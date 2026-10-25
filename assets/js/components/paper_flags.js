const BUILTIN_FLAGS = [
  { id: "read", name: "已读", builtin: true },
  { id: "todo", name: "待办", builtin: true },
];
const PLUS_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>';
const FLAG_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 22V3m0 0c6-4 10 4 16 0v12c-6 4-10-4-16 0"/></svg>';

export function getPaperFlagIds(paper) {
  const ids = Array.isArray(paper.flags) ? paper.flags.filter(id => id !== "read" && id !== "todo") : [];
  return [...new Set([...(paper.read ? ["read"] : []), ...(paper.todo ? ["todo"] : []), ...ids])];
}

export function initPaperFlags({ apiFetch, readJsonResponse, getPapers = () => [], onChange, onClose }) {
  let definitions = [...BUILTIN_FLAGS];
  let active = null;

  function setDefinitions(value) {
    if (!Array.isArray(value)) return;
    definitions = [...BUILTIN_FLAGS, ...value.filter(item => item && !["read", "todo"].includes(item.id)
      && typeof item.id === "string" && typeof item.name === "string")];
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
    if (notify) onClose?.({ changed: previous.changed, paperId: previous.paper.id, restoreFocus });
  }

  document.addEventListener("click", event => {
    if (active && !active.menu.contains(event.target) && !active.button.contains(event.target)) close({ restoreFocus: false });
  });
  document.addEventListener("keydown", event => {
    if (active && event.key === "Escape") { event.preventDefault(); close(); }
  });
  window.addEventListener("resize", () => close({ restoreFocus: false }));
  document.addEventListener("scroll", event => {
    if (active && !active.menu.contains(event.target)) active.place();
  }, true);

  function renderButton(button, paper) {
    button.replaceChildren();
    const ids = getPaperFlagIds(paper);
    const selected = definitions.filter(item => ids.includes(item.id));
    const names = selected.map(item => item.name);
    button.title = names.length ? `管理标志：${names.join("、")}` : "添加标志";
    button.setAttribute("aria-label", `${paper.title}：${names.length ? names.join("、") : "添加标志"}`);
    button.classList.toggle("is-empty", !selected.length);
    for (const item of selected.slice(0, 2)) {
      const chip = document.createElement("span");
      chip.className = "paper-flag-chip";
      chip.textContent = item.name;
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
      if (button.isConnected) open(button, paper, changed);
    });
    return button;
  }

  function open(button, paper, changed = false) {
    const menu = document.createElement("div");
    menu.className = "paper-flags-popover";
    menu.setAttribute("role", "dialog");
    menu.setAttribute("aria-label", "文献标志");
    const title = document.createElement("div");
    title.className = "paper-flags-heading";
    title.textContent = "标志";
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
    document.body.appendChild(menu);
    const state = { menu, button, paper, changed, busy: false, place };
    active = state;
    button.setAttribute("aria-expanded", "true");

    function place() {
      const anchor = button.getBoundingClientRect();
      const bounds = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - bounds.width - 8))}px`;
      const below = innerHeight - anchor.bottom - 8;
      const y = bounds.height <= below ? anchor.bottom + 6 : anchor.top - bounds.height - 6;
      menu.style.top = `${Math.max(8, Math.min(y, innerHeight - bounds.height - 8))}px`;
    }

    function renderOptions() {
      list.replaceChildren();
      const query = input.value.trim().toLocaleLowerCase();
      const ids = getPaperFlagIds(paper);
      const usedIds = new Set([...getPapers().flatMap(getPaperFlagIds), ...ids]);
      const visible = definitions.filter(item => query ? item.name.toLocaleLowerCase().includes(query) : usedIds.has(item.id));
      for (const item of visible) {
        const row = document.createElement("label");
        row.className = "paper-flag-option";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = item.id;
        checkbox.checked = ids.includes(item.id);
        checkbox.disabled = state.busy;
        const icon = document.createElement("span");
        icon.className = "paper-flag-option-icon";
        icon.innerHTML = FLAG_ICON;
        const name = document.createElement("span");
        name.className = "paper-flag-option-name";
        name.textContent = item.name;
        row.append(icon, name, checkbox);
        checkbox.addEventListener("change", () => change(async () => {
          const next = new Set(getPaperFlagIds(paper));
          checkbox.checked ? next.add(item.id) : next.delete(item.id);
          await save([...next]);
        }, item.id));
        list.appendChild(row);
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

    async function save(ids) {
      const response = await apiFetch("/api/library/paper", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: paper.id, flags: ids }),
      });
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.error || "保存标志失败，请重试。");
      Object.assign(paper, data.paper);
      state.changed = true;
      renderButton(button, paper);
      onChange?.(data, paper);
      if (active !== state) onClose?.({ changed: true, paperId: paper.id, restoreFocus: false });
    }

    async function change(action, focusId = "") {
      if (state.busy) return;
      state.busy = true;
      status.hidden = true;
      renderOptions();
      try { await action(); }
      catch (error) { status.textContent = error.message || "保存标志失败，请重试。"; status.hidden = false; }
      finally {
        state.busy = false;
        if (active === state) {
          renderOptions();
          const target = [...list.querySelectorAll('input[type="checkbox"]')].find(checkbox => checkbox.value === focusId);
          (target || input).focus({ preventScroll: true });
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
        await save([...new Set([...getPaperFlagIds(paper), flag.id])]);
        input.value = "";
      });
    });
    renderOptions();
    input.focus({ preventScroll: true });
  }

  return { setDefinitions, createButton, close, searchText };
}
