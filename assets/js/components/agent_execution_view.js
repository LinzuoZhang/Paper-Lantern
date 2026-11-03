// Presentation only: previews describe intent; only operation receipts prove execution.
const labels = {
  list_papers: "整理文献目录", library_overview: "查看文献库概况", search_library: "搜索文献库",
  list_paper_summaries: "批量读取摘要", get_paper_summary: "查看论文摘要", search_paper_content: "搜索原文",
  get_paper_passages: "读取原文片段", get_read_evidence: "回看已读原文", get_item: "读取文献详情", list_flags: "查看标记",
  discover_tools: "发现可用工具", propose_library_plan: "提交操作计划", research_library: "查阅研究资料",
  get_task_plan: "查看操作计划", get_task_result: "回看工具结果",
  create_category: "创建分类", rename_category: "重命名分类", move_category: "移动分类", delete_category: "删除分类",
  set_item_categories: "替换文献分类", add_item_categories: "添加文献分类", remove_item_categories: "移除文献分类",
  update_paper: "修改文献信息", batch_update_items: "批量修改文献", batch_update_flags: "批量修改标记",
  create_flag: "创建标记", update_flag: "修改标记", create_note: "创建笔记", write_note: "修改笔记",
};
const fields = { title: "标题", categoryIds: "分类", flags: "标记", basicInfo: "文献元数据", notes: "笔记内容",
  doi: "DOI", name: "名称", color: "颜色", icon: "图标", parentId: "父分类", order: "排序", id: "编号" };
const statusLabels = { success: "已完成", failed: "失败", running: "正在执行", pending: "未执行", approval: "等待确认",
  skipped: "已跳过", unknown: "回执待核对", warning: "需核对" };
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
function icon(kind) {
  const paths = { success: '<path d="m8 12 3 3 5-6"/><circle cx="12" cy="12" r="9"/>',
    failed: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/>',
    running: '<path d="M12 3a9 9 0 1 1-9 9"/>',
    warning: '<path d="m12 3 10 18H2L12 3Zm0 6v4m0 4h.01"/>',
    pending: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 2"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>' };
  const span = node("span", `execution-icon execution-${kind}`);
  span.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[kind] || paths.warning}</svg>`;
  return span;
}
function badge(status, text) {
  const span = node("span", `execution-status execution-${status}`);
  span.append(icon(status === "approval" || status === "skipped" ? "pending" : status === "partial" || status === "unknown" ? "warning" : status), node("span", "", text));
  return span;
}
function button(text, action) {
  const control = node("button", "execution-button", text); control.type = "button";
  control.addEventListener("click", action); return control;
}
function countsText(operations) {
  const count = status => operations.filter(op => op.status === status).length;
  const parts = [`${operations.length} 项操作`];
  for (const [status, label] of [["success", "已完成"], ["failed", "失败"], ["running", "执行中"], ["approval", "待确认"], ["pending", "未执行"], ["skipped", "跳过"], ["unknown", "待核对"]]) {
    if (count(status)) parts.push(`${count(status)} 项${label}`);
  }
  return parts.join(" · ");
}
function references(value, refs = new Set()) {
  if (object(value)) {
    if (typeof value.ref === "string") refs.add(value.ref);
    for (const item of Object.values(value)) references(item, refs);
  } else if (Array.isArray(value)) value.forEach(item => references(item, refs));
  else if (typeof value === "string" && /^\{ref:[^{}]+\}$/.test(value)) refs.add(value.slice(5, -1));
  return [...refs];
}

// Reuse disclosure nodes by operation identity, preserving focus, open state and scroll on updates.
export function createExecutionView(host, { onCopyError = () => {} } = {}) {
  let identity, model, currentPlan;
  const disclosures = new Map(), groupNodes = new Map(), rowNodes = new Map();
  let heading, stats, notices, groupsHost, controls, actions, rawPlan;
  function disclosure(key, className) {
    const element = node("details", className), summary = node("summary", "execution-row");
    summary.append(icon("chevron"));
    const label = node("span", "execution-row-label"), meta = node("span", "execution-row-meta");
    summary.append(label, meta); element.append(summary);
    const body = node("div", "execution-detail"); element.append(body);
    const entry = { element, label, meta, body, touched: false, auto: false };
    summary.addEventListener("click", () => { entry.touched = true; });
    disclosures.set(key, entry); return entry;
  }
  function autoOpen(entry, shouldOpen) {
    // A newly failed operation must be surfaced once, including when its group was closed.
    if (shouldOpen && !entry.auto) entry.element.open = true;
    else if (!entry.touched) entry.element.open = shouldOpen;
    entry.auto = shouldOpen;
  }
  function rawDetail(key, data, label = "参数与原始结果") {
    const previous = disclosures.get(key);
    if (previous) { previous.body.querySelector("pre").textContent = JSON.stringify(data, null, 2); return previous; }
    const entry = disclosure(key, "execution-raw"); entry.label.textContent = label;
    const pre = node("pre", "execution-json", JSON.stringify(data, null, 2));
    const copy = button("复制", async () => {
      try { await navigator.clipboard.writeText(pre.textContent); copy.textContent = "已复制"; }
      catch { onCopyError(); }
    });
    entry.body.append(copy, pre); return entry;
  }
  function renderOperation(entry, op) {
    entry.body.replaceChildren();
    if (op.reason) entry.body.append(node("p", "execution-reason", op.reason));
    entry.body.append(node("p", "execution-caption", `顺序 ${op.index + 1} · ${op.id || "无编号"} · ${op.tool || "工具名称未提供"}`));
    const refs = references(op.original.arguments);
    if (refs.length) entry.body.append(node("p", "execution-caption", `依赖引用：${refs.join("、")}`));
    if (op.original.dependsOn || op.original.depends_on) entry.body.append(node("p", "execution-caption", `依赖操作：${executionValue(op.original.dependsOn || op.original.depends_on)}`));
    if (op.error) entry.body.append(node("p", "execution-error", op.error));
    if (op.uncertain) entry.body.append(node("p", "execution-warning", "可能已有部分写入，请核对当前文献库状态。"));
    if (op.changes.length) {
      entry.body.append(node("p", "execution-caption", `变更预览 · ${op.changes.length} 个对象${op.status === "success" ? " · 已收到执行成功回执" : " · 不代表已写入"}`));
      for (const change of op.changes) {
        const block = node("div", "execution-change");
        if (change.title || change.id) block.append(node("p", "execution-target", change.title || change.id));
        const diff = executionDiff(change);
        if (diff.length) {
          const table = node("table", "execution-diff");
          const head = node("thead"), tr = node("tr");
          ["字段", "修改前", "修改后"].forEach(text => { const th = node("th", "", text); th.setAttribute("scope", "col"); tr.append(th); });
          head.append(tr); const body = node("tbody");
          for (const field of diff) {
            const row = node("tr"); row.append(node("th", "", field.label), node("td", "", executionValue(field.before)), node("td", "", executionValue(field.after))); body.append(row);
            if (field.key === "flags" && Array.isArray(field.before) && Array.isArray(field.after)) {
              const added = field.after.filter(value => !field.before.includes(value)), removed = field.before.filter(value => !field.after.includes(value));
              block.append(node("p", "execution-caption", `新增标记：${executionValue(added)} · 移除标记：${executionValue(removed)}`));
            }
          }
          table.append(head, body); block.append(table);
        } else block.append(node("pre", "execution-json", JSON.stringify(change, null, 2)));
        entry.body.append(block);
      }
    }
    const raw = rawDetail(`raw:${op.id}:${op.index}`, { operation: op.original, preview: { arguments: op.arguments, changes: op.changes }, result: op.receipt ?? null });
    entry.body.append(raw.element);
  }
  function update(plan, { busy = false, actions: planActions = [] } = {}) {
    currentPlan = plan; model = executionModel(plan);
    const nextIdentity = `${plan.id || "legacy"}:${plan.version || ""}`;
    if (identity !== nextIdentity || !host.contains(heading)) {
      identity = nextIdentity; disclosures.clear(); groupNodes.clear(); rowNodes.clear(); host.replaceChildren();
      heading = node("div", "execution-header"); stats = node("p", "execution-stats");
      stats.setAttribute("role", "status"); stats.setAttribute("aria-live", "polite");
      notices = node("div", "execution-notices"); controls = node("div", "execution-controls"); groupsHost = node("div", "execution-groups"); actions = node("div", "research-plan-buttons");
      for (const [text, open] of [["展开全部", true], ["折叠全部", false]]) controls.append(button(text, () => {
        for (const entry of disclosures.values()) { entry.touched = true; entry.element.open = open; }
      }));
      host.append(heading, stats, notices, controls, groupsHost, actions);
      rawPlan = rawDetail("plan-raw", plan, "完整计划记录"); host.append(rawPlan.element);
    }
    host.hidden = false; host.dataset.state = model.status;
    heading.replaceChildren(node("h3", "execution-title", plan.proposal?.summary || "操作计划"), badge(busy ? "running" : model.status, busy ? "已确认，等待执行回执" : model.text));
    if (plan.version != null) heading.append(node("span", "execution-version", `V${plan.version}`));
    const c = model.counts;
    stats.textContent = `${c.total} 项操作 · ${c.success} 成功 · ${c.failed} 失败${c.skipped ? ` · ${c.skipped} 跳过` : ""}${c.pending ? ` · ${c.pending} 未执行` : ""}${c.approval ? ` · ${c.approval} 待确认` : ""}${c.running ? ` · ${c.running} 执行中` : ""}${c.unknown ? ` · ${c.unknown} 待核对` : ""}`;
    notices.replaceChildren();
    if (["draft", "awaiting_approval"].includes(plan.state) && !busy) notices.append(node("p", "execution-caption", "以下为变更预览，确认后才会执行写入。"));
    if (plan.kind === "tools") notices.append(node("p", "execution-caption", "工具请求记录；事件未提供的参数和结果不作推断，写入状态请查看操作计划回执。"));
    if (plan.failure?.error) notices.append(node("p", "execution-error", `${plan.failure.stage === "preview" ? "预览校验失败" : "计划遇到问题"}：${plan.failure.error}`));
    if (plan.failure?.possiblePartialWrite) notices.append(node("p", "execution-warning", "可能已有部分写入，请核对失败步骤后重新确认。"));
    if (plan.syncError) notices.append(node("p", "execution-warning", `文献库同步未完成：${plan.syncError}`));
    for (const group of model.groups) {
      let entry = groupNodes.get(group.key);
      if (!entry) { entry = disclosure(`group:${group.key}`, "execution-group"); groupNodes.set(group.key, entry); groupsHost.append(entry.element); }
      entry.label.textContent = group.label; entry.meta.textContent = countsText(group.operations);
      const attention = group.operations.some(op => ["running", "failed"].includes(op.status));
      autoOpen(entry, attention);
      for (const op of group.operations) {
        const key = `${op.id ?? "legacy"}:${op.index}`;
        let row = rowNodes.get(key);
        if (!row) { row = disclosure(`operation:${key}`, "execution-operation"); rowNodes.set(key, row); entry.body.append(row.element); }
        row.label.textContent = op.title ? `${op.label} · ${op.title}` : op.label;
        row.label.title = row.label.textContent;
        row.meta.replaceChildren(badge(op.status, statusLabels[op.status]));
        if (Number.isFinite(op.receipt?.elapsedMs)) row.meta.append(node("span", "execution-duration", `${op.receipt.elapsedMs} ms`));
        row.element.dataset.state = op.status;
        autoOpen(row, ["running", "failed"].includes(op.status));
        const keyData = JSON.stringify(op);
        if (row.rendered !== keyData) { renderOperation(row, op); row.rendered = keyData; }
      }
    }
    // Updated records may remove/revise operations without leaving stale rows behind.
    for (const [key, entry] of groupNodes) if (!model.groups.some(group => group.key === key)) { entry.element.remove(); groupNodes.delete(key); }
    for (const [key, entry] of rowNodes) if (!model.operations.some(op => `${op.id ?? "legacy"}:${op.index}` === key)) { entry.element.remove(); rowNodes.delete(key); }
    actions.replaceChildren();
    for (const action of planActions) { const control = button(action.label, action.run); control.disabled = busy || action.disabled; actions.append(control); }
    actions.hidden = !planActions.length;
    rawPlan.body.querySelector("pre").textContent = JSON.stringify(currentPlan, null, 2);
  }
  return { update };
}
