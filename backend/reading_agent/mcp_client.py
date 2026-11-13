"""Official MCP SDK transport to the existing, read-only stdio server."""

from contextlib import AsyncExitStack
from datetime import timedelta
import json
import os
from pathlib import Path
import sys

from .state import AgentCancelled, AgentError


PROJECT_ROOT = Path(__file__).resolve().parents[2]
MODEL_TOOLS = frozenset({"list_paper_summaries", "get_paper_summary", "search_paper_content", "get_paper_passages",
                         "get_paper_highlights", "get_paper_annotations"})


class ResearchMCPClient:
    def __init__(self, library_dir, timeout=60):
        self.library_dir = Path(library_dir).resolve()
        self.timeout = timeout
        self.tools = {}
        self.session = None

    async def __aenter__(self):
        try:
            from mcp import ClientSession, StdioServerParameters
            from mcp.client.stdio import stdio_client
        except ImportError as exc:
            raise AgentError("缺少 Agent 依赖，请安装 requirements-reading-agent.txt。") from exc
        if not (self.library_dir / "library_db.json").is_file():
            raise AgentError("文献库不存在或尚未初始化，请指定已有文献库目录。")
        self.stack = AsyncExitStack()
        await self.stack.__aenter__()
        env = {**os.environ, "PAPER_LIBRARY_DIR": str(self.library_dir),
               "PAPER_LANTERN_PROJECT_DIR": str(PROJECT_ROOT), "PAPER_LANTERN_MCP_READ_ONLY": "1",
               "PYTHONIOENCODING": "utf-8"}
        env.pop("PAPER_LANTERN_MCP_DEBUG", None)
        try:
            streams = await self.stack.enter_async_context(stdio_client(StdioServerParameters(
                command=sys.executable,
                args=["-X", "utf8", str(PROJECT_ROOT / "plugins/paper-lantern-research-mcp/scripts/paper_lantern_research_mcp.py")],
                cwd=str(PROJECT_ROOT), env=env,
            )))
            self.session = await self.stack.enter_async_context(ClientSession(
                streams[0], streams[1], read_timeout_seconds=timedelta(seconds=self.timeout),
            ))
            await self.session.initialize()
            response = await self.session.list_tools()
            self.tools = {tool.name: {"type": "function", "function": {
                "name": tool.name, "description": tool.description or "", "parameters": tool.inputSchema,
            }} for tool in response.tools}
            missing = (MODEL_TOOLS | {"library_overview", "list_papers"}) - self.tools.keys()
            if missing:
                raise AgentError("MCP 缺少必需工具：" + ", ".join(sorted(missing)))
            return self
        except BaseException:
            await self.stack.aclose()
            raise

    async def __aexit__(self, *exc):
        # SDK task groups otherwise wrap the caller's actionable AgentError in
        # nested ExceptionGroups. Close the transport, preserve the original.
        await self.stack.aclose()
        return False

    async def call(self, name, arguments):
        if name not in self.tools:
            raise AgentError(f"MCP 工具不可用：{name}")
        try:
            result = await self.session.call_tool(name, arguments)
        except AgentCancelled:
            raise
        except Exception as exc:
            # Transport/protocol failures are tool observations too. The agent
            # can adjust its request or try another tool on the next turn.
            raise AgentError(str(exc)[:2000] or type(exc).__name__) from exc
        blocks = [block.text for block in result.content if block.type == "text"]
        if result.isError:
            raise AgentError("; ".join(blocks)[:2000] or "MCP 工具执行失败。")
        try:
            value = json.loads("\n".join(blocks))
        except (ValueError, TypeError) as exc:
            raise AgentError("MCP 工具未返回有效 JSON 对象。") from exc
        if not isinstance(value, dict):
            raise AgentError("MCP 工具未返回 JSON 对象。")
        return value
