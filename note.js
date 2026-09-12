import { initNotesPanel } from "./notes_panel.js";
import { initLibrarySidebar } from "./library_sidebar.js";
import { initDiscussionPanel } from "./discussion_panel.js";

const noteId = new URLSearchParams(window.location.search).get("id") || "";
const titleInput = document.querySelector("#standaloneNoteTitle");
const status = document.querySelector("#standaloneNoteStatus");

let currentNote = null;
let apiBaseUrl = "";
let titleSaveTimer = null;
let copiedTimer = null;

const notesPanel = initNotesPanel({
  getCurrentPaper: () => currentNote,
  savePaper: saveCurrentNote,
  apiFetch,
  copyText: copyTextToClipboard,
  showCopiedFeedback,
  triggerBlobDownload,
});

const discussionPane = document.querySelector("#noteDiscussionPane");
const discussionTab = document.querySelector("#noteDiscussionTab");
const discussionPanel = initDiscussionPanel({
  getItem: () => currentNote,
  getContextText: () => notesPanel.getValue(),
  getSummary: () => ({ title: currentNote?.title || "", notes: notesPanel.getValue() }),
  saveItem: saveCurrentNote,
  apiFetch,
  readJsonResponse,
  onActivate: openDiscussionPane,
  contextType: "note",
  taskInstruction: "你的任务是协助用户写好和完善当前笔记。用户可能会随机询问各种问题；请优先结合已有笔记理解意图，回答尽量围绕笔记内容展开，并在合适时给出可直接写入笔记的建议或文本。",
});

discussionTab?.addEventListener("click", () => {
  if (discussionPane?.hidden) openDiscussionPane();
  else closeDiscussionPane();
});

const librarySidebar = initLibrarySidebar({
  shell: document.querySelector(".standalone-note-shell"),
  getCurrentItem: () => currentNote,
  setCurrentItem: (note) => { currentNote = note; },
  apiFetch,
  readJsonResponse,
  setStatus,
  restorePinned: false,
});
loadNote();

async function loadNote() {
  if (!noteId) {
    setStatus("缺少笔记编号。", true);
    return;
  }
  try {
    const noteResponse = await apiFetch(`/api/library/paper?${new URLSearchParams({ id: noteId }).toString()}`);
    const noteData = await readJsonResponse(noteResponse);
    if (!noteResponse.ok) throw new Error(noteData.error || "笔记不存在。");
    if (noteData.paper?.itemType !== "note") throw new Error("该条目不是纯笔记。");
    currentNote = noteData.paper;
    titleInput.value = currentNote.title || "新建笔记";
    document.title = `${titleInput.value} - Paper Lantern`;
    notesPanel.render(currentNote.notes || "");
    discussionPanel.renderHistory(currentNote.discussion || []);
    librarySidebar.setCurrentItem(currentNote);
    setStatus("");
  } catch (error) {
    console.error(error);
    setStatus(error.message || "笔记加载失败。", true);
  }
}

function openDiscussionPane() {
  if (!discussionPane || !discussionTab) return;
  discussionPane.hidden = false;
  document.querySelector(".standalone-note-shell")?.classList.add("discussion-open");
  discussionTab.classList.add("active");
  discussionTab.setAttribute("aria-selected", "true");
}

function closeDiscussionPane() {
  if (!discussionPane || !discussionTab) return;
  discussionPane.hidden = true;
  document.querySelector(".standalone-note-shell")?.classList.remove("discussion-open");
  discussionTab.classList.remove("active");
  discussionTab.setAttribute("aria-selected", "false");
}

async function saveCurrentNote(extra = {}) {
  if (!currentNote?.id) return;
  const response = await apiFetch("/api/library/paper", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: currentNote.id, ...extra }),
  });
  const data = await readJsonResponse(response);
  if (!response.ok) throw new Error(data.error || "笔记保存失败。");
  currentNote = data.paper;
  return currentNote;
}

titleInput?.addEventListener("input", () => {
  window.clearTimeout(titleSaveTimer);
  const title = titleInput.value.trim();
  document.title = `${title || "新建笔记"} - Paper Lantern`;
  titleSaveTimer = window.setTimeout(saveTitle, 500);
});

titleInput?.addEventListener("blur", saveTitle);

async function saveTitle() {
  window.clearTimeout(titleSaveTimer);
  const title = titleInput.value.trim();
  if (!currentNote || !title || title === currentNote.title) return;
  try {
    await saveCurrentNote({ title });
    librarySidebar.refresh().catch((error) => console.error("Failed to refresh library sidebar.", error));
    setStatus("已保存");
    window.setTimeout(() => setStatus(""), 1000);
  } catch (error) {
    setStatus(error.message || "标题保存失败。", true);
  }
}

function setStatus(message, isError = false) {
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("error", isError);
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function showCopiedFeedback(anchor) {
  let toast = document.querySelector("#copiedFeedback");
  if (!toast) {
    toast = document.createElement("span");
    toast.id = "copiedFeedback";
    toast.className = "copied-feedback";
    toast.textContent = "已复制";
    document.body.appendChild(toast);
  }
  const rect = anchor.getBoundingClientRect();
  toast.style.left = `${Math.max(8, rect.left + rect.width / 2 - 28)}px`;
  toast.style.top = `${Math.max(8, rect.top - 36)}px`;
  toast.classList.add("show");
  window.clearTimeout(copiedTimer);
  copiedTimer = window.setTimeout(() => toast.classList.remove("show"), 1200);
}

function triggerBlobDownload(blob, filename) {
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function readJsonResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return response.json();
  throw new Error((await response.text()).replace(/<[^>]*>/g, " ").trim() || `HTTP ${response.status}`);
}

async function apiFetch(path, options = {}) {
  if (!String(path).startsWith("/")) return fetch(path, options);
  let lastError = null;
  for (const base of buildApiBaseCandidates()) {
    try {
      const response = await fetch(`${base}${path}`, options);
      if (response.status !== 404 || !path.startsWith("/api/")) {
        apiBaseUrl = base;
        return response;
      }
      lastError = new Error("API not found.");
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("无法连接到 Paper Lantern 服务。");
}

function buildApiBaseCandidates() {
  const candidates = [];
  if (apiBaseUrl) candidates.push(apiBaseUrl);
  if (/^https?:$/.test(window.location.protocol)) candidates.push(window.location.origin);
  ["http://127.0.0.1:8000", "http://localhost:8000", "http://127.0.0.1:8010", "http://localhost:8010", "http://127.0.0.1:8765", "http://localhost:8765"].forEach((base) => candidates.push(base));
  return [...new Set(candidates)];
}
