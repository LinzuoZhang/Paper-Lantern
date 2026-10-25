"""Markdown contract for AI-authored MCP notes (no optional dependencies)."""

import re
from urllib.parse import parse_qs, urlsplit


MARKDOWN_RULES = (
    "Markdown contract: wrap inline math in $...$ and display math in $$...$$; "
    "do not use \\(...\\), \\[...\\], or bare LaTeX math environments. "
    "Escape literal currency dollars as \\$. Cite library papers using "
    "[label](hash:<paper-id>) with an existing ID from search_library/get_item; "
    "use make_paper_link to generate links. Do not use reader URLs or bare hash IDs. "
    "Fenced and inline code examples are exempt. Invalid content is rejected without saving."
)


def _without_code(text):
    # Preserve newlines so error locations still refer to the original note.
    def blank(match):
        return re.sub(r"[^\n]", " ", match.group())

    lines = text.splitlines(keepends=True)
    fence = None
    for index, line in enumerate(lines):
        if fence:
            if re.match(r"^ {0,3}" + re.escape(fence[0]) + "{" + str(fence[1]) + r",}\s*$", line):
                fence = None
            lines[index] = re.sub(r"[^\n]", " ", line)
        else:
            opening = re.match(r"^ {0,3}(`{3,}|~{3,})", line)
            if opening:
                fence = (opening[1][0], len(opening[1]))
                lines[index] = re.sub(r"[^\n]", " ", line)
    return re.sub(r"(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)", blank, "".join(lines))


def validate_note_markdown(content, db, max_chars):
    if len(content) > max_chars:
        raise ValueError("Markdown exceeds MAX_NOTES_CHARS; shorten it before saving.")
    text = _without_code(content)

    def fail(offset, message):
        line = text.count("\n", 0, offset) + 1
        raise ValueError(f"Markdown line {line}: {message}")

    def escaped(offset):
        start = offset
        while start and text[start - 1] == "\\":
            start -= 1
        return (offset - start) % 2 == 1

    delimiter = None
    opened = 0
    index = 0
    while index < len(text):
        if text[index] == "\\" and not escaped(index):
            if text[index:index + 2] in (r"\(", r"\)", r"\[", r"\]"):
                fail(index, "Use $...$ or $$...$$ instead of LaTeX math delimiters.")
            if not delimiter and re.match(r"\\(?:begin|end)\{(?:equation\*?|align\*?|aligned|gather\*?|multline\*?|displaymath|math|\w*matrix)\}", text[index:]):
                fail(index, "Wrap the LaTeX math environment in $$...$$.")
            if not delimiter and re.match(r"\\(?:frac|dfrac|tfrac|sqrt|sum|prod|int|lim|alpha|beta|gamma|theta|lambda|sigma|mathbf|mathrm|mathbb)\b", text[index:]):
                fail(index, "Wrap LaTeX math commands in $...$ or $$...$$.")
        if text[index] == "$" and not escaped(index):
            run = re.match(r"\$+", text[index:])[0]
            if len(run) > 2:
                fail(index, "Math delimiters must be $ or $$, not three or more dollars.")
            if delimiter is None:
                delimiter, opened = run, index
            elif delimiter != run:
                fail(index, f"Mismatched math delimiter; expected {delimiter}.")
            else:
                if not text[opened + len(run):index].strip():
                    fail(opened, "Math content must not be empty.")
                delimiter = None
            index += len(run)
            continue
        if text[index] == "\n" and delimiter == "$":
            fail(opened, "Inline math must close on the same line; use $$...$$ for multiline math.")
        index += 1
    if delimiter:
        fail(opened, f"Unclosed {delimiter} math delimiter; escape literal dollars as \\$.")

    # Inline links, reference definitions, autolinks and HTML hrefs are inspected.
    targets = []
    patterns = (
        r"!?\[(?:\\.|[^\]\\])*\]\(\s*<?([^\s)>]+)",
        r"(?m)^ {0,3}\[[^\]\n]+\]:\s*<?([^\s>]+)",
        r"<((?:hash:)[^>]+)>",
        r"(?i)href\s*=\s*[\"']([^\"']+)",
    )
    for pattern in patterns:
        for match in re.finditer(pattern, text):
            targets.append((match.start(1), match.end(1), match[1], pattern == patterns[0]))
    hash_spans = []
    for start, end, target, inline in targets:
        if target.startswith("hash:"):
            if not inline:
                fail(start, "Library citations must use [label](hash:<paper-id>); use make_paper_link.")
            item_id = target[5:]
            if item_id not in db.get("papers", {}):
                fail(start, f"Unknown library ID {item_id!r}; look it up with search_library.")
            hash_spans.append((start, end))
        else:
            parsed = urlsplit(target)
            if target.lstrip("#") in db.get("papers", {}) or (
                parsed.path.rsplit("/", 1)[-1] in {"reader.html", "paper.html", "note.html"}
                and "id" in parse_qs(parsed.query)
            ):
                fail(start, "Use [label](hash:<paper-id>) for library links instead of page URLs.")
    for match in re.finditer(r"\bhash:", text):
        if not any(start <= match.start() < end for start, end in hash_spans):
            fail(match.start(), "Bare hash IDs are not citations; use [label](hash:<paper-id>).")
