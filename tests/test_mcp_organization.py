import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
from unittest.mock import patch

import server
from test_categories import LibraryFixture


class MCPOrganizationTests(LibraryFixture):
    def setUp(self):
        super().setUp()
        path = Path(server.__file__).parent / "plugins/paper-lantern-research-mcp/scripts/paper_lantern_research_mcp.py"
        spec = importlib.util.spec_from_file_location("mcp_organization_contract", path)
        self.mcp = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.mcp)

    def request(self, name, args):
        response = self.mcp.handle_request({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                                            "params": {"name": name, "arguments": args}})
        self.assertNotIn("error", response)
        return response["result"]

    def call(self, name, args):
        result = self.request(name, args)
        self.assertFalse(result["isError"], result)
        return json.loads(result["content"][0]["text"])

    def snapshot(self):
        return {str(path.relative_to(self.library)): path.read_bytes()
                for path in self.library.rglob("*") if path.is_file()}

    def test_discovery_and_input_validation(self):
        tools = {tool["name"]: tool for tool in self.mcp.list_tools()}
        for name in ("batch_update_items", "rename_category", "move_category", "delete_category",
                     "list_flags", "create_flag", "update_flag", "batch_update_flags"):
            self.assertIn(name, tools)
            self.assertFalse(tools[name]["inputSchema"]["additionalProperties"])
        paper = self.paper()
        cases = [
            ("batch_update_items", {"items": []}),
            ("batch_update_items", {"items": [{"id": paper["id"], "read": True}] * 1001}),
            ("batch_update_items", {"items": [{"id": paper["id"]}]}),
            ("batch_update_items", {"items": [{"id": paper["id"], "categoryId": "New"}]}),
            ("batch_update_items", {"items": [{"id": paper["id"], "todo": "yes"}]}),
            ("batch_update_items", {"items": [{"id": paper["id"], "unknown": True}]}),
            ("batch_update_items", {"items": [{"id": paper["id"], "read": True}], "dryRun": "yes"}),
            ("rename_category", {"id": "A", "name": " "}),
            ("move_category", {"id": "A", "beforeId": "B", "afterId": "C"}),
            ("delete_category", {"id": "A", "dryRun": "yes"}),
            ("list_flags", {"unknown": True}),
            ("create_flag", {"name": " "}),
            ("update_flag", {"id": "todo"}),
            ("update_flag", {"id": "todo", "icon": "unknown"}),
            ("batch_update_flags", {"ids": [paper["id"]], "flags": [], "operation": "add"}),
            ("batch_update_flags", {"ids": [paper["id"]], "flags": ["read"], "operation": "replace"}),
        ]
        before = self.snapshot()
        for name, args in cases:
            with self.subTest(name=name, args=args):
                self.assertTrue(self.request(name, args)["isError"])
                self.assertEqual(self.snapshot(), before)
        server.maybe_auto_sync_library.assert_not_called()

    def test_batch_updates_distinct_papers_and_notes_and_syncs_once(self):
        paper = self.paper(["A", "B"])
        note = server.add_note_to_db("Old note", "A")
        flag = server.create_library_flag("精读")
        items = [
            {"id": paper["id"], "categoryIds": ["A"], "addCategoryIds": ["B", "C"], "removeCategoryIds": ["A", "C"],
             "title": "Updated paper", "doi": "10.1234/example", "basicInfo": {"authors": ["Alice"]},
             "notes": "Read carefully", "flags": ["read", flag["id"]]},
            {"id": note["id"], "categoryIds": [], "title": "Updated note", "notes": "# Report", "todo": True},
        ]
        result = self.call("batch_update_items", {"items": items})
        self.assertEqual(result["updatedCount"], 2)
        self.assertEqual([item["status"] for item in result["results"]], ["updated", "updated"])
        updated = server.read_paper(paper["id"])
        self.assertEqual(updated["categoryIds"], ["B"])
        self.assertEqual(updated["title"], "Updated paper")
        self.assertEqual(updated["doi"], "10.1234/example")
        self.assertEqual(updated["basicInfo"]["authors"], ["Alice"])
        self.assertEqual(updated["notes"], "Read carefully")
        self.assertEqual(updated["flags"], ["read", flag["id"]])
        updated_note = server.read_paper(note["id"])
        self.assertEqual(updated_note["categoryIds"], ["uncategorized"])
        self.assertEqual(updated_note["notes"], "# Report")
        self.assertTrue(updated_note["todo"])
        server.maybe_auto_sync_library.assert_called_once()

    def test_batch_preview_and_revision_guard(self):
        paper = self.paper()
        # A legacy note must not be migrated during preview.
        directory = server.paper_dir_from_id(paper["id"])
        metadata = server.read_json(directory / "metadata.json", {})
        metadata["notes"] = "Legacy content"
        server.write_json(directory / "metadata.json", metadata)
        (directory / server.NOTES_FILE).unlink(missing_ok=True)
        items = [{"id": paper["id"], "title": "New title", "notes": "Replacement", "todo": True}]
        before = self.snapshot()
        preview = self.call("batch_update_items", {"items": items, "dryRun": True})
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(preview["updatedCount"], 0)
        self.assertEqual(preview["results"], [])
        self.assertEqual(preview["changes"][0]["before"]["notes"], "Legacy content")
        self.assertEqual(preview["changes"][0]["after"]["title"], "New title")
        server.maybe_auto_sync_library.assert_not_called()
        result = self.call("batch_update_items", {"items": items, "expectedRevision": preview["revision"]})
        self.assertEqual(result["updatedCount"], 1)
        before = self.snapshot()
        self.assertTrue(self.request("batch_update_items", {"items": items, "expectedRevision": preview["revision"]})["isError"])
        self.assertEqual(self.snapshot(), before)

    def test_batch_revision_detects_notes_flags_and_category_changes(self):
        paper = self.paper()
        args = {"items": [{"id": paper["id"], "title": "New"}]}
        mutations = [
            lambda: server.write_paper_notes(server.paper_dir_from_id(paper["id"]), "Manual edit"),
            lambda: server.update_paper_local_state(paper["id"], {"read": True}),
            lambda: server.create_category("A", "child"),
            lambda: server.create_library_flag("New flag"),
        ]
        for mutation in mutations:
            revision = self.call("batch_update_items", {**args, "dryRun": True})["revision"]
            mutation()
            self.assertTrue(self.request("batch_update_items", {**args, "expectedRevision": revision})["isError"])
        self.assertEqual(server.read_paper(paper["id"])["title"], paper["title"])

    def test_invalid_late_item_leaves_whole_batch_untouched(self):
        first, second = self.paper(), self.paper()
        invalid_items = [
            {"id": "missing", "title": "Invalid"},
            {"id": second["id"], "addCategoryIds": ["missing"]},
            {"id": second["id"], "flags": ["missing"]},
            {"id": second["id"], "notes": r"Use \(x\)."},
            {"id": first["id"], "todo": True},
        ]
        before = self.snapshot()
        for invalid in invalid_items:
            args = {"items": [{"id": first["id"], "title": "Must not change", "notes": "New", "read": True}, invalid]}
            with self.subTest(invalid=invalid):
                self.assertTrue(self.request("batch_update_items", args)["isError"])
                self.assertEqual(self.snapshot(), before)
        server.maybe_auto_sync_library.assert_not_called()

    def test_local_only_batch_preserves_metadata_and_does_not_sync(self):
        first, second = self.paper(), self.paper()
        flag = server.create_library_flag("精读")
        server.update_paper_local_state(first["id"], {"flags": [flag["id"]], "viewedAt": "2026-10-29"})
        paths = [server.paper_dir_from_id(item["id"]) / "metadata.json" for item in (first, second)]
        before = {path: path.read_bytes() for path in paths}
        result = self.call("batch_update_items", {"items": [
            {"id": first["id"], "read": True}, {"id": second["id"], "todo": True},
        ]})
        self.assertEqual(result["updatedCount"], 2)
        self.assertEqual({path: path.read_bytes() for path in paths}, before)
        self.assertEqual(server.read_paper(first["id"])["flags"], ["read", flag["id"]])
        self.assertEqual(server.read_paper(first["id"])["viewedAt"], "2026-10-29")
        server.maybe_auto_sync_library.assert_not_called()

    def test_batch_io_failure_returns_partial_results_and_stops(self):
        papers = [self.paper() for _ in range(3)]
        original_write = server.write_json
        failure_path = server.paper_dir_from_id(papers[1]["id"]) / "metadata.json"

        def write(path, data):
            if path == failure_path:
                raise OSError("disk unavailable")
            return original_write(path, data)

        with patch.object(server, "write_json", side_effect=write):
            result = self.request("batch_update_items", {"items": [{"id": item["id"], "title": "Changed"} for item in papers]})
        self.assertTrue(result["isError"])
        payload = json.loads(result["content"][0]["text"])
        self.assertEqual([item["status"] for item in payload["results"]], ["updated", "failed", "skipped"])
        self.assertTrue(payload["results"][1]["possiblePartialWrite"])
        self.assertEqual(payload["updatedCount"], 1)
        self.assertEqual(server.read_paper(papers[0]["id"])["title"], "Changed")
        self.assertEqual(server.read_paper(papers[2]["id"])["title"], papers[2]["title"])
        server.maybe_auto_sync_library.assert_called_once()

    def test_sync_failure_reports_saved_results(self):
        paper = self.paper()
        with patch.object(server, "maybe_auto_sync_library", side_effect=OSError("sync failed")):
            result = self.request("batch_update_items", {"items": [{"id": paper["id"], "title": "Saved"}]})
        self.assertTrue(result["isError"])
        payload = json.loads(result["content"][0]["text"])
        self.assertEqual(payload["updatedCount"], 1)
        self.assertEqual(payload["syncError"], "sync failed")
        self.assertEqual(server.read_paper(paper["id"])["title"], "Saved")

    def test_rename_and_move_subtrees_preserve_articles_and_other_memberships(self):
        server.create_category("A", "child")
        paper = self.paper(["A/child", "C"])
        note = server.add_note_to_db("Note", "A")
        result = self.call("rename_category", {"id": "A", "name": "Renamed"})
        self.assertEqual(result["categoryId"], "Renamed")
        self.assertEqual(result["idMap"], {"A": "Renamed", "A/child": "Renamed/child"})
        moved = self.call("move_category", {"id": "Renamed", "parentId": "B"})
        self.assertEqual(moved["categoryId"], "B/Renamed")
        self.assertEqual(server.read_paper(paper["id"])["categoryIds"], ["B/Renamed/child", "C"])
        self.assertEqual(server.read_paper(note["id"])["categoryIds"], ["B/Renamed"])
        self.assertTrue((server.paper_dir_from_id(paper["id"]) / "paper.pdf").exists())
        self.assertEqual(server.maybe_auto_sync_library.call_count, 2)

    def test_move_reorders_and_rejects_cycles_even_via_sibling(self):
        self.call("move_category", {"id": "C", "beforeId": "A"})
        db = server.load_library_db()
        siblings = [item for item in db["categories"].values() if item["id"] in {"A", "B", "C"}]
        self.assertEqual([item["id"] for item in sorted(siblings, key=lambda item: item["order"])], ["C", "A", "B"])
        server.create_category("A", "child")
        before = self.snapshot()
        for args in ({"id": "A", "parentId": "A/child"}, {"id": "A", "beforeId": "A/child"},
                     {"id": "A", "beforeId": "A"}, {"id": "A", "beforeId": "B", "parentId": "C"}):
            self.assertTrue(self.request("move_category", args)["isError"])
            self.assertEqual(self.snapshot(), before)

    def test_delete_category_preview_and_apply_preserve_articles(self):
        server.create_category("A", "child")
        first, second = self.paper(["A/child", "B"]), self.paper("A")
        before = self.snapshot()
        preview = self.call("delete_category", {"id": "A", "dryRun": True})
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(set(preview["deletedCategoryIds"]), {"A", "A/child"})
        self.assertEqual(preview["affectedCount"], 2)
        server.maybe_auto_sync_library.assert_not_called()
        result = self.call("delete_category", {"id": "A"})
        self.assertEqual(result["affectedCount"], 2)
        self.assertEqual(server.read_paper(first["id"])["categoryIds"], ["B"])
        self.assertEqual(server.read_paper(second["id"])["categoryIds"], ["uncategorized"])
        self.assertTrue((server.paper_dir_from_id(second["id"]) / "paper.pdf").exists())
        server.maybe_auto_sync_library.assert_called_once()

    def test_category_errors_leave_library_unchanged(self):
        before = self.snapshot()
        for name, args in [
            ("rename_category", {"id": "A", "name": "B"}),
            ("rename_category", {"id": "missing", "name": "X"}),
            ("move_category", {"id": "missing"}),
            ("move_category", {"id": "A", "parentId": "missing"}),
            ("delete_category", {"id": "missing"}),
            ("rename_category", {"id": "uncategorized", "name": "X"}),
            ("move_category", {"id": "uncategorized", "parentId": "A"}),
            ("delete_category", {"id": "uncategorized"}),
        ]:
            self.assertTrue(self.request(name, args)["isError"])
            self.assertEqual(self.snapshot(), before)
        server.maybe_auto_sync_library.assert_not_called()

    def test_flag_definitions_reuse_names_and_update_appearance(self):
        flag = self.call("create_flag", {"name": "  精读  "})["flag"]
        self.assertEqual(self.call("create_flag", {"name": "精读"})["flag"]["id"], flag["id"])
        self.assertEqual(self.call("create_flag", {"name": "已读"})["flag"]["id"], "read")
        updated = self.call("update_flag", {"id": flag["id"], "color": "#ABCDEF", "icon": "star"})["flag"]
        self.assertEqual(updated["color"], "#abcdef")
        self.assertEqual(updated["icon"], "star")
        self.assertIn(updated, self.call("list_flags", {})["flags"])
        before = self.snapshot()
        for name, args in [("create_flag", {"name": "x" * 25}), ("create_flag", {"name": "bad\nname"}),
                           ("update_flag", {"id": "missing", "color": "#123456"}),
                           ("update_flag", {"id": flag["id"], "color": "red"})]:
            self.assertTrue(self.request(name, args)["isError"])
            self.assertEqual(self.snapshot(), before)
        server.maybe_auto_sync_library.assert_not_called()

    def test_batch_flags_preview_add_remove_and_clear_with_replacement(self):
        paper, note = self.paper(), server.add_note_to_db("Note", "B")
        flag = server.create_library_flag("待复现")
        server.update_paper_local_state(paper["id"], {"flags": ["read"], "viewedAt": "2026-10-29"})
        args = {"ids": [paper["id"], note["id"], paper["id"]], "flags": [flag["id"], "todo", flag["id"]], "operation": "add"}
        before = self.snapshot()
        preview = self.call("batch_update_flags", {**args, "dryRun": True})
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(preview["count"], 2)
        added = self.call("batch_update_flags", args)
        self.assertEqual(added["changes"][0]["afterFlags"], added["papers"][0]["flags"])
        self.assertEqual(server.read_paper(paper["id"])["flags"], ["read", "todo", flag["id"]])
        self.call("batch_update_flags", {"ids": [paper["id"], note["id"]], "flags": ["todo"], "operation": "remove"})
        self.assertEqual(server.read_paper(paper["id"])["flags"], ["read", flag["id"]])
        self.call("batch_update_items", {"items": [{"id": paper["id"], "flags": [], "read": True}]})
        self.assertEqual(server.read_paper(paper["id"])["flags"], [])
        self.assertEqual(server.read_paper(paper["id"])["viewedAt"], "2026-10-29")
        self.call("update_paper", {"id": note["id"], "flags": []})
        self.assertEqual(server.read_paper(note["id"])["flags"], [])
        server.maybe_auto_sync_library.assert_not_called()

    def test_invalid_late_flag_target_does_not_save_any_assignments(self):
        paper = self.paper()
        before = self.snapshot()
        for args in ({"ids": [paper["id"], "missing"], "flags": ["read"], "operation": "add"},
                     {"ids": [paper["id"]], "flags": ["missing"], "operation": "add"}):
            self.assertTrue(self.request("batch_update_flags", args)["isError"])
            self.assertEqual(self.snapshot(), before)
        server.maybe_auto_sync_library.assert_not_called()

    def test_organization_tools_through_real_stdio(self):
        paper = self.paper("A")
        calls = [
            ("create_flag", {"name": "待复现"}),
            ("list_flags", {}),
            ("update_flag", {"id": "todo", "color": "#123456", "icon": "star"}),
            ("rename_category", {"id": "A", "name": "Research"}),
            ("move_category", {"id": "Research", "parentId": "B"}),
            ("batch_update_items", {"items": [{"id": paper["id"], "title": "Updated via stdio", "categoryIds": ["B/Research"]}]}),
            ("batch_update_flags", {"ids": [paper["id"]], "flags": ["todo"], "operation": "add"}),
            ("delete_category", {"id": "B/Research", "dryRun": True}),
            ("delete_category", {"id": "B/Research"}),
        ]
        messages = [{"jsonrpc": "2.0", "id": index, "method": "tools/call", "params": {"name": name, "arguments": args}}
                    for index, (name, args) in enumerate(calls)]
        path = Path(self.mcp.__file__)
        # Exercise the actual stdio entrypoint, with automatic cloud sync disabled
        # so a user's configured remote service is never contacted by this test.
        bootstrap = ("import runpy, server; server.maybe_auto_sync_library = lambda: None; "
                     "runpy.run_path(" + repr(str(path)) + ", run_name='__main__')")
        result = subprocess.run(
            [sys.executable, "-X", "utf8", "-c", bootstrap], cwd=Path(server.__file__).parent,
            input="\n".join(json.dumps(message) for message in messages) + "\n",
            text=True, encoding="utf-8", capture_output=True, timeout=15,
            env={**os.environ, "PAPER_LIBRARY_DIR": str(self.library)},
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        responses = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertEqual(len(responses), len(calls))
        payloads = []
        for response in responses:
            self.assertFalse(response["result"]["isError"], response)
            payloads.append(json.loads(response["result"]["content"][0]["text"]))
        self.assertEqual(payloads[0]["flag"]["name"], "待复现")
        self.assertEqual(payloads[2]["flag"]["icon"], "star")
        self.assertEqual(payloads[4]["categoryId"], "B/Research")
        self.assertEqual(payloads[5]["updatedCount"], 1)
        self.assertEqual(payloads[6]["papers"][0]["flags"], ["todo"])
        self.assertEqual(payloads[7]["affectedCount"], 1)
        self.assertEqual(server.read_paper(paper["id"])["categoryIds"], ["uncategorized"])
        self.assertEqual(server.read_paper(paper["id"])["title"], "Updated via stdio")
