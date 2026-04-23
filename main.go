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
	"path"
	"strings"
	"time"

	"github.com/hashicorp/mdns"
)

//go:embed all:dist
var frontendStatic embed.FS

const (
	defaultLocalAPIURL  = "http://127.0.0.1:4321"
	defaultRemoteAPIURL = "https://pan.bobixuan.top:4321"
	defaultListenAddr   = ":80"
)

func getEnv(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func isAPIReachable(rawURL string) bool {
	parsedURL, err := url.Parse(rawURL)
	if err != nil || parsedURL.Host == "" {
		return false
	}

	transport := &http.Transport{}
	if parsedURL.Scheme == "https" {
		transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}
	}

	client := &http.Client{
		Timeout:   1200 * time.Millisecond,
		Transport: transport,
	}
	resp, err := client.Get(rawURL)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return true
}

func resolveAPIBaseURL() (string, string) {
	if explicit := strings.TrimSpace(os.Getenv("CCD_API_BASE_URL")); explicit != "" {
		return explicit, "env"
	}
	if isAPIReachable(defaultLocalAPIURL) {
		return defaultLocalAPIURL, "local"
	}
	return defaultRemoteAPIURL, "remote"
}

func getOutboundIP() string {
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err != nil {
		return "127.0.0.1"
	}
	defer conn.Close()
	return conn.LocalAddr().(*net.UDPAddr).IP.String()
}

func main() {
	remoteAPIURL, apiSource := resolveAPIBaseURL()
	listenAddr := getEnv("CCD_LISTEN_ADDR", defaultListenAddr)

	remoteURL, err := url.Parse(remoteAPIURL)
	if err != nil || remoteURL.Scheme == "" || remoteURL.Host == "" {
		log.Fatalf("远端 API 地址无效: %q", remoteAPIURL)
	}

	fmt.Println("=======================================")
	fmt.Println("课堂云盘前端代理已启动")
	switch apiSource {
	case "env":
		fmt.Println("模式：自定义 API 代理模式（静态页面 + 指定 API 转发）")
	case "local":
		fmt.Println("模式：本地联调模式（静态页面 + 本地 FastAPI 转发）")
	default:
		fmt.Println("模式：中转代理模式（静态页面 + 远端 API 转发）")
	}
	fmt.Println("=======================================")

	// 1. 启动局域网域名广播 (mDNS)
	host, _ := os.Hostname()
	info := []string{"Classroom Pan Server"}
	service, _ := mdns.NewMDNSService(host, "_http._tcp", "local.", "", 80, nil, info)
	server, err := mdns.NewServer(&mdns.Config{Zone: service})
	if err == nil {
		defer server.Shutdown()
		fmt.Printf("[mDNS] 已广播局域网域名: http://%s.local\n", strings.ToLower(host))
	}

	// 2. 反向代理配置 (携带伪装的 Host 防止 502)
	proxy := httputil.NewSingleHostReverseProxy(remoteURL)
	originalDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		originalDirector(req)
		req.Host = remoteURL.Host // 极其关键：防止 Lucky 拦截
	}

	// 👇👇👇 核心魔法：无视 HTTPS 证书校验强制连接 👇👇👇
	proxy.Transport = &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}
	// 👆👆👆 核心魔法结束 👆👆👆

	// 3. 路由分发
	staticFS, err := fs.Sub(frontendStatic, "dist")
	if err != nil {
		log.Fatal("前端包加载失败:", err)
	}
	fileServer := http.FileServer(http.FS(staticFS))
	indexHTML, err := fs.ReadFile(staticFS, "index.html")
	if err != nil {
		log.Fatal("前端入口加载失败:", err)
	}
	serveIndex := func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if r.Method == http.MethodHead {
			w.WriteHeader(http.StatusOK)
			return
		}
		_, _ = w.Write(indexHTML)
	}

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			fmt.Printf("[API 代理] %-6s %s -> %s\n", r.Method, r.URL.Path, remoteURL.Host)
			proxy.ServeHTTP(w, r)
			return
		}

		cleanPath := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if cleanPath == "." || cleanPath == "" {
			serveIndex(w, r)
			return
		}

		if _, statErr := fs.Stat(staticFS, cleanPath); statErr == nil {
			fileServer.ServeHTTP(w, r)
			return
		}

		serveIndex(w, r)
	})

	// 4. 打印机房使用指南
	fmt.Println("---------------------------------------")
	fmt.Println("访问入口")
	fmt.Println("- 首选域名: http://pan.local")
	fmt.Printf("- 备用地址: http://%s\n", getOutboundIP())
	fmt.Printf("- 当前监听: http://127.0.0.1%s\n", listenAddr)
	fmt.Printf("- 远端 API: %s\n", remoteAPIURL)
	if apiSource == "local" {
		fmt.Println("提示：已自动检测到本地后端，当前页面会直接使用本机 server.py。")
	} else if apiSource == "remote" {
		fmt.Println("提示：未检测到本地后端，当前仍回退到远端 API。")
		fmt.Println("提示：如需联调本地后端，请先启动 server.py，或设置 CCD_API_BASE_URL。")
	}
	fmt.Println("提示：学生机只访问本机地址；只要这台中转机能连上远端 API 即可。")
	fmt.Println("提示：如果 pan.local 打不开，请把当前网络切到“专用网络”。")
	fmt.Println("---------------------------------------")

	log.Fatal(http.ListenAndServe(listenAddr, nil))
}
