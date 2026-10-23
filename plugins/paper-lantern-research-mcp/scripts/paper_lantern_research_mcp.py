#!/usr/bin/env python3
"""MCP stdio server for Paper Lantern literature-library operations."""

from __future__ import annotations

import json
import os
import sys
import traceback
from pathlib import Path
from typing import Any, Callable


SERVER_NAME = "paper-lantern-research"
SERVER_VERSION = "0.2.0"


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
def tool_update_paper(args: JsonObject) -> JsonObject:
    validate_value(args, TOOLS["update_paper"][1])
    paper_id = str(args.get("id", "")).strip()
    if not paper_id:
        raise ValueError("id is required.")
    db = read_db()
    record = db.get("papers", {}).get(paper_id)
    if not record:
        raise FileNotFoundError("Paper not found.")
    category_changed = any(key in args for key in ("categoryIds", "categoryId", "addCategoryIds", "removeCategoryIds"))
    # Validate every referenced category before changing any files or relationships.
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
    paper_dir = paper_server.paper_dir_from_record(record)
    metadata = paper_server.read_json(paper_dir / "metadata.json", paper_server.default_metadata(record.get("title", paper_id), record.get("categoryId", paper_server.UNCATEGORIZED_ID)))
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
        paper_server.write_paper_notes(paper_dir, args["notes"])
        metadata.pop("notes", None)
    if isinstance(args.get("read"), bool) or isinstance(args.get("todo"), bool):
        updates = {}
        if isinstance(args.get("read"), bool):
            updates["read"] = args["read"]
        if isinstance(args.get("todo"), bool):
            updates["todo"] = args["todo"]
        paper_server.update_paper_local_state(paper_id, updates)
    paper_server.copy_category_fields(metadata, record)
    paper_server.write_json(paper_dir / "metadata.json", metadata)
    paper_server.save_library_db(db)
    sync_changed = category_changed or any(key in args for key in ("title", "doi", "basicInfo", "notes"))
    sync = paper_server.maybe_auto_sync_library() if sync_changed else None
    paper = paper_server.read_paper(paper_id)
    return tool_text({"paper": paper, "paperLink": markdown_link(format_paper_link_label(paper), paper_id), "sync": sync})


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
    note = paper_server.add_note_to_db(title, category)
    if content:
        note_dir = paper_server.paper_dir_from_record(read_db()["papers"][note["id"]])
        paper_server.write_paper_notes(note_dir, content)
        note = paper_server.read_paper(note["id"])
    sync = paper_server.maybe_auto_sync_library()
    return tool_text({"note": paper_server.read_paper(note["id"]), "openPath": f"note.html?id={note['id']}", "sync": sync})


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


TOOLS: dict[str, tuple[str, JsonObject, Callable[[JsonObject], JsonObject]]] = {
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
        "Update a paper or note and its category memberships. Apply categoryIds (replacement), then addCategoryIds, then removeCategoryIds. An empty categoryIds array clears all memberships. Read/todo markers are local-only.",
        {
            "type": "object",
            "properties": {
                "id": {"type": "string", "minLength": 1},
                "title": {"type": "string"},
                "categoryId": LEGACY_CATEGORY_SCHEMA,
                "categoryIds": {**CATEGORY_IDS_SCHEMA, "description": "Replace all memberships with these existing categories; [] clears memberships and shows the item in Uncategorized."},
                "addCategoryIds": {**CATEGORY_IDS_SCHEMA, "description": "Add existing categories while keeping other memberships. [] makes no change."},
                "removeCategoryIds": {**CATEGORY_IDS_SCHEMA, "description": "Remove these exact memberships while retaining all others. [] makes no change; removal wins if also listed in addCategoryIds."},
                "doi": {"type": "string"},
                "basicInfo": {"type": "object"},
                "notes": {"type": "string"},
                "read": {"type": "boolean"},
                "todo": {"type": "boolean"},
            },
            "required": ["id"],
            "additionalProperties": False,
        },
        tool_update_paper,
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
                "content": {"type": "string"},
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
                "content": {"type": "string"},
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
            "description": description,
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
