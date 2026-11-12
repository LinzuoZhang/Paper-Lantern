"""Agent annotation discovery, read routing, and preview/approval boundaries."""

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import patch

import server
from backend.reading_agent.capabilities import mcp_module, READ_CAPABILITIES, WRITE_CAPABILITIES
from backend.reading_agent.graph import ReadingAgent
from backend.reading_agent.library_agent import LibraryAgent, proposal_definition
from backend.reading_agent.mcp_client import MODEL_TOOLS
from backend.reading_agent.plans import PlanStore, PlanValidationError, approve_plan, preview_plan, retry_plan
from backend.reading_agent.state import AgentOptions
from backend.reading_agent.store import JobConflict, JobStore
from test_categories import LibraryFixture


class AgentAnnotationTests(LibraryFixture):
    def setUp(self):
        super().setUp()
        self.item = self.paper()
        self.directory = server.paper_dir_from_id(self.item["id"])
        self.path = self.directory / "highlights.json"
        self.jobs = JobStore(self.root / "jobs.sqlite3")
        self.job, _ = self.jobs.create({"task": "Read and annotate paper", "agentVersion": "general-v1"}, self.library)
        self.plans = PlanStore(self.jobs)
        self.rect = {"pageNumber": 1, "left": .1, "top": .2, "width": .3, "height": .04,
                     "selectedText": "Original quotation", "groupId": "existing", "color": "green", "comment": "Keep me"}
        server.write_json(self.path, [self.rect])
        self.mcp = mcp_module()

    def files(self):
        return {str(path.relative_to(self.library)): path.read_bytes() for path in self.library.rglob("*") if path.is_file()}

    def operation(self, tool, **args):
        return {"id": "op", "tool": tool, "arguments": {"id": self.item["id"], **args}}

    def plan(self, operations):
        plan = self.plans.create(self.job["id"], self.job["id"], {"summary": "新增论文高亮与批注", "operations": operations})
        self.jobs.finish(self.job["id"], 1, "awaiting_approval", {"kind": "plan", "planId": plan["id"]})
        return plan

    def preview(self, operations):
        plan = self.plan(operations)
        return preview_plan(server, self.plans, plan["id"], self.job["id"])

    def approve(self, plan):
        return approve_plan(server, self.plans, plan["id"], self.job["id"], plan["digest"])

    def mock_pdf(self):
        class PDF(list):
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                pass

        return patch("backend.pdf_highlights.require_pymupdf", return_value=SimpleNamespace(open=lambda *_args: PDF([object()])))

    def test_discovery_and_general_agent_can_read_but_cannot_execute_writes(self):
        names = ["get_paper_highlights", "get_paper_annotations", "add_paper_highlight", "add_paper_annotation"]
        self.assertTrue(set(names[:2]) <= READ_CAPABILITIES.keys() & MODEL_TOOLS)
        self.assertTrue(set(names[2:]) <= WRITE_CAPABILITIES.keys())
        calls = []
        module = self.mcp

        class Client:
            async def call(self, name, arguments):
                calls.append((name, arguments))
                result = module.handle_request({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                    "params": {"name": name, "arguments": arguments}})["result"]
                if result["isError"]:
                    raise ValueError(result["content"][0]["text"])
                return json.loads(result["content"][0]["text"])

        agent = LibraryAgent(AgentOptions("Annotate", self.library), None, self.jobs, self.job["id"], self.job["id"], self.root / "checkpoints.sqlite3")
        agent.client = Client()
        before = self.files()

        async def run():
            state = await agent.setup({})
            self.assertTrue(set(names) <= {tool["name"] for tool in state["catalog"]})
            state["reply"] = {"tool_calls": [{"id": "discover", "function": {
                "name": "discover_tools", "arguments": json.dumps({"names": names})}}]}
            state.update(await agent.tools(state))
            schemas = state["facts"][-1]["result"]["tools"]
            effects = {tool["name"]: (tool["effect"], tool["approvalRequired"]) for tool in schemas}
            self.assertEqual(effects["get_paper_annotations"], ("read", False))
            self.assertEqual(effects["add_paper_annotation"], ("write", True))
            variants = proposal_definition(schemas)["function"]["parameters"]["properties"]["operations"]["items"]["anyOf"]
            self.assertTrue(any(variant["properties"]["tool"]["enum"] == ["add_paper_annotation"] for variant in variants))
            for name in names[:2]:
                state["reply"] = {"tool_calls": [{"id": name, "function": {
                    "name": name, "arguments": json.dumps({"id": self.item["id"]})}}]}
                state.update(await agent.tools(state))
                result = state["facts"][-1]["result"]
                self.assertEqual(result["groups"][0]["entries"][0]["content"], "Keep me")
                self.assertEqual(calls[-1][1]["limit"], 5)
            state["reply"] = {"tool_calls": [{"id": "write", "function": {"name": "add_paper_annotation",
                "arguments": json.dumps({"id": self.item["id"], "groupId": "existing", "content": "Forbidden"})}}]}
            state.update(await agent.tools(state))
            self.assertIn("只能提交", state["facts"][-1]["error"])
            self.assertNotIn("add_paper_annotation", [name for name, _args in calls])

        with patch.dict("os.environ", {"PAPER_LANTERN_MCP_READ_ONLY": "1"}):
            asyncio.run(run())
        self.assertEqual(self.files(), before)

    def test_research_annotations_are_scope_checked_and_do_not_become_original_evidence(self):
        agent = ReadingAgent(AgentOptions("Compare", self.library), None)
        agent.allowed = {self.item["id"]}
        case = self

        class Client:
            async def call(self, name, arguments):
                case.assertEqual(arguments, {"id": case.item["id"], "limit": 5})
                return {"id": case.item["id"], "groups": [{"entries": [{"content": "Personal opinion"}]}]}

        agent.client = Client()
        state = {"messages": [{"role": "assistant", "tool_calls": [{"id": "read", "function": {
            "name": "get_paper_annotations", "arguments": json.dumps({"id": self.item["id"]})}}]}],
            "evidence": {}, "claims": {}, "tool_calls": 0}
        result = asyncio.run(agent.tools_step(state))
        self.assertEqual(result["evidence"], {})
        self.assertIn("Personal opinion", result["messages"][-1]["content"])

    def test_preview_then_append_translation_preserves_existing_and_replay_does_not_duplicate(self):
        operation = self.operation("add_paper_annotation", groupId="existing", content="原文翻译", type="translation")
        before = self.files()
        plan = self.preview([operation])
        self.assertEqual(self.files(), before)
        after_view = plan["preview"][0]["changes"][0]["after"]["highlights"][0]
        self.assertIn("翻译：原文翻译", after_view)
        self.assertIn("原文：Original quotation", after_view)
        completed = self.approve(plan)
        self.assertEqual(completed["state"], "completed", completed)
        saved = server.read_json(self.path, [])
        self.assertEqual(saved[0]["comment"], "Keep me")
        self.assertEqual(saved[0]["translation"], "原文翻译")
        self.assertEqual(saved[0]["text"][0]["id"], completed["results"][0]["output"]["entryId"])
        self.approve(plan)
        self.assertEqual(server.read_json(self.path, []), saved)
        server.maybe_auto_sync_library.assert_called_once()

    def test_new_highlight_reference_previews_and_executes_with_identical_group_id(self):
        operations = [self.operation("add_paper_highlight", pageNumber=1, text="New original quotation", color="purple"),
            {"id": "comment", "tool": "add_paper_annotation", "arguments": {
                "id": self.item["id"], "groupId": {"ref": "op.groupId"}, "content": "Comment on new highlight"}}]
        rects = [{"left": .1, "top": .4, "width": .3, "height": .02}, {"left": .1, "top": .5, "width": .2, "height": .02}]
        before = self.files()
        with self.mock_pdf(), patch("backend.pdf_highlights.quote_rectangles", return_value=rects):
            plan = self.preview(operations)
            group_id = plan["preview"][1]["arguments"]["groupId"]
            self.assertEqual(self.files(), before)
            completed = self.approve(plan)
        self.assertEqual(completed["state"], "completed", completed)
        self.assertEqual(completed["results"][0]["output"]["groupId"], group_id)
        saved = server.read_json(self.path, [])
        self.assertEqual(saved[0]["comment"], "Keep me")
        self.assertEqual(len(saved), 3)
        for rect in saved[1:]:
            self.assertEqual(rect["groupId"], group_id)
            self.assertEqual(rect["comment"], "Comment on new highlight")
        server.maybe_auto_sync_library.assert_called_once()

    def test_concurrent_annotation_or_pdf_change_invalidates_approval(self):
        for changed in ("highlights.json", "paper.pdf"):
            with self.subTest(changed=changed):
                plan = self.preview([self.operation("add_paper_annotation", groupId="existing", content="Review")])
                if changed == "highlights.json":
                    server.write_json(self.path, [{**self.rect, "comment": "Concurrent change"}])
                else:
                    (self.directory / changed).write_bytes(b"replacement PDF")
                before = self.files()
                with self.assertRaises(JobConflict):
                    self.approve(plan)
                self.assertEqual(self.files(), before)

    def test_validation_errors_and_missing_pdf_dependency_fail_preview_without_writes(self):
        note = server.add_note_to_db("Note", [])
        invalid = [self.operation("add_paper_annotation", groupId="missing", content="Review"),
                   self.operation("add_paper_annotation", groupId="existing", content=" "),
                   self.operation("add_paper_annotation", id=note["id"], groupId="existing", content="Review")]
        for operation in invalid:
            before = self.files()
            with self.assertRaises(PlanValidationError):
                self.preview([operation])
            self.assertEqual(self.files(), before)
        before = self.files()
        with patch("backend.pdf_highlights.require_pymupdf", side_effect=RuntimeError("Install PyMuPDF")):
            with self.assertRaises(PlanValidationError) as caught:
                self.preview([self.operation("add_paper_highlight", pageNumber=1, text="Original quotation")])
        self.assertIn("PyMuPDF", caught.exception.plan["failure"]["error"])
        self.assertEqual(self.files(), before)
        with self.mock_pdf(), patch("backend.pdf_highlights.quote_rectangles", return_value=[]):
            with self.assertRaises(PlanValidationError):
                self.preview([self.operation("add_paper_highlight", pageNumber=1, text="Missing quotation")])
        self.assertEqual(self.files(), before)
        self.path.write_text('{"broken":', encoding="utf-8")
        before = self.files()
        with self.assertRaises(PlanValidationError):
            self.preview([self.operation("add_paper_annotation", groupId="existing", content="Review")])
        self.assertEqual(self.files(), before)
        server.maybe_auto_sync_library.assert_not_called()

    def test_duplicate_highlight_is_noop_without_sync(self):
        rects = [{key: self.rect[key] for key in ("left", "top", "width", "height")}]
        before = self.files()
        with self.mock_pdf(), patch("backend.pdf_highlights.quote_rectangles", return_value=rects):
            plan = self.preview([self.operation("add_paper_highlight", pageNumber=1, text="Original quotation")])
            completed = self.approve(plan)
        self.assertFalse(completed["results"][0]["output"]["changed"])
        self.assertEqual(self.files(), before)
        server.maybe_auto_sync_library.assert_not_called()

    def test_retry_skips_completed_highlight_and_resolves_group_reference(self):
        operations = [self.operation("add_paper_highlight", pageNumber=1, text="New original quotation"),
            {"id": "comment", "tool": "add_paper_annotation", "arguments": {
                "id": self.item["id"], "groupId": "{ref:op.groupId}", "content": "Review"}}]
        from backend.reading_agent import plans as module
        original = module.apply_operation

        def fail(api, mcp, name, args, plan_id, key):
            if key == "comment":
                raise OSError("Comment write failed")
            return original(api, mcp, name, args, plan_id, key)

        rects = [{key: self.rect[key] for key in ("left", "top", "width", "height")}]
        with self.mock_pdf(), patch("backend.pdf_highlights.quote_rectangles", return_value=rects):
            plan = self.preview(operations)
            with patch.object(module, "apply_operation", side_effect=fail):
                failed = self.approve(plan)
        self.assertEqual(failed["state"], "failed")
        replacement = retry_plan(server, self.plans, plan["id"], self.job["id"])
        self.assertEqual(len(replacement["proposal"]["operations"]), 1)
        self.assertEqual(replacement["preview"][0]["arguments"]["groupId"], failed["results"][0]["output"]["groupId"])
        completed = self.approve(replacement)
        self.assertEqual(completed["state"], "completed", completed)
        self.assertEqual(len(server.read_json(self.path, [])), 2)
