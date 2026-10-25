import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import server
from backend.pdf_highlights import quote_rectangles
from test_categories import LibraryFixture


class Rect:
    def __init__(self, values):
        self.x0, self.y0, self.x1, self.y1 = values

    @property
    def width(self):
        return self.x1 - self.x0

    @property
    def height(self):
        return self.y1 - self.y0

    @property
    def is_empty(self):
        return self.width <= 0 or self.height <= 0

    def __or__(self, other):
        return Rect((min(self.x0, other.x0), min(self.y0, other.y0), max(self.x1, other.x1), max(self.y1, other.y1)))

    def __and__(self, other):
        return Rect((max(self.x0, other.x0), max(self.y0, other.y0), min(self.x1, other.x1), min(self.y1, other.y1)))

    def __mul__(self, rotation):
        if rotation == 90:
            return Rect((200 - self.y1, self.x0, 200 - self.y0, self.x1))
        return self


class Page:
    def __init__(self, text, rotation=0):
        self.text = text
        self.rotation_matrix = rotation
        self.rect = Rect((0, 0, 200, 500) if rotation else (0, 0, 500, 200))

    def get_text(self, mode=None, **_kwargs):
        if mode != "rawdict":
            return self.text
        return {"blocks": [{"lines": [{"spans": [{"chars": [
            {"c": char, "bbox": (10 + index * 4, 20 + line * 20, 14 + index * 4, 30 + line * 20)}
            for index, char in enumerate(text)
        ]}]} for line, text in enumerate(self.text.splitlines())]}]}


class PDF(list):
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        pass


class MCPAutoHighlightTests(LibraryFixture):
    def setUp(self):
        super().setUp()
        path = Path(server.__file__).parent / "plugins/paper-lantern-research-mcp/scripts/paper_lantern_research_mcp.py"
        spec = importlib.util.spec_from_file_location("mcp_highlight_contract", path)
        self.mcp = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.mcp)
        self.quote = "Our method improves accuracy by forty percent."
        self.page = Page("Research paper background and introduction.\n" + self.quote)
        self.fitz = SimpleNamespace(Rect=Rect, TEXTFLAGS_RAWDICT=255, TEXT_PRESERVE_IMAGES=4,
                                    open=lambda **_kwargs: PDF([self.page]))
        self.native = patch("backend.pdf_highlights.require_pymupdf", return_value=self.fitz)
        self.native.start()
        self.addCleanup(self.native.stop)
        config = patch.object(server, "get_ai_config", return_value=("key", "model", "https://example.test", False))
        config.start()
        self.addCleanup(config.stop)
        llm_patch = patch.object(server, "call_chat_completions", return_value=({"highlights": [
            {"pageNumber": 1, "text": self.quote},
            {"pageNumber": 1, "text": "Invented important results not in this PDF."},
        ]}, {}))
        self.llm = llm_patch.start()
        self.addCleanup(llm_patch.stop)

    def request(self, arguments):
        response = self.mcp.handle_request({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                                            "params": {"name": "auto_highlight_paper", "arguments": arguments}})
        self.assertNotIn("error", response)
        return response["result"]

    def call(self, arguments):
        result = self.request(arguments)
        self.assertFalse(result.get("isError"), result)
        return json.loads(result["content"][0]["text"])

    def test_discovery_and_schema_validation(self):
        tools = {tool["name"]: tool for tool in self.mcp.list_tools()}
        schema = tools["auto_highlight_paper"]["inputSchema"]
        self.assertEqual(schema["required"], ["id"])
        self.assertTrue(schema["properties"]["save"]["default"])
        for args in ({}, {"id": " "}, {"id": 1}, {"id": "paper", "save": "yes"}, {"id": "paper", "typo": True}):
            self.assertTrue(self.request(args)["isError"])
        self.llm.assert_not_called()

    def test_save_preserves_annotations_and_repeated_calls_deduplicate(self):
        paper = self.paper()
        directory = server.paper_dir_from_id(paper["id"])
        manual = {"pageNumber": 1, "color": "green", "comment": "Keep my comment", "selectedText": "Different original text"}
        server.write_json(directory / "highlights.json", [manual])
        first = self.call({"id": paper["id"]})
        self.assertTrue(first["saved"])
        self.assertEqual(first["addedCount"], 1)
        self.assertEqual(first["colorMeaning"], "自动高亮")
        saved = server.read_paper(paper["id"])["highlights"]
        self.assertEqual({key: saved[0][key] for key in manual}, manual)
        self.assertEqual(saved[1]["color"], "purple")
        self.assertEqual(saved[1]["source"], "auto-highlight")
        self.assertTrue((directory / "sync_hash.json").exists())
        server.maybe_auto_sync_library.assert_called_once()
        again = self.call({"id": paper["id"]})
        self.assertEqual(again["addedCount"], 0)
        self.assertEqual(again["duplicateCount"], 1)
        self.assertEqual(server.read_paper(paper["id"])["highlights"], saved)
        server.maybe_auto_sync_library.assert_called_once()

    def test_preview_performs_no_writes_or_sync(self):
        paper = self.paper()
        directory = server.paper_dir_from_id(paper["id"])
        before = {file.name: file.read_bytes() for file in directory.iterdir() if file.is_file()}
        result = self.call({"id": paper["id"], "save": False})
        self.assertFalse(result["saved"])
        self.assertEqual(result["addedCount"], 1)
        self.assertEqual({file.name: file.read_bytes() for file in directory.iterdir() if file.is_file()}, before)
        server.maybe_auto_sync_library.assert_not_called()

    def test_concurrent_annotations_are_reloaded_before_merge(self):
        paper = self.paper()
        directory = server.paper_dir_from_id(paper["id"])
        manual = {"pageNumber": 1, "selectedText": "New manual annotation", "color": "pink"}

        def complete(*_args, **_kwargs):
            server.write_json(directory / "highlights.json", [manual])
            return {"highlights": [{"pageNumber": 1, "text": self.quote}]}, {}

        self.llm.side_effect = complete
        self.call({"id": paper["id"]})
        saved = server.read_paper(paper["id"])["highlights"][0]
        self.assertEqual({key: saved[key] for key in manual}, manual)

    def test_failure_scans_notes_and_modified_pdf_do_not_save(self):
        paper = self.paper()
        path = server.paper_dir_from_id(paper["id"]) / "highlights.json"
        before = path.read_bytes()
        self.llm.side_effect = RuntimeError("provider offline")
        self.assertTrue(self.request({"id": paper["id"]})["isError"])
        self.assertEqual(path.read_bytes(), before)
        self.llm.side_effect = None
        note = server.add_note_to_db("Note", [])
        self.assertTrue(self.request({"id": note["id"]})["isError"])
        self.assertTrue(self.request({"id": "missing"})["isError"])
        self.page.text = ""
        self.assertTrue(self.request({"id": paper["id"]})["isError"])
        self.page.text = "Research paper background and introduction.\n" + self.quote

        def changed_pdf(*_args, **_kwargs):
            (path.parent / "paper.pdf").write_bytes(b"changed PDF")
            return {"highlights": [{"pageNumber": 1, "text": self.quote}]}, {}

        self.llm.side_effect = changed_pdf
        self.assertTrue(self.request({"id": paper["id"]})["isError"])
        self.assertEqual(path.read_bytes(), before)
        server.maybe_auto_sync_library.assert_not_called()

    def test_geometry_cross_line_rotation_and_ambiguous_quotes(self):
        page = Page("An efficient method\nimproves performance.")
        rectangles = quote_rectangles(page, "An efficient method improves performance.")
        self.assertEqual(len(rectangles), 2)
        for rotation in (0, 90):
            page = Page(self.quote, rotation)
            for rect in quote_rectangles(page, self.quote):
                for key in ("left", "top", "width", "height"):
                    self.assertTrue(0 <= rect[key] <= 1)
                self.assertLessEqual(rect["left"] + rect["width"], 1)
                self.assertLessEqual(rect["top"] + rect["height"], 1)
        self.assertEqual(quote_rectangles(Page(self.quote * 2), self.quote), [])
        self.assertEqual(quote_rectangles(Page(self.quote), "not in the original"), [])
