const libraryRoot = document.querySelector("#libraryRoot");
const libraryStatus = document.querySelector("#libraryStatus");
const categoryTree = document.querySelector("#categoryTree");
const paperList = document.querySelector("#paperList");
const currentCategoryName = document.querySelector("#currentCategoryName");
const uploadForm = document.querySelector("#uploadForm");
const libraryPdfInput = document.querySelector("#libraryPdfInput");
const paperTitleInput = document.querySelector("#paperTitleInput");
const categoryInput = document.querySelector("#categoryInput");

let libraryTree = null;
let selectedCategoryId = "";
let apiBaseUrl = "";

loadLibrary();

libraryPdfInput.addEventListener("change", async () => {
  const file = libraryPdfInput.files && libraryPdfInput.files[0];
  if (!file) return;
  await uploadPdfToLibrary(file, paperTitleInput.value.trim(), categoryInput.value.trim());
  uploadForm.reset();
  categoryInput.value = selectedCategoryId || "未分类";
});

document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest(".library-menu") && !event.target.closest(".menu-button")) {
    document.querySelector(".library-menu")?.remove();
  }
});

async function uploadPdfToLibrary(file, title, category) {
  setLibraryStatus("Saving PDF...");
  try {
    const formData = new FormData();
    formData.append("pdf", file);
    formData.append("title", title || file.name.replace(/\.pdf$/i, ""));
    formData.append("category", category || "未分类");
    const response = await apiFetch("/api/library/upload", { method: "POST", body: formData });
    const data = await readJsonResponse(response);
    if (!response.ok) {
      setLibraryStatus(data.error || "Upload failed.", true);
      return;
    }
    setLibraryStatus("PDF saved. Opening paper...");
    openPaperReader(data.paper.id, true);
  } catch (error) {
    console.error(error);
    setLibraryStatus(error.message || "Upload failed.", true);
  }
}

function openPaperReader(paperId, analyze = false) {
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
    libraryRoot.textContent = `存储位置：${data.root}`;
    if (focusPaperId) selectedCategoryId = findPaperCategory(libraryTree, focusPaperId) || selectedCategoryId;
    renderLibrary();
    setLibraryStatus("");
  } catch (error) {
    console.error(error);
    setLibraryStatus(error.message || "文献库加载失败", true);
  }
}

function renderLibrary() {
  categoryTree.innerHTML = "";
  paperList.innerHTML = "";
  const categories = flattenCategories(libraryTree);
  categories.forEach((category) => {
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
      categoryInput.value = selectedCategoryId || "未分类";
      renderLibrary();
    });

    const menuButton = document.createElement("button");
    menuButton.type = "button";
    menuButton.className = "category-menu-button";
    menuButton.setAttribute("aria-label", `${category.name} category actions`);
    menuButton.textContent = "...";
    menuButton.addEventListener("click", (event) => {
      event.stopPropagation();
      showCategoryMenu(category, menuButton);
    });

    row.append(button, menuButton);
    categoryTree.appendChild(row);
  });

  const selected = categories.find((category) => category.id === selectedCategoryId) || categories[0];
  currentCategoryName.textContent = selected?.id ? selected.name : "全部论文";
  const papers = selectedCategoryId ? selected?.papers || [] : collectPapers(libraryTree);
  if (!papers.length) {
    const empty = document.createElement("div");
    empty.className = "library-empty";
    empty.textContent = "这个分类里还没有论文。";
    paperList.appendChild(empty);
    return;
  }

  papers.forEach((paper) => {
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
    meta.textContent = `上传日期：${formatUploadDate(paper.uploadedAt)}`;

    const text = document.createElement("div");
    text.className = "paper-card-text";
    text.append(title, meta);

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

function showCategoryMenu(category, anchor) {
  document.querySelector(".category-menu")?.remove();
  const menu = document.createElement("div");
  menu.className = "category-menu library-menu";

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.textContent = "增加子分类";
  addButton.addEventListener("click", async () => {
    menu.remove();
    const name = window.prompt("子分类名称");
    if (!name?.trim()) return;
    await updateCategory({ action: "create", parentId: category.id, name: name.trim() });
  });

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.textContent = "删除分类";
  deleteButton.disabled = category.locked || !category.id;
  deleteButton.addEventListener("click", async () => {
    menu.remove();
    if (!window.confirm(`删除分类“${category.name}”？其中的论文会移动到“未分类”。`)) return;
    await updateCategory({ action: "delete", id: category.id });
  });

  menu.append(addButton, deleteButton);
  document.body.appendChild(menu);
  const rect = anchor.getBoundingClientRect();
  menu.style.left = `${Math.min(rect.left, window.innerWidth - 170)}px`;
  menu.style.top = `${rect.bottom + 4}px`;
}

function showPaperMenu(paper, anchor) {
  document.querySelector(".library-menu")?.remove();
  const menu = document.createElement("div");
  menu.className = "paper-menu library-menu";

  const moveButton = document.createElement("button");
  moveButton.type = "button";
  moveButton.textContent = "移动分类";
  moveButton.addEventListener("click", async () => {
    menu.remove();
    const category = window.prompt("目标分类/子文件夹", paper.categoryName || paper.category || "未分类");
    if (!category?.trim()) return;
    await updatePaper({ action: "move", id: paper.id, category: category.trim() });
  });

  const downloadLink = document.createElement("a");
  downloadLink.href = `${apiBaseUrl || ""}${paper.pdfUrl}`;
  downloadLink.download = `${paper.title || "paper"}.pdf`;
  downloadLink.textContent = "下载 PDF";
  downloadLink.addEventListener("click", async (event) => {
    event.preventDefault();
    menu.remove();
    await ensureApiBase();
    const link = document.createElement("a");
    link.href = `${apiBaseUrl || ""}${paper.pdfUrl}`;
    link.download = `${paper.title || "paper"}.pdf`;
    link.click();
  });

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.textContent = "删除论文";
  deleteButton.addEventListener("click", async () => {
    menu.remove();
    if (!window.confirm(`删除论文“${paper.title}”？`)) return;
    await updatePaper({ action: "delete", id: paper.id });
  });

  menu.append(moveButton, downloadLink, deleteButton);
  document.body.appendChild(menu);
  const rect = anchor.getBoundingClientRect();
  menu.style.left = `${Math.min(rect.left, window.innerWidth - 170)}px`;
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
      setLibraryStatus(data.error || "分类操作失败", true);
      return;
    }
    libraryTree = data.tree;
    if (payload.action === "delete" && selectedCategoryId === payload.id) selectedCategoryId = "";
    renderLibrary();
    setLibraryStatus("");
  } catch (error) {
    console.error(error);
    setLibraryStatus(error.message || "分类操作失败", true);
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
      setLibraryStatus(data.error || "论文操作失败", true);
      return;
    }
    libraryTree = data.tree;
    if (payload.action === "move" && selectedCategoryId && selectedCategoryId !== payload.category) {
      selectedCategoryId = "";
    }
    renderLibrary();
    setLibraryStatus("");
  } catch (error) {
    console.error(error);
    setLibraryStatus(error.message || "论文操作失败", true);
  }
}

async function ensureApiBase() {
  if (apiBaseUrl) return;
  const response = await apiFetch("/api/library");
  await readJsonResponse(response);
}

function formatUploadDate(value) {
  if (!value) return "未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知";
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function flattenCategories(node, depth = 0) {
  if (!node) return [];
  const current = {
    id: node.id || "",
    name: node.name || "文献库",
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

async function readJsonResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  const text = await response.text();
  const detail = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  throw new Error(
    response.status === 404
      ? "接口未找到，请确认使用 python server.py 启动服务，而不是普通静态服务器。"
      : detail || `服务器返回了非 JSON 响应：HTTP ${response.status}`,
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
