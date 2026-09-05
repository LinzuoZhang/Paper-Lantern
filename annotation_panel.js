export function initAnnotationPanel(options) {
  const {
    getPdfFrameElement,
    getPdfViewer,
    getCurrentPaperTitle,
    getFileTitle,
    getHighlightGroup,
    getHighlightKey,
    getHighlights,
    setHighlights,
    isSameHighlightGroup,
    highlightColors,
    redrawHighlights,
    refreshCommentsNavigation,
    renderDiscussionMarkdown,
    saveCurrentPaper,
    startDiscussionFromReference,
    translateAnnotationText,
    explainAnnotationText,
    clamp,
  } = options;

  let activeHighlightGroupId = null;
  let annotationAutoSaveTimer = null;
  let dragState = null;

  function showAnnotationEditor(highlight, clientX, clientY) {
    activeHighlightGroupId = highlight.groupId || getHighlightKey(highlight);
    let editor = document.querySelector("#annotationEditor");
    if (!editor) {
      editor = createAnnotationEditor();
      getPdfFrameElement().appendChild(editor);
      initDraggableWindow(editor, hideAnnotationEditor);
      bindEditorEvents(editor);
      renderColorSwatches(editor);
    }

    const entries = getAnnotationEntries(getHighlightGroup(activeHighlightGroupId));
    if (!entries.length && highlight.type === "comment") {
      const entry = { id: createEntryId(), type: "comment", content: "" };
      setEntriesForActiveGroup([entry]);
      renderAnnotationDetail(editor, entry.id, "edit");
    } else {
      renderAnnotationPreviewList(editor);
    }
    syncActiveColor(editor, highlight);
    positionEditor(editor, clientX, clientY);
  }

  function createAnnotationEditor() {
    const editor = document.createElement("section");
    editor.id = "annotationEditor";
    editor.className = "annotation-editor translation-window";
    editor.innerHTML = `
      <header class="translation-window-header">
        <span>批注</span>
        <div class="annotation-header-actions">
          <button class="annotation-add-comment-button" type="button" aria-label="增加评论" title="增加评论">
            ${iconSvg("comment")}
          </button>
          <button class="annotation-translate-button" type="button" aria-label="增加翻译" title="增加翻译">
            ${iconSvg("translate")}
          </button>
          <button class="annotation-explain-button" type="button" aria-label="解释" title="解释">
            ${iconSvg("explain")}
          </button>
          <button class="annotation-delete icon-button" type="button" aria-label="删除批注" title="删除批注">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M3 6h18"></path>
              <path d="M8 6V4h8v2"></path>
              <path d="M6 6l1 15h10l1-15"></path>
              <path d="M10 11v6"></path>
              <path d="M14 11v6"></path>
            </svg>
          </button>
          <button class="translation-close" type="button" aria-label="关闭批注">×</button>
        </div>
      </header>
      <div class="annotation-content"></div>
      <div class="annotation-footer">
        <div class="annotation-colors" aria-label="高亮颜色"></div>
        <button class="annotation-discuss-button" type="button" aria-label="继续讨论" title="继续讨论">
          ${iconSvg("enter")}
          <span>继续讨论</span>
        </button>
      </div>
    `;
    return editor;
  }

  function bindEditorEvents(editor) {
    editor.querySelector(".annotation-add-comment-button").addEventListener("click", () => addCommentEntry(editor));
    editor.querySelector(".annotation-translate-button").addEventListener("click", () => translateActiveAnnotation(editor));
    editor.querySelector(".annotation-explain-button").addEventListener("click", () => explainActiveAnnotation(editor));
    editor.querySelector(".annotation-delete").addEventListener("click", deleteActiveHighlight);
    editor.querySelector(".annotation-discuss-button").addEventListener("click", continueAnnotationInDiscussion);
  }

  function renderColorSwatches(editor) {
    const colorHost = editor.querySelector(".annotation-colors");
    colorHost.innerHTML = "";
    Object.entries(highlightColors).forEach(([key, value]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "color-swatch";
      button.dataset.color = key;
      button.style.background = value;
      button.setAttribute("aria-label", key);
      button.addEventListener("click", () => {
        colorHost.querySelectorAll(".color-swatch").forEach((swatch) => swatch.classList.remove("active"));
        button.classList.add("active");
        scheduleAnnotationAutoSave();
      });
      colorHost.appendChild(button);
    });
  }

  function renderAnnotationPreviewList(editor) {
    const host = editor.querySelector(".annotation-content");
    const entries = getAnnotationEntries(getHighlightGroup(activeHighlightGroupId));
    updateAnnotationHeaderActions(editor);
    host.innerHTML = '<div class="annotation-bubble-list" aria-label="批注内容"></div>';
    const list = host.querySelector(".annotation-bubble-list");
    list.addEventListener("click", (event) => {
      const actionButton = event.target.closest(".annotation-refresh-button, .annotation-entry-delete-button");
      if (actionButton) return;
      const bubble = event.target.closest(".annotation-bubble");
      if (!bubble) return;
      renderAnnotationDetail(editor, bubble.dataset.entryId, "preview");
    });
    list.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (event.target.closest("button")) return;
      const bubble = event.target.closest(".annotation-bubble");
      if (!bubble) return;
      event.preventDefault();
      renderAnnotationDetail(editor, bubble.dataset.entryId, "preview");
    });

    entries.forEach((entry) => {
      list.appendChild(createPreviewBubble(editor, entry));
    });
  }

  function createPreviewBubble(editor, entry) {
    const bubble = document.createElement("article");
    bubble.className = `annotation-bubble annotation-bubble-${entry.type}`;
    bubble.dataset.entryId = entry.id;
    bubble.dataset.type = entry.type;

    const header = document.createElement("div");
    header.className = "annotation-bubble-header";
    const label = document.createElement("span");
    label.className = "annotation-bubble-label";
    label.textContent = entry.type === "translation" ? "翻译" : "评论";
    header.appendChild(label);

    if (entry.type === "translation") {
      header.appendChild(createRefreshButton(editor, entry.id));
    }
    header.appendChild(createEntryDeleteButton(editor, entry.id));

    const body = document.createElement("div");
    body.className = "annotation-bubble-preview markdown-body";
    if (entry.type === "translation") {
      const source = getHighlightGroupSelectedText(getHighlightGroup(activeHighlightGroupId))
        || inferTextFromHighlightRanges(getHighlightRanges(getHighlightGroup(activeHighlightGroupId)));
      if (source) {
        const sourceNode = document.createElement("div");
        sourceNode.className = "annotation-translation-source";
        sourceNode.textContent = `“${source}”`;
        body.appendChild(sourceNode);
      }
    }
    const contentNode = document.createElement("div");
    contentNode.className = "annotation-bubble-markdown";
    contentNode.innerHTML = entry.content ? renderDiscussionMarkdown(entry.content) : "<p>空评论</p>";
    body.appendChild(contentNode);
    body.classList.toggle("empty", !entry.content);

    bubble.append(header, body);
    bubble.tabIndex = 0;
    return bubble;
  }

  function addCommentEntry(editor) {
    const entry = { id: createEntryId(), type: "comment", content: "" };
    const entries = [...getAnnotationEntries(getHighlightGroup(activeHighlightGroupId)), entry];
    setEntriesForActiveGroup(entries);
    updateAnnotationHeaderActions(editor);
    renderAnnotationDetail(editor, entry.id, "edit");
  }

  async function deleteAnnotationEntry(editor, entryId) {
    if (!activeHighlightGroupId) return;
    window.clearTimeout(annotationAutoSaveTimer);
    const entries = getAnnotationEntries(getHighlightGroup(activeHighlightGroupId))
      .filter((entry) => entry.id !== entryId && entry.content);
    setEntriesForActiveGroup(entries);
    redrawHighlights();
    refreshCommentsNavigation();
    updateAnnotationHeaderActions(editor);
    renderAnnotationPreviewList(editor);
    try {
      await saveCurrentPaper();
    } catch (error) {
      console.error("Failed to delete annotation entry.", error);
    }
  }

  function renderAnnotationDetail(editor, entryId, mode = "preview") {
    const entry = getAnnotationEntries(getHighlightGroup(activeHighlightGroupId)).find((item) => item.id === entryId);
    if (!entry) {
      renderAnnotationPreviewList(editor);
      return;
    }

    const host = editor.querySelector(".annotation-content");
    updateAnnotationHeaderActions(editor);
    host.innerHTML = `
      <div class="annotation-detail" data-entry-id="${entry.id}" data-type="${entry.type}" data-mode="${mode === "edit" ? "edit" : "preview"}">
        <div class="annotation-detail-toolbar">
          <button class="annotation-back-button" type="button" aria-label="返回批注列表" title="返回">
            ${iconSvg("back")}
          </button>
          <span class="annotation-detail-title">${entry.type === "translation" ? "翻译" : "评论"}</span>
          <button class="annotation-detail-refresh-button" type="button" aria-label="重新翻译" title="重新翻译" ${entry.type === "translation" ? "" : "hidden"}>
            ${iconSvg("refresh")}
          </button>
          <button class="annotation-detail-mode-button" type="button" aria-label="${mode === "edit" ? "预览" : "编辑"}" title="${mode === "edit" ? "预览" : "编辑"}">
            ${iconSvg(mode === "edit" ? "preview" : "edit")}
          </button>
          <button class="annotation-detail-delete-button" type="button" aria-label="删除这条批注" title="删除">
            ${iconSvg("trash")}
          </button>
        </div>
        <div class="annotation-detail-preview markdown-body"></div>
        <textarea class="annotation-detail-input" rows="8" spellcheck="false"></textarea>
      </div>
    `;

    const detail = host.querySelector(".annotation-detail");
    const input = detail.querySelector(".annotation-detail-input");
    const preview = detail.querySelector(".annotation-detail-preview");
    input.value = entry.content || "";
    input.placeholder = entry.type === "translation" ? "翻译内容" : "写下评论...";
    renderDetailPreview(preview, input.value);
    setDetailMode(detail, mode);
    detail.querySelector(".annotation-back-button").addEventListener("click", () => {
      updateDetailEntry(detail);
      saveAnnotationEdit().catch((error) => console.error("Failed to save annotation.", error));
      renderAnnotationPreviewList(editor);
    });
    detail.querySelector(".annotation-detail-mode-button").addEventListener("click", () => {
      updateDetailEntry(detail);
      setDetailMode(detail, detail.dataset.mode === "edit" ? "preview" : "edit");
    });
    detail.querySelector(".annotation-detail-refresh-button").addEventListener("click", (event) => {
      event.stopPropagation();
      refreshTranslationEntry(editor, entry.id, { stayInDetail: true });
    });
    detail.querySelector(".annotation-detail-delete-button").addEventListener("click", () => {
      deleteAnnotationEntry(editor, entry.id);
    });
    input.addEventListener("input", () => {
      renderDetailPreview(preview, input.value);
      updateDetailEntry(detail);
      scheduleAnnotationAutoSave();
    });
    if (mode === "edit") input.focus();
  }

  function setDetailMode(detail, mode) {
    const nextMode = mode === "edit" ? "edit" : "preview";
    detail.dataset.mode = nextMode;
    const modeButton = detail.querySelector(".annotation-detail-mode-button");
    modeButton.setAttribute("aria-label", nextMode === "edit" ? "预览" : "编辑");
    modeButton.title = nextMode === "edit" ? "预览" : "编辑";
    modeButton.innerHTML = iconSvg(nextMode === "edit" ? "preview" : "edit");
  }

  function renderDetailPreview(preview, value) {
    const content = String(value || "").trim();
    preview.innerHTML = content ? renderDiscussionMarkdown(content) : "<p>空评论</p>";
    preview.classList.toggle("empty", !content);
  }

  function updateDetailEntry(detail) {
    const entryId = detail.dataset.entryId;
    const content = detail.querySelector(".annotation-detail-input")?.value.trim() || "";
    const entries = getAnnotationEntries(getHighlightGroup(activeHighlightGroupId)).map((entry) => {
      return entry.id === entryId ? { ...entry, content } : entry;
    });
    setEntriesForActiveGroup(entries);
  }

  function syncActiveColor(editor, highlight) {
    const color = getHighlightGroup(activeHighlightGroupId).find((item) => item.color)?.color || highlight.color || "yellow";
    editor.querySelectorAll(".color-swatch").forEach((button) => {
      button.classList.toggle("active", button.dataset.color === color);
    });
  }

  async function translateActiveAnnotation(editor) {
    if (!activeHighlightGroupId) return;
    const group = getHighlightGroup(activeHighlightGroupId);
    if (hasActiveTranslation()) {
      renderAnnotationPreviewList(editor);
      return;
    }
    const source = getHighlightGroupSelectedText(group) || inferTextFromHighlightRanges(getHighlightRanges(group));
    if (!editor || !source) return;
    const button = editor.querySelector(".annotation-translate-button");
    try {
      if (button) button.disabled = true;
      const translation = await translateAnnotationText(source);
      const entries = getAnnotationEntries(group).filter((entry) => entry.type !== "translation");
      const entry = { id: createEntryId(), type: "translation", content: translation };
      setEntriesForActiveGroup([entry, ...entries]);
      await saveAnnotationEdit();
      updateAnnotationHeaderActions(editor);
      renderAnnotationPreviewList(editor);
    } catch (error) {
      console.error(error);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function explainActiveAnnotation(editor) {
    if (!activeHighlightGroupId || typeof explainAnnotationText !== "function") return;
    const group = getHighlightGroup(activeHighlightGroupId);
    const source = getHighlightGroupSelectedText(group) || inferTextFromHighlightRanges(getHighlightRanges(group));
    if (!editor || !source) return;
    const button = editor.querySelector(".annotation-explain-button");
    try {
      if (button) button.disabled = true;
      const explanation = await explainAnnotationText(source);
      const content = String(explanation || "").trim();
      if (!content) return;
      const entry = { id: createEntryId(), type: "comment", content };
      setEntriesForActiveGroup([...getAnnotationEntries(group), entry]);
      await saveAnnotationEdit();
      updateAnnotationHeaderActions(editor);
      renderAnnotationDetail(editor, entry.id, "preview");
    } catch (error) {
      console.error(error);
    } finally {
      if (button) button.disabled = false;
    }
  }

  function hasActiveTranslation() {
    return getAnnotationEntries(getHighlightGroup(activeHighlightGroupId))
      .some((entry) => entry.type === "translation" && entry.content);
  }

  function updateAnnotationHeaderActions(editor) {
    const translateButton = editor?.querySelector(".annotation-translate-button");
    if (translateButton) translateButton.hidden = hasActiveTranslation();
  }

  async function refreshTranslationEntry(editor, entryId, options = {}) {
    const group = getHighlightGroup(activeHighlightGroupId);
    const source = getHighlightGroupSelectedText(group) || inferTextFromHighlightRanges(getHighlightRanges(group));
    if (!source) return;
    const button = editor.querySelector(".annotation-detail-refresh-button")
      || editor.querySelector(`.annotation-bubble[data-entry-id="${CSS.escape(entryId)}"] .annotation-refresh-button`);
    try {
      if (button) button.disabled = true;
      const translation = await translateAnnotationText(source);
      const entries = getAnnotationEntries(group).map((entry) => (
        entry.id === entryId ? { ...entry, content: translation } : entry
      ));
      setEntriesForActiveGroup(entries);
      await saveAnnotationEdit();
      if (options.stayInDetail) renderAnnotationDetail(editor, entryId, "preview");
      else renderAnnotationPreviewList(editor);
    } catch (error) {
      console.error(error);
    } finally {
      if (button) button.disabled = false;
    }
  }

  function createRefreshButton(editor, entryId) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "annotation-refresh-button";
    button.setAttribute("aria-label", "重新翻译");
    button.title = "重新翻译";
    button.innerHTML = iconSvg("refresh");
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      refreshTranslationEntry(editor, entryId);
    });
    return button;
  }

  function createEntryDeleteButton(editor, entryId) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "annotation-entry-delete-button";
    button.setAttribute("aria-label", "删除这条批注");
    button.title = "删除";
    button.innerHTML = iconSvg("trash");
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteAnnotationEntry(editor, entryId);
    });
    return button;
  }

  function getAnnotationEntries(group) {
    const first = group[0] || {};
    const entries = normalizeEntries(first.text);
    if (!entries.some((entry) => entry.type === "translation") && String(first.translation || "").trim()) {
      entries.unshift({ id: stableEntryId("translation", String(first.translation).trim(), 0), type: "translation", content: String(first.translation).trim() });
    }
    if (!entries.some((entry) => entry.type === "comment") && String(first.comment || "").trim()) {
      entries.push({ id: stableEntryId("comment", String(first.comment).trim(), entries.length), type: "comment", content: String(first.comment).trim() });
    }
    return sortAnnotationEntries(entries);
  }

  function normalizeEntries(value) {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry, index) => {
        if (typeof entry === "string") {
          const content = entry.trim();
          return { id: stableEntryId("comment", content, index), type: "comment", content };
        }
        if (!entry || typeof entry !== "object") return null;
        const type = entry.type === "translation" ? "translation" : "comment";
        const content = String(entry.content || entry.text || "").trim();
        return content || type === "comment" ? { id: String(entry.id || stableEntryId(type, content, index)), type, content } : null;
      })
      .filter(Boolean);
  }

  function readEditorEntries(editor) {
    const detail = editor?.querySelector(".annotation-detail");
    if (detail) updateDetailEntry(detail);
    return getAnnotationEntries(getHighlightGroup(activeHighlightGroupId)).filter((entry) => entry.content);
  }

  function setEntriesForActiveGroup(entries) {
    const normalized = sortAnnotationEntries(entries).filter((entry) => entry.content || entry.type === "comment");
    const firstComment = normalized.find((entry) => entry.type === "comment" && entry.content)?.content || "";
    const translation = normalized.find((entry) => entry.type === "translation" && entry.content)?.content || "";
    const color = document.querySelector("#annotationEditor .color-swatch.active")?.dataset.color || "yellow";
    setHighlights(getHighlights().map((highlight) => {
      if (!isSameHighlightGroup(highlight, activeHighlightGroupId)) return highlight;
      const next = { ...highlight, color, text: normalized };
      if (firstComment) {
        next.comment = firstComment;
        next.type = "comment";
      } else {
        delete next.comment;
      }
      if (translation) {
        next.translation = translation;
        next.type = next.type === "comment" ? "comment-translation" : "translation";
      } else {
        delete next.translation;
        if (!next.comment) delete next.type;
      }
      return next;
    }));
  }

  function sortAnnotationEntries(entries) {
    return entries.slice().sort((a, b) => {
      if (a.type === b.type) return 0;
      return a.type === "translation" ? -1 : 1;
    });
  }

  async function continueAnnotationInDiscussion() {
    if (!activeHighlightGroupId) return;
    const reference = buildDiscussionReferenceFromHighlightGroup(activeHighlightGroupId);
    if (!reference) return;
    window.clearTimeout(annotationAutoSaveTimer);
    await saveAnnotationEdit();
    hideAnnotationEditor({ skipSave: true });
    startDiscussionFromReference(reference);
  }

  function buildDiscussionReferenceFromHighlightGroup(groupId) {
    const group = getHighlightGroup(groupId);
    if (!group.length) return null;
    const ranges = getHighlightRanges(group);
    if (!ranges.length) return null;
    const text = getHighlightGroupSelectedText(group) || inferTextFromHighlightRanges(ranges);
    if (!text) return null;
    return {
      text,
      paperTitle: getCurrentPaperTitle() || getFileTitle(),
      page: ranges[0].pageNumber || 0,
      before: "",
      after: "",
      ranges,
    };
  }

  function getHighlightRanges(group) {
    return group.map((item) => ({
      pageNumber: Number(item.pageNumber),
      left: Number(item.left),
      top: Number(item.top),
      width: Number(item.width),
      height: Number(item.height),
    })).filter((item) => (
      Number.isFinite(item.pageNumber) &&
      Number.isFinite(item.left) &&
      Number.isFinite(item.top) &&
      Number.isFinite(item.width) &&
      Number.isFinite(item.height)
    ));
  }

  function getHighlightGroupSelectedText(group) {
    const selected = group.find((item) => String(item.selectedText || "").trim())?.selectedText || "";
    if (selected.trim()) return selected.trim();
    const legacy = group.find((item) => typeof item.text === "string" && item.text.trim())?.text || "";
    return legacy.trim();
  }

  function inferTextFromHighlightRanges(ranges) {
    const parts = [];
    const sortedRanges = ranges.slice().sort((a, b) => a.pageNumber - b.pageNumber || a.top - b.top || a.left - b.left);
    sortedRanges.forEach((range) => {
      const pageNode = getPdfViewer().querySelector(`.pdf-page[data-page-number="${range.pageNumber}"]`);
      const textLayer = pageNode?.querySelector(".pdf-text-layer");
      if (!pageNode || !textLayer) return;
      const pageRect = pageNode.getBoundingClientRect();
      const rangeRect = {
        left: pageRect.left + range.left * pageRect.width,
        top: pageRect.top + range.top * pageRect.height,
        right: pageRect.left + (range.left + range.width) * pageRect.width,
        bottom: pageRect.top + (range.top + range.height) * pageRect.height,
      };
      const line = Array.from(textLayer.querySelectorAll("span"))
        .map((span) => {
          const rect = span.getBoundingClientRect();
          if (!rectOverlaps(rangeRect, rect)) return null;
          return { left: rect.left, top: rect.top, text: span.textContent || "" };
        })
        .filter(Boolean)
        .sort((a, b) => a.top - b.top || a.left - b.left)
        .map((item) => item.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (line) parts.push(line);
    });
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  function rectOverlaps(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  function scheduleAnnotationAutoSave() {
    window.clearTimeout(annotationAutoSaveTimer);
    annotationAutoSaveTimer = window.setTimeout(() => {
      saveAnnotationEdit().catch((error) => console.error("Failed to auto-save annotation.", error));
    }, 450);
  }

  async function saveAnnotationEdit() {
    if (!activeHighlightGroupId) return;
    const editor = document.querySelector("#annotationEditor");
    const entries = editor ? readEditorEntries(editor) : getAnnotationEntries(getHighlightGroup(activeHighlightGroupId));
    const hadTypedAnnotation = getHighlightGroup(activeHighlightGroupId).some((item) => item.comment || item.translation || item.type === "comment");
    setEntriesForActiveGroup(entries.filter((entry) => entry.content));
    if (hadTypedAnnotation && !entries.some((entry) => entry.content)) {
      setHighlights(getHighlights().filter((highlight) => !isSameHighlightGroup(highlight, activeHighlightGroupId)));
    }
    redrawHighlights();
    refreshCommentsNavigation();
    await saveCurrentPaper();
  }

  function deleteActiveHighlight() {
    if (!activeHighlightGroupId) return;
    setHighlights(getHighlights().filter((highlight) => !isSameHighlightGroup(highlight, activeHighlightGroupId)));
    redrawHighlights();
    hideAnnotationEditor();
    saveCurrentPaper().catch((error) => console.error("Failed to delete annotation.", error));
  }

  function initDraggableWindow(bubble, closeHandler) {
    const header = bubble.querySelector(".translation-window-header");
    const closeButton = bubble.querySelector(".translation-close");
    closeButton.addEventListener("click", closeHandler);
    header.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return;
      event.preventDefault();
      const rect = bubble.getBoundingClientRect();
      const frameRect = getPdfFrameElement().getBoundingClientRect();
      dragState = {
        pointerId: event.pointerId,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        frameRect,
      };
      header.setPointerCapture(event.pointerId);
    });
    header.addEventListener("pointermove", (event) => {
      if (!dragState || dragState.pointerId !== event.pointerId) return;
      const frameRect = dragState.frameRect;
      const maxLeft = frameRect.width - bubble.offsetWidth - 8;
      const maxTop = frameRect.height - bubble.offsetHeight - 8;
      const left = clamp(event.clientX - frameRect.left - dragState.offsetX, 8, Math.max(8, maxLeft));
      const top = clamp(event.clientY - frameRect.top - dragState.offsetY, 8, Math.max(8, maxTop));
      bubble.style.left = `${left}px`;
      bubble.style.top = `${top}px`;
    });
    header.addEventListener("pointerup", finishDrag);
    header.addEventListener("pointercancel", finishDrag);
  }

  function finishDrag(event) {
    if (!dragState) return;
    event.currentTarget.releasePointerCapture?.(dragState.pointerId);
    dragState = null;
  }

  function positionEditor(editor, clientX, clientY) {
    const frameRect = getPdfFrameElement().getBoundingClientRect();
    const editorWidth = editor.offsetWidth || 390;
    const editorHeight = editor.offsetHeight || 410;
    const left = Math.max(12, Math.min(clientX - frameRect.left + 10, frameRect.width - editorWidth - 12));
    const top = Math.max(12, Math.min(clientY - frameRect.top + 10, frameRect.height - editorHeight - 12));
    editor.style.left = `${left}px`;
    editor.style.top = `${top}px`;
  }

  function hideAnnotationEditor(options = {}) {
    window.clearTimeout(annotationAutoSaveTimer);
    if (!options.skipSave) {
      saveAnnotationEdit().catch((error) => console.error("Failed to auto-save annotation.", error));
    }
    document.querySelector("#annotationEditor")?.remove();
    activeHighlightGroupId = null;
  }

  function iconSvg(name) {
    const icons = {
      comment: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"></path><path d="M12 8v6"></path><path d="M9 11h6"></path></svg>',
      translate: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m5 8 6 6"></path><path d="m4 14 6-6 2-3"></path><path d="M2 5h12"></path><path d="M7 2h1"></path><path d="m22 22-5-10-5 10"></path><path d="M14 18h6"></path></svg>',
      explain: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 18h6"></path><path d="M10 22h4"></path><path d="M8 14a6 6 0 1 1 8 0c-1 1-1.5 2-1.5 3h-5c0-1-.5-2-1.5-3z"></path></svg>',
      refresh: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 6v5h-5"></path><path d="M19.1 15a7.5 7.5 0 1 1-1.9-8.1L20 11"></path></svg>',
      back: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15 18l-6-6 6-6"></path></svg>',
      enter: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 12h12"></path><path d="m12 8 4 4-4 4"></path><path d="M20 5v14"></path></svg>',
      edit: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>',
      preview: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"></path><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"></path></svg>',
      trash: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v5"></path><path d="M14 11v5"></path></svg>',
    };
    return icons[name] || "";
  }

  function createEntryId() {
    return `entry-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function stableEntryId(type, content, index) {
    return `entry-${type}-${index}-${simpleHash(`${type}:${index}:${content}`)}`;
  }

  function simpleHash(value) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16);
  }

  return {
    show: showAnnotationEditor,
    hide: hideAnnotationEditor,
  };
}
