# ☁️ Classroom Cloud Drive / 课堂云盘

[![Go Version](https://img.shields.io/badge/Go-1.18+-00ADD8?style=flat&logo=go)](https://go.dev/)
[![Python Version](https://img.shields.io/badge/Python-3.8+-3776AB?style=flat&logo=python)](https://python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688?style=flat&logo=fastapi)](https://fastapi.tiangolo.com/)
[![Vue.js](https://img.shields.io/badge/Vue.js-3.x-4FC08D?style=flat&logo=vuedotjs)](https://vuejs.org/)

🌍 **[English Version](#english-version)** | 🇨🇳 **[中文版](#中文版-chinese-version)**

---

<a id="english-version"></a>
# 🌍 English Version

**Classroom Cloud Drive** is a file collaboration system tailored for classroom computer labs and school local area networks (LANs). It has been split into two distinct business lines:
- **Personal Cloud Drive:** Upload, download, batch share, and share files via extraction codes in the chat.
- **Project Repositories:** A built-in "Classroom GitHub" featuring a public repo hall, private repositories, collaborator maintenance, join requests, announcements, and logs.

The project adopts a dual-layer architecture: **Go** handles the static frontend serving and API proxying, while **Python** powers the core business logic, storage, repositories, notifications, and admin capabilities.

## ✨ Current Capabilities

- **Authentication:** User registration, login, and logout. Supports registration via phone number/invitation code.
- **Personal Drive:** Upload, download, delete, batch permission adjustments, and batch sharing to the chat box.
- **Classroom Chat:** Supports text, images, and share codes. Admins can reset chat history.
- **Repo Hall:** Browse public repositories.
- **Private Repositories:** Invite collaborators for joint maintenance.
- **Repo Management:** Support for join requests, withdrawal of requests, approval/rejection, and voluntary exit by collaborators. Features announcements, file management (upload/download/delete), and activity logs.
- **Admin Panel:** Manage user roles, quotas, passwords, account freezing, asset transfers, repo/share governance, global recycle bin, and audit logs.
- **Notification Center:** Unread badges, approval reminders, and collaboration change alerts.

## 🏗️ Architecture Description

### Go Proxy Layer
- **File:** [`main.go`](main.go)
- **Role:** Embeds the `dist` static frontend and proxies `/api/*` requests.
- **Default Port:** `:80` (can be overridden via `CCD_LISTEN_ADDR`).
- **Proxy Target Priority:**
  1. Explicitly set `CCD_API_BASE_URL`
  2. Local `http://127.0.0.1:4321`
  3. Remote `https://pan.bobixuan.top:4321`

### Python Backend
- **File:** [`server.py`](server.py)
- **Framework:** FastAPI + SQLite
- **Default Port:** `4321`
- **Local Runtime Directories:** `classroom.db`, `classroom_data/`, `repo_storage/`

### Frontend
- **Directory:** [`dist`](dist)
- **Tech Stack:** Vue 3 + Vue Router (Static source code embedded directly by Go).

## 🚀 Local Development

### 1. Install Python Dependencies
```powershell
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
````

### 2\. Start FastAPI Backend

```powershell
.\.venv\Scripts\activate
python server.py
```

*Listens on `http://127.0.0.1:4321` by default.*

### 3\. Start Go Frontend Proxy

```powershell
$env:CCD_LISTEN_ADDR=':8088'
go run .
```

*If local port `4321` is reachable, Go enters "Local Dev Mode"; otherwise, it falls back to the remote API.*

### 4\. Build Go Executable

```powershell
go build .
```

## ⚙️ Run Modes

  - **Local Dev Mode:** For development. Requires `server.py` to be running and `127.0.0.1:4321` to be accessible.
  - **Relay Proxy Mode:** Ideal for lab deployment. Students connect to the Go proxy machine, which forwards requests to the remote backend.
  - **Explicit API Mode:** Manually specify the backend address:
    ```powershell
    $env:CCD_API_BASE_URL='[https://example.com:4321](https://example.com:4321)'
    $env:CCD_LISTEN_ADDR=':8088'
    go run .
    ```

## 📊 Default Data & Limits

  - **Personal Drive Quota:** 500 MB per user.
  - **Repository Quota:** 1 GB per repo.
  - **Repo Visibility:** Private / Public.
  - **Super Admin:** The user `bobibobixuan` is automatically elevated to super admin.

## 🔧 Recent Fixes

  - **Notification Bubble Layer Issue:** Fixed an issue where the notification panel was covered by the homepage content. It is now a high-z-index fixed layer.
  - **Super Admin Permission Error:** Fixed frontend displaying super admin as sub-admin or failing to edit other users. Merged identity logic in frontend and prioritized local backend in Go proxy.

## 🛠️ Troubleshooting

1.  **Mismatched local code/functions:** Check the Go proxy startup logs to see where the API is actually forwarding.
2.  **Cannot start on `:8088`:** Port is occupied. Change the port or kill the blocking process.
3.  **Cannot access `pan.local`:** mDNS is easily blocked in computer labs. Use the LAN IP printed in the proxy startup logs instead.

## 📂 Repository Structure

  - [`main.go`](https://www.google.com/search?q=main.go): Go static frontend & API proxy
  - [`server.py`](https://www.google.com/search?q=server.py): FastAPI backend
  - [`README.md`](README.md): Project documentation
  - [`UPDATES.md`](UPDATES.md): Changelog
  - [`FEATURES_v2.md`](https://www.google.com/search?q=FEATURES_v2.md): Future feature planning
  - [`dist`](https://www.google.com/search?q=dist): Frontend pages & components

## 💡 Git Commit Advice

Runtime directories and virtual environments should not be committed. Please use the `.gitignore` provided:

  - `.venv/`
  - `classroom.db`
  - `classroom_data/`
  - `repo_storage/`

Before syncing to GitHub, ensure `git status` only contains expected files.

-----

\<a id="中文版-chinese-version"\>\</a\>

# 🇨🇳 中文版 (Chinese Version)

这是一个面向课堂机房和校内局域网的文件协作系统，现阶段已经拆分为两条明确业务线：

  - **个人云盘**：上传、下载、批量分享、聊天栏提取码分享。
  - **项目仓库**：仓库大厅、私有仓库、协作者维护、加入申请、公告、日志，定位为班级内网版 GitHub。

项目采用 Go + FastAPI 双层结构：Go 负责静态前端与 API 代理，Python 负责认证、云盘、仓库、通知和管理员能力。

## ✨ 当前能力

  - 用户注册、登录、退出，支持通过手机号邀请码注册。
  - 个人云盘上传、下载、删除、批量权限调整、批量分享到聊天栏。
  - 课堂聊天栏支持文字、图片、分享码，管理员可以重置聊天记录。
  - 仓库大厅支持公开仓库浏览。
  - 私有仓库支持邀请协作者共同维护。
  - 仓库支持加入维护申请、撤回申请、批准/拒绝、协作者主动退出。
  - 仓库支持公告、文件上传下载删除、仓库活动日志。
  - 管理后台支持用户角色、配额、密码、冻结、资产转移、仓库治理、分享治理、回收站、审计日志。
  - 通知中心支持未读红点、审批提醒、协作变更提醒。

## 🏗️ 架构说明

### Go 代理层

  - **文件**：[`main.go`](https://www.google.com/search?q=main.go)
  - **作用**：嵌入 `dist` 静态前端，代理 `/api/*` 请求。
  - **默认监听地址**：`:80`，可通过 `CCD_LISTEN_ADDR` 覆盖。
  - **代理目标优先级**：
    1.  显式设置的 `CCD_API_BASE_URL`
    2.  本地 `http://127.0.0.1:4321`
    3.  远端 `https://pan.bobixuan.top:4321`

### Python 后端

  - **文件**：[`server.py`](https://www.google.com/search?q=server.py)
  - **框架**：FastAPI + SQLite
  - **默认端口**：`4321`
  - **本地运行时目录**：`classroom.db`, `classroom_data/`, `repo_storage/`

### 前端

  - **目录**：[`dist`](https://www.google.com/search?q=dist)
  - **技术**：Vue 3 + Vue Router（当前是静态源码方式，由 Go 直接嵌入并提供页面）。

## 🚀 本地开发

### 1\. 安装 Python 依赖

```powershell
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

### 2\. 启动 FastAPI 后端

```powershell
.\.venv\Scripts\activate
python server.py
```

*启动后默认监听 `http://127.0.0.1:4321`。*

### 3\. 启动 Go 前端代理

```powershell
$env:CCD_LISTEN_ADDR=':8088'
go run .
```

*如果本地 `4321` 可达，Go 会自动进入“本地联调模式”；否则会退回远端 API。*

### 4\. 编译 Go 程序

```powershell
go build .
```

## ⚙️ 运行模式

  - **本地联调模式**：适合开发和调试。条件是本机 `server.py` 已启动，且 `127.0.0.1:4321` 可访问。
  - **中转代理模式**：适合机房部署。学生只访问 Go 代理所在机器，代理再转发到远端后端。
  - **显式自定义 API 模式**：可以手动指定后端地址：
    ```powershell
    $env:CCD_API_BASE_URL='[https://example.com:4321](https://example.com:4321)'
    $env:CCD_LISTEN_ADDR=':8088'
    go run .
    ```

## 📊 默认数据与限制

  - 单用户云盘默认配额：500 MB。
  - 单仓库配额：1 GB。
  - 仓库可见性：private / public。
  - `bobibobixuan` 会被默认提升为超级管理员。

## 🔧 最近修复

  - **通知气泡层级问题**：修复了消息通知面板会被主页内容盖住或裁切的问题，现已调整为高层级 `fixed` 浮层。
  - **超级管理员权限错判问题**：修复了登录后前端显示成子管理员或无法修改其他用户权限的问题。补全了身份字段并修正了身份合并逻辑。

## 🛠️ 常见排查

1.  **页面功能和本地代码不一致**：优先检查 Go 代理实际转发到哪里。启动日志里会明确打印当前 API 地址。
2.  **`:8088` 无法启动**：说明端口被占用。换一个端口，或先释放占用进程。
3.  **`pan.local` 无法访问**：机房里 mDNS 很容易被拦截，优先使用代理启动日志里打印的局域网 IP 地址。

## 📂 仓库结构

  - [`main.go`](https://www.google.com/search?q=main.go)：Go 静态前端与 API 代理
  - [`server.py`](https://www.google.com/search?q=server.py)：FastAPI 后端
  - [`README.md`](README.md)：项目说明
  - [`UPDATES.md`](UPDATES.md)：更新记录
  - [`FEATURES_v2.md`](https://www.google.com/search?q=FEATURES_v2.md)：功能规划说明
  - [`dist`](https://www.google.com/search?q=dist)：前端页面与组件

## 💡 Git 提交建议

运行时目录和虚拟环境不应进入版本库。请使用本仓库的 `.gitignore` 来过滤：

  - `.venv/`
  - `classroom.db`
  - `classroom_data/`
  - `repo_storage/`


```
```
