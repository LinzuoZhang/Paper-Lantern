"""General tool-routing graph; writes stop at a persistent approval interrupt."""

import asyncio
from contextlib import AsyncExitStack
from dataclasses import replace
import json
from typing import TypedDict

from .capabilities import READ_CAPABILITIES, WRITE_CAPABILITIES
from .context import json_size
from .graph import ReadingAgent
from .mcp_client import PROJECT_ROOT, ResearchMCPClient
from .plans import PlanStore
from .state import AgentError


DISCOVER = {"type": "function", "function": {"name": "discover_tools", "description": "Load schemas for up to 6 capabilities from the catalog. Read tools become callable; write schemas are only for constructing a proposal.",
    "parameters": {"type": "object", "properties": {"names": {"type": "array", "minItems": 1, "maxItems": 6, "items": {"type": "string"}}}, "required": ["names"], "additionalProperties": False}}}
PROPOSE = {"type": "function", "function": {"name": "propose_library_plan", "description": "Submit a complete concrete write plan for user review. Does not modify the library. Use earlier operation outputs through {ref:'operationId.categoryId/flagId/noteId'}. After this call wait for approval. Call alone.",
    "parameters": {"type": "object", "properties": {"summary": {"type": "string"}, "operations": {"type": "array", "minItems": 1, "maxItems": 100,
        "items": {"type": "object", "properties": {"id": {"type": "string"}, "tool": {"type": "string"}, "arguments": {"type": "object"}, "reason": {"type": "string"}},
                  "required": ["id", "tool", "arguments"], "additionalProperties": False}}}, "required": ["summary", "operations"], "additionalProperties": False}}}
RESEARCH = {"type": "function", "function": {"name": "research_library", "description": "Delegate literature reviews, scientific comparisons and finding related papers to the source-verified reading agent. Uses previous conversation. Call alone; its verified report is the final answer.",
    "parameters": {"type": "object", "properties": {"task": {"type": "string"}}, "required": ["task"], "additionalProperties": False}}}
READ_PLAN = {"type": "function", "function": {"name": "get_task_plan", "description": "Read a prior plan in this conversation to revise it. Operations are paginated. Does not execute it.",
    "parameters": {"type": "object", "properties": {"planId": {"type": "string"}, "offset": {"type": "integer", "minimum": 0}}, "required": ["planId"], "additionalProperties": False}}}
READ_RESULTS = {"type": "function", "function": {"name": "get_task_result", "description": "Recall a previously returned tool result by observation index. Use when earlier observations no longer fit the current context.",
    "parameters": {"type": "object", "properties": {"index": {"type": "integer", "minimum": 0}}, "required": ["index"], "additionalProperties": False}}}


class LibraryState(TypedDict, total=False):
    catalog: list
    facts: list
    selected: list
    reply: dict
    rounds: int
    tool_calls: int
    plan_id: str
    research_task: str
    output: dict


def brief(value, max_string=4000):
    if isinstance(value, str):
        return value if len(value) <= max_string else value[:max_string] + "\n[内容已截短]"
    if isinstance(value, list):
        return [brief(item, max_string) for item in value]
    if isinstance(value, dict):
        return {key: brief(item, max_string) for key, item in value.items() if key not in {"libraryRoot", "localPath", "pdfPath"}}
    return value


class LibraryAgent:
    def __init__(self, options, model, jobs, job_id, turn_id, checkpoint_path, on_event=None, guard=None):
        self.options, self.model, self.jobs = options, model, jobs
        self.job_id, self.turn_id = job_id, turn_id
        self.checkpoint_path, self.on_event, self.guard = checkpoint_path, on_event, guard
        self.plans = PlanStore(jobs)

    def emit(self, event, **fields):
        if self.on_event:
            self.on_event({"type": event, **fields})

    def check(self):
        if self.guard:
            self.guard()

    async def setup(self, _state):
        self.check()
        catalog = (await self.client.call("agent_capabilities", {}))["tools"]
        return {"catalog": catalog, "facts": [], "selected": [], "rounds": 0, "tool_calls": 0}

    async def agent(self, state):
        self.check()
        if state["rounds"] >= 24 or state["tool_calls"] >= 80:
            raise AgentError("通用任务达到分析预算，尚未执行任何未确认操作；可缩小任务后继续。")
        prompt = (PROJECT_ROOT / "prompts/agent/library.txt").read_text(encoding="utf-8")
        context = {"task": self.options.task,
                   "history": brief(list(self.options.conversation)[-4:], 2500), "capabilities": state["catalog"],
                   "observations": []}
        context["observationIndex"] = [{"index": index, "tool": fact["tool"]} for index, fact in enumerate(state["facts"])]
        for fact in reversed(state["facts"]):
            context["observations"].insert(0, fact)
            if json_size(context) > 70_000:
                context["observations"].pop(0)
                break
        messages = [{"role": "system", "content": prompt}, {"role": "user", "content": json.dumps(context, ensure_ascii=False)}]
        tools = [DISCOVER, PROPOSE, RESEARCH, READ_PLAN, READ_RESULTS] + [self.client.tools[name] for name in state["selected"] if name in self.client.tools]
        if json_size({"messages": messages, "tools": tools}) > self.options.max_context_chars - 6000:
            raise AgentError("任务资料过大，请将任务分批处理；未执行未确认操作。")
        self.emit("model_started", call=state["rounds"] + 1, summary="正在理解任务、选择工具并检查文献库资料。")
        reply = await self.model.complete(messages, tools)
        reply.pop("reasoning_content", None)
        if reply.get("content") and reply.get("tool_calls"):
            self.emit("analysis_progress", summary=" ".join(reply["content"].split())[:180])
        return {"reply": reply, "rounds": state["rounds"] + 1}

    async def tools(self, state):
        self.check()
        facts, selected = list(state["facts"]), list(state["selected"])
        update = {}
        calls = state["reply"].get("tool_calls", [])
        for call in calls:
            name = call["function"]["name"]
            self.emit("tool_started", name=name)
            try:
                args = json.loads(call["function"]["arguments"])
                if not isinstance(args, dict):
                    raise ValueError("工具参数须为对象。")
                if name in {"propose_library_plan", "research_library"} and len(calls) != 1:
                    raise ValueError("提交计划或启动研究时须单独调用。")
                if name == "discover_tools":
                    names = args.get("names")
                    if not isinstance(names, list) or not 1 <= len(names) <= 6 or any(item not in {*READ_CAPABILITIES, *WRITE_CAPABILITIES} for item in names):
                        raise ValueError("请从能力目录选择 1–6 个工具。")
                    data = await self.client.call("agent_capabilities", {"names": names})
                    selected = list(dict.fromkeys(selected + [item for item in names if item in READ_CAPABILITIES]))[-8:]
                elif name == "get_task_plan":
                    plan = self.plans.get(args.get("planId"), self.job_id, self.options.library_dir)
                    offset = args.get("offset", 0)
                    if type(offset) is not int or offset < 0:
                        raise ValueError("offset 须为非负整数。")
                    operations = plan["proposal"]["operations"]
                    data = {"summary": plan["proposal"]["summary"], "state": plan["state"], "operations": operations[offset:offset + 10],
                            "nextOffset": offset + 10 if offset + 10 < len(operations) else None}
                elif name == "get_task_result":
                    index = args.get("index")
                    if type(index) is not int or not 0 <= index < len(state["facts"]):
                        raise ValueError("工具结果索引不存在。")
                    data = state["facts"][index]
                elif name == "propose_library_plan":
                    plan = self.plans.create(self.job_id, self.turn_id, args, call["id"])
                    update["plan_id"] = plan["id"]
                    data = {"planId": plan["id"], "state": "draft", "summary": plan["proposal"]["summary"]}
                elif name == "research_library":
                    if set(args) != {"task"} or not isinstance(args["task"], str) or not 1 <= len(args["task"].strip()) <= 8000:
                        raise ValueError("请提供完整研究任务。")
                    update["research_task"] = args["task"].strip()
                    data = {"delegated": True}
                elif name in selected and name in READ_CAPABILITIES:
                    if name == "search_library":
                        args["limit"] = min(args.get("limit", 30), 30)
                    if name == "list_paper_summaries" and ("hashes" not in args or len(args["hashes"]) > 12):
                        raise ValueError("请按已查到的 hashes 分批读取，每次不超过12篇。")
                    if name in {"get_paper_passages", "search_paper_content"}:
                        args["limit"] = min(args.get("limit", 5), 5)
                    data = brief(await self.client.call(name, args), 6000)
                    if json_size(data) > 26_000:
                        raise ValueError("结果较大，请缩小查询范围或分页读取。")
                else:
                    raise ValueError("请先发现只读工具；写操作只能提交 propose_library_plan，不能直接调用。")
                facts.append({"tool": name, "arguments": args, "result": data})
            except (ValueError, TypeError, OSError, AgentError) as error:
                facts.append({"tool": name, "error": str(error)[:1500]})
            self.check()
        return {"facts": facts, "selected": selected, "tool_calls": state["tool_calls"] + len(calls), **update}

    async def research(self, state):
        options = replace(self.options, task=state["research_task"])
        result = await ReadingAgent(options, self.model, on_event=self.on_event,
            checkpoint_path=self.checkpoint_path.with_name("checkpoints.sqlite3"), thread_id=self.turn_id, guard=self.guard).run()
        return {"output": {**result, "kind": "research"}}

    def review(self, state):
        from langgraph.types import interrupt
        plan = self.plans.get(state["plan_id"], self.job_id, self.options.library_dir)
        if plan["state"] not in {"completed", "failed"}:
            approval = interrupt({"planId": state["plan_id"], "message": "计划需用户确认后执行。"})
            if not isinstance(approval, dict) or approval.get("planId") != state["plan_id"]:
                raise AgentError("计划恢复参数无效。")
            plan = self.plans.get(state["plan_id"], self.job_id, self.options.library_dir)
        if plan["state"] not in {"completed", "failed"}:
            raise AgentError("计划尚未由服务端执行，不允许跳过确认。")
        completed = sum(item["status"] == "completed" for item in plan["results"])
        lines = ["# 文献库操作结果", "", plan["proposal"]["summary"], "", f"完成 {completed} / {len(plan['proposal']['operations'])} 项操作。"]
        for item in plan["results"]:
            lines.append(f"- {item['id']}：{'完成' if item['status'] == 'completed' else '失败 · ' + item.get('error', '')}")
        return {"output": {"kind": "library", "report": "\n".join(lines), "planId": plan["id"], "execution": plan["results"]}}

    def finish(self, state):
        return {"output": {"kind": "library", "report": state["reply"].get("content", "").strip() or "任务未返回内容。"}}

    async def run(self):
        from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
        from langgraph.graph import END, START, StateGraph
        from langgraph.types import Command
        async with asyncio.timeout(self.options.total_timeout), AsyncExitStack() as stack:
            self.client = await stack.enter_async_context(ResearchMCPClient(self.options.library_dir, self.options.tool_timeout))
            saver = await stack.enter_async_context(AsyncSqliteSaver.from_conn_string(str(self.checkpoint_path)))
            builder = StateGraph(LibraryState)
            for name in ("setup", "agent", "tools", "research", "review", "finish"):
                builder.add_node(name, getattr(self, name))
            builder.add_edge(START, "setup"); builder.add_edge("setup", "agent")
            builder.add_conditional_edges("agent", lambda state: "tools" if state["reply"].get("tool_calls") else "finish")
            builder.add_conditional_edges("tools", lambda state: "review" if state.get("plan_id") else "research" if state.get("research_task") else "agent")
            for name in ("research", "review", "finish"):
                builder.add_edge(name, END)
            graph = builder.compile(checkpointer=saver)
            config = {"configurable": {"thread_id": self.turn_id}, "recursion_limit": 100}
            saved = await graph.aget_state(config)
            initial = {} if not saved.values else None
            current_id = (self.jobs.get(self.job_id)["result"] or {}).get("planId")
            if current_id and saved.values.get("plan_id") and current_id != saved.values["plan_id"]:
                await graph.aupdate_state(config, {"plan_id": current_id, "output": {}}, as_node="tools")
                saved = await graph.aget_state(config)
            elif saved.values.get("plan_id") and saved.next:
                plan = self.plans.get(saved.values["plan_id"], self.job_id, self.options.library_dir)
                if plan["state"] in {"completed", "failed"}:
                    initial = Command(resume={"planId": plan["id"]})
            state = await graph.ainvoke(initial, config)
            if state.get("output"):
                return state["output"]
            if state.get("plan_id"):
                plan = self.plans.get(state["plan_id"], self.job_id, self.options.library_dir)
                return {"kind": "plan", "awaitingApproval": True, "planId": plan["id"],
                        "report": "# 待确认的操作计划\n\n" + plan["proposal"]["summary"]}
            raise AgentError("任务未生成回答或可确认计划。")
