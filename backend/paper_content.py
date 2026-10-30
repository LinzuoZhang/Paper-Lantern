"""Read-only, bounded article passages and literal multilingual retrieval."""

import hashlib
import json
import re
import unicodedata


SOURCES = ("abstract", "summary", "notes", "full_text")
PASSAGE_CHARS = 1200
PASSAGE_OVERLAP = 160


def normalize_search(text):
    return " ".join(unicodedata.normalize("NFKC", text).casefold().split())


def query_terms(query):
    if len(query) > 2000:
        raise ValueError("query allows at most 2000 characters.")
    terms = list(dict.fromkeys(normalize_search(query).split()))
    if not terms or len(terms) > 32:
        raise ValueError("query requires 1–32 whitespace-separated search terms.")
    return terms


def read_full_text(directory, cache_name):
    """Prefer page-aware PDF text; never assign PDF pages to a flat cache."""
    try:
        import fitz

        with fitz.open(directory / "paper.pdf") as pdf:
            pages = [(index + 1, page.get_text()) for index, page in enumerate(pdf)]
        if not any(text.strip() for _, text in pages):
            raise ValueError("PDF has no extractable text; scanned PDFs require OCR.")
        return pages, "pdf", []
    except Exception as exc:
        cache = directory / cache_name
        if cache.is_file():
            text = cache.read_text(encoding="utf-8")
            if text.strip():
                return [(None, text)], "cache", [
                    "PDF text unavailable; using the flat text cache without page numbers."
                ]
        raise ValueError("No extractable article text. Provide a text cache or a readable text PDF "
                         "and install PyMuPDF; scanned PDFs require OCR.") from exc


def read_source(directory, metadata, source, cache_name, notes_name):
    if source == "full_text":
        return read_full_text(directory, cache_name)
    if source == "abstract":
        basic = metadata.get("basicInfo")
        basic = basic if isinstance(basic, dict) else {}
        text = str(metadata.get("abstract") or basic.get("abstract") or "")
    elif source == "summary":
        summary = metadata.get("threeLineSummary")
        text = "\n".join(f"{key}: {value}" for key, value in sorted(summary.items())
                         if value is not None) if isinstance(summary, dict) else ""
    elif source == "notes":
        # Do not use read_paper_notes: it migrates legacy metadata on read.
        notes = directory / notes_name
        text = notes.read_text(encoding="utf-8") if notes.is_file() else str(metadata.get("notes") or "")
    else:
        raise ValueError("Unknown content source.")
    return [(None, text)], "stored", []


def build_passages(paper_id, source, pages, origin):
    """IDs bind the article, source representation, and exact source version."""
    version = hashlib.sha256(json.dumps(
        ["passages-v1", paper_id, source, origin, pages], ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")).hexdigest()
    passages = []
    for page_number, text in pages:
        start = 0
        while start < len(text):
            end = min(start + PASSAGE_CHARS, len(text))
            if end < len(text):
                boundary = max((match.end() for match in re.finditer(
                    r"\s+", text[start + PASSAGE_CHARS // 2:end]
                )), default=0)
                if boundary:
                    end = start + PASSAGE_CHARS // 2 + boundary
            if text[start:end].strip():
                passages.append({
                    "passageId": f"{source}:{version}:{len(passages)}",
                    "source": source, "sourceVersion": version, "textOrigin": origin,
                    "pageNumber": page_number,
                    "offsetScope": "page" if page_number is not None else "source",
                    "startChar": start, "endChar": end, "text": text[start:end],
                })
            if end == len(text):
                break
            start = max(start + 1, end - PASSAGE_OVERLAP)
    return version, passages


def score_passage(passage, terms, match):
    text = normalize_search(passage["text"])
    matched = [term for term in terms if term in text]
    if not matched or (match == "all" and len(matched) != len(terms)):
        return None
    return {**passage, "matchedTerms": matched,
            "score": sum(min(text.count(term), 10) for term in matched)}
