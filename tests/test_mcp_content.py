"""Content retrieval contracts, including exact offsets and versioned citations."""

import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import server
from backend.paper_content import PASSAGE_CHARS
from test_categories import LibraryFixture

try:
    import fitz as native_fitz
except ImportError:
    native_fitz = None


class MCPContentFixture(LibraryFixture):
    def setUp(self):
        super().setUp()
        path = Path(server.__file__).parent / "plugins/paper-lantern-research-mcp/scripts/paper_lantern_research_mcp.py"
        spec = importlib.util.spec_from_file_location("mcp_content_contract", path)
        self.mcp = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.mcp)
        self.no_pdf = patch.dict("sys.modules", {"fitz": None})
        self.no_pdf.start()
        self.addCleanup(self.no_pdf.stop)

    def request(self, name, args):
        result = self.mcp.handle_request({"jsonrpc": "2.0", "id": 9, "method": "tools/call",
                                          "params": {"name": name, "arguments": args}})
        self.assertEqual(result["id"], 9)
        self.assertNotIn("error", result)
        return result["result"]

    def call(self, name, args):
        result = self.request(name, args)
        self.assertFalse(result["isError"], result)
        return json.loads(result["content"][0]["text"])

    def cache(self, paper, text):
        directory = server.paper_dir_from_id(paper["id"])
        server.write_text_file(directory / server.EXTRACTED_TEXT_FILE, text)
        return directory

    def metadata(self, paper, **values):
        directory = server.paper_dir_from_id(paper["id"])
        metadata = server.read_json(directory / "metadata.json", {})
        server.write_json(directory / "metadata.json", {**metadata, **values})
        return directory


class MCPContentTests(MCPContentFixture):
    def test_stdio_content_search_and_passage_readback(self):
        paper = self.paper()
        self.metadata(paper, abstract="机器人 evidence")
        original = self.call("get_paper_passages", {"hash": paper["id"], "source": "abstract"})["passages"][0]
        messages = [
            {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {
                "name": "search_paper_content", "arguments": {"query": "机器人", "sources": ["abstract"]}}},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {
                "name": "get_paper_passages", "arguments": {"hash": paper["id"], "source": "abstract",
                                                          "passageIds": [original["passageId"]]}}},
        ]
        process = subprocess.run(
            [sys.executable, "-X", "utf8", self.mcp.__file__],
            input="\n".join(json.dumps(message, ensure_ascii=False) for message in messages) + "\n",
            encoding="utf-8", capture_output=True, timeout=15,
            env={**os.environ, "PAPER_LIBRARY_DIR": str(self.library)},
        )
        self.assertEqual(process.returncode, 0, process.stderr)
        responses = [json.loads(line) for line in process.stdout.splitlines()]
        self.assertEqual([item["id"] for item in responses], [1, 2])
        for response in responses:
            self.assertFalse(response["result"]["isError"], response)
        found, fetched = [json.loads(item["result"]["content"][0]["text"]) for item in responses]
        self.assertEqual(found["matches"][0]["passageId"], original["passageId"])
        self.assertEqual(fetched["passages"], [original])

    def test_searches_every_source_without_ai_migration_or_file_writes(self):
        paper = self.paper(["A", "B"])
        directory = self.metadata(paper, abstract="机器人 abstract", threeLineSummary={"method": "机器人 summary"},
                                  notes="机器人 legacy notes")
        (directory / server.NOTES_FILE).unlink(missing_ok=True)
        self.cache(paper, "机器人 正文 evidence")
        before = {path.relative_to(self.library): path.read_bytes() for path in self.library.rglob("*") if path.is_file()}
        with patch.object(server, "get_ai_config") as config, patch.object(server, "read_paper_notes") as migrate:
            result = self.call("search_paper_content", {"query": "机器人"})
            self.assertEqual(result["searchedPaperCount"], 1)
            self.assertEqual(result["matchedPaperCount"], 1)
            self.assertEqual({item["source"] for item in result["matches"]}, {"abstract", "summary", "notes", "full_text"})
            for item in result["matches"]:
                self.assertEqual(item["hash"], paper["id"])
                self.assertEqual(item["categoryIds"], ["A", "B"])
                self.assertIn(f"hash:{paper['id']}", item["paperLink"])
                fetched = self.call("get_paper_passages", {"hash": paper["id"], "source": item["source"],
                                                          "passageIds": [item["passageId"]]})
                self.assertEqual(fetched["passages"][0]["text"], item["text"])
            config.assert_not_called()
            migrate.assert_not_called()
        after = {path.relative_to(self.library): path.read_bytes() for path in self.library.rglob("*") if path.is_file()}
        self.assertEqual(before, after)
        self.assertFalse((directory / server.NOTES_FILE).exists())
        server.maybe_auto_sync_library.assert_not_called()

    def test_current_notes_file_overrides_legacy_notes_and_abstract_fallback(self):
        paper = self.paper()
        directory = self.metadata(paper, basicInfo={"abstract": "Fallback evidence"}, notes="Obsolete evidence")
        server.write_text_file(directory / server.NOTES_FILE, "Current evidence")
        result = self.call("search_paper_content", {"query": "evidence", "sources": ["abstract", "notes"]})
        self.assertEqual(result["totalMatches"], 2)
        self.assertEqual(result["warnings"], [])
        notes = next(item for item in result["matches"] if item["source"] == "notes")
        self.assertEqual(notes["text"], "Current evidence")

    def test_literal_unicode_matching_all_any_and_relevance(self):
        first, second = self.paper(), self.paper()
        self.cache(first, "ＦＬＯＷ\nMatching flow 机器人")
        self.cache(second, "Flow alone")
        options = {"query": "FLOW matching flow", "sources": ["full_text"]}
        result = self.call("search_paper_content", options)
        self.assertEqual(result["terms"], ["flow", "matching"])
        self.assertEqual([item["hash"] for item in result["matches"]], [first["id"]])
        self.assertEqual(result["matches"][0]["text"], "ＦＬＯＷ\nMatching flow 机器人")
        any_result = self.call("search_paper_content", {**options, "match": "any"})
        self.assertEqual([item["hash"] for item in any_result["matches"]], [first["id"], second["id"]])
        self.assertEqual(self.call("search_paper_content", {"query": ".*", "sources": ["full_text"]})["totalMatches"], 0)

    def test_scope_intersects_hashes_categories_and_excludes_notes_and_archives(self):
        server.create_category("A", "child")
        first, second, archived = self.paper(["A/child", "B"]), self.paper("A"), self.paper("A")
        for paper in (first, second, archived):
            self.metadata(paper, abstract="scope")
        server.add_note_to_db("scope standalone note", "A")
        server.archive_item(archived["id"])
        options = {"query": "scope", "sources": ["abstract"], "categoryIds": ["A", "B"], "categoryMatch": "all"}
        result = self.call("search_paper_content", options)
        self.assertEqual([item["hash"] for item in result["matches"]], [first["id"]])
        self.assertEqual(self.call("search_paper_content", {**options, "includeDescendants": False})["totalMatches"], 0)
        self.assertEqual(self.call("search_paper_content", {**options, "hashes": [second["id"]]})["searchedPaperCount"], 0)
        self.assertEqual(self.call("search_paper_content", {**options, "hashes": []})["totalMatches"], 0)
        result = self.call("search_paper_content", {**options, "categoryIds": [], "hashes": [first["id"], first["id"]]})
        self.assertEqual(result["totalMatches"], 1)
        self.assertEqual(self.call("search_paper_content", {"query": "scope", "sources": ["abstract"], "categoryId": "A"})["totalMatches"], 2)

    def test_search_pagination_is_stable_and_counts_before_limit(self):
        for _ in range(4):
            self.metadata(self.paper(), abstract="Evidence")
        args = {"query": "Evidence", "sources": ["abstract"]}
        all_matches = self.call("search_paper_content", args)["matches"]
        first = self.call("search_paper_content", {**args, "limit": 2})
        second = self.call("search_paper_content", {**args, "limit": 2, "offset": first["nextOffset"]})
        self.assertEqual(first["totalMatches"], 4)
        self.assertEqual(first["matches"] + second["matches"], all_matches)
        self.assertIsNone(second["nextOffset"])
        self.assertEqual(self.call("search_paper_content", {**args, "offset": 99})["matches"], [])

    def test_bounded_overlapping_passages_keep_exact_cache_offsets(self):
        paper = self.paper()
        text = "前言😀\n" + "x" * (PASSAGE_CHARS - 12) + "BoundaryNeedle\n" + "long evidence " * 300
        self.cache(paper, text)
        result = self.call("get_paper_passages", {"hash": paper["id"], "limit": 1})
        passages = list(result["passages"])
        while result["nextOffset"] is not None:
            result = self.call("get_paper_passages", {"hash": paper["id"], "limit": 1,
                                                       "offset": result["nextOffset"], "sourceVersion": result["sourceVersion"]})
            passages.extend(result["passages"])
        self.assertGreater(len(passages), 2)
        self.assertEqual(passages[-1]["endChar"], len(text))
        for passage in passages:
            self.assertEqual(passage["text"], text[passage["startChar"]:passage["endChar"]])
            self.assertLessEqual(len(passage["text"]), PASSAGE_CHARS)
            self.assertIsNone(passage["pageNumber"])
            self.assertEqual(passage["offsetScope"], "source")
        found = self.call("search_paper_content", {"query": "BoundaryNeedle", "sources": ["full_text"]})
        self.assertGreater(found["totalMatches"], 0)
        ids = [passages[-1]["passageId"], passages[0]["passageId"], passages[-1]["passageId"]]
        selected = self.call("get_paper_passages", {"hash": paper["id"], "passageIds": ids})
        self.assertEqual(selected["passages"], [passages[-1], passages[0]])
        self.assertTrue(self.request("get_paper_passages", {"hash": paper["id"], "pageNumbers": [1]})["isError"])

    def test_stale_cross_article_and_cross_source_ids_are_rejected(self):
        first, second = self.paper(), self.paper()
        for paper in (first, second):
            self.cache(paper, "Same original text")
        original = self.call("get_paper_passages", {"hash": first["id"]})
        args = {"hash": first["id"], "passageIds": [original["passages"][0]["passageId"]]}
        self.assertTrue(self.request("get_paper_passages", {**args, "hash": second["id"]})["isError"])
        self.assertTrue(self.request("get_paper_passages", {**args, "source": "notes"})["isError"])
        self.cache(first, "Changed original text")
        self.assertTrue(self.request("get_paper_passages", args)["isError"])
        self.assertTrue(self.request("get_paper_passages", {"hash": first["id"], "sourceVersion": original["sourceVersion"]})["isError"])

    def test_unreadable_text_warns_but_keeps_metadata_hits(self):
        paper = self.paper()
        self.metadata(paper, abstract="Available evidence")
        result = self.call("search_paper_content", {"query": "evidence"})
        self.assertEqual(result["totalMatches"], 1)
        self.assertEqual(result["warnings"][0]["hash"], paper["id"])
        self.assertEqual(result["warnings"][0]["source"], "full_text")
        self.assertTrue(self.request("get_paper_passages", {"hash": paper["id"]})["isError"])
        self.assertEqual(self.call("get_paper_passages", {"hash": paper["id"], "source": "notes"})["passages"], [])
        self.assertEqual(self.call("search_paper_content", {"query": "absent"})["totalMatches"], 0)

    def test_missing_article_directory_is_a_warning_during_library_search(self):
        paper = self.paper()
        with patch.object(self.mcp, "article_metadata", side_effect=FileNotFoundError("missing directory")):
            result = self.call("search_paper_content", {"query": "evidence"})
        self.assertEqual(result["totalMatches"], 0)
        self.assertEqual(result["warnings"], [{"hash": paper["id"], "message": "missing directory"}])

    def test_discovery_and_validation(self):
        paper = self.paper()
        note = server.add_note_to_db("Note", "A")
        self.cache(paper, "Evidence")
        tools = {tool["name"]: tool for tool in self.mcp.list_tools()}
        for name in ("search_paper_content", "get_paper_passages"):
            self.assertFalse(tools[name]["inputSchema"]["additionalProperties"])
            self.assertTrue(self.request(name, {})["isError"])
        searches = [{"query": value} for value in (" ", 1, "x" * 2001, " ".join(f"t{i}" for i in range(33)))]
        searches += [{"query": "x", **extra} for extra in (
            {"sources": []}, {"sources": ["unknown"]}, {"sources": "notes"}, {"limit": 0}, {"limit": 51},
            {"offset": -1}, {"offset": True}, {"match": "bad"}, {"categoryMatch": "bad"},
            {"categoryIds": [5]}, {"hashes": ["unknown"]}, {"hashes": [note["id"]]},
            {"hashes": "bad"}, {"includeDescendants": 1}, {"unexpected": 1},
        )]
        for args in searches:
            with self.subTest(args=args):
                self.assertTrue(self.request("search_paper_content", args)["isError"])
        for extra in ({"pageNumbers": [0]}, {"pageNumbers": [True]}, {"pageNumbers": []}, {"pageNumbers": "1"},
                      {"passageIds": []}, {"passageIds": [" "]}, {"passageIds": ["bad"]},
                      {"passageIds": ["bad"], "pageNumbers": [1]}, {"source": "notes", "pageNumbers": [1]},
                      {"hash": "../../outside"}, {"hash": note["id"]}, {"limit": 51}, {"source": "bad"},
                      {"sourceVersion": " "}, {"offset": -1}, {"hash": 1}, {"unexpected": 1}):
            with self.subTest(extra=extra):
                self.assertTrue(self.request("get_paper_passages", {"hash": paper["id"], **extra})["isError"])

    def test_page_extraction_preserves_blank_page_numbers_and_prefers_pdf(self):
        paper = self.paper()
        self.cache(paper, "Stale cache text")
        texts = ["First page evidence\n", "", "Third page evidence\n"]

        class PDF(list):
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                pass

        fake_fitz = SimpleNamespace(open=lambda _path: PDF([
            SimpleNamespace(get_text=lambda text=text: text) for text in texts
        ]))
        with patch.dict("sys.modules", {"fitz": fake_fitz}):
            result = self.call("get_paper_passages", {"hash": paper["id"], "pageNumbers": [3, 1, 3]})
            self.assertEqual(result["pageCount"], 3)
            self.assertEqual([item["pageNumber"] for item in result["passages"]], [1, 3])
            for item in result["passages"]:
                self.assertEqual(item["offsetScope"], "page")
                self.assertEqual(item["text"], texts[item["pageNumber"] - 1][item["startChar"]:item["endChar"]])
            self.assertEqual(self.call("get_paper_passages", {"hash": paper["id"], "pageNumbers": [2]})["passages"], [])
            self.assertTrue(self.request("get_paper_passages", {"hash": paper["id"], "pageNumbers": [4]})["isError"])
            found = self.call("search_paper_content", {"query": "Third", "sources": ["full_text"]})["matches"][0]
            self.assertEqual(found["pageNumber"], 3)
            fetched = self.call("get_paper_passages", {"hash": paper["id"], "passageIds": [found["passageId"]]})
            self.assertEqual(fetched["passages"][0]["text"], found["text"])


@unittest.skipIf(native_fitz is None, "PyMuPDF is optional")
class NativeMCPContentTests(MCPContentFixture):
    def test_real_pdf_search_and_page_selection(self):
        with native_fitz.open() as pdf:
            pdf.new_page().insert_text((72, 72), "First page: baseline evidence.")
            pdf.new_page()
            pdf.new_page().insert_text((72, 72), "Third page: robot experiments.")
            content = pdf.tobytes()
        paper = server.add_paper_to_db("Native passages", "A", io.BytesIO(content))
        directory = server.paper_dir_from_id(paper["id"])
        with patch.dict("sys.modules", {"fitz": native_fitz}):
            found = self.call("search_paper_content", {"query": "robot", "sources": ["full_text"]})
            self.assertEqual(found["warnings"], [])
            self.assertEqual(found["matches"][0]["pageNumber"], 3)
            passages = self.call("get_paper_passages", {"hash": paper["id"], "pageNumbers": [3]})
            self.assertEqual(passages["pageCount"], 3)
            self.assertIn("robot experiments", passages["passages"][0]["text"])
        self.assertFalse((directory / server.EXTRACTED_TEXT_FILE).exists())
        server.maybe_auto_sync_library.assert_not_called()
