"""Goal-driven execution, correction, hard validation and HTTP/SSE integration."""

import copy
import builtins
import importlib.util
import json
import threading
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import AsyncMock, patch

import server
from backend.paper_analysis import (
    MAX_ROUNDS, READ_CHARS, analyze_paper, normalize_goals, run_analysis,
    text_format_errors, validate_result,
)


HAS_LANGGRAPH = importlib.util.find_spec("langgraph") is not None
PAPER = "Original Paper Title\nAuthors: Alice\n" + "The model uses attention to aggregate context. " * 10
METHOD = {"methodOverview": "通过注意力聚合上下文。", "methodSections": [
    {"title": "上下文聚合", "motivation": "", "content": "以注意力权重聚合输入信息，得到上下文表示。"}],
    "methodConclusion": "聚合结果用于预测；输入范围限制了可获得的上下文。"}
KEYWORDS = {"keywords": ["attention"], "keywordExplanations": {"attention": "注意力，对输入加权以聚合上下文。"}}


def calls(*actions):
    return {"role": "assistant", "content": "", "tool_calls": [
        {"id": f"call-{index}", "type": "function", "function": {
            "name": name, "arguments": json.dumps(arguments, ensure_ascii=False)}}
        for index, (name, arguments) in enumerate(actions)]}


class ValidationTests(unittest.TestCase):
    def test_goal_validation(self):
        self.assertEqual(normalize_goals(["method", "keywords", "method"]), ["method", "keywords"])
        for value in ([], "method", {}, ["unknown"], [None]):
            with self.subTest(value=value), self.assertRaises(ValueError):
                normalize_goals(value)

    def test_required_fields_types_explanations_and_no_silent_drops(self):
        self.assertFalse(validate_result(KEYWORDS, ["keywords"]))
        for result in ({"keywords": "attention", "keywordExplanations": {}},
                       {"keywords": ["attention"], "keywordExplanations": {}},
                       {"keywords": ["attention", "Attention"], "keywordExplanations": {"attention": "解释"}},
                       {"keywords": ["attention"], "keywordExplanations": {"attention": 4}},
                       {**KEYWORDS, "unexpected": True}):
            with self.subTest(result=result):
                self.assertTrue(validate_result(result, ["keywords"]))
        self.assertTrue(validate_result({}, ["method"]))
        invalid = copy.deepcopy(METHOD)
        invalid["methodSections"].append({"title": "缺失正文"})
        self.assertTrue(validate_result(invalid, ["method"]))

    def test_formula_format_errors_include_actionable_paths(self):
        for text in ("未闭合 $x", "$x_{a$", "$P_target$", "正文$$x$$正文", "错误\theta", "$x$$"):
            with self.subTest(text=text):
                self.assertTrue(text_format_errors(text, "methodSections[0].content"))
        for text in ("正文 $x_{target}$。", "正文\n\n$$x_{target}$$\n\n解释", r"符号 \(x\)。", r"价格 \$10"):
            with self.subTest(text=text):
                self.assertFalse(text_format_errors(text, "content"))

    def test_method_sections_above_old_fixed_limit_survive_save_normalization(self):
        sections = [{"title": f"阶段{i}", "motivation": "", "content": "步骤解释"} for i in range(8)]
        self.assertEqual(len(server.normalize_method_sections(sections)), 8)


@unittest.skipUnless(HAS_LANGGRAPH, "Install requirements-reading-agent.txt for LangGraph tests")
class GraphTests(unittest.IsolatedAsyncioTestCase):
    async def run_graph(self, replies, goals=None, goal="", text=PAPER):
        self.events = []
        self.model = type("Model", (), {"complete": AsyncMock(side_effect=replies)})()
        return await analyze_paper(text, goals, goal, self.model, self.events.append)

    async def test_model_chooses_method_before_keywords_without_fixed_pipeline(self):
        result, raw = await self.run_graph([
            calls(("read_paper", {"start": 0})),
            calls(("update_result", {"patch": METHOD})),
            calls(("update_result", {"patch": KEYWORDS}), ("finish", {})),
        ], ["keywords", "method"])
        self.assertEqual(result["methodSections"], METHOD["methodSections"])
        self.assertEqual(result["keywords"], KEYWORDS["keywords"])
        self.assertEqual([step["tool"] for step in raw["trace"]],
                         ["read_paper", "update_result", "update_result", "finish"])
        self.assertTrue(raw["validated"])
        self.assertTrue(all(event["stage"] == "agent_progress" for event in self.events))

    async def test_natural_language_goal_selects_only_requested_outputs(self):
        result, raw = await self.run_graph([
            calls(("select_goals", {"goals": ["keywords"]}), ("read_paper", {"start": 0})),
            calls(("update_result", {"patch": KEYWORDS}), ("finish", {})),
        ], goal="只生成论文关键词及解释")
        self.assertEqual(raw["goals"], ["keywords"])
        self.assertEqual(result["methodSections"], [])
        self.assertIn("select_goals", str(self.model.complete.call_args_list[0].args[1]))
        self.assertNotIn("select_goals", str(self.model.complete.call_args_list[1].args[1]))

    async def test_invalid_finish_returns_errors_and_model_repairs_formula(self):
        broken = copy.deepcopy(METHOD)
        broken["methodSections"][0]["content"] = "表示 $P_target$。"
        repaired = copy.deepcopy(METHOD)
        repaired["methodSections"][0]["content"] = "表示 $P_{target}$。"
        result, raw = await self.run_graph([
            calls(("read_paper", {"start": 0})),
            calls(("update_result", {"patch": broken}), ("finish", {})),
            calls(("update_result", {"patch": repaired}), ("finish", {})),
        ], ["method"])
        observation = json.loads(self.model.complete.call_args_list[2].args[0][-1]["content"])
        self.assertFalse(observation["valid"])
        self.assertIn("多字符下标", str(observation["errors"]))
        self.assertEqual(result["methodSections"], repaired["methodSections"])
        self.assertEqual([s["valid"] for s in raw["trace"] if "valid" in s], [False, True])

    async def test_successful_validation_cannot_authorize_later_invalid_revision(self):
        broken = {"methodConclusion": ""}
        result, raw = await self.run_graph([
            calls(("read_paper", {"start": 0}), ("update_result", {"patch": METHOD}), ("validate_result", {})),
            calls(("update_result", {"patch": broken}), ("finish", {})),
            calls(("update_result", {"patch": {"methodConclusion": METHOD["methodConclusion"]}}), ("finish", {})),
        ], ["method"])
        self.assertEqual([s["valid"] for s in raw["trace"] if "valid" in s], [True, False, True])
        self.assertEqual(result["methodConclusion"], METHOD["methodConclusion"])

    async def test_invalid_tool_arguments_missing_source_and_scope_are_observations(self):
        _, raw = await self.run_graph([
            calls(("update_result", {"patch": KEYWORDS}), ("delete_paper", {}),
                  ("read_paper", {"start": True}), ("read_paper", {"start": 0, "length": READ_CHARS + 1})),
            calls(("read_paper", {"start": 0}), ("update_result", {"patch": METHOD})),
            calls(("update_result", {"patch": KEYWORDS}), ("finish", {})),
        ], ["keywords"])
        self.assertEqual(sum(not s["ok"] for s in raw["trace"]), 5)

    async def test_search_and_read_reach_later_source_without_silent_truncation(self):
        text = "Introduction " * 10_000 + "FINAL_METHOD attention aggregates context."
        result, raw = await self.run_graph([
            calls(("search_paper", {"query": "FINAL_METHOD"})),
            calls(("read_paper", {"start": len(text) - 41, "length": 41})),
            calls(("update_result", {"patch": METHOD}), ("finish", {})),
        ], ["method"], text=text)
        first_result = json.loads(self.model.complete.call_args_list[1].args[0][-1]["content"])
        self.assertIn("FINAL_METHOD", str(first_result))
        self.assertGreater(raw["readRanges"][0][0], READ_CHARS)
        self.assertTrue(result["methodSections"])

    async def test_model_cannot_finish_without_reading_or_with_plain_answer(self):
        _, raw = await self.run_graph([
            {"role": "assistant", "content": "已经完成"},
            calls(("finish", {})),
            calls(("read_paper", {"start": 0}), ("update_result", {"patch": KEYWORDS}), ("finish", {})),
        ], ["keywords"])
        self.assertEqual([s["valid"] for s in raw["trace"] if "valid" in s], [False, True])

    async def test_exhausted_budget_raises_without_publishing_draft(self):
        with self.assertRaisesRegex(ValueError, "调用上限"):
            await self.run_graph([calls(("validate_result", {})) for _ in range(MAX_ROUNDS)], ["method"])
        self.assertFalse(any(e["stage"] == "complete" for e in self.events))


class ServerRoutingTests(unittest.TestCase):
    def test_stdlib_runtime_uses_agent_worker_and_forwards_progress(self):
        original_import = builtins.__import__

        def without_langgraph(name, *args, **kwargs):
            if name == "langgraph.graph":
                raise ImportError("Optional runtime")
            return original_import(name, *args, **kwargs)

        progress = []
        events = iter([{"stage": "agent_progress", "summary": {"detail": "正在读取原文"}},
                       {"result": KEYWORDS, "raw": {"validated": True}}])
        # The real worker iterator is a closable generator.
        def worker(*args, **kwargs):
            yield from events

        with patch("builtins.__import__", side_effect=without_langgraph), \
                patch("backend.discussion_agent_bridge.run_agent_worker", side_effect=worker) as run:
            result, raw = run_analysis(PAPER, ["keywords"], "", ("private-key", "model", "url", False), "", lambda *e: progress.append(e))
        self.assertEqual(result, KEYWORDS)
        self.assertTrue(raw["validated"])
        self.assertEqual(progress[0][0], "agent_progress")
        self.assertEqual(run.call_args.args[1], "backend.paper_analysis")

    def test_legacy_entry_points_delegate_to_goals_not_old_pipeline(self):
        for operation, expected in ((server.summarize_paper, None),
                                    (server.extract_paper_overview, ["metadata", "keywords", "threeLine"])):
            with self.subTest(operation=operation.__name__), \
                    patch("backend.paper_analysis.run_analysis", return_value=({"paperTitle": "Original"}, {})) as run, \
                    patch("server.get_ai_config", return_value=("key", "model", "url", True)), \
                    patch("server.get_module_custom_prompt", return_value="保留术语"):
                result, _ = operation("key", "model", "url", PAPER)
            self.assertEqual(run.call_args.args[1], expected)
            self.assertTrue(run.call_args.args[3][3])
            self.assertEqual(run.call_args.args[4], "保留术语")
            self.assertEqual(result["paperTitle"], "Original")


@unittest.skipUnless(HAS_LANGGRAPH, "Install requirements-reading-agent.txt for HTTP integration tests")
class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.http = ThreadingHTTPServer(("127.0.0.1", 0), server.PaperReaderHandler)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.http.server_port}"
        self.config = patch("server.get_ai_config", return_value=("test-key", "model", "https://model.invalid", False))
        self.config_mock = self.config.start()
        self.prompts = patch("server.get_module_custom_prompt", return_value="")
        self.prompts.start()
        self.logs = patch("server.create_ai_run_dir", return_value=None)
        self.logs.start()

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join(timeout=2)
        self.config.stop()
        self.prompts.stop()
        self.logs.stop()

    def post(self, payload, endpoint="/api/summarize"):
        return urllib.request.build_opener(urllib.request.ProxyHandler({})).open(urllib.request.Request(self.url + endpoint,
            data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"}), timeout=20)

    def test_json_and_sse_use_actual_graph_and_finish_only_after_validation(self):
        for stream in (False, True):
            with self.subTest(stream=stream):
                replies = [calls(("read_paper", {"start": 0})),
                           calls(("update_result", {"patch": KEYWORDS}), ("finish", {}))]
                with patch("backend.paper_analysis.ConfiguredModel.complete", new=AsyncMock(side_effect=replies)):
                    with self.post({"paperText": PAPER, "goals": ["keywords"], "stream": stream}) as response:
                        text = response.read().decode()
                if stream:
                    events = [json.loads(line[6:]) for line in text.splitlines() if line.startswith("data: ")]
                    self.assertEqual(events[-1]["stage"], "complete")
                    self.assertTrue(all(e["stage"] == "agent_progress" for e in events[:-1]))
                    result = events[-1]["summary"]
                else:
                    data = json.loads(text)
                    result = data["summary"]
                    self.assertTrue(data["raw"]["validated"])
                self.assertEqual(result["keywords"], KEYWORDS["keywords"])
                self.assertIn(unittest.mock.call("keywords"), self.config_mock.call_args_list)

    def test_bad_goals_are_400_before_model_call(self):
        for payload in (["not an object"], {"paperText": PAPER, "goals": []}, {"paperText": PAPER, "goal": []}):
            with self.subTest(payload=payload), self.assertRaises(urllib.error.HTTPError) as error:
                self.post(payload)
            self.assertEqual(error.exception.code, 400)
            error.exception.close()


@unittest.skipUnless(HAS_LANGGRAPH, "Install requirements-reading-agent.txt for worker integration")
class WorkerIntegrationTests(unittest.TestCase):
    def test_real_worker_and_native_model_requests(self):
        from backend.discussion_agent_bridge import run_agent_worker

        requests = []
        replies = [calls(("read_paper", {"start": 0})),
                   calls(("update_result", {"patch": KEYWORDS}), ("finish", {}))]

        class ModelHandler(BaseHTTPRequestHandler):
            def do_POST(self):
                requests.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
                body = json.dumps({"choices": [{"message": replies[len(requests) - 1]}]}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        upstream = ThreadingHTTPServer(("127.0.0.1", 0), ModelHandler)
        thread = threading.Thread(target=upstream.serve_forever, daemon=True)
        thread.start()
        try:
            events = list(run_agent_worker({"paperText": PAPER, "goals": ["keywords"], "goal": "",
                "connection": ["local-test-key", "test-model", f"http://127.0.0.1:{upstream.server_port}/v1/chat/completions", False],
                "customPrompt": "保留英文术语。"}, "backend.paper_analysis", "正在启动测试…"))
        finally:
            upstream.shutdown()
            upstream.server_close()
            thread.join(timeout=2)
        final = next(e for e in events if "result" in e)
        self.assertTrue(final["raw"]["validated"])
        self.assertEqual(final["result"]["keywords"], KEYWORDS["keywords"])
        self.assertEqual(len(requests), 2)
        self.assertIn("保留英文术语", str(requests[0]["messages"]))
        self.assertTrue(requests[0]["tools"])
        self.assertEqual(PAPER, json.loads(requests[1]["messages"][-1]["content"])["text"])


if __name__ == "__main__":
    unittest.main()
