"""Checkpointed catalog, native tool loop and source-verified report graph."""

import asyncio
from contextlib import AsyncExitStack
from copy import deepcopy
import json
import re
from time import monotonic

from backend.mcp_markdown import _without_code, validate_note_markdown
from .mcp_client import MODEL_TOOLS, PROJECT_ROOT, ResearchMCPClient
from .state import AgentError, AgentOptions, ResearchState
from .evidence import CLAIM_TOOL, audit_report, register_claim, report_with_paper_links, source_signatures
from .context import READ_EVIDENCE_TOOL, bounded_context, json_size, passage_view, recall_evidence
from .model import stream_model_reply


FINALIZATION_CALLS = 6
FINALIZATION_TOOLS = 12
FINALIZATION_VERSION = 1


class ReadingAgent:
    def __init__(self, options: AgentOptions, model, on_event=None, checkpoint_path=None, thread_id=None, guard=None):
        self.options = options
        self.model = model
        self.on_event = on_event
        self.events = []
        self.catalog = []
        self.allowed = set()
        self.scope_count = 0
        self.checkpoint_path = checkpoint_path
        self.thread_id = thread_id
        self.guard = guard
        self.private_reasoning = {}
        self.resumed = False

    def check_guard(self):
        if self.guard:
            self.guard()

    def emit(self, kind, **fields):
        event = {"type": kind, **fields}
        self.events.append(event)
        if self.on_event:
            self.on_event(event)

    async def call(self, name, arguments):
        self.check_guard()
        self.emit("tool_started", name=name)
        started = monotonic()
        try:
            result = await self.client.call(name, arguments)
        except Exception:
            self.emit("tool_finished", name=name, ok=False, elapsedMs=round((monotonic() - started) * 1000))
            raise
        self.emit("tool_finished", name=name, ok=True, elapsedMs=round((monotonic() - started) * 1000))
        self.check_guard()
        return result

    async def prepare(self, _state):
        listing = await self.call("list_papers", {"hashes": list(self.options.hashes)} if self.options.hashes else {})
        records = listing["papers"]
        if self.options.category_ids:
            overview = await self.call("library_overview", {"limit": 1})
            parents = {item["id"]: item.get("parentId", "") for item in overview["categories"]}
            requested = {"uncategorized" if value.strip() in {"Uncategorized", "未分类"} else value.strip().replace("\\", "/")
                         for value in self.options.category_ids}
            if requested - parents.keys():
                raise AgentError("分类不存在：" + ", ".join(sorted(requested - parents.keys())))
            scope = set(requested)
            while True:
                expanded = scope | {key for key, parent in parents.items() if parent in scope}
                if expanded == scope:
                    break
                scope = expanded
            records = [record for record in records if scope.intersection(record["categoryIds"])]
        self.scope_count = len(records)
        records.sort(key=lambda record: (record.get("uploadedAt", ""), record["hash"]), reverse=True)
        selected = records[:self.options.max_catalog]
        candidates = []
        for start in range(0, len(selected), 20):
            batch = await self.call("list_paper_summaries", {"hashes": [item["hash"] for item in selected[start:start + 20]]})
            for paper in batch["papers"]:
                candidates.append({"hash": paper["hash"], "title": str(paper["title"])[:500],
                                   "abstract": str(paper.get("abstract") or "")[:800],
                                   "threeLineSummary": json.dumps(paper.get("threeLineSummary", {}), ensure_ascii=False)[:1200]})
        used = 0
        for paper in candidates:
            size = len(json.dumps(paper, ensure_ascii=False))
            if used + size > self.options.max_context_chars // 2:
                break
            self.catalog.append(paper)
            used += size
        self.allowed = {item["hash"] for item in records}
        self.emit("catalog_ready", scopePaperCount=self.scope_count, catalogPaperCount=len(self.catalog),
                  catalogTruncated=len(self.catalog) < self.scope_count)
        prompt = (PROJECT_ROOT / "prompts/agent/research.txt").read_text(encoding="utf-8")
        return {"messages": [{"role": "system", "content": prompt}, {"role": "user", "content": (
            ("之前的对话（仅作理解追问的背景；旧结论及 C 编号不是本轮证据，须重新读取原文并登记本轮结论）：\n"
             + json.dumps(self.options.conversation, ensure_ascii=False) + "\n\n" if self.options.conversation else "")
            + "本轮研究任务：\n" + self.options.task.strip() + "\n\n文献目录资料（摘要可能缺失或被截短）：\n"
            + json.dumps(self.catalog, ensure_ascii=False)
        )}], "model_calls": 0, "tool_calls": 0, "repairs": 0, "evidence": {}, "report": "", "retry": False,
                "claims": {}, "verification": {}, "catalog": self.catalog, "scope_count": self.scope_count,
                "allowed_ids": sorted(self.allowed), "finalizing": False, "finalization_calls": 0,
                "finalization_tool_calls": 0, "finalization_version": FINALIZATION_VERSION, "validation_error": ""}

    def scoped_arguments(self, name, arguments):
        if name not in MODEL_TOOLS or not isinstance(arguments, dict):
            raise AgentError("只允许本次已声明的只读研究工具。")
        args = deepcopy(arguments)
        if name in {"get_paper_highlights", "get_paper_annotations"}:
            if not isinstance(args.get("id"), str) or args["id"].strip() not in self.allowed:
                raise AgentError("文章不在本次研究目录中。")
            args["id"] = args["id"].strip()
            args.setdefault("limit", 5)
        elif name in {"get_paper_summary", "get_paper_passages"}:
            if not isinstance(args.get("hash"), str) or args["hash"].strip() not in self.allowed:
                raise AgentError("文章不在本次研究目录中。")
            args["hash"] = args["hash"].strip()
        else:
            ids = args.get("hashes", sorted(self.allowed))
            if not isinstance(ids, list) or any(not isinstance(key, str) or key.strip() not in self.allowed for key in ids):
                raise AgentError("hashes 必须是本次研究目录中的文章 ID 数组。")
            args["hashes"] = list(dict.fromkeys(key.strip() for key in ids))
        if name == "get_paper_passages":
            args.setdefault("limit", 5)
        if name == "search_paper_content":
            args.setdefault("limit", 10)
        if "limit" in args and (type(args["limit"]) is not int or not 1 <= args["limit"] <= 10):
            raise AgentError("每次工具读取 limit 须为 1–10，请分页获取。")
        return args

    async def model_step(self, state):
        self.check_guard()
        messages = list(state["messages"])
        if not self.catalog:
            return {"report": "所选范围内没有可用的 PDF 文献，未进行正文阅读或研究结论汇总。"}
        archive_chars = json_size([passage_view(item) for item in state["evidence"].values()]) + json_size(state.get("claims", {}))
        context_pressure = bool(state["evidence"]) and archive_chars >= self.options.max_context_chars * .60
        finalizing = (state.get("finalizing", False) or context_pressure or state["model_calls"] >= self.options.max_rounds
                      or state["tool_calls"] >= self.options.max_tool_calls)
        entering_finalization = finalizing and not state.get("finalizing", False)
        finalization_calls = state.get("finalization_calls", 0)
        if finalizing and finalization_calls >= FINALIZATION_CALLS:
            raise AgentError("报告校验失败：证据整理与修正预算已用尽，尚未生成有有效引文的报告。请缩小范围后新建任务。")
        if entering_finalization:
            self.emit("finalization_started", evidenceCount=len(state["evidence"]), claimCount=len(state.get("claims", {})),
                      reason="context_budget" if context_pressure else "research_budget")
        reserve = min(6000, self.options.max_context_chars // 10)
        tool_schemas = ([CLAIM_TOOL, READ_EVIDENCE_TOOL] if finalizing else
                        [self.client.tools[name] for name in sorted(MODEL_TOOLS)] + [CLAIM_TOOL, READ_EVIDENCE_TOOL])
        context_limit = min(int(self.options.max_context_chars * .70), self.options.max_context_chars - json_size(tool_schemas) - reserve - 2000)

        def compact():
            compacted, stats = bounded_context(messages[0], self.options.task, self.options.conversation,
                self.catalog, state["evidence"], state.get("claims", {}), self.scope_count,
                state.get("validation_error", ""), context_limit, state.get("focus_passage_ids", []))
            self.emit("context_compacted", evidenceCount=len(state["evidence"]), resumed=self.resumed, **stats)
            self.private_reasoning.clear()
            self.resumed = False
            return compacted

        if self.resumed or entering_finalization or json_size(messages) > self.options.max_context_chars * .70:
            # Restart the native tool conversation at a clean boundary. This
            # avoids persisting private reasoning while retaining checked data.
            messages = compact()
        force_final = finalizing and (finalization_calls >= FINALIZATION_CALLS - 1
                                     or state.get("finalization_tool_calls", 0) >= FINALIZATION_TOOLS)
        instruction = ""
        if finalizing:
            instruction = ("检索阶段已结束。仅使用已读正文片段，不再搜索或读取文献。"
                           "仍可实际调用 record_claim 登记发现、推断或局限，用已有 passageId 和逐字引文取得真实 C 编号；"
                           "可用 get_read_evidence 从本地回看已读原文，不会再次搜索或读取文件。"
                           "每次最多4个工具调用，不得自行编造编号。随后输出报告，在对应段落使用 [C1] 等已登记编号，"
                           "并使用资料中的完整 paperLinks；不得截短文章 ID，不要把证据编号放进代码块。"
                           f"已登记编号：{', '.join(state.get('claims', {})) or '无，须先登记'}。"
                           f"本阶段还可请求模型 {FINALIZATION_CALLS - finalization_calls} 次，"
                           f"登记工具 {max(0, FINALIZATION_TOOLS - state.get('finalization_tool_calls', 0))} 次。")
            if state.get("validation_error"):
                instruction += " 上次校验问题：" + state["validation_error"]
            if force_final:
                instruction += " 本轮是最终输出，只使用已登记的结论和编号生成报告，不再调用工具。"
            messages.append({"role": "user", "content": instruction})
        read_ids = {item["hash"] for item in state["evidence"].values()}
        material_titles = [item["title"] for item in self.catalog if item["hash"] in read_ids][:3]
        progress = {"summary": state.get("progress_summary", ""), "materialTitles": material_titles,
                    "readPaperCount": len(read_ids), "catalogPaperCount": len(self.catalog)}
        tools = [] if force_final else tool_schemas
        outgoing = []
        for message in messages:
            value = dict(message)
            key = tuple(call["id"] for call in message.get("tool_calls", []))
            if key and key in self.private_reasoning:
                value["reasoning_content"] = self.private_reasoning[key]
            outgoing.append(value)
        if json_size({"messages": outgoing, "tools": tools}) > self.options.max_context_chars - reserve:
            messages = compact()
            if instruction:
                messages.append({"role": "user", "content": instruction})
            outgoing = messages
        if json_size({"messages": outgoing, "tools": tools}) > self.options.max_context_chars - reserve:
            raise AgentError("研究问题和工具定义超过上下文预算，请缩短问题。完整证据和检查点已保留。")
        self.emit("model_started", call=state["model_calls"] + 1, finalOnly=force_final, finalizing=finalizing,
                  contextChars=json_size({"messages": outgoing, "tools": tools}), contextBudget=self.options.max_context_chars, **progress)
        reply = await stream_model_reply(self.model, outgoing, tools, self.emit, self.check_guard,
                                         state.get("claims", {}).values())
        self.check_guard()
        reasoning = reply.pop("reasoning_content", None)
        if reasoning and reply.get("tool_calls"):
            self.private_reasoning[tuple(call["id"] for call in reply.get("tool_calls", []))] = reasoning
        calls = reply.get("tool_calls", [])
        if force_final and calls:
            raise AgentError("模型在最终汇总阶段仍请求调用工具。")
        summary = state.get("progress_summary", "")
        if calls and reply.get("content", "").strip():
            summary = " ".join(reply["content"].split())[:180]
            self.emit("analysis_progress", **{**progress, "summary": summary})
        return {"messages": messages + [reply], "model_calls": state["model_calls"] + 1,
                "progress_summary": summary,
                "finalizing": finalizing, "finalization_calls": finalization_calls + int(finalizing),
                "finalization_version": FINALIZATION_VERSION}

    async def tools_step(self, state):
        messages = list(state["messages"])
        evidence = dict(state["evidence"])
        claims = dict(state.get("claims", {}))
        count = state["tool_calls"]
        finalization_tools = state.get("finalization_tool_calls", 0)
        focus_ids = list(state.get("focus_passage_ids", []))
        for call in messages[-1]["tool_calls"]:
            name = call["function"]["name"]
            count += 1
            if state.get("finalizing"):
                finalization_tools += 1
            try:
                if state.get("finalizing"):
                    if finalization_tools > FINALIZATION_TOOLS:
                        raise AgentError("证据登记工具预算已用尽，请使用已登记结论输出报告。")
                    if name not in {"record_claim", "get_read_evidence"}:
                        raise AgentError("检索阶段已结束，只能登记结论或通过 get_read_evidence 回看已读原文，不得再次检索。")
                elif count > self.options.max_tool_calls:
                    raise AgentError("已达到工具调用预算。")
                self.check_guard()
                raw_arguments = json.loads(call["function"]["arguments"])
                if name == "record_claim":
                    data = register_claim(raw_arguments, evidence, claims)
                    claims[data["claimId"]] = data
                    self.emit("claim_verified", claimId=data["claimId"], supportCount=len(data["supports"]))
                elif name == "get_read_evidence":
                    self.emit("tool_started", name=name)
                    data = recall_evidence(raw_arguments, evidence)
                    self.emit("tool_finished", name=name, ok=True, elapsedMs=0)
                    focus_ids = [item["passageId"] for item in data["passages"]] + focus_ids
                else:
                    arguments = self.scoped_arguments(name, raw_arguments)
                    data = await self.call(name, arguments)
                text = json.dumps(data, ensure_ascii=False)
                if len(text) > 24_000:
                    raise AgentError("工具结果超过 24,000 字符，请请求更少的文章或片段。")
                if name in {"get_paper_passages", "search_paper_content"}:
                    for passage in data.get("passages", data.get("matches", [])):
                        paper_hash = passage.get("hash", data.get("hash"))
                        if passage.get("source") == "full_text" and passage.get("text", "").strip() and paper_hash in self.allowed:
                            evidence[passage["passageId"]] = {"hash": paper_hash, **passage}
                            focus_ids.insert(0, passage["passageId"])
            except (AgentError, ValueError, TypeError) as exc:
                text = json.dumps({"isError": True, "message": str(exc)[:2000]}, ensure_ascii=False)
                self.emit("tool_rejected", name=name)
            messages.append({"role": "tool", "tool_call_id": call["id"], "content": text})
        self.check_guard()
        return {"messages": messages, "evidence": evidence, "tool_calls": count, "claims": claims,
                "focus_passage_ids": list(dict.fromkeys(focus_ids))[:8],
                "finalization_tool_calls": finalization_tools}

    def verify(self, state):
        report = state["messages"][-1].get("content", "").strip()
        read_ids = {item["hash"] for item in state["evidence"].values()}
        try:
            if not read_ids:
                raise ValueError("尚未通过工具取得论文正文，请调用 get_paper_passages 读取 full_text。")
            if not report:
                raise ValueError("最终报告为空。")
            # Catalog references may describe candidates whose originals have
            # not been read. Existence and source support are separate checks:
            # keep known candidate links valid without treating them as evidence.
            validate_note_markdown(report, {"papers": {key: {} for key in self.allowed | read_ids}}, 40_000)
            linked_ids = re.findall(r"(?<!!)\[(?:\\.|[^\]\\])+\]\(hash:([^\s)]+)\)", _without_code(report))
            if not read_ids.intersection(linked_ids):
                raise ValueError("报告必须用 [标题](hash:文章ID) 引用已读取正文的文献。")
            verification = audit_report(report, state.get("claims", {}), self.options.strict_evidence)
        except ValueError as exc:
            self.emit("report_reset")
            finalizing = state.get("finalizing", False) or (self.options.strict_evidence and bool(read_ids))
            exhausted = state.get("finalization_calls", 0) >= FINALIZATION_CALLS if finalizing else state["repairs"] >= 1
            if exhausted:
                raise AgentError("报告校验失败：" + str(exc)) from None
            self.emit("report_retry", reason=str(exc))
            return {"retry": True, "repairs": state["repairs"] + 1,
                    "finalizing": finalizing, "validation_error": str(exc)[:2000],
                    "messages": state["messages"] + [{"role": "user", "content": "报告校验失败，请修正：" + str(exc)}]}
        footer = (f"\n\n---\n检索范围：所选范围 {self.scope_count} 篇；本次目录 {len(self.catalog)} 篇；"
                  f"取得正文片段 {len(read_ids)} 篇。正文仅按已返回片段查阅，不代表全文覆盖。")
        if len(self.catalog) < self.scope_count:
            footer += " 首轮目录受预算限制，范围内文献未必逐篇查阅。"
        verification = audit_report(report + footer, state.get("claims", {}), self.options.strict_evidence)
        self.emit("report_ready", readPaperCount=len(read_ids), evidenceCount=len(state["evidence"]))
        return {"report": report + footer, "retry": False, "verification": verification}

    async def revalidate_sources(self, evidence):
        groups = {}
        for passage in evidence.values():
            groups.setdefault((passage["hash"], passage["sourceVersion"]), []).append(passage["passageId"])
        for (paper_hash, version), ids in groups.items():
            for start in range(0, len(ids), 50):
                try:
                    await self.call("get_paper_passages", {"hash": paper_hash, "sourceVersion": version,
                                    "passageIds": ids[start:start + 50], "limit": 50})
                except AgentError:
                    raise AgentError("已读原文发生变化、归档或不可读取。为避免混用版本，请新建研究任务。") from None

    async def verify_step(self, state):
        update = self.verify(state)
        if update.get("report"):
            before = await asyncio.to_thread(source_signatures, self.options.library_dir, state["evidence"])
            await self.revalidate_sources(state["evidence"])
            after = await asyncio.to_thread(source_signatures, self.options.library_dir, state["evidence"])
            if before != after:
                raise AgentError("核验期间原文发生变化，请新建研究任务。")
            update["verification"]["checks"]["sourcesRevalidated"] = True
            update["verification"]["sourceSignatures"] = after
        self.check_guard()
        return update

    def compile(self, checkpointer=None):
        try:
            from langgraph.graph import END, START, StateGraph
        except ImportError as exc:
            raise AgentError("缺少 LangGraph，请安装 requirements-reading-agent.txt。") from exc
        graph = StateGraph(ResearchState)
        graph.add_node("catalog", self.prepare)
        graph.add_node("agent", self.model_step)
        graph.add_node("tools", self.tools_step)
        graph.add_node("verify", self.verify_step)
        graph.add_edge(START, "catalog")
        graph.add_edge("catalog", "agent")
        graph.add_conditional_edges("agent", lambda state: "end" if state.get("report") else (
            "tools" if state["messages"][-1].get("tool_calls") else "verify"
        ), {"end": END, "tools": "tools", "verify": "verify"})
        graph.add_edge("tools", "agent")
        graph.add_conditional_edges("verify", lambda state: "retry" if state["retry"] else "end", {"retry": "agent", "end": END})
        return graph.compile(checkpointer=checkpointer)

    async def run(self):
        try:
            async with asyncio.timeout(self.options.total_timeout):
                async with AsyncExitStack() as stack:
                    saver = None
                    if self.checkpoint_path:
                        from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
                        saver = await stack.enter_async_context(AsyncSqliteSaver.from_conn_string(str(self.checkpoint_path)))
                    graph = self.compile(saver)
                    client = await stack.enter_async_context(ResearchMCPClient(self.options.library_dir, self.options.tool_timeout))
                    self.client = client
                    config = {"recursion_limit": (self.options.max_rounds + FINALIZATION_CALLS) * 4 + 16,
                              "configurable": {"thread_id": self.thread_id or "single-run"}}
                    initial = {}
                    if saver:
                        snapshot = await graph.aget_state(config)
                        if snapshot.values:
                            previous = snapshot.values
                            self.catalog = previous.get("catalog", [])
                            self.scope_count = previous.get("scope_count", 0)
                            self.allowed = set(previous.get("allowed_ids", []))
                            await self.revalidate_sources(previous.get("evidence", {}))
                            # A pre-finalization checkpoint may be stuck at a
                            # failed verifier with its entire model budget spent.
                            # Migrate it once, after validating the old sources;
                            # subsequent resumes retain the bounded new counters.
                            if (not previous.get("finalization_version") and not previous.get("report")
                                    and previous.get("evidence") and (previous.get("model_calls", 0) >= self.options.max_rounds
                                    or previous.get("tool_calls", 0) >= self.options.max_tool_calls or previous.get("repairs", 0) >= 1)):
                                update = {"finalizing": True, "finalization_calls": 0, "finalization_tool_calls": 0,
                                          "finalization_version": FINALIZATION_VERSION, "retry": True,
                                          "validation_error": "旧版任务在报告校验阶段中断。请登记已有正文的引文并修正完整文献链接后输出报告。"}
                                await graph.aupdate_state(config, update, as_node="tools")
                                self.emit("finalization_recovered", evidenceCount=len(previous["evidence"]))
                            self.resumed = True
                            initial = None
                            self.emit("checkpoint_resumed", modelCalls=previous.get("model_calls", 0))
                    state = await graph.ainvoke(initial, config)
        except TimeoutError:
            raise AgentError("研究任务超时；没有写入文献库或保存未完成报告。") from None
        result = {"report": state["report"], "task": self.options.task, "scopePaperCount": self.scope_count,
                "catalogPaperCount": len(self.catalog), "catalogTruncated": len(self.catalog) < self.scope_count,
                "readPaperIds": sorted({item["hash"] for item in state["evidence"].values()}),
                "evidence": list(state["evidence"].values()), "modelCalls": state["model_calls"],
                "toolCalls": state["tool_calls"], "usage": getattr(self.model, "usage", []), "events": self.events,
                "finalizationCalls": state.get("finalization_calls", 0),
                "finalizationToolCalls": state.get("finalization_tool_calls", 0),
                "claims": list(state.get("claims", {}).values()), "verification": state.get("verification", {})}
        papers = json.loads((self.options.library_dir / "library_db.json").read_text(encoding="utf-8"))["papers"]
        return report_with_paper_links(result, papers)
