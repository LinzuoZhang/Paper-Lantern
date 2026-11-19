// Render only explicit public work summaries, never raw model/reasoning output.
export function createPaperAnalysisProgress(container) {
  const document = container.ownerDocument;
  const panel = document.createElement("div");
  panel.className = "analysis-progress";
  const header = document.createElement("div");
  header.className = "analysis-progress-header";
  const label = document.createElement("span");
  label.textContent = "解析进度";
  const budget = document.createElement("span");
  budget.className = "analysis-progress-budget";
  header.append(label, budget);
  const status = document.createElement("p");
  status.className = "summary-loading analysis-progress-status";
  status.setAttribute("role", "status");
  const history = document.createElement("ol");
  history.className = "analysis-progress-history";
  history.setAttribute("aria-label", "Agent 工作摘要");
  panel.append(header, status, history);
  container.replaceChildren(panel);
  let previous = "";

  function update(progress = {}) {
    status.textContent = progress.detail || "正在启动论文解析…";
    if (Number.isInteger(progress.round) && Number.isInteger(progress.maxRounds)) {
      const remaining = Math.max(0, progress.roundsRemaining || 0);
      budget.textContent = `第 ${progress.round}/${progress.maxRounds} 轮 · 剩余 ${remaining} 轮`;
    }
    if (progress.source !== "agent") return;
    const parts = [progress.phase, progress.completed, progress.next];
    if (!parts.every(value => typeof value === "string" && value.trim())) return;
    const signature = JSON.stringify(parts);
    if (signature === previous) return;
    previous = signature;
    const entry = document.createElement("li");
    const phase = document.createElement("strong");
    phase.textContent = progress.phase;
    const completed = document.createElement("p");
    completed.textContent = progress.completed;
    const next = document.createElement("p");
    next.className = "analysis-progress-next";
    next.textContent = `接下来：${progress.next}`;
    entry.append(phase, completed, next);
    history.append(entry);
    while (history.children.length > 6) history.firstElementChild.remove();
    history.scrollTop = history.scrollHeight;
  }

  update();
  return { update };
}
