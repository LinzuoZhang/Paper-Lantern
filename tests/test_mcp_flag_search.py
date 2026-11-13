"""MCP flag filtering uses the same local state as the library UI."""

import importlib.util
import json
from pathlib import Path
from unittest.mock import patch

import server
from test_categories import LibraryFixture


class MCPFlagSearchTests(LibraryFixture):
    def setUp(self):
        super().setUp()
        path = Path(server.__file__).parent / "plugins/paper-lantern-research-mcp/scripts/paper_lantern_research_mcp.py"
        spec = importlib.util.spec_from_file_location("mcp_flag_search", path)
        self.mcp = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.mcp)

    def request(self, args, name="search_papers_by_flags"):
        response = self.mcp.handle_request({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                                            "params": {"name": name, "arguments": args}})
        self.assertNotIn("error", response)
        return response["result"]

    def call(self, args, name="search_papers_by_flags"):
        result = self.request(args, name)
        self.assertFalse(result["isError"], result)
        return json.loads(result["content"][0]["text"])

    def test_any_all_custom_flags_and_paper_only_scope(self):
        flag = server.create_library_flag("Reproduce")["id"]
        both = self.paper(["A", "B"])
        custom = self.paper()
        read = self.paper()
        self.paper()  # Unflagged.
        note = server.add_note_to_db("Flagged note", "A")
        archived = self.paper()
        for item, flags in ((both, ["read", flag]), (custom, [flag]), (read, ["read"]),
                            (note, [flag]), (archived, [flag])):
            server.update_paper_local_state(item["id"], {"flags": flags})
        self.call({"id": archived["id"]}, "archive_item")
        result = self.call({"flags": ["read", flag, flag]})
        self.assertEqual(result["flags"], ["read", flag])
        self.assertEqual(result["match"], "any")
        self.assertEqual(result["totalMatches"], 3)
        self.assertEqual({item["id"] for item in result["matches"]}, {both["id"], custom["id"], read["id"]})
        result = self.call({"flags": ["read", flag], "match": "all"})
        self.assertEqual(result["totalMatches"], 1)
        item = result["matches"][0]
        self.assertEqual(item["id"], both["id"])
        self.assertEqual(item["categoryIds"], ["A", "B"])
        self.assertEqual(item["flags"], ["read", flag])
        self.assertTrue(item["read"])
        self.assertFalse(item["todo"])
        self.assertEqual(self.call({"flags": ["todo"]})["matches"], [])
        server.maybe_auto_sync_library.assert_not_called()

    def test_legacy_read_todo_and_local_overrides(self):
        paper = self.paper()
        path = server.paper_dir_from_id(paper["id"]) / "metadata.json"
        metadata = server.read_json(path, {})
        metadata.update(read=True, todo=True, tags=["read"])
        server.write_json(path, metadata)
        self.assertEqual(self.call({"flags": ["read", "todo"], "match": "all"})["totalMatches"], 1)
        server.update_paper_local_state(paper["id"], {"read": False, "todo": False})
        self.assertEqual(self.call({"flags": ["read", "todo"]})["totalMatches"], 0)

    def test_pagination_defaults_order_and_out_of_range(self):
        papers = [self.paper() for _ in range(32)]
        for paper in papers:
            server.update_paper_local_state(paper["id"], {"todo": True})
        db = server.load_library_db()
        for record in db["papers"].values():
            record["uploadedAt"] = "2026-01-01T00:00:00+00:00"
        newest = papers[0]["id"]
        db["papers"][newest]["uploadedAt"] = "2026-02-01T00:00:00+00:00"
        server.save_library_db(db)
        first = self.call({"flags": ["todo"]})
        self.assertEqual(first["offset"], 0)
        self.assertEqual(len(first["matches"]), 30)
        self.assertEqual(first["totalMatches"], 32)
        self.assertEqual(first["nextOffset"], 30)
        last = self.call({"flags": ["todo"], "offset": first["nextOffset"]})
        self.assertIsNone(last["nextOffset"])
        actual = [item["id"] for item in first["matches"] + last["matches"]]
        self.assertEqual(actual, [newest] + sorted(paper["id"] for paper in papers if paper["id"] != newest))
        self.assertEqual(len(self.call({"flags": ["todo"], "limit": 1})["matches"]), 1)
        beyond = self.call({"flags": ["todo"], "offset": 100})
        self.assertEqual(beyond["matches"], [])
        self.assertEqual(beyond["totalMatches"], 32)
        self.assertIsNone(beyond["nextOffset"])

    def test_invalid_arguments_and_unknown_ids(self):
        for args in ({}, {"flags": []}, {"flags": "read"}, {"flags": [1]}, {"flags": [" "]},
                     {"flags": ["missing"]}, {"flags": ["read", "missing"]}, {"flags": ["read"] * 103},
                     {"flags": ["read"], "match": "none"}, {"flags": ["read"], "offset": -1},
                     {"flags": ["read"], "offset": True}, {"flags": ["read"], "limit": 0},
                     {"flags": ["read"], "limit": 201}, {"flags": ["read"], "query": "Paper"}):
            with self.subTest(args=args):
                self.assertTrue(self.request(args)["isError"])

    def test_read_only_discovery_and_successful_search_preserve_files(self):
        paper = self.paper()
        server.update_paper_local_state(paper["id"], {"todo": True})
        snapshot = lambda: {str(path.relative_to(self.library)): (path.read_bytes(), path.stat().st_mtime_ns)
                            for path in self.library.rglob("*") if path.is_file()}
        before = snapshot()
        with patch.dict("os.environ", {"PAPER_LANTERN_MCP_READ_ONLY": "1"}), patch.object(
            server, "load_library_db", side_effect=AssertionError("Must not write manifest")
        ), patch.object(server, "load_paper_flags", wraps=server.load_paper_flags) as load_flags:
            self.assertIn("search_papers_by_flags", {tool["name"] for tool in self.mcp.list_tools()})
            result = self.call({"flags": ["todo"]})
            self.assertEqual([item["id"] for item in result["matches"]], [paper["id"]])
            load_flags.assert_called_once_with()
            catalog = self.call({"names": ["search_papers_by_flags"]}, "agent_capabilities")
            self.assertEqual(catalog["tools"][0]["effect"], "read")
            self.assertFalse(catalog["tools"][0]["approvalRequired"])
        self.assertEqual(snapshot(), before)
        server.maybe_auto_sync_library.assert_not_called()
