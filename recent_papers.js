export const RECENT_PAPERS_KEY = "paperLanternRecentPapers";
const LEGACY_RECENT_PAPERS_KEY = "openMoonlightRecentPapers";
const MAX_RECENT_PAPERS = 100;

export function migrateLegacyRecentPapers() {
  try {
    if (localStorage.getItem(RECENT_PAPERS_KEY)) return;
    const legacy = localStorage.getItem(LEGACY_RECENT_PAPERS_KEY);
    if (legacy) localStorage.setItem(RECENT_PAPERS_KEY, legacy);
  } catch {
    // Recent papers still work through the server when browser storage is unavailable.
  }
}

export function getRecentPaperRecords() {
  try {
    const records = JSON.parse(localStorage.getItem(RECENT_PAPERS_KEY) || "[]");
    return Array.isArray(records) ? records.filter((record) => record?.id && isValidDate(record.viewedAt)) : [];
  } catch {
    return [];
  }
}

export function recordPaperViewed(paperId, viewedAt = new Date().toISOString()) {
  const id = String(paperId || "").trim();
  const timestamp = isValidDate(viewedAt) ? String(viewedAt) : new Date().toISOString();
  if (!id) return timestamp;

  const records = getRecentPaperRecords().filter((record) => record.id !== id);
  records.unshift({ id, viewedAt: timestamp });
  try {
    localStorage.setItem(RECENT_PAPERS_KEY, JSON.stringify(records.slice(0, MAX_RECENT_PAPERS)));
  } catch {
    // The server-side record remains the source of truth if localStorage is blocked.
  }
  return timestamp;
}

export function getPaperViewedAt(paper, records = getRecentPaperRecords()) {
  if (!paper) return "";
  const id = typeof paper === "string" ? paper : paper.id;
  const serverViewedAt = typeof paper === "object" ? paper.viewedAt : "";
  const localViewedAt = records.find((record) => record.id === id)?.viewedAt || "";
  return latestTimestamp(localViewedAt, serverViewedAt);
}

export function getRecentPapers(papers, records = getRecentPaperRecords()) {
  const seen = new Set();
  return (papers || [])
    .filter((paper) => { if (seen.has(paper.id)) return false; seen.add(paper.id); return true; })
    .map((paper) => {
      const viewedAt = getPaperViewedAt(paper, records);
      return viewedAt ? { ...paper, viewedAt } : null;
    })
    .filter(Boolean)
    .sort((a, b) => dateValue(b.viewedAt) - dateValue(a.viewedAt))
    .slice(0, MAX_RECENT_PAPERS);
}

function latestTimestamp(first, second) {
  const firstValue = dateValue(first);
  const secondValue = dateValue(second);
  if (!firstValue && !secondValue) return "";
  return firstValue >= secondValue ? String(first) : String(second);
}

function dateValue(value) {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function isValidDate(value) {
  return dateValue(value) > 0;
}
