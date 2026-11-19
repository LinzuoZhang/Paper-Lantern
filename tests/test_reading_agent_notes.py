"""Standalone-note analysis must cover both list pages and long Markdown bodies."""

import asyncio
from copy import deepcopy
from datetime import date, timedelta
import json
import re
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import server
from backend.reading_agent.capabilities import mcp_module
from backend.reading_agent.library_agent import LibraryAgent
from backend.reading_agent.library_context import note_read_arguments, observation_view, read_definition, result_page, task_memory
from backend.reading_agent.state import AgentError, AgentOptions
from backend.reading_agent.store import JobStore
from backend.reading_agent.worker import execute_job
from test_categories import LibraryFixture
from test_reading_agent import HAS_RUNTIME


class NotePassageTests(LibraryFixture):
    def call(self, args, error=False):
        result = mcp_module().handle_request({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": {"name": "get_note_passages", "arguments": args}})["result"]
        self.assertEqual(result["isError"], error, result)
        return result if error else json.loads(result["content"][0]["text"])

    def snapshot(self):
        return {str(p.relative_to(self.library)): (p.read_bytes(), p.stat().st_mtime_ns)
                for p in self.library.rglob("*") if p.is_file()}

    def test_long_note_paginates_exactly_without_truncation_or_writes(self):
        content = "# 日报 2026-11-01\n\n" + "多模态模型的推理和训练趋势。数学 $x^2$ 与链接。\n" * 500 + "最后一段 SENTINEL"
        note = server.add_note_to_db("日报", "A", content=content)
        before = self.snapshot()
        passages, offset, version = [], 0, None
        with patch.dict("os.environ", {"PAPER_LANTERN_MCP_READ_ONLY": "1"}), \
                patch.object(server, "load_library_db", side_effect=AssertionError("Read must not migrate")):
            while offset is not None:
                args = {"id": note["id"], "offset": offset, "limit": 2}
                if version:
                    args["sourceVersion"] = version
                data = self.call(args)
                self.assertEqual(data["itemType"], "note")
                self.assertIn(f"hash:{note['id']}", data["paperLink"])
                fact = {"tool": "get_note_passages", "arguments": args, "result": data}
                self.assertEqual(observation_view(fact)["result"]["passages"], data["passages"])
                self.assertEqual(result_page([fact], 0)["result"]["passages"], data["passages"])
                passages.extend(data["passages"])
                offset, version = data["nextOffset"], data["sourceVersion"]
        self.assertGreater(len(passages), 5)
        covered = 0
        for passage in passages:
            self.assertLessEqual(passage["startChar"], covered)
            self.assertEqual(passage["text"], content[passage["startChar"]:passage["endChar"]])
            self.assertLessEqual(len(passage["text"]), 1200)
            covered = passage["endChar"]
        self.assertEqual(covered, len(content))
        self.assertEqual(self.snapshot(), before)
        server.maybe_auto_sync_library.assert_not_called()

    def test_legacy_fallback_current_notes_changes_and_invalid_targets(self):
        note = server.add_note_to_db("Legacy daily", "A")
        directory = server.paper_dir_from_id(note["id"])
        metadata = server.read_json(directory / "metadata.json", {})
        metadata["notes"] = "Legacy source for daily notes"
        server.write_json(directory / "metadata.json", metadata)
        (directory / server.NOTES_FILE).unlink(missing_ok=True)
        with patch.dict("os.environ", {"PAPER_LANTERN_MCP_READ_ONLY": "1"}):
            before = self.snapshot()
            old = self.call({"id": note["id"]})
            self.assertEqual(old["passages"][0]["text"], metadata["notes"])
            self.assertEqual(self.snapshot(), before)
            server.write_paper_notes(directory, "Current note body")
            self.call({"id": note["id"], "sourceVersion": old["sourceVersion"]}, error=True)
            self.assertEqual(self.call({"id": note["id"]})["passages"][0]["text"], "Current note body")
            server.write_paper_notes(directory, "")
            self.assertEqual(self.call({"id": note["id"]})["passages"], [])
            for args in ({"id": "missing"}, {"id": note["id"], "offset": -1},
                         {"id": note["id"], "limit": 6}, {"id": self.paper()["id"]}):
                self.call(args, error=True)
        server.archive_item(note["id"])
        self.call({"id": note["id"]}, error=True)

    def test_memory_distinguishes_listing_from_complete_versioned_note_reads(self):
        def read(offset, count, version="v1"):
            return {"tool": "get_note_passages", "result": {"id": "n", "title": "Daily", "itemType": "note",
                "sourceVersion": version, "totalPassages": 6, "offset": offset,
                "passages": [{"text": "Exact note text"}] * count}}
        facts = [{"tool": "search_library", "arguments": {"itemType": "note"},
                  "result": {"matches": [{"id": "n", "itemType": "note"}], "totalMatches": 1}}]
        self.assertEqual(task_memory(facts)["noteReadCount"], 0)
        facts += [read(0, 2), read(4, 2)]
        memory = task_memory(facts)
        self.assertTrue(memory["searches"][0]["complete"])
        self.assertEqual(memory["noteReads"][0]["nextOffset"], 2)
        self.assertEqual(memory["noteReadCount"], 0)
        facts.append(read(2, 2))
        original = deepcopy(facts)
        memory = task_memory(facts)
        self.assertEqual(memory["noteReadCount"], 1)
        self.assertEqual(memory["noteReads"][0]["observations"], [1, 2, 3])
        self.assertEqual(facts, original)
        facts.append(read(4, 2, "v2"))
        memory = task_memory(facts)
        self.assertEqual(memory["noteReadCount"], 0)
        self.assertEqual(memory["noteReads"][0]["nextOffset"], 0)
        self.assertEqual(memory["noteReads"][0]["observations"], [4])

    @unittest.skipUnless(HAS_RUNTIME, "Install Agent runtime")
    def test_real_graph_reads_thirty_one_daily_notes_and_long_note_tail(self):
        self.run_daily_graph(serial=False)

    @unittest.skipUnless(HAS_RUNTIME, "Install Agent runtime")
    def test_serial_provider_with_guessed_versions_still_reads_all_thirty_one_notes(self):
        self.run_daily_graph(serial=True)

    def run_daily_graph(self, serial):
        server.create_category("", "日报文献")
        [server.add_note_to_db(f"日报 {date(2026, 10, 19) + timedelta(days=i)}", "日报文献",
                 content=("# 日报\n推理模型与多模态研究进展。\n" * 500 if i == 0 else f"第{i + 1}篇：推理模型与多模态研究进展。")
                         + f"\nTAIL-{i}") for i in range(31)]
        before = self.snapshot()
        store = JobStore(self.root / "jobs.sqlite3")
        job, _ = store.create({"task": "读取日报文献，分析近一个月的研究趋势", "agentVersion": "general-v1"}, self.library)
        case = self

        class Model:
            calls = 0
            tails = set()
            offsets = []

            async def complete(self, messages, tools):
                self.calls += 1
                context = json.loads(messages[-1]["content"])
                case.assertIn("currentTime", context)
                case.assertIn("不转交 research_library", messages[0]["content"])
                for tool in tools:
                    if tool["function"]["name"] == "get_note_passages":
                        case.assertNotIn("sourceVersion", tool["function"]["parameters"]["properties"])
                for fact in context["observations"]:
                    case.assertNotIn("error", fact, fact)
                    if fact["tool"] == "get_note_passages":
                        for passage in fact["result"]["passages"]:
                            self.tails.update(int(value) for value in re.findall(r"TAIL-(\d+)\b", passage["text"]))
                memory = context["workspace"]
                if self.calls == 1:
                    calls = [("discover_tools", {"names": ["search_library", "get_note_passages"]})]
                elif not memory["searches"] or not memory["searches"][0]["complete"]:
                    offset = memory["searches"][0]["nextOffset"] if memory["searches"] else 0
                    self.offsets.append(offset)
                    calls = [("search_library", {"query": "日报文献", "itemType": "note", "offset": offset})]
                else:
                    reads = {note["id"]: note for note in memory["noteReads"]}
                    pending = [item for item in memory["items"] if not reads.get(item["id"], {}).get("complete")]
                    if not pending:
                        case.assertEqual(memory["noteReadCount"], 31)
                        case.assertEqual(self.tails, set(range(31)))
                        case.assertEqual(self.offsets, [0, 30])
                        if serial:
                            case.assertGreater(self.calls, 24)
                        return {"role": "assistant", "content": "已读取31篇日报笔记，趋势分析基于笔记记录。"}
                    calls = []
                    for item in pending[:1 if serial else 4]:
                        args = {"id": item["id"]}
                        if item["id"] in reads:
                            args.update(offset=reads[item["id"]]["nextOffset"])
                        if serial:
                            # Reproduce the failed session, including old
                            # checkpoint/provider inputs outside the new schema.
                            args["sourceVersion"] = ["latest", " ", None, "invented"][self.calls % 4]
                        calls.append(("get_note_passages", args))
                return {"role": "assistant", "tool_calls": [{"id": f"{self.calls}-{i}", "type": "function",
                    "function": {"name": name, "arguments": json.dumps(args)}} for i, (name, args) in enumerate(calls)]}

        model = Model()
        with patch("backend.reading_agent.library_agent.ReadingAgent.run", side_effect=AssertionError("Notes must not use PDF research")):
            asyncio.run(execute_job(store, job["id"], 1, lambda: model))
        completed = store.get(job["id"])
        self.assertEqual(completed["status"], "completed", completed["error"])
        self.assertEqual(completed["result"]["kind"], "library")
        self.assertIn("31", completed["result"]["report"])
        self.assertEqual(self.snapshot(), before)

    def test_model_schema_hides_versions_and_continuation_uses_returned_digest(self):
        schema = mcp_module().TOOLS["get_note_passages"][1]
        adapted = read_definition({"type": "function", "function": {"name": "get_note_passages", "parameters": schema}})
        self.assertIn("sourceVersion", schema["properties"])
        self.assertNotIn("sourceVersion", adapted["function"]["parameters"]["properties"])
        for guessed in ("latest", " ", None, "wrong"):
            self.assertNotIn("sourceVersion", note_read_arguments({"id": "n", "sourceVersion": guessed}, []))
        facts = [{"tool": "get_note_passages", "result": {"id": "n", "sourceVersion": "real-digest"}}]
        self.assertEqual(note_read_arguments({"id": "n", "offset": 5, "sourceVersion": "latest"}, facts)["sourceVersion"], "real-digest")
        with self.assertRaisesRegex(ValueError, "offset=0"):
            note_read_arguments({"id": "other", "offset": 5}, facts)

    def test_changed_note_invalidates_old_pages_and_restarts_with_new_digest(self):
        note = server.add_note_to_db("Changing daily", "A", content="Old daily findings. " * 500)
        store = JobStore(self.root / "jobs.sqlite3")
        job, _ = store.create({"task": "读取笔记", "agentVersion": "general-v1"}, self.library)
        agent = LibraryAgent(AgentOptions("读取笔记", self.library), None, store, job["id"], job["id"], self.root / "checkpoints.sqlite3")

        async def call(name, args):
            result = mcp_module().handle_request({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                "params": {"name": name, "arguments": args}})["result"]
            if result["isError"]:
                raise AgentError(result["content"][0]["text"])
            return json.loads(result["content"][0]["text"])

        agent.client = SimpleNamespace(call=call)
        state = {"facts": [], "selected": ["get_note_passages"], "tool_calls": 0}

        def read(offset):
            state["reply"] = {"tool_calls": [{"function": {"name": "get_note_passages", "arguments": json.dumps(
                {"id": note["id"], "offset": offset, "limit": 1, "sourceVersion": "latest"})}}]}
            with patch.dict("os.environ", {"PAPER_LANTERN_MCP_READ_ONLY": "1"}):
                state.update(asyncio.run(agent.tools(state)))

        read(0)
        old = state["facts"][-1]["result"]["sourceVersion"]
        server.write_paper_notes(server.paper_dir_from_id(note["id"]), "New daily findings. " * 500)
        read(1)
        self.assertTrue(state["facts"][0]["stale"])
        self.assertIn("offset=0", state["facts"][-1]["error"])
        self.assertEqual(task_memory(state["facts"])["noteReads"], [])
        read(0)
        new = state["facts"][-1]["result"]["sourceVersion"]
        self.assertNotEqual(old, new)
        read(1)
        self.assertEqual(state["facts"][-1]["arguments"]["sourceVersion"], new)
        self.assertNotIn("error", state["facts"][-1])
        self.assertEqual(task_memory(state["facts"])["noteReads"][0]["loadedPassages"], 2)

