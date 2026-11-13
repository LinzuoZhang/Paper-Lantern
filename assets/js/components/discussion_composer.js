const SEND_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m-7 7 7-7 7 7"/></svg>';
const STOP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>';
const MODEL_CHECK_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m3.5 8.5 3 3 6-7"/></svg>';
const MODEL_SEARCH_THRESHOLD = 5;
const MODEL_MENU_WIDTH = 320;
const MODEL_MENU_GAP = 6;
const MODEL_MENU_MARGIN = 8;

// The chat composer keeps the native <select> as the single source of truth for
// the selected profile id. This turns it into a compact popover without
// changing the surrounding layout or the settings persistence path.
export function createModelPicker(select, documentNode = document, onSelect = () => {}) {
  const parent = select?.parentNode;
  if (!parent || typeof documentNode?.createElement !== "function" || typeof parent.insertBefore !== "function") return null;
  const idLabel = select.getAttribute?.("aria-label") || "选择模型";
  const placeholder = select.querySelector?.("option")?.textContent?.trim() || idLabel;
  const windowNode = documentNode.defaultView || globalThis.window;

  const root = documentNode.createElement("div");
  root.className = "model-picker";
  const trigger = documentNode.createElement("button");
  trigger.type = "button";
  trigger.className = "model-picker-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  const triggerLabel = documentNode.createElement("span");
  triggerLabel.className = "model-picker-label";
  trigger.appendChild(triggerLabel);
  root.appendChild(trigger);
  parent.insertBefore(root, select);
  select.hidden = true;
  select.classList?.add("model-picker-native");

  let items = [], selectedId = "", ready = false, disabled = false;
  let menu = null, search = null, list = null, rows = [], matches = [], activeIndex = -1, open = false;

  const isDisabled = () => disabled || !ready || items.length === 0;
  const currentLabel = () => !ready ? placeholder : !items.length ? "暂无可用模型"
    : items.find(item => item.id === selectedId)?.label || items[0].label;

  function syncTrigger() {
    const text = currentLabel();
    triggerLabel.textContent = text;
    trigger.title = text;
    trigger.setAttribute("aria-label", `${idLabel}：${text}`);
    trigger.disabled = isDisabled();
  }

  function setActive(index, scroll = true) {
    activeIndex = index;
    rows.forEach((row, order) => row.classList.toggle("is-active", order === index));
    if (scroll && index >= 0) rows[index]?.scrollIntoView?.({ block: "nearest" });
  }

  function choose(id) {
    close(true);
    if (!id || id === selectedId) return;
    selectedId = id;
    syncTrigger();
    onSelect(id);
  }

  function renderList() {
    if (!list) return;
    const term = (search?.value || "").trim().toLocaleLowerCase();
    matches = term ? items.filter(item => item.label.toLocaleLowerCase().includes(term)) : items.slice();
    rows = [];
    list.replaceChildren();
    matches.forEach((item, index) => {
      const row = documentNode.createElement("button");
      row.type = "button";
      row.className = "model-picker-option";
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(item.id === selectedId));
      row.title = item.label;
      const text = documentNode.createElement("span");
      text.className = "model-picker-option-label";
      text.textContent = item.label;
      const check = documentNode.createElement("span");
      check.className = "model-picker-check";
      check.innerHTML = MODEL_CHECK_ICON;
      row.append(text, check);
      row.addEventListener("click", () => choose(item.id));
      row.addEventListener("pointerenter", () => setActive(index, false));
      list.appendChild(row);
      rows.push(row);
    });
    if (!matches.length) {
      const empty = documentNode.createElement("p");
      empty.className = "model-picker-empty";
      empty.textContent = term ? "没有找到匹配的模型" : "暂无可用模型";
      list.appendChild(empty);
    }
    const selectedIndex = matches.findIndex(item => item.id === selectedId);
    setActive(selectedIndex >= 0 ? selectedIndex : matches.length ? 0 : -1, false);
    if (open) position();
  }

  function position() {
    if (!menu || !trigger) return;
    const rect = trigger.getBoundingClientRect();
    const viewportWidth = windowNode?.innerWidth || 0;
    const viewportHeight = windowNode?.innerHeight || 0;
    const width = Math.min(MODEL_MENU_WIDTH, Math.max(220, viewportWidth - MODEL_MENU_MARGIN * 2));
    menu.style.width = `${width}px`;
    const height = menu.offsetHeight;
    const spaceAbove = rect.top - MODEL_MENU_MARGIN;
    const spaceBelow = viewportHeight - rect.bottom - MODEL_MENU_MARGIN;
    // Chat composers sit at the bottom, so open upward unless that space is worse.
    const above = height <= spaceAbove || spaceAbove >= spaceBelow;
    const rawTop = above ? rect.top - height - MODEL_MENU_GAP : rect.bottom + MODEL_MENU_GAP;
    const left = Math.max(MODEL_MENU_MARGIN, Math.min(rect.left, viewportWidth - width - MODEL_MENU_MARGIN));
    const top = Math.max(MODEL_MENU_MARGIN, Math.min(rawTop, viewportHeight - height - MODEL_MENU_MARGIN));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function outside(event) {
    if (!menu?.contains(event.target) && !root.contains(event.target)) close();
  }
  function escape(event) {
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(true); }
  }
  function onScroll(event) {
    if (menu?.contains(event.target)) return;
    position();
  }
  function onMenuKeydown(event) {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Tab") { close(true); return; }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      if (rows.length) setActive(event.key === "Home" ? 0 : rows.length - 1);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!rows.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((activeIndex + step + rows.length) % rows.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (matches[activeIndex]) choose(matches[activeIndex].id);
    }
  }

  function buildMenu() {
    menu = documentNode.createElement("section");
    menu.className = "model-picker-menu";
    menu.setAttribute("role", "listbox");
    menu.setAttribute("aria-label", idLabel);
    if (items.length > MODEL_SEARCH_THRESHOLD) {
      const searchWrap = documentNode.createElement("div");
      searchWrap.className = "model-picker-search";
      search = documentNode.createElement("input");
      search.type = "search";
      search.placeholder = "搜索模型…";
      search.setAttribute("aria-label", "搜索模型");
      searchWrap.appendChild(search);
      menu.appendChild(searchWrap);
      search.addEventListener("input", renderList);
    }
    list = documentNode.createElement("div");
    list.className = "model-picker-list";
    list.setAttribute("tabindex", "-1");
    menu.appendChild(list);
    menu.addEventListener("keydown", onMenuKeydown);
    menu.addEventListener("pointerdown", event => event.stopPropagation());
  }

  function openMenu() {
    if (open || isDisabled()) return;
    open = true;
    buildMenu();
    documentNode.body.appendChild(menu);
    trigger.setAttribute("aria-expanded", "true");
    renderList();
    position();
    documentNode.addEventListener("pointerdown", outside, true);
    documentNode.addEventListener("keydown", escape, true);
    windowNode?.addEventListener("resize", position);
    documentNode.addEventListener("scroll", onScroll, true);
    const focusTarget = search || list;
    windowNode?.requestAnimationFrame?.(() => { if (open) { menu?.classList.add("is-open"); focusTarget.focus?.({ preventScroll: true }); } });
  }

  function close(restoreFocus = false) {
    if (!open) return;
    open = false;
    documentNode.removeEventListener("pointerdown", outside, true);
    documentNode.removeEventListener("keydown", escape, true);
    windowNode?.removeEventListener("resize", position);
    documentNode.removeEventListener("scroll", onScroll, true);
    menu?.remove();
    menu = null; search = null; list = null; rows = []; matches = []; activeIndex = -1;
    trigger.setAttribute("aria-expanded", "false");
    if (restoreFocus) trigger.focus?.({ preventScroll: true });
  }

  trigger.addEventListener("click", () => open ? close() : openMenu());
  trigger.addEventListener("keydown", event => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); openMenu(); }
  });
  syncTrigger();

  return {
    setOptions(nextItems, nextSelected, options = {}) {
      items = nextItems.map(item => ({ id: item.id, label: item.label }));
      selectedId = items.find(item => item.id === nextSelected)?.id || items[0]?.id || "";
      ready = options.ready !== false;
      syncTrigger();
      if (isDisabled()) close();
      else if (open) renderList();
    },
    setSelected(id) {
      selectedId = items.find(item => item.id === id)?.id || "";
      syncTrigger();
      if (open) renderList();
    },
    setDisabled(value) {
      disabled = Boolean(value);
      syncTrigger();
      if (isDisabled()) close();
    },
    close,
  };
}

// The reader and the research assistant share keyboard, send/stop and model
// selection behavior. Their request transports remain independent.
export function initDiscussionComposer({ form, input, send, modelSelect = null, modelStatus = null,
  apiFetch, readJsonResponse, moduleId = "discuss", documentNode = document,
  isBlocked = () => false, onStop = () => {}, onModelStateChange = () => {} }) {
  let busy = false, stopping = false, modelLoading = false, modelSaving = false, modelsReady = false;
  let selectedProfile = "", revision = 0, deferredAI = null;
  const modelPicker = modelSelect ? createModelPicker(modelSelect, documentNode, id => {
    if (busy || modelSaving || !modelsReady || id === selectedProfile) return;
    modelSelect.value = id;
    void saveModel();
  }) : null;

  function showModelError(message = "") {
    if (modelStatus) { modelStatus.textContent = message; modelStatus.hidden = !message; }
  }
  function refresh() {
    input.disabled = busy;
    if (modelSelect) {
      modelSelect.disabled = busy || modelSaving || !modelsReady;
      modelPicker?.setDisabled(busy || modelSaving);
    }
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
    modelSelect.value = selectedProfile; modelsReady = true;
    modelPicker?.setOptions(profiles.map(profile => ({ id: profile.id, label: profile.model.trim() })), selectedProfile, { ready: true });
    refresh();
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
    } catch (error) {
      modelSelect.value = selectedProfile;
      modelPicker?.setSelected(selectedProfile);
      showModelError(error.message || "切换模型失败。");
    }
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
