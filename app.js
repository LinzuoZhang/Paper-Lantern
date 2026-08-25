const libraryRoot = document.querySelector("#libraryRoot");
const libraryStatus = document.querySelector("#libraryStatus");
const categoryTree = document.querySelector("#categoryTree");
const paperList = document.querySelector("#paperList");
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
const LEGACY_RECENT_PAPERS_KEY = "openMoonlightRecentPapers";
const RECENT_PAPERS_KEY = "paperLanternRecentPapers";
const UNCATEGORIZED_LABEL = "Uncategorized";

let libraryTree = null;
let selectedCategoryId = "";
let apiBaseUrl = "";
let searchQuery = "";
let arxivDownloadOverlayTimer = null;

loadLibrary();
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

async function uploadArxivPaper(arxivId) {
  setLibraryStatus("Downloading arXiv PDF...");
  showArxivDownloadOverlay("Downloading arXiv PDF...", arxivId);
  arxivUploadButton.disabled = true;
  try {
    const response = await apiFetch("/api/library/arxiv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ arxivId, category: getActiveUploadCategory() }),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) {
      setLibraryStatus(data.detail || data.error || "arXiv upload failed.", true);
      showArxivDownloadOverlay(data.detail || data.error || "arXiv upload failed.", arxivId, true);
      return;
    }
    reportSyncResult(data.sync);
    showArxivDownloadOverlay("Opening paper...", arxivId);
    openPaperReader(data.paper.id, true);
  } catch (error) {
    console.error(error);
    setLibraryStatus(error.message || "arXiv upload failed.", true);
    showArxivDownloadOverlay(error.message || "arXiv upload failed.", arxivId, true);
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
  overlay.querySelector(".arxiv-download-detail").textContent = arxivId ? `arXiv: ${arxivId}` : "";
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
  categoryTree.innerHTML = "";
  paperList.innerHTML = "";
  const categories = flattenCategories(libraryTree);
  renderRecentCategory();
  categories.forEach((category) => renderCategoryRow(category));

  const allPapers = collectPapers(libraryTree);
  let papers = [];
  if (selectedCategoryId === RECENT_CATEGORY_ID) {
    currentCategoryName.textContent = "Recent Papers";
    papers = getRecentPapers(allPapers);
  } else {
    const selected = categories.find((category) => category.id === selectedCategoryId) || categories[0];
    currentCategoryName.textContent = selected?.id ? selected.name : "All Papers";
    papers = selectedCategoryId ? selected?.papers || [] : allPapers;
  }
  renderPaperList(filterPapers(papers, searchQuery));
}

function renderCategoryRow(category) {
  const row = document.createElement("div");
  row.className = "category-row";
  row.style.paddingLeft = `${category.depth * 18}px`;

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

  papers.forEach((paper) => {
    const viewedAt = paper.viewedAt || getPaperViewedAt(paper.id);
    const card = document.createElement("article");
    card.className = "paper-card";
    card.tabIndex = 0;
    card.addEventListener("click", () => openPaperReader(paper.id));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter") openPaperReader(paper.id);
    });

    const title = document.createElement("h3");
    title.textContent = paper.title;

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

function showCategoryMenu(category, anchor) {
  document.querySelector(".category-menu")?.remove();
  const menu = document.createElement("div");
  menu.className = "category-menu library-menu";

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.textContent = "Add subcategory";
  addButton.addEventListener("click", async () => {
    menu.remove();
    const name = window.prompt("Subcategory name");
    if (!name?.trim()) return;
    await updateCategory({ action: "create", parentId: category.id, name: name.trim() });
  });

  const renameButton = document.createElement("button");
  renameButton.type = "button";
  renameButton.textContent = "Rename";
  renameButton.disabled = category.locked || !category.id;
  renameButton.addEventListener("click", async () => {
    menu.remove();
    const name = window.prompt("New category name", category.name);
    if (!name?.trim() || name.trim() === category.name) return;
    await updateCategory({ action: "rename", id: category.id, name: name.trim() });
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

function showPaperMenu(paper, anchor) {
  document.querySelector(".library-menu")?.remove();
  const menu = document.createElement("div");
  menu.className = "paper-menu library-menu";

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

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.textContent = "Delete paper";
  deleteButton.addEventListener("click", async () => {
    menu.remove();
    if (!window.confirm(`Delete paper "${paper.title}"?`)) return;
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
    aiApiKeyInput.value = "";
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
