import { initNotesPanel } from "../components/notes_panel.js";
import { initLibrarySidebar } from "../components/library_sidebar.js";
import { initDiscussionPanel } from "../components/discussion_panel.js";
import { initNoteAnnotations } from "../components/note_annotations.js";

const noteId = new URLSearchParams(window.location.search).get("id") || "";
const noteShell = document.querySelector(".standalone-note-shell");
const titleInput = document.querySelector("#standaloneNoteTitle");
const titleHeading = document.querySelector("#standaloneNoteTitleHeading");
const titleText = document.querySelector("#standaloneNoteTitleText");
const titleEditButton = document.querySelector("#standaloneNoteTitleEditButton");
const status = document.querySelector("#standaloneNoteStatus");
const notesWorkspace = document.querySelector("#notesWorkspace");
const noteZoomFeedback = document.querySelector("#noteZoomFeedback");
const discussionResizer = document.querySelector("#noteDiscussionResizer");
const noteSideRail = document.querySelector(".standalone-note-side-rail");
const readerLeftRail = document.querySelector("#readerLeftRail");
const NOTE_DISCUSSION_WIDTH_KEY = "paperLanternNoteDiscussionWidth";
const NOTE_DISCUSSION_MIN_WIDTH = 320;
const NOTE_DISCUSSION_MAX_WIDTH = 720;
const NOTE_ZOOM_KEY = "paperLanternStandaloneNoteZoom";
const NOTE_ZOOM_MIN = 0.7;
const NOTE_ZOOM_MAX = 2;
const NOTE_ZOOM_STEP = 0.1;

let currentNote = null;
let apiBaseUrl = "";
let copiedTimer = null;
let noteZoomFeedbackTimer = null;
let isResizingDiscussion = false;
let isEditingTitle = false;
let noteZoom = 1;

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
  paperReferences: notesPanel,
  getItem: () => currentNote,
  getContextText: () => notesPanel.getValue(),
  getSummary: () => ({ title: currentNote?.title || "", notes: notesPanel.getValue() }),
  saveItem: saveCurrentNote,
  apiFetch,
  readJsonResponse,
  copyText: copyTextToClipboard,
  onCopied: (button) => showCopiedFeedback(button),
  onActivate: openDiscussionPane,
  contextType: "note",
  taskInstruction: "你的任务是协助用户写好和完善当前笔记。用户可能会随机询问各种问题；请优先结合已有笔记理解意图，回答尽量围绕笔记内容展开，并在合适时给出可直接写入笔记的建议或文本。",
});

discussionTab?.addEventListener("click", () => {
  if (discussionPane?.hidden) openDiscussionPane();
  else closeDiscussionPane();
});

const annotationPane = document.querySelector("#noteAnnotationPane");
const annotationTab = document.querySelector("#noteAnnotationTab");
const noteAnnotations = initNoteAnnotations({
  host: document.querySelector("#notesEditor"),
  frame: noteShell,
  list: document.querySelector("#noteAnnotationList"),
  getNote: () => currentNote,
  getValue: () => notesPanel.getValue(),
  saveNote: saveCurrentNote,
  apiFetch,
  readJsonResponse,
  renderMarkdown: (text) => discussionPanel.renderMarkdown(text),
  startDiscussion: (reference) => discussionPanel.startFromReference(reference),
  setStatus,
});
annotationTab?.addEventListener("click", () => {
  if (!annotationPane.hidden) closeDiscussionPane();
  else {
    openDiscussionPane();
    discussionPane.hidden = true;
    annotationPane.hidden = false;
    discussionTab.classList.remove("active");
    discussionTab.setAttribute("aria-selected", "false");
    annotationTab.classList.add("active");
    annotationTab.setAttribute("aria-selected", "true");
    noteAnnotations.renderList();
  }
});

const librarySidebar = initLibrarySidebar({
  shell: noteShell,
  getCurrentItem: () => currentNote,
  setCurrentItem: (note) => { currentNote = note; },
  apiFetch,
  readJsonResponse,
  setStatus,
  restorePinned: false,
});
initDiscussionResizer();
initTitleEditing();
initNoteZoom();
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
    renderNoteTitle(currentNote.title || "新建笔记");
    notesPanel.render(currentNote.notes || "");
    discussionPanel.renderHistory(currentNote.discussion || []);
    noteAnnotations.render();
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
  annotationPane.hidden = true;
  annotationTab.classList.remove("active");
  annotationTab.setAttribute("aria-selected", "false");
  if (discussionResizer) discussionResizer.hidden = false;
  noteShell?.classList.add("discussion-open");
  setDiscussionPaneWidth(getDiscussionPaneWidth());
  discussionTab.classList.add("active");
  discussionTab.setAttribute("aria-selected", "true");
}

function closeDiscussionPane() {
  if (!discussionPane || !discussionTab) return;
  discussionPane.hidden = true;
  annotationPane.hidden = true;
  annotationTab.classList.remove("active");
  annotationTab.setAttribute("aria-selected", "false");
  if (discussionResizer) discussionResizer.hidden = true;
  noteShell?.classList.remove("discussion-open");
  discussionTab.classList.remove("active");
  discussionTab.setAttribute("aria-selected", "false");
}

function initDiscussionResizer() {
  if (!discussionResizer || !noteShell) return;
  const savedWidth = Number.parseFloat(window.localStorage.getItem(NOTE_DISCUSSION_WIDTH_KEY) || "");
  setDiscussionPaneWidth(Number.isFinite(savedWidth) ? savedWidth : 420);

  discussionResizer.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    isResizingDiscussion = true;
    discussionResizer.setPointerCapture(event.pointerId);
    document.body.classList.add("resizing-note-discussion");
  });
  discussionResizer.addEventListener("pointermove", (event) => {
    if (!isResizingDiscussion) return;
    resizeDiscussionToClientX(event.clientX);
  });
  discussionResizer.addEventListener("pointerup", (event) => finishDiscussionResize(event.pointerId));
  discussionResizer.addEventListener("pointercancel", (event) => finishDiscussionResize(event.pointerId));
  discussionResizer.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowLeft" ? 1 : -1;
    setDiscussionPaneWidth(getDiscussionPaneWidth() + direction * 24);
  });

  window.addEventListener("resize", () => setDiscussionPaneWidth(getDiscussionPaneWidth()));
  new MutationObserver(() => {
    if (noteShell.classList.contains("discussion-open")) setDiscussionPaneWidth(getDiscussionPaneWidth());
  }).observe(noteShell, { attributes: true, attributeFilter: ["class"] });
}

function resizeDiscussionToClientX(clientX) {
  const shellRect = noteShell?.getBoundingClientRect();
  if (!shellRect || !discussionResizer) return;
  const sideRailWidth = noteSideRail?.getBoundingClientRect().width || 54;
  const width = shellRect.right - sideRailWidth - clientX - discussionResizer.offsetWidth / 2;
  setDiscussionPaneWidth(width);
}

function setDiscussionPaneWidth(width) {
  if (!noteShell || !discussionResizer) return;
  const shellWidth = noteShell.getBoundingClientRect().width || window.innerWidth || 1200;
  const leftRailWidth = readerLeftRail?.getBoundingClientRect().width || 54;
  const sideRailWidth = noteSideRail?.getBoundingClientRect().width || 54;
  const availableWidth = shellWidth - leftRailWidth - sideRailWidth - discussionResizer.offsetWidth - 360;
  const maxWidth = Math.max(NOTE_DISCUSSION_MIN_WIDTH, Math.min(NOTE_DISCUSSION_MAX_WIDTH, availableWidth));
  const clampedWidth = Math.min(Math.max(Number(width) || 420, NOTE_DISCUSSION_MIN_WIDTH), maxWidth);
  noteShell.style.setProperty("--note-discussion-width", `${clampedWidth}px`);
  discussionResizer.setAttribute("aria-valuemax", String(Math.round(maxWidth)));
  discussionResizer.setAttribute("aria-valuenow", String(Math.round(clampedWidth)));
  window.localStorage.setItem(NOTE_DISCUSSION_WIDTH_KEY, String(clampedWidth));
}

function getDiscussionPaneWidth() {
  const value = Number.parseFloat(getComputedStyle(noteShell).getPropertyValue("--note-discussion-width"));
  return Number.isFinite(value) ? value : 420;
}

function finishDiscussionResize(pointerId) {
  if (!isResizingDiscussion || !discussionResizer) return;
  isResizingDiscussion = false;
  document.body.classList.remove("resizing-note-discussion");
  if (discussionResizer.hasPointerCapture(pointerId)) discussionResizer.releasePointerCapture(pointerId);
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

function initTitleEditing() {
  titleEditButton?.addEventListener("click", startTitleEditing);
  titleInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      commitTitleEdit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelTitleEdit();
    }
  });
  titleInput?.addEventListener("blur", commitTitleEdit);
}

function startTitleEditing() {
  if (!titleInput || !currentNote || isEditingTitle) return;
  isEditingTitle = true;
  titleInput.value = currentNote.title || "新建笔记";
  titleInput.hidden = false;
  if (titleHeading) titleHeading.hidden = true;
  if (titleEditButton) titleEditButton.hidden = true;
  titleInput.focus();
  titleInput.select();
}

function cancelTitleEdit() {
  if (!isEditingTitle) return;
  isEditingTitle = false;
  renderNoteTitle(currentNote?.title || "新建笔记");
  closeTitleEditor();
  titleEditButton?.focus();
}

async function commitTitleEdit() {
  if (!isEditingTitle || !titleInput) return;
  isEditingTitle = false;
  const previousTitle = currentNote?.title || "新建笔记";
  const title = titleInput.value.trim() || previousTitle;
  renderNoteTitle(title);
  closeTitleEditor();
  if (!currentNote || title === previousTitle) return;
  try {
    await saveCurrentNote({ title });
    librarySidebar.refresh().catch((error) => console.error("Failed to refresh library sidebar.", error));
    setStatus("已保存");
    window.setTimeout(() => setStatus(""), 1000);
  } catch (error) {
    renderNoteTitle(previousTitle);
    setStatus(error.message || "标题保存失败。", true);
  }
}

function closeTitleEditor() {
  if (titleInput) titleInput.hidden = true;
  if (titleHeading) titleHeading.hidden = false;
  if (titleEditButton) titleEditButton.hidden = false;
}

function renderNoteTitle(title) {
  const normalizedTitle = String(title || "").trim() || "新建笔记";
  if (titleText) {
    titleText.textContent = normalizedTitle;
    titleText.title = normalizedTitle;
  }
  if (titleInput) titleInput.value = normalizedTitle;
  document.title = `${normalizedTitle} - Paper Lantern`;
}

function initNoteZoom() {
  if (!notesWorkspace) return;
  const savedZoom = Number.parseFloat(window.localStorage.getItem(NOTE_ZOOM_KEY) || "");
  setNoteZoom(Number.isFinite(savedZoom) ? savedZoom : 1, false);
  notesWorkspace.addEventListener("wheel", (event) => {
    if (!event.ctrlKey || !event.deltaY) return;
    event.preventDefault();
    const direction = event.deltaY < 0 ? 1 : -1;
    setNoteZoom(noteZoom + direction * NOTE_ZOOM_STEP);
  }, { passive: false, capture: true });
}

function setNoteZoom(value, showFeedback = true) {
  noteZoom = Math.min(Math.max(Number(value) || 1, NOTE_ZOOM_MIN), NOTE_ZOOM_MAX);
  noteZoom = Math.round(noteZoom * 10) / 10;
  notesWorkspace?.style.setProperty("--notes-content-font-size", `${15 * noteZoom}px`);
  window.localStorage.setItem(NOTE_ZOOM_KEY, String(noteZoom));
  if (showFeedback) showNoteZoomFeedback();
}

function showNoteZoomFeedback() {
  if (!noteZoomFeedback) return;
  noteZoomFeedback.textContent = `${Math.round(noteZoom * 100)}%`;
  noteZoomFeedback.hidden = false;
  noteZoomFeedback.classList.add("show");
  window.clearTimeout(noteZoomFeedbackTimer);
  noteZoomFeedbackTimer = window.setTimeout(() => {
    noteZoomFeedback.classList.remove("show");
    noteZoomFeedback.hidden = true;
  }, 900);
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
