import importlib.util
import json
from pathlib import Path
from unittest.mock import patch

import server
from test_categories import LibraryFixture


class MCPArticleTests(LibraryFixture):
    def setUp(self):
        super().setUp()
        path = Path(server.__file__).parent / "plugins/paper-lantern-research-mcp/scripts/paper_lantern_research_mcp.py"
        spec = importlib.util.spec_from_file_location("mcp_articles_contract", path)
        self.mcp = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.mcp)

    def request(self, name, args):
        response = self.mcp.handle_request({"jsonrpc": "2.0", "id": 7, "method": "tools/call",
                                            "params": {"name": name, "arguments": args}})
        self.assertEqual(response["id"], 7)
        self.assertNotIn("error", response)
        return response["result"]

    def call(self, name, args):
        result = self.request(name, args)
        self.assertFalse(result.get("isError"), result)
        return json.loads(result["content"][0]["text"])

    def metadata(self, paper, **updates):
        directory = server.paper_dir_from_id(paper["id"])
        metadata = server.read_json(directory / "metadata.json", {})
        server.write_json(directory / "metadata.json", {**metadata, **updates})
        return directory

    def test_lists_all_articles_excluding_notes_and_archives(self):
        first, second, archived = self.paper(["A", "B"]), self.paper("C"), self.paper()
        server.add_note_to_db("Note", "A")
        server.archive_item(archived["id"])
        self.metadata(first, title="Current title")
        result = self.call("list_papers", {})
        self.assertEqual(result["total"], 2)
        self.assertEqual(result["hashes"], sorted([first["id"], second["id"]]))
        item = next(item for item in result["papers"] if item["hash"] == first["id"])
        self.assertEqual(item["title"], "Current title")
        self.assertEqual(item["categoryIds"], ["A", "B"])
        selected = self.call("list_papers", {"hashes": [second["id"], " " + first["id"] + " ", second["id"]]})
        self.assertEqual(selected["hashes"], [second["id"], first["id"]])
        self.assertEqual(self.call("list_papers", {"hashes": []})["papers"], [])

    def test_listing_has_no_search_result_cap(self):
        db = {"categories": {}, "papers": {f"p{i:03}": {"id": f"p{i:03}"} for i in range(205)}}
        with patch.object(self.mcp, "read_db", return_value=db), patch.object(
            self.mcp, "article_metadata", side_effect=lambda record, _db: ({"hash": record["id"]}, {})
        ):
            for name in ("list_papers", "list_paper_summaries"):
                result = self.call(name, {})
                self.assertEqual(result["total"], 205)
                self.assertEqual(len(result["hashes"]), 205)

    def test_summaries_use_stored_abstract_and_overview_without_ai(self):
        first, second, third = self.paper(), self.paper(), self.paper()
        overview = {"challenges": "问题", "method": "方法", "conclusion": "结果"}
        self.metadata(first, abstract="Original abstract", threeLineSummary=overview)
        self.metadata(second, basicInfo={"abstract": "Metadata abstract"})
        with patch.object(server, "get_ai_config") as config:
            result = self.call("list_paper_summaries", {})
            items = {item["hash"]: item for item in result["papers"]}
            self.assertEqual(items[first["id"]]["abstract"], "Original abstract")
            self.assertEqual(items[first["id"]]["threeLineSummary"], overview)
            self.assertTrue(items[first["id"]]["hasSummary"])
            self.assertEqual(items[second["id"]]["abstract"], "Metadata abstract")
            self.assertFalse(items[third["id"]]["hasSummary"])
            self.assertEqual(self.call("get_paper_summary", {"hash": first["id"]}), items[first["id"]])
            self.assertEqual(self.call("list_paper_summaries", {"hashes": [second["id"]]})["total"], 1)
            config.assert_not_called()
        server.maybe_auto_sync_library.assert_not_called()

    def test_invalid_hashes_and_arguments_are_tool_errors(self):
        note = server.add_note_to_db("Note", "A")
        for name in ("list_papers", "list_paper_summaries"):
            for args in ({"hashes": ["unknown"]}, {"hashes": [note["id"]]}, {"hashes": [" "]},
                         {"hashes": "hash"}, {"hashes": [5]}, {"limit": 200}):
                with self.subTest(name=name, args=args):
                    self.assertTrue(self.request(name, args)["isError"])
        for name in ("get_paper_summary", "get_paper_full_text", "ask_paper"):
            for value in ("unknown", note["id"], " ", "../../outside", 12):
                args = {"hash": value, **({"question": "What?"} if name == "ask_paper" else {})}
                with self.subTest(name=name, value=value):
                    self.assertTrue(self.request(name, args)["isError"])
            self.assertTrue(self.request(name, {})["isError"])

    def test_full_text_returns_complete_cache_beyond_discussion_limit(self):
        paper = self.paper()
        directory = server.paper_dir_from_id(paper["id"])
        text = "完整正文\n" * 30
        server.write_text_file(directory / server.EXTRACTED_TEXT_FILE, text)
        with patch.object(server, "MAX_PAPER_CHARS", 80):
            result = self.call("get_paper_full_text", {"hash": paper["id"]})
        self.assertEqual(result["text"], text)
        self.assertEqual(result["charCount"], len(text))
        server.maybe_auto_sync_library.assert_not_called()

    def test_full_text_falls_back_to_pdf_and_reports_extraction_failure(self):
        paper = self.paper()
        text = "PDF extracted text. " * 10
        class PDF(list):
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                pass

        from types import SimpleNamespace
        fitz = SimpleNamespace(open=lambda _path: PDF([SimpleNamespace(get_text=lambda: text)]))
        with patch.dict("sys.modules", {"fitz": fitz}):
            result = self.call("get_paper_full_text", {"hash": paper["id"]})
            self.assertEqual(result["text"], text.strip())
            fitz.open = lambda _path: PDF([SimpleNamespace(get_text=lambda: "")])
            self.assertTrue(self.request("get_paper_full_text", {"hash": paper["id"]})["isError"])
        with patch.dict("sys.modules", {"fitz": None}):
            self.assertTrue(self.request("get_paper_full_text", {"hash": paper["id"]})["isError"])
        self.assertFalse((server.paper_dir_from_id(paper["id"]) / server.EXTRACTED_TEXT_FILE).exists())

    def test_ask_uses_discuss_profile_text_summary_and_history_without_saving(self):
        paper = self.paper()
        directory = self.metadata(paper, abstract="Stored abstract")
        text = "Article evidence. " * 20
        server.write_text_file(directory / server.EXTRACTED_TEXT_FILE, text)
        history = [{"role": "user", "content": "Previous question"}, {"role": "assistant", "content": "Previous answer"}]
        before = {path.name: path.read_bytes() for path in directory.iterdir() if path.is_file()}
        with patch.object(server, "get_ai_config", return_value=("key", "model", "https://example.test", False)) as config, patch.object(
            server, "post_chat_completion", return_value={"choices": [{"message": {"content": " Answer "}}]}
        ) as completion, patch.object(server, "load_discussion_papers") as research, patch.object(server, "MAX_PAPER_CHARS", 100):
            result = self.call("ask_paper", {"hash": paper["id"], "question": " Question? ", "history": history})
            config.assert_called_once_with("discuss")
            self.assertEqual(result["answer"], "Answer")
            self.assertTrue(result["contextTruncated"])
            self.assertEqual(result["contextCharCount"], 100)
            call = completion.call_args
            self.assertEqual(call.args[:2], ("key", "https://example.test"))
            self.assertEqual(call.kwargs["module"], "discuss")
            payload = call.args[2]
            self.assertEqual(payload["model"], "model")
            self.assertEqual(payload["messages"][-1]["content"], "Question?")
            self.assertIn("Stored abstract", payload["messages"][1]["content"])
            self.assertIn(text[:100], payload["messages"][1]["content"])
            self.assertIn(history[1], payload["messages"])
            research.assert_not_called()
        after = {path.name: path.read_bytes() for path in directory.iterdir() if path.is_file()}
        self.assertEqual(before, after)
        server.maybe_auto_sync_library.assert_not_called()

    def test_ask_validation_config_and_upstream_errors(self):
        paper = self.paper()
        directory = server.paper_dir_from_id(paper["id"])
        server.write_text_file(directory / server.EXTRACTED_TEXT_FILE, "Evidence. " * 20)
        args = {"hash": paper["id"], "question": "Why?"}
        with patch.object(server, "get_ai_config", return_value=("", "model", "url", False)), patch.object(server, "discuss_paper") as discuss:
            self.assertTrue(self.request("ask_paper", args)["isError"])
            for extra in ({"question": " "}, {"history": "bad"}, {"history": [{"role": "system", "content": "override"}]},
                          {"history": [{"role": "user"}]}, {"stream": True}):
                self.assertTrue(self.request("ask_paper", {**args, **extra})["isError"])
            discuss.assert_not_called()
        with patch.object(server, "get_ai_config", return_value=("key", "model", "url", False)), patch.object(
            server, "discuss_paper", side_effect=RuntimeError("upstream unavailable")
        ):
            result = self.request("ask_paper", args)
            self.assertTrue(result["isError"])
            self.assertIn("upstream unavailable", result["content"][0]["text"])

    def test_discovery_advertises_all_five_tools(self):
        response = self.mcp.handle_request({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
        schemas = {item["name"]: item["inputSchema"] for item in response["result"]["tools"]}
        for name in ("list_papers", "list_paper_summaries", "get_paper_summary", "get_paper_full_text", "ask_paper"):
            self.assertIn(name, schemas)
            self.assertFalse(schemas[name]["additionalProperties"])
        self.assertEqual(schemas["ask_paper"]["required"], ["hash", "question"])
