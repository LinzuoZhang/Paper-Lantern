const libraryRoot = document.querySelector("#libraryRoot");
const libraryStatus = document.querySelector("#libraryStatus");
const categoryTree = document.querySelector("#categoryTree");
const categoryTopRows = document.querySelector("#categoryTopRows");
const categoryMainRows = document.querySelector("#categoryMainRows");
const paperList = document.querySelector("#paperList");
const paperInfoPanel = document.querySelector("#paperInfoPanel");
const currentCategoryName = document.querySelector("#currentCategoryName");
const librarySearchInput = document.querySelector("#librarySearchInput");
const uploadForm = document.querySelector("#uploadForm");
const libraryPdfInput = document.querySelector("#libraryPdfInput");
const uploadMenuButton = document.querySelector("#uploadMenuButton");
const uploadMenu = document.querySelector("#uploadMenu");
const arxivUploadInput = document.querySelector("#arxivUploadInput");
const arxivUploadButton = document.querySelector("#arxivUploadButton");
const cloudSyncStatus = document.querySelector("#cloudSyncStatus");
const settingsButton = document.querySelector("#settingsButton");
const cloudSyncButton = document.querySelector("#cloudSyncButton");
const cloudConfigOverlay = document.querySelector("#cloudConfigOverlay");
const cloudConfigForm = document.querySelector("#cloudConfigForm");
const cloudConfigCloseButton = document.querySelector("#cloudConfigCloseButton");
const libCitationOverlay = document.querySelector("#libCitationOverlay");
const libCitationOverlayTitle = document.querySelector("#libCitationOverlayTitle");
const libCitationOverlayMeta = document.querySelector("#libCitationOverlayMeta");
const libCitationOverlayCloseButton = document.querySelector("#libCitationOverlayCloseButton");
const libCitationFormatSelect = document.querySelector("#libCitationFormatSelect");
const libCitationCopyButton = document.querySelector("#libCitationCopyButton");
const libCitationOutput = document.querySelector("#libCitationOutput");
const aiBaseUrlInput = document.querySelector("#aiBaseUrlInput");
const aiModelInput = document.querySelector("#aiModelInput");
const aiApiKeyInput = document.querySelector("#aiApiKeyInput");
const aiApiTestButton = document.querySelector("#aiApiTestButton");
const aiApiTestStatus = document.querySelector("#aiApiTestStatus");
const cloudProviderSelect = document.querySelector("#cloudProviderSelect");
const cloudLocalDirInput = document.querySelector("#cloudLocalDirInput");
const cloudWebdavUrlInput = document.querySelector("#cloudWebdavUrlInput");
const cloudUsernameInput = document.querySelector("#cloudUsernameInput");
const cloudPasswordInput = document.querySelector("#cloudPasswordInput");
const cloudAutoPushInput = document.querySelector("#cloudAutoPushInput");

const RECENT_CATEGORY_ID = "__recent";
const TODO_CATEGORY_ID = "__todo";
const LEGACY_RECENT_PAPERS_KEY = "openMoonlightRecentPapers";
const RECENT_PAPERS_KEY = "paperLanternRecentPapers";
const UNCATEGORIZED_LABEL = "Uncategorized";

const recentCategoryIconSvg =
  '<svg class="category-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path></svg>';
const libraryCategoryIconSvg =
  '<svg class="category-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>';
const folderCategoryIconSvg =
  '<svg class="category-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>';
const paperReadUncheckedSvg =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M4 22v-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>';
const paperReadCheckedSvg =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M4 22v-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>';
const paperTodoUncheckedSvg =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M12 7v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path><path d="M9 10h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>';
const paperTodoCheckedSvg =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="m9 12 2 2 4-4" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
const todoCategoryIconSvg =
  '<svg class="category-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path></svg>';
const plusCircleSvg =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"></circle><path d="M12 8v8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path><path d="M8 12h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>';

let libraryTree = null;
let selectedCategoryId = RECENT_CATEGORY_ID;
let apiBaseUrl = "";
let paperSort = { key: "uploadedAt", dir: "desc" };

function sortPapers(papers) {
  const { key, dir } = paperSort;
  const sign = dir === "asc" ? 1 : -1;
  const list = [...papers];
  list.sort((a, b) => {
    if (key === "title") {
      const va = String(a.title || "").toLowerCase();
      const vb = String(b.title || "").toLowerCase();
      return sign * va.localeCompare(vb);
    }
    const rawA = key === "lastRead" ? getPaperViewedAt(a.id) : a.uploadedAt;
    const rawB = key === "lastRead" ? getPaperViewedAt(b.id) : b.uploadedAt;
    const ta = rawA ? new Date(rawA).getTime() : NaN;
    const tb = rawB ? new Date(rawB).getTime() : NaN;
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
    if (Number.isNaN(ta)) return 1;
    if (Number.isNaN(tb)) return -1;
    return sign * (ta - tb);
  });
  return list;
}
let searchQuery = "";
let arxivDownloadOverlayTimer = null;
let libCitationFormats = null;
let libCitationFormat = "gbt7714";

loadLibrary();
initLibraryCitationOverlay();
loadCloudSyncStatus();
loadSettings();
migrateLegacyRecentPapers();
if (new URLSearchParams(window.location.search).get("settings") === "1") {
  openCloudConfig();
}

libraryPdfInput.addEventListener("change", async () => {
  const file = libraryPdfInput.files && libraryPdfInput.files[0];
  if (!file) return;
  closeUploadMenu();
  await handlePdfUpload(file);
  uploadForm.reset();
});

uploadMenuButton.addEventListener("click", () => {
  uploadMenu.hidden ? openUploadMenu() : closeUploadMenu();
});

arxivUploadButton.addEventListener("click", async () => {
  const source = arxivUploadInput.value;
  if (!source?.trim()) return;
  closeUploadMenu();
  await uploadRemotePdf(source.trim());
  arxivUploadInput.value = "";
});

librarySearchInput.addEventListener("input", () => {
  searchQuery = librarySearchInput.value.trim().toLowerCase();
  renderLibrary();
});

settingsButton.addEventListener("click", () => {
  openCloudConfig();
});

cloudSyncButton.addEventListener("click", async () => {
  await runCloudSync();
});

cloudConfigCloseButton.addEventListener("click", closeCloudConfig);
cloudConfigOverlay.addEventListener("pointerdown", (event) => {
  if (event.target === cloudConfigOverlay) closeCloudConfig();
});
cloudConfigForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
});
wireCloudSettingsAutoSave();
aiApiTestButton.addEventListener("click", async () => {
  await testAiApi();
});

uploadForm.addEventListener("dragenter", handleUploadDrag);
uploadForm.addEventListener("dragover", handleUploadDrag);
uploadForm.addEventListener("dragleave", (event) => {
  if (!uploadForm.contains(event.relatedTarget)) uploadForm.classList.remove("drag-over");
});
uploadForm.addEventListener("drop", async (event) => {
  event.preventDefault();
  uploadForm.classList.remove("drag-over");
  const file = Array.from(event.dataTransfer?.files || []).find((item) => item.type === "application/pdf" || /\.pdf$/i.test(item.name));
  if (!file) {
    setLibraryStatus("Please drop a PDF file.", true);
    return;
  }
  await handlePdfUpload(file);
  uploadForm.reset();
});

document.addEventListener("pointerdown", (event) => {
  if (!uploadForm.contains(event.target)) closeUploadMenu();
  if (!event.target.closest(".library-menu") && !event.target.closest(".menu-button")) {
    document.querySelectorAll(".category-menu, .paper-menu").forEach((menu) => menu.remove());
  }
});

function openUploadMenu() {
  uploadMenu.hidden = false;
  uploadMenuButton.setAttribute("aria-expanded", "true");
  document.body.classList.add("upload-menu-open");
}

function closeUploadMenu() {
  uploadMenu.hidden = true;
  uploadMenuButton.setAttribute("aria-expanded", "false");
  document.body.classList.remove("upload-menu-open");
}

function handleUploadDrag(event) {
  event.preventDefault();
  if (Array.from(event.dataTransfer?.items || []).some((item) => item.kind === "file")) {
    uploadForm.classList.add("drag-over");
  }
}

async function handlePdfUpload(file) {
  await uploadPdfToLibrary(file, file.name.replace(/\.pdf$/i, ""), getActiveUploadCategory());
}

async function uploadPdfToLibrary(file, title, category) {
  setLibraryStatus("Saving PDF...");
  try {
    const formData = new FormData();
    formData.append("pdf", file);
    formData.append("title", title || file.name.replace(/\.pdf$/i, ""));
    formData.append("category", category || UNCATEGORIZED_LABEL);
    const response = await apiFetch("/api/library/upload", { method: "POST", body: formData });
    const data = await readJsonResponse(response);
    if (!response.ok) {
      setLibraryStatus(data.error || "Upload failed.", true);
      return;
    }
    reportSyncResult(data.sync);
    openPaperReader(data.paper.id, true);
  } catch (error) {
    console.error(error);
    setLibraryStatus(error.message || "Upload failed.", true);
  }
}

async function uploadRemotePdf(source) {
  setLibraryStatus("Downloading PDF...");
  showArxivDownloadOverlay("Downloading PDF...", source);
  arxivUploadButton.disabled = true;
  try {
    const response = await apiFetch("/api/library/remote-pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdfUrl: source, category: getActiveUploadCategory() }),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) {
      setLibraryStatus(data.detail || data.error || "PDF import failed.", true);
      showArxivDownloadOverlay(data.detail || data.error || "PDF import failed.", source, true);
      return;
    }
    reportSyncResult(data.sync);
    showArxivDownloadOverlay("Opening paper...", source);
    openPaperReader(data.paper.id, true);
  } catch (error) {
    console.error(error);
    setLibraryStatus(error.message || "PDF import failed.", true);
    showArxivDownloadOverlay(error.message || "PDF import failed.", source, true);
  } finally {
    arxivUploadButton.disabled = false;
  }
}

function showArxivDownloadOverlay(message, arxivId = "", isError = false) {
  window.clearTimeout(arxivDownloadOverlayTimer);
  let overlay = document.querySelector("#arxivDownloadOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "arxivDownloadOverlay";
    overlay.className = "arxiv-download-overlay";
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "polite");
    overlay.innerHTML = `
      <section class="arxiv-download-card">
        <div class="arxiv-download-spinner" aria-hidden="true"></div>
        <div>
          <strong class="arxiv-download-title"></strong>
          <p class="arxiv-download-detail"></p>
        </div>
      </section>
    `;
    document.body.appendChild(overlay);
  }

  overlay.classList.toggle("error", isError);
  overlay.querySelector(".arxiv-download-title").textContent = message;
  overlay.querySelector(".arxiv-download-detail").textContent = arxivId || "";
  if (isError) {
    arxivDownloadOverlayTimer = window.setTimeout(hideArxivDownloadOverlay, 2600);
  }
}

function hideArxivDownloadOverlay() {
  window.clearTimeout(arxivDownloadOverlayTimer);
  document.querySelector("#arxivDownloadOverlay")?.remove();
}

function getActiveUploadCategory() {
  return selectedCategoryId && selectedCategoryId !== RECENT_CATEGORY_ID ? selectedCategoryId : UNCATEGORIZED_LABEL;
}

function openPaperReader(paperId, analyze = false) {
  recordPaperViewed(paperId);
  const params = new URLSearchParams({ id: paperId });
  if (analyze) params.set("analyze", "1");
  window.location.href = `./reader.html?${params.toString()}`;
}

async function loadLibrary(focusPaperId = "") {
  try {
    const response = await apiFetch("/api/library");
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.error || "Failed to load library.");
    libraryTree = data.tree;
    libraryRoot.textContent = `Storage: ${data.root}`;
    if (focusPaperId) selectedCategoryId = findPaperCategory(libraryTree, focusPaperId) || selectedCategoryId;
    renderLibrary();
    setLibraryStatus("");
    reportSyncResult(data.sync);
  } catch (error) {
    console.error(error);
    setLibraryStatus(error.message || "Failed to load library.", true);
  }
}

function renderLibrary() {
  // The search bar is a static child of the tree, so only clear the dynamic
  // rows — this keeps the search input mounted and focused while typing.
  categoryTopRows.innerHTML = "";
  categoryMainRows.innerHTML = "";
  paperList.innerHTML = "";
  hidePaperInfoPanel();
  const categories = flattenCategories(libraryTree);
  renderRecentCategory();
  renderTodoCategory();
  renderCategoryNode(libraryTree, 0);

  const allPapers = collectPapers(libraryTree);
  let papers = [];
  if (selectedCategoryId === RECENT_CATEGORY_ID) {
    currentCategoryName.textContent = "最近";
    papers = getRecentPapers(allPapers);
  } else if (selectedCategoryId === TODO_CATEGORY_ID) {
    currentCategoryName.textContent = "待办";
    papers = allPapers.filter((paper) => paper.todo);
  } else {
    const selected = categories.find((category) => category.id === selectedCategoryId) || categories[0];
    if (selected?.id) {
      currentCategoryName.textContent = selected.name;
    } else {
      currentCategoryName.innerHTML = `${libraryCategoryIconSvg}<span>文献库</span>`;
    }
    // Show the papers of the selected category and all of its subcategories.
    papers = selectedCategoryId ? collectPapers(findCategoryNode(libraryTree, selectedCategoryId) || selected) : allPapers;
  }
  renderPaperList(filterPapers(papers, searchQuery));
}

function renderCategoryNode(node, depth = 0) {
  renderCategoryRow(node, depth);
  const folders = node.folders || [];
  if (folders.length && !isCategoryCollapsed(node.id)) {
    folders.forEach((folder) => renderCategoryNode(folder, depth + 1));
  }
}

function renderCategoryRow(node, depth = 0) {
  const row = document.createElement("div");
  row.className = "category-row";
  row.style.paddingLeft = `${depth * 18}px`;

  const hasChildren = Boolean(node.folders && node.folders.length);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "category-item";
  button.classList.toggle("active", node.id === selectedCategoryId);
  button.classList.toggle("category-has-children", hasChildren);

  const icon = document.createElement("span");
  icon.className = "category-folder-icon";
  icon.innerHTML = node.id ? folderCategoryIconSvg : libraryCategoryIconSvg;
  button.appendChild(icon);

  if (hasChildren) {
    const toggle = document.createElement("span");
    toggle.className = "category-collapse-toggle";
    toggle.setAttribute("aria-label", "展开/收起");
    toggle.textContent = isCategoryCollapsed(node.id) ? "▸" : "▾";
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleCategoryCollapsed(node.id);
      renderLibrary();
    });
    button.appendChild(toggle);
  }

  const paperCount = collectPapers(node).length;
  button.appendChild(document.createTextNode(`${node.name} (${paperCount})`));
  button.addEventListener("click", () => {
    selectedCategoryId = node.id;
    renderLibrary();
  });

  if (!node.id) {
    // 文献库: a circle-plus directly creates a new top-level category.
    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "category-menu-button menu-button category-add-button";
    addButton.setAttribute("aria-label", "新建分类");
    addButton.title = "新建分类";
    addButton.innerHTML = plusCircleSvg;
    addButton.addEventListener("click", (event) => {
      event.stopPropagation();
      startInlineCategoryCreate(node, addButton);
    });
    row.append(button, addButton);
  } else {
    const menuButton = document.createElement("button");
    menuButton.type = "button";
    menuButton.className = "category-menu-button menu-button";
    menuButton.setAttribute("aria-label", `${node.name} category actions`);
    menuButton.textContent = "...";
    menuButton.addEventListener("click", (event) => {
      event.stopPropagation();
      showCategoryMenu(node, menuButton);
    });
    row.append(button, menuButton);
  }
  categoryMainRows.appendChild(row);
}

function isCategoryCollapsed(categoryId) {
  return localStorage.getItem(`paperLanternCollapsed:${categoryId || "__root"}`) === "true";
}

function toggleCategoryCollapsed(categoryId) {
  const key = `paperLanternCollapsed:${categoryId || "__root"}`;
  const next = localStorage.getItem(key) !== "true";
  localStorage.setItem(key, String(next));
  return next;
}

function renderRecentCategory() {
  const row = document.createElement("div");
  // No bottom border here so "最近" and "待办" sit together without a divider.
  row.className = "category-row category-row-special category-row-special-flat";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "category-item recent-category-item";
  button.classList.toggle("active", selectedCategoryId === RECENT_CATEGORY_ID);
  button.innerHTML = `${recentCategoryIconSvg}<span>最近 (${getRecentPaperRecords().length})</span>`;
  button.addEventListener("click", () => {
    selectedCategoryId = RECENT_CATEGORY_ID;
    renderLibrary();
  });

  row.appendChild(button);
  categoryTopRows.appendChild(row);
}

function renderTodoCategory() {
  const row = document.createElement("div");
  row.className = "category-row category-row-special";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "category-item recent-category-item";
  button.classList.toggle("active", selectedCategoryId === TODO_CATEGORY_ID);
  const count = (collectPapers(libraryTree) || []).filter((paper) => paper.todo).length;
  button.innerHTML = `${todoCategoryIconSvg}<span>待办 (${count})</span>`;
  button.addEventListener("click", () => {
    selectedCategoryId = TODO_CATEGORY_ID;
    renderLibrary();
  });

  row.appendChild(button);
  categoryTopRows.appendChild(row);
}

function renderPaperList(papers) {
  if (!papers.length) {
    const empty = document.createElement("div");
    empty.className = "library-empty";
    empty.textContent = searchQuery
      ? "No matching papers."
      : selectedCategoryId === RECENT_CATEGORY_ID
        ? "暂无最近阅读记录。"
        : selectedCategoryId === TODO_CATEGORY_ID
          ? "暂无待办论文。"
          : "No papers in this category yet.";
    paperList.appendChild(empty);
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "paper-table-wrap";
  const table = document.createElement("table");
  table.className = "paper-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  const sortableHeaders = { "论文标题": "title", "上传时间": "uploadedAt", "上次阅读": "lastRead" };
  ["论文标题", "上传时间", "上次阅读", "已读", "待办", "选项"].forEach((label) => {
    const th = document.createElement("th");
    const sortKey = sortableHeaders[label];
    if (sortKey) {
      th.classList.add("paper-sortable");
      const button = document.createElement("span");
      button.className = "paper-sort-button";
      button.textContent = paperSort.key === sortKey ? `${label} ${paperSort.dir === "asc" ? "↑" : "↓"}` : label;
      th.appendChild(button);
      // The whole header cell is clickable.
      th.addEventListener("click", () => {
        if (paperSort.key === sortKey) {
          paperSort.dir = paperSort.dir === "asc" ? "desc" : "asc";
        } else {
          paperSort.key = sortKey;
          paperSort.dir = sortKey === "title" ? "asc" : "desc";
        }
        renderLibrary();
      });
    } else {
      th.textContent = label;
    }
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  sortPapers(papers).forEach((paper) => {
    const viewedAt = paper.viewedAt || getPaperViewedAt(paper.id);
    const tr = document.createElement("tr");
    tr.className = "paper-table-row";
    tr.tabIndex = 0;
    tr.addEventListener("pointerenter", () => renderPaperInfoPanel(paper));
    tr.addEventListener("focus", () => renderPaperInfoPanel(paper));
    tr.addEventListener("keydown", (event) => {
      if (event.key === "Enter") openPaperReader(paper.id);
    });

    const titleTd = document.createElement("td");
    titleTd.className = "paper-title-cell";
    const titleButton = document.createElement("span");
    titleButton.className = "paper-title-button";
    titleButton.textContent = paper.title;
    titleButton.title = paper.title;
    titleTd.appendChild(titleButton);
    // The whole title cell is clickable.
    titleTd.addEventListener("click", () => openPaperReader(paper.id));

    const uploadTd = document.createElement("td");
    uploadTd.className = "paper-date-cell";
    uploadTd.textContent = formatUploadDate(paper.uploadedAt);

    const viewedTd = document.createElement("td");
    viewedTd.className = "paper-date-cell";
    viewedTd.textContent = formatViewedDate(viewedAt);

    const readTd = document.createElement("td");
    readTd.className = "paper-read-cell";
    const readToggle = document.createElement("button");
    readToggle.type = "button";
    readToggle.className = "paper-read-toggle";
    readToggle.classList.toggle("checked", Boolean(paper.read));
    readToggle.setAttribute("aria-label", "已读");
    readToggle.title = "已读";
    readToggle.innerHTML = paper.read ? paperReadCheckedSvg : paperReadUncheckedSvg;
    readToggle.addEventListener("click", () => updatePaperRead(paper, readToggle, !paper.read));
    readTd.appendChild(readToggle);

    const cells = [titleTd, uploadTd, viewedTd, readTd];

    const todoTd = document.createElement("td");
    todoTd.className = "paper-todo-cell";
    const todoToggle = document.createElement("button");
    todoToggle.type = "button";
    todoToggle.className = "paper-todo-toggle";
    todoToggle.classList.toggle("checked", Boolean(paper.todo));
    todoToggle.setAttribute("aria-label", "待办");
    todoToggle.title = "待办";
    todoToggle.innerHTML = paper.todo ? paperTodoCheckedSvg : paperTodoUncheckedSvg;
    todoToggle.addEventListener("click", () => updatePaperTodo(paper, todoToggle, !paper.todo));
    todoTd.appendChild(todoToggle);
    cells.push(todoTd);

    const optionsTd = document.createElement("td");
    optionsTd.className = "paper-options-cell";
    const actions = document.createElement("button");
    actions.type = "button";
    actions.className = "paper-menu-button menu-button";
    actions.setAttribute("aria-label", `${paper.title} paper actions`);
    actions.textContent = "...";
    actions.addEventListener("click", (event) => {
      event.stopPropagation();
      showPaperMenu(paper, actions);
    });
    optionsTd.appendChild(actions);
    cells.push(optionsTd);

    tr.append(...cells);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  paperList.appendChild(wrap);
  initPaperTableResize(table);
}

async function updatePaperRead(paper, toggle, read) {
  try {
    const response = await apiFetch("/api/library/paper", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: paper.id, read }),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.error || "更新已读状态失败。");
    paper.read = read;
    if (toggle) {
      toggle.classList.toggle("checked", read);
      toggle.innerHTML = read ? paperReadCheckedSvg : paperReadUncheckedSvg;
    }
  } catch (error) {
    console.error("Failed to update read marker.", error);
    renderLibrary();
  }
}

async function updatePaperTodo(paper, toggle, todo) {
  try {
    const response = await apiFetch("/api/library/paper", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: paper.id, todo }),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.error || "更新待办状态失败。");
    paper.todo = todo;
    // In the Todo view, unchecking removes the paper from the list, so refresh
    // the view to reflect that immediately.
    if (selectedCategoryId === TODO_CATEGORY_ID) {
      renderLibrary();
      return;
    }
    if (toggle) {
      toggle.classList.toggle("checked", todo);
      toggle.innerHTML = todo ? paperTodoCheckedSvg : paperTodoUncheckedSvg;
    }
  } catch (error) {
    console.error("Failed to update todo marker.", error);
    renderLibrary();
  }
}

let paperColumnWidths = [];

function initPaperTableResize(table) {
  const ths = Array.from(table.querySelectorAll("thead th"));
  const resizableCount = ths.length - 1;
  if (paperColumnWidths.length !== resizableCount) paperColumnWidths = [];
  // Columns before the last are resizable; the last (选项) is width:auto and
  // absorbs the delta so the table always fills 100%.
  const defaults = [36, 15, 17, 7, 12];
  ths.forEach((th, index) => {
    if (index === ths.length - 1) return;
    th.style.width = `${paperColumnWidths[index] || defaults[index]}%`;
    const handle = document.createElement("div");
    handle.className = "paper-col-resize-handle";
    handle.setAttribute("aria-hidden", "true");
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startWidth = th.getBoundingClientRect().width;
      const onMove = (moveEvent) => {
        const nextPx = Math.max(startWidth + (moveEvent.clientX - startX), 56);
        const tableWidth = table.getBoundingClientRect().width;
        const pct = Math.min((nextPx / tableWidth) * 100, 70);
        th.style.width = `${pct}%`;
        paperColumnWidths[index] = pct;
      };
      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.body.classList.remove("resizing-columns");
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.body.classList.add("resizing-columns");
    });
    th.appendChild(handle);
  });
}

function renderPaperInfoPanel(paper) {
  if (!paperInfoPanel || !paper) return;
  paperInfoPanel.hidden = false;
  paperInfoPanel.classList.add("open");
  paperInfoPanel.innerHTML = "";

  const header = document.createElement("header");
  header.className = "paper-info-header";
  const title = document.createElement("h2");
  title.textContent = paper.title || "Untitled paper";
  const meta = document.createElement("p");
  meta.textContent = paper.categoryName || paper.category || "Uncategorized";
  header.append(title, meta);

  const basicInfo = paper.basicInfo || {};
  const basicSection = createPaperInfoSection("Basic Info", [
    ["Authors", formatPaperInfoValue(basicInfo.authors)],
    ["Venue", formatPaperInfoValue(basicInfo.venue)],
    ["Date", formatPaperInfoValue(basicInfo.publishedDate)],
    ["Institutions", formatPaperInfoValue(basicInfo.institutions)],
  ]);

  const lines = paper.threeLineSummary || {};
  const summarySection = createPaperInfoSection("Three-Line Summary", [
    ["Challenges", formatPaperInfoValue(lines.challenges)],
    ["Method", formatPaperInfoValue(lines.method)],
    ["Conclusion", formatPaperInfoValue(lines.conclusion)],
  ]);

  const citationFormats = buildPaperCitationFormats(paper);
  const citationCard = document.createElement("button");
  citationCard.type = "button";
  citationCard.className = "paper-info-citation-card";
  const citationHeading = document.createElement("h3");
  citationHeading.textContent = "Citation";
  const citationPreview = document.createElement("p");
  citationPreview.className = "paper-info-citation-preview";
  citationPreview.textContent = citationFormats.gbt7714 || "暂无引用信息";
  const citationHint = document.createElement("span");
  citationHint.className = "paper-info-citation-hint";
  citationHint.textContent = "点击选择引用格式并复制";
  citationCard.append(citationHeading, citationPreview, citationHint);
  citationCard.addEventListener("click", () => openLibraryCitationOverlay(paper, citationFormats));

  paperInfoPanel.append(header, basicSection, summarySection, citationCard);
}

function buildPaperCitationFormats(paper) {
  const candidate = buildPaperCitationCandidate(paper);
  return {
    gbt7714: formatLibraryGbt(candidate),
    bibtex: formatLibraryBibtex(candidate),
    ris: formatLibraryRis(candidate),
    apa: formatLibraryApa(candidate),
    mla: formatLibraryMla(candidate),
    ieee: formatLibraryIeee(candidate),
  };
}

function buildPaperCitationCandidate(paper) {
  const basicInfo = paper.basicInfo || {};
  const authors = (Array.isArray(basicInfo.authors) ? basicInfo.authors : [])
    .map(normalizeLibraryAuthor)
    .filter(Boolean);
  const year = String(basicInfo.publishedDate || "").match(/(?:19|20)\d{2}/)?.[0] || "";
  return {
    doi: String(paper.doi || "").trim(),
    title: String(paper.title || "").trim(),
    venue: String(basicInfo.venue || "").trim(),
    authors,
    authorNames: authors.map((author) => author.name),
    volume: "",
    issue: "",
    page: "",
    year,
    publisher: "",
    type: basicInfo.venue ? "proceedings-article" : "misc",
  };
}

function normalizeLibraryAuthor(value) {
  const name = String(value || "").replace(/\s+/g, " ").trim();
  if (!name) return null;
  if (name.includes(",")) {
    const [family, ...givenParts] = name.split(",");
    return { name, family: family.trim(), given: givenParts.join(",").trim() };
  }
  const parts = name.split(" ");
  if (parts.length >= 2) {
    return { name, given: parts.slice(0, -1).join(" "), family: parts[parts.length - 1] };
  }
  return { name, given: "", family: name };
}

function libraryGbtAuthor(author) {
  const initials = author.given ? author.given.split(/\s+/).map((part) => part[0]?.toUpperCase()).filter(Boolean).join(" ") : "";
  return [author.family, initials].filter(Boolean).join(" ") || author.name;
}

function libraryBibAuthor(author) {
  return author.family && author.given ? `${author.family}, ${author.given}` : author.name || author.family || author.given;
}

function libraryApaAuthor(author) {
  if (!author.family) return author.name || author.given;
  const initials = author.given ? author.given.split(/\s+/).map((part) => `${part[0]?.toUpperCase()}.`).filter(Boolean).join(" ") : "";
  return [author.family, initials].filter(Boolean).join(", ");
}

function libraryMlaAuthor(author) {
  return author.family && author.given ? `${author.given} ${author.family}` : author.name || author.family || author.given;
}

function libraryIeeeAuthor(author) {
  const initials = author.given ? author.given.split(/\s+/).map((part) => `${part[0]?.toUpperCase()}.`).filter(Boolean).join(" ") : "";
  return author.family ? [initials, author.family].filter(Boolean).join(" ") : author.name || author.given;
}

function formatLibraryGbt(candidate) {
  const authorNames = candidate.authors.map(libraryGbtAuthor).filter(Boolean);
  const authorPart = authorNames.length
    ? authorNames.slice(0, 3).join(", ") + (authorNames.length > 3 ? ", 等" : "")
    : "";
  const marker = candidate.type === "proceedings-article" || candidate.venue ? "[J]" : "[EB/OL]";
  const head = authorPart ? `${authorPart}. ${candidate.title}${marker}` : `${candidate.title}${marker}`;
  const tail = [candidate.venue, candidate.year, candidate.doi ? `https://doi.org/${candidate.doi}` : ""].filter(Boolean).join(", ");
  return tail ? `${head}. ${tail}.` : `${head}.`;
}

function formatLibraryBibtex(candidate) {
  const entryType = candidate.type === "proceedings-article" || candidate.venue ? "article" : "misc";
  const authorJoined = candidate.authors.map(libraryBibAuthor).filter(Boolean).join(" and ");
  const firstWord = candidate.title.match(/[A-Za-z0-9]+/)?.[0]?.toLowerCase() || "";
  const key = `${candidate.authors[0]?.family || ""}${candidate.year}${firstWord}`.replace(/[^A-Za-z0-9]/g, "") || "reference";
  const lines = [`@${entryType}{${key},`];
  if (authorJoined) lines.push(`  author = {${authorJoined}},`);
  if (candidate.title) lines.push(`  title = {${candidate.title}},`);
  if (candidate.venue) lines.push(`  journal = {${candidate.venue}},`);
  if (candidate.year) lines.push(`  year = {${candidate.year}},`);
  if (candidate.doi) lines.push(`  doi = {${candidate.doi}},`);
  lines.push("}");
  return lines.join("\n");
}

function formatLibraryRis(candidate) {
  const lines = ["TY  - JOUR"];
  candidate.authors.forEach((author) => {
    const name = libraryBibAuthor(author);
    if (name) lines.push(`AU  - ${name}`);
  });
  if (candidate.title) lines.push(`TI  - ${candidate.title}`);
  if (candidate.venue) lines.push(`JO  - ${candidate.venue}`);
  if (candidate.year) lines.push(`PY  - ${candidate.year}`);
  if (candidate.doi) lines.push(`DO  - ${candidate.doi}`);
  lines.push("ER  - ");
  return lines.join("\n");
}

function formatLibraryApa(candidate) {
  const apa = candidate.authors.map(libraryApaAuthor).filter(Boolean);
  let authorStr = "";
  if (apa.length === 1) authorStr = apa[0];
  else if (apa.length === 2) authorStr = `${apa[0]}, & ${apa[1]}`;
  else if (apa.length > 2) authorStr = `${apa.slice(0, -1).join(", ")}, & ${apa[apa.length - 1]}`;
  const yearPart = candidate.year ? `(${candidate.year}).` : "";
  const source = candidate.venue ? `. ${candidate.venue}` : "";
  const doiPart = candidate.doi ? ` https://doi.org/${candidate.doi}` : "";
  return [authorStr, yearPart, `${candidate.title}.${source}.${doiPart}`].filter(Boolean).join(" ").trim();
}

function formatLibraryMla(candidate) {
  const authors = candidate.authors;
  const first = authors.length ? libraryBibAuthor(authors[0]) : "";
  const rest = authors.slice(1).map(libraryMlaAuthor).filter(Boolean);
  let authorStr = first;
  if (rest.length === 1) authorStr = `${first}, and ${rest[0]}`;
  else if (rest.length > 1) authorStr = `${first}, et al.`;
  const parts = [authorStr, `"${candidate.title}."`].filter(Boolean);
  if (candidate.venue) parts.push(candidate.venue);
  if (candidate.year) parts.push(candidate.year);
  return `${parts.join(", ")}.`;
}

function formatLibraryIeee(candidate) {
  const authors = candidate.authors.map(libraryIeeeAuthor).filter(Boolean);
  let authorStr = "";
  if (authors.length === 1) authorStr = authors[0];
  else if (authors.length === 2) authorStr = `${authors[0]} and ${authors[1]}`;
  else if (authors.length > 2) authorStr = `${authors.slice(0, -1).join(", ")}, and ${authors[authors.length - 1]}`;
  const parts = [authorStr, `"${candidate.title},"`, candidate.venue, candidate.year].filter(Boolean);
  return `${parts.join(", ")}.`;
}

function openLibraryCitationOverlay(paper, formats) {
  libCitationFormats = formats;
  const basicInfo = paper.basicInfo || {};
  const metaParts = [
    Array.isArray(basicInfo.authors) ? basicInfo.authors.slice(0, 3).join("；") : "",
    basicInfo.venue,
    String(basicInfo.publishedDate || "").match(/(?:19|20)\d{2}/)?.[0] || "",
  ].filter(Boolean);
  libCitationOverlayTitle.textContent = paper.title || "引用信息";
  libCitationOverlayMeta.textContent = metaParts.join(" · ") || paper.doi || "";
  libCitationFormatSelect.value = libCitationFormat;
  updateLibraryCitationOutput();
  libCitationOverlay.hidden = false;
}

function closeLibraryCitationOverlay() {
  if (libCitationOverlay) libCitationOverlay.hidden = true;
}

function updateLibraryCitationOutput() {
  if (libCitationOutput) {
    libCitationOutput.value = (libCitationFormats && libCitationFormats[libCitationFormat]) || "";
  }
}

function initLibraryCitationOverlay() {
  libCitationOverlayCloseButton?.addEventListener("click", closeLibraryCitationOverlay);
  libCitationOverlay?.addEventListener("pointerdown", (event) => {
    if (event.target === libCitationOverlay) closeLibraryCitationOverlay();
  });
  libCitationFormatSelect?.addEventListener("change", () => {
    libCitationFormat = libCitationFormatSelect.value;
    updateLibraryCitationOutput();
  });
  libCitationCopyButton?.addEventListener("click", async () => {
    const text = libCitationOutput?.value || "";
    if (!text) return;
    try {
      await copyTextToClipboardLibrary(text);
      libCitationCopyButton.classList.add("copied");
      libCitationCopyButton.title = "已复制";
      libCitationCopyButton.setAttribute("aria-label", "已复制");
      window.setTimeout(() => {
        libCitationCopyButton.classList.remove("copied");
        libCitationCopyButton.title = "复制引用";
        libCitationCopyButton.setAttribute("aria-label", "复制引用");
      }, 1200);
    } catch (error) {
      console.error("Failed to copy citation.", error);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && libCitationOverlay && !libCitationOverlay.hidden) {
      closeLibraryCitationOverlay();
    }
  });
}

async function copyTextToClipboardLibrary(text) {
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

function hidePaperInfoPanel() {
  if (!paperInfoPanel) return;
  paperInfoPanel.hidden = true;
  paperInfoPanel.classList.remove("open");
  paperInfoPanel.innerHTML = "";
}

function createPaperInfoSection(title, rows) {
  const section = document.createElement("section");
  section.className = "paper-info-section";
  const heading = document.createElement("h3");
  heading.textContent = title;
  const list = document.createElement("dl");
  list.className = "paper-info-list";
  rows.forEach(([label, value]) => {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value || "Not available";
    list.append(dt, dd);
  });
  section.append(heading, list);
  return section;
}

function formatPaperInfoValue(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join("; ");
  return String(value || "").trim();
}

function showCategoryMenu(category, anchor) {
  document.querySelector(".category-menu")?.remove();
  const menu = document.createElement("div");
  menu.className = "category-menu library-menu";

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><path d="M12 11v6"></path><path d="M9 14h6"></path></svg>新建子分类';
  addButton.addEventListener("click", () => {
    menu.remove();
    startInlineCategoryCreate(category, anchor);
  });

  const renameButton = document.createElement("button");
  renameButton.type = "button";
  renameButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>重命名';
  renameButton.disabled = category.locked || !category.id;
  renameButton.addEventListener("click", () => {
    menu.remove();
    startInlineCategoryRename(category, anchor);
  });

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M6 6l1 15h10l1-15"></path></svg>删除';
  deleteButton.disabled = category.locked || !category.id;
  deleteButton.addEventListener("click", async () => {
    menu.remove();
    if (!window.confirm(`确定删除分类"${category.name}"？其中论文将移入未分类。`)) return;
    await updateCategory({ action: "delete", id: category.id });
  });

  menu.append(addButton, renameButton, deleteButton);
  document.body.appendChild(menu);
  positionMenu(menu, anchor, 190);
}

function startInlineCategoryRename(category, anchor) {
  const row = anchor.closest(".category-row");
  const button = row ? row.querySelector(".category-item") : null;
  if (!row || !button) return;
  const menuButton = row.querySelector(".category-menu-button");
  if (menuButton) menuButton.hidden = true;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "category-inline-input";
  input.value = category.name;
  input.setAttribute("aria-label", "分类名称");
  input.setAttribute("maxlength", "120");
  button.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    if (commit && name && name !== category.name) {
      updateCategory({ action: "rename", id: category.id, name }).catch((error) => {
        console.error(error);
        setLibraryStatus("重命名失败。", true);
        renderLibrary();
      });
    } else {
      renderLibrary();
    }
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  });
  input.addEventListener("blur", () => finish(true));
}

function startInlineCategoryCreate(parentCategory, anchor) {
  const row = anchor.closest(".category-row");
  const newRow = document.createElement("div");
  newRow.className = "category-row category-create-row";
  newRow.style.paddingLeft = `${(Number(parentCategory.depth || 0) + 1) * 18}px`;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "category-inline-input";
  input.placeholder = "新分类名称";
  input.setAttribute("aria-label", "新分类名称");
  input.setAttribute("maxlength", "120");
  newRow.appendChild(input);

  if (row) row.after(newRow);
  else categoryMainRows.appendChild(newRow);
  input.focus();

  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    if (commit && name) {
      updateCategory({ action: "create", parentId: parentCategory.id || "", name }).catch((error) => {
        console.error(error);
        setLibraryStatus("Create category failed.", true);
        newRow.remove();
      });
    } else {
      newRow.remove();
    }
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  });
  input.addEventListener("blur", () => finish(true));
}

function showPaperMenu(paper, anchor) {
  document.querySelector(".library-menu")?.remove();
  const menu = document.createElement("div");
  menu.className = "paper-menu library-menu";

  const moveButton = document.createElement("button");
  moveButton.type = "button";
  moveButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><path d="M12 13v4"></path><path d="m9.5 14.5 2.5-2.5 2.5 2.5"></path></svg>移动';
  moveButton.addEventListener("click", () => {
    menu.remove();
    showMovePaperMenu(paper, anchor);
  });

  const exportLink = document.createElement("a");
  exportLink.href = `${apiBaseUrl || ""}/api/library/export?id=${encodeURIComponent(paper.id)}`;
  exportLink.download = `${paper.title || "paper"}-export.pdf`;
  exportLink.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><path d="M7 10l5 5 5-5"></path><path d="M12 15V3"></path></svg>导出';
  exportLink.addEventListener("click", async (event) => {
    event.preventDefault();
    menu.remove();
    await ensureApiBase();
    const link = document.createElement("a");
    link.href = `${apiBaseUrl || ""}/api/library/export?id=${encodeURIComponent(paper.id)}`;
    link.download = `${paper.title || "paper"}-export.pdf`;
    link.click();
  });

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M6 6l1 15h10l1-15"></path></svg>删除';
  deleteButton.addEventListener("click", async () => {
    menu.remove();
    if (!window.confirm(`确定删除论文"${paper.title}"？`)) return;
    await updatePaper({ action: "delete", id: paper.id });
  });

  menu.append(moveButton, exportLink, deleteButton);
  document.body.appendChild(menu);
  positionMenu(menu, anchor, 190);
}

function showMovePaperMenu(paper, anchor) {
  document.querySelector(".library-menu")?.remove();
  const menu = document.createElement("div");
  menu.className = "paper-menu move-paper-menu library-menu";

  const heading = document.createElement("div");
  heading.className = "move-menu-heading";
  heading.textContent = "移动到分类";
  menu.appendChild(heading);

  const list = document.createElement("div");
  list.className = "move-category-list";
  menu.appendChild(list);

  const rerender = () => showMovePaperMenu(paper, anchor);
  renderMoveCategoryNode(libraryTree, 0, paper, list, rerender);

  document.body.appendChild(menu);
  positionMenu(menu, anchor, 260);
}

function renderMoveCategoryNode(node, depth, paper, container, rerender) {
  (node.folders || []).forEach((folder) => {
    renderMoveCategoryRow(folder, depth, paper, container, rerender);
    if (folder.folders && folder.folders.length && !isCategoryCollapsed(folder.id)) {
      renderMoveCategoryNode(folder, depth + 1, paper, container, rerender);
    }
  });
}

function renderMoveCategoryRow(node, depth, paper, container, rerender) {
  const row = document.createElement("div");
  row.className = "move-category-row";
  row.style.paddingLeft = `${14 + depth * 14}px`;

  const hasChildren = Boolean(node.folders && node.folders.length);
  const paperCategory = String(paper.category || "");
  const isExact = node.id === paperCategory;
  const isAncestor = Boolean(paperCategory) && paperCategory.startsWith(`${node.id}/`);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "move-category-option";
  if (depth >= 1) button.classList.add("move-category-sub");
  button.classList.toggle("move-category-has-children", hasChildren);
  if (isAncestor && !isExact) button.classList.add("move-category-current");
  button.disabled = isExact;

  const icon = document.createElement("span");
  icon.className = "move-category-folder-icon";
  icon.innerHTML = folderCategoryIconSvg;
  button.appendChild(icon);

  if (hasChildren) {
    const toggle = document.createElement("span");
    toggle.className = "move-category-toggle";
    toggle.textContent = isCategoryCollapsed(node.id) ? "▸" : "▾";
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleCategoryCollapsed(node.id);
      rerender();
    });
    button.appendChild(toggle);
  }

  button.appendChild(document.createTextNode(node.name));
  button.addEventListener("click", async () => {
    document.querySelector(".library-menu")?.remove();
    await updatePaper({ action: "move", id: paper.id, category: node.id });
  });
  row.appendChild(button);
  container.appendChild(row);
}

function positionMenu(menu, anchor, width) {
  const rect = anchor.getBoundingClientRect();
  menu.style.left = `${Math.min(rect.left, window.innerWidth - width)}px`;
  menu.style.top = `${rect.bottom + 4}px`;
}

async function updateCategory(payload) {
  try {
    const response = await apiFetch("/api/library/category", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) {
      setLibraryStatus(data.error || "Category operation failed.", true);
      return;
    }
    libraryTree = data.tree;
    if (payload.action === "rename" && selectedCategoryId === payload.id) {
      selectedCategoryId = data.categoryId || "";
    } else if (payload.action === "rename" && selectedCategoryId.startsWith(`${payload.id}/`) && data.categoryId) {
      selectedCategoryId = `${data.categoryId}/${selectedCategoryId.slice(String(payload.id).length + 1)}`;
    }
    if (payload.action === "delete" && selectedCategoryId === payload.id) selectedCategoryId = "";
    renderLibrary();
    setLibraryStatus("");
    reportSyncResult(data.sync);
  } catch (error) {
    console.error(error);
    setLibraryStatus(error.message || "Category operation failed.", true);
  }
}

async function updatePaper(payload) {
  try {
    const response = await apiFetch("/api/library/paper", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) {
      setLibraryStatus(data.error || "Paper operation failed.", true);
      return;
    }
    libraryTree = data.tree;
    if (payload.action === "move" && selectedCategoryId && selectedCategoryId !== payload.category) {
      selectedCategoryId = "";
    }
    renderLibrary();
    setLibraryStatus("");
    reportSyncResult(data.sync);
  } catch (error) {
    console.error(error);
    setLibraryStatus(error.message || "Paper operation failed.", true);
  }
}

async function ensureApiBase() {
  if (apiBaseUrl) return;
  const response = await apiFetch("/api/library");
  await readJsonResponse(response);
}

function formatUploadDate(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function formatViewedDate(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function flattenCategories(node, depth = 0) {
  if (!node) return [];
  const current = {
    id: node.id || "",
    name: node.name || "Library",
    depth,
    locked: Boolean(node.locked),
    paperCount: collectPapers(node).length,
    papers: node.papers || [],
  };
  return [current, ...(node.folders || []).flatMap((folder) => flattenCategories(folder, depth + 1))];
}

function collectPapers(node) {
  if (!node) return [];
  return [...(node.papers || []), ...(node.folders || []).flatMap(collectPapers)];
}

function findCategoryNode(node, id) {
  if (!node) return null;
  if ((node.id || "") === id) return node;
  for (const folder of node.folders || []) {
    const found = findCategoryNode(folder, id);
    if (found) return found;
  }
  return null;
}

function filterPapers(papers, query) {
  if (!query) return papers;
  return papers.filter((paper) => {
    const haystack = [paper.title, paper.category, paper.categoryName, ...(Array.isArray(paper.keywords) ? paper.keywords : [])]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
}

function getRecentPaperRecords() {
  try {
    const records = JSON.parse(localStorage.getItem(RECENT_PAPERS_KEY) || "[]");
    return Array.isArray(records) ? records.filter((record) => record?.id && record?.viewedAt) : [];
  } catch {
    return [];
  }
}

function migrateLegacyRecentPapers() {
  if (localStorage.getItem(RECENT_PAPERS_KEY)) return;
  const legacy = localStorage.getItem(LEGACY_RECENT_PAPERS_KEY);
  if (legacy) localStorage.setItem(RECENT_PAPERS_KEY, legacy);
}

function saveRecentPaperRecords(records) {
  localStorage.setItem(RECENT_PAPERS_KEY, JSON.stringify(records.slice(0, 100)));
}

function getPaperViewedAt(paperId) {
  return getRecentPaperRecords().find((record) => record.id === paperId)?.viewedAt || "";
}

function recordPaperViewed(paperId) {
  const records = getRecentPaperRecords().filter((record) => record.id !== paperId);
  records.unshift({ id: paperId, viewedAt: new Date().toISOString() });
  saveRecentPaperRecords(records);
}

function getRecentPapers(allPapers) {
  const paperById = new Map(allPapers.map((paper) => [paper.id, paper]));
  return getRecentPaperRecords()
    .map((record) => {
      const paper = paperById.get(record.id);
      return paper ? { ...paper, viewedAt: record.viewedAt } : null;
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.viewedAt).getTime() - new Date(a.viewedAt).getTime());
}

function findPaperCategory(node, paperId) {
  if (!node) return "";
  if ((node.papers || []).some((paper) => paper.id === paperId)) return node.id || "";
  for (const folder of node.folders || []) {
    const found = findPaperCategory(folder, paperId);
    if (found) return found;
  }
  return "";
}

function setLibraryStatus(message, isError = false) {
  libraryStatus.textContent = message;
  libraryStatus.classList.toggle("error", isError);
}

async function loadCloudSyncStatus() {
  try {
    const response = await apiFetch("/api/cloud-sync");
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.error || "Failed to load cloud sync status.");
    renderCloudSyncStatus(data);
  } catch (error) {
    console.error(error);
    cloudSyncStatus.textContent = "Unavailable";
    cloudSyncButton.disabled = true;
  }
}

let cloudSettingsSaveTimer = null;

function wireCloudSettingsAutoSave() {
  const fields = [aiBaseUrlInput, aiModelInput, aiApiKeyInput, cloudProviderSelect, cloudLocalDirInput, cloudWebdavUrlInput, cloudUsernameInput, cloudPasswordInput, cloudAutoPushInput];
  fields.forEach((field) => {
    if (!field) return;
    const eventName = field.type === "checkbox" || field.tagName === "SELECT" ? "change" : "input";
    field.addEventListener(eventName, () => {
      window.clearTimeout(cloudSettingsSaveTimer);
      cloudSettingsSaveTimer = window.setTimeout(() => {
        saveCloudSyncConfig().catch((error) => console.error("Failed to auto-save settings.", error));
      }, 600);
    });
  });
}

function openCloudConfig() {
  cloudConfigOverlay.hidden = false;
  aiBaseUrlInput.focus();
}

function closeCloudConfig() {
  cloudConfigOverlay.hidden = true;
}

async function loadSettings() {
  try {
    const response = await apiFetch("/api/settings");
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.error || "Failed to load settings.");
    renderSettings(data);
  } catch (error) {
    console.error(error);
  }
}

async function saveCloudSyncConfig() {
  setCloudSyncBusy(true);
  try {
    const response = await apiFetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ai: {
          baseUrl: aiBaseUrlInput.value.trim(),
          model: aiModelInput.value.trim(),
          apiKey: aiApiKeyInput.value,
        },
        sync: {
          provider: cloudProviderSelect.value,
          localDir: cloudLocalDirInput.value.trim(),
          webdavUrl: cloudWebdavUrlInput.value.trim(),
          username: cloudUsernameInput.value.trim(),
          password: cloudPasswordInput.value,
          autoSync: cloudAutoPushInput.checked,
        },
      }),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) {
      setLibraryStatus(data.error || "Settings save failed.", true);
      return;
    }
    renderSettings(data.settings);
    renderCloudSyncStatus(data.sync);
    setLibraryStatus("设置已自动保存");
  } catch (error) {
    console.error(error);
    setLibraryStatus(error.message || "设置保存失败。", true);
  } finally {
    setCloudSyncBusy(false);
  }
}

async function testAiApi() {
  setAiApiTestStatus("Testing...", false);
  setAiApiTestBusy(true);
  try {
    const response = await apiFetch("/api/settings/test-ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ai: {
          baseUrl: aiBaseUrlInput.value.trim(),
          model: aiModelInput.value.trim(),
          apiKey: aiApiKeyInput.value,
        },
      }),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) {
      setAiApiTestStatus(formatAiApiTestError(data), true);
      return;
    }
    const message = data.message ? ` · ${data.message}` : "";
    setAiApiTestStatus(`Connected: ${data.model || aiModelInput.value.trim() || "model"}${message}`, false);
  } catch (error) {
    console.error(error);
    setAiApiTestStatus(error.message || "AI API test failed.", true);
  } finally {
    setAiApiTestBusy(false);
  }
}

function setAiApiTestBusy(isBusy) {
  aiApiTestButton.disabled = isBusy;
  aiApiTestButton.setAttribute("aria-busy", String(isBusy));
}

function setAiApiTestStatus(message, isError) {
  aiApiTestStatus.textContent = message;
  aiApiTestStatus.classList.toggle("error", Boolean(isError));
}

function formatAiApiTestError(data) {
  const detail = String(data?.detail || "").replace(/\s+/g, " ").trim();
  return detail ? `${data.error || "AI API test failed."} ${detail.slice(0, 260)}` : data?.error || "AI API test failed.";
}

async function runCloudSync() {
  setCloudSyncBusy(true);
  try {
    const response = await apiFetch("/api/cloud-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sync" }),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) {
      renderCloudSyncStatus(data);
      setLibraryStatus(data.error || "Cloud sync failed.", true);
      return;
    }
    renderCloudSyncStatus(data);
    if (data.tree) {
      libraryTree = data.tree;
      selectedCategoryId = "";
      renderLibrary();
    }
    setLibraryStatus(
      `Cloud synced. Downloaded ${data.downloaded || 0}, uploaded ${data.uploaded || 0}, merged highlights ${data.highlightsMerged || 0}.`,
    );
  } catch (error) {
    console.error(error);
    setLibraryStatus(error.message || "Cloud sync failed.", true);
  } finally {
    setCloudSyncBusy(false);
  }
}

function renderCloudSyncStatus(status) {
  const configured = Boolean(status?.configured);
  cloudSyncButton.disabled = !configured;
  if (!configured) {
    cloudSyncStatus.textContent = "Not configured";
    return;
  }
  cloudProviderSelect.value = status.provider === "webdav" ? "webdav" : "local";
  if (status.provider === "local") cloudLocalDirInput.value = status.target || cloudLocalDirInput.value;
  if (status.provider === "webdav") cloudWebdavUrlInput.value = status.target || cloudWebdavUrlInput.value;
  cloudAutoPushInput.checked = Boolean(status.autoPush);
  const provider = status.provider === "webdav" ? "WebDAV" : status.provider === "local" ? "Folder" : status.provider;
  const auto = status.autoPush ? " · Auto" : "";
  cloudSyncStatus.textContent = status.syncedAt
    ? `${provider}${auto} · ${formatViewedDate(status.syncedAt)}`
    : `${provider}${auto}`;
}

function setCloudSyncBusy(isBusy) {
  cloudSyncButton.disabled = isBusy;
  cloudSyncButton.classList.toggle("syncing", isBusy);
  cloudSyncButton.setAttribute("aria-busy", String(isBusy));
  settingsButton.disabled = isBusy;
}

function renderSettings(settings) {
  const ai = settings?.ai || {};
  const sync = settings?.sync || {};
  aiBaseUrlInput.value = ai.baseUrl || "";
  aiModelInput.value = ai.model || "";
  aiApiKeyInput.placeholder = ai.hasApiKey ? maskSecretTail(ai.apiKeyTail) : "Paste API key";
  cloudProviderSelect.value = sync.provider === "webdav" ? "webdav" : "local";
  cloudLocalDirInput.value = sync.localDir || "";
  cloudWebdavUrlInput.value = sync.webdavUrl || "";
  cloudUsernameInput.value = sync.username || "";
  cloudPasswordInput.placeholder = sync.hasPassword ? maskSecretTail(sync.passwordTail) : "Paste password / app password";
  cloudAutoPushInput.checked = Boolean(sync.autoSync);
}

function maskSecretTail(tail) {
  return `****${tail || "****"}`;
}

function reportSyncResult(sync) {
  if (!sync) return;
  renderCloudSyncStatus(sync);
  if (sync.error) setLibraryStatus(`Cloud auto sync failed: ${sync.error}`, true);
}

async function readJsonResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return response.json();

  const text = await response.text();
  const detail = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  throw new Error(
    response.status === 404
      ? "API not found. Start this app with python server.py instead of a generic static server."
      : detail || `Server returned a non-JSON response: HTTP ${response.status}`,
  );
}

async function apiFetch(path, options = {}) {
  const url = String(path);
  if (!url.startsWith("/")) return fetch(url, options);

  const bases = buildApiBaseCandidates();
  let lastError = null;
  const tried = [];
  for (const base of bases) {
    try {
      tried.push(base || window.location.origin || "current origin");
      const response = await fetch(`${base}${url}`, options);
      if (response.status !== 404 || !url.startsWith("/api/")) {
        apiBaseUrl = base;
        return response;
      }
      lastError = new Error(`API not found at ${base || "current origin"}.`);
    } catch (error) {
      lastError = error;
    }
  }
  if (url === "/api/library/remote-pdf") {
    throw new Error("Remote PDF import API is not available. Restart python server.py so the new backend route is loaded.");
  }
  throw new Error(`${lastError?.message || "Failed to fetch"} Tried: ${tried.join(", ")}. Please start the Python server and open http://127.0.0.1:8000/ or http://localhost:8000/.`);
}

function buildApiBaseCandidates() {
  const candidates = [];
  if (apiBaseUrl) candidates.push(apiBaseUrl);
  if (window.location.protocol === "http:" || window.location.protocol === "https:") candidates.push(window.location.origin);
  ["http://127.0.0.1:8000", "http://localhost:8000", "http://127.0.0.1:8010", "http://localhost:8010", "http://127.0.0.1:8765", "http://localhost:8765"].forEach((base) => {
    if (window.location.origin !== base) candidates.push(base);
  });
  return [...new Set(candidates)];
}
