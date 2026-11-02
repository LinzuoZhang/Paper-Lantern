import { createDiscussionHistory, generateDiscussionTitle, makeDiscussionTitle, showDiscussionConfirm } from "./discussion_history.js";
import { initDiscussionComposer, createDiscussionPaperPicker } from "./discussion_composer.js";

const POSITION_KEY = "paperLanternResearchPosition";
const LAYOUT_KEY = "paperLanternResearchLayout";
const SIZE = 38;
const MARGIN = 16;

function planValue(value) {
  if (value == null) return "无";
  if (Array.isArray(value)) return value.length ? value.map(planValue).join("、") : "无";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value !== "object") return String(value) || "无";
  if ("parentId" in value && "name" in value) return `分类：${value.id || value.name}${value.order == null ? "" : `\n排序：${value.order}`}`;
  const labels = { title: "标题", categoryIds: "分类", doi: "DOI", basicInfo: "文献信息", notes: "笔记内容", flags: "标记", name: "名称", color: "颜色", icon: "图标", id: "编号" };
  return Object.entries(value).filter(([key]) => !["builtin", "locked", "updatedAt"].includes(key) && (key !== "id" || !("title" in value || "name" in value)))
    .map(([key, item]) => typeof item === "object" && item?.parentId != null ? planValue(item) : `${labels[key] || key}：${planValue(item)}`).join("\n") || "无";
}

export function clampPanelWidth(width) {
  return Math.round(Math.min(600, Math.max(360, Number(width) || 420)));
}

export function clampPosition(point, width, height) {
  return { x: Math.max(MARGIN, Math.min(point.x, Math.max(MARGIN, width - SIZE - MARGIN))),
    y: Math.max(MARGIN, Math.min(point.y, Math.max(MARGIN, height - SIZE - MARGIN))) };
}

export function researchProgressText(progress, task = "") {
  const summary = typeof progress.summary === "string" ? progress.summary.trim() : "";
  let activity = progress.finalizing ? "正在整理已读资料，核对引文并组织回答…" : "正在分析资料…";
  if (summary) activity += `\n${summary}`;
  else if (!progress.finalizing && progress.readPaperCount > 0) activity = `正在比较已读取的 ${progress.readPaperCount} 篇文献，梳理与问题相关的方法、实验和局限…`;
  else if (!progress.finalizing) activity = `正在围绕“${task.replace(/\s+/g, " ").slice(0, 72)}”${progress.catalogPaperCount > 0 ? `筛选 ${progress.catalogPaperCount} 篇候选文献，确定需要查阅的内容` : "整理研究问题和查阅重点"}…`;
  const titles = (progress.materialTitles || []).filter(title => typeof title === "string" && title.trim());
  if (titles.length) activity += `\n已读资料：${titles.map(title => `《${title.slice(0, 52)}》`).join("、")}${progress.readPaperCount > titles.length ? `等 ${progress.readPaperCount} 篇` : ""}`;
  return activity;
}

export async function readResearchStream(response, receive) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  try {
    while (!finished) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      if (done && buffer) { lines.push(buffer); buffer = ""; }
      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") { finished = true; break; }
        receive(JSON.parse(data));
      }
      if (done) break;
    }
  } finally {
    if (!finished) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function initResearchAssistant({ apiFetch, readJsonResponse, getScope = () => ({ label: "整个文献库" }), getPapers = () => [], onNoteSaved = () => {}, showConfirm = showDiscussionConfirm }) {
  const find = id => document.getElementById(id);
  const launcher = find("researchLauncher");
  const panel = find("researchPanel");
  if (!launcher || !panel) return null;
  const form = find("researchForm");
  const input = find("researchTask");
  const submit = find("researchSubmit");
  const modelSelect = find("researchModelSelect");
  const modelStatus = find("researchModelStatus");
  const addPaper = find("researchAddPaper");
  const paperTray = find("researchPapers");
  const status = find("researchStatus");
  const report = find("researchReport");
  const answer = find("researchAnswer");
  const welcome = find("researchWelcome");
  const copy = find("researchCopy");
  const content = find("researchContent");
  const dockButton = find("researchDock");
  const resizeHandle = find("researchResize");
  const scopeLabel = find("researchScope");
  const conversationHeader = find("researchConversationHeader");
  const scrollBottom = find("researchScrollBottom");
  const libraryView = find("libraryView");
  const categoryPanel = document.querySelector?.(".category-panel");
  const infoPanel = find("paperInfoPanel");
  const dot = launcher.querySelector(".research-launcher-dot");
  const threadList = find("researchThreadList");
  const threadTitle = find("researchThreadTitle");
  const titleEdit = find("researchTitleEdit");
  const historyButton = find("researchHistoryButton");
  const question = find("researchQuestion");
  const messages = find("researchMessages");
  const actions = find("researchResultActions");
  const resume = find("researchResume");
  const save = find("researchSave");
  const note = find("researchNote");
  const planHost = find("researchPlan");
  let planKey = "", planVersion = 0, currentPlan = null, planBusy = false;
  let point;
  let saved = false;
  let drag = null;
  let suppressClick = false;
  let controller = null;
  let lastReport = "";
  let markdown = null;
  let job = null;
  let libraryKey = "";
  let cursor = 0;
  let generation = 0;
  let reconnectTimer = null;
  let leaving = false;
  let lastClaims = [];
  let submitting = false;
  let cancelRequested = false;
  let draftPapers = [];
  let renderedConversation = "";
  let progressSummary = "";
  const jobs = new Map();
  const titleRequests = new Set();
  const deletedIds = new Set();
  const openingNotes = new Set();
  const renderedReports = new WeakMap();
  let selectionVersion = 0;
  let mode = "docked", panelWidth = 420, restoreOpen = false, panelDrag = null;
  let followOutput = true, scrollFrame = null;
  try {
    const layout = JSON.parse(localStorage.getItem(LAYOUT_KEY));
    if (layout) {
      mode = layout.mode === "floating" ? "floating" : "docked";
      panelWidth = clampPanelWidth(layout.width);
      restoreOpen = layout.open === true;
    }
  } catch {}

  function persistLayout() {
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify({ mode, width: panelWidth, open: !panel.hidden })); } catch {}
  }
  function updateLayout() {
    const docked = mode === "docked" && !panel.hidden;
    document.body.classList.toggle("research-docked-open", docked);
    document.body.style.setProperty("--research-panel-width", `${panelWidth}px`);
    panel.dataset.mode = mode;
    panel.style.width = `${Math.min(panelWidth, window.innerWidth)}px`;
    if (mode === "docked") { panel.style.left = ""; panel.style.top = ""; }
    launcher.hidden = docked;
    resizeHandle?.setAttribute("aria-valuenow", String(panelWidth));
    if (resizeHandle) resizeHandle.hidden = mode !== "docked";
    if (dockButton) {
      const label = mode === "docked" ? "切换为浮窗" : "停靠到右侧";
      dockButton.title = label; dockButton.setAttribute("aria-label", label);
      dockButton.innerHTML = mode === "docked"
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18m-5-12-3 3 3 3"/></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18m-6-6 3-3-3-3"/></svg>';
    }
    // Collapse the presentation only; keep the detail DOM, scroll and saved width.
    const available = libraryView?.getBoundingClientRect().width || window.innerWidth - panelWidth;
    const categoryWidth = categoryPanel?.getBoundingClientRect().width || 228;
    const infoWidth = parseFloat(infoPanel?.style.width) || infoPanel?.getBoundingClientRect().width || 340;
    document.body.classList.toggle("research-details-collapsed", docked && available - categoryWidth - infoWidth - 16 < 500);
    placePanel();
    scheduleFollow();
  }
  function updateScrollUi() {
    if (scrollBottom) scrollBottom.hidden = !job || content.scrollHeight - content.clientHeight - content.scrollTop < 48;
  }
  function scheduleFollow() {
    if (panel.hidden || scrollFrame !== null) return;
    scrollFrame = window.requestAnimationFrame(() => {
      scrollFrame = null;
      if (followOutput) content.scrollTop = content.scrollHeight;
      updateScrollUi();
    });
  }
  content.addEventListener("scroll", () => {
    followOutput = content.scrollHeight - content.clientHeight - content.scrollTop < 48;
    updateScrollUi();
  }, { passive: true });
  content.addEventListener("wheel", event => { if (event.deltaY < 0) followOutput = false; }, { passive: true });
  content.addEventListener("keydown", event => {
    if (["ArrowUp", "PageUp", "Home"].includes(event.key)) followOutput = false;
  });
  scrollBottom?.addEventListener("click", () => { followOutput = true; scheduleFollow(); });
  dockButton?.addEventListener("click", () => {
    historyUi.close(); paperPicker.close();
    mode = mode === "docked" ? "floating" : "docked";
    updateLayout(); persistLayout();
  });
  resizeHandle?.addEventListener("pointerdown", event => {
    if (event.button !== 0 || mode !== "docked") return;
    event.preventDefault();
    historyUi.close(); paperPicker.close();
    panelDrag = { id: event.pointerId, x: event.clientX, width: panelWidth };
    resizeHandle.setPointerCapture(event.pointerId);
    document.body.classList.add("resizing-research");
  });
  resizeHandle?.addEventListener("pointermove", event => {
    if (!panelDrag || event.pointerId !== panelDrag.id) return;
    panelWidth = clampPanelWidth(panelDrag.width + panelDrag.x - event.clientX);
    updateLayout();
  });
  function endPanelResize(event) {
    if (!panelDrag || event.pointerId !== panelDrag.id) return;
    panelDrag = null;
    document.body.classList.remove("resizing-research");
    if (resizeHandle.hasPointerCapture(event.pointerId)) resizeHandle.releasePointerCapture(event.pointerId);
    persistLayout();
  }
  resizeHandle?.addEventListener("pointerup", endPanelResize);
  resizeHandle?.addEventListener("pointercancel", endPanelResize);
  resizeHandle?.addEventListener("lostpointercapture", endPanelResize);
  resizeHandle?.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    panelWidth = event.key === "Home" ? 360 : event.key === "End" ? 600
      : clampPanelWidth(panelWidth + (event.key === "ArrowLeft" ? 10 : -10));
    updateLayout(); persistLayout();
  });
  function resizeInput() {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, Math.min(220, window.innerHeight * .28))}px`;
  }
  input.addEventListener("input", resizeInput);
  const historyUi = createDiscussionHistory({ getThreads: () => [...jobs.values()].map(value => ({ ...value,
    title: value.title || makeDiscussionTitle(value.task), createdAt: new Date((value.createdAt || 0) * 1000).toISOString(),
    updatedAt: new Date((value.updatedAt || value.createdAt || 0) * 1000).toISOString(),
  })), getActiveId: () => job?.id, filterThread: () => true, threadList, title: threadTitle, titleEdit,
    historyButtons: historyButton ? [historyButton] : [], popoverClass: "research-history-popover",
    onOpen: openJob, onRename: renameJob, onDelete: deleteJob, onError: error => showStatus(error.message, true),
    emptyText: "在下方输入问题，开始新的库内研究。",
  });
  const activeStatuses = new Set(["queued", "running", "cancelling"]);
  const composer = initDiscussionComposer({ form, input, send: submit, modelSelect, modelStatus, apiFetch, readJsonResponse,
    moduleId: "readingAgent", isBlocked: () => submitting, onStop: stopResearch, onModelStateChange: renderDraftPapers });
  const paperPicker = createDiscussionPaperPicker({ getPapers, getSelectedIds: () => draftPapers.map(paper => paper.id), onSelect: attachPaper });
  addPaper?.addEventListener("click", event => {
    event.stopPropagation();
    if (!submitting && !(job && activeStatuses.has(job.status))) paperPicker.open(addPaper);
  });
  try {
    const value = JSON.parse(localStorage.getItem(POSITION_KEY));
    if (Number.isFinite(value?.x) && Number.isFinite(value?.y)) { point = value; saved = true; }
  } catch {}

  function viewport() { return { width: window.innerWidth, height: window.innerHeight }; }
  function placePanel() {
    if (panel.hidden || mode !== "floating" || !point) return;
    const { width, height } = viewport();
    const bounds = panel.getBoundingClientRect();
    const left = Math.max(MARGIN, Math.min(point.x + SIZE - bounds.width, width - bounds.width - MARGIN));
    const above = point.y - bounds.height - 12;
    const below = point.y + SIZE + 12;
    const top = above >= MARGIN ? above : below + bounds.height <= height - MARGIN ? below
      : Math.min(above, height - bounds.height - MARGIN);
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(Math.max(MARGIN, top))}px`;
  }
  function place(next) {
    point = clampPosition(next, window.innerWidth, window.innerHeight);
    launcher.style.left = `${Math.round(point.x)}px`;
    launcher.style.top = `${Math.round(point.y)}px`;
    placePanel();
  }
  function persist() {
    saved = true;
    try { localStorage.setItem(POSITION_KEY, JSON.stringify(point)); } catch {}
  }
  function resize() {
    place(saved ? point : { x: window.innerWidth - SIZE - 24, y: window.innerHeight - SIZE - 24 });
    updateLayout(); resizeInput();
  }
  function refreshScope() {
    const scope = draftPapers.length ? { label: `已加入 ${draftPapers.length} 篇论文`, hashes: draftPapers.map(paper => paper.id) } : getScope();
    if (scopeLabel) {
      const label = job && !draftPapers.length ? "当前会话" : scope.label || "文献库";
      scopeLabel.textContent = label === "整个文献库" ? "文献库" : label;
      scopeLabel.title = job && !draftPapers.length ? "继续使用本会话的研究范围" : label;
    }
    return scope;
  }
  function renderDraftPapers() {
    const busy = submitting || Boolean(job && activeStatuses.has(job.status));
    if (addPaper) addPaper.disabled = busy || draftPapers.length >= 12;
    if (paperTray) {
      paperTray.replaceChildren(); paperTray.hidden = !draftPapers.length;
      for (const paper of draftPapers) {
        const chip = document.createElement("span"); chip.className = "discussion-paper-chip";
        const link = document.createElement("a"); link.className = "discussion-paper-link";
        link.href = `./reader.html?id=${encodeURIComponent(paper.id)}`; link.target = "_blank"; link.rel = "noopener noreferrer";
        const authors = paper.basicInfo?.authors || [];
        link.textContent = authors.length > 1 ? `${authors[0]} et al.` : authors[0] || paper.title; link.title = paper.title;
        const remove = document.createElement("button"); remove.type = "button"; remove.className = "discussion-paper-remove";
        remove.textContent = "×"; remove.disabled = busy; remove.setAttribute("aria-label", `移除论文《${paper.title}》`);
        remove.addEventListener("click", () => { draftPapers = draftPapers.filter(value => value.id !== paper.id); renderDraftPapers(); refreshScope(); });
        chip.append(link, remove); paperTray.appendChild(chip);
      }
    }
    composer.refresh();
    resizeInput();
  }
  function attachPaper(paper) {
    if (submitting || (job && activeStatuses.has(job.status)) || draftPapers.length >= 12 || draftPapers.some(value => value.id === paper.id)) return;
    draftPapers.push(paper); renderDraftPapers(); refreshScope(); input.focus();
  }
  function toggle(open) {
    panel.hidden = !open;
    launcher.setAttribute("aria-expanded", String(open));
    launcher.setAttribute("aria-label", open ? "收起阅读助手" : "打开阅读助手");
    updateLayout(); persistLayout();
    if (open) {
      if (!controller) refreshScope();
      placePanel();
      resizeInput();
      if (!controller) input.focus({ preventScroll: true });
    } else { historyUi.close(); paperPicker.close(); launcher.focus({ preventScroll: true }); }
  }
  launcher.addEventListener("click", () => { if (!suppressClick) toggle(panel.hidden); });
  launcher.addEventListener("pointerdown", event => {
    if (event.button !== 0 || !event.isPrimary) return;
    historyUi.close();
    paperPicker.close();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, origin: { ...point }, moved: false };
    launcher.setPointerCapture(event.pointerId);
  });
  launcher.addEventListener("pointermove", event => {
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.hypot(dx, dy) >= 6) drag.moved = true;
    if (!drag.moved) return;
    launcher.classList.add("is-dragging");
    place({ x: drag.origin.x + dx, y: drag.origin.y + dy });
  });
  function endDrag(event) {
    if (!drag || drag.id !== event.pointerId) return;
    suppressClick = drag.moved;
    if (drag.moved) persist();
    drag = null;
    launcher.classList.remove("is-dragging");
    if (launcher.hasPointerCapture(event.pointerId)) launcher.releasePointerCapture(event.pointerId);
    setTimeout(() => { suppressClick = false; }, 0);
  }
  launcher.addEventListener("pointerup", endDrag);
  launcher.addEventListener("pointercancel", endDrag);
  launcher.addEventListener("keydown", event => {
    const moves = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] };
    if (!event.shiftKey || !moves[event.key]) return;
    event.preventDefault();
    const [x, y] = moves[event.key];
    place({ x: point.x + x, y: point.y + y });
    persist();
  });
  find("researchClose").addEventListener("click", () => toggle(false));
  panel.addEventListener("keydown", event => {
    if (event.key === "Escape" && !event.defaultPrevented && historyButton?.getAttribute("aria-expanded") !== "true"
      && !document.querySelector?.(".research-paper-picker")) { event.preventDefault(); toggle(false); }
  });
  panel.querySelectorAll("[data-research-prompt]").forEach(button => button.addEventListener("click", () => {
    if (controller) return;
    input.value = button.dataset.researchPrompt;
    composer.refresh(); resizeInput();
    input.focus();
  }));
  window.addEventListener("resize", resize);
  window.addEventListener("beforeunload", () => { leaving = true; historyUi.close(); paperPicker.close(); clearTimeout(reconnectTimer); controller?.abort(); });
  historyButton?.addEventListener("click", event => historyUi.toggle(historyButton, event));
  titleEdit?.addEventListener("click", () => historyUi.renameActive());
  find("researchNew")?.addEventListener("click", newConversation);
  find("researchBack")?.addEventListener("click", newConversation);
  async function cancelJob(id) {
    const data = await request("/cancel", { jobId: id });
    rememberJob(data.job);
    if (job?.id === id) applyJob(data.job);
  }
  async function stopResearch() {
    if (submitting) { cancelRequested = true; setBusy(true); showStatus("正在停止研究并保留进度…"); return; }
    if (!job || !activeStatuses.has(job.status)) return;
    try {
      composer.setBusy(true, { stopping: true });
      await cancelJob(job.id);
    }
    catch (error) { setBusy(Boolean(job && activeStatuses.has(job.status))); showStatus(error.message, true); }
  }
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(lastReport);
      copy.setAttribute("title", "已复制");
      copy.setAttribute("aria-label", "已复制");
      setTimeout(() => {
        copy.setAttribute("title", "复制报告");
        copy.setAttribute("aria-label", "复制报告");
      }, 1500);
    }
    catch { showStatus("复制失败，可选中报告文本进行复制。", true); }
  });
  function showStatus(text, error = false) {
    status.hidden = false;
    status.textContent = text;
    status.title = text;
    status.classList.toggle("is-error", error);
    scheduleFollow();
  }
  function renderReport(text, target = report, claims = lastClaims) {
    if (!markdown && window.markdownit) {
      markdown = window.markdownit({ html: false, linkify: false });
      if (window.texmath && window.katex) markdown.use(window.texmath, {
        engine: window.katex, delimiters: "dollars", katexOptions: { throwOnError: false },
      });
      const defaultFence = markdown.renderer.rules.fence;
      markdown.renderer.rules.fence = (tokens, idx, options, env, renderer) => {
        const language = markdown.utils.escapeHtml(tokens[idx].info.trim().split(/\s+/)[0] || "代码");
        return `<div class="research-code-block"><div class="research-code-toolbar"><span>${language}</span><button type="button" class="research-code-copy" title="复制代码" aria-label="复制代码">复制</button></div>${defaultFence(tokens, idx, options, env, renderer)}</div>`;
      };
      const defaultLink = markdown.renderer.rules.link_open || ((tokens, idx, options, _env, renderer) => renderer.renderToken(tokens, idx, options));
      markdown.renderer.rules.link_open = (tokens, idx, options, env, renderer) => {
        const token = tokens[idx];
        const href = token.attrGet("href") || "";
        if (href.startsWith("hash:")) token.attrSet("href", `./reader.html?id=${encodeURIComponent(href.slice(5))}`);
        const paperLink = /^\.\/reader\.html\?id=([^&]+)/.exec(token.attrGet("href") || "");
        if (paperLink) {
          const paper = getPapers().find(paper => paper.id === decodeURIComponent(paperLink[1]));
          token.attrSet("class", "research-paper-citation");
          if (paper?.title) token.attrSet("title", paper.title);
        }
        token.attrSet("target", "_blank");
        token.attrSet("rel", "noopener noreferrer");
        return defaultLink(tokens, idx, options, env, renderer);
      };
      markdown.renderer.rules.image = (tokens, idx) => markdown.utils.escapeHtml(tokens[idx].content);
    }
    const renderKey = JSON.stringify([text, claims]);
    if (renderedReports.get(target) !== renderKey) {
      if (markdown) target.innerHTML = markdown.render(text, { claims });
      else target.textContent = text;
      renderedReports.set(target, renderKey);
    }
    if (target !== report) return;
    report.hidden = false;
    if (answer) answer.hidden = false;
    if (actions) actions.hidden = false;
    welcome.hidden = true;
    copy.hidden = false;
    scheduleFollow();
  }
  content.addEventListener("click", async event => {
    const button = event.target.closest?.(".research-code-copy");
    if (!button) return;
    const code = button.closest(".research-code-block")?.querySelector("pre code");
    try {
      await navigator.clipboard.writeText(code?.textContent || "");
      button.textContent = "已复制";
      setTimeout(() => { button.textContent = "复制"; }, 1500);
    } catch { showStatus("复制失败，可选中代码进行复制。", true); }
  });
  const tools = { list_papers: "整理文献目录", list_paper_summaries: "筛选文献摘要", library_overview: "确认研究范围",
    get_paper_summary: "查阅摘要", search_paper_content: "搜索相关内容", get_paper_passages: "阅读原文片段", get_read_evidence: "回看已读原文" };
  function receive(event) {
    if (event.error) throw new Error(event.error);
    if (event.seq) { cursor = event.seq; remember(); }
    if (event.job) applyJob(event.job);
    if (event.status) showStatus(event.status);
    if (event.agent?.type === "tool_started") showStatus(`${tools[event.agent.name] || "查阅文献"}…${progressSummary ? `\n${progressSummary}` : ""}`);
    if (["model_started", "analysis_progress"].includes(event.agent?.type)) {
      progressSummary = event.agent.summary || "";
      showStatus(researchProgressText(event.agent, job?.task || input.value));
    }
    if (event.agent?.type === "catalog_ready") showStatus(`已找到 ${event.agent.catalogPaperCount} 篇候选文献，正在查阅…`);
    if (event.agent?.type === "report_ready") showStatus("正在整理研究报告…");
    if (event.agent?.type === "claim_verified") showStatus("已核验相关结论的原文引文…");
    if (event.agent?.type === "checkpoint_resumed") showStatus("已恢复上次查阅进度，正在继续…");
    if (["finalization_started", "finalization_recovered"].includes(event.agent?.type)) showStatus(event.agent.reason === "context_budget"
      ? "资料较多，正在聚焦已读原文、核对引文并整理回答…" : "正在整理已读证据、核验引文并生成报告…");
    if (event.report) { lastReport = event.report; renderReport(lastReport); status.hidden = true; }
  }
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (submitting || !composer.canSubmit()) return;
    await jobsReady;
    if (submitting || (job && activeStatuses.has(job.status))) return;
    followOutput = true;
    const context = job && !draftPapers.length ? null : refreshScope();
    const payload = { task: input.value.trim() };
    if (job) payload.jobId = job.id;
    if (context?.hashes) payload.hashes = context.hashes;
    if (context?.categoryIds) payload.categoryIds = context.categoryIds;
    if (payload.hashes?.length === 0) { showStatus("所选条目中没有可研究的论文。", true); return; }
    const submittedPapers = [...draftPapers];
    submitting = true;
    cancelRequested = false;
    const selectedVersion = ++selectionVersion;
    setBusy(true);
    if (resume) resume.hidden = true;
    welcome.hidden = true;
    panel.setAttribute("aria-busy", "true");
    showStatus("正在准备研究任务…");
    try {
      payload.requestId = globalThis.crypto?.randomUUID?.().replaceAll("-", "") || Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
      if (libraryKey) {
        try { localStorage.setItem(`paperLanternResearchJob:${libraryKey}`, JSON.stringify({ id: payload.jobId || payload.requestId, cursor: 0 })); } catch {}
      }
      const data = await request("", payload);
      rememberJob(data.job);
      if (cancelRequested && activeStatuses.has(data.job.status)) {
        const cancelled = await request("/cancel", { jobId: data.job.id });
        data.job = cancelled.job; rememberJob(data.job);
      }
      if (selectedVersion === selectionVersion) { input.value = ""; draftPapers = []; await selectJob(data.job, 0, true); }
    } catch (error) {
      // The server may have created the job before the response was lost.
      // Attach to the existing active task rather than issuing another POST.
      await loadJobs(true, selectedVersion === selectionVersion);
      const recovered = job && (payload.jobId ? job.id === payload.jobId && job.turnId === payload.requestId : job.id === payload.requestId);
      if (cancelRequested && recovered && activeStatuses.has(job.status)) {
        try { await cancelJob(job.id); } catch (cancelError) { showStatus(cancelError.message, true); }
      }
      if (selectedVersion === selectionVersion) {
        if (recovered) { input.value = ""; draftPapers = []; }
        else { draftPapers = submittedPapers; showStatus(error.message, true); }
        if (!lastReport && !job?.conversation?.length) welcome.hidden = false;
      }
    } finally {
      submitting = false;
      cancelRequested = false;
      setBusy(Boolean(job && activeStatuses.has(job.status)));
    }
  });

  async function request(suffix, payload) {
    const response = await apiFetch(`/api/reading-agent/jobs${suffix}`, payload === undefined ? {} : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.error || "无法访问研究任务，请重启 Paper Lantern 后重试。");
    return data;
  }
  function remember() {
    if (job && libraryKey) {
      try { localStorage.setItem(`paperLanternResearchJob:${libraryKey}`, JSON.stringify({ id: job.id, cursor })); } catch {}
    }
  }
  function setBusy(busy) {
    const active = busy || submitting;
    composer.setBusy(active, { stopping: cancelRequested || job?.status === "cancelling" });
    dot.hidden = !active;
    renderDraftPapers();
    panel.setAttribute("aria-busy", String(active));
  }
  function renderConversation(turns = []) {
    if (!messages) return;
    const key = JSON.stringify(turns);
    if (key === renderedConversation) return;
    renderedConversation = key;
    messages.replaceChildren();
    messages.hidden = !turns.length;
    for (const turn of turns) {
      const prompt = document.createElement("div"); prompt.className = "research-question";
      prompt.textContent = turn.task;
      messages.append(prompt);
      if (!turn.result?.report) continue;
      const response = document.createElement("div"); response.className = "research-answer research-previous-answer";
      const body = document.createElement("article"); body.className = "research-report";
      renderReport(turn.result.report, body, turn.result.claims || []);
      const toolbar = document.createElement("div"); toolbar.className = "research-result-actions";
      toolbar.setAttribute("role", "group"); toolbar.setAttribute("aria-label", "报告操作");
      const duplicate = document.createElement("button"); duplicate.type = "button"; duplicate.className = "research-icon-button";
      duplicate.innerHTML = copy.innerHTML; duplicate.setAttribute("title", "复制报告"); duplicate.setAttribute("aria-label", "复制报告");
      duplicate.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(turn.result.report); duplicate.setAttribute("title", "已复制"); }
        catch { showStatus("复制失败，可选中报告文本进行复制。", true); }
      });
      toolbar.append(duplicate);
      if (turn.noteId) {
        const openNote = document.createElement("a"); openNote.className = "research-icon-button";
        openNote.innerHTML = note?.innerHTML || "↗"; openNote.href = `./note.html?id=${encodeURIComponent(turn.noteId)}`;
        openNote.target = "_blank"; openNote.rel = "noopener";
        openNote.setAttribute("title", "打开笔记"); openNote.setAttribute("aria-label", "打开笔记");
        openNote.addEventListener("click", event => openReportNote(event, turn.turnId, openNote));
        openNote.addEventListener("auxclick", event => { if (event.button === 1) return openReportNote(event, turn.turnId, openNote); });
        toolbar.append(openNote);
      } else if (turn.status === "completed") {
        const saveNote = document.createElement("button"); saveNote.type = "button"; saveNote.className = "research-icon-button";
        saveNote.innerHTML = save?.innerHTML || "↓";
        saveNote.setAttribute("title", "保存为笔记"); saveNote.setAttribute("aria-label", "保存为笔记");
        saveNote.addEventListener("click", () => saveReport(turn.turnId, saveNote));
        toolbar.append(saveNote);
      }
      response.append(body, toolbar); messages.append(response);
    }
  }
  function applyJob(value) {
    if (deletedIds.has(value.id)) return;
    job = rememberJob(value);
    loadJobPlan(job);
    cursor = Math.max(cursor, job.eventAfter || 0);
    renderConversation(job.conversation);
    remember();
    const busy = activeStatuses.has(job.status);
    setBusy(busy);
    if (resume) resume.hidden = !["failed", "cancelled", "interrupted"].includes(job.status)
      || (job.status === "cancelled" && job.result?.kind === "plan");
    if (save) { save.hidden = job.status !== "completed" || Boolean(job.noteId); save.disabled = false; }
    if (note) {
      note.hidden = !job.noteId;
      if (job.noteId) note.href = `./note.html?id=${encodeURIComponent(job.noteId)}`;
    }
    if (actions) actions.hidden = !job.result?.report;
    if (job.result?.report) {
      lastClaims = job.result.claims || [];
      lastReport = job.result.report;
      renderReport(lastReport);
    } else {
      lastReport = ""; lastClaims = [];
      report.hidden = copy.hidden = true;
      if (answer) answer.hidden = true;
    }
    if (job.status === "completed") status.hidden = true;
    else if (job.status === "awaiting_approval") showStatus("计划尚未执行。请查看具体变更后确认，或继续追问调整方案。");
    else if (job.status === "failed" || job.status === "interrupted") showStatus(job.error || "任务中断，可从检查点继续。", true);
    else if (job.status === "cancelled") showStatus("研究已停止，已完成的查阅记录已保留。");
    else if (job.status === "cancelling") showStatus("正在停止研究并保留进度…");
    else if (job.status === "queued") showStatus("研究任务已创建，正在启动…");
    else if (job.status === "running") showStatus("研究正在后台进行，可关闭面板或稍后回来查看。");
    if (threadTitle) { threadTitle.textContent = job.title || makeDiscussionTitle(job.task); threadTitle.title = threadTitle.textContent; }
    if (conversationHeader) conversationHeader.hidden = false;
    if (titleEdit) titleEdit.hidden = false;
    if (question) { question.textContent = job.task; question.hidden = false; }
    input.placeholder = job.status === "awaiting_approval" ? "描述要调整的计划，或确认后执行…" : "继续追问，或输入新的文献库任务…";
    if (threadList) threadList.hidden = true;
    maybeGenerateTitle(job);
    historyUi.render();
    refreshScope(); scheduleFollow();
  }
  function rememberJob(value, render = true) {
    if (deletedIds.has(value.id)) return value;
    const previous = jobs.get(value.id);
    if (previous && (value.attempt || 0) < (previous.attempt || 0)) return previous;
    const next = { ...previous, ...value };
    if ((previous?.titleRevision || 0) > (value.titleRevision || 0)) {
      for (const key of ["title", "titleSource", "titleRevision"]) next[key] = previous[key];
    }
    jobs.set(value.id, next);
    if (render) historyUi.render();
    return next;
  }
  async function selectJob(value, savedCursor = 0, follow = false) {
    paperPicker.close(); draftPapers = []; refreshScope();
    generation++;
    controller?.abort();
    clearTimeout(reconnectTimer);
    controller = null;
    cursor = Math.max(savedCursor, value.eventAfter || 0);
    progressSummary = "";
    lastReport = ""; lastClaims = [];
    report.hidden = copy.hidden = true;
    if (answer) answer.hidden = true;
    welcome.hidden = true;
    followOutput = follow;
    applyJob(value);
    if (!follow) {
      if (value.conversation?.length) content.scrollTop += question.getBoundingClientRect().top - content.getBoundingClientRect().top - 20;
      else content.scrollTop = 0;
    }
    updateScrollUi();
    if (activeStatuses.has(value.status)) connect(value.id, generation);
  }
  async function connect(id, version) {
    if (leaving || version !== generation) return;
    controller = new AbortController();
    try {
      const response = await apiFetch(`/api/reading-agent/jobs/events?jobId=${encodeURIComponent(id)}&after=${cursor}`, { signal: controller.signal });
      if (response.status === 404 && version === generation) {
        jobs.delete(id); deletedIds.add(id);
        if (job?.id === id) newConversation();
        showStatus("此对话已删除。"); return;
      }
      if (!response.ok) { const data = await readJsonResponse(response); throw new Error(data.error || "进度连接不可用。"); }
      await readResearchStream(response, event => { if (version === generation) receive(event); });
      if (version === generation && activeStatuses.has(job?.status)) throw new Error("进度连接已断开");
    } catch (error) {
      if (version !== generation || leaving || error.name === "AbortError") return;
      showStatus("进度连接中断，任务仍在后台运行，正在重连…");
      reconnectTimer = setTimeout(() => connect(id, version), 2000);
    } finally {
      if (version === generation) controller = null;
    }
  }
  async function loadJobs(recover = false, restore = true) {
    if (!threadList) return;
    const version = selectionVersion;
    try {
      const data = await request("");
      libraryKey = data.libraryKey;
      for (const item of data.jobs) if (!deletedIds.has(item.id)) rememberJob(item, false);
      historyUi.render();
      if (!job) welcome.hidden = jobs.size > 0;
      let stored;
      try { stored = JSON.parse(localStorage.getItem(`paperLanternResearchJob:${libraryKey}`)); } catch {}
      const selected = data.jobs.find(item => activeStatuses.has(item.status)) || data.jobs.find(item => item.id === stored?.id);
      if (restore && selected && (!job || recover) && version === selectionVersion) {
        const full = (await request(`/status?jobId=${encodeURIComponent(selected.id)}`)).job;
        if (version === selectionVersion) await selectJob(full, full.id === stored?.id ? stored.cursor || 0 : 0);
      }
    } catch (error) { if (!panel.hidden) showStatus(error.message, true); }
  }
  function newConversation() {
      selectionVersion++;
      historyUi.close();
      paperPicker.close(); draftPapers = [];
      generation++; controller?.abort(); controller = null; clearTimeout(reconnectTimer);
      job = null; lastReport = ""; lastClaims = []; input.value = "";
      planVersion++; planKey = ""; currentPlan = null;
      if (planHost) { planHost.hidden = true; planHost.replaceChildren(); }
      progressSummary = "";
      report.hidden = copy.hidden = true; welcome.hidden = jobs.size > 0; status.hidden = true;
      if (actions) actions.hidden = true;
      renderConversation([]);
      if (answer) answer.hidden = true;
      if (resume) resume.hidden = true;
      if (question) question.hidden = true;
      if (threadList) threadList.hidden = false;
      if (threadTitle) { threadTitle.textContent = "新对话"; threadTitle.title = "新对话"; }
      if (conversationHeader) conversationHeader.hidden = true;
      if (scrollBottom) scrollBottom.hidden = true;
      followOutput = true;
      if (titleEdit) titleEdit.hidden = true;
      input.placeholder = "输入研究问题，或加入论文一起研究…";
      if (libraryKey) { try { localStorage.removeItem(`paperLanternResearchJob:${libraryKey}`); } catch {} }
      setBusy(false); refreshScope(); historyUi.render(); input.focus();
  }
  async function openJob(id) {
    const version = ++selectionVersion;
    const data = await request(`/status?jobId=${encodeURIComponent(id)}`);
    if (version === selectionVersion && !deletedIds.has(id)) await selectJob(data.job);
  }
  async function renameJob(thread, title) {
    const data = await request("/rename", { jobId: thread.id, title });
    if (deletedIds.has(thread.id)) return;
    rememberJob(data.job);
    if (job?.id === thread.id) { job = jobs.get(thread.id); if (threadTitle) threadTitle.textContent = threadTitle.title = job.title; }
  }
  async function deleteJob(thread) {
    const busy = activeStatuses.has(jobs.get(thread.id)?.status);
    if (!await showConfirm(`确定删除对话“${thread.title}”？${busy ? "正在运行的研究将同时停止。" : ""}`)) return false;
    await request("/delete", { jobId: thread.id });
    deletedIds.add(thread.id); jobs.delete(thread.id);
    if (job?.id === thread.id) newConversation();
    historyUi.render(); return true;
  }
  async function maybeGenerateTitle(value) {
    if (value.status !== "completed" || !value.result?.report || value.titleSource !== "provisional" || titleRequests.has(value.id)) return;
    titleRequests.add(value.id);
    try {
      const title = await generateDiscussionTitle({ apiFetch, readJsonResponse, paperTitle: "文献库研究", question: value.task, answer: value.result.report });
      if (!title || deletedIds.has(value.id)) return;
      const data = await request("/title", { jobId: value.id, title, expectedRevision: value.titleRevision || 0 });
      if (deletedIds.has(value.id)) return;
      rememberJob(data.job);
      if (job?.id === value.id) { job = jobs.get(value.id); if (threadTitle) threadTitle.textContent = threadTitle.title = job.title; }
    } catch (error) { console.warn("Failed to generate research conversation title.", error); }
  }
  resume?.addEventListener("click", async () => {
    if (!job) return;
    const id = job.id, version = selectionVersion, savedCursor = cursor;
    try {
      resume.disabled = true;
      const data = await request("/resume", { jobId: id });
      rememberJob(data.job);
      if (version === selectionVersion && job?.id === id && !deletedIds.has(id)) await selectJob(data.job, savedCursor, true);
    }
    catch (error) { showStatus(error.message, true); }
    finally { resume.disabled = false; }
  });
  async function ensureReportNote(id, turnId) {
    const data = await request("/save", { jobId: id, turnId });
    if (!deletedIds.has(id)) rememberJob(data.job);
    onNoteSaved(data);
    if (job?.id === id) applyJob(data.job);
    return data;
  }
  function renderPlan() {
    if (!planHost || !currentPlan) return;
    const plan = currentPlan;
    const states = { draft: "准备预览", awaiting_approval: "等待确认", executing: "正在执行", completed: "已执行", failed: "部分操作失败", stale: "文献库已变化", cancelled: "已取消", superseded: "已由新计划替代" };
    planHost.hidden = false; planHost.replaceChildren();
    const heading = document.createElement("h3"); heading.textContent = `操作计划 · V${plan.version} · ${states[plan.state] || plan.state}`;
    const summary = document.createElement("p"); summary.textContent = plan.proposal.summary;
    planHost.append(heading, summary);
    if (plan.syncError) { const sync = document.createElement("p"); sync.textContent = `文献库已更新，同步未完成：${plan.syncError}`; planHost.append(sync); }
    for (const operation of plan.preview || []) {
      const details = document.createElement("details");
      const label = document.createElement("summary");
      const result = (plan.results || []).find(value => value.id === operation.id);
      label.textContent = `${operation.label} · ${operation.changes?.length || 0} 项变更${result ? ` · ${result.status === "completed" ? "已完成" : result.status === "failed" ? "失败" : "处理中"}` : ""}`;
      details.append(label);
      if (operation.reason) { const reason = document.createElement("p"); reason.textContent = operation.reason; details.append(reason); }
      for (const change of operation.changes || []) {
        if (change.title) { const title = document.createElement("p"); title.textContent = change.title; details.append(title); }
        const before = document.createElement("pre"); before.textContent = `修改前\n${planValue(change.before)}\n\n修改后\n${planValue(change.after)}`;
        details.append(before);
      }
      if (result?.error) { const error = document.createElement("p"); error.textContent = result.error; details.append(error); }
      planHost.append(details);
    }
    const buttons = document.createElement("div"); buttons.className = "research-plan-buttons";
    function button(text, action) {
      const control = document.createElement("button"); control.type = "button"; control.textContent = text; control.disabled = planBusy;
      control.addEventListener("click", action); buttons.append(control);
    }
    if (plan.state === "awaiting_approval") {
      button(planBusy ? "正在执行…" : "确认执行", () => actOnPlan("approve"));
      button("修改计划", () => { input.placeholder = "说明要调整的范围、分类或操作…"; input.focus(); });
      button("取消计划", () => actOnPlan("cancel"));
    } else if (["failed", "stale", "executing"].includes(plan.state)) {
      button("重新生成预览", () => actOnPlan("retry"));
      button("修改计划", () => input.focus());
    }
    if (buttons.children.length) planHost.append(buttons);
  }
  async function loadJobPlan(value) {
    if (!planHost) return;
    const id = value.result?.planId;
    if (!id) { planKey = ""; planVersion++; currentPlan = null; planHost.hidden = true; return; }
    const key = `${value.id}:${id}:${value.status}`;
    if (key === planKey) return;
    planKey = key; const version = ++planVersion;
    currentPlan = null; planHost.hidden = false; planHost.textContent = "正在准备操作预览…";
    try {
      const data = await request("/plan/preview", { jobId: value.id, planId: id });
      if (version !== planVersion || job?.id !== value.id) return;
      currentPlan = data.plan; renderPlan();
    } catch (error) {
      if (version !== planVersion) return;
      planHost.textContent = `计划尚未执行，预览失败：${error.message} 可继续追问调整计划。`;
    }
  }
  async function actOnPlan(action) {
    if (!job || !currentPlan || planBusy) return;
    const id = job.id, selectedVersion = selectionVersion, plan = currentPlan;
    planBusy = true; renderPlan();
    if (action === "approve") showStatus("正在执行已确认的文献库操作…");
    try {
      const payload = { jobId: id, planId: plan.id };
      if (action === "approve") payload.digest = plan.digest;
      const data = await request(`/plan/${action}`, payload);
      rememberJob(data.job); onNoteSaved(data);
      if (selectedVersion === selectionVersion && job?.id === id) {
        currentPlan = data.plan;
        planKey = `${id}:${data.plan.id}:${data.job.status}`;
        await selectJob(data.job, cursor);
        renderPlan();
      }
    } catch (error) {
      showStatus(error.message, true);
      planKey = "";
      if (job?.id === id) await loadJobPlan(job);
    } finally { planBusy = false; renderPlan(); }
  }
  async function saveReport(turnId, button) {
    if (!job) return;
    const id = job.id;
    try {
      button.disabled = true;
      await ensureReportNote(id, turnId || id);
    }
    catch (error) { showStatus(error.message, true); }
    finally { button.disabled = false; }
  }
  async function openReportNote(event, turnId, control) {
    event.preventDefault();
    if (!job) return;
    const id = job.id, targetTurn = turnId || id, key = `${id}:${targetTurn}`;
    if (openingNotes.has(key)) return;
    openingNotes.add(key);
    control.setAttribute("aria-busy", "true");
    control.setAttribute("title", "正在检查笔记…");
    let destination;
    try {
      // Open during the click gesture so asynchronous validation isn't blocked.
      destination = window.open("about:blank", "_blank");
      if (destination) destination.opener = null;
      const data = await ensureReportNote(id, targetTurn);
      if (!data.note?.id) throw new Error("未能取得报告笔记，请稍后重试。");
      const url = new URL(`./note.html?id=${encodeURIComponent(data.note.id)}`, window.location.href).href;
      if (destination) {
        if (!destination.closed) destination.location.replace(url);
      } else window.location.assign(url);
    } catch (error) {
      destination?.close();
      showStatus(error.message, true);
    } finally {
      openingNotes.delete(key);
      control.setAttribute("aria-busy", "false");
      control.setAttribute("title", "打开笔记");
    }
  }
  save?.addEventListener("click", () => saveReport(job?.turnId, save));
  note?.addEventListener("click", event => openReportNote(event, job?.turnId, note));
  note?.addEventListener("auxclick", event => { if (event.button === 1) return openReportNote(event, job?.turnId, note); });
  const jobsReady = loadJobs();
  resize();
  if (typeof ResizeObserver !== "undefined") {
    const layoutObserver = new ResizeObserver(updateLayout);
    [libraryView, categoryPanel, infoPanel].filter(Boolean).forEach(node => layoutObserver.observe(node));
    const contentObserver = new ResizeObserver(scheduleFollow);
    [report, messages].filter(Boolean).forEach(node => contentObserver.observe(node));
    window.addEventListener("beforeunload", () => { layoutObserver.disconnect(); contentObserver.disconnect(); });
  }
  if (restoreOpen) toggle(true);
  return { refreshScope, open: () => toggle(true) };
}
