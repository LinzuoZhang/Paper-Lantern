import * as pdfjsLib from "./vendor/pdfjs/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdfjs/pdf.worker.min.mjs";

const backToLibraryButton = document.querySelector("#backToLibraryButton");
const openLibraryDrawerButton = document.querySelector("#openLibraryDrawerButton");
const closeLibraryDrawerButton = document.querySelector("#closeLibraryDrawerButton");
const readerLibraryDrawer = document.querySelector("#readerLibraryDrawer");
const readerCategoryList = document.querySelector("#readerCategoryList");
const readerPaperList = document.querySelector("#readerPaperList");
const readerLibraryTitle = document.querySelector("#readerLibraryTitle");
const pdfViewer = document.querySelector("#pdfViewer");
const appShell = document.querySelector(".app-shell");
const paneResizer = document.querySelector("#paneResizer");
const selectionMenu = document.querySelector("#selectionMenu");
const highlightButton = document.querySelector("#highlightButton");
const commentButton = document.querySelector("#commentButton");
const translateButton = document.querySelector("#translateButton");
const emptyState = document.querySelector("#emptyState");
const fileName = document.querySelector("#fileName");
const pageIndicator = document.querySelector("#pageIndicator");
const summarizeButton = document.querySelector("#summarizeButton");
const statusText = document.querySelector("#status");
const challenges = document.querySelector("#challenges");
const method = document.querySelector("#method");
const conclusion = document.querySelector("#conclusion");
const keywords = document.querySelector("#keywords");
const methodSections = document.querySelector("#methodSections");
const discussionMessages = document.querySelector("#discussionMessages");
const discussionForm = document.querySelector("#discussionForm");
const discussionInput = document.querySelector("#discussionInput");
const sendDiscussionButton = document.querySelector("#sendDiscussionButton");
const clearDiscussionButton = document.querySelector("#clearDiscussionButton");

let lastExtractedText = "";
let currentPdfTask = null;
let currentPdfDocument = null;
let pdfZoom = 1;
let zoomRenderTimer = null;
let paneRenderTimer = null;
let savedHighlights = [];
let selectedPdfText = "";
let selectedPdfRange = null;
let lastSelectionRect = null;
let isResizingPanes = false;
let currentPaper = null;
let currentVisiblePage = 0;
let apiBaseUrl = "";
let translationDragState = null;
let commentDraftHighlights = [];
let activeHighlightGroupId = null;
let readerLibraryTree = null;
let readerSelectedCategoryId = "";
let discussionHistory = [];
let discussionIsBusy = false;

const highlightColors = {
  yellow: "rgba(255, 221, 64, 0.42)",
  green: "rgba(120, 196, 162, 0.36)",
  blue: "rgba(111, 178, 214, 0.32)",
  pink: "rgba(239, 147, 171, 0.32)",
};

initPaneResizer();
initCollapsibleSummaryCards();
initReaderLibraryDrawer();
openReaderFromUrl();

backToLibraryButton?.addEventListener("click", () => {
  window.location.href = "./index.html";
});

function initReaderLibraryDrawer() {
  openLibraryDrawerButton?.addEventListener("click", () => openReaderLibraryDrawer());
  closeLibraryDrawerButton?.addEventListener("click", () => closeReaderLibraryDrawer());
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeReaderLibraryDrawer();
  });
  loadReaderLibrary().catch((error) => console.error("Failed to load reader library.", error));
}

async function openReaderLibraryDrawer() {
  readerLibraryDrawer.classList.add("open");
  readerLibraryDrawer.setAttribute("aria-hidden", "false");
  openLibraryDrawerButton.setAttribute("aria-expanded", "true");
  await loadReaderLibrary();
}

function closeReaderLibraryDrawer() {
  readerLibraryDrawer.classList.remove("open");
  readerLibraryDrawer.setAttribute("aria-hidden", "true");
  openLibraryDrawerButton.setAttribute("aria-expanded", "false");
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
  const categories = flattenReaderCategories(readerLibraryTree);
  readerCategoryList.innerHTML = "";
  categories.forEach((category) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "reader-category-item";
    button.classList.toggle("active", category.id === readerSelectedCategoryId);
    button.style.paddingLeft = `${10 + category.depth * 14}px`;
    button.textContent = `${category.name} (${category.paperCount})`;
    button.addEventListener("click", () => {
      readerSelectedCategoryId = category.id;
      renderReaderLibrary();
    });
    readerCategoryList.appendChild(button);
  });

  const selected = categories.find((category) => category.id === readerSelectedCategoryId) || categories[0];
  const papers = readerSelectedCategoryId ? selected?.papers || [] : collectReaderPapers(readerLibraryTree);
  readerLibraryTitle.textContent = selected?.id ? selected.name : "All Papers";
  readerPaperList.innerHTML = "";
  if (!papers.length) {
    const empty = document.createElement("div");
    empty.className = "reader-library-empty";
    empty.textContent = "No papers here.";
    readerPaperList.appendChild(empty);
    return;
  }
  papers.forEach((paper) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "reader-paper-item";
    button.classList.toggle("active", currentPaper?.id === paper.id);
    button.textContent = paper.title;
    button.addEventListener("click", () => {
      const params = new URLSearchParams({ id: paper.id });
      window.location.href = `./reader.html?${params.toString()}`;
    });
    readerPaperList.appendChild(button);
  });
}

function flattenReaderCategories(node, depth = 0) {
  if (!node) return [];
  const current = {
    id: node.id || "",
    name: node.name || "Library",
    depth,
    paperCount: collectReaderPapers(node).length,
    papers: node.papers || [],
  };
  return [current, ...(node.folders || []).flatMap((folder) => flattenReaderCategories(folder, depth + 1))];
}

function collectReaderPapers(node) {
  if (!node) return [];
  return [...(node.papers || []), ...(node.folders || []).flatMap(collectReaderPapers)];
}

async function openReaderFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const paperId = params.get("id");
  if (!paperId) {
    setStatus("缺少论文 ID，请从文献库打开论文。", true);
    return;
  }
  await openLibraryPaper(paperId, params.get("analyze") === "1");
}

async function openLibraryPaper(paperId, shouldAnalyze = false) {
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
  renderSummary(paperToSummary(currentPaper));
  fileName.textContent = currentPaper.title;
  fileName.title = currentPaper.title;
  renderReaderLibrary();

  const pdfResponse = await apiFetch(currentPaper.pdfUrl);
  const blob = await pdfResponse.blob();
  const file = new File([blob], `${currentPaper.title}.pdf`, { type: "application/pdf" });
  showPdf(file, currentPaper.title);
  lastExtractedText = "";
  setBusy(true);
  clearStatus();
  if (shouldAnalyze || !currentPaper.threeLineSummary?.method) {
    renderSummaryLoading("解析论文并生成总结中...");
  }

  try {
    const extraction = await extractPdfText(file);
    const extractedText = extraction.text;
    lastExtractedText = extractedText;
    if (extraction.title) {
      fileName.textContent = extraction.title;
      fileName.title = extraction.title;
    }

    if (extractedText.trim().length < 80) {
      setStatus("Not enough text was extracted. This PDF may be scanned; paste text manually and retry.", true);
      return;
    }

    if (shouldAnalyze || !currentPaper.threeLineSummary?.method) {
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
pdfViewer.addEventListener("scroll", updatePageIndicator);
pdfViewer.addEventListener("click", handlePdfClick);
document.addEventListener("pointerdown", (event) => {
  const translationBubble = document.querySelector("#translationBubble");
  const commentBubble = document.querySelector("#commentBubble");
  const annotationEditor = document.querySelector("#annotationEditor");
  const clickedFloatingUi =
    selectionMenu.contains(event.target) ||
    translationBubble?.contains(event.target) ||
    commentBubble?.contains(event.target) ||
    annotationEditor?.contains(event.target);
  if (!event.target.closest(".library-menu") && !event.target.closest(".menu-button")) {
    document.querySelector(".library-menu")?.remove();
  }
  if (!clickedFloatingUi) {
    hideTranslationBubble();
    hideAnnotationEditor();
  }

  if (!selectionMenu.contains(event.target) && !pdfViewer.contains(event.target)) {
    hideSelectionMenu();
  }
});

highlightButton.addEventListener("mousedown", (event) => event.preventDefault());
commentButton.addEventListener("mousedown", (event) => event.preventDefault());
translateButton.addEventListener("mousedown", (event) => event.preventDefault());
highlightButton.addEventListener("click", highlightSelection);
commentButton.addEventListener("click", commentSelection);
translateButton.addEventListener("click", translateSelection);
discussionForm?.addEventListener("submit", handleDiscussionSubmit);
clearDiscussionButton?.addEventListener("click", () => {
  clearDiscussion();
  saveDiscussionHistory();
});

summarizeButton.addEventListener("click", async () => {
  const text = lastExtractedText.trim();
  if (text.length < 80) {
    setStatus("Upload a PDF first. No extracted text is available for regeneration.", true);
    return;
  }

  setBusy(true);
  clearStatus();
  renderSummaryLoading("重新生成总结中...");
  try {
    await summarizeText(text);
  } catch (error) {
    console.error(error);
    renderSummary(paperToSummary(currentPaper));
    setStatus(error.message || "Failed to summarize.", true);
  } finally {
    setBusy(false);
  }
});

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
    threeLineSummary: paper.threeLineSummary || {},
    methodOverview: paper.methodOverview || "",
    methodSections: paper.methodSections || [],
    methodConclusion: paper.methodConclusion || "",
  };
}

async function handleDiscussionSubmit(event) {
  event.preventDefault();
  if (discussionIsBusy) return;

  const question = discussionInput.value.trim();
  if (!question) return;

  const paperText = lastExtractedText.trim();
  if (paperText.length < 80) {
    appendDiscussionMessage("assistant", "请先打开并解析一篇论文，再开始讨论。");
    return;
  }

  appendDiscussionMessage("user", question);
  discussionInput.value = "";
  setDiscussionBusy(true);
  const pending = appendDiscussionMessage("assistant", "Thinking...");
  pending.classList.add("pending");

  try {
    const response = await apiFetch("/api/discuss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paperText,
        question,
        summary: paperToSummary(currentPaper),
        history: discussionHistory.slice(-8),
      }),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.detail || data.error || "Discussion failed.");

    pending.classList.remove("pending");
    setDiscussionMessageContent(pending.querySelector(".discussion-message-body"), data.answer || "No response", "assistant");
    discussionHistory.push({ role: "user", content: question }, { role: "assistant", content: data.answer || "" });
    await saveDiscussionHistory();
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

function appendDiscussionMessage(role, content) {
  discussionMessages.querySelector(".discussion-empty")?.remove();

  const message = document.createElement("div");
  message.className = `discussion-message ${role === "user" ? "user" : "assistant"}`;

  const label = document.createElement("div");
  label.className = "discussion-message-label";
  label.textContent = role === "user" ? "You" : "AI";

  const body = document.createElement("div");
  body.className = "discussion-message-body";
  setDiscussionMessageContent(body, content, role);

  message.append(label, body);
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

function renderDiscussionMarkdown(content) {
  const text = escapeHtml(String(content || ""));
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let paragraph = [];
  let list = [];
  let inCodeBlock = false;
  let codeLines = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${formatDiscussionInline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    blocks.push(`<ul>${list.map((item) => `<li>${formatDiscussionInline(item)}</li>`).join("")}</ul>`);
    list = [];
  };
  const flushCode = () => {
    blocks.push(`<pre><code>${codeLines.join("\n")}</code></pre>`);
    codeLines = [];
  };

  lines.forEach((line) => {
    if (/^\s*```/.test(line)) {
      if (inCodeBlock) {
        flushCode();
        inCodeBlock = false;
      } else {
        flushParagraph();
        flushList();
        inCodeBlock = true;
      }
      return;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      return;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length + 3;
      blocks.push(`<h${level}>${formatDiscussionInline(heading[2])}</h${level}>`);
      return;
    }

    const bullet = line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
      return;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      return;
    }

    flushList();
    paragraph.push(line.trim());
  });

  if (inCodeBlock) flushCode();
  flushParagraph();
  flushList();
  return blocks.join("") || "<p>No response</p>";
}

function formatDiscussionInline(text) {
  return text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function clearDiscussion() {
  discussionHistory = [];
  discussionMessages.innerHTML = "";
  const empty = document.createElement("div");
  empty.className = "discussion-empty";
  empty.textContent = "Ask a question about the method, assumptions, experiments, or limitations.";
  discussionMessages.appendChild(empty);
}

function renderDiscussionHistory(history) {
  clearDiscussion();
  discussionHistory = normalizeDiscussionHistory(history);
  discussionHistory.forEach((message) => appendDiscussionMessage(message.role, message.content));
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

async function saveDiscussionHistory() {
  if (!currentPaper) return;
  try {
    await saveCurrentPaper({ discussion: discussionHistory });
  } catch (error) {
    console.error("Failed to save discussion.", error);
  }
}

function setDiscussionBusy(isBusy) {
  discussionIsBusy = isBusy;
  sendDiscussionButton.disabled = isBusy;
  discussionInput.disabled = isBusy;
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
  fileName.textContent = title;
  fileName.title = title;
}

function initPaneResizer() {
  const savedWidth = Number(localStorage.getItem("readerPaneWidth"));
  if (Number.isFinite(savedWidth)) {
    setReaderPaneWidth(savedWidth);
  }

  paneResizer.addEventListener("pointerdown", (event) => {
    if (window.matchMedia("(max-width: 900px)").matches) return;
    event.preventDefault();
    isResizingPanes = true;
    paneResizer.setPointerCapture(event.pointerId);
    document.body.classList.add("resizing-panes");
    hideSelectionMenu();
    hideTranslationBubble();
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
    const currentWidth = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--reader-pane-width")) || 62;
    const direction = event.key === "ArrowRight" ? 1 : -1;
    setReaderPaneWidth(currentWidth + direction * 2);
    refreshPdfAfterPaneResize();
  });
}

function resizePanesToClientX(clientX) {
  const shellRect = appShell.getBoundingClientRect();
  const width = ((clientX - shellRect.left) / shellRect.width) * 100;
  setReaderPaneWidth(width);
}

function setReaderPaneWidth(width) {
  const clampedWidth = clamp(width, 35, 78);
  document.documentElement.style.setProperty("--reader-pane-width", `${clampedWidth}%`);
  localStorage.setItem("readerPaneWidth", String(clampedWidth));
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
    await renderPdfPages(renderId);
    setViewerScrollRatio(scrollRatio);
  }, 120);
}

async function renderPdf(file) {
  hideSelectionMenu();
  hideTranslationBubble();
  pdfViewer.innerHTML = "";
  if (!currentPaper) savedHighlights = [];
  pdfZoom = 1;
  const loadingNode = document.createElement("div");
  loadingNode.className = "pdf-loading";
  loadingNode.textContent = "Loading PDF...";
  pdfViewer.appendChild(loadingNode);

  const renderId = Symbol("pdfRender");
  currentPdfTask = renderId;
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  if (currentPdfTask !== renderId) return;
  currentPdfDocument = pdf;
  setPageIndicator(1, pdf.numPages);

  await renderPdfPages(renderId);
}

async function renderPdfPages(renderId = Symbol("pdfRender")) {
  if (!currentPdfDocument) return;
  currentPdfTask = renderId;
  pdfViewer.innerHTML = "";
  for (let pageNumber = 1; pageNumber <= currentPdfDocument.numPages; pageNumber += 1) {
    const page = await currentPdfDocument.getPage(pageNumber);
    if (currentPdfTask !== renderId) return;
    await renderPdfPage(page, pageNumber, renderId);
    if (currentPdfTask !== renderId) return;
  }
  restoreHighlights();
  updatePageIndicator();
}

async function renderPdfPage(page, pageNumber, renderId) {
  const containerWidth = Math.max(pdfViewer.clientWidth - 36, 320);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(containerWidth / baseViewport.width, 1.6) * pdfZoom;
  const viewport = page.getViewport({ scale });
  const outputScale = window.devicePixelRatio || 1;

  const pageNode = document.createElement("article");
  pageNode.className = "pdf-page";
  pageNode.dataset.pageNumber = String(pageNumber);
  pageNode.style.width = `${viewport.width}px`;
  pageNode.style.height = `${viewport.height}px`;

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
  textLayer.style.setProperty("--scale-factor", `${scale}`);

  pageNode.append(canvas, highlightLayer, textLayer);

  const textContent = await page.getTextContent();
  if (currentPdfTask !== renderId) return;
  await new pdfjsLib.TextLayer({
    textContentSource: textContent,
    container: textLayer,
    viewport,
  }).render();
  if (currentPdfTask !== renderId) return;

  const existingPage = pdfViewer.querySelector(`.pdf-page[data-page-number="${pageNumber}"]`);
  if (existingPage) existingPage.remove();
  pdfViewer.appendChild(pageNode);
}

function handlePdfWheel(event) {
  if (!event.ctrlKey || !currentPdfDocument) return;

  event.preventDefault();
  hideSelectionMenu();
  hideTranslationBubble();
  window.getSelection()?.removeAllRanges();

  const previousZoom = pdfZoom;
  const direction = event.deltaY < 0 ? 1 : -1;
  const nextZoom = clamp(pdfZoom + direction * 0.12, 0.6, 2.8);
  if (nextZoom === previousZoom) return;

  const scrollRatio = getViewerScrollRatio();
  pdfZoom = nextZoom;
  schedulePdfRerender(scrollRatio);
}

function schedulePdfRerender(scrollRatio) {
  window.clearTimeout(zoomRenderTimer);
  zoomRenderTimer = window.setTimeout(async () => {
    const renderId = Symbol("pdfZoomRender");
    await renderPdfPages(renderId);
    setViewerScrollRatio(scrollRatio);
  }, 80);
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

async function summarizeText(text) {
  const response = await apiFetch("/api/summarize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paperText: text }),
  });
  const data = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(data.detail || data.error || "Summary failed.");
  }

  renderSummary(data.summary);
  await saveCurrentPaper({ summary: data.summary });
  if (data.summary?.paperTitle) {
    fileName.textContent = data.summary.paperTitle;
    fileName.title = data.summary.paperTitle;
  }
  clearStatus();
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

function handlePdfSelectionChange() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    hideSelectionMenu();
    hideTranslationBubble();
    return;
  }

  const range = selection.getRangeAt(0);
  const commonNode = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
    ? range.commonAncestorContainer.parentElement
    : range.commonAncestorContainer;
  if (!pdfViewer.contains(commonNode)) {
    hideSelectionMenu();
    hideTranslationBubble();
    return;
  }

  const text = selection.toString().trim();
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
  if (!text || !rects.length) {
    hideSelectionMenu();
    hideTranslationBubble();
    return;
  }

  selectedPdfText = text;
  selectedPdfRange = range.cloneRange();
  lastSelectionRect = rects[rects.length - 1];
  hideTranslationBubble();
  showSelectionMenu(lastSelectionRect);
}

function showSelectionMenu(rect) {
  const frameRect = pdfViewer.parentElement.getBoundingClientRect();
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
  const highlights = createHighlightsFromRange(selectedPdfRange, { groupId, color: "yellow" });
  highlights.forEach((highlight) => {
    savedHighlights.push(highlight);
    const pageNode = pdfViewer.querySelector(`.pdf-page[data-page-number="${highlight.pageNumber}"]`);
    if (pageNode) drawHighlight(pageNode, highlight);
  });

  hideSelectionMenu();
  hideTranslationBubble();
  hideCommentBubble();
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
  commentDraftHighlights = createHighlightsFromRange(selectedPdfRange, {
    groupId,
    color: "green",
    type: "comment",
    text: selectedPdfText,
  });
  if (!commentDraftHighlights.length) return;
  hideSelectionMenu();
  hideTranslationBubble();
  showCommentWindow("");
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

  hideSelectionMenu();
  hideCommentBubble();
  translateButton.disabled = true;
  translateButton.textContent = "\u7ffb\u8bd1\u4e2d";
  try {
    const response = await apiFetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
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
    showAnnotationEditor(draftHighlights[0], lastSelectionRect?.right || 0, lastSelectionRect?.bottom || 0);
  } catch (error) {
    setStatus(error.message || "\u7ffb\u8bd1\u5931\u8d25", true);
  } finally {
    translateButton.disabled = false;
    translateButton.textContent = "\u7ffb\u8bd1";
  }
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
    pdfViewer.parentElement.appendChild(bubble);
    initTranslationWindow(bubble);
  }

  bubble.querySelector(".translation-text").value = text;
  const frameRect = pdfViewer.parentElement.getBoundingClientRect();
  const rect = lastSelectionRect || frameRect;
  const bubbleWidth = bubble.offsetWidth || 360;
  const bubbleHeight = bubble.offsetHeight || 220;
  const left = Math.max(12, Math.min(rect.left - frameRect.left, frameRect.width - bubbleWidth - 12));
  const top = Math.max(12, Math.min(rect.bottom - frameRect.top + 10, frameRect.height - bubbleHeight - 12));
  bubble.style.left = `${left}px`;
  bubble.style.top = `${top}px`;
}

function showCommentWindow(text) {
  let bubble = document.querySelector("#commentBubble");
  if (!bubble) {
    bubble = document.createElement("section");
    bubble.id = "commentBubble";
    bubble.className = "translation-window comment-window";
    bubble.innerHTML = `
      <header class="translation-window-header">
        <span>Comment</span>
        <button class="translation-close" type="button" aria-label="Close comment">×</button>
      </header>
      <textarea class="translation-text comment-text" placeholder="Add a comment..." spellcheck="false"></textarea>
      <footer class="comment-actions">
        <button class="ghost comment-cancel" type="button">Cancel</button>
        <button class="comment-save" type="button">Save</button>
      </footer>
    `;
    pdfViewer.parentElement.appendChild(bubble);
    initTranslationWindow(bubble, hideCommentBubble);
    bubble.querySelector(".comment-save").addEventListener("click", saveComment);
    bubble.querySelector(".comment-cancel").addEventListener("click", hideCommentBubble);
  }

  bubble.querySelector(".comment-text").value = text;
  const frameRect = pdfViewer.parentElement.getBoundingClientRect();
  const rect = lastSelectionRect || frameRect;
  const bubbleWidth = bubble.offsetWidth || 360;
  const bubbleHeight = bubble.offsetHeight || 240;
  const left = Math.max(12, Math.min(rect.left - frameRect.left, frameRect.width - bubbleWidth - 12));
  const top = Math.max(12, Math.min(rect.bottom - frameRect.top + 10, frameRect.height - bubbleHeight - 12));
  bubble.style.left = `${left}px`;
  bubble.style.top = `${top}px`;
}

function saveComment() {
  const bubble = document.querySelector("#commentBubble");
  const comment = bubble?.querySelector(".comment-text")?.value.trim() || "";
  if (!comment || !commentDraftHighlights.length) return;

  commentDraftHighlights.forEach((highlight) => {
    const annotation = { ...highlight, comment };
    savedHighlights.push(annotation);
    const pageNode = pdfViewer.querySelector(`.pdf-page[data-page-number="${annotation.pageNumber}"]`);
    if (pageNode) drawHighlight(pageNode, annotation);
  });

  commentDraftHighlights = [];
  hideCommentBubble();
  window.getSelection()?.removeAllRanges();
  saveCurrentPaper().catch((error) => console.error("Failed to save comment.", error));
}

function handlePdfClick(event) {
  const selection = window.getSelection();
  if (selection && selection.toString().trim()) return;
  if (selectionMenu.contains(event.target)) return;

  const hit = findHighlightAtPoint(event.clientX, event.clientY);
  if (!hit) return;

  event.preventDefault();
  hideSelectionMenu();
  hideTranslationBubble();
  hideCommentBubble();
  showAnnotationEditor(hit.highlight, event.clientX, event.clientY);
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

function showAnnotationEditor(highlight, clientX, clientY) {
  activeHighlightGroupId = highlight.groupId || getHighlightKey(highlight);
  let editor = document.querySelector("#annotationEditor");
  if (!editor) {
    editor = document.createElement("section");
    editor.id = "annotationEditor";
    editor.className = "annotation-editor translation-window";
    editor.innerHTML = `
      <header class="translation-window-header">
        <span>Annotation</span>
        <button class="translation-close" type="button" aria-label="Close annotation editor">×</button>
      </header>
      <textarea class="translation-text annotation-comment" placeholder="Add or edit comment..." spellcheck="false"></textarea>
      <textarea class="translation-text annotation-translation" placeholder="Translation..." spellcheck="false"></textarea>
      <div class="annotation-colors" aria-label="Highlight color"></div>
      <footer class="comment-actions">
        <button class="danger annotation-delete" type="button">Delete</button>
        <button class="annotation-save" type="button">Save</button>
      </footer>
    `;
    pdfViewer.parentElement.appendChild(editor);
    initTranslationWindow(editor, hideAnnotationEditor);
    editor.querySelector(".annotation-save").addEventListener("click", saveAnnotationEdit);
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
  editor.querySelectorAll(".color-swatch").forEach((button) => {
    button.classList.toggle("active", button.dataset.color === color);
  });

  const frameRect = pdfViewer.parentElement.getBoundingClientRect();
  const editorWidth = editor.offsetWidth || 360;
  const editorHeight = editor.offsetHeight || 360;
  const left = Math.max(12, Math.min(clientX - frameRect.left + 10, frameRect.width - editorWidth - 12));
  const top = Math.max(12, Math.min(clientY - frameRect.top + 10, frameRect.height - editorHeight - 12));
  editor.style.left = `${left}px`;
  editor.style.top = `${top}px`;
}

function saveAnnotationEdit() {
  if (!activeHighlightGroupId) return;
  const editor = document.querySelector("#annotationEditor");
  const comment = editor?.querySelector(".annotation-comment")?.value.trim() || "";
  const translation = editor?.querySelector(".annotation-translation")?.value.trim() || "";
  const color = editor?.querySelector(".color-swatch.active")?.dataset.color || "yellow";
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
  redrawHighlights();
  hideAnnotationEditor();
  saveCurrentPaper().catch((error) => console.error("Failed to save annotation.", error));
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
    if (event.target === closeButton) return;
    event.preventDefault();
    const rect = bubble.getBoundingClientRect();
    const frameRect = pdfViewer.parentElement.getBoundingClientRect();
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

function hideCommentBubble() {
  document.querySelector("#commentBubble")?.remove();
  commentDraftHighlights = [];
}

function hideAnnotationEditor() {
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
    Object.assign(highlight, normalized);
    const key = [
      normalized.pageNumber,
      normalized.left.toFixed(5),
      normalized.top.toFixed(5),
      normalized.width.toFixed(5),
      normalized.height.toFixed(5),
      normalized.comment || "",
      normalized.translation || "",
      normalized.color || "",
    ].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function drawHighlight(pageNode, highlight) {
  const layer = pageNode.querySelector(".pdf-highlight-layer");
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
  if (highlight.comment || highlight.translation) {
    const pin = document.createElement("span");
    pin.className = "pdf-comment-pin";
    pin.dataset.groupId = highlight.groupId || getHighlightKey(highlight);
    pin.title = noteTitle;
    pin.style.left = `${(highlight.left + highlight.width) * pageNode.offsetWidth}px`;
    pin.style.top = `${highlight.top * pageNode.offsetHeight}px`;
    layer.appendChild(pin);
  }
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
    pageIndicator.textContent = "0 / 0";
    return;
  }
  pageIndicator.textContent = `${currentVisiblePage || 1} / ${total}`;
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
  for (const base of bases) {
    try {
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
    `${lastError?.message || "Failed to fetch"} Please start the Python server and open http://127.0.0.1:8000/ or http://127.0.0.1:8010/.`,
  );
}

function buildApiBaseCandidates() {
  const candidates = [];
  if (apiBaseUrl) candidates.push(apiBaseUrl);
  if (window.location.protocol === "http:" || window.location.protocol === "https:") {
    candidates.push("");
  }
  ["http://127.0.0.1:8000", "http://127.0.0.1:8010", "http://127.0.0.1:8765"].forEach((base) => {
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

  const items = Array.isArray(summary.keywords) ? summary.keywords : [];
  if (!items.length) {
    keywords.textContent = "No keywords returned.";
    return;
  }

  const fragment = document.createDocumentFragment();
  items.forEach((item) => {
    const node = document.createElement("span");
    node.className = "keyword-chip";
    node.textContent = typeof item === "string" ? item : item.term || "Unnamed term";
    fragment.appendChild(node);
  });
  keywords.appendChild(fragment);

  renderMethodSections(summary.methodSections || [], {
    fallbackText: summary.threeLineSummary?.method || "",
    overview: summary.methodOverview || "",
    conclusion: summary.methodConclusion || summary.threeLineSummary?.conclusion || "",
  });
}

function renderSummaryLoading(message = "Loading...") {
  keywords.innerHTML = "";
  methodSections.innerHTML = "";
  const keywordLoading = document.createElement("div");
  keywordLoading.className = "summary-loading";
  keywordLoading.textContent = message;
  keywords.appendChild(keywordLoading);

  challenges.textContent = "Loading...";
  method.textContent = "Loading...";
  conclusion.textContent = "Loading...";

  const methodLoading = document.createElement("div");
  methodLoading.className = "summary-loading summary-loading-large";
  methodLoading.textContent = message;
  methodSections.appendChild(methodLoading);
}

function renderMethodSections(sections, options = {}) {
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
      motivationNode.textContent = `动机：${section.motivation}`;
      article.appendChild(motivationNode);
    }

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
        const formulaNode = document.createElement("div");
        formulaNode.className = "formula-display";
        renderFormula(formulaNode, String(formula), true);
        formulaBox.appendChild(formulaNode);
      });
      article.appendChild(formulaBox);
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
        summary: text,
        bullets: [],
        formulas: extractFormulaLikeText(text),
      },
    ];
  }

  return chunks.slice(0, 5).map((chunk, index) => ({
    title: `Method point ${index + 1}`,
    summary: chunk,
    bullets: [],
    formulas: extractFormulaLikeText(chunk),
  }));
}

function extractFormulaLikeText(text) {
  return Array.from(text.matchAll(/(?:\\?[A-Za-z]+[A-Za-z0-9_{}α-ωΑ-Ω]*|[A-Za-z_][A-Za-z0-9_]*)\s*=\s*[^，。；;,.]+|[A-Z]=\([^)]+\)|O\([^)]+\)/g)).map(
    (match) => match[0],
  );
}

function formatInlineTechnicalText(text) {
  const pattern = /(\b[A-Z][A-Za-z0-9_-]{1,}\b|(?:\\?[A-Za-z]+[A-Za-z0-9_{}α-ωΑ-Ω]*|[A-Za-z_][A-Za-z0-9_]*)\s*=\s*[^，。；;,.]+|[A-Za-z]\([^)]+\)|G=\([^)]+\)|O\([^)]+\))/g;
  const nodes = [];
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    const mark = document.createElement("mark");
    mark.className = looksLikeFormula(match[0]) ? "formula-inline" : "term-inline";
    if (looksLikeFormula(match[0])) {
      renderFormula(mark, match[0], false);
    } else {
      mark.textContent = match[0];
    }
    nodes.push(mark);
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(document.createTextNode(text.slice(lastIndex)));
  }
  return nodes.length ? nodes : [document.createTextNode(text)];
}

function looksLikeFormula(value) {
  return /=|\(|\)|\+|-|\*|\/|\^|_/.test(value);
}

function normalizeFormulaSource(value) {
  return String(value || "")
    .replace(/^\s*(?:\$\$|\\\[|\\\()/, "")
    .replace(/(?:\$\$|\\\]|\\\))\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
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
  summarizeButton.disabled = isBusy;
}

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle("error", isError);
}

function clearStatus() {
  setStatus("");
}

