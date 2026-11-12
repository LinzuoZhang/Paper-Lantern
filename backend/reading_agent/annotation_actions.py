"""Prepare concrete annotation changes for both preview and approved execution."""

from copy import deepcopy
import hashlib

from backend.paper_annotations import append_annotation, highlight_groups
from backend.pdf_highlights import prepare_pdf_highlight


ANNOTATION_TOOLS = frozenset({"add_paper_highlight", "add_paper_annotation"})


def prepare_annotation_change(directory, highlights, name, args, plan_id, operation_id):
    stable_id = hashlib.sha256(f"agent-annotation:{plan_id}:{operation_id}".encode()).hexdigest()[:32]
    previous = deepcopy(highlight_groups(highlights))
    if name == "add_paper_highlight":
        group, additions = prepare_pdf_highlight(directory / "paper.pdf", highlights, args["pageNumber"],
            args["text"].strip(), args.get("color", "yellow"), group_id="annotation-" + stable_id)
        highlights.extend(additions)
        output = {"groupId": group["groupId"], "added": bool(additions), "changed": bool(additions)}
    else:
        entry = append_annotation(highlights, args["groupId"].strip(), args["content"].strip(),
                                  args.get("type", "comment"), entry_id="entry-" + stable_id)
        output = {"groupId": args["groupId"].strip(), "entryId": entry["id"], "changed": True}
    output["itemId"] = args["id"]

    def view(groups):
        colors = {"yellow": "黄色", "green": "绿色", "blue": "蓝色", "pink": "粉色", "orange": "橙色", "purple": "紫色", "red": "红色"}
        descriptions = []
        for group in groups:
            if group["groupId"] != output["groupId"]:
                continue
            lines = [f"第 {group['pageNumber']} 页 · {colors.get(group['color'], group['color'])}高亮", f"原文：{group['selectedText']}"]
            lines.extend(("翻译：" if entry["type"] == "translation" else "批注：") + entry["content"] for entry in group["entries"] if entry["content"])
            descriptions.append("\n".join(lines))
        return {"highlights": descriptions}

    return output, view(previous), view(highlight_groups(highlights))
