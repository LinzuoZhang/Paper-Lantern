from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import cgi
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import re
import shutil
import tempfile
from datetime import datetime, timezone
import urllib.error
import urllib.request
from urllib.parse import urlparse


BASE_DIR = Path(__file__).resolve().parent
DEEPSEEK_URL = "https://api.deepseek.com/chat/completions"
ENV_FILE = BASE_DIR / ".env" / "deepseek.env"
PROMPT_DIR = BASE_DIR / "prompts" / "deepseek"
MAX_PAPER_CHARS = 30000
MAX_TRANSLATE_CHARS = 4000
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
        headers={"User-Agent": "OpenMoonlight/1.0"},
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        content_type = response.headers.get("Content-Type", "")
        data = response.read()
    if b"%PDF" not in data[:1024] and "pdf" not in content_type.lower():
        raise ValueError("arXiv did not return a PDF.")
    return data


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
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


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
    save_library_db(db)
    return db


def save_library_db(db):
    LIBRARY_DIR.mkdir(parents=True, exist_ok=True)
    write_json(DB_FILE, db)


def ensure_uncategorized(db):
    db.setdefault("categories", {})
    db.setdefault("papers", {})
    db["categories"][UNCATEGORIZED_ID] = {
        "id": UNCATEGORIZED_ID,
        "name": UNCATEGORIZED_NAME,
        "parentId": "",
        "locked": True,
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
            db["categories"][current_id] = {"id": current_id, "name": part, "parentId": parent_id, "locked": False}
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
        for child in sorted(db["categories"].values(), key=lambda item: item["name"].lower())
        if child.get("parentId", "") == category_id
    ]
    papers = [
        read_paper(paper_id, db)
        for paper_id, paper in sorted(db["papers"].items(), key=lambda item: item[1].get("uploadedAt", ""), reverse=True)
        if paper.get("categoryId") == category_id
    ]
    papers = [paper for paper in papers if paper]
    return {"id": category_id, "name": name, "locked": locked, "folders": folders, "papers": papers}


def read_paper(paper_id, db=None):
    db = db or load_library_db()
    record = db["papers"].get(str(paper_id))
    if not record:
        return None
    paper_dir = paper_dir_from_record(record)
    if not paper_dir.exists():
        return None
    metadata = read_json(paper_dir / "metadata.json", default_metadata(record.get("title", paper_id), record.get("categoryId", UNCATEGORIZED_ID)))
    highlights = read_json(paper_dir / "highlights.json", [])
    discussion = normalize_discussion_history(read_json(paper_dir / "discussion.json", []), limit=200)
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
        "discussion": discussion,
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
    db["categories"][category_id] = {"id": category_id, "name": child_name, "parentId": parent_id, "locked": False}
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


def delete_paper(paper_id):
    db = load_library_db()
    record = db["papers"].pop(str(paper_id), None)
    if not record:
        raise FileNotFoundError("Paper not found.")
    paper_dir = paper_dir_from_record(record)
    if paper_dir.exists():
        shutil.rmtree(paper_dir)
    save_library_db(db)


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
    write_json(paper_dir / "discussion.json", [])
    db["papers"][paper_id] = {
        "id": paper_id,
        "title": title,
        "categoryId": category_id,
        "folder": f"papers/{paper_id}",
        "uploadedAt": metadata["uploadedAt"],
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
        self.send_header("Access-Control-Allow-Origin", "*")
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

        if request_path not in {"/api/summarize", "/api/translate", "/api/discuss"}:
            self.send_error(404, "Not found")
            return

        api_key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
        if not api_key or api_key == "sk-your-deepseek-api-key":
            self._send_json(500, {"error": "Missing DEEPSEEK_API_KEY. Put your real key in .env/deepseek.env."})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            model = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat").strip() or "deepseek-chat"
        except (ValueError, json.JSONDecodeError):
            self._send_json(400, {"error": "Invalid JSON request."})
            return

        if request_path == "/api/translate":
            selected_text = str(payload.get("text", "")).strip()
            if not selected_text:
                self._send_json(400, {"error": "Please select text to translate."})
                return
            try:
                translation = translate_text(api_key, model, selected_text)
                self._send_json(200, {"translation": translation})
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode("utf-8", errors="replace")
                self._send_json(exc.code, {"error": "DeepSeek API request failed.", "detail": detail})
            except Exception as exc:
                self._send_json(500, {"error": "Failed to translate text.", "detail": str(exc)})
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
                    paper_text,
                    question,
                    payload.get("summary", {}),
                    payload.get("history", []),
                )
                self._send_json(200, {"answer": answer})
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode("utf-8", errors="replace")
                self._send_json(exc.code, {"error": "DeepSeek API request failed.", "detail": detail})
            except Exception as exc:
                self._send_json(500, {"error": "Failed to discuss paper.", "detail": str(exc)})
            return

        try:
            paper_text = str(payload.get("paperText", "")).strip()
            if len(paper_text) < 80:
                self._send_json(400, {"error": "Please provide at least 80 characters of paper text."})
                return
            summary, raw = summarize_paper(api_key, model, paper_text)
            self._send_json(200, {"summary": summary, "raw": raw})
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            self._send_json(exc.code, {"error": "DeepSeek API request failed.", "detail": detail})
        except Exception as exc:
            self._send_json(500, {"error": "Failed to summarize paper.", "detail": str(exc)})

    def do_GET(self):
        request_path = urlparse(self.path).path
        if request_path == "/api/library":
            self._send_json(200, {"root": str(LIBRARY_DIR), "tree": read_library_tree()})
            return
        if request_path == "/api/library/paper":
            paper_id = parse_query_value(self.path, "id")
            paper = read_paper(paper_id)
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
        self._send_json(200, {"paper": paper, "tree": read_library_tree()})

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
            self._send_json(200, {"paper": paper, "tree": read_library_tree()})
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
        if action == "move":
            try:
                paper = move_paper(str(payload.get("id", "")), str(payload.get("category", "")))
                self._send_json(200, {"paper": paper, "tree": read_library_tree()})
            except FileNotFoundError as exc:
                self._send_json(404, {"error": str(exc)})
            except (OSError, ValueError) as exc:
                self._send_json(400, {"error": str(exc)})
            return
        if action == "delete":
            try:
                delete_paper(str(payload.get("id", "")))
                self._send_json(200, {"tree": read_library_tree()})
            except FileNotFoundError as exc:
                self._send_json(404, {"error": str(exc)})
            except OSError as exc:
                self._send_json(400, {"error": str(exc)})
            return

        db = load_library_db()
        record = db["papers"].get(str(payload.get("id", "")))
        if not record:
            self._send_json(404, {"error": "Paper not found."})
            return
        paper_dir = paper_dir_from_record(record)

        metadata = read_json(paper_dir / "metadata.json", default_metadata(record.get("title", record["id"]), record.get("categoryId", UNCATEGORIZED_ID)))
        if isinstance(payload.get("summary"), dict):
            summary = payload["summary"]
            metadata["title"] = summary.get("paperTitle") or metadata.get("title") or record.get("title") or record["id"]
            record["title"] = metadata["title"]
            metadata["keywords"] = normalize_keywords(summary.get("keywords", []))
            metadata["threeLineSummary"] = summary.get("threeLineSummary", {})
            metadata["methodOverview"] = str(summary.get("methodOverview", "")).strip()
            metadata["methodSections"] = normalize_method_sections(summary.get("methodSections", []))
            metadata["methodConclusion"] = str(summary.get("methodConclusion", "")).strip()
        if isinstance(payload.get("highlights"), list):
            write_json(paper_dir / "highlights.json", payload["highlights"])
        if isinstance(payload.get("discussion"), list):
            write_json(paper_dir / "discussion.json", normalize_discussion_history(payload["discussion"], limit=200))
        write_json(paper_dir / "metadata.json", metadata)
        save_library_db(db)
        self._send_json(200, {"paper": read_paper(record["id"], db), "tree": read_library_tree()})

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
                self._send_json(200, {"categoryId": category_id, "tree": read_library_tree()})
                return
            if action == "rename":
                category_id = rename_category(str(payload.get("id", "")), str(payload.get("name", "")))
                self._send_json(200, {"categoryId": category_id, "tree": read_library_tree()})
                return
            if action == "delete":
                delete_category(str(payload.get("id", "")))
                self._send_json(200, {"tree": read_library_tree()})
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


def summarize_paper(api_key, model, paper_text):
    paper_excerpt = paper_text[:MAX_PAPER_CHARS]
    overview, overview_raw = call_deepseek(api_key, model, build_overview_prompt(paper_excerpt))
    method_points = normalize_method_points(overview.get("methodPoints", []))
    if not method_points:
        method_points = [{"title": "Core method", "description": "The method points were not clearly separated."}]

    point_details = []
    point_raws = []
    for index, point in enumerate(method_points, start=1):
        detail, detail_raw = call_deepseek(
            api_key,
            model,
            build_method_point_prompt(paper_excerpt, point, index, len(method_points)),
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

    polished, polished_raw = call_deepseek(
        api_key,
        model,
        build_method_polish_prompt(paper_excerpt, method_points, point_details),
    )

    three_line = overview.get("threeLineSummary", {})
    method_sections = normalize_method_sections(polished.get("methodSections", []))
    method_text = polished.get("method", "") or sections_to_text(method_sections)
    summary = {
        "paperTitle": str(overview.get("paperTitle", "")).strip(),
        "keywords": normalize_keywords(overview.get("keywords", [])),
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


def translate_text(api_key, model, text):
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

    request = urllib.request.Request(
        DEEPSEEK_URL,
        data=json.dumps(upstream_payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    with urllib.request.urlopen(request, timeout=60) as response:
        raw = json.loads(response.read().decode("utf-8"))
        return raw["choices"][0]["message"]["content"].strip()


def discuss_paper(api_key, model, paper_text, question, summary=None, history=None):
    paper_excerpt = paper_text[:MAX_PAPER_CHARS]
    summary_context = json.dumps(summary or {}, ensure_ascii=False)
    history_messages = normalize_discussion_history(history)
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

    request = urllib.request.Request(
        DEEPSEEK_URL,
        data=json.dumps(upstream_payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    with urllib.request.urlopen(request, timeout=90) as response:
        raw = json.loads(response.read().decode("utf-8"))
        return raw["choices"][0]["message"]["content"].strip()


def call_deepseek(api_key, model, prompt):
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

    request = urllib.request.Request(
        DEEPSEEK_URL,
        data=json.dumps(upstream_payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    with urllib.request.urlopen(request, timeout=120) as response:
        raw = json.loads(response.read().decode("utf-8"))
        content = raw["choices"][0]["message"]["content"]
        return json.loads(content), raw


def normalize_discussion_history(history, limit=8):
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
        messages.append({"role": role, "content": content[:2000]})
    return messages


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
    load_env_file(ENV_FILE)
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer(("127.0.0.1", port), PaperReaderHandler)
    print(f"Paper reader running at http://127.0.0.1:{port}")
    print(f"DeepSeek env file: {ENV_FILE}")
    server.serve_forever()
