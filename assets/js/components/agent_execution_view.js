// Presentation only: previews describe intent; only operation receipts prove execution.
const labels = {
  list_papers: "整理文献目录", library_overview: "查看文献库概况", search_library: "搜索文献库",
  list_paper_summaries: "批量读取摘要", get_paper_summary: "查看论文摘要", search_paper_content: "搜索原文",
  get_paper_passages: "读取原文片段", get_read_evidence: "回看已读原文", get_item: "读取文献详情", list_flags: "查看标记",
  get_paper_highlights: "读取论文高亮", get_paper_annotations: "读取论文批注",
  add_paper_highlight: "新增论文高亮", add_paper_annotation: "追加论文批注",
  discover_tools: "发现可用工具", propose_library_plan: "提交操作计划", research_library: "查阅研究资料",
  get_task_plan: "查看操作计划", get_task_result: "回看工具结果",
  create_category: "创建分类", rename_category: "重命名分类", move_category: "移动分类", delete_category: "删除分类",
  set_item_categories: "替换文献分类", add_item_categories: "添加文献分类", remove_item_categories: "移除文献分类",
  update_paper: "修改文献信息", batch_update_items: "批量修改文献", batch_update_flags: "批量修改标记",
  create_flag: "创建标记", update_flag: "修改标记", create_note: "创建笔记", write_note: "修改笔记",
};
const fields = { title: "标题", categoryIds: "分类", flags: "标记", basicInfo: "文献元数据", notes: "笔记内容", highlights: "高亮与批注",
  doi: "DOI", name: "名称", color: "颜色", icon: "图标", parentId: "父分类", order: "排序", id: "编号" };
const list = value => Array.isArray(value) ? value : [];
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
export const executionValue = value => value === undefined ? "未提供" : value === null ? "无" :
  Array.isArray(value) ? (value.length ? value.map(executionValue).join("\n") : "无") :
  typeof value === "object" ? JSON.stringify(value, null, 2) : typeof value === "boolean" ? (value ? "是" : "否") : String(value);

export function executionModel(plan = {}) {
  const proposed = list(plan.proposal?.operations), preview = list(plan.preview), receipts = list(plan.results);
  // Keep proposal order and include orphaned legacy previews/receipts without hiding records.
  const ordered = [...proposed];
  for (const op of [...preview, ...receipts]) if (!ordered.some(item => item.id === op.id)) ordered.push(op);
  const operations = ordered.map((op, index) => {
    const detail = preview.find(item => item.id === op.id);
    const receipt = receipts.findLast(item => item.id === op.id);
    let status = receipt ? ({ completed: "success", success: "success", succeeded: "success", failed: "failed", error: "failed",
      running: "running", executing: "running", skipped: "skipped", cancelled: "skipped", pending: "pending", queued: "pending" }[receipt.status] || "unknown")
      : plan.state === "awaiting_approval" || plan.state === "draft" ? "approval" : "pending";
    if (!receipt && plan.failure?.operationId === op.id) status = "failed";
    const changes = list(detail?.changes || op.changes);
    const tool = op.tool || detail?.tool || receipt?.tool;
    return { ...op, ...detail, id: op.id, tool, index, receipt, changes, status,
      label: labels[tool] || detail?.label || op.label || tool || "未知操作",
      title: changes.find(change => change.title)?.title || "",
      error: receipt?.error || (plan.failure?.operationId === op.id ? plan.failure.error : ""),
      uncertain: Boolean(receipt?.possiblePartialWrite || (plan.failure?.operationId === op.id && plan.failure.possiblePartialWrite)),
      original: op };
  });
  const counts = { total: operations.length, success: 0, failed: 0, running: 0, pending: 0, approval: 0, skipped: 0, unknown: 0 };
  for (const op of operations) counts[op.status]++;
  let status = "pending", text = "计划已生成";
  if (plan.state === "awaiting_approval") { status = "approval"; text = "等待用户确认"; }
  else if (counts.running || ["executing", "running"].includes(plan.state)) { status = "running"; text = "正在执行"; }
  else if (counts.failed || plan.state === "failed") { status = counts.success ? "partial" : "failed"; text = counts.success ? "部分执行成功" : (plan.failure?.stage === "preview" ? "预览校验失败" : "执行失败"); }
  else if (counts.total && counts.success === counts.total) { status = "success"; text = "执行完成"; }
  else if (counts.success) { status = "partial"; text = "部分执行成功"; }
  else if (plan.state === "completed") { status = "warning"; text = "回执不完整，需核对"; }
  else if (["stale", "cancelled", "superseded"].includes(plan.state)) {
    text = { stale: "计划已失效", cancelled: "计划已取消", superseded: "已由新计划替代" }[plan.state];
    status = plan.state === "stale" ? "warning" : "pending";
  }
  const groups = [];
  for (const op of operations) {
    const type = op.tool || op.label;
    let group = groups.at(-1);
    if (!group || group.type !== type) { group = { type, key: `${op.id ?? op.index}:${type}`, label: op.label, operations: [] }; groups.push(group); }
    group.operations.push(op);
  }
  return { operations, groups, counts, status, text };
}

// Only compare fields actually supplied by structured change data. Never parse prose into a diff.
export function executionDiff(change) {
  if (!object(change?.before) || !object(change?.after)) return [];
  return [...new Set([...Object.keys(change.before), ...Object.keys(change.after)])]
    .filter(key => JSON.stringify(change.before[key]) !== JSON.stringify(change.after[key]))
    .map(key => ({ key, label: fields[key] || key, before: change.before[key], after: change.after[key] }));
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
// Present only readable plans and receipt-backed outcomes, without technical disclosures.
export function executionSummary(plan, model = executionModel(plan)) {
  const c = model.counts;
  if (plan.failure?.stage === "preview") return "操作计划校验失败，本次未执行任何修改。";
  if (model.status === "success") return "已完成。";
  if (model.status === "running") return `正在执行已确认的操作，已完成 ${c.success} 项。`;
  if (model.status === "partial" || model.status === "failed") {
    const remaining = c.pending + c.skipped + c.approval;
    return `操作${c.success ? "部分完成" : "未完成"}：${c.success} 项已完成，${c.failed} 项失败${remaining ? `，${remaining} 项未执行` : ""}${c.unknown ? `，${c.unknown} 项结果待核对` : ""}。`;
  }
  if (plan.state === "completed") return "尚未收到完整的操作结果，暂时无法确认所有修改是否完成，请核对文献库。";
  return { stale: "原计划已失效，请根据当前文献库状态调整计划后重新确认。",
    cancelled: "计划已取消。", superseded: "此计划已由新方案替代。" }[plan.state] || "";
}

function completedText(operations) {
  const names = [...new Set(operations.flatMap(op => {
    const args = op.arguments || op.original.arguments || {};
    return op.changes.map(change => change.title || change.after?.name || change.after?.title).filter(Boolean)
      .concat(op.receipt?.output?.categoryId || args.name || args.title || []);
  }))];
  const targets = names.slice(0, 3).map(name => `“${name}”`).join("、");
  return `已${operations[0].label}${targets ? `：${targets}${names.length > 3 ? `等 ${names.length} 个对象` : ""}` : ""}。`;
}

function completedNote(op) {
  const args = op.arguments || op.original.arguments || {};
  const saved = op.changes.find(change => change.after?.title)?.after;
  const title = saved?.title || args.title;
  const categories = list(saved?.categoryIds || args.categoryIds)
    .filter(value => typeof value === "string").map(value => value === "uncategorized" ? "未分类" : value);
  const location = categories.length ? `，保存到${categories.map(value => `“${value}”`).join("、")}` : "";
  const result = node("p", "execution-result-text", `已新建独立笔记${title ? `《${title}》` : ""}${location}。`);
  const noteId = op.receipt?.output?.noteId;
  if (typeof noteId === "string" && noteId) {
    const link = node("a", "execution-result-link", "打开笔记");
    link.href = `./note.html?id=${encodeURIComponent(noteId)}`;
    link.target = "_blank"; link.rel = "noopener";
    if (title) link.setAttribute("aria-label", `打开笔记《${title}》`);
    result.append(link);
  }
  return result;
}

export function createExecutionView(host) {
  let summary, outcome, notices, actions;
  function update(plan, { busy = false, actions: planActions = [] } = {}) {
    const model = executionModel(plan);
    if (!host.contains(summary)) {
      summary = node("p", "execution-plan-text");
      outcome = node("div", "execution-outcome");
      outcome.setAttribute("role", "status"); outcome.setAttribute("aria-live", "polite");
      notices = node("div", "execution-notices");
      actions = node("div", "research-plan-buttons");
      host.replaceChildren(summary, outcome, notices, actions);
    }
    host.hidden = false; host.dataset.state = busy ? "running" : model.status;
    const awaiting = ["draft", "awaiting_approval"].includes(plan.state);
    summary.textContent = plan.proposal?.summary || (awaiting ? plan.legacyResult?.report : "") || "";
    // Once execution begins, show outcomes instead of retaining the proposal in future tense.
    summary.hidden = !summary.textContent || busy || !awaiting;
    outcome.replaceChildren(); notices.replaceChildren();
    if (busy || !awaiting) {
      const text = busy ? "正在执行已确认的操作，请稍候…" : executionSummary(plan, model);
      if (text && (busy || model.status !== "success")) outcome.append(node("p", "execution-result-text", text));
      if (!busy) {
        // Legacy history may only contain the persisted natural-language report.
        if (!model.operations.length && plan.state === "completed" && plan.legacyResult?.kind !== "plan" && plan.legacyResult?.report) {
          outcome.replaceChildren(node("p", "execution-result-text", plan.legacyResult.report));
        } else {
          for (const group of model.groups) {
            const completed = group.operations.filter(op => op.status === "success");
            if (group.type === "create_note") completed.forEach(op => outcome.append(completedNote(op)));
            else if (completed.length) outcome.append(node("p", "execution-result-text", completedText(completed)));
          }
        }
      }
    }
    for (const op of model.operations.filter(op => op.error)) {
      notices.append(node("p", "execution-error", `${op.label}${op.title ? `（${op.title}）` : ""}未完成：${op.error}`));
    }
    if (plan.failure?.error && !model.operations.some(op => op.error === plan.failure.error)) {
      notices.append(node("p", "execution-error", plan.failure.error));
    }
    if (plan.failure?.possiblePartialWrite || model.operations.some(op => op.uncertain)) {
      notices.append(node("p", "execution-warning", "失败步骤可能已产生部分修改，请核对当前文献库后再调整计划。"));
    }
    if (plan.syncError) notices.append(node("p", "execution-warning", `文献库修改已保存，但同步未完成：${plan.syncError}`));
    actions.replaceChildren();
    for (const action of planActions) {
      const control = node("button", "execution-button", action.label); control.type = "button";
      control.disabled = busy || action.disabled;
      control.addEventListener("click", action.run); actions.append(control);
    }
    actions.hidden = !planActions.length;
  }
  return { update };
}
