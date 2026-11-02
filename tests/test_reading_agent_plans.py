"""Reviewed tool plans must never write before approval or expand after approval."""

import asyncio
import json
from pathlib import Path
from unittest.mock import patch

import server
from backend.reading_agent.plans import PlanStore, approve_plan, preview_plan, retry_plan
from backend.reading_agent.service import resume_after_plan
from backend.reading_agent.store import JobConflict, JobStore
from backend.reading_agent.worker import execute_job
from test_categories import LibraryFixture
from test_reading_agent import HAS_RUNTIME
import unittest


class PlanTests(LibraryFixture):
    def setUp(self):
        super().setUp()
        self.store = JobStore(self.root / "jobs.sqlite3")
        self.job, _ = self.store.create({"task": "Organize library", "agentVersion": "general-v1"}, self.library)
        self.plans = PlanStore(self.store)

    def plan(self, operations):
        value = self.plans.create(self.job["id"], self.job["id"], {"summary": "Organize selected items", "operations": operations})
        self.store.finish(self.job["id"], 1, "awaiting_approval", {"kind": "plan", "planId": value["id"], "report": "Plan"})
        return value

    def files(self):
        return {str(path.relative_to(self.library)): path.read_bytes() for path in self.library.rglob("*") if path.is_file()}

    def test_preview_references_approval_replay_and_actual_changes(self):
        paper = self.paper([])
        note = server.add_note_to_db("Existing note", ["A"], content="Existing text")
        raw = self.plan([
            {"id": "topic", "tool": "create_category", "arguments": {"name": "Topic", "parentId": "A"}},
            {"id": "flag", "tool": "create_flag", "arguments": {"name": "Important"}},
            {"id": "classify", "tool": "batch_update_items", "arguments": {"items": [
                {"id": paper["id"], "categoryIds": [{"ref": "topic.categoryId"}], "flags": [{"ref": "flag.flagId"}], "title": "Classified paper"}]}},
            {"id": "new_note", "tool": "create_note", "arguments": {"title": "Topic report", "categoryIds": [{"ref": "topic.categoryId"}], "content": "Draft"}},
            {"id": "append", "tool": "write_note", "arguments": {"id": {"ref": "new_note.noteId"}, "mode": "append", "content": "Appendix"}},
            {"id": "edit", "tool": "write_note", "arguments": {"id": note["id"], "content": "Reviewed", "mode": "append"}},
        ])
        before = self.files()
        with self.assertRaises(JobConflict):
            approve_plan(server, self.plans, raw["id"], self.job["id"], "")
        plan = preview_plan(server, self.plans, raw["id"], self.job["id"])
        self.assertEqual(plan["state"], "awaiting_approval")
        self.assertEqual(self.files(), before)
        self.assertNotIn("A/Topic", server.load_library_db()["categories"])
        completed = approve_plan(server, self.plans, plan["id"], self.job["id"], plan["digest"])
        self.assertEqual(completed["state"], "completed", completed)
        item = server.read_paper(paper["id"])
        self.assertEqual(item["categoryIds"], ["A/Topic"])
        self.assertEqual(item["title"], "Classified paper")
        self.assertEqual(len(item["flags"]), 1)
        created_id = completed["results"][3]["output"]["noteId"]
        self.assertEqual(server.read_paper(created_id)["notes"], "Draft\n\nAppendix")
        self.assertEqual(server.read_paper(note["id"])["notes"], "Existing text\n\nReviewed")
        after = self.files()
        self.assertEqual(approve_plan(server, self.plans, plan["id"], self.job["id"], plan["digest"])["state"], "completed")
        self.assertEqual(self.files(), after)

    def test_library_change_invalidates_preview_and_retry_needs_fresh_confirmation(self):
        paper = self.paper()
        raw = self.plan([{"id": "todo", "tool": "update_paper", "arguments": {"id": paper["id"], "todo": True}}])
        plan = preview_plan(server, self.plans, raw["id"], self.job["id"])
        server.create_category("", "Concurrent change")
        before = self.files()
        with self.assertRaises(JobConflict):
            approve_plan(server, self.plans, plan["id"], self.job["id"], plan["digest"])
        self.assertEqual(self.files(), before)
        self.assertEqual(self.plans.get(plan["id"], self.job["id"], self.library)["state"], "stale")
        updated = retry_plan(server, self.plans, plan["id"], self.job["id"])
        self.assertNotEqual(updated["id"], plan["id"])
        self.assertEqual(updated["state"], "awaiting_approval")
        self.assertFalse(server.read_paper(paper["id"])["todo"])

    def test_invalid_unapproved_or_cross_library_plans_cannot_write(self):
        for operations in (
            [{"id": "bad", "tool": "delete_item", "arguments": {"id": "p"}}],
            [{"id": "bad", "tool": "create_category", "arguments": {"name": "X"}}, {"id": "bad", "tool": "create_category", "arguments": {"name": "Y"}}],
        ):
            with self.assertRaises(ValueError):
                self.plans.create(self.job["id"], self.job["id"], {"summary": "Invalid", "operations": operations})
        raw = self.plan([{"id": "cat", "tool": "create_category", "arguments": {"name": "X", "parentId": {"ref": "future.categoryId"}}}])
        before = self.files()
        with self.assertRaises(ValueError):
            preview_plan(server, self.plans, raw["id"], self.job["id"])
        self.assertEqual(self.files(), before)
        with self.assertRaises(FileNotFoundError):
            self.plans.get(raw["id"], self.job["id"], self.root / "other-library")

    def test_modify_or_cancel_plan_revokes_approval(self):
        raw = self.plan([{"id": "cat", "tool": "create_category", "arguments": {"name": "First"}}])
        first = preview_plan(server, self.plans, raw["id"], self.job["id"])
        second = self.plans.create(self.job["id"], self.job["id"], {"summary": "New version", "operations": [
            {"id": "cat", "tool": "create_category", "arguments": {"name": "Second"}}]})
        self.assertEqual(second["version"], first["version"] + 1)
        with self.assertRaises(JobConflict):
            approve_plan(server, self.plans, first["id"], self.job["id"], first["digest"])
        second = preview_plan(server, self.plans, second["id"], self.job["id"])
        self.store.cancel(self.job["id"], self.library)
        self.plans.invalidate(self.job["id"])
        with self.assertRaises(JobConflict):
            approve_plan(server, self.plans, second["id"], self.job["id"], second["digest"])
        self.assertNotIn("Second", server.load_library_db()["categories"])

    def test_category_rename_move_delete_preview_matches_approved_effects(self):
        server.create_category("A", "Child")
        paper = self.paper(["A/Child", "C"])
        raw = self.plan([
            {"id": "rename", "tool": "rename_category", "arguments": {"id": "A/Child", "name": "Renamed"}},
            {"id": "move", "tool": "move_category", "arguments": {"id": {"ref": "rename.categoryId"}, "parentId": "B"}},
            {"id": "delete", "tool": "delete_category", "arguments": {"id": "C"}},
        ])
        before = self.files()
        plan = preview_plan(server, self.plans, raw["id"], self.job["id"])
        self.assertEqual(self.files(), before)
        self.assertIn("A/Renamed", plan["preview"][0]["changes"][0]["after"])
        self.assertEqual(plan["preview"][0]["changes"][0]["after"]["A/Renamed"]["id"], "A/Renamed")
        result = approve_plan(server, self.plans, plan["id"], self.job["id"], plan["digest"])
        self.assertEqual(result["state"], "completed", result)
        self.assertEqual(server.read_paper(paper["id"])["categoryIds"], ["B/Renamed"])
        self.assertNotIn("C", server.load_library_db()["categories"])

    def test_failure_records_completed_steps_and_retry_skips_them(self):
        paper = self.paper()
        raw = self.plan([
            {"id": "cat", "tool": "create_category", "arguments": {"name": "Created"}},
            {"id": "update", "tool": "add_item_categories", "arguments": {"id": paper["id"], "categoryIds": [{"ref": "cat.categoryId"}]}},
        ])
        plan = preview_plan(server, self.plans, raw["id"], self.job["id"])
        from backend.reading_agent import plans as module
        original = module.apply_operation
        def fail(api, mcp, name, args, plan_id, key):
            if key == "update":
                raise OSError("Simulated write failure")
            return original(api, mcp, name, args, plan_id, key)
        with patch.object(module, "apply_operation", side_effect=fail):
            result = approve_plan(server, self.plans, plan["id"], self.job["id"], plan["digest"])
        self.assertEqual(result["state"], "failed")
        self.assertEqual([item["status"] for item in result["results"]], ["completed", "failed"])
        retry = retry_plan(server, self.plans, plan["id"], self.job["id"])
        self.assertEqual(len(retry["proposal"]["operations"]), 1)
        self.assertEqual(retry["proposal"]["operations"][0]["arguments"]["categoryIds"], ["Created"])
        self.assertNotIn("Created", server.read_paper(paper["id"])["categoryIds"])


@unittest.skipUnless(HAS_RUNTIME, "Install Agent runtime")
class GeneralAgentTests(LibraryFixture):
    def test_real_graph_pauses_for_approval_and_resumes_without_reexecuting_tools(self):
        self.run_plan_and_resume(False)

    def test_failed_graph_accepts_reviewed_replacement_without_replanning_or_repeating_successes(self):
        self.run_plan_and_resume(True)

    def run_plan_and_resume(self, fail_first):
        target = self.paper([])
        store = JobStore(self.root / "jobs.sqlite3")
        job, _ = store.create({"task": "整理全部未分类论文", "agentVersion": "general-v1"}, self.library)
        case = self
        class Model:
            calls = 0
            async def complete(self, messages, tools):
                self.calls += 1
                name, args = ("discover_tools", {"names": ["search_library", "create_category", "batch_update_items"]})
                if self.calls == 2:
                    name, args = "search_library", {"categoryIds": ["uncategorized"], "itemType": "paper"}
                elif self.calls == 3:
                    context = json.loads(messages[-1]["content"])
                    observed = next(value for value in context["observations"] if value["tool"] == "search_library")
                    case.assertEqual(observed["result"]["matches"][0]["id"], target["id"])
                    name, args = "propose_library_plan", {"summary": "创建专题并整理未分类论文", "operations": [
                        {"id": "cat", "tool": "create_category", "arguments": {"name": "专题"}},
                        {"id": "group", "tool": "batch_update_items", "arguments": {"items": [
                            {"id": target["id"], "categoryIds": [{"ref": "cat.categoryId"}]}]}},
                    ]}
                return {"role": "assistant", "content": "正在检查分类和未分类论文。", "tool_calls": [{"id": f"call-{self.calls}", "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}]}
        model = Model()
        before = {str(path): path.read_bytes() for path in self.library.rglob("*") if path.is_file()}
        asyncio.run(execute_job(store, job["id"], 1, lambda: model))
        pending = store.get(job["id"])
        self.assertEqual(pending["status"], "awaiting_approval", pending["error"])
        self.assertEqual({str(path): path.read_bytes() for path in self.library.rglob("*") if path.is_file()}, before)
        plans = PlanStore(store)
        preview = preview_plan(server, plans, pending["result"]["planId"], job["id"])
        from backend.reading_agent import plans as module
        original = module.apply_operation
        def execute(api, mcp, name, args, plan_id, key):
            if fail_first and key == "group":
                raise OSError("Simulated classification failure")
            return original(api, mcp, name, args, plan_id, key)
        with patch.object(module, "apply_operation", side_effect=execute):
            executed = approve_plan(server, plans, preview["id"], job["id"], preview["digest"])
        self.assertEqual(executed["state"], "failed" if fail_first else "completed", executed)
        with patch("backend.reading_agent.service.launch"):
            resume_after_plan(store, job["id"], self.library, executed)
        queued = store.get(job["id"])
        self.assertEqual(queued["status"], "queued")
        with patch.object(model, "complete", side_effect=AssertionError("Do not rerun planning or writes")):
            asyncio.run(execute_job(store, job["id"], queued["attempt"], lambda: model))
        completed = store.get(job["id"])
        self.assertEqual(completed["status"], "completed", completed["error"])
        if fail_first:
            replacement = retry_plan(server, plans, executed["id"], job["id"])
            self.assertEqual([op["id"] for op in replacement["proposal"]["operations"]], ["group"])
            with store.connect() as connection:
                connection.execute("UPDATE jobs SET status='awaiting_approval',result=? WHERE id=?",
                    (json.dumps({"kind": "plan", "planId": replacement["id"], "report": "Retry plan"}), job["id"]))
            with patch.object(server, "create_category", side_effect=AssertionError("Do not repeat successful writes")):
                retried = approve_plan(server, plans, replacement["id"], job["id"], replacement["digest"])
            self.assertEqual(retried["state"], "completed", retried)
            with patch("backend.reading_agent.service.launch"):
                resume_after_plan(store, job["id"], self.library, retried)
            queued = store.get(job["id"])
            with patch.object(model, "complete", side_effect=AssertionError("Do not repeat planning")):
                asyncio.run(execute_job(store, job["id"], queued["attempt"], lambda: model))
            completed = store.get(job["id"])
            self.assertEqual(completed["status"], "completed", completed["error"])
        self.assertEqual(server.read_paper(target["id"])["categoryIds"], ["专题"])
        self.assertIn("1 / 1" if fail_first else "2 / 2", completed["result"]["report"])
