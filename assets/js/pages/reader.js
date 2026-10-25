import * as pdfjsLib from "../../../vendor/pdfjs/pdf.min.mjs";
import { initAnnotationPanel } from "../components/annotation_panel.js";
import { initNotesPanel } from "../components/notes_panel.js";
import { initSettingsModal } from "../components/settings_modal.js";
import { initLibrarySidebar } from "../components/library_sidebar.js";
import { initDiscussionPanel } from "../components/discussion_panel.js";
import { recordPaperViewed } from "../lib/recent_papers.js";
import { getCategoryLabels } from "../components/category_manager.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdfjs/pdf.worker.min.mjs";

const readerUploadMenu = document.querySelector("#readerUploadMenu");
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
let methodFormulaOverflowFrame = 0;
const copyThreeLineButton = document.querySelector("#copyThreeLineButton");
const copyMethodButton = document.querySelector("#copyMethodButton");
const readerTabs = document.querySelectorAll(".reader-tab");
const readerTabPanels = document.querySelectorAll(".reader-tab-panel");
const withAiPanel = document.querySelector("#withAiPanel");
const withAiSummaryScroll = document.querySelector("#withAiPanel .summary-scroll");
const withAiScrollBottomButton = document.querySelector("#withAiScrollBottomButton");
const WITH_AI_FOLLOW_THRESHOLD = 180;
const discussionForm = document.querySelector("#discussionForm");
const basicInfoButton = document.querySelector("#basicInfoButton");
const basicInfoStatus = document.querySelector("#basicInfoStatus");
const basicInfoTitle = document.querySelector("#basicInfoTitle");
const basicInfoCategories = document.querySelector("#basicInfoCategories");
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

const READING_POSITION_STORAGE_PREFIX = "paperLanternReadingPosition:";
const PDF_OUTLINE_MIN_WIDTH = 180;
const PDF_OUTLINE_MAX_WIDTH = 420;

let pdfSearchMatches = [];
let pdfSearchIndex = -1;
let pdfOutlineItems = [];
let isResizingPdfOutline = false;
let pdfLinkJumpHighlight = null;
let pdfLinkJumpHighlightIgnoreScrollUntil = 0;

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
let paperSaveQueue = Promise.resolve();
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
let librarySidebar = null;
let currentVisiblePage = 0;
let apiBaseUrl = "";
let translationDragState = null;
let discussionPanel = null;
let copiedToastTimer = null;
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

const annotationPanel = initAnnotationPanel({
  getPdfFrameElement,
  getPdfViewer: () => pdfViewer,
  getCurrentPaperTitle: () => currentPaper?.title || "",
  getFileTitle: () => fileName?.textContent || "",
  getHighlightGroup,
  getHighlightKey,
  getHighlights: () => savedHighlights,
  setHighlights: (nextHighlights) => {
    savedHighlights = Array.isArray(nextHighlights) ? nextHighlights : [];
  },
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
});

const notesPanel = initNotesPanel({
  getCurrentPaper: () => currentPaper,
  savePaper: saveCurrentPaper,
  apiFetch,
  copyText: copyTextToClipboard,
  showCopiedFeedback,
  triggerBlobDownload,
});

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
if (window.ResizeObserver && methodSections) {
  new ResizeObserver(scheduleMethodFormulaOverflowUpdate).observe(methodSections);
} else {
  window.addEventListener("resize", scheduleMethodFormulaOverflowUpdate);
}
librarySidebar = initLibrarySidebar({
  shell: appShell,
  getCurrentItem: () => currentPaper,
  setCurrentItem: (paper) => {
    currentPaper = paper;
    renderBasicInfoCategories(paper);
  },
  apiFetch,
  readJsonResponse,
  setStatus,
  openUrl: openReaderNavigationInNewTab,
  restorePinned: true,
});

discussionPanel = initDiscussionPanel({
  paperReferences: notesPanel,
  getItem: () => currentPaper,
  getContextText: () => lastExtractedText,
  getSummary: () => paperToSummary(currentPaper),
  saveItem: saveCurrentPaper,
  apiFetch,
  readJsonResponse,
  copyText: copyTextToClipboard,
  onCopied: (button) => showCopiedFeedback(button),
  showConfirm: (message) => showFloatingConfirm({ message, title: "确认操作", confirmLabel: "删除", danger: true }),
  onActivate: () => {
    setActiveReaderTab("withAiTab");
    setSummaryPaneCollapsed(false, false);
  },
  onOpenReference: () => openActiveDiscussionReference(),
  onScrollLatest: ({ smooth, force }) => scrollWithAiPanelToBottom({ smooth, force }),
  onReferenceChange: (reference) => {
    clearDiscussionReferenceHighlights();
    if (reference) openActiveDiscussionReference();
  },
  contextType: "paper",
});
initWithAiScrollBottom();
openReaderFromUrl().catch((error) => {
  console.error("Failed to open paper.", error);
  showPdfLoadError(error.message || "打开论文失败。");
  setStatus(error.message || "打开论文失败。", true);
  setBusy(false);
});




function openReaderNavigationInNewTab(url) {
  window.open(url, "_blank", "noopener,noreferrer");
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
  try {
    await notesPanel.save();
  } catch (error) {
    console.error("切换论文前保存笔记失败。", error);
  }
  setStatus("正在打开论文...");
  const response = await apiFetch(`/api/library/paper?id=${encodeURIComponent(paperId)}`);
  const data = await readJsonResponse(response);
  if (!response.ok) {
    setStatus(data.error || "打开论文失败", true);
    return;
  }

  currentPaper = data.paper;
  currentPaper.viewedAt = recordPaperViewed(currentPaper.id);
  try {
    currentPaper.viewedAt = (await persistPaperViewed(currentPaper.id)) || currentPaper.viewedAt;
  } catch (error) {
    console.warn("Failed to persist recent paper.", error);
  }
  savedHighlights = normalizeHighlights(Array.isArray(currentPaper.highlights) ? currentPaper.highlights : []);
  discussionPanel.renderHistory(currentPaper.discussion || []);
  notesPanel.render(currentPaper.notes || "");
  renderSummary(paperToSummary(currentPaper));
  renderBasicInfo(currentPaper.basicInfo, currentPaper);
  renderDoi(currentPaper.doi);
  resetCitationSection();
  loadCurrentCitationInfo().catch((error) => console.error("Failed to load current citation info.", error));
  setReaderPaperTitle(currentPaper.title);
  librarySidebar?.setCurrentItem(currentPaper);

  setBusy(true);
  setStatus("正在加载 PDF...");
  showPdfLoading();
  let pdfOpened = false;

  try {
    const file = await fetchPaperPdf(currentPaper);
    lastExtractedText = "";
    referenceEntries = new Map();
    showPdf(file, currentPaper.title);
    pdfOpened = true;
    clearStatus();
    if (!currentPaper.threeLineSummary?.method) {
      renderSummaryLoading("解析论文并生成总结中...");
    }

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
    if (!pdfOpened) showPdfLoadError(error.message || "PDF 加载失败。");
    else renderSummary(paperToSummary(currentPaper));
    setStatus(error.message || "Failed to read PDF.", true);
  } finally {
    setBusy(false);
  }
}

async function fetchPaperPdf(paper) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 60000);
  try {
    const parts = [];
    const chunkSize = 1024 * 1024;
    let offset = 0;
    let total = null;
    while (total === null || offset < total) {
      const response = await apiFetch(paper.pdfUrl, {
        signal: controller.signal,
        headers: { Range: `bytes=${offset}-${offset + chunkSize - 1}` },
      });
      if (!response.ok) throw new Error(`PDF 下载失败：HTTP ${response.status}`);
      if (response.status === 200 && offset === 0) {
        const blob = await response.blob();
        if (!blob.size) throw new Error("PDF 文件为空。");
        return new File([blob], `${paper.title}.pdf`, { type: "application/pdf" });
      }
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/i.exec(response.headers.get("Content-Range") || "");
      if (response.status !== 206 || !range || Number(range[1]) !== offset) {
        throw new Error("PDF 分段响应无效。");
      }
      total = Number(range[3]);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length !== Number(range[2]) - offset + 1) {
        throw new Error(`PDF 下载不完整：${offset}-${range[2]}。`);
      }
      parts.push(bytes);
      offset += bytes.length;
      setStatus(`正在加载 PDF... ${Math.round(offset / total * 100)}%`);
    }
    if (!offset) throw new Error("PDF 文件为空。");
    return new File(parts, `${paper.title}.pdf`, { type: "application/pdf" });
  } catch (error) {
    if (controller.signal.aborted) throw new Error("PDF 加载超时，请重试。", { cause: error });
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function showPdfLoading() {
  pdfViewer.style.display = "block";
  emptyState.style.display = "none";
  pdfViewer.innerHTML = '<div class="pdf-loading">正在加载 PDF...</div>';
}

function showPdfLoadError(message) {
  pdfViewer.style.display = "block";
  emptyState.style.display = "none";
  pdfViewer.replaceChildren();
  const errorNode = document.createElement("div");
  errorNode.className = "pdf-loading";
  errorNode.textContent = message;
  pdfViewer.appendChild(errorNode);
}

document.addEventListener("selectionchange", handlePdfSelectionChange);
pdfViewer.addEventListener("wheel", handlePdfWheel, { passive: false });
pdfViewer.addEventListener("scroll", () => {
  updatePageIndicator();
  hideReferencePopover();
  if (Date.now() > pdfLinkJumpHighlightIgnoreScrollUntil) clearPdfLinkJumpHighlight();
  scheduleVisiblePdfRender();
  scheduleSaveReadingPosition();
});
pdfViewer.addEventListener("wheel", clearPdfLinkJumpHighlight, { passive: true });
window.addEventListener("beforeunload", saveReadingPositionNow);
pdfViewer.addEventListener("pointerdown", handlePdfSelectionPointerDown);
pdfViewer.addEventListener("pointerdown", clearPdfLinkJumpHighlight);
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
  updateWithAiScrollBottomButton();
}

function initWithAiScrollBottom() {
  if (!withAiScrollBottomButton) return;
  withAiScrollBottomButton.addEventListener("click", () => scrollWithAiPanelToBottom());
  withAiSummaryScroll?.addEventListener("scroll", updateWithAiScrollBottomButton, { passive: true });
  window.addEventListener("scroll", updateWithAiScrollBottomButton, { passive: true });
  window.addEventListener("resize", () => {
    updateWithAiScrollBottomOffset();
    updateWithAiScrollBottomButton();
  });
  if (window.ResizeObserver && discussionForm) {
    new ResizeObserver(updateWithAiScrollBottomOffset).observe(discussionForm);
  }
  updateWithAiScrollBottomOffset();
  updateWithAiScrollBottomButton();
}

function scrollWithAiPanelToBottom({ smooth = true, force = true } = {}) {
  const behavior = smooth ? "smooth" : "auto";
  const scroller = isScrollableElement(withAiSummaryScroll) ? withAiSummaryScroll : document.scrollingElement;
  // 流式输出时只在用户本来就贴着底部时跟随，避免打断向上翻阅。
  if (!force && scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > WITH_AI_FOLLOW_THRESHOLD) return;
  if (isScrollableElement(withAiSummaryScroll)) {
    withAiSummaryScroll.scrollTo({ top: withAiSummaryScroll.scrollHeight, behavior });
  } else {
    discussionForm?.scrollIntoView({ block: "end", behavior });
  }
  updateWithAiScrollBottomButton();
}

function updateWithAiScrollBottomButton() {
  if (!withAiScrollBottomButton) return;
  const isWithAiActive = withAiPanel?.classList.contains("active");
  const scrollTarget = isScrollableElement(withAiSummaryScroll) ? withAiSummaryScroll : document.scrollingElement;
  const isNearBottom = !isScrollableElement(scrollTarget) || scrollTarget.scrollTop + scrollTarget.clientHeight >= scrollTarget.scrollHeight - 12;
  withAiScrollBottomButton.classList.toggle("is-hidden", !isWithAiActive || isNearBottom);
}

function queueWithAiScrollBottomButtonUpdate() {
  window.requestAnimationFrame(() => {
    updateWithAiScrollBottomOffset();
    updateWithAiScrollBottomButton();
  });
}

function isScrollableElement(element) {
  return Boolean(element && element.scrollHeight > element.clientHeight + 2);
}

function updateWithAiScrollBottomOffset() {
  if (!withAiPanel || !discussionForm) return;
  withAiPanel.style.setProperty("--with-ai-discussion-form-height", `${discussionForm.offsetHeight}px`);
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

async function persistPaperViewed(paperId) {
  const response = await apiFetch("/api/library/paper", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "view", id: paperId }),
  });
  const data = await readJsonResponse(response);
  if (!response.ok) throw new Error(data.error || "Failed to record recent paper.");
  return data.viewedAt || "";
}

function renderDiscussionMarkdown(content) {
  return discussionPanel?.renderMarkdown(content) || String(content || "");
}

function getDiscussionMarkdownRenderer() {
  return discussionPanel?.getMarkdownRenderer() || null;
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
  const paperId = currentPaper.id;
  savedHighlights = normalizeHighlights(savedHighlights);
  const body = JSON.stringify({ id: paperId, highlights: savedHighlights, ...extra });
  const save = paperSaveQueue.catch(() => {}).then(async () => {
    const response = await apiFetch("/api/library/paper", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.error || "Paper save failed.");
    if (currentPaper?.id === paperId) {
      currentPaper = data.paper;
      renderBasicInfoCategories(currentPaper);
    }
  });
  paperSaveQueue = save;
  return save;
}

function showPdf(file, displayTitle = "") {
  renderPdf(file).catch((error) => {
    console.error(error);
    showPdfLoadError(error.message || "PDF 渲染失败。");
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
  pdfSearchPrevButton?.addEventListener("click", () => stepPdfSearch(1));
  pdfSearchNextButton?.addEventListener("click", () => stepPdfSearch(-1));
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
  const paperId = currentPaper?.id || "";
  const response = await apiFetch("/api/summarize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paperId, paperText: text, stream: true }),
  });
  if (!response.ok) {
    const data = await readJsonResponse(response);
    throw new Error(data.detail || data.error || "Summary failed.");
  }
  if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
    throw new Error("Summary stream is unavailable.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  let summary = paperToSummary(currentPaper);

  async function applyEvent(event) {
    if (currentPaper?.id !== paperId) return;
    if (event.stage === "error") throw new Error(event.summary?.detail || "Summary failed.");
    let persist = true;
    if (event.stage === "overview") {
      summary = {
        ...summary,
        paperTitle: event.summary.paperTitle || summary.paperTitle,
        basicInfo: event.summary.basicInfo || {},
        keywords: event.summary.keywords || [],
        threeLineSummary: {
          ...summary.threeLineSummary,
          challenges: event.summary.threeLineSummary?.challenges || "",
          conclusion: event.summary.threeLineSummary?.conclusion || "",
        },
      };
      renderBasicInfo(summary.basicInfo);
      renderKeywords(summary.keywords);
      challenges.textContent = summary.threeLineSummary.challenges || "No response";
      conclusion.textContent = summary.threeLineSummary.conclusion || "No response";
    } else if (event.stage === "keywords") {
      summary = { ...summary, keywords: event.summary.keywords || [], keywordExplanations: event.summary.keywordExplanations || {} };
      renderKeywords(summary.keywords, summary.keywordExplanations);
    } else if (event.stage === "method_progress") {
      summary = { ...summary, methodSections: event.summary.methodSections || [] };
      renderMethodSections(summary.methodSections);
      persist = Boolean(event.summary.complete);
    } else if (event.stage === "complete") {
      summary = event.summary;
      renderSummary(summary);
      renderBasicInfo(summary.basicInfo);
      completed = true;
    } else {
      return;
    }
    if (persist) await saveCurrentPaper({ summary });
    if (currentPaper?.id === paperId && summary.paperTitle) {
      setReaderPaperTitle(summary.paperTitle);
      if (basicInfoTitle) basicInfoTitle.textContent = formatBasicInfoValue(summary.paperTitle);
    }
  }

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done }).replace(/\r\n/g, "\n");
    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = block.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n");
      if (data) await applyEvent(JSON.parse(data));
    }
    if (done) break;
  }
  if (!completed && currentPaper?.id === paperId) throw new Error("Summary stream ended early.");
  if (currentPaper?.id === paperId) clearStatus();
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
  const highlights = createHighlightsFromRange(selectedPdfRange, { groupId, color: "yellow", selectedText: selectedPdfText, text: [] });
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
    selectedText: selectedPdfText,
    text: [],
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

async function translateSelection() {
  const text = selectedPdfText.trim();
  if (!text || !selectedPdfRange) return;

  const groupId = createAnnotationId();
  const draftHighlights = createHighlightsFromRange(selectedPdfRange, {
    groupId,
    color: "blue",
    type: "translation",
    selectedText: text,
    text: [],
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
        paperText: lastExtractedText.trim(),
        summary: paperToSummary(currentPaper),
      }),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.detail || data.error || "\u7ffb\u8bd1\u5931\u8d25");
    const translation = data.translation || "";
    draftHighlights.forEach((highlight) => {
      const annotation = { ...highlight, translation, text: [{ type: "translation", content: translation }] };
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

async function translateAnnotationText(text) {
  const source = String(text || "").trim();
  if (!source) return "";
  const response = await apiFetch("/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: source,
      paperText: lastExtractedText.trim(),
      summary: paperToSummary(currentPaper),
    }),
  });
  const data = await readJsonResponse(response);
  if (!response.ok) throw new Error(data.detail || data.error || "\u7ffb\u8bd1\u5931\u8d25");
  return data.translation || "";
}

async function explainAnnotationText(text) {
  const selectedText = String(text || "").trim();
  const paperText = lastExtractedText.trim();
  if (!selectedText) return "";
  if (paperText.length < 80) throw new Error("\u8bf7\u5148\u6253\u5f00\u5e76\u89e3\u6790\u8bba\u6587\uff0c\u518d\u89e3\u91ca\u5c40\u90e8\u6587\u672c\u3002");
  const response = await apiFetch("/api/explain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      selectedText,
      paperText,
      summary: paperToSummary(currentPaper),
    }),
  });
  const data = await readJsonResponse(response);
  if (!response.ok) throw new Error(data.detail || data.error || "\u89e3\u91ca\u5931\u8d25");
  return data.explanation || "";
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
    selectedText: text,
    text: [],
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
      const annotation = { ...highlight, comment, text: [{ type: "comment", content: comment }] };
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
  const ranges = createHighlightsFromRange(selectedPdfRange).map((item) => ({
    pageNumber: item.pageNumber,
    left: item.left,
    top: item.top,
    width: item.width,
    height: item.height,
  }));
  const reference = {
    text,
    paperTitle: currentPaper?.title || fileName?.textContent || "",
    page: context.page || 0,
    before: context.before,
    after: context.after,
    ranges,
  };
  startDiscussionFromReference(reference);
  hideSelectionMenu();
  hideTranslationBubble();
  window.getSelection()?.removeAllRanges();
}

function startDiscussionFromReference(reference) {
  discussionPanel.startFromReference(reference);
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
  if (resolved) jumpToPdfLinkPage(resolved.pageIndex + 1, resolved);
}

function jumpToPdfLinkPage(pageNumber, destination = null) {
  jumpToPdfLinkPageAsync(pageNumber, destination).catch((error) => console.error("Failed to follow PDF link.", error));
}

async function jumpToPdfLinkPageAsync(pageNumber, destination = null) {
  if (!currentPdfDocument || !currentPdfTask) return;
  const renderId = currentPdfTask;
  const pageNode = pdfViewer.querySelector(`.pdf-page[data-page-number="${pageNumber}"]`);
  if (!pageNode) return;
  clearPdfLinkJumpHighlight();
  pdfLinkJumpHighlightIgnoreScrollUntil = Date.now() + 900;
  pageNode.scrollIntoView({ block: "center", behavior: "smooth" });
  await renderPdfPageInto(pageNumber, pageNode, renderId);
  if (currentPdfTask === renderId && destination) {
    const marker = await showPdfLinkJumpHighlight(pageNode, pageNumber, destination);
    if (marker) {
      marker.scrollIntoView({ block: "center", behavior: "smooth" });
      pdfLinkJumpHighlightIgnoreScrollUntil = Date.now() + 900;
    }
  }
}

async function showPdfLinkJumpHighlight(pageNode, pageNumber, destination) {
  if (!currentPdfDocument || !pageNode || !destination || destination.top == null) return null;
  const page = await currentPdfDocument.getPage(pageNumber);
  const metrics = pdfPageMetrics[pageNumber] || getPdfPageMetrics(page, renderedPdfZoom);
  const viewport = page.getViewport({ scale: metrics.scale });
  const rect = getPdfLinkDestinationHighlightRect(destination, page, viewport);
  if (!rect) return null;

  const marker = document.createElement("div");
  marker.className = "pdf-link-jump-highlight";
  Object.assign(marker.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
  pageNode.appendChild(marker);
  pdfLinkJumpHighlight = marker;
  return marker;
}

function getPdfLinkDestinationHighlightRect(destination, page, viewport) {
  const pageWidth = viewport.width;
  const pageHeight = viewport.height;
  const baseViewport = page.getViewport({ scale: 1 });
  const leftPdf = Number.isFinite(destination.left) ? destination.left : 0;
  const topPdf = Number(destination.top);
  if (!Number.isFinite(topPdf)) return null;

  const [, yFromPdfPoint] = viewport.convertToViewportPoint(leftPdf, topPdf);
  const yFromTopDistance = topPdf * viewport.scale;
  const candidates = [yFromPdfPoint, yFromTopDistance].filter((value) => Number.isFinite(value) && value >= -24 && value <= pageHeight + 24);
  const top = clamp(candidates[0] ?? pageHeight - baseViewport.height * viewport.scale, 0, pageHeight - 2);
  const left = Number.isFinite(destination.left) ? clamp(leftPdf * viewport.scale - 12, 0, pageWidth - 24) : Math.min(28, pageWidth * 0.06);
  const width = Number.isFinite(destination.left) ? Math.min(Math.max(pageWidth - left - 28, 80), pageWidth - left) : Math.max(pageWidth - left * 2, 80);
  const height = Math.min(36, Math.max(22, pageHeight * 0.035));
  return {
    left,
    top: clamp(top - height * 0.45, 0, pageHeight - height),
    width,
    height,
  };
}

function clearPdfLinkJumpHighlight() {
  if (!pdfLinkJumpHighlight) return;
  pdfLinkJumpHighlight.remove();
  pdfLinkJumpHighlight = null;
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

  const body = popover.querySelector(".reference-popover-body");
  body.innerHTML = "";
  entries.forEach((entry) => {
    const item = document.createElement("article");
    item.className = "reference-entry";
    const number = document.createElement("strong");
    number.textContent = `[${entry.number}]`;
    const text = document.createElement("p");
    text.textContent = entry.text;
    const actions = document.createElement("div");
    actions.className = "reference-entry-actions";
    const scholarButton = createReferenceIconButton("reference-scholar", "查看原文", '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M22 10 12 5 2 10l10 5 10-5z"></path><path d="M6 12.5V16c0 1.7 2.7 3 6 3s6-1.3 6-3v-3.5"></path><path d="M22 10v6"></path></svg>', "查看原文");
    scholarButton.addEventListener("click", () => openReferenceInGoogleScholar([entry]));
    const copyButton = createReferenceIconButton("reference-copy", "复制引用", getReferenceCopyIcon(), "复制引用");
    copyButton.addEventListener("click", () => copyReferenceEntries([entry], copyButton));
    actions.append(scholarButton, copyButton);
    item.append(number, text, actions);
    body.appendChild(item);
  });
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

async function copyReferenceEntries(entries, button) {
  const text = entries.map((entry) => `[${entry.number}] ${entry.text}`).join("\n");
  try {
    await copyTextToClipboard(text);
    button.classList.add("copied");
    button.setAttribute("aria-label", "已复制");
    button.title = "已复制";
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m20 6-11 11-5-5"></path></svg><span>已复制</span>';
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

function createReferenceIconButton(className, label, icon, text = "") {
  const button = document.createElement("button");
  button.className = `reference-icon-button ${className}`;
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.innerHTML = `${icon}${text ? `<span>${text}</span>` : ""}`;
  return button;
}

function getReferenceCopyIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
}

function resetReferenceCopyButton(button) {
  if (!button) return;
  button.classList.remove("copied", "error");
  button.setAttribute("aria-label", "复制引用");
  button.title = "复制引用";
  button.innerHTML = `${getReferenceCopyIcon()}<span>复制引用</span>`;
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
  annotationPanel.show(highlight, clientX, clientY, options);
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

function hideAnnotationEditor(options = {}) {
  annotationPanel.hide(options);
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
    const first = group[0] || highlight;
    const entries = normalizeAnnotationTextEntries(first.text, first);
    const selectedText = group.find((item) => item.selectedText)?.selectedText || "";
    const annotationEntries = entries
      .map((entry, entryIndex) => ({ ...entry, entryIndex }))
      .filter((entry) => entry.content);
    annotationEntries.forEach((entry, orderIndex) => groups.push({
      groupId,
      pageNumber: Number(highlight.pageNumber),
      entryIndex: entry.entryIndex,
      orderIndex,
      kind: entry.type,
      comment: entry.content,
      text: selectedText,
      color: first.color || "yellow",
    }));
    if (!annotationEntries.length) {
      groups.push({
        groupId,
        pageNumber: Number(highlight.pageNumber),
        entryIndex: -1,
        orderIndex: 0,
        kind: "highlight",
        comment: selectedText,
        text: selectedText,
        color: first.color || "yellow",
      });
    }
  }
  groups.sort((a, b) => a.pageNumber - b.pageNumber || a.orderIndex - b.orderIndex || a.comment.localeCompare(b.comment));
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
    empty.textContent = totalCount ? "暂无该颜色批注" : "暂无批注";
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
    deleteButton.title = entry.kind === "highlight" ? "删除高亮" : "删除该条批注";
    deleteButton.setAttribute("aria-label", entry.kind === "highlight" ? "删除高亮" : "删除该条批注");
    deleteButton.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M6 6l1 15h10l1-15"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg>';
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteCommentEntry(entry.groupId, entry.entryIndex);
    });

    head.append(swatch, page, deleteButton);

    const body = document.createElement("span");
    body.className = "comments-nav-body";
    body.textContent = String(entry.comment || "").trim();

    if (entry.kind !== "highlight" && entry.text) {
      const source = document.createElement("span");
      source.className = "comments-nav-source";
      source.textContent = `“${entry.text.trim()}”`;
      item.append(head, source, body);
    } else {
      item.append(head, body);
    }
    list.appendChild(item);
  });
}

async function deleteCommentEntry(groupId, entryIndex) {
  if (entryIndex < 0) {
    savedHighlights = savedHighlights.filter((highlight) => !isSameHighlightGroup(highlight, groupId));
    redrawHighlights();
    refreshCommentsNavigation();
    try {
      await saveCurrentPaper();
    } catch (error) {
      console.error("Failed to save after deleting highlight.", error);
    }
    return;
  }
  const group = getHighlightGroup(groupId);
  const first = group[0] || {};
  const entries = normalizeAnnotationTextEntries(first.text, first)
    .filter((entry, index) => index !== entryIndex);
  const firstComment = entries.find((entry) => entry.type === "comment" && entry.content)?.content || "";
  const translation = entries.find((entry) => entry.type === "translation" && entry.content)?.content || "";
  savedHighlights = savedHighlights.map((highlight) => {
    if (!isSameHighlightGroup(highlight, groupId)) return highlight;
    const next = { ...highlight, text: entries };
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
  });
  redrawHighlights();
  refreshCommentsNavigation();
  try {
    await saveCurrentPaper();
  } catch (error) {
    console.error("Failed to save after deleting comment entry.", error);
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
    normalized.selectedText = String(normalized.selectedText || (typeof normalized.text === "string" ? normalized.text : "") || "").trim();
    normalized.text = normalizeAnnotationTextEntries(normalized.text, normalized);
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
    selectedText: highlight.selectedText || "",
    text: normalizeAnnotationTextEntries(highlight.text, highlight).map(({ type, content }) => ({ type, content })),
    groupId: highlight.groupId || "",
  };
  return simpleHash(JSON.stringify(stable));
}

function normalizeAnnotationTextEntries(value, highlight = {}) {
  const entries = Array.isArray(value)
    ? value
        .map((entry) => {
          if (typeof entry === "string") return { type: "comment", content: entry };
          if (!entry || typeof entry !== "object") return null;
          const type = entry.type === "translation" ? "translation" : "comment";
          const content = String(entry.content || entry.text || "").trim();
          const id = String(entry.id || "").trim();
          return content ? { ...(id ? { id } : {}), type, content } : null;
        })
        .filter(Boolean)
    : [];
  if (!entries.some((entry) => entry.type === "translation") && String(highlight.translation || "").trim()) {
    entries.unshift({ type: "translation", content: String(highlight.translation).trim() });
  }
  if (!entries.some((entry) => entry.type === "comment") && String(highlight.comment || "").trim()) {
    entries.push({ type: "comment", content: String(highlight.comment).trim() });
  }
  return entries;
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
  return discussionPanel?.getActiveReference() || null;
}

function clearDiscussionReferenceHighlights() {
  document.querySelectorAll(".pdf-reference-mark").forEach((node) => node.remove());
}

function openActiveDiscussionReference() {
  const reference = getActiveDiscussionReference();
  if (!reference) return;
  const page = Number(reference.page || reference.ranges?.[0]?.pageNumber);
  if (!Number.isFinite(page) || page < 1) return;
  jumpToPdfPageAsync(page, "auto").then(() => {
    if (getActiveDiscussionReference() !== reference) return;
    retryApplyReferenceHighlight(14);
    const pageNode = pdfViewer.querySelector(`.pdf-page[data-page-number="${page}"]`);
    const mark = pageNode?.querySelector(".pdf-reference-mark");
    if (mark) {
      mark.scrollIntoView({ block: "center", behavior: "auto" });
      saveReadingPositionNow();
    }
  }).catch((error) => console.error("Failed to open discussion reference.", error));
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

function addReferenceMark(layer, rect) {
  const mark = document.createElement("span");
  mark.className = "pdf-reference-mark";
  mark.style.left = `${rect.left * 100}%`;
  mark.style.top = `${rect.top * 100}%`;
  mark.style.width = `${rect.width * 100}%`;
  mark.style.height = `${rect.height * 100}%`;
  layer.appendChild(mark);
}

function applyReferenceHighlightToPage(pageNode, reference) {
  const layer = pageNode.querySelector(".pdf-highlight-layer");
  if (!layer) return;
  layer.querySelectorAll(".pdf-reference-mark").forEach((node) => node.remove());
  const pageNumber = Number(pageNode.dataset.pageNumber);

  // Only recorded selection geometry is used — no text matching.
  const geometry = (reference.ranges || []).filter((item) => Number(item.pageNumber) === pageNumber);
  geometry.forEach((rect) => addReferenceMark(layer, rect));
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
      if (options.signal?.aborted) throw error;
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
    queueWithAiScrollBottomButtonUpdate();
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
  queueWithAiScrollBottomButtonUpdate();
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

function renderBasicInfoCategories(paper = currentPaper) {
  if (basicInfoCategories) basicInfoCategories.textContent = getCategoryLabels(paper).join("；");
}

function renderBasicInfo(info, paper = currentPaper) {
  const normalized = info && typeof info === "object" ? info : {};
  if (basicInfoTitle) basicInfoTitle.textContent = formatBasicInfoValue(paper?.title);
  renderBasicInfoCategories(paper);
  basicInfoAuthors.textContent = formatBasicInfoValue(normalized.authors);
  basicInfoVenue.textContent = formatBasicInfoValue(normalized.venue);
  basicInfoDate.textContent = formatBasicInfoValue(normalized.publishedDate);
  basicInfoInstitutions.textContent = formatBasicInfoValue(normalized.institutions);
  if (basicInfoLocalPath) basicInfoLocalPath.textContent = formatBasicInfoValue(getPaperStoragePath(paper));
}

function renderBasicInfoLoading() {
  if (basicInfoTitle) basicInfoTitle.textContent = "Loading...";
  renderBasicInfoCategories();
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
  [basicInfoTitle, basicInfoCategories, basicInfoLocalPath].forEach((field) => {
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
  queueWithAiScrollBottomButtonUpdate();
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
    queueWithAiScrollBottomButtonUpdate();
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
  scheduleMethodFormulaOverflowUpdate();
  queueWithAiScrollBottomButtonUpdate();
}

function scheduleMethodFormulaOverflowUpdate() {
  if (methodFormulaOverflowFrame) return;
  methodFormulaOverflowFrame = window.requestAnimationFrame(() => {
    methodFormulaOverflowFrame = 0;
    methodSections.querySelectorAll(".formula-inline").forEach((formula) => {
      if (!formula.clientWidth) return;
      formula.classList.toggle("is-overflowing", formula.scrollWidth > formula.clientWidth + 1);
    });
  });
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

