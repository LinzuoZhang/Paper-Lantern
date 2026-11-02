"""Durable local research jobs, leases and replayable progress events (stdlib)."""

from contextlib import contextmanager
import json
from pathlib import Path
import re
import sqlite3
import time
import uuid


ACTIVE = {"queued", "running", "cancelling"}
TERMINAL = {"completed", "failed", "cancelled", "interrupted", "awaiting_approval"}


class JobConflict(ValueError):
    pass


class JobStore:
    def __init__(self, path):
        self.path = Path(path).resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY, library_dir TEXT NOT NULL, request TEXT NOT NULL,
                    status TEXT NOT NULL, created_at REAL NOT NULL, updated_at REAL NOT NULL,
                    heartbeat REAL NOT NULL, attempt INTEGER NOT NULL, worker_pid INTEGER,
                    error TEXT NOT NULL DEFAULT '', result TEXT, note_id TEXT
                );
                CREATE UNIQUE INDEX IF NOT EXISTS one_active_job ON jobs(library_dir)
                    WHERE status IN ('queued','running','cancelling');
                CREATE TABLE IF NOT EXISTS events (
                    seq INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL,
                    created_at REAL NOT NULL, payload TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS events_job ON events(job_id,seq);
                CREATE TABLE IF NOT EXISTS followups (
                    request_id TEXT PRIMARY KEY, job_id TEXT NOT NULL, request TEXT NOT NULL
                );
            """)
            db.execute("BEGIN IMMEDIATE")
            columns = {row[1] for row in db.execute("PRAGMA table_info(jobs)")}
            for name, declaration in (("title", "TEXT NOT NULL DEFAULT ''"),
                                      ("title_source", "TEXT NOT NULL DEFAULT 'provisional'"),
                                      ("title_revision", "INTEGER NOT NULL DEFAULT 0"),
                                      ("deleted_at", "REAL"),
                                      ("conversation", "TEXT NOT NULL DEFAULT '[]'")):
                if name not in columns:
                    db.execute(f"ALTER TABLE jobs ADD COLUMN {name} {declaration}")

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def valid_id(job_id):
        if not isinstance(job_id, str) or not re.fullmatch(r"[a-f0-9]{32}", job_id):
            raise ValueError("任务 ID 无效。")
        return job_id

    @staticmethod
    def _event(db, job_id, payload):
        db.execute("INSERT INTO events(job_id,created_at,payload) VALUES (?,?,?)", (job_id, time.time(), json.dumps(payload, ensure_ascii=False)))

    def _recover(self, db, library_dir):
        stale = db.execute("SELECT id,status FROM jobs WHERE library_dir=? AND status IN ('queued','running','cancelling') AND heartbeat<?",
                           (str(Path(library_dir).resolve()), time.time() - 30)).fetchall()
        for row in stale:
            status = "cancelled" if row["status"] == "cancelling" else "interrupted"
            db.execute("UPDATE jobs SET status=?,error=?,updated_at=? WHERE id=?", (status, "后台运行器已中断，可从检查点继续。", time.time(), row["id"]))
            self._event(db, row["id"], {"jobStatus": status})

    def create(self, request, library_dir, request_id=None):
        job_id = self.valid_id(request_id) if request_id else uuid.uuid4().hex
        library = str(Path(library_dir).resolve())
        encoded = json.dumps(request, ensure_ascii=False, sort_keys=True)
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            self._recover(db, library)
            existing = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            if existing:
                if existing["deleted_at"] is not None:
                    raise JobConflict("该对话已删除，请使用新的请求 ID 创建对话。")
                if existing["request"] != encoded or existing["library_dir"] != library:
                    raise JobConflict("同一请求 ID 不能对应不同的研究任务。")
                return self._decode(existing), False
            if db.execute("SELECT 1 FROM followups WHERE request_id=?", (job_id,)).fetchone():
                raise JobConflict("该请求 ID 已用于追问，请使用新的请求 ID。")
            now = time.time()
            try:
                db.execute("INSERT INTO jobs(id,library_dir,request,status,created_at,updated_at,heartbeat,attempt) VALUES (?,?,?,'queued',?,?,?,1)",
                           (job_id, library, encoded, now, now, now))
            except sqlite3.IntegrityError:
                raise JobConflict("已有后台研究任务正在进行，请完成或停止后再创建。") from None
            self._event(db, job_id, {"jobStatus": "queued"})
            return self._decode(db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()), True

    @staticmethod
    def _decode(row):
        value = dict(row)
        value["request"] = json.loads(value["request"])
        value["result"] = json.loads(value["result"]) if value["result"] else None
        value["conversation"] = json.loads(value.get("conversation", "[]"))
        return value

    def follow_up(self, job_id, library_dir, request, request_id, *, replace_scope=False):
        self.valid_id(request_id)
        self.get(job_id, library_dir)
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM jobs WHERE id=? AND deleted_at IS NULL", (job_id,)).fetchone()
            if row is None:
                raise FileNotFoundError("研究对话不存在。")
            existing = db.execute("SELECT * FROM followups WHERE request_id=?", (request_id,)).fetchone()
            fingerprint = json.dumps({"request": request, "replaceScope": replace_scope}, ensure_ascii=False, sort_keys=True)
            if existing:
                if existing["job_id"] != job_id or existing["request"] != fingerprint:
                    raise JobConflict("同一请求 ID 不能对应不同的追问。")
                return self._decode(row), False
            if db.execute("SELECT 1 FROM jobs WHERE id=?", (request_id,)).fetchone():
                raise JobConflict("追问须使用新的请求 ID。")
            if row["status"] not in TERMINAL:
                raise JobConflict("请等待当前回答完成，或停止后再追问。")
            previous = self._decode(row)
            conversation = previous["conversation"]
            if len(conversation) >= 100:
                raise JobConflict("当前对话已达 100 轮，请新建对话继续。")
            conversation.append({"task": previous["request"]["task"], "result": previous["result"],
                                 "noteId": previous["note_id"], "status": previous["status"],
                                 "scope": {key: previous["request"].get(key, []) for key in ("hashes", "categoryIds")},
                                 "turnId": previous["request"].get("turnId", job_id)})
            request = dict(request)
            if not replace_scope:
                for key in ("hashes", "categoryIds"):
                    request[key] = previous["request"].get(key, [])
            request["turnId"] = request_id
            request["eventAfter"] = db.execute("SELECT COALESCE(MAX(seq),0) FROM events WHERE job_id=?", (job_id,)).fetchone()[0]
            now = time.time()
            try:
                db.execute("""UPDATE jobs SET request=?,conversation=?,status='queued',result=NULL,note_id=NULL,
                              attempt=attempt+1,worker_pid=NULL,error='',heartbeat=?,updated_at=?,title=? WHERE id=?""",
                           (json.dumps(request, ensure_ascii=False, sort_keys=True), json.dumps(conversation, ensure_ascii=False),
                            now, now, previous["title"] or self.public(previous)["title"], job_id))
            except sqlite3.IntegrityError:
                raise JobConflict("已有其他研究任务正在运行。") from None
            db.execute("INSERT INTO followups(request_id,job_id,request) VALUES (?,?,?)", (request_id, job_id, fingerprint))
            self._event(db, job_id, {"jobStatus": "queued", "followUp": True})
            return self._decode(db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()), True

    def get(self, job_id, library_dir=None):
        self.valid_id(job_id)
        with self.connect() as db:
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            if row is None or row["deleted_at"] is not None or (library_dir is not None and row["library_dir"] != str(Path(library_dir).resolve())):
                raise FileNotFoundError("研究任务不存在。")
            self._recover(db, row["library_dir"])
            return self._decode(db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone())

    def list(self, library_dir):
        library = str(Path(library_dir).resolve())
        with self.connect() as db:
            self._recover(db, library)
            rows = db.execute("""SELECT id,library_dir,request,status,created_at,updated_at,heartbeat,attempt,worker_pid,error,
                              NULL AS result,note_id,title,title_source,title_revision,deleted_at FROM jobs
                              WHERE library_dir=? AND deleted_at IS NULL ORDER BY updated_at DESC,created_at DESC,id""", (library,)).fetchall()
            return [self.public(self._decode(row), include_result=False) for row in rows]

    @staticmethod
    def public(job, include_result=True):
        provisional = " ".join(job["request"]["task"].split())
        provisional = provisional if len(provisional) <= 42 else provisional[:39] + "..."
        value = {"id": job["id"], "task": job["request"]["task"], "scope": {key: job["request"].get(key, []) for key in ("hashes", "categoryIds")},
                 "title": job.get("title") or provisional, "titleSource": job.get("title_source", "provisional"),
                 "titleRevision": job.get("title_revision", 0),
                 "status": job["status"], "createdAt": job["created_at"], "updatedAt": job["updated_at"], "attempt": job["attempt"],
                 "error": job["error"], "noteId": job["note_id"]}
        value["turnId"] = job["request"].get("turnId", job["id"])
        value["eventAfter"] = job["request"].get("eventAfter", 0)
        if include_result:
            from .evidence import report_with_paper_links
            try:
                papers = json.loads((Path(job["library_dir"]) / "library_db.json").read_text(encoding="utf-8")).get("papers", {})
            except (OSError, ValueError):
                papers = {}
            value["result"] = report_with_paper_links(job["result"], papers)
            value["conversation"] = [{**turn, "result": report_with_paper_links(turn.get("result"), papers)}
                                     for turn in job.get("conversation", [])]
        return value

    def rename(self, job_id, library_dir, title, *, generated=False, expected_revision=None):
        self.get(job_id, library_dir)
        if not isinstance(title, str) or not 1 <= len(title.strip()) <= 120:
            raise ValueError("对话标题须为 1–120 字符。")
        if generated and (type(expected_revision) is not int or expected_revision < 0):
            raise ValueError("自动标题版本无效。")
        title = " ".join(title.split())
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM jobs WHERE id=? AND deleted_at IS NULL", (job_id,)).fetchone()
            if row is None:
                raise FileNotFoundError("研究对话不存在。")
            if not generated or (row["title_source"] == "provisional" and row["title_revision"] == expected_revision):
                db.execute("UPDATE jobs SET title=?,title_source=?,title_revision=title_revision+1,updated_at=? WHERE id=?",
                           (title, "generated" if generated else "manual", time.time(), job_id))
        return self.get(job_id, library_dir)

    def delete(self, job_id, library_dir):
        self.get(job_id, library_dir)
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT status FROM jobs WHERE id=? AND deleted_at IS NULL", (job_id,)).fetchone()
            if row is None:
                raise FileNotFoundError("研究对话不存在。")
            status = "cancelled" if row["status"] in ACTIVE else row["status"]
            db.execute("UPDATE jobs SET deleted_at=?,updated_at=?,status=? WHERE id=?", (time.time(), time.time(), status, job_id))
            self._event(db, job_id, {"jobStatus": status, "deleted": True})

    def claim(self, job_id, attempt, pid):
        with self.connect() as db:
            row = db.execute("UPDATE jobs SET status='running',worker_pid=?,heartbeat=?,updated_at=? WHERE id=? AND attempt=? AND status='queued' AND (worker_pid IS NULL OR worker_pid=?)",
                             (pid, time.time(), time.time(), job_id, attempt, pid))
            if row.rowcount:
                self._event(db, job_id, {"jobStatus": "running"})
            return bool(row.rowcount)

    def alive(self, job_id, attempt):
        with self.connect() as db:
            row = db.execute("SELECT status,attempt FROM jobs WHERE id=?", (job_id,)).fetchone()
            return bool(row and row["attempt"] == attempt and row["status"] == "running")

    def heartbeat(self, job_id, attempt):
        with self.connect() as db:
            db.execute("UPDATE jobs SET heartbeat=? WHERE id=? AND attempt=? AND status='running'", (time.time(), job_id, attempt))

    def append(self, job_id, attempt, event):
        with self.connect() as db:
            row = db.execute("SELECT status,attempt FROM jobs WHERE id=?", (job_id,)).fetchone()
            if row and row["attempt"] == attempt and row["status"] == "running":
                self._event(db, job_id, event)

    def finish(self, job_id, attempt, status, result=None, error=""):
        if status not in TERMINAL:
            raise ValueError("Invalid terminal status")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT status,attempt FROM jobs WHERE id=?", (job_id,)).fetchone()
            if not row or row["attempt"] != attempt or row["status"] not in ACTIVE:
                return False
            if row["status"] == "cancelling":
                status, result, error = "cancelled", None, "任务已停止，可继续已完成的查阅。"
            db.execute("UPDATE jobs SET status=?,result=?,error=?,updated_at=?,heartbeat=? WHERE id=?", (
                status, json.dumps(result, ensure_ascii=False) if result is not None else None, error[:2000], time.time(), time.time(), job_id,
            ))
            self._event(db, job_id, {"jobStatus": status})
            return True

    def cancel(self, job_id, library_dir):
        self.get(job_id, library_dir)
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT status FROM jobs WHERE id=?", (job_id,)).fetchone()
            if row["status"] == "awaiting_approval":
                db.execute("UPDATE jobs SET status='cancelled',updated_at=? WHERE id=?", (time.time(), job_id))
                self._event(db, job_id, {"jobStatus": "cancelled"})
            elif row["status"] in ACTIVE:
                status = "cancelled" if row["status"] == "queued" else "cancelling"
                db.execute("UPDATE jobs SET status=?,updated_at=? WHERE id=?", (status, time.time(), job_id))
                self._event(db, job_id, {"jobStatus": status})
        return self.get(job_id, library_dir)

    def resume(self, job_id, library_dir):
        self.get(job_id, library_dir)
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            if row["status"] not in {"failed", "cancelled", "interrupted"}:
                raise JobConflict("只有中断、失败或已停止的任务可以继续。")
            try:
                db.execute("UPDATE jobs SET status='queued',attempt=attempt+1,worker_pid=NULL,error='',heartbeat=?,updated_at=? WHERE id=?", (time.time(), time.time(), job_id))
            except sqlite3.IntegrityError:
                raise JobConflict("已有其他研究任务正在运行。") from None
            self._event(db, job_id, {"jobStatus": "queued", "resumed": True})
        return self.get(job_id, library_dir)

    def events(self, job_id, after=0):
        with self.connect() as db:
            rows = db.execute("SELECT seq,payload FROM events WHERE job_id=? AND seq>? ORDER BY seq LIMIT 100", (job_id, after)).fetchall()
            return [{"seq": row["seq"], **json.loads(row["payload"])} for row in rows]

    def set_note(self, job_id, note_id):
        with self.connect() as db:
            db.execute("UPDATE jobs SET note_id=?,updated_at=? WHERE id=? AND status='completed'", (note_id, time.time(), job_id))
