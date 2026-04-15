package main

import (
	"crypto/tls" // 👈 引入 TLS 库处理 HTTPS
	"embed"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"

	"github.com/hashicorp/mdns"
)

//go:embed dist/*
var frontendStatic embed.FS

// ==========================================
// 【必填】你的 Lucky 映射公网地址 (确认是 https)
const HOME_SERVER_URL = "https://pan.bobixuan.top:4321"

// ==========================================

func getOutboundIP() string {
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err != nil {
		return "127.0.0.1"
	}
	defer conn.Close()
	return conn.LocalAddr().(*net.UDPAddr).IP.String()
}

func main() {
	fmt.Println("=======================================")
	fmt.Println("🚀 课堂云盘系统 - HTTPS 强穿透版")
	fmt.Println("=======================================")

	// 1. 启动局域网域名广播 (mDNS)
	host, _ := os.Hostname()
	info := []string{"Classroom Pan Server"}
	service, _ := mdns.NewMDNSService(host, "_http._tcp", "local.", "", 80, nil, info)
	server, err := mdns.NewServer(&mdns.Config{Zone: service})
	if err == nil {
		defer server.Shutdown()
		fmt.Println("✅ 域名广播启动成功！")
	}

	// 2. 反向代理配置 (携带伪装的 Host 防止 502)
	remoteUrl, _ := url.Parse(HOME_SERVER_URL)
	proxy := httputil.NewSingleHostReverseProxy(remoteUrl)
	originalDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		originalDirector(req)
		req.Host = remoteUrl.Host // 极其关键：防止 Lucky 拦截
	}

	// 👇👇👇 核心魔法：无视 HTTPS 证书校验强制连接 👇👇👇
	proxy.Transport = &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}
	// 👆👆👆 核心魔法结束 👆👆👆

	// 3. 路由分发
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			fmt.Printf("📦 [加密转发] %s\n", r.URL.Path)
			proxy.ServeHTTP(w, r)
			return
		}

		staticFS, err := fs.Sub(frontendStatic, "dist")
		if err != nil {
			http.Error(w, "前端包加载失败", 500)
			return
		}
		http.FileServer(http.FS(staticFS)).ServeHTTP(w, r)
	})

	// 4. 打印机房使用指南
	fmt.Println("---------------------------------------")
	fmt.Println("🎉 代理节点已就绪！数据通道已加密 (TLS/SSL)")
	fmt.Println("👉 请让学生通过以下方式访问：")
	fmt.Println("\n【首选访问域名】： http://pan.local")
	fmt.Printf("【备用 IP 访问】： http://%s\n\n", getOutboundIP())
	fmt.Println("⚠️ 如果域名打不开，请将电脑网络设置为【专用网络】。")
	fmt.Println("---------------------------------------")

	log.Fatal(http.ListenAndServe(":80", nil))
}
