import * as pdfjsLib from "./vendor/pdfjs/pdf.min.mjs";
import { initSettingsModal } from "./settings_modal.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdfjs/pdf.worker.min.mjs";

const openLibraryDrawerButton = document.querySelector("#openLibraryDrawerButton");
const readerPinButton = document.querySelector("#readerPinButton");
const readerLibraryDrawer = document.querySelector("#readerLibraryDrawer");
const readerCategoryList = document.querySelector("#readerCategoryList");
const readerPaperList = document.querySelector("#readerPaperList");
const readerLibraryTitle = document.querySelector("#readerLibraryTitle");
const readerPaperUploadButton = document.querySelector("#readerPaperUploadButton");
const readerPaperUploadInput = document.querySelector("#readerPaperUploadInput");
const readerUploadMenu = document.querySelector("#readerUploadMenu");
const readerArxivUploadInput = document.querySelector("#readerArxivUploadInput");
const readerArxivUploadButton = document.querySelector("#readerArxivUploadButton");
const readerSearchInput = document.querySelector("#readerSearchInput");
const readerLocationBackButton = document.querySelector("#readerLocationBackButton");
const readerLocationCurrentButton = document.querySelector("#readerLocationCurrentButton");
const readerLocationCurrentName = document.querySelector("#readerLocationCurrentName");
const readerLocationCurrentCount = document.querySelector("#readerLocationCurrentCount");
const readerLibraryBody = document.querySelector("#readerLibraryBody");
const readerLeftRail = document.querySelector("#readerLeftRail");
const pdfViewer = document.querySelector("#pdfViewer");
const appShell = document.querySelector(".app-shell");
const paneResizer = document.querySelector("#paneResizer");
const readerSideRail = document.querySelector("#readerSideRail");
const exportPdfButton = document.querySelector("#exportPdfButton");
const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "ftp:"]);
let pdfLinkAnnotationsCache = new Map(); // pageNumber -> Promise<Annotation[]>
let pdfLinkDestCache = new Map();        // destName(string) -> Promise<{pageIndex, top, left}|null>
const selectionMenu = document.querySelector("#selectionMenu");
const highlightButton = document.querySelector("#highlightButton");
const commentButton = document.querySelector("#commentButton");
const translateButton = document.querySelector("#translateButton");
const explainButton = document.querySelector("#explainButton");
const askSelectionButton = document.querySelector("#askSelectionButton");
const emptyState = document.querySelector("#emptyState");
const fileName = document.querySelector("#fileName");
const pageIndicator = document.querySelector("#pageIndicator");
const pageNumberInput = document.querySelector("#pageNumberInput");
const pageTotalLabel = document.querySelector("#pageTotalLabel");
const regenerateKeywordsButton = document.querySelector("#regenerateKeywordsButton");
const regenerateThreeLineButton = document.querySelector("#regenerateThreeLineButton");
const regenerateMethodButton = document.querySelector("#regenerateMethodButton");
const statusText = document.querySelector("#status");
const challenges = document.querySelector("#challenges");
const method = document.querySelector("#method");
const conclusion = document.querySelector("#conclusion");
const keywords = document.querySelector("#keywords");
const methodSections = document.querySelector("#methodSections");
const discussionListView = document.querySelector("#discussionListView");
const discussionThreadView = document.querySelector("#discussionThreadView");
const discussionThreadList = document.querySelector("#discussionThreadList");
const newDiscussionListButton = document.querySelector("#newDiscussionListButton");
const backToDiscussionsButton = document.querySelector("#backToDiscussionsButton");
const discussionThreadTitle = document.querySelector("#discussionThreadTitle");
const discussionMessages = document.querySelector("#discussionMessages");
const discussionForm = document.querySelector("#discussionForm");
const discussionReferenceBox = document.querySelector("#discussionReferenceBox");
const discussionReferenceText = document.querySelector("#discussionReferenceText");
const discussionInput = document.querySelector("#discussionInput");
const sendDiscussionButton = document.querySelector("#sendDiscussionButton");
const discussionCompactBar = document.querySelector("#discussionCompactBar");
const discussionCompactTitle = document.querySelector("#discussionCompactTitle");
const discussionCompactNewButton = document.querySelector("#discussionCompactNewButton");
const discussionCompactHistoryButton = document.querySelector("#discussionCompactHistoryButton");
const newDiscussionFromThreadButton = document.querySelector("#newDiscussionFromThreadButton");
const discussionHistoryButton = document.querySelector("#discussionHistoryButton");
const discussionTitleEditButton = document.querySelector("#discussionTitleEditButton");
const copyThreeLineButton = document.querySelector("#copyThreeLineButton");
const copyMethodButton = document.querySelector("#copyMethodButton");
const readerTabs = document.querySelectorAll(".reader-tab");
const readerTabPanels = document.querySelectorAll(".reader-tab-panel");
const basicInfoButton = document.querySelector("#basicInfoButton");
const basicInfoStatus = document.querySelector("#basicInfoStatus");
const basicInfoTitle = document.querySelector("#basicInfoTitle");
const basicInfoAuthors = document.querySelector("#basicInfoAuthors");
const basicInfoVenue = document.querySelector("#basicInfoVenue");
const basicInfoDate = document.querySelector("#basicInfoDate");
const basicInfoInstitutions = document.querySelector("#basicInfoInstitutions");
const basicInfoDoi = document.querySelector("#basicInfoDoi");
const basicInfoLocalPath = document.querySelector("#basicInfoLocalPath");
const copyDoiButton = document.querySelector("#copyDoiButton");
const openDoiButton = document.querySelector("#openDoiButton");
const generateCitationButton = document.querySelector("#generateCitationButton");
const citationStatus = document.querySelector("#citationStatus");
const citationResults = document.querySelector("#citationResults");
const citationOverlay = document.querySelector("#citationOverlay");
const citationOverlayTitle = document.querySelector("#citationOverlayTitle");
const citationOverlayMeta = document.querySelector("#citationOverlayMeta");
const citationOverlayCloseButton = document.querySelector("#citationOverlayCloseButton");
const citationFormatSelect = document.querySelector("#citationFormatSelect");
const citationCopyButton = document.querySelector("#citationCopyButton");
const citationOutput = document.querySelector("#citationOutput");
const notesEditor = document.querySelector("#notesEditor");
const notesWorkspace = document.querySelector("#notesWorkspace");
const notesPreview = document.querySelector("#notesPreview");
const notesStatus = document.querySelector("#notesStatus");
const toggleNotesModeButton = document.querySelector("#toggleNotesModeButton");
const copyNotesButton = document.querySelector("#copyNotesButton");
const exportNotesPdfButton = document.querySelector("#exportNotesPdfButton");
const zoomOutButton = document.querySelector("#zoomOutButton");
const zoomInButton = document.querySelector("#zoomInButton");
const fitPageButton = document.querySelector("#fitPageButton");
const pdfZoomLabel = document.querySelector("#pdfZoomLabel");
const pdfSearchToggleButton = document.querySelector("#pdfSearchToggleButton");
const pdfSearchControls = document.querySelector("#pdfSearchControls");
const pdfSearchInput = document.querySelector("#pdfSearchInput");
const pdfSearchPrevButton = document.querySelector("#pdfSearchPrevButton");
const pdfSearchNextButton = document.querySelector("#pdfSearchNextButton");
const pdfSearchCount = document.querySelector("#pdfSearchCount");
const pdfOutlineToggleButton = document.querySelector("#pdfOutlineToggleButton");
const pdfOutlinePanel = document.querySelector("#pdfOutlinePanel");
const pdfOutlineList = document.querySelector("#pdfOutlineList");
const pdfOutlineResizer = document.querySelector("#pdfOutlineResizer");

const READER_LIBRARY_ALL_ID = "__library";
const READER_RECENT_ID = "__recent";
const READER_TODO_ID = "__todo";
const READER_UNCATEGORIZED_ID = "uncategorized";
const READING_POSITION_STORAGE_PREFIX = "paperLanternReadingPosition:";
const MAX_DISCUSSION_REFERENCE_CHARS = 4000;
const PDF_OUTLINE_MIN_WIDTH = 180;
const PDF_OUTLINE_MAX_WIDTH = 420;

const readerLibraryIconSvg =
  '<svg class="reader-category-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>';
const readerFolderIconSvg =
  '<svg class="reader-category-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>';
const readerRecentIconSvg =
  '<svg class="reader-category-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path></svg>';
const readerTodoIconSvg =
  '<svg class="reader-category-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path></svg>';
const readerPlusCircleSvg =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"></circle><path d="M12 8v8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path><path d="M8 12h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>';
const readerBookmarkPlusSvg =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M12 8v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path><path d="M9 11h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>';
const readerBookmarkCheckedSvg =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="m9 11 2 2 4-5" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path></svg>';

let readerLibraryHoverTimer = null;
let readerCategoryInlineEditorActive = false;
let readerPickerOpen = false;
let readerSearchQuery = "";
let readerPinned = false;
let pdfSearchMatches = [];
let pdfSearchIndex = -1;
let pdfOutlineItems = [];
let isResizingPdfOutline = false;

let lastExtractedText = "";
let currentPdfTask = null;
let currentPdfDocument = null;
let pdfPageMetrics = [];
let pdfRenderedPages = new Map();
let pdfRenderingPages = new Map();
let pdfPageTextCache = new Map();
let pdfVirtualRenderTimer = null;
let pdfSearchTask = null;
let readingPositionSaveTimer = null;
let pdfZoom = 1;
let renderedPdfZoom = 1;
let zoomRenderTimer = null;
let paneRenderTimer = null;
let savedHighlights = [];
let selectedPdfText = "";
let selectedPdfRange = null;
let lastSelectionRect = null;
let isPdfTextSelecting = false;
let isPdfLoadingForReadingPosition = false;
let pdfSelectionPointerId = null;
let pendingPdfSelectionRect = null;
let pdfSelectionStartPageNumber = null;
let isResizingPanes = false;
let currentPaper = null;
let currentVisiblePage = 0;
let apiBaseUrl = "";
let translationDragState = null;
let activeHighlightGroupId = null;
let readerLibraryTree = null;
let readerSelectedCategoryId = "";
let discussionThreads = [];
let activeDiscussionId = null;
let discussionIsBusy = false;
let discussionMarkdownRenderer = null;
let discussionTitleRenaming = false;
let discussionHeaderVisible = true;
let discussionCompactInitDone = false;
let annotationAutoSaveTimer = null;
let notesAutoSaveTimer = null;
let copiedToastTimer = null;
let notesLastSavedValue = "";
let notesIsSaving = false;
let notesMode = "edit";
let referenceEntries = new Map();
let citationCandidates = [];
let selectedCitationIndex = -1;
let citationFormat = "gbt7714";
let citationSelectedCandidate = null;
let appliedCitationDoi = "";
let commentsNavIndex = 0;
let commentsColorFilter = "all";
let citationSearchSummaryVisible = false;

const highlightColors = {
  yellow: "rgba(255, 221, 64, 0.42)",
  green: "rgba(120, 196, 162, 0.36)",
  blue: "rgba(111, 178, 214, 0.32)",
  pink: "rgba(239, 147, 171, 0.32)",
};

const commentSwatchColors = {
  yellow: "#ffdd40",
  green: "#78c4a2",
  blue: "#6fb2d6",
  pink: "#ef93ab",
};

initPaneResizer();
initReaderSideRail();
initSummaryPaneToggle();
initReaderTabs();
initSettingsModal({
  openButtons: ["#readerSettingsButton"],
  setBusy: (isBusy) => {
    const button = document.querySelector("#readerSettingsButton");
    if (button) button.disabled = isBusy;
  },
  setStatus,
});
initCitationOverlay();
initBasicInfoEditing();
initPdfToolbar();
initPdfOutlineResizer();
initCollapsibleSummaryCards();
initReaderLibraryDrawer();
initNotesPanel();
openReaderFromUrl();

function initReaderLibraryDrawer() {
  openLibraryDrawerButton?.addEventListener("click", () => {
    // Clicking the brand while the drawer is open goes back to the library.
    if (readerLibraryDrawer.classList.contains("open")) {
      openReaderNavigationInNewTab("./index.html");
      return;
    }
    openReaderLibraryDrawer();
  });
  readerPinButton?.addEventListener("click", () => setReaderPinned(!readerPinned));
  if (localStorage.getItem("paperLanternReaderPinned") === "1") setReaderPinned(true);
  // Hover the left rail to expand, leave to auto-collapse (not while pinned).
  readerLeftRail?.addEventListener("pointerenter", () => {
    window.clearTimeout(readerLibraryHoverTimer);
    if (!readerPinned) openReaderLibraryDrawer();
  });
  readerLeftRail?.addEventListener("pointerleave", () => {
    if (readerPinned) return;
    window.clearTimeout(readerLibraryHoverTimer);
    readerLibraryHoverTimer = window.setTimeout(() => {
      if (document.querySelector(".library-menu")) return;
      if (isReaderUploadMenuOpen()) return;
      if (readerCategoryInlineEditorActive) return;
      closeReaderLibraryDrawer();
    }, 220);
  });
  document.addEventListener("keydown", (event) => {
    if (readerCategoryInlineEditorActive) return;
    if (event.key === "Escape" && !readerPinned) closeReaderLibraryDrawer();
  });
  readerPaperUploadButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    openReaderLibraryDrawer();
    isReaderUploadMenuOpen() ? closeReaderUploadMenu() : openReaderUploadMenu();
  });
  readerPaperUploadInput?.addEventListener("change", () => {
    const file = readerPaperUploadInput.files && readerPaperUploadInput.files[0];
    if (!file) return;
    closeReaderUploadMenu();
    uploadReaderLibraryPaper(file).finally(() => {
      readerPaperUploadInput.value = "";
    });
  });
  readerArxivUploadButton?.addEventListener("click", () => {
    const source = readerArxivUploadInput?.value || "";
    if (!source.trim()) return;
    closeReaderUploadMenu();
    uploadReaderRemotePaper(source.trim()).finally(() => {
      if (readerArxivUploadInput) readerArxivUploadInput.value = "";
    });
  });
  readerUploadMenu?.addEventListener("dragenter", handleReaderUploadDrag);
  readerUploadMenu?.addEventListener("dragover", handleReaderUploadDrag);
  readerUploadMenu?.addEventListener("dragleave", (event) => {
    if (!readerUploadMenu.contains(event.relatedTarget)) readerUploadMenu.classList.remove("drag-over");
  });
  readerUploadMenu?.addEventListener("drop", (event) => {
    event.preventDefault();
    readerUploadMenu.classList.remove("drag-over");
    const file = Array.from(event.dataTransfer?.files || []).find((item) => item.type === "application/pdf" || /\.pdf$/i.test(item.name));
    if (!file) {
      setStatus("请拖入 PDF 文件。", true);
      return;
    }
    closeReaderUploadMenu();
    uploadReaderLibraryPaper(file);
  });
  window.addEventListener("resize", positionReaderUploadMenu);
  readerSearchInput?.addEventListener("input", () => {
    readerSearchQuery = String(readerSearchInput.value || "").trim().toLowerCase();
    renderReaderLibrary();
  });
  // The current-directory text is informational only; the light back arrow
  // opens the category picker from the paper list.
  readerLocationBackButton?.addEventListener("click", () => {
    if (!readerPickerOpen) setReaderPickerMode(true);
  });
  initReaderLibraryResize();
  loadReaderLibrary().catch((error) => console.error("Failed to load reader library.", error));
}

function initReaderLibraryResize() {
  const divider = document.querySelector("#readerLibraryDivider");
  const categorySection = document.querySelector(".reader-category-section");
  const drawer = document.querySelector("#readerLibraryDrawer");
  if (!divider || !categorySection || !drawer) return;
  const minCategoryHeight = 128;
  const saved = Number(localStorage.getItem("paperLanternReaderCategoryHeight"));
  if (saved > minCategoryHeight) categorySection.style.height = `${saved}px`;

  divider.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const startY = event.clientY;
    const startH = categorySection.getBoundingClientRect().height;
    const onMove = (moveEvent) => {
      const delta = moveEvent.clientY - startY;
      const next = Math.max(Math.min(startH + delta, drawer.clientHeight - 60), minCategoryHeight);
      categorySection.style.height = `${next}px`;
      localStorage.setItem("paperLanternReaderCategoryHeight", String(next));
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.classList.remove("resizing-categories");
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.body.classList.add("resizing-categories");
  });
}

async function openReaderLibraryDrawer() {
  readerLibraryDrawer.classList.add("open");
  readerLeftRail?.classList.add("library-open");
  appShell?.classList.add("library-open");
  readerLibraryDrawer.setAttribute("aria-hidden", "false");
  openLibraryDrawerButton.classList.add("open");
  openLibraryDrawerButton.setAttribute("aria-expanded", "true");
  openLibraryDrawerButton.setAttribute("aria-label", "Back to library");
  await loadReaderLibrary();
}

function closeReaderLibraryDrawer() {
  if (readerPinned) return;
  readerLibraryDrawer.classList.remove("open");
  readerLeftRail?.classList.remove("library-open");
  appShell?.classList.remove("library-open");
  readerLibraryDrawer.setAttribute("aria-hidden", "true");
  openLibraryDrawerButton.classList.remove("open");
  openLibraryDrawerButton.setAttribute("aria-expanded", "false");
  openLibraryDrawerButton.setAttribute("aria-label", "Open library");
}

function setReaderPinned(pinned) {
  readerPinned = Boolean(pinned);
  localStorage.setItem("paperLanternReaderPinned", readerPinned ? "1" : "0");
  readerLeftRail?.classList.toggle("reader-pinned", readerPinned);
  appShell?.classList.toggle("reader-pinned", readerPinned);
  readerPinButton?.setAttribute("aria-pressed", String(readerPinned));
  if (readerPinned) {
    openReaderLibraryDrawer();
  } else {
    closeReaderLibraryDrawer();
  }
}

function setReaderPickerMode(open) {
  readerPickerOpen = Boolean(open);
  readerLibraryDrawer?.classList.toggle("reader-show-picker", readerPickerOpen);
  if (!readerPickerOpen) readerSearchInput?.focus();
}

function selectReaderLibraryCategory(categoryId) {
  readerSelectedCategoryId = categoryId;
  setReaderPickerMode(false);
  renderReaderLibrary();
}

async function loadReaderLibrary() {
  const response = await apiFetch("/api/library");
  const data = await readJsonResponse(response);
  if (!response.ok) throw new Error(data.error || "Failed to load library.");
  readerLibraryTree = data.tree;
  if (!readerSelectedCategoryId && currentPaper?.category) readerSelectedCategoryId = currentPaper.category;
  renderReaderLibrary();
}

function renderReaderLibrary() {
  if (!readerLibraryTree) return;
  if (readerCategoryInlineEditorActive) return;
  const categories = flattenReaderCategories(readerLibraryTree);
  readerCategoryList.innerHTML = "";

  readerCategoryList.appendChild(
    createReaderSpecialRow(READER_RECENT_ID, "最近", readerRecentIconSvg, String(getReaderRecentPapers().length)),
  );
  readerCategoryList.appendChild(
    createReaderSpecialRow(
      READER_TODO_ID,
      "待办",
      readerTodoIconSvg,
      String(collectReaderPapers(readerLibraryTree).filter((paper) => paper.todo).length),
      () => toggleCurrentPaperTodo(),
      false,
      isCurrentPaperTodo() ? readerBookmarkCheckedSvg : readerBookmarkPlusSvg,
      isCurrentPaperTodo() ? "移除待办" : "加入待办",
      isCurrentPaperTodo(),
    ),
  );

  // 文献库: all papers, with the existing categories as its sub-list.
  const shouldShowCurrentCategoryPath = readerCategoryContainsId(readerLibraryTree, currentPaper?.category);
  readerCategoryList.appendChild(
    createReaderSpecialRow(READER_LIBRARY_ALL_ID, "文献库", readerLibraryIconSvg, String(collectReaderPapers(readerLibraryTree).length), (button) => startReaderCategoryCreate(null, button), true, readerPlusCircleSvg, "新建分类", false, shouldShowCurrentCategoryPath),
  );
  if (!isReaderCategoryCollapsed(READER_LIBRARY_ALL_ID) || shouldShowCurrentCategoryPath) {
    renderReaderCategoryNode(readerLibraryTree, 0);
  }

  let papers;
  if (readerSelectedCategoryId === READER_LIBRARY_ALL_ID || !readerSelectedCategoryId) {
    papers = collectReaderPapers(readerLibraryTree);
  } else if (readerSelectedCategoryId === READER_RECENT_ID) {
    papers = getReaderRecentPapers();
  } else if (readerSelectedCategoryId === READER_TODO_ID) {
    papers = collectReaderPapers(readerLibraryTree).filter((paper) => paper.todo);
  } else {
    const selected = categories.find((category) => category.id === readerSelectedCategoryId);
    // Include papers from the selected category and all of its subcategories.
    papers = collectReaderPapers(findReaderCategoryNode(readerLibraryTree, readerSelectedCategoryId) || selected);
  }

  const isRoot = readerSelectedCategoryId === READER_LIBRARY_ALL_ID || !readerSelectedCategoryId;
  const selectedCategory = categories.find((category) => category.id === readerSelectedCategoryId);
  const currentName =
    readerSelectedCategoryId === READER_RECENT_ID
      ? "最近"
      : readerSelectedCategoryId === READER_TODO_ID
        ? "待办"
        : isRoot
          ? "文献库"
          : selectedCategory?.name || "文献库";
  if (readerLocationCurrentName) {
    readerLocationCurrentName.textContent = currentName;
  }
  if (readerLocationCurrentCount) {
    readerLocationCurrentCount.textContent = papers.length ? String(papers.length) : "";
  }
  if (readerLocationCurrentButton) {
    readerLocationCurrentButton.title = `${currentName} (${papers.length})`;
  }
  if (readerLibraryTitle) {
    readerLibraryTitle.textContent = "文献库";
  }

  if (readerSearchQuery) {
    const query = readerSearchQuery;
    papers = papers.filter((paper) => String(paper.title || "").toLowerCase().includes(query));
  }

  readerPaperList.innerHTML = "";
  if (!papers.length) {
    const empty = document.createElement("div");
    empty.className = "reader-library-empty";
    empty.textContent = readerSearchQuery ? "没有匹配的论文。" : "No papers here.";
    readerPaperList.appendChild(empty);
    return;
  }
  papers.forEach((paper) => {
    const item = document.createElement("div");
    item.className = "reader-paper-item";
    item.classList.toggle("active", currentPaper?.id === paper.id);

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "reader-paper-open";
    openButton.title = paper.title;
    openButton.textContent = paper.title;
    openButton.addEventListener("click", () => {
      const params = new URLSearchParams({ id: paper.id });
      openReaderNavigationInNewTab(`./reader.html?${params.toString()}`);
    });

    const todoButton = document.createElement("button");
    todoButton.type = "button";
    todoButton.className = "reader-paper-todo-button";
    todoButton.classList.toggle("checked", Boolean(paper.todo));
    todoButton.setAttribute("aria-label", paper.todo ? "移除待办" : "加入待办");
    todoButton.title = paper.todo ? "移除待办" : "加入待办";
    todoButton.innerHTML = paper.todo ? readerBookmarkCheckedSvg : readerBookmarkPlusSvg;
    todoButton.addEventListener("click", (event) => {
      event.stopPropagation();
      setReaderPaperTodo(paper, !paper.todo).catch((error) => {
        console.error(error);
        setStatus(error.message || "更新待办失败。", true);
      });
    });

    item.append(openButton, todoButton);
    readerPaperList.appendChild(item);
  });
}

function openReaderNavigationInNewTab(url) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function isReaderUploadMenuOpen() {
  return Boolean(readerUploadMenu && !readerUploadMenu.hidden);
}

function openReaderUploadMenu() {
  if (!readerUploadMenu) return;
  readerUploadMenu.hidden = false;
  readerPaperUploadButton?.setAttribute("aria-expanded", "true");
  readerUploadMenu.classList.remove("drag-over");
  positionReaderUploadMenu();
  window.requestAnimationFrame(positionReaderUploadMenu);
}

function closeReaderUploadMenu() {
  if (!readerUploadMenu) return;
  readerUploadMenu.hidden = true;
  readerPaperUploadButton?.setAttribute("aria-expanded", "false");
  readerUploadMenu.classList.remove("drag-over");
}

function positionReaderUploadMenu() {
  if (!readerUploadMenu || readerUploadMenu.hidden || !readerPaperUploadButton) return;
  const buttonRect = readerPaperUploadButton.getBoundingClientRect();
  const menuRect = readerUploadMenu.getBoundingClientRect();
  const margin = 8;
  const gap = 10;
  const left = Math.min(buttonRect.right + gap, window.innerWidth - menuRect.width - margin);
  const top = Math.min(Math.max(buttonRect.top, margin), window.innerHeight - menuRect.height - margin);
  readerUploadMenu.style.left = `${Math.max(margin, left)}px`;
  readerUploadMenu.style.top = `${top}px`;
}

function handleReaderUploadDrag(event) {
  event.preventDefault();
  if (Array.from(event.dataTransfer?.items || []).some((item) => item.kind === "file")) {
    readerUploadMenu?.classList.add("drag-over");
  }
}

let readerUploadOverlayTimer = null;

function showReaderUploadOverlay(message, detail = "") {
  window.clearTimeout(readerUploadOverlayTimer);
  let overlay = document.querySelector("#readerUploadOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "readerUploadOverlay";
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
  overlay.classList.remove("error");
  overlay.querySelector(".arxiv-download-title").textContent = message;
  overlay.querySelector(".arxiv-download-detail").textContent = detail || "";
}

function hideReaderUploadOverlay() {
  window.clearTimeout(readerUploadOverlayTimer);
  document.querySelector("#readerUploadOverlay")?.remove();
}

function showReaderUploadError(message, detail = "") {
  showReaderUploadOverlay(message, detail);
  document.querySelector("#readerUploadOverlay")?.classList.add("error");
  readerUploadOverlayTimer = window.setTimeout(hideReaderUploadOverlay, 2600);
}

function showFloatingConfirm({ message, title = "确认操作", confirmLabel = "确认", cancelLabel = "取消", danger = false } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "reader-floating-confirm-overlay";
    const titleNode = document.createElement("strong");
    titleNode.className = "reader-floating-confirm-title";
    titleNode.textContent = title;
    const body = document.createElement("p");
    body.className = "reader-floating-confirm-message";
    body.textContent = message;
    const actions = document.createElement("div");
    actions.className = "reader-floating-confirm-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "reader-floating-confirm-cancel";
    cancel.textContent = cancelLabel;
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = `reader-floating-confirm-ok${danger ? " danger" : ""}`;
    ok.textContent = confirmLabel;
    actions.append(cancel, ok);

    let settled = false;
    const close = (value) => {
      if (settled) return;
      settled = true;
      overlay.remove();
      document.removeEventListener("keydown", onKeydown);
      resolve(value);
    };
    const onKeydown = (event) => {
      if (event.key === "Escape") close(false);
    };
    cancel.addEventListener("click", () => close(false));
    ok.addEventListener("click", () => close(true));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close(false);
    });
    document.addEventListener("keydown", onKeydown);

    const card = document.createElement("section");
    card.className = "reader-floating-confirm-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.append(titleNode, body, actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    ok.focus();
  });
}

async function uploadReaderLibraryPaper(file) {
  if (!file) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
    setStatus("请选择 PDF 文件。", true);
    return;
  }
  const title = file.name.replace(/\.pdf$/i, "");
  const formData = new FormData();
  formData.append("pdf", file);
  formData.append("title", title);
  formData.append("category", getReaderUploadCategory());

  const previousLabel = readerPaperUploadButton?.querySelector("span")?.textContent || "";
  try {
    if (readerPaperUploadButton) readerPaperUploadButton.disabled = true;
    const label = readerPaperUploadButton?.querySelector("span");
    if (label) label.textContent = "上传中";
    showReaderUploadOverlay("正在上传论文...", file.name);
    const response = await apiFetch("/api/library/upload", { method: "POST", body: formData });
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.error || "上传失败。");
    if (data.tree) readerLibraryTree = data.tree;
    renderReaderLibrary();
    hideReaderUploadOverlay();
    openReaderNavigationInNewTab(`./reader.html?${new URLSearchParams({ id: data.paper.id }).toString()}`);
  } catch (error) {
    console.error(error);
    showReaderUploadError(error.message || "上传失败。");
  } finally {
    if (readerPaperUploadButton) readerPaperUploadButton.disabled = false;
    const label = readerPaperUploadButton?.querySelector("span");
    if (label) label.textContent = previousLabel || "上传论文";
  }
}

async function uploadReaderRemotePaper(source) {
  const value = String(source || "").trim();
  if (!value) return;

  try {
    if (readerArxivUploadButton) {
      readerArxivUploadButton.disabled = true;
      readerArxivUploadButton.setAttribute("aria-label", "正在导入…");
    }
    showReaderUploadOverlay("正在导入论文...", value);
    const response = await apiFetch("/api/library/remote-pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdfUrl: value, category: getReaderUploadCategory() }),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.detail || data.error || "导入失败。");
    if (data.tree) readerLibraryTree = data.tree;
    renderReaderLibrary();
    hideReaderUploadOverlay();
    openReaderNavigationInNewTab(`./reader.html?${new URLSearchParams({ id: data.paper.id }).toString()}`);
  } catch (error) {
    console.error(error);
    showReaderUploadError(error.message || "导入失败。");
  } finally {
    if (readerArxivUploadButton) {
      readerArxivUploadButton.disabled = false;
      readerArxivUploadButton.setAttribute("aria-label", "上传");
    }
  }
}

function getReaderUploadCategory() {
  if (readerSelectedCategoryId && ![READER_LIBRARY_ALL_ID, READER_RECENT_ID, READER_TODO_ID].includes(readerSelectedCategoryId)) {
    return readerSelectedCategoryId;
  }
  return currentPaper?.category || READER_UNCATEGORIZED_ID;
}

function createReaderSpecialRow(id, label, iconSvg, countText = "", addHandler = null, collapsible = false, addIconSvg = readerPlusCircleSvg, addTitle = "新建分类", addActive = false, forceExpanded = false) {
  const row = document.createElement("div");
  row.className = "reader-category-row reader-special-row";
  const collapsed = isReaderCategoryCollapsed(id) && !forceExpanded;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "reader-category-item reader-special-item";
  button.classList.toggle("active", readerSelectedCategoryId === id);
  button.classList.toggle("reader-category-has-children", collapsible);
  button.style.paddingLeft = "8px";
  const icon = document.createElement("span");
  icon.className = "reader-category-folder-icon";
  icon.innerHTML = iconSvg;
  button.appendChild(icon);
  if (collapsible) {
    const toggle = document.createElement("span");
    toggle.className = "reader-category-collapse-toggle";
    toggle.setAttribute("aria-label", "展开/收起");
    toggle.textContent = collapsed ? "▸" : "▾";
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleReaderCategoryCollapsed(id);
      renderReaderLibrary();
    });
    button.appendChild(toggle);
  }
  button.appendChild(document.createTextNode(`${label}${countText ? ` (${countText})` : ""}`));
  button.addEventListener("click", () => {
    selectReaderLibraryCategory(id);
  });
  row.appendChild(button);
  if (addHandler) {
    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "reader-category-menu-button menu-button reader-add-category-button";
    addButton.classList.toggle("reader-add-category-button-active", addActive);
    addButton.setAttribute("aria-label", addTitle);
    addButton.title = addTitle;
    addButton.innerHTML = addIconSvg;
    addButton.addEventListener("click", (event) => {
      event.stopPropagation();
      addHandler(addButton);
    });
    row.appendChild(addButton);
  }
  return row;
}

function renderReaderCategoryNode(node, depth) {
  (node.folders || []).forEach((folder) => {
    renderReaderCategoryRow(folder, depth);
    if (folder.folders && folder.folders.length && (!isReaderCategoryCollapsed(folder.id) || readerCategoryContainsId(folder, currentPaper?.category))) {
      renderReaderCategoryNode(folder, depth + 1);
    }
  });
}

function renderReaderCategoryRow(node, depth) {
  const row = document.createElement("div");
  row.className = "reader-category-row";
  const hasChildren = Boolean(node.folders && node.folders.length);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "reader-category-item";
  button.classList.toggle("active", node.id === readerSelectedCategoryId);
  button.classList.toggle("reader-current-category-path", readerCategoryContainsId(node, currentPaper?.category));
  button.classList.toggle("reader-category-has-children", hasChildren);
  button.style.paddingLeft = `${8 + (depth + 1) * 12}px`;
  const icon = document.createElement("span");
  icon.className = "reader-category-folder-icon";
  icon.innerHTML = readerFolderIconSvg;
  button.appendChild(icon);
  if (hasChildren) {
    const collapsed = isReaderCategoryCollapsed(node.id) && !readerCategoryContainsId(node, currentPaper?.category);
    const toggle = document.createElement("span");
    toggle.className = "reader-category-collapse-toggle";
    toggle.setAttribute("aria-label", "展开/收起");
    toggle.textContent = collapsed ? "▸" : "▾";
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleReaderCategoryCollapsed(node.id);
      renderReaderLibrary();
    });
    button.appendChild(toggle);
  }
  button.appendChild(document.createTextNode(`${node.name} (${collectReaderPapers(node).length})`));
  button.addEventListener("click", () => {
    selectReaderLibraryCategory(node.id);
  });
  const menuButton = document.createElement("button");
  menuButton.type = "button";
  menuButton.className = "reader-category-menu-button menu-button";
  menuButton.textContent = "⋮";
  menuButton.setAttribute("aria-label", `${node.name} category actions`);
  menuButton.addEventListener("click", (event) => {
    event.stopPropagation();
    showReaderCategoryMenu(node, menuButton);
  });
  row.appendChild(button);
  row.appendChild(menuButton);
  readerCategoryList.appendChild(row);
}

function isReaderCategoryCollapsed(categoryId) {
  return localStorage.getItem(`paperLanternReaderCollapsed:${categoryId || "__root"}`) === "true";
}

function toggleReaderCategoryCollapsed(categoryId) {
  const key = `paperLanternReaderCollapsed:${categoryId || "__root"}`;
  const next = localStorage.getItem(key) !== "true";
  localStorage.setItem(key, String(next));
  return next;
}

function getReaderRecentPapers() {
  const all = collectReaderPapers(readerLibraryTree);
  let records = [];
  try {
    records = JSON.parse(localStorage.getItem("paperLanternRecentPapers") || "[]");
  } catch (error) {
    records = [];
  }
  const ids = new Set((Array.isArray(records) ? records : []).map((record) => record && record.id));
  return all.filter((paper) => ids.has(paper.id));
}

function isCurrentPaperTodo() {
  return Boolean(currentPaper?.todo || collectReaderPapers(readerLibraryTree).find((paper) => paper.id === currentPaper?.id)?.todo);
}

async function toggleCurrentPaperTodo() {
  if (!currentPaper?.id) {
    setStatus("未打开论文。", true);
    return;
  }
  await setReaderPaperTodo(currentPaper, !isCurrentPaperTodo());
}

async function setReaderPaperTodo(paper, nextTodo) {
  if (!paper?.id) {
    setStatus("未找到论文。", true);
    return;
  }
  try {
    const response = await apiFetch("/api/library/paper", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: paper.id, todo: nextTodo }),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.error || "更新待办失败。");
    paper.todo = nextTodo;
    if (currentPaper?.id === paper.id) {
      currentPaper = data.paper || { ...currentPaper, todo: nextTodo };
      currentPaper.todo = nextTodo;
    }
    if (data.tree) readerLibraryTree = data.tree;
    const libraryPaper = collectReaderPapers(readerLibraryTree).find((item) => item.id === paper.id);
    if (libraryPaper) libraryPaper.todo = nextTodo;
    setStatus(nextTodo ? "已加入待办。" : "已移除待办。");
    renderReaderLibrary();
  } catch (error) {
    paper.todo = !nextTodo;
    throw error;
  }
}

function isReaderUncategorizedCategory(category) {
  const id = String(category?.id || "").toLowerCase();
  const name = String(category?.name || "");
  return id === "uncategorized" || name === "未分类" || name.toLowerCase() === "uncategorized";
}

function createReaderUncategorizedIcon() {
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("focusable", "false");
  icon.classList.add("reader-category-icon");
  [
    ["path", { d: "M3 7.5A2.5 2.5 0 0 1 5.5 5h4.2l2 2H18.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9z" }],
    ["path", { d: "M8 12h8" }],
  ].forEach(([tag, attrs]) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    icon.appendChild(node);
  });
  return icon;
}

async function moveCurrentPaperToCategory(category) {
  if (!currentPaper?.id || !category) return;
  const targetCategory = category.id || category.name;
  if (!targetCategory || currentPaper.category === category.id) return;
  const previousText = statusText ? statusText.textContent : "";
  setStatus(`Moving to ${category.name}...`);
  try {
    const response = await apiFetch("/api/library/paper", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "move", id: currentPaper.id, category: targetCategory }),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.error || "Move failed.");
    currentPaper = data.paper || { ...currentPaper, category: targetCategory, categoryName: category.name };
    readerSelectedCategoryId = currentPaper.category || targetCategory;
    if (data.tree) {
      readerLibraryTree = data.tree;
      renderReaderLibrary();
    } else {
      await loadReaderLibrary();
    }
    setStatus(`Moved to ${category.name}.`);
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Move failed.", true);
  } finally {
    if (statusText && !statusText.classList.contains("error")) {
      window.setTimeout(() => {
        if (statusText && statusText.textContent.startsWith("Moved to ")) setStatus(previousText || "");
      }, 1600);
    }
  }
}

function showReaderCategoryMenu(category, anchor) {
  document.querySelector(".library-menu")?.remove();
  const menu = document.createElement("div");
  menu.className = "category-menu reader-category-menu library-menu";

  const moveButton = document.createElement("button");
  moveButton.type = "button";
  moveButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><path d="M8 13h7"></path><path d="m12 10 3 3-3 3"></path></svg>移动到此处';
  moveButton.disabled = !currentPaper?.id || currentPaper.category === category.id;
  moveButton.addEventListener("click", async () => {
    menu.remove();
    await moveCurrentPaperToCategory(category);
  });

  const renameButton = document.createElement("button");
  renameButton.type = "button";
  renameButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>重命名';
  renameButton.disabled = category.locked || !category.id;
  renameButton.addEventListener("click", () => {
    menu.remove();
    startReaderCategoryRename(category, anchor);
  });

  const createButton = document.createElement("button");
  createButton.type = "button";
  createButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><path d="M12 11v6"></path><path d="M9 14h6"></path></svg>新建子分类';
  createButton.addEventListener("click", () => {
    menu.remove();
    startReaderCategoryCreate(category, anchor);
  });

  menu.append(moveButton, renameButton, createButton);
  document.body.appendChild(menu);
  positionReaderMenu(menu, anchor, 210);
}

function positionReaderMenu(menu, anchor, width) {
  const rect = anchor.getBoundingClientRect();
  menu.style.left = `${Math.min(rect.left, window.innerWidth - width - 8)}px`;
  menu.style.top = `${rect.bottom + 4}px`;
}

function startReaderCategoryRename(category, anchor) {
  const row = anchor.closest(".reader-category-row");
  const button = row ? row.querySelector(".reader-category-item") : null;
  if (!row || !button) return;
  const menuButton = row.querySelector(".reader-category-menu-button");
  if (menuButton) menuButton.hidden = true;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "reader-category-inline-input";
  input.value = category.name;
  input.setAttribute("aria-label", "分类名称");
  input.setAttribute("maxlength", "120");
  button.replaceWith(input);
  readerCategoryInlineEditorActive = true;
  input.focus();
  input.select();

  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    readerCategoryInlineEditorActive = false;
    const name = input.value.trim();
    if (commit && name && name !== category.name) {
      updateReaderCategory({ action: "rename", id: category.id, name }).catch((error) => {
        console.error(error);
        renderReaderLibrary();
      });
    } else {
      renderReaderLibrary();
    }
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      finish(false);
    }
  });
  input.addEventListener("blur", () => finish(true));
}

function startReaderCategoryCreate(parentCategory, anchor) {
  const newRow = document.createElement("div");
  newRow.className = "reader-category-row reader-category-create-row";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "reader-category-inline-input";
  input.placeholder = "新分类名称";
  input.setAttribute("aria-label", "新分类名称");
  input.setAttribute("maxlength", "120");
  newRow.appendChild(input);

  if (parentCategory && anchor) {
    const parentRow = anchor.closest(".reader-category-row");
    input.style.paddingLeft = `${8 + (Number(parentCategory.depth || 0) + 1) * 12}px`;
    if (parentRow) parentRow.after(newRow);
    else readerCategoryList.prepend(newRow);
  } else if (anchor) {
    // Creating a top-level category: insert right below the 文献库 row.
    const anchorRow = anchor.closest(".reader-category-row");
    if (anchorRow) anchorRow.after(newRow);
    else readerCategoryList.prepend(newRow);
  } else {
    readerCategoryList.prepend(newRow);
  }
  input.focus();
  readerCategoryInlineEditorActive = true;

  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    readerCategoryInlineEditorActive = false;
    const name = input.value.trim();
    if (commit && name) {
      updateReaderCategory({ action: "create", parentId: parentCategory ? parentCategory.id : "", name }).catch((error) => {
        console.error(error);
        renderReaderLibrary();
      });
    } else {
      newRow.remove();
    }
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      finish(false);
    }
  });
  input.addEventListener("blur", () => finish(true));
}

async function updateReaderCategory(payload) {
  try {
    const response = await apiFetch("/api/library/category", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.error || "Category operation failed.");
    readerLibraryTree = data.tree;
    if (payload.action === "create" && data.categoryId) {
      readerSelectedCategoryId = data.categoryId;
    } else if (payload.action === "rename" && data.categoryId) {
      if (readerSelectedCategoryId === payload.id) readerSelectedCategoryId = data.categoryId;
      if (currentPaper?.category === payload.id) currentPaper.category = data.categoryId;
    }
    renderReaderLibrary();
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Category operation failed.", true);
  }
}

function flattenReaderCategories(node, depth = 0, includeCurrent = false) {
  if (!node) return [];
  const current = includeCurrent
    ? [
        {
          id: node.id || "",
          name: node.name || "Library",
          depth,
          paperCount: collectReaderPapers(node).length,
          papers: node.papers || [],
        },
      ]
    : [];
  const childDepth = includeCurrent ? depth + 1 : depth;
  return [...current, ...(node.folders || []).flatMap((folder) => flattenReaderCategories(folder, childDepth, true))];
}

function collectReaderPapers(node) {
  if (!node) return [];
  return [...(node.papers || []), ...(node.folders || []).flatMap(collectReaderPapers)];
}

function findReaderCategoryNode(node, id) {
  if (!node) return null;
  if ((node.id || "") === id) return node;
  for (const folder of node.folders || []) {
    const found = findReaderCategoryNode(folder, id);
    if (found) return found;
  }
  return null;
}

function readerCategoryContainsId(node, categoryId) {
  if (!node || !categoryId) return false;
  if (node.id === categoryId) return true;
  return (node.folders || []).some((folder) => readerCategoryContainsId(folder, categoryId));
}

async function openReaderFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const paperId = params.get("id");
  if (!paperId) {
    setStatus("缺少论文 ID，请从文献库打开论文。", true);
    return;
  }
  await openLibraryPaper(paperId);
}

async function openLibraryPaper(paperId) {
  setStatus("正在打开论文...");
  const response = await apiFetch(`/api/library/paper?id=${encodeURIComponent(paperId)}`);
  const data = await readJsonResponse(response);
  if (!response.ok) {
    setStatus(data.error || "打开论文失败", true);
    return;
  }

  currentPaper = data.paper;
  readerSelectedCategoryId = currentPaper.category || readerSelectedCategoryId;
  savedHighlights = normalizeHighlights(Array.isArray(currentPaper.highlights) ? currentPaper.highlights : []);
  renderDiscussionHistory(currentPaper.discussion || []);
  renderNotes(currentPaper.notes || "");
  renderSummary(paperToSummary(currentPaper));
  renderBasicInfo(currentPaper.basicInfo, currentPaper);
  renderDoi(currentPaper.doi);
  resetCitationSection();
  loadCurrentCitationInfo().catch((error) => console.error("Failed to load current citation info.", error));
  setReaderPaperTitle(currentPaper.title);
  renderReaderLibrary();

  const pdfResponse = await apiFetch(currentPaper.pdfUrl);
  const blob = await pdfResponse.blob();
  const file = new File([blob], `${currentPaper.title}.pdf`, { type: "application/pdf" });
  lastExtractedText = "";
  referenceEntries = new Map();
  showPdf(file, currentPaper.title);
  setBusy(true);
  clearStatus();
  if (!currentPaper.threeLineSummary?.method) {
    renderSummaryLoading("解析论文并生成总结中...");
  }

  try {
    const cachedText = String(currentPaper.extractedText || "").trim();
    const extraction = cachedText.length >= 80 ? { text: cachedText, title: "" } : await extractPdfText(file);
    const extractedText = extraction.text;
    lastExtractedText = extractedText;
    referenceEntries = extractReferenceEntries(extractedText);
    refreshReferenceCitations();
    if (extraction.title) {
      setReaderPaperTitle(extraction.title);
      currentPaper.title = extraction.title;
      if (basicInfoTitle) basicInfoTitle.textContent = formatBasicInfoValue(currentPaper.title);
      saveCurrentPaper({ title: extraction.title }).catch((error) => console.error("Failed to save extracted title.", error));
    }

    if (extractedText.trim().length < 80) {
      setStatus("Not enough text was extracted. This PDF may be scanned; paste text manually and retry.", true);
      return;
    }

    if (!cachedText) {
      saveExtractedTextCache(extractedText).catch((error) => console.error("Failed to save extracted text cache.", error));
    }

    if (!currentPaper.threeLineSummary?.method) {
      await summarizeText(extractedText);
    }
  } catch (error) {
    console.error(error);
    renderSummary(paperToSummary(currentPaper));
    setStatus(error.message || "Failed to read PDF.", true);
  } finally {
    setBusy(false);
  }
}

document.addEventListener("selectionchange", handlePdfSelectionChange);
pdfViewer.addEventListener("wheel", handlePdfWheel, { passive: false });
pdfViewer.addEventListener("scroll", () => {
  updatePageIndicator();
  hideReferencePopover();
  scheduleVisiblePdfRender();
  scheduleSaveReadingPosition();
});
window.addEventListener("beforeunload", saveReadingPositionNow);
pdfViewer.addEventListener("pointerdown", handlePdfSelectionPointerDown);
pdfViewer.addEventListener("lostpointercapture", resetPdfSelectionPointerState);
pdfViewer.addEventListener("click", handlePdfClick);
document.addEventListener("pointerup", handlePdfSelectionPointerFinish);
document.addEventListener("pointercancel", handlePdfSelectionPointerFinish);
window.addEventListener("blur", resetPdfSelectionPointerState);
document.addEventListener("pointerdown", (event) => {
  const translationBubble = document.querySelector("#translationBubble");
  const annotationEditor = document.querySelector("#annotationEditor");
  const referencePopover = document.querySelector("#referencePopover");
  const clickedFloatingUi =
    selectionMenu.contains(event.target) ||
    translationBubble?.contains(event.target) ||
    annotationEditor?.contains(event.target) ||
    referencePopover?.contains(event.target) ||
    readerUploadMenu?.contains(event.target);
  if (!event.target.closest(".library-menu") && !event.target.closest(".menu-button")) {
    document.querySelector(".library-menu")?.remove();
  }
  if (!event.target.closest(".reader-upload-menu") && !event.target.closest("#readerPaperUploadButton")) {
    closeReaderUploadMenu();
  }
  if (!clickedFloatingUi) {
    hideTranslationBubble();
    hideReferencePopover();
    hideAnnotationEditor();
  }

  if (!selectionMenu.contains(event.target) && !pdfViewer.contains(event.target)) {
    hideSelectionMenu();
  }
});

highlightButton.addEventListener("mousedown", (event) => event.preventDefault());
commentButton.addEventListener("mousedown", (event) => event.preventDefault());
translateButton.addEventListener("mousedown", (event) => event.preventDefault());
explainButton.addEventListener("mousedown", (event) => event.preventDefault());
askSelectionButton?.addEventListener("mousedown", (event) => event.preventDefault());
highlightButton.addEventListener("click", highlightSelection);
commentButton.addEventListener("click", commentSelection);
translateButton.addEventListener("click", translateSelection);
explainButton.addEventListener("click", explainSelection);
askSelectionButton?.addEventListener("click", askSelectionInDiscussion);
discussionForm?.addEventListener("submit", handleDiscussionSubmit);
discussionInput?.addEventListener("keydown", handleDiscussionInputKeydown);
newDiscussionListButton?.addEventListener("click", createBlankDiscussion);
newDiscussionFromThreadButton?.addEventListener("click", createBlankDiscussion);
discussionHistoryButton?.addEventListener("click", () => toggleDiscussionHistoryDropdown(discussionHistoryButton));
discussionTitleEditButton?.addEventListener("click", startThreadTitleRename);
discussionThreadTitle?.addEventListener("click", scrollActiveDiscussionToBottom);
backToDiscussionsButton?.addEventListener("click", () => showDiscussionList());
initDiscussionCompactBar();
copyThreeLineButton?.addEventListener("click", () => copyReaderSection("threeLine", copyThreeLineButton));
copyMethodButton?.addEventListener("click", () => copyReaderSection("method", copyMethodButton));

regenerateKeywordsButton?.addEventListener("click", () => regenerateSummarySection("keywords"));
regenerateThreeLineButton?.addEventListener("click", () => regenerateSummarySection("threeLine"));
regenerateMethodButton?.addEventListener("click", () => regenerateSummarySection("method"));

basicInfoButton?.addEventListener("click", async () => {
  const text = lastExtractedText.trim();
  if (text.length < 80) {
    setBasicInfoStatus("请先打开并解析一篇论文。", true);
    return;
  }

  setBusy(true);
  basicInfoButton.classList.add("spinning");
  setBasicInfoStatus("正在整理基本信息...");
  renderBasicInfoLoading();
  try {
    await refreshOverviewInfo(text);
    setBasicInfoStatus("");
  } catch (error) {
    console.error(error);
    renderBasicInfo(currentPaper?.basicInfo);
    setBasicInfoStatus(error.message || "基本信息整理失败。", true);
  } finally {
    basicInfoButton.classList.remove("spinning");
    setBusy(false);
  }
});

generateCitationButton?.addEventListener("click", () => {
  generateCitation();
});
copyDoiButton?.addEventListener("click", () => copyCurrentDoi(copyDoiButton));
openDoiButton?.addEventListener("click", openCurrentDoi);

function initReaderTabs() {
  readerTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const isCollapsed = appShell.classList.contains("summary-pane-collapsed");
      const isActive = tab.classList.contains("active");
      if (isActive && !isCollapsed) {
        setSummaryPaneCollapsed(true);
        return;
      }
      if (!isActive) setActiveReaderTab(tab.id);
      if (isCollapsed) {
        setSummaryPaneCollapsed(false);
      }
    });
  });
}

function initReaderSideRail() {
  const tabs = document.querySelector(".reader-tabs");
  if (readerSideRail && tabs) readerSideRail.append(tabs);
}

exportPdfButton?.addEventListener("click", exportCurrentPaperPdf);

async function exportCurrentPaperPdf() {
  if (!currentPaper?.id) {
    setStatus("No paper is open to export.", true);
    return;
  }

  exportPdfButton.disabled = true;
  try {
    // Download straight from the server URL instead of fetching into a blob:
    // the browser streams the file natively (honouring Content-Length), which
    // avoids the object-URL/revoke class of issues that can leave a download
    // sitting at 100% without finalizing.
    const origin = window.location.origin && window.location.origin !== "null" ? window.location.origin : "http://127.0.0.1:8000";
    const base = apiBaseUrl || origin;
    const exportUrl = `${base}/api/library/export?id=${encodeURIComponent(currentPaper.id)}`;
    setStatus("正在导出...");
    const link = document.createElement("a");
    link.href = exportUrl;
    link.download = `${cleanExportFilename(currentPaper.title)}-export.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => {
      if (statusText && statusText.textContent === "正在导出...") setStatus("");
    }, 4000);
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Export failed.", true);
  } finally {
    exportPdfButton.disabled = false;
  }
}

function initNotesPanel() {
  notesEditor?.addEventListener("input", () => {
    renderNotesPreview(notesEditor.value);
    window.clearTimeout(notesAutoSaveTimer);
    notesAutoSaveTimer = window.setTimeout(() => {
      saveNotes().catch((error) => console.error("Failed to auto-save notes.", error));
    }, 700);
  });
  toggleNotesModeButton?.addEventListener("click", toggleNotesMode);
  copyNotesButton?.addEventListener("click", copyNotes);
  exportNotesPdfButton?.addEventListener("click", exportNotesPdf);
  renderNotes("");
}

function renderNotes(value) {
  const notes = String(value || "");
  if (notesEditor) notesEditor.value = notes;
  notesLastSavedValue = notes;
  renderNotesPreview(notes);
  setNotesMode("edit");
}

function renderNotesPreview(value) {
  if (!notesPreview) return;
  const source = String(value || "").trim();
  notesPreview.innerHTML = source ? renderDiscussionMarkdown(source) : "<p>Notes preview</p>";
}

function setNotesMode(mode) {
  notesMode = mode === "preview" ? "preview" : "edit";
  if (notesWorkspace) notesWorkspace.dataset.mode = notesMode;
  if (notesEditor) notesEditor.hidden = notesMode !== "edit";
  if (notesPreview) notesPreview.hidden = notesMode !== "preview";
  if (!toggleNotesModeButton) return;
  const isPreview = notesMode === "preview";
  toggleNotesModeButton.setAttribute("aria-label", isPreview ? "Edit notes" : "Preview notes");
  toggleNotesModeButton.title = isPreview ? "Edit notes" : "Preview notes";
  toggleNotesModeButton.innerHTML = isPreview
    ? `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 20h9"></path>
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
      </svg>`
    : `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"></path>
        <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"></path>
      </svg>`;
}

function toggleNotesMode() {
  if (notesMode === "edit") renderNotesPreview(notesEditor?.value || "");
  setNotesMode(notesMode === "edit" ? "preview" : "edit");
}

async function copyNotes() {
  const value = notesEditor?.value || "";
  if (!value) return;
  try {
    await copyTextToClipboard(value);
    showCopiedFeedback(copyNotesButton);
  } catch (error) {
    console.error("Failed to copy notes.", error);
  }
}

async function saveNotes() {
  if (!currentPaper?.id || !notesEditor || notesIsSaving) return;
  const notes = notesEditor.value;
  window.clearTimeout(notesAutoSaveTimer);
  if (notes === notesLastSavedValue) {
    return;
  }
  notesIsSaving = true;
  try {
    await saveCurrentPaper({ notes });
    notesLastSavedValue = String(currentPaper?.notes || notes);
  } catch (error) {
    console.error(error);
  } finally {
    notesIsSaving = false;
  }
}

async function exportNotesPdf() {
  if (!currentPaper?.id) {
    return;
  }
  await saveNotes();
  if (exportNotesPdfButton) exportNotesPdfButton.disabled = true;
  try {
    const notes = notesEditor?.value || "";
    renderNotesPreview(notes);
    const response = await apiFetch("/api/library/notes/pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: currentPaper.id, notes }),
    });
    const blob = await response.blob();
    if (!response.ok) {
      const detail = await blob.text();
      throw new Error(detail || "Notes export failed.");
    }
    triggerBlobDownload(blob, `${currentPaper.title || "paper"}-notes.pdf`);
  } catch (error) {
    console.error(error);
  } finally {
    if (exportNotesPdfButton) exportNotesPdfButton.disabled = false;
  }
}

function cleanExportFilename(value) {
  return String(value || "")
    .replace(/[\\/:*?"<>|\x00-\x1f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function triggerBlobDownload(blob, filename) {
  const link = document.createElement("a");
  const objectUrl = URL.createObjectURL(blob);
  link.href = objectUrl;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  // Revoking too early can interrupt a large download mid-write (the browser
  // may sit at 100% without finalizing the file). Keep the URL alive long
  // enough for the save to finish; it is cleaned up on page unload anyway.
  window.setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(objectUrl);
  }, 10000);
}

function setActiveReaderTab(activeTabId) {
  readerTabs.forEach((tab) => {
    const isActive = tab.id === activeTabId;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });
  readerTabPanels.forEach((panel) => {
    const isActive = panel.getAttribute("aria-labelledby") === activeTabId;
    panel.classList.toggle("active", isActive);
    panel.hidden = !isActive;
  });
}

function initCollapsibleSummaryCards() {
  document.querySelectorAll("[data-collapsible-card]").forEach((card) => {
    const toggle = card.querySelector(".summary-card-toggle");
    if (!toggle) return;

    const contentId = toggle.getAttribute("aria-controls");
    const content = contentId ? document.getElementById(contentId) : null;
    const storageKey = `summaryCardCollapsed:${contentId || toggle.textContent.trim()}`;
    const isCollapsed = localStorage.getItem(storageKey) === "true";
    setSummaryCardCollapsed(card, toggle, content, isCollapsed);

    toggle.addEventListener("click", () => {
      const nextCollapsed = toggle.getAttribute("aria-expanded") === "true";
      setSummaryCardCollapsed(card, toggle, content, nextCollapsed);
      localStorage.setItem(storageKey, String(nextCollapsed));
    });
  });
}

function setSummaryCardCollapsed(card, toggle, content, isCollapsed) {
  card.classList.toggle("collapsed", isCollapsed);
  toggle.setAttribute("aria-expanded", String(!isCollapsed));
  if (content) content.hidden = isCollapsed;
}

function paperToSummary(paper) {
  if (!paper) return null;
  return {
    paperTitle: paper.title,
    keywords: paper.keywords || [],
    keywordExplanations: paper.keywordExplanations || {},
    basicInfo: paper.basicInfo || {},
    threeLineSummary: paper.threeLineSummary || {},
    methodOverview: paper.methodOverview || "",
    methodSections: paper.methodSections || [],
    methodConclusion: paper.methodConclusion || "",
  };
}

function handleDiscussionInputKeydown(event) {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  discussionForm?.requestSubmit();
}

async function handleDiscussionSubmit(event) {
  event.preventDefault();
  if (discussionIsBusy) return;

  const question = discussionInput.value.trim();
  if (!question) return;

  const paperText = lastExtractedText.trim();
  const thread = ensureActiveDiscussion(question);
  const selectionReference = normalizeDiscussionReference(thread.reference);
  const isFirstDiscussionTurn = normalizeDiscussionHistory(thread.messages).length === 0;
  if (paperText.length < 80) {
    appendDiscussionMessage("assistant", "请先打开并解析一篇论文，再开始讨论。");
    return;
  }

  const firstTurnQuote = isFirstDiscussionTurn && selectionReference?.text ? selectionReference.text : null;
  appendDiscussionMessage("user", question, -1, firstTurnQuote);
  discussionInput.value = "";
  setDiscussionBusy(true);
  const pending = appendDiscussionMessage("assistant", "Thinking...");
  pending.classList.add("pending");

  try {
    let answer = "";
    await requestDiscussionAnswer({
      paperText,
      question,
      summary: paperToSummary(currentPaper),
      history: thread.messages,
      selectionReference,
      onDelta: (delta) => {
        answer += delta;
        setDiscussionMessageContent(pending.querySelector(".discussion-message-body"), answer || "Thinking...", "assistant");
      },
    });

    pending.classList.remove("pending");
    thread.messages.push({ role: "user", content: question }, { role: "assistant", content: answer || "" });
    thread.updatedAt = new Date().toISOString();
    if (isFirstDiscussionTurn) {
      thread.title = makeDiscussionTitle(question);
      renderDiscussionThreadList();
      renderDiscussionThreadHeader(thread);
      const generatedTitle = await requestDiscussionTitle({
        paperTitle: currentPaper?.title || fileName?.textContent || "",
        question,
        answer,
        selectionReference,
      });
      if (generatedTitle) thread.title = generatedTitle;
    } else if (!thread.title || thread.title === "New discussion") {
      thread.title = makeDiscussionTitle(question);
    }
    thread.hash = await makeDiscussionThreadHash(thread);
    renderDiscussionMessages(thread.messages, thread.reference);
    renderDiscussionReferenceBox(null);
    renderDiscussionThreadList();
    renderDiscussionThreadHeader(thread);
    await saveDiscussionThreads();
  } catch (error) {
    console.error(error);
    pending.classList.remove("pending");
    pending.classList.add("error");
    setDiscussionMessageContent(
      pending.querySelector(".discussion-message-body"),
      error.message || "讨论失败，请稍后重试。",
      "assistant",
    );
  } finally {
    setDiscussionBusy(false);
  }
}

async function requestDiscussionTitle({ paperTitle, question, answer, selectionReference }) {
  try {
    const response = await apiFetch("/api/discussion-title", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paperTitle,
        question,
        answer,
        selectionReference: normalizeDiscussionReference(selectionReference),
      }),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.detail || data.error || "Failed to generate discussion title.");
    return sanitizeDiscussionTitle(data.title);
  } catch (error) {
    console.warn("Failed to generate discussion title.", error);
    return "";
  }
}

function createDiscussionThread(initialQuestion = "", shouldSave = false, reference = null) {
  const normalizedReference = normalizeDiscussionReference(reference);
  const thread = {
    id: makeDiscussionId(),
    title: initialQuestion ? makeDiscussionTitle(initialQuestion) : (normalizedReference ? "引用提问" : "New discussion"),
    messages: [],
    reference: normalizedReference,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  discussionThreads.unshift(thread);
  activeDiscussionId = thread.id;
  renderDiscussionThreadList();
  showDiscussionThread(thread.id);
  if (shouldSave) saveDiscussionThreads();
  return thread;
}

function createBlankDiscussion(event) {
  event?.stopPropagation();
  const thread = createDiscussionThread("", true);
  renderDiscussionReferenceBox(thread.reference);
  discussionInput.value = "";
  discussionInput?.focus();
}

function ensureActiveDiscussion(initialQuestion = "") {
  let thread = discussionThreads.find((item) => item.id === activeDiscussionId);
  if (!thread) thread = createDiscussionThread(initialQuestion);
  return thread;
}

function showDiscussionList() {
  closeDiscussionHistoryDropdown();
  activeDiscussionId = null;
  discussionListView.hidden = false;
  discussionThreadView.hidden = true;
  renderDiscussionThreadList();
  renderDiscussionReferenceBox(null);
  clearDiscussionReferenceHighlights();
  syncDiscussionCompactBar();
}

function showDiscussionThread(threadId) {
  closeDiscussionHistoryDropdown();
  const thread = discussionThreads.find((item) => item.id === threadId);
  if (!thread) return showDiscussionList();
  activeDiscussionId = thread.id;
  discussionListView.hidden = true;
  discussionThreadView.hidden = false;
  renderDiscussionThreadHeader(thread);
  renderDiscussionMessages(thread.messages, thread.reference);
  const hasMessages = normalizeDiscussionHistory(thread.messages).length > 0;
  // The quoted text box above the input is only for composing a new thread's
  // first question; once the conversation has messages it lives in the first
  // user message instead.
  renderDiscussionReferenceBox(hasMessages ? null : thread.reference);
  syncDiscussionCompactBar();
  retryApplyReferenceHighlight(14);
}

let discussionHistoryPopover = null;

function toggleDiscussionHistoryDropdown(anchorButton = null) {
  if (discussionHistoryPopover) {
    closeDiscussionHistoryDropdown();
    return;
  }
  const anchor = anchorButton || discussionHistoryButton;
  if (!anchor) return;

  const popover = document.createElement("div");
  popover.className = "discussion-history-popover";

  const searchWrap = document.createElement("div");
  searchWrap.className = "discussion-history-search-wrap";
  searchWrap.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="7"></circle><path d="m21 21-4.3-4.3"></path></svg>';
  const search = document.createElement("input");
  search.className = "discussion-history-search";
  search.type = "text";
  search.placeholder = "搜索对话…";
  search.setAttribute("aria-label", "搜索对话");
  searchWrap.appendChild(search);

  const list = document.createElement("div");
  list.className = "discussion-history-list";

  popover.append(searchWrap, list);

  const pencilSvg =
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"></path></svg>';

  const afterRename = (thread) => {
    renderItems();
    renderDiscussionThreadList();
    if (thread.id === activeDiscussionId) renderDiscussionThreadHeader(thread);
  };

  const beginHistoryRename = (thread, row) => {
    if (row.querySelector("form")) return;
    const form = document.createElement("form");
    form.className = "discussion-history-rename-form";
    const input = document.createElement("input");
    input.className = "discussion-history-rename-input";
    input.type = "text";
    input.maxLength = 120;
    input.setAttribute("aria-label", "Discussion name");
    input.value = thread.title || "New discussion";
    form.appendChild(input);

    const restore = () => {
      form.remove();
      renderItems();
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        restore();
      }
    });
    input.addEventListener("blur", () => {
      window.setTimeout(() => {
        if (!form.contains(document.activeElement)) restore();
      }, 0);
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const next = input.value.replace(/\s+/g, " ").trim();
      if (!next) return restore();
      thread.title = next.slice(0, 120);
      thread.hash = await makeDiscussionThreadHash(thread);
      await saveDiscussionThreads();
      afterRename(thread);
    });

    row.replaceChildren(form);
    input.focus();
    input.select();
  };

  const buildRow = (thread) => {
    const row = document.createElement("div");
    row.className = "discussion-history-item";
    row.classList.toggle("active", thread.id === activeDiscussionId);
    row.setAttribute("role", "button");
    row.tabIndex = 0;

    const titleWrap = document.createElement("span");
    titleWrap.className = "discussion-history-title-wrap";
    const title = document.createElement("span");
    title.className = "discussion-history-title";
    title.textContent = thread.title || "New discussion";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "discussion-history-edit";
    edit.setAttribute("aria-label", "重命名对话");
    edit.title = "重命名对话";
    edit.innerHTML = pencilSvg;
    edit.addEventListener("click", (event) => {
      event.stopPropagation();
      beginHistoryRename(thread, row);
    });
    titleWrap.append(title, edit);

    const meta = document.createElement("span");
    meta.className = "discussion-history-meta";
    meta.textContent = formatDiscussionUpdatedAt(thread.updatedAt || thread.createdAt);

    row.append(titleWrap, meta);
    row.title = thread.title || "New discussion";
    row.addEventListener("click", () => showDiscussionThread(thread.id));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        showDiscussionThread(thread.id);
      }
    });
    return row;
  };

  const renderItems = () => {
    const query = search.value.trim().toLowerCase();
    const visible = discussionThreads.filter((thread) => {
      const title = String(thread.title || "New discussion").toLowerCase();
      return !query || title.includes(query);
    });
    list.innerHTML = "";
    if (!visible.length) {
      const empty = document.createElement("div");
      empty.className = "discussion-history-empty";
      empty.textContent = "没有匹配的对话";
      list.appendChild(empty);
      return;
    }
    visible.forEach((thread) => list.appendChild(buildRow(thread)));
  };

  search.addEventListener("input", renderItems);
  popover.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDiscussionHistoryDropdown();
    }
  });

  document.body.appendChild(popover);
  discussionHistoryPopover = popover;

  // Position the popover near the anchor (header button or compact bar).
  popover.style.visibility = "hidden";
  const rect = anchor.getBoundingClientRect();
  const margin = 8;
  const popWidth = popover.offsetWidth || Math.min(320, window.innerWidth - margin * 2);
  const popHeight = popover.offsetHeight || 320;
  const left = Math.max(margin, Math.min(rect.left, window.innerWidth - popWidth - margin));
  const below = rect.bottom + 6;
  const top = below + popHeight > window.innerHeight - margin ? Math.max(margin, rect.top - popHeight - 6) : below;
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
  popover.style.visibility = "";

  const closeOnOutside = (event) => {
    if (!popover.contains(event.target) && event.target !== anchor) {
      closeDiscussionHistoryDropdown();
    }
  };
  popover._closeOnOutside = closeOnOutside;
  document.addEventListener("pointerdown", closeOnOutside);

  renderItems();
  window.requestAnimationFrame(() => search.focus());
}

function closeDiscussionHistoryDropdown() {
  if (!discussionHistoryPopover) return;
  if (discussionHistoryPopover._closeOnOutside) {
    document.removeEventListener("pointerdown", discussionHistoryPopover._closeOnOutside);
  }
  discussionHistoryPopover.remove();
  discussionHistoryPopover = null;
}

function initDiscussionCompactBar() {
  if (discussionCompactInitDone || !discussionCompactBar) return;
  discussionCompactInitDone = true;

  const header = document.querySelector(".discussion-thread-header");
  if (header && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry) {
          discussionHeaderVisible = entry.isIntersecting;
          syncDiscussionCompactBar();
        }
      },
      { threshold: 0 },
    );
    observer.observe(header);
  }

  discussionCompactNewButton?.addEventListener("click", createBlankDiscussion);
  discussionCompactHistoryButton?.addEventListener("click", () => toggleDiscussionHistoryDropdown(discussionCompactHistoryButton));
  discussionCompactTitle?.addEventListener("click", scrollActiveDiscussionToBottom);
  discussionReferenceBox?.addEventListener("click", openActiveDiscussionReference);
}

function scrollActiveDiscussionToBottom() {
  if (!discussionMessages) return;
  const last = discussionMessages.lastElementChild;
  if (last) last.scrollIntoView({ block: "end", behavior: "smooth" });
  else discussionThreadView?.scrollIntoView({ block: "end", behavior: "smooth" });
}

function syncDiscussionCompactBar() {
  if (!discussionCompactBar || !discussionCompactTitle) return;
  const thread = discussionThreads.find((item) => item.id === activeDiscussionId);
  // Show the bar whenever no conversation is selected (it then reads "新讨论"),
  // or when the selected conversation's header has scrolled out of view.
  const show = !thread || !discussionHeaderVisible;
  discussionCompactBar.classList.toggle("discussion-compact-visible", show);
  discussionCompactBar.setAttribute("aria-hidden", String(!show));
  discussionCompactTitle.textContent = thread?.title || "新讨论";
  discussionCompactTitle.title = thread?.title || "新讨论";
}

function renderDiscussionThreadHeader(thread) {
  if (!discussionThreadTitle) return;
  if (discussionTitleRenaming) {
    discussionThreadTitle.parentElement?.querySelector(".discussion-title-rename-form")?.remove();
    discussionTitleRenaming = false;
  }
  discussionThreadTitle.hidden = false;
  discussionThreadTitle.textContent = thread?.title || "New discussion";
  discussionThreadTitle.title = thread?.title || "New discussion";
  if (discussionTitleEditButton) discussionTitleEditButton.hidden = false;
  syncDiscussionCompactBar();
}

function startThreadTitleRename() {
  const thread = discussionThreads.find((item) => item.id === activeDiscussionId);
  if (!thread || discussionTitleRenaming || !discussionThreadTitle) return;
  const group = discussionThreadTitle.parentElement;
  if (!group || group.querySelector(".discussion-title-rename-form")) return;

  discussionTitleRenaming = true;
  const form = document.createElement("form");
  form.className = "discussion-title-rename-form";
  const input = document.createElement("input");
  input.className = "discussion-title-rename-input";
  input.type = "text";
  input.maxLength = 120;
  input.setAttribute("aria-label", "Discussion name");
  input.value = thread.title || "New discussion";
  form.appendChild(input);
  group.appendChild(form);
  discussionThreadTitle.hidden = true;
  if (discussionTitleEditButton) discussionTitleEditButton.hidden = true;

  const finish = (nextTitle) => {
    form.remove();
    discussionTitleRenaming = false;
    if (discussionThreadTitle) {
      discussionThreadTitle.hidden = false;
      discussionThreadTitle.textContent = nextTitle || thread.title || "New discussion";
    }
    if (discussionTitleEditButton) discussionTitleEditButton.hidden = false;
  };

  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      finish();
    }
  });
  input.addEventListener("blur", () => {
    window.setTimeout(() => {
      if (!form.contains(document.activeElement)) finish();
    }, 0);
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const next = input.value.replace(/\s+/g, " ").trim();
    if (!next) return finish();
    thread.title = next.slice(0, 120);
    thread.hash = await makeDiscussionThreadHash(thread);
    discussionTitleRenaming = false;
    form.remove();
    renderDiscussionThreadHeader(thread);
    renderDiscussionThreadList();
    await saveDiscussionThreads();
  });

  input.focus();
  input.select();
}

function renderDiscussionReferenceBox(reference) {
  const normalized = normalizeDiscussionReference(reference);
  if (!discussionReferenceBox || !discussionReferenceText) return;
  discussionReferenceBox.hidden = !normalized;
  discussionReferenceText.textContent = normalized?.text || "";
  discussionReferenceText.title = normalized?.text || "";
}

function renderDiscussionThreadList() {
  if (!discussionThreadList) return;
  discussionThreadList.innerHTML = "";
  if (!discussionThreads.length) {
    const empty = document.createElement("div");
    empty.className = "discussion-empty";
    empty.textContent = "Start typing below to begin a discussion.";
    discussionThreadList.appendChild(empty);
    return;
  }
  discussionThreads.forEach((thread) => {
    const item = document.createElement("div");
    item.className = "discussion-thread-item";
    item.dataset.threadId = thread.id;

    const openRow = document.createElement("div");
    openRow.className = "discussion-thread-open";
    openRow.setAttribute("role", "button");
    openRow.tabIndex = 0;

    const titleWrap = document.createElement("span");
    titleWrap.className = "discussion-thread-item-title-wrap";
    const title = document.createElement("span");
    title.className = "discussion-thread-item-title";
    title.textContent = thread.title || "New discussion";
    const titleEdit = document.createElement("button");
    titleEdit.type = "button";
    titleEdit.className = "discussion-thread-item-edit";
    titleEdit.setAttribute("aria-label", "重命名对话");
    titleEdit.title = "重命名对话";
    titleEdit.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"></path></svg>';
    titleEdit.addEventListener("click", (event) => {
      event.stopPropagation();
      startDiscussionThreadRename(thread.id);
    });
    titleWrap.append(title, titleEdit);

    const meta = document.createElement("span");
    meta.className = "discussion-thread-item-meta";
    meta.textContent = formatDiscussionUpdatedAt(thread.updatedAt || thread.createdAt);
    openRow.append(titleWrap, meta);
    openRow.addEventListener("click", () => showDiscussionThread(thread.id));
    openRow.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        showDiscussionThread(thread.id);
      }
    });

    const deleteButton = createMessageActionButton("delete", "Delete discussion");
    deleteButton.classList.add("discussion-thread-delete");
    deleteButton.addEventListener("click", () => deleteDiscussionThread(thread.id));

    item.append(openRow, deleteButton);
    discussionThreadList.appendChild(item);
  });
}

function formatDiscussionUpdatedAt(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "No recent activity";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs >= 0 && diffMs < minute) return "刚刚";
  if (diffMs >= 0 && diffMs < hour) return `${Math.floor(diffMs / minute)} 分钟前`;
  if (diffMs >= 0 && diffMs < day) return `${Math.floor(diffMs / hour)} 小时前`;
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function startDiscussionThreadRename(threadId) {
  if (discussionIsBusy) return;
  const thread = discussionThreads.find((item) => item.id === threadId);
  const item = discussionThreadList?.querySelector(`.discussion-thread-item[data-thread-id="${CSS.escape(threadId)}"]`);
  if (!thread || !item || item.querySelector(".discussion-thread-rename-form")) return;

  const openButton = item.querySelector(".discussion-thread-open");
  const deleteButton = item.querySelector(".discussion-thread-delete");
  const form = document.createElement("form");
  form.className = "discussion-thread-rename-form";
  form.innerHTML = `
    <input class="discussion-thread-rename-input" type="text" maxlength="120" aria-label="Discussion name" />
  `;
  const input = form.querySelector(".discussion-thread-rename-input");
  input.value = thread.title || "New discussion";

  const cancel = () => {
    form.remove();
    if (openButton) openButton.hidden = false;
    if (deleteButton) deleteButton.hidden = false;
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  });
  input.addEventListener("blur", () => {
    window.setTimeout(() => {
      if (!form.contains(document.activeElement)) cancel();
    }, 0);
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const next = input.value.replace(/\s+/g, " ").trim();
    if (!next) return;
    thread.title = next.slice(0, 120);
    thread.hash = await makeDiscussionThreadHash(thread);
    renderDiscussionThreadList();
    renderDiscussionThreadHeader(thread);
    await saveDiscussionThreads();
  });

  if (openButton) openButton.hidden = true;
  if (deleteButton) deleteButton.hidden = true;
  item.appendChild(form);
  input.focus();
  input.select();
}

function appendDiscussionMessage(role, content, index = -1, referenceText = null) {
  discussionMessages.querySelector(".discussion-empty")?.remove();

  const message = document.createElement("div");
  message.className = `discussion-message ${role === "user" ? "user" : "assistant"}`;
  if (index >= 0) message.dataset.messageIndex = String(index);

  const label = document.createElement("div");
  label.className = "discussion-message-label";
  label.textContent = role === "user" ? "You" : "AI";

  const header = document.createElement("div");
  header.className = "discussion-message-header";
  header.append(label);

  message.append(header);
  if (role === "user" && referenceText) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "discussion-reference-card";
    card.title = "点击查看原文";
    const icon = document.createElement("span");
    icon.className = "discussion-reference-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML =
      '<svg viewBox="0 0 24 24"><path d="M8 12 4 16l4 4"></path><path d="M4 16h10a4 4 0 0 0 4-4V4"></path></svg>';
    const cardText = document.createElement("span");
    cardText.className = "discussion-reference-text";
    cardText.textContent = String(referenceText).trim();
    card.append(icon, cardText);
    card.addEventListener("click", openActiveDiscussionReference);
    message.appendChild(card);
  }

  const body = document.createElement("div");
  body.className = "discussion-message-body";
  setDiscussionMessageContent(body, content, role);

  const actions = document.createElement("div");
  actions.className = "discussion-message-actions";
  const copyButton = createMessageActionButton("copy", `Copy ${role === "user" ? "question" : "answer"}`);
  copyButton.addEventListener("click", () => copyTextWithFeedback(getDiscussionMessageContent(message, content), copyButton));
  actions.appendChild(copyButton);

  if (role === "user") {
    const editButton = createMessageActionButton("edit", "Edit question");
    editButton.addEventListener("click", () => editDiscussionMessage(message));
    actions.appendChild(editButton);
  } else {
    const regenerateButton = createMessageActionButton("refresh", "Regenerate answer");
    regenerateButton.addEventListener("click", () => regenerateDiscussionAnswer(message));
    actions.appendChild(regenerateButton);
  }

  message.append(body, actions);
  discussionMessages.appendChild(message);
  message.scrollIntoView({ block: "nearest" });
  return message;
}

function setDiscussionMessageContent(body, content, role) {
  if (!body) return;
  if (role === "assistant") {
    body.classList.add("markdown-body");
    body.innerHTML = renderDiscussionMarkdown(content);
  } else {
    body.classList.remove("markdown-body");
    body.textContent = content;
  }
}

function getDiscussionMessageContent(messageNode, fallback = "") {
  const index = Number(messageNode?.dataset.messageIndex);
  const thread = discussionThreads.find((item) => item.id === activeDiscussionId);
  if (thread && Number.isInteger(index) && thread.messages[index]) return thread.messages[index].content;
  return String(fallback || "");
}

async function deleteDiscussionThread(threadId) {
  if (discussionIsBusy) return;
  const index = discussionThreads.findIndex((thread) => thread.id === threadId);
  if (index < 0) return;
  const thread = discussionThreads[index];
  const confirmed = await showFloatingConfirm({
    title: "删除对话",
    message: `确定删除对话“${thread?.title || "New discussion"}”？此操作不可恢复。`,
    confirmLabel: "删除",
    cancelLabel: "取消",
    danger: true,
  });
  if (!confirmed) return;
  discussionThreads.splice(index, 1);
  if (activeDiscussionId === threadId) activeDiscussionId = null;
  renderDiscussionThreadList();
  showDiscussionList();
  await saveDiscussionThreads();
}

function editDiscussionMessage(messageNode) {
  if (discussionIsBusy) return;
  const index = Number(messageNode?.dataset.messageIndex);
  const thread = discussionThreads.find((item) => item.id === activeDiscussionId);
  if (!thread || !Number.isInteger(index) || thread.messages[index]?.role !== "user") return;
  if (messageNode.querySelector(".discussion-edit-form")) return;

  const body = messageNode.querySelector(".discussion-message-body");
  const actions = messageNode.querySelector(".discussion-message-actions");
  const original = thread.messages[index].content || "";
  body.hidden = true;
  if (actions) actions.hidden = true;

  const form = document.createElement("form");
  form.className = "discussion-edit-form";
  form.innerHTML = `
    <textarea class="discussion-edit-input" rows="3" aria-label="Edit question"></textarea>
    <div class="discussion-edit-actions">
      <button class="discussion-edit-cancel" type="button">Cancel</button>
      <button class="discussion-edit-save" type="submit">Save</button>
    </div>
  `;
  const input = form.querySelector(".discussion-edit-input");
  input.value = original;
  form.querySelector(".discussion-edit-cancel").addEventListener("click", () => {
    form.remove();
    body.hidden = false;
    if (actions) actions.hidden = false;
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const next = input.value.trim();
    if (!next) return;
    await restartDiscussionAfterEdit(thread, index, next);
  });
  body.after(form);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

async function restartDiscussionAfterEdit(thread, index, next) {
  // Truncate to the messages before the edited one, then the edited question.
  const history = thread.messages.slice(0, index);
  thread.messages = history.concat([{ role: "user", content: next }]);
  thread.updatedAt = new Date().toISOString();
  const firstQuestion = history.find((message) => message.role === "user")?.content || next;
  thread.title = makeDiscussionTitle(firstQuestion);
  thread.hash = await makeDiscussionThreadHash(thread);
  await saveDiscussionThreads();
  renderDiscussionThreadList();
  renderDiscussionThreadHeader(thread);
  renderDiscussionMessages(thread.messages, thread.reference);

  const paperText = lastExtractedText.trim();
  if (paperText.length < 80) {
    appendDiscussionMessage("assistant", "请先打开并解析一篇论文，再重新开始讨论。");
    return;
  }

  setDiscussionBusy(true);
  const pending = appendDiscussionMessage("assistant", "Thinking...");
  pending.classList.add("pending");
  try {
    let answer = "";
    await requestDiscussionAnswer({
      paperText,
      question: next,
      summary: paperToSummary(currentPaper),
      history,
      selectionReference: normalizeDiscussionReference(thread.reference),
      onDelta: (delta) => {
        answer += delta;
        setDiscussionMessageContent(pending.querySelector(".discussion-message-body"), answer || "Thinking...", "assistant");
      },
    });
    pending.classList.remove("pending");
    thread.messages.push({ role: "assistant", content: answer || "" });
    thread.updatedAt = new Date().toISOString();
    thread.hash = await makeDiscussionThreadHash(thread);
    renderDiscussionMessages(thread.messages, thread.reference);
    renderDiscussionThreadList();
    renderDiscussionThreadHeader(thread);
    await saveDiscussionThreads();
  } catch (error) {
    console.error(error);
    pending.classList.remove("pending");
    pending.classList.add("error");
    setDiscussionMessageContent(pending.querySelector(".discussion-message-body"), error.message || "重新开始讨论失败，请稍后重试。", "assistant");
  } finally {
    setDiscussionBusy(false);
  }
}

async function regenerateDiscussionAnswer(messageNode) {
  if (discussionIsBusy) return;
  const assistantIndex = Number(messageNode?.dataset.messageIndex);
  const thread = discussionThreads.find((item) => item.id === activeDiscussionId);
  if (!thread || !Number.isInteger(assistantIndex) || thread.messages[assistantIndex]?.role !== "assistant") return;

  let userIndex = assistantIndex - 1;
  while (userIndex >= 0 && thread.messages[userIndex]?.role !== "user") userIndex -= 1;
  if (userIndex < 0) return;

  const paperText = lastExtractedText.trim();
  if (paperText.length < 80) {
    setDiscussionMessageContent(messageNode.querySelector(".discussion-message-body"), "请先打开并解析一篇论文，再重新生成回答。", "assistant");
    return;
  }

  const question = thread.messages[userIndex].content || "";
  const body = messageNode.querySelector(".discussion-message-body");
  setDiscussionBusy(true);
  messageNode.classList.add("pending");
  setDiscussionMessageContent(body, "Thinking...", "assistant");

  try {
    let answer = "";
    await requestDiscussionAnswer({
      paperText,
      question,
      summary: paperToSummary(currentPaper),
      history: thread.messages.slice(0, userIndex),
      selectionReference: normalizeDiscussionReference(thread.reference),
      onDelta: (delta) => {
        answer += delta;
        setDiscussionMessageContent(body, answer || "Thinking...", "assistant");
      },
    });

    thread.messages[assistantIndex].content = answer || "";
    thread.updatedAt = new Date().toISOString();
    thread.hash = await makeDiscussionThreadHash(thread);
    messageNode.classList.remove("pending", "error");
    setDiscussionMessageContent(body, answer || "No response", "assistant");
    renderDiscussionThreadList();
    renderDiscussionThreadHeader(thread);
    await saveDiscussionThreads();
  } catch (error) {
    console.error(error);
    messageNode.classList.remove("pending");
    messageNode.classList.add("error");
    setDiscussionMessageContent(body, error.message || "重新生成失败，请稍后重试。", "assistant");
  } finally {
    setDiscussionBusy(false);
  }
}

async function requestDiscussionAnswer({ paperText, question, summary, history, selectionReference, onDelta }) {
  const response = await apiFetch("/api/discuss", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      paperText,
      question,
      summary,
      history,
      selectionReference: normalizeDiscussionReference(selectionReference),
      stream: true,
    }),
  });

  const contentType = response.headers.get("content-type") || "";
  if (!response.ok) {
    const data = await readJsonResponse(response);
    throw new Error(data.detail || data.error || "Discussion failed.");
  }

  if (contentType.includes("text/event-stream") && response.body) {
    return readDiscussionEventStream(response, onDelta);
  }

  const data = await readJsonResponse(response);
  const answer = data.answer || "";
  if (answer) onDelta?.(answer);
  return answer;
}

async function readDiscussionEventStream(response, onDelta) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() || "";
    events.forEach((eventText) => {
      const delta = parseDiscussionStreamEvent(eventText);
      if (!delta) return;
      answer += delta;
      onDelta?.(delta);
    });
  }

  buffer += decoder.decode();
  const finalDelta = parseDiscussionStreamEvent(buffer);
  if (finalDelta) {
    answer += finalDelta;
    onDelta?.(finalDelta);
  }
  return answer;
}

function parseDiscussionStreamEvent(eventText) {
  const dataLines = String(eventText || "")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());
  if (!dataLines.length) return "";
  const data = dataLines.join("\n");
  if (data === "[DONE]") return "";
  try {
    return JSON.parse(data).delta || "";
  } catch (error) {
    console.warn("Failed to parse discussion stream event.", error);
    return "";
  }
}

function renderDiscussionMarkdown(content) {
  const renderer = getDiscussionMarkdownRenderer();
  if (!renderer) return '<p class="error">Markdown renderer failed to load.</p>';
  return renderer.render(String(content || "")) || "<p>No response</p>";
}

function getDiscussionMarkdownRenderer() {
  if (discussionMarkdownRenderer) return discussionMarkdownRenderer;
  if (!window.markdownit) return null;

  discussionMarkdownRenderer = window.markdownit({
    html: false,
    linkify: true,
    breaks: false,
    typographer: false,
  });

  if (window.texmath && window.katex) {
    discussionMarkdownRenderer.use(window.texmath, {
      engine: window.katex,
      delimiters: ["dollars", "brackets", "beg_end"],
      katexOptions: {
        throwOnError: false,
        strict: "ignore",
      },
    });
  }

  const defaultTableOpen =
    discussionMarkdownRenderer.renderer.rules.table_open ||
    ((tokens, index, options, env, self) => self.renderToken(tokens, index, options));
  const defaultTableClose =
    discussionMarkdownRenderer.renderer.rules.table_close ||
    ((tokens, index, options, env, self) => self.renderToken(tokens, index, options));
  discussionMarkdownRenderer.renderer.rules.table_open = (tokens, index, options, env, self) => {
    return `<div class="markdown-table-wrap">${defaultTableOpen(tokens, index, options, env, self)}`;
  };
  discussionMarkdownRenderer.renderer.rules.table_close = (tokens, index, options, env, self) => {
    return `${defaultTableClose(tokens, index, options, env, self)}</div>`;
  };

  return discussionMarkdownRenderer;
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function clearDiscussionMessages() {
  discussionMessages.innerHTML = "";
  const empty = document.createElement("div");
  empty.className = "discussion-empty";
  empty.textContent = "Ask a question about the method, assumptions, experiments, or limitations.";
  discussionMessages.appendChild(empty);
}

function renderDiscussionHistory(discussion) {
  const normalized = normalizeDiscussionThreads(discussion);
  // Restore quoted selections from the local mirror when the server copy lacks
  // the thread reference (e.g., older server normalization dropped it).
  const cachedById = new Map(loadDiscussionLocalCache().map((thread) => [thread?.id, thread]));
  discussionThreads = normalized.map((thread) => {
    if (!thread.reference) {
      const cached = cachedById.get(thread.id);
      if (cached?.reference) thread.reference = normalizeDiscussionReference(cached.reference);
    }
    return thread;
  });
  activeDiscussionId = null;
  renderDiscussionThreadList();
  showDiscussionList();
}

function renderDiscussionMessages(history, reference = null) {
  clearDiscussionMessages();
  const referenceText = reference ? String(reference.text || "").trim() : "";
  normalizeDiscussionHistory(history).forEach((message, index) => {
    // Attach the quoted selection below the "You" label of the first user message.
    const quote = index === 0 && message.role === "user" && referenceText ? referenceText : null;
    appendDiscussionMessage(message.role, message.content, index, quote);
  });
}

function normalizeDiscussionHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .map((message) => ({
      role: message?.role === "user" ? "user" : "assistant",
      content: String(message?.content || "").trim(),
    }))
    .filter((message) => message.content);
}

function normalizeDiscussionReference(reference) {
  if (!reference || typeof reference !== "object") return null;
  const text = String(reference.text || "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const page = Number(reference.page);
  const before = cleanCopiedText(reference.before);
  const after = cleanCopiedText(reference.after);
  return {
    text: text.slice(0, MAX_DISCUSSION_REFERENCE_CHARS),
    paperTitle: String(reference.paperTitle || "").trim().slice(0, 240),
    page: Number.isInteger(page) && page >= 1 && page <= 9999 ? page : 0,
    before: before.slice(0, 240),
    after: after.slice(0, 240),
  };
}

function normalizeDiscussionThreads(discussion) {
  if (Array.isArray(discussion)) {
    const messages = normalizeDiscussionHistory(discussion);
    if (!messages.length) return [];
    return [
      {
        id: makeDiscussionId(),
        title: makeDiscussionTitle(messages.find((message) => message.role === "user")?.content || "Discussion"),
        messages,
        hash: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
  }
  if (!discussion || !Array.isArray(discussion.threads)) return [];
  return discussion.threads
    .map((thread, index) => ({
      id: String(thread?.id || makeDiscussionId(index)),
      title: String(thread?.title || "").trim() || "New discussion",
      messages: normalizeDiscussionHistory(thread?.messages || []),
      reference: normalizeDiscussionReference(thread?.reference),
      hash: String(thread?.hash || ""),
      createdAt: String(thread?.createdAt || new Date().toISOString()),
      updatedAt: String(thread?.updatedAt || thread?.createdAt || new Date().toISOString()),
    }))
    .filter((thread) => thread.messages.length || thread.title)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function makeDiscussionId(seed = "") {
  return `discussion-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}${seed}`;
}

function makeDiscussionTitle(text) {
  const title = String(text || "Discussion").replace(/\s+/g, " ").trim();
  return title.length > 42 ? `${title.slice(0, 39)}...` : title;
}

function sanitizeDiscussionTitle(value) {
  const title = String(value || "")
    .replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!title || title.toLowerCase() === "undefined" || title.toLowerCase() === "null") return "";
  return title.length > 42 ? `${title.slice(0, 39)}...` : title;
}

async function makeDiscussionThreadHash(thread) {
  const stable = {
    id: thread.id,
    title: thread.title,
    messages: normalizeDiscussionHistory(thread.messages || []),
    reference: normalizeDiscussionReference(thread.reference),
    createdAt: thread.createdAt || "",
    updatedAt: thread.updatedAt || "",
  };
  const json = JSON.stringify(stable);
  if (!crypto?.subtle) return String(Date.now());
  const bytes = new TextEncoder().encode(json);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function getDiscussionLocalCacheKey() {
  return `paperLanternDiscussion:${currentPaper?.id || ""}`;
}

function persistDiscussionLocalCache() {
  try {
    localStorage.setItem(getDiscussionLocalCacheKey(), JSON.stringify(discussionThreads));
  } catch (error) {
    console.warn("Failed to cache discussion locally.", error);
  }
}

function loadDiscussionLocalCache() {
  try {
    const value = JSON.parse(localStorage.getItem(getDiscussionLocalCacheKey()) || "null");
    return Array.isArray(value) ? value : [];
  } catch (error) {
    return [];
  }
}

async function saveDiscussionThreads() {
  if (!currentPaper) return;
  // Keep a local mirror so the quoted selection survives a refresh even if the
  // running server's older normalization drops the thread reference.
  persistDiscussionLocalCache();
  try {
    await saveCurrentPaper({ discussion: { threads: discussionThreads } });
  } catch (error) {
    console.error("Failed to save discussion.", error);
  }
}

async function saveExtractedTextCache(extractedText) {
  if (!currentPaper || !String(extractedText || "").trim()) return;
  const response = await apiFetch("/api/library/paper", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: currentPaper.id, extractedText }),
  });
  const data = await readJsonResponse(response);
  if (!response.ok) throw new Error(data.error || "Failed to save extracted text cache.");
}

function setDiscussionBusy(isBusy) {
  discussionIsBusy = isBusy;
  sendDiscussionButton.disabled = isBusy;
  discussionInput.disabled = isBusy;
}

function createMessageActionButton(icon, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon-button message-action-button";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.innerHTML = getActionIconSvg(icon);
  return button;
}

function getActionIconSvg(icon) {
  if (icon === "refresh") {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M20 6v5h-5"></path>
        <path d="M19.1 15a7.5 7.5 0 1 1-1.9-8.1L20 11"></path>
      </svg>
    `;
  }
  if (icon === "edit") {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 20h9"></path>
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path>
      </svg>
    `;
  }
  if (icon === "delete") {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M3 6h18"></path>
        <path d="M8 6V4h8v2"></path>
        <path d="M6 6l1 15h10l1-15"></path>
        <path d="M10 11v6"></path>
        <path d="M14 11v6"></path>
      </svg>
    `;
  }
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="9" y="9" width="11" height="11" rx="2"></rect>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
    </svg>
  `;
}

async function copyReaderSection(section, button) {
  await copyTextWithFeedback(getReaderSectionText(section), button);
}

function getReaderSectionText(section) {
  if (section === "threeLine") return getThreeLineSummaryText();
  if (section === "method") return getMethodBreakdownText();
  return "";
}

function getThreeLineSummaryText() {
  const summary = paperToSummary(currentPaper);
  const lines = summary?.threeLineSummary || {};
  return [
    ["Challenges", lines.challenges],
    ["Core Method And Technical Details", lines.method],
    ["Conclusion", lines.conclusion],
  ]
    .map(([label, value]) => ({ label, value: cleanCopiedText(value) }))
    .filter(({ value }) => value)
    .map(({ label, value }) => `**${label}:** ${value}`)
    .join("\n\n");
}

function getMethodBreakdownText() {
  const summary = paperToSummary(currentPaper);
  if (!summary) return "";

  const sections = Array.isArray(summary.methodSections) ? summary.methodSections : [];
  const blocks = [];

  if (cleanCopiedText(summary.methodOverview)) {
    blocks.push(`## 概括\n\n${cleanCopiedText(summary.methodOverview)}`);
  }

  if (sections.length) {
    const sectionBlocks = sections.map((section, index) => {
      const lines = [];
      lines.push(`### ${index + 1}. ${cleanCopiedText(section.title || `Method point ${index + 1}`)}`);
      if (cleanCopiedText(section.motivation)) {
        lines.push(`**动机：** ${cleanCopiedText(section.motivation)}`);
      }
      const content = cleanCopiedText(section.content);
      if (content) {
        lines.push(content);
      } else {
        if (cleanCopiedText(section.summary)) {
          lines.push(cleanCopiedText(section.summary));
        }
        const bullets = (Array.isArray(section.bullets) ? section.bullets : [])
          .map((bullet) => cleanCopiedText(bullet))
          .filter(Boolean);
        if (bullets.length) {
          lines.push(bullets.map((bullet) => `- ${bullet}`).join("\n"));
        }
        const formulas = (Array.isArray(section.formulas) ? section.formulas : [])
          .map((formula) => cleanCopiedText(formula))
          .filter(Boolean);
        if (formulas.length) {
          lines.push(formulas.join("\n\n"));
        }
      }
      return lines.join("\n\n");
    });
    blocks.push(sectionBlocks.join("\n\n"));
  }

  if (cleanCopiedText(summary.methodConclusion)) {
    blocks.push(`## 总结\n\n${cleanCopiedText(summary.methodConclusion)}`);
  }

  return blocks.join("\n\n") || "No structured method sections returned.";
}

function cleanCopiedText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function showCopiedFeedback(anchor) {
  if (!anchor) return;
  let toast = document.querySelector("#copiedFeedback");
  if (!toast) {
    toast = document.createElement("span");
    toast.id = "copiedFeedback";
    toast.className = "copied-feedback";
    toast.textContent = "已复制";
    document.body.appendChild(toast);
  }
  const rect = anchor.getBoundingClientRect();
  const gap = 8;
  toast.style.left = `${Math.max(8, rect.left + rect.width / 2 - toast.offsetWidth / 2)}px`;
  toast.style.top = `${Math.max(8, rect.top - toast.offsetHeight - gap)}px`;
  toast.classList.add("show");
  window.clearTimeout(copiedToastTimer);
  copiedToastTimer = window.setTimeout(() => toast.classList.remove("show"), 1200);
}

async function copyTextWithFeedback(text, button) {
  const value = cleanCopiedText(text);
  if (!value) return;

  const previousTitle = button?.title || "";
  try {
    await copyTextToClipboard(value);
    if (button) {
      button.classList.add("copied");
      button.title = "已复制";
      button.setAttribute("aria-label", "已复制");
      showCopiedFeedback(button);
      window.setTimeout(() => {
        if (!document.body.contains(button)) return;
        button.classList.remove("copied");
        button.title = previousTitle || "Copy";
        button.setAttribute("aria-label", previousTitle || "Copy");
      }, 1200);
    }
  } catch (error) {
    console.error("Failed to copy text.", error);
    if (button) {
      button.title = "Copy failed";
      button.setAttribute("aria-label", "Copy failed");
    }
  }
}

async function saveCurrentPaper(extra = {}) {
  if (!currentPaper) return;
  savedHighlights = normalizeHighlights(savedHighlights);
  const response = await apiFetch("/api/library/paper", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: currentPaper.id, highlights: savedHighlights, ...extra }),
  });
  const data = await readJsonResponse(response);
  if (!response.ok) throw new Error(data.error || "Paper save failed.");
  if (response.ok) currentPaper = data.paper;
}

function showPdf(file, displayTitle = "") {
  renderPdf(file).catch((error) => {
    console.error(error);
    setStatus(error.message || "Failed to render PDF.", true);
  });
  pdfViewer.style.display = "block";
  emptyState.style.display = "none";
  pageIndicator.hidden = false;
  setPageIndicator(0, 0);
  const title = displayTitle || file.name.replace(/\.pdf$/i, "");
  setReaderPaperTitle(title);
}

function setReaderPaperTitle(title) {
  const normalizedTitle = String(title || "").replace(/\s+/g, " ").trim();
  const displayTitle = normalizedTitle || "Loading paper...";
  fileName.textContent = displayTitle;
  fileName.title = displayTitle;
  document.title = normalizedTitle ? `${normalizedTitle} - Paper Lantern` : "PaperLantern Paper Reader";
}

function initPaneResizer() {
  const savedWidth = Number(localStorage.getItem("readerSummaryPaneWidth"));
  if (Number.isFinite(savedWidth)) {
    setSummaryPaneWidth(savedWidth);
  }

  paneResizer.addEventListener("pointerdown", (event) => {
    if (window.matchMedia("(max-width: 900px)").matches) return;
    event.preventDefault();
    isResizingPanes = true;
    paneResizer.setPointerCapture(event.pointerId);
    document.body.classList.add("resizing-panes");
    hideSelectionMenu();
    hideTranslationBubble();
    hideReferencePopover();
  });

  paneResizer.addEventListener("pointermove", (event) => {
    if (!isResizingPanes) return;
    resizePanesToClientX(event.clientX);
  });

  paneResizer.addEventListener("pointerup", (event) => {
    finishPaneResize(event.pointerId);
  });

  paneResizer.addEventListener("pointercancel", (event) => {
    finishPaneResize(event.pointerId);
  });

  paneResizer.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const currentWidth = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--summary-pane-width")) || 360;
    const direction = event.key === "ArrowLeft" ? 1 : -1;
    setSummaryPaneWidth(currentWidth + direction * 24);
    refreshPdfAfterPaneResize();
  });
}

function initSummaryPaneToggle() {
  const isCollapsed = localStorage.getItem("summaryPaneCollapsed") === "true";
  setSummaryPaneCollapsed(isCollapsed, false);
}

function setSummaryPaneCollapsed(isCollapsed, shouldRefreshPdf = true) {
  appShell.classList.toggle("summary-pane-collapsed", isCollapsed);
  localStorage.setItem("summaryPaneCollapsed", String(isCollapsed));
  if (shouldRefreshPdf) refreshPdfAfterPaneResize();
}

function resizePanesToClientX(clientX) {
  const shellRect = appShell.getBoundingClientRect();
  const sideRailWidth = readerSideRail?.getBoundingClientRect().width || 54;
  const width = shellRect.right - sideRailWidth - clientX - paneResizer.offsetWidth / 2;
  setSummaryPaneWidth(width);
}

function setSummaryPaneWidth(width) {
  const shellWidth = appShell?.getBoundingClientRect().width || window.innerWidth || 1200;
  const sideRailWidth = readerSideRail?.getBoundingClientRect().width || 54;
  const maxWidth = Math.max(300, shellWidth - 54 - sideRailWidth - paneResizer.offsetWidth - 360);
  const clampedWidth = clamp(width, 300, maxWidth);
  document.documentElement.style.setProperty("--summary-pane-width", `${clampedWidth}px`);
  localStorage.setItem("readerSummaryPaneWidth", String(clampedWidth));
}

function finishPaneResize(pointerId) {
  if (!isResizingPanes) return;
  isResizingPanes = false;
  document.body.classList.remove("resizing-panes");
  if (paneResizer.hasPointerCapture(pointerId)) {
    paneResizer.releasePointerCapture(pointerId);
  }
  refreshPdfAfterPaneResize();
}

function refreshPdfAfterPaneResize() {
  if (!currentPdfDocument) return;
  const scrollRatio = getViewerScrollRatio();
  window.clearTimeout(paneRenderTimer);
  paneRenderTimer = window.setTimeout(async () => {
    const renderId = Symbol("paneResizeRender");
    await renderPdfPages(renderId, { keepExisting: true });
    setViewerScrollRatio(scrollRatio);
    scheduleVisiblePdfRender();
  }, 120);
}

async function renderPdf(file) {
  hideSelectionMenu();
  hideTranslationBubble();
  hideReferencePopover();
  isPdfLoadingForReadingPosition = true;
  pdfOutlineItems = [];
  closePdfOutlinePanel();
  updatePdfOutlineUI();
  pdfViewer.innerHTML = "";
  if (!currentPaper) savedHighlights = [];
  pdfZoom = 1;
  renderedPdfZoom = 1;
  window.clearTimeout(zoomRenderTimer);
  setPdfZoomPreviewScale(1);
  updatePdfZoomLabel();
  const loadingNode = document.createElement("div");
  loadingNode.className = "pdf-loading";
  loadingNode.textContent = "Loading PDF...";
  pdfViewer.appendChild(loadingNode);

  const renderId = Symbol("pdfRender");
  currentPdfTask = renderId;
  try {
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    if (currentPdfTask !== renderId) return;
    currentPdfDocument = pdf;
    pdfPageMetrics = [];
    pdfRenderedPages = new Map();
    pdfRenderingPages = new Map();
    pdfPageTextCache = new Map();
    pdfLinkAnnotationsCache = new Map();
    pdfLinkDestCache = new Map();
    pdfOutlineItems = [];
    closePdfOutlinePanel();
    updatePdfOutlineUI();
    setPageIndicator(1, pdf.numPages);
    await loadPdfOutline(pdf);

    await renderPdfPages(renderId, { restoreReadingPosition: true });
  } finally {
    if (currentPdfTask === renderId) isPdfLoadingForReadingPosition = false;
  }
}

async function renderPdfPages(renderId = Symbol("pdfRender"), options = {}) {
  if (!currentPdfDocument) return;
  const { keepExisting = false, restoreReadingPosition = false } = options;
  const renderZoom = pdfZoom;
  currentPdfTask = renderId;
  pdfRenderingPages = new Map();
  pdfRenderedPages = new Map();
  if (!keepExisting) pdfViewer.innerHTML = "";
  const pagesHost = document.createElement("div");
  pagesHost.className = "pdf-pages";
  if (!keepExisting) pdfViewer.appendChild(pagesHost);
  for (let pageNumber = 1; pageNumber <= currentPdfDocument.numPages; pageNumber += 1) {
    const page = await currentPdfDocument.getPage(pageNumber);
    if (currentPdfTask !== renderId) return;
    const metrics = getPdfPageMetrics(page, renderZoom);
    pdfPageMetrics[pageNumber] = metrics;
    pagesHost.appendChild(createPdfPagePlaceholder(pageNumber, metrics));
  }
  if (keepExisting) {
    pdfViewer.replaceChildren(pagesHost);
  }
  renderedPdfZoom = renderZoom;
  setPdfZoomPreviewScale(1);
  if (restoreReadingPosition) restoreSavedReadingPosition();
  await renderVisiblePdfPages(renderId, { force: true });
  refreshReferenceCitations();
  updatePageIndicator();
  resetPdfSearchState();
  updatePdfZoomLabel();
  scheduleVisiblePdfRender();
}

function getPdfPageMetrics(page, zoom = pdfZoom) {
  const containerWidth = Math.max(pdfViewer.clientWidth - 36, 320);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(containerWidth / baseViewport.width, 1.6) * zoom;
  const viewport = page.getViewport({ scale });
  return {
    width: viewport.width,
    height: viewport.height,
    scale,
  };
}

function createPdfPagePlaceholder(pageNumber, metrics) {
  const pageNode = document.createElement("article");
  pageNode.className = "pdf-page pdf-page-placeholder";
  pageNode.dataset.pageNumber = String(pageNumber);
  pageNode.style.width = `${metrics.width}px`;
  pageNode.style.height = `${metrics.height}px`;
  return pageNode;
}

function scheduleVisiblePdfRender() {
  if (!currentPdfDocument) return;
  window.clearTimeout(pdfVirtualRenderTimer);
  pdfVirtualRenderTimer = window.setTimeout(() => {
    renderVisiblePdfPages(currentPdfTask).catch((error) => console.error("Failed to render visible PDF pages.", error));
  }, 60);
}

async function renderVisiblePdfPages(renderId = currentPdfTask, options = {}) {
  if (!currentPdfDocument) return;
  const { force = false } = options;
  const pages = Array.from(pdfViewer.querySelectorAll(".pdf-page"));
  const viewerRect = pdfViewer.getBoundingClientRect();
  const renderBuffer = Math.max(viewerRect.height * 1.15, 900);
  const keepBuffer = Math.max(viewerRect.height * 2.2, 1600);
  const pagesToRender = [];

  pages.forEach((pageNode) => {
    const pageNumber = Number(pageNode.dataset.pageNumber) || 0;
    const rect = pageNode.getBoundingClientRect();
    const renderNear = rect.bottom >= viewerRect.top - renderBuffer && rect.top <= viewerRect.bottom + renderBuffer;
    const keepNear = rect.bottom >= viewerRect.top - keepBuffer && rect.top <= viewerRect.bottom + keepBuffer;
    if (renderNear) pagesToRender.push({ pageNumber, pageNode });
    if (!keepNear && !isPdfTextSelecting) unloadPdfPage(pageNode);
  });

  for (const { pageNumber, pageNode } of pagesToRender) {
    if (currentPdfTask !== renderId && !force) return;
    await renderPdfPageInto(pageNumber, pageNode, renderId);
  }
}

function unloadPdfPage(pageNode) {
  const pageNumber = Number(pageNode.dataset.pageNumber) || 0;
  if (!pageNumber || !pdfRenderedPages.has(pageNumber)) return;
  pageNode.replaceChildren();
  pageNode.classList.add("pdf-page-placeholder");
  pdfRenderedPages.delete(pageNumber);
}

async function renderPdfPageInto(pageNumber, pageNode, renderId = currentPdfTask) {
  if (!currentPdfDocument || !pageNode) return;
  const rendered = pdfRenderedPages.get(pageNumber);
  if (rendered && Math.abs(rendered.zoom - renderedPdfZoom) < 0.001) return;
  if (pdfRenderingPages.has(pageNumber)) return pdfRenderingPages.get(pageNumber);

  const task = (async () => {
    const page = await currentPdfDocument.getPage(pageNumber);
    if (currentPdfTask !== renderId) return;
    const metrics = pdfPageMetrics[pageNumber] || getPdfPageMetrics(page, renderedPdfZoom);
    const viewport = page.getViewport({ scale: metrics.scale });
  const outputScale = window.devicePixelRatio || 1;

    pageNode.style.width = `${metrics.width}px`;
    pageNode.style.height = `${metrics.height}px`;
    pageNode.replaceChildren();

  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;

  const context = canvas.getContext("2d");
  const transform = outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0];
  await page.render({ canvasContext: context, viewport, transform }).promise;
  if (currentPdfTask !== renderId) return;

  const highlightLayer = document.createElement("div");
  highlightLayer.className = "pdf-highlight-layer";

  const textLayer = document.createElement("div");
  textLayer.className = "pdf-text-layer";
  textLayer.style.setProperty("--scale-factor", `${metrics.scale}`);

  pageNode.append(canvas, highlightLayer, textLayer);

  const textContent = await page.getTextContent();
  if (currentPdfTask !== renderId) return;
  await new pdfjsLib.TextLayer({
    textContentSource: textContent,
    container: textLayer,
    viewport,
  }).render();
  if (currentPdfTask !== renderId) return;

  if (pageNode.isConnected) await decoratePdfLinks(pageNode, pageNumber, page, viewport);
  if (currentPdfTask !== renderId) return;

  pageNode.classList.remove("pdf-page-placeholder");
  pdfRenderedPages.set(pageNumber, { zoom: renderedPdfZoom });
  restoreHighlightsForPage(pageNode);
  maybeApplyDiscussionReferenceHighlight(pageNode, pageNumber);
  if (pageNode.isConnected) decorateReferenceCitations(pageNode, textLayer);
  })();

  pdfRenderingPages.set(pageNumber, task);
  try {
    await task;
  } finally {
    pdfRenderingPages.delete(pageNumber);
  }
}

function handlePdfWheel(event) {
  if (!event.ctrlKey || !currentPdfDocument) return;

  event.preventDefault();
  hideSelectionMenu();
  hideTranslationBubble();
  hideReferencePopover();
  window.getSelection()?.removeAllRanges();

  const previousZoom = pdfZoom;
  const zoomFactor = clamp(Math.exp(-event.deltaY * 0.0025), 0.72, 1.38);
  const nextZoom = clamp(pdfZoom * zoomFactor, 0.6, 2.8);
  if (nextZoom === previousZoom) return;

  const anchor = getPdfViewportAnchor(event.clientX, event.clientY);
  pdfZoom = nextZoom;
  currentPdfTask = Symbol("pdfZoomPending");
  setPdfZoomPreviewScale(pdfZoom / renderedPdfZoom);
  restorePdfViewportAnchor(anchor);
  schedulePdfRerender(anchor);
}

function schedulePdfRerender(anchor) {
  window.clearTimeout(zoomRenderTimer);
  zoomRenderTimer = window.setTimeout(async () => {
    const renderId = Symbol("pdfZoomRender");
    await renderPdfPages(renderId, { keepExisting: true });
    if (currentPdfTask === renderId) {
      restorePdfViewportAnchor(anchor);
      scheduleVisiblePdfRender();
    }
  }, 140);
}

function setPdfZoomPreviewScale(scale) {
  const pagesHost = pdfViewer.querySelector(".pdf-pages");
  if (!pagesHost) return;
  pagesHost.style.transform = scale === 1 ? "" : `scale(${scale})`;
  pagesHost.style.transformOrigin = "0 0";
}

const pdfZoomPresets = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.8];

function initPdfToolbar() {
  zoomOutButton?.addEventListener("click", () => zoomPdf(1 / 1.25));
  zoomInButton?.addEventListener("click", () => zoomPdf(1.25));
  fitPageButton?.addEventListener("click", () => fitPdfPage());
  pageNumberInput?.addEventListener("focus", () => {
    pageNumberInput.select();
  });
  pageNumberInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitPageNumberInput();
      pageNumberInput.blur();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setPageIndicator(currentVisiblePage, currentPdfDocument?.numPages || 0);
      pageNumberInput.blur();
    }
  });
  pageNumberInput?.addEventListener("change", commitPageNumberInput);
  pdfZoomLabel?.addEventListener("click", (event) => {
    event.stopPropagation();
    togglePdfZoomMenu();
  });
  document.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".pdf-zoom-menu") || event.target.closest(".pdf-zoom-label")) return;
    closePdfZoomMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !isPdfSearchOpen()) return;
    event.preventDefault();
    closePdfSearch();
  });
  pdfSearchToggleButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (isPdfSearchOpen()) closePdfSearch();
    else openPdfSearch();
  });
  pdfSearchInput?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closePdfSearch();
    }
  });
  pdfSearchInput?.addEventListener("input", () => {
    runPdfSearch(pdfSearchInput.value).catch((error) => console.error("PDF search failed.", error));
  });
  pdfSearchPrevButton?.addEventListener("click", () => stepPdfSearch(-1));
  pdfSearchNextButton?.addEventListener("click", () => stepPdfSearch(1));
  pdfOutlineToggleButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    togglePdfOutlinePanel();
  });
  updatePdfZoomLabel();
  updatePdfSearchUI();
  updatePdfOutlineUI();
}

function isPdfSearchOpen() {
  return Boolean(pdfSearchControls && !pdfSearchControls.hidden);
}

function openPdfSearch() {
  if (!pdfSearchControls) return;
  pdfSearchControls.hidden = false;
  pdfSearchToggleButton?.setAttribute("aria-expanded", "true");
  window.requestAnimationFrame(() => pdfSearchInput?.focus());
}

function closePdfSearch() {
  clearPdfSearch();
  if (pdfSearchControls) pdfSearchControls.hidden = true;
  pdfSearchToggleButton?.setAttribute("aria-expanded", "false");
  pdfSearchToggleButton?.focus();
}

function initPdfOutlineResizer() {
  const savedWidth = Number(localStorage.getItem("pdfOutlineWidth"));
  if (Number.isFinite(savedWidth)) setPdfOutlineWidth(savedWidth);

  pdfOutlineResizer?.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    isResizingPdfOutline = true;
    pdfOutlineResizer.setPointerCapture(event.pointerId);
    document.body.classList.add("resizing-pdf-outline");
  });

  pdfOutlineResizer?.addEventListener("pointermove", (event) => {
    if (!isResizingPdfOutline || !pdfOutlinePanel) return;
    const panelRect = pdfOutlinePanel.getBoundingClientRect();
    setPdfOutlineWidth(event.clientX - panelRect.left);
  });

  pdfOutlineResizer?.addEventListener("pointerup", (event) => finishPdfOutlineResize(event.pointerId));
  pdfOutlineResizer?.addEventListener("pointercancel", (event) => finishPdfOutlineResize(event.pointerId));

  pdfOutlineResizer?.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const currentWidth = Number.parseFloat(getComputedStyle(pdfOutlinePanel).width) || 280;
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    setPdfOutlineWidth(currentWidth + direction * 16);
    refreshPdfAfterPaneResize();
  });
}

function setPdfOutlineWidth(width) {
  if (!pdfOutlinePanel) return;
  const readerBodyWidth = pdfOutlinePanel.parentElement?.getBoundingClientRect().width || window.innerWidth || 900;
  const maxWidth = Math.min(PDF_OUTLINE_MAX_WIDTH, Math.max(PDF_OUTLINE_MIN_WIDTH, readerBodyWidth * 0.48));
  const clampedWidth = clamp(width, PDF_OUTLINE_MIN_WIDTH, maxWidth);
  pdfOutlinePanel.style.setProperty("--pdf-outline-width", `${clampedWidth}px`);
  localStorage.setItem("pdfOutlineWidth", String(clampedWidth));
}

function finishPdfOutlineResize(pointerId) {
  if (!isResizingPdfOutline) return;
  isResizingPdfOutline = false;
  document.body.classList.remove("resizing-pdf-outline");
  if (pdfOutlineResizer?.hasPointerCapture(pointerId)) {
    pdfOutlineResizer.releasePointerCapture(pointerId);
  }
  refreshPdfAfterPaneResize();
}

async function loadPdfOutline(pdf) {
  try {
    const outline = await pdf.getOutline();
    pdfOutlineItems = Array.isArray(outline) ? outline : [];
  } catch (error) {
    console.warn("Failed to read PDF outline.", error);
    pdfOutlineItems = [];
  }
  renderPdfOutline();
  updatePdfOutlineUI();
}

function updatePdfOutlineUI() {
  const hasOutline = pdfOutlineItems.length > 0;
  if (pdfOutlineToggleButton) {
    pdfOutlineToggleButton.disabled = !hasOutline;
    pdfOutlineToggleButton.classList.toggle("active", hasOutline && !pdfOutlinePanel?.hidden);
    pdfOutlineToggleButton.setAttribute("aria-expanded", String(hasOutline && !pdfOutlinePanel?.hidden));
  }
  if (!hasOutline) closePdfOutlinePanel();
}

function togglePdfOutlinePanel() {
  if (!pdfOutlinePanel || !pdfOutlineItems.length) return;
  setPdfOutlinePanelOpen(pdfOutlinePanel.hidden);
}

function setPdfOutlinePanelOpen(isOpen, shouldRefreshPdf = true) {
  if (!pdfOutlinePanel) return;
  pdfOutlinePanel.hidden = !isOpen;
  updatePdfOutlineUI();
  if (shouldRefreshPdf) refreshPdfAfterPaneResize();
}

function closePdfOutlinePanel(shouldRefreshPdf = false) {
  if (pdfOutlinePanel) pdfOutlinePanel.hidden = true;
  if (pdfOutlineToggleButton) {
    pdfOutlineToggleButton.classList.remove("active");
    pdfOutlineToggleButton.setAttribute("aria-expanded", "false");
  }
  if (shouldRefreshPdf) refreshPdfAfterPaneResize();
}

function renderPdfOutline() {
  if (!pdfOutlineList) return;
  pdfOutlineList.innerHTML = "";
  if (!pdfOutlineItems.length) {
    const empty = document.createElement("div");
    empty.className = "pdf-outline-empty";
    empty.textContent = "当前 PDF 没有目录";
    pdfOutlineList.appendChild(empty);
    return;
  }
  pdfOutlineList.appendChild(createPdfOutlineList(pdfOutlineItems, 0));
}

function createPdfOutlineList(items, depth) {
  const list = document.createElement("div");
  list.className = "pdf-outline-items";
  list.dataset.depth = String(depth);
  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "pdf-outline-item";
    const button = document.createElement("button");
    button.className = "pdf-outline-link";
    button.type = "button";
    button.style.paddingLeft = `${8 + depth * 14}px`;
    button.textContent = String(item?.title || "Untitled").trim() || "Untitled";
    button.title = button.textContent;
    button.addEventListener("click", () => jumpToPdfOutlineItem(item));
    row.appendChild(button);
    if (Array.isArray(item?.items) && item.items.length) {
      row.appendChild(createPdfOutlineList(item.items, depth + 1));
    }
    list.appendChild(row);
  });
  return list;
}

function jumpToPdfOutlineItem(item) {
  jumpToPdfOutlineItemAsync(item).catch((error) => console.error("Failed to follow PDF outline item.", error));
}

async function jumpToPdfOutlineItemAsync(item) {
  if (!currentPdfDocument || !item) return;
  const safeUrl = getPdfAnnotationExternalUrl(item);
  if (safeUrl) {
    window.open(safeUrl, "_blank", "noopener,noreferrer");
    return;
  }
  const resolved = await resolvePdfLinkDestination(currentPdfDocument, item.dest);
  if (!resolved) return;
  await jumpToPdfOutlinePageAsync(resolved.pageIndex + 1);
}

async function jumpToPdfOutlinePageAsync(pageNumber) {
  if (!currentPdfDocument || !currentPdfTask) return;
  window.clearTimeout(paneRenderTimer);
  window.clearTimeout(zoomRenderTimer);
  const pageNode = pdfViewer.querySelector(`.pdf-page[data-page-number="${pageNumber}"]`);
  if (!pageNode) return;
  pageNode.scrollIntoView({ block: "center", behavior: "auto" });
  updatePageIndicator();
  await renderPdfPageInto(pageNumber, pageNode, currentPdfTask);
  scheduleVisiblePdfRender();
}

function commitPageNumberInput() {
  if (!currentPdfDocument || !pageNumberInput) {
    setPageIndicator(0, 0);
    return;
  }
  const requestedPage = Number.parseInt(String(pageNumberInput.value || "").replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(requestedPage)) {
    setPageIndicator(currentVisiblePage, currentPdfDocument.numPages);
    return;
  }
  const pageNumber = clamp(requestedPage, 1, currentPdfDocument.numPages);
  pageNumberInput.value = String(pageNumber);
  jumpToPdfPage(pageNumber, "auto");
}

function jumpToPdfPage(pageNumber, behavior = "auto") {
  jumpToPdfPageAsync(pageNumber, behavior).catch((error) => console.error("Failed to jump to PDF page.", error));
}

async function jumpToPdfPageAsync(pageNumber, behavior = "auto") {
  if (!currentPdfDocument || !currentPdfTask) return;
  window.clearTimeout(paneRenderTimer);
  window.clearTimeout(zoomRenderTimer);
  const normalizedPage = clamp(Math.round(Number(pageNumber)), 1, currentPdfDocument.numPages);
  if (!Number.isFinite(normalizedPage)) return;
  const pageNode = pdfViewer.querySelector(`.pdf-page[data-page-number="${normalizedPage}"]`);
  if (!pageNode) return;
  pageNode.scrollIntoView({ block: "start", behavior });
  updatePageIndicator();
  await renderPdfPageInto(normalizedPage, pageNode, currentPdfTask);
  scheduleVisiblePdfRender();
  saveReadingPositionNow();
}

function updatePdfZoomLabel() {
  if (!pdfZoomLabel) return;
  pdfZoomLabel.textContent = `${Math.round(pdfZoom * 100)}%`;
}

function togglePdfZoomMenu() {
  const existing = document.querySelector(".pdf-zoom-menu");
  if (existing) {
    existing.remove();
    return;
  }
  const toolbar = pdfZoomLabel?.closest(".pdf-toolbar");
  if (!toolbar || !currentPdfDocument) return;

  const menu = document.createElement("div");
  menu.className = "pdf-zoom-menu";
  pdfZoomPresets.forEach((value) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "pdf-zoom-menu-item";
    item.textContent = `${Math.round(value * 100)}%`;
    item.classList.toggle("active", Math.abs(value - pdfZoom) < 0.01);
    item.addEventListener("click", () => {
      setPdfZoomTo(value);
      menu.remove();
    });
    menu.appendChild(item);
  });
  toolbar.appendChild(menu);

  const toolbarRect = toolbar.getBoundingClientRect();
  const labelRect = pdfZoomLabel.getBoundingClientRect();
  menu.style.top = `${labelRect.bottom - toolbarRect.top + 4}px`;
  menu.style.left = `${labelRect.left - toolbarRect.left}px`;
}

function closePdfZoomMenu() {
  document.querySelector(".pdf-zoom-menu")?.remove();
}

function setPdfZoomTo(value) {
  if (!currentPdfDocument) return;
  const nextZoom = clamp(value, 0.6, 2.8);
  if (nextZoom === pdfZoom) return;
  pdfZoom = nextZoom;
  currentPdfTask = Symbol("pdfZoomPending");
  setPdfZoomPreviewScale(pdfZoom / renderedPdfZoom);
  schedulePdfRerender();
  updatePdfZoomLabel();
}

function zoomPdf(factor) {
  if (!currentPdfDocument) return;
  const previousZoom = pdfZoom;
  const nextZoom = clamp(pdfZoom * factor, 0.6, 2.8);
  if (nextZoom === previousZoom) return;
  const viewerRect = pdfViewer.getBoundingClientRect();
  const anchor = getPdfViewportAnchor(viewerRect.left + viewerRect.width / 2, viewerRect.top + viewerRect.height / 2);
  pdfZoom = nextZoom;
  currentPdfTask = Symbol("pdfZoomPending");
  setPdfZoomPreviewScale(pdfZoom / renderedPdfZoom);
  restorePdfViewportAnchor(anchor);
  schedulePdfRerender(anchor);
  updatePdfZoomLabel();
}

async function fitPdfPage() {
  if (!currentPdfDocument) return;
  const page = await currentPdfDocument.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const containerWidth = Math.max(pdfViewer.clientWidth - 36, 320);
  const containerHeight = Math.max(pdfViewer.clientHeight - 36, 320);
  const widthBase = Math.min(containerWidth / base.width, 1.6);
  const fitScale = Math.min(containerWidth / base.width, containerHeight / base.height, 1.6);
  const nextZoom = clamp(fitScale / widthBase, 0.6, 2.8);
  if (nextZoom === pdfZoom) return;
  pdfZoom = nextZoom;
  currentPdfTask = Symbol("pdfZoomPending");
  setPdfZoomPreviewScale(pdfZoom / renderedPdfZoom);
  schedulePdfRerender();
  updatePdfZoomLabel();
}

async function runPdfSearch(query) {
  const q = String(query || "").trim();
  const searchId = Symbol("pdfSearch");
  pdfSearchTask = searchId;
  clearSearchHighlights();
  pdfSearchMatches = [];
  pdfSearchIndex = -1;
  if (!q || !currentPdfDocument) {
    updatePdfSearchUI();
    return;
  }
  const lower = q.toLowerCase();
  for (let pageNumber = 1; pageNumber <= currentPdfDocument.numPages; pageNumber += 1) {
    if (pdfSearchTask !== searchId) return;
    const pageText = (await getPdfPagePlainText(pageNumber)).toLowerCase();
    if (pageText.includes(lower)) {
      pdfSearchMatches.push(pageNumber);
      const pageNode = pdfViewer.querySelector(`.pdf-page[data-page-number="${pageNumber}"]`);
      if (pageNode?.querySelector(".pdf-text-layer")) highlightInTextLayer(pageNode, q);
    }
  }
  if (pdfSearchTask !== searchId) return;
  if (pdfSearchMatches.length) {
    pdfSearchIndex = 0;
    jumpToPdfSearchMatch();
  }
  updatePdfSearchUI();
}

function clearPdfSearch() {
  pdfSearchTask = null;
  if (pdfSearchInput) pdfSearchInput.value = "";
  clearSearchHighlights();
  pdfSearchMatches = [];
  pdfSearchIndex = -1;
  updatePdfSearchUI();
}

function clearSearchHighlights(root = pdfViewer) {
  root.querySelectorAll(".pdf-search-hit").forEach((mark) => mark.remove());
}

function highlightInTextLayer(pageNode, query) {
  clearSearchHighlights(pageNode);
  const layer = pageNode.querySelector(".pdf-highlight-layer");
  const range = findTextRangeInPage(pageNode, query, true);
  if (!layer || !range) return 0;

  const pageRect = pageNode.getBoundingClientRect();
  if (pageRect.width && pageRect.height) {
    Array.from(range.getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .forEach((rect) => {
        const mark = document.createElement("span");
        mark.className = "pdf-search-hit";
        mark.style.left = `${((rect.left - pageRect.left) / pageRect.width) * 100}%`;
        mark.style.top = `${((rect.top - pageRect.top) / pageRect.height) * 100}%`;
        mark.style.width = `${(rect.width / pageRect.width) * 100}%`;
        mark.style.height = `${(rect.height / pageRect.height) * 100}%`;
        layer.appendChild(mark);
      });
  }
  range.detach();
  return 1;
}

async function getPdfPagePlainText(pageNumber) {
  if (!currentPdfDocument) return "";
  if (pdfPageTextCache.has(pageNumber)) return pdfPageTextCache.get(pageNumber);
  const page = await currentPdfDocument.getPage(pageNumber);
  const content = await page.getTextContent();
  const text = content.items
    .map((item) => ("str" in item ? item.str : ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  pdfPageTextCache.set(pageNumber, text);
  return text;
}

function stepPdfSearch(delta) {
  if (!pdfSearchMatches.length) return;
  pdfSearchIndex = (pdfSearchIndex + delta + pdfSearchMatches.length) % pdfSearchMatches.length;
  jumpToPdfSearchMatch();
}

function jumpToPdfSearchMatch() {
  jumpToPdfSearchMatchAsync().catch((error) => console.error("Failed to jump to PDF search match.", error));
}

async function jumpToPdfSearchMatchAsync() {
  if (pdfSearchIndex < 0 || pdfSearchIndex >= pdfSearchMatches.length) return;
  const pageNode = pdfViewer.querySelector(`.pdf-page[data-page-number="${pdfSearchMatches[pdfSearchIndex]}"]`);
  if (pageNode) {
    pageNode.scrollIntoView({ block: "center", behavior: "smooth" });
    await renderPdfPageInto(Number(pdfSearchMatches[pdfSearchIndex]), pageNode, currentPdfTask);
    if (pdfSearchInput?.value) highlightInTextLayer(pageNode, pdfSearchInput.value);
  }
  updatePdfSearchUI();
}

function updatePdfSearchUI() {
  if (pdfSearchCount) pdfSearchCount.textContent = pdfSearchMatches.length ? `${pdfSearchIndex + 1}/${pdfSearchMatches.length}` : "";
  if (pdfSearchPrevButton) pdfSearchPrevButton.disabled = !pdfSearchMatches.length;
  if (pdfSearchNextButton) pdfSearchNextButton.disabled = !pdfSearchMatches.length;
}

function resetPdfSearchState() {
  pdfSearchTask = null;
  clearSearchHighlights();
  pdfSearchMatches = [];
  pdfSearchIndex = -1;
  updatePdfSearchUI();
}

async function extractPdfText(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pageTexts = [];
  const metadataTitle = await getPdfMetadataTitle(pdf);

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => item.str || "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (text) pageTexts.push(text);
  }

  const text = pageTexts.join("\n\n");
  return {
    text,
    title: metadataTitle || guessPaperTitle(pageTexts[0] || ""),
  };
}

function extractReferenceEntries(text) {
  const source = String(text || "")
    .replace(/\0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!source) return new Map();

  const sectionStart = findReferenceSectionStart(source);
  if (sectionStart < 0) return new Map();

  const section = trimReferenceSection(source.slice(sectionStart).trim());
  const markers = Array.from(section.matchAll(/(?:^|\s)\[(\d{1,3})\]\s+/g));
  if (!markers.length) return new Map();

  const entries = new Map();
  markers.forEach((marker, index) => {
    const number = marker[1];
    const contentStart = marker.index + marker[0].length;
    const contentEnd = index + 1 < markers.length ? markers[index + 1].index : section.length;
    const citation = cleanReferenceText(section.slice(contentStart, contentEnd));
    if (citation.length >= 12) entries.set(number, citation);
  });
  return entries;
}

function trimReferenceSection(section) {
  const appendixMatch = section.match(/\b(?:appendix|a\s+p\s*p\s*e\s*n\s*d\s*i\s*x|附录)\b/i);
  if (!appendixMatch) return section;

  const beforeAppendix = section.slice(0, appendixMatch.index);
  const markers = beforeAppendix.match(/(?:^|\s)\[(\d{1,3})\]\s+/g) || [];
  return markers.length >= 5 ? beforeAppendix : section;
}

function findReferenceSectionStart(source) {
  const headingMatches = Array.from(
    source.matchAll(/\b(?:references|bibliography|r\s+e\s*f\s*e\s*r\s*e\s*n\s*c\s*e\s*s|参考文献)\b/gi),
  );
  for (let index = headingMatches.length - 1; index >= 0; index -= 1) {
    const match = headingMatches[index];
    const preview = source.slice(match.index, match.index + 1800);
    const firstMarker = preview.match(/\[(1)\]\s+/);
    if (firstMarker) return match.index + firstMarker.index;
  }

  return findSequentialReferenceListStart(source);
}

function findSequentialReferenceListStart(source) {
  const markers = Array.from(source.matchAll(/(?:^|\s)\[(\d{1,3})\]\s+/g)).map((match) => ({
    number: Number(match[1]),
    index: match.index + match[0].indexOf("["),
  }));

  let best = null;
  markers.forEach((marker, startIndex) => {
    if (marker.number !== 1) return;
    let expected = 2;
    let lastIndex = marker.index;
    let count = 1;

    for (let index = startIndex + 1; index < markers.length && expected <= 12; index += 1) {
      const next = markers[index];
      if (next.index - lastIndex > 2500) break;
      if (next.number !== expected) continue;
      count += 1;
      expected += 1;
      lastIndex = next.index;
    }

    if (count >= 5 && (!best || count > best.count || marker.index > best.index)) {
      best = { count, index: marker.index };
    }
  });

  return best ? best.index : -1;
}

function cleanReferenceText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
}

function getCitationNumbers(value) {
  const body = String(value || "").replace(/^\[/, "").replace(/\]$/, "");
  const numbers = [];
  body.split(/[，,]/).forEach((part) => {
    const range = part.match(/(\d{1,3})\s*-\s*(\d{1,3})/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      const step = start <= end ? 1 : -1;
      for (let number = start; number !== end + step; number += step) numbers.push(String(number));
      return;
    }
    const single = part.match(/\d{1,3}/);
    if (single) numbers.push(single[0]);
  });
  return Array.from(new Set(numbers));
}

async function summarizeText(text) {
  const response = await apiFetch("/api/summarize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paperId: currentPaper?.id || "", paperText: text }),
  });
  const data = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(data.detail || data.error || "Summary failed.");
  }

  renderSummary(data.summary);
  renderBasicInfo(data.summary?.basicInfo);
  await saveCurrentPaper({ summary: data.summary });
  if (data.summary?.paperTitle) {
    setReaderPaperTitle(data.summary.paperTitle);
  }
  clearStatus();
}

async function regenerateSummarySection(section) {
  const text = lastExtractedText.trim();
  if (text.length < 80) {
    setStatus("Upload a PDF first. No extracted text is available for regeneration.", true);
    return;
  }

  const button = getSummarySectionRefreshButton(section);
  if (button) {
    button.disabled = true;
    button.classList.add("spinning");
  }
  clearStatus();
  if (section === "method") {
    // Keep the existing Method Breakdown visible while it regenerates; only
    // show progress in the status line instead of inside the content area.
    setStatus("正在重新生成方法解析...");
  } else {
    setSummarySectionLoading(section);
  }
  try {
    if (section === "keywords") {
      const overviewInfo = await fetchOverviewInfo(text);
      const keywordsValue = overviewInfo.keywords || [];
      const keywordExplanations = overviewInfo.keywordExplanations || {};
      renderKeywords(keywordsValue, keywordExplanations);
      await saveCurrentPaper({ summary: { ...paperToSummary(currentPaper), keywords: keywordsValue, keywordExplanations } });
      clearStatus();
      return;
    }

    const summary = await fetchFullSummary(text);
    if (section === "threeLine") {
      const threeLineSummary = summary.threeLineSummary || {};
      challenges.textContent = threeLineSummary.challenges || "No response";
      method.textContent = threeLineSummary.method || "No response";
      conclusion.textContent = threeLineSummary.conclusion || "No response";
      await saveCurrentPaper({ summary: { ...paperToSummary(currentPaper), threeLineSummary } });
      clearStatus();
      return;
    }

    if (section === "method") {
      const methodUpdate = {
        methodOverview: summary.methodOverview || "",
        methodSections: summary.methodSections || [],
        methodConclusion: summary.methodConclusion || "",
      };
      renderMethodSections(methodUpdate.methodSections, {
        fallbackText: summary.threeLineSummary?.method || "",
        overview: methodUpdate.methodOverview,
        conclusion: methodUpdate.methodConclusion,
      });
      await saveCurrentPaper({ summary: { ...paperToSummary(currentPaper), ...methodUpdate } });
      clearStatus();
    }
  } catch (error) {
    console.error(error);
    renderSummary(paperToSummary(currentPaper));
    setStatus(error.message || "Regeneration failed.", true);
  } finally {
    if (button) {
      button.classList.remove("spinning");
      button.disabled = false;
    }
  }
}

function getSummarySectionRefreshButton(section) {
  if (section === "keywords") return regenerateKeywordsButton;
  if (section === "threeLine") return regenerateThreeLineButton;
  if (section === "method") return regenerateMethodButton;
  return null;
}

function setSummarySectionLoading(section) {
  if (section === "keywords") {
    renderKeywordsLoading("重新生成关键词中...");
    return;
  }
  if (section === "threeLine") {
    challenges.textContent = "Loading...";
    method.textContent = "Loading...";
    conclusion.textContent = "Loading...";
  }
}

async function fetchFullSummary(text) {
  const response = await apiFetch("/api/summarize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paperId: currentPaper?.id || "", paperText: text }),
  });
  const data = await readJsonResponse(response);
  if (!response.ok) throw new Error(data.detail || data.error || "Summary failed.");
  return data.summary || {};
}

async function fetchOverviewInfo(text) {
  const response = await apiFetch("/api/overview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paperId: currentPaper?.id || "", paperText: text }),
  });
  const data = await readJsonResponse(response);
  if (!response.ok) throw new Error(data.detail || data.error || "Overview extraction failed.");
  return data.overviewInfo || {};
}

async function refreshOverviewInfo(text) {
  const overviewInfo = await fetchOverviewInfo(text);

  renderKeywords(overviewInfo.keywords || [], overviewInfo.keywordExplanations || {});
  renderBasicInfo(overviewInfo.basicInfo);
  await saveCurrentPaper({ overviewInfo });
  if (overviewInfo.paperTitle) {
    setReaderPaperTitle(overviewInfo.paperTitle);
  }
}

async function getPdfMetadataTitle(pdf) {
  try {
    const metadata = await pdf.getMetadata();
    const title = metadata?.info?.Title || metadata?.metadata?.get("dc:title") || "";
    return cleanPaperTitle(title);
  } catch (error) {
    console.warn("Could not read PDF metadata title.", error);
    return "";
  }
}

function guessPaperTitle(firstPageText) {
  const lines = firstPageText
    .split(/\s{2,}|\n+/)
    .map((line) => cleanPaperTitle(line))
    .filter((line) => line.length >= 8 && line.length <= 180)
    .filter((line) => !/^(abstract|introduction|keywords|arxiv|doi|preprint)\b/i.test(line));

  return lines[0] || "";
}

function cleanPaperTitle(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\.(pdf|PDF)$/g, "")
    .trim();
}

function handlePdfSelectionPointerDown(event) {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey) return;
  const textSpan = getPdfTextSpanForNode(event.target);
  const pageNode = textSpan?.closest(".pdf-page");
  isPdfTextSelecting = Boolean(textSpan && pageNode);
  pdfSelectionPointerId = isPdfTextSelecting ? event.pointerId : null;
  pdfSelectionStartPageNumber = isPdfTextSelecting ? Number(pageNode.dataset.pageNumber) || null : null;
  pendingPdfSelectionRect = null;
  if (!isPdfTextSelecting) {
    resetPdfSelectionPointerState();
    clearPdfSelectionState({ clearBrowserSelection: true });
    return;
  }
  hideSelectionMenu();
  hideTranslationBubble();
  hideReferencePopover();
  document.body.classList.add("selecting-pdf-text");
}

function handlePdfSelectionPointerFinish(event) {
  if (!isPdfTextSelecting || event.pointerId !== pdfSelectionPointerId) return;
  resetPdfSelectionPointerState();
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    pendingPdfSelectionRect = null;
    return;
  }
  if (!isPdfSelection(selection)) {
    clearPdfSelectionState({ clearBrowserSelection: true });
    return;
  }
  if (pendingPdfSelectionRect || lastSelectionRect) {
    showSelectionMenu(pendingPdfSelectionRect || lastSelectionRect);
  }
  pendingPdfSelectionRect = null;
}

function resetPdfSelectionPointerState() {
  isPdfTextSelecting = false;
  pdfSelectionPointerId = null;
  pdfSelectionStartPageNumber = null;
  document.body.classList.remove("selecting-pdf-text");
}

function handlePdfSelectionChange() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    clearPdfSelectionState();
    return;
  }

  const range = selection.getRangeAt(0);
  const commonNode = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
    ? range.commonAncestorContainer.parentElement
    : range.commonAncestorContainer;
  if (!pdfViewer.contains(commonNode)) {
    clearPdfSelectionState();
    return;
  }

  if (!isPdfSelection(selection)) {
    clearPdfSelectionState({ clearBrowserSelection: isPdfTextSelecting });
    return;
  }

  const text = selection.toString().trim();
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
  if (!text || !rects.length) {
    clearPdfSelectionState();
    return;
  }

  selectedPdfText = text;
  selectedPdfRange = range.cloneRange();
  lastSelectionRect = rects[rects.length - 1];
  hideTranslationBubble();
  hideReferencePopover();
  if (isPdfTextSelecting) {
    pendingPdfSelectionRect = lastSelectionRect;
    hideSelectionMenu();
    return;
  }
  showSelectionMenu(lastSelectionRect);
}

function clearPdfSelectionState(options = {}) {
  const { clearBrowserSelection = false } = options;
  selectedPdfText = "";
  selectedPdfRange = null;
  lastSelectionRect = null;
  pendingPdfSelectionRect = null;
  hideSelectionMenu();
  hideTranslationBubble();
  if (clearBrowserSelection) window.getSelection()?.removeAllRanges();
}

function isPdfSelection(selection) {
  if (!selection || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  const startPage = getPdfPageForNode(range.startContainer);
  const endPage = getPdfPageForNode(range.endContainer);
  const anchorPage = getPdfPageForNode(selection.anchorNode);
  const focusPage = getPdfPageForNode(selection.focusNode);
  if (!startPage || !endPage || !anchorPage || !focusPage) return false;
  if (isPdfTextSelecting) {
    const startPageNumber = Number(startPage.dataset.pageNumber) || null;
    const endPageNumber = Number(endPage.dataset.pageNumber) || null;
    const anchorPageNumber = Number(anchorPage.dataset.pageNumber) || null;
    const focusPageNumber = Number(focusPage.dataset.pageNumber) || null;
    if (
      !pdfSelectionStartPageNumber ||
      startPageNumber !== pdfSelectionStartPageNumber ||
      endPageNumber !== pdfSelectionStartPageNumber ||
      anchorPageNumber !== pdfSelectionStartPageNumber ||
      focusPageNumber !== pdfSelectionStartPageNumber
    ) {
      return false;
    }
  }
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
  if (!rects.length) return false;
  return rects.every((rect) => {
    const pageNode = getPageNodeForRect(rect);
    if (!pageNode) return false;
    return !isPdfTextSelecting || Number(pageNode.dataset.pageNumber) === pdfSelectionStartPageNumber;
  });
}

function getPdfTextLayerForNode(node) {
  const element = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  return element?.closest?.(".pdf-text-layer") || null;
}

function getPdfTextSpanForNode(node) {
  const element = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  return element?.closest?.(".pdf-text-layer span") || null;
}

function getPdfPageForNode(node) {
  const textSpan = getPdfTextSpanForNode(node);
  return textSpan?.closest(".pdf-page") || null;
}

function getPdfFrameElement() {
  return pdfViewer.closest(".paper-frame") || pdfViewer.parentElement;
}

function showSelectionMenu(rect) {
  const frameRect = getPdfFrameElement().getBoundingClientRect();
  const left = Math.min(rect.right - frameRect.left + 8, frameRect.width - selectionMenu.offsetWidth - 12);
  const top = Math.max(rect.top - frameRect.top - 4, 12);
  selectionMenu.style.left = `${Math.max(left, 12)}px`;
  selectionMenu.style.top = `${top}px`;
  selectionMenu.hidden = false;
}

function hideSelectionMenu() {
  selectionMenu.hidden = true;
}

function highlightSelection() {
  if (!selectedPdfRange) return;

  const groupId = createAnnotationId();
  const highlights = createHighlightsFromRange(selectedPdfRange, { groupId, color: "yellow", text: selectedPdfText });
  highlights.forEach((highlight) => {
    savedHighlights.push(highlight);
    const pageNode = pdfViewer.querySelector(`.pdf-page[data-page-number="${highlight.pageNumber}"]`);
    if (pageNode) drawHighlight(pageNode, highlight);
  });

  hideSelectionMenu();
  hideTranslationBubble();
  window.getSelection()?.removeAllRanges();
  saveCurrentPaper().catch((error) => console.error("Failed to save highlights.", error));
}

function createHighlightsFromRange(range, extra = {}) {
  const rects = mergeSelectionRects(Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0));
  return rects
    .map((rect) => {
    const pageNode = getPageNodeForRect(rect);
      if (!pageNode) return null;
    const pageRect = pageNode.getBoundingClientRect();
      return {
      pageNumber: Number(pageNode.dataset.pageNumber),
      left: (rect.left - pageRect.left) / pageRect.width,
      top: (rect.top - pageRect.top) / pageRect.height,
      width: rect.width / pageRect.width,
      height: rect.height / pageRect.height,
        ...extra,
    };
    })
    .filter(Boolean);
}

function mergeSelectionRects(rects) {
  const groups = [];
  rects.forEach((rect) => {
    const pageNode = getPageNodeForRect(rect);
    if (!pageNode) return;
    const pageRect = pageNode.getBoundingClientRect();
    const normalized = {
      pageNode,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      pageNumber: Number(pageNode.dataset.pageNumber),
      pageTop: (rect.top - pageRect.top) / pageRect.height,
    };
    const group = groups.find((item) => {
      return item.pageNumber === normalized.pageNumber && Math.abs(item.pageTop - normalized.pageTop) < 0.006;
    });
    if (group) {
      group.left = Math.min(group.left, normalized.left);
      group.right = Math.max(group.right, normalized.right);
      group.top = Math.min(group.top, normalized.top);
      group.bottom = Math.max(group.bottom, normalized.bottom);
    } else {
      groups.push(normalized);
    }
  });

  return groups.map((group) => ({
    left: group.left,
    right: group.right,
    top: group.top,
    bottom: group.bottom,
    width: group.right - group.left,
    height: group.bottom - group.top,
  }));
}

function commentSelection() {
  if (!selectedPdfRange) return;

  const groupId = createAnnotationId();
  const draftHighlights = createHighlightsFromRange(selectedPdfRange, {
    groupId,
    color: "green",
    type: "comment",
    text: selectedPdfText,
  });
  if (!draftHighlights.length) return;

  draftHighlights.forEach((highlight) => {
    savedHighlights.push(highlight);
    const pageNode = pdfViewer.querySelector(`.pdf-page[data-page-number="${highlight.pageNumber}"]`);
    if (pageNode) drawHighlight(pageNode, highlight);
  });

  hideSelectionMenu();
  hideTranslationBubble();
  window.getSelection()?.removeAllRanges();
  showAnnotationEditor(draftHighlights[0], lastSelectionRect?.right || 0, lastSelectionRect?.bottom || 0);
  refreshCommentsNavigation();
}

function setSelectionMenuButtonLabel(button, label) {
  const labelNode = button?.querySelector("span");
  if (labelNode) labelNode.textContent = label;
  else if (button) button.textContent = label;
}

function getTranslationSelectionType(text) {
  const value = String(text || "").trim();
  const units = value.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)?|[\u4e00-\u9fff]/g) || [];
  const sentenceMarks = value.match(/[.!?;:。！？；：]/g) || [];
  if (/\n\s*\n/.test(value) || value.length > 160 || sentenceMarks.length > 0 || units.length > 12) {
    return "sentence_or_paragraph";
  }
  return "word_or_phrase";
}

async function translateSelection() {
  const text = selectedPdfText.trim();
  if (!text || !selectedPdfRange) return;

  const groupId = createAnnotationId();
  const draftHighlights = createHighlightsFromRange(selectedPdfRange, {
    groupId,
    color: "blue",
    type: "translation",
    text,
  });
  if (!draftHighlights.length) return;

  translateButton.disabled = true;
  setSelectionMenuButtonLabel(translateButton, "翻译中");
  try {
    const response = await apiFetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        selectionType: getTranslationSelectionType(text),
        paperText: lastExtractedText.trim(),
        summary: paperToSummary(currentPaper),
      }),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.detail || data.error || "\u7ffb\u8bd1\u5931\u8d25");
    const translation = data.translation || "";
    draftHighlights.forEach((highlight) => {
      const annotation = { ...highlight, translation };
      savedHighlights.push(annotation);
      const pageNode = pdfViewer.querySelector(`.pdf-page[data-page-number="${annotation.pageNumber}"]`);
      if (pageNode) drawHighlight(pageNode, annotation);
    });
    window.getSelection()?.removeAllRanges();
    await saveCurrentPaper();
    showAnnotationEditor(draftHighlights[0], lastSelectionRect?.right || 0, lastSelectionRect?.bottom || 0, { mode: "preview" });
    refreshCommentsNavigation();
  } catch (error) {
    setStatus(error.message || "\u7ffb\u8bd1\u5931\u8d25", true);
  } finally {
    translateButton.disabled = false;
    setSelectionMenuButtonLabel(translateButton, "翻译");
  }
}

async function explainSelection() {
  const text = selectedPdfText.trim();
  const paperText = lastExtractedText.trim();
  if (!text || !selectedPdfRange) return;
  if (paperText.length < 80) {
    setStatus("请先打开并解析论文，再解释局部文本。", true);
    return;
  }

  const groupId = createAnnotationId();
  const draftHighlights = createHighlightsFromRange(selectedPdfRange, {
    groupId,
    color: "green",
    type: "comment",
    text,
  });
  if (!draftHighlights.length) return;

  hideTranslationBubble();
  explainButton.disabled = true;
  setSelectionMenuButtonLabel(explainButton, "解释中");
  try {
    const response = await apiFetch("/api/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        selectedText: text,
        paperText,
        summary: paperToSummary(currentPaper),
      }),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.detail || data.error || "\u89e3\u91ca\u5931\u8d25");
    const comment = String(data.explanation || "").trim() || "No explanation returned.";
    draftHighlights.forEach((highlight) => {
      const annotation = { ...highlight, comment };
      savedHighlights.push(annotation);
      const pageNode = pdfViewer.querySelector(`.pdf-page[data-page-number="${annotation.pageNumber}"]`);
      if (pageNode) drawHighlight(pageNode, annotation);
    });
    window.getSelection()?.removeAllRanges();
    hideSelectionMenu();
    showAnnotationEditor(draftHighlights[0], lastSelectionRect?.right || 0, lastSelectionRect?.bottom || 0, { mode: "preview" });
    refreshCommentsNavigation();
    saveCurrentPaper().catch((error) => console.error("Failed to save explanation annotation.", error));
  } catch (error) {
    setStatus(error.message || "\u89e3\u91ca\u5931\u8d25", true);
  } finally {
    explainButton.disabled = false;
    setSelectionMenuButtonLabel(explainButton, "解释");
  }
}

function askSelectionInDiscussion() {
  const text = selectedPdfText.trim();
  if (!text || !selectedPdfRange) return;

  const context = buildPdfSelectionContext(selectedPdfRange);
  const reference = {
    text,
    paperTitle: currentPaper?.title || fileName?.textContent || "",
    page: context.page || 0,
    before: context.before,
    after: context.after,
  };
  const thread = createDiscussionThread("", true, reference);
  setActiveReaderTab("withAiTab");
  setSummaryPaneCollapsed(false);
  renderDiscussionReferenceBox(thread.reference);
  hideSelectionMenu();
  hideTranslationBubble();
  window.getSelection()?.removeAllRanges();
  discussionInput?.focus();
}

// Capture the actual page and the text immediately around the selection from the
// rendered PDF, so a repeated phrase can be anchored to the instance the user
// highlighted instead of the first occurrence in the paper.
function buildPdfSelectionContext(range, beforeChars = 140, afterChars = 120) {
  if (!range) return { page: 0, before: "", after: "" };
  const pageNode = getPdfPageForNode(range.startContainer) || getPdfPageForNode(range.endContainer);
  if (!pageNode) return { page: 0, before: "", after: "" };
  const page = Number(pageNode.dataset.pageNumber) || 0;

  const walker = document.createTreeWalker(pageNode, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  const starts = [];
  let total = 0;
  while (walker.nextNode()) {
    const text = walker.currentNode.nodeValue || "";
    if (!text.length) continue;
    textNodes.push(walker.currentNode);
    starts.push(total);
    total += text.length;
  }
  if (!textNodes.length) return { page, before: "", after: "" };

  const startIndex = textNodes.indexOf(range.startContainer);
  const endIndex = textNodes.indexOf(range.endContainer);
  if (startIndex < 0 || endIndex < 0) return { page, before: "", after: "" };

  const fullText = textNodes.map((node) => node.nodeValue || "").join("");
  const startGlobal = starts[startIndex] + range.startOffset;
  const endGlobal = starts[endIndex] + range.endOffset;
  const collapse = (value) => String(value || "").replace(/\s+/g, " ").trim();
  return {
    page,
    before: collapse(fullText.slice(Math.max(0, startGlobal - beforeChars), startGlobal)).slice(-240),
    after: collapse(fullText.slice(endGlobal, endGlobal + afterChars)).slice(0, 240),
  };
}

function showTranslationWindow(text) {
  let bubble = document.querySelector("#translationBubble");
  if (!bubble) {
    bubble = document.createElement("section");
    bubble.id = "translationBubble";
    bubble.className = "translation-window";
    bubble.innerHTML = `
      <header class="translation-window-header">
        <span>Translation</span>
        <button class="translation-close" type="button" aria-label="Close translation">×</button>
      </header>
      <textarea class="translation-text" spellcheck="false"></textarea>
    `;
    getPdfFrameElement().appendChild(bubble);
    initTranslationWindow(bubble);
  }

  bubble.querySelector(".translation-text").value = text;
  const frameRect = getPdfFrameElement().getBoundingClientRect();
  const rect = lastSelectionRect || frameRect;
  const bubbleWidth = bubble.offsetWidth || 360;
  const bubbleHeight = bubble.offsetHeight || 220;
  const left = Math.max(12, Math.min(rect.left - frameRect.left, frameRect.width - bubbleWidth - 12));
  const top = Math.max(12, Math.min(rect.bottom - frameRect.top + 10, frameRect.height - bubbleHeight - 12));
  bubble.style.left = `${left}px`;
  bubble.style.top = `${top}px`;
}

function decorateReferenceCitations(pageNode, textLayer) {
  if (!referenceEntries.size) return;

  const pageRect = pageNode.getBoundingClientRect();
  const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  textNodes.forEach((node) => {
    const text = node.nodeValue || "";
    const matches = Array.from(text.matchAll(/\[(\s*\d{1,3}(?:\s*[,，-]\s*\d{1,3})*\s*)\]/g));
    matches.forEach((match) => {
      const numbers = getCitationNumbers(match[0]).filter((number) => referenceEntries.has(number));
      if (!numbers.length) return;

      const range = document.createRange();
      range.setStart(node, match.index);
      range.setEnd(node, match.index + match[0].length);
      const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
      range.detach();

      rects.forEach((rect) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "pdf-reference-cue";
        button.dataset.references = numbers.join(",");
        button.setAttribute("aria-label", `Show reference ${numbers.join(", ")}`);
        button.title = `Reference ${numbers.join(", ")}`;
        button.style.left = `${rect.left - pageRect.left}px`;
        button.style.top = `${rect.top - pageRect.top}px`;
        button.style.width = `${Math.max(rect.width, 10)}px`;
        button.style.height = `${Math.max(rect.height, 10)}px`;
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          showReferencePopover(numbers, event.clientX, event.clientY);
        });
        pageNode.appendChild(button);
      });
    });
  });
}

function refreshReferenceCitations() {
  pdfViewer.querySelectorAll(".pdf-reference-cue").forEach((cue) => cue.remove());
  if (!referenceEntries.size) return;
  pdfViewer.querySelectorAll(".pdf-page").forEach((pageNode) => {
    const textLayer = pageNode.querySelector(".pdf-text-layer");
    if (textLayer) decorateReferenceCitations(pageNode, textLayer);
  });
}

// Allow common external PDF links while still rejecting javascript:/data:/file:/relative paths.
function getSafePdfLinkUrl(url) {
  if (typeof url !== "string") return null;
  const trimmed = url.trim().replace(/^<|>$/g, "");
  if (!trimmed) return null;

  let candidate = trimmed;
  if (/^\/\//.test(candidate)) {
    candidate = `https:${candidate}`;
  } else if (/^www\./i.test(candidate) || /^doi\.org\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  } else if (/^10\.\d{4,9}\//.test(candidate)) {
    candidate = `https://doi.org/${candidate}`;
  }

  try {
    const parsed = new URL(candidate);
    return SAFE_LINK_PROTOCOLS.has(parsed.protocol.toLowerCase()) ? parsed.href : null;
  } catch {
    return null;
  }
}

function getPdfAnnotationExternalUrl(annotation) {
  if (!annotation || typeof annotation !== "object") return null;
  const action = annotation.action && typeof annotation.action === "object" ? annotation.action : {};
  const candidates = [
    annotation.url,
    annotation.unsafeUrl,
    action.url,
    action.uri,
    action.URI,
    typeof annotation.action === "string" ? annotation.action : "",
  ];
  for (const candidate of candidates) {
    const safeUrl = getSafePdfLinkUrl(candidate);
    if (safeUrl) return safeUrl;
  }
  return null;
}

// dest 解析为 { pageIndex(0-based), top, left }；top/left 仅 /XYZ、/FitH、/FitBH 有值，否则 null
async function resolvePdfLinkDestination(pdf, dest) {
  try {
    if (typeof dest === "string") {
      if (pdfLinkDestCache.has(dest)) return pdfLinkDestCache.get(dest);
      const promise = (async () => {
        const arr = await pdf.getDestination(dest);
        return arr ? computePdfLinkDestination(pdf, arr) : null;
      })().catch(() => null);
      pdfLinkDestCache.set(dest, promise);
      return promise;
    }
    return computePdfLinkDestination(pdf, dest);
  } catch {
    return null;
  }
}

async function computePdfLinkDestination(pdf, destArray) {
  const target = destArray[0];
  let pageIndex = null;
  if (typeof target === "number") {
    pageIndex = Math.min(Math.max(0, target), pdf.numPages - 1);
  } else if (typeof target === "object" && target !== null) {
    pageIndex = Math.min(Math.max(0, await pdf.getPageIndex(target)), pdf.numPages - 1);
  } else {
    return null;
  }
  // pdf.js 中 dest 的类型位可能是字符串（如 "XYZ"）或 Name 对象（如 { name: "XYZ" }）
  const typeEntry = destArray[1];
  const type = typeof typeEntry === "string" ? typeEntry : (typeEntry && typeEntry.name) || "";
  let top = null;
  let left = null;
  if (type === "XYZ") {
    left = typeof destArray[2] === "number" ? destArray[2] : null;
    top = typeof destArray[3] === "number" ? destArray[3] : null;
  } else if (type === "FitH" || type === "FitBH") {
    top = typeof destArray[2] === "number" ? destArray[2] : null;
  }
  return { pageIndex, top, left };
}

// 目标页文本项按行聚合；行以 [n] 开头且 n 在 referenceEntries 中 => 参考文献条目行
async function detectPdfLinkReferenceNumber(targetPage, destTop, destLeft) {
  try {
    const pageHeightPdf = targetPage.getViewport({ scale: 1 }).height;
    const { items } = await targetPage.getTextContent();
    const rows = new Map(); // 行顶(round) -> { top, left, parts }
    items.forEach((item) => {
      const str = (item.str || "").trim();
      if (!str) return;
      const top = pageHeightPdf - item.transform[5]; // 基线距页顶（PDF 单位）
      const rowTop = Math.round(top / 2) * 2;        // 粗粒度行锚点
      const row = rows.get(rowTop) || { top: 0, left: Infinity, parts: [] };
      row.top = top;
      const itemLeft = item.transform[4];
      if (itemLeft < row.left) row.left = itemLeft;
      row.parts.push({ left: itemLeft, str });
      rows.set(rowTop, row);
    });

    let best = null; // { number, lineTop, dist }
    rows.forEach((row) => {
      const lineText = row.parts
        .slice().sort((a, b) => a.left - b.left)
        .map((p) => p.str).join(" ");
      const marker = lineText.trimStart().match(/^\[(\d{1,3})\]/);
      if (!marker || !referenceEntries.has(marker[1])) return;
      const dist = Math.abs(row.top - destTop);
      if (!best || dist < best.dist || (dist === best.dist && row.top > best.lineTop)) {
        best = { number: marker[1], lineTop: row.top, dist };
      }
    });
    return best ? best.number : null;
  } catch {
    return null;
  }
}

async function decoratePdfLinks(pageNode, pageNumber, page, viewport) {
  let annotations;
  try {
    const cached = pdfLinkAnnotationsCache.get(pageNumber);
    if (cached) {
      annotations = await cached;
    } else {
      const promise = page.getAnnotations({ intent: "display" }).catch(() => []);
      pdfLinkAnnotationsCache.set(pageNumber, promise);
      annotations = await promise;
    }
  } catch {
    return;
  }

  const pageWidth = viewport.width;
  const pageHeight = viewport.height;
  const layer = document.createElement("div");
  layer.className = "pdf-link-layer";

  for (const annotation of annotations) {
    if (annotation.subtype !== "Link") continue;
    const url = getPdfAnnotationExternalUrl(annotation);
    const isInternal = url == null && annotation.dest != null;
    if (!url && !isInternal) continue;

    // rect 是 PDF 坐标（左下原点）-> convertToViewportRectangle 转成视口坐标（左上原点），再归一化、钳制到页内
    const [vx1, vy1, vx2, vy2] = viewport.convertToViewportRectangle(annotation.rect || [0, 0, 0, 0]);
    const left = Math.max(0, Math.min(vx1, vx2));
    const top = Math.max(0, Math.min(vy1, vy2));
    const width = Math.min(Math.abs(vx2 - vx1), pageWidth - left);
    const height = Math.min(Math.abs(vy2 - vy1), pageHeight - top);
    if (width < 2 || height < 2) continue;

    const link = document.createElement("a");
    link.className = "pdf-link";
    Object.assign(link.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });

    if (url) {
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.title = url;
      link.setAttribute("aria-label", url);
      link.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation(); // 阻止 handlePdfClick 触发（引用/高亮命中测试）
        window.open(url, "_blank", "noopener,noreferrer");
      });
    } else {
      link.href = "#";
      link.title = "PDF 内部链接";
      link.setAttribute("aria-label", "PDF 内部链接");
      link.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        handlePdfInternalLinkClick(annotation.dest, event.clientX, event.clientY);
      });
    }
    layer.appendChild(link);
  }

  if (layer.childElementCount) pageNode.appendChild(layer);
}

function handlePdfInternalLinkClick(dest, clientX, clientY) {
  handlePdfInternalLinkClickAsync(dest, clientX, clientY)
    .catch((error) => console.error("Failed to follow PDF internal link.", error));
}

async function handlePdfInternalLinkClickAsync(dest, clientX, clientY) {
  const resolved = await resolvePdfLinkDestination(currentPdfDocument, dest);
  if (resolved && resolved.top != null) {
    const targetPageNumber = resolved.pageIndex + 1;
    const targetPage = await currentPdfDocument.getPage(targetPageNumber);
    const refNumber = await detectPdfLinkReferenceNumber(targetPage, resolved.top, resolved.left);
    if (refNumber != null) {
      showReferencePopover([refNumber], clientX, clientY); // 原地弹框，不跳转
      return;
    }
  }
  if (resolved) jumpToPdfLinkPage(resolved.pageIndex + 1);
}

function jumpToPdfLinkPage(pageNumber) {
  jumpToPdfLinkPageAsync(pageNumber).catch((error) => console.error("Failed to follow PDF link.", error));
}

async function jumpToPdfLinkPageAsync(pageNumber) {
  if (!currentPdfDocument || !currentPdfTask) return;
  const pageNode = pdfViewer.querySelector(`.pdf-page[data-page-number="${pageNumber}"]`);
  if (!pageNode) return;
  pageNode.scrollIntoView({ block: "center", behavior: "smooth" });
  await renderPdfPageInto(pageNumber, pageNode, currentPdfTask);
}

function handlePdfClick(event) {
  const selection = window.getSelection();
  if (selection && selection.toString().trim()) return;
  if (selectionMenu.contains(event.target) || event.target.closest(".reference-popover")) return;

  const cue = event.target.closest(".pdf-reference-cue");
  if (cue) {
    const numbers = (cue.dataset.references || "").split(",").filter(Boolean);
    if (numbers.length) {
      event.preventDefault();
      showReferencePopover(numbers, event.clientX, event.clientY);
      return;
    }
  }

  const clickedReference = getCitationAtPoint(event.clientX, event.clientY);
  if (clickedReference.length) {
    event.preventDefault();
    showReferencePopover(clickedReference, event.clientX, event.clientY);
    return;
  }

  const hit = findHighlightAtPoint(event.clientX, event.clientY);
  if (!hit) return;

  event.preventDefault();
  hideSelectionMenu();
  hideTranslationBubble();
  hideReferencePopover();
  showAnnotationEditor(hit.highlight, event.clientX, event.clientY);
}

function getCitationAtPoint(clientX, clientY) {
  const range = getTextRangeAtPoint(clientX, clientY);
  if (!range || !range.startContainer || range.startContainer.nodeType !== Node.TEXT_NODE) return [];

  const text = range.startContainer.nodeValue || "";
  const offset = range.startOffset;
  const windowStart = Math.max(0, offset - 16);
  const windowText = text.slice(windowStart, Math.min(text.length, offset + 16));
  const matches = Array.from(windowText.matchAll(/\[(\s*\d{1,3}(?:\s*[,，-]\s*\d{1,3})*\s*)\]/g));
  const match = matches.find((item) => {
    const start = windowStart + item.index;
    const end = start + item[0].length;
    return offset >= start && offset <= end;
  });
  if (!match) return [];

  return getCitationNumbers(match[0]).filter((number) => referenceEntries.has(number));
}

function getTextRangeAtPoint(clientX, clientY) {
  if (document.caretRangeFromPoint) return document.caretRangeFromPoint(clientX, clientY);
  if (!document.caretPositionFromPoint) return null;
  const position = document.caretPositionFromPoint(clientX, clientY);
  if (!position) return null;
  const range = document.createRange();
  range.setStart(position.offsetNode, position.offset);
  range.collapse(true);
  return range;
}

function showReferencePopover(numbers, clientX, clientY) {
  const entries = numbers
    .map((number) => ({ number, text: referenceEntries.get(number) }))
    .filter((entry) => entry.text);
  if (!entries.length) return;

  hideSelectionMenu();
  hideTranslationBubble();
  hideAnnotationEditor();

  let popover = document.querySelector("#referencePopover");
  if (!popover) {
    popover = document.createElement("section");
    popover.id = "referencePopover";
    popover.className = "reference-popover";
    popover.innerHTML = `
      <header class="reference-popover-header">
        <span>参考文献</span>
        <div class="reference-popover-tools">
          <button class="reference-icon-button reference-copy" type="button" aria-label="复制引用" title="复制引用">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          </button>
          <button class="reference-icon-button reference-scholar" type="button" aria-label="在 Google Scholar 中打开" title="Google Scholar">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M22 10 12 5 2 10l10 5 10-5z"></path><path d="M6 12.5V16c0 1.7 2.7 3 6 3s6-1.3 6-3v-3.5"></path><path d="M22 10v6"></path></svg>
          </button>
          <button class="reference-icon-button reference-close" type="button" aria-label="关闭参考文献预览" title="关闭">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>
          </button>
        </div>
      </header>
      <div class="reference-popover-body"></div>
    `;
    popover.querySelector(".reference-close").addEventListener("click", hideReferencePopover);
    getPdfFrameElement().appendChild(popover);
  }

  popover.querySelector(".reference-copy").onclick = () => copyReferenceEntries(entries, popover);
  popover.querySelector(".reference-scholar").onclick = () => openReferenceInGoogleScholar(entries);
  const body = popover.querySelector(".reference-popover-body");
  body.innerHTML = "";
  entries.forEach((entry) => {
    const item = document.createElement("article");
    item.className = "reference-entry";
    const number = document.createElement("strong");
    number.textContent = `[${entry.number}]`;
    const text = document.createElement("p");
    text.textContent = entry.text;
    item.append(number, text);
    body.appendChild(item);
  });
  popover.dataset.copyText = entries.map((entry) => `[${entry.number}] ${entry.text}`).join("\n");
  resetReferenceCopyButton(popover.querySelector(".reference-copy"));
  positionReferencePopover(popover, clientX, clientY);
}

function positionReferencePopover(popover, clientX, clientY) {
  const frameRect = getPdfFrameElement().getBoundingClientRect();
  const width = popover.offsetWidth || 340;
  const height = popover.offsetHeight || 180;
  const placeRight = clientX - frameRect.left + 12 + width <= frameRect.width - 12;
  const left = placeRight ? clientX - frameRect.left + 12 : clientX - frameRect.left - width - 12;
  const top = Math.min(Math.max(clientY - frameRect.top - 18, 12), frameRect.height - height - 12);
  popover.style.left = `${Math.max(12, Math.min(left, frameRect.width - width - 12))}px`;
  popover.style.top = `${Math.max(12, top)}px`;
}

async function copyReferenceEntries(entries, popover) {
  const text = popover.dataset.copyText || entries.map((entry) => `[${entry.number}] ${entry.text}`).join("\n");
  const button = popover.querySelector(".reference-copy");
  try {
    await copyTextToClipboard(text);
    button.classList.add("copied");
    button.setAttribute("aria-label", "已复制");
    button.title = "已复制";
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m20 6-11 11-5-5"></path></svg>';
    window.setTimeout(() => {
      if (document.body.contains(button)) resetReferenceCopyButton(button);
    }, 1200);
  } catch (error) {
    console.error("Failed to copy reference.", error);
    button.classList.add("error");
    button.setAttribute("aria-label", "复制失败");
    button.title = "复制失败";
  }
}

function resetReferenceCopyButton(button) {
  if (!button) return;
  button.classList.remove("copied", "error");
  button.setAttribute("aria-label", "复制引用");
  button.title = "复制引用";
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
}

function openReferenceInGoogleScholar(entries) {
  const text = entries.map((entry) => entry.text).join(" ").replace(/\s+/g, " ").trim();
  if (!text) return;
  window.open(`https://scholar.google.com/scholar?q=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
}

async function copyTextToClipboard(text) {
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

function hideReferencePopover() {
  document.querySelector("#referencePopover")?.remove();
}

function findHighlightAtPoint(clientX, clientY) {
  const pageNode = Array.from(pdfViewer.querySelectorAll(".pdf-page")).find((node) => {
    const rect = node.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  });
  if (!pageNode) return null;

  const pageRect = pageNode.getBoundingClientRect();
  const pageNumber = Number(pageNode.dataset.pageNumber);
  const x = (clientX - pageRect.left) / pageRect.width;
  const y = (clientY - pageRect.top) / pageRect.height;
  const highlight = savedHighlights.find((item) => {
    return (
      item.pageNumber === pageNumber &&
      x >= item.left &&
      x <= item.left + item.width &&
      y >= item.top &&
      y <= item.top + item.height
    );
  });
  return highlight ? { pageNode, highlight } : null;
}

function showAnnotationEditor(highlight, clientX, clientY, options = {}) {
  activeHighlightGroupId = highlight.groupId || getHighlightKey(highlight);
  let editor = document.querySelector("#annotationEditor");
  if (!editor) {
    editor = document.createElement("section");
    editor.id = "annotationEditor";
    editor.className = "annotation-editor translation-window";
    editor.innerHTML = `
      <header class="translation-window-header">
        <span>Annotation</span>
        <div class="annotation-header-actions">
          <button class="annotation-delete icon-button" type="button" aria-label="Delete annotation" title="Delete annotation">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M3 6h18"></path>
              <path d="M8 6V4h8v2"></path>
              <path d="M6 6l1 15h10l1-15"></path>
              <path d="M10 11v6"></path>
              <path d="M14 11v6"></path>
            </svg>
          </button>
          <button class="translation-close" type="button" aria-label="Close annotation editor">×</button>
        </div>
      </header>
      <div class="annotation-tabs" role="tablist" aria-label="Annotation fields">
        <button class="annotation-tab active" type="button" role="tab" aria-selected="true" data-annotation-tab="comment">Comment</button>
        <button class="annotation-tab" type="button" role="tab" aria-selected="false" data-annotation-tab="translation">Translation</button>
        <button class="annotation-mode-toggle" type="button" data-annotation-mode="edit" aria-label="Preview" title="Preview">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"></path>
            <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"></path>
          </svg>
        </button>
      </div>
      <div class="annotation-tab-panel active" data-annotation-panel="comment">
        <textarea class="translation-text annotation-comment" placeholder="Add or edit comment with Markdown..." spellcheck="false"></textarea>
        <div class="annotation-preview markdown-body" aria-label="Comment preview"></div>
      </div>
      <div class="annotation-tab-panel" data-annotation-panel="translation" hidden>
        <textarea class="translation-text annotation-translation" placeholder="Translation or notes with Markdown..." spellcheck="false"></textarea>
        <div class="annotation-preview markdown-body" aria-label="Translation preview"></div>
      </div>
      <div class="annotation-colors" aria-label="Highlight color"></div>
    `;
    getPdfFrameElement().appendChild(editor);
    initTranslationWindow(editor, hideAnnotationEditor);
    editor.querySelector(".annotation-comment").addEventListener("input", () => {
      renderAnnotationPreview(editor, "comment");
      scheduleAnnotationAutoSave();
    });
    editor.querySelector(".annotation-translation").addEventListener("input", () => {
      renderAnnotationPreview(editor, "translation");
      scheduleAnnotationAutoSave();
    });
    editor.querySelectorAll(".annotation-tab").forEach((button) => {
      button.addEventListener("click", () => setAnnotationTab(editor, button.dataset.annotationTab));
    });
    editor.querySelector(".annotation-mode-toggle").addEventListener("click", () => toggleAnnotationMode(editor));
    editor.querySelector(".annotation-delete").addEventListener("click", deleteActiveHighlight);
    const colorHost = editor.querySelector(".annotation-colors");
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

  const group = getHighlightGroup(activeHighlightGroupId);
  const comment = group.find((item) => item.comment)?.comment || "";
  const translation = group.find((item) => item.translation)?.translation || "";
  const color = group.find((item) => item.color)?.color || highlight.color || "yellow";
  editor.querySelector(".annotation-comment").value = comment;
  editor.querySelector(".annotation-translation").value = translation;
  renderAnnotationPreview(editor, "comment");
  renderAnnotationPreview(editor, "translation");
  setAnnotationTab(editor, comment || !translation ? "comment" : "translation");
  // Opening an existing comment defaults to preview; composing a fresh
  // comment (no content yet) starts in edit mode.
  const hasContent = Boolean(comment.trim() || translation.trim());
  const defaultMode = hasContent ? "preview" : "edit";
  setAnnotationMode(editor, options.mode === "preview" || options.mode === "edit" ? options.mode : defaultMode);
  editor.querySelectorAll(".color-swatch").forEach((button) => {
    button.classList.toggle("active", button.dataset.color === color);
  });

  const frameRect = getPdfFrameElement().getBoundingClientRect();
  const editorWidth = editor.offsetWidth || 360;
  const editorHeight = editor.offsetHeight || 360;
  const left = Math.max(12, Math.min(clientX - frameRect.left + 10, frameRect.width - editorWidth - 12));
  const top = Math.max(12, Math.min(clientY - frameRect.top + 10, frameRect.height - editorHeight - 12));
  editor.style.left = `${left}px`;
  editor.style.top = `${top}px`;
}

function setAnnotationTab(editor, tabName) {
  const target = tabName === "translation" ? "translation" : "comment";
  editor.querySelectorAll(".annotation-tab").forEach((button) => {
    const active = button.dataset.annotationTab === target;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  editor.querySelectorAll(".annotation-tab-panel").forEach((panel) => {
    const active = panel.dataset.annotationPanel === target;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
}

function renderAnnotationPreview(editor, field) {
  const textarea = editor.querySelector(field === "translation" ? ".annotation-translation" : ".annotation-comment");
  const panel = editor.querySelector(`[data-annotation-panel="${field}"]`);
  const preview = panel?.querySelector(".annotation-preview");
  if (!preview || !textarea) return;
  const value = textarea.value.trim();
  preview.innerHTML = value ? renderDiscussionMarkdown(value) : "<p>Markdown preview</p>";
  preview.classList.toggle("empty", !value);
}

function toggleAnnotationMode(editor) {
  const current = editor.querySelector(".annotation-mode-toggle")?.dataset.annotationMode || "edit";
  setAnnotationMode(editor, current === "preview" ? "edit" : "preview");
}

function setAnnotationMode(editor, mode) {
  const nextMode = mode === "preview" ? "preview" : "edit";
  editor.querySelectorAll(".annotation-tab-panel").forEach((panel) => {
    panel.classList.toggle("preview-mode", nextMode === "preview");
    panel.classList.toggle("edit-mode", nextMode === "edit");
  });
  const toggle = editor.querySelector(".annotation-mode-toggle");
  if (toggle) {
    const isPreview = nextMode === "preview";
    toggle.dataset.annotationMode = nextMode;
    toggle.setAttribute("aria-label", isPreview ? "Edit" : "Preview");
    toggle.title = isPreview ? "Edit" : "Preview";
    // Same icons as the notes preview/edit toggle: pencil in preview mode,
    // eye in edit mode.
    toggle.innerHTML = isPreview
      ? `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M12 20h9"></path>
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
        </svg>`
      : `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"></path>
          <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"></path>
        </svg>`;
  }
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
  const comment = editor?.querySelector(".annotation-comment")?.value.trim() || "";
  const translation = editor?.querySelector(".annotation-translation")?.value.trim() || "";
  const color = editor?.querySelector(".color-swatch.active")?.dataset.color || "yellow";
  const wasCommentAnnotation = getHighlightGroup(activeHighlightGroupId).some((item) => item.type === "comment");
  savedHighlights = savedHighlights.map((highlight) => {
    if (!isSameHighlightGroup(highlight, activeHighlightGroupId)) return highlight;
    const next = { ...highlight, color };
    if (comment) {
      next.comment = comment;
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
  });
  if (wasCommentAnnotation && !comment && !translation) {
    savedHighlights = savedHighlights.filter((highlight) => !isSameHighlightGroup(highlight, activeHighlightGroupId));
  }
  redrawHighlights();
  await saveCurrentPaper();
}

function deleteActiveHighlight() {
  if (!activeHighlightGroupId) return;
  savedHighlights = savedHighlights.filter((highlight) => !isSameHighlightGroup(highlight, activeHighlightGroupId));
  redrawHighlights();
  hideAnnotationEditor();
  saveCurrentPaper().catch((error) => console.error("Failed to delete annotation.", error));
}

function initTranslationWindow(bubble, closeHandler = hideTranslationBubble) {
  const header = bubble.querySelector(".translation-window-header");
  const closeButton = bubble.querySelector(".translation-close");
  closeButton.addEventListener("click", closeHandler);
  header.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) return;
    event.preventDefault();
    const rect = bubble.getBoundingClientRect();
    const frameRect = getPdfFrameElement().getBoundingClientRect();
    translationDragState = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      frameRect,
    };
    header.setPointerCapture(event.pointerId);
  });
  header.addEventListener("pointermove", (event) => {
    if (!translationDragState || translationDragState.pointerId !== event.pointerId) return;
    const frameRect = translationDragState.frameRect;
    const maxLeft = frameRect.width - bubble.offsetWidth - 8;
    const maxTop = frameRect.height - bubble.offsetHeight - 8;
    const left = clamp(event.clientX - frameRect.left - translationDragState.offsetX, 8, Math.max(8, maxLeft));
    const top = clamp(event.clientY - frameRect.top - translationDragState.offsetY, 8, Math.max(8, maxTop));
    bubble.style.left = `${left}px`;
    bubble.style.top = `${top}px`;
  });
  header.addEventListener("pointerup", finishTranslationDrag);
  header.addEventListener("pointercancel", finishTranslationDrag);
}

function finishTranslationDrag(event) {
  if (!translationDragState) return;
  event.currentTarget.releasePointerCapture?.(translationDragState.pointerId);
  translationDragState = null;
}

function hideTranslationBubble() {
  document.querySelector("#translationBubble")?.remove();
}

function hideAnnotationEditor() {
  window.clearTimeout(annotationAutoSaveTimer);
  saveAnnotationEdit().catch((error) => console.error("Failed to auto-save annotation.", error));
  document.querySelector("#annotationEditor")?.remove();
  activeHighlightGroupId = null;
}

function redrawHighlights() {
  pdfViewer.querySelectorAll(".pdf-highlight-layer").forEach((layer) => {
    layer.innerHTML = "";
  });
  restoreHighlights();
}

function restoreHighlights() {
  savedHighlights = normalizeHighlights(savedHighlights);
  savedHighlights.forEach((highlight) => {
    const pageNode = pdfViewer.querySelector(`.pdf-page[data-page-number="${highlight.pageNumber}"]`);
    if (pageNode) drawHighlight(pageNode, highlight);
  });
  refreshCommentsNavigation();
}

function restoreHighlightsForPage(pageNode) {
  if (!pageNode) return;
  const pageNumber = Number(pageNode.dataset.pageNumber) || 0;
  const layer = pageNode.querySelector(".pdf-highlight-layer");
  if (!pageNumber || !layer) return;
  layer.innerHTML = "";
  savedHighlights = normalizeHighlights(savedHighlights);
  savedHighlights.forEach((highlight) => {
    if (Number(highlight.pageNumber) === pageNumber) drawHighlight(pageNode, highlight);
  });
  refreshCommentsNavigation();
}

function buildCommentGroups() {
  const groups = [];
  const seen = new Set();
  for (const highlight of savedHighlights) {
    const groupId = highlight.groupId || getHighlightKey(highlight);
    if (seen.has(groupId)) continue;
    seen.add(groupId);
    const group = getHighlightGroup(groupId);
    groups.push({
      groupId,
      pageNumber: Number(highlight.pageNumber),
      comment: group.find((item) => item.comment)?.comment || "",
      translation: group.find((item) => item.translation)?.translation || "",
      text: group.find((item) => item.text)?.text || "",
      color: group[0]?.color || "yellow",
    });
  }
  groups.sort((a, b) => a.pageNumber - b.pageNumber || a.comment.localeCompare(b.comment));
  return groups;
}

function refreshCommentsNavigation() {
  const groups = buildCommentGroups();
  const filteredGroups = filterCommentGroupsByColor(groups);
  if (commentsNavIndex >= filteredGroups.length) commentsNavIndex = 0;
  document.querySelectorAll(".comments-nav-card").forEach((card) => {
    renderCommentsFilter(card, groups);
    renderCommentsNavCard(card, filteredGroups, groups.length);
  });
}

function filterCommentGroupsByColor(groups) {
  if (commentsColorFilter === "all") return groups;
  return groups.filter((entry) => entry.color === commentsColorFilter);
}

function renderCommentsFilter(card, groups) {
  let filter = card.querySelector(".comments-color-filter");
  if (!filter) {
    filter = document.createElement("div");
    filter.className = "comments-color-filter";
    const header = card.querySelector(".summary-group-header");
    if (header) header.after(filter);
    else card.prepend(filter);
  }
  filter.innerHTML = "";

  const options = [{ key: "all", label: "全部", count: groups.length }];
  Object.keys(commentSwatchColors).forEach((key) => {
    options.push({
      key,
      label: key,
      count: groups.filter((entry) => entry.color === key).length,
    });
  });

  options.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "comments-color-filter-button";
    button.classList.toggle("active", commentsColorFilter === option.key);
    button.disabled = option.key !== "all" && option.count === 0;
    button.setAttribute("aria-label", option.key === "all" ? "显示全部评论" : `按${option.label}高亮筛选评论`);
    button.title = option.key === "all" ? "全部" : option.label;

    if (option.key === "all") {
      button.textContent = `全部 ${option.count}`;
    } else {
      const swatch = document.createElement("span");
      swatch.className = "comments-color-filter-swatch";
      swatch.style.background = commentSwatchColors[option.key];
      const count = document.createElement("span");
      count.textContent = String(option.count);
      button.append(swatch, count);
    }

    button.addEventListener("click", () => {
      commentsColorFilter = option.key;
      commentsNavIndex = 0;
      refreshCommentsNavigation();
    });
    filter.appendChild(button);
  });
}

function renderCommentsNavCard(card, groups, totalCount = groups.length) {
  const list = card.querySelector(".comments-nav-list");
  list.innerHTML = "";
  if (!groups.length) {
    const empty = document.createElement("div");
    empty.className = "comments-nav-empty";
    empty.textContent = totalCount ? "暂无该颜色评论" : "暂无评论";
    list.appendChild(empty);
    return;
  }

  groups.forEach((entry, index) => {
    const item = document.createElement("div");
    item.className = "comments-nav-item";
    item.classList.toggle("current", index === commentsNavIndex);
    item.addEventListener("click", () => setCommentsNavIndex(index));

    const head = document.createElement("div");
    head.className = "comments-nav-head";

    const swatch = document.createElement("span");
    swatch.className = "comments-nav-swatch";
    swatch.style.background = commentSwatchColors[entry.color] || entry.color || commentSwatchColors.yellow;

    const page = document.createElement("span");
    page.className = "comments-nav-page";
    page.textContent = `第${entry.pageNumber}页`;

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "comments-nav-delete icon-button";
    deleteButton.title = "删除评论";
    deleteButton.setAttribute("aria-label", "删除评论");
    deleteButton.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M6 6l1 15h10l1-15"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg>';
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteCommentGroup(entry.groupId);
    });

    head.append(swatch, page, deleteButton);

    const body = document.createElement("span");
    body.className = "comments-nav-body";
    const rawText = entry.comment || entry.translation || entry.text || "纯高亮";
    const text = rawText.trim();
    body.textContent = text.length > 140 ? `${text.slice(0, 140)}…` : text;

    item.append(head, body);
    list.appendChild(item);
  });
}

async function deleteCommentGroup(groupId) {
  savedHighlights = savedHighlights.filter((highlight) => !isSameHighlightGroup(highlight, groupId));
  redrawHighlights();
  try {
    await saveCurrentPaper();
  } catch (error) {
    console.error("Failed to save after deleting comment.", error);
  }
}

function setCommentsNavIndex(index) {
  const groups = filterCommentGroupsByColor(buildCommentGroups());
  if (index < 0 || index >= groups.length) return;
  commentsNavIndex = index;
  refreshCommentsNavigation();
  jumpToComment(groups[index].groupId);
}

function jumpToComment(groupId) {
  jumpToCommentAsync(groupId).catch((error) => console.error("Failed to jump to comment.", error));
}

async function jumpToCommentAsync(groupId) {
  const group = getHighlightGroup(groupId);
  if (!group.length) return;
  const first = group[0];
  const pageNode = pdfViewer.querySelector(`.pdf-page[data-page-number="${first.pageNumber}"]`);
  if (!pageNode) return;
  pageNode.scrollIntoView({ block: "center", behavior: "smooth" });
  await renderPdfPageInto(Number(first.pageNumber), pageNode, currentPdfTask);
  const selector = `[data-group-id="${CSS.escape(groupId)}"]`;
  const target = pageNode.querySelector(selector);
  if (target) {
    target.classList.remove("pdf-highlight-flash");
    void target.offsetWidth;
    target.classList.add("pdf-highlight-flash");
  }
}

function normalizeHighlights(highlights) {
  const seen = new Set();
  return highlights.filter((highlight) => {
    if (!highlight || !Number.isFinite(Number(highlight.pageNumber))) return false;
    const normalized = {
      ...highlight,
      pageNumber: Number(highlight.pageNumber),
      left: Number(highlight.left),
      top: Number(highlight.top),
      width: Number(highlight.width),
      height: Number(highlight.height),
    };
    if (
      !Number.isFinite(normalized.left) ||
      !Number.isFinite(normalized.top) ||
      !Number.isFinite(normalized.width) ||
      !Number.isFinite(normalized.height) ||
      normalized.width <= 0 ||
      normalized.height <= 0
    ) {
      return false;
    }
    normalized.hash = normalized.hash || createHighlightHash(normalized);
    Object.assign(highlight, normalized);
    const key = normalized.hash;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function createHighlightHash(highlight) {
  const stable = {
    pageNumber: Number(highlight.pageNumber),
    left: Number(highlight.left).toFixed(5),
    top: Number(highlight.top).toFixed(5),
    width: Number(highlight.width).toFixed(5),
    height: Number(highlight.height).toFixed(5),
    color: highlight.color || "",
    comment: highlight.comment || "",
    translation: highlight.translation || "",
    groupId: highlight.groupId || "",
  };
  return simpleHash(JSON.stringify(stable));
}

function simpleHash(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `h${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function drawHighlight(pageNode, highlight) {
  const layer = pageNode.querySelector(".pdf-highlight-layer");
  if (!layer) return;
  const mark = document.createElement("span");
  mark.className = highlight.comment || highlight.translation ? "pdf-highlight pdf-highlight-comment" : "pdf-highlight";
  mark.dataset.groupId = highlight.groupId || getHighlightKey(highlight);
  const noteTitle = [highlight.comment, highlight.translation].filter(Boolean).join("\n\n");
  if (noteTitle) mark.title = noteTitle;
  mark.style.background = highlightColors[highlight.color] || highlight.color || highlightColors.yellow;
  mark.style.left = `${highlight.left * pageNode.offsetWidth}px`;
  mark.style.top = `${highlight.top * pageNode.offsetHeight}px`;
  mark.style.width = `${highlight.width * pageNode.offsetWidth}px`;
  mark.style.height = `${highlight.height * pageNode.offsetHeight}px`;
  layer.appendChild(mark);
}

function getActiveDiscussionReference() {
  if (!activeDiscussionId) return null;
  const thread = discussionThreads.find((item) => item.id === activeDiscussionId);
  return thread?.reference || null;
}

function clearDiscussionReferenceHighlights() {
  document.querySelectorAll(".pdf-reference-mark").forEach((node) => node.remove());
}

function openActiveDiscussionReference() {
  const reference = getActiveDiscussionReference();
  if (!reference) return;
  if (reference.page) jumpToPdfPage(Number(reference.page), "auto");
  retryApplyReferenceHighlight(14);
}

function retryApplyReferenceHighlight(remaining = 12) {
  if (!getActiveDiscussionReference()) return;
  refreshDiscussionReferenceHighlights();
  if (remaining > 0) {
    window.setTimeout(() => retryApplyReferenceHighlight(remaining - 1), 220);
  }
}

function refreshDiscussionReferenceHighlights() {
  clearDiscussionReferenceHighlights();
  const reference = getActiveDiscussionReference();
  if (!reference || !reference.text || !reference.page) return;
  document.querySelectorAll("[data-page-number]").forEach((pageNode) => {
    if (Number(pageNode.dataset.pageNumber) === Number(reference.page)) {
      applyReferenceHighlightToPage(pageNode, reference);
    }
  });
}

function maybeApplyDiscussionReferenceHighlight(pageNode, pageNumber) {
  const reference = getActiveDiscussionReference();
  if (!reference || !reference.text || Number(reference.page) !== Number(pageNumber)) return;
  applyReferenceHighlightToPage(pageNode, reference);
}

function applyReferenceHighlightToPage(pageNode, reference) {
  const layer = pageNode.querySelector(".pdf-highlight-layer");
  const range = findTextRangeInPage(pageNode, reference.text);
  if (!layer || !range) return;
  layer.querySelectorAll(".pdf-reference-mark").forEach((node) => node.remove());
  const pageRect = pageNode.getBoundingClientRect();
  if (!pageRect.width || !pageRect.height) {
    range.detach();
    return;
  }
  Array.from(range.getClientRects())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .forEach((rect) => {
      const mark = document.createElement("span");
      mark.className = "pdf-reference-mark";
      mark.style.left = `${((rect.left - pageRect.left) / pageRect.width) * 100}%`;
      mark.style.top = `${((rect.top - pageRect.top) / pageRect.height) * 100}%`;
      mark.style.width = `${(rect.width / pageRect.width) * 100}%`;
      mark.style.height = `${(rect.height / pageRect.height) * 100}%`;
      layer.appendChild(mark);
    });
  range.detach();
}

function findTextRangeInPage(pageNode, needle, ignoreCase = false) {
  const layer = pageNode.querySelector(".pdf-text-layer");
  const wanted = String(needle || "").trim().split(/\s+/).filter(Boolean);
  if (!layer || !wanted.length) return null;

  const normalize = (value) => (ignoreCase ? String(value).toLowerCase() : String(value));

  // Build a flat list of non-whitespace tokens with their source node/offsets.
  const tokens = [];
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const value = walker.currentNode.nodeValue || "";
    const pattern = /[^\s]+/g;
    let match;
    while ((match = pattern.exec(value))) {
      tokens.push({
        node: walker.currentNode,
        start: match.index,
        end: match.index + match[0].length,
        text: normalize(match[0]),
      });
    }
  }
  if (tokens.length < wanted.length) return null;

  // A wanted token matches a word when they are equal, or when the word simply
  // starts with it (searching an incomplete word still highlights the prefix).
  const matches = (tokenText, wantedToken) => {
    const want = normalize(wantedToken);
    return tokenText === want || tokenText.startsWith(want);
  };
  const endOffsetFor = (token, wantedToken) => {
    return matches(token.text, wantedToken) && token.text.length > wantedToken.length
      ? token.start + normalize(wantedToken).length
      : token.end;
  };

  for (let startIndex = 0; startIndex <= tokens.length - wanted.length; startIndex += 1) {
    let ok = true;
    for (let k = 0; k < wanted.length; k += 1) {
      if (!matches(tokens[startIndex + k].text, wanted[k])) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const first = tokens[startIndex];
    const last = tokens[startIndex + wanted.length - 1];
    const range = document.createRange();
    range.setStart(first.node, first.start);
    range.setEnd(last.node, endOffsetFor(last, wanted[wanted.length - 1]));
    return range;
  }

  // Fallback: tolerate extra words or line-split fragments in between — find the
  // wanted words in order and highlight from the first to the last found.
  for (let s = 0; s < tokens.length; s += 1) {
    if (!matches(tokens[s].text, wanted[0])) continue;
    let lastIndex = s;
    let matched = 1;
    for (let scan = s + 1; scan < tokens.length && matched < wanted.length; scan += 1) {
      if (matches(tokens[scan].text, wanted[matched])) {
        lastIndex = scan;
        matched += 1;
      }
    }
    if (matched === wanted.length) {
      const first = tokens[s];
      const last = tokens[lastIndex];
      const range = document.createRange();
      range.setStart(first.node, first.start);
      range.setEnd(last.node, endOffsetFor(last, wanted[wanted.length - 1]));
      return range;
    }
  }
  return null;
}

function getHighlightGroup(groupId) {
  return savedHighlights.filter((highlight) => isSameHighlightGroup(highlight, groupId));
}

function isSameHighlightGroup(highlight, groupId) {
  return (highlight.groupId || getHighlightKey(highlight)) === groupId;
}

function getHighlightKey(highlight) {
  return [
    highlight.pageNumber,
    Number(highlight.left).toFixed(5),
    Number(highlight.top).toFixed(5),
    Number(highlight.width).toFixed(5),
    Number(highlight.height).toFixed(5),
  ].join(":");
}

function createAnnotationId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `annotation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getPageNodeForRect(rect) {
  return Array.from(pdfViewer.querySelectorAll(".pdf-page")).find((pageNode) => {
    const pageRect = pageNode.getBoundingClientRect();
    return rect.top < pageRect.bottom && rect.bottom > pageRect.top;
  });
}

function getViewerScrollRatio() {
  const maxScrollTop = Math.max(pdfViewer.scrollHeight - pdfViewer.clientHeight, 1);
  const maxScrollLeft = Math.max(pdfViewer.scrollWidth - pdfViewer.clientWidth, 1);
  return {
    top: pdfViewer.scrollTop / maxScrollTop,
    left: pdfViewer.scrollLeft / maxScrollLeft,
  };
}

function setViewerScrollRatio(ratio) {
  const maxScrollTop = Math.max(pdfViewer.scrollHeight - pdfViewer.clientHeight, 0);
  const maxScrollLeft = Math.max(pdfViewer.scrollWidth - pdfViewer.clientWidth, 0);
  pdfViewer.scrollTop = maxScrollTop * ratio.top;
  pdfViewer.scrollLeft = maxScrollLeft * ratio.left;
  updatePageIndicator();
}

function getReadingPositionStorageKey(paperId = currentPaper?.id) {
  return paperId ? `${READING_POSITION_STORAGE_PREFIX}${paperId}` : "";
}

function scheduleSaveReadingPosition() {
  if (isPdfLoadingForReadingPosition || !currentPaper?.id || !currentPdfDocument) return;
  window.clearTimeout(readingPositionSaveTimer);
  readingPositionSaveTimer = window.setTimeout(saveReadingPositionNow, 350);
}

function saveReadingPositionNow() {
  if (isPdfLoadingForReadingPosition || !currentPaper?.id || !currentPdfDocument) return;
  const key = getReadingPositionStorageKey();
  if (!key) return;
  const anchor = getPdfViewportAnchor();
  const position = {
    pageNumber: anchor.pageNumber || currentVisiblePage || 1,
    ratioX: Number.isFinite(anchor.ratioX) ? anchor.ratioX : 0.5,
    ratioY: Number.isFinite(anchor.ratioY) ? anchor.ratioY : 0,
    scrollRatio: anchor.scrollRatio || getViewerScrollRatio(),
    zoom: pdfZoom,
    savedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(key, JSON.stringify(position));
  } catch (error) {
    console.warn("Failed to save reading position.", error);
  }
}

function restoreSavedReadingPosition() {
  const key = getReadingPositionStorageKey();
  if (!key) return false;

  let position = null;
  try {
    position = JSON.parse(localStorage.getItem(key) || "null");
  } catch (error) {
    console.warn("Failed to read saved reading position.", error);
  }
  if (!position || typeof position !== "object") return false;

  const pageNumber = Math.round(Number(position.pageNumber));
  if (!Number.isFinite(pageNumber) || pageNumber < 1 || pageNumber > currentPdfDocument.numPages) return false;

  const viewerRect = pdfViewer.getBoundingClientRect();
  const ratioX = Number(position.ratioX);
  const ratioY = Number(position.ratioY);
  const anchor = {
    pageNumber,
    ratioX: Number.isFinite(ratioX) ? clamp(ratioX, 0, 1) : 0.5,
    ratioY: Number.isFinite(ratioY) ? clamp(ratioY, 0, 1) : 0,
    clientX: viewerRect.left + viewerRect.width / 2,
    clientY: viewerRect.top + viewerRect.height * 0.42,
    scrollRatio: position.scrollRatio || { top: 0, left: 0 },
  };
  restorePdfViewportAnchor(anchor);
  return true;
}

function getPdfViewportAnchor(clientX, clientY) {
  const viewerRect = pdfViewer.getBoundingClientRect();
  const x = Number.isFinite(clientX) ? clientX : viewerRect.left + viewerRect.width / 2;
  const y = Number.isFinite(clientY) ? clientY : viewerRect.top + viewerRect.height * 0.42;
  const pages = Array.from(pdfViewer.querySelectorAll(".pdf-page"));
  let pageNode = pages.find((node) => {
    const rect = node.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  });

  if (!pageNode) {
    pageNode = pages.find((node) => {
      const rect = node.getBoundingClientRect();
      return y >= rect.top && y <= rect.bottom;
    });
  }

  if (!pageNode) {
    return {
      clientX: x,
      clientY: y,
      scrollRatio: getViewerScrollRatio(),
    };
  }

  const pageRect = pageNode.getBoundingClientRect();
  return {
    pageNumber: Number(pageNode.dataset.pageNumber) || 1,
    ratioX: clamp((x - pageRect.left) / Math.max(pageRect.width, 1), 0, 1),
    ratioY: clamp((y - pageRect.top) / Math.max(pageRect.height, 1), 0, 1),
    clientX: x,
    clientY: y,
    scrollRatio: getViewerScrollRatio(),
  };
}

function restorePdfViewportAnchor(anchor) {
  if (!anchor) return;
  if (!anchor.pageNumber) {
    setViewerScrollRatio(anchor.scrollRatio || { top: 0, left: 0 });
    return;
  }

  const pageNode = pdfViewer.querySelector(`.pdf-page[data-page-number="${anchor.pageNumber}"]`);
  if (!pageNode) {
    setViewerScrollRatio(anchor.scrollRatio || { top: 0, left: 0 });
    return;
  }

  const pageRect = pageNode.getBoundingClientRect();
  const targetX = pageRect.left + pageRect.width * anchor.ratioX;
  const targetY = pageRect.top + pageRect.height * anchor.ratioY;
  pdfViewer.scrollLeft += targetX - anchor.clientX;
  pdfViewer.scrollTop += targetY - anchor.clientY;
  updatePageIndicator();
}

function updatePageIndicator() {
  if (!currentPdfDocument) {
    setPageIndicator(0, 0);
    return;
  }

  const pages = Array.from(pdfViewer.querySelectorAll(".pdf-page"));
  if (!pages.length) {
    setPageIndicator(1, currentPdfDocument.numPages);
    return;
  }

  const viewerRect = pdfViewer.getBoundingClientRect();
  const anchorY = viewerRect.top + viewerRect.height * 0.42;
  let bestPage = Number(pages[0].dataset.pageNumber) || 1;
  let bestDistance = Infinity;

  pages.forEach((pageNode) => {
    const rect = pageNode.getBoundingClientRect();
    const pageCenter = rect.top + rect.height / 2;
    const distance = Math.abs(pageCenter - anchorY);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestPage = Number(pageNode.dataset.pageNumber) || bestPage;
    }
  });

  setPageIndicator(bestPage, currentPdfDocument.numPages);
}

function setPageIndicator(current, total) {
  currentVisiblePage = current;
  if (!total) {
    if (pageNumberInput) pageNumberInput.value = "0";
    if (pageTotalLabel) pageTotalLabel.textContent = "0";
    return;
  }
  if (pageNumberInput && document.activeElement !== pageNumberInput) {
    pageNumberInput.value = String(currentVisiblePage || 1);
  }
  if (pageTotalLabel) pageTotalLabel.textContent = String(total);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

async function readJsonResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  const text = await response.text();
  const detail = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  throw new Error(
    response.status === 404
      ? "\u63a5\u53e3\u672a\u627e\u5230\uff0c\u8bf7\u786e\u8ba4\u4f7f\u7528 python server.py \u542f\u52a8\u670d\u52a1\uff0c\u800c\u4e0d\u662f\u666e\u901a\u9759\u6001\u670d\u52a1\u5668\u3002"
      : detail || `\u670d\u52a1\u5668\u8fd4\u56de\u4e86\u975e JSON \u54cd\u5e94\uff1aHTTP ${response.status}`,
  );
}

async function apiFetch(path, options = {}) {
  const url = String(path);
  if (!url.startsWith("/")) {
    return fetch(url, options);
  }

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
  throw new Error(
    `${lastError?.message || "Failed to fetch"} Tried: ${tried.join(", ")}. Please start the Python server and open http://127.0.0.1:8000/ or http://localhost:8000/.`,
  );
}

function buildApiBaseCandidates() {
  const candidates = [];
  if (apiBaseUrl) candidates.push(apiBaseUrl);
  if (window.location.protocol === "http:" || window.location.protocol === "https:") {
    candidates.push(window.location.origin);
  }
  ["http://127.0.0.1:8000", "http://localhost:8000", "http://127.0.0.1:8010", "http://localhost:8010", "http://127.0.0.1:8765", "http://localhost:8765"].forEach((base) => {
    if (window.location.origin !== base) candidates.push(base);
  });
  return [...new Set(candidates)];
}

function renderSummary(summary) {
  if (!summary) {
    challenges.textContent = "Waiting";
    method.textContent = "Waiting";
    conclusion.textContent = "Waiting";
    keywords.innerHTML = "";
    methodSections.innerHTML = "";
    return;
  }

  challenges.textContent = summary.threeLineSummary?.challenges || "No response";
  method.textContent = summary.threeLineSummary?.method || "No response";
  conclusion.textContent = summary.threeLineSummary?.conclusion || "No response";
  keywords.innerHTML = "";
  methodSections.innerHTML = "";

  renderKeywords(summary.keywords || [], summary.keywordExplanations || {});

  renderMethodSections(summary.methodSections || [], {
    fallbackText: summary.threeLineSummary?.method || "",
    overview: summary.methodOverview || "",
    conclusion: summary.methodConclusion || summary.threeLineSummary?.conclusion || "",
  });
}

function renderKeywords(items, explanations = {}) {
  keywords.innerHTML = "";
  const normalized = Array.isArray(items) ? items : [];
  const normalizedExplanations = explanations && typeof explanations === "object" ? explanations : {};
  if (!normalized.length) {
    keywords.textContent = "No keywords returned.";
    return;
  }

  const fragment = document.createDocumentFragment();
  normalized.forEach((item) => {
    const node = document.createElement("span");
    node.className = "keyword-chip";
    const term = typeof item === "string" ? item : item.term || "Unnamed term";
    const explanation = findKeywordExplanation(term, normalizedExplanations);
    node.textContent = term;
    if (explanation) {
      node.dataset.keywordTerm = term;
      node.dataset.keywordExplanation = explanation;
      node.setAttribute("aria-label", `${term}: ${explanation}`);
      node.tabIndex = 0;
      node.addEventListener("mouseenter", (event) => showKeywordTooltip(node, event));
      node.addEventListener("mousemove", (event) => positionKeywordTooltip(event.clientX, event.clientY));
      node.addEventListener("mouseleave", hideKeywordTooltip);
      node.addEventListener("focus", () => showKeywordTooltip(node));
      node.addEventListener("blur", hideKeywordTooltip);
    }
    fragment.appendChild(node);
  });
  keywords.appendChild(fragment);
}

function showKeywordTooltip(node, event = null) {
  const term = String(node?.dataset.keywordTerm || node?.textContent || "").trim();
  const explanation = String(node?.dataset.keywordExplanation || "").trim();
  if (!term || !explanation) return;

  let tooltip = document.querySelector("#keywordTooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.id = "keywordTooltip";
    tooltip.className = "keyword-tooltip";
    tooltip.innerHTML = '<strong class="keyword-tooltip-title"></strong><div class="keyword-tooltip-body"></div>';
    document.body.appendChild(tooltip);
  }
  tooltip.querySelector(".keyword-tooltip-title").textContent = term;
  tooltip.querySelector(".keyword-tooltip-body").textContent = explanation;
  tooltip.classList.add("show");

  if (event) {
    positionKeywordTooltip(event.clientX, event.clientY);
    return;
  }
  const rect = node.getBoundingClientRect();
  positionKeywordTooltip(rect.left + rect.width / 2, rect.bottom);
}

function positionKeywordTooltip(clientX, clientY) {
  const tooltip = document.querySelector("#keywordTooltip");
  if (!tooltip?.classList.contains("show")) return;
  const gap = 12;
  const margin = 8;
  const rect = tooltip.getBoundingClientRect();
  const left = Math.min(Math.max(clientX - rect.width / 2, margin), window.innerWidth - rect.width - margin);
  let top = clientY + gap;
  if (top + rect.height > window.innerHeight - margin) top = Math.max(margin, clientY - rect.height - gap);
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function hideKeywordTooltip() {
  document.querySelector("#keywordTooltip")?.classList.remove("show");
}

function findKeywordExplanation(term, explanations) {
  const direct = String(explanations?.[term] || "").trim();
  if (direct) return direct;
  const normalizedTerm = normalizeKeywordKey(term);
  const matchKey = Object.keys(explanations || {}).find((key) => normalizeKeywordKey(key) === normalizedTerm);
  return matchKey ? String(explanations[matchKey] || "").trim() : "";
}

function normalizeKeywordKey(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function renderBasicInfo(info, paper = currentPaper) {
  const normalized = info && typeof info === "object" ? info : {};
  if (basicInfoTitle) basicInfoTitle.textContent = formatBasicInfoValue(paper?.title);
  basicInfoAuthors.textContent = formatBasicInfoValue(normalized.authors);
  basicInfoVenue.textContent = formatBasicInfoValue(normalized.venue);
  basicInfoDate.textContent = formatBasicInfoValue(normalized.publishedDate);
  basicInfoInstitutions.textContent = formatBasicInfoValue(normalized.institutions);
  if (basicInfoLocalPath) basicInfoLocalPath.textContent = formatBasicInfoValue(getPaperStoragePath(paper));
}

function renderBasicInfoLoading() {
  if (basicInfoTitle) basicInfoTitle.textContent = "Loading...";
  basicInfoAuthors.textContent = "Loading...";
  basicInfoVenue.textContent = "Loading...";
  basicInfoDate.textContent = "Loading...";
  basicInfoInstitutions.textContent = "Loading...";
  if (basicInfoLocalPath) basicInfoLocalPath.textContent = "Loading...";
}

function formatBasicInfoValue(value) {
  if (Array.isArray(value)) return value.length ? value.join("；") : "未识别";
  const text = String(value || "").trim();
  return text || "未识别";
}

function getPaperStoragePath(paper = currentPaper) {
  if (!paper) return "";
  const directPath = String(paper.localPath || paper.pdfPath || "").trim();
  if (directPath) return directPath;
  const folder = String(paper.folder || "").trim();
  if (folder) return folder.replace(/\//g, "\\");
  return paper.id ? `literature_library\\papers\\${paper.id}` : "";
}

function setBasicInfoStatus(message, isError = false) {
  if (!basicInfoStatus) return;
  basicInfoStatus.textContent = message;
  basicInfoStatus.classList.toggle("error", isError);
  basicInfoStatus.hidden = !message;
}

function initBasicInfoEditing() {
  [basicInfoTitle, basicInfoLocalPath].forEach((field) => {
    if (!field) return;
    field.setAttribute("aria-label", "点击复制");
    field.title = "点击复制";
    field.addEventListener("click", () => copyReadonlyBasicInfo(field));
    field.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      copyReadonlyBasicInfo(field);
    });
  });

  const fields = [
    { dd: basicInfoAuthors, key: "authors", isArray: true },
    { dd: basicInfoVenue, key: "venue", isArray: false },
    { dd: basicInfoDate, key: "publishedDate", isArray: false },
    { dd: basicInfoInstitutions, key: "institutions", isArray: true },
    { dd: basicInfoDoi, key: "doi", isArray: false, isDoi: true },
  ];

  fields.forEach((field) => {
    if (!field.dd) return;
    field.dd.contentEditable = "true";
    field.dd.spellcheck = false;
    field.dd.setAttribute("aria-label", "可编辑");
    field.dd.addEventListener("blur", async () => {
      const raw = String(field.dd.textContent || "").trim();
      const value = raw === "未识别" ? "" : raw;
      if (!currentPaper?.id) return;
      if (field.isArray) {
        currentPaper.basicInfo = currentPaper.basicInfo || {};
        currentPaper.basicInfo[field.key] = value
          .split(/[；;\n]+/)
          .map((item) => item.trim())
          .filter(Boolean);
      } else if (field.isDoi) {
        currentPaper.doi = value;
      } else {
        currentPaper.basicInfo = currentPaper.basicInfo || {};
        currentPaper.basicInfo[field.key] = value;
      }
      try {
        await saveCurrentPaper(field.isDoi ? { doi: currentPaper.doi } : { basicInfo: currentPaper.basicInfo });
        if (field.isDoi) renderDoi(currentPaper.doi);
        setBasicInfoStatus("");
      } catch (error) {
        console.error("Failed to save basic info edit.", error);
        renderBasicInfo(currentPaper.basicInfo);
        renderDoi(currentPaper.doi);
        setBasicInfoStatus(error.message || "基本信息保存失败。", true);
      }
    });
  });
}

async function copyReadonlyBasicInfo(field) {
  const value = String(field?.textContent || "").trim();
  if (!value || value === "未识别" || value === "Loading...") return;
  await copyCitationText(field, value);
}

function renderDoi(doi) {
  if (!basicInfoDoi) return;
  const normalizedDoi = normalizeDoiValue(doi);
  basicInfoDoi.textContent = normalizedDoi || "未识别";
  [copyDoiButton, openDoiButton].forEach((button) => {
    if (button) button.disabled = !normalizedDoi;
  });
}

function normalizeDoiValue(value) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .trim();
}

function getCurrentDoiValue() {
  const text = String(basicInfoDoi?.textContent || currentPaper?.doi || "").trim();
  return normalizeDoiValue(text === "未识别" ? "" : text);
}

function getDoiUrl(doi) {
  const normalizedDoi = normalizeDoiValue(doi);
  return normalizedDoi ? `https://doi.org/${encodeURIComponent(normalizedDoi).replace(/%2F/g, "/")}` : "";
}

async function copyCurrentDoi(button) {
  const doi = getCurrentDoiValue();
  if (!doi) return;
  await copyCitationText(button, doi);
}

function openCurrentDoi() {
  const url = getDoiUrl(getCurrentDoiValue());
  if (url) window.open(url, "_blank", "noopener,noreferrer");
}

function setCitationStatus(message, isError = false) {
  if (!citationStatus) return;
  citationStatus.textContent = message;
  citationStatus.classList.toggle("error", isError);
  citationStatus.hidden = !message;
}

function resetCitationSection() {
  citationCandidates = [];
  selectedCitationIndex = -1;
  citationSelectedCandidate = null;
  citationSearchSummaryVisible = false;
  closeCitationOverlay();
  if (citationStatus) {
    setCitationStatus("");
  }
  if (citationResults) {
    citationResults.hidden = true;
    citationResults.innerHTML = "";
  }
  if (generateCitationButton) {
    generateCitationButton.disabled = false;
  }
}

async function loadCurrentCitationInfo() {
  const title = currentPaper?.title || "";
  const basicInfo = currentPaper?.basicInfo || {};
  if (!title) {
    setCitationStatus("缺少论文标题，无法生成当前引用信息。", true);
    return;
  }

  citationCandidates = [createCurrentCitationCandidate(currentPaper)];
  selectedCitationIndex = -1;
  citationSearchSummaryVisible = false;
  setCitationStatus("");
  renderCitationCandidates(citationCandidates);
}

function createCurrentCitationCandidate(paper) {
  const basicInfo = paper?.basicInfo || {};
  const authors = (Array.isArray(basicInfo.authors) ? basicInfo.authors : [])
    .map(normalizeCitationAuthor)
    .filter(Boolean);
  const year = extractCitationYear(basicInfo.publishedDate);
  const candidate = {
    doi: String(paper?.doi || "").trim(),
    title: String(paper?.title || "").trim(),
    venue: String(basicInfo.venue || "").trim(),
    authors,
    authorNames: authors.map((author) => author.name).filter(Boolean),
    volume: "",
    issue: "",
    page: "",
    year,
    publisher: "",
    type: basicInfo.venue ? "proceedings-article" : "misc",
    url: paper?.doi ? `https://doi.org/${paper.doi}` : "",
    score: 10000,
    titleSimilarity: 1,
    authorSimilarity: authors.length ? 1 : 0,
    matchLabel: "当前信息",
    source: "local",
  };
  candidate.citations = formatCurrentCitations(candidate);
  return candidate;
}

function normalizeCitationAuthor(value) {
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

function extractCitationYear(value) {
  const match = String(value || "").match(/(?:19|20)\d{2}/);
  return match ? match[0] : "";
}

function formatCurrentCitations(candidate) {
  return {
    gbt7714: formatCurrentGbtCitation(candidate),
    bibtex: formatCurrentBibtexCitation(candidate),
    ris: formatCurrentRisCitation(candidate),
    apa: formatCurrentApaCitation(candidate),
    mla: formatCurrentMlaCitation(candidate),
    ieee: formatCurrentIeeeCitation(candidate),
  };
}

function formatCurrentGbtCitation(candidate) {
  const authors = candidate.authors.map((author) => {
    const initials = author.given ? author.given.split(/\s+/).map((part) => part[0]?.toUpperCase()).filter(Boolean).join(" ") : "";
    return [author.family, initials].filter(Boolean).join(" ") || author.name;
  });
  const authorPart = authors.length > 3 ? `${authors.slice(0, 3).join(", ")}, 等` : authors.join(", ");
  const marker = candidate.venue ? "[C]" : "[EB/OL]";
  const head = `${authorPart ? `${authorPart}. ` : ""}${candidate.title}${marker}.`;
  const tail = [candidate.venue, candidate.year].filter(Boolean).join(", ");
  const doiPart = candidate.doi ? ` https://doi.org/${candidate.doi}` : "";
  return `${head}${tail ? ` ${tail}.` : ""}${doiPart}`.trim();
}

function formatCurrentBibtexCitation(candidate) {
  const type = candidate.venue ? "inproceedings" : "misc";
  const key = makeCurrentBibtexKey(candidate);
  const lines = [`@${type}{${key},`];
  const authors = candidate.authors.map(formatCurrentBibtexAuthor).filter(Boolean).join(" and ");
  if (authors) lines.push(`  author = {${escapeBibtexValue(authors)}},`);
  if (candidate.title) lines.push(`  title = {${escapeBibtexValue(candidate.title)}},`);
  if (candidate.venue) lines.push(`  booktitle = {${escapeBibtexValue(candidate.venue)}},`);
  if (candidate.year) lines.push(`  year = {${candidate.year}},`);
  if (candidate.doi) lines.push(`  doi = {${candidate.doi}},`);
  lines.push("}");
  return lines.join("\n");
}

function formatCurrentRisCitation(candidate) {
  const lines = [`TY  - ${candidate.venue ? "CONF" : "GEN"}`];
  candidate.authors.forEach((author) => {
    const name = formatCurrentBibtexAuthor(author);
    if (name) lines.push(`AU  - ${name}`);
  });
  if (candidate.title) lines.push(`TI  - ${candidate.title}`);
  if (candidate.venue) lines.push(`JO  - ${candidate.venue}`);
  if (candidate.year) lines.push(`PY  - ${candidate.year}`);
  if (candidate.doi) lines.push(`DO  - ${candidate.doi}`);
  lines.push("ER  - ");
  return lines.join("\n");
}

function formatCurrentApaCitation(candidate) {
  const authors = candidate.authors.map(formatCurrentApaAuthor).filter(Boolean);
  const authorPart = joinCitationAuthors(authors, "&");
  const yearPart = candidate.year ? `(${candidate.year}).` : "";
  const source = candidate.venue ? ` ${candidate.venue}.` : "";
  const doiPart = candidate.doi ? ` https://doi.org/${candidate.doi}` : "";
  return [authorPart, yearPart, `${candidate.title}.${source}${doiPart}`].filter(Boolean).join(" ").trim();
}

function formatCurrentMlaCitation(candidate) {
  const authors = candidate.authors;
  let authorPart = "";
  if (authors.length === 1) authorPart = formatCurrentBibtexAuthor(authors[0]);
  if (authors.length === 2) authorPart = `${formatCurrentBibtexAuthor(authors[0])}, and ${authors[1].name}`;
  if (authors.length > 2) authorPart = `${formatCurrentBibtexAuthor(authors[0])}, et al.`;
  const parts = [authorPart, candidate.title ? `"${candidate.title}."` : "", candidate.venue, candidate.year].filter(Boolean);
  return `${parts.join(", ")}.`;
}

function formatCurrentIeeeCitation(candidate) {
  const authors = candidate.authors.map((author) => {
    const initials = author.given ? author.given.split(/\s+/).map((part) => `${part[0]?.toUpperCase()}.`).filter(Boolean).join(" ") : "";
    return [initials, author.family].filter(Boolean).join(" ") || author.name;
  });
  const authorPart = joinCitationAuthors(authors, "and");
  const parts = [authorPart, candidate.title ? `"${candidate.title},"` : "", candidate.venue, candidate.year].filter(Boolean);
  return `${parts.join(", ")}.`;
}

function joinCitationAuthors(authors, conjunction) {
  if (!authors.length) return "";
  if (authors.length === 1) return authors[0];
  if (authors.length === 2) return `${authors[0]} ${conjunction} ${authors[1]}`;
  return `${authors.slice(0, -1).join(", ")}, ${conjunction} ${authors[authors.length - 1]}`;
}

function formatCurrentBibtexAuthor(author) {
  return author.family && author.given ? `${author.family}, ${author.given}` : author.name || author.family || author.given;
}

function formatCurrentApaAuthor(author) {
  if (!author.family) return author.name || author.given;
  const initials = author.given ? author.given.split(/\s+/).map((part) => `${part[0]?.toUpperCase()}.`).filter(Boolean).join(" ") : "";
  return `${author.family}, ${initials}`.trim();
}

function makeCurrentBibtexKey(candidate) {
  const firstAuthor = candidate.authors[0]?.family || candidate.authors[0]?.name || "reference";
  const firstTitleWord = (candidate.title.match(/[A-Za-z0-9]+/) || [""])[0].toLowerCase();
  return `${firstAuthor}${candidate.year || ""}${firstTitleWord}`.replace(/[^A-Za-z0-9]/g, "") || "reference";
}

function escapeBibtexValue(value) {
  return String(value || "").replace(/[&%$#_{}]/g, (char) => `\\${char}`);
}

async function generateCitation() {
  const title = currentPaper?.title || "";
  const basicInfo = currentPaper?.basicInfo || {};
  const paperText = lastExtractedText.trim();

  if (!title && !paperText) {
    setCitationStatus("缺少论文标题或正文，无法查询引用信息。", true);
    return;
  }

  setBusy(true);
  generateCitationButton.disabled = true;
  generateCitationButton.classList.add("spinning");
  appliedCitationDoi = "";
  selectedCitationIndex = -1;
  citationSearchSummaryVisible = true;
  citationCandidates = [createCurrentCitationCandidate(currentPaper)];
  renderCitationSearching();

  try {
    const response = await apiFetch("/api/citation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paperId: currentPaper?.id || "",
        title,
        authors: basicInfo.authors || [],
        institutions: basicInfo.institutions || [],
        venue: basicInfo.venue || "",
        publishedDate: basicInfo.publishedDate || "",
        doi: currentPaper?.doi || "",
        paperText,
      }),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.error || data.detail || "引用信息查询失败。");

    if (data.doi) {
      currentPaper.doi = data.doi;
      renderDoi(data.doi);
    }
    citationCandidates = Array.isArray(data.candidates) ? data.candidates : [];
    if (!citationCandidates.length) {
      setCitationStatus("未在 Crossref 中找到匹配的论文信息。", true);
      return;
    }
    setCitationStatus("");
    renderCitationCandidates(citationCandidates, { showSearchSummary: true });
  } catch (error) {
    console.error(error);
    setCitationStatus(error.message || "引用信息查询失败。", true);
  } finally {
    generateCitationButton.classList.remove("spinning");
    setBusy(false);
    generateCitationButton.disabled = false;
  }
}

function renderCitationSearching() {
  citationResults.hidden = false;
  citationResults.innerHTML = "";
  setCitationStatus("");
  const localCandidate = citationCandidates.find((candidate) => candidate.source === "local");
  if (localCandidate) {
    citationResults.appendChild(createCitationCandidate(localCandidate, citationCandidates.indexOf(localCandidate), { isCurrent: true }));
  }
  const searching = document.createElement("p");
  searching.className = "citation-searching";
  searching.textContent = "正在通过 Crossref 检索引用信息...";
  citationResults.appendChild(searching);
}

function renderCitationCandidates(candidates, options = {}) {
  const { showSearchSummary = false } = options;
  citationResults.hidden = false;
  citationResults.innerHTML = "";

  const localIndex = candidates.findIndex((candidate) => candidate.source === "local");
  const currentIndex = localIndex >= 0 ? localIndex : 0;
  const currentCandidate = candidates[currentIndex];
  const remoteEntries = candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter((entry) => entry.index !== currentIndex);

  if (currentCandidate) {
    citationResults.appendChild(createCitationCandidate(currentCandidate, currentIndex, { isCurrent: true }));
  }

  if (showSearchSummary) {
    const label = document.createElement("p");
    label.className = "citation-results-label";
    label.textContent = `共找到 ${remoteEntries.length} 条候选，点击选择：`;
    citationResults.appendChild(label);
  }

  const list = document.createElement("div");
  list.className = "citation-candidate-list";
  citationResults.appendChild(list);

  let isExpanded = false;

  function renderList() {
    const visible = isExpanded ? remoteEntries : remoteEntries.slice(0, 5);
    list.innerHTML = "";
    visible.forEach((entry) => {
      list.appendChild(createCitationCandidate(entry.candidate, entry.index));
    });
    renderExpandToggle();
  }

  function renderExpandToggle() {
    citationResults.querySelector(".citation-expand-button")?.remove();
    if (remoteEntries.length <= 5) return;
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "citation-expand-button";
    toggle.textContent = isExpanded ? "收起" : `展开全部 (${remoteEntries.length - 5})`;
    toggle.addEventListener("click", () => {
      isExpanded = !isExpanded;
      renderList();
    });
    citationResults.appendChild(toggle);
  }

  renderList();
}

function createCitationCandidate(candidate, index, options = {}) {
  const { isCurrent = false } = options;
  const row = document.createElement("div");
  row.className = "citation-candidate-row";
  row.classList.toggle("citation-current-row", isCurrent);

  const item = document.createElement("button");
  item.type = "button";
  item.className = "citation-candidate";
  item.classList.toggle("citation-current-candidate", isCurrent);
  item.dataset.index = String(index);
  item.classList.toggle("selected", index === selectedCitationIndex);
  item.addEventListener("click", () => selectCitationCandidate(index));

  if (isCurrent) {
    const badge = document.createElement("span");
    badge.className = "citation-current-badge";
    badge.textContent = "当前信息";
    item.appendChild(badge);
  }

  const titleNode = document.createElement("div");
  titleNode.className = "citation-candidate-title";
  titleNode.textContent = candidate.title || "(无题名)";

  const meta = document.createElement("div");
  meta.className = "citation-candidate-meta";
  const authors = Array.isArray(candidate.authors) ? candidate.authors : [];
  const authorText = authors
    .slice(0, 3)
    .map((author) => author.name || author.family || author.given)
    .filter(Boolean)
    .join("；");
  const metaParts = [authorText, candidate.venue, candidate.year].filter(Boolean);
  meta.textContent = metaParts.join(" · ");

  const doiNode = document.createElement("div");
  doiNode.className = "citation-candidate-doi";
  doiNode.textContent = candidate.doi ? `DOI: ${candidate.doi}` : (isCurrent ? "" : candidate.matchLabel || "");

  item.append(titleNode, meta, doiNode);

  const applyButton = document.createElement("button");
  applyButton.type = "button";
  applyButton.className = "citation-apply-button";
  applyButton.title = "更新引用信息";
  applyButton.setAttribute("aria-label", "更新引用信息");
  applyButton.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><path d="m9 11 3 3L22 4"></path></svg>';
  applyButton.addEventListener("click", () => applyCandidateBasicInfo(candidate));
  applyButton.hidden = candidate.source === "local";
  applyButton.classList.toggle("citation-apply-applied", Boolean(candidate.doi) && candidate.doi === appliedCitationDoi);

  row.append(item, applyButton);
  return row;
}

function selectCitationCandidate(index) {
  if (index < 0 || index >= citationCandidates.length) return;
  selectedCitationIndex = index;

  citationResults.querySelectorAll(".citation-candidate").forEach((item) => {
    item.classList.toggle("selected", Number(item.dataset.index) === index);
  });

  openCitationOverlay(citationCandidates[index]);
}

function openCitationOverlay(candidate) {
  citationSelectedCandidate = candidate;
  citationOverlayTitle.textContent = candidate.title || "引用信息";
  citationOverlayMeta.textContent = buildCitationMetaText(candidate);
  citationFormatSelect.value = citationFormat;
  updateCitationOutput(candidate);
  citationOverlay.hidden = false;
}

function closeCitationOverlay() {
  citationOverlay.hidden = true;
}

function buildCitationMetaText(candidate) {
  const authors = Array.isArray(candidate.authors) ? candidate.authors : [];
  const authorText = authors
    .map((author) => author.name || author.family || author.given)
    .filter(Boolean)
    .join("；");
  const parts = [authorText, candidate.venue, candidate.year].filter(Boolean);
  return parts.join(" · ") || candidate.doi || "";
}

function updateCitationOutput(candidate) {
  const citations = candidate.citations || {};
  citationOutput.value = citations[citationFormat] || "";
}

function initCitationOverlay() {
  citationOverlayCloseButton?.addEventListener("click", closeCitationOverlay);
  citationOverlay?.addEventListener("pointerdown", (event) => {
    if (event.target === citationOverlay) closeCitationOverlay();
  });
  citationFormatSelect?.addEventListener("change", () => {
    citationFormat = citationFormatSelect.value;
    if (citationSelectedCandidate) updateCitationOutput(citationSelectedCandidate);
  });
  citationCopyButton?.addEventListener("click", () => {
    copyCitationText(citationCopyButton, citationOutput.value);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && citationOverlay && !citationOverlay.hidden) {
      closeCitationOverlay();
    }
  });
}

async function copyCitationText(button, text) {
  if (!text) return;
  const previousTitle = button.title || "";
  const previousLabel = button.getAttribute("aria-label") || previousTitle;
  try {
    await copyTextToClipboard(text);
    button.classList.add("copied");
    button.title = "已复制";
    button.setAttribute("aria-label", "已复制");
    showCopiedFeedback(button);
    window.setTimeout(() => {
      if (!document.body.contains(button)) return;
      button.classList.remove("copied");
      button.title = previousTitle;
      if (previousLabel) button.setAttribute("aria-label", previousLabel);
    }, 1200);
  } catch (error) {
    console.error("Failed to copy citation.", error);
  }
}

async function applyCandidateBasicInfo(candidate) {
  if (!currentPaper?.id || !candidate || candidate.source === "local") return;
  setBusy(true);
  try {
    const response = await apiFetch("/api/citation/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paperId: currentPaper.id, candidate }),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.error || data.detail || "更新引用信息失败。");

    currentPaper = data.paper || currentPaper;
    renderBasicInfo(currentPaper.basicInfo);
    renderDoi(currentPaper.doi);
    appliedCitationDoi = String(candidate.doi || "");
    const remoteCandidates = citationCandidates.filter((item) => item.source !== "local");
    citationCandidates = [createCurrentCitationCandidate(currentPaper), ...remoteCandidates];
    renderCitationCandidates(citationCandidates, { showSearchSummary: citationSearchSummaryVisible });
    setCitationStatus("已更新引用信息。");
  } catch (error) {
    console.error(error);
    setCitationStatus(error.message || "更新引用信息失败。", true);
  } finally {
    setBusy(false);
  }
}

function renderSummaryLoading(message = "Loading...") {
  renderKeywordsLoading(message);

  challenges.textContent = "Loading...";
  method.textContent = "Loading...";
  conclusion.textContent = "Loading...";

  renderMethodLoading(message);
}

function renderKeywordsLoading(message = "Loading...") {
  keywords.innerHTML = "";
  const keywordLoading = document.createElement("div");
  keywordLoading.className = "summary-loading";
  keywordLoading.textContent = message;
  keywords.appendChild(keywordLoading);
}

function renderMethodLoading(message = "Loading...") {
  methodSections.innerHTML = "";
  const methodLoading = document.createElement("div");
  methodLoading.className = "summary-loading summary-loading-large";
  methodLoading.textContent = message;
  methodSections.appendChild(methodLoading);
}

function renderMethodSections(sections, options = {}) {
  methodSections.innerHTML = "";
  const fallbackText = typeof options === "string" ? options : options.fallbackText || "";
  const overviewText = typeof options === "object" ? options.overview || "" : "";
  const conclusionText = typeof options === "object" ? options.conclusion || "" : "";

  if ((!Array.isArray(sections) || !sections.length) && fallbackText) {
    sections = splitMethodFallback(fallbackText);
  }

  if (!Array.isArray(sections) || !sections.length) {
    methodSections.textContent = "No structured method sections returned.";
    return;
  }

  const fragment = document.createDocumentFragment();
  const overview = createMethodBoundary("概括", overviewText || fallbackText);
  if (overview) fragment.appendChild(overview);

  sections.forEach((section, index) => {
    const article = document.createElement("article");
    article.className = "method-section";

    const header = document.createElement("div");
    header.className = "method-section-header";

    const indexNode = document.createElement("span");
    indexNode.className = "method-index";
    indexNode.textContent = String(index + 1).padStart(2, "0");

    const title = document.createElement("h4");
    title.textContent = section.title || `Method point ${index + 1}`;

    header.append(indexNode, title);
    article.appendChild(header);

    if (section.motivation) {
      const motivationNode = document.createElement("p");
      motivationNode.className = "method-motivation";
      motivationNode.append(document.createTextNode("动机："), ...formatInlineTechnicalText(section.motivation));
      article.appendChild(motivationNode);
    }

    const content = String(section.content || "").trim();
    if (content) {
      const contentNode = document.createElement("div");
      contentNode.className = "method-content";
      appendMethodProse(contentNode, content);
      article.appendChild(contentNode);
    } else {
      // Legacy structured summaries (bullets + separate formula list).
      if (section.summary) {
        const summaryNode = document.createElement("p");
        summaryNode.className = "method-summary";
        summaryNode.append(...formatInlineTechnicalText(section.summary));
        article.appendChild(summaryNode);
      }

      const bullets = Array.isArray(section.bullets) ? section.bullets : [];
      if (bullets.length) {
        const list = document.createElement("ul");
        list.className = "method-bullets";
        bullets.forEach((bullet) => {
          const item = document.createElement("li");
          item.append(...formatInlineTechnicalText(String(bullet)));
          list.appendChild(item);
        });
        article.appendChild(list);
      }

      const formulas = Array.isArray(section.formulas) ? section.formulas : [];
      if (formulas.length) {
        const formulaBox = document.createElement("div");
        formulaBox.className = "formula-list";
        formulas.forEach((formula) => {
          formulaBox.appendChild(createFormulaExplanationBlock(formula));
        });
        article.appendChild(formulaBox);
      }
    }

    fragment.appendChild(article);
  });

  const conclusion = createMethodBoundary("总结", conclusionText);
  if (conclusion) fragment.appendChild(conclusion);
  methodSections.appendChild(fragment);
}

function createMethodBoundary(label, text) {
  const content = String(text || "").trim();
  if (!content) return null;

  const section = document.createElement("section");
  section.className = "method-boundary";

  const title = document.createElement("h4");
  title.textContent = label;

  const body = document.createElement("p");
  body.append(...formatInlineTechnicalText(content));

  section.append(title, body);
  return section;
}

function splitMethodFallback(text) {
  const chunks = text
    .replace(/(首先|其次|进一步|在训练|在推理|最后|实验中)/g, "\n$1")
    .split(/\n+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  if (chunks.length <= 1) {
    return [
      {
        title: "Core method overview",
        content: text,
      },
    ];
  }

  return chunks.slice(0, 5).map((chunk, index) => ({
    title: `Method point ${index + 1}`,
    content: chunk,
  }));
}

function appendMethodProse(parent, content) {
  splitProseDisplayMath(content).forEach((part) => {
    if (part.type === "formula") {
      const node = document.createElement("div");
      node.className = "formula-display";
      renderFormula(node, part.value, true);
      parent.appendChild(node);
      return;
    }
    String(part.value)
      .split(/\n\s*\n/)
      .forEach((paragraph) => {
        const text = paragraph.replace(/[ \t]*\n[ \t]*/g, " ").trim();
        if (!text) return;
        const node = document.createElement("p");
        node.append(...formatInlineTechnicalText(text));
        parent.appendChild(node);
      });
  });
}

function splitProseDisplayMath(content) {
  const text = String(content || "");
  const parts = [];
  let buffer = "";
  let cursor = 0;
  let afterFormula = false;
  // Block math ($$...$$) always splits out. A single-dollar span longer than
  // the inline-math limit (180) that is clearly math is also treated as a
  // block formula, so an over-long inline formula does not end up as raw
  // $...$ text.
  const pattern = /\$\$(.+?)\$\$|\$([^$\n]{181,}?)\$/gs;
  let match;
  while ((match = pattern.exec(text))) {
    const blockFormula = match[1] !== undefined;
    const inner = (blockFormula ? match[1] : match[2]).trim();
    if (!blockFormula && !looksLikeMathExpression(inner)) {
      // Long prose between two stray dollars — keep it in the text stream.
      buffer += text.slice(cursor, match.index) + "$" + inner + "$";
      cursor = match.index + match[0].length;
      continue;
    }
    buffer += text.slice(cursor, match.index);
    const before = (afterFormula ? stripFormulaExplanationPreamble(buffer) : buffer.trim());
    if (before) parts.push({ type: "text", value: before });
    parts.push({ type: "formula", value: inner });
    buffer = "";
    cursor = match.index + match[0].length;
    afterFormula = true;
  }
  if (cursor < text.length) buffer += text.slice(cursor);
  const rest = afterFormula ? stripFormulaExplanationPreamble(buffer) : buffer.trim();
  if (rest) parts.push({ type: "text", value: rest });
  return parts;
}

function looksLikeMathExpression(value) {
  return /\\(?:[a-zA-Z]+|\{|\})|\^|_\{/.test(String(value || ""));
}

// "$$...$$：其中 x 表示..." — when text right after a block formula starts with a
// separator or "其中/where", drop that preamble so it reads as a following sentence.
function stripFormulaExplanationPreamble(value) {
  return String(value || "")
    .replace(/^[：:，,；;、\s]+/, "")
    .replace(/^(?:其中|where|with|in which)\s*/i, "")
    .trim();
}

function createFormulaExplanationBlock(value) {
  const parsed = splitFormulaAndExplanation(value);
  const block = document.createElement("div");
  block.className = "formula-explanation";

  if (parsed.intro) {
    const introNode = document.createElement("div");
    introNode.className = "formula-explanation-text";
    introNode.append(...formatInlineTechnicalText(parsed.intro));
    block.appendChild(introNode);
  }

  const formulaNode = document.createElement("div");
  formulaNode.className = "formula-display";
  if (isFormulaRenderCandidate(parsed.formula) && !isInlineMathProse(parsed.formula)) {
    renderFormula(formulaNode, parsed.formula, true);
  } else {
    formulaNode.className = "formula-explanation-text";
    formulaNode.append(...formatInlineTechnicalText(parsed.formula));
  }
  block.appendChild(formulaNode);

  if (parsed.explanation) {
    const explanationNode = document.createElement("div");
    explanationNode.className = "formula-explanation-text";
    explanationNode.append(...formatInlineTechnicalText(parsed.explanation));
    block.appendChild(explanationNode);
  }

  return block;
}

function splitFormulaAndExplanation(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return { intro: "", formula: "", explanation: "" };

  const embeddedDisplayFormula = splitEmbeddedDisplayFormula(text);
  if (embeddedDisplayFormula) return embeddedDisplayFormula;

  const explicitFormula = splitExplicitFormulaAndExplanation(text);
  if (explicitFormula) return explicitFormula;

  const patterns = [
    /\s*(?:，|,|；|;)\s*(?:其中|where|with|in which)\s*/i,
    /\s*(?:：|:)\s*(?:其中|where|with|in which)\s*/i,
    /\s+(?:where|with|in which)\s+/i,
    /\s*(?:——|--|–|—)\s*/,
  ];
  for (const pattern of patterns) {
    const parsed = splitFormulaTextAtPattern(text, pattern);
    if (parsed) return parsed;
  }

  const generalSeparator = findFormulaExplanationSeparator(text);
  if (generalSeparator > 0) {
    return {
      intro: "",
      formula: text.slice(0, generalSeparator).trim(),
      explanation: text.slice(generalSeparator + 1).trim(),
    };
  }

  return { intro: "", formula: text, explanation: "" };
}

function splitEmbeddedDisplayFormula(text) {
  const dollarStart = text.indexOf("$$");
  const bracketStart = text.indexOf("\\[");
  const candidates = [dollarStart, bracketStart].filter((index) => index >= 0).sort((a, b) => a - b);
  const start = candidates[0];
  if (start === undefined) return null;

  const isDollar = text.startsWith("$$", start);
  const close = isDollar ? "$$" : "\\]";
  const formulaStart = start + (isDollar ? 2 : 2);
  const end = text.indexOf(close, formulaStart);
  if (end < 0) return null;

  const intro = text.slice(0, start).trim();
  const formula = text.slice(start, end + close.length).trim();
  const explanation = stripFormulaExplanationPrefix(text.slice(end + close.length).trim());
  return { intro, formula, explanation };
}

function splitExplicitFormulaAndExplanation(text) {
  const formulaEnd = findLeadingFormulaEnd(text);
  if (formulaEnd <= 0) return null;
  return {
    intro: "",
    formula: text.slice(0, formulaEnd).trim(),
    explanation: stripFormulaExplanationPrefix(text.slice(formulaEnd).trim()),
  };
}

function findLeadingFormulaEnd(text) {
  if (text.startsWith("$$")) {
    const end = text.indexOf("$$", 2);
    return end > 1 ? end + 2 : -1;
  }
  if (text.startsWith("\\[")) {
    const end = text.indexOf("\\]", 2);
    return end > 1 ? end + 2 : -1;
  }
  if (text.startsWith("$")) {
    const end = findUnescapedDollar(text, 1);
    return end > 0 ? end + 1 : -1;
  }
  if (text.startsWith("\\(")) {
    const end = text.indexOf("\\)", 2);
    return end > 1 ? end + 2 : -1;
  }
  return -1;
}

function findUnescapedDollar(text, startIndex) {
  for (let index = startIndex; index < text.length; index += 1) {
    if (text[index] === "$" && text[index - 1] !== "\\") return index;
  }
  return -1;
}

function stripFormulaExplanationPrefix(value) {
  return String(value || "")
    .replace(/^\s*(?:：|:|；|;|，|,|——|--|–|—)\s*/u, "")
    .replace(/^(?:其中|where|with|in which)\s*/i, "")
    .trim();
}

function splitFormulaTextAtPattern(text, pattern) {
  const match = text.match(pattern);
  if (!match || match.index <= 0) return null;
  return {
    intro: "",
    formula: text.slice(0, match.index).trim(),
    explanation: text.slice(match.index + match[0].length).trim(),
  };
}

function findFormulaExplanationSeparator(text) {
  const separators = ["：", ":", "；", ";", "，", ","];
  for (const separator of separators) {
    let index = text.indexOf(separator);
    while (index >= 0) {
      const before = text.slice(0, index).trim();
      const after = text.slice(index + separator.length).trim();
      if (before.length >= 3 && after.length >= 3 && looksLikeStandaloneFormula(before) && looksLikeExplanation(after)) {
        return index;
      }
      index = text.indexOf(separator, index + separator.length);
    }
  }
  return -1;
}

function looksLikeStandaloneFormula(value) {
  return /=|\\frac|\\sum|\\min|\\max|[_^]|\([^)]+\)|\{[^}]+\}/.test(value);
}

function looksLikeExplanation(value) {
  return /^(?:[\u4e00-\u9fff]|where\b|denote\b|means\b|represents\b|is the\b|为|表示)/i.test(value.trim());
}

function formatInlineTechnicalText(text) {
  const source = normalizeInlineMathText(text);
  const tokens = tokenizeInlineMath(source);
  if (!tokens.some((token) => token.type === "math")) {
    return renderInlineMarkdownNodes(source);
  }

  return tokens.flatMap((token) => {
    if (token.type === "math") return [createInlineFormulaNode(token.value, token.raw)];
    return renderInlineMarkdownNodes(token.value);
  });
}

function normalizeInlineMathText(text) {
  return String(text || "")
    .replace(/\\\$/g, "$")
    .replace(/＄/g, "$")
    .replace(/\\\(/g, "\\(")
    .replace(/\\\)/g, "\\)");
}

function tokenizeInlineMath(source) {
  const tokens = [];
  let cursor = 0;

  while (cursor < source.length) {
    const dollarIndex = findNextInlineMathDelimiter(source, cursor);
    const bracketIndex = source.indexOf("\\(", cursor);
    const nextIndex = [dollarIndex, bracketIndex].filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? -1;
    if (nextIndex < 0) break;

    const parsed = source.startsWith("\\(", nextIndex)
      ? readBracketInlineMath(source, nextIndex)
      : readDollarInlineMath(source, nextIndex);
    if (!parsed) {
      tokens.push({ type: "text", value: source.slice(cursor, nextIndex + 1) });
      cursor = nextIndex + 1;
      continue;
    }

    if (nextIndex > cursor) tokens.push({ type: "text", value: source.slice(cursor, nextIndex) });
    tokens.push({ type: "math", value: parsed.value, raw: parsed.raw });
    cursor = parsed.end;
  }

  if (cursor < source.length) tokens.push({ type: "text", value: source.slice(cursor) });
  return tokens;
}

function findNextInlineMathDelimiter(source, startIndex) {
  for (let index = startIndex; index < source.length; index += 1) {
    if (source[index] !== "$" || isEscaped(source, index)) continue;
    if (source[index + 1] === "$" || source[index - 1] === "$") continue;
    return index;
  }
  return -1;
}

function readDollarInlineMath(source, startIndex) {
  const endIndex = findClosingDollar(source, startIndex + 1);
  if (endIndex < 0) return null;
  const value = source.slice(startIndex + 1, endIndex).trim();
  if (!isValidInlineFormulaContent(value)) return null;
  return {
    value,
    raw: source.slice(startIndex, endIndex + 1),
    end: endIndex + 1,
  };
}

function readBracketInlineMath(source, startIndex) {
  const endIndex = source.indexOf("\\)", startIndex + 2);
  if (endIndex < 0) return null;
  const value = source.slice(startIndex + 2, endIndex).trim();
  if (!isValidInlineFormulaContent(value)) return null;
  return {
    value,
    raw: source.slice(startIndex, endIndex + 2),
    end: endIndex + 2,
  };
}

function findClosingDollar(source, startIndex) {
  for (let index = startIndex; index < source.length; index += 1) {
    if (source[index] !== "$" || isEscaped(source, index)) continue;
    if (source[index + 1] === "$" || source[index - 1] === "$") continue;
    return index;
  }
  return -1;
}

function isEscaped(source, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function isValidInlineFormulaContent(value) {
  if (!value || /\n/.test(value)) return false;
  if (value.length > 180) return false;
  return /[A-Za-z0-9\\_^{}=+\-*/()[\]|.,<>α-ωΑ-Ω]/.test(value);
}

function createInlineFormulaNode(value, raw) {
  const node = document.createElement("span");
  node.className = "formula-inline";
  if (!window.katex) {
    node.textContent = raw || value;
    return node;
  }

  renderFormula(node, value, false);
  return node;
}

function renderInlineMarkdownNodes(source) {
  const renderer = getDiscussionMarkdownRenderer();
  if (!renderer) return [document.createTextNode(source)];

  const template = document.createElement("template");
  template.innerHTML = renderer.renderInline(escapeMarkdownMathDelimiters(source));
  return Array.from(template.content.childNodes);
}

function escapeMarkdownMathDelimiters(source) {
  return String(source || "").replace(/\$/g, "\\$").replace(/\\\(/g, "\\\\(").replace(/\\\)/g, "\\\\)");
}

function normalizeFormulaSource(value) {
  const formula = String(value || "")
    .replace(/^\s*(?:\$\$|\$|\\\[|\\\()/, "")
    .replace(/(?:\$\$|\$|\\\]|\\\))\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return fixFormulaSubscripts(formula);
}

function isFormulaRenderCandidate(value) {
  const text = String(value || "").trim();
  return isExplicitFormulaSource(text) || looksLikeStandaloneFormula(text);
}

function isInlineMathProse(value) {
  const text = String(value || "").trim();
  if (!/(^|[^$])\$[^$\n]+\$/.test(text) && !/\\\([^)]*\\\)/.test(text)) return false;
  const withoutMath = text
    .replace(/\$[^$\n]+\$/g, "")
    .replace(/\\\([^)]*\\\)/g, "")
    .trim();
  return /[\u4e00-\u9fff]/.test(withoutMath) || /\b[a-z]{4,}\b/i.test(withoutMath);
}

function isExplicitFormulaSource(value) {
  const text = String(value || "").trim();
  return (
    (text.startsWith("$$") && text.endsWith("$$")) ||
    (text.startsWith("$") && text.endsWith("$")) ||
    (text.startsWith("\\[") && text.endsWith("\\]")) ||
    (text.startsWith("\\(") && text.endsWith("\\)"))
  );
}

function fixFormulaSubscripts(value) {
  return String(value || "").replace(/(^|[^\\])_([A-Za-z][A-Za-z0-9]{1,})(?![A-Za-z0-9]*\})/g, "$1_{$2}");
}

function renderFormula(node, source, displayMode = false) {
  const formula = normalizeFormulaSource(source);
  if (!formula) {
    node.textContent = "";
    return;
  }

  if (!window.katex) {
    node.textContent = formula;
    return;
  }

  try {
    window.katex.render(formula, node, {
      displayMode,
      throwOnError: false,
      strict: "ignore",
      trust: false,
    });
  } catch (error) {
    console.warn("Failed to render formula.", error);
    node.textContent = formula;
  }
}

function setBusy(isBusy) {
  if (regenerateKeywordsButton) regenerateKeywordsButton.disabled = isBusy;
  if (regenerateThreeLineButton) regenerateThreeLineButton.disabled = isBusy;
  if (regenerateMethodButton) regenerateMethodButton.disabled = isBusy;
  if (basicInfoButton) basicInfoButton.disabled = isBusy;
}

function setStatus(message, isError = false) {
  if (!statusText) return;
  statusText.textContent = message;
  statusText.classList.toggle("error", isError);
}

function clearStatus() {
  setStatus("");
}

