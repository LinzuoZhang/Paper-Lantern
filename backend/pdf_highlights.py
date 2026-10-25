"""Map exact quotations to the normalized rectangles used by the PDF reader."""

import uuid

from backend.auto_highlight import normalize_quote


def require_pymupdf():
    try:
        import fitz
    except ImportError as exc:
        raise RuntimeError("MCP 自动高亮需要 PyMuPDF，请运行 python -m pip install pymupdf。") from exc
    return fitz


def quote_rectangles(page, quote):
    fitz = require_pymupdf()
    text, positions = [], []
    # RAWDICT retains exact character boxes; line IDs keep columns separate.
    raw = page.get_text("rawdict", flags=fitz.TEXTFLAGS_RAWDICT & ~fitz.TEXT_PRESERVE_IMAGES)
    for block_index, block in enumerate(raw["blocks"]):
        for line_index, line in enumerate(block.get("lines", [])):
            for span in line["spans"]:
                for character in span["chars"]:
                    part = normalize_quote(character["c"])
                    text.append(part)
                    positions.extend([(block_index, line_index, character["bbox"])] * len(part))
    text = "".join(text)
    wanted = normalize_quote(quote)
    start = text.find(wanted)
    if not wanted or start < 0 or text.find(wanted, start + 1) >= 0:
        return []
    lines = {}
    for block, line, box in positions[start:start + len(wanted)]:
        key = (block, line)
        if key in lines:
            lines[key] |= fitz.Rect(box)
        else:
            lines[key] = fitz.Rect(box)
    result = []
    bounds = page.rect
    for box in lines.values():
        rect = (box * page.rotation_matrix) & bounds
        if rect.is_empty or bounds.is_empty:
            continue
        result.append({
            "left": (rect.x0 - bounds.x0) / bounds.width,
            "top": (rect.y0 - bounds.y0) / bounds.height,
            "width": rect.width / bounds.width,
            "height": rect.height / bounds.height,
        })
    return result


def build_pdf_highlights(pdf, quotes, existing):
    seen = {
        (item.get("pageNumber"), normalize_quote(str(item.get("selectedText") or "")))
        for item in existing if isinstance(item, dict)
    }
    additions, skipped, duplicates = [], [], 0
    for quote in quotes:
        key = (quote["pageNumber"], normalize_quote(quote["text"]))
        if key in seen:
            duplicates += 1
            continue
        rectangles = quote_rectangles(pdf[quote["pageNumber"] - 1], quote["text"])
        if not rectangles:
            skipped.append(quote)
            continue
        group_id = f"annotation-{uuid.uuid4().hex}"
        additions.extend({
            **rect, "pageNumber": quote["pageNumber"], "groupId": group_id,
            "color": "purple", "selectedText": quote["text"],
            "text": [], "source": "auto-highlight",
        } for rect in rectangles)
        seen.add(key)
    return additions, skipped, duplicates
