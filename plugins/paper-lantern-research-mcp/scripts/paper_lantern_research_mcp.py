#!/usr/bin/env python3
"""MCP stdio server for Paper Lantern literature-library operations."""

from __future__ import annotations

import json
import hashlib
import os
import sys
import traceback
from copy import deepcopy
from pathlib import Path
from typing import Any, Callable


SERVER_NAME = "paper-lantern-research"
SERVER_VERSION = "0.6.0"


def find_project_root() -> Path:
    env_root = os.environ.get("PAPER_LANTERN_PROJECT_DIR", "").strip()
    candidates = []
    if env_root:
        candidates.append(Path(env_root))
    candidates.extend(Path(__file__).resolve().parents)
    for candidate in candidates:
        root = candidate.resolve()
        if (root / "server.py").exists():
            return root
    raise RuntimeError("Paper Lantern project root not found. Set PAPER_LANTERN_PROJECT_DIR.")


PROJECT_ROOT = find_project_root()
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import server as paper_server  # noqa: E402
from backend.mcp_markdown import MARKDOWN_RULES, validate_note_markdown  # noqa: E402
from backend.paper_content import SOURCES, build_passages, query_terms, read_source, score_passage  # noqa: E402


JsonObject = dict[str, Any]


def json_response(message_id: Any, result: Any = None, error: JsonObject | None = None) -> JsonObject:
    response: JsonObject = {"jsonrpc": "2.0", "id": message_id}
    if error is not None:
        response["error"] = error
    else:
        response["result"] = result if result is not None else {}
    return response


def tool_text(payload: Any) -> JsonObject:
    return {
        "content": [
            {
                "type": "text",
                "text": json.dumps(payload, ensure_ascii=False, indent=2),
            }
        ],
        "isError": False,
    }


def tool_error(message: str) -> JsonObject:
    return {"content": [{"type": "text", "text": message}], "isError": True}


def read_db() -> JsonObject:
    return paper_server.load_library_db()


def validate_value(value: Any, schema: JsonObject, path: str = "arguments") -> None:
    expected = schema.get("type")
    matches = {
        "object": isinstance(value, dict),
        "array": isinstance(value, list),
        "string": isinstance(value, str),
        "integer": isinstance(value, int) and not isinstance(value, bool),
        "boolean": isinstance(value, bool),
    }
    if expected in matches and not matches[expected]:
        raise ValueError(f"{path} must be {expected}.")
    if "enum" in schema and value not in schema["enum"]:
        raise ValueError(f"{path} must be one of {schema['enum']}.")
    if isinstance(value, dict):
        for key in schema.get("required", []):
            if key not in value:
                raise ValueError(f"{path}.{key} is required.")
        properties = schema.get("properties", {})
        for key, item in value.items():
            if key in properties:
                validate_value(item, properties[key], f"{path}.{key}")
            elif schema.get("additionalProperties") is False:
                raise ValueError(f"Unknown argument: {path}.{key}.")
    elif isinstance(value, list):
        if len(value) < schema.get("minItems", 0):
            raise ValueError(f"{path} requires at least {schema['minItems']} items.")
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            raise ValueError(f"{path} allows at most {schema['maxItems']} items.")
        for index, item in enumerate(value):
            validate_value(item, schema.get("items", {}), f"{path}[{index}]")
    elif isinstance(value, int) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            raise ValueError(f"{path} must be at least {schema['minimum']}.")
        if "maximum" in schema and value > schema["maximum"]:
            raise ValueError(f"{path} must be at most {schema['maximum']}.")
    elif isinstance(value, str) and len(value.strip()) < schema.get("minLength", 0):
        raise ValueError(f"{path} must not be blank.")


def item_summary(item: JsonObject, db: JsonObject) -> JsonObject:
    ids = item.get("categoryIds", [item.get("categoryId", item.get("category", paper_server.UNCATEGORIZED_ID))])
    names = [db["categories"].get(key, {}).get("name", paper_server.UNCATEGORIZED_NAME) for key in ids]
    return {
        "id": item.get("id", ""),
        "title": item.get("title", ""),
        "categoryId": ids[0],
        "categoryName": names[0],
        "categoryIds": ids,
        "categoryNames": names,
        "itemType": item.get("itemType", "paper"),
        "uploadedAt": item.get("uploadedAt", ""),
    }


def format_paper_link_label(paper: JsonObject) -> str:
    basic = paper.get("basicInfo") if isinstance(paper.get("basicInfo"), dict) else {}
    authors = [str(author).strip() for author in basic.get("authors", []) if str(author).strip()] if isinstance(basic.get("authors"), list) else []
    if len(authors) > 1:
        return f"{authors[0]} et al."
    if len(authors) == 1:
        return authors[0]
    return str(paper.get("title") or paper.get("id") or "").strip()


def markdown_link(label: str, paper_id: str) -> str:
    safe_label = str(label or paper_id).replace("\\", "\\\\").replace("[", "\\[").replace("]", "\\]").replace("\n", " ").strip()
    return f"[{safe_label}](hash:{paper_id})"


def tool_library_overview(args: JsonObject) -> JsonObject:
    db = read_db()
    categories = []
    for item in sorted(db.get("categories", {}).values(), key=lambda item: (item.get("parentId", ""), item.get("order", 0), item.get("name", ""))):
        scope = set(paper_server.category_descendants(db, item["id"]))
        categories.append({
            **item,
            "directItemCount": sum(item["id"] in paper["categoryIds"] for paper in db["papers"].values()),
            "itemCount": sum(bool(scope.intersection(paper["categoryIds"])) for paper in db["papers"].values()),
        })
    papers = [item_summary(paper, db) for paper in db.get("papers", {}).values()]
    limit = int(args.get("limit", 50) or 50)
    return tool_text(
        {
            "libraryRoot": str(paper_server.LIBRARY_DIR),
            "categoryCount": len(categories),
            "itemCount": len(papers),
            "categories": categories,
            "recentItems": sorted(papers, key=lambda item: item.get("uploadedAt", ""), reverse=True)[: max(1, min(limit, 200))],
        }
    )


def tool_search_library(args: JsonObject) -> JsonObject:
    query = str(args.get("query", "")).strip().lower()
    filters = args.get("categoryIds", [args.get("categoryId", "")])
    if not isinstance(filters, list) or any(not isinstance(key, str) for key in filters):
        raise ValueError("categoryIds must be an array of strings.")
    filters = sorted({paper_server.UNCATEGORIZED_ID if key.strip() in {"Uncategorized", "未分类"} else key.strip().replace("\\", "/") for key in filters if key.strip()})
    match = args.get("categoryMatch", "any")
    if match not in {"any", "all"}:
        raise ValueError("categoryMatch must be any or all.")
    include_descendants = args.get("includeDescendants", True)
    item_type = str(args.get("itemType", "")).strip()
    limit = max(1, min(int(args.get("limit", 30) or 30), 200))
    db = read_db()
    scopes = [set(paper_server.category_descendants(db, key)) if include_descendants else {key} for key in filters]
    matches = []
    for record in db.get("papers", {}).values():
        checks = [bool(scope.intersection(record["categoryIds"])) for scope in scopes]
        if checks and not (all(checks) if match == "all" else any(checks)):
            continue
        if item_type and (record.get("itemType", "paper") != item_type):
            continue
        summary = item_summary(record, db)
        haystack = " ".join([str(record.get("id", "")), str(record.get("title", "")), *summary["categoryIds"], *summary["categoryNames"]]).lower()
        if query and query not in haystack:
            continue
        matches.append(summary)
    matches.sort(key=lambda item: item.get("uploadedAt", ""), reverse=True)
    return tool_text({"query": query, "categoryIds": filters, "categoryMatch": match, "includeDescendants": include_descendants, "totalMatches": len(matches), "matches": matches[:limit]})


def tool_get_item(args: JsonObject) -> JsonObject:
    item_id = str(args.get("id", "")).strip()
    include_text = bool(args.get("includeExtractedText", False))
    if not item_id:
        raise ValueError("id is required.")
    paper = paper_server.read_paper(item_id, include_extracted_text=include_text)
    return tool_text({"item": paper, "paperLink": markdown_link(format_paper_link_label(paper), item_id)})


def select_papers(db: JsonObject, hashes: list[str] | None = None) -> list[JsonObject]:
    """Select PDF articles only; explicit selections preserve caller order."""
    keys = list(dict.fromkeys(value.strip() for value in hashes)) if hashes is not None else sorted(db.get("papers", {}))
    records = []
    for key in keys:
        record = db.get("papers", {}).get(key)
        if not record or record.get("itemType", "paper") != "paper":
            if hashes is not None:
                raise FileNotFoundError(f"Article not found: {key}")
            continue
        records.append(record)
    return records


def article_metadata(record: JsonObject, db: JsonObject) -> tuple[JsonObject, JsonObject]:
    directory = paper_server.paper_dir_from_record(record)
    if not directory.is_dir():
        raise FileNotFoundError(f"Article directory not found: {record['id']}")
    metadata = paper_server.read_json(directory / "metadata.json", {})
    return {**item_summary(record, db), "hash": record["id"],
            "title": metadata.get("title") or record.get("title") or record["id"]}, metadata


def article_summary(metadata: JsonObject) -> JsonObject:
    basic = metadata.get("basicInfo") if isinstance(metadata.get("basicInfo"), dict) else {}
    abstract = str(metadata.get("abstract") or basic.get("abstract") or "").strip()
    overview = metadata.get("threeLineSummary")
    overview = overview if isinstance(overview, dict) else {}
    return {"abstract": abstract, "threeLineSummary": overview,
            "hasSummary": bool(abstract or any(str(value or "").strip() for value in overview.values()))}


@paper_server.library_locked
def tool_list_papers(args: JsonObject) -> JsonObject:
    db = read_db()
    papers = [article_metadata(record, db)[0] for record in select_papers(db, args.get("hashes"))]
    return tool_text({"total": len(papers), "hashes": [paper["hash"] for paper in papers], "papers": papers})


@paper_server.library_locked
def tool_list_paper_summaries(args: JsonObject) -> JsonObject:
    db = read_db()
    papers = []
    for record in select_papers(db, args.get("hashes")):
        paper, metadata = article_metadata(record, db)
        papers.append({**paper, **article_summary(metadata)})
    return tool_text({"total": len(papers), "hashes": [paper["hash"] for paper in papers], "papers": papers})


@paper_server.library_locked
def tool_get_paper_summary(args: JsonObject) -> JsonObject:
    db = read_db()
    record = select_papers(db, [args["hash"]])[0]
    paper, metadata = article_metadata(record, db)
    return tool_text({**paper, **article_summary(metadata)})


@paper_server.library_locked
def read_article_text(paper_hash: str) -> tuple[JsonObject, JsonObject, str]:
    db = read_db()
    record = select_papers(db, [paper_hash])[0]
    paper, metadata = article_metadata(record, db)
    # The full-text tool must not inherit the discussion context's truncation.
    text = paper_server.read_discussion_paper_text(paper_server.paper_dir_from_record(record), max_chars=sys.maxsize)
    if not text.strip():
        raise ValueError("No extractable article text. Open the article to extract text or use a PDF with a text layer.")
    return paper, metadata, text


def tool_get_paper_full_text(args: JsonObject) -> JsonObject:
    paper, _metadata, text = read_article_text(args["hash"])
    return tool_text({**paper, "text": text, "charCount": len(text)})


@paper_server.library_locked
def read_article_content(paper_hash: str, sources: list[str], db: JsonObject | None = None) -> tuple[JsonObject, JsonObject, list[JsonObject]]:
    db = read_db() if db is None else db
    record = select_papers(db, [paper_hash])[0]
    paper, metadata = article_metadata(record, db)
    directory = paper_server.paper_dir_from_record(record)
    documents, warnings = {}, []
    for source in sources:
        try:
            pages, origin, notices = read_source(
                directory, metadata, source, paper_server.EXTRACTED_TEXT_FILE, paper_server.NOTES_FILE,
            )
            version, passages = build_passages(record["id"], source, pages, origin)
            documents[source] = {"sourceVersion": version, "passages": passages,
                                 "pageCount": len(pages) if origin == "pdf" else None}
            warnings.extend({"hash": record["id"], "source": source, "message": notice} for notice in notices)
        except (OSError, ValueError, RuntimeError) as exc:
            warnings.append({"hash": record["id"], "source": source, "message": str(exc)})
    return paper, documents, warnings


def tool_search_paper_content(args: JsonObject) -> JsonObject:
    terms = query_terms(args["query"])
    sources = list(dict.fromkeys(args.get("sources", SOURCES)))
    match = args.get("match", "all")
    filters = args.get("categoryIds", [args.get("categoryId", "")])
    filters = list(dict.fromkeys(paper_server.UNCATEGORIZED_ID if key.strip() in {"Uncategorized", "未分类"}
                                 else key.strip().replace("\\", "/") for key in filters if key.strip()))
    with paper_server.LIBRARY_LOCK:
        db = read_db()
        records = select_papers(db, args.get("hashes"))
        scopes = [set(paper_server.category_descendants(db, key)) if args.get("includeDescendants", True)
                  else {key} for key in filters]
        records = [record for record in records if not scopes or
                   (all if args.get("categoryMatch", "any") == "all" else any)(
                       bool(scope.intersection(record["categoryIds"])) for scope in scopes)]
    matches, warnings, matched_papers = [], [], set()
    for record in records:
        try:
            paper, documents, notices = read_article_content(record["id"], sources, db)
        except (OSError, ValueError, RuntimeError) as exc:
            warnings.append({"hash": record["id"], "message": str(exc)})
            continue
        warnings.extend(notices)
        for document in documents.values():
            for passage in document["passages"]:
                found = score_passage(passage, terms, match)
                if found is not None:
                    matches.append({**paper, **found,
                                    "paperLink": markdown_link(paper["title"], paper["hash"])})
                    matched_papers.add(paper["hash"])
    matches.sort(key=lambda item: (-len(item["matchedTerms"]), -item["score"], item["hash"],
                                   SOURCES.index(item["source"]), item["pageNumber"] or 0, item["startChar"]))
    offset, limit = args.get("offset", 0), args.get("limit", 20)
    end = offset + limit
    return tool_text({"query": args["query"].strip(), "terms": terms, "match": match, "sources": sources,
                      "categoryIds": filters, "categoryMatch": args.get("categoryMatch", "any"),
                      "includeDescendants": args.get("includeDescendants", True),
                      "searchedPaperCount": len(records), "matchedPaperCount": len(matched_papers),
                      "totalMatches": len(matches), "offset": offset,
                      "nextOffset": end if end < len(matches) else None,
                      "matches": matches[offset:end], "warnings": warnings})


def tool_get_paper_passages(args: JsonObject) -> JsonObject:
    source = args.get("source", "full_text")
    if "passageIds" in args and "pageNumbers" in args:
        raise ValueError("Use passageIds or pageNumbers, not both.")
    if "pageNumbers" in args and source != "full_text":
        raise ValueError("pageNumbers is only supported for full_text.")
    paper, documents, warnings = read_article_content(args["hash"], [source])
    if source not in documents:
        raise ValueError(warnings[0]["message"])
    document = documents[source]
    if "sourceVersion" in args and args["sourceVersion"].strip() != document["sourceVersion"]:
        raise ValueError("Content source changed; search or list passages again for the current sourceVersion.")
    passages = document["passages"]
    if "passageIds" in args:
        lookup = {item["passageId"]: item for item in passages}
        ids = list(dict.fromkeys(value.strip() for value in args["passageIds"]))
        if any(key not in lookup for key in ids):
            raise ValueError("Unknown or stale passage ID for this article/source; search or list passages again.")
        passages = [lookup[key] for key in ids]
    elif "pageNumbers" in args:
        if document["pageCount"] is None:
            raise ValueError("Page numbers are unavailable in the flat text cache; provide a readable PDF and PyMuPDF.")
        numbers = set(args["pageNumbers"])
        if max(numbers) > document["pageCount"]:
            raise ValueError(f"pageNumbers exceeds the PDF page count ({document['pageCount']}).")
        passages = [item for item in passages if item["pageNumber"] in numbers]
    offset, limit = args.get("offset", 0), args.get("limit", 10)
    end = offset + limit
    return tool_text({**paper, "paperLink": markdown_link(paper["title"], paper["hash"]),
                      "source": source, "sourceVersion": document["sourceVersion"],
                      "pageCount": document["pageCount"], "sourcePassageCount": len(document["passages"]),
                      "totalPassages": len(passages), "offset": offset,
                      "nextOffset": end if end < len(passages) else None,
                      "passages": passages[offset:end], "warnings": warnings})


def tool_ask_paper(args: JsonObject) -> JsonObject:
    paper, metadata, text = read_article_text(args["hash"])
    if len(text.strip()) < 80:
        raise ValueError("Please provide at least 80 characters of article text.")
    api_key, model, url, _think_mode = paper_server.get_ai_config("discuss")
    if not api_key or api_key in {"sk-your-api-key", "sk-your-real-api-key"}:
        raise ValueError("Missing AI API key. Open Settings and save your API key.")
    context = text[:paper_server.MAX_PAPER_CHARS]
    # No paper_id: this is a single-article question, without library-wide research.
    # The model call runs after releasing the library lock and writes no discussion.
    answer = paper_server.discuss_paper(
        api_key, model, url, context, args["question"].strip(),
        summary={"title": paper["title"], **article_summary(metadata),
                 "basicInfo": metadata.get("basicInfo", {}),
                 "methodOverview": metadata.get("methodOverview", ""),
                 "methodSections": metadata.get("methodSections", []),
                 "methodConclusion": metadata.get("methodConclusion", "")},
        history=args.get("history", []), stream=False,
    )
    return tool_text({"hash": paper["hash"], "id": paper["id"], "title": paper["title"],
                      "answer": answer, "contextCharCount": len(context),
                      "contextTruncated": len(text) > len(context)})


def tool_auto_highlight_paper(args: JsonObject) -> JsonObject:
    from backend.auto_highlight import normalize_pages
    from backend.pdf_highlights import build_pdf_highlights, require_pymupdf

    item_id = args["id"].strip()
    save = args.get("save", True)
    with paper_server.LIBRARY_LOCK:
        db = read_db()
        record = db.get("papers", {}).get(item_id)
        if not record:
            raise FileNotFoundError("Paper not found.")
        if record.get("itemType", "paper") != "paper":
            raise ValueError("Automatic highlighting requires a PDF paper, not a standalone note.")
        directory = paper_server.paper_dir_from_record(record)
        pdf_bytes = (directory / "paper.pdf").read_bytes()

    api_key, model, url, _think_mode = paper_server.get_ai_config("autoHighlight")
    if not api_key or api_key in {"sk-your-api-key", "sk-your-real-api-key"}:
        raise ValueError("Missing AI API key. Open Settings and save your API key.")
    fitz = require_pymupdf()
    with fitz.open(stream=pdf_bytes, filetype="pdf") as pdf:
        pages = normalize_pages([
            {"pageNumber": index + 1, "text": page.get_text()}
            for index, page in enumerate(pdf)
        ])
        # Do not hold the library lock while waiting for the model.
        quotes = paper_server.auto_highlight_quotes(pages, api_key, model, url)
        with paper_server.LIBRARY_LOCK:
            current = read_db().get("papers", {}).get(item_id)
            if not current or paper_server.paper_dir_from_record(current) != directory:
                raise RuntimeError("The paper moved or was removed during automatic highlighting; retry.")
            if hashlib.sha256((directory / "paper.pdf").read_bytes()).digest() != hashlib.sha256(pdf_bytes).digest():
                raise RuntimeError("The PDF changed during automatic highlighting; retry.")
            existing = paper_server.read_json(directory / "highlights.json", [])
            if not isinstance(existing, list):
                raise ValueError("Existing highlights are invalid; no changes were saved.")
            additions, skipped, duplicates = build_pdf_highlights(pdf, quotes, existing)
            if save and additions:
                paper_server.write_json(directory / "highlights.json", existing + additions)
                paper_server.update_paper_sync_hash(directory)
    sync = paper_server.maybe_auto_sync_library() if save and additions else None
    return tool_text({
        "id": item_id, "saved": save, "color": "purple", "colorMeaning": "自动高亮",
        "addedCount": len({item["groupId"] for item in additions}),
        "duplicateCount": duplicates, "unmatchedCount": len(skipped),
        "highlights": additions, "quotes": quotes, "unmatched": skipped,
        "openPath": f"reader.html?id={item_id}", "sync": sync,
    })


def tool_import_paper_from_url(args: JsonObject) -> JsonObject:
    """Backward-compatible alias for start_import."""
    return tool_start_import(args)


def tool_start_import(args: JsonObject) -> JsonObject:
    url = str(args.get("url", "")).strip()
    if not url:
        raise ValueError("url is required.")
    title = str(args.get("title", "")).strip()
    category = paper_server.request_category_ids(args)
    return tool_text({"job": paper_server.start_import(url, title, category)})


def tool_get_import_status(args: JsonObject) -> JsonObject:
    job_id = str(args.get("jobId", "")).strip()
    if not job_id:
        raise ValueError("jobId is required.")
    return tool_text({"job": paper_server.get_import_status(job_id)})


def tool_cancel_import(args: JsonObject) -> JsonObject:
    job_id = str(args.get("jobId", "")).strip()
    if not job_id:
        raise ValueError("jobId is required.")
    return tool_text({"job": paper_server.cancel_import(job_id)})


def tool_archive_item(args: JsonObject) -> JsonObject:
    item_id = str(args.get("id", "")).strip()
    if not item_id:
        raise ValueError("id is required.")
    return tool_text({"archived": paper_server.archive_item(item_id)})


def tool_restore_item(args: JsonObject) -> JsonObject:
    item_id = str(args.get("id", "")).strip()
    if not item_id:
        raise ValueError("id is required.")
    item = paper_server.restore_item(item_id)
    return tool_text({"item": item})


def tool_delete_item(args: JsonObject) -> JsonObject:
    item_id = str(args.get("id", "")).strip()
    if not item_id:
        raise ValueError("id is required.")
    return tool_text(paper_server.delete_item(item_id, permanent=bool(args.get("permanent", False))))


def tool_list_duplicates(args: JsonObject) -> JsonObject:
    groups = paper_server.list_duplicates()
    limit = max(1, min(int(args.get("limit", 100) or 100), 500))
    return tool_text({"duplicateGroupCount": len(groups), "groups": groups[:limit]})


def tool_merge_duplicate_items(args: JsonObject) -> JsonObject:
    canonical_id = str(args.get("canonicalId", "")).strip()
    duplicate_ids = args.get("duplicateIds", [])
    if not isinstance(duplicate_ids, list):
        raise ValueError("duplicateIds must be an array.")
    result = paper_server.merge_duplicate_items(canonical_id, duplicate_ids)
    canonical = result["canonical"]
    result["paperLink"] = markdown_link(format_paper_link_label(canonical), canonical["id"])
    return tool_text(result)


@paper_server.library_locked
def tool_create_category(args: JsonObject) -> JsonObject:
    name = str(args.get("name", "")).strip()
    parent_id = str(args.get("parentId", "")).strip()
    if not name:
        raise ValueError("name is required.")
    category = paper_server.create_category(parent_id, name)
    sync = paper_server.maybe_auto_sync_library()
    return tool_text({"category": category, "tree": paper_server.read_library_tree(), "sync": sync})


@paper_server.library_locked
def tool_rename_category(args: JsonObject) -> JsonObject:
    old_id = args["id"].strip()
    descendants = paper_server.category_descendants(read_db(), old_id)
    new_id = paper_server.rename_category(old_id, args["name"].strip())
    return category_change_result(old_id, new_id, descendants)


@paper_server.library_locked
def tool_move_category(args: JsonObject) -> JsonObject:
    db = read_db()
    item_id = args["id"].strip()
    parent_id = args.get("parentId", "").strip()
    before_id = args.get("beforeId", "").strip()
    after_id = args.get("afterId", "").strip()
    if before_id and after_id:
        raise ValueError("Supply only one of beforeId and afterId.")
    sibling_id = before_id or after_id
    if sibling_id:
        sibling = db["categories"].get(sibling_id)
        if not sibling:
            raise FileNotFoundError("Target sibling category not found.")
        if sibling_id == item_id:
            raise ValueError("A category cannot be positioned relative to itself.")
        effective_parent = sibling.get("parentId", "")
        if "parentId" in args and parent_id != effective_parent:
            raise ValueError("parentId must match the target sibling's parent.")
        parent_id = effective_parent
    if parent_id == item_id or parent_id.startswith(item_id + "/"):
        raise ValueError("Cannot move a category inside itself.")
    descendants = paper_server.category_descendants(db, item_id)
    new_id = paper_server.move_category(item_id, parent_id, before_id, after_id)
    return category_change_result(item_id, new_id, descendants)


def category_change_result(old_id: str, new_id: str, descendants: list[str]) -> JsonObject:
    sync = paper_server.maybe_auto_sync_library()
    return tool_text({"categoryId": new_id, "idMap": {key: new_id + key[len(old_id):] for key in descendants},
                      "tree": paper_server.read_library_tree(), "sync": sync})


@paper_server.library_locked
def tool_delete_category(args: JsonObject) -> JsonObject:
    db = read_db()
    item_id = args["id"].strip()
    category = db["categories"].get(item_id)
    if not category:
        raise FileNotFoundError("Category not found.")
    if category.get("locked"):
        raise PermissionError("This category cannot be deleted.")
    deleted_ids = paper_server.category_descendants(db, item_id)
    scope = set(deleted_ids)
    affected = []
    for record in db["papers"].values():
        if scope.intersection(record["categoryIds"]):
            remaining = [key for key in record["categoryIds"] if key not in scope] or [paper_server.UNCATEGORIZED_ID]
            affected.append({"id": record["id"], "beforeCategoryIds": record["categoryIds"], "afterCategoryIds": remaining})
    dry_run = args.get("dryRun", False)
    if not dry_run:
        paper_server.delete_category(item_id)
    sync = paper_server.maybe_auto_sync_library() if not dry_run else None
    result = {"dryRun": dry_run, "deletedCategoryIds": deleted_ids,
              "affectedItems": affected, "affectedCount": len(affected), "sync": sync}
    if not dry_run:
        result["tree"] = paper_server.read_library_tree()
    return tool_text(result)


def tool_list_flags(args: JsonObject) -> JsonObject:
    return tool_text({"flags": paper_server.library_flag_definitions()})


def tool_create_flag(args: JsonObject) -> JsonObject:
    with paper_server.FLAGS_LOCK:
        flag = paper_server.create_library_flag(args["name"])
        return tool_text({"flag": flag, "flags": paper_server.library_flag_definitions()})


def tool_update_flag(args: JsonObject) -> JsonObject:
    with paper_server.FLAGS_LOCK:
        flag = paper_server.update_library_flag_appearance(args["id"].strip(), {key: args[key] for key in ("color", "icon") if key in args})
        return tool_text({"flag": flag, "flags": paper_server.library_flag_definitions()})


@paper_server.library_locked
def tool_batch_update_flags(args: JsonObject) -> JsonObject:
    with paper_server.FLAGS_LOCK:
        ids = paper_server.normalize_paper_ids(args["ids"])
        db = read_db()
        for item_id in ids:
            record = db["papers"].get(item_id)
            if not record or not paper_server.paper_dir_from_record(record).is_dir():
                raise FileNotFoundError(f"Item not found: {item_id}")
        selected = paper_server.normalize_paper_flag_ids(args["flags"])
        operation = args["operation"]
        previews = []
        for item_id in ids:
            directory = paper_server.paper_dir_from_record(db["papers"][item_id])
            metadata = paper_server.read_json(directory / "metadata.json", {})
            current = paper_server.paper_local_state(item_id, metadata)["flags"]
            updated = list(dict.fromkeys(current + selected)) if operation == "add" else [key for key in current if key not in selected]
            updated = (["read"] if "read" in updated else []) + (["todo"] if "todo" in updated else []) + [key for key in updated if key not in {"read", "todo"}]
            previews.append({"id": item_id, "beforeFlags": current, "afterFlags": updated})
        dry_run = args.get("dryRun", False)
        papers = [] if dry_run else paper_server.update_papers_flags(ids, selected, operation, compact=True)
        return tool_text({"dryRun": dry_run, "count": len(ids), "changes": previews, "papers": papers, "sync": None})


def prepare_item_update(args: JsonObject, db: JsonObject) -> JsonObject:
    """Validate and prepare in memory; no notes migration or other file writes."""
    validate_value(args, TOOLS["update_paper"][1])
    paper_id = args["id"].strip()
    original = db.get("papers", {}).get(paper_id)
    if not original:
        raise FileNotFoundError("Paper not found.")
    record = deepcopy(original)
    paper_dir = paper_server.paper_dir_from_record(record)
    if not paper_dir.is_dir():
        raise FileNotFoundError(f"Item directory not found: {paper_id}")
    metadata = paper_server.read_json(paper_dir / "metadata.json", paper_server.default_metadata(record.get("title", paper_id), record.get("categoryId", paper_server.UNCATEGORIZED_ID)))
    if "notes" in args:
        validate_note_markdown(args["notes"], db, paper_server.MAX_NOTES_CHARS)
    local_updates = {key: args[key] for key in ("read", "todo") if key in args}
    if "flags" in args:
        selected = paper_server.normalize_paper_flag_ids(args["flags"])
        local_updates["flags"] = (["read"] if "read" in selected else []) + (["todo"] if "todo" in selected else []) + [key for key in selected if key not in {"read", "todo"}]
    category_changed = any(key in args for key in ("categoryIds", "categoryId", "addCategoryIds", "removeCategoryIds"))
    ids = record["categoryIds"]
    if "categoryIds" in args:
        ids = paper_server.resolve_category_ids(db, args["categoryIds"])
    elif "categoryId" in args:
        ids = paper_server.resolve_category_ids(db, args["categoryId"], create=True)
    additions = paper_server.resolve_category_ids(db, args.get("addCategoryIds", []))
    removals = paper_server.resolve_category_ids(db, args.get("removeCategoryIds", []))
    if category_changed:
        desired = ((set(ids) | set(additions)) - set(removals)) - {paper_server.UNCATEGORIZED_ID}
        paper_server.set_record_categories(record, sorted(desired), paper_server.utc_now())
    if isinstance(args.get("title"), str) and args["title"].strip():
        title = args["title"].strip()
        metadata["title"] = title
        record["title"] = title
    if isinstance(args.get("doi"), str):
        doi = args["doi"].strip()
        if doi:
            metadata["doi"] = doi
        else:
            metadata.pop("doi", None)
    if isinstance(args.get("basicInfo"), dict):
        metadata["basicInfo"] = paper_server.normalize_basic_info(args["basicInfo"])
    if isinstance(args.get("notes"), str):
        metadata.pop("notes", None)
    paper_server.copy_category_fields(metadata, record)
    sync_changed = category_changed or any(key in args for key in ("title", "doi", "basicInfo", "notes"))
    return {"args": args, "record": record, "metadata": metadata, "directory": paper_dir,
            "localUpdates": local_updates, "syncChanged": sync_changed}


def apply_item_update(plan: JsonObject, db: JsonObject) -> None:
    args, record, directory = plan["args"], plan["record"], plan["directory"]
    if "notes" in args:
        paper_server.write_paper_notes(directory, args["notes"])
    if plan["syncChanged"]:
        paper_server.write_json(directory / "metadata.json", plan["metadata"])
        db["papers"][record["id"]] = record
        paper_server.save_library_db(db)
    if plan["localUpdates"]:
        paper_server.update_paper_local_state(record["id"], plan["localUpdates"])


@paper_server.library_locked
def tool_update_paper(args: JsonObject) -> JsonObject:
    with paper_server.FLAGS_LOCK:
        db = read_db()
        plan = prepare_item_update(args, db)
        apply_item_update(plan, db)
    sync = paper_server.maybe_auto_sync_library() if plan["syncChanged"] else None
    paper_id = args["id"].strip()
    paper = paper_server.read_paper(paper_id)
    return tool_text({"paper": paper, "paperLink": markdown_link(format_paper_link_label(paper), paper_id), "sync": sync})


@paper_server.library_locked
def tool_batch_update_items(args: JsonObject) -> JsonObject:
    with paper_server.FLAGS_LOCK:
        db = read_db()
        ids = [item["id"].strip() for item in args["items"]]
        if any(len(item) == 1 for item in args["items"]):
            raise ValueError("Each batch item must specify at least one update field besides id.")
        if len(set(ids)) != len(ids):
            raise ValueError("Each item ID may occur only once in a batch.")
        snapshots = []
        for item_id in ids:
            record = db["papers"].get(item_id)
            if not record:
                raise FileNotFoundError(f"Item not found: {item_id}")
            directory = paper_server.paper_dir_from_record(record)
            metadata = paper_server.read_json(directory / "metadata.json", {})
            notes_path = directory / paper_server.NOTES_FILE
            notes = paper_server.read_text_file(notes_path) if notes_path.exists() else str(metadata.get("notes", ""))
            snapshots.append({"record": record, "metadata": metadata, "notes": notes,
                              "localState": paper_server.paper_local_state(item_id, metadata)})
        revision = hashlib.sha256(json.dumps({"items": snapshots, "categories": db["categories"],
                                              "flags": paper_server.library_flag_definitions()},
                                             ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
        if "expectedRevision" in args and args["expectedRevision"] != revision:
            raise ValueError("Revision conflict: selected items, categories or flags changed; preview the batch again.")
        plans = [prepare_item_update(item, db) for item in args["items"]]
        changes = []
        for plan, snapshot in zip(plans, snapshots):
            before = {"title": snapshot["metadata"].get("title") or snapshot["record"].get("title", ""),
                      "categoryIds": snapshot["record"]["categoryIds"], "doi": snapshot["metadata"].get("doi", ""),
                      "basicInfo": snapshot["metadata"].get("basicInfo", {}), "notes": snapshot["notes"],
                      **snapshot["localState"]}
            after = {**before, **{key: plan["metadata"].get(key, "") for key in ("title", "doi", "basicInfo") if key in plan["args"]},
                     "categoryIds": plan["record"]["categoryIds"], **plan["localUpdates"]}
            if "notes" in plan["args"]:
                after["notes"] = plan["args"]["notes"]
            if "flags" in plan["localUpdates"]:
                after.update(read="read" in after["flags"], todo="todo" in after["flags"])
            else:
                after["flags"] = (["read"] if after["read"] else []) + (["todo"] if after["todo"] else []) + [key for key in before["flags"] if key not in {"read", "todo"}]
            keys = [key for key in before if before[key] != after.get(key)]
            changes.append({"id": plan["record"]["id"], "before": {key: before[key] for key in keys},
                            "after": {key: after[key] for key in keys}})
        dry_run = args.get("dryRun", False)
        results = []
        failed = False
        sync_needed = False
        if not dry_run:
            for plan in plans:
                item_id = plan["record"]["id"]
                if failed:
                    results.append({"id": item_id, "status": "skipped"})
                    continue
                sync_needed = sync_needed or plan["syncChanged"]
                try:
                    apply_item_update(plan, db)
                    results.append({"id": item_id, "status": "updated"})
                except OSError as exc:
                    failed = True
                    results.append({"id": item_id, "status": "failed", "error": str(exc), "possiblePartialWrite": True})
    sync, sync_error = None, ""
    if sync_needed:
        try:
            sync = paper_server.maybe_auto_sync_library()
        except Exception as exc:
            sync_error = str(exc)
    payload = {"dryRun": dry_run, "revision": revision, "count": len(plans), "changes": changes,
               "results": results, "updatedCount": sum(item["status"] == "updated" for item in results), "sync": sync}
    if sync_error:
        payload["syncError"] = sync_error
    result = tool_text(payload)
    result["isError"] = failed or bool(sync_error)
    return result


def tool_set_item_categories(args: JsonObject) -> JsonObject:
    return tool_update_paper({"id": args["id"], "categoryIds": args["categoryIds"]})


def tool_add_item_categories(args: JsonObject) -> JsonObject:
    return tool_update_paper({"id": args["id"], "addCategoryIds": args["categoryIds"]})


@paper_server.library_locked
def tool_remove_item_categories(args: JsonObject) -> JsonObject:
    ids = args["categoryIds"]
    if args.get("includeDescendants", False):
        db = read_db()
        selected = paper_server.resolve_category_ids(db, ids)
        ids = sorted({child for key in selected for child in paper_server.category_descendants(db, key)})
    return tool_update_paper({"id": args["id"], "removeCategoryIds": ids})


@paper_server.library_locked
def tool_create_note(args: JsonObject) -> JsonObject:
    title = str(args.get("title", "")).strip() or "Research note"
    category = paper_server.request_category_ids(args)
    content = str(args.get("content", ""))
    validate_note_markdown(content, read_db(), paper_server.MAX_NOTES_CHARS)
    note = paper_server.add_note_to_db(title, category)
    if content:
        note_dir = paper_server.paper_dir_from_record(read_db()["papers"][note["id"]])
        paper_server.write_paper_notes(note_dir, content)
        note = paper_server.read_paper(note["id"])
    sync = paper_server.maybe_auto_sync_library()
    return tool_text({"note": paper_server.read_paper(note["id"]), "openPath": f"note.html?id={note['id']}", "sync": sync})


@paper_server.library_locked
def tool_write_note(args: JsonObject) -> JsonObject:
    note_id = str(args.get("id", "")).strip()
    content = str(args.get("content", ""))
    mode = str(args.get("mode", "replace")).strip().lower()
    if not note_id:
        raise ValueError("id is required.")
    db = read_db()
    record = db.get("papers", {}).get(note_id)
    if not record:
        raise FileNotFoundError("Note not found.")
    if record.get("itemType") != "note":
        raise ValueError("The item is not a standalone note.")
    note_dir = paper_server.paper_dir_from_record(record)
    existing = paper_server.read_paper_notes(note_dir)
    if mode == "append":
        next_content = existing.rstrip() + ("\n\n" if existing.strip() and content.strip() else "") + content
    elif mode == "prepend":
        next_content = content.rstrip() + ("\n\n" if existing.strip() and content.strip() else "") + existing
    elif mode == "replace":
        next_content = content
    else:
        raise ValueError("mode must be replace, append, or prepend.")
    validate_note_markdown(next_content, db, paper_server.MAX_NOTES_CHARS)
    paper_server.write_paper_notes(note_dir, next_content)
    return tool_text({"note": paper_server.read_paper(note_id, db)})


def tool_make_paper_link(args: JsonObject) -> JsonObject:
    paper_id = str(args.get("paperId", "") or args.get("id", "")).strip()
    if not paper_id:
        raise ValueError("paperId is required.")
    paper = paper_server.read_paper(paper_id)
    label = str(args.get("label", "")).strip() or format_paper_link_label(paper)
    return tool_text({"paperId": paper_id, "title": paper.get("title", ""), "markdown": markdown_link(label, paper_id)})


CATEGORY_IDS_SCHEMA: JsonObject = {"type": "array", "items": {"type": "string", "minLength": 1}}
LEGACY_CATEGORY_SCHEMA: JsonObject = {
    "type": "string",
    "description": "Legacy single-category parameter. categoryIds takes precedence when both are supplied.",
}
MEMBERSHIP_SCHEMA: JsonObject = {
    "type": "object",
    "properties": {
        "id": {"type": "string", "minLength": 1, "description": "Paper or standalone note ID."},
        "categoryIds": {**CATEGORY_IDS_SCHEMA, "description": "Existing category IDs, as returned by library_overview."},
    },
    "required": ["id", "categoryIds"],
    "additionalProperties": False,
}


ARTICLE_HASH_SCHEMA: JsonObject = {"type": "string", "minLength": 1, "description": "Article hash, identical to its library ID (not a PDF content checksum)."}
ARTICLE_LIST_SCHEMA: JsonObject = {
    "type": "object",
    "properties": {"hashes": {"type": "array", "items": ARTICLE_HASH_SCHEMA,
                               "description": "Omit to return every article, without a result limit. [] returns none. Duplicate hashes are ignored; unknown hashes and note IDs are errors."}},
    "additionalProperties": False,
}
ARTICLE_SCHEMA: JsonObject = {"type": "object", "properties": {"hash": ARTICLE_HASH_SCHEMA},
                            "required": ["hash"], "additionalProperties": False}
CONTENT_SOURCE_SCHEMA: JsonObject = {"type": "string", "enum": list(SOURCES)}
CONTENT_OFFSET_SCHEMA: JsonObject = {"type": "integer", "minimum": 0, "default": 0}
CONTENT_LIMIT_SCHEMA: JsonObject = {"type": "integer", "minimum": 1, "maximum": 50}
ITEM_UPDATE_SCHEMA: JsonObject = {
    "type": "object",
    "properties": {
        "id": {"type": "string", "minLength": 1},
        "title": {"type": "string"},
        "categoryId": LEGACY_CATEGORY_SCHEMA,
        "categoryIds": {**CATEGORY_IDS_SCHEMA, "description": "Replace all memberships with existing categories; [] clears memberships."},
        "addCategoryIds": {**CATEGORY_IDS_SCHEMA, "description": "Add existing categories while keeping other memberships."},
        "removeCategoryIds": {**CATEGORY_IDS_SCHEMA, "description": "Remove exact memberships; removal wins over additions."},
        "doi": {"type": "string"},
        "basicInfo": {"type": "object"},
        "notes": {"type": "string", "description": MARKDOWN_RULES},
        "read": {"type": "boolean"},
        "todo": {"type": "boolean"},
        "flags": {"type": "array", "items": {"type": "string", "minLength": 1}, "maxItems": 102,
                  "description": "Replace all selected flag IDs, including read/todo. [] clears them. When present, flags takes precedence over read/todo booleans."},
    },
    "required": ["id"], "additionalProperties": False,
}
ID_SCHEMA: JsonObject = {"type": "string", "minLength": 1}
DRY_RUN_SCHEMA: JsonObject = {"type": "boolean", "default": False, "description": "Preview changes without applying them or triggering sync."}


TOOLS: dict[str, tuple[str, JsonObject, Callable[[JsonObject], JsonObject]]] = {
    "list_papers": (
        "Return all article hashes and metadata, or only the supplied hashes in request order. Excludes standalone notes and archived items. No pagination or implicit result limit.",
        ARTICLE_LIST_SCHEMA,
        tool_list_papers,
    ),
    "list_paper_summaries": (
        "Return every article's hash, title, stored abstract and threeLineSummary; optionally select hashes. Missing summaries have hasSummary=false. Does not call AI or generate summaries.",
        ARTICLE_LIST_SCHEMA,
        tool_list_paper_summaries,
    ),
    "get_paper_summary": (
        "Read one article's stored abstract and threeLineSummary by hash. Missing summaries have hasSummary=false; does not call AI.",
        ARTICLE_SCHEMA,
        tool_get_paper_summary,
    ),
    "get_paper_full_text": (
        "Read the complete article text by hash, without truncation. Uses cached extracted text, falling back to PDF extraction via optional PyMuPDF. Scanned PDFs require OCR/text extraction first. Does not call AI or write files.",
        ARTICLE_SCHEMA,
        tool_get_paper_full_text,
    ),
    "search_paper_content": (
        "Search stored abstract, three-line summary, paper notes and full text of active PDF articles. "
        "Literal NFKC/case-insensitive whitespace-separated terms (match=all by default), not semantic search. "
        "Returns ranked passages (at most 1200 characters each) with hash, source, passageId, sourceVersion, "
        "pageNumber (null for flat caches), exact character offsets and paperLink. Prefer PDF page text via optional "
        "PyMuPDF, falling back to the text cache. Unreadable sources are reported in warnings, not silently omitted. "
        "Optional hashes and category filters intersect; [] hashes selects none. Paginate with offset/nextOffset. "
        "Does not call AI, write an index, migrate notes, or change library data.",
        {
            "type": "object",
            "properties": {
                "query": {"type": "string", "minLength": 1, "description": "1–32 whitespace-separated terms, at most 2000 characters; Chinese terms use literal substring matching."},
                "hashes": ARTICLE_LIST_SCHEMA["properties"]["hashes"],
                "sources": {"type": "array", "items": CONTENT_SOURCE_SCHEMA, "minItems": 1, "maxItems": 4,
                            "description": "Default: abstract, summary, notes, full_text. Notes means notes attached to PDF articles, not standalone notes."},
                "match": {"type": "string", "enum": ["all", "any"], "default": "all"},
                "categoryId": LEGACY_CATEGORY_SCHEMA,
                "categoryIds": CATEGORY_IDS_SCHEMA,
                "categoryMatch": {"type": "string", "enum": ["any", "all"], "default": "any"},
                "includeDescendants": {"type": "boolean", "default": True},
                "offset": CONTENT_OFFSET_SCHEMA,
                "limit": {**CONTENT_LIMIT_SCHEMA, "default": 20},
            },
            "required": ["query"], "additionalProperties": False,
        },
        tool_search_paper_content,
    ),
    "get_paper_passages": (
        "Read bounded passages of an active PDF article by hash. source defaults to full_text; also supports "
        "abstract, summary and attached notes. Select passageIds from search_paper_content (same source required), "
        "or one-based pageNumbers (full_text only), or omit both to paginate the source. "
        "PDF page text is preferred; a flat text cache has pageNumber=null and cannot satisfy pageNumbers. "
        "Offsets are zero-based, end-exclusive Python character positions within the page or source as offsetScope indicates. "
        "Overlapping passages contain at most 1200 characters. IDs bind the article and exact source version; "
        "stale/unknown IDs are errors. Pass sourceVersion when paginating to detect source changes. "
        "Empty sources and blank pages return an empty list. Does not call AI or write files.",
        {
            "type": "object",
            "properties": {
                "hash": ARTICLE_HASH_SCHEMA,
                "source": {**CONTENT_SOURCE_SCHEMA, "default": "full_text"},
                "passageIds": {"type": "array", "items": {"type": "string", "minLength": 1},
                               "minItems": 1, "maxItems": 50},
                "pageNumbers": {"type": "array", "items": {"type": "integer", "minimum": 1},
                                "minItems": 1, "maxItems": 100},
                "sourceVersion": {"type": "string", "minLength": 1},
                "offset": CONTENT_OFFSET_SCHEMA,
                "limit": {**CONTENT_LIMIT_SCHEMA, "default": 10},
            },
            "required": ["hash"], "additionalProperties": False,
        },
        tool_get_paper_passages,
    ),
    "ask_paper": (
        "Ask about one article by hash using Paper Lantern's configured discuss AI module and its article text/summary. Optional history supports follow-up questions. Returns answer and contextTruncated (context limited to MAX_PAPER_CHARS). Does not save discussion or consult other articles; no HTTP server required.",
        {
            "type": "object",
            "properties": {
                "hash": ARTICLE_HASH_SCHEMA,
                "question": {"type": "string", "minLength": 1},
                "history": {"type": "array", "items": {
                    "type": "object", "properties": {
                        "role": {"type": "string", "enum": ["user", "assistant"]},
                        "content": {"type": "string", "minLength": 1},
                    }, "required": ["role", "content"], "additionalProperties": False,
                }},
            },
            "required": ["hash", "question"], "additionalProperties": False,
        },
        tool_ask_paper,
    ),
    "library_overview": (
        "Return categories, unique item counts (direct and including descendants), and recent items with all category IDs and names.",
        {"type": "object", "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 200}}, "additionalProperties": False},
        tool_library_overview,
    ),
    "search_library": (
        "Search papers or notes by title, ID, or category name/ID. Filter by multiple categories with any/all matching; descendants are included by default. Each item appears once.",
        {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "categoryId": LEGACY_CATEGORY_SCHEMA,
                "categoryIds": {**CATEGORY_IDS_SCHEMA, "description": "Filter categories. An empty array applies no category filter and overrides categoryId."},
                "categoryMatch": {"type": "string", "enum": ["any", "all"], "default": "any", "description": "Match any requested category or every requested category."},
                "includeDescendants": {"type": "boolean", "default": True, "description": "Include subcategories of each requested category."},
                "itemType": {"type": "string", "enum": ["", "paper", "note"]},
                "limit": {"type": "integer", "minimum": 1, "maximum": 200},
            },
            "additionalProperties": False,
        },
        tool_search_library,
    ),
    "get_item": (
        "Read one paper or note, including notes and optionally cached extracted text.",
        {
            "type": "object",
            "properties": {"id": {"type": "string"}, "includeExtractedText": {"type": "boolean"}},
            "required": ["id"],
            "additionalProperties": False,
        },
        tool_get_item,
    ),
    "auto_highlight_paper": (
        "Use the configured LLM to select important original text from a library PDF and save purple highlights, preserving existing annotations and skipping duplicates. Requires PyMuPDF. Set save=false to preview without writing. Returns normalized rectangles, quotes, counts, and colorMeaning. Refresh the PDF reader after saving.",
        {
            "type": "object",
            "properties": {
                "id": {"type": "string", "minLength": 1, "description": "Library PDF paper ID."},
                "save": {"type": "boolean", "default": True, "description": "Save merged highlights; false returns a preview without modifying files."},
            },
            "required": ["id"],
            "additionalProperties": False,
        },
        tool_auto_highlight_paper,
    ),
    "import_paper_from_url": (
        "Alias for start_import. Import a PDF into multiple categories; a duplicate adds memberships to the existing item.",
        {
            "type": "object",
            "properties": {
                "url": {"type": "string", "minLength": 1},
                "title": {"type": "string"},
                "categoryId": LEGACY_CATEGORY_SCHEMA,
                "categoryIds": {**CATEGORY_IDS_SCHEMA, "description": "Initial memberships. Empty or omitted means Uncategorized; missing category paths are created. For duplicates, memberships are added to the existing item."},
            },
            "required": ["url"],
            "additionalProperties": False,
        },
        tool_import_paper_from_url,
    ),
    "start_import": (
        "Start an asynchronous, idempotent PDF/arXiv import into categoryIds and return its job ID. Duplicate imports add memberships without duplicating the article.",
        {
            "type": "object",
            "properties": {
                "url": {"type": "string", "minLength": 1},
                "title": {"type": "string"},
                "categoryId": LEGACY_CATEGORY_SCHEMA,
                "categoryIds": {**CATEGORY_IDS_SCHEMA, "description": "Initial memberships. Empty or omitted means Uncategorized; missing category paths are created. For duplicates, memberships are added to the existing item."},
            },
            "required": ["url"],
            "additionalProperties": False,
        },
        tool_start_import,
    ),
    "get_import_status": (
        "Return the current stage, byte progress, final URL, duplicate result, and retry safety for an import job.",
        {
            "type": "object",
            "properties": {"jobId": {"type": "string"}},
            "required": ["jobId"],
            "additionalProperties": False,
        },
        tool_get_import_status,
    ),
    "cancel_import": (
        "Request cancellation of an import job before it starts writing to the library.",
        {
            "type": "object",
            "properties": {"jobId": {"type": "string"}},
            "required": ["jobId"],
            "additionalProperties": False,
        },
        tool_cancel_import,
    ),
    "archive_item": (
        "Move a paper or note to Paper Lantern's recoverable archive.",
        {
            "type": "object",
            "properties": {"id": {"type": "string"}},
            "required": ["id"],
            "additionalProperties": False,
        },
        tool_archive_item,
    ),
    "restore_item": (
        "Restore a paper or note from Paper Lantern's archive.",
        {
            "type": "object",
            "properties": {"id": {"type": "string"}},
            "required": ["id"],
            "additionalProperties": False,
        },
        tool_restore_item,
    ),
    "delete_item": (
        "Archive an item by default; permanently delete it only when permanent=true is explicitly supplied.",
        {
            "type": "object",
            "properties": {"id": {"type": "string"}, "permanent": {"type": "boolean", "default": False}},
            "required": ["id"],
            "additionalProperties": False,
        },
        tool_delete_item,
    ),
    "list_duplicates": (
        "Find duplicate paper or note groups using PDF hashes, DOI, source URL, and normalized title.",
        {
            "type": "object",
            "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 500}},
            "additionalProperties": False,
        },
        tool_list_duplicates,
    ),
    "merge_duplicate_items": (
        "Merge duplicate metadata and research content into a chosen canonical item, then archive the duplicates.",
        {
            "type": "object",
            "properties": {
                "canonicalId": {"type": "string"},
                "duplicateIds": {"type": "array", "items": {"type": "string"}, "minItems": 1},
            },
            "required": ["canonicalId", "duplicateIds"],
            "additionalProperties": False,
        },
        tool_merge_duplicate_items,
    ),
    "create_category": (
        "Create a literature-library category.",
        {
            "type": "object",
            "properties": {"name": {"type": "string"}, "parentId": {"type": "string"}},
            "required": ["name"],
            "additionalProperties": False,
        },
        tool_create_category,
    ),
    "update_paper": (
        "Update a paper or note and its category memberships. Apply categoryIds (replacement), then addCategoryIds, then removeCategoryIds. An empty categoryIds array clears all memberships. Flags and read/todo markers are local-only; flags replaces all flags and overrides read/todo when supplied.",
        ITEM_UPDATE_SCHEMA,
        tool_update_paper,
    ),
    "batch_update_items": (
        "Update up to 1000 distinct papers/notes with per-item metadata, notes, categories and flags. All inputs are validated before any update. Category arrays reference existing categories. dryRun returns before/after changes and a revision; pass it as expectedRevision when applying to reject stale previews. Sync runs at most once; local-state-only batches do not sync. On an I/O failure, stop and return updated/failed/skipped results with isError=true; earlier updates remain saved.",
        {
            "type": "object",
            "properties": {
                "items": {"type": "array", "minItems": 1, "maxItems": 1000, "items": {
                    **ITEM_UPDATE_SCHEMA,
                    "properties": {key: value for key, value in ITEM_UPDATE_SCHEMA["properties"].items() if key != "categoryId"},
                }},
                "dryRun": DRY_RUN_SCHEMA,
                "expectedRevision": {"type": "string", "minLength": 1},
            },
            "required": ["items"],
            "additionalProperties": False,
        },
        tool_batch_update_items,
    ),
    "rename_category": (
        "Rename a category and remap all descendant category IDs and article/note memberships. Returns categoryId and idMap; article IDs stay unchanged. Locked categories cannot be renamed.",
        {"type": "object", "properties": {"id": ID_SCHEMA, "name": ID_SCHEMA}, "required": ["id", "name"], "additionalProperties": False},
        tool_rename_category,
    ),
    "move_category": (
        "Move a category subtree or reorder siblings. parentId='' means root. Supply at most one of beforeId/afterId; its parent determines the destination and must match parentId if supplied. Returns new categoryId and idMap. Cycles and locked categories are rejected.",
        {"type": "object", "properties": {"id": ID_SCHEMA, "parentId": {"type": "string"}, "beforeId": ID_SCHEMA, "afterId": ID_SCHEMA}, "required": ["id"], "additionalProperties": False},
        tool_move_category,
    ),
    "delete_category": (
        "Delete a category and its descendants, removing only those memberships and preserving every article/note and other memberships. Items with no remaining membership become Uncategorized. dryRun previews affectedItems and deletedCategoryIds. Locked categories cannot be deleted.",
        {"type": "object", "properties": {"id": ID_SCHEMA, "dryRun": DRY_RUN_SCHEMA}, "required": ["id"], "additionalProperties": False},
        tool_delete_category,
    ),
    "list_flags": (
        "List built-in and custom local-only flag definitions, including IDs, names, colors and icons. These flags are separate from paper metadata tags and are not cloud-synced.",
        {"type": "object", "properties": {}, "additionalProperties": False},
        tool_list_flags,
    ),
    "create_flag": (
        "Create a local custom flag with a 1-24 character name (maximum 100 custom flags). Names are reused case-insensitively, including built-in names. Does not assign it to articles or trigger sync.",
        {"type": "object", "properties": {"name": ID_SCHEMA}, "required": ["name"], "additionalProperties": False},
        tool_create_flag,
    ),
    "update_flag": (
        "Set color and/or icon for an existing built-in or custom flag, preserving assignments. Supply at least one of color/icon. Local-only; no sync.",
        {"type": "object", "properties": {"id": ID_SCHEMA, "color": {"type": "string", "description": "#RRGGBB color."}, "icon": {"type": "string", "enum": list(paper_server.PAPER_FLAG_ICONS)}}, "required": ["id"], "additionalProperties": False},
        tool_update_flag,
    ),
    "batch_update_flags": (
        "Add or remove flag IDs on up to 1000 papers/notes, preserving other flags and recent-view state. Duplicate item/flag IDs are ignored. Validate all IDs before saving. Supports dryRun; local-only and never triggers sync. Use update_paper.flags or batch_update_items for complete replacement/clearing.",
        {"type": "object", "properties": {
            "ids": {"type": "array", "items": ID_SCHEMA, "minItems": 1, "maxItems": 1000},
            "flags": {"type": "array", "items": ID_SCHEMA, "minItems": 1, "maxItems": 102},
            "operation": {"type": "string", "enum": ["add", "remove"]}, "dryRun": DRY_RUN_SCHEMA,
        }, "required": ["ids", "flags", "operation"], "additionalProperties": False},
        tool_batch_update_flags,
    ),
    "set_item_categories": (
        "Replace every category membership of a paper or note. categoryIds=[] clears memberships and places it in Uncategorized. Returns the updated paper with categoryIds/categoryNames.",
        MEMBERSHIP_SCHEMA,
        tool_set_item_categories,
    ),
    "add_item_categories": (
        "Add a paper or note to existing categories, preserving its other memberships. Duplicate IDs are ignored; [] makes no change.",
        MEMBERSHIP_SCHEMA,
        tool_add_item_categories,
    ),
    "remove_item_categories": (
        "Remove category memberships of a paper or note while retaining the item and other memberships. With includeDescendants=true, also removes memberships under those categories, matching a parent-category removal in the UI. No remaining memberships means Uncategorized.",
        {
            **MEMBERSHIP_SCHEMA,
            "properties": {
                **MEMBERSHIP_SCHEMA["properties"],
                "includeDescendants": {"type": "boolean", "default": False},
            },
        },
        tool_remove_item_categories,
    ),
    "create_note": (
        "Create a standalone note or report in multiple categories. categoryIds=[] or omission means Uncategorized.",
        {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "categoryId": LEGACY_CATEGORY_SCHEMA,
                "categoryIds": {**CATEGORY_IDS_SCHEMA, "description": "Initial memberships. Empty or omitted means Uncategorized. Missing category paths are created."},
                "content": {"type": "string", "description": MARKDOWN_RULES},
            },
            "required": ["title"],
            "additionalProperties": False,
        },
        tool_create_note,
    ),
    "write_note": (
        "Replace, append, or prepend Markdown content in a standalone note.",
        {
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "content": {"type": "string", "description": MARKDOWN_RULES},
                "mode": {"type": "string", "enum": ["replace", "append", "prepend"]},
            },
            "required": ["id", "content"],
            "additionalProperties": False,
        },
        tool_write_note,
    ),
    "make_paper_link": (
        "Create the Paper Lantern Markdown link format for a library paper.",
        {
            "type": "object",
            "properties": {"paperId": {"type": "string"}, "id": {"type": "string"}, "label": {"type": "string"}},
            "additionalProperties": False,
        },
        tool_make_paper_link,
    ),
}


def list_tools() -> list[JsonObject]:
    return [
        {
            "name": name,
            "description": description + (" " + MARKDOWN_RULES if name in {"create_note", "write_note", "update_paper", "batch_update_items"} else ""),
            "inputSchema": schema,
        }
        for name, (description, schema, _handler) in TOOLS.items()
    ]


def handle_request(message: JsonObject) -> JsonObject | None:
    message_id = message.get("id")
    method = message.get("method")
    params = message.get("params") if isinstance(message.get("params"), dict) else {}

    if method == "initialize":
        return json_response(
            message_id,
            {
                "protocolVersion": params.get("protocolVersion", "2024-11-05"),
                "capabilities": {"tools": {}},
                "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
            },
        )
    if method == "notifications/initialized":
        return None
    if method == "tools/list":
        return json_response(message_id, {"tools": list_tools()})
    if method == "tools/call":
        name = str(params.get("name", ""))
        arguments = params.get("arguments", {})
        tool = TOOLS.get(name)
        if not tool:
            return json_response(message_id, error={"code": -32602, "message": f"Unknown tool: {name}"})
        try:
            validate_value(arguments, tool[1])
            return json_response(message_id, tool[2](arguments))
        except Exception as exc:  # MCP tool errors should be returned as tool content.
            if os.environ.get("PAPER_LANTERN_MCP_DEBUG"):
                return json_response(message_id, tool_error(f"{exc}\n{traceback.format_exc()}"))
            return json_response(message_id, tool_error(str(exc)))
    if method == "ping":
        return json_response(message_id, {})
    return json_response(message_id, error={"code": -32601, "message": f"Method not found: {method}"})


def main() -> int:
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            message = json.loads(line)
            response = handle_request(message)
        except Exception as exc:
            response = json_response(None, error={"code": -32700, "message": str(exc)})
        if response is not None:
            sys.stdout.write(json.dumps(response, ensure_ascii=False, separators=(",", ":")) + "\n")
            sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
