"""HTTP-process job management; workers survive browser and server reconnects."""

import os
import json
import sqlite3
from pathlib import Path
import subprocess
import time

from backend.content_index import library_cache_dir
from .store import TERMINAL, JobStore
from .web_bridge import PROJECT_ROOT, agent_python, validate_request


def store_for(library_dir, base_dir=None):
    return JobStore(library_cache_dir(library_dir, base_dir) / "jobs.sqlite3")


def launch(store, job):
    try:
        command = [agent_python(), "-X", "utf8", str(PROJECT_ROOT / "scripts/run_reading_agent.py"),
                   "--job-id=" + job["id"], "--job-store=" + str(store.path), "--job-attempt=" + str(job["attempt"])]
        process = subprocess.Popen(command, cwd=PROJECT_ROOT, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                   stderr=subprocess.DEVNULL, env={**os.environ, "PYTHONIOENCODING": "utf-8"},
                                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), start_new_session=os.name != "nt")
        # Only the worker records its own PID when claiming the lease. On
        # Windows a venv executable can be a redirector with a different PID.
        # Reap child handles in this HTTP process, without owning its lifetime.
        import threading
        threading.Thread(target=process.wait, daemon=True).start()
    except (OSError, ValueError) as exc:
        store.finish(job["id"], job["attempt"], "failed", error="无法启动研究运行器：" + type(exc).__name__)


def create_job(payload, library_dir, base_dir=None):
    if not isinstance(payload, dict):
        raise ValueError("研究请求格式无效。")
    request_id = payload.get("requestId")
    if "requestId" in payload:
        JobStore.valid_id(request_id)
    request = validate_request({key: value for key, value in payload.items() if key not in {"requestId", "jobId"}})
    request["agentVersion"] = "general-v1"
    store = store_for(library_dir, base_dir)
    if "jobId" in payload:
        job, created = store.follow_up(payload["jobId"], library_dir, request, request_id,
                                       replace_scope=bool({"hashes", "categoryIds"}.intersection(payload)))
        if created:
            from .plans import PlanStore
            PlanStore(store).invalidate(job["id"], "superseded")
    else:
        job, created = store.create(request, library_dir, request_id)
    if created:
        launch(store, job)
    return store.public(store.get(job["id"], library_dir))


def resume_after_plan(store, job_id, library_dir, plan):
    """Resume approval results or plan failures; writes remain on the server."""
    with store.connect() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT * FROM jobs WHERE id=? AND deleted_at IS NULL", (job_id,)).fetchone()
        if row is None or row["library_dir"] != str(Path(library_dir).resolve()):
            raise FileNotFoundError("对话不存在。")
        request = json.loads(row["request"])
        if request.get("turnId", job_id) != plan["turnId"]:
            raise ValueError("该计划属于先前的对话轮次。")
        if row["status"] == "awaiting_approval":
            try:
                db.execute("UPDATE jobs SET status='queued',attempt=attempt+1,worker_pid=NULL,error='',heartbeat=?,updated_at=? WHERE id=?",
                           (time.time(), time.time(), job_id))
            except sqlite3.IntegrityError:
                # The operation receipts remain visible and do not need another execution.
                result = {"kind": "library", "planId": plan["id"], "report": "# 操作结果\n\n" + plan["proposal"]["summary"], "execution": plan["results"]}
                failed = plan["state"] in {"failed", "stale"}
                db.execute("UPDATE jobs SET status=?,result=?,error=?,updated_at=? WHERE id=?",
                           ("interrupted" if failed else "completed", json.dumps(result, ensure_ascii=False),
                            "已有其他任务运行，自动修复暂未启动；可从检查点继续。" if failed else "", time.time(), job_id))
                return
            store._event(db, job_id, {"jobStatus": "queued", "planExecuted": plan["id"],
                                     "planRepair": plan["state"] in {"failed", "stale"}})
        else:
            return
    launch(store, store.get(job_id, library_dir))


def job_events(store, job_id, library_dir, after=0):
    yield {"job": store.public(store.get(job_id, library_dir))}
    while True:
        events = store.events(job_id, after)
        for event in events:
            after = event["seq"]
            yield event
        job = store.get(job_id, library_dir)
        if job["status"] in TERMINAL and not store.events(job_id, after):
            yield {"job": store.public(job)}
            return
        if not events:
            yield {"heartbeat": True}
            time.sleep(.5)
