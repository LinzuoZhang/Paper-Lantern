const SEND_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m-7 7 7-7 7 7"/></svg>';
const STOP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>';

// The reader and the research assistant share keyboard, send/stop and model
// selection behavior. Their request transports remain independent.
export function initDiscussionComposer({ form, input, send, modelSelect = null, modelStatus = null,
  apiFetch, readJsonResponse, moduleId = "discuss", documentNode = document,
  isBlocked = () => false, onStop = () => {}, onModelStateChange = () => {} }) {
  let busy = false, stopping = false, modelLoading = false, modelSaving = false, modelsReady = false;
  let selectedProfile = "", revision = 0, deferredAI = null;

  function showModelError(message = "") {
    if (modelStatus) { modelStatus.textContent = message; modelStatus.hidden = !message; }
  }
  function refresh() {
    input.disabled = busy;
    if (modelSelect) modelSelect.disabled = busy || modelSaving || !modelsReady;
    if (send) {
      send.disabled = busy ? stopping : modelSaving || isBlocked() || !input.value.trim();
      send.type = busy ? "button" : "submit";
      send.classList.toggle("discussion-stop-mode", busy);
      send.innerHTML = busy ? STOP_ICON : SEND_ICON;
      send.title = stopping ? "正在停止" : busy ? "停止" : "发送";
      send.setAttribute("aria-label", send.title);
    }
  }
  function setBusy(next, options = {}) {
    busy = Boolean(next); stopping = busy && Boolean(options.stopping);
    if (!busy && deferredAI && !modelSaving) { const ai = deferredAI; deferredAI = null; renderModels(ai); }
    refresh();
  }
  function renderModels(ai) {
    const profiles = (ai?.profiles || []).filter(profile => String(profile.model || "").trim());
    const configured = ai?.modules?.[moduleId]?.profileId || "";
    selectedProfile = profiles.find(profile => profile.id === configured)?.id
      || profiles.find(profile => profile.id === ai.activeProfileId)?.id || profiles[0]?.id || "";
    modelSelect.replaceChildren(...profiles.map(profile => {
      const option = documentNode.createElement("option"); option.value = profile.id; option.textContent = profile.model.trim(); return option;
    }));
    modelSelect.value = selectedProfile; modelsReady = true; refresh();
  }
  async function loadModels() {
    if (!modelSelect || busy || modelLoading || modelSaving) return;
    modelLoading = true;
    const requestedRevision = revision;
    try {
      const response = await apiFetch("/api/settings", { cache: "no-store" });
      const data = await readJsonResponse(response);
      if (!response.ok || !Array.isArray(data.ai?.profiles)) throw new Error(data.error || "无法读取模型，请检查接口配置。");
      if (requestedRevision !== revision) return;
      if (busy) deferredAI = data.ai;
      else renderModels(data.ai);
      showModelError();
    } catch (error) { if (requestedRevision === revision) showModelError(error.message || "无法读取模型。"); }
    finally { modelLoading = false; refresh(); }
  }
  async function saveModel() {
    if (!modelSelect || busy || modelSaving || modelSelect.value === selectedProfile) return;
    const requested = modelSelect.value;
    modelSaving = true; revision++; showModelError(); refresh(); onModelStateChange();
    try {
      const response = await apiFetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ai: { modules: { [moduleId]: { profileId: requested } } } }) });
      const data = await readJsonResponse(response);
      if (!response.ok || data.settings?.ai?.modules?.[moduleId]?.profileId !== requested) throw new Error(data.error || "模型未保存，请重试。");
      renderModels(data.settings.ai);
      documentNode.dispatchEvent?.(new CustomEvent("paperlantern:ai-settings-changed", { detail: { source: moduleId, ai: data.settings.ai } }));
    } catch (error) { modelSelect.value = selectedProfile; showModelError(error.message || "切换模型失败。"); }
    finally {
      modelSaving = false;
      if (!busy && deferredAI) { const ai = deferredAI; deferredAI = null; renderModels(ai); }
      refresh(); onModelStateChange();
    }
  }
  input.addEventListener("input", refresh);
  input.addEventListener("keydown", event => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    if (canSubmit()) form.requestSubmit();
  });
  send?.addEventListener("click", event => {
    if (!busy) return;
    event.preventDefault();
    if (!stopping) onStop();
  });
  modelSelect?.addEventListener("focus", loadModels);
  modelSelect?.addEventListener("pointerdown", () => { if (!modelsReady) void loadModels(); });
  modelSelect?.addEventListener("change", saveModel);
  documentNode.addEventListener?.("paperlantern:ai-settings-changed", event => {
    if (!modelSelect || !event.detail?.ai) return;
    revision++;
    if (busy || modelSaving) deferredAI = event.detail.ai;
    else { renderModels(event.detail.ai); showModelError(); }
  });
  function canSubmit() { return !busy && !modelSaving && !isBlocked() && Boolean(input.value.trim()); }
  refresh();
  // Let the caller finish initializing before an immediately resolved settings
  // request can notify its UI callbacks.
  if (modelSelect) void loadModels();
  return { setBusy, refresh, canSubmit, loadModels, isModelSaving: () => modelSaving };
}

export function createDiscussionPaperPicker({ getPapers, getSelectedIds = () => [], onSelect, documentNode = document }) {
  let picker = null, anchor = null, rows = [], active = 0;
  function close(restoreFocus = false) {
    picker?.remove(); picker = null;
    documentNode.removeEventListener?.("click", outside);
    documentNode.removeEventListener?.("keydown", escape);
    window.removeEventListener?.("resize", position);
    if (restoreFocus) anchor?.focus();
  }
  function outside(event) { if (!picker?.contains(event.target) && event.target !== anchor) close(); }
  function escape(event) { if (event.key === "Escape" && picker) { event.preventDefault(); event.stopPropagation(); close(true); } }
  function position() {
    if (!picker || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = picker.offsetWidth, height = picker.offsetHeight;
    picker.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
    picker.style.top = `${rect.top > height + 6 ? rect.top - height - 6 : Math.min(rect.bottom + 6, Math.max(8, window.innerHeight - height - 8))}px`;
  }
  function open(nextAnchor) {
    if (picker) { close(); return; }
    anchor = nextAnchor;
    const create = (tag, className, text) => {
      const node = documentNode.createElement(tag); node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    picker = create("section", "notes-paper-picker research-paper-picker");
    picker.setAttribute("role", "dialog"); picker.setAttribute("aria-label", "加入论文");
    const header = create("header", "notes-paper-picker-header"); header.appendChild(create("strong", "notes-paper-picker-title", "加入论文"));
    const searchWrap = create("div", "notes-paper-picker-search-wrap");
    const search = create("input", "notes-paper-picker-search"); search.type = "search";
    search.placeholder = "搜索论文、作者或目录…"; search.setAttribute("aria-label", search.placeholder);
    searchWrap.appendChild(search);
    const list = create("div", "notes-paper-picker-list"); list.setAttribute("aria-label", "选择论文");
    picker.append(header, searchWrap, list); documentNode.body.appendChild(picker);
    const updateActive = () => rows.forEach((row, index) => { row.classList.toggle("active", index === active); if (index === active) row.scrollIntoView?.({ block: "nearest" }); });
    const render = () => {
      const terms = search.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
      const selected = new Set(getSelectedIds());
      const papers = [...new Map((getPapers() || []).filter(paper => paper.itemType !== "note").map(paper => [paper.id, paper])).values()]
        .filter(paper => !selected.has(paper.id)).filter(paper => {
          const text = [paper.title, ...(paper.basicInfo?.authors || []), ...(paper.categoryNames || []), ...(paper.categoryIds || [])].join(" ").toLocaleLowerCase();
          return terms.every(term => text.includes(term));
        });
      rows = []; active = 0; list.replaceChildren();
      for (const paper of papers) {
        const row = create("button", "notes-paper-picker-item notes-paper-picker-paper"); row.type = "button";
        const text = create("span", "notes-paper-picker-item-text");
        text.append(create("strong", "", paper.title || paper.id), create("small", "", [...(paper.basicInfo?.authors || []), ...(paper.categoryNames || paper.categoryIds || [])].join(" · ")));
        row.appendChild(text);
        row.addEventListener("click", () => { onSelect(paper); close(true); });
        list.appendChild(row); rows.push(row);
      }
      if (!rows.length) list.appendChild(create("p", "notes-paper-picker-empty", terms.length ? "没有匹配的论文" : "没有可加入的论文"));
      updateActive(); position();
    };
    search.addEventListener("input", render);
    picker.addEventListener("click", event => event.stopPropagation());
    picker.addEventListener("keydown", event => {
      if (event.isComposing || event.keyCode === 229) return;
      if (["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault(); active = (active + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % Math.max(rows.length, 1); updateActive();
      } else if (event.key === "Enter" && event.target === search) { event.preventDefault(); rows[active]?.click(); }
      else if (event.key === "Escape") escape(event);
    });
    documentNode.addEventListener?.("click", outside);
    documentNode.addEventListener?.("keydown", escape);
    window.addEventListener?.("resize", position);
    render(); search.focus();
  }
  return { open, close };
}
