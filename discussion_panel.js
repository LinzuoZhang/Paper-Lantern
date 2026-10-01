const SEND_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 2 11 13"></path><path d="m22 2-7 20-4-9-9-4 20-7z"></path></svg>';
const STOP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1.5"></rect></svg>';
const EDIT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"></path></svg>';
const COPY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
const SEARCH_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg>';
const REFERENCE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 12 4 16l4 4"></path><path d="M4 16h10a4 4 0 0 0 4-4V4"></path></svg>';

export function initDiscussionPanel({
  root = document,
  getItem,
  getContextText,
  getSummary = () => ({}),
  saveItem,
  apiFetch,
  readJsonResponse,
  copyText = copyTextToClipboard,
  onCopied = null,
  showConfirm = showDiscussionConfirm,
  onActivate = () => {},
  onOpenReference = () => {},
  onReferenceChange = () => {},
  onScrollLatest = null,
  contextType = "paper",
  taskInstruction = "",
} = {}) {
  const find = (selector) => root.querySelector(selector);
  const listView = find("#discussionListView");
  const threadView = find("#discussionThreadView");
  const threadList = find("#discussionThreadList");
  const title = find("#discussionThreadTitle");
  const messages = find("#discussionMessages");
  const form = find("#discussionForm");
  const input = find("#discussionInput");
  const send = find("#sendDiscussionButton");
  const referenceBox = find("#discussionReferenceBox");
  const referenceText = find("#discussionReferenceText");
  const newButtons = [find("#newDiscussionListButton"), find("#newDiscussionFromThreadButton"), find("#discussionCompactNewButton")].filter(Boolean);
  const back = find("#backToDiscussionsButton");
  const titleEdit = find("#discussionTitleEditButton");
  const compactBar = find("#discussionCompactBar");
  const compactTitle = find("#discussionCompactTitle");
  const historyButtons = [find("#discussionHistoryButton"), find("#discussionCompactHistoryButton")].filter(Boolean);
  const threadHeader = threadView?.querySelector(".discussion-thread-header");
  const listHeader = find("#newDiscussionListButton") || listView;
  const documentNode = root.ownerDocument || root;

  let threads = [];
  let activeId = null;
  let busy = false;
  let abortController = null;
  let markdownRenderer = null;
  let historyPopover = null;
  let historyOutsideHandler = null;
  let discussionThreadHeaderVisible = false;
  let discussionListHeaderVisible = false;

  if (!form || !input || !messages) {
    return emptyController();
  }

  form.addEventListener("submit", submit);
  send?.addEventListener("click", (event) => {
    if (!busy) return;
    event.preventDefault();
    abortController?.abort();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  newButtons.forEach((button) => button.addEventListener("click", createBlank));
  back?.addEventListener("click", showList);
  titleEdit?.addEventListener("click", renameActiveThread);
  historyButtons.forEach((button) => button.addEventListener("click", (event) => toggleHistoryPopover(button, event)));
  title?.addEventListener("click", scrollToLatest);
  compactTitle?.addEventListener("click", scrollToLatest);
  referenceBox?.addEventListener("click", () => {
    const reference = getActiveReference();
    if (reference) onOpenReference(reference);
  });
  initCompactBar();

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const question = input.value.trim();
    if (!question) return;
    const thread = ensureActive(question);
    const isFirstTurn = thread.messages.length === 0;
    thread.messages.push({ role: "user", content: question });
    thread.updatedAt = new Date().toISOString();
    input.value = "";
    syncNewDiscussionButtons();
    renderMessages(thread);
    await persist();
    const pending = appendMessage("assistant", "正在思考…", true);
    scrollLatest({ smooth: true, force: true });
    setBusy(true);
    abortController = new AbortController();
    let answer = "";
    try {
      answer = await requestAnswer({
        question,
        history: thread.messages.slice(0, -1),
        selectionReference: thread.reference,
        signal: abortController.signal,
        onDelta: (delta) => {
          answer += delta;
          setMessageBody(pending, answer || "正在思考…");
          scrollLatest({ smooth: false, force: false });
        },
      });
      thread.messages.push({ role: "assistant", content: answer || "未返回内容。" });
      const provisionalTitle = makeTitle(question);
      if (isFirstTurn) thread.title = provisionalTitle;
      thread.updatedAt = new Date().toISOString();
      await persist();
      renderThreadList();
      renderHeader(thread);
      renderMessages(thread);
      if (isFirstTurn) generateAndApplyTitle(thread, question, answer, provisionalTitle);
    } catch (error) {
      if (error.name === "AbortError") {
        if (answer) thread.messages.push({ role: "assistant", content: answer });
        await persist();
        renderMessages(thread);
      } else {
        pending.classList.remove("pending");
        pending.classList.add("error");
        setMessageBody(pending, error.message || "讨论失败，请稍后重试。");
      }
    } finally {
      abortController = null;
      setBusy(false);
    }
  }

  async function requestAnswer({ question, history, selectionReference, signal, onDelta }) {
    const context = String(getContextText?.() || "");
    const response = await apiFetch("/api/discuss", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
      cache: "no-store",
      body: JSON.stringify({
        paperText: context,
        question,
        summary: getSummary?.() || {},
        history,
        selectionReference: normalizeReference(selectionReference),
        contextType,
        taskInstruction,
        stream: true,
      }),
      signal,
    });
    if (!response.ok) {
      const data = await readJsonResponse(response);
      throw new Error(data.detail || data.error || "讨论失败。");
    }
    if ((response.headers.get("content-type") || "").includes("text/event-stream") && response.body) {
      return readEventStream(response, onDelta);
    }
    const data = await readJsonResponse(response);
    const answer = String(data.answer || "");
    if (answer) onDelta(answer);
    return answer;
  }

  async function generateAndApplyTitle(thread, question, answer, provisionalTitle) {
    try {
      const response = await apiFetch("/api/discussion-title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paperTitle: String(getItem?.()?.title || ""),
          question,
          answer,
          selectionReference: normalizeReference(thread.reference),
        }),
      });
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.detail || data.error || "生成讨论标题失败。");
      const generatedTitle = String(data.title || "").replace(/\s+/g, " ").trim().slice(0, 42);
      if (!generatedTitle || thread.title !== provisionalTitle || !threads.some((entry) => entry.id === thread.id)) return;
      thread.title = generatedTitle;
      thread.updatedAt = new Date().toISOString();
      renderThreadList();
      if (activeId === thread.id) renderHeader(thread);
      await persist();
    } catch (error) {
      console.warn("Failed to generate discussion title.", error);
    }
  }

  async function readEventStream(response, onDelta) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let answer = "";
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || "";
      if (done && buffer.trim()) events.push(buffer);
      for (const block of events) {
        for (const line of block.split(/\r?\n/)) {
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          if (!raw || raw === "[DONE]") continue;
          try {
            const data = JSON.parse(raw);
            const delta = String(data.delta || data.answer || data.content || "");
            if (delta) { answer += delta; onDelta?.(delta); }
            if (data.error) throw new Error(data.error);
          } catch (error) {
            if (error instanceof SyntaxError) continue;
            throw error;
          }
        }
      }
      if (done) break;
    }
    return answer;
  }

  function renderHistory(value) {
    threads = normalizeThreads(value).filter(hasMessages);
    activeId = null;
    renderThreadList();
    showList();
  }

  function createBlank(event) {
    event?.preventDefault?.();
    const thread = createThread();
    threads.unshift(thread);
    showThread(thread.id);
  }

  function startFromReference(reference) {
    const thread = createThread(normalizeReference(reference));
    threads.unshift(thread);
    showThread(thread.id);
    onActivate();
    input.focus();
    return thread;
  }

  function createThread(reference = null) {
    const now = new Date().toISOString();
    return { id: `discussion-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, title: reference ? "引用提问" : "新讨论", messages: [], reference, createdAt: now, updatedAt: now };
  }

  // 从未发送过消息的讨论只是草稿：不出现在列表里，也不会写入磁盘。
  function dropEmptyThreads(keepId = null) {
    const kept = threads.filter((entry) => hasMessages(entry) || entry.id === keepId);
    if (kept.length !== threads.length) threads = kept;
  }

  function ensureActive(question) {
    let thread = threads.find((entry) => entry.id === activeId);
    if (!thread) {
      thread = createThread();
      thread.title = makeTitle(question);
      threads.unshift(thread);
      showThread(thread.id);
    }
    return thread;
  }

  function showList() {
    closeHistoryPopover();
    dropEmptyThreads();
    if (listView) listView.hidden = false;
    if (threadView) threadView.hidden = true;
    activeId = null;
    renderThreadList();
    renderReference(null);
    notifyReferenceChange(null);
    syncNewDiscussionButtons();
    syncCompactBar();
  }

  function showThread(id) {
    const thread = threads.find((entry) => entry.id === id);
    if (!thread) return;
    dropEmptyThreads(id);
    activeId = id;
    if (listView) listView.hidden = true;
    if (threadView) threadView.hidden = false;
    renderHeader(thread);
    renderMessages(thread);
    renderReference(thread.messages.length ? null : thread.reference);
    syncNewDiscussionButtons();
    onActivate();
    notifyReferenceChange(thread.reference);
    window.requestAnimationFrame(syncCompactBar);
  }

  function initCompactBar() {
    if (!compactBar) return;
    if (window.IntersectionObserver) {
      if (threadHeader) {
        const threadObserver = new IntersectionObserver(([entry]) => {
          discussionThreadHeaderVisible = Boolean(entry?.isIntersecting);
          syncCompactBar();
        }, { threshold: 0.25 });
        threadObserver.observe(threadHeader);
      }
      if (listHeader) {
        const listObserver = new IntersectionObserver(([entry]) => {
          discussionListHeaderVisible = Boolean(entry?.isIntersecting);
          syncCompactBar();
        }, { threshold: 0.25 });
        listObserver.observe(listHeader);
      }
    }
    window.addEventListener("resize", syncCompactBar);
    syncCompactBar();
  }

  function syncCompactBar() {
    if (!compactBar) return;
    const thread = threads.find((entry) => entry.id === activeId);
    const isThreadOpen = Boolean(thread && threadView && !threadView.hidden);
    const activeHeaderVisible = isThreadOpen ? discussionThreadHeaderVisible : discussionListHeaderVisible;
    const show = !activeHeaderVisible;
    compactBar.classList.toggle("discussion-compact-visible", show);
    compactBar.setAttribute("aria-hidden", String(!show));
    if (compactTitle) {
      compactTitle.textContent = thread?.title || "新讨论";
      compactTitle.title = thread?.title || "新讨论";
    }
  }

  function syncNewDiscussionButtons() {
    const thread = threads.find((entry) => entry.id === activeId);
    const disabled = Boolean(thread && thread.messages.length === 0);
    newButtons.forEach((button) => {
      button.disabled = disabled;
      button.setAttribute("aria-disabled", String(disabled));
    });
  }

  function toggleHistoryPopover(anchor, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (historyPopover) {
      closeHistoryPopover();
      return;
    }

    const popover = documentNode.createElement("div");
    popover.className = "discussion-history-popover";
    popover.setAttribute("role", "dialog");
    popover.setAttribute("aria-label", "历史讨论");

    const searchWrap = documentNode.createElement("div");
    searchWrap.className = "discussion-history-search-wrap";
    searchWrap.innerHTML = SEARCH_ICON;
    const search = documentNode.createElement("input");
    search.type = "search";
    search.className = "discussion-history-search";
    search.placeholder = "搜索历史讨论";
    search.setAttribute("aria-label", "搜索历史讨论");
    searchWrap.appendChild(search);

    const list = documentNode.createElement("div");
    list.className = "discussion-history-list";
    popover.append(searchWrap, list);
    documentNode.body.appendChild(popover);
    historyPopover = popover;
    historyButtons.forEach((button) => button.setAttribute("aria-expanded", "true"));

    const render = () => renderHistoryPopoverList(list, search.value);
    search.addEventListener("input", render);
    popover.addEventListener("click", (clickEvent) => clickEvent.stopPropagation());
    render();
    positionHistoryPopover(popover, anchor);
    window.requestAnimationFrame(() => search.focus());
    historyOutsideHandler = closeHistoryPopover;
    documentNode.addEventListener("click", historyOutsideHandler);
  }

  function renderHistoryPopoverList(list, query = "") {
    list.replaceChildren();
    const normalizedQuery = String(query).trim().toLocaleLowerCase();
    const matches = threads.filter((thread) => hasMessages(thread) && (!normalizedQuery || String(thread.title || "").toLocaleLowerCase().includes(normalizedQuery)));
    if (!matches.length) {
      const empty = documentNode.createElement("div");
      empty.className = "discussion-history-empty";
      empty.textContent = normalizedQuery ? "没有匹配的讨论" : "暂无历史讨论";
      list.appendChild(empty);
      return;
    }

    matches.forEach((thread) => {
      const item = documentNode.createElement("div");
      item.className = `discussion-history-item${thread.id === activeId ? " active" : ""}`;
      item.setAttribute("role", "button");
      item.tabIndex = 0;
      const titleWrap = documentNode.createElement("span");
      titleWrap.className = "discussion-history-title-wrap";
      const itemTitle = documentNode.createElement("span");
      itemTitle.className = "discussion-history-title";
      itemTitle.textContent = thread.title || "新讨论";
      itemTitle.title = thread.title || "新讨论";
      const edit = documentNode.createElement("button");
      edit.type = "button";
      edit.className = "discussion-history-edit";
      edit.title = "重命名对话";
      edit.setAttribute("aria-label", `重命名对话“${thread.title || "新讨论"}”`);
      edit.innerHTML = EDIT_ICON;
      edit.addEventListener("click", (event) => {
        event.stopPropagation();
        startRenamingHistoryThread(titleWrap, thread, list, query);
      });
      titleWrap.append(itemTitle, edit);
      const meta = documentNode.createElement("span");
      meta.className = "discussion-history-meta";
      meta.textContent = `${thread.messages.length} 条`;
      item.append(titleWrap, meta);
      const openThread = () => {
        showThread(thread.id);
        closeHistoryPopover();
      };
      item.addEventListener("click", openThread);
      item.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        openThread();
      });
      list.appendChild(item);
    });
  }

  function startRenamingHistoryThread(titleWrap, thread, list, query) {
    const renameForm = documentNode.createElement("form");
    renameForm.className = "discussion-history-rename-form";
    const renameInput = documentNode.createElement("input");
    renameInput.type = "text";
    renameInput.className = "discussion-history-rename-input";
    renameInput.value = thread.title || "新讨论";
    renameInput.maxLength = 120;
    renameInput.setAttribute("aria-label", "对话标题");
    renameForm.appendChild(renameInput);
    titleWrap.replaceChildren(renameForm);

    let settled = false;
    const finish = (shouldSave) => {
      if (settled) return;
      settled = true;
      const nextTitle = renameInput.value.trim();
      if (shouldSave && nextTitle && nextTitle !== thread.title) {
        thread.title = nextTitle.slice(0, 120);
        thread.updatedAt = new Date().toISOString();
        if (activeId === thread.id) renderHeader(thread);
        renderThreadList();
        persist();
      }
      renderHistoryPopoverList(list, query);
    };
    renameForm.addEventListener("click", (event) => event.stopPropagation());
    renameForm.addEventListener("submit", (event) => {
      event.preventDefault();
      event.stopPropagation();
      finish(true);
    });
    renameInput.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    });
    renameInput.addEventListener("blur", () => finish(true));
    renameInput.focus();
    renameInput.select();
  }

  function positionHistoryPopover(popover, anchor) {
    const anchorRect = anchor.getBoundingClientRect();
    const gap = 6;
    const width = popover.offsetWidth;
    const height = popover.offsetHeight;
    const left = Math.min(Math.max(8, anchorRect.right - width), window.innerWidth - width - 8);
    const spaceBelow = window.innerHeight - anchorRect.bottom;
    const top = spaceBelow >= height + gap
      ? anchorRect.bottom + gap
      : Math.max(8, anchorRect.top - height - gap);
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  }

  function closeHistoryPopover() {
    historyPopover?.remove();
    historyPopover = null;
    if (historyOutsideHandler) {
      documentNode.removeEventListener("click", historyOutsideHandler);
      historyOutsideHandler = null;
    }
    historyButtons.forEach((button) => button.setAttribute("aria-expanded", "false"));
  }

  function notifyReferenceChange(reference) {
    onReferenceChange(normalizeReference(reference));
  }

  function renderThreadList() {
    if (!threadList) return;
    threadList.replaceChildren();
    const visibleThreads = threads.filter(hasMessages);
    if (!visibleThreads.length) {
      const empty = document.createElement("div");
      empty.className = "discussion-empty";
      empty.textContent = "在下方输入内容，开始新的讨论。";
      threadList.appendChild(empty);
      return;
    }
    visibleThreads.forEach((thread) => {
      const row = document.createElement("div");
      row.className = "discussion-thread-item";
      const titleWrap = document.createElement("div");
      titleWrap.className = "discussion-thread-item-title-wrap";
      const open = document.createElement("button");
      open.type = "button";
      open.className = "discussion-thread-open discussion-thread-item-title";
      open.textContent = thread.title || "新讨论";
      open.title = thread.title || "新讨论";
      open.addEventListener("click", () => showThread(thread.id));
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "icon-button discussion-thread-item-edit";
      edit.title = "重命名对话";
      edit.setAttribute("aria-label", `重命名对话“${thread.title || "新讨论"}”`);
      edit.innerHTML = EDIT_ICON;
      edit.addEventListener("click", () => startRenamingThread(row, thread));
      titleWrap.append(open, edit);
      const meta = document.createElement("span");
      meta.className = "discussion-thread-item-meta";
      meta.textContent = `${thread.messages.length} 条消息`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "icon-button discussion-thread-delete";
      remove.title = "删除讨论";
      remove.setAttribute("aria-label", "删除讨论");
      remove.textContent = "×";
      remove.addEventListener("click", async () => {
        if (!await showConfirm(`确定删除对话“${thread.title || "新讨论"}”？`)) return;
        threads = threads.filter((entry) => entry.id !== thread.id);
        if (activeId === thread.id) showList();
        renderThreadList();
        persist();
      });
      row.append(titleWrap, meta, remove);
      threadList.appendChild(row);
    });
  }

  function startRenamingThread(row, thread) {
    const form = document.createElement("form");
    form.className = "discussion-thread-rename-form";
    const renameInput = document.createElement("input");
    renameInput.className = "discussion-thread-rename-input";
    renameInput.type = "text";
    renameInput.value = thread.title || "新讨论";
    renameInput.maxLength = 120;
    renameInput.setAttribute("aria-label", "对话标题");
    form.appendChild(renameInput);
    row.replaceChildren(form);

    let settled = false;
    const finish = (shouldSave) => {
      if (settled) return;
      settled = true;
      const nextTitle = renameInput.value.trim();
      if (shouldSave && nextTitle && nextTitle !== thread.title) {
        thread.title = nextTitle.slice(0, 120);
        thread.updatedAt = new Date().toISOString();
        if (activeId === thread.id) renderHeader(thread);
        persist();
      }
      renderThreadList();
    };

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      finish(true);
    });
    renameInput.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    });
    renameInput.addEventListener("blur", () => finish(true));
    renameInput.focus();
    renameInput.select();
  }

  function renderHeader(thread) {
    if (title) { title.textContent = thread?.title || "新讨论"; title.title = thread?.title || "新讨论"; }
    if (compactTitle) compactTitle.textContent = thread?.title || "新讨论";
  }

  function renderMessages(thread) {
    messages.replaceChildren();
    if (!thread?.messages?.length) {
      const empty = document.createElement("div");
      empty.className = "discussion-empty";
      empty.textContent = contextType === "note" ? "围绕当前笔记提问，或让 AI 协助续写、整理和改进。" : "询问论文的方法、实验、假设或局限。";
      messages.appendChild(empty);
      return;
    }
    let referenceRendered = false;
    thread.messages.forEach((message, index) => {
      const messageReference = !referenceRendered && message.role === "user" ? thread.reference : null;
      if (messageReference) referenceRendered = true;
      appendMessage(message.role, message.content, false, messageReference, index);
    });
  }

  function appendMessage(role, content, pending = false, reference = null, index = -1) {
    messages.querySelector(".discussion-empty")?.remove();
    const node = document.createElement("article");
    node.className = `discussion-message ${role === "user" ? "user" : "assistant"}${pending ? " pending" : ""}`;
    const normalizedReference = normalizeReference(reference);
    if (normalizedReference) {
      const referenceCard = document.createElement("button");
      referenceCard.type = "button";
      referenceCard.className = "discussion-reference-card";
      referenceCard.title = "跳转到论文原文";
      referenceCard.setAttribute("aria-label", `跳转到引用原文：${normalizedReference.text}`);
      const icon = document.createElement("span");
      icon.className = "discussion-reference-icon";
      icon.innerHTML = REFERENCE_ICON;
      const text = document.createElement("span");
      text.className = "discussion-reference-text";
      text.textContent = normalizedReference.text;
      referenceCard.append(icon, text);
      referenceCard.addEventListener("click", () => onOpenReference(normalizedReference));
      node.appendChild(referenceCard);
    }
    const body = document.createElement("div");
    body.className = "discussion-message-body markdown-body";
    node.appendChild(body);
    if (!pending && index >= 0) appendMessageActions(node, role, index);
    messages.appendChild(node);
    setMessageBody(node, content);
    return node;
  }

  function appendMessageActions(node, role, index) {
    const actions = document.createElement("div");
    actions.className = "discussion-message-actions";
    const copyButton = createMessageActionButton(COPY_ICON, role === "user" ? "复制提问" : "复制回答");
    copyButton.addEventListener("click", () => copyMessage(node, index, copyButton));
    actions.appendChild(copyButton);
    if (role === "user") {
      const editButton = createMessageActionButton(EDIT_ICON, "编辑提问");
      editButton.addEventListener("click", () => startEditingMessage(node, index));
      actions.appendChild(editButton);
    }
    node.appendChild(actions);
  }

  function createMessageActionButton(icon, label) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "icon-button message-action-button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = icon;
    return button;
  }

  async function copyMessage(node, index, button) {
    const thread = threads.find((entry) => entry.id === activeId);
    const content = thread?.messages?.[index]?.content || node.querySelector(".discussion-message-body")?.innerText || "";
    const value = String(content).trim();
    if (!value) return;
    const previousLabel = button.title;
    try {
      await copyText(value);
      button.classList.add("copied");
      button.title = "已复制";
      button.setAttribute("aria-label", "已复制");
      onCopied?.(button);
      window.setTimeout(() => {
        if (!button.isConnected) return;
        button.classList.remove("copied");
        button.title = previousLabel;
        button.setAttribute("aria-label", previousLabel);
      }, 1200);
    } catch (error) {
      console.error("Failed to copy discussion message.", error);
      button.title = "复制失败";
      button.setAttribute("aria-label", "复制失败");
    }
  }

  function startEditingMessage(node, index) {
    if (busy) return;
    const thread = threads.find((entry) => entry.id === activeId);
    const message = thread?.messages?.[index];
    if (!message || message.role !== "user" || node.querySelector(".discussion-edit-form")) return;

    const body = node.querySelector(".discussion-message-body");
    const actions = node.querySelector(".discussion-message-actions");
    if (body) body.hidden = true;
    if (actions) actions.hidden = true;

    const form = document.createElement("form");
    form.className = "discussion-edit-form";
    const editInput = document.createElement("textarea");
    editInput.className = "discussion-edit-input";
    editInput.rows = 3;
    editInput.setAttribute("aria-label", "编辑提问");
    editInput.value = message.content || "";
    const editActions = document.createElement("div");
    editActions.className = "discussion-edit-actions";
    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "discussion-edit-cancel";
    cancelButton.textContent = "取消";
    const saveButton = document.createElement("button");
    saveButton.type = "submit";
    saveButton.className = "discussion-edit-save";
    saveButton.textContent = "保存";
    editActions.append(cancelButton, saveButton);
    form.append(editInput, editActions);

    let settled = false;
    const finish = (shouldSave) => {
      if (settled) return;
      const next = editInput.value.trim();
      if (!shouldSave || !next || next === message.content) {
        settled = true;
        form.remove();
        if (body) body.hidden = false;
        if (actions) actions.hidden = false;
        return;
      }
      settled = true;
      const previousContent = message.content;
      message.content = next;
      thread.updatedAt = new Date().toISOString();
      // 只有仍是自动生成的标题才跟着首问更新，避免覆盖用户改过的标题。
      if (index === 0 && thread.title === makeTitle(previousContent)) thread.title = makeTitle(next);
      persist();
      renderThreadList();
      renderHeader(thread);
      renderMessages(thread);
    };

    cancelButton.addEventListener("click", () => finish(false));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      finish(true);
    });
    editInput.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      finish(false);
    });
    (body || node).after(form);
    editInput.focus();
    editInput.setSelectionRange(editInput.value.length, editInput.value.length);
  }

  function setMessageBody(node, content) {
    const body = node.querySelector?.(".discussion-message-body") || node;
    body.innerHTML = renderMarkdown(content);
  }

  function renderReference(reference) {
    const normalized = normalizeReference(reference);
    if (referenceBox) referenceBox.hidden = !normalized;
    if (referenceText) referenceText.textContent = normalized?.text || "";
  }

  function scrollToLatest() {
    scrollLatest({ smooth: true, force: true });
  }

  // 把最新消息带进视野。force 为 false 时，只有用户本来就贴着底部才跟随，避免打断向上翻阅。
  function scrollLatest({ smooth = true, force = true } = {}) {
    if (typeof onScrollLatest === "function") {
      onScrollLatest({ smooth, force });
      return;
    }
    const target = messages.lastElementChild;
    if (!target) return;
    if (!force && !isNearBottom(findScrollParent(messages))) return;
    target.scrollIntoView({ block: "end", behavior: smooth ? "smooth" : "auto" });
  }

  function renameActiveThread() {
    const thread = threads.find((entry) => entry.id === activeId);
    if (!thread || !title || !titleEdit || title.parentElement?.querySelector(".discussion-thread-title-input")) return;

    const renameInput = document.createElement("input");
    renameInput.className = "discussion-thread-title-input";
    renameInput.type = "text";
    renameInput.value = thread.title || "新讨论";
    renameInput.maxLength = 120;
    renameInput.setAttribute("aria-label", "对话标题");
    title.hidden = true;
    titleEdit.hidden = true;
    title.insertAdjacentElement("afterend", renameInput);

    let settled = false;
    const finish = (shouldSave, restoreFocus = false) => {
      if (settled) return;
      settled = true;
      const nextTitle = renameInput.value.trim();
      if (shouldSave && nextTitle && nextTitle !== thread.title) {
        thread.title = nextTitle.slice(0, 120);
        thread.updatedAt = new Date().toISOString();
        renderThreadList();
        persist();
      }
      renderHeader(thread);
      renameInput.remove();
      title.hidden = false;
      titleEdit.hidden = false;
      if (restoreFocus) titleEdit.focus();
    };

    renameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish(true, true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(false, true);
      }
    });
    renameInput.addEventListener("blur", () => finish(true));
    renameInput.focus();
    renameInput.select();
  }

  function renderMarkdown(content) {
    const text = String(content || "");
    try {
      const renderer = getMarkdownRenderer();
      return renderer ? renderer.render(text) : escapeHtml(text).replace(/\n/g, "<br>");
    } catch { return escapeHtml(text).replace(/\n/g, "<br>"); }
  }

  function getMarkdownRenderer() {
    if (!markdownRenderer && window.markdownit) {
      markdownRenderer = window.markdownit({ html: false, linkify: true, breaks: false });
      if (window.texmath && window.katex) {
        markdownRenderer.use(window.texmath, {
          engine: window.katex,
          delimiters: "dollars",
          katexOptions: { throwOnError: false },
        });
      }
    }
    return markdownRenderer;
  }

  async function persist() {
    const item = getItem?.();
    if (!item || !saveItem) return;
    try { await saveItem({ discussion: { threads: threads.filter(hasMessages) } }); }
    catch (error) { console.error("Failed to save discussion.", error); }
  }

  function setBusy(next) {
    busy = Boolean(next);
    input.disabled = busy;
    if (send) { send.classList.toggle("discussion-stop-mode", busy); send.innerHTML = busy ? STOP_ICON : SEND_ICON; send.title = busy ? "停止" : "发送"; }
  }

  function getActiveReference() { return threads.find((entry) => entry.id === activeId)?.reference || null; }

  setBusy(false);
  renderHistory(getItem?.()?.discussion || []);
  return { renderHistory, renderMarkdown, getMarkdownRenderer, startFromReference, showList, getActiveReference, focus: () => input.focus(), getThreads: () => threads };
}

function showDiscussionConfirm(message) {
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

function normalizeThreads(value) {
  const raw = Array.isArray(value) ? (value.length ? [{ title: "讨论", messages: value }] : []) : Array.isArray(value?.threads) ? value.threads : [];
  return raw.map((thread, index) => ({
    id: String(thread?.id || `discussion-${Date.now().toString(36)}-${index}`),
    title: String(thread?.title || "新讨论"),
    messages: Array.isArray(thread?.messages) ? thread.messages.map((message) => ({ role: message?.role === "user" ? "user" : "assistant", content: String(message?.content || "").trim() })).filter((message) => message.content) : [],
    reference: normalizeReference(thread?.reference),
    createdAt: String(thread?.createdAt || new Date().toISOString()),
    updatedAt: String(thread?.updatedAt || thread?.createdAt || new Date().toISOString()),
  })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function normalizeReference(reference) {
  if (!reference || typeof reference !== "object") return null;
  const text = String(reference.text || "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return { ...reference, text: text.slice(0, 4000) };
}

function hasMessages(thread) { return Boolean(thread?.messages?.length); }
async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}
function findScrollParent(element) {
  let node = element || null;
  while (node) {
    const overflowY = window.getComputedStyle(node).overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight + 2) return node;
    node = node.parentElement;
  }
  return null;
}
function isNearBottom(element, threshold = 180) {
  if (!element) return true;
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
}
function makeTitle(text) { const value = String(text || "新讨论").replace(/\s+/g, " ").trim(); return value.length > 42 ? `${value.slice(0, 39)}...` : value; }
function escapeHtml(value) { return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]); }
function emptyController() { return { renderHistory() {}, renderMarkdown: escapeHtml, getMarkdownRenderer: () => null, startFromReference() {}, showList() {}, getActiveReference: () => null, focus() {}, getThreads: () => [] }; }
