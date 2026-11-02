"""Stream the optional Agent CLI from the stdlib web server's Python runtime."""

import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import threading
from time import monotonic


PROJECT_ROOT = Path(__file__).resolve().parents[2]
RUN_LOCK = threading.Lock()


def validate_request(payload):
    if not isinstance(payload, dict) or set(payload) - {"task", "hashes", "categoryIds"}:
        raise ValueError("研究请求格式无效。")
    task = payload.get("task")
    if not isinstance(task, str) or not task.strip() or len(task) > 8000:
        raise ValueError("请输入 1–8000 字符的研究任务。")
    result = {"task": task.strip()}
    for key in ("hashes", "categoryIds"):
        values = payload.get(key, [])
        if not isinstance(values, list) or len(values) > 200 or any(not isinstance(value, str) or not value.strip() or len(value) > 500 for value in values):
            raise ValueError("文献和分类范围无效，请重新选择。")
        if key == "hashes" and key in payload and not values:
            raise ValueError("所选范围内没有可研究的论文。")
        result[key] = list(dict.fromkeys(value.strip() for value in values))
    return result


def agent_python():
    configured = os.environ.get("PAPER_LANTERN_AGENT_PYTHON", "").strip()
    if configured:
        path = Path(configured).expanduser().resolve()
        if not path.is_file():
            raise ValueError("阅读助手运行环境不可用，请检查 PAPER_LANTERN_AGENT_PYTHON。")
        return str(path)
    for relative in (".cache/reading-agent-venv/Scripts/python.exe", ".cache/reading-agent-venv/bin/python"):
        path = PROJECT_ROOT / relative
        if path.is_file():
            return str(path)
    return sys.executable


def run_events(payload, library_dir):
    """One local research run at a time; generator close tears down the process."""
    if not RUN_LOCK.acquire(blocking=False):
        yield {"error": "已有研究任务正在进行，请等待完成后再试。"}
        return
    process = None
    try:
        arguments = [agent_python(), "-X", "utf8", str(PROJECT_ROOT / "scripts/run_reading_agent.py"),
                     "--library-dir", str(Path(library_dir).resolve()), "--task=" + payload["task"]]
        for key, option in (("hashes", "--hash"), ("categoryIds", "--category")):
            for value in payload[key]:
                arguments.append(option + "=" + value)
        env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
        process = subprocess.Popen(arguments, cwd=PROJECT_ROOT, env=env, stdin=subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8",
                                   errors="replace", creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        messages = queue.Queue()

        def collect(pipe, kind):
            try:
                for line in pipe:
                    messages.put((kind, line))
            finally:
                pipe.close()
                messages.put((kind, None))

        readers = [threading.Thread(target=collect, args=(process.stdout, "output"), daemon=True),
                   threading.Thread(target=collect, args=(process.stderr, "progress"), daemon=True)]
        for reader in readers:
            reader.start()
        yield {"status": "正在准备文献…"}
        output, size, closed, last_error = [], 0, set(), ""
        started = monotonic()
        while len(closed) < 2:
            if monotonic() - started > 700:
                yield {"error": "研究任务超时，请缩小范围后重试。"}
                return
            try:
                kind, line = messages.get(timeout=1)
            except queue.Empty:
                yield {"heartbeat": True}
                continue
            if line is None:
                closed.add(kind)
            elif kind == "output":
                size += len(line)
                if size > 60_000:
                    yield {"error": "报告超过显示上限，请缩小研究范围。"}
                    return
                output.append(line)
            else:
                try:
                    event = json.loads(line)
                except ValueError:
                    last_error = line.strip()[:1500]
                    continue
                if isinstance(event, dict) and "type" in event:
                    yield {"agent": event}
        process.wait(timeout=5)
        if process.returncode:
            yield {"error": last_error or "研究未完成，请检查模型配置后重试。"}
        elif not "".join(output).strip():
            yield {"error": "没有收到研究报告，请重试。"}
        else:
            yield {"report": "".join(output).strip()}
    finally:
        if process is not None:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
        RUN_LOCK.release()
