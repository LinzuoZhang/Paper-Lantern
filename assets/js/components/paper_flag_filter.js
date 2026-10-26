import { getPaperFlagIds, filterPapersByFlags, flagIconMarkup } from "./paper_flags.js";

const FILTER_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16l-6 7v6l-4 2v-8Z"/></svg>';

export function initPaperFlagFilter({ getDefinitions, getPapers, getAllPapers, onBeforeOpen, onChange }) {
  const selected = new Set();
  let active = null;

  function close({ restoreFocus = true } = {}) {
    if (!active) return;
    const previous = active;
    active = null;
    previous.menu.remove();
    previous.button.setAttribute("aria-expanded", "false");
    if (restoreFocus && previous.button.isConnected) previous.button.focus();
  }

  function clear() {
    selected.clear();
    close({ restoreFocus: false });
    onChange();
    document.querySelector(".paper-flag-filter-button")?.focus({ preventScroll: true });
  }

  document.addEventListener("click", event => {
    if (active && !active.menu.contains(event.target) && !active.button.contains(event.target)) close({ restoreFocus: false });
  }, true);
  document.addEventListener("keydown", event => {
    if (active && event.key === "Escape") { event.preventDefault(); close(); }
  });
  document.addEventListener("scroll", event => {
    if (active && !active.menu.contains(event.target)) active.place();
  }, true);
  window.addEventListener("resize", () => close({ restoreFocus: false }));

  function createButton() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "paper-flag-filter-button";
    button.classList.toggle("is-active", selected.size > 0);
    button.setAttribute("aria-label", selected.size ? `按标志筛选，已选 ${selected.size} 项` : "按标志筛选");
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", String(Boolean(active)));
    const names = getDefinitions().filter(item => selected.has(item.id)).map(item => item.name);
    button.title = names.length ? `当前筛选：${names.join("、")}` : "按标志筛选";
    const label = document.createElement("span");
    label.textContent = "标志";
    button.append(label);
    button.insertAdjacentHTML("beforeend", FILTER_ICON);
    if (selected.size) {
      const count = document.createElement("span");
      count.className = "paper-flag-filter-count";
      count.textContent = selected.size;
      count.setAttribute("aria-hidden", "true");
      button.appendChild(count);
    }
    if (active) active.button = button;
    button.addEventListener("click", event => {
      event.stopPropagation();
      if (active) { close(); return; }
      onBeforeOpen?.();
      const anchor = document.querySelector(".paper-flag-filter-button") || button;
      if (anchor.isConnected) open(anchor);
    });
    return button;
  }

  function open(button) {
    const menu = document.createElement("div");
    menu.className = "paper-flags-popover paper-flag-filter-popover";
    menu.setAttribute("role", "dialog");
    menu.setAttribute("aria-label", "筛选标志");
    const header = document.createElement("div");
    header.className = "paper-flag-filter-heading";
    const title = document.createElement("span");
    title.textContent = "筛选标志";
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "paper-flag-filter-clear";
    reset.textContent = "清除";
    reset.addEventListener("click", clear);
    header.append(title, reset);
    const search = document.createElement("div");
    search.className = "paper-flags-search";
    const input = document.createElement("input");
    input.type = "search";
    input.placeholder = "搜索标志…";
    input.setAttribute("aria-label", "搜索筛选标志");
    const list = document.createElement("div");
    list.className = "paper-flags-list";
    search.append(input, list);
    menu.append(header, search);
    document.body.appendChild(menu);
    const state = { button, menu, place };
    active = state;
    button.setAttribute("aria-expanded", "true");

    function place() {
      const anchor = state.button.getBoundingClientRect();
      const bounds = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(anchor.right - bounds.width, innerWidth - bounds.width - 8))}px`;
      const y = anchor.bottom + bounds.height + 6 <= innerHeight - 8 ? anchor.bottom + 6 : anchor.top - bounds.height - 6;
      menu.style.top = `${Math.max(8, Math.min(y, innerHeight - bounds.height - 8))}px`;
    }

    function renderOptions() {
      list.replaceChildren();
      const counts = new Map();
      for (const paper of getPapers()) {
        for (const id of getPaperFlagIds(paper)) counts.set(id, (counts.get(id) || 0) + 1);
      }
      const used = new Set(getAllPapers().flatMap(getPaperFlagIds));
      const query = input.value.trim().toLocaleLowerCase();
      const visible = getDefinitions().filter(item => (item.id === "todo" || used.has(item.id) || selected.has(item.id))
        && (!query || item.name.toLocaleLowerCase().includes(query)));
      reset.disabled = selected.size === 0;
      for (const item of visible) {
        const row = document.createElement("label");
        row.className = "paper-flag-option";
        const icon = document.createElement("span");
        icon.className = "paper-flag-filter-icon";
        icon.style.color = item.color;
        icon.innerHTML = flagIconMarkup(item.icon);
        const name = document.createElement("span");
        name.className = "paper-flag-option-name";
        name.textContent = item.name;
        const count = document.createElement("span");
        count.className = "paper-flag-partial";
        count.textContent = counts.get(item.id) || 0;
        count.setAttribute("aria-hidden", "true");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = item.id;
        checkbox.checked = selected.has(item.id);
        checkbox.setAttribute("aria-label", item.name);
        checkbox.addEventListener("change", () => {
          checkbox.checked ? selected.add(item.id) : selected.delete(item.id);
          onChange();
          if (active !== state) return;
          if (!state.button.isConnected) { close({ restoreFocus: false }); return; }
          renderOptions();
          [...list.querySelectorAll("input")].find(input => input.value === item.id)?.focus({ preventScroll: true });
        });
        row.append(icon, name, count, checkbox);
        list.appendChild(row);
      }
      if (!visible.length) {
        const empty = document.createElement("div");
        empty.className = "paper-flags-empty";
        empty.textContent = "没有匹配的标志";
        list.appendChild(empty);
      }
      place();
    }
    input.addEventListener("input", renderOptions);
    renderOptions();
    input.focus({ preventScroll: true });
  }

  return { createButton, close, clear, hasSelection: () => selected.size > 0, filter: papers => filterPapersByFlags(papers, selected) };
}
