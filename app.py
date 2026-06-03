from __future__ import annotations

import json
import os
import shutil
import sqlite3
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


CODEX_HOME = Path(r"C:\Users\Administrator\.codex")
DB_PATH = CODEX_HOME / "state_6.sqlite"
BACKUP_ROOT = CODEX_HOME / "backups" / "model-provider-switcher"
APP_DIR = Path(__file__).resolve().parent
STATIC_DIR = APP_DIR / "static"


def connect() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


def json_response(handler: BaseHTTPRequestHandler, status: int, data: object) -> None:
    body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def text_response(handler: BaseHTTPRequestHandler, status: int, text: str, content_type: str) -> None:
    body = text.encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def read_body(handler: BaseHTTPRequestHandler) -> dict:
    length = int(handler.headers.get("Content-Length", "0"))
    raw = handler.rfile.read(length).decode("utf-8") if length else "{}"
    return json.loads(raw)


def timestamp_dir() -> Path:
    stamp = time.strftime("%Y%m%d-%H%M%S")
    target_dir = BACKUP_ROOT / stamp
    target_dir.mkdir(parents=True, exist_ok=True)
    return target_dir


def get_thread(thread_id: str) -> dict:
    with connect() as con:
        row = con.execute(
            "SELECT id, model_provider, rollout_path FROM threads WHERE id = ?",
            (thread_id,),
        ).fetchone()
    if row is None:
        raise ValueError(f"thread id not found: {thread_id}")
    return dict(row)


def thread_rows(search: str, limit: int) -> list[dict]:
    sql = """
        SELECT id, title, model_provider, rollout_path, updated_at, cwd, source
        FROM threads
    """
    params: list[object] = []
    if search:
        sql += """
            WHERE id LIKE ?
               OR title LIKE ?
               OR model_provider LIKE ?
               OR cwd LIKE ?
               OR rollout_path LIKE ?
        """
        term = f"%{search}%"
        params.extend([term, term, term, term, term])
    sql += " ORDER BY updated_at DESC LIMIT ?"
    params.append(limit)

    with connect() as con:
        rows = [dict(row) for row in con.execute(sql, params)]

    for row in rows:
        rollout = Path(row["rollout_path"])
        row["rollout_exists"] = rollout.is_file()
        row["rollout_provider"] = read_rollout_provider(rollout) if row["rollout_exists"] else None
    return rows


def read_rollout_provider(path: Path) -> str | None:
    try:
        with path.open("r", encoding="utf-8") as f:
            for line in f:
                obj = json.loads(line)
                payload = obj.get("payload") if isinstance(obj, dict) else None
                if isinstance(payload, dict) and "model_provider" in payload:
                    value = payload["model_provider"]
                    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return None
    return None


def backup_database(target_dir: Path) -> Path:
    target = target_dir / "state_6.sqlite"
    with connect() as src:
        dst = sqlite3.connect(target)
        try:
            src.backup(dst)
        finally:
            dst.close()
    return target


def backup_file(path: Path, target_dir: Path) -> Path:
    rel_name = str(path).replace(":", "").replace("\\", "__").replace("/", "__")
    target = target_dir / rel_name
    shutil.copy2(path, target)
    return target


def rewrite_rollout_provider(path: Path, provider: str) -> int:
    changed = 0
    temp_path = path.with_name(f"{path.name}.tmp-{os.getpid()}-{time.time_ns()}")
    try:
        with path.open("r", encoding="utf-8", newline="") as src, temp_path.open(
            "w", encoding="utf-8", newline="\n"
        ) as dst:
            for line_no, line in enumerate(src, 1):
                stripped = line.rstrip("\r\n")
                if not stripped:
                    dst.write(line)
                    continue
                try:
                    obj = json.loads(stripped)
                except json.JSONDecodeError as exc:
                    raise ValueError(f"{path} line {line_no} is not valid JSON: {exc}") from exc

                payload = obj.get("payload") if isinstance(obj, dict) else None
                if isinstance(payload, dict) and "model_provider" in payload:
                    if payload["model_provider"] != provider:
                        payload["model_provider"] = provider
                        changed += 1

                dst.write(json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n")
        os.replace(temp_path, path)
    finally:
        if temp_path.exists():
            temp_path.unlink()
    return changed


def update_threads(ids: list[str], provider: str) -> dict:
    if not ids:
        raise ValueError("ids is required")
    if not isinstance(provider, str) or provider == "":
        raise ValueError("provider must be a non-empty string")

    placeholders = ",".join("?" for _ in ids)
    with connect() as con:
        rows = [
            dict(row)
            for row in con.execute(
                f"SELECT id, model_provider, rollout_path FROM threads WHERE id IN ({placeholders})",
                ids,
            )
        ]

    found_ids = {row["id"] for row in rows}
    missing_ids = [thread_id for thread_id in ids if thread_id not in found_ids]
    if missing_ids:
        raise ValueError(f"thread id not found: {', '.join(missing_ids)}")

    target_dir = timestamp_dir()
    db_backup = backup_database(target_dir)

    file_changes: list[dict] = []
    for row in rows:
        rollout = Path(row["rollout_path"])
        if not rollout.is_file():
            raise FileNotFoundError(str(rollout))
        file_backup = backup_file(rollout, target_dir)
        changed_lines = rewrite_rollout_provider(rollout, provider)
        file_changes.append(
            {
                "id": row["id"],
                "rollout_path": str(rollout),
                "changed_lines": changed_lines,
                "file_backup": str(file_backup),
            }
        )

    now = int(time.time())
    with connect() as con:
        con.execute("BEGIN IMMEDIATE")
        try:
            con.executemany(
                "UPDATE threads SET model_provider = ?, updated_at = ? WHERE id = ?",
                [(provider, now, row["id"]) for row in rows],
            )
            con.commit()
        except Exception:
            con.rollback()
            raise

    return {
        "updated": len(rows),
        "provider": provider,
        "db_backup": str(db_backup),
        "file_changes": file_changes,
    }


def providers() -> list[str]:
    with connect() as con:
        rows = con.execute(
            "SELECT DISTINCT model_provider FROM threads WHERE model_provider != '' ORDER BY model_provider"
        ).fetchall()
    return [row[0] for row in rows]


def read_rollout_text(thread_id: str) -> dict:
    row = get_thread(thread_id)
    path = Path(row["rollout_path"])
    if not path.is_file():
        raise FileNotFoundError(str(path))
    return {
        "id": row["id"],
        "rollout_path": str(path),
        "content": path.read_text(encoding="utf-8"),
        "rollout_provider": read_rollout_provider(path),
    }


def save_rollout_text(thread_id: str, content: str) -> dict:
    if not isinstance(content, str):
        raise ValueError("content must be a string")
    row = get_thread(thread_id)
    path = Path(row["rollout_path"])
    if not path.is_file():
        raise FileNotFoundError(str(path))

    target_dir = timestamp_dir()
    file_backup = backup_file(path, target_dir)
    path.write_text(content, encoding="utf-8", newline="\n")
    return {
        "id": row["id"],
        "rollout_path": str(path),
        "file_backup": str(file_backup),
        "rollout_provider": read_rollout_provider(path),
    }


def select_rollout_file(thread_id: str) -> dict:
    row = get_thread(thread_id)
    current_path = Path(row["rollout_path"])
    initial_dir = current_path.parent if current_path.parent.exists() else CODEX_HOME

    import tkinter as tk
    from tkinter import filedialog

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    selected = filedialog.askopenfilename(
        title="Select rollout JSONL file",
        initialdir=str(initial_dir),
        filetypes=[("JSONL files", "*.jsonl"), ("All files", "*.*")],
    )
    root.destroy()
    if not selected:
        return {"id": row["id"], "selected": None}
    return update_rollout_path(thread_id, selected)


def update_rollout_path(thread_id: str, rollout_path: str) -> dict:
    if not isinstance(rollout_path, str) or rollout_path == "":
        raise ValueError("rollout_path must be a non-empty string")
    path = Path(rollout_path)
    if not path.is_file():
        raise FileNotFoundError(str(path))

    row = get_thread(thread_id)
    target_dir = timestamp_dir()
    db_backup = backup_database(target_dir)
    now = int(time.time())
    with connect() as con:
        con.execute("BEGIN IMMEDIATE")
        try:
            con.execute(
                "UPDATE threads SET rollout_path = ?, updated_at = ? WHERE id = ?",
                (str(path), now, row["id"]),
            )
            con.commit()
        except Exception:
            con.rollback()
            raise
    return {
        "id": row["id"],
        "rollout_path": str(path),
        "rollout_provider": read_rollout_provider(path),
        "db_backup": str(db_backup),
    }


def ensure_backup_root() -> Path:
    BACKUP_ROOT.mkdir(parents=True, exist_ok=True)
    return BACKUP_ROOT.resolve()


def backup_dirs() -> list[Path]:
    root = ensure_backup_root()
    dirs = [item.resolve() for item in root.iterdir() if item.is_dir()]
    return sorted(dirs, key=lambda item: item.stat().st_mtime, reverse=True)


def validate_backup_child(path: Path) -> None:
    root = ensure_backup_root()
    resolved = path.resolve()
    if resolved == root or root not in resolved.parents:
        raise ValueError(f"refuse to delete outside backup root: {resolved}")


def backup_status() -> dict:
    dirs = backup_dirs()
    return {
        "backup_root": str(ensure_backup_root()),
        "count": len(dirs),
        "backups": [
            {
                "path": str(path),
                "name": path.name,
                "modified_at": int(path.stat().st_mtime),
            }
            for path in dirs
        ],
    }


def open_backup_root() -> dict:
    root = ensure_backup_root()
    os.startfile(str(root))
    return {"backup_root": str(root)}


def cleanup_backups_keep(keep: int) -> dict:
    if keep < 0:
        raise ValueError("keep must be greater than or equal to 0")
    dirs = backup_dirs()
    delete_dirs = dirs[keep:]
    deleted: list[str] = []
    for path in delete_dirs:
        validate_backup_child(path)
        shutil.rmtree(path)
        deleted.append(str(path))
    status = backup_status()
    status["deleted"] = deleted
    return status


def cleanup_backups_all(confirm_text: str) -> dict:
    if confirm_text != "确认清空":
        raise ValueError("confirm_text must be 确认清空")
    return cleanup_backups_keep(0)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        try:
            parsed = urlparse(self.path)
            if parsed.path == "/":
                index = STATIC_DIR / "index.html"
                text_response(self, 200, index.read_text(encoding="utf-8"), "text/html; charset=utf-8")
                return
            if parsed.path == "/favicon.ico":
                self.send_response(204)
                self.end_headers()
                return
            if parsed.path == "/styles.css":
                text_response(
                    self,
                    200,
                    (STATIC_DIR / "styles.css").read_text(encoding="utf-8"),
                    "text/css; charset=utf-8",
                )
                return
            if parsed.path == "/app.js":
                text_response(
                    self,
                    200,
                    (STATIC_DIR / "app.js").read_text(encoding="utf-8"),
                    "application/javascript; charset=utf-8",
                )
                return
            if parsed.path == "/api/threads":
                query = parse_qs(parsed.query)
                search = query.get("search", [""])[0]
                limit_text = query.get("limit", ["100"])[0]
                limit = max(1, min(500, int(limit_text)))
                json_response(self, 200, {"db_path": str(DB_PATH), "threads": thread_rows(search, limit)})
                return
            if parsed.path == "/api/providers":
                json_response(self, 200, {"providers": providers()})
                return
            if parsed.path == "/api/backups":
                json_response(self, 200, backup_status())
                return
            if parsed.path == "/api/rollout":
                query = parse_qs(parsed.query)
                thread_id = query.get("id", [""])[0]
                json_response(self, 200, read_rollout_text(thread_id))
                return
            if parsed.path == "/api/rollout/raw":
                query = parse_qs(parsed.query)
                thread_id = query.get("id", [""])[0]
                data = read_rollout_text(thread_id)
                text_response(self, 200, data["content"], "text/plain; charset=utf-8")
                return
            json_response(self, 404, {"error": "not found"})
        except Exception as exc:
            json_response(self, 400, {"error": str(exc)})

    def do_POST(self) -> None:
        try:
            path = urlparse(self.path).path
            if path == "/api/update":
                data = read_body(self)
                ids = data.get("ids")
                provider = data.get("provider")
                if not isinstance(ids, list) or not all(isinstance(item, str) for item in ids):
                    raise ValueError("ids must be a string array")
                result = update_threads(ids, provider)
                json_response(self, 200, result)
                return
            if path == "/api/rollout/save":
                data = read_body(self)
                thread_id = data.get("id")
                content = data.get("content")
                if not isinstance(thread_id, str):
                    raise ValueError("id must be a string")
                json_response(self, 200, save_rollout_text(thread_id, content))
                return
            if path == "/api/rollout/select":
                data = read_body(self)
                thread_id = data.get("id")
                if not isinstance(thread_id, str):
                    raise ValueError("id must be a string")
                json_response(self, 200, select_rollout_file(thread_id))
                return
            if path == "/api/rollout/path":
                data = read_body(self)
                thread_id = data.get("id")
                rollout_path = data.get("rollout_path")
                if not isinstance(thread_id, str):
                    raise ValueError("id must be a string")
                json_response(self, 200, update_rollout_path(thread_id, rollout_path))
                return
            if path == "/api/backups/open":
                json_response(self, 200, open_backup_root())
                return
            if path == "/api/backups/keep3":
                json_response(self, 200, cleanup_backups_keep(3))
                return
            if path == "/api/backups/clear":
                data = read_body(self)
                confirm_text = data.get("confirm_text")
                if not isinstance(confirm_text, str):
                    raise ValueError("confirm_text must be a string")
                json_response(self, 200, cleanup_backups_all(confirm_text))
                return
            else:
                json_response(self, 404, {"error": "not found"})
                return
        except Exception as exc:
            json_response(self, 400, {"error": str(exc)})

    def log_message(self, format: str, *args: object) -> None:
        print("%s - %s" % (self.address_string(), format % args))


def main() -> None:
    host = "127.0.0.1"
    port = int(os.environ.get("PORT", "8765"))
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Model Provider Switcher running at http://{host}:{port}")
    print(f"Database: {DB_PATH}")
    server.serve_forever()


if __name__ == "__main__":
    main()
