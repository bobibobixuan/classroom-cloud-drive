import uvicorn
from fastapi import FastAPI, UploadFile, Form, Header, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
import os, sqlite3, uuid, re, shutil
from datetime import datetime

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_DIR = "./classroom_data"
DB_FILE = "./classroom.db"
os.makedirs(DATA_DIR, exist_ok=True)

# 🚀 配置：每个人 500MB 总限额
USER_QUOTA = 500 * 1024 * 1024
ALLOWED_EXTENSIONS = {
    # 文档
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".md", ".csv",
    # 图片
    ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".svg", ".webp", ".ico",
    # 压缩
    ".zip", ".rar", ".7z", ".tar", ".gz", ".bz2",
    # 代码
    ".cpp", ".c", ".h", ".py", ".java", ".js", ".ts", ".go", ".rs", ".php", ".sql", ".html", ".css", ".json", ".xml", ".yaml", ".yml",
    # 音视频
    ".mp3", ".mp4", ".avi", ".mov", ".mkv", ".wav", ".flac", ".m4a",
    # 其他
    ".exe", ".msi", ".iso", ".dmg", ".apk",
}

# 图片类型
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"}


def init_db():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute(
        """CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, password TEXT, phone TEXT UNIQUE)"""
    )
    c.execute(
        """CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, username TEXT)"""
    )
    c.execute(
        """CREATE TABLE IF NOT EXISTS shares (code TEXT PRIMARY KEY, username TEXT, filename TEXT)"""
    )
    # 🗨️ 新增：聊天信息表 (is_image 用于标记是否为图片)
    c.execute(
        """CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, content TEXT, share_code TEXT, image_data TEXT, time TEXT)"""
    )
    conn.commit()
    
    # 🔄 数据迁移：为旧的 messages 表添加缺失的列
    try:
        c.execute("PRAGMA table_info(messages)")
        columns = {row[1] for row in c.fetchall()}
        
        if "image_data" not in columns:
            c.execute("ALTER TABLE messages ADD COLUMN image_data TEXT")
            conn.commit()
    except:
        pass
    
    conn.close()


init_db()


def get_user_storage(username: str):
    user_dir = os.path.join(DATA_DIR, username)
    if not os.path.exists(user_dir):
        return 0
    return sum(
        os.path.getsize(os.path.join(user_dir, f))
        for f in os.listdir(user_dir)
        if os.path.isfile(os.path.join(user_dir, f))
    )


def get_user_by_token(token: str):
    if not token:
        raise HTTPException(status_code=401, detail="未登录")
    token = token.replace("Bearer ", "")
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT username FROM sessions WHERE token=?", (token,))
    row = c.fetchone()
    conn.close()
    if row:
        return row[0]
    raise HTTPException(status_code=401, detail="过期")


# ---------------- API ----------------


@app.get("/api/list")
def list_files(authorization: str = Header(None)):
    username = get_user_by_token(authorization)
    user_dir = os.path.join(DATA_DIR, username)
    files = []
    if os.path.exists(user_dir):
        for f in os.listdir(user_dir):
            files.append(
                {"name": f, "size": os.path.getsize(os.path.join(user_dir, f))}
            )
    return {"files": files, "used": get_user_storage(username), "quota": USER_QUOTA}


@app.post("/api/upload")
def upload_file(file: UploadFile, authorization: str = Header(None), content_length: int = Header(None)):
    username = get_user_by_token(authorization)
    
    # ✅ Bug #2 修复：检查文件扩展名
    _, ext = os.path.splitext(file.filename)
    if ext.lower() not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"不支持的文件类型: {ext}")
    
    # ✅ Bug #3 修复：使用 content-length 检查空间
    file_size = content_length or 0
    if get_user_storage(username) + file_size > USER_QUOTA:
        raise HTTPException(status_code=400, detail=f"空间不足！请删除一些旧文件再试")

    user_dir = os.path.join(DATA_DIR, username)
    os.makedirs(user_dir, exist_ok=True)
    with open(os.path.join(user_dir, file.filename), "wb") as f:
        f.write(file.file.read())
    return {"msg": "成功"}


@app.get("/api/download/{filename}")
def download_file(filename: str, authorization: str = Header(None)):
    """直接下载个人文件"""
    username = get_user_by_token(authorization)
    p = os.path.join(DATA_DIR, username, filename)
    if os.path.exists(p):
        return FileResponse(p, filename=filename)
    raise HTTPException(status_code=404, detail="文件不存在")


@app.get("/api/validate/{code}")
def validate_share(code: str):
    """验证分享文件是否仍然存在"""
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT username, filename FROM shares WHERE code=?", (code,))
    row = c.fetchone()
    conn.close()
    
    if not row:
        return {"valid": False, "reason": "分享码不存在"}
    
    p = os.path.join(DATA_DIR, row[0], row[1])
    if os.path.exists(p):
        return {"valid": True, "filename": row[1], "size": os.path.getsize(p)}
    else:
        return {"valid": False, "reason": "文件已被删除"}


# ---------------- 🗨️ 聊天与分享 ----------------


@app.post("/api/chat")
def send_chat(
    content: str = Form(""),
    share_code: str = Form(""),
    image_data: str = Form(""),
    authorization: str = Header(None),
):
    username = get_user_by_token(authorization)
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute(
        "INSERT INTO messages (username, content, share_code, image_data, time) VALUES (?,?,?,?,?)",
        (username, content, share_code, image_data, datetime.now().strftime("%H:%M")),
    )
    conn.commit()
    conn.close()
    return {"msg": "已发送"}


@app.get("/api/chat")
def get_chat():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute(
        "SELECT username, content, share_code, image_data, time FROM messages ORDER BY id DESC LIMIT 30"
    )
    rows = [
        {"user": r[0], "text": r[1], "code": r[2], "image": r[3], "time": r[4]} for r in c.fetchall()
    ]
    conn.close()
    return rows[::-1]  # 反转让最新的在下面


@app.post("/api/share/{filename}")
def share_file(filename: str, authorization: str = Header(None)):
    username = get_user_by_token(authorization)
    code = str(uuid.uuid4())[:6]
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("INSERT INTO shares VALUES (?,?,?)", (code, username, filename))
    conn.commit()
    conn.close()
    return {"code": code}


@app.get("/api/s/{code}")
def download_shared(code: str):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT username, filename FROM shares WHERE code=?", (code,))
    row = c.fetchone()
    conn.close()
    if row:
        p = os.path.join(DATA_DIR, row[0], row[1])
        if os.path.exists(p):
            return FileResponse(p, filename=row[1])
    raise HTTPException(status_code=404)


@app.post("/api/login")
def login(username: str = Form(...), password: str = Form(...)):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute(
        "SELECT * FROM users WHERE username=? AND password=?", (username, password)
    )
    if c.fetchone():
        token = str(uuid.uuid4())
        c.execute("DELETE FROM sessions WHERE username=?", (username,))
        c.execute("INSERT INTO sessions VALUES (?, ?)", (token, username))
        conn.commit()
        conn.close()
        return {"token": token, "username": username}
    conn.close()
    raise HTTPException(status_code=401)


@app.post("/api/register")
def register(
    username: str = Form(...), password: str = Form(...), phone: str = Form(...)
):
    if not re.match(r"^1[3-9]\d{9}$", phone):
        raise HTTPException(status_code=400, detail="邀请码错误")
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    try:
        c.execute("INSERT INTO users VALUES (?, ?, ?)", (username, password, phone))
        conn.commit()
    except:
        raise HTTPException(status_code=400, detail="已存在")
    finally:
        conn.close()
    return {"msg": "ok"}


@app.post("/api/rename")
def rename_account(new_username: str = Form(...), authorization: str = Header(None)):
    """修改用户名"""
    username = get_user_by_token(authorization)
    
    if not new_username or len(new_username) < 2:
        raise HTTPException(status_code=400, detail="用户名长度不能少于2个字符")
    
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    
    # 检查新用户名是否已被占用
    c.execute("SELECT * FROM users WHERE username=?", (new_username,))
    if c.fetchone():
        raise HTTPException(status_code=400, detail="用户名已被占用")
    
    try:
        # 更新用户表
        c.execute("UPDATE users SET username=? WHERE username=?", (new_username, username))
        # 更新会话表
        c.execute("UPDATE sessions SET username=? WHERE username=?", (new_username, username))
        # 更新消息表
        c.execute("UPDATE messages SET username=? WHERE username=?", (new_username, username))
        # 更新分享表
        c.execute("UPDATE shares SET username=? WHERE username=?", (new_username, username))
        
        # 重命名用户数据目录
        old_dir = os.path.join(DATA_DIR, username)
        new_dir = os.path.join(DATA_DIR, new_username)
        if os.path.exists(old_dir):
            os.rename(old_dir, new_dir)
        
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()
    
    return {"msg": "修改成功", "new_username": new_username}


@app.post("/api/delete-account")
def delete_account(password: str = Form(...), authorization: str = Header(None)):
    """注销账号（需要验证密码）"""
    username = get_user_by_token(authorization)
    
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    
    # 验证密码
    c.execute("SELECT password FROM users WHERE username=?", (username,))
    row = c.fetchone()
    if not row or row[0] != password:
        raise HTTPException(status_code=401, detail="密码错误")
    
    try:
        # 删除用户数据目录
        user_dir = os.path.join(DATA_DIR, username)
        if os.path.exists(user_dir):
            shutil.rmtree(user_dir)
        
        # 从数据库中删除用户相关数据
        c.execute("DELETE FROM users WHERE username=?", (username,))
        c.execute("DELETE FROM sessions WHERE username=?", (username,))
        c.execute("DELETE FROM messages WHERE username=?", (username,))
        c.execute("DELETE FROM shares WHERE username=?", (username,))
        
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()
    
    return {"msg": "账号已注销"}

# ---------------- 程序入口 ----------------
if __name__ == "__main__":
    print("=======================================")
    print("🚀 课堂云盘 - 服务端已启动")
    print("📡 正在监听 4321 端口...")
    print("=======================================")
    # 这里直接调用 uvicorn 运行当前的 app
    uvicorn.run(app, host="0.0.0.0", port=4321)
