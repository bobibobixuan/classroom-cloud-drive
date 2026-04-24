import os
import asyncio
import base64
import binascii
import importlib.metadata
import json
import mimetypes
import re
import shutil
import sqlite3
import uuid
from datetime import datetime
from types import SimpleNamespace
from typing import Optional
from urllib.parse import quote

import bcrypt
import uvicorn
from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from passlib.context import CryptContext


def patch_bcrypt_backend_compatibility():
    if not hasattr(bcrypt, "__about__"):
        try:
            version = importlib.metadata.version("bcrypt")
        except importlib.metadata.PackageNotFoundError:
            version = ""
        bcrypt.__about__ = SimpleNamespace(__version__=version)

    original_hashpw = getattr(bcrypt, "hashpw", None)
    if not callable(original_hashpw) or getattr(original_hashpw, "_passlib_compat", False):
        return

    def compat_hashpw(password: bytes, salt: bytes):
        secret = password.encode("utf-8") if isinstance(password, str) else password
        return original_hashpw(secret[:72], salt)

    compat_hashpw._passlib_compat = True
    bcrypt.hashpw = compat_hashpw


patch_bcrypt_backend_compatibility()

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_DIR = "./classroom_data"
REPO_DIR = "./repo_storage"
CHAT_IMAGE_DIR = os.path.join(DATA_DIR, "chat_images")
RECYCLE_BIN_DIR = os.path.join(DATA_DIR, "recycle_bin")
DB_FILE = "./classroom.db"
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(REPO_DIR, exist_ok=True)
os.makedirs(CHAT_IMAGE_DIR, exist_ok=True)
os.makedirs(RECYCLE_BIN_DIR, exist_ok=True)

USER_QUOTA = 500 * 1024 * 1024
REPO_QUOTA = 1024 * 1024 * 1024
SUPER_ADMIN_USERNAME = "bobibobixuan"
ROLE_USER = "user"
ROLE_ADMIN = "admin"
ROLE_SUPER_ADMIN = "super_admin"
WHITELIST_STATUS_PENDING = "pending"
WHITELIST_STATUS_REGISTERED = "registered"
ADMIN_SCOPE_USER_LIFECYCLE = "user_lifecycle"
ADMIN_SCOPE_QUOTA = "quota_management"
ADMIN_SCOPE_ROLE = "role_management"
ADMIN_SCOPE_TRANSFER = "transfer_ownership"
ADMIN_SCOPE_SHARE = "share_governance"
ADMIN_SCOPE_STORAGE = "storage_cleanup"
ADMIN_SCOPE_AUDIT = "audit_logs"
ADMIN_SCOPE_OPTIONS = {
    ADMIN_SCOPE_USER_LIFECYCLE,
    ADMIN_SCOPE_QUOTA,
    ADMIN_SCOPE_ROLE,
    ADMIN_SCOPE_TRANSFER,
    ADMIN_SCOPE_SHARE,
    ADMIN_SCOPE_STORAGE,
    ADMIN_SCOPE_AUDIT,
}
DEFAULT_ADMIN_SCOPES = {
    ADMIN_SCOPE_USER_LIFECYCLE,
    ADMIN_SCOPE_QUOTA,
    ADMIN_SCOPE_TRANSFER,
    ADMIN_SCOPE_SHARE,
    ADMIN_SCOPE_AUDIT,
}
ALLOWED_EXTENSIONS = {
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".md", ".csv",
    ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".svg", ".webp", ". ico",
    ".zip", ".rar", ".7z", ".tar", ".gz", ".bz2",
    ".cpp", ".c", ".h", ".py", ".java", ".js", ".ts", ".go", ".rs", ".php", ".sql", ".html", ".htm", ".css", ".json", ".xml", ".yaml", ".yml",
    ".mp3", ".mp4", ".avi", ".mov", ".mkv", ".wav", ".flac", ".m4a",
    ".exe", ".msi", ".iso", ".dmg", ".apk",
}
DRIVE_SHARE_OPTIONS = {"private", "public"}
REPO_VISIBILITY_OPTIONS = {"private", "public"}
PASSWORD_CONTEXT = CryptContext(schemes=["bcrypt"], deprecated="auto")
CHAT_IMAGE_MIME_TO_EXT = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/bmp": ".bmp",
}
MAX_CHAT_IMAGE_BYTES = 6 * 1024 * 1024
IGNORABLE_SYSTEM_FILES = {"desktop.ini", "thumbs.db"}
CHAT_STREAM_EVENT = asyncio.Event()
CHAT_STREAM_VERSION = 0


def now_text():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def format_bytes(size: int):
    if size >= 1024 * 1024:
        return f"{size / 1024 / 1024:.1f} MB"
    if size >= 1024:
        return f"{size / 1024:.1f} KB"
    return f"{size} B"


def normalize_name_part(value: str, field_label: str):
    cleaned = re.sub(r"\s+", " ", (value or "").strip())
    if len(cleaned) < 1:
        raise HTTPException(status_code=400, detail=f"{field_label}不能为空")
    if len(cleaned) > 40:
        raise HTTPException(status_code=400, detail=f"{field_label}不能超过 40 个字符")
    if any(character in cleaned for character in '<>:"/\\|?*'):
        raise HTTPException(status_code=400, detail=f"{field_label}包含非法字符")
    return cleaned


def build_registered_username(nickname: str, real_name: str):
    normalized_nickname = normalize_name_part(nickname, "昵称")
    normalized_real_name = normalize_name_part(real_name, "真实姓名")
    final_username = f"{normalized_nickname}_{normalized_real_name}"
    if len(final_username) > 80:
        raise HTTPException(status_code=400, detail="昵称和真实姓名组合后过长，请缩短昵称")
    return final_username


def parse_whitelist_import_lines(raw_text: str):
    rows = []
    seen_phones = set()
    for line_number, raw_line in enumerate((raw_text or "").replace("\ufeff", "").splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        parts = [part.strip() for part in re.split(r"[,，\t]", line) if part.strip()]
        if len(parts) < 2:
            parts = line.split(None, 1)
        if len(parts) < 2:
            raise HTTPException(status_code=400, detail=f"第 {line_number} 行格式错误，应为 手机号,真实姓名")
        first_value = parts[0].strip()
        second_value = parts[1].strip()
        header_values = {first_value.lower(), second_value.lower()}
        if header_values & {"phone", "手机号"} and header_values & {"真实姓名", "姓名", "name"}:
            continue
        if re.match(r"^1[3-9]\d{9}$", first_value):
            phone = first_value
            real_name = second_value
        elif re.match(r"^1[3-9]\d{9}$", second_value):
            phone = second_value
            real_name = first_value
        else:
            raise HTTPException(status_code=400, detail=f"第 {line_number} 行手机号不合法")
        if not re.match(r"^1[3-9]\d{9}$", phone):
            raise HTTPException(status_code=400, detail=f"第 {line_number} 行手机号不合法")
        normalized_real_name = normalize_name_part(real_name, f"第 {line_number} 行真实姓名")
        if phone in seen_phones:
            continue
        seen_phones.add(phone)
        rows.append({"phone": phone, "real_name": normalized_real_name})
    if not rows:
        raise HTTPException(status_code=400, detail="名单内容为空，至少需要一条手机号和真实姓名")
    return rows


def get_registered_real_name(cursor, username: str):
    cursor.execute(
        "SELECT real_name FROM registration_whitelist WHERE registered_username=? AND status=?",
        (username, WHITELIST_STATUS_REGISTERED),
    )
    row = cursor.fetchone()
    if not row:
        return ""
    return row["real_name"] or ""


def build_registration_whitelist_payload(row):
    return {
        "phone": row["phone"],
        "real_name": row["real_name"] or "",
        "status": row["status"] or WHITELIST_STATUS_PENDING,
        "registered_username": row["registered_username"] or "",
        "imported_at": row["imported_at"] or "",
        "imported_by": row["imported_by"] or "",
        "registered_at": row["registered_at"] or "",
    }


def resolve_registered_real_name(username: str = "", phone: str = "", cursor=None):
    if not username and not phone:
        return ""
    if cursor is None:
        conn = get_db()
        active_cursor = conn.cursor()
    else:
        conn = None
        active_cursor = cursor
    try:
        if phone:
            active_cursor.execute(
                "SELECT real_name FROM registration_whitelist WHERE phone=? ORDER BY CASE COALESCE(status, '') WHEN ? THEN 0 ELSE 1 END LIMIT 1",
                (phone, WHITELIST_STATUS_REGISTERED),
            )
            row = active_cursor.fetchone()
            if row and row["real_name"]:
                return row["real_name"]
        if username:
            active_cursor.execute(
                "SELECT real_name FROM registration_whitelist WHERE registered_username=? ORDER BY CASE COALESCE(status, '') WHEN ? THEN 0 ELSE 1 END LIMIT 1",
                (username, WHITELIST_STATUS_REGISTERED),
            )
            row = active_cursor.fetchone()
            if row and row["real_name"]:
                return row["real_name"]
        return ""
    finally:
        if conn:
            conn.close()


def normalize_admin_scopes(scopes):
    if scopes is None:
        return set()
    if isinstance(scopes, str):
        parts = scopes.split(",")
    else:
        parts = scopes
    normalized = {str(part).strip() for part in parts if str(part).strip()}
    return {scope for scope in normalized if scope in ADMIN_SCOPE_OPTIONS}


def serialize_admin_scopes(scopes):
    return ",".join(sorted(normalize_admin_scopes(scopes)))


def resolve_admin_scopes_for_role(role: str, scopes):
    if role == ROLE_SUPER_ADMIN:
        return serialize_admin_scopes(ADMIN_SCOPE_OPTIONS)
    if role == ROLE_ADMIN:
        normalized = normalize_admin_scopes(scopes)
        return serialize_admin_scopes(normalized or DEFAULT_ADMIN_SCOPES)
    return ""


def request_client_ip(request: Optional[Request]):
    if not request:
        return "unknown"
    forwarded = request.headers.get("x-forwarded-for", "").strip()
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def is_super_admin_user(user):
    return bool(user and user.get("role") == ROLE_SUPER_ADMIN)


def has_admin_scope(user, scope: Optional[str]):
    if not user or not user.get("is_admin"):
        return False
    if is_super_admin_user(user):
        return True
    if not scope:
        return True
    return scope in set(user.get("admin_scopes") or [])


def log_audit_event(
    action: str,
    request: Optional[Request] = None,
    actor: Optional[dict] = None,
    target_type: str = "system",
    target_id: str = "",
    detail: str = "",
    outcome: str = "success",
):
    conn = None
    try:
        conn = get_db()
        c = conn.cursor()
        c.execute(
            """
            INSERT INTO audit_logs (
                created_at,
                actor_username,
                actor_role,
                ip_address,
                action,
                target_type,
                target_id,
                detail,
                outcome
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                now_text(),
                (actor or {}).get("username", "anonymous"),
                (actor or {}).get("role", ROLE_USER),
                request_client_ip(request),
                action,
                target_type,
                target_id,
                detail,
                outcome,
            ),
        )
        conn.commit()
    except Exception:
        if conn:
            conn.rollback()
    finally:
        if conn:
            conn.close()


def insert_notification(cursor, username: str, category: str, title: str, detail: str = "", link: str = ""):
    target_username = (username or "").strip()
    if not target_username:
        return
    cursor.execute(
        """
        INSERT INTO notifications (username, category, title, detail, link, is_read, created_at)
        VALUES (?, ?, ?, ?, ?, 0, ?)
        """,
        (target_username, category, title.strip(), detail.strip(), link.strip(), now_text()),
    )


def build_notification_payload(row):
    return {
        "id": row["id"],
        "category": row["category"],
        "title": row["title"],
        "detail": row["detail"] or "",
        "link": row["link"] or "",
        "is_read": bool(row["is_read"]),
        "created_at": row["created_at"],
    }


def append_repo_activity(cursor, repo_id: str, actor_username: str, action: str, detail: str = ""):
    cursor.execute(
        """
        INSERT INTO repo_activity_logs (repo_id, created_at, actor_username, action, detail)
        VALUES (?, ?, ?, ?, ?)
        """,
        (repo_id, now_text(), (actor_username or "system").strip() or "system", action.strip(), detail.strip()),
    )


def build_repo_activity_payload(row):
    return {
        "id": row["id"],
        "created_at": row["created_at"],
        "actor_username": row["actor_username"],
        "action": row["action"],
        "detail": row["detail"] or "",
    }


def get_repo_member_usernames(cursor, repo_id: str):
    cursor.execute("SELECT username FROM repo_members WHERE repo_id=? ORDER BY username ASC", (repo_id,))
    return [row["username"] for row in cursor.fetchall()]


def notify_repo_members(cursor, repo_id: str, title: str, detail: str = "", link: str = "", exclude_usernames: Optional[set[str]] = None):
    excluded = {name for name in (exclude_usernames or set()) if name}
    for username in get_repo_member_usernames(cursor, repo_id):
        if username in excluded:
            continue
        insert_notification(cursor, username, "repo", title, detail, link)


def normalize_password_for_bcrypt(password: str):
    return password.encode("utf-8")[:72].decode("utf-8", "ignore")


def hash_password(password: str):
    return PASSWORD_CONTEXT.hash(normalize_password_for_bcrypt(password))


def verify_password(password: str, password_hash: str):
    if not password_hash or not PASSWORD_CONTEXT.identify(password_hash):
        return False
    return PASSWORD_CONTEXT.verify(normalize_password_for_bcrypt(password), password_hash)


def build_attachment_headers(filename: str):
    fallback_name = "".join(
        character if 32 <= ord(character) < 127 and character not in {'"', '\\'} else "_"
        for character in filename
    ).strip() or "download"
    encoded_name = quote(filename)
    return {
        "Content-Disposition": f"attachment; filename=\"{fallback_name}\"; filename*=UTF-8''{encoded_name}",
        "X-Content-Type-Options": "nosniff",
    }


def build_attachment_response(file_path: str, download_name: str):
    media_type, _ = mimetypes.guess_type(download_name)
    return FileResponse(
        file_path,
        media_type=media_type or "application/octet-stream",
        headers=build_attachment_headers(download_name),
    )


def read_chat_messages(limit: int = 50):
    conn = get_db()
    c = conn.cursor()
    c.execute(
        """
        SELECT
            messages.username,
            messages.content,
            messages.share_code,
            messages.image_data,
            messages.time,
            COALESCE(registration_whitelist.real_name, '') AS real_name
        FROM messages
        LEFT JOIN registration_whitelist ON registration_whitelist.registered_username = messages.username
        ORDER BY messages.id DESC
        LIMIT ?
        """,
        (limit,),
    )
    rows = [
        {
            "user": row["username"],
            "real_name": row["real_name"] or "",
            "text": row["content"],
            "code": row["share_code"],
            "image": row["image_data"],
            "time": row["time"],
        }
        for row in c.fetchall()
    ]
    conn.close()
    return rows[::-1]


def notify_chat_stream_updated():
    global CHAT_STREAM_VERSION
    CHAT_STREAM_VERSION += 1
    CHAT_STREAM_EVENT.set()


def calculate_user_storage_on_disk(username: str):
    user_dir = get_user_dir(username)
    if not os.path.exists(user_dir):
        return 0
    total = 0
    for filename in os.listdir(user_dir):
        path = os.path.join(user_dir, filename)
        if os.path.isfile(path):
            total += os.path.getsize(path)
    return total


def get_repo_storage(repo_id: str):
    repo_dir = get_repo_dir(repo_id)
    if not os.path.exists(repo_dir):
        return 0
    total = 0
    for root, _, files in os.walk(repo_dir):
        for filename in files:
            file_path = os.path.join(root, filename)
            if os.path.isfile(file_path):
                total += os.path.getsize(file_path)
    return total


def is_ignorable_system_file(name: str):
    lowered = name.lower()
    return name.startswith(".") or lowered in IGNORABLE_SYSTEM_FILES


def build_chat_image_url(filename: str):
    return f"/api/chat/images/{quote(filename)}"


def decode_chat_image_data(image_data: str):
    matched = re.match(r"^data:(image/[a-zA-Z0-9.+-]+);base64,(.+)$", image_data, re.DOTALL)
    if not matched:
        raise HTTPException(status_code=400, detail="聊天图片格式不合法")
    mime_type = matched.group(1).lower()
    extension = CHAT_IMAGE_MIME_TO_EXT.get(mime_type)
    if not extension:
        raise HTTPException(status_code=400, detail="暂不支持该聊天图片格式")
    try:
        content = base64.b64decode(matched.group(2), validate=True)
    except (ValueError, binascii.Error) as exc:
        raise HTTPException(status_code=400, detail="聊天图片解码失败") from exc
    if not content:
        raise HTTPException(status_code=400, detail="聊天图片不能为空")
    if len(content) > MAX_CHAT_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="聊天图片过大，请压缩后再上传")
    return content, extension


def save_chat_image(image_data: str):
    content, extension = decode_chat_image_data(image_data)
    filename = f"{uuid.uuid4().hex}{extension}"
    file_path = os.path.join(CHAT_IMAGE_DIR, filename)
    with open(file_path, "wb") as output_file:
        output_file.write(content)
    return build_chat_image_url(filename)


def delete_chat_image_file(image_value: str):
    if not image_value:
        return
    filename = os.path.basename(image_value)
    file_path = os.path.join(CHAT_IMAGE_DIR, filename)
    if os.path.exists(file_path):
        os.remove(file_path)


def get_db():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn


def ensure_column(cursor, table_name: str, column_name: str, definition: str):
    cursor.execute(f"PRAGMA table_info({table_name})")
    columns = {row[1] for row in cursor.fetchall()}
    if column_name not in columns:
        cursor.execute(f"ALTER TABLE {table_name} ADD COLUMN {definition}")


def deduplicate_by_columns(cursor, table_name: str, columns: list[str]):
    joined_columns = ", ".join(columns)
    cursor.execute(
        f"""
        DELETE FROM {table_name}
        WHERE rowid NOT IN (
            SELECT MAX(rowid)
            FROM {table_name}
            GROUP BY {joined_columns}
        )
        """
    )


def ensure_unique_index(cursor, table_name: str, index_name: str, columns: list[str]):
    deduplicate_by_columns(cursor, table_name, columns)
    joined_columns = ", ".join(columns)
    cursor.execute(f"CREATE UNIQUE INDEX IF NOT EXISTS {index_name} ON {table_name} ({joined_columns})")


def migrate_plaintext_passwords(cursor):
    cursor.execute("SELECT username, password FROM users")
    updates = []
    for row in cursor.fetchall():
        stored_password = row["password"] or ""
        if PASSWORD_CONTEXT.identify(stored_password):
            continue
        updates.append((hash_password(stored_password), row["username"]))
    if updates:
        cursor.executemany("UPDATE users SET password=? WHERE username=?", updates)


def backfill_user_storage(cursor):
    cursor.execute("SELECT username FROM users")
    updates = []
    for row in cursor.fetchall():
        updates.append((calculate_user_storage_on_disk(row["username"]), row["username"]))
    if updates:
        cursor.executemany("UPDATE users SET used_storage=? WHERE username=?", updates)


def migrate_inline_chat_images(cursor):
    cursor.execute("SELECT id, image_data FROM messages WHERE image_data IS NOT NULL AND image_data != ''")
    updates = []
    for row in cursor.fetchall():
        image_value = row["image_data"] or ""
        if not image_value.startswith("data:image/"):
            continue
        try:
            image_url = save_chat_image(image_value)
        except HTTPException:
            continue
        updates.append((image_url, row["id"]))
    if updates:
        cursor.executemany("UPDATE messages SET image_data=? WHERE id=?", updates)


def reconcile_registration_whitelist(cursor):
    cursor.execute(
        """
        SELECT registration_whitelist.phone, users.username
        FROM registration_whitelist
        JOIN users ON users.phone = registration_whitelist.phone
        """
    )
    updates = []
    for row in cursor.fetchall():
        updates.append(
            (
                WHITELIST_STATUS_REGISTERED,
                row["username"],
                row["phone"],
            )
        )
    if updates:
        cursor.executemany(
            """
            UPDATE registration_whitelist
            SET status=?,
                registered_username=?,
                registered_at=COALESCE(registered_at, imported_at, ?)
            WHERE phone=?
            """,
            [(status, username, now_text(), phone) for status, username, phone in updates],
        )


def validate_filename(filename: str):
    if not filename:
        raise HTTPException(status_code=400, detail="文件名不能为空")
    if filename in {".", ".."}:
        raise HTTPException(status_code=400, detail="非法文件名")
    if os.path.basename(filename) != filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="非法文件名")
    return filename


def normalize_repo_path(relative_path: str):
    if not relative_path:
        raise HTTPException(status_code=400, detail="仓库文件路径不能为空")
    sanitized = relative_path.replace("\\", "/")
    normalized = os.path.normpath(sanitized).replace("\\", "/")
    if normalized in {"", ".", ".."} or normalized.startswith("../") or normalized.startswith("/"):
        raise HTTPException(status_code=400, detail="非法仓库文件路径")
    return normalized


def validate_repo_name(name: str):
    cleaned = (name or "").strip()
    if len(cleaned) < 2:
        raise HTTPException(status_code=400, detail="仓库名称至少需要 2 个字符")
    if len(cleaned) > 60:
        raise HTTPException(status_code=400, detail="仓库名称不能超过 60 个字符")
    return cleaned


def make_repo_slug(name: str):
    base = re.sub(r"[^a-zA-Z0-9\u4e00-\u9fa5]+", "-", name.lower()).strip("-")
    if not base:
        base = "repo"
    return f"{base}-{uuid.uuid4().hex[:6]}"


def get_user_dir(username: str):
    return os.path.join(DATA_DIR, username)


def get_user_file_path(username: str, filename: str):
    return os.path.join(get_user_dir(username), validate_filename(filename))


def get_repo_dir(repo_id: str):
    return os.path.join(REPO_DIR, repo_id)


def get_repo_file_path(repo_id: str, relative_path: str):
    return os.path.join(get_repo_dir(repo_id), normalize_repo_path(relative_path))


def delete_repository_records(cursor, repo_id: str):
    repo_dir = get_repo_dir(repo_id)
    if os.path.exists(repo_dir):
        shutil.rmtree(repo_dir)
    cursor.execute("DELETE FROM repo_files WHERE repo_id=?", (repo_id,))
    cursor.execute("DELETE FROM repo_members WHERE repo_id=?", (repo_id,))
    cursor.execute("DELETE FROM repo_join_requests WHERE repo_id=?", (repo_id,))
    cursor.execute("DELETE FROM repositories WHERE id=?", (repo_id,))


def get_user_storage(username: str):
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT COALESCE(used_storage, 0) AS used_storage FROM users WHERE username=?", (username,))
    row = c.fetchone()
    conn.close()
    if not row:
        return 0
    return row["used_storage"] or 0


def seed_drive_file_record(cursor, username: str, filename: str):
    cursor.execute(
        """
        INSERT INTO file_records (username, filename, share_scope, updated_at)
        VALUES (?, ?, 'private', ?)
        ON CONFLICT(username, filename) DO UPDATE SET
            share_scope=file_records.share_scope,
            updated_at=COALESCE(file_records.updated_at, excluded.updated_at)
        """,
        (username, filename, now_text()),
    )


def sync_drive_files(username: str):
    conn = get_db()
    c = conn.cursor()
    user_dir = get_user_dir(username)
    disk_files = set()
    if os.path.exists(user_dir):
        for filename in os.listdir(user_dir):
            path = os.path.join(user_dir, filename)
            if os.path.isfile(path):
                disk_files.add(filename)
                seed_drive_file_record(c, username, filename)

    c.execute("SELECT filename FROM file_records WHERE username=?", (username,))
    db_files = {row[0] for row in c.fetchall()}
    for missing in db_files - disk_files:
        c.execute("DELETE FROM file_records WHERE username=? AND filename=?", (username, missing))
        c.execute("DELETE FROM shares WHERE username=? AND filename=?", (username, missing))
    conn.commit()
    conn.close()


def set_drive_file_record(cursor, username: str, filename: str, share_scope: str):
    cursor.execute(
        """
        INSERT INTO file_records (username, filename, share_scope, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(username, filename) DO UPDATE SET
            share_scope=excluded.share_scope,
            updated_at=excluded.updated_at
        """,
        (username, filename, share_scope, now_text()),
    )


def seed_repo_file_record(cursor, repo_id: str, relative_path: str):
    cursor.execute(
        """
        INSERT INTO repo_files (repo_id, relative_path, updated_by, updated_at)
        VALUES (?, ?, 'system', ?)
        ON CONFLICT(repo_id, relative_path) DO NOTHING
        """,
        (repo_id, relative_path, now_text()),
    )


def set_repo_file_record(cursor, repo_id: str, relative_path: str, updated_by: str):
    cursor.execute(
        """
        INSERT INTO repo_files (repo_id, relative_path, updated_by, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(repo_id, relative_path) DO UPDATE SET
            updated_by=excluded.updated_by,
            updated_at=excluded.updated_at
        """,
        (repo_id, relative_path, updated_by, now_text()),
    )


def sync_repo_files(repo_id: str):
    conn = get_db()
    c = conn.cursor()
    repo_dir = get_repo_dir(repo_id)
    disk_files = set()
    if os.path.exists(repo_dir):
        for root, _, files in os.walk(repo_dir):
            for filename in files:
                full_path = os.path.join(root, filename)
                relative_path = os.path.relpath(full_path, repo_dir).replace("\\", "/")
                disk_files.add(relative_path)
                seed_repo_file_record(c, repo_id, relative_path)

    c.execute("SELECT relative_path FROM repo_files WHERE repo_id=?", (repo_id,))
    db_files = {row[0] for row in c.fetchall()}
    for missing in db_files - disk_files:
        c.execute("DELETE FROM repo_files WHERE repo_id=? AND relative_path=?", (repo_id, missing))
    conn.commit()
    conn.close()


def sync_all_files():
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT username FROM users")
    usernames = [row[0] for row in c.fetchall()]
    c.execute("SELECT id FROM repositories")
    repo_ids = [row[0] for row in c.fetchall()]
    conn.close()
    for username in usernames:
        sync_drive_files(username)
    for repo_id in repo_ids:
        sync_repo_files(repo_id)


def get_user_quota(username: str):
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT COALESCE(quota_bytes, ?) FROM users WHERE username=?", (USER_QUOTA, username))
    row = c.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="用户不存在")
    return int(row[0] or USER_QUOTA)


def move_file_to_recycle_bin(owner_username: str, deleted_by: str, source_type: str, source_id: str, file_path: str, original_name: str):
    if not os.path.exists(file_path):
        return None
    recycle_id = uuid.uuid4().hex
    stored_path = os.path.join(RECYCLE_BIN_DIR, recycle_id)
    os.makedirs(os.path.dirname(stored_path), exist_ok=True)
    shutil.move(file_path, stored_path)
    size_bytes = os.path.getsize(stored_path) if os.path.exists(stored_path) else 0

    conn = get_db()
    c = conn.cursor()
    c.execute(
        """
        INSERT INTO recycle_bin (
            id,
            owner_username,
            deleted_by,
            source_type,
            source_id,
            original_name,
            stored_path,
            size_bytes,
            deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (recycle_id, owner_username, deleted_by, source_type, source_id, original_name, stored_path, size_bytes, now_text()),
    )
    conn.commit()
    conn.close()
    return {"id": recycle_id, "size_bytes": size_bytes}


def cleanup_empty_repo_dirs(repo_id: str, file_path: str):
    parent = os.path.dirname(file_path)
    repo_root = get_repo_dir(repo_id)
    while os.path.commonpath([repo_root, parent]) == repo_root and parent != repo_root and os.path.isdir(parent):
        entries = os.listdir(parent)
        visible_entries = [entry for entry in entries if not is_ignorable_system_file(entry)]
        if visible_entries:
            break
        if entries:
            shutil.rmtree(parent, ignore_errors=True)
        else:
            try:
                os.rmdir(parent)
            except OSError:
                break
        parent = os.path.dirname(parent)


def validate_share_access(row, provided_password: str = ""):
    if not row:
        return False, "分享码不存在"
    if row["access_level"] == "private" or row["revoked_at"]:
        return False, "该分享已失效"
    if row["expires_at"] and row["expires_at"] <= now_text():
        return False, "该分享已过期"
    if row["password_hash"] and not verify_password(provided_password or "", row["password_hash"]):
        return False, "分享密码错误"
    file_path = get_user_file_path(row["username"], row["filename"])
    if not os.path.exists(file_path):
        return False, "文件已被删除"
    return True, ""


def transfer_user_ownership(cursor, source_username: str, target_username: str):
    if source_username == target_username:
        raise HTTPException(status_code=400, detail="转移目标不能是本人")

    cursor.execute("SELECT 1 FROM users WHERE username=?", (target_username,))
    if not cursor.fetchone():
        raise HTTPException(status_code=404, detail="接收账号不存在")

    source_dir = get_user_dir(source_username)
    target_dir = get_user_dir(target_username)
    os.makedirs(target_dir, exist_ok=True)

    cursor.execute(
        "SELECT filename, share_scope, updated_at FROM file_records WHERE username=? ORDER BY updated_at DESC, filename ASC",
        (source_username,),
    )
    drive_records = {row["filename"]: row for row in cursor.fetchall()}
    moved_files = 0
    moved_bytes = 0

    if os.path.exists(source_dir):
        for filename in os.listdir(source_dir):
            source_path = os.path.join(source_dir, filename)
            if not os.path.isfile(source_path):
                continue
            target_name = filename
            if os.path.exists(os.path.join(target_dir, target_name)):
                base, ext = os.path.splitext(filename)
                suffix = 1
                while os.path.exists(os.path.join(target_dir, f"{base}-from-{source_username}-{suffix}{ext}")):
                    suffix += 1
                target_name = f"{base}-from-{source_username}-{suffix}{ext}"
            target_path = os.path.join(target_dir, target_name)
            file_size = os.path.getsize(source_path)
            shutil.move(source_path, target_path)
            record = drive_records.get(filename)
            cursor.execute("DELETE FROM file_records WHERE username=? AND filename=?", (target_username, target_name))
            cursor.execute(
                "INSERT INTO file_records (username, filename, share_scope, updated_at) VALUES (?, ?, ?, ?)",
                (
                    target_username,
                    target_name,
                    record["share_scope"] if record else "private",
                    record["updated_at"] if record and record["updated_at"] else now_text(),
                ),
            )
            cursor.execute(
                "UPDATE shares SET username=?, filename=? WHERE username=? AND filename=?",
                (target_username, target_name, source_username, filename),
            )
            moved_files += 1
            moved_bytes += file_size

    cursor.execute("DELETE FROM file_records WHERE username=?", (source_username,))
    if moved_bytes:
        update_user_storage_delta(cursor, source_username, -moved_bytes)
        update_user_storage_delta(cursor, target_username, moved_bytes)

    cursor.execute("SELECT id FROM repositories WHERE owner_username=?", (source_username,))
    repo_ids = [row[0] for row in cursor.fetchall()]
    for repo_id in repo_ids:
        cursor.execute("DELETE FROM repo_members WHERE repo_id=? AND username=?", (repo_id, target_username))
        cursor.execute(
            "UPDATE repo_members SET username=?, role='owner' WHERE repo_id=? AND username=?",
            (target_username, repo_id, source_username),
        )
        cursor.execute(
            "INSERT OR IGNORE INTO repo_members (repo_id, username, role) VALUES (?, ?, 'owner')",
            (repo_id, target_username),
        )
        cursor.execute("UPDATE repositories SET owner_username=?, updated_at=? WHERE id=?", (target_username, now_text(), repo_id))

    if os.path.exists(source_dir) and not os.listdir(source_dir):
        os.rmdir(source_dir)

    return {"moved_files": moved_files, "moved_bytes": moved_bytes, "transferred_repos": len(repo_ids)}


def purge_recycle_bin():
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT id, stored_path, size_bytes FROM recycle_bin")
    rows = c.fetchall()
    deleted_items = 0
    freed_bytes = 0
    for row in rows:
        stored_path = row["stored_path"]
        if stored_path and os.path.exists(stored_path):
            freed_bytes += os.path.getsize(stored_path)
            os.remove(stored_path)
        deleted_items += 1
    c.execute("DELETE FROM recycle_bin")
    conn.commit()
    conn.close()
    return {"deleted_items": deleted_items, "freed_bytes": freed_bytes}


def update_user_storage_delta(cursor, username: str, delta: int):
    cursor.execute(
        "UPDATE users SET used_storage = MAX(COALESCE(used_storage, 0) + ?, 0) WHERE username=?",
        (delta, username),
    )


def build_user_context(row, cursor=None):
    role = (row["role"] or "").strip() or (ROLE_ADMIN if row["is_admin"] else ROLE_USER)
    admin_scopes = sorted(normalize_admin_scopes(row["admin_scopes"] or ""))
    is_admin = bool(row["is_admin"] or role in {ROLE_ADMIN, ROLE_SUPER_ADMIN})
    is_super_admin = role == ROLE_SUPER_ADMIN
    real_name = resolve_registered_real_name(row["username"], row["phone"] if "phone" in row.keys() else "", cursor)
    return {
        "username": row["username"],
        "real_name": real_name,
        "is_admin": is_admin,
        "role": role,
        "is_super_admin": is_super_admin,
        "admin_scopes": sorted(ADMIN_SCOPE_OPTIONS) if is_super_admin else admin_scopes,
        "is_disabled": bool(row["is_disabled"]),
        "quota_bytes": int(row["quota_bytes"] or USER_QUOTA),
    }


def get_user_context(token: str):
    if not token:
        raise HTTPException(status_code=401, detail="未登录")
    cleaned_token = token.replace("Bearer ", "")
    conn = get_db()
    c = conn.cursor()
    c.execute(
        """
        SELECT
            sessions.username,
            COALESCE(users.phone, '') AS phone,
            COALESCE(users.is_admin, 0) AS is_admin,
            COALESCE(users.role, '') AS role,
            COALESCE(users.admin_scopes, '') AS admin_scopes,
            COALESCE(users.is_disabled, 0) AS is_disabled,
            COALESCE(users.quota_bytes, ?) AS quota_bytes
        FROM sessions
        JOIN users ON users.username = sessions.username
        WHERE sessions.token=?
        """,
        (USER_QUOTA, cleaned_token),
    )
    row = c.fetchone()
    if row and row["is_disabled"]:
        c.execute("DELETE FROM sessions WHERE token=?", (cleaned_token,))
        conn.commit()
    if not row:
        conn.close()
        raise HTTPException(status_code=401, detail="过期")
    if row["is_disabled"]:
        conn.close()
        raise HTTPException(status_code=403, detail="账号已被冻结，请联系超级管理员")
    payload = build_user_context(row, c)
    conn.close()
    return payload


def get_optional_user_context(token: Optional[str]):
    if not token:
        return None
    try:
        return get_user_context(token)
    except HTTPException:
        return None


def require_admin(token: str, scope: Optional[str] = None, super_only: bool = False):
    user = get_user_context(token)
    if not user["is_admin"]:
        raise HTTPException(status_code=403, detail="需要管理员权限")
    if super_only and not user["is_super_admin"]:
        raise HTTPException(status_code=403, detail="需要超级管理员权限")
    if scope and not has_admin_scope(user, scope):
        raise HTTPException(status_code=403, detail="当前管理员未被授予该项权限")
    return user


def init_db():
    conn = get_db()
    c = conn.cursor()
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY,
            password TEXT,
            phone TEXT UNIQUE,
            is_admin INTEGER DEFAULT 0,
            role TEXT DEFAULT 'user',
            admin_scopes TEXT DEFAULT '',
            is_disabled INTEGER DEFAULT 0,
            quota_bytes INTEGER DEFAULT 524288000
        )
        """
    )
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            username TEXT
        )
        """
    )
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS shares (
            code TEXT PRIMARY KEY,
            username TEXT,
            filename TEXT,
            access_level TEXT DEFAULT 'private',
            created_at TEXT,
            password_hash TEXT,
            expires_at TEXT,
            revoked_at TEXT,
            revoked_by TEXT
        )
        """
    )
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT,
            content TEXT,
            share_code TEXT,
            image_data TEXT,
            time TEXT
        )
        """
    )
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS file_records (
            username TEXT,
            filename TEXT,
            share_scope TEXT DEFAULT 'private',
            updated_at TEXT,
            PRIMARY KEY (username, filename)
        )
        """
    )
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS repositories (
            id TEXT PRIMARY KEY,
            name TEXT,
            slug TEXT UNIQUE,
            description TEXT,
            announcement TEXT,
            owner_username TEXT,
            visibility TEXT DEFAULT 'private',
            created_at TEXT,
            updated_at TEXT
        )
        """
    )
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS repo_members (
            repo_id TEXT,
            username TEXT,
            role TEXT,
            PRIMARY KEY (repo_id, username)
        )
        """
    )
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS repo_join_requests (
            repo_id TEXT,
            username TEXT,
            message TEXT,
            status TEXT DEFAULT 'pending',
            created_at TEXT,
            updated_at TEXT,
            handled_by TEXT,
            PRIMARY KEY (repo_id, username)
        )
        """
    )
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS repo_files (
            repo_id TEXT,
            relative_path TEXT,
            updated_by TEXT,
            updated_at TEXT,
            PRIMARY KEY (repo_id, relative_path)
        )
        """
    )
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS recycle_bin (
            id TEXT PRIMARY KEY,
            owner_username TEXT,
            deleted_by TEXT,
            source_type TEXT,
            source_id TEXT,
            original_name TEXT,
            stored_path TEXT,
            size_bytes INTEGER DEFAULT 0,
            deleted_at TEXT
        )
        """
    )
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT,
            actor_username TEXT,
            actor_role TEXT,
            ip_address TEXT,
            action TEXT,
            target_type TEXT,
            target_id TEXT,
            detail TEXT,
            outcome TEXT
        )
        """
    )
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT,
            category TEXT,
            title TEXT,
            detail TEXT,
            link TEXT,
            is_read INTEGER DEFAULT 0,
            created_at TEXT
        )
        """
    )
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS repo_activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            repo_id TEXT,
            created_at TEXT,
            actor_username TEXT,
            action TEXT,
            detail TEXT
        )
        """
    )
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS registration_whitelist (
            phone TEXT PRIMARY KEY,
            real_name TEXT,
            status TEXT DEFAULT 'pending',
            registered_username TEXT,
            imported_at TEXT,
            imported_by TEXT,
            registered_at TEXT
        )
        """
    )
    conn.commit()

    ensure_column(c, "users", "is_admin", "is_admin INTEGER DEFAULT 0")
    ensure_column(c, "users", "role", "role TEXT DEFAULT 'user'")
    ensure_column(c, "users", "admin_scopes", "admin_scopes TEXT DEFAULT ''")
    ensure_column(c, "users", "is_disabled", "is_disabled INTEGER DEFAULT 0")
    ensure_column(c, "users", "quota_bytes", f"quota_bytes INTEGER DEFAULT {USER_QUOTA}")
    ensure_column(c, "users", "used_storage", "used_storage INTEGER DEFAULT 0")
    ensure_column(c, "messages", "image_data", "image_data TEXT")
    ensure_column(c, "shares", "access_level", "access_level TEXT DEFAULT 'private'")
    ensure_column(c, "shares", "created_at", "created_at TEXT")
    ensure_column(c, "shares", "password_hash", "password_hash TEXT")
    ensure_column(c, "shares", "expires_at", "expires_at TEXT")
    ensure_column(c, "shares", "revoked_at", "revoked_at TEXT")
    ensure_column(c, "shares", "revoked_by", "revoked_by TEXT")
    ensure_column(c, "file_records", "share_scope", "share_scope TEXT DEFAULT 'private'")
    ensure_column(c, "file_records", "updated_at", "updated_at TEXT")
    ensure_column(c, "repositories", "description", "description TEXT")
    ensure_column(c, "repositories", "announcement", "announcement TEXT")
    ensure_column(c, "repositories", "slug", "slug TEXT")
    ensure_column(c, "repositories", "owner_username", "owner_username TEXT")
    ensure_column(c, "repositories", "visibility", "visibility TEXT DEFAULT 'private'")
    ensure_column(c, "repositories", "created_at", "created_at TEXT")
    ensure_column(c, "repositories", "updated_at", "updated_at TEXT")
    ensure_column(c, "repo_join_requests", "message", "message TEXT")
    ensure_column(c, "repo_join_requests", "status", "status TEXT DEFAULT 'pending'")
    ensure_column(c, "repo_join_requests", "created_at", "created_at TEXT")
    ensure_column(c, "repo_join_requests", "updated_at", "updated_at TEXT")
    ensure_column(c, "repo_join_requests", "handled_by", "handled_by TEXT")
    ensure_column(c, "repo_files", "updated_by", "updated_by TEXT")
    ensure_column(c, "repo_files", "updated_at", "updated_at TEXT")
    ensure_unique_index(c, "file_records", "idx_file_records_username_filename", ["username", "filename"])
    ensure_unique_index(c, "repo_members", "idx_repo_members_repo_username", ["repo_id", "username"])
    ensure_unique_index(c, "repo_join_requests", "idx_repo_join_requests_repo_username", ["repo_id", "username"])
    ensure_unique_index(c, "repo_files", "idx_repo_files_repo_path", ["repo_id", "relative_path"])
    ensure_unique_index(c, "notifications", "idx_notifications_username_created_at_id", ["username", "created_at", "id"])
    ensure_column(c, "registration_whitelist", "real_name", "real_name TEXT")
    ensure_column(c, "registration_whitelist", "status", "status TEXT DEFAULT 'pending'")
    ensure_column(c, "registration_whitelist", "registered_username", "registered_username TEXT")
    ensure_column(c, "registration_whitelist", "imported_at", "imported_at TEXT")
    ensure_column(c, "registration_whitelist", "imported_by", "imported_by TEXT")
    ensure_column(c, "registration_whitelist", "registered_at", "registered_at TEXT")
    c.execute(
        "UPDATE registration_whitelist SET status=? WHERE COALESCE(status, '')=''",
        (WHITELIST_STATUS_PENDING,),
    )
    reconcile_registration_whitelist(c)
    c.execute("UPDATE file_records SET share_scope='private' WHERE share_scope='classroom'")
    c.execute("UPDATE shares SET access_level='private' WHERE access_level='classroom'")
    c.execute("UPDATE users SET quota_bytes=? WHERE quota_bytes IS NULL OR quota_bytes<=0", (USER_QUOTA,))
    c.execute(
        "UPDATE users SET role=? WHERE COALESCE(is_admin, 0)=1 AND COALESCE(role, '')=''",
        (ROLE_ADMIN,),
    )
    c.execute(
        "UPDATE users SET admin_scopes=? WHERE COALESCE(is_admin, 0)=1 AND COALESCE(admin_scopes, '')=''",
        (serialize_admin_scopes(DEFAULT_ADMIN_SCOPES),),
    )
    c.execute(
        "UPDATE users SET role=?, is_admin=1, admin_scopes=? WHERE username=?",
        (ROLE_SUPER_ADMIN, serialize_admin_scopes(ADMIN_SCOPE_OPTIONS), SUPER_ADMIN_USERNAME),
    )
    migrate_plaintext_passwords(c)
    backfill_user_storage(c)
    migrate_inline_chat_images(c)
    conn.commit()
    conn.close()
    sync_all_files()


init_db()


def get_drive_file_record(username: str, filename: str):
    validate_filename(filename)
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT username, filename, share_scope, updated_at FROM file_records WHERE username=? AND filename=?", (username, filename))
    row = c.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="文件不存在")
    return row


def build_drive_file_payload(username: str, row):
    file_path = get_user_file_path(username, row["filename"])
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="文件不存在")
    return {
        "name": row["filename"],
        "size": os.path.getsize(file_path),
        "share_scope": row["share_scope"],
        "updated_at": row["updated_at"],
    }


def get_repo_counts(cursor, repo_id: str):
    cursor.execute("SELECT COUNT(*) FROM repo_files WHERE repo_id=?", (repo_id,))
    file_count = cursor.fetchone()[0]
    cursor.execute("SELECT COUNT(*) FROM repo_members WHERE repo_id=?", (repo_id,))
    member_count = cursor.fetchone()[0]
    return file_count, member_count


def get_repo_row(repo_id: str):
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM repositories WHERE id=?", (repo_id,))
    row = c.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="仓库不存在")
    return row


def get_repo_access(repo_id: str, token: Optional[str], require_write: bool = False, require_manage: bool = False):
    user = get_optional_user_context(token)
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM repositories WHERE id=?", (repo_id,))
    repo = c.fetchone()
    if not repo:
        conn.close()
        raise HTTPException(status_code=404, detail="仓库不存在")

    my_role = None
    if user:
        c.execute("SELECT role FROM repo_members WHERE repo_id=? AND username=?", (repo_id, user["username"]))
        member_row = c.fetchone()
        if member_row:
            my_role = member_row["role"]

    can_read = repo["visibility"] == "public" or my_role is not None or (user and user["is_admin"])
    can_write = my_role in {"owner", "collaborator"} or (user and user["is_admin"])
    can_manage = my_role == "owner" or (user and user["is_admin"])

    if not can_read:
        conn.close()
        raise HTTPException(status_code=403, detail="你没有查看该仓库的权限")
    if require_write and not can_write:
        conn.close()
        raise HTTPException(status_code=403, detail="你没有写入该仓库的权限")
    if require_manage and not can_manage:
        conn.close()
        raise HTTPException(status_code=403, detail="你没有管理该仓库的权限")

    file_count, member_count = get_repo_counts(c, repo_id)
    repo_payload = {
        "id": repo["id"],
        "name": repo["name"],
        "slug": repo["slug"],
        "description": repo["description"] or "",
        "announcement": repo["announcement"] or "",
        "owner_username": repo["owner_username"],
        "visibility": repo["visibility"],
        "created_at": repo["created_at"],
        "updated_at": repo["updated_at"],
        "my_role": my_role,
        "can_write": bool(can_write),
        "can_manage": bool(can_manage),
        "file_count": file_count,
        "member_count": member_count,
    }
    conn.close()
    return repo_payload, user


def build_repo_join_request_payload(row):
    return {
        "username": row["username"],
        "message": row["message"] or "",
        "status": row["status"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "handled_by": row["handled_by"],
    }


def build_repo_list_item(cursor, repo_row, username: Optional[str], is_admin: bool):
    my_role = None
    if username:
        cursor.execute("SELECT role FROM repo_members WHERE repo_id=? AND username=?", (repo_row["id"], username))
        member_row = cursor.fetchone()
        if member_row:
            my_role = member_row["role"]
    file_count, member_count = get_repo_counts(cursor, repo_row["id"])
    return {
        "id": repo_row["id"],
        "name": repo_row["name"],
        "slug": repo_row["slug"],
        "description": repo_row["description"] or "",
        "announcement": repo_row["announcement"] or "",
        "owner_username": repo_row["owner_username"],
        "visibility": repo_row["visibility"],
        "created_at": repo_row["created_at"],
        "updated_at": repo_row["updated_at"],
        "my_role": my_role,
        "can_write": bool(my_role in {"owner", "collaborator"} or is_admin),
        "can_manage": bool(my_role == "owner" or is_admin),
        "file_count": file_count,
        "member_count": member_count,
    }


@app.get("/api/me")
def get_me(authorization: str = Header(None)):
    return get_user_context(authorization)


@app.get("/api/drive")
def list_drive_files(authorization: str = Header(None)):
    user = get_user_context(authorization)
    username = user["username"]

    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT username, filename, share_scope, updated_at FROM file_records WHERE username=? ORDER BY updated_at DESC, filename ASC", (username,))
    rows = c.fetchall()
    conn.close()

    files = []
    for row in rows:
        path = get_user_file_path(username, row["filename"])
        if os.path.exists(path):
            files.append(build_drive_file_payload(username, row))

    return {
        "files": files,
        "used": get_user_storage(username),
        "quota": user["quota_bytes"],
        "username": username,
        "is_admin": user["is_admin"],
        "is_super_admin": user["is_super_admin"],
        "role": user["role"],
        "admin_scopes": user["admin_scopes"],
    }


@app.post("/api/drive/upload")
def upload_drive_file(file: UploadFile, authorization: str = Header(None)):
    user = get_user_context(authorization)
    username = user["username"]
    filename = validate_filename(file.filename or "")
    _, ext = os.path.splitext(filename)
    if ext.lower() not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"不支持的文件类型: {ext}")

    content = file.file.read()
    file_path = get_user_file_path(username, filename)
    old_size = os.path.getsize(file_path) if os.path.exists(file_path) else 0
    next_size = get_user_storage(username) - old_size + len(content)
    if next_size > user["quota_bytes"]:
        raise HTTPException(status_code=400, detail="空间不足！请删除一些旧文件再试")

    user_dir = get_user_dir(username)
    os.makedirs(user_dir, exist_ok=True)
    with open(file_path, "wb") as output_file:
        output_file.write(content)

    conn = get_db()
    c = conn.cursor()
    set_drive_file_record(c, username, filename, "private")
    update_user_storage_delta(c, username, len(content) - old_size)
    conn.commit()
    conn.close()
    return {
        "msg": f"个人云盘已保存 {filename}（{format_bytes(len(content))}）",
        "filename": filename,
        "size": len(content),
    }


@app.get("/api/drive/download/{filename}")
def download_drive_file(filename: str, request: Request, authorization: str = Header(None)):
    user = get_user_context(authorization)
    file_path = get_user_file_path(user["username"], filename)
    if os.path.exists(file_path):
        log_audit_event("drive.download", request, user, "drive_file", f"{user['username']}:{filename}")
        return build_attachment_response(file_path, filename)
    raise HTTPException(status_code=404, detail="文件不存在")


@app.post("/api/drive/files/{filename}/share-scope")
def update_drive_share_scope(filename: str, share_scope: str = Form(...), authorization: str = Header(None)):
    user = get_user_context(authorization)
    if share_scope not in DRIVE_SHARE_OPTIONS:
        raise HTTPException(status_code=400, detail="非法分享权限")
    get_drive_file_record(user["username"], filename)
    conn = get_db()
    c = conn.cursor()
    set_drive_file_record(c, user["username"], filename, share_scope)
    if share_scope == "private":
        c.execute("DELETE FROM shares WHERE username=? AND filename=?", (user["username"], filename))
    conn.commit()
    conn.close()
    return {"msg": "分享权限已更新", "share_scope": share_scope}


@app.post("/api/drive/files/batch-share-scope")
def batch_update_drive_share_scope(
    share_scope: str = Form(...),
    filenames: list[str] = Form(...),
    authorization: str = Header(None),
):
    user = get_user_context(authorization)
    if share_scope not in DRIVE_SHARE_OPTIONS:
        raise HTTPException(status_code=400, detail="非法分享权限")
    if not filenames:
        raise HTTPException(status_code=400, detail="请先选择文件")

    conn = get_db()
    c = conn.cursor()
    for filename in filenames:
        get_drive_file_record(user["username"], filename)
        set_drive_file_record(c, user["username"], filename, share_scope)
        if share_scope == "private":
            c.execute("DELETE FROM shares WHERE username=? AND filename=?", (user["username"], filename))
    conn.commit()
    conn.close()
    return {"msg": f"已更新 {len(filenames)} 个文件的分享权限", "share_scope": share_scope}


@app.delete("/api/drive/files/{filename}")
def delete_drive_file(filename: str, request: Request, authorization: str = Header(None)):
    user = get_user_context(authorization)
    file_path = get_user_file_path(user["username"], filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="文件不存在")
    removed_size = os.path.getsize(file_path)
    move_file_to_recycle_bin(user["username"], user["username"], "drive_file", f"{user['username']}:{filename}", file_path, filename)

    conn = get_db()
    c = conn.cursor()
    c.execute("DELETE FROM file_records WHERE username=? AND filename=?", (user["username"], filename))
    c.execute("DELETE FROM shares WHERE username=? AND filename=?", (user["username"], filename))
    update_user_storage_delta(c, user["username"], -removed_size)
    conn.commit()
    conn.close()
    log_audit_event("drive.delete", request, user, "drive_file", f"{user['username']}:{filename}")
    return {"msg": "已删除"}


@app.post("/api/drive/files/batch-delete")
def batch_delete_drive_files(request: Request, filenames: list[str] = Form(...), authorization: str = Header(None)):
    user = get_user_context(authorization)
    if not filenames:
        raise HTTPException(status_code=400, detail="请先选择文件")

    conn = get_db()
    c = conn.cursor()
    deleted = 0
    removed_bytes = 0
    for filename in filenames:
        file_path = get_user_file_path(user["username"], filename)
        if os.path.exists(file_path):
            removed_bytes += os.path.getsize(file_path)
            move_file_to_recycle_bin(user["username"], user["username"], "drive_file", f"{user['username']}:{filename}", file_path, filename)
            deleted += 1
        c.execute("DELETE FROM file_records WHERE username=? AND filename=?", (user["username"], filename))
        c.execute("DELETE FROM shares WHERE username=? AND filename=?", (user["username"], filename))
    if removed_bytes:
        update_user_storage_delta(c, user["username"], -removed_bytes)
    conn.commit()
    conn.close()
    log_audit_event("drive.batch_delete", request, user, "drive_file", user["username"], f"count={deleted}")
    return {"msg": f"已删除 {deleted} 个文件"}


@app.get("/api/chat/images/{image_name}")
def get_chat_image(image_name: str):
    safe_name = os.path.basename(image_name)
    if not safe_name or safe_name != image_name:
        raise HTTPException(status_code=400, detail="非法图片路径")
    image_path = os.path.join(CHAT_IMAGE_DIR, safe_name)
    if not os.path.exists(image_path):
        raise HTTPException(status_code=404, detail="聊天图片不存在")
    return FileResponse(image_path, headers={"Cache-Control": "public, max-age=31536000, immutable"})


@app.post("/api/share/{filename}")
def share_drive_file(filename: str, request: Request, authorization: str = Header(None)):
    user = get_user_context(authorization)
    row = get_drive_file_record(user["username"], filename)
    if row["share_scope"] == "private":
        raise HTTPException(status_code=400, detail="当前文件为私密分享，不能发送到聊天栏")

    code = str(uuid.uuid4())[:6]
    conn = get_db()
    c = conn.cursor()
    c.execute(
        "INSERT INTO shares (code, username, filename, access_level, created_at) VALUES (?, ?, ?, ?, ?)",
        (code, user["username"], filename, row["share_scope"], now_text()),
    )
    conn.commit()
    conn.close()
    log_audit_event("drive.share.create", request, user, "share", code, f"{user['username']}:{filename}")
    return {"code": code, "access_level": row["share_scope"]}


@app.get("/api/validate/{code}")
def validate_share(code: str, request: Request, password: str = "", authorization: str = Header(None)):
    conn = get_db()
    c = conn.cursor()
    c.execute(
        "SELECT username, filename, access_level, password_hash, expires_at, revoked_at FROM shares WHERE code=?",
        (code,),
    )
    row = c.fetchone()
    conn.close()
    valid, reason = validate_share_access(row, password)
    if not valid:
        log_audit_event("share.validate", request, get_optional_user_context(authorization), "share", code, reason, "denied")
        return {"valid": False, "reason": reason}

    file_path = get_user_file_path(row["username"], row["filename"])
    log_audit_event("share.validate", request, get_optional_user_context(authorization), "share", code, f"{row['username']}:{row['filename']}")

    return {
        "valid": True,
        "filename": row["filename"],
        "size": os.path.getsize(file_path),
        "owner": row["username"],
        "access_level": row["access_level"],
        "requires_password": bool(row["password_hash"]),
        "expires_at": row["expires_at"],
    }


@app.get("/api/s/{code}")
def download_shared(code: str, request: Request, password: str = "", authorization: str = Header(None)):
    conn = get_db()
    c = conn.cursor()
    c.execute(
        "SELECT username, filename, access_level, password_hash, expires_at, revoked_at FROM shares WHERE code=?",
        (code,),
    )
    row = c.fetchone()
    conn.close()
    valid, reason = validate_share_access(row, password)
    if not valid:
        log_audit_event("share.download", request, get_optional_user_context(authorization), "share", code, reason, "denied")
        raise HTTPException(status_code=403 if row else 404, detail=reason)

    file_path = get_user_file_path(row["username"], row["filename"])
    if os.path.exists(file_path):
        log_audit_event("share.download", request, get_optional_user_context(authorization), "share", code, f"{row['username']}:{row['filename']}")
        return build_attachment_response(file_path, row["filename"])
    raise HTTPException(status_code=404, detail="文件不存在")


@app.get("/api/repos/mine")
def list_my_repos(authorization: str = Header(None)):
    user = get_user_context(authorization)
    conn = get_db()
    c = conn.cursor()
    c.execute(
        """
        SELECT DISTINCT repositories.*
        FROM repositories
        JOIN repo_members ON repo_members.repo_id = repositories.id
        WHERE repo_members.username=?
        ORDER BY repositories.updated_at DESC, repositories.name ASC
        """,
        (user["username"],),
    )
    rows = c.fetchall()
    repos = [build_repo_list_item(c, row, user["username"], user["is_admin"]) for row in rows]
    conn.close()
    return {"repos": repos}


@app.get("/api/repos/hall")
def list_public_repos(authorization: str = Header(None)):
    user = get_optional_user_context(authorization)
    username = user["username"] if user else None
    is_admin = bool(user and user["is_admin"])
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM repositories WHERE visibility='public' ORDER BY updated_at DESC, name ASC LIMIT 200")
    rows = c.fetchall()
    repos = [build_repo_list_item(c, row, username, is_admin) for row in rows]
    conn.close()
    return {"repos": repos}


@app.post("/api/repos")
def create_repo(
    name: str = Form(...),
    description: str = Form(""),
    visibility: str = Form("private"),
    authorization: str = Header(None),
):
    user = get_user_context(authorization)
    cleaned_name = validate_repo_name(name)
    if visibility not in REPO_VISIBILITY_OPTIONS:
        raise HTTPException(status_code=400, detail="非法仓库可见性")

    repo_id = uuid.uuid4().hex
    repo_slug = make_repo_slug(cleaned_name)
    created_at = now_text()
    os.makedirs(get_repo_dir(repo_id), exist_ok=True)

    conn = get_db()
    c = conn.cursor()
    c.execute(
        "INSERT INTO repositories (id, name, slug, description, owner_username, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (repo_id, cleaned_name, repo_slug, description.strip(), user["username"], visibility, created_at, created_at),
    )
    c.execute(
        "INSERT INTO repo_members (repo_id, username, role) VALUES (?, ?, 'owner')",
        (repo_id, user["username"]),
    )
    append_repo_activity(c, repo_id, user["username"], "repo.created", f"创建仓库 {cleaned_name}")
    conn.commit()
    conn.close()
    return {"msg": "仓库已创建", "repo_id": repo_id}


@app.get("/api/repos/{repo_id}")
def get_repo_detail(repo_id: str, authorization: str = Header(None)):
    repo, user = get_repo_access(repo_id, authorization)
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT relative_path, updated_by, updated_at FROM repo_files WHERE repo_id=? ORDER BY relative_path ASC", (repo_id,))
    files = []
    for row in c.fetchall():
        file_path = get_repo_file_path(repo_id, row["relative_path"])
        if os.path.exists(file_path):
            files.append(
                {
                    "path": row["relative_path"],
                    "size": os.path.getsize(file_path),
                    "updated_by": row["updated_by"],
                    "updated_at": row["updated_at"],
                }
            )
    c.execute("SELECT username, role FROM repo_members WHERE repo_id=? ORDER BY CASE WHEN role='owner' THEN 0 ELSE 1 END, username ASC", (repo_id,))
    members = [{"username": row["username"], "role": row["role"]} for row in c.fetchall()]
    join_requests = []
    my_join_request = None
    repo_logs = []
    if repo["can_manage"]:
        c.execute(
            "SELECT username, message, status, created_at, updated_at, handled_by FROM repo_join_requests WHERE repo_id=? AND status='pending' ORDER BY created_at ASC, username ASC",
            (repo_id,),
        )
        join_requests = [build_repo_join_request_payload(row) for row in c.fetchall()]
        c.execute(
            "SELECT id, created_at, actor_username, action, detail FROM repo_activity_logs WHERE repo_id=? ORDER BY id DESC LIMIT 80",
            (repo_id,),
        )
        repo_logs = [build_repo_activity_payload(row) for row in c.fetchall()]
    if user and repo["my_role"] is None:
        c.execute(
            "SELECT username, message, status, created_at, updated_at, handled_by FROM repo_join_requests WHERE repo_id=? AND username=?",
            (repo_id, user["username"]),
        )
        row = c.fetchone()
        if row:
            my_join_request = build_repo_join_request_payload(row)
    conn.close()
    return {"repo": repo, "files": files, "members": members, "join_requests": join_requests, "my_join_request": my_join_request, "repo_logs": repo_logs}


@app.post("/api/repos/{repo_id}/visibility")
def update_repo_visibility(repo_id: str, visibility: str = Form(...), authorization: str = Header(None)):
    repo, actor = get_repo_access(repo_id, authorization, require_manage=True)
    if visibility not in REPO_VISIBILITY_OPTIONS:
        raise HTTPException(status_code=400, detail="非法仓库可见性")
    conn = get_db()
    c = conn.cursor()
    c.execute("UPDATE repositories SET visibility=?, updated_at=? WHERE id=?", (visibility, now_text(), repo_id))
    actor_username = actor["username"] if actor else repo["owner_username"]
    append_repo_activity(c, repo_id, actor_username, "repo.visibility", f"可见性改为 {visibility}")
    notify_repo_members(
        c,
        repo_id,
        f"仓库 {repo['name']} 的可见性已更新",
        f"当前可见性：{'公开仓库' if visibility == 'public' else '私有仓库'}",
        f"/repos/{repo_id}",
        {actor_username},
    )
    conn.commit()
    conn.close()
    return {"msg": "仓库可见性已更新", "visibility": visibility}


@app.post("/api/repos/{repo_id}/announcement")
def update_repo_announcement(
    repo_id: str,
    announcement: str = Form(""),
    authorization: str = Header(None),
):
    repo, actor = get_repo_access(repo_id, authorization, require_manage=True)
    cleaned_announcement = (announcement or "").strip()
    if len(cleaned_announcement) > 2000:
        raise HTTPException(status_code=400, detail="仓库公告不能超过 2000 个字符")
    conn = get_db()
    c = conn.cursor()
    c.execute("UPDATE repositories SET announcement=?, updated_at=? WHERE id=?", (cleaned_announcement, now_text(), repo_id))
    actor_username = actor["username"] if actor else repo["owner_username"]
    append_repo_activity(c, repo_id, actor_username, "repo.announcement", cleaned_announcement or "公告已清空")
    notify_repo_members(
        c,
        repo_id,
        f"仓库 {repo['name']} 的公告已更新",
        cleaned_announcement or "公告已被清空",
        f"/repos/{repo_id}",
        {actor_username},
    )
    conn.commit()
    conn.close()
    return {"msg": "仓库公告已更新", "announcement": cleaned_announcement}


@app.post("/api/repos/{repo_id}/members")
def add_repo_member(repo_id: str, username: str = Form(...), authorization: str = Header(None)):
    repo, actor = get_repo_access(repo_id, authorization, require_manage=True)
    target_username = username.strip()
    if not target_username:
        raise HTTPException(status_code=400, detail="请输入要添加的用户名")
    if target_username == repo["owner_username"]:
        raise HTTPException(status_code=400, detail="仓库拥有者已默认在成员列表中")

    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT 1 FROM users WHERE username=?", (target_username,))
    if not c.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="目标用户不存在")
    c.execute(
        "INSERT INTO repo_members (repo_id, username, role) VALUES (?, ?, 'collaborator') ON CONFLICT(repo_id, username) DO UPDATE SET role='collaborator'",
        (repo_id, target_username),
    )
    c.execute(
        "UPDATE repo_join_requests SET status='approved', updated_at=?, handled_by=? WHERE repo_id=? AND username=?",
        (now_text(), actor["username"] if actor else repo["owner_username"], repo_id, target_username),
    )
    c.execute("UPDATE repositories SET updated_at=? WHERE id=?", (now_text(), repo_id))
    append_repo_activity(c, repo_id, actor["username"] if actor else repo["owner_username"], "repo.member.add", f"已添加协作者 {target_username}")
    insert_notification(c, target_username, "repo", f"你已加入仓库 {repo['name']} 的维护", "你现在可以直接维护该仓库。", f"/repos/{repo_id}")
    conn.commit()
    conn.close()
    return {"msg": f"已将 {target_username} 添加为协作者"}


@app.delete("/api/repos/{repo_id}/members/{username}")
def remove_repo_member(repo_id: str, username: str, authorization: str = Header(None)):
    repo, actor = get_repo_access(repo_id, authorization, require_manage=True)
    if username == repo["owner_username"]:
        raise HTTPException(status_code=400, detail="不能移除仓库拥有者")
    conn = get_db()
    c = conn.cursor()
    c.execute("DELETE FROM repo_members WHERE repo_id=? AND username=?", (repo_id, username))
    c.execute("UPDATE repositories SET updated_at=? WHERE id=?", (now_text(), repo_id))
    append_repo_activity(c, repo_id, actor["username"] if actor else repo["owner_username"], "repo.member.remove", f"已移除协作者 {username}")
    insert_notification(c, username, "repo", f"你已被移出仓库 {repo['name']}", "如需继续维护，请重新发起加入申请。", f"/repos/{repo_id}")
    conn.commit()
    conn.close()
    return {"msg": f"已移除成员 {username}"}


@app.delete("/api/repos/{repo_id}/members/me")
def leave_repo_member(repo_id: str, authorization: str = Header(None)):
    repo, user = get_repo_access(repo_id, authorization, require_write=True)
    if not user or repo["my_role"] != "collaborator":
        raise HTTPException(status_code=400, detail="当前账号不是该仓库的协作者")
    conn = get_db()
    c = conn.cursor()
    c.execute("DELETE FROM repo_members WHERE repo_id=? AND username=?", (repo_id, user["username"]))
    c.execute("UPDATE repositories SET updated_at=? WHERE id=?", (now_text(), repo_id))
    append_repo_activity(c, repo_id, user["username"], "repo.member.leave", f"{user['username']} 主动退出维护")
    insert_notification(c, repo["owner_username"], "repo", f"{user['username']} 已退出仓库 {repo['name']} 的维护", "可在仓库成员列表中查看最新协作者状态。", f"/repos/{repo_id}")
    conn.commit()
    conn.close()
    return {"msg": "你已退出该仓库的维护"}


@app.post("/api/repos/{repo_id}/join-requests")
def create_repo_join_request(
    repo_id: str,
    message: str = Form(""),
    authorization: str = Header(None),
):
    repo, user = get_repo_access(repo_id, authorization)
    if not user:
        raise HTTPException(status_code=401, detail="请先登录后再申请")
    if user["is_admin"]:
        raise HTTPException(status_code=400, detail="管理员已拥有全局维护权限，无需申请")
    if repo["my_role"] in {"owner", "collaborator"} or repo["can_write"]:
        raise HTTPException(status_code=400, detail="你已经拥有该仓库的维护权限")

    request_message = message.strip()
    conn = get_db()
    c = conn.cursor()
    c.execute(
        "SELECT status FROM repo_join_requests WHERE repo_id=? AND username=?",
        (repo_id, user["username"]),
    )
    existing = c.fetchone()
    if existing and existing["status"] == "pending":
        conn.close()
        raise HTTPException(status_code=400, detail="你已经提交过申请，请等待仓库管理者处理")

    current_time = now_text()
    c.execute(
        """
        INSERT INTO repo_join_requests (repo_id, username, message, status, created_at, updated_at, handled_by)
        VALUES (?, ?, ?, 'pending', ?, ?, NULL)
        ON CONFLICT(repo_id, username) DO UPDATE SET
            message=excluded.message,
            status='pending',
            updated_at=excluded.updated_at,
            handled_by=NULL
        """,
        (repo_id, user["username"], request_message, current_time, current_time),
    )
    append_repo_activity(c, repo_id, user["username"], "repo.join_request.pending", request_message or "提交了加入维护申请")
    insert_notification(c, repo["owner_username"], "repo", f"{user['username']} 申请加入仓库 {repo['name']} 的维护", request_message or "请进入仓库详情进行审核。", f"/repos/{repo_id}")
    conn.commit()
    conn.close()
    return {"msg": "已提交加入维护申请，请等待仓库管理者审核"}


@app.delete("/api/repos/{repo_id}/join-requests/me")
def cancel_repo_join_request(repo_id: str, authorization: str = Header(None)):
    repo, user = get_repo_access(repo_id, authorization)
    if not user:
        raise HTTPException(status_code=401, detail="请先登录")
    conn = get_db()
    c = conn.cursor()
    c.execute(
        "SELECT status FROM repo_join_requests WHERE repo_id=? AND username=?",
        (repo_id, user["username"]),
    )
    row = c.fetchone()
    if not row or row["status"] != "pending":
        conn.close()
        raise HTTPException(status_code=400, detail="当前没有可取消的待审核申请")
    c.execute(
        "UPDATE repo_join_requests SET status='cancelled', updated_at=?, handled_by=? WHERE repo_id=? AND username=?",
        (now_text(), user["username"], repo_id, user["username"]),
    )
    append_repo_activity(c, repo_id, user["username"], "repo.join_request.cancelled", "撤回了加入维护申请")
    insert_notification(c, repo["owner_username"], "repo", f"{user['username']} 已撤回仓库 {repo['name']} 的维护申请", "该申请不再需要审核。", f"/repos/{repo_id}")
    conn.commit()
    conn.close()
    return {"msg": "已取消加入维护申请"}


@app.post("/api/repos/{repo_id}/join-requests/{username}")
def review_repo_join_request(
    repo_id: str,
    username: str,
    action: str = Form(...),
    authorization: str = Header(None),
):
    repo, actor = get_repo_access(repo_id, authorization, require_manage=True)
    decision = action.strip().lower()
    if decision not in {"approve", "reject"}:
        raise HTTPException(status_code=400, detail="非法审核动作")

    conn = get_db()
    c = conn.cursor()
    c.execute(
        "SELECT status FROM repo_join_requests WHERE repo_id=? AND username=?",
        (repo_id, username),
    )
    row = c.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="该申请不存在")
    if row["status"] != "pending":
        conn.close()
        raise HTTPException(status_code=400, detail="该申请已处理")

    handled_at = now_text()
    handler = actor["username"] if actor else repo["owner_username"]
    if decision == "approve":
        c.execute(
            "INSERT INTO repo_members (repo_id, username, role) VALUES (?, ?, 'collaborator') ON CONFLICT(repo_id, username) DO UPDATE SET role='collaborator'",
            (repo_id, username),
        )
        c.execute(
            "UPDATE repo_join_requests SET status='approved', updated_at=?, handled_by=? WHERE repo_id=? AND username=?",
            (handled_at, handler, repo_id, username),
        )
        c.execute("UPDATE repositories SET updated_at=? WHERE id=?", (handled_at, repo_id))
        append_repo_activity(c, repo_id, handler, "repo.join_request.approved", f"通过了 {username} 的加入维护申请")
        insert_notification(c, username, "repo", f"你加入仓库 {repo['name']} 的申请已通过", f"处理人：{handler}", f"/repos/{repo_id}")
        result_message = f"已通过 {username} 的加入维护申请"
    else:
        c.execute(
            "UPDATE repo_join_requests SET status='rejected', updated_at=?, handled_by=? WHERE repo_id=? AND username=?",
            (handled_at, handler, repo_id, username),
        )
        append_repo_activity(c, repo_id, handler, "repo.join_request.rejected", f"拒绝了 {username} 的加入维护申请")
        insert_notification(c, username, "repo", f"你加入仓库 {repo['name']} 的申请未通过", f"处理人：{handler}", f"/repos/{repo_id}")
        result_message = f"已拒绝 {username} 的加入维护申请"
    conn.commit()
    conn.close()
    return {"msg": result_message}


@app.get("/api/notifications")
def list_notifications(limit: int = 40, authorization: str = Header(None)):
    user = get_user_context(authorization)
    normalized_limit = max(1, min(int(limit or 40), 100))
    conn = get_db()
    c = conn.cursor()
    c.execute(
        "SELECT id, category, title, detail, link, is_read, created_at FROM notifications WHERE username=? ORDER BY id DESC LIMIT ?",
        (user["username"], normalized_limit),
    )
    items = [build_notification_payload(row) for row in c.fetchall()]
    c.execute("SELECT COUNT(*) FROM notifications WHERE username=? AND COALESCE(is_read, 0)=0", (user["username"],))
    unread_count = int(c.fetchone()[0] or 0)
    conn.close()
    return {"items": items, "unread_count": unread_count}


@app.post("/api/notifications/read")
def mark_notifications_as_read(authorization: str = Header(None)):
    user = get_user_context(authorization)
    conn = get_db()
    c = conn.cursor()
    c.execute("UPDATE notifications SET is_read=1 WHERE username=? AND COALESCE(is_read, 0)=0", (user["username"],))
    conn.commit()
    conn.close()
    return {"msg": "通知已全部标记为已读"}


@app.get("/api/admin/repos")
def list_admin_repos(authorization: str = Header(None)):
    require_admin(authorization, ADMIN_SCOPE_AUDIT)
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM repositories ORDER BY updated_at DESC, name ASC")
    repos = []
    for row in c.fetchall():
        file_count, member_count = get_repo_counts(c, row["id"])
        repos.append(
            {
                "id": row["id"],
                "name": row["name"],
                "slug": row["slug"],
                "owner_username": row["owner_username"],
                "visibility": row["visibility"],
                "updated_at": row["updated_at"],
                "file_count": file_count,
                "member_count": member_count,
                "storage": get_repo_storage(row["id"]),
            }
        )
    conn.close()
    return {"repos": repos, "quota": REPO_QUOTA}


@app.delete("/api/admin/repos/{repo_id}")
def delete_repo_as_admin(repo_id: str, request: Request, authorization: str = Header(None)):
    admin_user = require_admin(authorization, ADMIN_SCOPE_STORAGE)
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT name FROM repositories WHERE id=?", (repo_id,))
    row = c.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="仓库不存在")
    delete_repository_records(c, repo_id)
    conn.commit()
    conn.close()
    log_audit_event("admin.repo.delete", request, admin_user, "repository", repo_id, row["name"])
    return {"msg": f"已删除仓库 {row['name']}"}


@app.get("/api/admin/shares")
def list_admin_shares(authorization: str = Header(None)):
    require_admin(authorization, ADMIN_SCOPE_SHARE)
    conn = get_db()
    c = conn.cursor()
    c.execute(
        """
        SELECT code, username, filename, access_level, created_at, expires_at, revoked_at, revoked_by,
               CASE WHEN password_hash IS NOT NULL AND password_hash != '' THEN 1 ELSE 0 END AS has_password
        FROM shares
        ORDER BY created_at DESC, code ASC
        LIMIT 500
        """
    )
    shares = [dict(row) for row in c.fetchall()]
    conn.close()
    return {"shares": shares}


@app.post("/api/admin/shares/{code}/policy")
def update_share_policy(
    code: str,
    request: Request,
    password: str = Form(""),
    expires_at: str = Form(""),
    revoke: int = Form(0),
    authorization: str = Header(None),
):
    admin_user = require_admin(authorization, ADMIN_SCOPE_SHARE)
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT code FROM shares WHERE code=?", (code,))
    if not c.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="分享不存在")
    password_hash = hash_password(password) if password.strip() else None
    normalized_expiry = expires_at.strip() or None
    revoked_at = now_text() if int(revoke) else None
    revoked_by = admin_user["username"] if int(revoke) else None
    c.execute(
        "UPDATE shares SET password_hash=?, expires_at=?, revoked_at=?, revoked_by=? WHERE code=?",
        (password_hash, normalized_expiry, revoked_at, revoked_by, code),
    )
    conn.commit()
    conn.close()
    log_audit_event("admin.share.policy", request, admin_user, "share", code, f"revoke={bool(int(revoke))}; expires_at={normalized_expiry}")
    return {"msg": f"已更新分享 {code} 的策略"}


@app.delete("/api/admin/shares/{code}")
def revoke_share(code: str, request: Request, authorization: str = Header(None)):
    admin_user = require_admin(authorization, ADMIN_SCOPE_SHARE)
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT code FROM shares WHERE code=?", (code,))
    if not c.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="分享不存在")
    c.execute("UPDATE shares SET revoked_at=?, revoked_by=? WHERE code=?", (now_text(), admin_user["username"], code))
    conn.commit()
    conn.close()
    log_audit_event("admin.share.revoke", request, admin_user, "share", code)
    return {"msg": f"已撤销分享 {code}"}


@app.get("/api/admin/recycle-bin")
def list_recycle_bin(authorization: str = Header(None)):
    require_admin(authorization, ADMIN_SCOPE_STORAGE)
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT id, owner_username, deleted_by, source_type, source_id, original_name, size_bytes, deleted_at FROM recycle_bin ORDER BY deleted_at DESC LIMIT 500")
    items = [dict(row) for row in c.fetchall()]
    conn.close()
    return {"items": items}


@app.post("/api/admin/recycle-bin/purge")
def purge_all_recycle_bin(request: Request, authorization: str = Header(None)):
    admin_user = require_admin(authorization, ADMIN_SCOPE_STORAGE)
    result = purge_recycle_bin()
    log_audit_event("admin.recycle_bin.purge", request, admin_user, "recycle_bin", "all", f"items={result['deleted_items']}; bytes={result['freed_bytes']}")
    return {"msg": "已清空全局回收站", **result}


@app.get("/api/admin/audit-logs")
def list_audit_logs(limit: int = 200, authorization: str = Header(None)):
    require_admin(authorization, ADMIN_SCOPE_AUDIT)
    safe_limit = max(1, min(limit, 1000))
    conn = get_db()
    c = conn.cursor()
    c.execute(
        "SELECT id, created_at, actor_username, actor_role, ip_address, action, target_type, target_id, detail, outcome FROM audit_logs ORDER BY id DESC LIMIT ?",
        (safe_limit,),
    )
    logs = [dict(row) for row in c.fetchall()]
    conn.close()
    return {"logs": logs}


@app.post("/api/repos/{repo_id}/upload")
def upload_repo_files(
    repo_id: str,
    files: list[UploadFile] = File(...),
    relative_paths: Optional[list[str]] = Form(None),
    authorization: str = Header(None),
):
    _, user = get_repo_access(repo_id, authorization, require_write=True)
    if not user:
        raise HTTPException(status_code=401, detail="未登录")
    if not files:
        raise HTTPException(status_code=400, detail="请至少选择一个文件")

    uploaded_paths = []
    total_bytes = 0
    normalized_paths = relative_paths or []
    current_repo_size = get_repo_storage(repo_id)
    pending_sizes = {}

    prepared_files = []
    for index, file in enumerate(files):
        source_name = file.filename or ""
        target_path = normalize_repo_path(normalized_paths[index] if index < len(normalized_paths) and normalized_paths[index] else source_name)
        _, ext = os.path.splitext(target_path)
        if ext.lower() not in ALLOWED_EXTENSIONS:
            raise HTTPException(status_code=400, detail=f"不支持的文件类型: {ext}")

        content = file.file.read()
        new_size = len(content)
        disk_path = get_repo_file_path(repo_id, target_path)
        previous_size = pending_sizes.get(target_path)
        if previous_size is None:
            previous_size = os.path.getsize(disk_path) if os.path.exists(disk_path) else 0
        total_bytes += new_size - previous_size
        pending_sizes[target_path] = new_size
        prepared_files.append((target_path, content))

    if current_repo_size + total_bytes > REPO_QUOTA:
        raise HTTPException(
            status_code=400,
            detail=f"仓库容量超限。单仓库上限为 {format_bytes(REPO_QUOTA)}，当前操作后将达到 {format_bytes(current_repo_size + total_bytes)}。",
        )

    conn = get_db()
    c = conn.cursor()
    for target_path, content in prepared_files:
        disk_path = get_repo_file_path(repo_id, target_path)
        os.makedirs(os.path.dirname(disk_path), exist_ok=True)
        with open(disk_path, "wb") as output_file:
            output_file.write(content)
        set_repo_file_record(c, repo_id, target_path, user["username"])
        uploaded_paths.append(target_path)

    c.execute("UPDATE repositories SET updated_at=? WHERE id=?", (now_text(), repo_id))
    append_repo_activity(c, repo_id, user["username"], "repo.file.upload", f"上传了 {len(uploaded_paths)} 个文件")
    conn.commit()
    conn.close()
    sample_names = "、".join(uploaded_paths[:3])
    if len(uploaded_paths) > 3:
        sample_names += " 等"
    return {
        "msg": f"仓库已接收 {len(uploaded_paths)} 个文件，共 {format_bytes(total_bytes)}：{sample_names}",
        "uploaded_count": len(uploaded_paths),
        "total_bytes": total_bytes,
        "paths": uploaded_paths,
    }


@app.get("/api/repos/{repo_id}/files/{relative_path:path}")
def download_repo_file(repo_id: str, relative_path: str, request: Request, authorization: str = Header(None)):
    repo, user = get_repo_access(repo_id, authorization)
    normalized = normalize_repo_path(relative_path)
    file_path = get_repo_file_path(repo_id, normalized)
    if os.path.exists(file_path):
        log_audit_event(
            "repo.download",
            request,
            user or {"username": "anonymous", "role": ROLE_USER},
            "repo_file",
            f"{repo_id}:{normalized}",
            repo["name"],
        )
        return build_attachment_response(file_path, os.path.basename(normalized))
    raise HTTPException(status_code=404, detail="仓库文件不存在")


@app.delete("/api/repos/{repo_id}/files/{relative_path:path}")
def delete_repo_file(repo_id: str, relative_path: str, request: Request, authorization: str = Header(None)):
    repo, user = get_repo_access(repo_id, authorization, require_write=True)
    normalized = normalize_repo_path(relative_path)
    file_path = get_repo_file_path(repo_id, normalized)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="仓库文件不存在")
    actor_username = user["username"] if user else repo["owner_username"]
    move_file_to_recycle_bin(repo["owner_username"], actor_username, "repo_file", f"{repo_id}:{normalized}", file_path, normalized)
    cleanup_empty_repo_dirs(repo_id, file_path)

    conn = get_db()
    c = conn.cursor()
    c.execute("DELETE FROM repo_files WHERE repo_id=? AND relative_path=?", (repo_id, normalized))
    c.execute("UPDATE repositories SET updated_at=? WHERE id=?", (now_text(), repo_id))
    append_repo_activity(c, repo_id, actor_username, "repo.file.delete", f"删除了文件 {normalized}")
    conn.commit()
    conn.close()
    log_audit_event("repo.delete", request, user, "repo_file", f"{repo_id}:{normalized}", repo["name"])
    return {"msg": f"已从仓库 {repo['name']} 删除文件"}


@app.post("/api/chat")
def send_chat(
    content: str = Form(""),
    share_code: str = Form(""),
    image_data: str = Form(""),
    authorization: str = Header(None),
):
    user = get_user_context(authorization)
    if not content and not share_code and not image_data:
        raise HTTPException(status_code=400, detail="消息不能为空")

    stored_image = ""
    if image_data:
        stored_image = save_chat_image(image_data)

    conn = get_db()
    c = conn.cursor()
    c.execute(
        "INSERT INTO messages (username, content, share_code, image_data, time) VALUES (?,?,?,?,?)",
        (user["username"], content, share_code, stored_image, datetime.now().strftime("%H:%M")),
    )
    conn.commit()
    conn.close()
    notify_chat_stream_updated()
    return {"msg": "已发送", "image_url": stored_image}


@app.get("/api/chat")
def get_chat():
    return read_chat_messages()


@app.get("/api/chat/stream")
async def stream_chat():
    async def event_generator():
        last_version = -1
        while True:
            current_version = CHAT_STREAM_VERSION
            if current_version != last_version:
                payload = json.dumps(read_chat_messages(), ensure_ascii=False)
                yield f"data: {payload}\n\n"
                last_version = current_version
            try:
                await asyncio.wait_for(CHAT_STREAM_EVENT.wait(), timeout=25)
                CHAT_STREAM_EVENT.clear()
            except asyncio.TimeoutError:
                yield ": keep-alive\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/chat/reset")
def reset_chat(authorization: str = Header(None)):
    require_admin(authorization, ADMIN_SCOPE_SHARE)
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT image_data FROM messages WHERE image_data IS NOT NULL AND image_data != ''")
    image_values = [row[0] for row in c.fetchall()]
    c.execute("DELETE FROM messages")
    conn.commit()
    conn.close()
    for image_value in image_values:
        delete_chat_image_file(image_value)
    notify_chat_stream_updated()
    return {"msg": "聊天记录已清空"}


@app.post("/api/login")
def login(request: Request, username: str = Form(...), password: str = Form(...)):
    conn = get_db()
    c = conn.cursor()
    c.execute(
        """
        SELECT
            username,
            password,
            COALESCE(phone, '') AS phone,
            COALESCE(is_admin, 0) AS is_admin,
            COALESCE(role, '') AS role,
            COALESCE(admin_scopes, '') AS admin_scopes,
            COALESCE(is_disabled, 0) AS is_disabled,
            COALESCE(quota_bytes, ?) AS quota_bytes
        FROM users
        WHERE username=?
        """,
        (USER_QUOTA, username),
    )
    row = c.fetchone()
    if not row or not verify_password(password, row["password"]):
        conn.close()
        log_audit_event("auth.login", request, {"username": username, "role": ROLE_USER}, "user", username, "账号或密码错误", "denied")
        raise HTTPException(status_code=401, detail="账号或密码错误")
    if row["is_disabled"]:
        conn.close()
        log_audit_event("auth.login", request, {"username": username, "role": row["role"] or ROLE_USER}, "user", username, "账号已冻结", "denied")
        raise HTTPException(status_code=403, detail="账号已被冻结，请联系超级管理员")

    if row and verify_password(password, row["password"]):
        token = str(uuid.uuid4())
        c.execute("DELETE FROM sessions WHERE username=?", (username,))
        c.execute("INSERT INTO sessions VALUES (?, ?)", (token, username))
        conn.commit()
        payload = build_user_context(row, c)
        conn.close()
        log_audit_event("auth.login", request, payload, "user", username, "登录成功")
        return {"token": token, **payload}


@app.post("/api/register")
def register(username: str = Form(...), password: str = Form(...), phone: str = Form(...)):
    if not re.match(r"^1[3-9]\d{9}$", phone):
        raise HTTPException(status_code=400, detail="手机号格式错误")
    conn = get_db()
    c = conn.cursor()
    c.execute(
        "SELECT phone, real_name, status FROM registration_whitelist WHERE phone=?",
        (phone.strip(),),
    )
    whitelist_row = c.fetchone()
    if not whitelist_row:
        conn.close()
        raise HTTPException(status_code=403, detail="该手机号未被录入注册白名单")
    if (whitelist_row["status"] or WHITELIST_STATUS_PENDING) == WHITELIST_STATUS_REGISTERED:
        conn.close()
        raise HTTPException(status_code=400, detail="该手机号名额已完成注册，不能重复使用")

    final_username = build_registered_username(username, whitelist_row["real_name"] or "")
    c.execute("SELECT 1 FROM users WHERE username=?", (final_username,))
    if c.fetchone():
        conn.close()
        raise HTTPException(status_code=400, detail="该昵称已与实名组合成重复账号，请更换昵称后重试")

    c.execute("SELECT COUNT(*) FROM users WHERE COALESCE(is_admin, 0)=1 OR role IN (?, ?)", (ROLE_ADMIN, ROLE_SUPER_ADMIN))
    has_admin = c.fetchone()[0] > 0
    role = ROLE_ADMIN if not has_admin else ROLE_USER
    is_admin = 1 if role in {ROLE_ADMIN, ROLE_SUPER_ADMIN} else 0
    admin_scopes = serialize_admin_scopes(ADMIN_SCOPE_OPTIONS if role == ROLE_SUPER_ADMIN else DEFAULT_ADMIN_SCOPES)
    try:
        c.execute(
            "INSERT INTO users (username, password, phone, is_admin, role, admin_scopes, quota_bytes) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (final_username, hash_password(password), phone.strip(), is_admin, role, admin_scopes if is_admin else "", USER_QUOTA),
        )
        c.execute(
            "UPDATE registration_whitelist SET status=?, registered_username=?, registered_at=? WHERE phone=?",
            (WHITELIST_STATUS_REGISTERED, final_username, now_text(), phone.strip()),
        )
        conn.commit()
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="用户名或手机号已存在")
    finally:
        conn.close()
    return {
        "msg": "ok",
        "username": final_username,
        "real_name": whitelist_row["real_name"] or "",
        "is_admin": bool(is_admin),
        "role": role,
        "is_super_admin": role == ROLE_SUPER_ADMIN,
    }


@app.get("/api/admin/registration-whitelist")
def list_registration_whitelist(authorization: str = Header(None)):
    require_admin(authorization, ADMIN_SCOPE_USER_LIFECYCLE)
    conn = get_db()
    c = conn.cursor()
    c.execute(
        """
        SELECT phone, real_name, status, registered_username, imported_at, imported_by, registered_at
        FROM registration_whitelist
        ORDER BY
            CASE COALESCE(status, '') WHEN ? THEN 0 ELSE 1 END,
            imported_at DESC,
            phone ASC
        """,
        (WHITELIST_STATUS_PENDING,),
    )
    items = [build_registration_whitelist_payload(row) for row in c.fetchall()]
    conn.close()
    return {"items": items}


@app.post("/api/admin/registration-whitelist/import")
def import_registration_whitelist(
    request: Request,
    file: UploadFile = File(...),
    authorization: str = Header(None),
):
    current_admin = require_admin(authorization, ADMIN_SCOPE_USER_LIFECYCLE)
    filename = (file.filename or "名单.txt").strip()
    _, ext = os.path.splitext(filename)
    if ext.lower() not in {".txt", ".csv"}:
        raise HTTPException(status_code=400, detail="名单文件只支持 .txt 或 .csv")
    try:
        content = file.file.read().decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail="名单文件需为 UTF-8 编码") from exc
    rows = parse_whitelist_import_lines(content)
    conn = get_db()
    c = conn.cursor()
    imported_at = now_text()
    inserted = 0
    updated = 0
    for row in rows:
        c.execute(
            "SELECT username FROM users WHERE phone=?",
            (row["phone"],),
        )
        matched_user = c.fetchone()
        next_status = WHITELIST_STATUS_REGISTERED if matched_user else WHITELIST_STATUS_PENDING
        matched_username = matched_user["username"] if matched_user else None
        matched_registered_at = imported_at if matched_user else None
        c.execute(
            "SELECT status FROM registration_whitelist WHERE phone=?",
            (row["phone"],),
        )
        existing = c.fetchone()
        c.execute(
            """
            INSERT INTO registration_whitelist (phone, real_name, status, registered_username, imported_at, imported_by, registered_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(phone) DO UPDATE SET
                real_name=excluded.real_name,
                imported_at=excluded.imported_at,
                imported_by=excluded.imported_by,
                status=CASE
                    WHEN excluded.status=? THEN excluded.status
                    WHEN registration_whitelist.status=? THEN registration_whitelist.status
                    ELSE excluded.status
                END,
                registered_username=CASE
                    WHEN excluded.registered_username IS NOT NULL AND excluded.registered_username != '' THEN excluded.registered_username
                    ELSE registration_whitelist.registered_username
                END,
                registered_at=CASE
                    WHEN excluded.registered_username IS NOT NULL AND excluded.registered_username != '' THEN COALESCE(registration_whitelist.registered_at, excluded.registered_at)
                    ELSE registration_whitelist.registered_at
                END
            """,
            (
                row["phone"],
                row["real_name"],
                next_status,
                matched_username,
                imported_at,
                current_admin["username"],
                matched_registered_at,
                WHITELIST_STATUS_REGISTERED,
                WHITELIST_STATUS_REGISTERED,
            ),
        )
        if existing:
            updated += 1
        else:
            inserted += 1
    reconcile_registration_whitelist(c)
    conn.commit()
    conn.close()
    log_audit_event(
        "admin.registration_whitelist.import",
        request,
        current_admin,
        "registration_whitelist",
        filename,
        f"inserted={inserted}; updated={updated}",
    )
    return {"msg": "白名单导入完成", "inserted": inserted, "updated": updated, "total": len(rows)}


@app.post("/api/admin/users")
def create_user_as_admin(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
    phone: str = Form(...),
    role: str = Form(ROLE_USER),
    quota_bytes: int = Form(USER_QUOTA),
    admin_scopes: Optional[list[str]] = Form(None),
    authorization: str = Header(None),
):
    current_admin = require_admin(authorization, ADMIN_SCOPE_USER_LIFECYCLE)
    role = (role or ROLE_USER).strip()
    if role not in {ROLE_USER, ROLE_ADMIN, ROLE_SUPER_ADMIN}:
        raise HTTPException(status_code=400, detail="非法角色")
    if role != ROLE_USER and not current_admin["is_super_admin"]:
        raise HTTPException(status_code=403, detail="只有超级管理员可以直接创建管理员")
    if role == ROLE_SUPER_ADMIN and username.strip() != SUPER_ADMIN_USERNAME:
        raise HTTPException(status_code=400, detail="超级管理员账号名固定为 bobibobixuan")
    if quota_bytes <= 0:
        raise HTTPException(status_code=400, detail="配额必须大于 0")

    normalized_scopes = resolve_admin_scopes_for_role(role, admin_scopes)
    conn = get_db()
    c = conn.cursor()
    try:
        c.execute(
            "INSERT INTO users (username, password, phone, is_admin, role, admin_scopes, quota_bytes) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                username.strip(),
                hash_password(password),
                phone.strip(),
                1 if role in {ROLE_ADMIN, ROLE_SUPER_ADMIN} else 0,
                role,
                normalized_scopes,
                quota_bytes,
            ),
        )
        conn.commit()
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="用户名或手机号已存在")
    finally:
        conn.close()
    log_audit_event("admin.user.create", request, current_admin, "user", username.strip(), f"role={role}, quota={quota_bytes}")
    return {"msg": f"已创建用户 {username.strip()}"}


@app.get("/api/admin/users")
def list_users(authorization: str = Header(None)):
    require_admin(authorization, ADMIN_SCOPE_USER_LIFECYCLE)
    conn = get_db()
    c = conn.cursor()
    c.execute(
        """
        SELECT
            username,
            phone,
            COALESCE(is_admin, 0) AS is_admin,
            COALESCE(role, '') AS role,
            COALESCE(admin_scopes, '') AS admin_scopes,
            COALESCE(is_disabled, 0) AS is_disabled,
            COALESCE(quota_bytes, ?) AS quota_bytes,
            COALESCE(used_storage, 0) AS used_storage
        FROM users
        ORDER BY
            CASE COALESCE(role, '') WHEN ? THEN 0 WHEN ? THEN 1 ELSE 2 END,
            username ASC
        """,
        (USER_QUOTA, ROLE_SUPER_ADMIN, ROLE_ADMIN),
    )
    users = []
    for row in c.fetchall():
        c.execute("SELECT COUNT(*) FROM repositories WHERE owner_username=?", (row["username"],))
        repo_count = c.fetchone()[0]
        user_payload = build_user_context(row, c)
        users.append(
            {
                "username": row["username"],
            "real_name": user_payload["real_name"],
                "phone": row["phone"],
                "is_admin": user_payload["is_admin"],
                "role": user_payload["role"],
                "is_super_admin": user_payload["is_super_admin"],
                "admin_scopes": user_payload["admin_scopes"],
                "is_disabled": user_payload["is_disabled"],
                "storage": row["used_storage"],
                "quota_bytes": user_payload["quota_bytes"],
                "repo_count": repo_count,
            }
        )
    conn.close()
    return {"users": users}


@app.post("/api/admin/grant")
def set_admin_role(target_username: str = Form(...), is_admin: int = Form(...), authorization: str = Header(None)):
    current_admin = require_admin(authorization, ADMIN_SCOPE_ROLE, super_only=True)
    target_value = 1 if int(is_admin) else 0

    conn = get_db()
    c = conn.cursor()
    c.execute(
        "SELECT username, COALESCE(is_admin, 0) AS is_admin, COALESCE(role, '') AS role FROM users WHERE username=?",
        (target_username,),
    )
    row = c.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="目标用户不存在")
    if row["role"] == ROLE_SUPER_ADMIN and target_value == 0:
        conn.close()
        raise HTTPException(status_code=400, detail="不能撤销超级管理员")

    if row["username"] == current_admin["username"] and target_value == 0:
        c.execute("SELECT COUNT(*) FROM users WHERE is_admin=1")
        admin_count = c.fetchone()[0]
        if admin_count <= 1:
            conn.close()
            raise HTTPException(status_code=400, detail="至少需要保留一名管理员")

    c.execute(
        "UPDATE users SET is_admin=?, role=?, admin_scopes=? WHERE username=?",
        (
            target_value,
            ROLE_ADMIN if target_value else ROLE_USER,
            serialize_admin_scopes(DEFAULT_ADMIN_SCOPES) if target_value else "",
            target_username,
        ),
    )
    conn.commit()
    conn.close()
    return {"msg": "管理员权限已更新", "username": target_username, "is_admin": bool(target_value)}


@app.post("/api/admin/users/{username}/password")
def reset_user_password(
    username: str,
    request: Request,
    new_password: str = Form(...),
    authorization: str = Header(None),
):
    current_admin = require_admin(authorization, ADMIN_SCOPE_USER_LIFECYCLE)
    target_username = username.strip()
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT COALESCE(role, '') AS role FROM users WHERE username=?", (target_username,))
    row = c.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="目标用户不存在")
    if row["role"] in {ROLE_ADMIN, ROLE_SUPER_ADMIN} and not current_admin["is_super_admin"]:
        conn.close()
        raise HTTPException(status_code=403, detail="只有超级管理员可以重置管理员密码")
    c.execute("UPDATE users SET password=? WHERE username=?", (hash_password(new_password), target_username))
    c.execute("DELETE FROM sessions WHERE username=?", (target_username,))
    conn.commit()
    conn.close()
    log_audit_event("admin.user.password_reset", request, current_admin, "user", target_username)
    return {"msg": f"已重置 {target_username} 的密码"}


@app.post("/api/admin/users/{username}/status")
def update_user_status(
    username: str,
    request: Request,
    is_disabled: int = Form(...),
    authorization: str = Header(None),
):
    current_admin = require_admin(authorization, ADMIN_SCOPE_USER_LIFECYCLE)
    target_username = username.strip()
    next_disabled = 1 if int(is_disabled) else 0
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT COALESCE(role, '') AS role FROM users WHERE username=?", (target_username,))
    row = c.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="目标用户不存在")
    if row["role"] == ROLE_SUPER_ADMIN:
        conn.close()
        raise HTTPException(status_code=400, detail="不能冻结超级管理员")
    if row["role"] == ROLE_ADMIN and not current_admin["is_super_admin"]:
        conn.close()
        raise HTTPException(status_code=403, detail="只有超级管理员可以冻结管理员")
    c.execute("UPDATE users SET is_disabled=? WHERE username=?", (next_disabled, target_username))
    if next_disabled:
        c.execute("DELETE FROM sessions WHERE username=?", (target_username,))
    conn.commit()
    conn.close()
    log_audit_event("admin.user.status", request, current_admin, "user", target_username, f"disabled={bool(next_disabled)}")
    return {"msg": f"已更新 {target_username} 的账号状态", "is_disabled": bool(next_disabled)}


@app.post("/api/admin/users/{username}/quota")
def update_user_quota(
    username: str,
    request: Request,
    quota_bytes: int = Form(...),
    authorization: str = Header(None),
):
    current_admin = require_admin(authorization, ADMIN_SCOPE_QUOTA)
    target_username = username.strip()
    if quota_bytes <= 0:
        raise HTTPException(status_code=400, detail="配额必须大于 0")
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT 1 FROM users WHERE username=?", (target_username,))
    if not c.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="目标用户不存在")
    c.execute("UPDATE users SET quota_bytes=? WHERE username=?", (quota_bytes, target_username))
    conn.commit()
    conn.close()
    log_audit_event("admin.user.quota", request, current_admin, "user", target_username, f"quota={quota_bytes}")
    return {"msg": f"已更新 {target_username} 的空间配额", "quota_bytes": quota_bytes}


@app.post("/api/admin/users/{username}/role")
def update_user_role(
    username: str,
    request: Request,
    role: str = Form(...),
    admin_scopes: Optional[list[str]] = Form(None),
    authorization: str = Header(None),
):
    current_admin = require_admin(authorization, ADMIN_SCOPE_ROLE, super_only=True)
    target_username = username.strip()
    next_role = (role or ROLE_USER).strip()
    if next_role not in {ROLE_USER, ROLE_ADMIN, ROLE_SUPER_ADMIN}:
        raise HTTPException(status_code=400, detail="非法角色")
    if next_role == ROLE_SUPER_ADMIN and target_username != SUPER_ADMIN_USERNAME:
        raise HTTPException(status_code=400, detail="超级管理员账号名固定为 bobibobixuan")
    next_scopes = resolve_admin_scopes_for_role(next_role, admin_scopes)
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT COALESCE(role, '') AS role FROM users WHERE username=?", (target_username,))
    row = c.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="目标用户不存在")
    if row["role"] == ROLE_SUPER_ADMIN and next_role != ROLE_SUPER_ADMIN:
        conn.close()
        raise HTTPException(status_code=400, detail="不能降级超级管理员")
    c.execute(
        "UPDATE users SET role=?, is_admin=?, admin_scopes=? WHERE username=?",
        (
            next_role,
            1 if next_role in {ROLE_ADMIN, ROLE_SUPER_ADMIN} else 0,
            next_scopes,
            target_username,
        ),
    )
    role_label = "超级管理员" if next_role == ROLE_SUPER_ADMIN else ("子管理员" if next_role == ROLE_ADMIN else "普通用户")
    detail = f"你的账号角色已更新为 {role_label}"
    if next_role == ROLE_ADMIN and next_scopes:
        detail += f"，权限范围：{next_scopes}"
    insert_notification(c, target_username, "admin", "账号权限发生变化", detail, "/admin")
    conn.commit()
    conn.close()
    log_audit_event("admin.user.role", request, current_admin, "user", target_username, f"role={next_role}; scopes={next_scopes}")
    return {"msg": f"已更新 {target_username} 的角色", "role": next_role}


@app.post("/api/admin/users/{username}/transfer-ownership")
def transfer_user_assets(
    username: str,
    request: Request,
    target_username: str = Form(...),
    authorization: str = Header(None),
):
    current_admin = require_admin(authorization, ADMIN_SCOPE_TRANSFER)
    source_username = username.strip()
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT COALESCE(role, '') AS role FROM users WHERE username=?", (source_username,))
    row = c.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="目标用户不存在")
    if row["role"] == ROLE_SUPER_ADMIN:
        conn.close()
        raise HTTPException(status_code=400, detail="不能转移超级管理员资产")
    try:
        result = transfer_user_ownership(c, source_username, target_username.strip())
        conn.commit()
    except Exception as exc:
        conn.rollback()
        conn.close()
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(status_code=400, detail=str(exc))
    conn.close()
    log_audit_event("admin.user.transfer", request, current_admin, "user", source_username, f"to={target_username.strip()}")
    return {"msg": f"已将 {source_username} 的文件和仓库转移给 {target_username.strip()}", **result}


@app.delete("/api/admin/users/{username}")
def delete_user_as_admin(username: str, request: Request, transfer_to: str = "", authorization: str = Header(None)):
    current_admin = require_admin(authorization, ADMIN_SCOPE_USER_LIFECYCLE)
    target_username = username.strip()
    if not target_username:
        raise HTTPException(status_code=400, detail="用户名不能为空")
    if target_username == current_admin["username"]:
        raise HTTPException(status_code=400, detail="当前管理员请通过账号安全自行注销")

    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT COALESCE(is_admin, 0) AS is_admin, COALESCE(role, '') AS role FROM users WHERE username=?", (target_username,))
    row = c.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="目标用户不存在")
    if row["role"] == ROLE_SUPER_ADMIN:
        conn.close()
        raise HTTPException(status_code=400, detail="不能删除超级管理员")
    if row["role"] == ROLE_ADMIN and not current_admin["is_super_admin"]:
        conn.close()
        raise HTTPException(status_code=403, detail="只有超级管理员可以删除管理员")

    if row["is_admin"]:
        c.execute("SELECT COUNT(*) FROM users WHERE is_admin=1")
        admin_count = c.fetchone()[0]
        if admin_count <= 1:
            conn.close()
            raise HTTPException(status_code=400, detail="至少需要保留一名管理员")

    c.execute("SELECT id FROM repositories WHERE owner_username=?", (target_username,))
    owned_repo_ids = [repo_row[0] for repo_row in c.fetchall()]
    c.execute("SELECT image_data FROM messages WHERE username=? AND image_data IS NOT NULL AND image_data != ''", (target_username,))
    owned_chat_images = [image_row[0] for image_row in c.fetchall()]

    try:
        if transfer_to.strip():
            transfer_user_ownership(c, target_username, transfer_to.strip())
            c.execute("SELECT id FROM repositories WHERE owner_username=?", (target_username,))
            owned_repo_ids = [repo_row[0] for repo_row in c.fetchall()]
        user_dir = get_user_dir(target_username)
        if os.path.exists(user_dir):
            shutil.rmtree(user_dir)

        for repo_id in owned_repo_ids:
            delete_repository_records(c, repo_id)

        c.execute("DELETE FROM repo_members WHERE username=?", (target_username,))
        c.execute("DELETE FROM users WHERE username=?", (target_username,))
        c.execute("DELETE FROM sessions WHERE username=?", (target_username,))
        c.execute("DELETE FROM messages WHERE username=?", (target_username,))
        c.execute("DELETE FROM shares WHERE username=?", (target_username,))
        c.execute("DELETE FROM file_records WHERE username=?", (target_username,))
        conn.commit()
    except Exception as exc:
        conn.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    finally:
        conn.close()

    for image_value in owned_chat_images:
        delete_chat_image_file(image_value)
    notify_chat_stream_updated()
    log_audit_event("admin.user.delete", request, current_admin, "user", target_username, f"transfer_to={transfer_to.strip()}")
    return {"msg": f"已删除用户 {target_username}"}


@app.post("/api/rename")
def rename_account(new_username: str = Form(...), authorization: str = Header(None)):
    user = get_user_context(authorization)
    username = user["username"]

    conn = get_db()
    c = conn.cursor()
    real_name = get_registered_real_name(c, username)
    normalized_target_username = build_registered_username(new_username, real_name) if real_name else normalize_name_part(new_username, "用户名")
    if normalized_target_username == username:
        conn.close()
        raise HTTPException(status_code=400, detail="新用户名不能与当前用户名相同")
    c.execute("SELECT 1 FROM users WHERE username=?", (normalized_target_username,))
    if c.fetchone():
        conn.close()
        raise HTTPException(status_code=400, detail="用户名已被占用")

    try:
        c.execute("UPDATE users SET username=? WHERE username=?", (normalized_target_username, username))
        c.execute("UPDATE sessions SET username=? WHERE username=?", (normalized_target_username, username))
        c.execute("UPDATE messages SET username=? WHERE username=?", (normalized_target_username, username))
        c.execute("UPDATE shares SET username=? WHERE username=?", (normalized_target_username, username))
        c.execute("UPDATE file_records SET username=? WHERE username=?", (normalized_target_username, username))
        c.execute("UPDATE repositories SET owner_username=? WHERE owner_username=?", (normalized_target_username, username))
        c.execute("UPDATE repo_members SET username=? WHERE username=?", (normalized_target_username, username))
        c.execute("UPDATE repo_files SET updated_by=? WHERE updated_by=?", (normalized_target_username, username))
        c.execute(
            "UPDATE registration_whitelist SET registered_username=? WHERE registered_username=?",
            (normalized_target_username, username),
        )

        old_dir = get_user_dir(username)
        new_dir = get_user_dir(normalized_target_username)
        if os.path.exists(old_dir):
            os.rename(old_dir, new_dir)
        conn.commit()
    except Exception as exc:
        conn.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    finally:
        conn.close()

    return {"msg": "修改成功", "new_username": normalized_target_username}


@app.post("/api/delete-account")
def delete_account(password: str = Form(...), authorization: str = Header(None)):
    user = get_user_context(authorization)
    username = user["username"]
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT password, COALESCE(is_admin, 0) AS is_admin FROM users WHERE username=?", (username,))
    row = c.fetchone()
    if not row or not verify_password(password, row["password"]):
        conn.close()
        raise HTTPException(status_code=401, detail="密码错误")

    if row["is_admin"]:
        c.execute("SELECT COUNT(*) FROM users WHERE is_admin=1")
        admin_count = c.fetchone()[0]
        if admin_count <= 1:
            conn.close()
            raise HTTPException(status_code=400, detail="最后一名管理员不能注销，请先授予其他管理员")

    c.execute("SELECT id FROM repositories WHERE owner_username=?", (username,))
    owned_repo_ids = [repo_row[0] for repo_row in c.fetchall()]
    c.execute("SELECT image_data FROM messages WHERE username=? AND image_data IS NOT NULL AND image_data != ''", (username,))
    owned_chat_images = [image_row[0] for image_row in c.fetchall()]

    try:
        user_dir = get_user_dir(username)
        if os.path.exists(user_dir):
            shutil.rmtree(user_dir)

        for repo_id in owned_repo_ids:
            delete_repository_records(c, repo_id)

        c.execute("DELETE FROM repo_members WHERE username=?", (username,))
        c.execute("DELETE FROM users WHERE username=?", (username,))
        c.execute("DELETE FROM sessions WHERE username=?", (username,))
        c.execute("DELETE FROM messages WHERE username=?", (username,))
        c.execute("DELETE FROM shares WHERE username=?", (username,))
        c.execute("DELETE FROM file_records WHERE username=?", (username,))
        conn.commit()
    except Exception as exc:
        conn.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    finally:
        conn.close()

    for image_value in owned_chat_images:
        delete_chat_image_file(image_value)
    notify_chat_stream_updated()

    return {"msg": "账号已注销"}


if __name__ == "__main__":
    print("=======================================")
    print("课堂云盘后端服务已启动")
    print(f"数据目录：{os.path.abspath(DATA_DIR)}")
    print(f"仓库目录：{os.path.abspath(REPO_DIR)}")
    print(f"数据库文件：{os.path.abspath(DB_FILE)}")
    print("接口地址：http://0.0.0.0:4321")
    print("已启用：个人云盘、仓库大厅、协作者、聊天与管理员接口")
    print("=======================================")
    uvicorn.run(app, host="0.0.0.0", port=4321)
