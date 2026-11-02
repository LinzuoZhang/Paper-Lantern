"""Detached durable worker; no model credentials or private reasoning on disk."""

import asyncio
import os
from pathlib import Path
import sys

from .state import AgentCancelled, AgentError, AgentOptions
from .store import JobStore


async def execute_job(store, job_id, attempt, model_factory=None):
    from .graph import ReadingAgent
    from .model import ConfiguredModel

    job = store.get(job_id)
    if not store.claim(job_id, attempt, os.getpid()):
        return

    def guard():
        if not store.alive(job_id, attempt):
            raise AgentCancelled("任务已停止或由新的运行器接管。")

    request = job["request"]
    history = []
    remaining = 24_000
    for turn in reversed(job.get("conversation", [])[-8:]):
        question = turn["task"][:4000]
        answer = (turn.get("result") or {}).get("report", "")[:6000]
        size = len(question) + len(answer)
        if size > remaining:
            break
        history.insert(0, {"question": question, "answer": answer})
        if (turn.get("result") or {}).get("planId"):
            from .plans import PlanStore
            try:
                prior = PlanStore(store).get(turn["result"]["planId"], job_id, job["library_dir"])
                history[0]["plan"] = {"planId": prior["id"], "summary": prior["proposal"]["summary"], "state": prior["state"]}
            except (ValueError, FileNotFoundError):
                pass
        remaining -= size
    options = AgentOptions(task=request["task"], library_dir=Path(job["library_dir"]), conversation=tuple(history),
                           hashes=tuple(request.get("hashes", [])), category_ids=tuple(request.get("categoryIds", [])),
                           max_rounds=12, max_tool_calls=40, tool_timeout=180, total_timeout=1200)
    monitor = None
    try:
        model = model_factory() if model_factory else ConfiguredModel()
        if request.get("agentVersion") == "general-v1":
            from .library_agent import LibraryAgent
            agent = LibraryAgent(options, model, store, job_id, request.get("turnId", job_id),
                                 store.path.with_name("library_agent_checkpoints.sqlite3"),
                                 on_event=lambda event: store.append(job_id, attempt, {"agent": event}), guard=guard)
        else:
            agent = ReadingAgent(options, model, on_event=lambda event: store.append(job_id, attempt, {"agent": event}),
                                 checkpoint_path=store.path.with_name("checkpoints.sqlite3"),
                                 thread_id=request.get("turnId", job_id), guard=guard)
        task = asyncio.create_task(agent.run())

        async def watch():
            while not task.done():
                if not store.alive(job_id, attempt):
                    task.cancel()
                    return
                store.heartbeat(job_id, attempt)
                await asyncio.sleep(.5)

        monitor = asyncio.create_task(watch())
        result = await task
        guard()
        # Structural progress is in the events table; don't duplicate it in
        # every result fetch. LangGraph messages remain in the local checkpoint.
        result.pop("events", None)
        store.finish(job_id, attempt, "awaiting_approval" if result.get("awaitingApproval") else "completed", result=result)
    except (asyncio.CancelledError, AgentCancelled):
        store.finish(job_id, attempt, "cancelled", error="研究已停止，可以从检查点继续。")
    except TimeoutError:
        store.finish(job_id, attempt, "failed", error="任务超时，检查点和已确认操作的执行记录已保留。")
    except (AgentError, ValueError, OSError) as exc:
        store.finish(job_id, attempt, "failed", error=str(exc))
    except Exception as exc:
        store.finish(job_id, attempt, "failed", error=f"运行器异常（{type(exc).__name__}），检查点已保留。")
    finally:
        if monitor:
            monitor.cancel()
            try:
                await monitor
            except asyncio.CancelledError:
                pass


def run_job(store_path, job_id, attempt):
    store = JobStore(store_path)
    try:
        if not (3, 11) <= sys.version_info[:2] < (3, 13) or sys.version_info.releaselevel != "final":
            store.finish(job_id, attempt, "failed", error="阅读助手需要正式版 Python 3.11 或 3.12。")
            return 1
        asyncio.run(execute_job(store, job_id, attempt))
        return 0
    except Exception as exc:
        store.finish(job_id, attempt, "failed", error=f"无法初始化运行器（{type(exc).__name__}）。请检查 Agent 依赖。")
        return 1
