"""Real SSE transport must deliver content before completion and preserve tools."""

import asyncio
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading
import unittest

from backend.reading_agent.model import ConfiguredModel, stream_model_reply
from backend.reading_agent.state import AgentError


@contextmanager
def model_server(send):
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            requests.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.end_headers()

            def event(delta=None, finish=None, usage=None):
                data = {"choices": [{"index": 0, "delta": delta or {}, "finish_reason": finish}]}
                if usage:
                    data["usage"] = usage
                self.wfile.write(("data: " + json.dumps(data, ensure_ascii=False) + "\n\n").encode("utf-8"))
                self.wfile.flush()

            send(event)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield ConfiguredModel(connection=("private-key", "model", f"http://127.0.0.1:{server.server_port}", False), custom_prompt=""), requests
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


class ModelStreamingTests(unittest.TestCase):
    def test_content_arrives_before_provider_finishes_and_reasoning_is_private(self):
        started, finish = threading.Event(), threading.Event()

        def send(event):
            event({"reasoning_content": "PRIVATE_REASONING"})
            event({"content": "# 报告\n\n"})
            finish.wait(timeout=5)
            event({"content": "逐步显示正文。"})
            event(finish="stop", usage={"total_tokens": 30, "secret": "not persisted"})

        with model_server(send) as (model, requests):
            chunks = []

            def receive(text):
                chunks.append(text)
                started.set()

            async def run():
                task = asyncio.create_task(model.stream_complete([{"role": "user", "content": "Research"}], [], receive))
                try:
                    self.assertTrue(await asyncio.to_thread(started.wait, 3))
                    self.assertFalse(task.done(), "Content must arrive while the HTTP response is still open")
                    self.assertEqual(chunks, ["# 报告\n\n"])
                finally:
                    finish.set()
                return await task

            reply = asyncio.run(run())
        self.assertTrue(requests[0]["stream"])
        self.assertEqual(reply["content"], "# 报告\n\n逐步显示正文。")
        self.assertEqual(reply["reasoning_content"], "PRIVATE_REASONING")
        self.assertNotIn("PRIVATE_REASONING", "".join(chunks))
        self.assertEqual(model.usage, [{"total_tokens": 30}])

    def test_fragmented_tool_calls_never_publish_provisional_text_as_a_report(self):
        def send(event):
            event({"content": "先查询文献。"})
            event({"reasoning_content": "PRIVATE_REASONING"})
            event({"tool_calls": [{"index": 0, "id": "call-1", "type": "function", "function": {
                "name": "search_library", "arguments": '{"query":"'}}]})
            event({"tool_calls": [{"index": 1, "id": "call-2", "type": "function", "function": {
                "name": "get_item", "arguments": '{"id":"paper"}'}}]})
            event({"tool_calls": [{"index": 0, "function": {"arguments": 'control"}'}}]})
            event(finish="tool_calls")

        events = []
        with model_server(send) as (model, _):
            reply = asyncio.run(stream_model_reply(model, [], [{"type": "function"}],
                lambda kind, **fields: events.append({"type": kind, **fields})))
        self.assertEqual([call["function"]["name"] for call in reply["tool_calls"]], ["search_library", "get_item"])
        self.assertEqual(json.loads(reply["tool_calls"][0]["function"]["arguments"]), {"query": "control"})
        self.assertEqual(events, [], "Tool rounds must not start, update or reset a visible report")
        self.assertNotIn("PRIVATE_REASONING", json.dumps(events))
        self.assertNotIn("search_library", json.dumps(events))

    def test_tool_enabled_content_stays_hidden_until_the_reply_is_classified(self):
        events = []
        case = self

        class Model:
            async def stream_complete(self, messages, tools, receive):
                receive("Intermediate explanation before a late tool call")
                case.assertEqual(events, [], "No report text may flash before tool_calls arrive")
                return {"content": "Intermediate explanation before a late tool call", "tool_calls": [
                    {"id": "read", "type": "function", "function": {"name": "get_item", "arguments": "{}"}}]}

        reply = asyncio.run(stream_model_reply(Model(), [], [{"type": "function"}],
            lambda kind, **fields: events.append({"type": kind, **fields})))
        self.assertTrue(reply["tool_calls"])
        self.assertEqual(events, [])

    def test_final_reply_with_tools_available_is_published_once_after_classification(self):
        events = []
        case = self

        class Model:
            async def stream_complete(self, messages, tools, receive):
                receive("Final ")
                receive("report")
                case.assertEqual(events, [])
                return {"content": "Final report", "reasoning_content": "PRIVATE_REASONING"}

        asyncio.run(stream_model_reply(Model(), [], [{"type": "function"}],
            lambda kind, **fields: events.append({"type": kind, **fields}), claims=[{"id": "C1"}]))
        self.assertEqual(sum(event["type"] == "report_started" for event in events), 1)
        self.assertEqual(events[0]["claims"], [{"id": "C1"}])
        self.assertEqual("".join(event["delta"] for event in events if event["type"] == "report_delta"), "Final report")
        self.assertNotIn("PRIVATE_REASONING", json.dumps(events))

    def test_final_report_only_turn_streams_before_the_model_finishes(self):
        events = []
        case = self

        class Model:
            async def stream_complete(self, messages, tools, receive):
                receive("Final ")
                case.assertEqual([event["type"] for event in events], ["report_started", "report_delta"])
                receive("report")
                return {"content": "Final report"}

        asyncio.run(stream_model_reply(Model(), [], [],
            lambda kind, **fields: events.append({"type": kind, **fields})))
        self.assertEqual("".join(event["delta"] for event in events if event["type"] == "report_delta"), "Final report")

    def test_truncated_stream_clears_partial_report_and_cannot_be_completed(self):
        events = []
        with model_server(lambda event: event({"content": "Incomplete report"})) as (model, _):
            with self.assertRaisesRegex(AgentError, "连接中断"):
                asyncio.run(stream_model_reply(model, [], [],
                    lambda kind, **fields: events.append({"type": kind, **fields})))
        self.assertEqual(events[0]["type"], "report_started")
        self.assertEqual(events[-1]["type"], "report_reset")

    def test_cancellation_stops_stream_callbacks_without_becoming_a_model_error(self):
        from backend.reading_agent.state import AgentCancelled

        class Model:
            async def stream_complete(self, messages, tools, receive):
                receive("Must not appear")

        events = []
        def guard():
            raise AgentCancelled("Stopped")

        with self.assertRaises(AgentCancelled):
            asyncio.run(stream_model_reply(Model(), [], [], lambda kind, **fields: events.append(kind), guard))
        self.assertEqual(events, [])
