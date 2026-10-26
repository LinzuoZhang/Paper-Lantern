import { initSettingsModal } from "../components/settings_modal.js";
import { initPaperFlags, applyPaperFlagUpdates } from "../components/paper_flags.js";
import { initPaperFlagFilter } from "../components/paper_flag_filter.js";
import { getCategoryIds, getCategoryLabels, collectUniquePapers, categorySearchText, showCategoryManager } from "../components/category_manager.js";
import {
  RECENT_PAPERS_KEY,
  getPaperViewedAt,
  getRecentPaperRecords,
  getRecentPapers,
  migrateLegacyRecentPapers,
  recordPaperViewed,
} from "../lib/recent_papers.js";

const libraryView = document.querySelector("#libraryView");
const libraryRoot = document.querySelector("#libraryRoot");
const libraryLayout = document.querySelector(".library-layout");
const categoryPanel = document.querySelector(".category-panel");
const libraryLayoutResizer = document.querySelector("#libraryLayoutResizer");
const paperInfoResizer = document.querySelector("#paperInfoResizer");
const libraryStatus = document.querySelector("#libraryStatus");
const categoryTree = document.querySelector("#categoryTree");
const categoryTopRows = document.querySelector("#categoryTopRows");
const categoryMainRows = document.querySelector("#categoryMainRows");
const paperList = document.querySelector("#paperList");
const paperInfoPanel = document.querySelector("#paperInfoPanel");
const currentCategoryName = document.querySelector("#currentCategoryName");
const paperBulkToolbar = document.querySelector("#paperBulkToolbar");
const paperBulkCount = document.querySelector("#paperBulkCount");
const paperBulkFlagsButton = document.querySelector("#paperBulkFlagsButton");
const paperBulkMoveButton = document.querySelector("#paperBulkMoveButton");
const paperBulkDeleteButton = document.querySelector("#paperBulkDeleteButton");
const librarySearchInput = document.querySelector("#librarySearchInput");
const uploadForm = document.querySelector("#uploadForm");
const libraryPdfInput = document.querySelector("#libraryPdfInput");
const uploadMenuButton = document.querySelector("#uploadMenuButton");
const createNoteButton = document.querySelector("#createNoteButton");
const uploadMenu = document.querySelector("#uploadMenu");
const arxivUploadInput = document.querySelector("#arxivUploadInput");
const arxivUploadButton = document.querySelector("#arxivUploadButton");
const cloudSyncStatus = document.querySelector("#cloudSyncStatus");
const settingsButton = document.querySelector("#settingsButton");
const cloudSyncButton = document.querySelector("#cloudSyncButton");
const libCitationOverlay = document.querySelector("#libCitationOverlay");
const libCitationOverlayTitle = document.querySelector("#libCitationOverlayTitle");
const libCitationOverlayMeta = document.querySelector("#libCitationOverlayMeta");
const libCitationOverlayCloseButton = document.querySelector("#libCitationOverlayCloseButton");
const libCitationFormatSelect = document.querySelector("#libCitationFormatSelect");
const libCitationCopyButton = document.querySelector("#libCitationCopyButton");
const libCitationOutput = document.querySelector("#libCitationOutput");

const RECENT_CATEGORY_ID = "__recent";
const TODO_CATEGORY_ID = "__todo";
const UNCATEGORIZED_LABEL = "Uncategorized";
const LIBRARY_CATEGORY_PANEL_WIDTH_KEY = "paperLanternLibraryCategoryPanelWidth";
const LIBRARY_INFO_PANEL_WIDTH_KEY = "paperLanternLibraryInfoPanelWidth";

const recentCategoryIconSvg =
  '<svg class="category-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path></svg>';
const libraryCategoryIconSvg =
  '<svg class="category-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>';
const folderCategoryIconSvg =
  '<svg class="category-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>';
const todoCategoryIconSvg =
  '<svg class="category-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path></svg>';
const plusCircleSvg =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"></circle><path d="M12 8v8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path><path d="M8 12h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>';
const noteItemSvg =
  '<svg class="paper-title-type-icon note-type-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>';
const paperItemSvg =
  '<svg class="paper-title-type-icon paper-type-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h8l4 4v16H6z"></path><path d="M14 2v5h5"></path><path d="M9 12h6M9 16h6"></path></svg>';

let libraryTree = null;
let selectedCategoryId = RECENT_CATEGORY_ID;
let apiBaseUrl = "";
let paperSort = { key: "uploadedAt", dir: "desc" };

function sortPapers(papers) {
  const { key, dir } = paperSort;
  const sign = dir === "asc" ? 1 : -1;
  const list = [...papers];
  const recentRecords = key === "lastRead" ? getRecentPaperRecords() : [];
  list.sort((a, b) => {
    if (key === "title") {
      const va = String(a.title || "").toLowerCase();
      const vb = String(b.title || "").toLowerCase();
      return sign * va.localeCompare(vb);
    }
    const rawA = key === "lastRead" ? getPaperViewedAt(a, recentRecords) : a.uploadedAt;
    const rawB = key === "lastRead" ? getPaperViewedAt(b, recentRecords) : b.uploadedAt;
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
let flagFilterPapers = [];
let libraryDragState = null;
let libraryFileDragDepth = 0;
let arxivDownloadOverlayTimer = null;
let cloudSyncProgressHideTimer = null;
let cloudSyncProgressPollTimer = null;
let cloudSyncProgressValue = 0;
let cloudSyncCancelRequested = false;
let libCitationFormats = null;
let libCitationFormat = "gbt7714";
const selectedPaperIds = new Set();
let paperBulkBusy = false;
const paperFlags = initPaperFlags({
  apiFetch,
  readJsonResponse,
  getPapers: () => collectPapers(libraryTree),
  onBulkBusyChange: setPaperBulkBusy,
  onChange: data => {
    if (data.tree) libraryTree = data.tree;
    else applyPaperFlagUpdates(libraryTree, data.papers || [data.paper]);
  },
  onClose: ({ changed, paperId, restoreFocus, bulk }) => {
    if (!changed) return;
    renderLibrary();
    if (restoreFocus) {
      const row = [...paperList.querySelectorAll(".paper-table-row")].find(row => row.dataset.paperId === paperId);
      const target = bulk && !paperBulkFlagsButton?.disabled && !paperBulkToolbar.hidden
        ? paperBulkFlagsButton : row?.querySelector(".paper-flags-button");
      (target || categoryTree.querySelector(".category-item.active"))?.focus();
    }
  },
});

const paperFlagFilter = initPaperFlagFilter({
  getDefinitions: () => paperFlags.getDefinitions(),
  getPapers: () => flagFilterPapers,
  getAllPapers: () => collectPapers(libraryTree),
  onBeforeOpen: () => paperFlags.close({ restoreFocus: false }),
  onChange: () => {
    clearPaperSelection();
    renderLibrary({ preserveFlagFilter: true });
  },
});

migrateLegacyRecentPapers();
loadLibrary();
initLibraryLayoutResize();
initPaperInfoPanelResize();
initLibraryCitationOverlay();
loadCloudSyncStatus();
window.addEventListener("storage", (event) => {
  if (event.key === RECENT_PAPERS_KEY && libraryTree) renderLibrary();
});
window.addEventListener("focus", () => {
  loadLibrary();
});
initSettingsModal({
  openButtons: ["#settingsButton"],
  autoOpen: { queryParam: "settings" },
  setBusy: setCloudSyncBusy,
  setStatus: setLibraryStatus,
  onSettingsSaved: renderCloudSyncStatus,
});

function initLibraryLayoutResize() {
  if (!libraryLayout || !categoryPanel || !libraryLayoutResizer) return;
  applySavedLibraryCategoryPanelWidth();
  window.addEventListener("resize", applySavedLibraryCategoryPanelWidth);

  libraryLayoutResizer.addEventListener("pointerdown", (event) => {
    if (!isLibraryLayoutResizable()) return;
    event.preventDefault();
    const onMove = (moveEvent) => {
      setLibraryCategoryPanelWidth(moveEvent.clientX - libraryLayout.getBoundingClientRect().left);
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.classList.remove("resizing-library-layout");
      const width = Math.round(categoryPanel.getBoundingClientRect().width);
      localStorage.setItem(LIBRARY_CATEGORY_PANEL_WIDTH_KEY, String(width));
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.body.classList.add("resizing-library-layout");
  });
}

function applySavedLibraryCategoryPanelWidth() {
  if (!categoryPanel) return;
  if (!isLibraryLayoutResizable()) {
    categoryPanel.style.width = "";
    categoryPanel.style.flexBasis = "";
    return;
  }
  const savedWidth = Number(localStorage.getItem(LIBRARY_CATEGORY_PANEL_WIDTH_KEY));
  if (Number.isFinite(savedWidth) && savedWidth > 0) setLibraryCategoryPanelWidth(savedWidth);
}

function isLibraryLayoutResizable() {
  return window.matchMedia("(min-width: 901px)").matches;
}

function setLibraryCategoryPanelWidth(width) {
  if (!libraryLayout || !categoryPanel) return;
  const layoutWidth = libraryLayout.getBoundingClientRect().width || window.innerWidth;
  const maxWidth = Math.min(520, Math.max(260, layoutWidth * 0.45));
  const nextWidth = Math.round(Math.min(Math.max(Number(width) || 280, 220), maxWidth));
  categoryPanel.style.width = `${nextWidth}px`;
  categoryPanel.style.flexBasis = `${nextWidth}px`;
}

function initPaperInfoPanelResize() {
  if (!libraryLayout || !paperInfoPanel || !paperInfoResizer) return;
  applySavedPaperInfoPanelWidth();
  window.addEventListener("resize", applySavedPaperInfoPanelWidth);

  paperInfoResizer.addEventListener("pointerdown", (event) => {
    if (!isLibraryLayoutResizable()) return;
    event.preventDefault();
    const onMove = (moveEvent) => {
      setPaperInfoPanelWidth(libraryLayout.getBoundingClientRect().right - moveEvent.clientX);
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.classList.remove("resizing-paper-info");
      const width = Math.round(paperInfoPanel.getBoundingClientRect().width);
      localStorage.setItem(LIBRARY_INFO_PANEL_WIDTH_KEY, String(width));
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.body.classList.add("resizing-paper-info");
  });
}

function applySavedPaperInfoPanelWidth() {
  if (!paperInfoPanel) return;
  if (!isLibraryLayoutResizable()) {
    paperInfoPanel.style.width = "";
    paperInfoPanel.style.flexBasis = "";
    return;
  }
  const savedWidth = Number(localStorage.getItem(LIBRARY_INFO_PANEL_WIDTH_KEY));
  if (Number.isFinite(savedWidth) && savedWidth > 0) setPaperInfoPanelWidth(savedWidth);
}

function setPaperInfoPanelWidth(width) {
  if (!libraryLayout || !paperInfoPanel) return;
  const layoutWidth = libraryLayout.getBoundingClientRect().width || window.innerWidth;
  const categoryWidth = categoryPanel?.getBoundingClientRect().width || 280;
  const resizerWidth = (libraryLayoutResizer?.getBoundingClientRect().width || 0) + (paperInfoResizer?.getBoundingClientRect().width || 0);
  const maxWidth = Math.min(560, Math.max(280, layoutWidth - categoryWidth - resizerWidth - 420));
  const nextWidth = Math.round(Math.min(Math.max(Number(width) || 340, 280), maxWidth));
  paperInfoPanel.style.width = `${nextWidth}px`;
  paperInfoPanel.style.flexBasis = `${nextWidth}px`;
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

createNoteButton?.addEventListener("click", createLibraryNote);

async function createLibraryNote() {
  createNoteButton.disabled = true;
  try {
    const response = await apiFetch("/api/library/note", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "新建笔记", categoryIds: [getActiveUploadCategory()] }),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.error || "新建笔记失败。");
    const note = data.note;
    if (!note?.id) throw new Error("新建笔记失败：服务器未返回笔记编号。");
    window.location.href = `./note.html?${new URLSearchParams({ id: note.id }).toString()}`;
  } catch (error) {
    console.error(error);
    setLibraryStatus(error.message || "新建笔记失败。", true);
  } finally {
    createNoteButton.disabled = false;
  }
}

uploadForm.addEventListener("submit", (event) => {
  event.preventDefault();
});

arxivUploadButton.addEventListener("click", async () => {
  const source = arxivUploadInput.value;
  if (!source?.trim()) return;
  closeUploadMenu();
  await uploadRemotePdf(source.trim());
  arxivUploadInput.value = "";
});

librarySearchInput.addEventListener("input", () => {
  clearPaperSelection();
  searchQuery = librarySearchInput.value.trim().toLowerCase();
  renderLibrary();
});

paperBulkMoveButton?.addEventListener("click", () => {
  const papers = getSelectedPapers();
  if (papers.length) showMovePaperMenu(papers, paperBulkMoveButton);
});

paperBulkDeleteButton?.addEventListener("click", deleteSelectedPapers);
paperBulkFlagsButton?.addEventListener("click", (event) => {
  event.stopPropagation();
  const papers = getSelectedPapers();
  if (papers.length && !paperBulkBusy) paperFlags.openBulk(paperBulkFlagsButton, papers);
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || event.defaultPrevented || paperBulkBusy) return;
  const menu = document.querySelector(".library-menu");
  if (menu) {
    menu.remove();
    return;
  }
  if (selectedPaperIds.size) clearPaperSelection();
});

cloudSyncButton.addEventListener("click", async () => {
  await runCloudSync();
});

uploadForm.addEventListener("dragenter", handleUploadDrag);
uploadForm.addEventListener("dragover", handleUploadDrag);
uploadForm.addEventListener("dragleave", (event) => {
  if (!uploadForm.contains(event.relatedTarget)) uploadForm.classList.remove("drag-over");
});
uploadForm.addEventListener("drop", async (event) => {
  event.preventDefault();
  event.stopPropagation();
  uploadForm.classList.remove("drag-over");
  const file = getDroppedPdfFile(event.dataTransfer);
  if (!file) {
    setLibraryStatus("Please drop a PDF file.", true);
    return;
  }
  await handlePdfUpload(file);
  uploadForm.reset();
});

libraryView?.addEventListener("dragenter", handleLibraryFileDragEnter);
libraryView?.addEventListener("dragover", handleLibraryFileDragOver);
libraryView?.addEventListener("dragleave", handleLibraryFileDragLeave);
libraryView?.addEventListener("drop", handleLibraryFileDrop);

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
  if (hasExternalFileDrag(event.dataTransfer)) {
    uploadForm.classList.add("drag-over");
  }
}

function handleLibraryFileDragEnter(event) {
  if (!hasExternalFileDrag(event.dataTransfer)) return;
  event.preventDefault();
  libraryFileDragDepth += 1;
  libraryView?.classList.add("library-file-drag-over");
}

function handleLibraryFileDragOver(event) {
  if (!hasExternalFileDrag(event.dataTransfer)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  libraryView?.classList.add("library-file-drag-over");
}

function handleLibraryFileDragLeave(event) {
  if (!hasExternalFileDrag(event.dataTransfer)) return;
  event.preventDefault();
  libraryFileDragDepth = Math.max(0, libraryFileDragDepth - 1);
  if (!libraryFileDragDepth) libraryView?.classList.remove("library-file-drag-over");
}

async function handleLibraryFileDrop(event) {
  if (!hasExternalFileDrag(event.dataTransfer)) return;
  event.preventDefault();
  clearLibraryFileDragState();
  const file = getDroppedPdfFile(event.dataTransfer);
  if (!file) {
    setLibraryStatus("请拖入 PDF 文件。", true);
    return;
  }
  closeUploadMenu();
  await handlePdfUpload(file);
  uploadForm.reset();
}

function clearLibraryFileDragState() {
  libraryFileDragDepth = 0;
  libraryView?.classList.remove("library-file-drag-over");
  uploadForm.classList.remove("drag-over");
}

function hasExternalFileDrag(dataTransfer) {
  if (!dataTransfer) return false;
  if (libraryDragState) return false;
  const types = Array.from(dataTransfer.types || []);
  if (!types.includes("Files")) return false;
  return Array.from(dataTransfer.items || []).some((item) => item.kind === "file");
}

function getDroppedPdfFile(dataTransfer) {
  return Array.from(dataTransfer?.files || []).find((item) => item.type === "application/pdf" || /\.pdf$/i.test(item.name));
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
    formData.append("categoryIds", JSON.stringify([category || UNCATEGORIZED_LABEL]));
    const response = await apiFetch("/api/library/upload", { method: "POST", body: formData });
    const data = await readJsonResponse(response);
    if (!response.ok) {
      setLibraryStatus(data.error || "Upload failed.", true);
      return;
    }
    reportSyncResult(data.sync);
    libraryTree = data.tree || libraryTree;
    openPaperReader(data.paper.id);
  } catch (error) {
    console.error(error);
    setLibraryStatus(error.message || "Upload failed.", true);
  }
}

async function uploadRemotePdf(source) {
  setLibraryStatus("Starting PDF import...");
  showArxivDownloadOverlay("Starting PDF import...", source);
  arxivUploadButton.disabled = true;
  try {
    const response = await apiFetch("/api/library/import/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdfUrl: source, categoryIds: [getActiveUploadCategory()] }),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) {
      setLibraryStatus(data.detail || data.error || "PDF import failed.", true);
      showArxivDownloadOverlay(data.detail || data.error || "PDF import failed.", source, true);
      return;
    }
    let job = data.job;
    if (!job?.jobId) throw new Error("Import API did not return a job id.");
    while (!["completed", "failed", "cancelled"].includes(job.state)) {
      showImportJobProgress(job, source);
      await new Promise((resolve) => window.setTimeout(resolve, 650));
      const statusResponse = await apiFetch(`/api/library/import/status?${new URLSearchParams({ jobId: job.jobId })}`);
      const statusData = await readJsonResponse(statusResponse);
      if (!statusResponse.ok) throw new Error(statusData.error || "Unable to read import status.");
      job = statusData.job;
    }
    if (job.state !== "completed") {
      const message = job.error || (job.state === "cancelled" ? "PDF import cancelled." : "PDF import failed.");
      setLibraryStatus(message, true);
      showArxivDownloadOverlay(message, `Job ${job.jobId}`, true);
      return;
    }
    showArxivDownloadOverlay("Opening paper...", source);
    const libraryResponse = await apiFetch("/api/library");
    const libraryData = await readJsonResponse(libraryResponse);
    if (libraryResponse.ok) libraryTree = libraryData.tree || libraryTree;
    openPaperReader(job.paperId);
  } catch (error) {
    console.error(error);
    setLibraryStatus(error.message || "PDF import failed.", true);
    showArxivDownloadOverlay(error.message || "PDF import failed.", source, true);
  } finally {
    arxivUploadButton.disabled = false;
  }
}

function showImportJobProgress(job, source) {
  const labels = {
    queued: "Queued...",
    resolving_metadata: "Resolving metadata...",
    downloading: "Downloading PDF...",
    validating_pdf: "Validating PDF...",
    deduplicating: "Checking for duplicates...",
    writing_library: "Writing to library...",
  };
  const bytes = Number(job.downloadedBytes || 0);
  const total = Number(job.totalBytes || 0);
  const progress = bytes > 0
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB${total > 0 ? ` / ${(total / 1024 / 1024).toFixed(1)} MB` : ""}`
    : source;
  showArxivDownloadOverlay(labels[job.stage] || "Importing PDF...", progress);
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
  return selectedCategoryId && ![RECENT_CATEGORY_ID, TODO_CATEGORY_ID].includes(selectedCategoryId)
    ? selectedCategoryId
    : UNCATEGORIZED_LABEL;
}

function openPaperReader(paperId) {
  recordPaperViewed(paperId);
  if (libraryTree) renderLibrary();
  window.open(`./reader.html?${new URLSearchParams({ id: paperId }).toString()}`, "_blank", "noopener,noreferrer");
}

function openLibraryItem(item) {
  if (item?.itemType === "note") {
    window.open(`./note.html?${new URLSearchParams({ id: item.id }).toString()}`, "_blank", "noopener,noreferrer");
    return;
  }
  openPaperReader(item.id);
}

async function loadLibrary(focusPaperId = "") {
  try {
    const response = await apiFetch("/api/library");
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.error || "Failed to load library.");
    libraryTree = data.tree;
    paperFlags.setDefinitions(data.flags);
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

function renderLibrary({ preserveFlagFilter = false } = {}) {
  if (!preserveFlagFilter) paperFlagFilter.close({ restoreFocus: false });
  paperFlags.close({ restoreFocus: false, notify: false });
  // The search bar is a static child of the tree, so only clear the dynamic
  // rows — this keeps the search input mounted and focused while typing.
  categoryTopRows.innerHTML = "";
  categoryMainRows.innerHTML = "";
  paperList.innerHTML = "";
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
  flagFilterPapers = filterPapers(papers, searchQuery);
  const visiblePapers = paperFlagFilter.filter(flagFilterPapers);
  reconcilePaperSelection(visiblePapers);
  renderPaperList(visiblePapers);
  // In "最近", the list is always ordered by reading time, so the preview follows that order too.
  const previewPaper = selectedCategoryId === RECENT_CATEGORY_ID ? visiblePapers[0] : sortPapers(visiblePapers)[0];
  if (previewPaper) renderPaperInfoPanel(previewPaper);
  else renderPaperInfoEmpty();
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
  row.dataset.categoryId = node.id || "";
  row.style.paddingLeft = `${depth * 18}px`;
  initCategoryDragAndDrop(row, node);

  const hasChildren = Boolean(node.folders && node.folders.length);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "category-item";
  button.draggable = Boolean(node.id && !node.locked);
  button.addEventListener("dragstart", (event) => startCategoryDrag(event, node));
  button.addEventListener("dragend", clearLibraryDragFeedback);
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
  const label = document.createElement("span");
  label.className = "category-label";
  label.textContent = `${node.name} (${paperCount})`;
  button.title = label.textContent;
  button.appendChild(label);
  button.addEventListener("click", () => {
    clearPaperSelection();
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
    menuButton.textContent = "⋮";
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
  button.innerHTML = `${recentCategoryIconSvg}<span class="category-label">最近 (${getRecentPapers(collectPapers(libraryTree)).length})</span>`;
  button.addEventListener("click", () => {
    clearPaperSelection();
    selectedCategoryId = RECENT_CATEGORY_ID;
    renderLibrary();
  });

  row.appendChild(button);
  categoryTopRows.appendChild(row);
}

function renderTodoCategory() {
  const row = document.createElement("div");
  row.className = "category-row category-row-special category-row-special-flat";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "category-item recent-category-item";
  button.classList.toggle("active", selectedCategoryId === TODO_CATEGORY_ID);
  const count = (collectPapers(libraryTree) || []).filter((paper) => paper.todo).length;
  button.innerHTML = `${todoCategoryIconSvg}<span class="category-label">待办 (${count})</span>`;
  button.addEventListener("click", () => {
    clearPaperSelection();
    selectedCategoryId = TODO_CATEGORY_ID;
    renderLibrary();
  });

  row.appendChild(button);
  categoryTopRows.appendChild(row);
}

function startPaperDrag(event, paper) {
  libraryDragState = { type: "paper", id: paper.id };
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData("application/x-paperlantern-paper", paper.id);
  event.dataTransfer.setData("text/plain", paper.title || paper.id);
  event.currentTarget.classList.add("dragging");
}

function startCategoryDrag(event, category) {
  if (!category.id || category.locked) {
    event.preventDefault();
    return;
  }
  libraryDragState = { type: "category", id: category.id };
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("application/x-paperlantern-category", category.id);
  event.dataTransfer.setData("text/plain", category.name || category.id);
  event.currentTarget.closest(".category-row")?.classList.add("dragging");
}

function initCategoryDragAndDrop(row, category) {
  row.addEventListener("dragover", (event) => {
    const drop = getCategoryDropTarget(row, category, event);
    if (!drop) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = drop.type === "paper" ? "copy" : "move";
    showCategoryDropFeedback(row, drop.zone);
  });
  row.addEventListener("dragleave", (event) => {
    if (!row.contains(event.relatedTarget)) clearCategoryDropFeedback(row);
  });
  row.addEventListener("drop", async (event) => {
    const drop = getCategoryDropTarget(row, category, event);
    clearLibraryDragFeedback();
    if (!drop) return;
    event.preventDefault();
    if (drop.type === "paper") {
      if (!category.id || category.id === "uncategorized") return;
      await updatePaper({ action: "add_categories", id: drop.id, categoryIds: [category.id] });
      return;
    }
    await updateCategory(drop.payload);
  });
}

function getCategoryDropTarget(row, category, event) {
  const draggedPaperId = libraryDragState?.type === "paper" ? libraryDragState.id : event.dataTransfer.getData("application/x-paperlantern-paper");
  if (draggedPaperId) return category.id && category.id !== "uncategorized" ? { type: "paper", id: draggedPaperId, zone: "inside" } : null;

  const draggedCategoryId = libraryDragState?.type === "category" ? libraryDragState.id : event.dataTransfer.getData("application/x-paperlantern-category");
  if (!draggedCategoryId || draggedCategoryId === category.id) return null;
  if (category.id && category.id.startsWith(`${draggedCategoryId}/`)) return null;

  const zone = getCategoryDropZone(row, category, event);
  if (zone === "inside") {
    return { type: "category", zone, payload: { action: "move", id: draggedCategoryId, parentId: category.id || "" } };
  }
  if (!category.id) return { type: "category", zone: "inside", payload: { action: "move", id: draggedCategoryId, parentId: "" } };
  return {
    type: "category",
    zone,
    payload: {
      action: "move",
      id: draggedCategoryId,
      parentId: category.parentId || "",
      beforeId: zone === "before" ? category.id : "",
      afterId: zone === "after" ? category.id : "",
    },
  };
}

function getCategoryDropZone(row, category, event) {
  if (!category.id) return "inside";
  const rect = row.getBoundingClientRect();
  const ratio = (event.clientY - rect.top) / Math.max(rect.height, 1);
  if (ratio < 0.25) return "before";
  if (ratio > 0.75) return "after";
  return "inside";
}

function showCategoryDropFeedback(row, zone) {
  document.querySelectorAll(".category-row.drop-before, .category-row.drop-after, .category-row.drop-inside").forEach(clearCategoryDropFeedback);
  row.classList.add(`drop-${zone}`);
}

function clearCategoryDropFeedback(row) {
  row.classList.remove("drop-before", "drop-after", "drop-inside");
}

function clearLibraryDragFeedback() {
  libraryDragState = null;
  document.querySelectorAll(".dragging, .drop-before, .drop-after, .drop-inside").forEach((node) => {
    node.classList.remove("dragging", "drop-before", "drop-after", "drop-inside");
  });
}

function renderPaperList(papers) {
  if (!papers.length && !paperFlagFilter.hasSelection()) {
    const empty = document.createElement("div");
    empty.className = "library-empty";
    empty.textContent = searchQuery
      ? "未找到匹配的文献或笔记。"
      : selectedCategoryId === RECENT_CATEGORY_ID
        ? "暂无最近阅读记录。"
        : selectedCategoryId === TODO_CATEGORY_ID
          ? "暂无待办论文。"
          : "此分类中暂无论文或笔记。";
    paperList.appendChild(empty);
    syncPaperSelectionUi();
    return;
  }

  const isRecent = selectedCategoryId === RECENT_CATEGORY_ID;
  const recentRecords = getRecentPaperRecords();
  // In "最近", only reading time matters: always newest-viewed first.
  const sortKeyShown = isRecent ? "lastRead" : paperSort.key;
  const sortDirShown = isRecent ? "desc" : paperSort.dir;

  const wrap = document.createElement("div");
  wrap.className = "paper-table-wrap";
  const table = document.createElement("table");
  table.className = "paper-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  const sortableHeaders = { "标题": "title", "上传时间": "uploadedAt", "上次阅读": "lastRead" };
  ["标题", "上传时间", "上次阅读", "标志", "选项"].forEach((label) => {
    const th = document.createElement("th");
    if (label === "标志") th.className = "paper-flags-column";
    const sortKey = sortableHeaders[label];
    if (sortKey) {
      th.classList.add("paper-sortable");
      const button = document.createElement("span");
      button.className = "paper-sort-button";
      if (label === "标题") {
        const selectAllSlot = document.createElement("span");
        selectAllSlot.className = "paper-select-all-slot";
        const selectAllCheckbox = document.createElement("input");
        selectAllCheckbox.type = "checkbox";
        selectAllCheckbox.className = "paper-select-all-checkbox";
        selectAllCheckbox.tabIndex = selectedPaperIds.size ? 0 : -1;
        selectAllCheckbox.setAttribute("aria-label", "全选当前列表");
        selectAllCheckbox.addEventListener("pointerdown", (event) => event.stopPropagation());
        selectAllCheckbox.addEventListener("click", (event) => event.stopPropagation());
        selectAllCheckbox.addEventListener("change", () => toggleAllVisiblePapers(papers, selectAllCheckbox.checked));
        selectAllSlot.appendChild(selectAllCheckbox);
        button.appendChild(selectAllSlot);
      }
      button.appendChild(document.createTextNode(sortKeyShown === sortKey ? `${label} ${sortDirShown === "asc" ? "↑" : "↓"}` : label));
      th.appendChild(button);
      // The whole header cell is clickable, except in "最近" where the order is fixed.
      th.addEventListener("click", () => {
        if (isRecent) return;
        if (paperSort.key === sortKey) {
          paperSort.dir = paperSort.dir === "asc" ? "desc" : "asc";
        } else {
          paperSort.key = sortKey;
          paperSort.dir = sortKey === "title" ? "asc" : "desc";
        }
        renderLibrary();
      });
    } else if (label === "标志") {
      th.appendChild(paperFlagFilter.createButton());
    } else {
      th.textContent = label;
    }
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  (isRecent ? papers : sortPapers(papers)).forEach((paper) => {
    const viewedAt = getPaperViewedAt(paper, recentRecords);
    const tr = document.createElement("tr");
    tr.className = "paper-table-row";
    tr.tabIndex = 0;
    tr.draggable = selectedPaperIds.size === 0;
    tr.dataset.paperId = paper.id;
    tr.classList.toggle("is-selected", selectedPaperIds.has(paper.id));
    tr.addEventListener("dragstart", (event) => startPaperDrag(event, paper));
    tr.addEventListener("dragend", clearLibraryDragFeedback);
    tr.addEventListener("pointerenter", () => renderPaperInfoPanel(paper));
    tr.addEventListener("focus", () => renderPaperInfoPanel(paper));
    tr.addEventListener("keydown", (event) => {
      if (event.target !== tr) return;
      if (event.key === "Enter") openLibraryItem(paper);
    });

    const titleTd = document.createElement("td");
    titleTd.className = "paper-title-cell";
    const titleButton = document.createElement("span");
    titleButton.className = "paper-title-button";
    const selectionSlot = document.createElement("span");
    selectionSlot.className = "paper-select-slot";
    const selectCheckbox = document.createElement("input");
    selectCheckbox.type = "checkbox";
    selectCheckbox.className = "paper-select-checkbox";
    selectCheckbox.checked = selectedPaperIds.has(paper.id);
    selectCheckbox.tabIndex = selectedPaperIds.size ? 0 : -1;
    selectCheckbox.setAttribute("aria-label", `选择 ${paper.title}`);
    selectCheckbox.addEventListener("pointerdown", (event) => event.stopPropagation());
    selectCheckbox.addEventListener("click", (event) => event.stopPropagation());
    selectCheckbox.addEventListener("change", () => togglePaperSelection(paper.id, selectCheckbox.checked));
    selectionSlot.appendChild(selectCheckbox);
    const titleText = document.createElement("span");
    titleText.className = "paper-title-text";
    titleText.textContent = paper.title;
    titleButton.appendChild(selectionSlot);
    titleButton.insertAdjacentHTML("beforeend", paper.itemType === "note" ? noteItemSvg : paperItemSvg);
    titleButton.appendChild(titleText);
    titleButton.title = paper.title;
    titleTd.appendChild(titleButton);
    // The whole title cell is clickable.
    titleTd.addEventListener("click", () => openLibraryItem(paper));

    const uploadTd = document.createElement("td");
    uploadTd.className = "paper-date-cell";
    uploadTd.textContent = formatUploadDate(paper.uploadedAt);

    const viewedTd = document.createElement("td");
    viewedTd.className = "paper-date-cell";
    viewedTd.textContent = formatViewedDate(viewedAt);

    const flagsTd = document.createElement("td");
    flagsTd.className = "paper-flags-cell";
    flagsTd.appendChild(paperFlags.createButton(paper));
    const cells = [titleTd, uploadTd, viewedTd, flagsTd];

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
  if (!papers.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.className = "paper-flag-filter-empty";
    const message = document.createElement("p");
    message.textContent = "没有符合当前标志筛选的文献。";
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "paper-flag-filter-reset";
    reset.textContent = "清除标志筛选";
    reset.addEventListener("click", paperFlagFilter.clear);
    cell.append(message, reset);
    row.appendChild(cell);
    tbody.appendChild(row);
  }
  wrap.appendChild(table);
  paperList.appendChild(wrap);
  initPaperTableResize(table);
  syncPaperSelectionUi();
}

function reconcilePaperSelection(papers) {
  const visibleIds = new Set((papers || []).map((paper) => paper.id));
  selectedPaperIds.forEach((paperId) => {
    if (!visibleIds.has(paperId)) selectedPaperIds.delete(paperId);
  });
}

function togglePaperSelection(paperId, isSelected) {
  if (isSelected) selectedPaperIds.add(paperId);
  else selectedPaperIds.delete(paperId);
  syncPaperSelectionUi();
}

function toggleAllVisiblePapers(papers, isSelected) {
  (papers || []).forEach((paper) => {
    if (isSelected) selectedPaperIds.add(paper.id);
    else selectedPaperIds.delete(paper.id);
  });
  syncPaperSelectionUi();
}

function clearPaperSelection() {
  if (!selectedPaperIds.size) return;
  selectedPaperIds.clear();
  document.querySelector(".library-menu")?.remove();
  syncPaperSelectionUi();
}

function syncPaperSelectionUi() {
  const count = selectedPaperIds.size;
  const isSelecting = count > 0;
  if (paperBulkToolbar) paperBulkToolbar.hidden = !isSelecting;
  if (paperBulkCount) paperBulkCount.textContent = `已选 ${count} 项`;
  if (paperBulkFlagsButton) paperBulkFlagsButton.disabled = paperBulkBusy || !isSelecting;
  if (paperBulkMoveButton) paperBulkMoveButton.disabled = paperBulkBusy || !isSelecting;
  if (paperBulkDeleteButton) paperBulkDeleteButton.disabled = paperBulkBusy || !isSelecting;
  paperList.classList.toggle("is-multi-selecting", isSelecting);
  const rows = Array.from(paperList.querySelectorAll(".paper-table-row"));
  let selectedVisibleCount = 0;
  rows.forEach((row) => {
    const checked = selectedPaperIds.has(row.dataset.paperId || "");
    if (checked) selectedVisibleCount += 1;
    row.classList.toggle("is-selected", checked);
    row.draggable = !isSelecting;
    const checkbox = row.querySelector(".paper-select-checkbox");
    if (checkbox) {
      checkbox.checked = checked;
      checkbox.disabled = paperBulkBusy;
      checkbox.tabIndex = isSelecting ? 0 : -1;
    }
  });
  const selectAllCheckbox = paperList.querySelector(".paper-select-all-checkbox");
  if (selectAllCheckbox) {
    selectAllCheckbox.checked = rows.length > 0 && selectedVisibleCount === rows.length;
    selectAllCheckbox.disabled = paperBulkBusy;
    selectAllCheckbox.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < rows.length;
    selectAllCheckbox.tabIndex = isSelecting ? 0 : -1;
  }
}

function getSelectedPapers() {
  const paperMap = new Map(collectPapers(libraryTree).map((paper) => [paper.id, paper]));
  return Array.from(selectedPaperIds, (paperId) => paperMap.get(paperId)).filter(Boolean);
}

function setPaperBulkBusy(isBusy) {
  paperBulkBusy = Boolean(isBusy);
  syncPaperSelectionUi();
}

async function deleteSelectedPapers() {
  const papers = getSelectedPapers();
  if (!papers.length || paperBulkBusy) return;
  if (!window.confirm(`确定删除选中的 ${papers.length} 项？此操作无法撤销。`)) return;
  await updateSelectedPapers(
    { action: "delete-many", ids: papers.map((paper) => paper.id) },
    `正在删除 ${papers.length} 项...`,
  );
}

async function updateSelectedPapers(payload, pendingMessage) {
  if (paperBulkBusy) return;
  setPaperBulkBusy(true);
  setLibraryStatus(pendingMessage || "正在处理所选项目...");
  try {
    let response = await apiFetch("/api/library/paper", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    let data = await readJsonResponse(response);
    if (shouldUseLegacyBatchFallback(payload, response, data)) {
      data = await runLegacyPaperBatch(payload);
      response = { ok: true };
    }
    if (!response.ok) throw new Error(data.error || "批量操作失败。");
    libraryTree = data.tree;
    selectedPaperIds.clear();
    renderLibrary();
    setLibraryStatus("");
    reportSyncResult(data.sync);
  } catch (error) {
    console.error(error);
    setLibraryStatus(error.message || "批量操作失败。", true);
  } finally {
    setPaperBulkBusy(false);
  }
}

function shouldUseLegacyBatchFallback(payload, response, data) {
  if (!payload?.action?.endsWith("-many") || response.status !== 404) return false;
  const error = String(data?.error || "").trim();
  return !error || error === "Paper not found.";
}

async function runLegacyPaperBatch(payload) {
  const ids = Array.isArray(payload.ids) ? payload.ids : [];
  let lastData = { tree: libraryTree, sync: null };
  for (const id of ids) {
    const singlePayload = payload.action === "move-many"
      ? { action: "move", id, category: payload.category }
      : { action: "delete", id };
    const response = await apiFetch("/api/library/paper", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(singlePayload),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.error || "批量操作失败。");
    lastData = data;
  }
  return lastData;
}

let paperColumnWidths = [];

function initPaperTableResize(table) {
  const ths = Array.from(table.querySelectorAll("thead th"));
  const resizableCount = ths.length - 1;
  const defaults = [54, 14, 14, 12];
  if (paperColumnWidths.length !== resizableCount) paperColumnWidths = [...defaults];
  // Columns before the last are resizable; the last (选项) is width:auto and
  // absorbs the delta so the table always fills 100%.
  ths.forEach((th, index) => {
    if (index === ths.length - 1) return;
    th.style.width = `${paperColumnWidths[index] || defaults[index]}%`;
    const handle = document.createElement("div");
    handle.className = "paper-col-resize-handle";
    handle.setAttribute("aria-hidden", "true");
    handle.addEventListener("click", (event) => event.stopPropagation());
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
  const names = paper.categoryNames || [paper.categoryName || paper.category || "未分类"];
  meta.textContent = names.length > 2 ? `${names.slice(0, 2).join("、")} ＋${names.length - 2}` : names.join("、");
  meta.title = getCategoryIds(paper).join("\n");
  header.append(title, meta);

  if (paper.itemType === "note") {
    const preview = document.createElement("p");
    preview.className = "paper-info-note-preview";
    preview.textContent = String(paper.notes || "").trim().slice(0, 360) || "空笔记";
    paperInfoPanel.append(header, preview);
    return;
  }

  const basicInfo = paper.basicInfo || {};
  const basicSection = createPaperInfoSection("基本信息", [
    ["分类", getCategoryLabels(paper).join("；")],
    ["作者", formatPaperInfoValue(basicInfo.authors)],
    ["期刊", formatPaperInfoValue(basicInfo.venue)],
    ["发表日期", formatPaperInfoValue(basicInfo.publishedDate)],
    ["机构", formatPaperInfoValue(basicInfo.institutions)],
  ]);

  const lines = paper.threeLineSummary || {};
  const summarySection = createPaperInfoSection("三行总结", [
    ["挑战", formatPaperInfoValue(lines.challenges)],
    ["方法", formatPaperInfoValue(lines.method)],
    ["结论", formatPaperInfoValue(lines.conclusion)],
  ]);

  const citationFormats = buildPaperCitationFormats(paper);
  const citationCard = document.createElement("button");
  citationCard.type = "button";
  citationCard.className = "paper-info-citation-card";
  const citationHeading = document.createElement("h3");
  citationHeading.textContent = "引用信息";
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

function renderPaperInfoEmpty() {
  if (!paperInfoPanel) return;
  paperInfoPanel.hidden = false;
  paperInfoPanel.classList.remove("open");
  paperInfoPanel.innerHTML = "";
  const empty = document.createElement("div");
  empty.className = "paper-info-empty";
  empty.textContent = searchQuery ? "未找到匹配的文献或笔记。" : "选择文献，查看详细信息。";
  paperInfoPanel.appendChild(empty);
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
    if (!window.confirm(`确定删除分类"${category.name}"及其子分类？条目将保留其他分类归属，没有其他归属的条目将归入未分类。`)) return;
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

  const manageButton = document.createElement("button");
  manageButton.type = "button";
  manageButton.innerHTML = `${folderCategoryIconSvg}<span>分类</span>`;
  manageButton.addEventListener("click", () => {
    menu.remove();
    showCategoryManager({ tree: libraryTree, paper, anchor, onSave: (categoryIds) => updatePaper({ action: "set_categories", id: paper.id, categoryIds }, { propagate: true }) });
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
    if (!window.confirm(`确定删除${paper.itemType === "note" ? "笔记" : "论文"}"${paper.title}"？`)) return;
    await updatePaper({ action: "delete", id: paper.id });
  });

  menu.append(manageButton);
  if (paper.itemType !== "note") menu.append(exportLink);
  menu.append(deleteButton);
  document.body.appendChild(menu);
  positionMenu(menu, anchor, 190);
}

function showMovePaperMenu(paperOrPapers, anchor) {
  const papers = (Array.isArray(paperOrPapers) ? paperOrPapers : [paperOrPapers]).filter(Boolean);
  if (!papers.length) return;
  document.querySelector(".library-menu")?.remove();
  const menu = document.createElement("div");
  menu.className = "paper-menu move-paper-menu library-menu";

  const heading = document.createElement("div");
  heading.className = "move-menu-heading";
  heading.textContent = papers.length > 1 ? `移动 ${papers.length} 项到分类` : "移动到分类";
  menu.appendChild(heading);

  const list = document.createElement("div");
  list.className = "move-category-list";
  menu.appendChild(list);

  const rerender = () => showMovePaperMenu(papers, anchor);
  renderMoveCategoryNode(libraryTree, 0, papers, list, rerender);

  document.body.appendChild(menu);
  positionMenu(menu, anchor, 260);
}

function renderMoveCategoryNode(node, depth, papers, container, rerender) {
  (node.folders || []).forEach((folder) => {
    renderMoveCategoryRow(folder, depth, papers, container, rerender);
    if (folder.folders && folder.folders.length && !isCategoryCollapsed(folder.id)) {
      renderMoveCategoryNode(folder, depth + 1, papers, container, rerender);
    }
  });
}

function renderMoveCategoryRow(node, depth, papers, container, rerender) {
  const row = document.createElement("div");
  row.className = "move-category-row";
  row.style.paddingLeft = `${14 + depth * 14}px`;

  const hasChildren = Boolean(node.folders && node.folders.length);
  const paperCategories = new Set(papers.map((paper) => String(paper.category || "")));
  const onlyCategory = paperCategories.size === 1 ? Array.from(paperCategories)[0] : "";
  const isExact = Boolean(onlyCategory) && node.id === onlyCategory;
  const isAncestor = Boolean(onlyCategory) && onlyCategory.startsWith(`${node.id}/`);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "move-category-option";
  if (depth >= 1) button.classList.add("move-category-sub");
  button.classList.toggle("move-category-has-children", hasChildren);
  if (isExact || isAncestor) button.classList.add("move-category-current");
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
    if (papers.length === 1) {
      await updatePaper({ action: "move", id: papers[0].id, category: node.id });
      return;
    }
    await updateSelectedPapers(
      { action: "move-many", ids: papers.map((paper) => paper.id), category: node.id },
      `正在移动 ${papers.length} 项...`,
    );
  });
  row.appendChild(button);
  container.appendChild(row);
}

function positionMenu(menu, anchor, width) {
  const rect = anchor.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const margin = 8;
  const left = Math.max(margin, Math.min(rect.left, window.innerWidth - (menuRect.width || width) - margin));
  const top = rect.bottom + 4 + menuRect.height <= window.innerHeight - margin
    ? rect.bottom + 4
    : Math.max(margin, rect.top - menuRect.height - 4);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
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
    } else if (payload.action === "move" && selectedCategoryId === payload.id) {
      selectedCategoryId = data.categoryId || "";
    } else if (payload.action === "move" && selectedCategoryId.startsWith(`${payload.id}/`) && data.categoryId) {
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

async function updatePaper(payload, { propagate = false } = {}) {
  try {
    const response = await apiFetch("/api/library/paper", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(data.error || "文章操作失败。");
    }
    libraryTree = data.tree;
    renderLibrary();
    setLibraryStatus("");
    reportSyncResult(data.sync);
    return data;
  } catch (error) {
    console.error(error);
    setLibraryStatus(error.message || "Paper operation failed.", true);
    if (propagate) throw error;
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
    parentId: node.parentId || "",
    order: Number(node.order) || 0,
    paperCount: collectPapers(node).length,
    papers: node.papers || [],
  };
  return [current, ...(node.folders || []).flatMap((folder) => flattenCategories(folder, depth + 1))];
}

function collectPapers(node) {
  return collectUniquePapers(node);
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
  const terms = String(query || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return papers;
  return papers.filter((paper) => {
    const authors = paper.basicInfo?.authors;
    const haystack = [paper.title, categorySearchText(paper),
      ...(Array.isArray(authors) ? authors : [authors]), paperFlags.searchText(paper),
      ...(Array.isArray(paper.keywords) ? paper.keywords : [])]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return terms.every(term => haystack.includes(term));
  });
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

async function runCloudSync() {
  setCloudSyncBusy(true);
  startCloudSyncProgress();
  try {
    updateCloudSyncProgress("Connecting to sync target...", "Checking the remote library index.", 28);
    const response = await apiFetch("/api/cloud-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sync" }),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) {
      renderCloudSyncStatus(data);
      setLibraryStatus(data.error || "Cloud sync failed.", true);
      await pollCloudSyncProgress();
      if (data.cancelled) {
        settleCloudSyncProgress();
      } else {
        finishCloudSyncProgress("Sync failed", data.error || "Cloud sync failed.", true);
      }
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
    finishCloudSyncProgress(
      "Sync complete",
      formatCloudSyncTransferSummary(data),
      false,
    );
  } catch (error) {
    console.error(error);
    setLibraryStatus(error.message || "Cloud sync failed.", true);
    await pollCloudSyncProgress();
    finishCloudSyncProgress("Sync failed", error.message || "Cloud sync failed.", true);
  } finally {
    setCloudSyncBusy(false);
  }
}

function startCloudSyncProgress() {
  window.clearTimeout(cloudSyncProgressHideTimer);
  window.clearInterval(cloudSyncProgressPollTimer);
  cloudSyncCancelRequested = false;
  cloudSyncProgressValue = 8;
  updateCloudSyncProgress("Preparing sync...", "Scanning local library files.", cloudSyncProgressValue);
  cloudSyncProgressPollTimer = window.setInterval(pollCloudSyncProgress, 700);
}

function updateCloudSyncProgress(title, detail, progress, isError = false) {
  cloudSyncProgressValue = Math.max(cloudSyncProgressValue, progress);
  let overlay = document.querySelector("#cloudSyncProgressOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "cloudSyncProgressOverlay";
    overlay.className = "cloud-sync-progress-overlay";
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "polite");
    overlay.innerHTML = `
      <section class="cloud-sync-progress-card">
        <div class="cloud-sync-progress-icon" aria-hidden="true"></div>
        <div class="cloud-sync-progress-content">
          <div class="cloud-sync-progress-top">
            <strong class="cloud-sync-progress-title"></strong>
            <button class="cloud-sync-cancel-button" type="button" aria-label="Stop sync" title="Stop sync">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="6" y="6" width="12" height="12" rx="2"></rect>
              </svg>
            </button>
          </div>
          <p class="cloud-sync-progress-detail"></p>
          <div class="cloud-sync-progress-meter">
            <span class="cloud-sync-progress-label">0/1</span>
            <div class="cloud-sync-progress-track" aria-hidden="true">
              <div class="cloud-sync-progress-bar"></div>
            </div>
          </div>
        </div>
      </section>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector(".cloud-sync-cancel-button").addEventListener("click", cancelCloudSync);
  }
  overlay.classList.toggle("error", Boolean(isError));
  overlay.classList.toggle("complete", !isError && cloudSyncProgressValue >= 100);
  overlay.querySelector(".cloud-sync-progress-title").textContent = title;
  overlay.querySelector(".cloud-sync-progress-detail").textContent = detail || "";
  updateCloudSyncProgressBar(overlay, progress, 100, isError ? "error" : "running");
}

async function pollCloudSyncProgress() {
  try {
    const response = await apiFetch("/api/cloud-sync/progress", { cache: "no-store" });
    const progress = await readJsonResponse(response);
    if (response.ok && progress?.step) updateCloudSyncProgressFromServer(progress);
  } catch (error) {
    console.error("Failed to read sync progress.", error);
  }
}

function updateCloudSyncProgressFromServer(progress) {
  const title =
    progress.status === "error"
      ? "Sync failed"
      : progress.status === "cancelled"
        ? "Sync stopped"
        : progress.status === "canceling"
          ? "Stopping sync..."
          : progress.status === "complete"
            ? "Sync complete"
            : cloudSyncProgressTitle(progress.step);
  const detail = progress.currentFile ? `${progress.detail || ""} (${progress.currentFile})` : progress.detail || "";
  updateCloudSyncProgress(title, detail, overallCloudSyncProgress(progress), progress.status === "error");
  const overlay = document.querySelector("#cloudSyncProgressOverlay");
  if (overlay) {
    overlay.classList.toggle("cancelled", progress.status === "cancelled" || progress.status === "canceling");
    const cancelButton = overlay.querySelector(".cloud-sync-cancel-button");
    if (cancelButton) {
      cancelButton.disabled = cloudSyncCancelRequested || ["canceling", "cancelled", "complete", "error"].includes(progress.status);
      cancelButton.hidden = ["cancelled", "complete", "error"].includes(progress.status);
    }
    updateCloudSyncProgressBar(overlay, progress.current, progress.total, progress.status);
  }
}

function updateCloudSyncProgressBar(overlay, currentValue, totalValue, status = "running") {
  const total = Math.max(0, Number(totalValue || 0));
  const current = Math.max(0, Number(currentValue || 0));
  const percent = total > 0 ? Math.round((Math.min(current, total) / total) * 100) : 100;
  const label =
    status === "error"
      ? "Error"
      : status === "cancelled"
        ? "Stopped"
        : status === "complete"
          ? "Done"
          : `${Math.min(current, total)}/${total || 0}`;
  overlay.querySelector(".cloud-sync-progress-label").textContent = label;
  overlay.querySelector(".cloud-sync-progress-bar").style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function cloudSyncProgressTitle(step) {
  if (step === "compare") return "Checking differences...";
  if (step === "download") return "Downloading files...";
  if (step === "upload") return "Uploading files...";
  if (step === "finalize") return "Finalizing sync...";
  return "Preparing sync...";
}

function overallCloudSyncProgress(progress) {
  const total = Number(progress.total || 0);
  const current = Number(progress.current || 0);
  return total > 0 ? Math.round((current / total) * 100) : 100;
}

function finishCloudSyncProgress(title, detail, isError) {
  window.clearInterval(cloudSyncProgressPollTimer);
  updateCloudSyncProgress(title, detail, isError ? cloudSyncProgressValue : 100, isError);
  const overlay = document.querySelector("#cloudSyncProgressOverlay");
  if (overlay) {
    const cancelButton = overlay.querySelector(".cloud-sync-cancel-button");
    if (cancelButton) cancelButton.hidden = true;
    if (!isError) updateCloudSyncProgressBar(overlay, 1, 1, "complete");
  }
  window.clearTimeout(cloudSyncProgressHideTimer);
  cloudSyncProgressHideTimer = window.setTimeout(hideCloudSyncProgress, isError ? 4200 : 1800);
}

function settleCloudSyncProgress(delay = 2600) {
  window.clearInterval(cloudSyncProgressPollTimer);
  window.clearTimeout(cloudSyncProgressHideTimer);
  cloudSyncProgressHideTimer = window.setTimeout(hideCloudSyncProgress, delay);
}

function hideCloudSyncProgress() {
  window.clearInterval(cloudSyncProgressPollTimer);
  window.clearTimeout(cloudSyncProgressHideTimer);
  document.querySelector("#cloudSyncProgressOverlay")?.remove();
}

async function cancelCloudSync() {
  if (cloudSyncCancelRequested) return;
  cloudSyncCancelRequested = true;
  const overlay = document.querySelector("#cloudSyncProgressOverlay");
  const cancelButton = overlay?.querySelector(".cloud-sync-cancel-button");
  if (cancelButton) cancelButton.disabled = true;
  updateCloudSyncProgress("Stopping sync...", "Waiting for the current file to finish.", cloudSyncProgressValue);
  try {
    const response = await apiFetch("/api/cloud-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel" }),
    });
    await readJsonResponse(response);
    await pollCloudSyncProgress();
  } catch (error) {
    console.error(error);
    updateCloudSyncProgress("Stop request failed", error.message || "Unable to stop sync.", cloudSyncProgressValue, true);
  }
}

function formatCloudSyncTransferSummary(data) {
  const filesDownloaded = Number(data?.filesDownloaded || 0);
  const filesUploaded = Number(data?.filesUploaded || 0);
  const totalFiles = filesDownloaded + filesUploaded;
  return `Transferred ${totalFiles} files: downloaded ${filesDownloaded}, uploaded ${filesUploaded}.`;
}

function renderCloudSyncStatus(status) {
  const configured = Boolean(status?.configured);
  cloudSyncButton.disabled = !configured;
  if (!configured) {
    cloudSyncStatus.textContent = "Not configured";
    return;
  }
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
      if (response.status !== 404 || !url.startsWith("/api/")
        || response.headers.get("content-type")?.includes("application/json")) {
        apiBaseUrl = base;
        return response;
      }
      lastError = new Error(`API not found at ${base || "current origin"}.`);
    } catch (error) {
      lastError = error;
    }
  }
  if (url === "/api/library/import/start") {
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
