"""Reader-compatible grouping and entry normalization for PDF annotations."""

import uuid


def highlight_group_id(highlight):
    if highlight.get("groupId"):
        return str(highlight["groupId"])
    # Match reader.js getHighlightKey for older rectangles without a groupId.
    return ":".join([str(highlight.get("pageNumber", "")), *(
        f"{float(highlight.get(key, 0)):.5f}" for key in ("left", "top", "width", "height")
    )])


def annotation_entries(highlight):
    """Mirror the reader's text entries and legacy comment/translation fallback."""
    entries = []
    values = highlight.get("text", [])
    for index, value in enumerate(values if isinstance(values, list) else []):
        if isinstance(value, str):
            entry_type, content, entry_id = "comment", value.strip(), ""
        elif isinstance(value, dict):
            entry_type = "translation" if value.get("type") == "translation" else "comment"
            content = str(value.get("content") or value.get("text") or "").strip()
            entry_id = str(value.get("id") or "")
        else:
            continue
        if content or entry_type == "comment":
            entries.append({"id": entry_id or f"legacy-{index}", "type": entry_type, "content": content})
    for entry_type, field in (("translation", "translation"), ("comment", "comment")):
        content = str(highlight.get(field) or "").strip()
        if content and not any(entry["type"] == entry_type for entry in entries):
            entries.append({"id": f"legacy-{field}", "type": entry_type, "content": content})
    return sorted(entries, key=lambda entry: entry["type"] != "translation")


def highlight_groups(highlights):
    grouped = {}
    for highlight in highlights:
        key = highlight_group_id(highlight)
        grouped.setdefault(key, []).append(highlight)
    return [{"groupId": key, "pageNumber": items[0].get("pageNumber"),
             "selectedText": next((item["selectedText"] for item in items if item.get("selectedText")), ""),
             "color": items[0].get("color", "yellow"),
             "entries": annotation_entries(items[0]), "highlights": items}
            for key, items in grouped.items()]


def append_annotation(highlights, group_id, content, entry_type, entry_id=None):
    group = next((group for group in highlight_groups(highlights) if group["groupId"] == group_id), None)
    if group is None:
        raise ValueError("Highlight group not found; call get_paper_highlights for current groupIds.")
    entry = {"id": entry_id or f"entry-{uuid.uuid4().hex}", "type": entry_type, "content": content}
    entries = sorted([*group["entries"], entry], key=lambda item: item["type"] != "translation")
    comment = next((item["content"] for item in entries if item["type"] == "comment" and item["content"]), "")
    translation = next((item["content"] for item in entries if item["type"] == "translation" and item["content"]), "")
    for highlight in group["highlights"]:
        highlight.update(groupId=group_id, text=entries)
        for field, value in (("comment", comment), ("translation", translation)):
            if value:
                highlight[field] = value
            else:
                highlight.pop(field, None)
        highlight["type"] = "comment-translation" if comment and translation else "comment" if comment else "translation"
    return entry
