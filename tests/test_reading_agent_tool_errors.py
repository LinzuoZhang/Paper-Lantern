"""Tool failures are observations; cancellation still stops agent execution."""

import asyncio
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from backend.reading_agent.demo import DEMO_IDS, create_demo_library
from backend.reading_agent.graph import ReadingAgent
from backend.reading_agent.library_agent import LibraryAgent
from backend.reading_agent.mcp_client import MODEL_TOOLS, ResearchMCPClient
from backend.reading_agent.state import AgentCancelled, AgentError, AgentOptions
from backend.reading_agent.store import JobStore
from backend.reading_agent.worker import execute_job
from test_categories import LibraryFixture
from test_reading_agent import HAS_RUNTIME


def reply(*calls):
    return {"role": "assistant", "content": "", "tool_calls": [
        {"id": str(index), "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}
        for index, (name, args) in enumerate(calls)]}


class ToolErrorTests(unittest.TestCase):
    def test_mcp_protocol_errors_keep_the_original_message(self):
        client = ResearchMCPClient(Path("."))
        client.tools = {"get_paper_passages": {}}
        for error in (OSError("Connection closed"), RuntimeError("Protocol failure"), TimeoutError()):
            with self.subTest(error=type(error).__name__):
                client.session = SimpleNamespace(call_tool=AsyncMock(side_effect=error))
                with self.assertRaises(AgentError) as caught:
                    asyncio.run(client.call("get_paper_passages", {}))
                self.assertEqual(str(caught.exception), str(error) or type(error).__name__)

    def test_research_tool_failure_is_returned_and_the_next_call_still_runs(self):
        for error in (FileNotFoundError("Article directory not found: broken"),
                      RuntimeError("Unexpected tool failure"), KeyError("malformed result")):
            with self.subTest(error=type(error).__name__):
                agent = ReadingAgent(AgentOptions("Compare", Path(".")), None)
                agent.allowed = {"broken", "good"}
                agent.catalog = [{"hash": "good", "title": "Available paper"}]
                passage = {"hash": "good", "source": "full_text", "passageId": "p1", "text": "Original evidence"}
                agent.client = SimpleNamespace(call=AsyncMock(side_effect=[error, {"passages": [passage]}]),
                    tools={name: {"type": "function", "function": {"name": name}} for name in MODEL_TOOLS})
                state = {"messages": [{"role": "system", "content": "Read originals"}, reply(
                    ("get_paper_passages", {"hash": "broken"}), ("get_paper_passages", {"hash": "good"}))],
                    "evidence": {}, "tool_calls": 0, "model_calls": 0}
                state.update(asyncio.run(agent.tools_step(state)))
                observation = json.loads(state["messages"][-2]["content"])
                self.assertTrue(observation["isError"])
                self.assertEqual(observation["message"], str(error))
                self.assertEqual(state["evidence"], {"p1": passage})
                self.assertEqual(state["tool_calls"], 2)
                agent.model = SimpleNamespace(complete=AsyncMock(return_value={"role": "assistant", "content": "Report"}))
                asyncio.run(agent.model_step(state))
                outgoing = agent.model.complete.call_args.args[0]
                self.assertEqual(json.loads(outgoing[-2]["content"]), observation)

    def test_catalog_errors_reach_the_model_and_keep_the_requested_scope(self):
        agent = ReadingAgent(AgentOptions("Compare", Path("."), hashes=("good", "broken")), None)

        async def call(name, args):
            if name in {"list_papers", "list_paper_summaries"}:
                raise AgentError("Article directory not found: broken")
            self.assertEqual(name, "search_library")
            records = [{"id": key, "title": key, "categoryIds": []} for key in ("good", "broken", "outside")]
            return {"matches": records, "nextOffset": None}

        agent.client = SimpleNamespace(call=call)
        state = asyncio.run(agent.prepare({}))
        self.assertEqual(agent.allowed, {"good", "broken"})
        self.assertEqual({paper["hash"] for paper in agent.catalog}, {"good", "broken"})
        self.assertEqual(len(state["catalog_errors"]), 2)
        self.assertIn("Article directory not found: broken", state["messages"][-1]["content"])
        self.assertEqual(state["evidence"], {})

    def library_agent(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        jobs = JobStore(Path(temporary.name) / "jobs.sqlite3")
        return LibraryAgent(AgentOptions("Organize", Path(".")), None, jobs, "job", "turn", jobs.path.with_name("checkpoint.sqlite3"))

    def test_general_tool_failure_is_an_observation_and_does_not_skip_other_calls(self):
        agent = self.library_agent()
        agent.client = SimpleNamespace(call=AsyncMock(side_effect=[RuntimeError("Tool failed"), {"item": {"id": "good"}}]))
        state = {"facts": [], "selected": ["get_item"], "tool_calls": 0,
                 "reply": reply(("get_item", {"id": "broken"}), ("get_item", {"id": "good"}))}
        update = asyncio.run(agent.tools(state))
        self.assertEqual(update["facts"][0]["error"], "Tool failed")
        self.assertEqual(update["facts"][1]["result"]["item"]["id"], "good")

    def test_failed_research_returns_to_the_parent_agent(self):
        agent = self.library_agent()
        state = {"research_task": "Compare", "facts": []}
        with patch.object(ReadingAgent, "run", AsyncMock(side_effect=AgentError("Article directory not found: broken"))):
            update = asyncio.run(agent.research(state))
        self.assertEqual(update["research_task"], "")
        self.assertNotIn("output", update)
        self.assertEqual(update["facts"][-1]["tool"], "research_library")
        self.assertIn("Article directory not found", update["facts"][-1]["error"])

    def test_corrected_research_uses_a_new_checkpoint_after_failure(self):
        parent = self.library_agent()
        state = {"research_task": "Compare", "facts": []}
        threads = []

        async def run(agent):
            threads.append(agent.thread_id)
            if len(threads) == 1:
                raise AgentError("Missing article")
            return {"report": "Verified report"}

        with patch.object(ReadingAgent, "run", run):
            state.update(asyncio.run(parent.research(state)))
            state["research_task"] = "Compare available articles"
            update = asyncio.run(parent.research(state))
        self.assertEqual(update["output"]["report"], "Verified report")
        self.assertNotEqual(threads[0], threads[1])

    def test_cancellation_is_never_converted_to_a_tool_observation(self):
        for error in (AgentCancelled("Stopped"), asyncio.CancelledError()):
            with self.subTest(error=type(error).__name__):
                agent = ReadingAgent(AgentOptions("Compare", Path(".")), None)
                agent.allowed = {"p"}
                agent.client = SimpleNamespace(call=AsyncMock(side_effect=error))
                state = {"messages": [reply(("get_paper_passages", {"hash": "p"}))], "evidence": {}, "tool_calls": 0}
                with self.assertRaises(type(error)):
                    asyncio.run(agent.tools_step(state))
                with self.assertRaises(type(error)):
                    asyncio.run(agent.prepare({}))
                parent = self.library_agent()
                parent.client = agent.client
                with self.assertRaises(type(error)):
                    asyncio.run(parent.tools({"facts": [], "selected": ["get_item"], "tool_calls": 0,
                                             "reply": reply(("get_item", {"id": "p"}))}))
                with patch.object(ReadingAgent, "run", AsyncMock(side_effect=error)), self.assertRaises(type(error)):
                    asyncio.run(parent.research({"research_task": "Compare", "facts": []}))


@unittest.skipUnless(HAS_RUNTIME, "Install requirements-reading-agent.txt on stable Python 3.11/3.12")
class ToolErrorGraphTests(LibraryFixture):
    def test_missing_article_directory_does_not_abort_research_on_other_papers(self):
        library = create_demo_library(self.root / "demo")
        manifest = library / "library_db.json"
        db = json.loads(manifest.read_text(encoding="utf-8"))
        db["papers"]["broken"] = {**db["papers"][DEMO_IDS[0]], "id": "broken", "folder": "papers/missing"}
        manifest.write_text(json.dumps(db), encoding="utf-8")
        case = self

        class Model:
            calls = 0

            async def complete(self, messages, tools):
                self.calls += 1
                if self.calls == 1:
                    case.assertIn("Article directory not found: broken", messages[-1]["content"])
                    return reply(("get_paper_passages", {"hash": "broken"}),
                                 ("get_paper_passages", {"hash": DEMO_IDS[0]}))
                case.assertTrue(json.loads(messages[-2]["content"])["isError"])
                return {"role": "assistant", "content": f"[Flow](hash:{DEMO_IDS[0]}) contains synthetic evidence. Broken paper was unavailable."}

        result = asyncio.run(ReadingAgent(AgentOptions("Compare", library, strict_evidence=False), Model()).run())
        self.assertEqual(result["readPaperIds"], [DEMO_IDS[0]])
        self.assertIn("Broken paper was unavailable", result["report"])

    def test_worker_continues_the_parent_graph_after_research_fails(self):
        store = JobStore(self.root / "jobs.sqlite3")
        job, _ = store.create({"task": "Compare", "agentVersion": "general-v1"}, self.library)
        case = self

        class Model:
            calls = 0

            async def complete(self, messages, tools):
                self.calls += 1
                if self.calls == 1:
                    return reply(("research_library", {"task": "Compare"}))
                context = json.loads(messages[-1]["content"])
                case.assertIn("Article directory not found", context["observations"][-1]["error"])
                return {"role": "assistant", "content": "缺少文章目录，无法完成原文核验。"}

        with patch.object(ReadingAgent, "run", AsyncMock(side_effect=AgentError("Article directory not found: missing"))):
            asyncio.run(execute_job(store, job["id"], 1, Model))
        finished = store.get(job["id"])
        self.assertEqual(finished["status"], "completed", finished["error"])
        self.assertIn("缺少文章目录", finished["result"]["report"])
