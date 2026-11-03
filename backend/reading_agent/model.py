"""Native tool calls through Paper Lantern's configured Chat Completions client."""

import asyncio
import json
import urllib.error
import urllib.request
from urllib.parse import urlsplit
from time import monotonic
import uuid

from .state import AgentError


async def stream_model_reply(model, messages, tools, emit, guard=None, claims=()):
    """Publish content deltas without exposing reasoning or tool arguments."""
    stream_id = uuid.uuid4().hex
    started, pending, last_flush = False, [], 0.0

    def flush():
        nonlocal last_flush
        if pending:
            emit("report_delta", streamId=stream_id, delta="".join(pending))
            pending.clear()
            last_flush = monotonic()

    def receive(text):
        nonlocal started
        if guard:
            guard()
        if not started:
            started = True
            emit("report_started", streamId=stream_id, claims=list(claims))
        pending.append(text)
        if monotonic() - last_flush >= .05 or sum(map(len, pending)) >= 256:
            flush()

    try:
        if hasattr(model, "stream_complete"):
            reply = await model.stream_complete(messages, tools, receive)
        else:
            reply = await model.complete(messages, tools)
        if reply.get("tool_calls"):
            if started:
                emit("report_reset", streamId=stream_id)
        else:
            if not started and reply.get("content"):
                receive(reply["content"])
            flush()
        return reply
    except BaseException:
        if started:
            emit("report_reset", streamId=stream_id)
        raise


class ConfiguredModel:
    def __init__(self, timeout=90, connection=None, custom_prompt=None):
        import server

        self.timeout = timeout
        self.key, self.model, self.url, self.think_mode = connection or server.get_ai_config("readingAgent")
        self.custom_prompt = server.get_module_custom_prompt("readingAgent") if custom_prompt is None else custom_prompt
        if not self.key or self.key in {"sk-your-api-key", "sk-your-real-api-key"}:
            raise AgentError("阅读机器人缺少 AI 配置，请在设置中配置模型服务或选择对应接口。")
        self.usage = []

    def request(self, payload):
        import server

        if urlsplit(self.url).hostname in {"127.0.0.1", "localhost", "::1"}:
            # Local model servers must not be sent to a system HTTP proxy.
            payload = server.apply_ai_think_mode(payload, self.think_mode, self.url)
            request = urllib.request.Request(self.url, data=json.dumps(payload).encode("utf-8"),
                                             headers={"Authorization": f"Bearer {self.key}", "Content-Type": "application/json"})
            with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=self.timeout) as response:
                return server.parse_chat_completion_response(response)
        return server.post_chat_completion(self.key, self.url, payload, self.timeout, think_mode=self.think_mode)

    def request_stream(self, payload, on_delta):
        import server

        payload = server.apply_ai_think_mode(payload, self.think_mode, self.url)
        request = urllib.request.Request(self.url, data=json.dumps(payload).encode("utf-8"),
            headers={"Authorization": f"Bearer {self.key}", "Content-Type": "application/json", "Accept": "text/event-stream"})
        opener = (urllib.request.build_opener(urllib.request.ProxyHandler({})).open
                  if urlsplit(self.url).hostname in {"127.0.0.1", "localhost", "::1"}
                  else server.open_chat_completion_request)
        with opener(request, timeout=self.timeout) as response:
            # Some compatible providers ignore stream=True and return JSON.
            if "application/json" in response.headers.get("Content-Type", ""):
                result = server.parse_chat_completion_response(response)
                message = result["choices"][0]["message"]
                if not message.get("tool_calls") and isinstance(message.get("content"), str) and message["content"]:
                    on_delta(message["content"])
                return result
            content, reasoning, calls, usage = [], [], {}, None
            finished, size = False, 0
            for raw in response:
                line = raw.decode("utf-8-sig").strip()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    finished = True
                    break
                event = json.loads(data)
                if event.get("error"):
                    raise AgentError("模型流式响应失败，请检查接口服务。")
                if isinstance(event.get("usage"), dict):
                    usage = event["usage"]
                for choice in event.get("choices", []):
                    if choice.get("index", 0) != 0:
                        continue
                    delta = choice.get("delta", {})
                    size += len(json.dumps(delta, ensure_ascii=False))
                    if size > 160_000:
                        raise AgentError("模型单轮输出超过上下文预算。")
                    for field, target in (("content", content), ("reasoning_content", reasoning)):
                        text = delta.get(field)
                        if text is not None:
                            if not isinstance(text, str):
                                raise AgentError("模型返回了非文本内容。")
                            target.append(text)
                    for fragment in delta.get("tool_calls") or []:
                        index = fragment.get("index")
                        if type(index) is not int or index < 0:
                            raise AgentError("模型返回了无效的原生 tool_calls。")
                        call = calls.setdefault(index, {"id": "", "type": "function", "function": {"name": "", "arguments": ""}})
                        call["id"] += fragment.get("id") or ""
                        call["type"] = fragment.get("type") or call["type"]
                        for field in ("name", "arguments"):
                            call["function"][field] += (fragment.get("function") or {}).get(field) or ""
                    if delta.get("content") and not calls:
                        on_delta(delta["content"])
                    if choice.get("finish_reason"):
                        finished = True
            if not finished:
                raise AgentError("模型输出连接中断，请从检查点继续。")
            message = {"content": "".join(content)}
            if reasoning:
                message["reasoning_content"] = "".join(reasoning)
            if calls:
                message["tool_calls"] = [calls[index] for index in sorted(calls)]
            return {"choices": [{"message": message}], "usage": usage}

    async def _complete(self, messages, tools, on_delta=None):
        import server

        payload = {"model": self.model, "messages": messages, "stream": on_delta is not None, "max_tokens": 4096}
        if tools:
            payload.update({"tools": tools, "tool_choice": "auto"})
        payload = server.apply_module_custom_prompt(payload, self.custom_prompt)
        try:
            if on_delta is not None:
                result = await asyncio.to_thread(self.request_stream, payload, on_delta)
            else:
                result = await asyncio.to_thread(self.request, payload)
        except urllib.error.HTTPError as exc:
            raise AgentError(f"模型请求失败（HTTP {exc.code}）；请检查接口是否支持 tools/tool_calls。") from None
        except AgentError:
            raise
        except Exception as exc:
            raise AgentError(f"模型请求失败（{type(exc).__name__}），请检查服务连接与超时设置。") from None
        usage = result.get("usage")
        if isinstance(usage, dict):
            self.usage.append({key: value for key, value in usage.items()
                               if key in {"prompt_tokens", "completion_tokens", "total_tokens"} and type(value) is int})
        try:
            message = result["choices"][0]["message"]
        except (KeyError, IndexError, TypeError) as exc:
            raise AgentError("模型返回缺少 choices[0].message。") from exc
        if not isinstance(message, dict):
            raise AgentError("模型 message 格式无效。")
        # Some thinking models require reasoning_content to be echoed across tool
        # turns. Keep it in memory only; never include it in reports or traces.
        reply = {"role": "assistant", "content": message.get("content") or ""}
        if "reasoning_content" in message:
            reply["reasoning_content"] = message["reasoning_content"]
        calls = message.get("tool_calls")
        if calls:
            ids = set()
            for call in calls:
                function = call.get("function") if isinstance(call, dict) else None
                if not (isinstance(call, dict) and isinstance(call.get("id"), str) and call["id"]
                        and call["id"] not in ids and call.get("type") == "function"
                        and isinstance(function, dict) and isinstance(function.get("name"), str)
                        and isinstance(function.get("arguments"), str)):
                    raise AgentError("模型返回了无效的原生 tool_calls。")
                ids.add(call["id"])
            reply["tool_calls"] = calls
        if not isinstance(reply["content"], str) or not isinstance(reply.get("reasoning_content", ""), str):
            raise AgentError("模型返回了非文本内容。")
        if len(json.dumps(reply, ensure_ascii=False)) > 80_000:
            raise AgentError("模型单轮输出超过上下文预算。")
        return reply

    async def complete(self, messages, tools):
        return await self._complete(messages, tools)

    async def stream_complete(self, messages, tools, on_delta):
        return await self._complete(messages, tools, on_delta=on_delta)
