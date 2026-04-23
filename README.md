# Classroom Cloud Drive / 课堂云盘

[![Go Version](https://img.shields.io/badge/Go-1.18+-00ADD8?style=flat&logo=go)](https://go.dev/)
[![Python Version](https://img.shields.io/badge/Python-3.8+-3776AB?style=flat&logo=python)](https://python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688?style=flat&logo=fastapi)](https://fastapi.tiangolo.com/)
[![Vue.js](https://img.shields.io/badge/Vue.js-3.x-4FC08D?style=flat&logo=vuedotjs)](https://vuejs.org/)

[English Version](#english-version) | [中文版](#中文版)

---

## English Version

Classroom Cloud Drive is a LAN-oriented collaboration system for classroom labs. It currently provides two core business areas:

- Personal cloud drive: upload, download, delete, batch sharing, and chat-based share-code distribution.
- Project repositories: public repo hall, private repositories, collaborators, join requests, announcements, file management, and activity logs.

The runtime is split into two layers:

- [main.go](main.go): Go static frontend host and API proxy.
- [server.py](server.py): FastAPI backend with SQLite storage.

### Current Capabilities

- Authentication with whitelist-backed register/login/logout.
- Personal drive with upload, download, delete, batch visibility changes, and batch share-to-chat.
- Classroom chat with text, images, and share codes.
- Public repo hall and private collaborative repositories.
- Repository join requests, approval flow, collaborator self-leave, announcements, and activity logs.
- Admin management for users, quotas, passwords, account status, asset transfer, share governance, recycle bin cleanup, and audit logs.
- Notification center with unread badges and approval reminders.
- Split admin frontend navigation: admin settings and audit logs are now separate pages.
- Account display can render nickname plus muted real-name text when whitelist data is available.

### Admin Console Layout

- Admin settings entry: /admin/users
- Repository settings: /admin/repos
- Public share settings: /admin/shares
- Recycle cleanup: /admin/recycle
- Audit log center: /admin/logs

Regular admins only see the sections allowed by their delegated admin scopes. Super admin keeps full access.

### Architecture

#### Go Proxy Layer

- Entry: [main.go](main.go)
- Role: embeds the [dist](dist) frontend and proxies all /api/* requests.
- Default listen address: :80, override with CCD_LISTEN_ADDR.
- Backend target priority:
  1. CCD_API_BASE_URL
  2. http://127.0.0.1:4321
  3. https://pan.bobixuan.top:4321

#### Python Backend

- Entry: [server.py](server.py)
- Framework: FastAPI + SQLite
- Default port: 4321
- Runtime data: classroom.db, classroom_data/, repo_storage/

#### Frontend

- Source directory: [dist](dist)
- Stack: Vue 3 + Vue Router, embedded directly by Go

### Local Development

#### 1. Install Python dependencies

```powershell
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

#### 2. Start the backend

```powershell
.\.venv\Scripts\activate
python server.py
```

The backend listens on http://127.0.0.1:4321 by default.

#### 3. Start the Go proxy

```powershell
$env:CCD_LISTEN_ADDR=':8088'
go run .
```

If the local backend is reachable, Go uses local dev mode automatically. Otherwise it falls back to the configured remote API.

#### 4. Build the Windows executable

```powershell
go build -o pan.exe .
```

The default Windows build artifact in this repository is pan.exe.

### Run Modes

- Local dev mode: use local server.py on 127.0.0.1:4321.
- Relay proxy mode: students access the Go machine, which forwards to the remote backend.
- Explicit API mode:

```powershell
$env:CCD_API_BASE_URL='https://example.com:4321'
$env:CCD_LISTEN_ADDR=':8088'
go run .
```

### Default Limits

- Personal drive quota: 500 MB per user
- Repository quota: 1 GB per repository
- Repository visibility: private / public
- Super admin account: bobibobixuan

### Recent UI / Admin Changes

- Notification popup is now rendered as a fixed top-level layer to avoid clipping.
- Super admin identity handling and admin scope propagation were fixed.
- Admin role assignment now falls back to default delegated scopes when an admin is created or promoted without explicit scope selection.
- Registration is now whitelist-based, binds imported phone numbers to real names, and generates nickname_realname accounts.
- Imported whitelist data now reconciles with historical user phone numbers, so old accounts can display real names without re-registering.
- Admin console was reorganized into subpages:
  - /admin/users
  - /admin/repos
  - /admin/shares
  - /admin/recycle
  - /admin/logs
- Audit logs are exposed as a separate admin menu item below admin settings.
- The admin user area now contains a dedicated whitelist subpanel for importing and reviewing registration slots.
- Login/register pages now show persistent inline feedback for field validation, wrong passwords, frozen accounts, and post-registration guidance.
- The chat drawer now keeps the composer visible on open, stays pinned to the latest messages more reliably, and shows muted real names next to nicknames.

### Troubleshooting

1. If the UI does not match local code, check the Go proxy startup log to confirm which backend URL is active.
2. If :8088 cannot start, change the port or release the process using it.
3. If pan.local is unavailable, use the LAN IP printed by the Go proxy.
4. If admin changes appear ineffective, confirm the Go proxy is pointing at the same backend instance whose classroom.db you inspected.

### Repository Layout

- [main.go](main.go): Go static frontend host and API proxy
- [server.py](server.py): FastAPI backend
- [README.md](README.md): project documentation
- [UPDATES.md](UPDATES.md): update log
- [dist](dist): frontend source embedded by Go
- [classroom_data](classroom_data): local drive/chat runtime data
- [repo_storage](repo_storage): repository file storage

### Git Advice

Do not commit runtime data or local environments:

- .venv/
- classroom.db
- classroom_data/
- repo_storage/

Before pushing, make sure git status only shows intended source changes.

---

## 中文版

课堂云盘是一个面向机房和校内局域网的文件协作系统，目前分为两条核心业务线：

- 个人云盘：上传、下载、删除、批量分享，以及聊天栏提取码分享。
- 项目仓库：仓库大厅、私有仓库、协作者、加入申请、公告、文件管理和仓库活动日志。

系统采用双层结构：

- [main.go](main.go)：Go 静态前端承载与 API 代理。
- [server.py](server.py)：FastAPI + SQLite 后端。

### 当前能力

- 基于白名单的用户注册、登录、退出。
- 个人云盘上传、下载、删除、批量公开设置、批量分享到聊天栏。
- 课堂聊天支持文本、图片、分享码。
- 仓库大厅和私有协作仓库。
- 仓库加入申请、审批流、协作者主动退出、公告和仓库活动日志。
- 管理后台支持用户、配额、密码、冻结、资产转移、分享治理、回收站清理和审计日志。
- 通知中心支持未读红点和审批提醒。
- 管理后台前端已拆成独立配置页和独立日志页。
- 当白名单实名可用时，前端账号显示支持“昵称 + 浅色实名”。

### 管理后台布局

- 管理员配置入口：/admin/users
- 仓库设置：/admin/repos
- 公开链接设置：/admin/shares
- 回收站清理：/admin/recycle
- 操作日志中心：/admin/logs

普通管理员只会看到自己被下放权限允许的分区，超级管理员保留完整访问权限。

### 架构说明

#### Go 代理层

- 入口文件：[main.go](main.go)
- 作用：嵌入 [dist](dist) 前端并代理所有 /api/* 请求。
- 默认监听：:80，可通过 CCD_LISTEN_ADDR 覆盖。
- 后端目标优先级：
  1. CCD_API_BASE_URL
  2. http://127.0.0.1:4321
  3. https://pan.bobixuan.top:4321

#### Python 后端

- 入口文件：[server.py](server.py)
- 技术栈：FastAPI + SQLite
- 默认端口：4321
- 本地运行数据：classroom.db、classroom_data/、repo_storage/

#### 前端

- 源码目录：[dist](dist)
- 技术：Vue 3 + Vue Router，由 Go 直接嵌入提供

### 本地开发

#### 1. 安装 Python 依赖

```powershell
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

#### 2. 启动后端

```powershell
.\.venv\Scripts\activate
python server.py
```

默认监听 http://127.0.0.1:4321。

#### 3. 启动 Go 前端代理

```powershell
$env:CCD_LISTEN_ADDR=':8088'
go run .
```

如果本地后端可达，Go 会自动走本地联调模式，否则退回远端 API。

#### 4. 打包 Windows 可执行文件

```powershell
go build -o pan.exe .
```

当前仓库默认输出的 Windows 可执行文件名为 pan.exe。

### 运行模式

- 本地联调模式：直接连本地 server.py。
- 中转代理模式：学生访问 Go 代理机，再由代理转发到远端后端。
- 显式指定 API 模式：

```powershell
$env:CCD_API_BASE_URL='https://example.com:4321'
$env:CCD_LISTEN_ADDR=':8088'
go run .
```

### 默认限制

- 单用户云盘默认配额：500 MB
- 单仓库默认配额：1 GB
- 仓库可见性：private / public
- 默认超级管理员账号：bobibobixuan

### 最近界面与权限调整

- 通知气泡调整为顶层 fixed 浮层，避免被裁切。
- 超级管理员身份同步和管理员 scope 继承逻辑已修复。
- 当创建或提升子管理员时，如果没有显式勾选权限范围，后端会自动补齐默认下放权限。
- 注册已改为白名单制：手机号导入后绑定真实姓名，注册成功后会消费名额，并生成 昵称_真实姓名 账号。
- 白名单导入会自动回填历史用户手机号，旧账号不需要重新注册也能补上实名展示。
- 管理后台拆分为独立子页面：
  - /admin/users
  - /admin/repos
  - /admin/shares
  - /admin/recycle
  - /admin/logs
- 审计日志已从管理员配置中拆出，作为单独菜单展示。
- 管理员用户页内部新增“注册白名单”子块，用来导入名单和查看待注册/已注册流转。
- 登录与注册页面增加了表单内提示，能直接显示密码错误、字段缺失、账号冻结和注册后登录指引。
- 聊天抽屉已优化为更稳定的底部输入区布局，并支持显示发言人的浅色实名与快速回到底部。

### 常见排查

1. 页面表现和本地代码不一致时，优先看 Go 代理启动日志里的实际 API 地址。
2. :8088 无法启动时，换端口或结束占用进程。
3. pan.local 无法访问时，优先使用 Go 代理输出的局域网 IP。
4. 管理员操作看似未生效时，先确认当前 Go 代理连接的后端，是否就是你查看过 classroom.db 的那一份实例。

### 仓库结构

- [main.go](main.go)：Go 静态前端承载与 API 代理
- [server.py](server.py)：FastAPI 后端
- [README.md](README.md)：项目文档
- [UPDATES.md](UPDATES.md)：更新记录
- [dist](dist)：由 Go 直接嵌入的前端源码
- [classroom_data](classroom_data)：本地云盘与聊天运行数据
- [repo_storage](repo_storage)：仓库文件存储

### Git 提交建议

运行时目录和本地环境不要提交进版本库：

- .venv/
- classroom.db
- classroom_data/
- repo_storage/

提交前先确认 git status 里只剩你预期的源码变更。
