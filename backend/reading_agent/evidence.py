"""Verbatim evidence registration and deterministic report/source auditing."""

import hashlib
import html
import json
from pathlib import Path
import re
import unicodedata

from backend.auto_highlight import normalize_quote
from backend.mcp_markdown import _without_code


def report_title(report, fallback="研究报告"):
    """Take the report's visible Markdown title, ignoring fenced code examples."""
    headings = []
    fence = None
    previous = ""
    for line in report.splitlines():
        if fence:
            if re.match(r"^ {0,3}" + re.escape(fence[0]) + "{" + str(fence[1]) + r",}\s*$", line):
                fence = None
            continue
        opening = re.match(r"^ {0,3}(`{3,}|~{3,})", line)
        if opening:
            fence = (opening[1][0], len(opening[1]))
            previous = ""
            continue
        heading = re.match(r"^ {0,3}(#{1,6})[ \t]+(.+?)\s*$", line)
        if heading:
            headings.append((len(heading[1]), re.sub(r"\s+#+\s*$", "", heading[2])))
        elif previous and re.fullmatch(r" {0,3}(?:=+|-+)[ \t]*", line):
            headings.append((1 if line.lstrip().startswith("=") else 2, previous))
        previous = line.strip() if line and not line.startswith(("    ", "\t", ">")) else ""
    for _, title in sorted(headings, key=lambda value: value[0]):
        title = re.sub(r"!?\[([^\]]+)\]\([^)]*\)", r"\1", title)
        title = re.sub(r"\[C[1-9]\d*\]", "", title)
        title = re.sub(r"<[^>]*>", "", title)
        title = re.sub(r"(`+|\*{1,3}|(?<!\w)_{1,3}|_{1,3}(?!\w)|~~)", "", title)
        title = " ".join(html.unescape(title).split()).strip()
        if title:
            return title[:200]
    return " ".join(str(fallback or "研究报告").split())[:200] or "研究报告"


CLAIM_TOOL = {"type": "function", "function": {
    "name": "record_claim",
    "description": "Register a finding, inference or limitation using verbatim quotes from full_text passages already read. Quotes are checked against the original passage. Returns claimId, to cite in the report as [C1]. Findings require source support; inferences must be explicitly labelled as such. Does not write the library.",
    "parameters": {"type": "object", "properties": {
        "statement": {"type": "string", "minLength": 1, "maxLength": 2000},
        "kind": {"type": "string", "enum": ["finding", "inference", "limitation"]},
        "supports": {"type": "array", "minItems": 1, "maxItems": 6, "items": {"type": "object", "properties": {
            "passageId": {"type": "string"}, "quote": {"type": "string", "minLength": 8, "maxLength": 1200},
        }, "required": ["passageId", "quote"], "additionalProperties": False}},
    }, "required": ["statement", "kind", "supports"], "additionalProperties": False},
}}


def quote_span(text, quote):
    normalized, offsets = [], []
    for index, char in enumerate(text):
        for part in unicodedata.normalize("NFKD", char):
            if not part.isspace() and part != "\u00ad":
                normalized.append(part)
                offsets.append(index)
    canonical = normalize_quote(quote)
    wanted = unicodedata.normalize("NFKD", canonical)
    position = "".join(normalized).find(wanted)
    if len(canonical) < 8 or position < 0:
        raise ValueError("引文必须是已读正文片段中至少 8 个非空白字符的原文，不得改写。")
    return offsets[position], offsets[position + len(wanted) - 1] + 1


def register_claim(arguments, evidence, claims):
    if not isinstance(arguments, dict) or set(arguments) != {"statement", "kind", "supports"}:
        raise ValueError("结论须包含 statement、kind、supports。")
    statement = arguments["statement"]
    if not isinstance(statement, str) or not 1 <= len(statement.strip()) <= 2000:
        raise ValueError("结论须为 1–2000 字符。")
    if not isinstance(arguments["kind"], str) or arguments["kind"] not in {"finding", "inference", "limitation"}:
        raise ValueError("请标记结论为 finding、inference 或 limitation。")
    supports = arguments["supports"]
    if not isinstance(supports, list) or not 1 <= len(supports) <= 6:
        raise ValueError("每条结论须关联 1–6 段已读原文。")
    verified = []
    for support in supports:
        if not isinstance(support, dict) or set(support) != {"passageId", "quote"}:
            raise ValueError("原文支持须包含 passageId 和 quote。")
        passage = evidence.get(support["passageId"]) if isinstance(support["passageId"], str) else None
        if not passage or passage.get("source") != "full_text":
            raise ValueError("只能引用本任务已读取的正文片段。")
        quote = support["quote"]
        if not isinstance(quote, str) or len(quote) > 1200:
            raise ValueError("引文格式或长度无效。")
        start, end = quote_span(passage["text"], quote)
        verified.append({"passageId": support["passageId"], "hash": passage["hash"],
                         "sourceVersion": passage["sourceVersion"], "pageNumber": passage.get("pageNumber"),
                         "textOrigin": passage.get("textOrigin"), "offsetScope": passage.get("offsetScope"),
                         "startChar": passage["startChar"] + start, "endChar": passage["startChar"] + end,
                         "quote": passage["text"][start:end]})
    for claim in claims.values():
        if claim["statement"] == statement.strip() and claim["kind"] == arguments["kind"] and claim["supports"] == verified:
            return claim
    if len(claims) >= 40:
        raise ValueError("结论数量超过 40 条，请合并重复结论。")
    claim_id = "C" + str(len(claims) + 1)
    return {"claimId": claim_id, "statement": statement.strip(), "kind": arguments["kind"], "supports": verified}


def audit_report(report, claims, strict=True):
    plain = _without_code(report)
    used = list(dict.fromkeys(re.findall(r"\[(C[1-9]\d*)\](?!\()", plain)))
    if strict and not used:
        if claims:
            raise ValueError("已登记原文证据，但报告正文未引用证据编号。请在对应结论段落使用 "
                             + "、".join(f"[{key}]" for key in claims) + "；不要只放在代码块中。")
        raise ValueError("请先用 record_claim 登记有原文依据的结论，并在报告对应段落使用 [C1] 等证据编号。")
    unknown = set(used) - claims.keys()
    if unknown:
        raise ValueError("报告含未知证据编号：" + ", ".join(sorted(unknown)))
    referenced = {key: claims[key] for key in used}
    return {"usedClaimIds": used, "claimCount": len(used),
            "supportCount": sum(len(claim["supports"]) for claim in referenced.values()),
            "reportDigest": hashlib.sha256(report.encode("utf-8")).hexdigest(),
            "checks": {"quotesVerified": True, "claimIdsVerified": True},
            "limitation": "自动检查确认引文确实来自所列原文，不等同于证明结论的语义正确性。"}


def report_with_paper_links(result, papers):
    """Link verified claim numbers to library papers, preserving code and links."""
    if not result or not isinstance(result.get("report"), str):
        return result
    report = result["report"]
    claims = {claim["claimId"]: claim for claim in result.get("claims", [])}
    if not claims:
        return result
    plain = _without_code(report)
    replacements = []
    for match in re.finditer(r"(?<!!)(?<!\\)\[(C[1-9]\d*)\](?!\()", plain):
        claim = claims.get(match[1])
        if not claim:
            continue
        links, seen = [], set()
        for support in claim.get("supports", []):
            key = support.get("hash")
            if key not in papers or key in seen:
                continue
            seen.add(key)
            links.append(f"[{match[1]}](hash:{key})")
        if links:
            replacements.append((match.start(), match.end(), "、".join(links)))
    for start, end, replacement in reversed(replacements):
        report = report[:start] + replacement + report[end:]
    if report == result["report"]:
        return result
    presented = {**result, "report": report}
    if result.get("verification"):
        presented["verification"] = {**result["verification"], "reportDigest": hashlib.sha256(report.encode("utf-8")).hexdigest()}
    return presented


def source_signatures(library_dir, evidence):
    root = Path(library_dir).resolve()
    manifest = json.loads((root / "library_db.json").read_text(encoding="utf-8"))
    origins = {}
    for passage in evidence.values():
        origins.setdefault(passage["hash"], set()).add(passage.get("textOrigin", "cache"))
    result = {}
    for paper_hash, values in origins.items():
        record = manifest.get("papers", {}).get(paper_hash)
        if not record:
            raise ValueError("引用文献已删除或归档。")
        directory = (root / record["folder"]).resolve()
        if not directory.is_relative_to(root):
            raise ValueError("引用文献路径不在文献库中。")
        files = {}
        for name in (["paper.pdf", "extracted_text.txt"] if "cache" in values else ["paper.pdf"]):
            path = directory / name
            if not path.exists():
                files[name] = None
                continue
            digest = hashlib.sha256()
            with path.open("rb") as handle:
                for block in iter(lambda: handle.read(1024 * 1024), b""):
                    digest.update(block)
            files[name] = digest.hexdigest()
        result[paper_hash] = {"folder": record["folder"], "origins": sorted(values), "files": files}
    return result
