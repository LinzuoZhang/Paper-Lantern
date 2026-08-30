"""Crossref metadata lookup and citation formatting (Python standard library only).

The frontend calls ``/api/citation``; the server delegates here to:
  1. extract DOIs from a paper's extracted text (best effort),
  2. query the Crossref REST API for candidate works,
  3. rank candidates by DOI > title > author-list similarity,
  4. format each candidate's citation into the six supported styles.
"""

import json
import re
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from difflib import SequenceMatcher


CROSSREF_API_URL = "https://api.crossref.org"
ARXIV_API_URL = "https://export.arxiv.org/api/query"
MAILTO = "paperlantern@example.com"
USER_AGENT = f"PaperLantern/1.0 (mailto:{MAILTO})"
_ATOM_NS = "http://www.w3.org/2005/Atom"
_ARXIV_NS = "http://arxiv.org/schemas/atom"

# A DOI is "10." + 4-9 digit registrant + "/" + a suffix of allowed characters.
_DOI_RE = re.compile(r"10\.\d{4,9}/[^\s\"'<>]+", re.IGNORECASE)
# PDF text extraction often inserts spaces around the "/" (e.g. "10.1234 /abc").
_LOOSE_DOI_RE = re.compile(r"10\.\s*\d{4,9}\s*/\s*[^\s\"'<>]+", re.IGNORECASE)


def extract_dois(text):
    """Return a list of plausible DOIs found in ``text``, in order of appearance.

    Best-effort only: covers the unbroken form, ``doi:``/``doi.org`` URLs, and the
    common case where PDF extraction splits the DOI around its "/".
    """
    if not text:
        return []

    results = []
    seen = set()

    def add(raw):
        doi = _clean_doi(raw)
        if not doi or doi.lower() in seen:
            return
        seen.add(doi.lower())
        results.append(doi)

    collapsed = re.sub(r"\s+", " ", text)
    for match in _DOI_RE.finditer(collapsed):
        add(match.group(0))
    for match in _LOOSE_DOI_RE.finditer(text):
        add(re.sub(r"\s+", "", match.group(0)))

    return results


def _clean_doi(raw):
    value = str(raw or "").strip()
    match = re.search(r"10\.\d{4,9}/", value)
    if not match:
        return ""
    value = value[match.start():]
    while value and value[-1] in ".,;:)]}":
        value = value[:-1]
    return value


_FULL_DOI_LABEL_RE = re.compile(r"\bDigital\s+Object\s+Identifier\b\s*[:：]?\s*", re.IGNORECASE)
_DOI_ABBREV_RE = re.compile(r"\bDOI\b(?!\.)\s*[:：]?\s*", re.IGNORECASE)
_REFERENCE_HEADING_RE = re.compile(
    r"\b(?:references|bibliography|r\s+e\s*f\s*e\s*r\s*e\s*n\s*c\s*e\s*s|参考文献)\b",
    re.IGNORECASE,
)
_REFERENCE_MARKER_RE = re.compile(r"(?:^|\s)\[(\d{1,3})\]\s+")


def _strip_reference_section(text):
    """Return text before the bibliography so cited-work DOIs are not promoted."""
    source = str(text or "")
    if not source:
        return ""

    collapsed = re.sub(r"\s+", " ", source)
    heading_matches = list(_REFERENCE_HEADING_RE.finditer(collapsed))
    for match in reversed(heading_matches):
        preview = collapsed[match.start():match.start() + 1800]
        first_marker = re.search(r"\[(1)\]\s+", preview)
        if first_marker:
            return collapsed[:match.start() + first_marker.start()].strip()

    markers = [
        {"number": int(match.group(1)), "index": match.start() + match.group(0).find("[")}
        for match in _REFERENCE_MARKER_RE.finditer(collapsed)
    ]
    best_index = None
    best_count = 0
    for start_index, marker in enumerate(markers):
        if marker["number"] != 1:
            continue
        expected = 2
        last_index = marker["index"]
        count = 1
        for next_marker in markers[start_index + 1:]:
            if next_marker["index"] - last_index > 2500:
                break
            if next_marker["number"] != expected:
                continue
            count += 1
            expected += 1
            last_index = next_marker["index"]
            if expected > 12:
                break
        if count >= 5 and (best_index is None or count > best_count or marker["index"] > best_index):
            best_index = marker["index"]
            best_count = count

    return collapsed[:best_index].strip() if best_index is not None else source


def extract_paper_doi(text):
    """Return the paper's own DOI, preferring one introduced by a DOI label.

    A paper's extracted text contains many DOIs: its own plus every cited work
    (and often a "recommended for acceptance" footnote that cites the conference
    version). The paper's own DOI is the one introduced by the full phrase
    "Digital Object Identifier"; we fall back to a bare "DOI:" label, then to the
    first DOI before the reference section only when neither label is present.
    """
    if not text:
        return ""
    text = _strip_reference_section(text)
    if not text:
        return ""
    for pattern in (_FULL_DOI_LABEL_RE, _DOI_ABBREV_RE):
        for match in pattern.finditer(text):
            tail = text[match.end():match.end() + 150]
            dois = extract_dois(tail)
            if dois:
                return dois[0]
    dois = extract_dois(text)
    return dois[0] if dois else ""


def http_get_json(url, timeout=30):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def http_get_text(url, timeout=30):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", errors="replace")


def fetch_work_by_doi(doi):
    url = f"{CROSSREF_API_URL}/works/{urllib.parse.quote(doi, safe='/')}"
    try:
        data = http_get_json(url)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        raise
    message = data.get("message") if isinstance(data, dict) else None
    return normalize_work(message)


def search_works(title, authors, institutions):
    rows = 15
    queries = []

    bibliographic = " ".join(part for part in [title, *authors[:3], *institutions[:1]] if part)
    if bibliographic:
        queries.append(("query.bibliographic", bibliographic))
    if title:
        queries.append(("query.title", title))
    if authors:
        queries.append(("query.author", authors[0]))

    found = []
    seen = set()
    for key, value in queries:
        params = {"rows": rows, "mailto": MAILTO, key: value}
        url = f"{CROSSREF_API_URL}/works?{urllib.parse.urlencode(params)}"
        try:
            data = http_get_json(url)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError):
            continue
        message = data.get("message") if isinstance(data, dict) else {}
        for item in (message.get("items") or []):
            normalized = normalize_work(item)
            if not normalized:
                continue
            key = normalized["doi"].lower()
            if key in seen:
                continue
            seen.add(key)
            found.append(normalized)
    return found


def _arxiv_query_term(value):
    return str(value or "").replace('"', "").strip()


def search_arxiv(title, authors, max_results=10):
    if not title and not authors:
        return []

    terms = []
    if title:
        terms.append(f'ti:"{_arxiv_query_term(title)}"')
    if authors:
        terms.append(f'au:"{_arxiv_query_term(authors[0])}"')
    if not terms:
        return []

    search_query = " AND ".join(terms)
    params = {"search_query": search_query, "start": 0, "max_results": max_results}
    url = f"{ARXIV_API_URL}?{urllib.parse.urlencode(params)}"
    try:
        text = http_get_text(url)
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ValueError):
        return []
    return parse_arxiv_feed(text)


def parse_arxiv_feed(text):
    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        return []

    namespace = {"atom": _ATOM_NS, "arxiv": _ARXIV_NS}
    results = []
    for entry in root.findall("atom:entry", namespace):
        normalized = normalize_arxiv_entry(entry, namespace)
        if normalized:
            results.append(normalized)
    return results


def normalize_arxiv_entry(entry, namespace):
    title = " ".join((entry.findtext("atom:title", default="", namespaces=namespace) or "").split())
    if not title:
        return None

    authors = []
    for author_el in entry.findall("atom:author", namespaces=namespace):
        raw_name = " ".join((author_el.findtext("atom:name", default="", namespaces=namespace) or "").split())
        normalized = normalize_local_author(raw_name)
        if normalized:
            authors.append(normalized)

    published = entry.findtext("atom:published", default="", namespaces=namespace) or ""
    year = published[:4] if published else ""

    entry_id = entry.findtext("atom:id", default="", namespaces=namespace) or ""
    arxiv_id = ""
    match = re.search(r"abs/([^/]+)$", entry_id)
    if match:
        arxiv_id = match.group(1).split("v")[0] if "v" in match.group(1) else match.group(1)

    doi = (entry.findtext("arxiv:doi", default="", namespaces=namespace) or "").strip()
    if not doi and arxiv_id:
        doi = f"10.48550/arXiv.{arxiv_id}"

    return {
        "doi": doi,
        "title": title,
        "venue": "arXiv",
        "authors": authors,
        "authorNames": [author["name"] for author in authors],
        "institutions": [],
        "volume": "",
        "issue": "",
        "page": "",
        "year": year,
        "publishedDate": year,
        "publisher": "",
        "type": "preprint",
        "url": f"https://arxiv.org/abs/{arxiv_id}" if arxiv_id else "",
    }


def _first_string(value):
    if isinstance(value, list):
        for item in value:
            if item:
                return str(item)
        return ""
    return str(value or "")


def normalize_work(item):
    if not isinstance(item, dict):
        return None
    doi = str(item.get("DOI", "")).strip()
    if not doi:
        return None

    authors = []
    institutions = []
    for author in item.get("author") or []:
        if not isinstance(author, dict):
            continue
        given = " ".join(str(author.get("given", "")).split())
        family = " ".join(str(author.get("family", "")).split())
        name = " ".join(str(author.get("name", "")).split())
        if name or given or family:
            authors.append({"given": given, "family": family, "name": name})
        for affiliation in author.get("affiliation") or []:
            aff_name = str(affiliation.get("name", "")).strip() if isinstance(affiliation, dict) else str(affiliation).strip()
            if aff_name and aff_name not in institutions:
                institutions.append(aff_name)

    year = ""
    published_date = ""
    issued = item.get("issued") or {}
    date_parts = issued.get("date-parts") or []
    if date_parts and isinstance(date_parts[0], list) and date_parts[0]:
        parts = [str(part) for part in date_parts[0] if part is not None]
        if parts:
            year = parts[0]
            published_date = "-".join(parts)

    return {
        "doi": doi,
        "title": _first_string(item.get("title")),
        "venue": _first_string(item.get("container-title")),
        "authors": authors,
        "authorNames": [a["name"] or f"{a['given']} {a['family']}".strip() for a in authors],
        "institutions": institutions,
        "volume": str(item.get("volume", "") or "").strip(),
        "issue": str(item.get("issue", "") or "").strip(),
        "page": str(item.get("page", "") or "").strip(),
        "year": year,
        "publishedDate": published_date or year,
        "publisher": str(item.get("publisher", "") or "").strip(),
        "type": str(item.get("type", "") or "").strip(),
        "url": str(item.get("URL", "") or "").strip() or f"https://doi.org/{doi}",
    }


def candidate_to_basic_info(candidate):
    """Map a normalized Crossref work to the paper's basicInfo shape."""
    authors = []
    for author in candidate.get("authors") or []:
        name = author.get("name") or f"{author.get('given', '')} {author.get('family', '')}".strip()
        if name:
            authors.append(name)
    return {
        "authors": authors,
        "venue": candidate.get("venue", ""),
        "publishedDate": candidate.get("publishedDate", "") or candidate.get("year", ""),
        "institutions": candidate.get("institutions", []),
    }


def normalize_local_author(name):
    value = " ".join(str(name or "").split())
    if not value:
        return None
    if "," in value:
        family, given = [part.strip() for part in value.split(",", 1)]
        return {"given": given, "family": family, "name": value}
    parts = value.split()
    if len(parts) >= 2:
        return {"given": " ".join(parts[:-1]), "family": parts[-1], "name": value}
    return {"given": "", "family": value, "name": value}


def extract_year(value):
    match = re.search(r"(19|20)\d{2}", str(value or ""))
    return match.group(0) if match else ""


def make_local_citation_candidate(title, authors, venue="", year="", doi=""):
    clean_title = " ".join(str(title or "").split())
    clean_venue = " ".join(str(venue or "").split())
    clean_year = extract_year(year)
    normalized_authors = [
        author
        for author in (normalize_local_author(author_name) for author_name in (authors or []))
        if author
    ]
    candidate = {
        "doi": str(doi or "").strip(),
        "title": clean_title,
        "venue": clean_venue,
        "authors": normalized_authors,
        "authorNames": [author["name"] for author in normalized_authors],
        "volume": "",
        "issue": "",
        "page": "",
        "year": clean_year,
        "publisher": "",
        "type": "proceedings-article" if clean_venue else "misc",
        "url": f"https://doi.org/{doi}" if doi else "",
        "score": 10000,
        "titleSimilarity": 1.0 if clean_title else 0.0,
        "authorSimilarity": 1.0 if normalized_authors else 0.0,
        "matchLabel": "当前信息",
        "source": "local",
    }
    candidate["citations"] = format_citations(candidate)
    return candidate


def build_current_citation_results(title, authors, venue="", year="", doi=""):
    doi = str(doi or "").strip()
    return doi, [make_local_citation_candidate(title, authors, venue, year, doi)]


def _text_key(value):
    return re.sub(r"[^a-z0-9一-鿿]+", " ", str(value or "").lower()).strip()


def title_similarity(a, b):
    key_a = _text_key(a)
    key_b = _text_key(b)
    if not key_a or not key_b:
        return 0.0
    if key_a == key_b:
        return 1.0
    ratio = SequenceMatcher(None, key_a, key_b).ratio()
    tokens_a = set(key_a.split())
    tokens_b = set(key_b.split())
    intersection = tokens_a & tokens_b
    union = tokens_a | tokens_b
    jaccard = len(intersection) / len(union) if union else 0.0
    # Fraction of the longer title's tokens covered by the shorter one. This
    # still catches the common "one source omits a subtitle" case (YOPOv2 vs
    # YOPOv2: ... Framework), but unlike containment-by-the-shorter-length it
    # does NOT inflate short generic phrases ("Whole body manipulation") to a
    # near-perfect match against a long specific title.
    longer = max(len(tokens_a), len(tokens_b))
    coverage = len(intersection) / longer if longer else 0.0
    return max(ratio, jaccard, coverage)


def author_similarity(query_authors, candidate_names):
    if not query_authors or not candidate_names:
        return 0.0
    keys_q = [key for key in (_text_key(a) for a in query_authors) if key]
    keys_c = [key for key in (_text_key(a) for a in candidate_names) if key]
    if not keys_q or not keys_c:
        return 0.0

    total = 0.0
    for key_q in keys_q:
        best = 0.0
        for key_c in keys_c:
            ratio = SequenceMatcher(None, key_q, key_c).ratio()
            tokens_q = set(key_q.split())
            tokens_c = set(key_c.split())
            overlap = tokens_q & tokens_c
            if overlap:
                ratio = max(ratio, len(overlap) / len(tokens_q | tokens_c))
            best = max(best, ratio)
        total += best
    return total / len(keys_q)


def score_candidate(candidate, query):
    score = 0.0
    reasons = []

    query_doi = (query.get("doi") or "").strip().lower()
    if query_doi and candidate["doi"].lower() == query_doi:
        score += 1000
        reasons.append("DOI")

    title_sim = title_similarity(query.get("title") or "", candidate["title"])
    score += title_sim * 100
    if title_sim >= 0.55:
        reasons.append("标题")

    author_sim = author_similarity(query.get("authors") or [], candidate.get("authorNames") or [])
    score += author_sim * 10
    if author_sim >= 0.4:
        reasons.append("作者")

    candidate["score"] = round(score, 2)
    candidate["titleSimilarity"] = round(title_sim, 3)
    candidate["authorSimilarity"] = round(author_sim, 3)
    candidate["matchLabel"] = "、".join(reasons) if reasons else "相关"
    return candidate


def build_citation_results(title, authors, institutions, paper_text="", venue="", year="", doi=""):
    """Return ``(doi, candidates)`` where candidates are ranked by similarity."""
    doi = str(doi or "").strip()
    if not doi and paper_text:
        doi = extract_paper_doi(paper_text)

    query = {"doi": doi, "title": title, "authors": authors, "institutions": institutions}

    local_candidate = make_local_citation_candidate(title, authors, venue, year, doi)
    candidates = [local_candidate]
    seen_dois = set()

    def add_work(normalized):
        if not normalized:
            return
        key = normalized["doi"].lower()
        if key in seen_dois:
            return
        seen_dois.add(key)
        candidates.append(normalized)

    if doi:
        add_work(fetch_work_by_doi(doi))

    # Run Crossref and arXiv searches in parallel and merge the results.
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(search_works, title, authors, institutions),
            executor.submit(search_arxiv, title, authors),
        ]
        for future in futures:
            try:
                results = future.result()
            except Exception:
                continue
            for normalized in results:
                add_work(normalized)

    for candidate in candidates:
        if candidate.get("source") == "local":
            continue
        score_candidate(candidate, query)

    # Post-processing: drop candidates that are not the queried paper. The
    # bibliographic searches return a mix of the target and related/similar works
    # (e.g. "Whole-Body Manipulation" when searching "Whole-Body World-Action
    # Model"). A DOI-exact match is always kept; otherwise the candidate must
    # clearly be the same paper — a near-perfect title match, or a strong title
    # match with an author overlap.
    surviving = []
    for candidate in candidates:
        if candidate.get("source") == "local":
            surviving.append(candidate)
            continue
        if candidate["score"] >= 1000:
            surviving.append(candidate)
            continue
        title_sim = candidate.get("titleSimilarity", 0)
        author_sim = candidate.get("authorSimilarity", 0)
        if title_sim >= 0.9 or (title_sim >= 0.65 and author_sim >= 0.3):
            surviving.append(candidate)

    local_candidates = [candidate for candidate in surviving if candidate.get("source") == "local"]
    remote_candidates = [candidate for candidate in surviving if candidate.get("source") != "local"]
    remote_candidates.sort(key=lambda candidate: candidate["score"], reverse=True)
    for candidate in remote_candidates:
        candidate["citations"] = format_citations(candidate)
    candidates = local_candidates + remote_candidates

    return doi, candidates


def _author_parts(author):
    given = " ".join(str(author.get("given", "")).split())
    family = " ".join(str(author.get("family", "")).split())
    name = " ".join(str(author.get("name", "")).split())
    return name, given, family


def _bibtex_author(author):
    name, given, family = _author_parts(author)
    if family and given:
        return f"{family}, {given}"
    return name or family or given


def _gbt_author(author):
    name, given, family = _author_parts(author)
    if not family and not given:
        return name
    initials = " ".join(part[0].upper() for part in given.split() if part) if given else ""
    return " ".join(part for part in (family, initials) if part)


def _apa_author(author):
    name, given, family = _author_parts(author)
    if not family:
        return name or given
    initials = " ".join(f"{part[0].upper()}." for part in given.split() if part) if given else ""
    return f"{family}, {initials}".strip()


def _ieee_author(author):
    name, given, family = _author_parts(author)
    initials = " ".join(f"{part[0].upper()}." for part in given.split() if part) if given else ""
    if family:
        return f"{initials} {family}".strip()
    return name or given


def _mla_normal(author):
    name, given, family = _author_parts(author)
    if family and given:
        return f"{given} {family}"
    return name or family or given


def _split_pages(page):
    parts = re.split(r"[-–—]+", str(page or ""), maxsplit=1)
    start = parts[0].strip() if parts else ""
    end = parts[1].strip() if len(parts) > 1 else ""
    return start, end


_BIBTEX_TYPES = {
    "journal-article": "article",
    "proceedings-article": "inproceedings",
    "proceedings": "proceedings",
    "book": "book",
    "book-chapter": "incollection",
    "book-section": "incollection",
    "monograph": "book",
    "dissertation": "phdthesis",
    "report": "techreport",
    "posted-content": "misc",
    "preprint": "misc",
}

_RIS_TYPES = {
    "journal-article": "JOUR",
    "proceedings-article": "CONF",
    "proceedings": "CONF",
    "book": "BOOK",
    "book-chapter": "CHAP",
    "book-section": "CHAP",
    "monograph": "BOOK",
    "dissertation": "THES",
    "report": "RPRT",
    "posted-content": "GEN",
    "preprint": "GEN",
}

_GBT_MARKERS = {
    "journal-article": "[J]",
    "proceedings-article": "[C]",
    "proceedings": "[C]",
    "book": "[M]",
    "book-chapter": "[M]",
    "book-section": "[M]",
    "monograph": "[M]",
    "dissertation": "[D]",
    "report": "[R]",
    "posted-content": "[EB/OL]",
    "preprint": "[EB/OL]",
}


def format_citations(record):
    return {
        "gbt7714": format_gbt7714(record),
        "bibtex": format_bibtex(record),
        "ris": format_ris(record),
        "apa": format_apa(record),
        "mla": format_mla(record),
        "ieee": format_ieee(record),
    }


def format_gbt7714(record):
    authors = record.get("authors") or []
    author_names = [name for name in (_gbt_author(a) for a in authors) if name]
    if author_names:
        author_part = ", ".join(author_names[:3]) + (", 等" if len(author_names) > 3 else "")
    else:
        author_part = ""

    title = record.get("title", "")
    marker = _GBT_MARKERS.get(record.get("type"), "[J]")
    head = f"{author_part}. {title}{marker}" if author_part else f"{title}{marker}"

    venue = record.get("venue", "")
    year = record.get("year", "")
    volume = record.get("volume", "")
    issue = record.get("issue", "")
    page = record.get("page", "")

    vol_issue = ""
    if volume:
        vol_issue = volume + (f"({issue})" if issue else "")
    elif issue:
        vol_issue = issue

    tail = venue
    if year:
        tail = f"{tail}, {year}" if tail else year
    if vol_issue:
        tail = f"{tail}, {vol_issue}" if tail else vol_issue
    if page:
        separator = ": " if vol_issue else (", " if tail else "")
        tail = f"{tail}{separator}{page}"

    return f"{head}. {tail}." if tail else f"{head}."


def _bibtex_escape(text):
    replacements = {"&": "\\&", "%": "\\%", "$": "\\$", "#": "\\#", "_": "\\_", "{": "\\{", "}": "\\}"}
    return "".join(replacements.get(ch, ch) for ch in str(text or ""))


def _bibtex_key(record):
    authors = record.get("authors") or []
    family = ""
    if authors:
        _, _, family = _author_parts(authors[0])
        family = family or authors[0].get("name", "")
    first_word = ""
    title_words = re.findall(r"[A-Za-z0-9]+", record.get("title", ""))
    if title_words:
        first_word = title_words[0].lower()
    key = "".join(ch for ch in (family + record.get("year", "") + first_word) if ch.isalnum())
    return key or "reference"


def format_bibtex(record):
    entry_type = _BIBTEX_TYPES.get(record.get("type"), "misc")
    key = _bibtex_key(record)
    lines = [f"@{entry_type}{{{key},"]

    authors = record.get("authors") or []
    author_joined = " and ".join(a for a in (_bibtex_author(a) for a in authors) if a)
    if author_joined:
        lines.append(f"  author = {{{_bibtex_escape(author_joined)}}},")
    if record.get("title"):
        lines.append(f"  title = {{{_bibtex_escape(record['title'])}}},")
    if record.get("venue"):
        field = "journal" if entry_type == "article" else "booktitle"
        lines.append(f"  {field} = {{{_bibtex_escape(record['venue'])}}},")
    if record.get("year"):
        lines.append(f"  year = {{{record['year']}}},")
    if record.get("volume"):
        lines.append(f"  volume = {{{record['volume']}}},")
    if record.get("issue"):
        lines.append(f"  number = {{{record['issue']}}},")
    if record.get("page"):
        start, end = _split_pages(record["page"])
        pages = f"{start}--{end}" if end else start
        lines.append(f"  pages = {{{pages}}},")
    if record.get("publisher"):
        lines.append(f"  publisher = {{{_bibtex_escape(record['publisher'])}}},")
    if record.get("doi"):
        lines.append(f"  doi = {{{record['doi']}}},")
    lines.append("}")
    return "\n".join(lines)


def format_ris(record):
    entry_type = _RIS_TYPES.get(record.get("type"), "GEN")
    lines = [f"TY  - {entry_type}"]
    for author in record.get("authors") or []:
        name = _bibtex_author(author)
        if name:
            lines.append(f"AU  - {name}")
    if record.get("title"):
        lines.append(f"TI  - {record['title']}")
    if record.get("venue"):
        lines.append(f"JO  - {record['venue']}")
    if record.get("year"):
        lines.append(f"PY  - {record['year']}")
    if record.get("volume"):
        lines.append(f"VL  - {record['volume']}")
    if record.get("issue"):
        lines.append(f"IS  - {record['issue']}")
    start, end = _split_pages(record.get("page", ""))
    if start:
        lines.append(f"SP  - {start}")
    if end:
        lines.append(f"EP  - {end}")
    if record.get("publisher"):
        lines.append(f"PB  - {record['publisher']}")
    if record.get("doi"):
        lines.append(f"DO  - {record['doi']}")
    lines.append("ER  - ")
    return "\n".join(lines)


def format_apa(record):
    apa_authors = [name for name in (_apa_author(a) for a in (record.get("authors") or [])) if name]
    if apa_authors:
        if len(apa_authors) == 1:
            author_str = apa_authors[0]
        elif len(apa_authors) == 2:
            author_str = f"{apa_authors[0]}, & {apa_authors[1]}"
        elif len(apa_authors) <= 20:
            author_str = ", ".join(apa_authors[:-1]) + ", & " + apa_authors[-1]
        else:
            author_str = ", ".join(apa_authors[:19]) + ", ... " + apa_authors[-1]
    else:
        author_str = ""

    title = record.get("title", "")
    venue = record.get("venue", "")
    volume = record.get("volume", "")
    issue = record.get("issue", "")
    page = record.get("page", "")
    year = record.get("year", "")

    body = f"{title}."
    source = venue
    if volume:
        source = f"{source}, {volume}" + (f"({issue})" if issue else "")
    if page:
        source = f"{source}, {page}" if source else page
    if source:
        body += f" {source}."
    if record.get("doi"):
        body += f" https://doi.org/{record['doi']}"
    elif record.get("url"):
        body += f" {record['url']}"

    year_part = f"({year})." if year else ""
    return f"{author_str} {year_part} {body}".strip() if author_str else f"{year_part} {body}".strip()


def format_mla(record):
    authors = record.get("authors") or []
    if authors:
        first = _bibtex_author(authors[0])
        rest = [name for name in (_mla_normal(a) for a in authors[1:]) if name]
        if not rest:
            author_str = first
        elif len(rest) == 1:
            author_str = f"{first}, and {rest[0]}"
        else:
            author_str = f"{first}, et al."
    else:
        author_str = ""

    parts = []
    if author_str:
        parts.append(author_str)
    parts.append(f'"{record.get("title", "")}."')
    if record.get("venue"):
        parts.append(record["venue"])
    volume = record.get("volume", "")
    issue = record.get("issue", "")
    if volume:
        volume_part = f"vol. {volume}"
        if issue:
            volume_part += f", no. {issue}"
        parts.append(volume_part)
    elif issue:
        parts.append(f"no. {issue}")
    if record.get("year"):
        parts.append(record["year"])
    if record.get("page"):
        parts.append(f"pp. {record['page']}")
    return ", ".join(parts) + "."


def format_ieee(record):
    ieee_authors = [name for name in (_ieee_author(a) for a in (record.get("authors") or [])) if name]
    if ieee_authors:
        if len(ieee_authors) == 1:
            author_str = ieee_authors[0]
        elif len(ieee_authors) == 2:
            author_str = f"{ieee_authors[0]} and {ieee_authors[1]}"
        else:
            author_str = ", ".join(ieee_authors[:-1]) + ", and " + ieee_authors[-1]
    else:
        author_str = ""

    parts = []
    if author_str:
        parts.append(author_str)
    parts.append(f'"{record.get("title", "")},"')
    if record.get("venue"):
        parts.append(record["venue"])
    volume = record.get("volume", "")
    if volume:
        volume_part = f"vol. {volume}"
        if record.get("issue"):
            volume_part += f", no. {record['issue']}"
        parts.append(volume_part)
    if record.get("page"):
        parts.append(f"pp. {record['page']}")
    if record.get("year"):
        parts.append(record["year"])
    return ", ".join(parts) + "."
