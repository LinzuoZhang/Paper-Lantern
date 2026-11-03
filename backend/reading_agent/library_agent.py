"""General tool-routing graph; writes stop at a persistent approval interrupt."""

import asyncio
from copy import deepcopy
from contextlib import AsyncExitStack
from dataclasses import replace
import json
from typing import TypedDict

from .capabilities import READ_CAPABILITIES, WRITE_CAPABILITIES
from .context import json_size
from .graph import ReadingAgent
from .library_context import brief, cached_read, observation_view, read_arguments, read_definition, result_page, task_memory
from .mcp_client import PROJECT_ROOT, ResearchMCPClient
from .plans import PlanStore
from .state import AgentError
from .model import stream_model_reply


DISCOVER = {"type": "function", "function": {"name": "discover_tools", "description": "Load schemas for up to 6 capabilities from the catalog. Read tools become callable; write schemas are only for constructing a proposal.",
    "parameters": {"type": "object", "properties": {"names": {"type": "array", "minItems": 1, "maxItems": 6, "items": {"type": "string"}}}, "required": ["names"], "additionalProperties": False}}}
PROPOSE = {"type": "function", "function": {"name": "propose_library_plan", "description": 'Submit a complete concrete write plan for user review. Does not modify the library. For a new category use categoryIds: [{"ref":"earlierOperationId.categoryId"}], an object, not a string. Membership updates also require arguments.id (the paper/note ID). After this call wait for approval. Call alone.',
    "parameters": {"type": "object", "properties": {"summary": {"type": "string"}, "operations": {"type": "array", "minItems": 1, "maxItems": 100,
        "items": {"type": "object", "properties": {"id": {"type": "string"}, "tool": {"type": "string"}, "arguments": {"type": "object"}, "reason": {"type": "string"}},
                  "required": ["id", "tool", "arguments"], "additionalProperties": False}}}, "required": ["summary", "operations"], "additionalProperties": False}}}
RESEARCH = {"type": "function", "function": {"name": "research_library", "description": "Delegate literature reviews, scientific comparisons and finding related papers to the source-verified reading agent. Uses previous conversation. Call alone; its verified report is the final answer.",
    "parameters": {"type": "object", "properties": {"task": {"type": "string"}}, "required": ["task"], "additionalProperties": False}}}
READ_PLAN = {"type": "function", "function": {"name": "get_task_plan", "description": "Read a prior plan in this conversation to revise it. Operations are paginated. Does not execute it.",
    "parameters": {"type": "object", "properties": {"planId": {"type": "string"}, "offset": {"type": "integer", "minimum": 0}}, "required": ["planId"], "additionalProperties": False}}}
READ_RESULTS = {"type": "function", "function": {"name": "get_task_result", "description": "Recall a previously returned tool result by observation index. Use when earlier observations no longer fit the current context.",
    "parameters": {"type": "object", "properties": {"index": {"type": "integer", "minimum": 0}, "offset": {"type": "integer", "minimum": 0},
        "limit": {"type": "integer", "minimum": 1, "maximum": 12}}, "required": ["index"], "additionalProperties": False}}}

PLANNING_VERSION = 2
MAX_ROUNDS = 24
MAX_TOOLS = 80
FINAL_ROUNDS = 4
MAX_PLAN_REPAIRS = 3
REPAIR_ROUNDS = 6
REPAIR_TOOLS = 20


def proposal_definition(write_schemas):
    """Expose discovered write argument requirements in the proposal itself."""
    definition = deepcopy(PROPOSE)
    operation = definition["function"]["parameters"]["properties"]["operations"]["items"]
    operation["properties"]["tool"]["enum"] = list(WRITE_CAPABILITIES)

    def with_references(schema):
        schema = deepcopy(schema)
        if schema.get("type") == "string":
            return {"anyOf": [schema, {"type": "object", "properties": {"ref": {"type": "string",
                    "description": "Earlier operation output, e.g. create_topic.categoryId"}},
                    "required": ["ref"], "additionalProperties": False}]}
        if "properties" in schema:
            schema["properties"] = {key: with_references(value) for key, value in schema["properties"].items()
                                    if key not in {"dryRun", "expectedRevision", "categoryId"}}
        if "items" in schema:
            schema["items"] = with_references(schema["items"])
        return schema

    choices, discovered = [], set()
    for tool in write_schemas:
        if tool["name"] not in WRITE_CAPABILITIES:
            continue
        variant = deepcopy(operation)
        variant["properties"]["tool"]["enum"] = [tool["name"]]
        variant["properties"]["arguments"] = with_references(tool["parameters"])
        choices.append(variant)
        discovered.add(tool["name"])
    if choices:
        remaining = [name for name in WRITE_CAPABILITIES if name not in discovered]
        if remaining:
            fallback = deepcopy(operation)
            fallback["properties"]["tool"]["enum"] = remaining
            choices.append(fallback)
        definition["function"]["parameters"]["properties"]["operations"]["items"] = {"anyOf": choices}
    return definition


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
    finalizing: bool
    planning_version: int
    plan_repairs: int
    plan_failure: dict


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
        return {"catalog": catalog, "facts": [], "selected": [], "rounds": 0, "tool_calls": 0,
                "finalizing": False, "planning_version": PLANNING_VERSION, "plan_repairs": 0, "plan_failure": {}}

    async def agent(self, state):
        self.check()
        round_limit = MAX_ROUNDS + state.get("plan_repairs", 0) * REPAIR_ROUNDS
        tool_limit = MAX_TOOLS + state.get("plan_repairs", 0) * REPAIR_TOOLS
        if state["rounds"] >= round_limit or state["tool_calls"] >= tool_limit:
            raise AgentError("资料已保留，但模型未在计划整理阶段提交方案。可继续追问要求根据已有资料提出计划；未执行未确认操作。")
        memory = task_memory(state["facts"])
        stalled = len(state["facts"]) >= 4 and all("cachedFrom" in fact or "error" in fact for fact in state["facts"][-4:])
        stalled_complete = stalled and memory["itemCount"] > 0 and all(query["complete"] for query in memory["searches"])
        finalizing = (state.get("finalizing", False) or stalled_complete or state["rounds"] >= round_limit - FINAL_ROUNDS
                      or state["tool_calls"] >= tool_limit - 4 * FINAL_ROUNDS)
        if finalizing and not state.get("finalizing"):
            self.emit("planning_finalization_started", summary="正在汇总已读取的文献与分类信息，整理具体操作计划。")
        prompt = (PROJECT_ROOT / "prompts/agent/library.txt").read_text(encoding="utf-8")
        context = {"task": self.options.task,
                   "history": brief(list(self.options.conversation)[-4:], 2500), "capabilities": state["catalog"],
                   "workspace": memory, "taskPhase": "finalizing" if finalizing else "collecting",
                   "remainingModelCalls": round_limit - state["rounds"], "observations": [],
                   "planFailure": state.get("plan_failure", {})}
        if stalled and not finalizing:
            context["collectionNotice"] = "最近的请求没有取得新资料。请按 workspace 的 nextOffset 继续未完成的分页，或根据已有资料及时提交方案。"
        context["observationIndex"] = [{"index": index, "tool": fact["tool"], "arguments": brief(fact.get("arguments", {}), 200),
                                        **({"error": fact["error"]} if "error" in fact else {}),
                                        **({"cachedFrom": fact["cachedFrom"]} if "cachedFrom" in fact else {})}
                                       for index, fact in enumerate(state["facts"])]
        for fact in reversed(state["facts"]):
            context["observations"].insert(0, observation_view(fact))
            if json_size(context) > 70_000:
                context["observations"].pop(0)
                break
        messages = [{"role": "system", "content": prompt}, {"role": "user", "content": json.dumps(context, ensure_ascii=False)}]
        tools = [DISCOVER, proposal_definition(memory["writeSchemas"]), READ_PLAN, READ_RESULTS]
        if not finalizing:
            tools += [RESEARCH] + [read_definition(self.client.tools[name]) for name in state["selected"] if name in self.client.tools]
        if json_size({"messages": messages, "tools": tools}) > self.options.max_context_chars - 6000:
            raise AgentError("任务资料过大，请将任务分批处理；未执行未确认操作。")
        self.emit("model_started", call=state["rounds"] + 1, contextChars=json_size({"messages": messages, "tools": tools}),
                  summary=("正在核对失败原因和当前文献库状态，修正操作计划。" if state.get("plan_failure") else
                           "正在根据已读取的文献与分类信息整理计划。" if finalizing else "正在理解任务、选择工具并检查文献库资料。"))
        reply = await stream_model_reply(self.model, messages, tools, self.emit, self.check)
        reply.pop("reasoning_content", None)
        if reply.get("content") and reply.get("tool_calls"):
            self.emit("analysis_progress", summary=" ".join(reply["content"].split())[:180])
        return {"reply": reply, "rounds": state["rounds"] + 1, "finalizing": finalizing, "planning_version": PLANNING_VERSION}

    async def tools(self, state):
        self.check()
        facts, selected = list(state["facts"]), list(state["selected"])
        update = {}
        calls = state["reply"].get("tool_calls", [])
        for call in calls:
            name = call["function"]["name"]
            self.emit("tool_started", name=name)
            args = {}
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
                    for tool in data["tools"]:
                        if tool["name"] in READ_CAPABILITIES:
                            adapted = read_definition({"type": "function", "function": {"name": tool["name"], "parameters": tool["parameters"]}})
                            tool["parameters"] = adapted["function"]["parameters"]
                    selected = list(dict.fromkeys(selected + [item for item in names if item in READ_CAPABILITIES]))[-8:]
                elif name == "get_task_plan":
                    plan = self.plans.get(args.get("planId"), self.job_id, self.options.library_dir)
                    offset = args.get("offset", 0)
                    if type(offset) is not int or offset < 0:
                        raise ValueError("offset 须为非负整数。")
                    operations = plan["proposal"]["operations"]
                    data = {"summary": plan["proposal"]["summary"], "state": plan["state"], "operations": operations[offset:offset + 10],
                            "failure": plan.get("failure", {}),
                            "results": [result for result in plan["results"] if result["id"] in {op["id"] for op in operations[offset:offset + 10]}],
                            "nextOffset": offset + 10 if offset + 10 < len(operations) else None}
                elif name == "get_task_result":
                    index = args.get("index")
                    if type(index) is not int or not 0 <= index < len(state["facts"]):
                        raise ValueError("工具结果索引不存在。")
                    offset, limit = args.get("offset", 0), args.get("limit", 12)
                    if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 12:
                        raise ValueError("回看结果须使用非负 offset 和 1–12 的 limit。")
                    data = result_page(state["facts"], index, offset, limit)
                elif name == "propose_library_plan":
                    plan = self.plans.create(self.job_id, self.turn_id, args, call["id"])
                    update["plan_id"] = plan["id"]
                    data = {"planId": plan["id"], "state": "draft", "summary": plan["proposal"]["summary"]}
                elif name == "research_library":
                    if state.get("finalizing"):
                        raise ValueError("已进入计划整理阶段，请根据已有资料提交方案或说明尚缺的信息。")
                    if set(args) != {"task"} or not isinstance(args["task"], str) or not 1 <= len(args["task"].strip()) <= 8000:
                        raise ValueError("请提供完整研究任务。")
                    update["research_task"] = args["task"].strip()
                    data = {"delegated": True}
                elif name in selected and name in READ_CAPABILITIES:
                    args = read_arguments(name, args)
                    cached = cached_read(facts, name, args)
                    if cached is not None:
                        facts.append({"tool": name, "arguments": args, "cachedFrom": cached,
                                      "result": {"cached": True, "observation": cached, "message": "已读取相同结果，请使用 workspace 中的资料；需要细节可回看原结果。"}})
                        self.emit("tool_cache_hit", name=name, observation=cached)
                        continue
                    if state.get("finalizing"):
                        raise ValueError("已进入计划整理阶段，不再读取新资料；请提交计划，信息不足的对象可保留并说明。")
                    if name == "list_paper_summaries" and ("hashes" not in args or len(args["hashes"]) > 12):
                        raise ValueError("请按已查到的 hashes 分批读取，每次不超过12篇。")
                    data = brief(await self.client.call(name, args), 6000)
                else:
                    raise ValueError("请先发现只读工具；写操作只能提交 propose_library_plan，不能直接调用。")
                facts.append({"tool": name, "arguments": args, "result": data})
            except (ValueError, TypeError, OSError, AgentError) as error:
                facts.append({"tool": name, "arguments": args, "error": str(error)[:1500]})
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
        if plan["state"] not in {"completed", "failed", "stale"}:
            approval = interrupt({"planId": state["plan_id"], "message": "计划需用户确认后执行。"})
            if not isinstance(approval, dict) or approval.get("planId") != state["plan_id"]:
                raise AgentError("计划恢复参数无效。")
            plan = self.plans.get(state["plan_id"], self.job_id, self.options.library_dir)
        if plan["state"] not in {"completed", "failed", "stale"}:
            raise AgentError("计划尚未由服务端执行，不允许跳过确认。")
        if plan["state"] in {"failed", "stale"} and state.get("plan_repairs", 0) < MAX_PLAN_REPAIRS:
            failure = plan.get("failure") or {"stage": "execution", "error": "计划执行失败，请查看各步骤的执行记录。"}
            failed = next((op for op in plan["proposal"]["operations"] if op["id"] == failure.get("operationId")), None)
            receipts = plan["results"]
            repairs = state.get("plan_repairs", 0) + 1
            facts = [dict(fact) for fact in state["facts"]]
            if failure["stage"] != "preview":
                for fact in facts:
                    if fact["tool"] in READ_CAPABILITIES:
                        fact["stale"] = True
            feedback = {"planId": plan["id"], "summary": plan["proposal"]["summary"], "state": plan["state"],
                        "failure": failure, "failedOperation": failed, "repairAttempt": repairs,
                        "remainingRepairAttempts": MAX_PLAN_REPAIRS - repairs,
                        "completedOperationIds": [item["id"] for item in receipts if item["status"] == "completed"],
                        "results": receipts,
                        "instruction": "根据失败原因修正方案；用 get_task_plan 分页查看原操作及回执。不得重复已完成操作；失败步骤可能部分写入，须先读取当前状态再决定剩余变更。新方案仍需用户确认。"}
            self.emit("plan_repair_started", planId=plan["id"], attempt=repairs, reason=failure["error"],
                      summary="计划遇到问题，正在核对失败原因并修正方案；修正后将重新请你确认。")
            return {"plan_id": "", "output": {}, "research_task": "", "facts": facts, "finalizing": False,
                    "plan_repairs": repairs, "plan_failure": feedback}
        lines = []
        for item in plan["results"]:
            label = WRITE_CAPABILITIES.get(item["tool"], item["id"])
            lines.append(f"- {label}：{'完成' if item['status'] == 'completed' else '失败 · ' + item.get('error', '')}")
        if plan["state"] != "completed":
            lines += ["", "自动修复已达到 3 次上限，未执行新的未确认操作。", plan.get("failure", {}).get("error", "请核对失败步骤后继续追问。")]
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
            builder.add_conditional_edges("review", lambda state: "end" if state.get("output") else "agent", {"end": END, "agent": "agent"})
            for name in ("research", "finish"):
                builder.add_edge(name, END)
            graph = builder.compile(checkpointer=saver)
            config = {"configurable": {"thread_id": self.turn_id}, "recursion_limit": 100}
            saved = await graph.aget_state(config)
            if (saved.values and saved.values.get("planning_version", 0) < PLANNING_VERSION
                    and not saved.values.get("plan_id") and not saved.values.get("output")
                    and (saved.values.get("rounds", 0) >= MAX_ROUNDS - FINAL_ROUNDS
                         or saved.values.get("tool_calls", 0) >= MAX_TOOLS - 4 * FINAL_ROUNDS)):
                await graph.aupdate_state(config, {"rounds": min(saved.values.get("rounds", 0), MAX_ROUNDS - FINAL_ROUNDS),
                    "tool_calls": min(saved.values.get("tool_calls", 0), MAX_TOOLS - 4 * FINAL_ROUNDS),
                    "finalizing": True, "planning_version": PLANNING_VERSION}, as_node="tools")
                saved = await graph.aget_state(config)
                self.emit("planning_recovered", summary="已恢复原先读取的资料，正在直接整理计划，不再重复查询。")
            initial = {} if not saved.values else None
            current_id = (self.jobs.get(self.job_id)["result"] or {}).get("planId")
            if current_id and saved.values.get("plan_id") and current_id != saved.values["plan_id"]:
                await graph.aupdate_state(config, {"plan_id": current_id, "output": {}}, as_node="tools")
                saved = await graph.aget_state(config)
            elif saved.values.get("plan_id") and saved.next:
                plan = self.plans.get(saved.values["plan_id"], self.job_id, self.options.library_dir)
                if plan["state"] in {"completed", "failed", "stale"}:
                    initial = Command(resume={"planId": plan["id"]})
            state = await graph.ainvoke(initial, config)
            if state.get("output"):
                return state["output"]
            if state.get("plan_id"):
                plan = self.plans.get(state["plan_id"], self.job_id, self.options.library_dir)
                return {"kind": "plan", "awaitingApproval": True, "planId": plan["id"],
                        "report": "# 待确认的操作计划\n\n" + plan["proposal"]["summary"]}
            raise AgentError("任务未生成回答或可确认计划。")
