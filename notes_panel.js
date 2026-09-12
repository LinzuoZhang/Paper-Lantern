const AUTOSAVE_DELAY_MS = 700;
const NOTES_MODE_STORAGE_KEY = "paper-lantern-notes-mode";
const PAPER_NOTE_DRAG_TYPE = "application/x-paper-lantern-paper";

const NOTES_MODE_ICONS = {
  source: "code",
  ir: "edit",
  sv: "both",
};

const NOTES_TOOLBAR = [
  "outline",
  "headings",
  "bold",
  "italic",
  "list",
  "ordered-list",
  "check",
  "link",
  "undo",
  "redo",
  {
    name: "more",
    toolbar: ["strike", "quote", "line", "code", "inline-code", "table"],
  },
  "fullscreen",
  "edit-mode",
];

const NOTES_MORE_ICONS = {
  strike: "strike",
  quote: "quote",
  line: "line",
  code: "code",
  "inline-code": "inline-code",
  table: "table",
};

// 论文卡片在笔记中显示的文本：第一个作者名 + "et al."，无作者时回退到标题。
export function formatPaperCardLabel(paper) {
  const authors = Array.isArray(paper?.authors)
    ? paper.authors.map((author) => String(author).trim()).filter(Boolean)
    : [];
  if (authors.length > 1) return `${authors[0]} et al.`;
  if (authors.length === 1) return authors[0];
  return String(paper?.title || paper?.id || "").trim();
}

export function initNotesPanel({
  getCurrentPaper,
  savePaper,
  apiFetch,
  copyText,
  showCopiedFeedback,
  triggerBlobDownload,
}) {
  const editorHost = document.querySelector("#notesEditor");
  const dirtyIndicator = document.querySelector("#notesDirtyIndicator");
  const copyNotesButton = document.querySelector("#copyNotesButton");
  const exportNotesButton = document.querySelector("#exportNotesButton");
  const notesExportMenu = document.querySelector("#notesExportMenu");
  const exportNotesMarkdownButton = document.querySelector("#exportNotesMarkdownButton");
  const exportNotesPdfButton = document.querySelector("#exportNotesPdfButton");

  let vditor = null;
  let fallbackEditor = null;
  let editorReady = false;
  let applyingValue = false;
  let pendingValue = "";
  let lastSavedValue = "";
  let autoSaveTimer = null;
  let savePromise = null;
  let paperLinkPopover = null;
  let paperLinkRequestId = 0;
  let paperDropCaret = null;
  const paperLinkCache = new Map();

  function getStoredEditorMode() {
    try {
      const mode = window.localStorage.getItem(NOTES_MODE_STORAGE_KEY);
      return Object.hasOwn(NOTES_MODE_ICONS, mode) ? mode : "ir";
    } catch {
      return "ir";
    }
  }

  function setDirty(isDirty, saveFailed = false) {
    if (!dirtyIndicator) return;
    dirtyIndicator.hidden = !isDirty;
    dirtyIndicator.classList.toggle("error", saveFailed);
    dirtyIndicator.title = saveFailed ? "保存失败，内容仍未保存" : "有未保存的更改";
  }

  function setMenuOptionContent(button, label, icon, className) {
    if (!button) return;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttributeNS("http://www.w3.org/1999/xlink", "href", `#vditor-icon-${icon}`);
    svg.appendChild(use);
    const text = document.createElement("span");
    text.textContent = label;
    button.replaceChildren(svg, text);
    button.classList.add(className);
  }

  function setModeOptionContent(button, label, icon) {
    setMenuOptionContent(button, label, icon, "notes-mode-option");
  }

  function setEditorMode(mode, persist = true) {
    editorHost?.classList.toggle("notes-source-mode", mode === "source");
    const sourceModeButton = editorHost?.querySelector('button[data-notes-mode="source"]');
    const instantModeButton = editorHost?.querySelector('button[data-mode="ir"]');
    const splitModeButton = editorHost?.querySelector('button[data-mode="sv"]');
    sourceModeButton?.classList.toggle("vditor-menu--current", mode === "source");
    instantModeButton?.classList.toggle("vditor-menu--current", mode === "ir");
    splitModeButton?.classList.toggle("vditor-menu--current", mode === "sv");

    const editModeUse = editorHost?.querySelector('.vditor-toolbar button[data-type="edit-mode"] use');
    editModeUse?.setAttributeNS(
      "http://www.w3.org/1999/xlink",
      "href",
      `#vditor-icon-${NOTES_MODE_ICONS[mode] || NOTES_MODE_ICONS.ir}`,
    );
    if (persist) {
      try {
        window.localStorage.setItem(NOTES_MODE_STORAGE_KEY, mode);
      } catch {
        // The editor remains usable when storage is unavailable.
      }
    }
  }

  function scheduleEmptyModeSwitchCleanup(wasEmpty) {
    if (!wasEmpty) return;
    window.setTimeout(() => {
      if (!vditor) return;
      const value = getValue();
      if (value === "" || String(value).trim()) return;
      applyingValue = true;
      vditor.setValue("", true);
      applyingValue = false;
      pendingValue = "";
      if (!String(lastSavedValue).trim()) {
        lastSavedValue = "";
        setDirty(false);
      }
    }, 0);
  }

  function activateSourceMode() {
    const splitModeButton = editorHost?.querySelector('button[data-mode="sv"]');
    if (!vditor || !splitModeButton) return;
    const wasEmpty = !getValue().trim();
    splitModeButton.click();
    setEditorMode("source");
    scheduleEmptyModeSwitchCleanup(wasEmpty);
  }

  function arrangeEditorChrome() {
    const editModeButton = editorHost?.querySelector('.vditor-toolbar button[data-type="edit-mode"]');
    const fullscreenButton = editorHost?.querySelector('.vditor-toolbar button[data-type="fullscreen"]');
    fullscreenButton?.parentElement?.classList.add("notes-toolbar-right-start");

    editorHost?.querySelectorAll(".vditor-hint button").forEach((button) => {
      const fullLabel = String(button.textContent || "").trim();
      const shortcutMatch = fullLabel.match(/\s+<([^<>]+)>$/);
      if (!shortcutMatch) return;
      const label = fullLabel.slice(0, shortcutMatch.index).trim();
      const shortcut = shortcutMatch[1].trim();
      button.textContent = label;
      button.title = `快捷键：${shortcut}`;
      button.setAttribute("aria-label", `${label}，快捷键 ${shortcut}`);
    });

    const moreMenu = editorHost
      ?.querySelector('.vditor-toolbar button[data-type="more"]')
      ?.parentElement?.querySelector(".vditor-hint");
    moreMenu?.querySelectorAll("button[data-type]").forEach((button) => {
      const type = button.dataset.type;
      const icon = NOTES_MORE_ICONS[type];
      if (icon) setMenuOptionContent(button, String(button.textContent || "").trim(), icon, "notes-more-option");
    });

    const modeMenu = editModeButton?.parentElement?.querySelector(".vditor-hint");
    const wysiwygModeButton = modeMenu?.querySelector('button[data-mode="wysiwyg"]');
    const splitModeButton = modeMenu?.querySelector('button[data-mode="sv"]');
    const instantModeButton = modeMenu?.querySelector('button[data-mode="ir"]');
    if (wysiwygModeButton && splitModeButton) {
      const sourceModeButton = document.createElement("button");
      sourceModeButton.type = "button";
      sourceModeButton.dataset.notesMode = "source";
      setModeOptionContent(sourceModeButton, "源码模式", NOTES_MODE_ICONS.source);
      sourceModeButton.title = "快捷键：Alt+Ctrl+7";
      sourceModeButton.setAttribute("aria-label", "源码模式，快捷键 Alt+Ctrl+7");
      sourceModeButton.addEventListener("click", activateSourceMode);
      wysiwygModeButton.replaceWith(sourceModeButton);

      setModeOptionContent(splitModeButton, "分屏预览", NOTES_MODE_ICONS.sv);
      splitModeButton.title = "快捷键：Alt+Ctrl+9";
      splitModeButton.setAttribute("aria-label", "分屏预览，快捷键 Alt+Ctrl+9");
      splitModeButton.addEventListener("click", () => {
        const wasEmpty = !getValue().trim();
        setEditorMode("sv");
        scheduleEmptyModeSwitchCleanup(wasEmpty);
      });
      setModeOptionContent(instantModeButton, "即时渲染", NOTES_MODE_ICONS.ir);
      instantModeButton?.addEventListener("click", () => {
        const wasEmpty = !getValue().trim();
        setEditorMode("ir");
        scheduleEmptyModeSwitchCleanup(wasEmpty);
      });
    }

    const content = editorHost?.querySelector(".vditor-content");
    const counter = editorHost?.querySelector(".vditor-counter");
    if (content && counter) content.appendChild(counter);

    const storedMode = getStoredEditorMode();
    if (storedMode === "source") {
      activateSourceMode();
    } else if (storedMode === "sv") {
      splitModeButton?.click();
    } else {
      setEditorMode("ir", false);
    }
  }

  function getValue() {
    if (editorReady && vditor) return String(vditor.getValue() || "");
    if (fallbackEditor) return fallbackEditor.value;
    return pendingValue;
  }

  function escapeMarkdownLinkText(value) {
    return String(value || "")
      .replace(/[\r\n]+/g, " ")
      .replace(/([\\\[\]])/g, "\\$1")
      .trim();
  }

  function getTextareaCaretAtPoint(textarea, clientX, clientY) {
    const textareaRect = textarea.getBoundingClientRect();
    if (
      clientX < textareaRect.left || clientX > textareaRect.right ||
      clientY < textareaRect.top || clientY > textareaRect.bottom
    ) return null;

    const computed = window.getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(computed.lineHeight) || 22;
    const borderLeft = Number.parseFloat(computed.borderLeftWidth) || 0;
    const borderTop = Number.parseFloat(computed.borderTopWidth) || 0;
    const mirror = document.createElement("div");
    Object.assign(mirror.style, {
      position: "fixed",
      zIndex: "9999",
      left: `${textareaRect.left + borderLeft - textarea.scrollLeft}px`,
      top: `${textareaRect.top + borderTop - textarea.scrollTop}px`,
      width: `${textarea.clientWidth}px`,
      height: "auto",
      margin: "0",
      border: "0",
      padding: computed.padding,
      boxSizing: "border-box",
      opacity: "0",
      overflow: "visible",
      whiteSpace: "pre-wrap",
      overflowWrap: computed.overflowWrap,
      wordBreak: computed.wordBreak,
      tabSize: computed.tabSize,
      font: computed.font,
      lineHeight: computed.lineHeight,
      letterSpacing: computed.letterSpacing,
      textTransform: computed.textTransform,
    });
    const value = textarea.value;
    const textNode = document.createTextNode(value);
    const marker = document.createElement("span");
    marker.textContent = "\u200b";
    marker.style.display = "inline-block";
    marker.style.width = "1px";
    marker.style.height = `${lineHeight}px`;
    marker.style.verticalAlign = "text-bottom";
    mirror.append(textNode, marker);
    document.body.appendChild(mirror);

    let hitRange = null;
    if (document.caretRangeFromPoint) {
      hitRange = document.caretRangeFromPoint(clientX, clientY);
    } else if (document.caretPositionFromPoint) {
      const position = document.caretPositionFromPoint(clientX, clientY);
      if (position) {
        hitRange = document.createRange();
        hitRange.setStart(position.offsetNode, position.offset);
      }
    }
    let offset = value.length;
    if (hitRange?.startContainer === textNode) {
      offset = Math.min(value.length, Math.max(0, hitRange.startOffset));
    } else if (hitRange?.startContainer === mirror) {
      offset = hitRange.startOffset > 0 ? value.length : 0;
    }
    mirror.replaceChildren(
      document.createTextNode(value.slice(0, offset)),
      marker,
      document.createTextNode(value.slice(offset)),
    );
    const rect = marker.getBoundingClientRect();
    const result = { offset, left: rect.left, top: rect.top, height: rect.height || lineHeight };
    mirror.remove();
    return result;
  }

  // 将编辑器选区移动到拖动坐标，并返回用于绘制落点光标的位置。
  function positionCaretAtPoint(clientX, clientY) {
    const mode = vditor?.vditor.currentMode;
    const editable = mode ? vditor.vditor[mode]?.element : fallbackEditor;
    if (!editable) return null;

    if (editable instanceof HTMLTextAreaElement) {
      const point = getTextareaCaretAtPoint(editable, clientX, clientY);
      if (!point) return null;
      editable.focus({ preventScroll: true });
      editable.setSelectionRange(point.offset, point.offset);
      return { editable, rect: point };
    }

    if (mode !== "ir" && mode !== "wysiwyg") return null;

    let range = null;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(clientX, clientY);
    } else if (document.caretPositionFromPoint) {
      const position = document.caretPositionFromPoint(clientX, clientY);
      if (position) {
        range = document.createRange();
        range.setStart(position.offsetNode, position.offset);
      }
    }
    if (!range) return null;
    if (range.startContainer !== editable && !editable.contains(range.startContainer)) return null;
    range.collapse(true);
    editable.focus({ preventScroll: true });
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return { editable, rect: range.getClientRects()[0] || null };
  }

  function hidePaperDropCaret() {
    paperDropCaret?.remove();
    paperDropCaret = null;
  }

  function showPaperDropCaret(clientX, clientY) {
    const caret = positionCaretAtPoint(clientX, clientY);
    if (!caret) {
      hidePaperDropCaret();
      return;
    }

    const { editable, rect: rangeRect } = caret;
    const editableRect = editable?.getBoundingClientRect();
    const computed = editable ? window.getComputedStyle(editable) : null;
    const fallbackHeight = Number.parseFloat(computed?.lineHeight) || 22;
    const height = Math.max(16, rangeRect?.height || fallbackHeight);
    const left = rangeRect?.left ?? Math.min(Math.max(clientX, editableRect?.left || clientX), editableRect?.right || clientX);
    const top = rangeRect?.top ?? Math.min(Math.max(clientY - height / 2, editableRect?.top || clientY), (editableRect?.bottom || clientY + height) - height);

    if (!paperDropCaret) {
      paperDropCaret = document.createElement("span");
      paperDropCaret.className = "notes-paper-drop-caret";
      paperDropCaret.setAttribute("aria-hidden", "true");
      document.body.appendChild(paperDropCaret);
    }
    paperDropCaret.style.left = `${left}px`;
    paperDropCaret.style.top = `${top}px`;
    paperDropCaret.style.height = `${height}px`;
  }

  // 插入后重新聚焦编辑器并把光标显示在卡片链接之后。Vditor 重绘 DOM 后
  // 拖放路径上的光标很容易丢失，这里在下一轮任务里显式恢复。
  function revealCaretAfterPaperCard(id) {
    window.setTimeout(() => {
      if (!editorReady || !vditor) {
        fallbackEditor?.focus();
        return;
      }
      const mode = vditor.vditor.currentMode;
      const editable = vditor.vditor[mode]?.element;
      if (!editable) return;
      if (mode !== "ir" && mode !== "wysiwyg") {
        // sv / 源码模式基于 textarea，插入后选区本就在卡片之后，只需聚焦。
        editable.focus();
        return;
      }
      let linkNode = null;
      if (mode === "ir") {
        linkNode =
          Array.from(editable.querySelectorAll(".vditor-ir__marker--link"))
            .find((marker) => String(marker.textContent || "").trim() === `hash:${id}`)
            ?.closest(".vditor-ir__node") || null;
      } else {
        linkNode = editable.querySelector(`a[href="hash:${id}"]`);
      }
      editable.focus();
      const range = document.createRange();
      if (linkNode?.parentNode) {
        range.setStartAfter(linkNode);
      } else {
        range.selectNodeContents(editable);
        range.collapse(false);
      }
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }, 0);
  }

  function insertPaperReference(paper, clientX, clientY) {
    const id = String(paper?.id || "").trim();
    const label = escapeMarkdownLinkText(formatPaperCardLabel(paper) || id);
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || !label) return;
    const markdown = `[${label}](hash:${id})`;

    if (editorReady && vditor) {
      vditor.focus();
      positionCaretAtPoint(clientX, clientY);
      vditor.insertValue(markdown, true);
      revealCaretAfterPaperCard(id);
      return;
    }
    if (fallbackEditor) {
      const start = fallbackEditor.selectionStart;
      const end = fallbackEditor.selectionEnd;
      fallbackEditor.setRangeText(markdown, start, end, "end");
      handleInput(fallbackEditor.value);
    }
  }

  function closePaperLinkPopover() {
    paperLinkRequestId += 1;
    paperLinkPopover?.remove();
    paperLinkPopover = null;
  }

  function positionPaperLinkPopover(anchor, popover) {
    const anchorRect = anchor.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const margin = 10;
    let left = Math.min(anchorRect.left, window.innerWidth - popoverRect.width - margin);
    let top = anchorRect.bottom + 8;
    if (top + popoverRect.height > window.innerHeight - margin) {
      top = anchorRect.top - popoverRect.height - 8;
    }
    popover.style.left = `${Math.max(margin, left)}px`;
    popover.style.top = `${Math.max(margin, top)}px`;
  }

  async function loadLinkedPaper(id) {
    if (paperLinkCache.has(id)) return paperLinkCache.get(id);
    const request = (async () => {
      const response = await apiFetch(`/api/library/paper?${new URLSearchParams({ id }).toString()}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "论文信息加载失败");
      return data.paper || data;
    })();
    paperLinkCache.set(id, request);
    try {
      return await request;
    } catch (error) {
      paperLinkCache.delete(id);
      throw error;
    }
  }

  async function showPaperLinkPopover(anchor, id) {
    closePaperLinkPopover();
    const requestId = paperLinkRequestId;
    const popover = document.createElement("section");
    popover.className = "notes-paper-link-popover";
    popover.setAttribute("role", "dialog");
    popover.setAttribute("aria-label", "论文链接详情");

    const header = document.createElement("header");
    const title = document.createElement("strong");
    title.textContent = String(anchor.querySelector?.(".vditor-ir__link")?.textContent || anchor.textContent || id).trim();

    const jumpButton = document.createElement("button");
    jumpButton.type = "button";
    jumpButton.className = "notes-paper-link-jump";
    jumpButton.setAttribute("aria-label", "跳转到论文");
    jumpButton.title = "跳转到论文";
    jumpButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M14 3h7v7"></path><path d="m10 14 11-11"></path><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path></svg>';
    jumpButton.addEventListener("click", () => {
      window.open(`./reader.html?${new URLSearchParams({ id }).toString()}`, "_blank", "noopener,noreferrer");
      closePaperLinkPopover();
    });
    header.append(title, jumpButton);

    const summary = document.createElement("div");
    summary.className = "notes-paper-link-summary loading";
    summary.textContent = "正在加载三行摘要…";

    popover.append(header, summary);
    popover.addEventListener("click", (event) => event.stopPropagation());
    document.body.appendChild(popover);
    paperLinkPopover = popover;
    positionPaperLinkPopover(anchor, popover);

    try {
      const paper = await loadLinkedPaper(id);
      if (paperLinkPopover !== popover || requestId !== paperLinkRequestId) return;
      title.textContent = paper.title || title.textContent;
      const threeLine = paper.threeLineSummary || {};
      summary.classList.remove("loading");
      summary.replaceChildren();
      [
        ["挑战", threeLine.challenges],
        ["方法", threeLine.method],
        ["结论", threeLine.conclusion],
      ].forEach(([label, value]) => {
        const row = document.createElement("p");
        const labelNode = document.createElement("b");
        labelNode.textContent = `${label}：`;
        row.append(labelNode, document.createTextNode(String(value || "暂无内容")));
        summary.appendChild(row);
      });
      window.requestAnimationFrame(() => positionPaperLinkPopover(anchor, popover));
    } catch (error) {
      if (paperLinkPopover !== popover || requestId !== paperLinkRequestId) return;
      summary.classList.remove("loading");
      summary.classList.add("error");
      summary.textContent = error.message || "论文信息加载失败";
    }
  }

  function scheduleSave(delay = AUTOSAVE_DELAY_MS) {
    window.clearTimeout(autoSaveTimer);
    autoSaveTimer = window.setTimeout(() => {
      save().catch((error) => console.error("笔记自动保存失败。", error));
    }, delay);
  }

  function handleInput(value) {
    pendingValue = String(value || "");
    if (applyingValue || pendingValue === lastSavedValue) return;
    setDirty(true);
    scheduleSave();
  }

  async function save() {
    window.clearTimeout(autoSaveTimer);
    if (savePromise) {
      await savePromise;
      if (getValue() !== lastSavedValue) return save();
      return;
    }

    const paper = getCurrentPaper?.();
    const notes = getValue();
    pendingValue = notes;
    if (!paper?.id || notes === lastSavedValue) return;

    savePromise = savePaper({ notes });
    try {
      await savePromise;
      lastSavedValue = notes;
      setDirty(getValue() !== lastSavedValue);
    } catch (error) {
      setDirty(true, true);
      throw error;
    } finally {
      savePromise = null;
    }

    if (getValue() !== lastSavedValue) scheduleSave(0);
  }

  function render(value) {
    const notes = String(value || "");
    window.clearTimeout(autoSaveTimer);
    pendingValue = notes;
    lastSavedValue = notes;
    setDirty(false);

    if (editorReady && vditor) {
      applyingValue = true;
      vditor.setValue(notes, true);
      applyingValue = false;
    } else if (fallbackEditor) {
      fallbackEditor.value = notes;
    }
  }

  async function copyNotes() {
    const notes = getValue();
    if (!notes) return;
    try {
      await copyText(notes);
      showCopiedFeedback(copyNotesButton);
    } catch (error) {
      console.error("复制笔记失败。", error);
    }
  }

  function setExportMenuOpen(open) {
    if (!notesExportMenu || !exportNotesButton) return;
    notesExportMenu.hidden = !open;
    exportNotesButton.setAttribute("aria-expanded", String(open));
  }

  async function exportNotesPdf() {
    const paper = getCurrentPaper?.();
    if (!paper?.id) return;

    try {
      await save();
    } catch (error) {
      console.error(error);
    }

    if (exportNotesPdfButton) exportNotesPdfButton.disabled = true;
    try {
      const response = await apiFetch("/api/library/notes/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: paper.id, notes: getValue() }),
      });
      const blob = await response.blob();
      if (!response.ok) {
        const detail = await blob.text();
        throw new Error(detail || "笔记 PDF 导出失败");
      }
      triggerBlobDownload(blob, `${paper.title || "paper"}-notes.pdf`);
    } catch (error) {
      console.error(error);
    } finally {
      if (exportNotesPdfButton) exportNotesPdfButton.disabled = false;
    }
  }

  async function exportNotesMarkdown() {
    const paper = getCurrentPaper?.();
    if (!paper?.id) return;

    try {
      await save();
    } catch (error) {
      console.error(error);
    }

    const notes = getValue();
    const blob = new Blob([notes], { type: "text/markdown;charset=utf-8" });
    triggerBlobDownload(blob, `${paper.title || "paper"}-notes.md`);
  }

  function initializeFallbackEditor() {
    if (!editorHost) return;
    editorHost.replaceChildren();
    fallbackEditor = document.createElement("textarea");
    fallbackEditor.className = "notes-editor-fallback";
    fallbackEditor.placeholder = "# 笔记";
    fallbackEditor.spellcheck = true;
    fallbackEditor.setAttribute("aria-label", "Markdown 笔记");
    fallbackEditor.value = pendingValue;
    fallbackEditor.addEventListener("input", () => handleInput(fallbackEditor.value));
    fallbackEditor.addEventListener("blur", () => scheduleSave(0));
    editorHost.appendChild(fallbackEditor);
    editorHost.title = "增强编辑器加载失败，已切换到基础编辑模式";
  }

  function initializeVditor() {
    if (!editorHost) return;
    if (!window.Vditor) {
      initializeFallbackEditor();
      return;
    }

    const cdn = new URL("./vendor/vditor", document.baseURI).href.replace(/\/$/, "");
    try {
      vditor = new window.Vditor(editorHost, {
        cdn,
        lang: "zh_CN",
        mode: getStoredEditorMode() === "ir" ? "ir" : "sv",
        height: "100%",
        minHeight: 260,
        value: pendingValue,
        placeholder: "开始记录阅读笔记，支持 Markdown、公式、表格和任务列表…",
        tab: "    ",
        cache: { enable: false },
        counter: { enable: true, type: "markdown" },
        toolbar: NOTES_TOOLBAR,
        toolbarConfig: { pin: false },
        fullscreen: { index: 2000 },
        preview: {
          delay: 250,
          maxWidth: 920,
          hljs: { style: "github", lineNumber: true },
          math: { engine: "KaTeX", inlineDigit: true },
          theme: {
            current: "light",
            path: `${cdn}/dist/css/content-theme`,
          },
        },
        input: handleInput,
        blur: () => scheduleSave(0),
        ctrlEnter: () => {
          save().catch((error) => console.error("笔记保存失败。", error));
        },
        after: () => {
          window.setTimeout(() => {
            if (!vditor) return;
            // Follow standard Markdown paragraph semantics: a single newline is
            // a soft break, while a blank line starts a new paragraph.
            vditor.vditor.lute.SetSoftBreak2HardBreak(false);
            arrangeEditorChrome();
            editorReady = true;
            applyingValue = true;
            vditor.setValue(pendingValue, true);
            applyingValue = false;
            setDirty(false);
          }, 0);
        },
      });
    } catch (error) {
      console.error("Vditor 初始化失败。", error);
      vditor = null;
      initializeFallbackEditor();
    }
  }

  copyNotesButton?.addEventListener("click", copyNotes);
  exportNotesButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    setExportMenuOpen(Boolean(notesExportMenu?.hidden));
  });
  notesExportMenu?.addEventListener("click", (event) => event.stopPropagation());
  exportNotesMarkdownButton?.addEventListener("click", () => {
    setExportMenuOpen(false);
    exportNotesMarkdown();
  });
  exportNotesPdfButton?.addEventListener("click", () => {
    setExportMenuOpen(false);
    exportNotesPdf();
  });
  document.addEventListener("click", () => {
    setExportMenuOpen(false);
    closePaperLinkPopover();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setExportMenuOpen(false);
      closePaperLinkPopover();
    }
  });
  editorHost?.addEventListener("dragover", (event) => {
    if (!Array.from(event.dataTransfer?.types || []).includes(PAPER_NOTE_DRAG_TYPE)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    editorHost.classList.add("paper-link-drag-over");
    showPaperDropCaret(event.clientX, event.clientY);
  }, true);
  editorHost?.addEventListener("dragleave", (event) => {
    if (!editorHost.contains(event.relatedTarget)) {
      editorHost.classList.remove("paper-link-drag-over");
      hidePaperDropCaret();
    }
  });
  editorHost?.addEventListener("drop", (event) => {
    const raw = event.dataTransfer?.getData(PAPER_NOTE_DRAG_TYPE);
    if (!raw) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    editorHost.classList.remove("paper-link-drag-over");
    hidePaperDropCaret();
    try {
      insertPaperReference(JSON.parse(raw), event.clientX, event.clientY);
    } catch (error) {
      console.error("论文链接插入失败。", error);
    }
  }, true);
  document.addEventListener("dragend", () => {
    editorHost?.classList.remove("paper-link-drag-over");
    hidePaperDropCaret();
  });
  editorHost?.addEventListener("click", (event) => {
    const anchor = event.target instanceof Element
      ? event.target.closest('a[href^="hash:"], .vditor-ir__node[data-type="a"]')
      : null;
    if (!anchor || !editorHost.contains(anchor)) return;
    const destination = anchor.matches("a")
      ? anchor.getAttribute("href")
      : anchor.querySelector(".vditor-ir__marker--link")?.textContent;
    if (!String(destination || "").startsWith("hash:")) return;
    const id = String(destination).slice(5).trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) return;
    event.preventDefault();
    event.stopPropagation();
    showPaperLinkPopover(anchor, id);
  }, true);
  editorHost?.addEventListener("keydown", (event) => {
    if (event.altKey && event.ctrlKey && event.key === "7") {
      event.preventDefault();
      event.stopImmediatePropagation();
      activateSourceMode();
    } else if (event.altKey && event.ctrlKey && event.key === "8") {
      const wasEmpty = !getValue().trim();
      setEditorMode("ir");
      scheduleEmptyModeSwitchCleanup(wasEmpty);
    } else if (event.altKey && event.ctrlKey && event.key === "9") {
      const wasEmpty = !getValue().trim();
      setEditorMode("sv");
      scheduleEmptyModeSwitchCleanup(wasEmpty);
    }
  }, true);
  window.addEventListener("pagehide", () => {
    if (getValue() !== lastSavedValue) {
      save().catch((error) => console.error("离开页面前保存笔记失败。", error));
    }
  });

  initializeVditor();

  return { render, save, getValue };
}
