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

export function readerUrl(base, paperId) {
  return `${base}/reader.html?${new URLSearchParams({ id: paperId }).toString()}`;
}

export function normalizeImportSource(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value);
    if (parsed.hostname === "arxiv.org" && /^\/abs\//i.test(parsed.pathname)) {
      return value;
    }
    if (parsed.hostname === "arxiv.org" && /^\/pdf\//i.test(parsed.pathname)) {
      return value;
    }
    if (/\.pdf(?:$|[?#])/i.test(parsed.pathname)) return value;
  } catch {
    if (/^\d{4}\.\d{4,5}(?:v\d+)?$/i.test(value)) return value;
  }
  return "";
}

async function readJsonResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return response.json();
  const text = await response.text();
  throw new Error(text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() || `HTTP ${response.status}`);
}
