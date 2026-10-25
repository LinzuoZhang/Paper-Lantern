import io
import json
import unittest
from unittest.mock import patch

import server
from backend.auto_highlight import BATCH_CHARS, normalize_pages, select_important_quotes


class AutoHighlightTests(unittest.TestCase):
    def setUp(self):
        self.quote = "Our method reduces memory usage by forty percent."
        self.pages = [{"pageNumber": 2, "text": "Introduction and background. " + self.quote + " Further details of the experiments."}]

    def test_rejects_invented_wrong_page_ambiguous_and_duplicate_quotes(self):
        result = select_important_quotes(self.pages, lambda _: {"highlights": [
            {"pageNumber": 2, "text": self.quote},
            {"pageNumber": 2, "text": self.quote},
            {"pageNumber": 1, "text": self.quote},
            {"pageNumber": 2, "text": "This is an invented important finding."},
            {"pageNumber": True, "text": self.quote},
            {"pageNumber": 2, "text": "method"},
            None,
        ]})
        self.assertEqual(result, [{"pageNumber": 2, "text": self.quote}])
        repeated = [{"pageNumber": 2, "text": self.quote * 2}]
        self.assertEqual(select_important_quotes(repeated, lambda _: {"highlights": result}), [])

    def test_handles_whitespace_and_ligatures(self):
        pages = [{"pageNumber": 1, "text": "An efﬁcient method improves performance.\nMore details."}]
        quote = {"pageNumber": 1, "text": "An efficient method improves performance."}
        self.assertEqual(select_important_quotes(pages, lambda _: {"highlights": [quote]}), [quote])

    def test_processes_late_pages_and_oversized_pages_without_truncation(self):
        pages = [{"pageNumber": 1, "text": "x" * (BATCH_CHARS + 12)}, *self.pages]
        prompts = []

        def complete(prompt):
            prompts.append(prompt)
            return {"highlights": [{"pageNumber": 2, "text": self.quote}]}

        self.assertEqual(select_important_quotes(pages, complete), [{"pageNumber": 2, "text": self.quote}])
        self.assertEqual(len(prompts), 2)
        self.assertIn(self.quote, prompts[-1])

    def test_input_validation_and_empty_ai_result(self):
        for value in (None, [], [{"pageNumber": True, "text": "a" * 100}],
                      self.pages * 2, [{"pageNumber": 1, "text": ""}],
                      [{"pageNumber": 1, "text": "a" * 500001}]):
            with self.subTest(value=str(value)[:100]), self.assertRaises(ValueError):
                normalize_pages(value)
        self.assertEqual(normalize_pages(self.pages), self.pages)
        self.assertEqual(select_important_quotes(self.pages, lambda _: {"highlights": []}), [])
        with self.assertRaises(RuntimeError):
            select_important_quotes(self.pages, lambda _: {"summary": "wrong format"})

    def request(self, payload):
        # Dispatch the real HTTP handler with an in-memory request body.
        handler = object.__new__(server.PaperReaderHandler)
        handler.path = "/api/auto-highlight"
        body = json.dumps(payload).encode()
        handler.headers = {"Content-Length": str(len(body))}
        handler.rfile = io.BytesIO(body)
        replies = []
        handler._send_json = lambda status, data: replies.append((status, data))
        with patch("server.get_ai_config", return_value=("test-key", "model", "https://example.test", False)):
            handler.do_POST()
        return replies[0]

    def test_route_uses_configured_llm_and_returns_validated_quotes(self):
        expected = [{"pageNumber": 2, "text": self.quote}]
        with patch("server.call_chat_completions", return_value=({"highlights": expected}, {})) as call:
            self.assertEqual(self.request({"pages": self.pages}), (200, {"highlights": expected}))
        self.assertEqual(call.call_args.args[:3], ("test-key", "model", "https://example.test"))
        with patch("server.call_chat_completions") as call:
            self.assertEqual(self.request({"pages": []})[0], 400)
            call.assert_not_called()
        with patch("server.call_chat_completions", side_effect=RuntimeError("provider offline")):
            self.assertEqual(self.request({"pages": self.pages})[0], 500)


if __name__ == "__main__":
    unittest.main()
