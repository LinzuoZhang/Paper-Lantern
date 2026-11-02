"""Context pressure must bound model inputs without losing original evidence."""

import asyncio
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest

from backend.reading_agent.context import bounded_context, json_size, recall_evidence
from backend.reading_agent.demo import DEMO_IDS, create_demo_library
from backend.reading_agent.graph import ReadingAgent
from backend.reading_agent.state import AgentError, AgentOptions
from test_reading_agent import HAS_RUNTIME


def context_from(messages):
    return next(json.loads(message["content"].split("\n", 1)[1]) for message in messages
                if message.get("content", "").startswith("任务资料与已查阅证据"))


class ContextTests(unittest.TestCase):
    def test_bounded_view_preserves_original_archive_and_recent_recalled_passages(self):
        evidence = {f"p{i}": {"passageId": f"p{i}", "hash": f"paper-{i % 8}", "source": "full_text",
                    "text": f"Exact original {i}: control experiments. " + "x" * 1160,
                    "sourceVersion": "version", "startChar": i * 1040, "categoryNames": ["unused" * 500]}
                    for i in range(80)}
        before = deepcopy(evidence)
        catalog = [{"hash": f"paper-{i}", "title": f"Paper {i}", "abstract": "a" * 800} for i in range(80)]
        claims = {"C1": {"claimId": "C1", "kind": "finding", "statement": "Control experiments have specific conditions.",
                         "supports": [{"hash": "paper-0", "passageId": "p0", "quote": evidence["p0"]["text"]}]}}
        original_claims = deepcopy(claims)
        messages, stats = bounded_context({"role": "system", "content": "Read originals"}, "Compare control experiments",
            [], catalog, evidence, claims, 80, "", 20_000, ["p0"])
        context = context_from(messages)
        self.assertLessEqual(json_size(messages), 20_000)
        self.assertEqual(evidence, before)
        self.assertEqual(claims, original_claims)
        self.assertEqual(context["claims"]["C1"]["statement"], claims["C1"]["statement"])
        self.assertNotIn("quote", context["claims"]["C1"]["supports"][0])
        self.assertLess(len(context["evidence"]), 80)
        self.assertIn("p0", {item["passageId"] for item in context["evidence"]})
        self.assertEqual(len({item["hash"] for item in context["evidence"]}), 8)
        self.assertEqual(stats["archivedEvidenceCount"], 80)
        for item in context["evidence"]:
            self.assertEqual(item["text"], evidence[item["passageId"]]["text"])
            self.assertNotIn("categoryNames", item)
        omitted = next(item["passageId"] for item in context["evidenceIndex"])
        recalled = recall_evidence({"passageIds": [omitted]}, evidence)
        self.assertEqual(recalled["passages"][0]["text"], evidence[omitted]["text"])
        for arguments in ({"passageIds": ["outside"]}, {"hash": "outside"}, {"limit": 5},
                          {"offset": -1}, {"passageIds": ["p0"], "hash": "paper-0"}):
            with self.assertRaises(ValueError):
                recall_evidence(arguments, evidence)
        page = recall_evidence({"hash": "paper-0", "limit": 2}, evidence)
        self.assertEqual(page["total"], 10)
        self.assertEqual(page["nextOffset"], 2)


@unittest.skipUnless(HAS_RUNTIME, "Install Agent runtime")
class ContextCheckpointTests(unittest.TestCase):
    def test_large_real_evidence_checkpoint_resumes_recalls_and_finishes_within_budget(self):
        with tempfile.TemporaryDirectory() as directory:
            library = create_demo_library(Path(directory) / "library")
            manifest = json.loads((library / "library_db.json").read_text(encoding="utf-8"))
            for paper in manifest["papers"].values():
                (library / paper["folder"] / "extracted_text.txt").write_text(
                    "Synthetic control experiment evidence: runtime is 1.0 seconds. " * 1000, encoding="utf-8")
            checkpoint = Path(directory) / "checkpoints.sqlite3"
            options = AgentOptions("Compare synthetic control experiment evidence", library)
            case = self

            class ReadingModel:
                calls = 0

                async def complete(self, messages, tools):
                    self.calls += 1
                    case.assertLessEqual(json_size({"messages": messages, "tools": tools}), options.max_context_chars)
                    if self.calls > 2:
                        raise AgentError("Simulated model disconnect after collecting originals")
                    offsets = [0, 10] if self.calls == 1 else [20, 30]
                    return {"role": "assistant", "content": "", "tool_calls": [
                        {"id": f"read-{self.calls}-{index}", "type": "function", "function": {"name": "get_paper_passages",
                         "arguments": json.dumps({"hash": paper, "offset": offset, "limit": 10})}}
                        for index, (paper, offset) in enumerate((paper, offset) for paper in DEMO_IDS for offset in offsets)]}

            first = ReadingModel()
            with self.assertRaisesRegex(AgentError, "Simulated model disconnect"):
                asyncio.run(ReadingAgent(options, first, checkpoint_path=checkpoint, thread_id="large").run())

            class FinishingModel:
                calls = 0
                recalled_id = ""

                async def complete(self, messages, tools):
                    self.calls += 1
                    case.assertLessEqual(json_size({"messages": messages, "tools": tools}), options.max_context_chars)
                    case.assertFalse(any(tool["function"]["name"] == "search_paper_content" for tool in tools))
                    context = context_from(messages)
                    if self.calls == 1:
                        case.assertEqual(context["archivedEvidenceCount"], 80)
                        case.assertGreater(context["omittedEvidenceCount"], 0)
                        self.recalled_id = context["evidenceIndex"][0]["passageId"]
                        name, arguments = "get_read_evidence", {"passageIds": [self.recalled_id]}
                    elif self.calls == 2:
                        visible = list(context["evidence"])
                        for message in messages:
                            if message["role"] == "tool":
                                visible += json.loads(message["content"]).get("passages", [])
                        passage = next(item for item in visible if item["passageId"] == self.recalled_id)
                        name, arguments = "record_claim", {"statement": "Synthetic runtime is 1.0 seconds", "kind": "finding",
                            "supports": [{"passageId": self.recalled_id, "quote": passage["text"][:100]}]}
                    else:
                        return {"role": "assistant", "content": f"[Flow](hash:{DEMO_IDS[0]}) provides synthetic experiment evidence [C1]."}
                    return {"role": "assistant", "content": "", "tool_calls": [{"id": f"finish-{self.calls}", "type": "function",
                        "function": {"name": name, "arguments": json.dumps(arguments)}}]}

            agent = ReadingAgent(options, FinishingModel(), checkpoint_path=checkpoint, thread_id="large")
            result = asyncio.run(agent.run())
            self.assertEqual(len(result["evidence"]), 80)
            self.assertEqual(result["verification"]["claimCount"], 1)
            self.assertTrue(result["verification"]["checks"]["sourcesRevalidated"])
            self.assertEqual(result["finalizationCalls"], 3)
            self.assertTrue(any(event["type"] == "finalization_started" and event["reason"] == "context_budget" for event in agent.events))
