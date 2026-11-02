"""Native tool calls through Paper Lantern's configured Chat Completions client."""

import asyncio
import json
import urllib.error
import urllib.request
from urllib.parse import urlsplit

from .state import AgentError


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

    async def complete(self, messages, tools):
        import server

        payload = {"model": self.model, "messages": messages, "stream": False, "max_tokens": 4096}
        if tools:
            payload.update({"tools": tools, "tool_choice": "auto"})
        payload = server.apply_module_custom_prompt(payload, self.custom_prompt)
        try:
            result = await asyncio.to_thread(self.request, payload)
        except urllib.error.HTTPError as exc:
            raise AgentError(f"模型请求失败（HTTP {exc.code}）；请检查接口是否支持 tools/tool_calls。") from None
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
            if not tools or not isinstance(calls, list) or len(calls) > 4:
                raise AgentError("模型须每轮最多调用 4 个工具，并遵守最终汇总阶段的工具限制。")
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
