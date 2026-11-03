"""P0 model protocol, scope boundaries, and optional real LangGraph/MCP tests."""

import asyncio
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import server
from backend.reading_agent.demo import DEMO_IDS, DEMO_TASK, DemoModelServer, create_demo_library
from backend.reading_agent.graph import ReadingAgent
from backend.reading_agent.model import ConfiguredModel
from backend.reading_agent.state import AgentError, AgentOptions


HAS_RUNTIME = (sys.version_info.releaselevel == "final" and importlib.util.find_spec("langgraph") is not None
               and importlib.util.find_spec("mcp") is not None)


def snapshot(directory):
    return {str(path.relative_to(directory)): (path.read_bytes(), path.stat().st_mtime_ns)
            for path in Path(directory).rglob("*") if path.is_file()}


class ReadingAgentContractTests(unittest.TestCase):
    def test_model_summarizes_visible_progress_without_extra_calls_or_private_reasoning(self):
        from types import SimpleNamespace
        from backend.reading_agent.mcp_client import MODEL_TOOLS

        class Model:
            calls = 0

            async def complete(self, _messages, _tools):
                self.calls += 1
                if self.calls == 1:
                    return {"role": "assistant", "content": "关注《Control study》的实验设置，核对评价指标和对照条件。",
                            "reasoning_content": "PRIVATE_PROGRESS_SENTINEL", "tool_calls": [{"id": "read", "type": "function",
                            "function": {"name": "get_paper_passages", "arguments": '{"hash":"p"}'}}]}
                return {"role": "assistant", "content": "Final report belongs in the answer, not the progress status."}

        model = Model()
        agent = ReadingAgent(AgentOptions("Compare", Path(".")), model)
        agent.catalog = [{"hash": "p", "title": "Control study"}]
        agent.client = SimpleNamespace(tools={key: {"type": "function", "function": {"name": key}} for key in MODEL_TOOLS})
        state = {"messages": [{"role": "system", "content": "Research"}], "model_calls": 0, "tool_calls": 0, "evidence": {}}
        update = asyncio.run(agent.model_step(state))
        progress = [event for event in agent.events if event["type"] == "analysis_progress"]
        self.assertEqual(len(progress), 1)
        self.assertIn("Control study", progress[0]["summary"])
        state.update(update)
        state["evidence"] = {"passage": {"hash": "p"}}
        asyncio.run(agent.model_step(state))
        started = [event for event in agent.events if event["type"] == "model_started"][-1]
        self.assertEqual(started["summary"], progress[0]["summary"])
        self.assertEqual(started["materialTitles"], ["Control study"])
        self.assertEqual(started["readPaperCount"], 1)
        self.assertEqual(model.calls, 2)
        self.assertEqual(sum(event["type"] == "analysis_progress" for event in agent.events), 1)
        self.assertNotIn("PRIVATE_PROGRESS_SENTINEL", json.dumps(agent.events))
        self.assertNotIn("PRIVATE_PROGRESS_SENTINEL", json.dumps(update))

    def test_options_and_scope_reject_invalid_or_outside_requests(self):
        for values in ({"task": " "}, {"max_rounds": 0}, {"max_tool_calls": True}, {"max_catalog": 201}):
            with self.subTest(values=values), self.assertRaises(ValueError):
                AgentOptions(**{"task": "Compare", "library_dir": Path("."), **values})
        agent = ReadingAgent(AgentOptions("Compare", Path(".")), None)
        agent.allowed = {"inside"}
        self.assertEqual(agent.scoped_arguments("search_paper_content", {"query": "x"})["hashes"], ["inside"])
        for name, args in (("delete_item", {"id": "inside"}), ("get_paper_passages", {"hash": "outside"}),
                           ("list_paper_summaries", {"hashes": ["outside"]}),
                           ("get_paper_passages", {"hash": "inside", "limit": 50})):
            with self.subTest(name=name), self.assertRaises(AgentError):
                agent.scoped_arguments(name, args)

    def test_configured_model_retains_native_calls_and_never_mutates_history(self):
        history = [{"role": "user", "content": "Compare"}]
        calls = [{"id": "c1", "type": "function", "function": {"name": "get_paper_passages", "arguments": '{"hash":"p"}'}}]
        with patch.object(server, "get_ai_config", return_value=("private-key", "model", "https://model.test", False)) as config, \
             patch.object(server, "get_module_custom_prompt", return_value="简洁"), \
             patch.object(server, "post_chat_completion", return_value={"choices": [{"message": {
                 "tool_calls": calls, "reasoning_content": "private reasoning",
             }}], "usage": {"total_tokens": 20, "untrusted": "not saved"}}) as post:
            model = ConfiguredModel()
            reply = asyncio.run(model.complete(history, [{"type": "function"}]))
        config.assert_called_once_with("readingAgent")
        self.assertEqual(reply["tool_calls"], calls)
        self.assertEqual(reply["reasoning_content"], "private reasoning")
        self.assertEqual(model.usage, [{"total_tokens": 20}])
        self.assertEqual(history, [{"role": "user", "content": "Compare"}])
        self.assertIn("tools", post.call_args.args[2])
        self.assertIn("简洁", post.call_args.args[2]["messages"][0]["content"])

    def test_malformed_native_calls_and_http_errors_are_actionable(self):
        model = ConfiguredModel(connection=("never-print-this", "model", "https://model.test/?key=never-print-this", False), custom_prompt="")
        for message in ({"tool_calls": [{"id": "c", "function": {}}]}, {"content": ["bad"]}):
            with self.subTest(message=message), patch.object(server, "post_chat_completion", return_value={"choices": [{"message": message}]}):
                with self.assertRaises(AgentError):
                    asyncio.run(model.complete([], [{"type": "function"}]))
        import urllib.error
        with patch.object(server, "post_chat_completion", side_effect=urllib.error.HTTPError(model.url, 400, "secret", {}, None)):
            with self.assertRaises(AgentError) as error:
                asyncio.run(model.complete([], []))
        self.assertIn("HTTP 400", str(error.exception))
        self.assertNotIn("never-print-this", str(error.exception))

    def test_final_report_requires_original_evidence_and_read_paper_citations(self):
        agent = ReadingAgent(AgentOptions("Compare", Path("."), strict_evidence=False), None)
        state = {"messages": [{"role": "assistant", "content": "Unsupported answer"}], "evidence": {}, "repairs": 0, "model_calls": 1}
        retried = agent.verify(state)
        self.assertTrue(retried["retry"])
        with self.assertRaises(AgentError):
            agent.verify({**state, "repairs": 1})
        state["evidence"] = {"passage": {"hash": "read"}}
        state["messages"] = [{"role": "assistant", "content": "Citation examples only: `[Read](hash:read)`"}]
        self.assertTrue(agent.verify(state)["retry"])
        state["messages"] = [{"role": "assistant", "content": "[Wrong](hash:unread)"}]
        self.assertTrue(agent.verify(state)["retry"])
        state["messages"] = [{"role": "assistant", "content": "[Read](hash:read) supports the comparison."}]
        self.assertIn("Read", agent.verify(state)["report"])

    def test_catalog_reference_is_valid_but_does_not_replace_original_evidence(self):
        agent = ReadingAgent(AgentOptions("Compare", Path(".")), None)
        agent.allowed = {"read", "catalog-only"}
        state = {"messages": [{"role": "assistant", "content":
                 "Finding [Read](hash:read) [C1].\nCandidate [Paper](hash:catalog-only) (original not checked)."}],
                 "evidence": {"passage": {"hash": "read"}}, "repairs": 0, "model_calls": 1,
                 "claims": {"C1": {"supports": [{"hash": "read"}]}}}
        self.assertIn("hash:catalog-only", agent.verify(state)["report"])
        state["messages"][0]["content"] = "Candidate [Paper](hash:catalog-only) [C1]."
        self.assertIn("已读取正文", agent.verify(state)["validation_error"])
        state["messages"][0]["content"] = "Finding [Read](hash:read) [C1]; [Missing](hash:unknown)."
        self.assertIn("Unknown library ID 'unknown'", agent.verify(state)["validation_error"])
        state["messages"][0]["content"] = "Finding [Read](hash:read) [C9]; [Paper](hash:catalog-only)."
        self.assertIn("未知证据编号", agent.verify(state)["validation_error"])
        state["messages"][0]["content"] = "Finding [Read](hash:read); [Paper](hash:catalog-only)."
        self.assertIn("未引用证据编号", agent.verify(state)["validation_error"])


@unittest.skipUnless(HAS_RUNTIME, "Install requirements-reading-agent.txt on stable Python 3.11/3.12")
class ReadingAgentIntegrationTests(unittest.TestCase):
    def test_real_graph_stdio_tools_and_http_model_leave_library_untouched(self):
        with tempfile.TemporaryDirectory() as temporary, DemoModelServer() as fixture:
            library = create_demo_library(Path(temporary) / "library")
            before = snapshot(library)
            model = ConfiguredModel(connection=("offline-key", "offline", fixture.url, False), custom_prompt="")
            result = asyncio.run(ReadingAgent(AgentOptions(DEMO_TASK, library), model).run())
            self.assertEqual(snapshot(library), before)

            self.assertEqual(result["readPaperIds"], sorted(DEMO_IDS))
            self.assertEqual(result["modelCalls"], 4)
            self.assertEqual(result["toolCalls"], 4)
            self.assertIn("1.0", result["report"])
            self.assertIn("hash:p0-flow-control", result["report"])
            self.assertTrue(all(item["source"] == "full_text" for item in result["evidence"]))
            self.assertTrue(all(item["pageNumber"] is None for item in result["evidence"]))
            self.assertNotIn("offline-key", json.dumps(result))
            self.assertNotIn("reasoning_content", json.dumps(result))
            names = [event["name"] for event in result["events"] if event["type"] == "tool_finished"]
            self.assertIn("search_paper_content", names)
            self.assertEqual(names.count("get_paper_passages"), 4)
            self.assertEqual(fixture.requests[1]["messages"][-1]["role"], "tool")
            self.assertTrue(all(request["stream"] for request in fixture.requests))
            self.assertGreater(len([event for event in result["events"] if event["type"] == "report_delta"]), 1)

    def test_mcp_server_itself_rejects_write_calls(self):
        from backend.reading_agent.mcp_client import ResearchMCPClient

        async def run(library):
            async with ResearchMCPClient(library) as client:
                self.assertNotIn("create_note", client.tools)
                result = await client.session.call_tool("create_note", {"title": "Must not be created"})
                self.assertTrue(result.isError)

        with tempfile.TemporaryDirectory() as temporary:
            library = create_demo_library(Path(temporary) / "library")
            before = snapshot(library)
            asyncio.run(run(library))
            self.assertEqual(snapshot(library), before)

    def test_catalog_budget_category_scope_and_no_unread_citations(self):
        class Model:
            calls = 0

            async def complete(self, _messages, _tools):
                self.calls += 1
                if self.calls == 1:
                    return {"role": "assistant", "content": "", "tool_calls": [{
                        "id": "read", "type": "function", "function": {"name": "get_paper_passages",
                        "arguments": json.dumps({"hash": DEMO_IDS[0]})},
                    }]}
                return {"role": "assistant", "content": f"[Flow](hash:{DEMO_IDS[0]}) provides synthetic evidence; other papers were not read."}

        with tempfile.TemporaryDirectory() as temporary:
            library = create_demo_library(Path(temporary) / "library")
            before = snapshot(library)
            result = asyncio.run(ReadingAgent(AgentOptions(DEMO_TASK, library, category_ids=("Demo",), max_catalog=1, strict_evidence=False), Model()).run())
            self.assertTrue(result["catalogTruncated"])
            self.assertEqual(result["scopePaperCount"], 2)
            self.assertEqual(result["catalogPaperCount"], 1)
            self.assertEqual(result["readPaperIds"], [DEMO_IDS[0]])
            self.assertEqual(snapshot(library), before)

    def test_empty_manifest_does_not_reconcile_storage_or_call_model(self):
        class Model:
            async def complete(self, *_args):
                raise AssertionError("Empty library must not spend a model call")

        with tempfile.TemporaryDirectory() as temporary:
            library = create_demo_library(Path(temporary) / "library")
            manifest = library / "library_db.json"
            db = json.loads(manifest.read_text(encoding="utf-8"))
            db["papers"] = {}
            manifest.write_text(json.dumps(db), encoding="utf-8")
            before = snapshot(library)
            result = asyncio.run(ReadingAgent(AgentOptions(DEMO_TASK, library), Model()).run())
            self.assertEqual(result["modelCalls"], 0)
            self.assertEqual(result["readPaperIds"], [])
            self.assertEqual(snapshot(library), before)

    def test_unsupported_model_fails_with_original_actionable_error(self):
        class Model:
            async def complete(self, *_args):
                return {"role": "assistant", "content": "Guessing without tool calls."}

        with tempfile.TemporaryDirectory() as temporary:
            library = create_demo_library(Path(temporary) / "library")
            with self.assertRaisesRegex(AgentError, "报告校验失败"):
                asyncio.run(ReadingAgent(AgentOptions(DEMO_TASK, library), Model()).run())

    def test_total_timeout_closes_mcp_without_losing_timeout_reason(self):
        class Model:
            async def complete(self, *_args):
                await asyncio.sleep(10)

        with tempfile.TemporaryDirectory() as temporary:
            library = create_demo_library(Path(temporary) / "library")
            with self.assertRaisesRegex(AgentError, "超时"):
                asyncio.run(ReadingAgent(AgentOptions(DEMO_TASK, library, total_timeout=1), Model()).run())
