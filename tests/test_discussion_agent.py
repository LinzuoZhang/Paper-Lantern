"""Discussion routing, native tool use, context, bounds and read-only MCP."""

import copy
import importlib.util
import io
import json
import threading
import urllib.error
import urllib.request
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import AsyncMock, Mock, patch

import server
from backend import cloud_sync
from backend.discussion_agent import MAX_ROUNDS, TOOL_NAMES, answer_with_tools, bounded_result
from backend.discussion_agent_bridge import run_discussion_agent
from backend.reading_agent.capabilities import mcp_module
from backend.reading_agent.state import AgentError
from test_categories import LibraryFixture


def tool_call(name, args, call_id="call-1"):
    return {"role": "assistant", "content": "临时分析不应显示", "tool_calls": [{
        "id": call_id, "type": "function", "function": {
            "name": name, "arguments": json.dumps(args, ensure_ascii=False)}}]}


class ToolLoopTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        definitions = mcp_module().TOOLS
        self.mcp = Mock()
        self.mcp.tools = {name: {"type": "function", "function": {
            "name": name, "description": desc, "parameters": schema}}
            for name, (desc, schema, _) in definitions.items()}
        self.mcp.call = AsyncMock(return_value={"passages": [{"text": "论文中的原文证据"}]})
        self.events = []

    async def answer(self, replies):
        model = type("Model", (), {"complete": AsyncMock(side_effect=replies)})()
        await answer_with_tools([{"role": "user", "content": "当前论文问题"}], model, self.mcp, self.events.append)
        return model

    async def test_reads_whole_library_and_streams_only_answer(self):
        model = await self.answer([tool_call("search_paper_content", {"query": "机器人", "limit": 100}),
                                   {"content": "根据原文的最终回答"}])
        self.mcp.call.assert_awaited_once_with("search_paper_content", {"query": "机器人", "limit": 10})
        self.assertIn("论文中的原文证据", str(model.complete.call_args.args[0]))
        self.assertEqual("".join(e.get("delta", "") for e in self.events), "根据原文的最终回答")
        self.assertTrue(any("MCP" in e.get("status", "") for e in self.events))
        offered = {t["function"]["name"] for t in model.complete.call_args.args[1]}
        self.assertEqual(offered, TOOL_NAMES)

    async def test_direct_answer_does_not_read_library(self):
        await self.answer([{"content": "依据当前上下文回答"}])
        self.mcp.call.assert_not_called()

    async def test_rejects_writes_bad_arguments_and_unbounded_catalogs(self):
        for name, args in [("write_note", {"id": "note", "content": "overwrite"}),
                           ("get_paper_summary", []), ("list_paper_summaries", {}),
                           ("search_library", {"limit": "ten"})]:
            with self.subTest(name=name):
                model = await self.answer([tool_call(name, args), {"content": "证据不足"}])
                self.mcp.call.assert_not_called()
                observation = model.complete.call_args.args[0][-1]
                self.assertIn("error", json.loads(observation["content"]))

    async def test_mcp_failure_becomes_observation_for_recovery(self):
        self.mcp.call.side_effect = AgentError("原文不可读")
        model = await self.answer([tool_call("get_paper_summary", {"hash": "a"}), {"content": "原文不可读"}])
        self.assertIn("原文不可读", model.complete.call_args.args[0][-1]["content"])

    async def test_budget_reserves_final_answer_without_tools(self):
        model = await self.answer([tool_call("search_library", {"query": "robot"}, str(i)) for i in range(MAX_ROUNDS)]
                                  + [{"content": "已读取资料范围内的结论"}])
        self.assertEqual(model.complete.call_args.args[1], [])
        self.assertIn("检索预算已用完", model.complete.call_args.args[0][-1]["content"])

    def test_oversized_results_explicitly_mark_incomplete_evidence(self):
        value = json.loads(bounded_result({"text": "文" * 30_000}))
        self.assertTrue(value["truncated"])
        self.assertLess(len(value["excerpt"]), 30_000)


class DiscussionRoutingTests(unittest.TestCase):
    def test_closing_stream_terminates_worker_without_credentials_in_arguments(self):
        process = Mock(stdin=io.StringIO(), stdout=io.StringIO('{"done": true}\n'))
        process.poll.return_value = None
        with patch("backend.discussion_agent_bridge.subprocess.Popen", return_value=process) as start:
            events = run_discussion_agent([{"role": "user", "content": "private document"}],
                                         ("private-key", "model", "url", False), "", server.LIBRARY_DIR)
            self.assertIn("status", next(events))
            events.close()
        process.terminate.assert_called_once()
        self.assertNotIn("private-key", str(start.call_args))
        self.assertNotIn("private document", str(start.call_args))

    def test_http_routes_agent_stream_and_json_and_validates_mode(self):
        class Handler(server.PaperReaderHandler):
            def log_message(self, *_args):
                pass

        httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

        def request(payload):
            req = urllib.request.Request(f"http://127.0.0.1:{httpd.server_port}/api/discuss",
                data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
            return opener.open(req, timeout=5)

        try:
            with patch("server.get_ai_config", return_value=("key", "discuss-model", "url", True)), \
                 patch("backend.discussion_agent_bridge.run_discussion_agent",
                       side_effect=lambda *args: iter([{"status": "MCP 检索中"}, {"delta": "回答"}])) as run:
                for context_type in ("paper", "note"):
                    for stream in (False, True):
                        with request({"mode": "agent", "question": "问题", "paperText": "",
                                      "contextType": context_type, "paperId": "current", "stream": stream}) as response:
                            body = response.read().decode()
                            self.assertIn("回答", body)
                            self.assertEqual("text/event-stream" in response.headers["Content-Type"], stream)
                            if stream:
                                self.assertIn("[DONE]", body)
                self.assertEqual(run.call_count, 4)
                for payload in ({"mode": "unknown", "question": "问题"},
                                {"mode": "agent", "question": ""},
                                {"mode": "agent", "question": "问" * 8001},
                                {"mode": "normal", "question": "问题", "paperText": ""}):
                    with self.assertRaises(urllib.error.HTTPError) as error:
                        request(payload)
                    self.assertEqual(error.exception.code, 400)
                self.assertEqual(run.call_count, 4)
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join(timeout=5)

    def test_agent_preserves_context_and_uses_discussion_model_for_both_transports(self):
        for context_type in ("paper", "note"):
            for stream in (False, True):
                with self.subTest(context_type=context_type, stream=stream), \
                     patch("backend.discussion_agent_bridge.run_discussion_agent", return_value=iter([{"delta": "回答"}])) as run, \
                     patch("server.get_module_custom_prompt", return_value="讨论自定义提示"):
                    answer = server.discuss_paper("key", "discussion-model", "http://model", "当前正文", "追问",
                        summary={"title": "当前资料"}, history=[{"role": "user", "content": "之前的问题"}],
                        selection_reference={"text": "引用选区", "before": "前文", "page": 3},
                        context_type=context_type, paper_id="a" if context_type == "paper" else "",
                        item_id="a" if context_type == "paper" else "note-a", paper_ids=["b"],
                        mode="agent", stream=stream, think_mode=True)
                    self.assertEqual("".join(e.get("delta", "") for e in answer) if stream else answer, "回答")
                    messages, connection, prompt, library = run.call_args.args
                    context = str(messages)
                    for text in ("当前正文", "之前的问题", "引用选区", "前文", "追问", "priorityPaperIds"):
                        self.assertIn(text, context)
                    self.assertEqual(connection, ("key", "discussion-model", "http://model", True))
                    self.assertEqual(prompt, "讨论自定义提示")
                    self.assertEqual(library, server.LIBRARY_DIR)

    def test_agent_long_context_marks_truncation_and_keeps_selection(self):
        with patch("backend.discussion_agent_bridge.run_discussion_agent", return_value=iter([])) as run:
            server.discuss_paper("key", "model", "url", "a" * 80_000, "问题",
                selection_reference={"text": "末尾的选区"}, mode="agent", think_mode=False)
        messages = run.call_args.args[0]
        self.assertIn("末尾的选区", str(messages))
        self.assertIn('"contextTruncated": true', str(messages))
        self.assertNotIn("a" * 40_001, str(messages))

    def test_normal_discussion_never_starts_mcp(self):
        with patch("backend.discussion_agent_bridge.run_discussion_agent") as run, \
             patch("server.post_chat_completion", return_value={"choices": [{"message": {"content": "普通回答"}}]}):
            self.assertEqual(server.discuss_paper("key", "model", "url", "正文", "问题"), "普通回答")
        run.assert_not_called()

    def test_mode_survives_save_sync_and_affects_hash(self):
        payload = {"threads": [{"id": "thread", "title": "讨论", "mode": "agent",
                               "messages": [{"role": "user", "content": "问题"}]}]}
        normal = copy.deepcopy(payload)
        normal["threads"][0].pop("mode")
        for normalize in (server.normalize_discussion_payload, cloud_sync.normalize_discussion_payload):
            self.assertEqual(normalize(payload)["threads"][0]["mode"], "agent")
            self.assertNotEqual(normalize(payload)["threads"][0]["hash"], normalize(normal)["threads"][0]["hash"])
        self.assertEqual(cloud_sync.merge_discussion_payloads({}, payload)["threads"][0]["mode"], "agent")


@unittest.skipUnless(importlib.util.find_spec("mcp"), "Optional Agent runtime is not installed")
class MCPIntegrationTests(LibraryFixture):
    def test_discussion_worker_uses_real_read_only_mcp_and_native_model_tools(self):
        paper = self.paper()
        folder = server.paper_dir_from_record(server.load_library_db()["papers"][paper["id"]])
        (folder / "extracted_text.txt").write_text("Synthetic robot evidence for this discussion.", encoding="utf-8")
        before = {p.relative_to(self.library): p.read_bytes() for p in self.library.rglob("*") if p.is_file()}
        requests = []

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_POST(self):
                request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                requests.append(request)
                if len(requests) == 1:
                    message = tool_call("search_library", {"query": paper["id"]})
                elif len(requests) == 2:
                    message = tool_call("get_paper_passages", {"hash": paper["id"]}, "call-2")
                else:
                    message = {"role": "assistant", "content": "Synthetic robot evidence 支持这个回答。"}
                data = json.dumps({"choices": [{"message": message}]}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        try:
            events = list(run_discussion_agent([{"role": "user", "content": "读取合成论文并回答"}],
                ("synthetic-key", "synthetic-model", f"http://127.0.0.1:{httpd.server_port}/v1/chat/completions", False),
                "", self.library))
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join(timeout=5)
        self.assertEqual(len(requests), 3)
        self.assertIn(paper["id"], str(requests[1]["messages"][-1]))
        self.assertIn("Synthetic robot evidence", str(requests[2]["messages"][-1]))
        self.assertIn("支持这个回答", "".join(e.get("delta", "") for e in events))
        self.assertEqual(before, {p.relative_to(self.library): p.read_bytes() for p in self.library.rglob("*") if p.is_file()})
