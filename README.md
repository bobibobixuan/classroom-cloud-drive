# 课堂云盘 / Classroom Cloud Drive

这是一个面向课堂机房和校内局域网的文件协作系统，现阶段已经拆分为两条明确业务线：

- 个人云盘：上传、下载、批量分享、聊天栏提取码分享。
- 项目仓库：仓库大厅、私有仓库、协作者维护、加入申请、公告、日志，定位为班级内网版 GitHub。

项目采用 Go + FastAPI 双层结构：Go 负责静态前端与 API 代理，Python 负责认证、云盘、仓库、通知和管理员能力。

## 当前能力

- 用户注册、登录、退出，支持通过手机号邀请码注册。
- 个人云盘上传、下载、删除、批量权限调整、批量分享到聊天栏。
- 课堂聊天栏支持文字、图片、分享码，管理员可以重置聊天记录。
- 仓库大厅支持公开仓库浏览。
- 私有仓库支持邀请协作者共同维护。
- 仓库支持加入维护申请、撤回申请、批准/拒绝、协作者主动退出。
- 仓库支持公告、文件上传下载删除、仓库活动日志。
- 管理后台支持用户角色、配额、密码、冻结、资产转移、仓库治理、分享治理、回收站、审计日志。
- 通知中心支持未读红点、审批提醒、协作变更提醒。

## 架构说明

### Go 代理层

- 文件：[main.go](main.go)
- 作用：嵌入 dist 静态前端，代理 /api/* 请求。
- 默认监听地址：:80，可通过 CCD_LISTEN_ADDR 覆盖。
- 代理目标优先级：
  1. 显式设置的 CCD_API_BASE_URL
  2. 本地 http://127.0.0.1:4321
  3. 远端 https://pan.bobixuan.top:4321

### Python 后端

- 文件：[server.py](server.py)
- 框架：FastAPI + SQLite
- 默认端口：4321
- 本地运行时目录：
  - classroom.db
  - classroom_data/
  - repo_storage/

### 前端

- 目录：[dist](dist)
- 技术：Vue 3 + Vue Router
- 当前是静态源码方式，由 Go 直接嵌入并提供页面。

## 本地开发

### 1. 安装 Python 依赖

```powershell
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

### 2. 启动 FastAPI 后端

```powershell
.\.venv\Scripts\activate
python server.py
```

启动后默认监听 http://127.0.0.1:4321。

### 3. 启动 Go 前端代理

```powershell
$env:CCD_LISTEN_ADDR=':8088'
go run .
```

如果本地 4321 可达，Go 会自动进入“本地联调模式”；否则会退回远端 API。

### 4. 编译 Go 程序

```powershell
go build .
```

## 运行模式

### 本地联调模式

适合开发和调试。条件是本机 server.py 已启动，且 127.0.0.1:4321 可访问。

启动日志会显示：

- 模式：本地联调模式（静态页面 + 本地 FastAPI 转发）
- 远端 API: http://127.0.0.1:4321

### 中转代理模式

适合机房部署。学生只访问 Go 代理所在机器，代理再转发到远端后端。

### 显式自定义 API 模式

可以手动指定后端地址：

```powershell
$env:CCD_API_BASE_URL='https://example.com:4321'
$env:CCD_LISTEN_ADDR=':8088'
go run .
```

## 关键环境变量

- CCD_API_BASE_URL：指定后端 API 根地址。
- CCD_LISTEN_ADDR：指定 Go 代理监听地址。

## 默认数据与限制

- 单用户云盘默认配额：500 MB。
- 单仓库配额：1 GB。
- 仓库可见性：private / public。
- bobibobixuan 会被提升为超级管理员。

## 最近修复

### 通知气泡层级问题

- 现象：消息通知面板会被主页内容盖住或裁切。
- 修复：通知面板已调整为高层级 fixed 浮层，脱离原先的 overflow-hidden 裁切上下文。

### 超级管理员权限错判问题

- 现象：登录后前端显示成子管理员，或无法修改其他用户权限与容量。
- 修复：/api/drive 身份字段补全，前端身份合并逻辑修正，同时 Go 代理默认优先走本地新后端，避免继续命中远端旧接口。

## 常见排查

### 1. 页面功能和本地代码不一致

优先检查 Go 代理实际转发到哪里。启动日志里会明确打印当前 API 地址。

### 2. :8088 无法启动

说明端口被占用。换一个端口，或先释放占用进程。

### 3. pan.local 无法访问

机房里 mDNS 很容易被拦截，优先使用代理启动日志里打印的局域网 IP 地址。

## 仓库结构

- [main.go](main.go)：Go 静态前端与 API 代理
- [server.py](server.py)：FastAPI 后端
- [README.md](README.md)：项目说明
- [UPDATES.md](UPDATES.md)：更新记录
- [FEATURES_v2.md](FEATURES_v2.md)：功能规划说明
- [dist](dist)：前端页面与组件

## Git 提交建议

运行时目录和虚拟环境不应进入版本库。请使用本仓库的 [.gitignore](.gitignore) 来过滤：

- .venv/
- classroom.db
- classroom_data/
- repo_storage/

如果你要把本地联调结果同步到 GitHub，建议先确认 git status 中只包含预期文件，再执行提交与推送。
