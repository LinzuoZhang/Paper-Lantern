"""The Agent's stdio reads must not rewrite manifests or migrate notes."""

import importlib.util
import json
from pathlib import Path
from unittest.mock import patch

import server
from test_categories import LibraryFixture


class MCPReadOnlyTests(LibraryFixture):
    def setUp(self):
        super().setUp()
        path = Path(server.__file__).parent / "plugins/paper-lantern-research-mcp/scripts/paper_lantern_research_mcp.py"
        spec = importlib.util.spec_from_file_location("mcp_read_only_contract", path)
        self.mcp = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.mcp)
        self.mode = patch.dict("os.environ", {"PAPER_LANTERN_MCP_READ_ONLY": "1"})
        self.mode.start()
        self.addCleanup(self.mode.stop)

    def call(self, name, args):
        return self.mcp.handle_request({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                                        "params": {"name": name, "arguments": args}})["result"]

    def snapshot(self):
        return {str(path.relative_to(self.library)): (path.read_bytes(), path.stat().st_mtime_ns)
                for path in self.library.rglob("*") if path.is_file()}

    def test_reads_preserve_every_file_and_timestamp(self):
        paper = self.paper(["A", "B"])
        directory = server.paper_dir_from_id(paper["id"])
        metadata = server.read_json(directory / "metadata.json", {})
        metadata.update(abstract="Control evidence", notes="Legacy notes")
        server.write_json(directory / "metadata.json", metadata)
        (directory / server.NOTES_FILE).unlink(missing_ok=True)
        server.write_text_file(directory / server.EXTRACTED_TEXT_FILE, "Original control evidence. " * 5)
        before = self.snapshot()
        with patch.object(server, "load_library_db", side_effect=AssertionError("Must not call writing loader")):
            for name, args in (
                ("library_overview", {}), ("search_library", {"query": "Paper"}), ("list_papers", {}),
                ("list_paper_summaries", {}), ("get_paper_summary", {"hash": paper["id"]}),
                ("get_paper_full_text", {"hash": paper["id"]}),
                ("search_paper_content", {"query": "control", "sources": ["abstract", "notes"]}),
                ("get_paper_passages", {"hash": paper["id"], "source": "notes"}),
                ("get_item", {"id": paper["id"]}), ("list_flags", {}), ("agent_capabilities", {}),
            ):
                with self.subTest(name=name):
                    result = self.call(name, args)
                    self.assertFalse(result["isError"], result)
        self.assertEqual(self.snapshot(), before)
        server.maybe_auto_sync_library.assert_not_called()

    def test_mutations_and_migrating_readers_are_hidden_and_rejected(self):
        paper = self.paper()
        before = self.snapshot()
        exposed = {tool["name"] for tool in self.mcp.list_tools()}
        self.assertEqual(exposed, set(self.mcp.READ_ONLY_TOOLS))
        for name, args in (("create_note", {"title": "No write"}), ("delete_item", {"id": paper["id"]}),
                           ("auto_highlight_paper", {"id": paper["id"]}), ("ask_paper", {"hash": paper["id"], "question": "Why?"})):
            result = self.call(name, args)
            self.assertTrue(result["isError"])
            self.assertIn("read-only", result["content"][0]["text"])
        self.assertEqual(self.snapshot(), before)

    def test_search_pagination_covers_all_uncategorized_papers_without_duplicates(self):
        expected = {self.paper([])["id"] for _ in range(35)}
        self.paper(["A"])
        before = self.snapshot()
        seen, offset = [], 0
        while offset is not None:
            result = self.call("search_library", {"categoryIds": ["uncategorized"], "itemType": "paper",
                                                   "offset": offset, "limit": 30})
            self.assertFalse(result["isError"], result)
            page = json.loads(result["content"][0]["text"])
            self.assertEqual(page["totalMatches"], 35)
            seen.extend(item["id"] for item in page["matches"])
            offset = page["nextOffset"]
        self.assertEqual(set(seen), expected)
        self.assertEqual(len(seen), 35)
        self.assertEqual(self.snapshot(), before)

    def test_legacy_or_missing_manifest_errors_without_creating_or_migrating(self):
        db = json.loads(server.DB_FILE.read_text(encoding="utf-8"))
        db["version"] = 1
        server.DB_FILE.write_text(json.dumps(db), encoding="utf-8")
        before = self.snapshot()
        self.assertTrue(self.call("list_papers", {})["isError"])
        self.assertEqual(self.snapshot(), before)
        self.assertFalse(server.DB_FILE.with_name("library_db.v1.backup.json").exists())
        server.DB_FILE.unlink()
        self.assertTrue(self.call("list_papers", {})["isError"])
        self.assertFalse(server.DB_FILE.exists())
