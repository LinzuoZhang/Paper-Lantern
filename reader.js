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
const toggleSummaryPaneButton = document.querySelector("#toggleSummaryPaneButton");
const selectionMenu = document.querySelector("#selectionMenu");
const highlightButton = document.querySelector("#highlightButton");
const commentButton = document.querySelector("#commentButton");
const translateButton = document.querySelector("#translateButton");
const translateWithContextButton = document.querySelector("#translateWithContextButton");
const explainButton = document.querySelector("#explainButton");
const emptyState = document.querySelector("#emptyState");
const fileName = document.querySelector("#fileName");
const readerPaperMenuButton = document.querySelector("#readerPaperMenuButton");
const pageIndicator = document.querySelector("#pageIndicator");
const pdfZoomOutButton = document.querySelector("#pdfZoomOutButton");
const pdfZoomInButton = document.querySelector("#pdfZoomInButton");
const pdfZoomLabel = document.querySelector("#pdfZoomLabel");
const pdfFitWidthButton = document.querySelector("#pdfFitWidthButton");
const pdfFitPageButton = document.querySelector("#pdfFitPageButton");
const pdfPageInput = document.querySelector("#pdfPageInput");
const pdfPageTotal = document.querySelector("#pdfPageTotal");
const pdfShortcutsButton = document.querySelector("#pdfShortcutsButton");
const pdfShortcutsOverlay = document.querySelector("#pdfShortcutsOverlay");
const pdfShortcutsCloseButton = document.querySelector("#pdfShortcutsCloseButton");
const summarizeButton = document.querySelector("#summarizeButton");
const statusText = document.querySelector("#status");
const challenges = document.querySelector("#challenges");
const method = document.querySelector("#method");
const conclusion = document.querySelector("#conclusion");
const keywords = document.querySelector("#keywords");
const methodSections = document.querySelector("#methodSections");
const discussionListView = document.querySelector("#discussionListView");
const discussionThreadView = document.querySelector("#discussionThreadView");
const discussionThreadList = document.querySelector("#discussionThreadList");
const backToDiscussionsButton = document.querySelector("#backToDiscussionsButton");
const discussionThreadTitle = document.querySelector("#discussionThreadTitle");
const discussionThreadMenuButton = document.querySelector("#discussionThreadMenuButton");
const discussionMessages = document.querySelector("#discussionMessages");
const discussionForm = document.querySelector("#discussionForm");
const discussionInput = document.querySelector("#discussionInput");
const discussionInputTarget = document.querySelector("#discussionInputTarget");
const discussionResizeHandle = document.querySelector("#discussionResizeHandle");
const sendDiscussionButton = document.querySelector("#sendDiscussionButton");
const continueInWebButton = document.querySelector("#continueInWebButton");
const clearDiscussionButton = document.querySelector("#clearDiscussionButton");
const readerTabs = document.querySelectorAll(".reader-tab");
const readerTabPanels = document.querySelectorAll(".reader-tab-panel");
const basicInfoButton = document.querySelector("#basicInfoButton");
const basicInfoStatus = document.querySelector("#basicInfoStatus");
const basicInfoAuthors = document.querySelector("#basicInfoAuthors");
const basicInfoVenue = document.querySelector("#basicInfoVenue");
const basicInfoDate = document.querySelector("#basicInfoDate");
const basicInfoInstitutions = document.querySelector("#basicInfoInstitutions");

let lastExtractedText = "";
let currentPdfTask = null;
let currentPdfDocument = null;
let pdfZoom = 1;
let pdfFitMode = "width";
let zoomRenderTimer = null;
let paneRenderTimer = null;
let pdfPageObserver = null;
let pdfPanState = null;
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
let discussionThreads = [];
let activeDiscussionId = null;
let discussionIsBusy = false;
let discussionInputResizeState = null;
let discussionThreadMenu = null;
let commentAutoSaveTimer = null;
let annotationAutoSaveTimer = null;
let discussionWebUrl = "https://chatgpt.com/";

const highlightColors = {
  yellow: "rgba(255, 221, 64, 0.42)",
  green: "rgba(120, 196, 162, 0.36)",
  blue: "rgba(111, 178, 214, 0.32)",
  pink: "rgba(239, 147, 171, 0.32)",
};

initPaneResizer();
initSummaryPaneToggle();
initPdfControls();
initReaderTabs();
initCollapsibleSummaryCards();
initReaderLibraryDrawer();
initDiscussionInputResizer();
loadDiscussionWebSettings().catch((error) => console.error("Failed to load discussion web settings.", error));
openReaderFromUrl();

readerPaperMenuButton?.addEventListener("click", (event) => {
  event.stopPropagation();
  if (currentPaper) showReaderPaperMenu(currentPaper, readerPaperMenuButton);
});

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
  readerPaperMenuButton.disabled = false;
  readerSelectedCategoryId = currentPaper.category || readerSelectedCategoryId;
  savedHighlights = normalizeHighlights(Array.isArray(currentPaper.highlights) ? currentPaper.highlights : []);
  renderDiscussionHistory(currentPaper.discussion || []);
  renderSummary(paperToSummary(currentPaper));
  renderBasicInfo(currentPaper.basicInfo);
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
    const cachedText = String(currentPaper.extractedText || "").trim();
    const extraction = cachedText.length >= 80 ? { text: cachedText, title: "" } : await extractPdfText(file);
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

    if (!cachedText) {
      saveExtractedTextCache(extractedText).catch((error) => console.error("Failed to save extracted text cache.", error));
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

function showReaderPaperMenu(paper, anchor) {
  document.querySelector(".reader-paper-menu")?.remove();
  const menu = document.createElement("div");
  menu.className = "paper-menu library-menu reader-paper-menu";
  menu.setAttribute("role", "menu");

  const moveButton = document.createElement("button");
  moveButton.type = "button";
  moveButton.textContent = "Move category";
  moveButton.addEventListener("click", () => {
    menu.remove();
    showReaderMovePaperMenu(paper, anchor).catch((error) => {
      console.error(error);
      setStatus(error.message || "Failed to load categories.", true);
    });
  });

  const exportLink = document.createElement("a");
  exportLink.href = `${apiBaseUrl || ""}/api/library/export?id=${encodeURIComponent(paper.id)}`;
  exportLink.download = `${paper.title || "paper"}-export.pdf`;
  exportLink.textContent = "Export";
  exportLink.addEventListener("click", (event) => {
    event.preventDefault();
    menu.remove();
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
    try {
      await updateReaderPaper({ action: "reveal", id: paper.id });
      setStatus("Opened the paper in File Explorer.");
    } catch (error) {
      console.error(error);
      setStatus(error.message || "Failed to show the paper in its folder.", true);
    }
  });

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.textContent = "Delete paper";
  deleteButton.addEventListener("click", async () => {
    menu.remove();
    if (!window.confirm(`Delete paper "${paper.title}"?`)) return;
    try {
      await updateReaderPaper({ action: "delete", id: paper.id });
      window.location.href = "./index.html";
    } catch (error) {
      console.error(error);
      setStatus(error.message || "Failed to delete the paper.", true);
    }
  });

  menu.append(moveButton, exportLink, revealButton, deleteButton);
  document.body.appendChild(menu);
  positionReaderPaperMenu(menu, anchor, 190);
}

async function showReaderMovePaperMenu(paper, anchor) {
  if (!readerLibraryTree) await loadReaderLibrary();
  document.querySelector(".reader-paper-menu")?.remove();
  const menu = document.createElement("div");
  menu.className = "paper-menu move-paper-menu library-menu reader-paper-menu";
  menu.setAttribute("role", "menu");

  const heading = document.createElement("div");
  heading.className = "move-menu-heading";
  heading.textContent = "Move to category";
  menu.appendChild(heading);

  flattenReaderCategories(readerLibraryTree)
    .forEach((category) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "move-category-option";
      button.style.paddingLeft = `${14 + category.depth * 14}px`;
      button.disabled = category.id === paper.category;
      button.textContent = category.id ? category.name : "Uncategorized";
      button.addEventListener("click", async () => {
        menu.remove();
        try {
          await updateReaderPaper({ action: "move", id: paper.id, category: category.id });
          readerSelectedCategoryId = category.id;
          await loadReaderLibrary();
          setStatus(`Moved to ${category.id ? category.name : "Uncategorized"}.`);
        } catch (error) {
          console.error(error);
          setStatus(error.message || "Failed to move the paper.", true);
        }
      });
      menu.appendChild(button);
    });

  const customButton = document.createElement("button");
  customButton.type = "button";
  customButton.className = "move-category-custom";
  customButton.textContent = "Enter new category...";
  customButton.addEventListener("click", async () => {
    menu.remove();
    const category = window.prompt("Target category / subfolder", paper.categoryName || paper.category || "Uncategorized");
    if (!category?.trim()) return;
    try {
      await updateReaderPaper({ action: "move", id: paper.id, category: category.trim() });
      readerSelectedCategoryId = currentPaper?.category || "";
      await loadReaderLibrary();
      setStatus("Moved to the new category.");
    } catch (error) {
      console.error(error);
      setStatus(error.message || "Failed to move the paper.", true);
    }
  });
  menu.appendChild(customButton);

  document.body.appendChild(menu);
  positionReaderPaperMenu(menu, anchor, 260);
}

function positionReaderPaperMenu(menu, anchor, width) {
  const rect = anchor.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))}px`;
  menu.style.top = `${rect.bottom + 4}px`;
}

async function updateReaderPaper(payload) {
  const response = await apiFetch("/api/library/paper", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await readJsonResponse(response);
  if (!response.ok) throw new Error(data.error || "Paper operation failed.");
  if (data.paper && currentPaper) currentPaper = { ...currentPaper, ...data.paper, extractedText: currentPaper.extractedText };
  if (data.tree) {
    readerLibraryTree = data.tree;
    renderReaderLibrary();
  }
  return data;
}

document.addEventListener("selectionchange", handlePdfSelectionChange);
pdfViewer.addEventListener("wheel", handlePdfWheel, { passive: false });
pdfViewer.addEventListener("scroll", updatePageIndicator);
pdfViewer.addEventListener("click", handlePdfClick);
pdfViewer.addEventListener("pointerdown", startPdfPan);
pdfViewer.addEventListener("pointermove", movePdfPan);
pdfViewer.addEventListener("pointerup", finishPdfPan);
pdfViewer.addEventListener("pointercancel", finishPdfPan);
document.addEventListener("keydown", handlePdfKeyboardShortcut);
document.addEventListener("pointerdown", (event) => {
  const translationBubble = document.querySelector("#translationBubble");
  const commentBubble = document.querySelector("#commentBubble");
  const annotationEditor = document.querySelector("#annotationEditor");
  const clickedFloatingUi =
    selectionMenu.contains(event.target) ||
    translationBubble?.contains(event.target) ||
    commentBubble?.contains(event.target) ||
    annotationEditor?.contains(event.target);
  const clickedDiscussionMenu = event.target.closest(".discussion-thread-menu") || event.target.closest(".discussion-thread-more-button");
  if (!event.target.closest(".library-menu") && !event.target.closest(".menu-button")) {
    document.querySelector(".library-menu")?.remove();
  }
  if (!clickedFloatingUi) {
    hideTranslationBubble();
    hideAnnotationEditor();
  }
  if (!clickedDiscussionMenu) closeDiscussionThreadMenu();

  if (!selectionMenu.contains(event.target) && !pdfViewer.contains(event.target)) {
    hideSelectionMenu();
  }
});

highlightButton.addEventListener("mousedown", (event) => event.preventDefault());
commentButton.addEventListener("mousedown", (event) => event.preventDefault());
translateButton.addEventListener("mousedown", (event) => event.preventDefault());
translateWithContextButton.addEventListener("mousedown", (event) => event.preventDefault());
explainButton.addEventListener("mousedown", (event) => event.preventDefault());
highlightButton.addEventListener("click", highlightSelection);
commentButton.addEventListener("click", commentSelection);
translateButton.addEventListener("click", translateSelection);
translateWithContextButton.addEventListener("click", () => translateSelection(true));
explainButton.addEventListener("click", explainSelection);
discussionForm?.addEventListener("submit", handleDiscussionSubmit);
discussionInput?.addEventListener("keydown", handleDiscussionInputKeydown);
continueInWebButton?.addEventListener("click", continueDiscussionOnWeb);
clearDiscussionButton?.addEventListener("click", () => {
  clearActiveDiscussion();
});
backToDiscussionsButton?.addEventListener("click", () => showDiscussionList());
discussionThreadMenuButton?.addEventListener("click", (event) => {
  const thread = discussionThreads.find((item) => item.id === activeDiscussionId);
  if (!thread) return;
  event.stopPropagation();
  toggleDiscussionThreadMenu(thread, discussionThreadTitle, discussionThreadMenuButton);
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

basicInfoButton?.addEventListener("click", async () => {
  const text = lastExtractedText.trim();
  if (text.length < 80) {
    setBasicInfoStatus("请先打开并解析一篇论文。", true);
    return;
  }

  setBusy(true);
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
    setBusy(false);
  }
});

function initReaderTabs() {
  readerTabs.forEach((tab) => {
    tab.addEventListener("click", () => setActiveReaderTab(tab.id));
  });
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
    basicInfo: paper.basicInfo || {},
    threeLineSummary: paper.threeLineSummary || {},
    methodOverview: paper.methodOverview || "",
    methodSections: paper.methodSections || [],
    methodConclusion: paper.methodConclusion || "",
  };
}

async function loadDiscussionWebSettings() {
  const response = await apiFetch("/api/settings");
  const data = await readJsonResponse(response);
  if (!response.ok) throw new Error(data.error || "Failed to load settings.");
  discussionWebUrl = normalizeDiscussionWebUrl(data.settings?.web?.discussionUrl);
}

function normalizeDiscussionWebUrl(value) {
  const url = String(value || "").trim() || "https://chatgpt.com/";
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.href;
  } catch {
    // Fall back to the default site if a saved URL is invalid.
  }
  return "https://chatgpt.com/";
}

async function continueDiscussionOnWeb() {
  if (!currentPaper) {
    setStatus("请先打开一篇论文。", true);
    return;
  }

  const targetUrl = normalizeDiscussionWebUrl(discussionWebUrl);
  const targetWindow = window.open(targetUrl, "_blank");
  if (targetWindow) targetWindow.opener = null;

  const [copied, revealed] = await Promise.all([
    copyTextToClipboard(buildDiscussionWebHandoff()),
    updateReaderPaper({ action: "reveal", id: currentPaper.id }).then(() => true).catch((error) => {
      console.warn("Failed to show the paper in its folder.", error);
      return false;
    }),
  ]);
  if (!targetWindow) {
    setStatus(copied ? "已复制讨论上下文，但浏览器阻止了新窗口。" : "浏览器阻止了新窗口，且无法复制讨论上下文。", true);
    return;
  }
  if (copied && revealed) setStatus("已复制讨论上下文、打开网页，并在文件夹中显示论文。");
  else if (copied) setStatus("已复制讨论上下文并打开网页，但未能显示论文所在文件夹。", true);
  else setStatus("已打开网页，但复制讨论上下文失败。", true);
}

function buildDiscussionWebHandoff() {
  const summary = paperToSummary(currentPaper) || {};
  const threeLine = summary.threeLineSummary || {};
  const thread = discussionThreads.find((item) => item.id === activeDiscussionId);
  const history = normalizeDiscussionHistory(thread?.messages || []);
  const recentHistory = history.slice(-16).map((message) => `${message.role === "user" ? "我" : "Paper Lantern AI"}：${message.content}`);
  const draft = discussionInput.value.trim();
  const sections = [
    "请基于以下论文与讨论上下文继续交流。若信息不足，请明确指出缺少什么。",
    `论文标题：${currentPaper.title || "未命名论文"}`,
  ];

  const summaryLines = [
    ["挑战", threeLine.challenges],
    ["核心方法", threeLine.method],
    ["结论", threeLine.conclusion],
    ["方法概览", summary.methodOverview],
  ]
    .filter(([, value]) => String(value || "").trim())
    .map(([label, value]) => `${label}：${String(value).trim()}`);
  if (summaryLines.length) sections.push(`论文摘要：\n${summaryLines.join("\n")}`);
  if (Array.isArray(summary.keywords) && summary.keywords.length) sections.push(`关键词：${summary.keywords.join("、")}`);
  sections.push(`当前 Discussion：${thread?.title || "新建 Discussion"}`);
  if (recentHistory.length) sections.push(`最近讨论记录：\n${recentHistory.join("\n\n")}`);
  if (draft) sections.push(`我现在想问：\n${draft}`);
  else sections.push("我接下来想继续讨论这篇论文，请结合以上内容回答。");
  return sections.join("\n\n");
}

async function copyTextToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (error) {
    console.warn("Clipboard API failed.", error);
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied;
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
        history: thread.messages,
      }),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.detail || data.error || "Discussion failed.");

    pending.classList.remove("pending");
    setDiscussionMessageContent(pending.querySelector(".discussion-message-body"), data.answer || "No response", "assistant");
    thread.messages.push({ role: "user", content: question }, { role: "assistant", content: data.answer || "" });
    thread.updatedAt = new Date().toISOString();
    if (!thread.title || thread.title === "New discussion") thread.title = makeDiscussionTitle(question);
    thread.hash = await makeDiscussionThreadHash(thread);
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

function createDiscussionThread(initialQuestion = "", shouldSave = false) {
  const thread = {
    id: makeDiscussionId(),
    title: initialQuestion ? makeDiscussionTitle(initialQuestion) : "New discussion",
    messages: [],
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

function ensureActiveDiscussion(initialQuestion = "") {
  let thread = discussionThreads.find((item) => item.id === activeDiscussionId);
  if (!thread) thread = createDiscussionThread(initialQuestion);
  return thread;
}

function showDiscussionList() {
  activeDiscussionId = null;
  discussionListView.hidden = false;
  discussionThreadView.hidden = true;
  renderDiscussionThreadList();
  updateDiscussionInputTarget();
}

function initDiscussionInputResizer() {
  if (!discussionResizeHandle || !discussionInput) return;
  const savedHeight = Number(localStorage.getItem("discussionInputHeight"));
  setDiscussionInputHeight(Number.isFinite(savedHeight) ? savedHeight : 74, false);

  discussionResizeHandle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    discussionInputResizeState = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: discussionInput.getBoundingClientRect().height,
    };
    discussionResizeHandle.setPointerCapture(event.pointerId);
    document.body.classList.add("resizing-discussion-input");
  });

  discussionResizeHandle.addEventListener("pointermove", (event) => {
    if (!discussionInputResizeState || event.pointerId !== discussionInputResizeState.pointerId) return;
    setDiscussionInputHeight(discussionInputResizeState.startHeight - (event.clientY - discussionInputResizeState.startY), false);
  });

  const finishResize = (event) => {
    if (!discussionInputResizeState || event.pointerId !== discussionInputResizeState.pointerId) return;
    if (discussionResizeHandle.hasPointerCapture(event.pointerId)) discussionResizeHandle.releasePointerCapture(event.pointerId);
    localStorage.setItem("discussionInputHeight", String(Math.round(discussionInput.getBoundingClientRect().height)));
    discussionInputResizeState = null;
    document.body.classList.remove("resizing-discussion-input");
  };
  discussionResizeHandle.addEventListener("pointerup", finishResize);
  discussionResizeHandle.addEventListener("pointercancel", finishResize);
  discussionResizeHandle.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const direction = event.key === "ArrowUp" ? 1 : -1;
    setDiscussionInputHeight(discussionInput.getBoundingClientRect().height + direction * 16);
  });
}

function setDiscussionInputHeight(value, save = true) {
  if (!discussionInput || !discussionResizeHandle) return;
  const height = Math.round(clamp(Number(value) || 74, 74, 360));
  discussionInput.style.height = `${height}px`;
  discussionResizeHandle.setAttribute("aria-valuenow", String(height));
  if (save) localStorage.setItem("discussionInputHeight", String(height));
}

function showDiscussionThread(threadId) {
  const thread = discussionThreads.find((item) => item.id === threadId);
  if (!thread) return showDiscussionList();
  activeDiscussionId = thread.id;
  discussionListView.hidden = true;
  discussionThreadView.hidden = false;
  renderDiscussionThreadHeader(thread);
  renderDiscussionMessages(thread.messages);
  updateDiscussionInputTarget();
}

function renderDiscussionThreadHeader(thread) {
  if (!discussionThreadTitle) return;
  discussionThreadTitle.textContent = thread?.title || "New discussion";
  discussionThreadTitle.title = thread?.title || "New discussion";
  updateDiscussionInputTarget();
}

function updateDiscussionInputTarget() {
  if (!discussionInputTarget || !discussionInput) return;
  const thread = discussionThreads.find((item) => item.id === activeDiscussionId);
  if (!thread) {
    discussionInputTarget.textContent = "新建 Discussion";
    discussionInputTarget.title = "发送后将新建一个 Discussion 会话";
    discussionInput.placeholder = "输入问题后将新建一个 Discussion...";
    return;
  }

  const title = thread.title || "未命名 Discussion";
  discussionInputTarget.textContent = `继续：${title}`;
  discussionInputTarget.title = `将继续当前会话：${title}`;
  discussionInput.placeholder = `继续“${title}”...`;
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
    const openButton = document.createElement("div");
    openButton.className = "discussion-thread-open-button";
    openButton.dataset.threadId = thread.id;
    openButton.tabIndex = 0;
    openButton.setAttribute("role", "button");
    openButton.setAttribute("aria-label", `打开 Discussion：${thread.title || "未命名 Discussion"}`);
    const title = document.createElement("span");
    title.className = "discussion-thread-item-title";
    title.textContent = thread.title || "New discussion";
    const meta = document.createElement("span");
    meta.className = "discussion-thread-item-meta";
    const turnCount = Math.ceil((thread.messages || []).length / 2);
    meta.textContent = `${turnCount || 0} turns`;
    openButton.append(title, meta);
    openButton.addEventListener("click", () => showDiscussionThread(thread.id));
    openButton.addEventListener("keydown", (event) => {
      if (event.target !== openButton) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        showDiscussionThread(thread.id);
      }
    });

    const moreButton = document.createElement("button");
    moreButton.className = "discussion-thread-more-button";
    moreButton.type = "button";
    moreButton.textContent = "•••";
    moreButton.setAttribute("aria-label", "会话选项");
    moreButton.title = "会话选项";
    moreButton.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleDiscussionThreadMenu(thread, title, moreButton);
    });
    item.append(openButton, moreButton);
    discussionThreadList.appendChild(item);
  });
}

function toggleDiscussionThreadMenu(thread, titleNode, anchor) {
  if (discussionThreadMenu?.dataset.threadId === thread.id) {
    closeDiscussionThreadMenu();
    return;
  }
  closeDiscussionThreadMenu();
  const menu = document.createElement("div");
  menu.className = "discussion-thread-menu";
  menu.dataset.threadId = thread.id;

  const renameButton = document.createElement("button");
  renameButton.type = "button";
  renameButton.textContent = "重命名";
  renameButton.addEventListener("click", () => {
    closeDiscussionThreadMenu();
    beginDiscussionRename(thread, titleNode);
  });

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "danger";
  deleteButton.textContent = "删除会话";
  deleteButton.addEventListener("click", () => showDiscussionDeleteConfirmation(thread));
  menu.append(renameButton, deleteButton);
  document.body.appendChild(menu);
  discussionThreadMenu = menu;

  const rect = anchor.getBoundingClientRect();
  const width = 154;
  menu.style.left = `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))}px`;
  menu.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - 92)}px`;
}

function showDiscussionDeleteConfirmation(thread) {
  if (!discussionThreadMenu) return;
  discussionThreadMenu.replaceChildren();
  const message = document.createElement("p");
  message.textContent = "删除这个会话？";
  const actions = document.createElement("div");
  actions.className = "discussion-thread-menu-actions";
  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.textContent = "取消";
  cancelButton.addEventListener("click", closeDiscussionThreadMenu);
  const confirmButton = document.createElement("button");
  confirmButton.type = "button";
  confirmButton.className = "danger";
  confirmButton.textContent = "确认删除";
  confirmButton.addEventListener("click", async () => {
    discussionThreads = discussionThreads.filter((item) => item.id !== thread.id);
    const wasActive = activeDiscussionId === thread.id;
    closeDiscussionThreadMenu();
    if (wasActive) showDiscussionList();
    else renderDiscussionThreadList();
    await saveDiscussionThreads();
  });
  actions.append(cancelButton, confirmButton);
  discussionThreadMenu.append(message, actions);
}

function closeDiscussionThreadMenu() {
  discussionThreadMenu?.remove();
  discussionThreadMenu = null;
}

function beginDiscussionRename(thread, titleNode) {
  const input = document.createElement("input");
  input.className = "discussion-thread-title-input";
  input.type = "text";
  input.value = thread.title || "";
  input.maxLength = 80;
  input.setAttribute("aria-label", "Discussion 名称");
  titleNode.replaceWith(input);
  input.focus();
  input.select();

  let finished = false;
  const finish = async (save) => {
    if (finished) return;
    finished = true;
    const title = String(input.value).replace(/\s+/g, " ").trim().slice(0, 80);
    if (save && title && title !== thread.title) {
      thread.title = title;
      thread.updatedAt = new Date().toISOString();
      thread.hash = await makeDiscussionThreadHash(thread);
      if (thread.id === activeDiscussionId) renderDiscussionThreadHeader(thread);
      await saveDiscussionThreads();
    }
    renderDiscussionThreadList();
  };

  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  });
  input.addEventListener("blur", () => finish(true));
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
  const lines = String(content || "").split(/\r?\n/);
  const blocks = [];
  let paragraph = [];
  let list = [];
  let inCodeBlock = false;
  let codeLines = [];
  let inMathBlock = false;
  let mathDelimiter = "";
  let mathLines = [];

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
    blocks.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
    codeLines = [];
  };
  const flushMath = () => {
    blocks.push(renderDiscussionMath(mathLines.join("\n"), true));
    mathLines = [];
    mathDelimiter = "";
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*```/.test(line)) {
      if (inCodeBlock) {
        flushCode();
        inCodeBlock = false;
      } else {
        flushParagraph();
        flushList();
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (inMathBlock) {
      if ((mathDelimiter === "$$" && /^\s*\$\$\s*$/.test(line)) || (mathDelimiter === "\\[" && /^\s*\\\]\s*$/.test(line))) {
        flushMath();
        inMathBlock = false;
      } else {
        mathLines.push(line);
      }
      continue;
    }

    const singleLineMath = line.match(/^\s*\$\$\s*(.*?)\s*\$\$\s*$/) || line.match(/^\s*\\\[\s*(.*?)\s*\\\]\s*$/);
    if (singleLineMath) {
      flushParagraph();
      flushList();
      blocks.push(renderDiscussionMath(singleLineMath[1], true));
      continue;
    }

    const mathStart = line.match(/^\s*(\$\$|\\\[)\s*$/);
    if (mathStart) {
      flushParagraph();
      flushList();
      inMathBlock = true;
      mathDelimiter = mathStart[1];
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length + 3;
      blocks.push(`<h${level}>${formatDiscussionInline(heading[2])}</h${level}>`);
      continue;
    }

    const bullet = line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    if (isMarkdownTableHeader(line, lines[index + 1])) {
      flushParagraph();
      flushList();
      const headers = splitMarkdownTableRow(line);
      const alignments = getMarkdownTableAlignments(lines[index + 1]);
      const rows = [];
      index += 2;
      while (index < lines.length && isMarkdownTableRow(lines[index])) {
        rows.push(splitMarkdownTableRow(lines[index]));
        index += 1;
      }
      index -= 1;
      blocks.push(renderDiscussionTable(headers, alignments, rows));
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  if (inCodeBlock) flushCode();
  if (inMathBlock) flushMath();
  flushParagraph();
  flushList();
  return blocks.join("") || "<p>No response</p>";
}

function splitMarkdownTableRow(line) {
  const trimmed = String(line || "").trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function isMarkdownTableRow(line) {
  return String(line || "").includes("|") && splitMarkdownTableRow(line).length >= 2;
}

function isMarkdownTableHeader(headerLine, dividerLine) {
  if (!isMarkdownTableRow(headerLine) || !dividerLine) return false;
  const columns = splitMarkdownTableRow(dividerLine);
  return columns.length >= 2 && columns.every((column) => /^:?-+:?$/.test(column));
}

function getMarkdownTableAlignments(dividerLine) {
  return splitMarkdownTableRow(dividerLine).map((column) => {
    const starts = column.startsWith(":");
    const ends = column.endsWith(":");
    if (starts && ends) return "center";
    if (ends) return "right";
    return "left";
  });
}

function renderDiscussionTable(headers, alignments, rows) {
  const cells = (items, tagName) =>
    headers
      .map((_, index) => {
        const alignment = alignments[index] || "left";
        const value = items[index] || "";
        return `<${tagName} style="text-align:${alignment}">${formatDiscussionInline(value)}</${tagName}>`;
      })
      .join("");
  const body = rows.map((row) => `<tr>${cells(row, "td")}</tr>`).join("");
  return `<div class="markdown-table-wrap"><table><thead><tr>${cells(headers, "th")}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function formatDiscussionInline(text) {
  const tokens = [];
  const addToken = (html) => {
    const token = `@@PAPER_LANTERN_TOKEN_${tokens.length}@@`;
    tokens.push({ token, html });
    return token;
  };

  let value = String(text || "")
    .replace(/`([^`]+)`/g, (_, code) => addToken(`<code>${escapeHtml(code)}</code>`))
    .replace(/\\\((.+?)\\\)/g, (_, formula) => addToken(renderDiscussionMath(formula, false)))
    .replace(/(^|[^\\$])\$(?!\$)([^$\n]+?)\$(?!\$)/g, (_, prefix, formula) => `${prefix}${addToken(renderDiscussionMath(formula, false))}`);

  value = escapeHtml(value)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");

  tokens.forEach(({ token, html }) => {
    value = value.split(token).join(html);
  });
  return value;
}

function renderDiscussionMath(source, displayMode) {
  const formula = normalizeFormulaSource(source);
  if (!formula) return "";
  if (!window.katex) {
    return `<code class="discussion-math-fallback">${escapeHtml(formula)}</code>`;
  }
  try {
    return window.katex.renderToString(formula, {
      displayMode,
      throwOnError: false,
      strict: "ignore",
      trust: false,
    });
  } catch (error) {
    console.warn("Failed to render discussion formula.", error);
    return `<code class="discussion-math-fallback">${escapeHtml(formula)}</code>`;
  }
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

async function clearActiveDiscussion() {
  const thread = discussionThreads.find((item) => item.id === activeDiscussionId);
  if (!thread) return false;
  thread.messages = [];
  thread.updatedAt = new Date().toISOString();
  thread.hash = await makeDiscussionThreadHash(thread);
  renderDiscussionMessages(thread.messages);
  renderDiscussionThreadList();
  await saveDiscussionThreads();
  return true;
}

function renderDiscussionHistory(discussion) {
  discussionThreads = normalizeDiscussionThreads(discussion);
  activeDiscussionId = null;
  renderDiscussionThreadList();
  showDiscussionList();
}

function renderDiscussionMessages(history) {
  clearDiscussionMessages();
  normalizeDiscussionHistory(history).forEach((message) => appendDiscussionMessage(message.role, message.content));
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

async function makeDiscussionThreadHash(thread) {
  const stable = {
    id: thread.id,
    title: thread.title,
    messages: normalizeDiscussionHistory(thread.messages || []),
    createdAt: thread.createdAt || "",
    updatedAt: thread.updatedAt || "",
  };
  const json = JSON.stringify(stable);
  if (!crypto?.subtle) return String(Date.now());
  const bytes = new TextEncoder().encode(json);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function saveDiscussionThreads() {
  if (!currentPaper) return;
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

async function saveCurrentPaper(extra = {}) {
  if (!currentPaper) return;
  const response = await apiFetch("/api/library/paper", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: currentPaper.id, ...extra }),
  });
  const data = await readJsonResponse(response);
  if (response.ok) currentPaper = data.paper;
}

async function saveHighlights() {
  savedHighlights = normalizeHighlights(savedHighlights);
  await saveCurrentPaper({ highlights: savedHighlights });
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

function initPdfControls() {
  pdfZoomOutButton?.addEventListener("click", () => changePdfZoom(-0.15));
  pdfZoomInButton?.addEventListener("click", () => changePdfZoom(0.15));
  pdfFitWidthButton?.addEventListener("click", () => setPdfFitMode("width"));
  pdfFitPageButton?.addEventListener("click", () => setPdfFitMode("page"));
  pdfPageInput?.addEventListener("change", () => goToPdfPage(Number(pdfPageInput.value)));
  pdfPageInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    goToPdfPage(Number(pdfPageInput.value));
    pdfPageInput.blur();
  });
  pdfShortcutsButton?.addEventListener("click", openPdfShortcuts);
  pdfShortcutsCloseButton?.addEventListener("click", closePdfShortcuts);
  pdfShortcutsOverlay?.addEventListener("pointerdown", (event) => {
    if (event.target === pdfShortcutsOverlay) closePdfShortcuts();
  });
  updatePdfControls();
}

function openPdfShortcuts() {
  if (!pdfShortcutsOverlay) return;
  pdfShortcutsOverlay.hidden = false;
  pdfShortcutsCloseButton?.focus();
}

function closePdfShortcuts() {
  if (!pdfShortcutsOverlay) return;
  pdfShortcutsOverlay.hidden = true;
  pdfShortcutsButton?.focus();
}

function updatePdfControls() {
  const isReady = Boolean(currentPdfDocument);
  [pdfZoomOutButton, pdfZoomInButton, pdfFitWidthButton, pdfFitPageButton, pdfPageInput].forEach((control) => {
    if (control) control.disabled = !isReady;
  });
  if (pdfZoomLabel) pdfZoomLabel.textContent = `${Math.round(pdfZoom * 100)}%`;
  if (pdfFitWidthButton) pdfFitWidthButton.classList.toggle("active", pdfFitMode === "width");
  if (pdfFitPageButton) pdfFitPageButton.classList.toggle("active", pdfFitMode === "page");
  if (pdfPageInput) {
    pdfPageInput.min = "1";
    pdfPageInput.max = String(currentPdfDocument?.numPages || 1);
  }
  if (pdfPageTotal) pdfPageTotal.textContent = `/ ${currentPdfDocument?.numPages || 0}`;
}

function changePdfZoom(amount, anchor = null) {
  if (!currentPdfDocument) return;
  const nextZoom = clamp(pdfZoom + amount, 0.5, 3.5);
  if (nextZoom === pdfZoom) return;
  pdfFitMode = "manual";
  setPdfZoom(nextZoom, anchor);
}

function setPdfFitMode(mode) {
  if (!currentPdfDocument) return;
  pdfFitMode = mode === "page" ? "page" : "width";
  setPdfZoom(1);
}

function setPdfZoom(nextZoom, anchor = null) {
  const previousZoom = pdfZoom;
  const scrollRatio = getViewerScrollRatio();
  pdfZoom = nextZoom;
  updatePdfControls();
  schedulePdfRerender(scrollRatio, anchor, previousZoom);
}

function getPdfZoomAnchor(event) {
  const rect = pdfViewer.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(event.clientX - rect.left, rect.width)),
    y: Math.max(0, Math.min(event.clientY - rect.top, rect.height)),
    contentX: pdfViewer.scrollLeft + Math.max(0, Math.min(event.clientX - rect.left, rect.width)),
    contentY: pdfViewer.scrollTop + Math.max(0, Math.min(event.clientY - rect.top, rect.height)),
  };
}

function goToPdfPage(pageNumber) {
  if (!currentPdfDocument) return;
  const page = clamp(Math.round(Number(pageNumber) || 1), 1, currentPdfDocument.numPages);
  const pageNode = pdfViewer.querySelector(`.pdf-page[data-page-number="${page}"]`);
  if (pageNode) {
    pdfViewer.scrollTo({ top: Math.max(pageNode.offsetTop - 12, 0), behavior: "smooth" });
    renderPdfPage(page, currentPdfTask).catch((error) => console.error("Failed to render requested page.", error));
  }
  if (pdfPageInput) pdfPageInput.value = String(page);
}

function handlePdfKeyboardShortcut(event) {
  if (event.key === "Escape" && !pdfShortcutsOverlay?.hidden) {
    closePdfShortcuts();
    return;
  }
  const target = event.target;
  const isTyping = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
  if (isTyping) return;

  if (event.type === "keydown" && (event.ctrlKey || event.metaKey) && ["+", "=", "-", "0"].includes(event.key)) {
    event.preventDefault();
    if (event.key === "0") setPdfFitMode("width");
    else changePdfZoom(event.key === "-" ? -0.15 : 0.15);
    return;
  }

}

function startPdfPan(event) {
  if (event.button !== 1 || !currentPdfDocument) return;
  event.preventDefault();
  hideSelectionMenu();
  pdfPanState = {
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
    scrollLeft: pdfViewer.scrollLeft,
    scrollTop: pdfViewer.scrollTop,
  };
  pdfViewer.setPointerCapture(event.pointerId);
  pdfViewer.classList.add("is-panning");
}

function movePdfPan(event) {
  if (!pdfPanState || event.pointerId !== pdfPanState.pointerId) return;
  pdfViewer.scrollLeft = pdfPanState.scrollLeft - (event.clientX - pdfPanState.clientX);
  pdfViewer.scrollTop = pdfPanState.scrollTop - (event.clientY - pdfPanState.clientY);
}

function finishPdfPan(event) {
  if (!pdfPanState || event.pointerId !== pdfPanState.pointerId) return;
  if (pdfViewer.hasPointerCapture(event.pointerId)) pdfViewer.releasePointerCapture(event.pointerId);
  pdfPanState = null;
  pdfViewer.classList.remove("is-panning");
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

function initSummaryPaneToggle() {
  const isCollapsed = localStorage.getItem("summaryPaneCollapsed") === "true";
  setSummaryPaneCollapsed(isCollapsed, false);
  toggleSummaryPaneButton?.addEventListener("click", () => {
    const nextCollapsed = !appShell.classList.contains("summary-pane-collapsed");
    setSummaryPaneCollapsed(nextCollapsed);
  });
}

function setSummaryPaneCollapsed(isCollapsed, shouldRefreshPdf = true) {
  appShell.classList.toggle("summary-pane-collapsed", isCollapsed);
  toggleSummaryPaneButton?.setAttribute("aria-expanded", String(!isCollapsed));
  toggleSummaryPaneButton?.setAttribute("aria-label", isCollapsed ? "Expand summary pane" : "Collapse summary pane");
  localStorage.setItem("summaryPaneCollapsed", String(isCollapsed));
  if (shouldRefreshPdf) refreshPdfAfterPaneResize();
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
  pdfFitMode = "width";
  updatePdfControls();
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
  updatePdfControls();

  await renderPdfPages(renderId);
}

async function renderPdfPages(renderId = Symbol("pdfRender")) {
  if (!currentPdfDocument) return;
  currentPdfTask = renderId;
  pdfPageObserver?.disconnect();
  pdfViewer.innerHTML = "";
  const firstPage = await currentPdfDocument.getPage(1);
  if (currentPdfTask !== renderId) return;
  const viewport = getPdfPageViewport(firstPage);
  for (let pageNumber = 1; pageNumber <= currentPdfDocument.numPages; pageNumber += 1) {
    const pageNode = document.createElement("article");
    pageNode.className = "pdf-page pending";
    pageNode.dataset.pageNumber = String(pageNumber);
    pageNode.style.width = `${viewport.width}px`;
    pageNode.style.height = `${viewport.height}px`;
    pdfViewer.appendChild(pageNode);
  }
  observePdfPages(renderId);
  await renderPdfPage(1, renderId);
  updatePageIndicator();
}

function observePdfPages(renderId) {
  pdfPageObserver?.disconnect();
  pdfPageObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting || currentPdfTask !== renderId) return;
        const pageNumber = Number(entry.target.dataset.pageNumber);
        renderPdfPage(pageNumber, renderId).catch((error) => console.error("Failed to render PDF page.", error));
      });
    },
    { root: pdfViewer, rootMargin: "900px 0px" },
  );
  pdfViewer.querySelectorAll(".pdf-page").forEach((pageNode) => pdfPageObserver.observe(pageNode));
}

function getPdfPageViewport(page) {
  const containerWidth = Math.max(pdfViewer.clientWidth - 36, 320);
  const baseViewport = page.getViewport({ scale: 1 });
  const containerHeight = Math.max(pdfViewer.clientHeight - 36, 320);
  const widthScale = Math.min(containerWidth / baseViewport.width, 1.6);
  const fitScale = pdfFitMode === "page" ? Math.min(widthScale, containerHeight / baseViewport.height) : widthScale;
  return page.getViewport({ scale: fitScale * pdfZoom });
}

async function renderPdfPage(pageNumber, renderId) {
  if (!currentPdfDocument || currentPdfTask !== renderId) return;
  const pageNode = pdfViewer.querySelector(`.pdf-page[data-page-number="${pageNumber}"]`);
  if (!pageNode || pageNode.dataset.rendered === "true" || pageNode.dataset.rendering === "true") return;
  pageNode.dataset.rendering = "true";
  const page = await currentPdfDocument.getPage(pageNumber);
  if (currentPdfTask !== renderId) return;
  const viewport = getPdfPageViewport(page);
  const outputScale = window.devicePixelRatio || 1;

  pageNode.innerHTML = "";
  pageNode.classList.remove("pending");
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
  textLayer.style.setProperty("--scale-factor", `${viewport.scale}`);

  pageNode.append(canvas, highlightLayer, textLayer);

  const textContent = await page.getTextContent();
  if (currentPdfTask !== renderId) return;
  await new pdfjsLib.TextLayer({
    textContentSource: textContent,
    container: textLayer,
    viewport,
  }).render();
  if (currentPdfTask !== renderId) return;
  pageNode.dataset.rendered = "true";
  delete pageNode.dataset.rendering;
  restoreHighlightsForPage(pageNode);
}

function handlePdfWheel(event) {
  if (!event.ctrlKey || !currentPdfDocument) return;

  event.preventDefault();
  hideSelectionMenu();
  hideTranslationBubble();
  window.getSelection()?.removeAllRanges();

  const direction = event.deltaY < 0 ? 1 : -1;
  changePdfZoom(direction * 0.12, getPdfZoomAnchor(event));
}

function schedulePdfRerender(scrollRatio, anchor = null, previousZoom = pdfZoom) {
  window.clearTimeout(zoomRenderTimer);
  zoomRenderTimer = window.setTimeout(async () => {
    const renderId = Symbol("pdfZoomRender");
    await renderPdfPages(renderId);
    if (anchor && previousZoom > 0) {
      const factor = pdfZoom / previousZoom;
      pdfViewer.scrollLeft = Math.max(0, anchor.contentX * factor - anchor.x);
      pdfViewer.scrollTop = Math.max(0, anchor.contentY * factor - anchor.y);
      updatePageIndicator();
    } else {
      setViewerScrollRatio(scrollRatio);
    }
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
  renderBasicInfo(data.summary?.basicInfo);
  await saveCurrentPaper({ summary: data.summary });
  if (data.summary?.paperTitle) {
    fileName.textContent = data.summary.paperTitle;
    fileName.title = data.summary.paperTitle;
  }
  clearStatus();
}

async function refreshOverviewInfo(text) {
  const response = await apiFetch("/api/overview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paperText: text }),
  });
  const data = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(data.detail || data.error || "Overview extraction failed.");
  }

  renderKeywords(data.overviewInfo?.keywords || []);
  renderBasicInfo(data.overviewInfo?.basicInfo);
  await saveCurrentPaper({ overviewInfo: data.overviewInfo });
  if (data.overviewInfo?.paperTitle) {
    fileName.textContent = data.overviewInfo.paperTitle;
    fileName.title = data.overviewInfo.paperTitle;
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
  saveHighlights().catch((error) => console.error("Failed to save highlights.", error));
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

async function translateSelection(withContext = false) {
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

  hideCommentBubble();
  const button = withContext ? translateWithContextButton : translateButton;
  button.disabled = true;
  button.textContent = "\u7ffb\u8bd1\u4e2d";
  try {
    const requestPayload = { text };
    if (withContext) {
      requestPayload.summary = paperToSummary(currentPaper);
      requestPayload.surroundingContext = getTranslationSurroundingContext(lastExtractedText, text);
    }
    const response = await apiFetch(withContext ? "/api/translate-context" : "/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestPayload),
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
    await saveHighlights();
    showAnnotationEditor(draftHighlights[0], lastSelectionRect?.right || 0, lastSelectionRect?.bottom || 0);
  } catch (error) {
    setStatus(error.message || "\u7ffb\u8bd1\u5931\u8d25", true);
  } finally {
    button.disabled = false;
    button.textContent = withContext ? "\u7ed3\u5408\u4e0a\u4e0b\u6587\u7ffb\u8bd1" : "\u7ffb\u8bd1";
  }
}

function getTranslationSurroundingContext(paperText, selectedText) {
  const source = String(paperText || "").replace(/\s+/g, " ").trim();
  const target = String(selectedText || "").replace(/\s+/g, " ").trim();
  if (!source || !target) return "";

  const index = source.indexOf(target);
  if (index < 0) return "";

  const radius = 1500;
  const start = Math.max(0, index - radius);
  const end = Math.min(source.length, index + target.length + radius);
  return `${start > 0 ? "…" : ""}${source.slice(start, end)}${end < source.length ? "…" : ""}`;
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
  hideCommentBubble();
  explainButton.disabled = true;
  explainButton.textContent = "\u89e3\u91ca\u4e2d";
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
    showAnnotationEditor(draftHighlights[0], lastSelectionRect?.right || 0, lastSelectionRect?.bottom || 0);
    saveHighlights().catch((error) => console.error("Failed to save explanation annotation.", error));
  } catch (error) {
    setStatus(error.message || "\u89e3\u91ca\u5931\u8d25", true);
  } finally {
    explainButton.disabled = false;
    explainButton.textContent = "\u89e3\u91ca";
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
        <button class="ghost comment-cancel" type="button">Close</button>
      </footer>
    `;
    pdfViewer.parentElement.appendChild(bubble);
    initTranslationWindow(bubble, hideCommentBubble);
    bubble.querySelector(".comment-text").addEventListener("input", scheduleCommentAutoSave);
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

function scheduleCommentAutoSave() {
  window.clearTimeout(commentAutoSaveTimer);
  commentAutoSaveTimer = window.setTimeout(() => {
    saveCommentDraft().catch((error) => console.error("Failed to auto-save comment.", error));
  }, 450);
}

async function saveCommentDraft() {
  const bubble = document.querySelector("#commentBubble");
  const comment = bubble?.querySelector(".comment-text")?.value.trim() || "";
  if (!commentDraftHighlights.length) return;

  const draftGroupId = commentDraftHighlights[0].groupId;
  const hasSavedDraft = savedHighlights.some((highlight) => isSameHighlightGroup(highlight, draftGroupId));
  if (!comment) {
    if (hasSavedDraft) {
      savedHighlights = savedHighlights.filter((highlight) => !isSameHighlightGroup(highlight, draftGroupId));
      redrawHighlights();
      await saveHighlights();
    }
    return;
  }

  if (hasSavedDraft) {
    savedHighlights = savedHighlights.map((highlight) => {
      if (!isSameHighlightGroup(highlight, draftGroupId)) return highlight;
      return { ...highlight, comment, type: highlight.translation ? "comment-translation" : "comment" };
    });
    redrawHighlights();
  } else {
    commentDraftHighlights.forEach((highlight) => {
      const annotation = { ...highlight, comment };
      savedHighlights.push(annotation);
      const pageNode = pdfViewer.querySelector(`.pdf-page[data-page-number="${annotation.pageNumber}"]`);
      if (pageNode) drawHighlight(pageNode, annotation);
    });
  }

  window.getSelection()?.removeAllRanges();
  await saveHighlights();
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
        <button class="annotation-mode-toggle" type="button" data-annotation-mode="edit">Preview</button>
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
    pdfViewer.parentElement.appendChild(editor);
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
  setAnnotationMode(editor, "edit");
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
    toggle.dataset.annotationMode = nextMode;
    toggle.textContent = nextMode === "preview" ? "Edit" : "Preview";
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
  await saveHighlights();
}

function deleteActiveHighlight() {
  if (!activeHighlightGroupId) return;
  savedHighlights = savedHighlights.filter((highlight) => !isSameHighlightGroup(highlight, activeHighlightGroupId));
  redrawHighlights();
  hideAnnotationEditor();
  saveHighlights().catch((error) => console.error("Failed to delete annotation.", error));
}

function initTranslationWindow(bubble, closeHandler = hideTranslationBubble) {
  const header = bubble.querySelector(".translation-window-header");
  const closeButton = bubble.querySelector(".translation-close");
  closeButton.addEventListener("click", closeHandler);
  header.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) return;
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
  window.clearTimeout(commentAutoSaveTimer);
  saveCommentDraft().catch((error) => console.error("Failed to auto-save comment.", error));
  document.querySelector("#commentBubble")?.remove();
  commentDraftHighlights = [];
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
  pdfViewer.querySelectorAll(".pdf-page[data-rendered='true']").forEach(restoreHighlightsForPage);
}

function restoreHighlightsForPage(pageNode) {
  if (!pageNode?.dataset?.pageNumber) return;
  const pageNumber = Number(pageNode.dataset.pageNumber);
  savedHighlights
    .filter((highlight) => highlight.pageNumber === pageNumber)
    .forEach((highlight) => drawHighlight(pageNode, highlight));
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
  const tried = [];
  for (const base of bases) {
    try {
      tried.push(base || window.location.origin || "current origin");
      const response = await fetch(`${base}${url}`, options);
      const isPaperLanternResponse = response.headers.get("X-Paper-Lantern") === "1";
      if (response.status !== 404 || !url.startsWith("/api/") || isPaperLanternResponse) {
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

  renderKeywords(summary.keywords || []);

  renderMethodSections(summary.methodSections || [], {
    fallbackText: summary.threeLineSummary?.method || "",
    overview: summary.methodOverview || "",
    conclusion: summary.methodConclusion || summary.threeLineSummary?.conclusion || "",
  });
}

function renderKeywords(items) {
  keywords.innerHTML = "";
  const normalized = Array.isArray(items) ? items : [];
  if (!normalized.length) {
    keywords.textContent = "No keywords returned.";
    return;
  }

  const fragment = document.createDocumentFragment();
  normalized.forEach((item) => {
    const node = document.createElement("span");
    node.className = "keyword-chip";
    node.textContent = typeof item === "string" ? item : item.term || "Unnamed term";
    fragment.appendChild(node);
  });
  keywords.appendChild(fragment);
}

function renderBasicInfo(info) {
  const normalized = info && typeof info === "object" ? info : {};
  basicInfoAuthors.textContent = formatBasicInfoValue(normalized.authors);
  basicInfoVenue.textContent = formatBasicInfoValue(normalized.venue);
  basicInfoDate.textContent = formatBasicInfoValue(normalized.publishedDate);
  basicInfoInstitutions.textContent = formatBasicInfoValue(normalized.institutions);
}

function renderBasicInfoLoading() {
  basicInfoAuthors.textContent = "Loading...";
  basicInfoVenue.textContent = "Loading...";
  basicInfoDate.textContent = "Loading...";
  basicInfoInstitutions.textContent = "Loading...";
}

function formatBasicInfoValue(value) {
  if (Array.isArray(value)) return value.length ? value.join("；") : "未识别";
  const text = String(value || "").trim();
  return text || "未识别";
}

function setBasicInfoStatus(message, isError = false) {
  if (!basicInfoStatus) return;
  basicInfoStatus.textContent = message;
  basicInfoStatus.classList.toggle("error", isError);
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
  basicInfoButton.disabled = isBusy;
}

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle("error", isError);
}

function clearStatus() {
  setStatus("");
}

