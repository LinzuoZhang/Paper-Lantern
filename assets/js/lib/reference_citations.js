const NAME_WORD = String.raw`(?:\p{Lu}\.|\p{Lu}[\p{L}\p{M}'’ʼ-]*|van|von|de|del|der|den|da|di|la|le)`;
const YEAR = String.raw`(?:18|19|20|21)\d{2}[a-z]?`;
const SURNAME = String.raw`\p{Lu}[\p{L}\p{M}'’ʼ-]*`;
const indexes = new WeakMap();

function cleanReferenceText(value) {
  return String(value || "").replace(/\s+/g, " ").replace(/\s+([,.;:])/g, "$1").trim();
}

function normalizeAuthor(value) {
  return value.normalize("NFKC").replace(/[’ʼ‘]/g, "'").toLowerCase();
}

function firstAuthor(reference) {
  const prefix = reference.match(new RegExp(`^${NAME_WORD}(?:\\s+${NAME_WORD}){0,6}`, "u"))?.[0] || "";
  const author = prefix.split(/\s+(?:and|et\s+al)\b/)[0].trim();
  return author.split(/\s+/).at(-1)?.replace(/\.$/, "") || "";
}

function referenceYears(reference) {
  return Array.from(reference.matchAll(new RegExp(`(?<![\\p{L}\\d])(${YEAR})(?![\\p{L}\\d])`, "gu")), (match) => match[1]);
}

function authorYearCitations(text) {
  const authors = `${SURNAME}(?:(?:\\s+(?:and|&)\\s+|\\s*,\\s*(?:and\\s+)?)${SURNAME})*`;
  const pattern = new RegExp(`(?<![\\p{L}\\p{M}'’ʼ-])(${authors})(?:\\s+et\\s+al\\.?)?(?:\\s*[,，]\\s*|\\s*[(（]\\s*|\\s+)(${YEAR}(?:\\s*[,，]\\s*${YEAR})*)(?![\\p{L}\\d])(?:\\s*[)）])?`, "gu");
  return Array.from(text.matchAll(pattern), (match) => ({
    index: match.index, text: match[0],
    authors: Array.from(match[1].matchAll(new RegExp(SURNAME, "gu")), (name) => normalizeAuthor(name[0])),
    years: referenceYears(match[2]),
  }));
}

function referenceAuthorNames(reference) {
  let end = reference.search(new RegExp(`(?<![\\p{L}\\d])${YEAR}(?![\\p{L}\\d])`, "u"));
  if (end < 0) end = reference.length;
  for (const match of reference.matchAll(/\.(?=\s|$)/g)) {
    const word = reference.slice(0, match.index).match(/([\p{L}\p{M}'’ʼ-]+)$/u)?.[1];
    if (word && word.length === 1) continue; // Author initials are not the end of the author list.
    end = Math.min(end, match.index);
    break;
  }
  return new Set(Array.from(reference.slice(0, end).matchAll(new RegExp(SURNAME, "gu")), (name) => normalizeAuthor(name[0])));
}

function isEntryBoundary(section, offset) {
  const before = section.slice(0, offset).trimEnd();
  if (!before) return true;
  // Page numbers may occur between entries. Initials and “et al.” stay in the author list.
  const end = before.match(/([^\s]+)\.\s*(?:\d+(?:\s*[,–-]\s*\d+)*\s*)?$/u);
  return Boolean(end && !/^(?:\p{L}|al|pp|vol)$/iu.test(end[1]));
}

function unnumberedEntries(section, citedAuthors) {
  const starts = [];
  const pattern = new RegExp(`(?<![\\p{L}\\p{M}'’ʼ-])${NAME_WORD}(?:\\s+${NAME_WORD}){0,5}(?=\\s*[,.(]|\\s+(?:and|&)\\s+)`, "gu");
  for (const match of section.matchAll(pattern)) {
    if (!isEntryBoundary(section, match.index)) continue;
    if (/^(?:In|Proceedings|IEEE|The)\b/.test(match[0])) continue;
    const after = section.slice(match.index + match[0].length);
    const cited = citedAuthors.has(normalizeAuthor(firstAuthor(match[0])));
    // A year after a comma can also follow a publisher; require a cited name for that form.
    if (after.startsWith(",") && !new RegExp(`^,\\s*(?:(?:and\\s+)?${NAME_WORD}\\s+${NAME_WORD}|\\p{Lu}\\.|et\\s+al)`, "u").test(after)
      && !(cited && new RegExp(`^,\\s*${YEAR}`, "u").test(after))) continue;
    if (!after.startsWith(",") && !new RegExp(`^\\s*[.(]\\s*${YEAR}`, "u").test(after) && !cited) continue;
    starts.push(match.index);
  }
  const entries = new Map();
  starts.forEach((start, index) => {
    const text = cleanReferenceText(section.slice(start, starts[index + 1] ?? section.length));
    const author = firstAuthor(text);
    const year = referenceYears(text)[0];
    if (!author || !year || text.length < 12) return;
    let key = `${author} · ${year}`;
    if (entries.has(key)) key += ` · ${index + 1}`;
    entries.set(key, text);
  });
  return entries;
}

export function extractReferenceEntries(text) {
  const source = cleanReferenceText(String(text || "").replace(/\0/g, " "));
  if (!source) return new Map();
  const headings = Array.from(source.matchAll(/\b(?:references|bibliography|r\s+e\s*f\s*e\s*r\s*e\s*n\s*c\s*e\s*s)\b|参考文献/gi));
  for (let index = headings.length - 1; index >= 0; index -= 1) {
    const heading = headings[index];
    const section = source.slice(heading.index + heading[0].length).trim();
    const firstMarker = section.slice(0, 1800).match(/\[1\]\s+/);
    if (firstMarker) return numberedEntries(section.slice(firstMarker.index));
    const citedAuthors = new Set(authorYearCitations(source.slice(0, heading.index)).flatMap((citation) => citation.authors));
    const entries = unnumberedEntries(trimReferenceSection(section), citedAuthors);
    if (entries.size) return entries;
  }
  const start = findSequentialReferenceListStart(source);
  return start < 0 ? new Map() : numberedEntries(source.slice(start));
}

function trimReferenceSection(section) {
  const appendix = section.match(/\b(?:appendix|a\s+p\s*p\s*e\s*n\s*d\s*i\s*x)\b|附录/i);
  return appendix ? section.slice(0, appendix.index) : section;
}

function numberedEntries(section) {
  // Preserve the numbered parser's tolerance of “appendix” inside an early entry.
  const trimmed = trimReferenceSection(section);
  if ((trimmed.match(/(?:^|\s)\[\d{1,3}\]\s+/g) || []).length >= 5) section = trimmed;
  const markers = Array.from(section.matchAll(/(?:^|\s)\[(\d{1,3})\]\s+/g));
  const entries = new Map();
  markers.forEach((marker, index) => {
    const text = cleanReferenceText(section.slice(marker.index + marker[0].length, markers[index + 1]?.index ?? section.length));
    if (text.length >= 12) entries.set(marker[1], text);
  });
  return entries;
}

function findSequentialReferenceListStart(source) {
  const markers = Array.from(source.matchAll(/(?:^|\s)\[(\d{1,3})\]\s+/g), (match) => ({ number: Number(match[1]), index: match.index + match[0].indexOf("[") }));
  let best = null;
  markers.forEach((marker, startIndex) => {
    if (marker.number !== 1) return;
    let expected = 2;
    let lastIndex = marker.index;
    let count = 1;
    for (let index = startIndex + 1; index < markers.length && expected <= 12; index += 1) {
      const next = markers[index];
      if (next.index - lastIndex > 2500) break;
      if (next.number !== expected) continue;
      count += 1;
      expected += 1;
      lastIndex = next.index;
    }
    if (count >= 5 && (!best || count > best.count || marker.index > best.index)) best = { count, index: marker.index };
  });
  return best?.index ?? -1;
}

function citationIndex(entries) {
  if (indexes.has(entries)) return indexes.get(entries);
  const index = new Map();
  entries.forEach((text, key) => {
    const author = normalizeAuthor(firstAuthor(text));
    if (!author) return;
    const names = referenceAuthorNames(text);
    for (const year of referenceYears(text)) {
      const citationKey = `${author}:${year}`;
      const keys = index.get(citationKey) || [];
      if (!keys.some((entry) => entry.key === key)) keys.push({ key, names });
      index.set(citationKey, keys);
    }
  });
  indexes.set(entries, index);
  return index;
}

export function findReferenceCitations(text, entries) {
  const matches = [];
  for (const match of text.matchAll(/\[\s*\d{1,3}(?:\s*[,，–-]\s*\d{1,3})*\s*\]/g)) {
    const keys = getCitationNumbers(match[0]).filter((key) => entries.has(key));
    if (keys.length) matches.push({ index: match.index, text: match[0], keys });
  }
  const index = citationIndex(entries);
  for (const citation of authorYearCitations(text)) {
    const keys = new Set();
    for (const year of citation.years) {
      for (const entry of index.get(`${citation.authors[0]}:${year}`) || []) {
        if (citation.authors.slice(1).every((author) => entry.names.has(author))) keys.add(entry.key);
      }
    }
    if (keys.size) matches.push({ index: citation.index, text: citation.text, keys: Array.from(keys) });
  }
  return matches.sort((a, b) => a.index - b.index);
}

export function getReferenceLabel(key) {
  return /^\d+$/.test(key) ? `[${key}]` : key;
}

function getCitationNumbers(value) {
  const numbers = [];
  value.slice(1, -1).split(/[，,]/).forEach((part) => {
    const range = part.match(/(\d{1,3})\s*[-–]\s*(\d{1,3})/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      const step = start <= end ? 1 : -1;
      for (let number = start; number !== end + step; number += step) numbers.push(String(number));
    } else {
      const single = part.match(/\d{1,3}/);
      if (single) numbers.push(single[0]);
    }
  });
  return Array.from(new Set(numbers));
}
