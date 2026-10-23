export function getCategoryIds(paper) {
  const ids = Array.isArray(paper?.categoryIds) ? paper.categoryIds : [paper?.category || paper?.categoryId || "uncategorized"];
  return [...new Set(ids.filter(Boolean))];
}

export function getCategoryLabels(paper) {
  const ids = getCategoryIds(paper);
  const names = Array.isArray(paper?.categoryNames) ? paper.categoryNames : [];
  return ids.length ? ids.map((id, index) => {
    if (["uncategorized", "Uncategorized", "未分类"].includes(id)) return "未分类";
    if (id.includes("/")) return id.split("/").join(" / ");
    return names[index] || (index === 0 ? paper?.categoryName : "") || id;
  }) : ["未分类"];
}

export function collectUniquePapers(node) {
  const papers = new Map();
  function visit(current) {
    if (!current) return;
    for (const paper of current.papers || []) {
      if (!papers.has(paper.id)) papers.set(paper.id, paper);
    }
    for (const child of current.folders || []) visit(child);
  }
  visit(node);
  return [...papers.values()];
}

export function categorySearchText(paper) {
  return [...getCategoryIds(paper), ...(paper.categoryNames || [paper.categoryName || ""])].join(" ");
}

export function showCategoryManager({ tree, paper, anchor, onSave }) {
  document.querySelector(".category-manager")?.close();
  const dialog = document.createElement("dialog");
  dialog.className = "category-manager";
  const header = document.createElement("div");
  header.className = "category-manager-header";
  const heading = document.createElement("h2");
  heading.id = "categoryManagerTitle";
  heading.textContent = "管理分类";
  dialog.setAttribute("aria-labelledby", heading.id);
  const close = document.createElement("button");
  close.type = "button";
  close.className = "drawer-close-button category-manager-close";
  close.setAttribute("aria-label", "关闭管理分类");
  close.title = "关闭";
  close.addEventListener("click", () => dialog.close());
  header.append(heading, close);
  const description = document.createElement("p");
  description.id = "categoryManagerDescription";
  description.className = "category-manager-description";
  description.textContent = "选择文献所属的分类，可多选";
  dialog.setAttribute("aria-describedby", description.id);
  const searchField = document.createElement("div");
  searchField.className = "category-manager-search";
  const searchIcon = document.createElement("span");
  searchIcon.className = "category-manager-search-icon";
  searchIcon.setAttribute("aria-hidden", "true");
  searchIcon.innerHTML = '<svg viewBox="0 0 20 20" fill="none"><circle cx="8.5" cy="8.5" r="5.5"></circle><path d="m12.5 12.5 4 4"></path></svg>';
  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "搜索分类...";
  search.setAttribute("aria-label", "搜索分类");
  searchField.append(searchIcon, search);
  const list = document.createElement("div");
  list.className = "category-manager-list";
  const selected = new Set(getCategoryIds(paper).filter((id) => id !== "uncategorized"));
  const rows = [];
  function visit(node, depth = 0, path = "") {
    for (const folder of node?.folders || []) {
      if (folder.id === "uncategorized") continue;
      const fullName = path ? `${path} / ${folder.name}` : folder.name;
      const row = document.createElement("label");
      row.className = "category-manager-option";
      row.style.paddingLeft = `${8 + depth * 16}px`;
      row.title = fullName;
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = folder.id;
      checkbox.checked = selected.has(folder.id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selected.add(folder.id);
        else selected.delete(folder.id);
      });
      const name = document.createElement("span");
      name.textContent = folder.name;
      row.append(checkbox, name);
      list.append(row);
      rows.push({ row, searchText: fullName.toLowerCase() });
      visit(folder, depth + 1, fullName);
    }
  }
  visit(tree);
  const empty = document.createElement("p");
  empty.className = "category-manager-empty";
  list.append(empty);
  const filter = () => {
    const query = search.value.trim().toLowerCase();
    rows.forEach(({ row, searchText }) => { row.hidden = !searchText.includes(query); });
    empty.hidden = rows.some(({ row }) => !row.hidden);
    empty.textContent = rows.length ? "没有匹配的分类。" : "暂无分类，请先在侧栏新建分类。";
  };
  search.addEventListener("input", filter);
  filter();
  const error = document.createElement("p");
  error.className = "category-manager-error";
  error.setAttribute("role", "alert");
  const footer = document.createElement("div");
  footer.className = "category-manager-footer";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "secondary-button";
  cancel.textContent = "取消";
  cancel.addEventListener("click", () => dialog.close());
  const save = document.createElement("button");
  save.type = "button";
  save.className = "category-manager-save";
  save.textContent = "保存";
  let saving = false;
  dialog.addEventListener("cancel", (event) => { if (saving) event.preventDefault(); });
  save.addEventListener("click", async () => {
    if (saving) return;
    saving = true;
    dialog.querySelectorAll("input, button").forEach((el) => { el.disabled = true; });
    error.textContent = "";
    save.textContent = "保存中…";
    try {
      await onSave([...selected]);
      dialog.close();
    } catch (failure) {
      error.textContent = failure.message || "保存分类失败，请重试。";
    } finally {
      saving = false;
      save.textContent = "保存";
      dialog.querySelectorAll("input, button").forEach((el) => { el.disabled = false; });
    }
  });
  footer.append(cancel, save);
  dialog.append(header, description, searchField, list, error, footer);
  dialog.addEventListener("close", () => { dialog.remove(); if (anchor?.isConnected) anchor.focus(); });
  document.body.append(dialog);
  dialog.showModal();
  search.focus();
  return dialog;
}
