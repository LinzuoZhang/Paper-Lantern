"""Run the optional, read-only research agent from any working directory."""

import argparse
import asyncio
from contextlib import ExitStack
import json
import os
from pathlib import Path
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.reading_agent.state import AgentError, AgentOptions  # noqa: E402


def parser():
    result = argparse.ArgumentParser(description="Paper Lantern 阅读机器人（只读 MCP + LangGraph）")
    result.add_argument("--task", help="研究任务")
    result.add_argument("--library-dir", type=Path, help="已有文献库；默认 PAPER_LIBRARY_DIR 或 literature_library")
    result.add_argument("--category", action="append", default=[], help="限定分类 ID，包含子分类；可重复")
    result.add_argument("--hash", action="append", default=[], dest="hashes", help="限定文章 ID；可重复")
    result.add_argument("--output", type=Path, help="保存 Markdown 报告，并生成 .trace.json 证据与事件文件；不覆盖已有文件")
    result.add_argument("--max-rounds", type=int, default=8)
    result.add_argument("--max-tool-calls", type=int, default=24)
    result.add_argument("--max-catalog", type=int, default=80)
    result.add_argument("--timeout", type=int, default=600, help="整次任务超时秒数")
    result.add_argument("--job-id", help=argparse.SUPPRESS)
    result.add_argument("--job-store", type=Path, help=argparse.SUPPRESS)
    result.add_argument("--job-attempt", type=int, help=argparse.SUPPRESS)
    demo = result.add_mutually_exclusive_group()
    demo.add_argument("--demo", action="store_true", help="隔离合成库 + 本地确定性模型，离线验证实际 LangGraph/MCP/HTTP 链路")
    demo.add_argument("--live-demo", action="store_true", help="隔离合成库 + 当前配置模型；发送合成文本验证真实工具调用，会使用模型额度")
    return result


def output_paths(path):
    path = path.expanduser().resolve()
    trace = path.with_suffix(".trace.json")
    if path == trace or path.exists() or trace.exists():
        raise AgentError("报告或 trace 文件已存在，请选择新的输出路径。")
    return path, trace


def save_result(path, trace, result):
    path.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive creation also protects against a concurrent writer after the
    # initial check. No report is saved until the run passes validation.
    with trace.open("x", encoding="utf-8") as handle:
        json.dump({key: value for key, value in result.items() if key != "report"}, handle, ensure_ascii=False, indent=2)
    with path.open("x", encoding="utf-8") as handle:
        handle.write(result["report"] + "\n")


def main(argv=None):
    args = parser().parse_args(argv)
    if args.job_id:
        if not args.job_store or not args.job_attempt or args.demo or args.live_demo or args.output:
            parser().error("后台任务启动参数无效。")
        from backend.reading_agent.worker import run_job
        return run_job(args.job_store, args.job_id, args.job_attempt)
    if not (args.demo or args.live_demo or args.task):
        parser().error("请提供 --task，或使用 --demo / --live-demo。")
    if (args.demo or args.live_demo) and (args.library_dir or args.category or args.hashes):
        parser().error("演示模式使用独立合成库，不能同时指定文献库、分类或文章。")
    if not (3, 11) <= sys.version_info[:2] < (3, 13) or sys.version_info.releaselevel != "final":
        print("阅读机器人需要正式版 Python 3.11 或 3.12，请在独立环境安装 requirements-reading-agent.txt。", file=sys.stderr)
        return 2
    try:
        from backend.reading_agent.graph import ReadingAgent
        from backend.reading_agent.model import ConfiguredModel

        paths = output_paths(args.output) if args.output else None
        with ExitStack() as stack:
            task = args.task
            if args.demo or args.live_demo:
                from backend.reading_agent.demo import DEMO_TASK, DemoModelServer, create_demo_library

                temporary = stack.enter_context(tempfile.TemporaryDirectory(prefix="paper-lantern-p0-"))
                library = create_demo_library(Path(temporary) / "library")
                task = task or DEMO_TASK
            else:
                library = args.library_dir or Path(os.environ.get("PAPER_LIBRARY_DIR", ROOT / "literature_library"))
            if paths:
                for output in paths:
                    if output == library.resolve() or library.resolve() in output.parents:
                        raise AgentError("CLI 报告请保存到文献库之外；库内保存请使用网页阅读助手。")
            if args.demo:
                # Bypass real configuration entirely, including absent API keys.
                local = stack.enter_context(DemoModelServer())
                model = ConfiguredModel(timeout=30, connection=("offline-demo", "offline-demo", local.url, False), custom_prompt="")
            else:
                model = ConfiguredModel()
            options = AgentOptions(task=task, library_dir=library.resolve(), category_ids=tuple(args.category),
                                   hashes=tuple(args.hashes), max_rounds=args.max_rounds, max_tool_calls=args.max_tool_calls,
                                   max_catalog=args.max_catalog, total_timeout=args.timeout)

            def progress(event):
                print(json.dumps(event, ensure_ascii=False), file=sys.stderr, flush=True)

            result = asyncio.run(ReadingAgent(options, model, progress).run())
            result["mode"] = "offline-demo" if args.demo else "live-demo" if args.live_demo else "configured-model"
            if paths:
                save_result(*paths, result)
            print(result["report"])
        return 0
    except KeyboardInterrupt:
        print("任务已中止，未调用文献库写入工具。", file=sys.stderr)
        return 130
    except (AgentError, ValueError, OSError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    except Exception as exc:
        # MCP/AnyIO may wrap transport failures in ExceptionGroup. Avoid
        # dumping an upstream response or a credential-bearing URL.
        print(f"Agent 运行失败（{type(exc).__name__}）。请检查依赖、MCP 连接与模型工具调用兼容性。", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
