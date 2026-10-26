const BUILTIN_FLAGS = [
  { id: "read", name: "已读", builtin: true },
  { id: "todo", name: "待办", builtin: true },
];
const PLUS_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>';
const FLAG_ICONS = [
  { id: "flag", name: "旗帜", shape: '<path d="M4 3c6-4 10 4 16 0v12c-6 4-10-4-16 0Z" fill="currentColor" stroke="none"/><path d="M4 3v19" fill="none"/>' },
  { id: "star", name: "星标", shape: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.3L5.8 21 7 14.2 2 9.3l6.9-1Z" fill="currentColor" stroke="none"/>' },
  { id: "bookmark", name: "书签", shape: '<path d="M6 3h12v19l-6-4-6 4Z" fill="currentColor" stroke="none"/>' },
  { id: "circle", name: "圆点", shape: '<circle cx="12" cy="12" r="8" fill="currentColor" stroke="none"/>' },
  { id: "heart", name: "爱心", shape: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" fill="currentColor" stroke="none"/>' },
  { id: "bolt", name: "闪电", shape: '<path d="M13 2 3 14h7l-1 8L21 9h-8Z" fill="currentColor" stroke="none"/>' },
  { id: "check", name: "完成", shape: '<path d="m9 16.2-4.2-4.3-2 2L9 20 22 7l-2-2Z" fill="currentColor" stroke="none"/>' },
  { id: "tag", name: "标签", shape: '<path d="M3 3h8l10 10-8 8-10-10V3Zm5 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" fill="currentColor" stroke="none" fill-rule="evenodd"/>' },
];
const flagIcon = value => FLAG_ICONS.find(item => item.id === value) || FLAG_ICONS[0];
export function flagIconMarkup(value) {
  const icon = flagIcon(value);
  return `<svg viewBox="0 0 24 24" aria-hidden="true" data-flag-icon="${icon.id}">${icon.shape}</svg>`;
}
const DEFAULT_COLOR = "#73777d";
const FLAG_COLORS = [
  ["灰色", DEFAULT_COLOR], ["蓝色", "#4776a8"], ["绿色", "#55836b"], ["琥珀色", "#a9823e"],
  ["橙色", "#b57551"], ["玫瑰色", "#ac6270"], ["紫色", "#8470a3"], ["青色", "#4f858c"],
];
const flagColor = color => typeof color === "string" && /^#[\da-f]{6}$/i.test(color) ? color.toLowerCase() : DEFAULT_COLOR;

export function getPaperFlagIds(paper) {
  const ids = Array.isArray(paper.flags) ? paper.flags.filter(id => id !== "read" && id !== "todo") : [];
  return [...new Set([...(paper.read ? ["read"] : []), ...(paper.todo ? ["todo"] : []), ...ids])];
}

export function filterPapersByFlags(papers, flagIds = []) {
  const selected = new Set(flagIds);
  return selected.size ? papers.filter(paper => getPaperFlagIds(paper).some(id => selected.has(id))) : papers;
}

export function applyPaperFlagUpdates(tree, papers) {
  const updates = new Map((papers || []).filter(Boolean).map(paper => [paper.id, paper]));
  function visit(node) {
    for (const paper of node?.papers || []) {
      const update = updates.get(paper.id);
      if (!update) continue;
      for (const key of ["read", "todo", "flags", "viewedAt"]) {
        if (Object.hasOwn(update, key)) paper[key] = update[key];
      }
    }
    for (const folder of node?.folders || []) visit(folder);
  }
  visit(tree);
}

export async function savePaperFlags({ apiFetch, readJsonResponse, papers, flagId, checked, bulk, onSaved, onProgress }) {
  async function request(payload) {
    const response = await apiFetch("/api/library/paper", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    return { response, data: await readJsonResponse(response) };
  }
  function assignment(paper) {
    const flags = new Set(getPaperFlagIds(paper));
    checked ? flags.add(flagId) : flags.delete(flagId);
    return { id: paper.id, flags: [...flags] };
  }
  function requireSuccess({ response, data }) {
    if (!response.ok) throw new Error(data.error || "保存标志失败，请重试。");
    return data;
  }

  const result = await request(bulk
    ? { action: "flags-many", ids: papers.map(paper => paper.id), flags: [flagId], operation: checked ? "add" : "remove", response: "flags" }
    : assignment(papers[0]));
  // A running server may predate flags-many while already supporting per-paper flags.
  if (bulk && result.response.status === 404 && result.data.error === "Paper not found.") {
    onProgress?.(0, papers.length);
    for (const [index, paper] of papers.entries()) {
      const response = await apiFetch(`/api/library/paper?${new URLSearchParams({ id: paper.id })}`);
      const current = requireSuccess({ response, data: await readJsonResponse(response) });
      const data = requireSuccess(await request(assignment(current.paper)));
      onSaved(data);
      onProgress?.(index + 1, papers.length);
    }
    return;
  }
  onSaved(requireSuccess(result));
}

export function initPaperFlags({ apiFetch, readJsonResponse, getPapers = () => [], onChange, onClose, onBulkBusyChange }) {
  let definitions = BUILTIN_FLAGS.map(item => ({ ...item, color: DEFAULT_COLOR, icon: "flag" }));
  let active = null;

  function setDefinitions(value) {
    if (!Array.isArray(value)) return;
    definitions = [
      ...BUILTIN_FLAGS.map(item => {
        const saved = value.find(flag => flag?.id === item.id);
        return { ...item, color: flagColor(saved?.color), icon: flagIcon(saved?.icon).id };
      }),
      ...value.filter(item => item && !["read", "todo"].includes(item.id)
        && typeof item.id === "string" && typeof item.name === "string").map(item => ({ ...item, color: flagColor(item.color), icon: flagIcon(item.icon).id })),
    ];
  }

  function searchText(paper) {
    const selected = new Set(getPaperFlagIds(paper));
    return definitions.filter(item => selected.has(item.id)).map(item => item.name).join(" ");
  }

  function close({ restoreFocus = true, notify = true } = {}) {
    if (!active) return;
    const previous = active;
    active = null;
    previous.menu.remove();
    previous.button.setAttribute("aria-expanded", "false");
    if (restoreFocus && previous.button.isConnected) previous.button.focus();
    if (notify) onClose?.({ changed: previous.changed, paperId: previous.paper.id, restoreFocus, bulk: previous.bulk });
  }

  document.addEventListener("click", event => {
    if (active && !active.menu.contains(event.target) && !active.button.contains(event.target)) close({ restoreFocus: false });
  });
  document.addEventListener("keydown", event => {
    if (active && event.key === "Escape") {
      event.preventDefault();
      if (!active.closePalette()) close();
    }
  });
  window.addEventListener("resize", () => close({ restoreFocus: false }));
  document.addEventListener("scroll", event => {
    if (active) active.place();
  }, true);

  function renderButton(button, paper) {
    button.replaceChildren();
    button.dataset.paperId = paper.id;
    const ids = getPaperFlagIds(paper);
    const selected = definitions.filter(item => ids.includes(item.id));
    const names = selected.map(item => item.name);
    button.title = names.length ? `标志：${names.join("、")}` : "添加标志";
    button.setAttribute("aria-label", `${paper.title}：${names.length ? names.join("、") : "添加标志"}`);
    button.classList.toggle("is-empty", !selected.length);
    for (const item of selected.slice(0, 2)) {
      const chip = document.createElement("span");
      chip.className = "paper-flag-chip";
      const icon = document.createElement("span");
      icon.className = "paper-flag-chip-icon";
      icon.style.color = item.color;
      icon.innerHTML = flagIconMarkup(item.icon);
      const name = document.createElement("span");
      name.className = "paper-flag-chip-name";
      name.textContent = item.name;
      chip.append(icon, name);
      button.appendChild(chip);
    }
    if (selected.length > 2) {
      const more = document.createElement("span");
      more.className = "paper-flag-count";
      more.textContent = `+${selected.length - 2}`;
      button.appendChild(more);
    } else if (!selected.length) {
      const add = document.createElement("span");
      add.className = "paper-flag-add";
      add.innerHTML = PLUS_ICON;
      button.appendChild(add);
    }
  }

  function refreshButtons() {
    const papers = new Map(getPapers().map(paper => [paper.id, paper]));
    for (const button of document.querySelectorAll(".paper-flags-button")) {
      const paper = papers.get(button.dataset.paperId);
      if (paper) renderButton(button, paper);
    }
  }

  function createButton(paper) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "paper-flags-button";
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    renderButton(button, paper);
    button.addEventListener("click", event => {
      event.stopPropagation();
      if (active?.button === button) { close(); return; }
      const changed = active?.changed || false;
      close({ restoreFocus: false, notify: false });
      if (button.isConnected) open(button, getPapers().find(item => item.id === paper.id) || paper, changed);
    });
    return button;
  }

  function openBulk(button, papers) {
    if (!papers.length) return;
    if (active?.button === button) { close(); return; }
    const changed = active?.changed || false;
    close({ restoreFocus: false, notify: false });
    const targets = [...new Map(papers.map(paper => [paper.id, paper])).values()];
    open(button, targets[0], changed, targets);
  }

  function open(button, paper, changed = false, selectedPapers = null) {
    const bulk = Boolean(selectedPapers);
    const targets = selectedPapers || [paper];
    let colorFlagId = "";
    const menu = document.createElement("div");
    menu.className = "paper-flags-popover";
    menu.setAttribute("role", "dialog");
    menu.setAttribute("aria-label", bulk ? "批量标志" : "文献标志");
    const title = document.createElement("div");
    title.className = "paper-flags-heading";
    title.textContent = bulk ? `标志 · 已选 ${targets.length} 项` : "标志";
    const form = document.createElement("form");
    form.className = "paper-flags-search";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "搜索或新建标志…";
    input.setAttribute("aria-label", "搜索或新建标志");
    input.maxLength = 24;
    const list = document.createElement("div");
    list.className = "paper-flags-list";
    const create = document.createElement("button");
    create.type = "submit";
    create.className = "paper-flags-create";
    create.hidden = true;
    const status = document.createElement("div");
    status.className = "paper-flags-status";
    status.setAttribute("role", "status");
    status.hidden = true;
    form.append(input, list, create);
    menu.append(title, form, status);
    if (bulk) {
      const hint = document.createElement("div");
      hint.className = "paper-flags-hint";
      hint.textContent = "勾选添加到全部，取消勾选从全部移除";
      title.after(hint);
    }
    document.body.appendChild(menu);
    const state = { menu, button, paper, changed, busy: false, place, bulk, closePalette };
    active = state;
    button.setAttribute("aria-expanded", "true");

    function place() {
      const palette = menu.querySelector(".paper-flag-palette");
      const paletteWidth = innerWidth < 480 ? 136 : 176;
      menu.style.width = palette ? `${Math.min(280, innerWidth - 22 - paletteWidth)}px` : "";
      const anchor = button.getBoundingClientRect();
      const bounds = menu.getBoundingClientRect();
      const left = Math.max(palette ? paletteWidth + 14 : 8, Math.min(anchor.left, innerWidth - bounds.width - 8));
      menu.style.left = `${left}px`;
      const below = innerHeight - anchor.bottom - 8;
      const y = bounds.height <= below ? anchor.bottom + 6 : anchor.top - bounds.height - 6;
      menu.style.top = `${Math.max(8, Math.min(y, innerHeight - bounds.height - 8))}px`;
      if (palette) {
        palette.style.width = `${paletteWidth}px`;
        const trigger = [...list.querySelectorAll(".paper-flag-color-trigger")].find(icon => icon.dataset.flagId === colorFlagId);
        const triggerBounds = trigger.getBoundingClientRect();
        const paletteBounds = palette.getBoundingClientRect();
        palette.style.left = `${left - paletteWidth - 6}px`;
        palette.style.top = `${Math.max(8, Math.min(triggerBounds.top - 8, innerHeight - paletteBounds.height - 8))}px`;
      }
    }

    function closePalette() {
      if (!colorFlagId) return false;
      const id = colorFlagId;
      colorFlagId = "";
      renderOptions();
      [...list.querySelectorAll(".paper-flag-color-trigger")].find(icon => icon.dataset.flagId === id)?.focus({ preventScroll: true });
      return true;
    }

    function renderOptions() {
      menu.querySelector(".paper-flag-palette")?.remove();
      list.replaceChildren();
      const query = input.value.trim().toLocaleLowerCase();
      const selectedIds = targets.map(getPaperFlagIds);
      const ids = selectedIds.flat();
      const usedIds = new Set([...getPapers().flatMap(getPaperFlagIds), ...ids]);
      const visible = definitions.filter(item => query ? item.name.toLocaleLowerCase().includes(query) : item.id === "todo" || usedIds.has(item.id));
      if (!visible.some(item => item.id === colorFlagId)) colorFlagId = "";
      for (const item of visible) {
        const row = document.createElement("div");
        row.className = "paper-flag-option";
        const label = document.createElement("label");
        label.className = "paper-flag-option-label";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = item.id;
        const count = selectedIds.filter(ids => ids.includes(item.id)).length;
        checkbox.checked = count === targets.length;
        checkbox.indeterminate = count > 0 && count < targets.length;
        checkbox.setAttribute("aria-label", item.name);
        checkbox.disabled = state.busy;
        const icon = document.createElement("button");
        icon.type = "button";
        icon.className = "paper-flag-color-trigger";
        icon.dataset.flagId = item.id;
        icon.style.color = item.color;
        icon.setAttribute("aria-label", `修改“${item.name}”图标和颜色`);
        icon.setAttribute("aria-expanded", String(colorFlagId === item.id));
        if (colorFlagId === item.id) icon.setAttribute("aria-controls", "paper-flag-appearance");
        icon.title = "修改图标和颜色";
        icon.disabled = state.busy;
        icon.innerHTML = flagIconMarkup(item.icon);
        icon.addEventListener("click", event => {
          event.stopPropagation();
          colorFlagId = colorFlagId === item.id ? "" : item.id;
          renderOptions();
          const target = colorFlagId ? menu.querySelector('.paper-flag-palette button[aria-pressed="true"]') || menu.querySelector(".paper-flag-palette button")
            : [...list.querySelectorAll(".paper-flag-color-trigger")].find(button => button.dataset.flagId === item.id);
          target?.focus({ preventScroll: true });
        });
        const name = document.createElement("span");
        name.className = "paper-flag-option-name";
        name.textContent = item.name;
        label.append(name, checkbox);
        row.append(icon, label);
        if (checkbox.indeterminate) {
          const partial = document.createElement("span");
          partial.className = "paper-flag-partial";
          partial.textContent = `${count}/${targets.length}`;
          partial.setAttribute("aria-hidden", "true");
          checkbox.before(partial);
        }
        checkbox.addEventListener("change", () => change(() => setFlag(item.id, checkbox.checked), item.id));
        list.appendChild(row);
        if (colorFlagId === item.id) menu.appendChild(createColorPalette(item));
      }
      if (!query && !visible.length) {
        const empty = document.createElement("div");
        empty.className = "paper-flags-empty";
        empty.textContent = "暂无使用中的标志，输入名称添加";
        list.appendChild(empty);
      }
      create.hidden = !query || definitions.some(item => item.name.toLocaleLowerCase() === query);
      create.disabled = state.busy;
      create.textContent = `创建“${input.value.trim()}”并添加`;
      input.disabled = state.busy;
      place();
    }

    function createColorPalette(item) {
      const palette = document.createElement("div");
      palette.className = "paper-flag-palette";
      palette.id = "paper-flag-appearance";
      palette.setAttribute("role", "group");
      palette.setAttribute("aria-label", `${item.name}图标设置`);
      const iconHeading = document.createElement("div");
      iconHeading.className = "paper-flag-palette-title";
      iconHeading.textContent = "图标";
      palette.appendChild(iconHeading);
      for (const option of FLAG_ICONS) {
        const choice = document.createElement("button");
        choice.type = "button";
        choice.className = "paper-flag-icon-choice";
        choice.style.color = item.color;
        choice.innerHTML = flagIconMarkup(option.id);
        choice.setAttribute("aria-label", option.name);
        choice.setAttribute("aria-pressed", String(item.icon === option.id));
        choice.title = option.name;
        choice.disabled = state.busy;
        choice.addEventListener("click", event => {
          event.stopPropagation();
          void change(() => setAppearance(item.id, { icon: option.id }), item.id, true);
        });
        palette.appendChild(choice);
      }
      const heading = document.createElement("div");
      heading.className = "paper-flag-palette-title";
      heading.textContent = "颜色";
      palette.appendChild(heading);
      for (const [name, color] of FLAG_COLORS) {
        const swatch = document.createElement("button");
        swatch.type = "button";
        swatch.className = "paper-flag-swatch";
        swatch.style.setProperty("--flag-color", color);
        swatch.setAttribute("aria-label", name);
        swatch.setAttribute("aria-pressed", String(item.color === color));
        swatch.title = name;
        swatch.disabled = state.busy;
        swatch.addEventListener("click", event => {
          event.stopPropagation();
          void change(() => setAppearance(item.id, { color }), item.id, true);
        });
        palette.appendChild(swatch);
      }
      const custom = document.createElement("input");
      custom.type = "color";
      custom.className = "paper-flag-custom-color";
      custom.value = item.color;
      custom.setAttribute("aria-label", "自定义图标颜色");
      custom.title = "自定义颜色";
      custom.disabled = state.busy;
      custom.addEventListener("change", () => change(() => setAppearance(item.id, { color: custom.value }), item.id, true));
      const customLabel = document.createElement("label");
      customLabel.className = "paper-flag-custom-color-label";
      customLabel.append(custom, document.createTextNode("自定义颜色"));
      const hint = document.createElement("div");
      hint.className = "paper-flag-color-hint";
      hint.textContent = "图标和颜色应用于所有同名标志";
      palette.append(customLabel, hint);
      return palette;
    }

    async function setAppearance(flagId, updates) {
      const response = await apiFetch("/api/library/flags", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: flagId, ...updates }),
      });
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.error || "保存图标设置失败，请重试。");
      setDefinitions(data.flags);
      state.changed = true;
      refreshButtons();
    }

    async function setFlag(flagId, checked) {
      await savePaperFlags({
        apiFetch, readJsonResponse, papers: targets, flagId, checked, bulk,
        onSaved(data) {
          const updated = new Map((data.papers || [data.paper]).filter(Boolean).map(item => [item.id, item]));
          targets.forEach(item => Object.assign(item, updated.get(item.id)));
          if (!bulk) renderButton(button, paper);
          state.changed = true;
          onChange?.(data, paper);
          refreshButtons();
        },
        onProgress(completed, total) {
          status.textContent = `正在更新标志（${completed}/${total}）…`;
          status.hidden = completed === total;
          place();
        },
      });
    }

    async function change(action, focusId = "", focusColor = false) {
      if (state.busy) return;
      state.busy = true;
      if (bulk) onBulkBusyChange?.(true);
      status.hidden = true;
      status.classList.remove("is-error");
      renderOptions();
      try { await action(); }
      catch (error) {
        status.textContent = error.message || "保存标志失败，请重试。";
        status.classList.add("is-error");
        status.hidden = false;
      }
      finally {
        state.busy = false;
        if (bulk) onBulkBusyChange?.(false);
        if (active === state) {
          renderOptions();
          const target = focusColor
            ? [...list.querySelectorAll(".paper-flag-color-trigger")].find(button => button.dataset.flagId === focusId)
            : [...list.querySelectorAll('input[type="checkbox"]')].find(checkbox => checkbox.value === focusId);
          (target || input).focus({ preventScroll: true });
        } else if (state.changed) {
          onClose?.({ changed: true, paperId: paper.id, restoreFocus: false, bulk });
        }
      }
    }

    input.addEventListener("input", renderOptions);
    form.addEventListener("submit", event => {
      event.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      void change(async () => {
        let flag = definitions.find(item => item.name.toLocaleLowerCase() === name.toLocaleLowerCase());
        if (!flag) {
          const response = await apiFetch("/api/library/flags", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
          });
          const data = await readJsonResponse(response);
          if (!response.ok) throw new Error(data.error || "创建标志失败，请重试。");
          setDefinitions(data.flags);
          flag = data.flag;
        }
        await setFlag(flag.id, true);
        input.value = "";
      });
    });
    renderOptions();
    input.focus({ preventScroll: true });
  }

  return { setDefinitions, createButton, close, searchText, openBulk, getDefinitions: () => definitions.map(item => ({ ...item })) };
}
