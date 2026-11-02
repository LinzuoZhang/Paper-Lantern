// Shared by the paper discussion panel and the library research assistant.
const EDIT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>';
const DELETE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/></svg>';
const SEARCH_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>';

export function createDiscussionHistory({ documentNode = document, getThreads, getActiveId, onOpen, onRename, onDelete,
  threadList = null, title = null, titleEdit = null, historyButtons = [], filterThread = thread => Boolean(thread.messages?.length),
  onError = error => console.warn(error), popoverClass = "", emptyText = "在下方输入内容，开始新的讨论。" }) {
  let popover = null;
  let popoverList = null;
  let search = null;
  let anchor = null;
  let cancelEditor = null;
  const create = (tag, className, text) => {
    const node = documentNode.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const visible = () => getThreads().filter(filterThread).slice().sort((a, b) =>
    new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());
  function close() {
    cancelEditor?.();
    popover?.remove();
    popover = popoverList = search = anchor = null;
    documentNode.removeEventListener?.("click", close);
    documentNode.removeEventListener?.("keydown", escape);
    window.removeEventListener?.("resize", position);
    historyButtons.forEach(button => button.setAttribute("aria-expanded", "false"));
  }
  function escape(event) {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
  }
  function position() {
    if (!popover || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = popover.offsetWidth, height = popover.offsetHeight;
    popover.style.left = `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))}px`;
    popover.style.top = `${window.innerHeight - rect.bottom >= height + 6 ? rect.bottom + 6 : Math.max(8, rect.top - height - 6)}px`;
  }
  function toggle(nextAnchor, event) {
    event?.preventDefault?.(); event?.stopPropagation?.();
    if (popover) { close(); return; }
    anchor = nextAnchor;
    popover = create("div", `discussion-history-popover ${popoverClass}`.trim());
    popover.setAttribute("role", "dialog"); popover.setAttribute("aria-label", "历史对话");
    const searchWrap = create("div", "discussion-history-search-wrap"); searchWrap.innerHTML = SEARCH_ICON;
    search = create("input", "discussion-history-search"); search.type = "search";
    search.placeholder = "搜索历史讨论"; search.setAttribute("aria-label", "搜索历史讨论");
    searchWrap.appendChild(search);
    popoverList = create("div", "discussion-history-list");
    popover.append(searchWrap, popoverList);
    documentNode.body.appendChild(popover);
    search.addEventListener("input", renderPopover);
    popover.addEventListener("click", event => event.stopPropagation());
    renderPopover(); position();
    historyButtons.forEach(button => button.setAttribute("aria-expanded", "true"));
    (window.requestAnimationFrame || (callback => callback()))(() => search?.focus());
    documentNode.addEventListener?.("click", close);
    documentNode.addEventListener?.("keydown", escape);
    window.addEventListener?.("resize", position);
  }
  async function open(thread) {
    try { await onOpen(thread.id); close(); } catch (error) { onError(error); }
  }
  function editButton(thread, handler, compact) {
    const button = create("button", compact ? "discussion-history-edit" : "icon-button discussion-thread-item-edit");
    button.type = "button"; button.title = "重命名对话";
    button.setAttribute("aria-label", `重命名对话“${thread.title || "新讨论"}”`); button.innerHTML = EDIT_ICON;
    button.addEventListener("click", event => { event.stopPropagation(); handler(); });
    return button;
  }
  function renderRows(list, compact, query = "") {
    if (cancelEditor && (list.querySelector(".discussion-history-rename-form") || list.querySelector(".discussion-thread-rename-form"))) return;
    list.replaceChildren();
    const normalized = String(query).trim().toLocaleLowerCase();
    const threads = visible().filter(thread => !normalized || String(thread.title || "").toLocaleLowerCase().includes(normalized));
    if (!threads.length) {
      list.appendChild(create("div", compact ? "discussion-history-empty" : "discussion-empty",
        normalized ? "没有匹配的讨论" : compact ? "暂无历史讨论" : emptyText));
      return;
    }
    for (const thread of threads) {
      const row = create("div", compact ? `discussion-history-item${thread.id === getActiveId() ? " active" : ""}` : "discussion-thread-item");
      row.setAttribute("role", "button"); row.setAttribute("aria-label", `打开对话“${thread.title || "新讨论"}”`); row.tabIndex = 0;
      const wrap = create(compact ? "span" : "div", compact ? "discussion-history-title-wrap" : "discussion-thread-item-title-wrap");
      const text = create(compact ? "span" : "button", compact ? "discussion-history-title" : "discussion-thread-open discussion-thread-item-title", thread.title || "新讨论");
      text.title = thread.title || "新讨论";
      if (!compact) { text.type = "button"; text.addEventListener("click", event => { event.stopPropagation(); void open(thread); }); }
      wrap.append(text, editButton(thread, () => startEditor(compact ? wrap : row, thread, compact ? "discussion-history-rename" : "discussion-thread-rename"), compact));
      const meta = create("span", compact ? "discussion-history-meta" : "discussion-thread-item-meta", formatDiscussionTime(thread));
      meta.title = "最后更新于 " + meta.textContent;
      const remove = create("button", compact ? "discussion-history-delete" : "icon-button discussion-thread-delete");
      remove.type = "button"; remove.title = "删除讨论";
      remove.setAttribute("aria-label", `删除对话“${thread.title || "新讨论"}”`); remove.innerHTML = DELETE_ICON;
      remove.addEventListener("click", async event => {
        event.stopPropagation();
        try { if (await onDelete(thread)) render(); } catch (error) { onError(error); }
      });
      row.append(wrap, meta, remove);
      row.addEventListener("click", event => {
        if (row.querySelector("form")) return;
        if (event.target !== row && event.target.closest?.("button, input, textarea, form")) return;
        void open(thread);
      });
      row.addEventListener("keydown", event => {
        if (event.target !== row || !["Enter", " "].includes(event.key) || row.querySelector("form")) return;
        event.preventDefault(); void open(thread);
      });
      list.appendChild(row);
    }
  }
  function renderPopover() { if (popoverList) { renderRows(popoverList, true, search?.value || ""); position(); } }
  function render() { if (threadList) renderRows(threadList, false); renderPopover(); }
  function startEditor(host, thread, prefix, header = false) {
    cancelEditor?.();
    const form = create("form", `${prefix}-form`);
    const input = create("input", `${prefix}-input`); input.type = "text"; input.maxLength = 120;
    input.value = thread.title || "新讨论"; input.setAttribute("aria-label", "对话标题"); form.appendChild(input);
    if (header) { title.hidden = titleEdit.hidden = true; title.insertAdjacentElement("afterend", form); }
    else host.replaceChildren(form);
    let settled = false, saving = false;
    const cleanup = (restoreFocus = false) => {
      if (settled) return;
      settled = true; cancelEditor = null;
      if (header) { form.remove(); title.hidden = false; titleEdit.hidden = !getActiveId(); }
      render();
      if (restoreFocus) titleEdit?.focus();
    };
    const finish = async (save, restoreFocus = false) => {
      if (settled || saving) return;
      const value = input.value.trim();
      if (save && value && value !== thread.title) {
        saving = input.disabled = true;
        try { await onRename(thread, value.slice(0, 120)); }
        catch (error) { saving = input.disabled = false; onError(error); if (!settled) input.focus(); return; }
        saving = false;
      }
      cleanup(restoreFocus);
    };
    cancelEditor = () => cleanup();
    form.addEventListener("click", event => event.stopPropagation());
    form.addEventListener("submit", event => { event.preventDefault(); event.stopPropagation(); void finish(true, header); });
    input.addEventListener("keydown", event => {
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); void finish(false, header); }
      else if (event.key === "Enter") { event.preventDefault(); void finish(true, header); }
    });
    input.addEventListener("blur", () => { void finish(true); });
    input.focus(); input.select?.();
  }
  function renameActive() {
    const thread = getThreads().find(thread => thread.id === getActiveId());
    if (thread && title && titleEdit) startEditor(title.parentElement, thread, "discussion-thread-title", true);
  }
  return { render, toggle, close, renameActive };
}

export async function generateDiscussionTitle({ apiFetch, readJsonResponse, paperTitle = "", question, answer, selectionReference = null }) {
  const response = await apiFetch("/api/discussion-title", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paperTitle, question, answer, selectionReference }) });
  const data = await readJsonResponse(response);
  if (!response.ok) throw new Error(data.detail || data.error || "生成讨论标题失败。");
  return String(data.title || "").replace(/\s+/g, " ").trim().slice(0, 42);
}

export function makeDiscussionTitle(text) {
  const value = String(text || "新讨论").replace(/\s+/g, " ").trim();
  return value.length > 42 ? `${value.slice(0, 39)}...` : value;
}

export function formatDiscussionTime(thread) {
  const date = new Date(thread.updatedAt || thread.createdAt);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return date.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

export function showDiscussionConfirm(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "reader-floating-confirm-overlay";
    const title = document.createElement("strong");
    title.className = "reader-floating-confirm-title";
    title.textContent = "确认操作";
    const body = document.createElement("p");
    body.className = "reader-floating-confirm-message";
    body.textContent = message;
    const actions = document.createElement("div");
    actions.className = "reader-floating-confirm-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "reader-floating-confirm-cancel";
    cancel.textContent = "取消";
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "reader-floating-confirm-ok danger";
    confirm.textContent = "删除";
    actions.append(cancel, confirm);

    const previouslyFocused = document.activeElement;
    let settled = false;
    const close = (value) => {
      if (settled) return;
      settled = true;
      overlay.remove();
      document.removeEventListener("keydown", onKeydown);
      previouslyFocused?.focus?.();
      resolve(value);
    };
    const onKeydown = (event) => {
      if (event.key === "Escape") close(false);
    };
    cancel.addEventListener("click", () => close(false));
    confirm.addEventListener("click", () => close(true));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close(false);
    });
    document.addEventListener("keydown", onKeydown);

    const card = document.createElement("section");
    card.className = "reader-floating-confirm-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", "discussionDeleteConfirmTitle");
    title.id = "discussionDeleteConfirmTitle";
    card.append(title, body, actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    confirm.focus();
  });
}

