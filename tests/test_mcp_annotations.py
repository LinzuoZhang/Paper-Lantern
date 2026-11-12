import importlib.util
import io
import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import server
from test_categories import LibraryFixture


class MCPAnnotationTests(LibraryFixture):
    def setUp(self):
        super().setUp()
        path = Path(server.__file__).parent / "plugins/paper-lantern-research-mcp/scripts/paper_lantern_research_mcp.py"
        spec = importlib.util.spec_from_file_location("mcp_annotations_contract", path)
        self.mcp = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.mcp)
        self.item = self.paper()
        self.path = server.paper_dir_from_id(self.item["id"]) / "highlights.json"
        self.rect = {"pageNumber": 1, "left": 0.1, "top": 0.2, "width": 0.3, "height": 0.04,
                     "groupId": "existing", "selectedText": "Original quotation", "color": "green"}

    def request(self, name, args):
        response = self.mcp.handle_request({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                                            "params": {"name": name, "arguments": args}})
        self.assertNotIn("error", response)
        return response["result"]

    def call(self, name, **args):
        result = self.request(name, {"id": self.item["id"], **args})
        self.assertFalse(result["isError"], result)
        return json.loads(result["content"][0]["text"])

    def saved(self):
        return json.loads(self.path.read_text(encoding="utf-8"))

    def mock_pdf(self):
        pdf = unittest.mock.MagicMock()
        pdf.__enter__.return_value = [object()]
        return patch("backend.pdf_highlights.require_pymupdf", return_value=SimpleNamespace(open=lambda *_args: pdf))

    def test_discovery_and_strict_input_validation(self):
        schemas = {tool["name"]: tool["inputSchema"] for tool in self.mcp.list_tools()}
        for name in ("get_paper_highlights", "get_paper_annotations", "add_paper_highlight", "add_paper_annotation"):
            self.assertIn(name, schemas)
            self.assertFalse(schemas[name]["additionalProperties"])
            self.assertTrue(self.request(name, {})["isError"])
        cases = [
            ("get_paper_highlights", {"pageNumber": 0}),
            ("get_paper_annotations", {"color": "unknown"}),
            ("get_paper_highlights", {"id": " "}),
            ("get_paper_highlights", {"typo": True}),
            ("add_paper_highlight", {"pageNumber": True, "text": "quote"}),
            ("add_paper_highlight", {"pageNumber": 1, "text": " "}),
            ("add_paper_highlight", {"pageNumber": 1, "text": "quote", "color": "unknown"}),
            ("add_paper_annotation", {"groupId": "existing", "content": " "}),
            ("add_paper_annotation", {"groupId": "existing", "content": "ok", "type": "system"}),
        ]
        before = self.path.read_bytes()
        for name, args in cases:
            with self.subTest(name=name, args=args):
                self.assertTrue(self.request(name, {"id": self.item["id"], **args})["isError"])
        self.assertEqual(self.path.read_bytes(), before)
        server.maybe_auto_sync_library.assert_not_called()

    def test_reads_group_rectangles_filter_and_preserve_legacy_files(self):
        values = [{**self.rect, "comment": "Old comment", "translation": "旧翻译"},
                  {**self.rect, "top": 0.3},
                  {**self.rect, "pageNumber": 2, "groupId": "plain", "color": "red", "text": []}]
        server.write_json(self.path, values)
        before = self.path.read_bytes(), self.path.stat().st_mtime_ns
        result = self.call("get_paper_highlights")
        self.assertEqual(result["total"], 2)
        group = result["groups"][0]
        self.assertEqual(len(group["highlights"]), 2)
        self.assertEqual([entry["content"] for entry in group["entries"]], ["旧翻译", "Old comment"])
        self.assertEqual(self.call("get_paper_annotations")["total"], 1)
        self.assertEqual(self.call("get_paper_annotations", pageNumber=2)["total"], 0)
        self.assertEqual(self.call("get_paper_highlights", color="red")["groups"][0]["groupId"], "plain")
        self.assertEqual((self.path.read_bytes(), self.path.stat().st_mtime_ns), before)
        server.maybe_auto_sync_library.assert_not_called()

    def test_append_updates_every_rectangle_and_keeps_entries_and_unrelated_data(self):
        original = {**self.rect, "source": "auto-highlight", "custom": {"keep": True},
                    "text": [{"id": "old", "type": "comment", "content": "Keep me"}], "comment": "Keep me"}
        other = {**self.rect, "groupId": "other"}
        server.write_json(self.path, [original, {**original, "top": 0.3}, other])
        result = self.call("add_paper_annotation", groupId="existing", content=" 新批注 ")
        self.assertEqual(result["entry"]["content"], "新批注")
        self.call("add_paper_annotation", groupId="existing", content="Translation", type="translation")
        saved = self.saved()
        for rect in saved[:2]:
            self.assertEqual([entry["content"] for entry in rect["text"]], ["Translation", "Keep me", "新批注"])
            self.assertEqual(rect["text"][1]["id"], "old")
            self.assertEqual(rect["comment"], "Keep me")
            self.assertEqual(rect["translation"], "Translation")
            self.assertEqual(rect["type"], "comment-translation")
            self.assertEqual(rect["custom"], {"keep": True})
            self.assertEqual(rect["source"], "auto-highlight")
        self.assertEqual({key: saved[2][key] for key in other}, other)
        self.assertTrue((self.path.parent / "sync_hash.json").exists())
        self.assertEqual(server.maybe_auto_sync_library.call_count, 2)
        self.assertEqual(server.read_paper(self.item["id"])["highlights"], saved)

    def test_paginated_annotation_reads_keep_total_and_all_groups(self):
        server.write_json(self.path, [{**self.rect, "groupId": f"g{i}", "comment": f"Comment {i}"} for i in range(7)])
        first = self.call("get_paper_annotations", limit=5)
        self.assertEqual(first["total"], 7)
        self.assertEqual(first["nextOffset"], 5)
        second = self.call("get_paper_annotations", offset=first["nextOffset"], limit=5)
        self.assertEqual(len(second["groups"]), 2)
        self.assertIsNone(second["nextOffset"])
        self.assertEqual({group["groupId"] for group in first["groups"] + second["groups"]}, {f"g{i}" for i in range(7)})

    def test_legacy_group_and_string_entries_can_be_annotated(self):
        rect = {key: value for key, value in self.rect.items() if key != "groupId"}
        server.write_json(self.path, [{**rect, "text": ["First"], "translation": "Legacy translation"}])
        group = self.call("get_paper_annotations")["groups"][0]
        self.assertEqual(group["groupId"], "1:0.10000:0.20000:0.30000:0.04000")
        self.call("add_paper_annotation", groupId=group["groupId"], content="Second")
        self.assertEqual([entry["content"] for entry in self.saved()[0]["text"]], ["Legacy translation", "First", "Second"])

    def test_highlight_add_and_duplicate_preserve_existing_annotations(self):
        server.write_json(self.path, [{**self.rect, "comment": "Keep"}])
        rectangles = [{"left": 0.1, "top": 0.4, "width": 0.3, "height": 0.02},
                      {"left": 0.1, "top": 0.5, "width": 0.2, "height": 0.02}]
        with self.mock_pdf(), patch("backend.pdf_highlights.quote_rectangles", return_value=rectangles), \
                patch.object(server, "get_ai_config", side_effect=AssertionError("No AI required")):
            result = self.call("add_paper_highlight", pageNumber=1, text="New original quotation", color="orange")
            self.assertTrue(result["added"])
            self.assertEqual(len(result["group"]["highlights"]), 2)
            self.assertEqual(result["group"]["color"], "orange")
            saved = self.saved()
            self.assertEqual({key: saved[0][key] for key in self.rect}, self.rect)
            self.assertEqual(saved[0]["comment"], "Keep")
            duplicate = self.call("add_paper_highlight", pageNumber=1, text="New original\nquotation")
            self.assertFalse(duplicate["added"])
            self.assertEqual(duplicate["group"]["groupId"], result["group"]["groupId"])
            self.assertEqual(self.saved(), saved)
            server.maybe_auto_sync_library.assert_called_once()
        self.call("add_paper_annotation", groupId=result["group"]["groupId"], content="Useful result")

    def test_invalid_targets_quotes_and_corrupt_storage_never_overwrite(self):
        before = self.path.read_bytes()
        with self.mock_pdf(), patch("backend.pdf_highlights.quote_rectangles", return_value=[]):
            for args in ({"pageNumber": 2, "text": "quote"}, {"pageNumber": 1, "text": "not present"}):
                self.assertTrue(self.request("add_paper_highlight", {"id": self.item["id"], **args})["isError"])
        self.assertTrue(self.request("add_paper_annotation", {"id": self.item["id"], "groupId": "missing", "content": "Test"})["isError"])
        self.assertEqual(self.path.read_bytes(), before)
        note = server.add_note_to_db("Note", [])
        for target in ("missing", note["id"], "../../outside"):
            for name in ("get_paper_highlights", "get_paper_annotations", "add_paper_highlight", "add_paper_annotation"):
                args = {"id": target}
                if name == "add_paper_highlight":
                    args.update(pageNumber=1, text="Original quotation")
                if name == "add_paper_annotation":
                    args.update(groupId="existing", content="Test")
                self.assertTrue(self.request(name, args)["isError"])
        for value in ('{"broken":', '{}', '[null]'):
            self.path.write_text(value, encoding="utf-8")
            self.assertTrue(self.request("get_paper_annotations", {"id": self.item["id"]})["isError"])
            self.assertTrue(self.request("add_paper_annotation", {"id": self.item["id"], "groupId": "existing", "content": "Test"})["isError"])
            self.assertTrue(self.request("add_paper_highlight", {"id": self.item["id"], "pageNumber": 1, "text": "Test"})["isError"])
            self.assertEqual(self.path.read_text(encoding="utf-8"), value)
        server.maybe_auto_sync_library.assert_not_called()

    def test_missing_highlights_file_reads_empty_and_annotation_does_not_create_it(self):
        self.path.unlink()
        self.assertEqual(self.call("get_paper_highlights")["groups"], [])
        self.assertTrue(self.request("add_paper_annotation", {"id": self.item["id"], "groupId": "missing", "content": "Test"})["isError"])
        self.assertFalse(self.path.exists())

    def test_real_pdf_quotation_to_annotation_round_trip(self):
        try:
            import fitz
        except ImportError:
            self.skipTest("PyMuPDF is optional")
        with fitz.open() as pdf:
            page = pdf.new_page()
            page.insert_text((50, 50), "Exact original quotation.\nSecond line of evidence.")
            content = pdf.tobytes()
        paper = server.add_paper_to_db("Real PDF", [], io.BytesIO(content))
        self.item = paper
        self.path = server.paper_dir_from_id(paper["id"]) / "highlights.json"
        result = self.call("add_paper_highlight", pageNumber=1, text="Exact original quotation. Second line of evidence.")
        self.assertEqual(len(result["group"]["highlights"]), 2)
        self.call("add_paper_annotation", groupId=result["group"]["groupId"], content="Cross-line comment")
        group = self.call("get_paper_annotations")["groups"][0]
        self.assertEqual(group["entries"][0]["content"], "Cross-line comment")
        self.assertTrue(all(rect["comment"] == "Cross-line comment" for rect in group["highlights"]))
        for rect in group["highlights"]:
            self.assertTrue(0 <= rect["left"] < rect["left"] + rect["width"] <= 1)
            self.assertTrue(0 <= rect["top"] < rect["top"] + rect["height"] <= 1)
        self.assertEqual((self.path.parent / "paper.pdf").read_bytes(), content)
