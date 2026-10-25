import importlib.util
import json
from pathlib import Path

import server
from test_categories import LibraryFixture


MCP_PATH = Path(server.__file__).parent / "plugins/paper-lantern-research-mcp/scripts/paper_lantern_research_mcp.py"


class MCPMarkdownTests(LibraryFixture):
    def setUp(self):
        super().setUp()
        spec = importlib.util.spec_from_file_location("mcp_markdown_contract", MCP_PATH)
        self.mcp = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.mcp)

    def call(self, name, args, error=False):
        result = self.mcp.handle_request({
            "jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": {"name": name, "arguments": args},
        })["result"]
        self.assertEqual(result["isError"], error, result)
        return result if error else json.loads(result["content"][0]["text"])

    def test_valid_content_is_preserved_through_all_write_paths(self):
        paper = self.paper()
        link = self.call("make_paper_link", {"paperId": paper["id"]})
        content = (
            f"# Review\n\n$E=mc^2$\n\n$$\n\\begin{{aligned}}\nx &= \\frac{{1}}{{2}}\n\\end{{aligned}}\n$$\n\n"
            f"[Paper](hash:{paper['id']})\n[External](https://example.org/paper)\n"
            "Price: \\$20. `\\(x\\)` and `$example`\n\n```tex\n\\[x\\]\n[demo](hash:missing)\n```\n"
        )
        self.assertIn("hash:", str(link))
        note = self.call("create_note", {"title": "Review", "content": content})["note"]
        self.assertEqual(note["notes"], content)
        self.call("write_note", {"id": note["id"], "content": content})
        self.call("update_paper", {"id": paper["id"], "notes": content})
        self.assertEqual(server.read_paper(paper["id"])["notes"], content)

    def test_invalid_markdown_never_creates_note_or_category(self):
        paper = self.paper()
        invalid = [
            r"\(x\)", r"\[x\]", r"\begin{equation}x\end{equation}",
            r"Bare \frac{1}{2}", "$x", "$$x$", "$$$x$$$", "$x\ny$", "$$$$",
            "[Missing](hash:missing)", f"hash:{paper['id']}",
            f"[Paper](reader.html?id={paper['id']})",
            f"[Paper][ref]\n\n[ref]: hash:{paper['id']}",
            f'<a href="hash:{paper["id"]}">Paper</a>',
        ]
        before = server.load_library_db()
        for content in invalid:
            with self.subTest(content=content):
                error = self.call("create_note", {
                    "title": "Invalid", "categoryIds": ["Must not exist"], "content": content,
                }, error=True)
                self.assertIn("Markdown line", error["content"][0]["text"])
                self.assertEqual(server.load_library_db(), before)
        server.maybe_auto_sync_library.assert_not_called()

    def test_invalid_update_does_not_change_metadata_categories_or_notes(self):
        paper = self.paper()
        self.call("update_paper", {
            "id": paper["id"], "title": "Must not save", "categoryId": "Must not exist",
            "notes": r"\[bad\]", "read": True,
        }, error=True)
        current = server.read_paper(paper["id"])
        self.assertEqual(current["title"], paper["title"])
        self.assertEqual(current["notes"], "")
        self.assertNotIn("Must not exist", server.load_library_db()["categories"])
        server.maybe_auto_sync_library.assert_not_called()

    def test_append_and_prepend_validate_final_content_without_writing(self):
        note = self.call("create_note", {"title": "Review", "content": "$valid$"})["note"]
        for mode in ("append", "prepend", "replace"):
            self.call("write_note", {"id": note["id"], "mode": mode, "content": "$unclosed"}, error=True)
            self.assertEqual(server.read_paper(note["id"])["notes"], "$valid$")
        # Legacy invalid text cannot be retained by appending a valid fragment.
        server.write_paper_notes(server.paper_dir_from_id(note["id"]), r"\(legacy\)")
        self.call("write_note", {"id": note["id"], "mode": "append", "content": "$valid$"}, error=True)
        self.call("write_note", {"id": note["id"], "content": "$fixed$"})

    def test_tool_discovery_advertises_contract_on_every_write_entry(self):
        tools = {tool["name"]: tool for tool in self.mcp.list_tools()}
        for name, field in (("create_note", "content"), ("write_note", "content"), ("update_paper", "notes")):
            self.assertIn("$$...$$", tools[name]["description"])
            self.assertIn("hash:<paper-id>", tools[name]["inputSchema"]["properties"][field]["description"])

    def test_oversize_markdown_is_rejected_instead_of_truncated(self):
        self.call("create_note", {"title": "Too large", "content": "x" * (server.MAX_NOTES_CHARS + 1)}, error=True)
        self.assertEqual(server.load_library_db()["papers"], {})
