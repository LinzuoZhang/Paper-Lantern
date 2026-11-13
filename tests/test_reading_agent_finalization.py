"""Evidence registration remains possible after research budgets are exhausted."""

import asyncio
import json
from pathlib import Path
import tempfile
import unittest

from backend.reading_agent.demo import DEMO_IDS, DEMO_TASK, create_demo_library
from backend.reading_agent.graph import FINALIZATION_CALLS, ReadingAgent
from backend.reading_agent.state import AgentError, AgentOptions, ResearchState
from test_reading_agent import HAS_RUNTIME


def tool(name, arguments, call_id="call"):
    return {"role": "assistant", "content": "", "tool_calls": [{"id": call_id, "type": "function",
            "function": {"name": name, "arguments": json.dumps(arguments)}}]}


def read_reply():
    return tool("get_paper_passages", {"hash": DEMO_IDS[0], "source": "full_text"})


def context_from(messages):
    return next(json.loads(message["content"].split("\n", 1)[1]) for message in messages
                if message.get("content", "").startswith("任务资料与已查阅证据"))


def claim_reply(passage, quote=None):
    return tool("record_claim", {"statement": "Synthetic toy runtime evidence", "kind": "finding",
                "supports": [{"passageId": passage["passageId"], "quote": quote or passage["text"]}]}, "claim")


def report(text=None):
    return {"role": "assistant", "content": text or f"[Flow](hash:{DEMO_IDS[0]}) reports a synthetic toy result [C1]."}


@unittest.skipUnless(HAS_RUNTIME, "Install Agent runtime")
class FinalizationTests(unittest.TestCase):
    def test_round_or_tool_budget_leaves_room_for_claims_and_multiple_report_repairs(self):
        for budget in ({"max_rounds": 1}, {"max_tool_calls": 1}):
            with self.subTest(budget=budget), tempfile.TemporaryDirectory() as directory:
                library = create_demo_library(Path(directory) / "library")
                case = self

                class Model:
                    calls = 0

                    async def complete(self, messages, tools):
                        self.calls += 1
                        if self.calls == 1:
                            return read_reply()
                        case.assertEqual([t["function"]["name"] for t in tools], ["record_claim", "get_read_evidence"])
                        if self.calls == 2:
                            context = context_from(messages)
                            case.assertIn(DEMO_IDS[0], context["paperLinks"])
                            return claim_reply(context["evidence"][0])
                        if self.calls == 3:
                            return report("[Shortened ID](hash:p0-flow) [C1]")
                        if self.calls == 4:
                            return report(f"[Flow](hash:{DEMO_IDS[0]}) has a result without a claim tag.")
                        return report()

                result = asyncio.run(ReadingAgent(AgentOptions(DEMO_TASK, library, **budget), Model()).run())
                self.assertEqual(result["modelCalls"], 5)
                self.assertEqual(result["finalizationCalls"], 4)
                self.assertEqual(result["finalizationToolCalls"], 1)
                self.assertEqual(result["verification"]["claimCount"], 1)
                self.assertEqual(sum(event["type"] == "report_retry" for event in result["events"]), 2)

    def test_finalization_rejects_further_search_and_invented_quotes(self):
        with tempfile.TemporaryDirectory() as directory:
            library = create_demo_library(Path(directory) / "library")

            class Model:
                calls = 0

                async def complete(self, messages, tools):
                    self.calls += 1
                    if self.calls == 1:
                        return read_reply()
                    passage = context_from(messages)["evidence"][0]
                    if self.calls == 2:
                        return tool("search_paper_content", {"query": "control"})
                    if self.calls == 3:
                        return claim_reply(passage, "Invented precision superiority over every other controller.")
                    if self.calls == 4:
                        return claim_reply(passage)
                    return report()

            result = asyncio.run(ReadingAgent(AgentOptions(DEMO_TASK, library, max_rounds=1), Model()).run())
            self.assertEqual(result["finalizationToolCalls"], 3)
            self.assertEqual(len(result["claims"]), 1)
            self.assertFalse(any(event.get("name") == "search_paper_content" and event["type"] == "tool_started"
                                 for event in result["events"]))
            self.assertTrue(result["verification"]["checks"]["sourcesRevalidated"])

    def test_finalization_budget_is_bounded_and_does_not_reset_on_resume(self):
        with tempfile.TemporaryDirectory() as directory:
            library = create_demo_library(Path(directory) / "library")
            checkpoint = Path(directory) / "checkpoints.sqlite3"

            class Model:
                calls = 0

                async def complete(self, _messages, _tools):
                    self.calls += 1
                    return read_reply() if self.calls == 1 else report(f"[Flow](hash:{DEMO_IDS[0]}) without any registered claim.")

            model = Model()
            options = AgentOptions(DEMO_TASK, library, max_rounds=1)
            with self.assertRaisesRegex(AgentError, "报告校验失败"):
                asyncio.run(ReadingAgent(options, model, checkpoint_path=checkpoint, thread_id="bounded").run())
            self.assertEqual(model.calls, 1 + FINALIZATION_CALLS)
            before = model.calls
            with self.assertRaisesRegex(AgentError, "报告校验失败"):
                asyncio.run(ReadingAgent(options, model, checkpoint_path=checkpoint, thread_id="bounded").run())
            self.assertEqual(model.calls, before, "Resume must not reset exhausted settlement budgets")

    def test_failed_catalog_link_checkpoint_revalidates_without_new_model_calls(self):
        with tempfile.TemporaryDirectory() as directory:
            library = create_demo_library(Path(directory) / "library")
            checkpoint = Path(directory) / "checkpoints.sqlite3"

            class OldVerifier(ReadingAgent):
                def verify(self, state):
                    allowed = self.allowed
                    try:
                        # Reproduce the old bug: only read papers count as existing.
                        self.allowed = {item["hash"] for item in state["evidence"].values()}
                        return super().verify(state)
                    finally:
                        self.allowed = allowed

            class Model:
                calls = 0

                async def complete(self, messages, _tools):
                    self.calls += 1
                    if self.calls == 1:
                        return read_reply()
                    if self.calls == 2:
                        return claim_reply(context_from(messages)["evidence"][0])
                    return report(f"# Comparison\nFinding [Flow](hash:{DEMO_IDS[0]}) [C1].\n"
                                  f"Candidate [Baseline](hash:{DEMO_IDS[1]}) (original not checked).")

            model = Model()
            options = AgentOptions(DEMO_TASK, library, max_rounds=1)
            with self.assertRaisesRegex(AgentError, "Unknown library ID"):
                asyncio.run(OldVerifier(options, model, checkpoint_path=checkpoint, thread_id="catalog-link").run())
            calls = model.calls
            result = asyncio.run(ReadingAgent(options, model, checkpoint_path=checkpoint, thread_id="catalog-link").run())
            self.assertEqual(model.calls, calls, "Fixing validation should reuse the final report, even with no model budget left")
            self.assertEqual(result["readPaperIds"], [DEMO_IDS[0]])
            self.assertIn(f"[C1](hash:{DEMO_IDS[0]})", result["report"])
            self.assertIn(f"[Baseline](hash:{DEMO_IDS[1]})", result["report"])
            self.assertTrue(result["verification"]["checks"]["sourcesRevalidated"])

    def test_legacy_failed_verifier_can_continue_from_read_evidence_without_research(self):
        from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
        from langgraph.graph import END, START, StateGraph
        from backend.reading_agent.mcp_client import ResearchMCPClient

        with tempfile.TemporaryDirectory() as directory:
            library = create_demo_library(Path(directory) / "library")
            checkpoint = Path(directory) / "checkpoints.sqlite3"
            config = {"configurable": {"thread_id": "legacy"}}

            async def seed_legacy_checkpoint():
                async with ResearchMCPClient(library) as client:
                    data = await client.call("get_paper_passages", {"hash": DEMO_IDS[0]})
                passage = {"hash": DEMO_IDS[0], **data["passages"][0]}
                old = {"messages": [{"role": "system", "content": "Use verified evidence"}, report("Old invalid report")],
                       "model_calls": 14, "tool_calls": 28, "repairs": 1, "evidence": {passage["passageId"]: passage},
                       "claims": {}, "report": "", "retry": False, "catalog": [{"hash": DEMO_IDS[0], "title": "Flow"}],
                       "scope_count": 1, "allowed_ids": [DEMO_IDS[0]]}

                def fail(_state):
                    raise AgentError("Legacy failed verifier")

                graph = StateGraph(ResearchState)
                graph.add_node("agent", lambda _state: old)
                graph.add_node("verify", fail)
                graph.add_edge(START, "agent")
                graph.add_edge("agent", "verify")
                graph.add_edge("verify", END)
                async with AsyncSqliteSaver.from_conn_string(str(checkpoint)) as saver:
                    with self.assertRaises(AgentError):
                        await graph.compile(checkpointer=saver).ainvoke({}, config)

            asyncio.run(seed_legacy_checkpoint())
            case = self

            class Model:
                calls = 0

                async def complete(self, messages, tools):
                    self.calls += 1
                    case.assertEqual([t["function"]["name"] for t in tools], ["record_claim", "get_read_evidence"])
                    return claim_reply(context_from(messages)["evidence"][0]) if self.calls == 1 else report()

            model = Model()
            options = AgentOptions(DEMO_TASK, library)
            result = asyncio.run(ReadingAgent(options, model, checkpoint_path=checkpoint, thread_id="legacy").run())
            self.assertEqual(result["modelCalls"], 16)
            self.assertEqual(result["toolCalls"], 29)
            self.assertEqual(result["finalizationCalls"], 2)
            self.assertTrue(any(event["type"] == "finalization_recovered" for event in result["events"]))
            asyncio.run(ReadingAgent(options, model, checkpoint_path=checkpoint, thread_id="legacy").run())
            self.assertEqual(model.calls, 2)
