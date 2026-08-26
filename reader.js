import * as pdfjsLib from "./vendor/pdfjs/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdfjs/pdf.worker.min.mjs";

const openLibraryDrawerButton = document.querySelector("#openLibraryDrawerButton");
const collapseLibraryButton = document.querySelector("#collapseLibraryButton");
const readerLibraryDrawer = document.querySelector("#readerLibraryDrawer");
const readerCategoryList = document.querySelector("#readerCategoryList");
const createReaderCategoryButton = document.querySelector("#createReaderCategoryButton");
const readerPaperList = document.querySelector("#readerPaperList");
const readerLibraryTitle = document.querySelector("#readerLibraryTitle");
const readerLeftRail = document.querySelector("#readerLeftRail");
const pdfViewer = document.querySelector("#pdfViewer");
const appShell = document.querySelector(".app-shell");
const paneResizer = document.querySelector("#paneResizer");
const readerSideRail = document.querySelector("#readerSideRail");
const readerSettingsButton = document.querySelector("#readerSettingsButton");
const exportPdfButton = document.querySelector("#exportPdfButton");
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
const selectionMenu = document.querySelector("#selectionMenu");
const highlightButton = document.querySelector("#highlightButton");
const commentButton = document.querySelector("#commentButton");
const translateButton = document.querySelector("#translateButton");
const explainButton = document.querySelector("#explainButton");
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
const discussionListView = document.querySelector("#discussionListView");
const discussionThreadView = document.querySelector("#discussionThreadView");
const discussionThreadList = document.querySelector("#discussionThreadList");
const backToDiscussionsButton = document.querySelector("#backToDiscussionsButton");
const discussionThreadTitle = document.querySelector("#discussionThreadTitle");
const discussionMessages = document.querySelector("#discussionMessages");
const discussionForm = document.querySelector("#discussionForm");
const discussionInput = document.querySelector("#discussionInput");
const sendDiscussionButton = document.querySelector("#sendDiscussionButton");
const copyThreeLineButton = document.querySelector("#copyThreeLineButton");
const copyMethodButton = document.querySelector("#copyMethodButton");
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
let renderedPdfZoom = 1;
let zoomRenderTimer = null;
let paneRenderTimer = null;
let savedHighlights = [];
let selectedPdfText = "";
let selectedPdfRange = null;
let lastSelectionRect = null;
let isPdfTextSelecting = false;
let pdfSelectionPointerId = null;
let pendingPdfSelectionRect = null;
let pdfSelectionStartPageNumber = null;
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
let discussionMarkdownRenderer = null;
let commentAutoSaveTimer = null;
let annotationAutoSaveTimer = null;
let referenceEntries = new Map();

const highlightColors = {
  yellow: "rgba(255, 221, 64, 0.42)",
  green: "rgba(120, 196, 162, 0.36)",
  blue: "rgba(111, 178, 214, 0.32)",
  pink: "rgba(239, 147, 171, 0.32)",
};

initPaneResizer();
initReaderSideRail();
initSummaryPaneToggle();
initReaderTabs();
initReaderSettings();
initCollapsibleSummaryCards();
initReaderLibraryDrawer();
openReaderFromUrl();

function initReaderLibraryDrawer() {
  openLibraryDrawerButton?.addEventListener("click", () => {
    if (readerLibraryDrawer.classList.contains("open")) {
      window.location.href = "./index.html";
      return;
    }
    openReaderLibraryDrawer();
  });
  collapseLibraryButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    closeReaderLibraryDrawer();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeReaderLibraryDrawer();
  });
  createReaderCategoryButton?.addEventListener("click", createTopLevelReaderCategory);
  loadReaderLibrary().catch((error) => console.error("Failed to load reader library.", error));
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
  readerLibraryDrawer.classList.remove("open");
  readerLeftRail?.classList.remove("library-open");
  appShell?.classList.remove("library-open");
  readerLibraryDrawer.setAttribute("aria-hidden", "true");
  openLibraryDrawerButton.classList.remove("open");
  openLibraryDrawerButton.setAttribute("aria-expanded", "false");
  openLibraryDrawerButton.setAttribute("aria-label", "Open library");
}

async function createTopLevelReaderCategory() {
  const name = window.prompt("Category name");
  if (!name?.trim()) return;
  await updateReaderCategory({ action: "create", parentId: "", name: name.trim() });
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
  let rootCategoryCount = 0;
  categories.forEach((category) => {
    const row = document.createElement("div");
    row.className = "reader-category-row";
    if (category.depth === 0) {
      rootCategoryCount += 1;
      row.classList.add("reader-category-row-root");
      if (rootCategoryCount > 1) row.classList.add("reader-category-row-root-separated");
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "reader-category-item";
    button.classList.toggle("active", category.id === readerSelectedCategoryId);
    button.style.paddingLeft = `${8 + category.depth * 12}px`;
    if (isReaderUncategorizedCategory(category)) {
      button.appendChild(createReaderUncategorizedIcon());
    }
    button.appendChild(document.createTextNode(`${category.name} (${category.paperCount})`));
    button.addEventListener("click", () => {
      readerSelectedCategoryId = category.id;
      renderReaderLibrary();
    });
    const menuButton = document.createElement("button");
    menuButton.type = "button";
    menuButton.className = "reader-category-menu-button menu-button";
    menuButton.textContent = "...";
    menuButton.setAttribute("aria-label", `${category.name} category actions`);
    menuButton.addEventListener("click", (event) => {
      event.stopPropagation();
      showReaderCategoryMenu(category, menuButton);
    });
    row.appendChild(button);
    row.appendChild(menuButton);
    readerCategoryList.appendChild(row);
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
  const previousText = statusText.textContent;
  setStatus(`Moving to ${category.name}...`);
  try {
    const response = await apiFetch("/api/library/paper", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "move", id: currentPaper.id, category: targetCategory }),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.error || "Move failed.");
    currentPaper = data.paper;
    readerSelectedCategoryId = currentPaper.category || category.id;
    await loadReaderLibrary();
    setStatus(`Moved to ${category.name}.`);
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Move failed.", true);
  } finally {
    if (!statusText.classList.contains("error")) {
      window.setTimeout(() => {
        if (statusText.textContent.startsWith("Moved to ")) setStatus(previousText || "");
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
  moveButton.textContent = "Move Here";
  moveButton.disabled = !currentPaper?.id || currentPaper.category === category.id;
  moveButton.addEventListener("click", async () => {
    menu.remove();
    await moveCurrentPaperToCategory(category);
  });

  const renameButton = document.createElement("button");
  renameButton.type = "button";
  renameButton.textContent = "Rename";
  renameButton.disabled = category.locked || !category.id;
  renameButton.addEventListener("click", async () => {
    menu.remove();
    const name = window.prompt("New category name", category.name);
    if (!name?.trim() || name.trim() === category.name) return;
    await updateReaderCategory({ action: "rename", id: category.id, name: name.trim() });
  });

  const createButton = document.createElement("button");
  createButton.type = "button";
  createButton.textContent = "Create Subcategory";
  createButton.addEventListener("click", async () => {
    menu.remove();
    const name = window.prompt("Subcategory name");
    if (!name?.trim()) return;
    await updateReaderCategory({ action: "create", parentId: category.id, name: name.trim() });
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
  renderBasicInfo(currentPaper.basicInfo);
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
  if (shouldAnalyze || !currentPaper.threeLineSummary?.method) {
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

document.addEventListener("selectionchange", handlePdfSelectionChange);
pdfViewer.addEventListener("wheel", handlePdfWheel, { passive: false });
pdfViewer.addEventListener("scroll", () => {
  updatePageIndicator();
  hideReferencePopover();
});
pdfViewer.addEventListener("pointerdown", handlePdfSelectionPointerDown);
pdfViewer.addEventListener("lostpointercapture", resetPdfSelectionPointerState);
pdfViewer.addEventListener("click", handlePdfClick);
document.addEventListener("pointerup", handlePdfSelectionPointerFinish);
document.addEventListener("pointercancel", handlePdfSelectionPointerFinish);
window.addEventListener("blur", resetPdfSelectionPointerState);
document.addEventListener("pointerdown", (event) => {
  const translationBubble = document.querySelector("#translationBubble");
  const commentBubble = document.querySelector("#commentBubble");
  const annotationEditor = document.querySelector("#annotationEditor");
  const referencePopover = document.querySelector("#referencePopover");
  const clickedFloatingUi =
    selectionMenu.contains(event.target) ||
    translationBubble?.contains(event.target) ||
    commentBubble?.contains(event.target) ||
    annotationEditor?.contains(event.target) ||
    referencePopover?.contains(event.target);
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
highlightButton.addEventListener("click", highlightSelection);
commentButton.addEventListener("click", commentSelection);
translateButton.addEventListener("click", translateSelection);
explainButton.addEventListener("click", explainSelection);
discussionForm?.addEventListener("submit", handleDiscussionSubmit);
discussionInput?.addEventListener("keydown", handleDiscussionInputKeydown);
backToDiscussionsButton?.addEventListener("click", () => showDiscussionList());
copyThreeLineButton?.addEventListener("click", () => copyReaderSection("threeLine", copyThreeLineButton));
copyMethodButton?.addEventListener("click", () => copyReaderSection("method", copyMethodButton));

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
  if (readerLeftRail) readerLeftRail.append(...[readerSettingsButton, exportPdfButton].filter(Boolean));
}

exportPdfButton?.addEventListener("click", exportCurrentPaperPdf);

async function exportCurrentPaperPdf() {
  if (!currentPaper?.id) {
    setStatus("No paper is open to export.", true);
    return;
  }

  exportPdfButton.disabled = true;
  try {
    const response = await apiFetch(`/api/library/export?id=${encodeURIComponent(currentPaper.id)}`);
    const blob = await response.blob();
    if (!response.ok) {
      const detail = await blob.text();
      throw new Error(detail || "Export failed.");
    }
    const link = document.createElement("a");
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = `${currentPaper.title || "paper"}-export.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Export failed.", true);
  } finally {
    exportPdfButton.disabled = false;
  }
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
    let answer = "";
    await requestDiscussionAnswer({
      paperText,
      question,
      summary: paperToSummary(currentPaper),
      history: thread.messages,
      onDelta: (delta) => {
        answer += delta;
        setDiscussionMessageContent(pending.querySelector(".discussion-message-body"), answer || "Thinking...", "assistant");
      },
    });

    pending.classList.remove("pending");
    thread.messages.push({ role: "user", content: question }, { role: "assistant", content: answer || "" });
    thread.updatedAt = new Date().toISOString();
    if (!thread.title || thread.title === "New discussion") thread.title = makeDiscussionTitle(question);
    thread.hash = await makeDiscussionThreadHash(thread);
    renderDiscussionMessages(thread.messages);
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
}

function showDiscussionThread(threadId) {
  const thread = discussionThreads.find((item) => item.id === threadId);
  if (!thread) return showDiscussionList();
  activeDiscussionId = thread.id;
  discussionListView.hidden = true;
  discussionThreadView.hidden = false;
  renderDiscussionThreadHeader(thread);
  renderDiscussionMessages(thread.messages);
}

function renderDiscussionThreadHeader(thread) {
  if (!discussionThreadTitle) return;
  discussionThreadTitle.textContent = thread?.title || "New discussion";
  discussionThreadTitle.title = thread?.title || "New discussion";
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

    const button = document.createElement("button");
    button.className = "discussion-thread-open";
    button.type = "button";
    const title = document.createElement("span");
    title.className = "discussion-thread-item-title";
    title.textContent = thread.title || "New discussion";
    const meta = document.createElement("span");
    meta.className = "discussion-thread-item-meta";
    const turnCount = Math.ceil((thread.messages || []).length / 2);
    meta.textContent = `${turnCount || 0} turns`;
    button.append(title, meta);
    button.addEventListener("click", () => showDiscussionThread(thread.id));

    const deleteButton = createMessageActionButton("delete", "Delete discussion");
    deleteButton.classList.add("discussion-thread-delete");
    deleteButton.addEventListener("click", () => deleteDiscussionThread(thread.id));

    item.append(button, deleteButton);
    discussionThreadList.appendChild(item);
  });
}

function appendDiscussionMessage(role, content, index = -1) {
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

  message.append(header, body, actions);
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
  const body = messageNode?.querySelector(".discussion-message-body");
  if (body?.innerText || body?.textContent) return body.innerText || body.textContent;
  return String(fallback || "");
}

async function deleteDiscussionThread(threadId) {
  if (discussionIsBusy) return;
  const index = discussionThreads.findIndex((thread) => thread.id === threadId);
  if (index < 0) return;
  if (!window.confirm("Delete this discussion?")) return;
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
    thread.messages[index].content = next;
    thread.updatedAt = new Date().toISOString();
    const firstQuestion = thread.messages.find((message) => message.role === "user")?.content || next;
    thread.title = makeDiscussionTitle(firstQuestion);
    thread.hash = await makeDiscussionThreadHash(thread);
    await saveDiscussionThreads();
    renderDiscussionThreadList();
    renderDiscussionThreadHeader(thread);
    renderDiscussionMessages(thread.messages);
  });
  body.after(form);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
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

async function requestDiscussionAnswer({ paperText, question, summary, history, onDelta }) {
  const response = await apiFetch("/api/discuss", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      paperText,
      question,
      summary,
      history,
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
  if (!renderer) return renderDiscussionMarkdownFallback(content);
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

function renderDiscussionMarkdownFallback(content) {
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

    if (isMarkdownTableHeader(line, lines[index + 1])) {
      flushParagraph();
      flushList();
      const tableLines = [line, lines[index + 1]];
      index += 2;
      while (index < lines.length && isMarkdownTableRow(lines[index])) {
        tableLines.push(lines[index]);
        index += 1;
      }
      index -= 1;
      blocks.push(renderMarkdownTable(tableLines));
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

    flushList();
    paragraph.push(line.trim());
  }

  if (inCodeBlock) flushCode();
  flushParagraph();
  flushList();
  return blocks.join("") || "<p>No response</p>";
}

function isMarkdownTableHeader(line, separatorLine) {
  return isMarkdownTableRow(line) && isMarkdownTableSeparator(separatorLine);
}

function isMarkdownTableRow(line) {
  const text = String(line || "").trim();
  return text.includes("|") && splitMarkdownTableRow(text).length >= 2;
}

function isMarkdownTableSeparator(line) {
  const cells = splitMarkdownTableRow(line);
  if (cells.length < 2) return false;
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function splitMarkdownTableRow(line) {
  let text = String(line || "").trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|")) text = text.slice(0, -1);
  const cells = [];
  let current = "";
  let escaped = false;

  for (const char of text) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      current += char;
      continue;
    }
    if (char === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function renderMarkdownTable(tableLines) {
  const headers = splitMarkdownTableRow(tableLines[0]);
  const alignments = splitMarkdownTableRow(tableLines[1]).map((cell) => {
    const value = cell.trim();
    if (value.startsWith(":") && value.endsWith(":")) return "center";
    if (value.endsWith(":")) return "right";
    return "left";
  });
  const rows = tableLines.slice(2).map(splitMarkdownTableRow);
  const columnCount = Math.max(headers.length, alignments.length, ...rows.map((row) => row.length));
  const renderCell = (cell, tag, columnIndex) => {
    const align = alignments[columnIndex] || "left";
    const value = formatDiscussionInline(cell || "");
    return `<${tag} style="text-align:${align}">${value}</${tag}>`;
  };

  const head = Array.from({ length: columnCount }, (_, index) => renderCell(headers[index], "th", index)).join("");
  const body = rows
    .map((row) => `<tr>${Array.from({ length: columnCount }, (_, index) => renderCell(row[index], "td", index)).join("")}</tr>`)
    .join("");
  return `<div class="markdown-table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
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

function clearDiscussionMessages() {
  discussionMessages.innerHTML = "";
  const empty = document.createElement("div");
  empty.className = "discussion-empty";
  empty.textContent = "Ask a question about the method, assumptions, experiments, or limitations.";
  discussionMessages.appendChild(empty);
}

function renderDiscussionHistory(discussion) {
  discussionThreads = normalizeDiscussionThreads(discussion);
  activeDiscussionId = null;
  renderDiscussionThreadList();
  showDiscussionList();
}

function renderDiscussionMessages(history) {
  clearDiscussionMessages();
  normalizeDiscussionHistory(history).forEach((message, index) => appendDiscussionMessage(message.role, message.content, index));
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
  return [
    ["Challenges", challenges.textContent],
    ["Core Method And Technical Details", method.textContent],
    ["Conclusion", conclusion.textContent],
  ]
    .map(([label, value]) => `${label}: ${cleanCopiedText(value)}`)
    .join("\n\n");
}

function getMethodBreakdownText() {
  const text = methodSections.innerText || methodSections.textContent || "";
  return cleanCopiedText(text) || "No structured method sections returned.";
}

function cleanCopiedText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

async function copyTextWithFeedback(text, button) {
  const value = cleanCopiedText(text);
  if (!value) return;

  const previousTitle = button?.title || "";
  try {
    await copyTextToClipboard(value);
    if (button) {
      button.classList.add("copied");
      button.title = "Copied";
      button.setAttribute("aria-label", "Copied");
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
    const currentWidth = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--reader-pane-width")) || 62;
    const direction = event.key === "ArrowRight" ? 1 : -1;
    setReaderPaneWidth(currentWidth + direction * 2);
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

function initReaderSettings() {
  readerSettingsButton?.addEventListener("click", openReaderSettings);
  cloudConfigCloseButton?.addEventListener("click", closeReaderSettings);
  cloudConfigOverlay?.addEventListener("pointerdown", (event) => {
    if (event.target === cloudConfigOverlay) closeReaderSettings();
  });
  cloudConfigForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveReaderSettings();
  });
  aiApiTestButton?.addEventListener("click", testReaderAiApi);
  loadReaderSettings().catch((error) => console.error("Failed to load settings.", error));
}

function openReaderSettings() {
  if (!cloudConfigOverlay) return;
  cloudConfigOverlay.hidden = false;
  aiBaseUrlInput?.focus();
}

function closeReaderSettings() {
  if (cloudConfigOverlay) cloudConfigOverlay.hidden = true;
}

async function loadReaderSettings() {
  const response = await apiFetch("/api/settings");
  const data = await readJsonResponse(response);
  if (!response.ok) throw new Error(data.error || "Failed to load settings.");
  renderReaderSettings(data);
}

async function saveReaderSettings() {
  setReaderSettingsBusy(true);
  try {
    const response = await apiFetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ai: {
          baseUrl: aiBaseUrlInput?.value.trim() || "",
          model: aiModelInput?.value.trim() || "",
          apiKey: aiApiKeyInput?.value || "",
        },
        sync: {
          provider: cloudProviderSelect?.value || "local",
          localDir: cloudLocalDirInput?.value.trim() || "",
          webdavUrl: cloudWebdavUrlInput?.value.trim() || "",
          username: cloudUsernameInput?.value.trim() || "",
          password: cloudPasswordInput?.value || "",
          autoSync: Boolean(cloudAutoPushInput?.checked),
        },
      }),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.error || "Settings save failed.");
    renderReaderSettings(data.settings);
    if (aiApiKeyInput) aiApiKeyInput.value = "";
    if (cloudPasswordInput) cloudPasswordInput.value = "";
    closeReaderSettings();
    setStatus("Settings saved.");
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Settings save failed.", true);
  } finally {
    setReaderSettingsBusy(false);
  }
}

async function testReaderAiApi() {
  setReaderAiApiTestStatus("Testing...", false);
  setReaderAiApiTestBusy(true);
  try {
    const response = await apiFetch("/api/settings/test-ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ai: {
          baseUrl: aiBaseUrlInput?.value.trim() || "",
          model: aiModelInput?.value.trim() || "",
          apiKey: aiApiKeyInput?.value || "",
        },
      }),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) {
      setReaderAiApiTestStatus(formatReaderAiApiTestError(data), true);
      return;
    }
    const message = data.message ? ` - ${data.message}` : "";
    setReaderAiApiTestStatus(`Connected: ${data.model || aiModelInput?.value.trim() || "model"}${message}`, false);
  } catch (error) {
    console.error(error);
    setReaderAiApiTestStatus(error.message || "AI API test failed.", true);
  } finally {
    setReaderAiApiTestBusy(false);
  }
}

function renderReaderSettings(settings) {
  const ai = settings?.ai || {};
  const sync = settings?.sync || {};
  if (aiBaseUrlInput) aiBaseUrlInput.value = ai.baseUrl || "";
  if (aiModelInput) aiModelInput.value = ai.model || "";
  if (aiApiKeyInput) aiApiKeyInput.placeholder = ai.hasApiKey ? maskSecretTail(ai.apiKeyTail) : "Paste API key";
  if (cloudProviderSelect) cloudProviderSelect.value = sync.provider === "webdav" ? "webdav" : "local";
  if (cloudLocalDirInput) cloudLocalDirInput.value = sync.localDir || "";
  if (cloudWebdavUrlInput) cloudWebdavUrlInput.value = sync.webdavUrl || "";
  if (cloudUsernameInput) cloudUsernameInput.value = sync.username || "";
  if (cloudPasswordInput) cloudPasswordInput.placeholder = sync.hasPassword ? maskSecretTail(sync.passwordTail) : "Paste password / app password";
  if (cloudAutoPushInput) cloudAutoPushInput.checked = Boolean(sync.autoSync);
}

function setReaderSettingsBusy(isBusy) {
  if (cloudConfigForm) cloudConfigForm.querySelector("button[type='submit']").disabled = isBusy;
  if (readerSettingsButton) readerSettingsButton.disabled = isBusy;
}

function setReaderAiApiTestBusy(isBusy) {
  if (!aiApiTestButton) return;
  aiApiTestButton.disabled = isBusy;
  aiApiTestButton.setAttribute("aria-busy", String(isBusy));
}

function setReaderAiApiTestStatus(message, isError) {
  if (!aiApiTestStatus) return;
  aiApiTestStatus.textContent = message;
  aiApiTestStatus.classList.toggle("error", Boolean(isError));
}

function formatReaderAiApiTestError(data) {
  const detail = String(data?.detail || "").replace(/\s+/g, " ").trim();
  return detail ? `${data.error || "AI API test failed."} ${detail.slice(0, 260)}` : data?.error || "AI API test failed.";
}

function maskSecretTail(tail) {
  return `****${tail || "****"}`;
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
    await renderPdfPages(renderId, { keepExisting: true });
    setViewerScrollRatio(scrollRatio);
  }, 120);
}

async function renderPdf(file) {
  hideSelectionMenu();
  hideTranslationBubble();
  hideReferencePopover();
  pdfViewer.innerHTML = "";
  if (!currentPaper) savedHighlights = [];
  pdfZoom = 1;
  renderedPdfZoom = 1;
  window.clearTimeout(zoomRenderTimer);
  setPdfZoomPreviewScale(1);
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

async function renderPdfPages(renderId = Symbol("pdfRender"), options = {}) {
  if (!currentPdfDocument) return;
  const { keepExisting = false } = options;
  const renderZoom = pdfZoom;
  currentPdfTask = renderId;
  if (!keepExisting) pdfViewer.innerHTML = "";
  const pagesHost = document.createElement("div");
  pagesHost.className = "pdf-pages";
  if (!keepExisting) pdfViewer.appendChild(pagesHost);
  for (let pageNumber = 1; pageNumber <= currentPdfDocument.numPages; pageNumber += 1) {
    const page = await currentPdfDocument.getPage(pageNumber);
    if (currentPdfTask !== renderId) return;
    await renderPdfPage(page, pageNumber, renderId, pagesHost, renderZoom);
    if (currentPdfTask !== renderId) return;
  }
  if (keepExisting) {
    pdfViewer.replaceChildren(pagesHost);
  }
  renderedPdfZoom = renderZoom;
  setPdfZoomPreviewScale(1);
  restoreHighlights();
  updatePageIndicator();
}

async function renderPdfPage(page, pageNumber, renderId, pagesHost = pdfViewer, zoom = pdfZoom) {
  const containerWidth = Math.max(pdfViewer.clientWidth - 36, 320);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(containerWidth / baseViewport.width, 1.6) * zoom;
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

  const existingPage = pagesHost.querySelector(`.pdf-page[data-page-number="${pageNumber}"]`);
  if (existingPage) existingPage.remove();
  pagesHost.appendChild(pageNode);
  decorateReferenceCitations(pageNode, textLayer);
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
    if (currentPdfTask === renderId) restorePdfViewportAnchor(anchor);
  }, 140);
}

function setPdfZoomPreviewScale(scale) {
  const pagesHost = pdfViewer.querySelector(".pdf-pages");
  if (!pagesHost) return;
  pagesHost.style.transform = scale === 1 ? "" : `scale(${scale})`;
  pagesHost.style.transformOrigin = "0 0";
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

async function refreshOverviewInfo(text) {
  const response = await apiFetch("/api/overview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paperId: currentPaper?.id || "", paperText: text }),
  });
  const data = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(data.detail || data.error || "Overview extraction failed.");
  }

  renderKeywords(data.overviewInfo?.keywords || []);
  renderBasicInfo(data.overviewInfo?.basicInfo);
  await saveCurrentPaper({ overviewInfo: data.overviewInfo });
  if (data.overviewInfo?.paperTitle) {
    setReaderPaperTitle(data.overviewInfo.paperTitle);
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
    saveCurrentPaper().catch((error) => console.error("Failed to save explanation annotation.", error));
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
      await saveCurrentPaper();
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
  await saveCurrentPaper();
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
  hideCommentBubble();
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
  hideCommentBubble();
  hideAnnotationEditor();

  let popover = document.querySelector("#referencePopover");
  if (!popover) {
    popover = document.createElement("section");
    popover.id = "referencePopover";
    popover.className = "reference-popover";
    popover.innerHTML = `
      <header class="reference-popover-header">
        <span>参考文献</span>
        <button class="reference-close" type="button" aria-label="Close reference preview">×</button>
      </header>
      <div class="reference-popover-body"></div>
      <div class="reference-popover-actions">
        <button class="reference-copy" type="button">复制引用</button>
      </div>
    `;
    popover.querySelector(".reference-close").addEventListener("click", hideReferencePopover);
    pdfViewer.parentElement.appendChild(popover);
  }

  popover.querySelector(".reference-copy").onclick = () => copyReferenceEntries(entries, popover);
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
  popover.querySelector(".reference-copy").textContent = "复制引用";
  positionReferencePopover(popover, clientX, clientY);
}

function positionReferencePopover(popover, clientX, clientY) {
  const frameRect = pdfViewer.parentElement.getBoundingClientRect();
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
    button.textContent = "已复制";
    window.setTimeout(() => {
      if (document.body.contains(button)) button.textContent = "复制引用";
    }, 1200);
  } catch (error) {
    console.error("Failed to copy reference.", error);
    button.textContent = "复制失败";
  }
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
      motivationNode.append(document.createTextNode("动机："), ...formatInlineTechnicalText(section.motivation));
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
        formulaBox.appendChild(createFormulaExplanationBlock(formula));
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

