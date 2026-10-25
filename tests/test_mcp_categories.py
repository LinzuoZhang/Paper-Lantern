import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import server
from test_categories import LibraryFixture


MCP_PATH = Path(server.__file__).parent / "plugins/paper-lantern-research-mcp/scripts/paper_lantern_research_mcp.py"


class MCPCategoryTests(LibraryFixture):
    def setUp(self):
        super().setUp()
        spec = importlib.util.spec_from_file_location("mcp_categories_contract", MCP_PATH)
        self.mcp = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.mcp)

    def request(self, name, arguments):
        response = self.mcp.handle_request({
            "jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": {"name": name, "arguments": arguments},
        })
        self.assertEqual(response["id"], 1)
        self.assertNotIn("error", response)
        return response["result"]

    def call(self, name, arguments):
        result = self.request(name, arguments)
        self.assertFalse(result.get("isError"), result)
        return json.loads(result["content"][0]["text"])

    def test_tool_discovery_exposes_multi_category_contract(self):
        response = self.mcp.handle_request({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
        schemas = {tool["name"]: tool["inputSchema"] for tool in response["result"]["tools"]}
        for name in ("start_import", "import_paper_from_url", "create_note", "update_paper", "search_library", "set_item_categories", "add_item_categories", "remove_item_categories"):
            self.assertEqual(schemas[name]["properties"]["categoryIds"]["type"], "array", name)
        for name in ("set_item_categories", "add_item_categories", "remove_item_categories"):
            self.assertIn("categoryIds", schemas[name]["required"])
        self.assertEqual(schemas["search_library"]["properties"]["categoryMatch"]["enum"], ["any", "all"])

    def test_dedicated_tools_replace_add_remove_and_clear_memberships(self):
        paper = self.paper("A")
        for tool, ids, expected in [
            ("set_item_categories", ["A", "B"], ["A", "B"]),
            ("add_item_categories", ["B", "C", "C"], ["A", "B", "C"]),
            ("remove_item_categories", ["A", "B"], ["C"]),
            ("set_item_categories", [], ["uncategorized"]),
        ]:
            with self.subTest(tool=tool):
                result = self.call(tool, {"id": paper["id"], "categoryIds": ids})
                self.assertEqual(result["paper"]["categoryIds"], expected)
                self.assertEqual(len(result["paper"]["categoryNames"]), len(expected))
        self.assertTrue((server.paper_dir_from_id(paper["id"]) / "paper.pdf").exists())

    def test_remove_parent_option_retains_memberships_outside_subtree(self):
        server.create_category("A", "child")
        paper = self.paper(["A", "A/child", "B"])
        direct = self.call("remove_item_categories", {"id": paper["id"], "categoryIds": ["A"]})
        self.assertEqual(direct["paper"]["categoryIds"], ["A/child", "B"])
        subtree = self.call("remove_item_categories", {"id": paper["id"], "categoryIds": ["A"], "includeDescendants": True})
        self.assertEqual(subtree["paper"]["categoryIds"], ["B"])

    def test_combined_update_applies_in_order_and_saves_other_fields(self):
        paper = self.paper("C")
        result = self.call("update_paper", {
            "id": paper["id"], "categoryIds": ["A", "B"],
            "addCategoryIds": ["B", "C"], "removeCategoryIds": ["A", "C"],
            "title": "Updated paper", "notes": "Shared reading notes",
        })
        self.assertEqual(result["paper"]["categoryIds"], ["B"])
        self.assertEqual(result["paper"]["title"], "Updated paper")
        self.assertEqual(result["paper"]["notes"], "Shared reading notes")
        server.maybe_auto_sync_library.assert_called_once()

    def test_invalid_combined_update_does_not_apply_partial_changes(self):
        paper = self.paper("A")
        for extra in ({"removeCategoryIds": ["missing"]}, {"removeCategoryIds": "A"}, {"addCategoryIds": [None]}):
            with self.subTest(extra=extra):
                result = self.request("update_paper", {"id": paper["id"], "categoryIds": ["B"], "title": "Must not be saved", "notes": "Must not be saved", **extra})
                self.assertTrue(result["isError"])
                loaded = server.read_paper(paper["id"])
                self.assertEqual(loaded["categoryIds"], ["A"])
                self.assertEqual(loaded["title"], paper["title"])
                self.assertEqual(loaded["notes"], "")
        server.maybe_auto_sync_library.assert_not_called()

    def test_schema_rejects_bad_arrays_and_unknown_parameters(self):
        paper = self.paper("A")
        for arguments in (
            {"id": paper["id"], "categoryIds": "B"},
            {"id": paper["id"], "categoryIds": [1]},
            {"id": paper["id"], "categoryIds": [" "]},
            {"id": paper["id"]},
            {"id": paper["id"], "categoryIds": ["B"], "typo": True},
            [paper["id"], "B"],
        ):
            with self.subTest(arguments=arguments):
                self.assertTrue(self.request("set_item_categories", arguments)["isError"])
                self.assertEqual(server.read_paper(paper["id"])["categoryIds"], ["A"])

    def test_empty_add_remove_are_noops_and_read_todo_do_not_sync(self):
        paper = self.paper(["A", "B"])
        for tool in ("add_item_categories", "remove_item_categories"):
            self.assertEqual(self.call(tool, {"id": paper["id"], "categoryIds": []})["paper"]["categoryIds"], ["A", "B"])
        server.maybe_auto_sync_library.reset_mock()
        result = self.call("update_paper", {"id": paper["id"], "read": True, "todo": True})
        self.assertTrue(result["paper"]["read"])
        self.assertTrue(result["paper"]["todo"])
        server.maybe_auto_sync_library.assert_not_called()

    def test_multi_category_search_supports_any_all_and_exact_matching(self):
        server.create_category("A", "child")
        first = self.paper(["A", "A/child", "B"])
        second = self.paper("A/child")
        note = server.add_note_to_db("Shared note", ["B", "C"])
        unclassified = self.paper([])
        cases = [
            ({"categoryIds": ["A", "B"]}, {first["id"], second["id"], note["id"]}),
            ({"categoryIds": ["A", "B"], "categoryMatch": "all"}, {first["id"]}),
            ({"categoryIds": ["A"], "includeDescendants": False}, {first["id"]}),
            ({"categoryId": "A"}, {first["id"], second["id"]}),
            ({"categoryIds": ["uncategorized", "B"]}, {first["id"], note["id"], unclassified["id"]}),
            ({"categoryIds": [], "categoryId": "A"}, {first["id"], second["id"], note["id"], unclassified["id"]}),
            ({"categoryIds": ["missing"]}, set()),
            ({"categoryIds": ["A", "B"], "itemType": "note"}, {note["id"]}),
        ]
        for args, expected in cases:
            with self.subTest(args=args):
                result = self.call("search_library", args)
                ids = [item["id"] for item in result["matches"]]
                self.assertEqual(set(ids), expected)
                self.assertEqual(len(ids), len(expected))
                self.assertEqual(result["totalMatches"], len(expected))
        limited = self.call("search_library", {"categoryIds": ["A", "B"], "limit": 1})
        self.assertEqual(limited["totalMatches"], 3)
        self.assertEqual(len(limited["matches"]), 1)

    def test_overview_reports_unique_counts_and_all_category_names(self):
        server.create_category("A", "child")
        first = self.paper(["A", "A/child", "B"])
        self.paper("A/child")
        overview = self.call("library_overview", {})
        self.assertEqual(overview["itemCount"], 2)
        categories = {item["id"]: item for item in overview["categories"]}
        self.assertEqual(categories["A"]["directItemCount"], 1)
        self.assertEqual(categories["A"]["itemCount"], 2)
        summary = next(item for item in overview["recentItems"] if item["id"] == first["id"])
        self.assertEqual(summary["categoryIds"], ["A", "A/child", "B"])
        self.assertEqual(summary["categoryNames"], ["A", "child", "B"])
        self.assertEqual(summary["categoryId"], "A")
        self.assertEqual(self.call("get_item", {"id": first["id"]})["item"]["categoryIds"], summary["categoryIds"])

    def test_note_creation_and_updates_share_the_same_membership_contract(self):
        result = self.call("create_note", {"title": "Research notes", "content": "Keep this content", "categoryIds": ["B", "C"]})
        note = result["note"]
        self.assertEqual(note["categoryIds"], ["B", "C"])
        updated = self.call("set_item_categories", {"id": note["id"], "categoryIds": ["A"]})["paper"]
        self.assertEqual(updated["categoryIds"], ["A"])
        self.assertEqual(updated["notes"], "Keep this content")
        self.call("archive_item", {"id": note["id"]})
        self.assertEqual(self.call("restore_item", {"id": note["id"]})["item"]["categoryIds"], ["A"])

    def test_import_tools_forward_multi_categories_and_keep_legacy_precedence(self):
        with patch.object(server, "start_import", return_value={"jobId": "job", "state": "queued"}) as start:
            for tool in ("start_import", "import_paper_from_url"):
                self.call(tool, {"url": "https://example.com/paper.pdf", "categoryIds": ["B", "A"], "categoryId": "C"})
                start.assert_called_with("https://example.com/paper.pdf", "", ["A", "B"])
            self.call("start_import", {"url": "https://example.com/paper.pdf", "categoryId": "C"})
            start.assert_called_with("https://example.com/paper.pdf", "", ["C"])
            start.reset_mock()
            self.assertTrue(self.request("start_import", {"url": "https://example.com/paper.pdf", "categoryIds": "A"})["isError"])
            start.assert_not_called()

    def test_legacy_category_update_can_create_paths_but_arrays_require_existing_categories(self):
        paper = self.paper()
        result = self.call("update_paper", {"id": paper["id"], "categoryId": "New/child"})
        self.assertEqual(result["paper"]["categoryIds"], ["New/child"])
        self.call("update_paper", {"id": paper["id"], "categoryIds": ["B"], "categoryId": "Ignored"})
        self.assertNotIn("Ignored", server.load_library_db()["categories"])
        self.assertTrue(self.request("set_item_categories", {"id": paper["id"], "categoryIds": ["Missing"]})["isError"])


class MCPStdioTests(unittest.TestCase):
    def test_discovery_validation_and_search_through_stdio(self):
        messages = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
            {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "search_library", "arguments": {"categoryIds": "bad"}}},
            {"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "search_library", "arguments": {"categoryIds": [], "categoryMatch": "all"}}},
        ]
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run(
                [sys.executable, "-X", "utf8", str(MCP_PATH)],
                input="\n".join(json.dumps(message) for message in messages) + "\n",
                text=True, encoding="utf-8", capture_output=True, timeout=15,
                env={**os.environ, "PAPER_LIBRARY_DIR": directory},
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        responses = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertEqual([response["id"] for response in responses], [1, 2, 3, 4])
        self.assertEqual(responses[0]["result"]["serverInfo"]["version"], "0.3.0")
        self.assertIn("auto_highlight_paper", {tool["name"] for tool in responses[1]["result"]["tools"]})
        self.assertIn("remove_item_categories", {tool["name"] for tool in responses[1]["result"]["tools"]})
        self.assertTrue(responses[2]["result"]["isError"])
        search = json.loads(responses[3]["result"]["content"][0]["text"])
        self.assertEqual(search["totalMatches"], 0)


if __name__ == "__main__":
    unittest.main()
