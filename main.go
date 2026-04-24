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
	"sort"
	"strconv"
	"strings"
	"time"
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

func resolveMachineHostname() string {
	host, err := os.Hostname()
	if err != nil {
		return ""
	}
	host = strings.TrimSpace(strings.ToLower(host))
	host = strings.TrimSuffix(host, ".")
	return host
}

func getLANIPv4s() []net.IP {
	interfaces, err := net.Interfaces()
	if err != nil {
		return nil
	}

	uniqueIPs := make(map[string]net.IP)
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}

		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}

		for _, addr := range addrs {
			var ip net.IP
			switch value := addr.(type) {
			case *net.IPNet:
				ip = value.IP
			case *net.IPAddr:
				ip = value.IP
			}

			ip = ip.To4()
			if ip == nil || ip.IsLoopback() || ip.IsUnspecified() {
				continue
			}

			uniqueIPs[ip.String()] = ip
		}
	}

	if len(uniqueIPs) == 0 {
		return nil
	}

	sortedKeys := make([]string, 0, len(uniqueIPs))
	for key := range uniqueIPs {
		sortedKeys = append(sortedKeys, key)
	}
	sort.Strings(sortedKeys)

	ips := make([]net.IP, 0, len(sortedKeys))
	for _, key := range sortedKeys {
		ips = append(ips, uniqueIPs[key])
	}
	return ips
}

func parseListenPort(listenAddr string) int {
	trimmed := strings.TrimSpace(listenAddr)
	if trimmed == "" {
		return 80
	}
	if strings.HasPrefix(trimmed, ":") {
		if port, err := strconv.Atoi(strings.TrimPrefix(trimmed, ":")); err == nil && port > 0 {
			return port
		}
	}
	if !strings.Contains(trimmed, ":") {
		if port, err := strconv.Atoi(trimmed); err == nil && port > 0 {
			return port
		}
	}
	_, portText, err := net.SplitHostPort(trimmed)
	if err == nil {
		if port, convErr := strconv.Atoi(portText); convErr == nil && port > 0 {
			return port
		}
	}
	return 80
}

func formatHTTPURL(host string, port int) string {
	if port == 80 {
		return fmt.Sprintf("http://%s", host)
	}
	return fmt.Sprintf("http://%s:%d", host, port)
}

func formatIPv4List(ips []net.IP) string {
	values := make([]string, 0, len(ips))
	for _, ip := range ips {
		values = append(values, ip.String())
	}
	return strings.Join(values, ", ")
}

func apiModeLabel(source string) string {
	switch source {
	case "env":
		return "自定义 API 代理模式"
	case "local":
		return "本地联调模式"
	default:
		return "中转代理模式"
	}
}

func main() {
	remoteAPIURL, apiSource := resolveAPIBaseURL()
	listenAddr := getEnv("CCD_LISTEN_ADDR", defaultListenAddr)
	listenPort := parseListenPort(listenAddr)
	machineHost := resolveMachineHostname()
	lanIPs := getLANIPv4s()

	remoteURL, err := url.Parse(remoteAPIURL)
	if err != nil || remoteURL.Scheme == "" || remoteURL.Host == "" {
		log.Fatalf("远端 API 地址无效: %q", remoteAPIURL)
	}

	fmt.Println("=======================================")
	fmt.Println("课堂云盘前端代理已启动")
	fmt.Printf("模式：%s\n", apiModeLabel(apiSource))
	fmt.Println("=======================================")

	proxy := httputil.NewSingleHostReverseProxy(remoteURL)
	originalDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		originalDirector(req)
		req.Host = remoteURL.Host
	}
	proxy.Transport = &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}

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

	fmt.Println("---------------------------------------")
	fmt.Println("连接信息")
	if machineHost != "" {
		fmt.Printf("- 主机名: %s\n", machineHost)
		fmt.Printf("- 主机名访问: %s\n", formatHTTPURL(machineHost, listenPort))
	} else {
		fmt.Println("- 主机名: 未获取")
	}
	if len(lanIPs) > 0 {
		fmt.Printf("- 局域网 IPv4: %s\n", formatIPv4List(lanIPs))
		for index, ip := range lanIPs {
			fmt.Printf("- IP 访问 %d: %s\n", index+1, formatHTTPURL(ip.String(), listenPort))
		}
	} else {
		fmt.Println("- 局域网 IPv4: 未检测到可用地址")
	}
	fmt.Printf("- 本机回环: %s\n", formatHTTPURL("127.0.0.1", listenPort))
	fmt.Printf("- 监听地址: %s\n", listenAddr)
	fmt.Printf("- 监听端口: %d\n", listenPort)
	fmt.Printf("- 后端模式: %s\n", apiModeLabel(apiSource))
	fmt.Printf("- 当前后端: %s\n", remoteAPIURL)
	fmt.Printf("- 后端主机: %s\n", remoteURL.Host)
	fmt.Println("- 前端根路径: /")
	fmt.Println("- API 前缀: /api/")
	fmt.Println("---------------------------------------")

	log.Fatal(http.ListenAndServe(listenAddr, nil))
}
