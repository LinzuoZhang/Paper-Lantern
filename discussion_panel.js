const SEND_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 2 11 13"></path><path d="m22 2-7 20-4-9-9-4 20-7z"></path></svg>';
const STOP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1.5"></rect></svg>';

export function initDiscussionPanel({
  root = document,
  getItem,
  getContextText,
  getSummary = () => ({}),
  saveItem,
  apiFetch,
  readJsonResponse,
  showConfirm = async (message) => window.confirm(message),
  onActivate = () => {},
  onOpenReference = () => {},
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
  const compactTitle = find("#discussionCompactTitle");
  const historyButtons = [find("#discussionHistoryButton"), find("#discussionCompactHistoryButton")].filter(Boolean);

  let threads = [];
  let activeId = null;
  let busy = false;
  let abortController = null;
  let markdownRenderer = null;

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
  historyButtons.forEach((button) => button.addEventListener("click", showList));
  title?.addEventListener("click", scrollToLatest);
  compactTitle?.addEventListener("click", scrollToLatest);
  referenceBox?.addEventListener("click", () => {
    const reference = getActiveReference();
    if (reference) onOpenReference(reference);
  });

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const question = input.value.trim();
    if (!question) return;
    const thread = ensureActive(question);
    thread.messages.push({ role: "user", content: question });
    thread.updatedAt = new Date().toISOString();
    input.value = "";
    renderMessages(thread);
    const pending = appendMessage("assistant", "正在思考…", true);
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
        },
      });
      thread.messages.push({ role: "assistant", content: answer || "未返回内容。" });
      if (!thread.title || thread.title === "新讨论") thread.title = makeTitle(question);
      thread.updatedAt = new Date().toISOString();
      await persist();
      renderThreadList();
      renderHeader(thread);
      renderMessages(thread);
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
      headers: { "Content-Type": "application/json" },
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

  async function readEventStream(response, onDelta) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let answer = "";
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";
      for (const block of events) {
        for (const line of block.split("\n")) {
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
    threads = normalizeThreads(value);
    activeId = null;
    renderThreadList();
    showList();
  }

  function createBlank(event) {
    event?.preventDefault?.();
    const thread = createThread();
    threads.unshift(thread);
    showThread(thread.id);
    persist();
  }

  function startFromReference(reference) {
    const thread = createThread(normalizeReference(reference));
    threads.unshift(thread);
    showThread(thread.id);
    onActivate();
    input.focus();
    persist();
    return thread;
  }

  function createThread(reference = null) {
    const now = new Date().toISOString();
    return { id: `discussion-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, title: reference ? "引用提问" : "新讨论", messages: [], reference, createdAt: now, updatedAt: now };
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
    if (listView) listView.hidden = false;
    if (threadView) threadView.hidden = true;
    activeId = null;
    renderThreadList();
    renderReference(null);
  }

  function showThread(id) {
    const thread = threads.find((entry) => entry.id === id);
    if (!thread) return;
    activeId = id;
    if (listView) listView.hidden = true;
    if (threadView) threadView.hidden = false;
    renderHeader(thread);
    renderMessages(thread);
    renderReference(thread.messages.length ? null : thread.reference);
    onActivate();
  }

  function renderThreadList() {
    if (!threadList) return;
    threadList.replaceChildren();
    if (!threads.length) {
      const empty = document.createElement("div");
      empty.className = "discussion-empty";
      empty.textContent = "在下方输入内容，开始新的讨论。";
      threadList.appendChild(empty);
      return;
    }
    threads.forEach((thread) => {
      const row = document.createElement("div");
      row.className = "discussion-thread-item";
      const open = document.createElement("button");
      open.type = "button";
      open.className = "discussion-thread-open";
      const name = document.createElement("span");
      name.className = "discussion-thread-item-title";
      name.textContent = thread.title || "新讨论";
      const meta = document.createElement("span");
      meta.className = "discussion-thread-item-meta";
      meta.textContent = `${thread.messages.length} 条消息`;
      open.append(name, meta);
      open.addEventListener("click", () => showThread(thread.id));
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
      row.append(open, remove);
      threadList.appendChild(row);
    });
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
    thread.messages.forEach((message) => appendMessage(message.role, message.content));
  }

  function appendMessage(role, content, pending = false) {
    messages.querySelector(".discussion-empty")?.remove();
    const node = document.createElement("article");
    node.className = `discussion-message ${role === "user" ? "user" : "assistant"}${pending ? " pending" : ""}`;
    const label = document.createElement("div");
    label.className = "discussion-message-label";
    label.textContent = role === "user" ? "你" : "AI";
    const body = document.createElement("div");
    body.className = "discussion-message-body markdown-body";
    node.append(label, body);
    messages.appendChild(node);
    setMessageBody(node, content);
    messages.scrollTop = messages.scrollHeight;
    return node;
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
    messages.lastElementChild?.scrollIntoView({ block: "end", behavior: "smooth" });
  }

  function renameActiveThread() {
    const thread = threads.find((entry) => entry.id === activeId);
    if (!thread) return;
    const next = window.prompt("讨论名称", thread.title || "新讨论");
    if (!next?.trim()) return;
    thread.title = next.trim().slice(0, 120);
    thread.updatedAt = new Date().toISOString();
    renderHeader(thread); renderThreadList(); persist();
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
    try { await saveItem({ discussion: { threads } }); }
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

function makeTitle(text) { const value = String(text || "新讨论").replace(/\s+/g, " ").trim(); return value.length > 42 ? `${value.slice(0, 39)}...` : value; }
function escapeHtml(value) { return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]); }
function emptyController() { return { renderHistory() {}, renderMarkdown: escapeHtml, getMarkdownRenderer: () => null, startFromReference() {}, showList() {}, getActiveReference: () => null, focus() {}, getThreads: () => [] }; }
