import { formatPaperCardLabel } from "./notes_panel.js";
import { getCategoryIds, collectUniquePapers, categorySearchText, showCategoryManager } from "./category_manager.js";
import { RECENT_PAPERS_KEY, getPaperViewedAt, getRecentPaperRecords, getRecentPapers } from "./recent_papers.js";

const ALL_ID = "__library";
const RECENT_ID = "__recent";
const TODO_ID = "__todo";
const UNCATEGORIZED_ID = "uncategorized";
const PAPER_DRAG_TYPE = "application/x-paper-lantern-paper";

const icons = {
  library: '<svg class="reader-category-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>',
  folder: '<svg class="reader-category-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>',
  recent: '<svg class="reader-category-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path></svg>',
  todo: '<svg class="reader-category-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"></circle><path d="M12 8v8M8 12h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>',
  bookmark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" fill="none" stroke="currentColor" stroke-width="2"></path><path d="M12 8v6M9 11h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>',
  bookmarked: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" fill="currentColor" stroke="currentColor" stroke-width="2"></path><path d="m9 11 2 2 4-5" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
  paperType: '<svg class="reader-paper-type-icon paper-type-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h8l4 4v16H6z"></path><path d="M14 2v5h5"></path><path d="M9 12h6M9 16h6"></path></svg>',
  noteType: '<svg class="reader-paper-type-icon note-type-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>',
};

export function initLibrarySidebar({
  shell,
  getCurrentItem,
  setCurrentItem = () => {},
  apiFetch,
  readJsonResponse,
  setStatus = () => {},
  openUrl = (url) => window.open(url, "_blank", "noopener,noreferrer"),
  restorePinned = true,
  pinnedStorageKey = "paperLanternReaderPinned",
} = {}) {
  const el = (selector) => document.querySelector(selector);
  const rail = el("#readerLeftRail");
  const drawer = el("#readerLibraryDrawer");
  const logo = el("#openLibraryDrawerButton");
  const pin = el("#readerPinButton");
  const categoryList = el("#readerCategoryList");
  const paperList = el("#readerPaperList");
  const title = el("#readerLibraryTitle");
  const search = el("#readerSearchInput");
  const back = el("#readerLocationBackButton");
  const locationName = el("#readerLocationCurrentName");
  const locationCount = el("#readerLocationCurrentCount");
  const locationCurrent = el("#readerLocationCurrentButton");
  const sortButton = el("#readerSortButton");
  const uploadButton = el("#readerPaperUploadButton");
  const uploadInput = el("#readerPaperUploadInput");
  const uploadMenu = el("#readerUploadMenu");
  const remoteInput = el("#readerArxivUploadInput");
  const remoteButton = el("#readerArxivUploadButton");

  if (!rail || !drawer || !categoryList || !paperList) {
    return { refresh: async () => {}, render: () => {}, setCurrentItem: () => {} };
  }

  let tree = null;
  let selectedId = "";
  let query = "";
  const explicitlyCollapsed = new Set();
  let pinned = false;
  let pickerOpen = false;
  let inlineEditing = false;
  let hoverTimer = null;
  let sortKey = "uploadedAt";
  let sortDirection = "desc";
  let sortMenu = null;

  const current = () => getCurrentItem?.() || null;

  logo?.addEventListener("click", () => {
    if (drawer.classList.contains("open")) openUrl("./index.html");
    else open();
  });
  pin?.addEventListener("click", () => setPinned(!pinned));
  if (restorePinned && localStorage.getItem(pinnedStorageKey) === "1") setPinned(true);
  rail.addEventListener("pointerenter", () => {
    window.clearTimeout(hoverTimer);
    if (!pinned) open();
  });
  rail.addEventListener("pointerleave", () => {
    if (pinned) return;
    hoverTimer = window.setTimeout(() => {
      if (!document.querySelector(".library-menu") && uploadMenu?.hidden !== false && !inlineEditing) close();
    }, 220);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !pinned && !inlineEditing) close();
  });
  search?.addEventListener("input", () => {
    query = String(search.value || "").trim().toLowerCase();
    render();
  });
  back?.addEventListener("click", () => setPicker(true));
  sortButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleSortMenu();
  });
  uploadButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    open();
    uploadMenu?.hidden === false ? closeUploadMenu() : openUploadMenu();
  });
  uploadInput?.addEventListener("change", () => {
    const file = uploadInput.files?.[0];
    if (!file) return;
    closeUploadMenu();
    uploadPaper(file).finally(() => { uploadInput.value = ""; });
  });
  remoteButton?.addEventListener("click", () => {
    const source = String(remoteInput?.value || "").trim();
    if (!source) return;
    closeUploadMenu();
    uploadRemotePaper(source).finally(() => { if (remoteInput) remoteInput.value = ""; });
  });
  ["dragenter", "dragover"].forEach((type) => uploadMenu?.addEventListener(type, (event) => {
    event.preventDefault();
    uploadMenu.classList.add("drag-over");
  }));
  uploadMenu?.addEventListener("dragleave", (event) => {
    if (!uploadMenu.contains(event.relatedTarget)) uploadMenu.classList.remove("drag-over");
  });
  uploadMenu?.addEventListener("drop", (event) => {
    event.preventDefault();
    uploadMenu.classList.remove("drag-over");
    const file = [...(event.dataTransfer?.files || [])].find((entry) => entry.type === "application/pdf" || /\.pdf$/i.test(entry.name));
    if (!file) return setStatus("请拖入 PDF 文件。", true);
    closeUploadMenu();
    uploadPaper(file);
  });
  document.addEventListener("pointerdown", (event) => {
    if (uploadMenu?.hidden === false && !uploadMenu.contains(event.target) && !uploadButton?.contains(event.target)) closeUploadMenu();
    if (sortMenu && !sortMenu.contains(event.target) && !sortButton?.contains(event.target)) closeSortMenu();
    const categoryMenu = document.querySelector(".library-menu");
    if (categoryMenu && !categoryMenu.contains(event.target) && !event.target.closest?.(".reader-category-menu-button")) categoryMenu.remove();
  });
  window.addEventListener("resize", positionUploadMenu);
  window.addEventListener("storage", (event) => {
    if (event.key === RECENT_PAPERS_KEY && tree) render();
  });

  async function open() {
    drawer.classList.add("open");
    rail.classList.add("library-open");
    shell?.classList.add("library-open");
    drawer.setAttribute("aria-hidden", "false");
    logo?.classList.add("open");
    logo?.setAttribute("aria-expanded", "true");
    logo?.setAttribute("aria-label", "返回文献库");
    await refresh();
  }

  function close() {
    if (pinned) return;
    closeSortMenu();
    closeUploadMenu();
    drawer.classList.remove("open");
    rail.classList.remove("library-open");
    shell?.classList.remove("library-open");
    drawer.setAttribute("aria-hidden", "true");
    logo?.classList.remove("open");
    logo?.setAttribute("aria-expanded", "false");
    logo?.setAttribute("aria-label", "打开文献库");
  }

  function setPinned(next) {
    pinned = Boolean(next);
    if (restorePinned) localStorage.setItem(pinnedStorageKey, pinned ? "1" : "0");
    rail.classList.toggle("reader-pinned", pinned);
    shell?.classList.toggle("reader-pinned", pinned);
    pin?.setAttribute("aria-pressed", String(pinned));
    if (pinned) open();
    else close();
  }

  async function refresh() {
    const response = await apiFetch("/api/library");
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.error || "文献库加载失败。");
    tree = data.tree;
    const fresh = collectPapers(tree).find((paper) => paper.id === current()?.id);
    if (fresh) syncCurrentCategories(fresh);
    if (!selectedId && current()?.category) selectedId = current().category;
    if (selectedId && ![ALL_ID, RECENT_ID, TODO_ID].includes(selectedId) && !findCategory(tree, selectedId)) selectedId = ALL_ID;
    render();
  }

  function setCurrent(nextItem) {
    setCurrentItem(nextItem);
    if (nextItem?.category) selectedId = nextItem.category;
    render();
  }

  function syncCurrentCategories(paper) {
    if (paper?.id !== current()?.id) return;
    const fields = {};
    for (const key of ["category", "categoryName", "categoryIds", "categoryNames"]) fields[key] = paper[key];
    setCurrentItem({ ...current(), ...fields });
  }

  function holdsCurrent(node) {
    return getCategoryIds(current()).some((id) => containsCategory(node, id));
  }

  function render() {
    if (!tree || inlineEditing) return;
    const categories = flattenCategories(tree);
    categoryList.replaceChildren();
    categoryList.appendChild(specialRow(RECENT_ID, "最近", icons.recent, recentPapers().length));
    categoryList.appendChild(specialRow(TODO_ID, "待办", icons.todo, collectPapers(tree).filter((item) => item.todo).length, toggleCurrentTodo, false, isCurrentTodo() ? icons.bookmarked : icons.bookmark, isCurrentTodo() ? "移除待办" : "加入待办", isCurrentTodo()));
    const showPath = holdsCurrent(tree);
    categoryList.appendChild(specialRow(ALL_ID, "文献库", icons.library, collectPapers(tree).length, (button) => startCreate(null, button), true, icons.plus, "新建分类", false, showPath));
    if (!isCollapsedForDisplay(ALL_ID, showPath)) renderCategoryChildren(tree, 0);

    let papers;
    if (!selectedId || selectedId === ALL_ID) papers = collectPapers(tree);
    else if (selectedId === RECENT_ID) papers = recentPapers();
    else if (selectedId === TODO_ID) papers = collectPapers(tree).filter((item) => item.todo);
    else papers = collectPapers(findCategory(tree, selectedId));
    papers = sortPapers(papers);

    const isRoot = !selectedId || selectedId === ALL_ID;
    const selected = categories.find((item) => item.id === selectedId);
    const name = selectedId === RECENT_ID ? "最近" : selectedId === TODO_ID ? "待办" : isRoot ? "文献库" : selected?.name || "文献库";
    if (locationName) locationName.textContent = name;
    if (locationCount) locationCount.textContent = papers.length ? String(papers.length) : "";
    if (locationCurrent) locationCurrent.title = `${name} (${papers.length})`;
    if (title) title.textContent = "文献库";
    if (sortButton) sortButton.hidden = selectedId === RECENT_ID || !papers.length;
    if (query) papers = papers.filter((paper) => `${paper.title || ""} ${categorySearchText(paper)}`.toLowerCase().includes(query));

    paperList.replaceChildren();
    if (!papers.length) {
      const empty = document.createElement("div");
      empty.className = "reader-library-empty";
      empty.textContent = query ? "没有匹配的文献或笔记。" : "这里暂无文献或笔记。";
      paperList.appendChild(empty);
      return;
    }
    papers.forEach((paper) => paperList.appendChild(createPaperRow(paper)));
  }

  function paperAuthors(paper) {
    return Array.isArray(paper?.basicInfo?.authors)
      ? paper.basicInfo.authors.map(String).map((value) => value.trim()).filter(Boolean)
      : [];
  }

  function createPaperRow(paper) {
    const row = document.createElement("div");
    row.className = "reader-paper-item";
    row.classList.toggle("active", current()?.id === paper.id);
    row.classList.toggle("reader-note-item", paper.itemType === "note");
    row.draggable = paper.itemType !== "note";
    const authors = paperAuthors(paper);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "reader-paper-open";
    button.title = authors.length ? `${paper.title || ""}\n${authors.join("、")}` : paper.title || "";
    button.innerHTML = paper.itemType === "note" ? icons.noteType : icons.paperType;
    const text = document.createElement("span");
    text.className = "reader-paper-open-text";
    const label = document.createElement("span");
    label.className = "reader-paper-open-label";
    label.textContent = paper.title || paper.id;
    text.appendChild(label);
    if (authors.length) {
      const authorLine = document.createElement("span");
      authorLine.className = "reader-paper-open-authors";
      authorLine.textContent = authors.join("、");
      text.appendChild(authorLine);
    }
    button.appendChild(text);
    button.addEventListener("click", () => openUrl(`./${paper.itemType === "note" ? "note.html" : "reader.html"}?${new URLSearchParams({ id: paper.id })}`));
    if (paper.itemType !== "note") {
      row.addEventListener("dragstart", (event) => startPaperDrag(event, paper, row));
      row.addEventListener("dragend", () => row.classList.remove("dragging"));
    }
    const todo = document.createElement("button");
    todo.type = "button";
    todo.className = "reader-paper-todo-button";
    todo.classList.toggle("checked", Boolean(paper.todo));
    todo.setAttribute("aria-label", paper.todo ? "移除待办" : "加入待办");
    todo.title = paper.todo ? "移除待办" : "加入待办";
    todo.innerHTML = paper.todo ? icons.bookmarked : icons.bookmark;
    todo.addEventListener("click", (event) => {
      event.stopPropagation();
      setPaperTodo(paper, !paper.todo).catch((error) => setStatus(error.message || "更新待办失败。", true));
    });
    const menuButton = document.createElement("button");
    menuButton.type = "button";
    menuButton.className = "reader-paper-menu-button";
    menuButton.textContent = "⋯";
    menuButton.title = "分类操作";
    menuButton.setAttribute("aria-label", `${paper.title || "条目"} 分类操作`);
    menuButton.addEventListener("click", (event) => { event.stopPropagation(); showPaperCategoryMenu(paper, menuButton); });
    row.append(button, todo, menuButton);
    return row;
  }

  function startPaperDrag(event, paper, row) {
    if (!event.dataTransfer) return;
    const authors = Array.isArray(paper.basicInfo?.authors) ? paper.basicInfo.authors.map(String).map((v) => v.trim()).filter(Boolean) : [];
    const reference = { id: String(paper.id || ""), title: String(paper.title || ""), authors };
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(PAPER_DRAG_TYPE, JSON.stringify(reference));
    event.dataTransfer.setData("application/x-paperlantern-paper", paper.id);
    event.dataTransfer.setData("text/plain", `[${formatPaperCardLabel(reference)}](hash:${reference.id})`);
    const image = document.createElement("canvas");
    image.width = 1;
    image.height = 1;
    document.body.appendChild(image);
    event.dataTransfer.setDragImage(image, 0, 0);
    window.setTimeout(() => image.remove(), 0);
    row.classList.add("dragging");
  }

  function specialRow(id, label, icon, count, action = null, collapsible = false, actionIcon = icons.plus, actionTitle = "新建分类", actionActive = false, holdsCurrent = false) {
    const row = document.createElement("div");
    row.className = "reader-category-row reader-special-row";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "reader-category-item reader-special-item";
    button.classList.toggle("active", selectedId === id);
    button.classList.toggle("reader-category-has-children", collapsible);
    button.style.paddingLeft = "8px";
    const iconNode = document.createElement("span");
    iconNode.className = "reader-category-folder-icon";
    iconNode.innerHTML = icon;
    button.appendChild(iconNode);
    if (collapsible) {
      const toggle = document.createElement("span");
      toggle.className = "reader-category-collapse-toggle";
      toggle.setAttribute("aria-label", "展开/收起");
      toggle.textContent = isCollapsedForDisplay(id, holdsCurrent) ? "▸" : "▾";
      toggle.addEventListener("click", (event) => { event.stopPropagation(); toggleCollapsed(id); render(); });
      button.appendChild(toggle);
    }
    const labelNode = document.createElement("span");
    labelNode.className = "category-label";
    labelNode.textContent = `${label}${count ? ` (${count})` : ""}`;
    button.title = labelNode.textContent;
    button.appendChild(labelNode);
    button.addEventListener("click", () => selectCategory(id));
    row.appendChild(button);
    if (action) {
      const actionButton = document.createElement("button");
      actionButton.type = "button";
      actionButton.className = "reader-category-menu-button menu-button reader-add-category-button";
      actionButton.classList.toggle("reader-add-category-button-active", actionActive);
      actionButton.title = actionTitle;
      actionButton.setAttribute("aria-label", actionTitle);
      actionButton.innerHTML = actionIcon;
      actionButton.addEventListener("click", (event) => { event.stopPropagation(); action(actionButton); });
      row.appendChild(actionButton);
    }
    return row;
  }

  function renderCategoryChildren(node, depth) {
    (node?.folders || []).forEach((folder) => {
      categoryList.appendChild(categoryRow(folder, depth));
      if (folder.folders?.length && !isCollapsedForDisplay(folder.id, holdsCurrent(folder))) renderCategoryChildren(folder, depth + 1);
    });
  }

  function categoryRow(category, depth) {
    const row = document.createElement("div");
    row.className = "reader-category-row";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "reader-category-item";
    button.classList.toggle("active", category.id === selectedId);
    button.classList.toggle("reader-current-category-path", holdsCurrent(category));
    button.classList.toggle("reader-category-has-children", Boolean(category.folders?.length));
    button.style.paddingLeft = `${8 + (depth + 1) * 12}px`;
    const iconNode = document.createElement("span");
    iconNode.className = "reader-category-folder-icon";
    iconNode.innerHTML = icons.folder;
    button.appendChild(iconNode);
    if (category.folders?.length) {
      const toggle = document.createElement("span");
      toggle.className = "reader-category-collapse-toggle";
      toggle.setAttribute("aria-label", "展开/收起");
      toggle.textContent = isCollapsedForDisplay(category.id, holdsCurrent(category)) ? "▸" : "▾";
      toggle.addEventListener("click", (event) => { event.stopPropagation(); toggleCollapsed(category.id); render(); });
      button.appendChild(toggle);
    }
    const label = document.createElement("span");
    label.className = "category-label";
    label.textContent = `${category.name} (${collectPapers(category).length})`;
    button.title = label.textContent;
    button.appendChild(label);
    button.addEventListener("click", () => selectCategory(category.id));
    const menuButton = document.createElement("button");
    menuButton.type = "button";
    menuButton.className = "reader-category-menu-button menu-button";
    menuButton.textContent = "⋮";
    menuButton.setAttribute("aria-label", `${category.name} 分类操作`);
    menuButton.addEventListener("click", (event) => { event.stopPropagation(); showCategoryMenu(category, menuButton); });
    row.append(button, menuButton);
    if (category.id !== UNCATEGORIZED_ID) {
      row.addEventListener("dragover", (event) => {
        if (!event.dataTransfer?.types.includes(PAPER_DRAG_TYPE) && !event.dataTransfer?.types.includes("application/x-paperlantern-paper")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        row.classList.add("category-drop-target");
      });
      row.addEventListener("dragleave", () => row.classList.remove("category-drop-target"));
      row.addEventListener("drop", (event) => {
        event.preventDefault();
        row.classList.remove("category-drop-target");
        let id = event.dataTransfer.getData("application/x-paperlantern-paper");
        try { id ||= JSON.parse(event.dataTransfer.getData(PAPER_DRAG_TYPE) || "{}").id; } catch { return; }
        const paper = collectPapers(tree).find((item) => item.id === id);
        if (paper) changePaperCategories(paper, [category.id], "add_categories").catch((error) => setStatus(error.message || "加入分类失败。", true));
      });
    }
    return row;
  }

  function selectCategory(id) {
    selectedId = id;
    setPicker(false);
    render();
  }

  function setPicker(next) {
    pickerOpen = Boolean(next);
    drawer.classList.toggle("reader-show-picker", pickerOpen);
    if (!pickerOpen) search?.focus();
  }

  function showCategoryMenu(category, anchor) {
    document.querySelector(".library-menu")?.remove();
    const menu = document.createElement("div");
    menu.className = "category-menu reader-category-menu library-menu";
    const actions = [
      ["分类", !current()?.id, () => managePaperCategories(current(), anchor)],
      ["重命名", category.locked || !category.id, () => startRename(category, anchor)],
      ["新建子分类", false, () => startCreate(category, anchor)],
    ];
    actions.forEach(([label, disabled, handler]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.disabled = disabled;
      button.addEventListener("click", () => { menu.remove(); Promise.resolve(handler()).catch((error) => setStatus(error.message || "分类操作失败。", true)); });
      menu.appendChild(button);
    });
    document.body.appendChild(menu);
    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${Math.min(rect.left, window.innerWidth - 218)}px`;
    menu.style.top = `${rect.bottom + 4}px`;
  }

  function managePaperCategories(paper, anchor) {
    showCategoryManager({ tree, paper, anchor, onSave: (ids) => changePaperCategories(paper, ids, "set_categories") });
  }

  function showPaperCategoryMenu(paper, anchor) {
    document.querySelector(".library-menu")?.remove();
    const menu = document.createElement("div");
    menu.className = "paper-menu library-menu";
    const addAction = (label, handler) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", () => { menu.remove(); Promise.resolve(handler()).catch((error) => setStatus(error.message || "分类操作失败。", true)); });
      menu.append(button);
    };
    addAction("分类", () => managePaperCategories(paper, anchor));
    document.body.append(menu);
    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - menu.offsetHeight - 8))}px`;
  }

  async function changePaperCategories(paper, ids, action) {
    const response = await apiFetch("/api/library/paper", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id: paper.id, categoryIds: ids }) });
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.error || "更新分类失败。");
    tree = data.tree || tree;
    syncCurrentCategories(data.paper);
    setStatus("分类已更新。");
    render();
    return data;
  }

  function startRename(category, anchor) {
    const row = anchor.closest(".reader-category-row");
    const old = row?.querySelector(".reader-category-item");
    if (!row || !old) return;
    const input = document.createElement("input");
    input.className = "reader-category-inline-input";
    input.value = category.name;
    input.maxLength = 120;
    old.replaceWith(input);
    inlineEditing = true;
    input.focus(); input.select();
    finishInline(input, (name) => updateCategory({ action: "rename", id: category.id, name }));
  }

  function startCreate(parent, anchor) {
    const row = document.createElement("div");
    row.className = "reader-category-row reader-category-create-row";
    const input = document.createElement("input");
    input.className = "reader-category-inline-input";
    input.placeholder = "新分类名称";
    input.maxLength = 120;
    row.appendChild(input);
    const anchorRow = anchor?.closest(".reader-category-row");
    if (anchorRow) anchorRow.after(row);
    else categoryList.prepend(row);
    inlineEditing = true;
    input.focus();
    finishInline(input, (name) => updateCategory({ action: "create", parentId: parent?.id || "", name }), () => row.remove());
  }

  function finishInline(input, commit, cancel = render) {
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      inlineEditing = false;
      const value = input.value.trim();
      if (save && value) commit(value);
      else cancel();
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault();
        finish(event.key === "Enter");
      }
    });
    input.addEventListener("blur", () => finish(true));
  }

  async function updateCategory(payload) {
    try {
      const response = await apiFetch("/api/library/category", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.error || "分类操作失败。");
      tree = data.tree;
      const fresh = collectPapers(tree).find((paper) => paper.id === current()?.id);
      if (fresh) syncCurrentCategories(fresh);
      if (payload.action === "create" && data.categoryId) selectedId = data.categoryId;
      if (payload.action === "rename" && selectedId === payload.id) selectedId = data.categoryId || payload.id;
      render();
    } catch (error) {
      setStatus(error.message || "分类操作失败。", true);
      render();
    }
  }

  function isCurrentTodo() {
    return Boolean(current()?.todo || collectPapers(tree).find((item) => item.id === current()?.id)?.todo);
  }

  async function toggleCurrentTodo() {
    if (!current()?.id) return setStatus("未打开条目。", true);
    await setPaperTodo(current(), !isCurrentTodo());
  }

  async function setPaperTodo(paper, next) {
    const response = await apiFetch("/api/library/paper", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: paper.id, todo: next }) });
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.error || "更新待办失败。");
    paper.todo = next;
    tree = data.tree || tree;
    if (current()?.id === paper.id) setCurrentItem(data.paper || { ...current(), todo: next });
    setStatus(next ? "已加入待办。" : "已移除待办。");
    render();
  }

  function toggleSortMenu() {
    closeSortMenu();
    const menu = document.createElement("div");
    menu.className = "reader-sort-menu";
    [["title", "标题"], ["uploadedAt", "上传时间"], ["lastRead", "阅读时间"]].forEach(([key, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "reader-sort-option";
      button.classList.toggle("active", sortKey === key);
      button.innerHTML = `<span>${label}</span>${sortKey === key ? `<span class="reader-sort-arrow">${sortDirection === "asc" ? "↑" : "↓"}</span>` : ""}`;
      button.addEventListener("click", () => {
        if (sortKey === key) sortDirection = sortDirection === "asc" ? "desc" : "asc";
        else { sortKey = key; sortDirection = key === "title" ? "asc" : "desc"; }
        closeSortMenu(); render();
      });
      menu.appendChild(button);
    });
    document.body.appendChild(menu);
    sortMenu = menu;
    const rect = sortButton.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(rect.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${rect.bottom + 6}px`;
  }

  function closeSortMenu() { sortMenu?.remove(); sortMenu = null; }
  function openUploadMenu() { if (!uploadMenu) return; uploadMenu.hidden = false; uploadButton?.setAttribute("aria-expanded", "true"); positionUploadMenu(); }
  function closeUploadMenu() { if (!uploadMenu) return; uploadMenu.hidden = true; uploadMenu.classList.remove("drag-over"); uploadButton?.setAttribute("aria-expanded", "false"); }
  function positionUploadMenu() {
    if (!uploadMenu || uploadMenu.hidden || !uploadButton) return;
    const rect = uploadButton.getBoundingClientRect();
    uploadMenu.style.left = `${Math.max(8, Math.min(rect.right + 10, window.innerWidth - uploadMenu.offsetWidth - 8))}px`;
    uploadMenu.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - uploadMenu.offsetHeight - 8))}px`;
  }

  async function uploadPaper(file) {
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") return setStatus("请选择 PDF 文件。", true);
    const form = new FormData();
    form.append("pdf", file); form.append("title", file.name.replace(/\.pdf$/i, "")); form.append("categoryIds", JSON.stringify([uploadCategory()]));
    uploadButton.disabled = true;
    try {
      const response = await apiFetch("/api/library/upload", { method: "POST", body: form });
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.error || "上传失败。");
      tree = data.tree || tree; render();
      openUrl(`./reader.html?${new URLSearchParams({ id: data.paper.id })}`);
    } catch (error) { setStatus(error.message || "上传失败。", true); }
    finally { uploadButton.disabled = false; }
  }

  async function uploadRemotePaper(source) {
    remoteButton.disabled = true;
    try {
      const response = await apiFetch("/api/library/remote-pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pdfUrl: source, categoryIds: [uploadCategory()] }) });
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.detail || data.error || "导入失败。");
      let paperId = data.paper?.id;
      if (!paperId) {
        let job = data.job;
        if (!job?.jobId) throw new Error("导入接口未返回任务信息。");
        const jobId = job.jobId;
        while (!["completed", "failed", "cancelled"].includes(job.state)) {
          setStatus("正在导入论文…");
          await new Promise((resolve) => window.setTimeout(resolve, 650));
          const statusResponse = await apiFetch(`/api/library/import/status?${new URLSearchParams({ jobId })}`);
          const status = await readJsonResponse(statusResponse);
          if (!statusResponse.ok) throw new Error(status.error || "无法读取导入进度。");
          if (status.job?.jobId !== jobId) throw new Error("导入任务信息无效。");
          job = status.job;
        }
        if (job.state !== "completed") throw new Error(job.error || (job.state === "cancelled" ? "导入已取消。" : "导入失败。"));
        paperId = job.paperId;
      }
      if (!paperId) throw new Error("导入完成，但未返回论文编号。");
      await refresh();
      setStatus("导入完成。");
      openUrl(`./reader.html?${new URLSearchParams({ id: paperId })}`);
    } catch (error) { setStatus(error.message || "导入失败。", true); }
    finally { remoteButton.disabled = false; }
  }

  function uploadCategory() { return selectedId && ![ALL_ID, RECENT_ID, TODO_ID].includes(selectedId) ? selectedId : current()?.category || UNCATEGORIZED_ID; }
  function collapseKey(id) { return `paperLanternReaderCollapsed:${id || "__root"}`; }
  function isCollapsed(id) { return localStorage.getItem(collapseKey(id)) === "true"; }
  function toggleCollapsed(id) {
    const key = collapseKey(id);
    const next = localStorage.getItem(key) !== "true";
    localStorage.setItem(key, String(next));
    if (next) explicitlyCollapsed.add(key);
    else explicitlyCollapsed.delete(key);
  }
  // 当前条目所在的分类路径会自动展开；用户手动收起后，以手动结果为准。
  function isCollapsedForDisplay(id, holdsCurrent = false) {
    return isCollapsed(id) && (!holdsCurrent || explicitlyCollapsed.has(collapseKey(id)));
  }
  function recentPapers() { return getRecentPapers(collectPapers(tree)); }
  function sortPapers(items) {
    const key = selectedId === RECENT_ID ? "lastRead" : sortKey;
    const direction = sortDirection === "asc" ? 1 : -1;
    const recentRecords = key === "lastRead" ? getRecentPaperRecords() : [];
    return [...(items || [])].sort((a, b) => {
      if (key === "title") return direction * String(a.title || "").localeCompare(String(b.title || ""), undefined, { numeric: true, sensitivity: "base" });
      const av = key === "lastRead" ? getPaperViewedAt(a, recentRecords) : a.uploadedAt;
      const bv = key === "lastRead" ? getPaperViewedAt(b, recentRecords) : b.uploadedAt;
      return direction * ((new Date(av || 0).getTime() || 0) - (new Date(bv || 0).getTime() || 0));
    });
  }

  window.addEventListener("paper-lantern-library-updated", () => {
    refresh().catch((error) => setStatus(error.message || "\u6587\u732e\u5e93\u5237\u65b0\u5931\u8d25\u3002", true));
  });
  window.addEventListener("focus", () => refresh().catch((error) => setStatus(error.message || "文献库刷新失败。", true)));
  refresh().catch((error) => { console.error("Failed to load library sidebar.", error); setStatus(error.message || "文献库加载失败。", true); });
  return { refresh, render, open, close, setCurrentItem: setCurrent };
}

function collectPapers(node) { return collectUniquePapers(node); }
function findCategory(node, id) { if (!node) return null; if (node.id === id) return node; for (const child of node.folders || []) { const found = findCategory(child, id); if (found) return found; } return null; }
function containsCategory(node, id) { return Boolean(node && id && (node.id === id || (node.folders || []).some((child) => containsCategory(child, id)))); }
function flattenCategories(node, depth = 0, include = false) {
  if (!node) return [];
  const own = include ? [{ id: node.id || "", name: node.name || "文献库", depth }] : [];
  return [...own, ...(node.folders || []).flatMap((child) => flattenCategories(child, include ? depth + 1 : depth, true))];
}
