import { initAnnotationPanel } from "./annotation_panel.js";

const COLORS = { yellow: "rgba(255,221,64,.42)", green: "rgba(120,196,162,.36)", blue: "rgba(111,178,214,.32)", pink: "rgba(239,147,171,.32)" };

// Text quotes plus nearby context survive edits before the selection and avoid
// silently moving a comment onto another occurrence of the same sentence.
export function findNoteAnchor(text, anchor) {
  const quote = String(anchor?.quote || "");
  if (!quote) return -1;
  const matches = [];
  for (let index = text.indexOf(quote); index !== -1; index = text.indexOf(quote, index + 1)) {
    const before = text.slice(Math.max(0, index - (anchor.before || "").length), index);
    const after = text.slice(index + quote.length, index + quote.length + (anchor.after || "").length);
    const score = Number(Boolean(anchor.before) && before === anchor.before)
      + Number(Boolean(anchor.after) && after === anchor.after);
    matches.push({ index, score });
  }
  if (matches.length === 1) return matches[0].index;
  matches.sort((a, b) => b.score - a.score);
  if (!matches.length) return -1;
  if (matches[0].score > matches[1].score) return matches[0].index;
  return matches.find(match => match.index === anchor.start)?.index ?? -1;
}

export function initNoteAnnotations(options) {
  const { host, frame, list, getNote, getValue, saveNote, apiFetch, readJsonResponse,
    renderMarkdown, startDiscussion, setStatus } = options;
  let highlights = [];
  let selected = null;
  let ranges = [];
  let busy = false;
  let paintFrame = 0;
  let saveQueue = Promise.resolve();
  const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
  const menu = document.createElement("div");
  menu.className = "selection-menu note-selection-menu";
  menu.setAttribute("role", "toolbar");
  menu.setAttribute("aria-label", "笔记选中文字操作");
  menu.hidden = true;
  const icons = {
    comment: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/><path d="M8 9h8M8 13h5"/>',
    translate: '<path d="M2 5h12M7 2h1M4 14l6-6 2-3M5 8l6 6m11 8-5-10-5 10m2-4h6"/>',
    explain: '<path d="M9 18h6m-5 4h4M8 14a6 6 0 1 1 8 0c-1 1-1.5 2-1.5 3h-5c0-1-.5-2-1.5-3z"/>',
    discuss: '<path d="M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5z"/>',
  };
  for (const [action, label] of [["comment", "批注"], ["translate", "翻译"], ["explain", "解释"], ["discuss", "讨论"]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.action = action;
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[action]}</svg><span>${label}</span>`;
    button.addEventListener("click", () => act(action));
    menu.appendChild(button);
  }
  // Keep the editor selection intact until the chosen action has captured it.
  menu.addEventListener("pointerdown", event => event.preventDefault());
  frame.appendChild(menu);

  const group = id => highlights.filter(item => item.groupId === id);
  const save = () => {
    const snapshot = structuredClone(highlights);
    saveQueue = saveQueue.catch(() => {}).then(async () => {
      try { await saveNote({ highlights: snapshot }); }
      catch (error) { setStatus(error.message || "批注保存失败。", true); throw error; }
    });
    return saveQueue;
  };
  const panel = initAnnotationPanel({
    getPdfFrameElement: () => frame,
    getPdfViewer: () => host,
    getCurrentPaperTitle: () => getNote()?.title || "",
    getFileTitle: () => "",
    getHighlightGroup: group,
    getHighlightKey: item => item.groupId,
    getHighlights: () => highlights,
    setHighlights: next => { highlights = next; },
    isSameHighlightGroup: (item, id) => item.groupId === id,
    highlightColors: COLORS,
    redrawHighlights: schedulePaint,
    refreshCommentsNavigation: renderList,
    renderDiscussionMarkdown: renderMarkdown,
    saveCurrentPaper: save,
    startDiscussionFromReference: startDiscussion,
    getDiscussionReference: items => makeReference(items[0]),
    translateAnnotationText: text => requestAI("translate", text),
    explainAnnotationText: text => requestAI("explain", text),
    clamp,
  });

  function getSurface() {
    return [...host.querySelectorAll('.vditor-ir > pre, .vditor-sv[contenteditable], .vditor-wysiwyg > pre, textarea.vditor-sv, .vditor-sv textarea, .notes-editor-fallback')]
      .find(element => element.getClientRects().length && getComputedStyle(element).visibility !== "hidden");
  }

  function textIndex(surface) {
    if (surface instanceof HTMLTextAreaElement) return { text: surface.value, nodes: [] };
    const nodes = [];
    let text = "";
    let previousBlock = null;
    const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement.closest('.vditor-ir__marker, .katex-mathml, [aria-hidden="true"]:not(.katex-html)')) continue;
      const probe = document.createRange();
      probe.selectNodeContents(node);
      if (!probe.getClientRects().length) continue;
      const block = node.parentElement.closest("p, h1, h2, h3, h4, h5, h6, li, td, th, pre");
      if (previousBlock && block !== previousBlock && !text.endsWith("\n")) text += "\n";
      previousBlock = block;
      nodes.push({ node, start: text.length });
      text += node.textContent;
    }
    return { text, nodes };
  }

  function captureSelection(event) {
    if (busy || !getNote()?.id) return;
    const surface = getSurface();
    if (!surface) return hideMenu();
    const index = textIndex(surface);
    let start, end, rect;
    if (surface instanceof HTMLTextAreaElement) {
      if (document.activeElement !== surface) return hideMenu();
      start = surface.selectionStart;
      end = surface.selectionEnd;
      rect = surface.getBoundingClientRect();
      rect = { right: event?.clientX || rect.left + 32, bottom: event?.clientY || rect.top + 32 };
    } else {
      const selection = window.getSelection();
      if (!selection?.rangeCount || selection.isCollapsed) return hideMenu();
      const range = selection.getRangeAt(0);
      if (!surface.contains(range.startContainer) || !surface.contains(range.endContainer)) return hideMenu();
      // Measure only visible text nodes, using the same index used for restoring.
      const overlaps = index.nodes.filter(item => range.intersectsNode(item.node));
      if (!overlaps.length) return hideMenu();
      const first = overlaps[0], last = overlaps.at(-1);
      start = first.start + (range.startContainer === first.node ? range.startOffset : 0);
      end = last.start + (range.endContainer === last.node ? range.endOffset : last.node.length);
      rect = range.getBoundingClientRect();
    }
    const quote = index.text.slice(start, end);
    if (!quote.trim()) return hideMenu();
    selected = { quote, start, before: index.text.slice(Math.max(0, start - 48), start), after: index.text.slice(end, end + 48) };
    menu.hidden = false;
    const bounds = frame.getBoundingClientRect();
    menu.style.left = `${clamp(rect.right - bounds.left + 8, 8, Math.max(8, bounds.width - menu.offsetWidth - 8))}px`;
    menu.style.top = `${clamp(rect.bottom - bounds.top + 6, 8, Math.max(8, bounds.height - menu.offsetHeight - 8))}px`;
  }

  function hideMenu() { menu.hidden = true; }

  function makeReference(item) {
    return { text: item.selectedText, paperTitle: getNote()?.title || "", page: 0,
      before: item.noteAnchor?.before || "", after: item.noteAnchor?.after || "", ranges: [] };
  }

  async function requestAI(action, text) {
    try {
      const response = await apiFetch(`/api/${action}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, selectedText: text, paperText: getValue(), contextType: "note",
          summary: { title: getNote()?.title || "", notes: getValue() } }),
      });
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.detail || data.error || "AI 请求失败。");
      const result = String(data[action === "translate" ? "translation" : "explanation"] || "").trim();
      if (!result) throw new Error("AI 未返回内容，请重试。");
      setStatus("");
      return result;
    } catch (error) { setStatus(error.message || "AI 请求失败。", true); throw error; }
  }

  async function act(action) {
    if (!selected || busy) return;
    const anchor = structuredClone(selected);
    const rect = menu.getBoundingClientRect();
    hideMenu();
    if (action === "discuss") {
      panel.hide();
      startDiscussion(makeReference({ selectedText: anchor.quote, noteAnchor: anchor }));
      return;
    }
    busy = true;
    const id = `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    const item = { groupId: id, contextType: "note", selectedText: anchor.quote, noteAnchor: anchor,
      color: action === "translate" ? "blue" : "green", type: "comment", text: [] };
    try {
      panel.hide();
      if (action !== "comment") {
        setStatus(action === "translate" ? "翻译中…" : "解释中…");
        const content = await requestAI(action, anchor.quote);
        const type = action === "translate" ? "translation" : "comment";
        item.type = type;
        item.text = [{ id: `${id}-entry`, type, content }];
        item[type === "translation" ? "translation" : "comment"] = content;
      }
      highlights.push(item);
      schedulePaint();
      renderList();
      panel.show(item, rect.left, rect.top);
      await save();
    } catch (error) { setStatus(error.message || "批注操作失败。", true); }
    finally { busy = false; }
  }

  function restoreRange(index, start, length) {
    const first = index.nodes.find(item => start >= item.start && start < item.start + item.node.length);
    const end = start + length;
    const last = index.nodes.find(item => end > item.start && end <= item.start + item.node.length);
    if (!first || !last) return null;
    const range = document.createRange();
    range.setStart(first.node, start - first.start);
    range.setEnd(last.node, end - last.start);
    return range;
  }

  function paint() {
    paintFrame = 0;
    ranges = [];
    const surface = getSurface();
    if (surface) {
      const index = textIndex(surface);
      for (const item of highlights) {
        const start = findNoteAnchor(index.text, item.noteAnchor);
        const range = start < 0 ? null : restoreRange(index, start, item.noteAnchor.quote.length);
        if (range) ranges.push({ item, range });
      }
    }
    if (!window.CSS?.highlights || !window.Highlight) return;
    for (const color of Object.keys(COLORS)) {
      CSS.highlights.set(`note-${color}`, new Highlight(...ranges.filter(entry => entry.item.color === color).map(entry => entry.range)));
    }
  }

  function schedulePaint() {
    if (!paintFrame) paintFrame = requestAnimationFrame(paint);
  }

  function openItem(item, x, y) {
    if (busy) return;
    panel.hide();
    hideMenu();
    paint();
    const entry = ranges.find(entry => entry.item.groupId === item.groupId);
    if (entry) entry.range.startContainer.parentElement.scrollIntoView({ block: "nearest" });
    panel.show(item, x, y);
  }

  function renderList() {
    list.replaceChildren();
    if (!highlights.length) {
      const empty = document.createElement("p");
      empty.className = "discussion-empty";
      empty.textContent = "还没有批注。选中笔记文字，即可添加批注、翻译或解释。";
      list.appendChild(empty);
    }
    for (const item of highlights) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "note-annotation-item";
      button.style.setProperty("--annotation-color", COLORS[item.color] || COLORS.yellow);
      const quote = document.createElement("blockquote");
      quote.textContent = item.selectedText;
      const content = document.createElement("span");
      content.textContent = item.text?.map(entry => entry.content).filter(Boolean).join("\n") || "添加评论…";
      button.append(quote, content);
      button.addEventListener("click", () => {
        const bounds = host.getBoundingClientRect();
        openItem(item, bounds.right - 400, bounds.top + 20);
      });
      list.appendChild(button);
    }
  }

  host.addEventListener("pointerup", event => {
    if (event.button !== 0) return;
    setTimeout(() => captureSelection(event), 0);
  });
  host.addEventListener("keyup", event => {
    if (event.key.startsWith("Arrow") || event.key === "Shift" || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a")) captureSelection();
  });
  host.addEventListener("input", () => { hideMenu(); schedulePaint(); });
  host.addEventListener("click", event => {
    if (window.getSelection()?.toString() || busy) return;
    const entry = ranges.find(({ range }) => [...range.getClientRects()].some(rect =>
      event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom));
    if (entry) openItem(entry.item, event.clientX, event.clientY);
  });
  document.addEventListener("pointerdown", event => { if (!menu.contains(event.target)) hideMenu(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape") { hideMenu(); panel.hide(); } });
  host.addEventListener("scroll", hideMenu, true);
  window.addEventListener("resize", hideMenu);
  new MutationObserver(schedulePaint).observe(host, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["style", "class"] });
  return {
    render() { highlights = (getNote()?.highlights || []).filter(item => item.contextType === "note" && item.noteAnchor); renderList(); schedulePaint(); },
    renderList,
  };
}
