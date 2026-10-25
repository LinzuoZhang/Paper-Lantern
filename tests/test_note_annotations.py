import io
import json
import unittest
from unittest.mock import patch

import server


class NoteAnnotationTests(unittest.TestCase):
    def test_ai_requests_use_note_context(self):
        result = {"choices": [{"message": {"content": "结果"}}]}
        with patch("server.post_chat_completion", return_value=result) as call:
            self.assertEqual(server.translate_text("key", "model", "url", "gradient", "短笔记", context_type="note"), "结果")
            payload = call.call_args.args[2]
            self.assertIn("笔记", payload["messages"][0]["content"])
            self.assertIn("Note context:\n短笔记", payload["messages"][1]["content"])
            self.assertEqual(server.explain_selected_text("key", "model", "url", "短笔记", "梯度", context_type="note"), "结果")
            payload = call.call_args.args[2]
            self.assertIn("笔记", payload["messages"][0]["content"])
            self.assertIn("Full note context:\n短笔记", payload["messages"][1]["content"])

    def test_short_notes_can_be_explained_and_papers_keep_length_check(self):
        for context_type, expected_status in [("note", 200), ("paper", 400)]:
            with self.subTest(context_type=context_type):
                payload = json.dumps({"selectedText": "梯度", "paperText": "短笔记", "contextType": context_type}).encode()
                handler = server.PaperReaderHandler.__new__(server.PaperReaderHandler)
                handler.path = "/api/explain"
                handler.headers = {"Content-Length": str(len(payload))}
                handler.rfile = io.BytesIO(payload)
                results = []
                handler._send_json = lambda code, data: results.append((code, data))
                with patch("server.get_ai_config", return_value=("key", "model", "url", False)), \
                     patch("server.explain_selected_text", return_value="解释") as explain:
                    handler.do_POST()
                self.assertEqual(results[0][0], expected_status)
                if context_type == "note":
                    self.assertEqual(explain.call_args.kwargs["context_type"], "note")
                    self.assertEqual(results[0][1]["explanation"], "解释")
                else:
                    explain.assert_not_called()


if __name__ == "__main__":
    unittest.main()
