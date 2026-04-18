# 🎉 课堂云盘功能更新说明

## ✨ 新增功能

### 1️⃣ 文件类型扩展
支持更多文件类型上传，包括：
- **文档**: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT, MD, CSV
- **图片**: JPG, JPEG, PNG, GIF, BMP, SVG, WEBP, ICO
- **压缩包**: ZIP, RAR, 7Z, TAR, GZ, BZ2
- **代码**: CPP, C, H, PY, JAVA, JS, TS, GO, RS, PHP, SQL, HTML, CSS, JSON, XML, YAML
- **音视频**: MP3, MP4, AVI, MOV, MKV, WAV, FLAC, M4A
- **其他**: EXE, MSI, ISO, DMG, APK

### 2️⃣ 账号改名字功能
用户现在可以修改用户名，具有以下特性：
- ✅ 新用户名长度验证（最少2个字符）
- ✅ 用户名唯一性检查
- ✅ 自动更新数据库中的所有相关记录
- ✅ 自动重命名用户数据文件夹
- ✅ 保留所有用户数据和文件

**操作方法**：点击顶部的"改用户名"按钮，输入新用户名确认即可

### 3️⃣ 注销账号功能
允许用户彻底注销账号，包括：
- ⚠️ 密码验证（防止误操作）
- ⚠️ 双重确认机制
- 🗑️ 永久删除所有用户数据
- 🗑️ 清除数据库中的所有相关记录

**操作方法**：点击顶部的"注销账号"按钮，输入密码并确认即可

### 4️⃣ 实时上传进度显示
上传文件时，用户可以看到：
- 📊 上传进度条（百分比）
- 📈 已上传/总大小（MB单位）
- 📱 实时更新的进度信息
- ✅ 上传完成后自动隐藏

**特点**：基于XMLHttpRequest的progress事件实现，支持大文件上传进度监控

---

## 🔧 后端变更（server.py）

### 新增API端点

#### `POST /api/rename`
修改用户名接口
- **参数**: 
  - `new_username` (Form): 新的用户名
  - `Authorization` (Header): Bearer Token
- **返回**: `{"msg": "修改成功", "new_username": "..."}`

#### `POST /api/delete-account`
注销账号接口
- **参数**:
  - `password` (Form): 用户密码（用于验证）
  - `Authorization` (Header): Bearer Token
- **返回**: `{"msg": "账号已注销"}`

### 文件扩展名白名表
`ALLOWED_EXTENSIONS` 从8个扩展名扩展到40+个扩展名

---

## 🎨 前端变更（dist/index.html）

### 新增UI组件
1. **顶部按钮栏**：改用户名、注销账号、退出登录三个按钮
2. **上传进度条**：显示上传进度和大小信息
3. **改用户名弹窗**：模态框输入新用户名
4. **注销账号弹窗**：模态框输入密码确认注销

### JavaScript新增函数
- `showRenameModal()` - 显示改用户名弹窗
- `closeRenameModal()` - 关闭改用户名弹窗
- `confirmRename()` - 确认改用户名
- `showDeleteModal()` - 显示注销账号弹窗
- `closeDeleteModal()` - 关闭注销账号弹窗
- `confirmDelete()` - 确认注销账号
- `upload()` - 改进的上传函数，支持进度显示

### CSS新增样式
- `.progress-bar` - 进度条容器
- `.progress-fill` - 进度条填充部分
- `.modal-overlay` - 模态框背景
- `.modal-content` - 模态框内容
- `.modal-header` - 弹窗标题
- `.modal-buttons` - 弹窗按钮组

---

## 🚀 使用建议

1. **首次使用**：建议先修改初始密码，然后体验改名和上传功能
2. **大文件上传**：查看进度条可以判断网络速度
3. **数据安全**：注销前请备份重要文件
4. **文件管理**：注册时使用真实手机号作为邀请码

---

## ⚡ 性能优化

- 上传进度使用原生 XMLHttpRequest，性能更好
- 模态框使用 CSS flexbox，动画流畅
- 数据库操作优化，批量删除效率高

---

## 🔐 安全性增强

- ✅ 用户名修改时检查唯一性
- ✅ 账号注销需要密码确认
- ✅ 数据库事务管理，防止数据不一致
- ✅ 前端双重确认机制，防止误操作

