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
  "paper-reference",
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

// Presentation-only symbols for the standalone note page. Vditor keeps its
// original buttons, handlers, shortcuts and mode switching.
const NOTES_LINE_ICONS = {
  outline: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M13 8h4M13 12h4M13 16h3"/>',
  headings: '<path d="M3 5h12M9 5v14M5 19h8m4-8 3 3 3-3"/>',
  bold: '<path d="M6 12h8a4 4 0 0 1 0 8H6V4h7a4 4 0 0 1 0 8"/>',
  italic: '<path d="M19 4h-9m4 16H5M15 4 9 20"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  "ordered-list": '<path d="M10 6h11M10 12h11M10 18h11M4 4h1v5M4 9h2M3 14a2 2 0 0 1 4 0c0 2-4 2-4 5h4"/>',
  check: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8 12 3 3 5-6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 .1l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7-.1l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  "paper-reference": '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
  undo: '<path d="M3 7v6h6M21 17a8 8 0 0 0-13.6-5.6L3 13"/>',
  redo: '<path d="M21 7v6h-6M3 17a8 8 0 0 1 13.6-5.6L21 13"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  fullscreen: '<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5"/>',
  contract: '<path d="M8 3v5H3M16 3v5h5M21 16h-5v5M3 16h5v5"/>',
  edit: '<path d="m16 3 5 5M4 20l4-1L21 6a2.1 2.1 0 0 0-3-3L5 16z"/>',
  both: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16M6 8h3M6 12h3M15 8h3M15 12h3"/>',
  strike: '<path d="M16 4H9a4 4 0 0 0-4 4M4 12h16M17 12a4 4 0 0 1-2 8H6"/>',
  quote: '<path d="M3 12h6V5H3v7c0 4 2 6 6 7M15 12h6V5h-6v7c0 4 2 6 6 7"/>',
  line: '<path d="M4 12h16"/>',
  code: '<path d="m8 8-4 4 4 4m8-8 4 4-4 4M14 4l-4 16"/>',
  "inline-code": '<path d="m8 7-5 5 5 5m8-10 5 5-5 5"/>',
  table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18M3 15h18"/>',
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

export function getExternalNoteLink(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (!["http:", "https:"].includes(url.protocol)) return null;
    const arxiv = /^(?:www\.)?arxiv\.org$/i.test(url.hostname)
      && /^\/(?:abs|pdf|html)\/(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?(?:\.pdf)?\/?$/i.test(url.pathname);
    if (arxiv) url.pathname = url.pathname.replace(/^\/html\//, "/abs/");
    return { url: url.href, importable: arxiv || /\.pdf$/i.test(url.pathname) };
  } catch {
    return null;
  }
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
  const isStandaloneNote = Boolean(editorHost?.closest(".standalone-note-page"));

  function iconReference(icon) {
    return isStandaloneNote && Object.hasOwn(NOTES_LINE_ICONS, icon)
      ? `#notes-line-${icon}`
      : `#vditor-icon-${icon}`;
  }

  function styleStandaloneEditorChrome() {
    if (!isStandaloneNote) return;
    const definitions = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    definitions.classList.add("notes-icon-definitions");
    definitions.setAttribute("aria-hidden", "true");
    definitions.innerHTML = `<defs>${Object.entries(NOTES_LINE_ICONS).map(([name, paths]) =>
      `<symbol id="notes-line-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</symbol>`).join("")}</defs>`;
    editorHost.appendChild(definitions);
    editorHost.querySelectorAll(".vditor-toolbar__item > button[data-type]").forEach((button) => {
      const type = button.dataset.type;
      const icon = type === "edit-mode" ? NOTES_MODE_ICONS.ir : type;
      if (!Object.hasOwn(NOTES_LINE_ICONS, icon)) return;
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
      use.setAttributeNS("http://www.w3.org/1999/xlink", "href", iconReference(icon));
      svg.setAttribute("aria-hidden", "true");
      svg.appendChild(use);
      button.replaceChildren(svg);
      if (["headings", "list", "link", "undo"].includes(type)) {
        button.parentElement.classList.add("notes-toolbar-group-start");
      }
    });
    // Vditor replaces this button's SVG when fullscreen changes, including when
    // invoked by a shortcut. Only refresh its presentation after that update.
    const fullscreenButton = editorHost.querySelector('button[data-type="fullscreen"]');
    if (fullscreenButton) {
      new MutationObserver(() => {
        const icon = editorHost.classList.contains("vditor--fullscreen") ? "contract" : "fullscreen";
        fullscreenButton.querySelector("use")?.setAttributeNS(
          "http://www.w3.org/1999/xlink", "href", iconReference(icon),
        );
      }).observe(fullscreenButton, { childList: true });
    }
  }

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
  let paperPicker = null;
  let paperPickerTree = null;
  let paperPickerBookmark = null;
  let paperPickerCategory = null;
  let paperPickerActiveIndex = 0;
  let paperPickerRequest = null;
  const paperPickerExpandedCategories = new Set();
  const paperLinkCache = new Map();

  const PAPER_REFERENCE_ICON = '<span class="notes-paper-reference-icon" aria-hidden="true">@</span>';

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
    use.setAttributeNS("http://www.w3.org/1999/xlink", "href", iconReference(icon));
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
      iconReference(NOTES_MODE_ICONS[mode] || NOTES_MODE_ICONS.ir),
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
    styleStandaloneEditorChrome();
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

  function getActiveEditable() {
    if (!editorReady || !vditor) return fallbackEditor;
    const mode = vditor.vditor.currentMode;
    return vditor.vditor[mode]?.element || null;
  }

  function captureInsertionBookmark() {
    const editable = getActiveEditable();
    if (!editable) return null;
    if (editable instanceof HTMLTextAreaElement) {
      return { editable, start: editable.selectionStart, end: editable.selectionEnd };
    }
    const selection = window.getSelection();
    if (!selection?.rangeCount) return null;
    const range = selection.getRangeAt(0);
    if (range.startContainer !== editable && !editable.contains(range.startContainer)) return null;
    return { editable, range: range.cloneRange() };
  }

  function restoreInsertionBookmark(bookmark) {
    if (!bookmark?.editable?.isConnected) return false;
    bookmark.editable.focus({ preventScroll: true });
    if (bookmark.editable instanceof HTMLTextAreaElement) {
      bookmark.editable.setSelectionRange(bookmark.start, bookmark.end);
      return true;
    }
    if (!bookmark.range?.startContainer?.isConnected) return false;
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(bookmark.range);
    return true;
  }

  function categoryPapers(category) {
    if (!category) return [];
    const papers = [
      ...(category.papers || []),
      ...(category.folders || []).flatMap(categoryPapers),
    ].filter((paper) => paper.itemType !== "note" && paper.id !== getCurrentPaper?.()?.id);
    return [...new Map(papers.map((paper) => [paper.id, paper])).values()];
  }

  function visiblePaperCategories(category, depth = 0, parents = []) {
    if (!category) return [];
    const items = [];
    (category.folders || []).forEach((folder) => {
      const pathParts = [...parents, folder.name];
      const hasChildren = Boolean(folder.folders?.length);
      const expanded = hasChildren && paperPickerExpandedCategories.has(folder.id);
      items.push({
        type: "category",
        category: folder,
        path: pathParts.join(" / "),
        count: categoryPapers(folder).length,
        depth,
        hasChildren,
        expanded,
      });
      if (expanded) items.push(...visiblePaperCategories(folder, depth + 1, pathParts));
    });
    return items;
  }

  function paperAuthors(paper) {
    return Array.isArray(paper?.basicInfo?.authors)
      ? paper.basicInfo.authors.map(String).map((value) => value.trim()).filter(Boolean)
      : [];
  }

  function paperPickerItems() {
    if (!paperPickerTree) return [];
    const input = paperPicker?.querySelector(".notes-paper-picker-search");
    const query = String(input?.value || "").trim().toLocaleLowerCase();
    if (query) {
      return categoryPapers(paperPickerTree)
        .filter((paper) => [paper.title, ...paperAuthors(paper), ...(paper.categoryNames || [paper.categoryName]), ...(paper.categoryIds || [])]
          .some((value) => String(value || "").toLocaleLowerCase().includes(query)))
        .map((paper) => ({ type: "paper", paper }));
    }
    if (paperPickerCategory) {
      return categoryPapers(paperPickerCategory).map((paper) => ({ type: "paper", paper }));
    }
    const rootPapers = (paperPickerTree.papers || [])
      .filter((paper) => paper.itemType !== "note" && paper.id !== getCurrentPaper?.()?.id);
    const categories = visiblePaperCategories(paperPickerTree);
    return [
      ...(rootPapers.length ? [{ type: "category", category: paperPickerTree, path: "文献库根目录", count: rootPapers.length, directOnly: true, depth: 0, hasChildren: false, expanded: false }] : []),
      ...categories,
    ];
  }

  function togglePaperPickerCategory(item) {
    if (!item?.hasChildren) return;
    if (paperPickerExpandedCategories.has(item.category.id)) {
      paperPickerExpandedCategories.delete(item.category.id);
    } else {
      paperPickerExpandedCategories.add(item.category.id);
    }
    renderPaperPicker();
  }

  function updatePaperPickerActive(items) {
    const buttons = Array.from(paperPicker?.querySelectorAll(".notes-paper-picker-item") || []);
    if (!buttons.length) {
      paperPickerActiveIndex = 0;
      return;
    }
    paperPickerActiveIndex = Math.min(Math.max(paperPickerActiveIndex, 0), buttons.length - 1);
    buttons.forEach((button, index) => {
      button.classList.toggle("active", index === paperPickerActiveIndex);
      button.setAttribute("aria-selected", String(index === paperPickerActiveIndex));
    });
    buttons[paperPickerActiveIndex]?.scrollIntoView({ block: "nearest" });
  }

  function choosePaperPickerItem(item) {
    if (item.type === "category") {
      paperPickerCategory = item.directOnly ? { ...item.category, folders: [] } : item.category;
      paperPickerActiveIndex = 0;
      renderPaperPicker();
      return;
    }
    const bookmark = paperPickerBookmark;
    closePaperPicker(false);
    insertPaperReference({
      id: item.paper.id,
      title: item.paper.title,
      authors: paperAuthors(item.paper),
    }, undefined, undefined, bookmark);
  }

  function renderPaperPicker() {
    if (!paperPicker) return;
    const input = paperPicker.querySelector(".notes-paper-picker-search");
    const query = String(input?.value || "").trim();
    const title = paperPicker.querySelector(".notes-paper-picker-title");
    const back = paperPicker.querySelector(".notes-paper-picker-back");
    if (title) title.textContent = query ? "搜索结果" : paperPickerCategory?.name || "选择目录";
    if (back) back.hidden = !paperPickerCategory || Boolean(query);
    const list = paperPicker.querySelector(".notes-paper-picker-list");
    const items = paperPickerItems();
    list.replaceChildren();

    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "notes-paper-picker-empty";
      empty.textContent = query ? "没有匹配的论文" : (paperPickerCategory ? "此目录中没有论文" : "文献库中没有可插入的论文");
      list.appendChild(empty);
      return;
    }

    items.forEach((item, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `notes-paper-picker-item notes-paper-picker-${item.type}`;
      button.setAttribute("role", "option");
      if (item.type === "category") {
        const row = document.createElement("div");
        row.className = "notes-paper-picker-category-row";
        row.style.setProperty("--paper-picker-depth", String(item.depth || 0));
        const disclosure = document.createElement("button");
        disclosure.type = "button";
        disclosure.className = "notes-paper-picker-disclosure";
        disclosure.disabled = !item.hasChildren;
        disclosure.setAttribute("aria-label", item.expanded ? `收起 ${item.category.name}` : `展开 ${item.category.name}`);
        disclosure.setAttribute("aria-expanded", String(Boolean(item.expanded)));
        disclosure.innerHTML = item.hasChildren
          ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>'
          : "";
        disclosure.addEventListener("click", () => togglePaperPickerCategory(item));
        button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h6l2 3h10v11H3z"></path></svg>';
        button.title = item.path;
        const text = document.createElement("span");
        text.className = "notes-paper-picker-item-text";
        const name = document.createElement("strong");
        name.textContent = item.category.name || item.path;
        const meta = document.createElement("small");
        meta.textContent = `${item.count} 篇论文`;
        text.append(name, meta);
        const arrow = document.createElement("span");
        arrow.className = "notes-paper-picker-arrow";
        arrow.textContent = "›";
        button.append(text, arrow);
        row.append(disclosure, button);
        list.appendChild(row);
      } else {
        button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h10l4 4v14H5z"></path><path d="M14 3v5h5"></path></svg>';
        const text = document.createElement("span");
        text.className = "notes-paper-picker-item-text";
        const name = document.createElement("strong");
        name.textContent = item.paper.title || "未命名论文";
        const meta = document.createElement("small");
        meta.textContent = paperAuthors(item.paper).join("、") || item.paper.categoryName || "论文";
        text.append(name, meta);
        button.appendChild(text);
        list.appendChild(button);
      }
      button.addEventListener("mouseenter", () => {
        paperPickerActiveIndex = index;
        updatePaperPickerActive(items);
      });
      button.addEventListener("click", () => choosePaperPickerItem(item));
    });
    updatePaperPickerActive(items);
  }

  function positionPaperPicker(anchorRect) {
    if (!paperPicker) return;
    const rect = paperPicker.getBoundingClientRect();
    const margin = 10;
    const anchor = anchorRect || { left: window.innerWidth / 2, bottom: window.innerHeight / 2, top: window.innerHeight / 2 };
    let left = Math.min(anchor.left, window.innerWidth - rect.width - margin);
    let top = anchor.bottom + 8;
    if (top + rect.height > window.innerHeight - margin) top = anchor.top - rect.height - 8;
    paperPicker.style.left = `${Math.max(margin, left)}px`;
    paperPicker.style.top = `${Math.max(margin, top)}px`;
  }

  function closePaperPicker(restoreFocus = true) {
    paperPicker?.remove();
    paperPicker = null;
    paperPickerCategory = null;
    paperPickerActiveIndex = 0;
    if (restoreFocus) restoreInsertionBookmark(paperPickerBookmark);
    paperPickerBookmark = null;
  }

  async function loadPaperPickerTree() {
    if (paperPickerTree) return paperPickerTree;
    if (!paperPickerRequest) {
      paperPickerRequest = (async () => {
        const response = await apiFetch("/api/library");
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "文献库加载失败");
        paperPickerTree = data.tree;
        return paperPickerTree;
      })().finally(() => { paperPickerRequest = null; });
    }
    return paperPickerRequest;
  }

  async function openPaperPicker(anchor, bookmark = captureInsertionBookmark()) {
    closePaperPicker(false);
    closePaperLinkPopover();
    paperPickerBookmark = bookmark;
    const picker = document.createElement("section");
    picker.className = "notes-paper-picker";
    picker.setAttribute("role", "dialog");
    picker.setAttribute("aria-label", "插入其它论文");
    picker.innerHTML = `
      <header class="notes-paper-picker-header">
        <button class="notes-paper-picker-back" type="button" aria-label="返回目录" title="返回目录" hidden>‹</button>
        <strong class="notes-paper-picker-title">选择目录</strong>
      </header>
      <label class="notes-paper-picker-search-wrap">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg>
        <input class="notes-paper-picker-search" type="search" placeholder="搜索论文、作者或目录…" autocomplete="off" />
      </label>
      <div class="notes-paper-picker-list" role="listbox"><p class="notes-paper-picker-empty">正在加载文献库…</p></div>`;
    picker.addEventListener("click", (event) => event.stopPropagation());
    const input = picker.querySelector(".notes-paper-picker-search");
    input.addEventListener("input", () => {
      paperPickerActiveIndex = 0;
      renderPaperPicker();
    });
    input.addEventListener("keydown", (event) => {
      const items = paperPickerItems();
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        paperPickerActiveIndex = (paperPickerActiveIndex + direction + items.length) % Math.max(items.length, 1);
        updatePaperPickerActive(items);
      } else if (event.key === "ArrowRight" && items[paperPickerActiveIndex]?.type === "category") {
        const item = items[paperPickerActiveIndex];
        if (item.hasChildren && !item.expanded) {
          event.preventDefault();
          togglePaperPickerCategory(item);
        }
      } else if (event.key === "ArrowLeft" && items[paperPickerActiveIndex]?.type === "category") {
        const item = items[paperPickerActiveIndex];
        if (item.hasChildren && item.expanded) {
          event.preventDefault();
          togglePaperPickerCategory(item);
        }
      } else if (event.key === "Enter" && items[paperPickerActiveIndex]) {
        event.preventDefault();
        choosePaperPickerItem(items[paperPickerActiveIndex]);
      } else if (event.key === "Escape") {
        event.preventDefault();
        closePaperPicker();
      }
    });
    picker.querySelector(".notes-paper-picker-back").addEventListener("click", () => {
      paperPickerCategory = null;
      paperPickerActiveIndex = 0;
      renderPaperPicker();
    });
    document.body.appendChild(picker);
    paperPicker = picker;
    positionPaperPicker(anchor?.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor);
    input.focus();
    try {
      await loadPaperPickerTree();
      if (paperPicker === picker) renderPaperPicker();
    } catch (error) {
      if (paperPicker === picker) {
        const empty = document.createElement("p");
        empty.className = "notes-paper-picker-empty error";
        empty.textContent = String(error.message || "文献库加载失败");
        picker.querySelector(".notes-paper-picker-list").replaceChildren(empty);
      }
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

  function insertPaperReference(paper, clientX, clientY, bookmark = null) {
    const id = String(paper?.id || "").trim();
    const label = escapeMarkdownLinkText(formatPaperCardLabel(paper) || id);
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || !label) return;
    const markdown = `[${label}](hash:${id})`;

    if (editorReady && vditor) {
      if (!restoreInsertionBookmark(bookmark)) {
        vditor.focus();
        if (Number.isFinite(clientX) && Number.isFinite(clientY)) positionCaretAtPoint(clientX, clientY);
      }
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

  const externalImports = new Map();

  async function importExternalPaper(url, onProgress) {
    const read = async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || data.error || "文献导入失败");
      if (!data.job?.jobId) throw new Error("导入接口未返回任务信息");
      return data.job;
    };
    let job = await read(await apiFetch("/api/library/import/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    }));
    const stages = {
      queued: "等待导入…", resolving_metadata: "正在获取文献信息…",
      downloading: "正在下载 PDF…", validating_pdf: "正在校验 PDF…",
      deduplicating: "正在检查重复文献…", writing_library: "正在写入文献库…",
    };
    while (!["completed", "failed", "cancelled"].includes(job.state)) {
      onProgress(stages[job.stage] || "正在导入…");
      await new Promise((resolve) => window.setTimeout(resolve, 650));
      job = await read(await apiFetch(`/api/library/import/status?${new URLSearchParams({ jobId: job.jobId })}`));
    }
    if (job.state !== "completed" || !job.paperId) {
      throw new Error(job.error || (job.state === "cancelled" ? "导入已取消" : "文献导入失败"));
    }
    window.dispatchEvent(new CustomEvent("paper-lantern-library-updated"));
    return job;
  }

  const linkPreviewCache = new Map();

  function showExternalLinkPopover(anchor, link) {
    closePaperLinkPopover();
    const popover = document.createElement("section");
    popover.className = "notes-paper-link-popover notes-external-link-popover";
    popover.setAttribute("role", "dialog");
    popover.setAttribute("aria-label", "外部链接选项");
    const header = document.createElement("header");
    const title = document.createElement("strong");
    title.textContent = new URL(link.url).hostname;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "notes-external-link-close";
    close.setAttribute("aria-label", "关闭外部链接选项");
    close.textContent = "×";
    close.addEventListener("click", closePaperLinkPopover);
    header.append(title, close);
    const address = document.createElement("a");
    address.className = "notes-external-link-address";
    const siteIcon = document.createElement("span");
    siteIcon.className = "notes-external-link-site-icon";
    siteIcon.setAttribute("aria-hidden", "true");
    siteIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></svg>';
    const addressText = document.createElement("span");
    addressText.className = "notes-external-link-url";
    addressText.textContent = link.url;
    address.append(siteIcon, addressText);
    const loadSiteIcon = (url, fallback = "") => {
      const image = document.createElement("img");
      image.alt = "";
      image.referrerPolicy = "no-referrer";
      image.addEventListener("load", () => {
        if (paperLinkPopover === popover) siteIcon.replaceChildren(image);
      });
      image.addEventListener("error", () => {
        if (fallback && fallback !== url && paperLinkPopover === popover) loadSiteIcon(fallback);
      });
      image.src = url;
    };
    address.href = link.url;
    address.target = "_blank";
    address.rel = "noopener noreferrer";
    const cover = document.createElement("div");
    cover.className = "notes-external-link-cover";
    const badge = document.createElement("span");
    badge.textContent = link.importable ? "PAPER" : "LINK";
    const coverLabel = document.createElement("span");
    coverLabel.textContent = new URL(link.url).hostname.replace(/^www\./, "");
    cover.append(badge, coverLabel);
    cover.setAttribute("aria-hidden", "true");
    const content = document.createElement("div");
    content.className = "notes-external-link-content";
    const description = document.createElement("p");
    description.className = "notes-external-link-description";
    description.textContent = link.importable ? "学术文献 · 支持一键导入文献库" : new URL(link.url).hostname;
    const actions = document.createElement("div");
    actions.className = "notes-external-link-actions";
    const open = document.createElement("a");
    open.className = "notes-external-link-action";
    open.textContent = "打开网页";
    open.href = link.url;
    open.target = "_blank";
    open.rel = "noopener noreferrer";
    actions.append(open);
    const status = document.createElement("p");
    status.className = "notes-paper-link-summary";
    status.setAttribute("role", "status");
    if (link.importable) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "notes-external-link-action notes-external-link-import";
      button.textContent = "一键导入";
      button.addEventListener("click", async () => {
        button.disabled = true;
        status.classList.remove("error");
        status.textContent = "正在启动导入…";
        try {
          if (!externalImports.has(link.url)) {
            const request = importExternalPaper(link.url, (message) => { status.textContent = message; });
            externalImports.set(link.url, request);
            request.catch(() => externalImports.delete(link.url));
          }
          const job = await externalImports.get(link.url);
          status.textContent = job.existingItem ? "该文献已在文献库中。" : "已导入文献库。";
          button.hidden = true;
          const reader = document.createElement("a");
          reader.className = "notes-external-link-action notes-external-link-import";
          reader.textContent = "打开文献";
          reader.href = `./reader.html?${new URLSearchParams({ id: job.paperId })}`;
          reader.target = "_blank";
          reader.rel = "noopener noreferrer";
          actions.append(reader);
        } catch (error) {
          status.textContent = error.message || "导入失败，请重试";
          status.classList.add("error");
          button.disabled = false;
        }
        if (popover.isConnected) positionPaperLinkPopover(anchor, popover);
      });
      actions.append(button);
    }
    content.append(address, header, description, status, actions);
    popover.append(cover, content);
    popover.addEventListener("click", (event) => event.stopPropagation());
    document.body.appendChild(popover);
    paperLinkPopover = popover;
    positionPaperLinkPopover(anchor, popover);
    const defaultIcon = new URL("/favicon.ico", link.url).href;
    loadSiteIcon(defaultIcon);
    if (!linkPreviewCache.has(link.url)) {
      const request = apiFetch("/api/link-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: link.url }),
      }).then(async (response) => {
        if (!response.ok) throw new Error("Preview unavailable");
        return (await response.json()).preview || {};
      });
      linkPreviewCache.set(link.url, request);
      request.catch(() => linkPreviewCache.delete(link.url));
    }
    linkPreviewCache.get(link.url).then((preview) => {
      if (paperLinkPopover !== popover) return;
      if (preview.title) title.textContent = preview.title;
      if (preview.description) description.textContent = preview.description;
      if (preview.icon && getExternalNoteLink(preview.icon)) loadSiteIcon(preview.icon, defaultIcon);
      if (preview.image && getExternalNoteLink(preview.image)) {
        const image = document.createElement("img");
        image.alt = "";
        image.referrerPolicy = "no-referrer";
        image.addEventListener("load", () => {
          if (paperLinkPopover === popover) cover.replaceChildren(image);
        });
        image.src = preview.image;
      }
      positionPaperLinkPopover(anchor, popover);
    }).catch(() => {});
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
        toolbar: NOTES_TOOLBAR.map((item) => item === "paper-reference" ? {
          name: "paper-reference",
          tip: "插入其它论文 <@>",
          tipPosition: "n",
          icon: PAPER_REFERENCE_ICON,
          click: (event) => {
            event.stopPropagation();
            openPaperPicker(event.currentTarget, captureInsertionBookmark());
          },
        } : item),
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
    closePaperPicker();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setExportMenuOpen(false);
      closePaperLinkPopover();
      closePaperPicker();
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
      ? event.target.closest('a[href], .vditor-ir__node[data-type="a"]')
      : null;
    if (!anchor || !editorHost.contains(anchor)) return;
    const destination = anchor.matches("a")
      ? anchor.getAttribute("href")
      : anchor.querySelector(".vditor-ir__marker--link")?.textContent;
    const externalLink = getExternalNoteLink(destination);
    if (externalLink) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showExternalLinkPopover(anchor, externalLink);
      return;
    }
    if (!String(destination || "").startsWith("hash:")) return;
    const id = String(destination).slice(5).trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) return;
    event.preventDefault();
    event.stopPropagation();
    showPaperLinkPopover(anchor, id);
  }, true);
  editorHost?.addEventListener("keydown", (event) => {
    if (event.key === "@" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing) {
      const editable = getActiveEditable();
      if (editable && (event.target === editable || editable.contains?.(event.target))) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const bookmark = captureInsertionBookmark();
        let anchor = null;
        if (editable instanceof HTMLTextAreaElement) {
          const rect = editable.getBoundingClientRect();
          anchor = { left: rect.left + 24, top: rect.top + 24, bottom: rect.top + 24 };
        } else {
          const rangeRect = bookmark?.range?.getBoundingClientRect();
          anchor = rangeRect?.width || rangeRect?.height ? rangeRect : editable.getBoundingClientRect();
        }
        openPaperPicker(anchor, bookmark);
      }
    } else if (event.altKey && event.ctrlKey && event.key === "7") {
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
