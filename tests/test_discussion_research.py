import tempfile
import json
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import server
from backend import cloud_sync
from backend.discussion_research import MAX_ROUNDS, research_discussion


class ResearchTests(unittest.TestCase):
    def setUp(self):
        self.payload = {"messages": [{"role": "user", "content": "比较方法"}]}
        self.papers = [{"number": 1, "id": "b", "title": "论文B", "summary": "摘要B"}]

    def test_waits_for_answers_then_streams_only_final_text(self):
        decide = Mock(side_effect=[
            {"is_final": False, "requests": [{"paper_number": 1, "question": "实验结果？"}]},
            {"is_final": True},
        ])
        worker = Mock(return_value="正文证据B")
        def final(payload):
            self.assertEqual(worker.call_count, 1)
            self.assertIn("正文证据B", str(payload))
            self.assertIn("摘要B", str(payload))
            return iter(["最终", "回答"])
        events = list(research_discussion(self.payload, self.papers, decide, worker, final))
        self.assertEqual([e["delta"] for e in events if "delta" in e], ["最终", "回答"])
        self.assertEqual(worker.call_args.args, (self.papers[0], "实验结果？"))
        self.assertIn("正文证据B", str(decide.call_args.args))

    def test_direct_final_does_not_consult_workers(self):
        worker = Mock()
        events = list(research_discussion(self.payload, self.papers, lambda _: {"is_final": True}, worker, lambda _: ["回答"]))
        worker.assert_not_called()
        self.assertEqual(events[-1], {"delta": "回答"})

    def test_round_limit_and_worker_failure_are_reported_to_final_model(self):
        decision = {"is_final": False, "requests": [{"paper_number": 1, "question": "问题"}]}
        decide = Mock(return_value=decision)
        worker = Mock(side_effect=RuntimeError("private upstream error"))
        final = Mock(return_value=iter(["有限证据回答"]))
        list(research_discussion(self.payload, self.papers, decide, worker, final))
        self.assertEqual(decide.call_count, MAX_ROUNDS)
        context = str(final.call_args.args[0])
        self.assertIn("查阅失败", context)
        self.assertIn("查阅上限", context)
        self.assertNotIn("private upstream error", context)

    def test_invalid_decisions_never_dispatch_or_stream_final(self):
        for decision in [{}, {"is_final": "false"}, {"is_final": False, "requests": []},
                         {"is_final": False, "requests": [{"paper_number": 9, "question": "?"}]},
                         {"is_final": False, "requests": [{"paper_number": True, "question": "?"}]}]:
            with self.subTest(decision=decision):
                worker, final = Mock(), Mock()
                with self.assertRaises(ValueError):
                    list(research_discussion(self.payload.copy(), self.papers, lambda _: decision, worker, final))
                worker.assert_not_called()
                final.assert_not_called()

    def test_catalog_excludes_current_paper_and_notes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            records = {key: {"id": key, "title": key, "itemType": "note" if key == "note" else "paper"}
                       for key in ("current", "b", "note")}
            with patch("server.load_library_db", return_value={"papers": records}), \
                 patch("server.paper_dir_from_record", return_value=root), \
                 patch("server.read_json", return_value={"threeLineSummary": {"conclusion": "摘要"}}):
                papers = server.load_discussion_papers("current")
            self.assertEqual([p["id"] for p in papers], ["b"])
            self.assertEqual(papers[0]["number"], 1)
            self.assertIn("摘要", papers[0]["summary"])

    def test_server_nonstream_and_stream_use_same_research_flow(self):
        for streaming in (False, True):
            with self.subTest(streaming=streaming), \
                 patch("server.load_discussion_papers", return_value=self.papers), \
                 patch("server.call_chat_completions", return_value=({"is_final": True}, {})), \
                 patch("server.stream_chat_completion", return_value=iter(["回答"])):
                answer = server.discuss_paper("key", "model", "url", "正文", "问题", paper_id="a", stream=streaming)
                if streaming:
                    self.assertEqual("".join(e.get("delta", "") for e in answer), "回答")
                else:
                    self.assertEqual(answer, "回答")

    def test_worker_reads_only_requested_paper_and_question(self):
        decision = {"is_final": False, "requests": [{"paper_number": 1, "question": "实验问题"}]}
        self.papers[0]["directory"] = Path("unused")
        with patch("server.load_discussion_papers", return_value=self.papers), \
             patch("server.call_chat_completions", side_effect=[(decision, {}), ({"is_final": True}, {})]), \
             patch("server.read_text_file", return_value="论文B的正文证据"), \
             patch("server.post_chat_completion", return_value={"choices": [{"message": {"content": "实验答案"}}]}) as post, \
             patch("server.stream_chat_completion", return_value=iter(["最终答案"])):
            answer = server.discuss_paper("key", "model", "url", "当前论文正文", "用户问题", paper_id="a")
        self.assertEqual(answer, "最终答案")
        context = str(post.call_args.args[2]["messages"])
        self.assertIn("论文B的正文证据", context)
        self.assertIn("实验问题", context)
        self.assertNotIn("当前论文正文", context)
        self.assertNotIn("用户问题", context)

    def test_attachments_survive_save_sync_and_upstream_history(self):
        papers = [{"id": "b", "title": "论文B", "authors": ["作者"]}]
        discussion = {"threads": [{"id": "test", "title": "讨论", "messages": [
            {"role": "user", "content": "比较方法", "papers": papers}]}]}
        for normalize in (server.normalize_discussion_payload, cloud_sync.normalize_discussion_payload):
            self.assertEqual(normalize(discussion)["threads"][0]["messages"][0]["papers"], papers)
        messages = server.build_discussion_context_messages(discussion["threads"][0]["messages"])
        self.assertIn("论文B", messages[0]["content"])
        self.assertEqual(set(messages[0]), {"role", "content"})

    def test_selected_catalog_does_not_include_unselected_papers(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            db = {"papers": {key: {"id": key} for key in ("a", "b", "c")}}
            with patch("server.load_library_db", return_value=db), \
                 patch("server.paper_dir_from_record", return_value=root), \
                 patch("server.read_json", return_value={}):
                self.assertEqual([p["id"] for p in server.load_discussion_papers("a", ["b"])], ["b"])
                self.assertEqual(server.load_discussion_papers("a", []), [])

    def test_quick_summary_is_saved_reused_and_preserves_notes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            metadata_file = root / "metadata.json"
            metadata_file.write_text(json.dumps({"title": "B", "notes": "原有笔记"}), encoding="utf-8")
            summary = {"challenges": "挑战", "method": "方法", "conclusion": "结论"}
            def completion(*args, **kwargs):
                # Simulate a user saving notes while the network call runs.
                metadata_file.write_text(json.dumps({"title": "B", "notes": "新笔记"}), encoding="utf-8")
                return summary, {}
            with patch("server.load_library_db", return_value={"papers": {"b": {"id": "b"}}}), \
                 patch("server.paper_dir_from_record", return_value=root), \
                 patch("server.read_discussion_paper_text", return_value="论文正文"), \
                 patch("server.call_chat_completions", side_effect=completion) as call, \
                 patch("server.update_paper_sync_hash"), patch("server.maybe_auto_sync_library"), \
                 patch("server.read_paper", return_value={"id": "b"}):
                server.ensure_discussion_paper_summary("b", "key", "model", "url")
                server.ensure_discussion_paper_summary("b", "key", "model", "url")
            call.assert_called_once()
            metadata = json.loads(metadata_file.read_text(encoding="utf-8"))
            self.assertEqual(metadata["notes"], "新笔记")
            self.assertEqual(metadata["threeLineSummary"], summary)

    def test_invalid_summary_does_not_write_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch("server.load_library_db", return_value={"papers": {"b": {"id": "b"}}}), \
                 patch("server.paper_dir_from_record", return_value=root), \
                 patch("server.read_discussion_paper_text", return_value="正文"), \
                 patch("server.call_chat_completions", return_value=({}, {})), \
                 patch("server.write_json") as write:
                with self.assertRaisesRegex(ValueError, "三行摘要"):
                    server.ensure_discussion_paper_summary("b", "key", "model", "url")
                write.assert_not_called()
