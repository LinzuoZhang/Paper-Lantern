"""Run discussion tools in the optional Agent runtime; close cancels the worker."""

import json
import os
import queue
import subprocess
import threading
from time import monotonic

from .reading_agent.web_bridge import PROJECT_ROOT, agent_python


def run_discussion_agent(messages, connection, custom_prompt, library_dir):
    payload = {"messages": messages, "connection": connection, "customPrompt": custom_prompt,
               "libraryDir": str(library_dir)}
    process = subprocess.Popen(
        [agent_python(), "-X", "utf8", "-m", "backend.discussion_agent"],
        cwd=PROJECT_ROOT, env={**os.environ, "PYTHONIOENCODING": "utf-8"},
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        text=True, encoding="utf-8", creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    events = queue.Queue(maxsize=256)
    stopped = threading.Event()

    def collect():
        try:
            for line in process.stdout:
                while not stopped.is_set():
                    try:
                        events.put(line, timeout=.2)
                        break
                    except queue.Full:
                        continue
                if stopped.is_set():
                    break
        finally:
            process.stdout.close()
            while not stopped.is_set():
                try:
                    events.put(None, timeout=.2)
                    break
                except queue.Full:
                    continue

    reader = threading.Thread(target=collect, daemon=True)
    try:
        reader.start()
        # Credentials and document text never appear in process arguments or logs.
        json.dump(payload, process.stdin, ensure_ascii=False)
        process.stdin.close()
        yield {"status": "正在连接文献库 MCP…"}
        started = monotonic()
        while monotonic() - started < 600:
            try:
                line = events.get(timeout=1)
            except queue.Empty:
                yield {"heartbeat": True}
                continue
            if line is None:
                raise ValueError("Agent 意外退出，请检查运行环境并安装 requirements-reading-agent.txt。")
            event = json.loads(line)
            if event.get("error"):
                raise ValueError(event["error"])
            if event.get("done"):
                return
            yield event
        raise ValueError("Agent 讨论超时，请缩小问题范围后重试。")
    finally:
        stopped.set()
        if process.stdin and not process.stdin.closed:
            try:
                process.stdin.close()
            except BrokenPipeError:
                pass
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        reader.join(timeout=2)
