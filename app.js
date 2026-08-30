const libraryRoot = document.querySelector("#libraryRoot");
const libraryStatus = document.querySelector("#libraryStatus");
const categoryTree = document.querySelector("#categoryTree");
const paperList = document.querySelector("#paperList");
const libraryLayout = document.querySelector(".library-layout");
const libraryPaneResizer = document.querySelector("#libraryPaneResizer");
const currentCategoryName = document.querySelector("#currentCategoryName");
const librarySearchInput = document.querySelector("#librarySearchInput");
const tagFilterList = document.querySelector("#tagFilterList");
const clearTagFiltersButton = document.querySelector("#clearTagFiltersButton");
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
const aiBaseUrlInput = document.querySelector("#aiBaseUrlInput");
const aiModelInput = document.querySelector("#aiModelInput");
const aiApiKeyInput = document.querySelector("#aiApiKeyInput");
const aiExtraParamsInput = document.querySelector("#aiExtraParamsInput");
const aiTaskConfigSections = Array.from(document.querySelectorAll("[data-ai-task]"));
const discussionWebUrlInput = document.querySelector("#discussionWebUrlInput");
const cloudProviderSelect = document.querySelector("#cloudProviderSelect");
const cloudLocalDirInput = document.querySelector("#cloudLocalDirInput");
const cloudWebdavUrlInput = document.querySelector("#cloudWebdavUrlInput");
const cloudUsernameInput = document.querySelector("#cloudUsernameInput");
const cloudPasswordInput = document.querySelector("#cloudPasswordInput");
const cloudAutoPushInput = document.querySelector("#cloudAutoPushInput");

const RECENT_CATEGORY_ID = "__recent";
const LEGACY_RECENT_PAPERS_KEY = "openMoonlightRecentPapers";
const RECENT_PAPERS_KEY = "paperLanternRecentPapers";
const UNCATEGORIZED_LABEL = "Uncategorized";
const LIBRARY_SIDEBAR_WIDTH_KEY = "paperLanternLibrarySidebarWidth";

let libraryTree = null;
let selectedCategoryId = "";
let apiBaseUrl = "";
let searchQuery = "";
let selectedTagNames = new Set();
let draggedCategory = null;
let draggedPaperId = "";
let suppressPaperOpenUntil = 0;
let isResizingLibrarySidebar = false;

loadLibrary();
loadCloudSyncStatus();
loadSettings();
migrateLegacyRecentPapers();
initLibraryPaneResizer();

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
  const arxivId = arxivUploadInput.value;
  if (!arxivId?.trim()) return;
  closeUploadMenu();
  await uploadArxivPaper(arxivId.trim());
  arxivUploadInput.value = "";
});

librarySearchInput.addEventListener("input", () => {
  searchQuery = librarySearchInput.value.trim().toLowerCase();
  renderLibrary();
});

clearTagFiltersButton.addEventListener("click", () => {
  selectedTagNames = new Set();
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
cloudConfigForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveCloudSyncConfig();
});
aiTaskConfigSections.forEach((section) => {
  section.querySelector("[data-ai-task-default]").addEventListener("change", () => updateAiTaskSection(section));
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

categoryTree.addEventListener("dragenter", handleLibrarySidebarDrag);
categoryTree.addEventListener("dragover", handleLibrarySidebarDrag);
categoryTree.addEventListener("dragleave", (event) => {
  if (!categoryTree.contains(event.relatedTarget)) categoryTree.classList.remove("file-drag-over");
});
categoryTree.addEventListener("drop", async (event) => {
  const file = getDroppedPdf(event);
  if (!file) return;
  event.preventDefault();
  categoryTree.classList.remove("file-drag-over");
  await handlePdfUpload(file);
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

async function handlePdfUpload(file, category = "") {
  await uploadPdfToLibrary(file, file.name.replace(/\.pdf$/i, ""), category || getActiveUploadCategory());
}

function getDroppedPdf(event) {
  return Array.from(event.dataTransfer?.files || []).find((item) => item.type === "application/pdf" || /\.pdf$/i.test(item.name));
}

function isFileDrag(event) {
  return Array.from(event.dataTransfer?.types || []).includes("Files");
}

function handleLibrarySidebarDrag(event) {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  categoryTree.classList.add("file-drag-over");
}

function clearLibraryDragState() {
  draggedCategory = null;
  draggedPaperId = "";
  document.querySelectorAll(".dragging, .drag-over-reorder, .file-drag-over").forEach((element) => {
    element.classList.remove("dragging", "drag-over-reorder", "file-drag-over");
  });
}

function getLibrarySidebarWidthBounds() {
  const min = 220;
  const available = Math.max(libraryLayout?.clientWidth || 0, window.innerWidth || 0);
  const max = available > 0 ? Math.max(min, Math.min(520, available - 380)) : 520;
  return { min, max };
}

function setLibrarySidebarWidth(width, persist = true) {
  if (!libraryLayout || window.matchMedia("(max-width: 900px)").matches) return;
  const { min, max } = getLibrarySidebarWidthBounds();
  const next = Math.round(Math.min(max, Math.max(min, Number(width) || min)));
  document.documentElement.style.setProperty("--library-category-width", `${next}px`);
  libraryPaneResizer?.setAttribute("aria-valuemin", String(min));
  libraryPaneResizer?.setAttribute("aria-valuemax", String(max));
  libraryPaneResizer?.setAttribute("aria-valuenow", String(next));
  if (persist) localStorage.setItem(LIBRARY_SIDEBAR_WIDTH_KEY, String(next));
}

function initLibraryPaneResizer() {
  if (!libraryLayout || !libraryPaneResizer) return;
  window.requestAnimationFrame(() => {
    const savedWidth = Number(localStorage.getItem(LIBRARY_SIDEBAR_WIDTH_KEY));
    if (Number.isFinite(savedWidth)) setLibrarySidebarWidth(savedWidth, false);
    else setLibrarySidebarWidth(280, false);
  });

  libraryPaneResizer.addEventListener("pointerdown", (event) => {
    if (window.matchMedia("(max-width: 900px)").matches) return;
    event.preventDefault();
    isResizingLibrarySidebar = true;
    libraryPaneResizer.setPointerCapture(event.pointerId);
    document.body.classList.add("resizing-library-sidebar");
  });
  libraryPaneResizer.addEventListener("pointermove", (event) => {
    if (!isResizingLibrarySidebar) return;
    setLibrarySidebarWidth(event.clientX - libraryLayout.getBoundingClientRect().left, false);
  });
  const finishResize = (event) => {
    if (!isResizingLibrarySidebar) return;
    isResizingLibrarySidebar = false;
    document.body.classList.remove("resizing-library-sidebar");
    if (libraryPaneResizer.hasPointerCapture(event.pointerId)) libraryPaneResizer.releasePointerCapture(event.pointerId);
    const current = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--library-category-width"));
    if (Number.isFinite(current)) setLibrarySidebarWidth(current, true);
  };
  libraryPaneResizer.addEventListener("pointerup", finishResize);
  libraryPaneResizer.addEventListener("pointercancel", finishResize);
  libraryPaneResizer.addEventListener("keydown", (event) => {
    if (window.matchMedia("(max-width: 900px)").matches) return;
    const { min, max } = getLibrarySidebarWidthBounds();
    const current = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--library-category-width")) || 280;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      setLibrarySidebarWidth(current + (event.key === "ArrowRight" ? 16 : -16));
    } else if (event.key === "Home") {
      event.preventDefault();
      setLibrarySidebarWidth(min);
    } else if (event.key === "End") {
      event.preventDefault();
      setLibrarySidebarWidth(max);
    }
  });
  window.addEventListener("resize", () => {
    const current = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--library-category-width"));
    if (Number.isFinite(current)) setLibrarySidebarWidth(current, false);
  });
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

async function uploadArxivPaper(arxivId) {
  setLibraryStatus("Downloading arXiv PDF...");
  try {
    const response = await apiFetch("/api/library/arxiv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ arxivId, category: getActiveUploadCategory() }),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) {
      setLibraryStatus(data.detail || data.error || "arXiv upload failed.", true);
      return;
    }
    reportSyncResult(data.sync);
    openPaperReader(data.paper.id, true);
  } catch (error) {
    console.error(error);
    setLibraryStatus(error.message || "arXiv upload failed.", true);
  }
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
  categoryTree.innerHTML = "";
  paperList.innerHTML = "";
  const categories = flattenCategories(libraryTree);
  renderRecentCategory();
  categories.forEach((category) => renderCategoryRow(category));

  const allPapers = collectPapers(libraryTree);
  renderTagFilters(allPapers);
  let papers = [];
  if (selectedCategoryId === RECENT_CATEGORY_ID) {
    currentCategoryName.textContent = "Recent Papers";
    papers = getRecentPapers(allPapers);
  } else {
    const selected = categories.find((category) => category.id === selectedCategoryId) || categories[0];
    currentCategoryName.textContent = selected?.id ? selected.name : "All Papers";
    papers = selectedCategoryId ? selected?.papers || [] : allPapers;
  }
  renderPaperList(filterPapers(papers, searchQuery, selectedTagNames));
}

function renderTagFilters(papers) {
  const tagMap = new Map();
  papers.forEach((paper) => {
    normalizePaperTags(paper.tags).forEach((tag) => {
      const key = tag.name.toLocaleLowerCase();
      const current = tagMap.get(key) || { ...tag, count: 0 };
      current.count += 1;
      tagMap.set(key, current);
    });
  });
  const available = Array.from(tagMap.entries()).sort(([, left], [, right]) => left.name.localeCompare(right.name, "zh-CN"));
  selectedTagNames.forEach((key) => {
    if (!tagMap.has(key)) selectedTagNames.delete(key);
  });
  tagFilterList.innerHTML = "";
  if (!available.length) {
    const empty = document.createElement("span");
    empty.className = "tag-filter-empty";
    empty.textContent = "No tags yet";
    tagFilterList.appendChild(empty);
  }
  available.forEach(([key, tag]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tag-filter-chip";
    button.classList.toggle("active", selectedTagNames.has(key));
    button.title = `Filter by ${tag.name}`;
    button.append(createTagColorIndicator([tag]), document.createTextNode(`${tag.name} (${tag.count})`));
    button.addEventListener("click", () => {
      if (selectedTagNames.has(key)) selectedTagNames.delete(key);
      else selectedTagNames.add(key);
      renderLibrary();
    });
    tagFilterList.appendChild(button);
  });
  clearTagFiltersButton.hidden = selectedTagNames.size === 0;
}

function renderCategoryRow(category) {
  const row = document.createElement("div");
  row.className = "category-row";
  row.style.paddingLeft = `${category.depth * 18}px`;
  row.dataset.categoryId = category.id;
  row.dataset.parentId = category.parentId || "";
  row.draggable = Boolean(category.id);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "category-item";
  button.classList.toggle("active", category.id === selectedCategoryId);
  button.textContent = `${category.name} (${category.paperCount})`;
  button.addEventListener("click", () => {
    selectedCategoryId = category.id;
    renderLibrary();
  });

  const menuButton = document.createElement("button");
  menuButton.type = "button";
  menuButton.className = "category-menu-button menu-button";
  menuButton.setAttribute("aria-label", `${category.name} category actions`);
  menuButton.textContent = "...";
  menuButton.addEventListener("click", (event) => {
    event.stopPropagation();
    showCategoryMenu(category, menuButton);
  });

  row.addEventListener("dragstart", (event) => {
    if (!category.id || event.target.closest(".category-menu-button")) {
      event.preventDefault();
      return;
    }
    draggedCategory = { id: category.id, parentId: category.parentId || "" };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", category.id);
    row.classList.add("dragging");
  });
  row.addEventListener("dragend", clearLibraryDragState);
  row.addEventListener("dragover", (event) => {
    if (isFileDrag(event)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      row.classList.add("file-drag-over");
      return;
    }
    if (!draggedCategory || draggedCategory.id === category.id || draggedCategory.parentId !== (category.parentId || "")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    row.classList.add("drag-over-reorder");
  });
  row.addEventListener("dragleave", () => row.classList.remove("drag-over-reorder", "file-drag-over"));
  row.addEventListener("drop", async (event) => {
    const file = getDroppedPdf(event);
    if (file) {
      event.preventDefault();
      event.stopPropagation();
      clearLibraryDragState();
      await handlePdfUpload(file, category.id || UNCATEGORIZED_LABEL);
      return;
    }
    if (!draggedCategory || draggedCategory.id === category.id || draggedCategory.parentId !== (category.parentId || "")) return;
    event.preventDefault();
    event.stopPropagation();
    const placeAfter = event.clientY > row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
    const siblings = Array.from(categoryTree.querySelectorAll(`.category-row[data-parent-id="${CSS.escape(draggedCategory.parentId)}"]`));
    const orderedIds = siblings.map((item) => item.dataset.categoryId).filter(Boolean).filter((id) => id !== draggedCategory.id);
    const targetIndex = orderedIds.indexOf(category.id);
    orderedIds.splice(Math.max(0, targetIndex + (placeAfter ? 1 : 0)), 0, draggedCategory.id);
    const parentId = draggedCategory.parentId;
    clearLibraryDragState();
    await updateCategory({ action: "reorder", parentId, orderedIds });
  });

  row.append(button, menuButton);
  categoryTree.appendChild(row);
}

function renderRecentCategory() {
  const row = document.createElement("div");
  row.className = "category-row category-row-special";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "category-item recent-category-item";
  button.classList.toggle("active", selectedCategoryId === RECENT_CATEGORY_ID);
  button.textContent = `Recent Papers (${getRecentPaperRecords().length})`;
  button.addEventListener("click", () => {
    selectedCategoryId = RECENT_CATEGORY_ID;
    renderLibrary();
  });

  row.appendChild(button);
  categoryTree.appendChild(row);
}

function renderPaperList(papers) {
  if (!papers.length) {
    const empty = document.createElement("div");
    empty.className = "library-empty";
    empty.textContent = searchQuery
      ? "No matching papers."
      : selectedCategoryId === RECENT_CATEGORY_ID
        ? "No recent reading history yet."
        : "No papers in this category yet.";
    paperList.appendChild(empty);
    return;
  }

  const canReorder = Boolean(selectedCategoryId && selectedCategoryId !== RECENT_CATEGORY_ID && !searchQuery && !selectedTagNames.size);
  papers.forEach((paper) => {
    const viewedAt = paper.viewedAt || getPaperViewedAt(paper.id);
    const card = document.createElement("article");
    card.className = "paper-card";
    card.tabIndex = 0;
    card.dataset.paperId = paper.id;
    card.draggable = canReorder;
    card.addEventListener("click", () => {
      if (Date.now() < suppressPaperOpenUntil) return;
      openPaperReader(paper.id);
    });
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter") openPaperReader(paper.id);
    });

    const title = document.createElement("h3");
    title.append(createTagColorIndicator(paper.tags), document.createTextNode(paper.title));

    const meta = document.createElement("p");
    meta.textContent = `Uploaded: ${formatUploadDate(paper.uploadedAt)} · Last read: ${formatViewedDate(viewedAt)}`;

    const text = document.createElement("div");
    text.className = "paper-card-text";
    text.append(title, meta);

    const summary = createPaperHoverSummary(paper);
    if (summary) text.appendChild(summary);

    const actions = document.createElement("button");
    actions.type = "button";
    actions.className = "paper-menu-button menu-button";
    actions.setAttribute("aria-label", `${paper.title} paper actions`);
    actions.textContent = "...";
    actions.addEventListener("click", (event) => {
      event.stopPropagation();
      showPaperMenu(paper, actions);
    });

    card.addEventListener("dragstart", (event) => {
      if (!canReorder || event.target.closest("button, a")) {
        event.preventDefault();
        return;
      }
      draggedPaperId = paper.id;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", paper.id);
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => {
      suppressPaperOpenUntil = Date.now() + 180;
      clearLibraryDragState();
    });
    card.addEventListener("dragover", (event) => {
      if (!canReorder || !draggedPaperId || draggedPaperId === paper.id) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      card.classList.add("drag-over-reorder");
    });
    card.addEventListener("dragleave", () => card.classList.remove("drag-over-reorder"));
    card.addEventListener("drop", async (event) => {
      if (!canReorder || !draggedPaperId || draggedPaperId === paper.id) return;
      event.preventDefault();
      const placeAfter = event.clientY > card.getBoundingClientRect().top + card.getBoundingClientRect().height / 2;
      const orderedIds = Array.from(paperList.querySelectorAll(".paper-card[data-paper-id]"))
        .map((item) => item.dataset.paperId)
        .filter((id) => id !== draggedPaperId);
      const targetIndex = orderedIds.indexOf(paper.id);
      orderedIds.splice(Math.max(0, targetIndex + (placeAfter ? 1 : 0)), 0, draggedPaperId);
      suppressPaperOpenUntil = Date.now() + 180;
      clearLibraryDragState();
      await updatePaper({ action: "reorder", category: selectedCategoryId, orderedIds });
    });

    card.append(text, actions);
    paperList.appendChild(card);
  });
}

function createPaperHoverSummary(paper) {
  const lines = paper.threeLineSummary || {};
  const values = [
    ["Challenges", lines.challenges],
    ["Method", lines.method],
    ["Conclusion", lines.conclusion],
  ].filter(([, value]) => String(value || "").trim());
  if (!values.length) return null;

  const box = document.createElement("div");
  box.className = "paper-hover-summary";
  values.forEach(([label, value]) => {
    const line = document.createElement("p");
    const labelNode = document.createElement("strong");
    labelNode.textContent = `${label}: `;
    line.append(labelNode, document.createTextNode(String(value)));
    box.appendChild(line);
  });
  return box;
}

function normalizePaperTags(tags) {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  return tags
    .map((tag) => ({
      name: String(tag?.name || "").replace(/\s+/g, " ").trim().slice(0, 48),
      color: /^#[0-9a-f]{6}$/i.test(String(tag?.color || "")) ? String(tag.color).toLowerCase() : "#2c758c",
    }))
    .filter((tag) => {
      const key = tag.name.toLocaleLowerCase();
      if (!tag.name || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 16);
}

function createTagColorIndicator(tags) {
  const indicator = document.createElement("span");
  indicator.className = "tag-color-indicators";
  normalizePaperTags(tags).forEach((tag) => {
    const dot = document.createElement("span");
    dot.className = "tag-color-dot";
    dot.style.backgroundColor = tag.color;
    dot.title = tag.name;
    indicator.appendChild(dot);
  });
  return indicator;
}

function showCategoryMenu(category, anchor) {
  document.querySelector(".category-menu")?.remove();
  const menu = document.createElement("div");
  menu.className = "category-menu library-menu";

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.textContent = "Add subcategory";
  addButton.addEventListener("click", () => {
    menu.remove();
    beginInlineSubcategoryCreate(category);
  });

  const renameButton = document.createElement("button");
  renameButton.type = "button";
  renameButton.textContent = "Rename";
  renameButton.disabled = category.locked || !category.id;
  renameButton.addEventListener("click", () => {
    menu.remove();
    beginInlineCategoryRename(category);
  });

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.textContent = "Delete category";
  deleteButton.disabled = category.locked || !category.id;
  deleteButton.addEventListener("click", async () => {
    menu.remove();
    if (!window.confirm(`Delete category "${category.name}"? Papers in it will move to Uncategorized.`)) return;
    await updateCategory({ action: "delete", id: category.id });
  });

  menu.append(addButton, renameButton, deleteButton);
  document.body.appendChild(menu);
  positionMenu(menu, anchor, 190);
}

function getCategoryRow(categoryId) {
  return Array.from(categoryTree.querySelectorAll(".category-row[data-category-id]")).find((row) => row.dataset.categoryId === categoryId) || null;
}

function createCategoryInlineInput(value, label) {
  const input = document.createElement("input");
  input.className = "category-inline-input";
  input.type = "text";
  input.value = value;
  input.maxLength = 80;
  input.placeholder = label;
  input.setAttribute("aria-label", label);
  return input;
}

function normalizedCategoryName(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 80);
}

function beginInlineCategoryRename(category) {
  const row = getCategoryRow(category.id);
  const button = row?.querySelector(".category-item");
  if (!row || !button) return;

  document.querySelector(".category-create-row")?.remove();
  const input = createCategoryInlineInput(category.name, "分类名称");
  button.replaceWith(input);
  input.focus();
  input.select();

  let finished = false;
  const finish = async (save) => {
    if (finished) return;
    finished = true;
    const name = normalizedCategoryName(input.value);
    if (save && name && name !== category.name) {
      const updated = await updateCategory({ action: "rename", id: category.id, name });
      if (!updated) renderLibrary();
      return;
    }
    renderLibrary();
  };

  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
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

function beginInlineSubcategoryCreate(category) {
  document.querySelector(".category-create-row")?.remove();
  const parentRow = getCategoryRow(category.id);
  if (!parentRow) return;

  const editorRow = document.createElement("div");
  editorRow.className = "category-row category-create-row";
  editorRow.style.paddingLeft = `${(category.depth + 1) * 18}px`;
  const input = createCategoryInlineInput("", "新建子分类名称");
  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "category-inline-cancel";
  cancelButton.textContent = "×";
  cancelButton.setAttribute("aria-label", "取消新建分类");
  editorRow.append(input, cancelButton);
  parentRow.after(editorRow);
  input.focus();

  let finished = false;
  const finish = async (save) => {
    if (finished) return;
    finished = true;
    const name = normalizedCategoryName(input.value);
    if (save && name) {
      const created = await updateCategory({ action: "create", parentId: category.id, name });
      if (!created) renderLibrary();
      return;
    }
    editorRow.remove();
  };

  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  });
  input.addEventListener("blur", () => finish(true));
  cancelButton.addEventListener("mousedown", (event) => event.preventDefault());
  cancelButton.addEventListener("click", () => finish(false));
}

function showPaperMenu(paper, anchor) {
  document.querySelector(".library-menu")?.remove();
  const menu = document.createElement("div");
  menu.className = "paper-menu library-menu";

  const tagsButton = document.createElement("button");
  tagsButton.type = "button";
  tagsButton.textContent = "Manage tags";
  tagsButton.addEventListener("click", () => {
    menu.remove();
    showPaperTagEditor(paper, anchor);
  });

  const moveButton = document.createElement("button");
  moveButton.type = "button";
  moveButton.textContent = "Move category";
  moveButton.addEventListener("click", () => {
    menu.remove();
    showMovePaperMenu(paper, anchor);
  });

  const exportLink = document.createElement("a");
  exportLink.href = `${apiBaseUrl || ""}/api/library/export?id=${encodeURIComponent(paper.id)}`;
  exportLink.download = `${paper.title || "paper"}-export.pdf`;
  exportLink.textContent = "Export";
  exportLink.addEventListener("click", async (event) => {
    event.preventDefault();
    menu.remove();
    await ensureApiBase();
    const link = document.createElement("a");
    link.href = `${apiBaseUrl || ""}/api/library/export?id=${encodeURIComponent(paper.id)}`;
    link.download = `${paper.title || "paper"}-export.pdf`;
    link.click();
  });

  const revealButton = document.createElement("button");
  revealButton.type = "button";
  revealButton.textContent = "Show in folder";
  revealButton.addEventListener("click", async () => {
    menu.remove();
    await revealPaperInFolder(paper.id);
  });

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.textContent = "Delete paper";
  deleteButton.addEventListener("click", async () => {
    menu.remove();
    if (!window.confirm(`Delete paper "${paper.title}"?`)) return;
    await updatePaper({ action: "delete", id: paper.id });
  });

  menu.append(tagsButton, moveButton, exportLink, revealButton, deleteButton);
  document.body.appendChild(menu);
  positionMenu(menu, anchor, 190);
}

function showPaperTagEditor(paper, anchor) {
  document.querySelector(".library-menu")?.remove();
  const menu = document.createElement("div");
  menu.className = "paper-menu tag-editor-menu library-menu";
  document.body.appendChild(menu);
  positionMenu(menu, anchor, 290);
  renderPaperTagEditor(menu, paper);
}

function renderPaperTagEditor(menu, paper) {
  const tags = normalizePaperTags(paper.tags);
  menu.innerHTML = "";

  const heading = document.createElement("div");
  heading.className = "move-menu-heading";
  heading.textContent = "Tags";
  menu.appendChild(heading);

  const list = document.createElement("div");
  list.className = "tag-editor-list";
  if (!tags.length) {
    const empty = document.createElement("span");
    empty.className = "tag-editor-empty";
    empty.textContent = "No tags yet";
    list.appendChild(empty);
  }
  tags.forEach((tag) => {
    const row = document.createElement("div");
    row.className = "tag-editor-row";
    const color = document.createElement("input");
    color.type = "color";
    color.value = tag.color;
    color.setAttribute("aria-label", `${tag.name} color`);
    color.addEventListener("change", async () => {
      await savePaperTagsFromEditor(menu, paper, tags.map((item) => (item.name === tag.name ? { ...item, color: color.value } : item)));
    });
    const name = document.createElement("span");
    name.textContent = tag.name;
    name.title = tag.name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "tag-remove-button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove ${tag.name}`);
    remove.addEventListener("click", async () => {
      await savePaperTagsFromEditor(menu, paper, tags.filter((item) => item.name !== tag.name));
    });
    row.append(color, name, remove);
    list.appendChild(row);
  });

  const addRow = document.createElement("div");
  addRow.className = "tag-editor-add-row";
  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = 48;
  input.placeholder = "New tag";
  input.setAttribute("aria-label", "New tag name");
  const color = document.createElement("input");
  color.type = "color";
  color.value = "#2c758c";
  color.setAttribute("aria-label", "New tag color");
  const add = document.createElement("button");
  add.type = "button";
  add.textContent = "Add";
  const submit = async () => {
    const name = input.value.replace(/\s+/g, " ").trim().slice(0, 48);
    if (!name) return;
    const existing = tags.find((tag) => tag.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    const next = existing
      ? tags.map((tag) => (tag === existing ? { ...tag, color: color.value } : tag))
      : [...tags, { name, color: color.value }];
    await savePaperTagsFromEditor(menu, paper, next);
  };
  add.addEventListener("click", submit);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  });
  addRow.append(input, color, add);
  menu.append(list, addRow);
}

async function savePaperTagsFromEditor(menu, paper, tags) {
  const saved = await savePaperTags(paper.id, tags);
  if (!saved) return;
  paper.tags = normalizePaperTags(saved.tags);
  renderLibrary();
  renderPaperTagEditor(menu, paper);
}

async function savePaperTags(paperId, tags) {
  try {
    const response = await apiFetch("/api/library/paper", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: paperId, tags: normalizePaperTags(tags) }),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.error || "Failed to save tags.");
    if (data.tree) libraryTree = data.tree;
    setLibraryStatus("Tags saved.");
    reportSyncResult(data.sync);
    return data.paper;
  } catch (error) {
    console.error(error);
    setLibraryStatus(error.message || "Failed to save tags.", true);
    return null;
  }
}

async function revealPaperInFolder(paperId) {
  try {
    const response = await apiFetch("/api/library/paper", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reveal", id: paperId }),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.error || "Failed to show the paper in its folder.");
    setLibraryStatus("Opened the paper in File Explorer.");
  } catch (error) {
    console.error(error);
    setLibraryStatus(error.message || "Failed to show the paper in its folder.", true);
  }
}

function showMovePaperMenu(paper, anchor) {
  document.querySelector(".library-menu")?.remove();
  const menu = document.createElement("div");
  menu.className = "paper-menu move-paper-menu library-menu";

  const heading = document.createElement("div");
  heading.className = "move-menu-heading";
  heading.textContent = "Move to category";
  menu.appendChild(heading);

  flattenCategories(libraryTree)
    .filter((category) => category.id !== RECENT_CATEGORY_ID)
    .forEach((category) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "move-category-option";
      button.style.paddingLeft = `${14 + category.depth * 14}px`;
      button.disabled = category.id === paper.category;
      button.textContent = category.id ? category.name : UNCATEGORIZED_LABEL;
      button.addEventListener("click", async () => {
        menu.remove();
        await updatePaper({ action: "move", id: paper.id, category: category.id || UNCATEGORIZED_LABEL });
      });
      menu.appendChild(button);
    });

  const customButton = document.createElement("button");
  customButton.type = "button";
  customButton.className = "move-category-custom";
  customButton.textContent = "Enter new category...";
  customButton.addEventListener("click", async () => {
    menu.remove();
    const category = window.prompt("Target category / subfolder", paper.categoryName || paper.category || UNCATEGORIZED_LABEL);
    if (!category?.trim()) return;
    await updatePaper({ action: "move", id: paper.id, category: category.trim() });
  });
  menu.appendChild(customButton);

  document.body.appendChild(menu);
  positionMenu(menu, anchor, 260);
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
      return false;
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
    return true;
  } catch (error) {
    console.error(error);
    setLibraryStatus(error.message || "Category operation failed.", true);
    return false;
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

function flattenCategories(node, depth = 0, parentId = "") {
  if (!node) return [];
  const current = {
    id: node.id || "",
    name: node.name || "Library",
    depth,
    parentId,
    locked: Boolean(node.locked),
    paperCount: collectPapers(node).length,
    papers: node.papers || [],
  };
  return [current, ...(node.folders || []).flatMap((folder) => flattenCategories(folder, depth + 1, current.id))];
}

function collectPapers(node) {
  if (!node) return [];
  return [...(node.papers || []), ...(node.folders || []).flatMap(collectPapers)];
}

function filterPapers(papers, query, tagNames = new Set()) {
  return papers.filter((paper) => {
    const tags = normalizePaperTags(paper.tags);
    const matchesTags = !tagNames.size || Array.from(tagNames).every((tagName) => tags.some((tag) => tag.name.toLocaleLowerCase() === tagName));
    if (!matchesTags) return false;
    if (!query) return true;
    const haystack = [paper.title, paper.category, paper.categoryName, ...tags.map((tag) => tag.name), ...(Array.isArray(paper.keywords) ? paper.keywords : [])]
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
          extraParams: parseApiExtraParams(aiExtraParamsInput.value, "Unified API extra parameters"),
          tasks: collectAiTaskSettings(),
        },
        web: {
          discussionUrl: discussionWebUrlInput.value.trim(),
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
    aiApiKeyInput.value = "";
    aiTaskConfigSections.forEach((section) => {
      section.querySelector("[data-ai-task-api-key]").value = "";
    });
    cloudPasswordInput.value = "";
    closeCloudConfig();
    setLibraryStatus("Settings saved.");
  } catch (error) {
    console.error(error);
    setLibraryStatus(error.message || "Settings save failed.", true);
  } finally {
    setCloudSyncBusy(false);
  }
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
  const web = settings?.web || {};
  aiBaseUrlInput.value = ai.baseUrl || "";
  aiModelInput.value = ai.model || "";
  aiApiKeyInput.placeholder = ai.hasApiKey ? maskSecretTail(ai.apiKeyTail) : "Paste API key";
  aiExtraParamsInput.value = formatApiExtraParams(ai.extraParams);
  renderAiTaskSettings(ai.tasks || {});
  discussionWebUrlInput.value = web.discussionUrl || "https://chatgpt.com/";
  cloudProviderSelect.value = sync.provider === "webdav" ? "webdav" : "local";
  cloudLocalDirInput.value = sync.localDir || "";
  cloudWebdavUrlInput.value = sync.webdavUrl || "";
  cloudUsernameInput.value = sync.username || "";
  cloudPasswordInput.placeholder = sync.hasPassword ? maskSecretTail(sync.passwordTail) : "Paste password / app password";
  cloudAutoPushInput.checked = Boolean(sync.autoSync);
}

function collectAiTaskSettings() {
  return Object.fromEntries(
    aiTaskConfigSections.map((section) => [
      section.dataset.aiTask,
      {
        useDefault: section.querySelector("[data-ai-task-default]").checked,
        baseUrl: section.querySelector("[data-ai-task-base-url]").value.trim(),
        model: section.querySelector("[data-ai-task-model]").value.trim(),
        apiKey: section.querySelector("[data-ai-task-api-key]").value,
        extraParams: parseApiExtraParams(
          section.querySelector("[data-ai-task-extra-params]").value,
          `${section.querySelector("strong").textContent} API extra parameters`,
        ),
      },
    ]),
  );
}

function renderAiTaskSettings(tasks) {
  aiTaskConfigSections.forEach((section) => {
    const task = tasks?.[section.dataset.aiTask] || {};
    section.querySelector("[data-ai-task-default]").checked = task.useDefault !== false;
    section.querySelector("[data-ai-task-base-url]").value = task.baseUrl || "";
    section.querySelector("[data-ai-task-model]").value = task.model || "";
    section.querySelector("[data-ai-task-extra-params]").value = formatApiExtraParams(task.extraParams);
    const apiKeyInput = section.querySelector("[data-ai-task-api-key]");
    apiKeyInput.placeholder = task.hasApiKey ? maskSecretTail(task.apiKeyTail) : "Leave blank to use unified key";
    updateAiTaskSection(section);
  });
}

function updateAiTaskSection(section) {
  const useDefault = section.querySelector("[data-ai-task-default]").checked;
  section.classList.toggle("uses-default", useDefault);
  section.querySelectorAll("[data-ai-task-base-url], [data-ai-task-model], [data-ai-task-api-key], [data-ai-task-extra-params]").forEach((input) => {
    input.disabled = useDefault;
  });
}

function parseApiExtraParams(value, label) {
  const text = value.trim();
  if (!text) return {};
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error(`${label} must be a JSON object.`);
  }
  const reserved = ["model", "messages", "stream", "response_format"].filter((key) => key in parsed);
  if (reserved.length) {
    throw new Error(`${label} cannot override: ${reserved.join(", ")}.`);
  }
  return parsed;
}

function formatApiExtraParams(params) {
  return params && typeof params === "object" && !Array.isArray(params) && Object.keys(params).length
    ? JSON.stringify(params, null, 2)
    : "";
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
  if (url === "/api/library/arxiv") {
    throw new Error("arXiv upload API is not available. Restart python server.py so the new backend route is loaded.");
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
