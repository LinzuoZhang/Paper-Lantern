export const DEFAULT_API_BASES = [
  "http://127.0.0.1:8000",
  "http://localhost:8000",
  "http://127.0.0.1:8010",
  "http://localhost:8010",
  "http://127.0.0.1:8765",
  "http://localhost:8765",
];

export async function getApiBase() {
  const stored = await chrome.storage.local.get({ apiBase: DEFAULT_API_BASES[0] });
  return String(stored.apiBase || DEFAULT_API_BASES[0]).replace(/\/+$/, "");
}

export async function setApiBase(apiBase) {
  const normalized = String(apiBase || DEFAULT_API_BASES[0]).replace(/\/+$/, "");
  await chrome.storage.local.set({ apiBase: normalized });
  return normalized;
}

export async function checkHealth(apiBase = null) {
  const base = apiBase || (await getApiBase());
  const response = await fetch(`${base}/api/health`, { cache: "no-store" });
  const data = await readJsonResponse(response);
  if (!response.ok || !data.ok) throw new Error(data.error || "Paper Lantern is not ready.");
  return { base, data };
}

export async function importRemotePdf(source, options = {}) {
  const base = await getApiBase();
  const response = await fetch(`${base}/api/library/remote-pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pdfUrl: source,
      title: options.title || "",
      category: options.category || "",
    }),
  });
  const data = await readJsonResponse(response);
  if (!response.ok) throw new Error(data.detail || data.error || "PDF import failed.");
  return { base, data };
}

export async function importLocalPdf(source, options = {}) {
  const base = await getApiBase();
  const file = await readLocalPdfFile(source);
  const formData = new FormData();
  formData.append("pdf", file);
  formData.append("title", options.title || file.name.replace(/\.pdf$/i, ""));
  formData.append("category", options.category || "");
  const response = await fetch(`${base}/api/library/upload`, {
    method: "POST",
    body: formData,
  });
  const data = await readJsonResponse(response);
  if (!response.ok) throw new Error(data.error || "PDF upload failed.");
  return { base, data };
}

export async function importPdfSource(source, options = {}) {
  return isLocalFileSource(source) ? importLocalPdf(source, options) : importRemotePdf(source, options);
}

export function readerUrl(base, paperId) {
  return `${base}/reader.html?${new URLSearchParams({ id: paperId }).toString()}`;
}

export function normalizeImportSource(url) {
  const value = String(url || "").trim();
  if (!value) return "";

  const visited = new Set();
  const candidates = collectImportSourceCandidates(value, visited);
  for (const candidate of candidates) {
    const normalized = normalizeDirectImportSource(candidate);
    if (normalized) return normalized;
  }

  return "";
}

function collectImportSourceCandidates(value, visited) {
  const text = String(value || "").trim();
  if (!text || visited.has(text)) return [];
  visited.add(text);

  const candidates = [text];
  try {
    const parsed = new URL(text);
    for (const name of ["src", "file", "url", "pdf", "href", "download", "target"]) {
      const nested = parsed.searchParams.get(name);
      if (!nested) continue;
      candidates.push(...collectImportSourceCandidates(nested, visited));
    }
  } catch {
    // Plain arXiv IDs are handled by normalizeDirectImportSource below.
  }

  return candidates;
}

function normalizeDirectImportSource(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const pathname = decodeURIComponent(parsed.pathname || "");
    const search = parsed.searchParams;
    if (hostname === "arxiv.org" && /^\/abs\//i.test(pathname)) {
      return value;
    }
    if (hostname === "arxiv.org" && /^\/pdf\//i.test(pathname)) {
      return value;
    }
    if (hostname === "export.arxiv.org" && /^\/(?:abs|pdf)\//i.test(pathname)) {
      return value;
    }
    if (/\.(?:pdf|PDF)$/i.test(pathname)) return value;
    if (/(?:^|\/)(?:pdf|download|fulltext|viewcontent)(?:\/|$)/i.test(pathname)) {
      return value;
    }
    if (hostname === "par.nsf.gov" && /^\/servlets\/purl\//i.test(pathname)) {
      return value;
    }
    if (Array.from(search.keys()).some((key) => /^(?:pdf|download)$/i.test(key))) {
      return value;
    }
    if (["pdf", "application/pdf"].some((item) => String(search.get("format") || search.get("type") || "").toLowerCase() === item)) {
      return value;
    }
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return value;
    }
    if (parsed.protocol === "file:") {
      return value;
    }
  } catch {
    if (/^\d{4}\.\d{4,5}(?:v\d+)?$/i.test(value)) return value;
  }
  return "";
}

function isLocalFileSource(source) {
  try {
    return new URL(String(source || "")).protocol === "file:";
  } catch {
    return false;
  }
}

async function readLocalPdfFile(source) {
  let response;
  try {
    response = await fetch(source);
  } catch (error) {
    throw new Error("无法读取本地文件。请在扩展详情页开启“允许访问文件网址”后重试。");
  }
  if (!response.ok) {
    throw new Error("无法读取本地文件。请确认文件仍然存在，并允许扩展访问文件网址。");
  }
  const blob = await response.blob();
  const filename = getFilenameFromFileUrl(source);
  return new File([blob], filename, { type: blob.type || "application/pdf" });
}

function getFilenameFromFileUrl(source) {
  try {
    const parsed = new URL(String(source || ""));
    const pathname = decodeURIComponent(parsed.pathname || "");
    const name = pathname.split(/[\\/]/).filter(Boolean).pop();
    return /\.pdf$/i.test(name || "") ? name : "paper.pdf";
  } catch {
    return "paper.pdf";
  }
}

async function readJsonResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return response.json();
  const text = await response.text();
  throw new Error(text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() || `HTTP ${response.status}`);
}
