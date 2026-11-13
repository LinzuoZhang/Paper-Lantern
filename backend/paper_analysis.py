"""Goal-driven paper analysis: LangGraph owns the loop, the model chooses the work."""

import asyncio
from copy import deepcopy
import json
from pathlib import Path
import re
import sys
from typing import TypedDict

from .reading_agent.model import ConfiguredModel
from .reading_agent.state import AgentError


GOALS = ("metadata", "keywords", "threeLine", "method")
OVERVIEW_GOALS = ("metadata", "keywords", "threeLine")
MAX_ROUNDS = 24
MAX_TOOL_CALLS = 48
READ_CHARS = 24_000
MAX_CONTEXT_CHARS = 240_000
GOAL_FIELDS = {
    "metadata": ("paperTitle", "basicInfo"),
    "keywords": ("keywords", "keywordExplanations"),
    "threeLine": ("threeLineSummary",),
    "method": ("methodOverview", "methodSections", "methodConclusion"),
}


def normalize_goals(goals=None):
    if goals is None:
        return list(GOALS)
    if (not isinstance(goals, list) or not goals
            or any(not isinstance(g, str) or g not in GOALS for g in goals)):
        raise ValueError("goals 必须是非空数组，可选 metadata、keywords、threeLine、method。")
    return list(dict.fromkeys(goals))


def validate_goal(goal):
    if not isinstance(goal, str) or len(goal) > 8000:
        raise ValueError("goal 必须是不超过 8000 字符的任务描述。")
    return goal.strip()


def goal_module(goals):
    goals = normalize_goals(goals)
    if goals == ["keywords"]:
        return "keywords"
    if set(goals) <= {"metadata", "threeLine"}:
        return "overview"
    return "summary"


def empty_result():
    return {"paperTitle": "", "basicInfo": {"authors": [], "venue": "", "publishedDate": "", "institutions": []},
            "keywords": [], "keywordExplanations": {},
            "threeLineSummary": {"challenges": "", "method": "", "conclusion": ""},
            "methodOverview": "", "methodSections": [], "methodConclusion": ""}


def result_schema():
    string = {"type": "string"}
    strings = {"type": "array", "items": string}
    return {"type": "object", "additionalProperties": False, "properties": {
        "paperTitle": string,
        "basicInfo": {"type": "object", "additionalProperties": False, "properties": {
            "authors": {**strings, "maxItems": 30}, "venue": {**string, "maxLength": 240},
            "publishedDate": {**string, "maxLength": 120}, "institutions": {**strings, "maxItems": 20}},
            "required": ["authors", "venue", "publishedDate", "institutions"]},
        "keywords": {**strings, "minItems": 1, "maxItems": 14},
        "keywordExplanations": {"type": "object", "additionalProperties": {**string, "maxLength": 600}},
        "threeLineSummary": {"type": "object", "additionalProperties": False,
            "properties": {key: string for key in ("challenges", "method", "conclusion")},
            "required": ["challenges", "method", "conclusion"]},
        "methodOverview": string, "methodConclusion": string,
        "methodSections": {"type": "array", "minItems": 1, "maxItems": 12,
            "items": {"type": "object", "additionalProperties": False,
                "properties": {"title": string, "motivation": string, "content": string},
                "required": ["title", "motivation", "content"]}},
    }}


def tool(name, description, properties, required=()):
    return {"type": "function", "function": {"name": name, "description": description,
        "parameters": {"type": "object", "additionalProperties": False,
                       "properties": properties, "required": list(required)}}}


def analysis_tools(select_goals=False):
    definitions = [
        tool("read_paper", "按字符位置读取论文原文，返回起止位置和是否还有后文。", {
            "start": {"type": "integer", "minimum": 0},
            "length": {"type": "integer", "minimum": 1, "maximum": READ_CHARS}}, ("start",)),
        tool("search_paper", "在整篇论文中搜索原文词语，返回匹配位置及上下文；不是联网搜索。", {
            "query": {"type": "string"}}, ("query",)),
        tool("update_result", "提交或修订分析结果。仅替换提供的顶层字段；数组须包含该字段的完整内容。可分多次提交。", {
            "patch": result_schema()}, ("patch",)),
        tool("validate_result", "检查当前结果是否覆盖全部目标，以及字段、关键词释义、方法结构和公式格式。错误须修正。", {}),
        tool("finish", "完成任务。服务端会再次独立校验；未通过时返回错误供修正，不能提交不合格结果。", {}),
    ]
    if select_goals:
        definitions.insert(0, tool("select_goals", "根据用户最终目的选择需要交付的结果类别。这是输出范围，不是执行计划。只能选择一次。", {
            "goals": {"type": "array", "minItems": 1, "items": {"type": "string", "enum": list(GOALS)}}}, ("goals",)))
    return definitions


def schema_errors(value, schema, path="result"):
    """Validate before normalization so malformed output cannot disappear silently."""
    errors = []
    kind = schema.get("type")
    valid = {"object": isinstance(value, dict), "array": isinstance(value, list),
             "string": isinstance(value, str)}.get(kind, False)
    if not valid:
        return [f"{path}: 必须是 {kind}"]
    if kind == "object":
        properties = schema.get("properties", {})
        for key in schema.get("required", []):
            if key not in value:
                errors.append(f"{path}.{key}: 缺少字段")
        for key, child in value.items():
            if key in properties:
                errors.extend(schema_errors(child, properties[key], f"{path}.{key}"))
            elif schema.get("additionalProperties") is False:
                errors.append(f"{path}.{key}: 未知字段")
            elif isinstance(schema.get("additionalProperties"), dict):
                errors.extend(schema_errors(child, schema["additionalProperties"], f"{path}.{key}"))
    elif kind == "array":
        if not schema.get("minItems", 0) <= len(value) <= schema.get("maxItems", float("inf")):
            errors.append(f"{path}: 数量不在允许范围内")
        for index, child in enumerate(value):
            errors.extend(schema_errors(child, schema["items"], f"{path}[{index}]"))
    elif kind == "string" and len(value) > schema.get("maxLength", float("inf")):
        errors.append(f"{path}: 超过最大字符数 {schema['maxLength']}")
    return errors


def text_format_errors(text, path):
    errors = []
    if re.search(r"[\x00-\x08\x0b-\x1f\t]", text):
        errors.append(f"{path}: 存在控制字符，请正确转义 LaTeX 反斜杠")
    # Ignore escaped currency dollars; keep a single delimiter stack so mixing
    # inline/block or parenthesized delimiters is also rejected.
    opened, position = None, 0
    for match in re.finditer(r"(?<!\\)(?:\$\$|\$)|\\[()\[\]]", text):
        token = match.group()
        if opened is None:
            if token in (r"\)", r"\]"):
                errors.append(f"{path}: 公式分隔符不匹配")
                break
            opened, position = token, match.end()
        else:
            expected = {r"\(": r"\)", r"\[": r"\]"}.get(opened, opened)
            if token != expected:
                errors.append(f"{path}: 公式分隔符不匹配")
                break
            formula = text[position:match.start()]
            depth = 0
            for brace in re.findall(r"(?<!\\)[{}]", formula):
                depth += 1 if brace == "{" else -1
                if depth < 0:
                    break
            if depth != 0:
                errors.append(f"{path}: 公式花括号不匹配")
            if re.search(r"_[A-Za-z][A-Za-z0-9]+", formula):
                errors.append(f"{path}: 多字符下标必须使用花括号")
            if opened == "$$":
                before, after = text[:position - 2], text[match.end():]
                if ((before.strip() and not before.endswith("\n\n"))
                        or (after.strip() and not after.startswith("\n\n"))):
                    errors.append(f"{path}: 块公式前后必须空一行")
            opened = None
    else:
        if opened is not None:
            errors.append(f"{path}: 公式分隔符未闭合")
    return errors


def validate_result(result, goals):
    schema = result_schema()
    fields = [field for goal in goals for field in GOAL_FIELDS[goal]]
    schema["required"] = fields
    errors = schema_errors(result, schema)
    if errors:
        return errors
    # Empty bibliographic values are valid when the source does not provide them.
    if "keywords" in goals:
        keywords, explanations = result["keywords"], result["keywordExplanations"]
        if len({term.strip().casefold() for term in keywords}) != len(keywords):
            errors.append("keywords: 关键词重复")
        if not all(term.strip() for term in keywords):
            errors.append("keywords: 关键词不能为空")
        if set(explanations) != set(keywords) or not all(v.strip() for v in explanations.values()):
            errors.append("keywordExplanations: 必须为每个关键词提供且只提供对应的非空释义")
    if "threeLine" in goals:
        for key, value in result["threeLineSummary"].items():
            if not value.strip():
                errors.append(f"threeLineSummary.{key}: 不能为空")
    if "method" in goals:
        for key in ("methodOverview", "methodConclusion"):
            if not result[key].strip():
                errors.append(f"{key}: 不能为空；原文未提供时明确说明限制")
        titles = []
        for index, section in enumerate(result["methodSections"]):
            for key in ("title", "content"):
                if not section[key].strip():
                    errors.append(f"methodSections[{index}].{key}: 不能为空")
            titles.append(section["title"].strip().casefold())
        if len(set(titles)) != len(titles):
            errors.append("methodSections: 存在重复的方法标题，请合并或区分")

    def inspect(value, path):
        if isinstance(value, str):
            errors.extend(text_format_errors(value, path))
        elif isinstance(value, dict):
            for key, item in value.items():
                inspect(item, f"{path}.{key}")
        elif isinstance(value, list):
            for index, item in enumerate(value):
                inspect(item, f"{path}[{index}]")

    for field in fields:
        inspect(result[field], field)
    return list(dict.fromkeys(errors))


class AnalysisState(TypedDict):
    messages: list
    result: dict
    reply: dict
    rounds: int
    calls: int
    read_ranges: list
    done: bool
    trace: list
    goals: list


async def analyze_paper(paper_text, goals, goal, model, emit=lambda event: None):
    # Import lazily: opening the web app still works without the optional runtime.
    from langgraph.graph import END, START, StateGraph

    goal = validate_goal(goal)
    infer_goals = goals is None and bool(goal)
    goals = [] if infer_goals else normalize_goals(goals)
    if not isinstance(paper_text, str) or len(paper_text.strip()) < 80:
        raise ValueError("Please provide at least 80 characters of paper text.")
    prompt_path = Path(__file__).resolve().parents[1] / "prompts/agent/paper_analysis.txt"
    messages = [{"role": "system", "content": prompt_path.read_text(encoding="utf-8")},
                {"role": "user", "content": json.dumps({"goals": goals, "goal": goal,
                    "paperLength": len(paper_text), "outputSchema": result_schema(),
                    "notice": "先按需读取原文。goals 是最终交付目标，不是执行顺序。"}, ensure_ascii=False)}]

    async def agent(state):
        if state["rounds"] >= MAX_ROUNDS or state["calls"] >= MAX_TOOL_CALLS:
            raise ValueError("论文解析达到调用上限，未通过校验的结果不会提交。请缩小目标后重试。")
        if len(json.dumps(state["messages"], ensure_ascii=False)) > MAX_CONTEXT_CHARS:
            raise ValueError("论文解析上下文超过预算，请缩小目标后重试。")
        emit({"stage": "agent_progress", "summary": {"detail": "正在分析论文并选择下一步…", "round": state["rounds"] + 1}})
        reply = await model.complete(state["messages"], analysis_tools(infer_goals and not state["goals"]))
        return {"messages": state["messages"] + [reply], "reply": reply, "rounds": state["rounds"] + 1}

    def execute(state):
        messages, result, ranges = list(state["messages"]), deepcopy(state["result"]), list(state["read_ranges"])
        trace, calls, done = list(state["trace"]), state["calls"], False
        targets = list(state["goals"])
        requested = state["reply"].get("tool_calls") or []
        if not requested:
            messages.append({"role": "user", "content": "请使用工具读取原文、提交结果并调用 finish。文字回答不能替代结构化交付。"})
        for call in requested:
            calls += 1
            name = call["function"]["name"]
            emit({"stage": "agent_progress", "summary": {"detail": {
                "read_paper": "正在读取论文原文…", "search_paper": "正在定位论文内容…",
                "update_result": "正在整理分析结果…", "validate_result": "正在校验结构与公式格式…",
                "select_goals": "正在确定最终交付内容…",
                "finish": "正在检查最终结果…"}.get(name, "正在处理工具请求…"), "tool": name}})
            try:
                if done:
                    raise ValueError("任务已完成，后续工具未执行。")
                if calls > MAX_TOOL_CALLS:
                    raise ValueError("工具调用预算已用完。")
                args = json.loads(call["function"]["arguments"])
                if not isinstance(args, dict):
                    raise ValueError("工具参数必须是对象。")
                allowed = {"read_paper": {"start", "length"}, "search_paper": {"query"},
                           "update_result": {"patch"}, "validate_result": set(), "finish": set(), "select_goals": {"goals"}}
                if name not in allowed or set(args) - allowed[name]:
                    raise ValueError("工具或参数不在允许范围内。")
                if name == "select_goals":
                    if not infer_goals or targets:
                        raise ValueError("最终交付范围已确定，不能修改。")
                    if not isinstance(args.get("goals"), list):
                        raise ValueError("必须提供 goals。")
                    targets = normalize_goals(args["goals"])
                    observation = {"goals": targets, "requiredFields": [f for g in targets for f in GOAL_FIELDS[g]]}
                elif name == "read_paper":
                    start, length = args.get("start"), args.get("length", READ_CHARS)
                    if type(start) is not int or not 0 <= start < len(paper_text):
                        raise ValueError("start 必须是论文范围内的字符位置。")
                    if type(length) is not int or not 1 <= length <= READ_CHARS:
                        raise ValueError(f"length 必须是 1–{READ_CHARS} 的整数。")
                    end = min(start + length, len(paper_text))
                    observation = {"start": start, "end": end, "total": len(paper_text),
                                   "hasMore": end < len(paper_text), "text": paper_text[start:end]}
                    ranges.append([start, end])
                elif name == "search_paper":
                    query = args.get("query")
                    if not isinstance(query, str) or not query.strip() or len(query) > 240:
                        raise ValueError("query 必须是 1–240 字符的原文词语。")
                    matches = []
                    # Literal case-insensitive matching keeps source offsets exact.
                    for match in re.finditer(re.escape(query.strip()), paper_text, re.IGNORECASE):
                        start, end = max(0, match.start() - 1000), min(len(paper_text), match.end() + 1500)
                        matches.append({"start": start, "end": end, "text": paper_text[start:end]})
                        ranges.append([start, end])
                        if len(matches) == 5:
                            break
                    observation = {"matches": matches, "notice": "最多返回前 5 处匹配，不代表已阅读全文。"}
                elif name == "update_result":
                    patch = args.get("patch")
                    if not ranges:
                        raise ValueError("尚未读取原文，不能提交分析结果。")
                    if not isinstance(patch, dict) or not patch:
                        raise ValueError("patch 必须是非空对象。")
                    target_fields = {field for g in targets for field in GOAL_FIELDS[g]}
                    if set(patch) - target_fields:
                        raise ValueError("仅提交当前目标对应的结果字段。")
                    errors = schema_errors(patch, result_schema())
                    if errors:
                        raise ValueError("；".join(errors[:20]))
                    result.update(deepcopy(patch))
                    observation = {"updated": list(patch), "notice": "这是草稿，尚未作为最终结果保存。"}
                else:
                    errors = validate_result(result, targets)
                    if not targets:
                        errors.insert(0, "请先 select_goals，按用户目的确定最终交付范围。")
                    if not ranges:
                        errors.insert(0, "必须先读取论文原文。")
                    observation = {"valid": not errors, "errors": errors[:30]}
                    if name == "finish" and not errors:
                        done = True
                trace.append({"tool": name, "ok": True,
                              **({"valid": observation["valid"]} if "valid" in observation else {})})
            except (ValueError, TypeError) as exc:
                observation = {"error": str(exc)}
                trace.append({"tool": name, "ok": False, "error": str(exc)})
            messages.append({"role": "tool", "tool_call_id": call["id"],
                             "content": json.dumps(observation, ensure_ascii=False)})
        return {"messages": messages, "result": result, "read_ranges": ranges,
                "trace": trace, "calls": calls, "done": done, "goals": targets}

    graph = StateGraph(AnalysisState)
    graph.add_node("agent", agent)
    graph.add_node("tools", execute)
    graph.add_edge(START, "agent")
    graph.add_edge("agent", "tools")
    graph.add_conditional_edges("tools", lambda state: "done" if state["done"] else "continue",
                                {"done": END, "continue": "agent"})
    final = await graph.compile().ainvoke({"messages": messages, "result": {}, "reply": {}, "rounds": 0,
        "calls": 0, "read_ranges": [], "done": False, "trace": [], "goals": goals}, {"recursion_limit": MAX_ROUNDS * 2 + 2})
    # Return only requested fields plus the stable UI defaults. No draft escapes.
    result = empty_result()
    result.update(final["result"])
    return result, {"engine": "langgraph", "goals": final["goals"], "rounds": final["rounds"],
                    "toolCalls": final["calls"], "readRanges": final["read_ranges"],
                    "trace": final["trace"], "validated": True}


def run_analysis(paper_text, goals, goal, connection, custom_prompt, on_stage=None):
    """Use the current Python or the repository's configured optional runtime."""
    goal = validate_goal(goal)
    goals = None if goals is None and goal else normalize_goals(goals)
    try:
        import langgraph.graph  # noqa: F401
    except ImportError:
        from .discussion_agent_bridge import run_agent_worker

        payload = {"paperText": paper_text, "goals": goals, "goal": goal,
                   "connection": connection, "customPrompt": custom_prompt}
        result = None
        events = run_agent_worker(payload, "backend.paper_analysis", "正在启动论文解析 Agent…", timeout=1200)
        try:
            for event in events:
                if "result" in event:
                    result = (event["result"], event["raw"])
                elif on_stage:
                    on_stage(event.get("stage", "agent_progress"), event.get("summary", {"detail": event.get("status", "正在解析论文…")}))
        finally:
            events.close()
        if result is None:
            raise ValueError("论文解析 Agent 未返回通过校验的结果。")
        return result

    model = ConfiguredModel(connection=connection, custom_prompt=custom_prompt, timeout=120)
    return asyncio.run(analyze_paper(paper_text, goals, goal, model,
        lambda event: on_stage(event["stage"], event["summary"]) if on_stage else None))


def main():
    def emit(event):
        print(json.dumps(event, ensure_ascii=False), flush=True)

    try:
        payload = json.load(sys.stdin)
        model = ConfiguredModel(connection=tuple(payload["connection"]), custom_prompt=payload["customPrompt"], timeout=120)
        result, raw = asyncio.run(analyze_paper(payload["paperText"], payload["goals"], payload["goal"], model, emit))
        emit({"result": result, "raw": raw})
        emit({"done": True})
    except ImportError:
        emit({"error": "论文解析需要 LangGraph，请在 Agent 的 Python 环境安装 requirements-reading-agent.txt。"})
        return 1
    except (AgentError, ValueError) as exc:
        emit({"error": str(exc)})
        return 1
    except Exception:
        emit({"error": "论文解析 Agent 运行失败，请检查模型的原生工具调用支持与 Agent 依赖。"})
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
