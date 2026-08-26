from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import cgi
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
import urllib.error
import urllib.request
from urllib.parse import urlparse

from config_store import get_secret, load_config, public_config, save_config
from cloud_sync import auto_sync_library, get_sync_config, public_status, save_sync_config, sync_library, update_paper_sync_hash


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_API_BASE_URL = "https://api.openai.com/v1"
CONFIG_FILE = BASE_DIR / ".env" / "paperlantern_config.json"
LEGACY_AI_ENV_FILE = BASE_DIR / ".env" / "ai.env"
LEGACY_CLOUD_SYNC_ENV_FILE = BASE_DIR / ".env" / "cloud_sync.env"
PROMPT_DIR = BASE_DIR / "prompts" / "ai"
MAX_PAPER_CHARS = 500_000
AI_SUMMARY_TIMEOUT_SECONDS = 600
MAX_TRANSLATE_CHARS = 4000
MAX_TRANSLATION_CONTEXT_CHARS = 3000
MAX_TRANSLATION_SUMMARY_CHARS = 8000
MAX_DISCUSSION_HISTORY_ITEMS = 200
DISCUSSION_RECENT_MESSAGE_COUNT = 24
MAX_DISCUSSION_MESSAGE_CHARS = 3000
MAX_DISCUSSION_EARLIER_CONTEXT_CHARS = 8000
MAX_EXTRACTED_TEXT_CHARS = 2_000_000
EXTRACTED_TEXT_FILE = "extracted_text.txt"
LIBRARY_DIR = Path(os.environ.get("PAPER_LIBRARY_DIR", BASE_DIR / "literature_library")).resolve()
DB_FILE = LIBRARY_DIR / "library_db.json"
PAPER_STORAGE_DIR = LIBRARY_DIR / "papers"
UNCATEGORIZED_ID = "uncategorized"
UNCATEGORIZED_NAME = "\u672a\u5206\u7c7b"


def load_env_file(path):
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def get_ai_config(task_name="summary"):
    config = load_config(BASE_DIR)
    ai = config.get("ai", {})
    task_configs = ai.get("tasks", {}) if isinstance(ai.get("tasks", {}), dict) else {}
    task = task_configs.get(task_name, {}) if isinstance(task_configs.get(task_name, {}), dict) else {}
    use_default = bool(task.get("useDefault", True))

    default_api_key = get_secret(config, "ai", "apiKey").strip()
    default_model = str(ai.get("model", "")).strip() or "gpt-4o-mini"
    default_base_url = str(ai.get("baseUrl", "")).strip() or DEFAULT_API_BASE_URL
    default_extra_params = dict(ai.get("extraParams", {})) if isinstance(ai.get("extraParams", {}), dict) else {}
    if use_default:
        api_key, model, base_url, extra_params = default_api_key, default_model, default_base_url, default_extra_params
    else:
        api_key = get_secret({"task": task}, "task", "apiKey").strip() or default_api_key
        model = str(task.get("model", "")).strip() or default_model
        base_url = str(task.get("baseUrl", "")).strip() or default_base_url
        extra_params = dict(task.get("extraParams", {})) if isinstance(task.get("extraParams", {}), dict) else {}

    base_url = base_url.rstrip("/")
    if base_url.endswith("/chat/completions"):
        chat_completions_url = base_url
    else:
        chat_completions_url = f"{base_url}/chat/completions"
    return api_key, model, chat_completions_url, extra_params


def parse_query_value(path, name):
    query = urlparse(path).query
    for part in query.split("&"):
        if not part or "=" not in part:
            continue
        key, value = part.split("=", 1)
        if key == name:
            from urllib.parse import unquote_plus

            return unquote_plus(value)
    return ""


def field_value(form, name):
    return str(form[name].value).strip() if name in form else ""


def clean_folder_name(value):
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', " ", str(value)).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned[:120] or "Untitled paper"


def normalize_arxiv_id(value):
    text = str(value or "").strip().replace("http://", "https://")
    text = re.sub(r"^https://(?:www\.)?arxiv\.org/(?:abs|pdf)/", "", text, flags=re.I)
    text = text.split("?", 1)[0].split("#", 1)[0].strip("/")
    text = re.sub(r"\.pdf$", "", text, flags=re.I)
    pattern = r"^(?:[a-z-]+(?:\.[A-Z]{2})?/\d{7}|[a-z-]+/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?$"
    return text if re.match(pattern, text, re.I) else ""


def download_arxiv_pdf(arxiv_id):
    request = urllib.request.Request(
        f"https://arxiv.org/pdf/{arxiv_id}.pdf",
        headers={"User-Agent": "PaperLantern/1.0"},
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        content_type = response.headers.get("Content-Type", "")
        data = response.read()
    if b"%PDF" not in data[:1024] and "pdf" not in content_type.lower():
        raise ValueError("arXiv did not return a PDF.")
    return data


def export_annotated_pdf(pdf_path, highlights):
    try:
        import fitz
    except ImportError as exc:
        raise RuntimeError("PyMuPDF is required to export annotated PDFs.") from exc

    normalized = normalize_export_highlights(highlights)
    doc = fitz.open(str(pdf_path))
    comments_by_group = {}
    try:
        for highlight in normalized:
            page_index = highlight["pageNumber"] - 1
            if page_index < 0 or page_index >= doc.page_count:
                continue
            page = doc[page_index]
            rect = normalized_highlight_rect(page, highlight)
            if rect.is_empty or rect.width <= 0 or rect.height <= 0:
                continue
            color = export_highlight_color(highlight.get("color", "yellow"))
            page.draw_rect(rect, color=None, fill=color, fill_opacity=0.34, overlay=True)
            note = "\n\n".join(value for value in (highlight.get("comment", ""), highlight.get("translation", "")) if value)
            if note:
                group_id = highlight.get("groupId") or highlight["hash"]
                comments_by_group.setdefault(group_id, {"page": page, "rect": rect, "text": note})

        for index, item in enumerate(comments_by_group.values(), start=1):
            add_export_comment(item["page"], item["rect"], item["text"], index)

        data = doc.tobytes(deflate=True, garbage=4)
    finally:
        doc.close()
    return data


def normalize_export_highlights(highlights):
    if not isinstance(highlights, list):
        return []
    normalized = []
    for item in highlights:
        if not isinstance(item, dict):
            continue
        try:
            page_number = int(item.get("pageNumber"))
            left = clamp_float(item.get("left"), 0, 1)
            top = clamp_float(item.get("top"), 0, 1)
            width = clamp_float(item.get("width"), 0, 1)
            height = clamp_float(item.get("height"), 0, 1)
        except (TypeError, ValueError):
            continue
        if page_number < 1 or width <= 0 or height <= 0:
            continue
        normalized.append(
            {
                "pageNumber": page_number,
                "left": left,
                "top": top,
                "width": min(width, 1 - left),
                "height": min(height, 1 - top),
                "color": str(item.get("color", "yellow")).strip(),
                "comment": str(item.get("comment", "")).strip(),
                "translation": str(item.get("translation", "")).strip(),
                "groupId": str(item.get("groupId", "")).strip(),
                "hash": str(item.get("hash", "")).strip(),
            }
        )
    return normalized


def clamp_float(value, lower, upper):
    number = float(value)
    return max(lower, min(upper, number))


def normalized_highlight_rect(page, highlight):
    rect = page.rect
    x0 = rect.x0 + highlight["left"] * rect.width
    y0 = rect.y0 + highlight["top"] * rect.height
    x1 = x0 + highlight["width"] * rect.width
    y1 = y0 + highlight["height"] * rect.height
    return fitz_rect(page, x0, y0, x1, y1)


def fitz_rect(page, x0, y0, x1, y1):
    import fitz

    rect = fitz.Rect(x0, y0, x1, y1)
    return rect & page.rect


def export_highlight_color(name):
    colors = {
        "yellow": (1.0, 0.84, 0.18),
        "green": (0.35, 0.78, 0.58),
        "blue": (0.32, 0.62, 0.86),
        "pink": (0.92, 0.45, 0.58),
    }
    return colors.get(str(name).lower(), colors["yellow"])


def add_export_comment(page, anchor_rect, text, index):
    import fitz

    clean_text = str(text).strip()
    if not clean_text:
        return
    point = fitz.Point(min(anchor_rect.x1 + 4, page.rect.x1 - 16), max(anchor_rect.y0, page.rect.y0 + 8))
    note = page.add_text_annot(point, clean_text, icon="Comment")
    note.set_info(title=f"Comment {index}", content=clean_text)
    note.update()


def clean_export_filename(value):
    name = clean_folder_name(Path(str(value)).stem)
    return f"{name}.pdf"


def clean_category_path(value):
    if str(value).strip() in {"", "Uncategorized"}:
        return Path(UNCATEGORIZED_NAME)
    parts = [clean_folder_name(part) for part in re.split(r"[/\\]+", str(value)) if part.strip()]
    return Path(*parts[:5]) if parts else Path(UNCATEGORIZED_NAME)


def is_uncategorized_path(value):
    return str(value).replace("\\", "/").strip("/") == UNCATEGORIZED_NAME


def unique_paper_dir(parent, title):
    base = clean_folder_name(title)
    candidate = parent / base
    index = 2
    while candidate.exists():
        candidate = parent / f"{base} {index}"
        index += 1
    return candidate


def unique_existing_dir(parent, source):
    candidate = parent / source.name
    index = 2
    while candidate.exists():
        candidate = parent / f"{source.name} {index}"
        index += 1
    return candidate


def resolve_library_path(paper_id):
    if not paper_id:
        return None
    candidate = (LIBRARY_DIR / paper_id).resolve()
    try:
        candidate.relative_to(LIBRARY_DIR)
    except ValueError:
        return None
    return candidate if candidate.exists() and candidate.is_dir() else None


def path_to_id(path):
    return str(path.resolve().relative_to(LIBRARY_DIR)).replace("\\", "/")


def read_json(path, fallback):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return fallback


def write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp",
        delete=False,
    ) as temp_file:
        temp_file.write(json.dumps(data, ensure_ascii=False, indent=2))
        temp_path = Path(temp_file.name)
    try:
        os.replace(temp_path, path)
    finally:
        temp_path.unlink(missing_ok=True)


def read_text_file(path):
    try:
        return Path(path).read_text(encoding="utf-8")
    except OSError:
        return ""


def write_text_file(path, text):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(str(text), encoding="utf-8")


def get_cloud_sync_config():
    return get_sync_config(BASE_DIR)


def maybe_auto_sync_library():
    return auto_sync_library(LIBRARY_DIR, get_cloud_sync_config())


def default_metadata(title, category):
    return {
        "title": str(title),
        "category": str(category).replace("\\", "/"),
        "uploadedAt": datetime.now(timezone.utc).isoformat(),
        "keywords": [],
        "threeLineSummary": {},
        "methodOverview": "",
        "methodSections": [],
        "methodConclusion": "",
        "basicInfo": {},
    }


def read_library_tree():
    LIBRARY_DIR.mkdir(parents=True, exist_ok=True)
    (LIBRARY_DIR / UNCATEGORIZED_NAME).mkdir(parents=True, exist_ok=True)
    return read_category_node(LIBRARY_DIR, "")


def read_category_node(path, relative):
    folders = []
    papers = []
    for child in sorted(path.iterdir(), key=lambda item: item.name.lower()):
        if not child.is_dir():
            continue
        if (child / "paper.pdf").exists():
            paper = read_paper(path_to_id(child))
            if paper:
                papers.append(paper)
        else:
            folders.append(read_category_node(child, path_to_id(child)))
    return {
        "id": relative,
        "name": path.name if relative else "文献库",
        "locked": is_uncategorized_path(relative),
        "folders": folders,
        "papers": papers,
    }


def read_paper(paper_id):
    paper_dir = resolve_library_path(paper_id)
    if not paper_dir:
        return None
    metadata = read_json(paper_dir / "metadata.json", default_metadata(paper_dir.name, path_to_id(paper_dir.parent)))
    highlights = read_json(paper_dir / "highlights.json", [])
    uploaded_at = metadata.get("uploadedAt") or datetime.fromtimestamp(paper_dir.stat().st_mtime, timezone.utc).isoformat()
    return {
        "id": path_to_id(paper_dir),
        "title": metadata.get("title") or paper_dir.name,
        "category": path_to_id(paper_dir.parent) if paper_dir.parent != LIBRARY_DIR else UNCATEGORIZED_NAME,
        "uploadedAt": uploaded_at,
        "pdfUrl": f"/api/library/pdf?id={path_to_id(paper_dir)}",
        "highlights": highlights if isinstance(highlights, list) else [],
        "keywords": normalize_keywords(metadata.get("keywords", [])),
        "threeLineSummary": metadata.get("threeLineSummary", {}),
        "methodOverview": str(metadata.get("methodOverview", "")).strip(),
        "methodSections": normalize_method_sections(metadata.get("methodSections", [])),
        "methodConclusion": str(metadata.get("methodConclusion", "")).strip(),
    }


def resolve_category_path(category_id):
    if not str(category_id).strip():
        return LIBRARY_DIR
    category = clean_category_path(category_id or UNCATEGORIZED_NAME)
    candidate = (LIBRARY_DIR / category).resolve()
    try:
        candidate.relative_to(LIBRARY_DIR)
    except ValueError:
        return None
    return candidate


def create_category(parent_id, name):
    parent = resolve_category_path(parent_id or "")
    if parent is None:
        raise ValueError("Invalid parent category.")
    parent.mkdir(parents=True, exist_ok=True)
    child_name = clean_folder_name(name)
    if not child_name:
        raise ValueError("Category name is required.")
    child = (parent / child_name).resolve()
    child.relative_to(LIBRARY_DIR)
    child.mkdir(parents=True, exist_ok=False)
    return path_to_id(child)


def delete_category(category_id):
    category = resolve_category_path(category_id)
    if category is None or not category.exists():
        raise FileNotFoundError("Category not found.")
    category_id = path_to_id(category)
    if not category_id or is_uncategorized_path(category_id):
        raise PermissionError("This category cannot be deleted.")
    uncategorized = LIBRARY_DIR / UNCATEGORIZED_NAME
    uncategorized.mkdir(parents=True, exist_ok=True)
    for paper_dir in list(category.rglob("*")):
        if paper_dir.is_dir() and (paper_dir / "paper.pdf").exists():
            target = unique_existing_dir(uncategorized, paper_dir)
            shutil.move(str(paper_dir), str(target))
            metadata_path = target / "metadata.json"
            metadata = read_json(metadata_path, default_metadata(target.name, UNCATEGORIZED_NAME))
            metadata["category"] = UNCATEGORIZED_NAME
            write_json(metadata_path, metadata)
    shutil.rmtree(category)


def move_paper(paper_id, category_id):
    paper_dir = resolve_library_path(paper_id)
    target_category = resolve_category_path(category_id or UNCATEGORIZED_NAME)
    if not paper_dir or not (paper_dir / "paper.pdf").exists():
        raise FileNotFoundError("Paper not found.")
    if target_category is None:
        raise ValueError("Invalid target category.")
    target_category.mkdir(parents=True, exist_ok=True)
    target = unique_existing_dir(target_category, paper_dir)
    shutil.move(str(paper_dir), str(target))
    metadata_path = target / "metadata.json"
    metadata = read_json(metadata_path, default_metadata(target.name, path_to_id(target_category)))
    metadata["category"] = path_to_id(target_category) if target_category != LIBRARY_DIR else UNCATEGORIZED_NAME
    write_json(metadata_path, metadata)
    return read_paper(path_to_id(target))


def delete_paper(paper_id):
    paper_dir = resolve_library_path(paper_id)
    if not paper_dir or not (paper_dir / "paper.pdf").exists():
        raise FileNotFoundError("Paper not found.")
    shutil.rmtree(paper_dir)


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def make_paper_id(seed):
    base = f"{seed}|{utc_now()}".encode("utf-8", errors="replace")
    return hashlib.sha256(base).hexdigest()[:16]


def new_db():
    return {
        "version": 1,
        "categories": {
            UNCATEGORIZED_ID: {
                "id": UNCATEGORIZED_ID,
                "name": UNCATEGORIZED_NAME,
                "parentId": "",
                "locked": True,
                "sortOrder": 0,
            }
        },
        "papers": {},
    }


def load_library_db():
    LIBRARY_DIR.mkdir(parents=True, exist_ok=True)
    PAPER_STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    if DB_FILE.exists():
        db = read_json(DB_FILE, new_db())
    else:
        db = new_db()
        migrate_existing_library(db)
        save_library_db(db)
    ensure_uncategorized(db)
    reconcile_paper_storage(db)
    ensure_library_sort_orders(db)
    save_library_db(db)
    return db


def save_library_db(db):
    LIBRARY_DIR.mkdir(parents=True, exist_ok=True)
    write_json(DB_FILE, db)


def ensure_uncategorized(db):
    db.setdefault("categories", {})
    db.setdefault("papers", {})
    existing = db["categories"].get(UNCATEGORIZED_ID, {})
    db["categories"][UNCATEGORIZED_ID] = {
        "id": UNCATEGORIZED_ID,
        "name": UNCATEGORIZED_NAME,
        "parentId": "",
        "locked": True,
        "sortOrder": existing.get("sortOrder", 0),
    }


def sort_order_value(item, fallback=0):
    try:
        return int(item.get("sortOrder", fallback))
    except (TypeError, ValueError):
        return fallback


def ensure_library_sort_orders(db):
    """Give existing records stable manual-order values without moving data."""
    categories = db.setdefault("categories", {})
    papers = db.setdefault("papers", {})
    parent_ids = {str(item.get("parentId", "")) for item in categories.values()}
    for parent_id in parent_ids:
        siblings = [item for item in categories.values() if str(item.get("parentId", "")) == parent_id]
        siblings.sort(key=lambda item: (sort_order_value(item, 10**9), str(item.get("name", "")).lower()))
        for index, item in enumerate(siblings):
            item["sortOrder"] = index

    category_ids = {str(item.get("categoryId") or UNCATEGORIZED_ID) for item in papers.values()}
    for category_id in category_ids:
        siblings = [item for item in papers.values() if str(item.get("categoryId") or UNCATEGORIZED_ID) == category_id]
        siblings.sort(key=lambda item: (sort_order_value(item, 10**9), str(item.get("uploadedAt", ""))), reverse=False)
        if not any("sortOrder" in item for item in siblings):
            siblings.sort(key=lambda item: str(item.get("uploadedAt", "")), reverse=True)
        for index, item in enumerate(siblings):
            item["sortOrder"] = index


def next_sort_order(items):
    return max((sort_order_value(item, -1) for item in items), default=-1) + 1


def reconcile_paper_storage(db):
    """Restore index records for paper folders that still exist on disk."""
    papers = db.setdefault("papers", {})
    categories = db.setdefault("categories", {})
    if not PAPER_STORAGE_DIR.exists():
        return

    for paper_dir in PAPER_STORAGE_DIR.iterdir():
        if not paper_dir.is_dir() or paper_dir.name in papers or not (paper_dir / "paper.pdf").exists():
            continue
        metadata = read_json(paper_dir / "metadata.json", default_metadata(paper_dir.name, UNCATEGORIZED_ID))
        category_id = str(metadata.get("category") or UNCATEGORIZED_ID)
        if category_id not in categories:
            category_id = UNCATEGORIZED_ID
        papers[paper_dir.name] = {
            "id": paper_dir.name,
            "title": metadata.get("title") or paper_dir.name,
            "categoryId": category_id,
            "folder": f"papers/{paper_dir.name}",
            "uploadedAt": metadata.get("uploadedAt") or datetime.fromtimestamp(paper_dir.stat().st_mtime, timezone.utc).isoformat(),
            "sortOrder": next_sort_order([item for item in papers.values() if item.get("categoryId") == category_id]),
        }


def migrate_existing_library(db):
    if not LIBRARY_DIR.exists():
        return
    for paper_dir in list(LIBRARY_DIR.rglob("*")):
        if not paper_dir.is_dir() or paper_dir.parent == PAPER_STORAGE_DIR:
            continue
        if PAPER_STORAGE_DIR in paper_dir.parents:
            continue
        if not (paper_dir / "paper.pdf").exists():
            continue
        relative_parent = paper_dir.parent.relative_to(LIBRARY_DIR) if paper_dir.parent != LIBRARY_DIR else Path()
        category_id = ensure_category_path(db, str(relative_parent).replace("\\", "/"))
        metadata = read_json(paper_dir / "metadata.json", default_metadata(paper_dir.name, category_id))
        paper_id = make_paper_id(path_to_id(paper_dir))
        target_dir = PAPER_STORAGE_DIR / paper_id
        while target_dir.exists():
            paper_id = make_paper_id(f"{paper_id}-retry")
            target_dir = PAPER_STORAGE_DIR / paper_id
        target_dir.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(paper_dir), str(target_dir))
        metadata["category"] = category_id
        metadata.setdefault("uploadedAt", datetime.fromtimestamp(target_dir.stat().st_mtime, timezone.utc).isoformat())
        write_json(target_dir / "metadata.json", metadata)
        db["papers"][paper_id] = {
            "id": paper_id,
            "title": metadata.get("title") or target_dir.name,
            "categoryId": category_id,
            "folder": f"papers/{paper_id}",
            "uploadedAt": metadata["uploadedAt"],
            "sortOrder": next_sort_order([item for item in db["papers"].values() if item.get("categoryId") == category_id]),
        }


def ensure_category_path(db, category_path):
    value = str(category_path or "").strip().strip("/\\")
    if not value or value == "Uncategorized" or value == UNCATEGORIZED_NAME:
        return UNCATEGORIZED_ID
    parent_id = ""
    current_id = ""
    for part in [clean_folder_name(item) for item in re.split(r"[/\\]+", value) if item.strip()]:
        current_id = f"{parent_id}/{part}".strip("/")
        if current_id not in db["categories"]:
            siblings = [item for item in db["categories"].values() if item.get("parentId", "") == parent_id]
            db["categories"][current_id] = {
                "id": current_id,
                "name": part,
                "parentId": parent_id,
                "locked": False,
                "sortOrder": next_sort_order(siblings),
            }
        parent_id = current_id
    return current_id or UNCATEGORIZED_ID


def paper_dir_from_record(record):
    return (LIBRARY_DIR / record["folder"]).resolve()


def read_library_tree():
    db = load_library_db()
    return build_category_node(db, "")


def build_category_node(db, category_id):
    if category_id:
        category = db["categories"][category_id]
        name = category["name"]
        locked = bool(category.get("locked"))
    else:
        name = "\u6587\u732e\u5e93"
        locked = False
    folders = [
        build_category_node(db, child["id"])
        for child in sorted(
            (item for item in db["categories"].values() if item.get("parentId", "") == category_id),
            key=lambda item: (sort_order_value(item, 10**9), item["name"].lower()),
        )
    ]
    papers = [
        read_paper(paper_id, db)
        for paper_id, paper in sorted(
            db["papers"].items(),
            key=lambda item: (sort_order_value(item[1], 10**9), item[1].get("uploadedAt", "")),
        )
        if paper.get("categoryId") == category_id
    ]
    papers = [paper for paper in papers if paper]
    return {"id": category_id, "name": name, "locked": locked, "folders": folders, "papers": papers}


def read_paper(paper_id, db=None, include_extracted_text=False):
    db = db or load_library_db()
    record = db["papers"].get(str(paper_id))
    if not record:
        return None
    paper_dir = paper_dir_from_record(record)
    if not paper_dir.exists():
        return None
    metadata = read_json(paper_dir / "metadata.json", default_metadata(record.get("title", paper_id), record.get("categoryId", UNCATEGORIZED_ID)))
    highlights = read_json(paper_dir / "highlights.json", [])
    discussion = normalize_discussion_payload(read_json(paper_dir / "discussion.json", []))
    extracted_text = read_text_file(paper_dir / EXTRACTED_TEXT_FILE) if include_extracted_text else ""
    category_id = record.get("categoryId") or UNCATEGORIZED_ID
    return {
        "id": record["id"],
        "title": metadata.get("title") or record.get("title") or record["id"],
        "category": category_id,
        "categoryName": db["categories"].get(category_id, {}).get("name", UNCATEGORIZED_NAME),
        "uploadedAt": record.get("uploadedAt") or metadata.get("uploadedAt") or utc_now(),
        "pdfUrl": f"/api/library/pdf?id={record['id']}",
        "highlights": highlights if isinstance(highlights, list) else [],
        "keywords": normalize_keywords(metadata.get("keywords", [])),
        "threeLineSummary": metadata.get("threeLineSummary", {}),
        "methodOverview": str(metadata.get("methodOverview", "")).strip(),
        "methodSections": normalize_method_sections(metadata.get("methodSections", [])),
        "methodConclusion": str(metadata.get("methodConclusion", "")).strip(),
        "basicInfo": normalize_basic_info(metadata.get("basicInfo", {})),
        "discussion": discussion,
        "extractedText": extracted_text,
    }


def create_category(parent_id, name):
    db = load_library_db()
    parent_id = str(parent_id or "")
    if parent_id and parent_id not in db["categories"]:
        raise ValueError("Invalid parent category.")
    child_name = clean_folder_name(name)
    if not child_name:
        raise ValueError("Category name is required.")
    category_id = f"{parent_id}/{child_name}".strip("/")
    if category_id in db["categories"]:
        raise FileExistsError("Category already exists.")
    siblings = [item for item in db["categories"].values() if item.get("parentId", "") == parent_id]
    db["categories"][category_id] = {
        "id": category_id,
        "name": child_name,
        "parentId": parent_id,
        "locked": False,
        "sortOrder": next_sort_order(siblings),
    }
    save_library_db(db)
    return category_id


def category_descendants(db, category_id):
    found = [category_id]
    changed = True
    while changed:
        changed = False
        for item in db["categories"].values():
            if item["id"] not in found and item.get("parentId") in found:
                found.append(item["id"])
                changed = True
    return found


def delete_category(category_id):
    db = load_library_db()
    category_id = str(category_id or "")
    category = db["categories"].get(category_id)
    if not category:
        raise FileNotFoundError("Category not found.")
    if category.get("locked"):
        raise PermissionError("This category cannot be deleted.")
    deleted_ids = category_descendants(db, category_id)
    for paper in db["papers"].values():
        if paper.get("categoryId") in deleted_ids:
            paper["categoryId"] = UNCATEGORIZED_ID
            metadata_path = paper_dir_from_record(paper) / "metadata.json"
            metadata = read_json(metadata_path, default_metadata(paper.get("title", paper["id"]), UNCATEGORIZED_ID))
            metadata["category"] = UNCATEGORIZED_ID
            write_json(metadata_path, metadata)
    for item_id in sorted(deleted_ids, key=len, reverse=True):
        db["categories"].pop(item_id, None)
    save_library_db(db)


def rename_category(category_id, name):
    db = load_library_db()
    category_id = str(category_id or "")
    category = db["categories"].get(category_id)
    if not category:
        raise FileNotFoundError("Category not found.")
    if category.get("locked"):
        raise PermissionError("This category cannot be renamed.")

    new_name = clean_folder_name(name)
    if not new_name:
        raise ValueError("Category name is required.")

    parent_id = category.get("parentId", "")
    new_id = f"{parent_id}/{new_name}".strip("/")
    if new_id != category_id and new_id in db["categories"]:
        raise FileExistsError("Category already exists.")

    descendants = category_descendants(db, category_id)
    id_map = {}
    for old_id in sorted(descendants, key=len):
        suffix = old_id[len(category_id):].lstrip("/")
        id_map[old_id] = f"{new_id}/{suffix}".strip("/") if suffix else new_id

    for old_id in sorted(descendants, key=len, reverse=True):
        record = db["categories"].pop(old_id)
        next_id = id_map[old_id]
        record["id"] = next_id
        if old_id == category_id:
            record["name"] = new_name
            record["parentId"] = parent_id
        elif record.get("parentId") in id_map:
            record["parentId"] = id_map[record["parentId"]]
        db["categories"][next_id] = record

    for paper in db["papers"].values():
        old_category = paper.get("categoryId")
        if old_category in id_map:
            paper["categoryId"] = id_map[old_category]
            metadata_path = paper_dir_from_record(paper) / "metadata.json"
            metadata = read_json(metadata_path, default_metadata(paper.get("title", paper["id"]), paper["categoryId"]))
            metadata["category"] = paper["categoryId"]
            write_json(metadata_path, metadata)

    save_library_db(db)
    return new_id


def move_paper(paper_id, category_id):
    db = load_library_db()
    record = db["papers"].get(str(paper_id))
    if not record:
        raise FileNotFoundError("Paper not found.")
    target_category = ensure_category_path(db, category_id)
    record["categoryId"] = target_category
    metadata_path = paper_dir_from_record(record) / "metadata.json"
    metadata = read_json(metadata_path, default_metadata(record.get("title", paper_id), target_category))
    metadata["category"] = target_category
    write_json(metadata_path, metadata)
    save_library_db(db)
    return read_paper(paper_id, db)


def reorder_category_siblings(parent_id, ordered_ids):
    db = load_library_db()
    parent_id = str(parent_id or "")
    if parent_id and parent_id not in db["categories"]:
        raise ValueError("Invalid parent category.")
    siblings = [item for item in db["categories"].values() if item.get("parentId", "") == parent_id]
    current_ids = [item["id"] for item in siblings]
    requested_ids = [str(item) for item in ordered_ids] if isinstance(ordered_ids, list) else []
    if len(requested_ids) != len(current_ids) or set(requested_ids) != set(current_ids):
        raise ValueError("Category order does not match the current sibling categories.")
    for index, category_id in enumerate(requested_ids):
        db["categories"][category_id]["sortOrder"] = index
    save_library_db(db)


def reorder_category_papers(category_id, ordered_ids):
    db = load_library_db()
    category_id = str(category_id or UNCATEGORIZED_ID)
    if category_id not in db["categories"]:
        raise ValueError("Invalid category.")
    siblings = [item for item in db["papers"].values() if item.get("categoryId") == category_id]
    current_ids = [item["id"] for item in siblings]
    requested_ids = [str(item) for item in ordered_ids] if isinstance(ordered_ids, list) else []
    if len(requested_ids) != len(current_ids) or set(requested_ids) != set(current_ids):
        raise ValueError("Paper order does not match the current category.")
    for index, paper_id in enumerate(requested_ids):
        db["papers"][paper_id]["sortOrder"] = index
    save_library_db(db)


def delete_paper(paper_id):
    db = load_library_db()
    record = db["papers"].pop(str(paper_id), None)
    if not record:
        raise FileNotFoundError("Paper not found.")
    paper_dir = paper_dir_from_record(record)
    if paper_dir.exists():
        shutil.rmtree(paper_dir)
    save_library_db(db)


def reveal_paper_in_folder(paper_id):
    db = load_library_db()
    record = db["papers"].get(str(paper_id))
    if not record:
        raise FileNotFoundError("Paper not found.")
    pdf_path = paper_dir_from_record(record) / "paper.pdf"
    if not pdf_path.exists():
        raise FileNotFoundError("PDF not found.")
    if os.name != "nt":
        raise OSError("Showing files in a folder is only supported on Windows.")
    subprocess.Popen(["explorer.exe", "/select,", str(pdf_path)], close_fds=True)


def add_paper_to_db(title, category, pdf_file):
    db = load_library_db()
    category_id = ensure_category_path(db, category)
    paper_id = make_paper_id(f"{title}-{category_id}")
    paper_dir = PAPER_STORAGE_DIR / paper_id
    while paper_dir.exists() or paper_id in db["papers"]:
        paper_id = make_paper_id(f"{paper_id}-retry")
        paper_dir = PAPER_STORAGE_DIR / paper_id
    paper_dir.mkdir(parents=True, exist_ok=True)
    with (paper_dir / "paper.pdf").open("wb") as output:
        shutil.copyfileobj(pdf_file, output)
    metadata = default_metadata(title, category_id)
    write_json(paper_dir / "metadata.json", metadata)
    write_json(paper_dir / "highlights.json", [])
    write_json(paper_dir / "discussion.json", default_discussion_payload())
    update_paper_sync_hash(paper_dir)
    db["papers"][paper_id] = {
        "id": paper_id,
        "title": title,
        "categoryId": category_id,
        "folder": f"papers/{paper_id}",
        "uploadedAt": metadata["uploadedAt"],
        "sortOrder": next_sort_order([item for item in db["papers"].values() if item.get("categoryId") == category_id]),
    }
    save_library_db(db)
    return read_paper(paper_id, db)


class PaperReaderHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Paper-Lantern", "1")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Expose-Headers", "X-Paper-Lantern")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_POST(self):
        request_path = urlparse(self.path).path
        if request_path == "/api/library/upload":
            self._handle_library_upload()
            return
        if request_path == "/api/library/arxiv":
            self._handle_library_arxiv_upload()
            return
        if request_path == "/api/library/paper":
            self._handle_library_save()
            return
        if request_path == "/api/library/category":
            self._handle_library_category()
            return
        if request_path == "/api/cloud-sync":
            self._handle_cloud_sync()
            return
        if request_path == "/api/cloud-sync/config":
            self._handle_cloud_sync_config()
            return
        if request_path == "/api/settings":
            self._handle_settings_save()
            return

        if request_path not in {"/api/summarize", "/api/overview", "/api/translate", "/api/translate-context", "/api/explain", "/api/discuss"}:
            self.send_error(404, "Not found")
            return

        task_name = {
            "/api/summarize": "summary",
            "/api/overview": "summary",
            "/api/translate": "translate",
            "/api/translate-context": "translate",
            "/api/explain": "explain",
            "/api/discuss": "discuss",
        }[request_path]
        api_key, model, chat_completions_url, extra_params = get_ai_config(task_name)
        if not api_key or api_key in {"sk-your-api-key", "sk-your-real-api-key"}:
            self._send_json(500, {"error": "Missing AI API key. Open Settings and save your API key."})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, json.JSONDecodeError):
            self._send_json(400, {"error": "Invalid JSON request."})
            return

        if request_path in {"/api/translate", "/api/translate-context"}:
            selected_text = str(payload.get("text", "")).strip()
            if not selected_text:
                self._send_json(400, {"error": "Please select text to translate."})
                return
            try:
                if request_path == "/api/translate-context":
                    translation = translate_with_context(
                        api_key,
                        model,
                        chat_completions_url,
                        selected_text,
                        paper_summary=payload.get("summary", {}),
                        surrounding_context=payload.get("surroundingContext", ""),
                        extra_params=extra_params,
                    )
                else:
                    translation = translate_text(api_key, model, chat_completions_url, selected_text, extra_params)
                self._send_json(200, {"translation": translation})
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode("utf-8", errors="replace")
                self._send_json(exc.code, {"error": "AI API request failed.", "detail": detail})
            except Exception as exc:
                self._send_json(500, {"error": "Failed to translate text.", "detail": str(exc)})
            return

        if request_path == "/api/explain":
            selected_text = str(payload.get("selectedText", "")).strip()
            paper_text = str(payload.get("paperText", "")).strip()
            if not selected_text:
                self._send_json(400, {"error": "Please select text to explain."})
                return
            if len(paper_text) < 80:
                self._send_json(400, {"error": "Please provide at least 80 characters of paper text."})
                return
            try:
                explanation = explain_selected_text(
                    api_key,
                    model,
                    chat_completions_url,
                    paper_text,
                    selected_text,
                    payload.get("summary", {}),
                    extra_params,
                )
                self._send_json(200, {"explanation": explanation})
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode("utf-8", errors="replace")
                self._send_json(exc.code, {"error": "AI API request failed.", "detail": detail})
            except Exception as exc:
                self._send_json(500, {"error": "Failed to explain selected text.", "detail": str(exc)})
            return

        if request_path == "/api/discuss":
            paper_text = str(payload.get("paperText", "")).strip()
            question = str(payload.get("question", "")).strip()
            if len(paper_text) < 80:
                self._send_json(400, {"error": "Please provide at least 80 characters of paper text."})
                return
            if not question:
                self._send_json(400, {"error": "Please enter a discussion question."})
                return
            try:
                answer = discuss_paper(
                    api_key,
                    model,
                    chat_completions_url,
                    paper_text,
                    question,
                    payload.get("summary", {}),
                    payload.get("history", []),
                    extra_params,
                )
                self._send_json(200, {"answer": answer})
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode("utf-8", errors="replace")
                self._send_json(exc.code, {"error": "AI API request failed.", "detail": detail})
            except Exception as exc:
                self._send_json(500, {"error": "Failed to discuss paper.", "detail": str(exc)})
            return

        if request_path == "/api/overview":
            paper_text = str(payload.get("paperText", "")).strip()
            if len(paper_text) < 80:
                self._send_json(400, {"error": "Please provide at least 80 characters of paper text."})
                return
            try:
                overview, raw = extract_paper_overview(api_key, model, chat_completions_url, paper_text, extra_params)
                self._send_json(200, {"overviewInfo": overview, "raw": raw})
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode("utf-8", errors="replace")
                self._send_json(exc.code, {"error": "AI API request failed.", "detail": detail})
            except Exception as exc:
                self._send_json(500, {"error": "Failed to extract paper overview.", "detail": str(exc)})
            return

        try:
            paper_text = str(payload.get("paperText", "")).strip()
            if len(paper_text) < 80:
                self._send_json(400, {"error": "Please provide at least 80 characters of paper text."})
                return
            summary, raw = summarize_paper(api_key, model, chat_completions_url, paper_text, extra_params)
            self._send_json(200, {"summary": summary, "raw": raw})
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            self._send_json(exc.code, {"error": "AI API request failed.", "detail": detail})
        except Exception as exc:
            self._send_json(500, {"error": "Failed to summarize paper.", "detail": str(exc)})

    def do_GET(self):
        request_path = urlparse(self.path).path
        if request_path == "/api/library":
            self._send_json(200, {"root": str(LIBRARY_DIR), "tree": read_library_tree()})
            return
        if request_path == "/api/cloud-sync":
            self._send_json(200, public_status(get_cloud_sync_config()))
            return
        if request_path == "/api/settings":
            self._send_json(200, public_config(load_config(BASE_DIR)))
            return
        if request_path == "/api/library/paper":
            paper_id = parse_query_value(self.path, "id")
            paper = read_paper(paper_id, include_extracted_text=True)
            if not paper:
                self._send_json(404, {"error": "Paper not found."})
                return
            self._send_json(200, {"paper": paper})
            return
        if request_path == "/api/library/pdf":
            paper_id = parse_query_value(self.path, "id")
            db = load_library_db()
            record = db["papers"].get(paper_id)
            paper_dir = paper_dir_from_record(record) if record else None
            pdf_path = paper_dir / "paper.pdf" if paper_dir else None
            if not pdf_path or not pdf_path.exists():
                self.send_error(404, "PDF not found")
                return
            data = pdf_path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "application/pdf")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if request_path == "/api/library/export":
            paper_id = parse_query_value(self.path, "id")
            db = load_library_db()
            record = db["papers"].get(paper_id)
            paper_dir = paper_dir_from_record(record) if record else None
            pdf_path = paper_dir / "paper.pdf" if paper_dir else None
            if not pdf_path or not pdf_path.exists():
                self.send_error(404, "PDF not found")
                return
            try:
                title = record.get("title") or paper_id or "paper"
                highlights = read_json(paper_dir / "highlights.json", [])
                data = export_annotated_pdf(pdf_path, highlights)
            except Exception as exc:
                self._send_json(500, {"error": "Failed to export PDF.", "detail": str(exc)})
                return
            filename = clean_export_filename(f"{title}-export.pdf")
            self.send_response(200)
            self.send_header("Content-Type", "application/pdf")
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return

        if request_path.endswith((".js", ".mjs")):
            file_path = Path(self.translate_path(request_path))
            if not file_path.exists() or not file_path.is_file():
                self.send_error(404, "File not found")
                return

            data = file_path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/javascript")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return

        super().do_GET()

    def _send_json(self, status, body):
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _handle_library_upload(self):
        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": self.headers.get("Content-Type", ""),
                "CONTENT_LENGTH": self.headers.get("Content-Length", "0"),
            },
        )
        pdf_item = form["pdf"] if "pdf" in form else None
        if pdf_item is None or not getattr(pdf_item, "filename", ""):
            self._send_json(400, {"error": "Please upload a PDF file."})
            return

        title = clean_folder_name(field_value(form, "title") or Path(pdf_item.filename).stem)
        category = field_value(form, "category") or UNCATEGORIZED_NAME
        paper = add_paper_to_db(title, category, pdf_item.file)
        sync = maybe_auto_sync_library()
        self._send_json(200, {"paper": paper, "tree": read_library_tree(), "sync": sync})

    def _handle_library_arxiv_upload(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, json.JSONDecodeError):
            self._send_json(400, {"error": "Invalid JSON request."})
            return

        arxiv_id = normalize_arxiv_id(payload.get("arxivId", ""))
        if not arxiv_id:
            self._send_json(400, {"error": "Please provide a valid arXiv ID or URL."})
            return

        category = str(payload.get("category", "")).strip() or UNCATEGORIZED_NAME
        title = clean_folder_name(payload.get("title", "") or f"arXiv {arxiv_id}")
        try:
            data = download_arxiv_pdf(arxiv_id)
            with tempfile.TemporaryFile() as pdf_file:
                pdf_file.write(data)
                pdf_file.seek(0)
                paper = add_paper_to_db(title, category, pdf_file)
            sync = maybe_auto_sync_library()
            self._send_json(200, {"paper": paper, "tree": read_library_tree(), "sync": sync})
        except urllib.error.HTTPError as exc:
            self._send_json(exc.code, {"error": "Failed to download arXiv PDF.", "detail": str(exc)})
        except (urllib.error.URLError, TimeoutError, ValueError) as exc:
            self._send_json(400, {"error": "Failed to download arXiv PDF.", "detail": str(exc)})

    def _handle_library_save(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, json.JSONDecodeError):
            self._send_json(400, {"error": "Invalid JSON request."})
            return

        action = str(payload.get("action", "save")).strip() or "save"
        if action == "reveal":
            try:
                reveal_paper_in_folder(str(payload.get("id", "")))
                self._send_json(200, {"revealed": True})
            except FileNotFoundError as exc:
                self._send_json(404, {"error": str(exc)})
            except OSError as exc:
                self._send_json(400, {"error": str(exc)})
            return
        if action == "move":
            try:
                paper = move_paper(str(payload.get("id", "")), str(payload.get("category", "")))
                sync = maybe_auto_sync_library()
                self._send_json(200, {"paper": paper, "tree": read_library_tree(), "sync": sync})
            except FileNotFoundError as exc:
                self._send_json(404, {"error": str(exc)})
            except (OSError, ValueError) as exc:
                self._send_json(400, {"error": str(exc)})
            return
        if action == "delete":
            try:
                delete_paper(str(payload.get("id", "")))
                sync = maybe_auto_sync_library()
                self._send_json(200, {"tree": read_library_tree(), "sync": sync})
            except FileNotFoundError as exc:
                self._send_json(404, {"error": str(exc)})
            except OSError as exc:
                self._send_json(400, {"error": str(exc)})
            return
        if action == "reorder":
            try:
                reorder_category_papers(str(payload.get("category", "")), payload.get("orderedIds", []))
                sync = maybe_auto_sync_library()
                self._send_json(200, {"tree": read_library_tree(), "sync": sync})
            except ValueError as exc:
                self._send_json(400, {"error": str(exc)})
            return

        db = load_library_db()
        record = db["papers"].get(str(payload.get("id", "")))
        if not record:
            self._send_json(404, {"error": "Paper not found."})
            return
        paper_dir = paper_dir_from_record(record)

        metadata = read_json(paper_dir / "metadata.json", default_metadata(record.get("title", record["id"]), record.get("categoryId", UNCATEGORIZED_ID)))
        sync_relevant_changed = False
        if isinstance(payload.get("summary"), dict):
            summary = payload["summary"]
            metadata["title"] = summary.get("paperTitle") or metadata.get("title") or record.get("title") or record["id"]
            record["title"] = metadata["title"]
            metadata["keywords"] = normalize_keywords(summary.get("keywords", []))
            metadata["threeLineSummary"] = summary.get("threeLineSummary", {})
            metadata["methodOverview"] = str(summary.get("methodOverview", "")).strip()
            metadata["methodSections"] = normalize_method_sections(summary.get("methodSections", []))
            metadata["methodConclusion"] = str(summary.get("methodConclusion", "")).strip()
            metadata["basicInfo"] = normalize_basic_info(summary.get("basicInfo", metadata.get("basicInfo", {})))
            sync_relevant_changed = True
        if isinstance(payload.get("overviewInfo"), dict):
            overview_info = payload["overviewInfo"]
            metadata["title"] = overview_info.get("paperTitle") or metadata.get("title") or record.get("title") or record["id"]
            record["title"] = metadata["title"]
            metadata["keywords"] = normalize_keywords(overview_info.get("keywords", metadata.get("keywords", [])))
            metadata["basicInfo"] = normalize_basic_info(overview_info.get("basicInfo", metadata.get("basicInfo", {})))
            sync_relevant_changed = True
        if isinstance(payload.get("basicInfo"), dict):
            metadata["basicInfo"] = normalize_basic_info(payload["basicInfo"])
            sync_relevant_changed = True
        if isinstance(payload.get("highlights"), list):
            write_json(paper_dir / "highlights.json", payload["highlights"])
            update_paper_sync_hash(paper_dir)
            sync_relevant_changed = True
        if isinstance(payload.get("discussion"), (list, dict)):
            write_json(paper_dir / "discussion.json", normalize_discussion_payload(payload["discussion"]))
            update_paper_sync_hash(paper_dir)
            sync_relevant_changed = True
        if isinstance(payload.get("extractedText"), str):
            extracted_text = payload["extractedText"].strip()
            if extracted_text:
                write_text_file(paper_dir / EXTRACTED_TEXT_FILE, extracted_text[:MAX_EXTRACTED_TEXT_CHARS])
        write_json(paper_dir / "metadata.json", metadata)
        save_library_db(db)
        sync = maybe_auto_sync_library() if sync_relevant_changed else None
        self._send_json(200, {"paper": read_paper(record["id"], db), "tree": read_library_tree(), "sync": sync})

    def _handle_library_category(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            action = str(payload.get("action", "")).strip()
        except (ValueError, json.JSONDecodeError):
            self._send_json(400, {"error": "Invalid JSON request."})
            return

        try:
            if action == "create":
                category_id = create_category(str(payload.get("parentId", "")), str(payload.get("name", "")))
                sync = maybe_auto_sync_library()
                self._send_json(200, {"categoryId": category_id, "tree": read_library_tree(), "sync": sync})
                return
            if action == "rename":
                category_id = rename_category(str(payload.get("id", "")), str(payload.get("name", "")))
                sync = maybe_auto_sync_library()
                self._send_json(200, {"categoryId": category_id, "tree": read_library_tree(), "sync": sync})
                return
            if action == "delete":
                delete_category(str(payload.get("id", "")))
                sync = maybe_auto_sync_library()
                self._send_json(200, {"tree": read_library_tree(), "sync": sync})
                return
            if action == "reorder":
                reorder_category_siblings(str(payload.get("parentId", "")), payload.get("orderedIds", []))
                sync = maybe_auto_sync_library()
                self._send_json(200, {"tree": read_library_tree(), "sync": sync})
                return
            self._send_json(400, {"error": "Unknown category action."})
        except FileExistsError:
            self._send_json(409, {"error": "Category already exists."})
        except FileNotFoundError as exc:
            self._send_json(404, {"error": str(exc)})
        except PermissionError as exc:
            self._send_json(403, {"error": str(exc)})
        except (OSError, ValueError) as exc:
            self._send_json(400, {"error": str(exc)})

    def _handle_cloud_sync(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            action = str(payload.get("action", "")).strip().lower()
        except (ValueError, json.JSONDecodeError):
            self._send_json(400, {"error": "Invalid JSON request."})
            return

        try:
            config = get_cloud_sync_config()
            if action in {"sync", ""}:
                result = sync_library(LIBRARY_DIR, config)
                self._send_json(200, {**result, "tree": read_library_tree()})
                return
            self._send_json(400, {"error": "Unknown cloud sync action."})
        except (OSError, RuntimeError, ValueError) as exc:
            self._send_json(400, {"error": str(exc), **public_status(get_cloud_sync_config())})

    def _handle_cloud_sync_config(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            status = save_sync_config(BASE_DIR, payload)
            self._send_json(200, status)
        except (ValueError, json.JSONDecodeError) as exc:
            self._send_json(400, {"error": str(exc)})
        except OSError as exc:
            self._send_json(500, {"error": str(exc)})

    def _handle_settings_save(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            config = save_config(BASE_DIR, payload)
            self._send_json(200, {"settings": public_config(config), "sync": public_status(get_cloud_sync_config())})
        except (ValueError, json.JSONDecodeError) as exc:
            self._send_json(400, {"error": str(exc)})
        except OSError as exc:
            self._send_json(500, {"error": str(exc)})


def summarize_paper(api_key, model, chat_completions_url, paper_text, extra_params=None):
    paper_excerpt = paper_text[:MAX_PAPER_CHARS]
    overview, overview_raw = extract_paper_overview(api_key, model, chat_completions_url, paper_excerpt, extra_params)
    method_points = normalize_method_points(overview.get("methodPoints", []))
    if not method_points:
        method_points = [{"title": "Core method", "description": "The method points were not clearly separated."}]

    point_details = []
    point_raws = []
    for index, point in enumerate(method_points, start=1):
        detail, detail_raw = call_chat_completions(
            api_key,
            model,
            chat_completions_url,
            build_method_point_prompt(paper_excerpt, point, index, len(method_points)),
            extra_params,
        )
        point_details.append(
            {
                "title": detail.get("title") or point["title"],
                "motivation": detail.get("motivation", ""),
                "summary": detail.get("summary", ""),
                "details": normalize_list(detail.get("details", [])),
                "formulas": normalize_list(detail.get("formulas", [])),
            }
        )
        point_raws.append(detail_raw)

    polished, polished_raw = call_chat_completions(
        api_key,
        model,
        chat_completions_url,
        build_method_polish_prompt(paper_excerpt, method_points, point_details),
        extra_params,
    )

    three_line = overview.get("threeLineSummary", {})
    method_sections = normalize_method_sections(polished.get("methodSections", []))
    method_text = polished.get("method", "") or sections_to_text(method_sections)
    summary = {
        "paperTitle": str(overview.get("paperTitle", "")).strip(),
        "keywords": normalize_keywords(overview.get("keywords", [])),
        "basicInfo": normalize_basic_info(overview.get("basicInfo", {})),
        "threeLineSummary": {
            "challenges": three_line.get("challenges", ""),
            "method": method_text,
            "conclusion": three_line.get("conclusion", ""),
        },
        "methodOverview": str(polished.get("methodOverview", "")).strip(),
        "methodSections": method_sections,
        "methodConclusion": str(polished.get("methodConclusion", "")).strip(),
    }
    raw = {
        "overview": overview_raw,
        "method_point_details": point_raws,
        "method_polish": polished_raw,
        "method_points": method_points,
        "point_details": point_details,
    }
    return summary, raw


def extract_paper_overview(api_key, model, chat_completions_url, paper_text, extra_params=None):
    paper_excerpt = paper_text[:MAX_PAPER_CHARS]
    overview, raw = call_chat_completions(
        api_key, model, chat_completions_url, build_overview_prompt(paper_excerpt), extra_params
    )
    three_line = overview.get("threeLineSummary", {})
    return (
        {
            "paperTitle": str(overview.get("paperTitle", "")).strip(),
            "keywords": normalize_keywords(overview.get("keywords", [])),
            "basicInfo": normalize_basic_info(overview.get("basicInfo", {})),
            "methodPoints": normalize_method_points(overview.get("methodPoints", [])),
            "threeLineSummary": {
                "challenges": str(three_line.get("challenges", "")).strip(),
                "conclusion": str(three_line.get("conclusion", "")).strip(),
            },
        },
        raw,
    )


def translate_text(api_key, model, chat_completions_url, text, extra_params=None):
    source_text = text[:MAX_TRANSLATE_CHARS]
    upstream_payload = {
        "model": model,
        "temperature": 0.1,
        "messages": [
            {
                "role": "system",
                "content": render_prompt("translate_system.txt"),
            },
            {"role": "user", "content": source_text},
        ],
    }
    upstream_payload.update(extra_params or {})

    raw = post_chat_completion(api_key, chat_completions_url, upstream_payload, timeout=60)
    return raw["choices"][0]["message"]["content"].strip()


def translate_with_context(
    api_key,
    model,
    chat_completions_url,
    text,
    paper_summary=None,
    surrounding_context="",
    extra_params=None,
):
    source_text = text[:MAX_TRANSLATE_CHARS]
    summary_context = json.dumps(paper_summary if isinstance(paper_summary, dict) else {}, ensure_ascii=False)
    summary_context = summary_context[:MAX_TRANSLATION_SUMMARY_CHARS]
    context_excerpt = str(surrounding_context or "").strip()[:MAX_TRANSLATION_CONTEXT_CHARS]
    upstream_payload = {
        "model": model,
        "temperature": 0.1,
        "messages": [
            {"role": "system", "content": render_prompt("translate_with_context_system.txt")},
            {
                "role": "user",
                "content": (
                    "Paper summary (reference only; do not translate or repeat it):\n"
                    f"{summary_context}\n\n"
                    "Surrounding source context (reference only; do not translate or repeat it):\n"
                    f"{context_excerpt}\n\n"
                    "Selected text to translate:\n"
                    f"{source_text}"
                ),
            },
        ],
    }
    upstream_payload.update(extra_params or {})

    raw = post_chat_completion(api_key, chat_completions_url, upstream_payload, timeout=60)
    return raw["choices"][0]["message"]["content"].strip()


def explain_selected_text(api_key, model, chat_completions_url, paper_text, selected_text, summary=None, extra_params=None):
    paper_excerpt = paper_text[:MAX_PAPER_CHARS]
    selected_excerpt = selected_text[:MAX_TRANSLATE_CHARS]
    summary_context = json.dumps(summary or {}, ensure_ascii=False)
    upstream_payload = {
        "model": model,
        "temperature": 0.18,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a research paper reading assistant. Use the full paper context to explain only the selected passage's role in the paper. "
                    "Do not translate the selected passage. Do not include any section except exactly '## 这段话在论文中的作用'. "
                    "Write concise but specific content suitable for a PDF comment, and do not invent claims beyond the provided paper context."
                ),
            },
            {
                "role": "user",
                "content": (
                    "Full paper context:\n"
                    f"{paper_excerpt}\n\n"
                    "Existing summary JSON:\n"
                    f"{summary_context}\n\n"
                    "Selected passage to explain:\n"
                    f"{selected_excerpt}\n\n"
                    "Output only this section:\n"
                    "## 这段话在论文中的作用\n"
                    "Explain how this passage functions in the paper's argument, method, evidence, or conclusion. Do not translate the passage."
                ),
            },
        ],
    }
    upstream_payload.update(extra_params or {})

    raw = post_chat_completion(api_key, chat_completions_url, upstream_payload, timeout=90)
    return extract_selected_role_section(raw["choices"][0]["message"]["content"].strip())


def extract_selected_role_section(text):
    content = str(text or "").strip()
    heading_pattern = r"(?m)^#{1,3}\s+这段话在论文中的作用\s*$"
    match = re.search(heading_pattern, content)
    if not match:
        content = re.sub(r"(?mis)^#{1,3}\s+段落定位与上下文\s*.*?(?=^#{1,3}\s+|\Z)", "", content).strip()
        return content
    rest = content[match.end():]
    next_heading = re.search(r"(?m)^#{1,3}\s+", rest)
    body = rest[:next_heading.start()].strip() if next_heading else rest.strip()
    return f"## 这段话在论文中的作用\n{body}".strip()


def discuss_paper(api_key, model, chat_completions_url, paper_text, question, summary=None, history=None, extra_params=None):
    paper_excerpt = paper_text[:MAX_PAPER_CHARS]
    summary_context = json.dumps(summary or {}, ensure_ascii=False)
    history_messages = build_discussion_context_messages(history)
    messages = [
        {
            "role": "system",
            "content": (
                "You are a research paper discussion assistant. Answer in the user's language, "
                "ground every claim in the provided paper context, and say when the paper does not provide enough evidence. "
                "Prefer concise, technical explanations with concrete method details."
            ),
        },
        {
            "role": "user",
            "content": (
                "Paper context:\n"
                f"{paper_excerpt}\n\n"
                "Existing AI summary JSON:\n"
                f"{summary_context}\n\n"
                "Use this context for the following discussion."
            ),
        },
        *history_messages,
        {"role": "user", "content": question},
    ]
    upstream_payload = {
        "model": model,
        "temperature": 0.18,
        "messages": messages,
    }
    upstream_payload.update(extra_params or {})

    raw = post_chat_completion(api_key, chat_completions_url, upstream_payload, timeout=90)
    return raw["choices"][0]["message"]["content"].strip()


def build_discussion_context_messages(history):
    history_messages = normalize_discussion_history(history, limit=MAX_DISCUSSION_HISTORY_ITEMS)
    if len(history_messages) <= DISCUSSION_RECENT_MESSAGE_COUNT:
        return history_messages

    earlier_messages = history_messages[:-DISCUSSION_RECENT_MESSAGE_COUNT]
    recent_messages = history_messages[-DISCUSSION_RECENT_MESSAGE_COUNT:]
    earlier_context = format_earlier_discussion_context(earlier_messages)
    if not earlier_context:
        return recent_messages

    return [
        {
            "role": "user",
            "content": (
                "Earlier discussion context, preserved for multi-turn continuity:\n"
                f"{earlier_context}\n\n"
                "Use this as background. The recent turns below are the active conversation."
            ),
        },
        *recent_messages,
    ]


def format_earlier_discussion_context(messages):
    lines = []
    total_chars = 0
    for item in messages:
        label = "User" if item["role"] == "user" else "Assistant"
        content = item["content"].strip()
        line = f"{label}: {content}"
        remaining = MAX_DISCUSSION_EARLIER_CONTEXT_CHARS - total_chars
        if remaining <= 0:
            break
        if len(line) > remaining:
            line = line[:remaining].rstrip()
        lines.append(line)
        total_chars += len(line) + 1
    return "\n".join(lines)


def call_chat_completions(api_key, model, chat_completions_url, prompt, extra_params=None):
    upstream_payload = {
        "model": model,
        "temperature": 0.12,
        "response_format": {"type": "json_object"},
        "messages": [
            {
                "role": "system",
                "content": render_prompt("summary_system.txt"),
            },
            {"role": "user", "content": prompt},
        ],
    }
    upstream_payload.update(extra_params or {})

    raw = post_chat_completion(
        api_key,
        chat_completions_url,
        upstream_payload,
        timeout=AI_SUMMARY_TIMEOUT_SECONDS,
        retry_without_response_format=True,
    )
    content = raw["choices"][0]["message"]["content"]
    return json.loads(content), raw


def post_chat_completion(api_key, chat_completions_url, payload, timeout, retry_without_response_format=False):
    try:
        return send_chat_completion(api_key, chat_completions_url, payload, timeout)
    except urllib.error.HTTPError as exc:
        if not retry_without_response_format or exc.code != 400 or "response_format" not in payload:
            raise
        fallback_payload = dict(payload)
        fallback_payload.pop("response_format", None)
        return send_chat_completion(api_key, chat_completions_url, fallback_payload, timeout)


def send_chat_completion(api_key, chat_completions_url, payload, timeout):
    request = urllib.request.Request(
        chat_completions_url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def normalize_discussion_history(history, limit=DISCUSSION_RECENT_MESSAGE_COUNT):
    if not isinstance(history, list):
        return []

    messages = []
    for item in history[-limit:]:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role", "")).strip()
        content = str(item.get("content", "")).strip()
        if role not in {"user", "assistant"} or not content:
            continue
        messages.append({"role": role, "content": content[:MAX_DISCUSSION_MESSAGE_CHARS]})
    return messages


def default_discussion_payload():
    return {"threads": []}


def make_discussion_title(messages):
    for message in messages:
        if message.get("role") == "user":
            title = " ".join(message.get("content", "").split())
            return (title[:117] + "...") if len(title) > 120 else title
    return "Discussion"


def make_discussion_thread_hash(thread):
    stable = {key: value for key, value in thread.items() if key != "hash"}
    normalized = json.dumps(stable, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def normalize_discussion_payload(discussion):
    if isinstance(discussion, list):
        messages = normalize_discussion_history(discussion, limit=200)
        if not messages:
            return default_discussion_payload()
        thread = {
            "id": "discussion-legacy",
            "title": make_discussion_title(messages),
            "messages": messages,
            "createdAt": "",
            "updatedAt": "",
        }
        thread["hash"] = make_discussion_thread_hash(thread)
        return {
            "threads": [
                thread
            ]
        }
    if not isinstance(discussion, dict):
        return default_discussion_payload()

    threads = []
    raw_threads = discussion.get("threads", [])
    if not isinstance(raw_threads, list):
        return default_discussion_payload()

    for index, item in enumerate(raw_threads[:100]):
        if not isinstance(item, dict):
            continue
        messages = normalize_discussion_history(item.get("messages", []), limit=200)
        title = str(item.get("title", "")).strip()[:120] or "New discussion"
        thread_id = str(item.get("id", "")).strip()[:80] or f"discussion-{index}"
        created_at = str(item.get("createdAt", "")).strip()
        updated_at = str(item.get("updatedAt", "")).strip() or created_at
        if not messages and title == "New discussion":
            continue
        thread = {
            "id": thread_id,
            "title": title,
            "messages": messages,
            "createdAt": created_at,
            "updatedAt": updated_at,
        }
        thread["hash"] = make_discussion_thread_hash(thread)
        threads.append(thread)
    return {"threads": threads}


def normalize_list(items):
    if isinstance(items, str):
        return [items.strip()] if items.strip() else []
    if not isinstance(items, list):
        return []
    return [str(item).strip() for item in items if str(item).strip()]


def normalize_keywords(keywords):
    normalized = []
    for item in keywords:
        if isinstance(item, str):
            value = item.strip()
        elif isinstance(item, dict):
            value = str(item.get("term", "")).strip()
        else:
            value = str(item).strip()
        if value and value not in normalized:
            normalized.append(value)
    return normalized[:14]


def normalize_method_points(points):
    normalized = []
    for item in points:
        if isinstance(item, str):
            title = item.strip()
            description = ""
        elif isinstance(item, dict):
            title = str(item.get("title", "")).strip()
            description = str(item.get("description", "")).strip()
        else:
            continue
        if title:
            normalized.append({"title": title, "description": description})
    return normalized[:5]


def normalize_method_sections(sections):
    normalized = []
    if not isinstance(sections, list):
        return normalized
    for section in sections:
        if not isinstance(section, dict):
            continue
        title = str(section.get("title", "")).strip()
        motivation = str(section.get("motivation", "")).strip()
        summary = str(section.get("summary", "")).strip()
        bullets = normalize_list(section.get("bullets", []))
        formulas = normalize_list(section.get("formulas", []))
        if title or motivation or summary or bullets or formulas:
            normalized.append(
                {
                    "title": title or "Method point",
                    "motivation": motivation,
                    "summary": summary,
                    "bullets": bullets[:5],
                    "formulas": formulas[:4],
                }
            )
    return normalized[:5]


def normalize_basic_info(info):
    if not isinstance(info, dict):
        return {"authors": [], "venue": "", "publishedDate": "", "institutions": []}
    return {
        "authors": normalize_list(info.get("authors", []))[:30],
        "venue": str(info.get("venue", "")).strip()[:240],
        "publishedDate": str(info.get("publishedDate", info.get("publicationDate", ""))).strip()[:120],
        "institutions": normalize_list(info.get("institutions", info.get("affiliations", [])))[:20],
    }


def sections_to_text(sections):
    parts = []
    for section in sections:
        lines = [section["title"], section.get("motivation", ""), section.get("summary", "")]
        lines.extend(section.get("bullets", []))
        lines.extend(section.get("formulas", []))
        parts.append("; ".join([line for line in lines if line]))
    return "\n\n".join(parts)


def render_prompt(template_name, **values):
    template_path = PROMPT_DIR / template_name
    template = template_path.read_text(encoding="utf-8")
    return template.format(**values).strip()


def build_overview_prompt(paper_text):
    return render_prompt("overview.txt", paper_text=paper_text)


def build_method_point_prompt(paper_text, point, index, total):
    return render_prompt(
        "method_point.txt",
        paper_text=paper_text,
        point_json=json.dumps(point, ensure_ascii=False),
        index=index,
        total=total,
    )


def build_method_polish_prompt(paper_text, method_points, point_details):
    return render_prompt(
        "method_polish.txt",
        paper_text=paper_text,
        method_points_json=json.dumps(method_points, ensure_ascii=False),
        point_details_json=json.dumps(point_details, ensure_ascii=False),
    )


if __name__ == "__main__":
    mimetypes.add_type("text/javascript", ".js")
    mimetypes.add_type("text/javascript", ".mjs")
    load_env_file(LEGACY_AI_ENV_FILE)
    load_env_file(LEGACY_CLOUD_SYNC_ENV_FILE)
    if not CONFIG_FILE.exists():
        save_config(BASE_DIR, {})
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer(("127.0.0.1", port), PaperReaderHandler)
    print(f"Paper reader running at http://127.0.0.1:{port}")
    print(f"Config file: {CONFIG_FILE}")
    server.serve_forever()
