import uvicorn
from fastapi import FastAPI, UploadFile, Form, Header, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
import os, sqlite3, uuid, re
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
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".txt",
    ".jpg",
    ".jpeg",
    ".png",
    ".zip",
    ".rar",
    ".7z",
    ".cpp",
    ".py",
}


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
    # 🗨️ 新增：聊天信息表 (is_share 用于标记是否为文件分享)
    c.execute(
        """CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, content TEXT, share_code TEXT, time TEXT)"""
    )
    conn.commit()
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


@app.delete("/api/files/{filename}")
def delete_file(filename: str, authorization: str = Header(None)):
    username = get_user_by_token(authorization)
    p = os.path.join(DATA_DIR, username, filename)
    if os.path.exists(p):
        os.remove(p)
    return {"msg": "已删除"}


# ---------------- 🗨️ 聊天与分享 ----------------


@app.post("/api/chat")
def send_chat(
    content: str = Form(...),
    share_code: str = Form(""),
    authorization: str = Header(None),
):
    username = get_user_by_token(authorization)
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute(
        "INSERT INTO messages (username, content, share_code, time) VALUES (?,?,?,?)",
        (username, content, share_code, datetime.now().strftime("%H:%M")),
    )
    conn.commit()
    conn.close()
    return {"msg": "已发送"}


@app.get("/api/chat")
def get_chat():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute(
        "SELECT username, content, share_code, time FROM messages ORDER BY id DESC LIMIT 30"
    )
    rows = [
        {"user": r[0], "text": r[1], "code": r[2], "time": r[3]} for r in c.fetchall()
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

# ---------------- 程序入口 ----------------
if __name__ == "__main__":
    print("=======================================")
    print("🚀 课堂云盘 - 服务端已启动")
    print("📡 正在监听 4321 端口...")
    print("=======================================")
    # 这里直接调用 uvicorn 运行当前的 app
    uvicorn.run(app, host="0.0.0.0", port=4321)
