#!/usr/bin/env python3
"""MCP stdio server for Paper Lantern literature-library operations."""

from __future__ import annotations

import io
import json
import os
import sys
import traceback
from pathlib import Path
from typing import Any, Callable


SERVER_NAME = "paper-lantern-research"
SERVER_VERSION = "0.1.0"


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


def item_summary(item: JsonObject) -> JsonObject:
    return {
        "id": item.get("id", ""),
        "title": item.get("title", ""),
        "categoryId": item.get("categoryId", item.get("category", "")),
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
    categories = sorted(db.get("categories", {}).values(), key=lambda item: (item.get("parentId", ""), item.get("order", 0), item.get("name", "")))
    papers = [item_summary(paper) for paper in db.get("papers", {}).values()]
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
    category = str(args.get("categoryId", "")).strip()
    item_type = str(args.get("itemType", "")).strip()
    limit = max(1, min(int(args.get("limit", 30) or 30), 200))
    db = read_db()
    matches = []
    for record in db.get("papers", {}).values():
        if category and record.get("categoryId") != category:
            continue
        if item_type and (record.get("itemType", "paper") != item_type):
            continue
        haystack = " ".join([str(record.get("id", "")), str(record.get("title", "")), str(record.get("categoryId", ""))]).lower()
        if query and query not in haystack:
            continue
        matches.append(item_summary(record))
    matches.sort(key=lambda item: item.get("uploadedAt", ""), reverse=True)
    return tool_text({"query": query, "matches": matches[:limit]})


def tool_get_item(args: JsonObject) -> JsonObject:
    item_id = str(args.get("id", "")).strip()
    include_text = bool(args.get("includeExtractedText", False))
    if not item_id:
        raise ValueError("id is required.")
    paper = paper_server.read_paper(item_id, include_extracted_text=include_text)
    return tool_text({"item": paper, "paperLink": markdown_link(format_paper_link_label(paper), item_id)})


def tool_import_paper_from_url(args: JsonObject) -> JsonObject:
    url = str(args.get("url", "")).strip()
    if not url:
        raise ValueError("url is required.")
    title = str(args.get("title", "")).strip()
    category = str(args.get("categoryId", "") or paper_server.UNCATEGORIZED_ID).strip()
    source = paper_server.normalize_remote_pdf_source(url)
    data, downloaded_title = paper_server.download_remote_pdf(source)
    paper_title = paper_server.clean_folder_name(title or downloaded_title)
    paper = paper_server.add_paper_to_db(paper_title, category, io.BytesIO(data))
    return tool_text({"paper": paper, "paperLink": markdown_link(format_paper_link_label(paper), paper["id"])})


def tool_create_category(args: JsonObject) -> JsonObject:
    name = str(args.get("name", "")).strip()
    parent_id = str(args.get("parentId", "")).strip()
    if not name:
        raise ValueError("name is required.")
    category = paper_server.create_category(parent_id, name)
    return tool_text({"category": category, "tree": paper_server.read_library_tree()})


def tool_update_paper(args: JsonObject) -> JsonObject:
    paper_id = str(args.get("id", "")).strip()
    if not paper_id:
        raise ValueError("id is required.")
    db = read_db()
    record = db.get("papers", {}).get(paper_id)
    if not record:
        raise FileNotFoundError("Paper not found.")
    if isinstance(args.get("categoryId"), str) and args["categoryId"].strip():
        paper_server.move_paper(paper_id, args["categoryId"].strip())
        db = read_db()
        record = db.get("papers", {}).get(paper_id)
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
    paper_server.write_json(paper_dir / "metadata.json", metadata)
    paper_server.save_library_db(db)
    paper = paper_server.read_paper(paper_id, db)
    return tool_text({"paper": paper, "paperLink": markdown_link(format_paper_link_label(paper), paper_id)})


def tool_create_note(args: JsonObject) -> JsonObject:
    title = str(args.get("title", "")).strip() or "Research note"
    category = str(args.get("categoryId", "") or paper_server.UNCATEGORIZED_ID).strip()
    content = str(args.get("content", ""))
    note = paper_server.add_note_to_db(title, category)
    if content:
        note_dir = paper_server.paper_dir_from_record(read_db()["papers"][note["id"]])
        paper_server.write_paper_notes(note_dir, content)
        note = paper_server.read_paper(note["id"])
    return tool_text({"note": note, "openPath": f"note.html?id={note['id']}"})


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


TOOLS: dict[str, tuple[str, JsonObject, Callable[[JsonObject], JsonObject]]] = {
    "library_overview": (
        "Return categories and recent library items.",
        {"type": "object", "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 200}}, "additionalProperties": False},
        tool_library_overview,
    ),
    "search_library": (
        "Search Paper Lantern items by title, id, or category id.",
        {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "categoryId": {"type": "string"},
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
        "Download a PDF URL or arXiv link into the literature library.",
        {
            "type": "object",
            "properties": {"url": {"type": "string"}, "title": {"type": "string"}, "categoryId": {"type": "string"}},
            "required": ["url"],
            "additionalProperties": False,
        },
        tool_import_paper_from_url,
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
        "Update paper metadata, category, notes, or local read/todo markers.",
        {
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "title": {"type": "string"},
                "categoryId": {"type": "string"},
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
    "create_note": (
        "Create a standalone Paper Lantern note or report.",
        {
            "type": "object",
            "properties": {"title": {"type": "string"}, "categoryId": {"type": "string"}, "content": {"type": "string"}},
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
        arguments = params.get("arguments") if isinstance(params.get("arguments"), dict) else {}
        tool = TOOLS.get(name)
        if not tool:
            return json_response(message_id, error={"code": -32602, "message": f"Unknown tool: {name}"})
        try:
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
