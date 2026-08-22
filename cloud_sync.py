import base64
import hashlib
import json
import os
from pathlib import Path
from datetime import datetime, timezone
import urllib.error
import urllib.parse
import urllib.request

from config_store import get_secret, load_config, public_config, save_config


MANIFEST_NAME = "paperlantern-library.json"
SYNC_INDEX_NAME = "paperlantern-sync-index.json"
REMOTE_PAPERS_DIR = "papers"
PAPER_FILES = ("paper.pdf", "metadata.json", "highlights.json", "discussion.json")
PAPER_SYNC_HASH_FILE = "sync_hash.json"
SYNCED_PAPER_FILES = ("paper.pdf", "metadata.json", "highlights.json", "discussion.json", PAPER_SYNC_HASH_FILE)
ROOT_SYNCED_FILES = (MANIFEST_NAME,)


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def get_sync_config(base_dir):
    app_config = load_config(base_dir)
    sync_config = app_config.get("sync", {})
    provider = str(sync_config.get("provider", "")).strip().lower()
    local_dir = str(sync_config.get("localDir", "")).strip()
    webdav_url = str(sync_config.get("webdavUrl", "")).strip().rstrip("/")
    username = str(sync_config.get("username", "")).strip()
    password = get_secret(app_config, "sync", "password")
    auto_push = bool(sync_config.get("autoSync", False))
    if not provider:
        provider = "webdav" if webdav_url else "local" if local_dir else ""
    return {
        "provider": provider,
        "local_dir": str(Path(local_dir).expanduser()) if local_dir else "",
        "webdav_url": webdav_url,
        "username": username,
        "password": password,
        "auto_push": auto_push,
        "state_file": Path(base_dir) / ".cache" / ".cloud_sync_state.json",
    }


def save_sync_config(base_dir, payload):
    provider = str(payload.get("provider", "")).strip().lower()
    local_dir = str(payload.get("localDir", "")).strip()
    webdav_url = str(payload.get("webdavUrl", "")).strip().rstrip("/")
    username = str(payload.get("username", "")).strip()
    password = str(payload.get("password", "")).strip()
    auto_push = bool(payload.get("autoPush"))
    if provider not in {"local", "webdav"}:
        raise ValueError("Provider must be local or webdav.")
    if provider == "local" and not local_dir:
        raise ValueError("Local sync folder is required.")
    if provider == "webdav" and not webdav_url:
        raise ValueError("WebDAV URL is required.")
    save_config(base_dir, {"sync": {"provider": provider, "localDir": local_dir, "webdavUrl": webdav_url, "username": username, "password": password, "autoSync": auto_push}})
    return public_status(get_sync_config(base_dir))


def public_status(config):
    provider = config.get("provider") or "disabled"
    configured = provider == "local" and bool(config.get("local_dir")) or provider == "webdav" and bool(config.get("webdav_url"))
    status = {
        "provider": provider,
        "configured": configured,
        "autoPush": bool(config.get("auto_push")),
        "target": describe_target(config),
    }
    status.update(read_sync_state(config))
    return status


def describe_target(config):
    if config.get("provider") == "local":
        return config.get("local_dir", "")
    if config.get("provider") == "webdav":
        return config.get("webdav_url", "")
    return ""


def sync_library(library_dir, config):
    ensure_configured(config)
    library_dir = Path(library_dir)
    local_db_path = library_dir / "library_db.json"
    local_db = normalize_db(read_json(local_db_path, new_manifest_db()))
    remote_db = read_remote_manifest(config)
    merged_db = merge_dbs(local_db, remote_db)
    write_json(local_db_path, merged_db)
    ensure_local_sync_hashes(library_dir, merged_db)

    local_index = build_local_sync_index(library_dir, merged_db)
    remote_index = read_remote_sync_index(config)
    if not remote_index.get("files"):
        remote_index = build_legacy_remote_sync_index(config, remote_db)

    plan = plan_sync_actions(local_index, remote_index)
    stats = execute_sync_plan(library_dir, config, plan)

    local_db = normalize_db(read_json(local_db_path, new_manifest_db()))
    final_db = merge_dbs(local_db, remote_db)
    write_json(local_db_path, final_db)
    ensure_local_sync_hashes(library_dir, final_db)
    final_index = build_local_sync_index(library_dir, final_db)
    write_local_sync_index(library_dir, final_index)
    write_remote_sync_index(config, final_index)

    result = {**public_status(config), "action": "sync", "syncedAt": utc_now(), "mergedPapers": len(final_db.get("papers", {})), **stats}
    write_sync_state(config, result)
    return result


def auto_sync_library(library_dir, config):
    if not config.get("auto_push"):
        return None
    try:
        return sync_library(library_dir, config)
    except Exception as exc:
        return {**public_status(config), "action": "auto-sync", "error": str(exc), "syncedAt": utc_now()}


def merge_dbs(local_db, remote_db):
    merged = new_manifest_db()
    merged["categories"] = {**remote_db.get("categories", {}), **local_db.get("categories", {})}
    merged["papers"] = {**remote_db.get("papers", {}), **local_db.get("papers", {})}
    return normalize_db(merged)


def normalize_db(db):
    if not isinstance(db, dict):
        return new_manifest_db()
    db.setdefault("version", 1)
    db.setdefault("categories", {})
    db.setdefault("papers", {})
    db["categories"].setdefault("uncategorized", {"id": "uncategorized", "name": "未分类", "parentId": "", "locked": True})
    return db


def new_manifest_db():
    return {
        "version": 1,
        "categories": {"uncategorized": {"id": "uncategorized", "name": "未分类", "parentId": "", "locked": True}},
        "papers": {},
    }


def ensure_configured(config):
    if config.get("provider") == "local" and config.get("local_dir"):
        return
    if config.get("provider") == "webdav" and config.get("webdav_url"):
        validate_webdav_url(config["webdav_url"])
        return
    raise ValueError("Cloud sync is not configured.")


def validate_webdav_url(url):
    parsed = urllib.parse.urlparse(url)
    host = parsed.netloc.lower()
    if "jianguoyun.com" in host and host != "dav.jianguoyun.com":
        raise ValueError("坚果云同步请使用 WebDAV 地址，例如 https://dav.jianguoyun.com/dav/PaperLantern，不要使用分享链接。")


def read_remote_manifest(config):
    try:
        data = remote_read(config, MANIFEST_NAME)
    except FileNotFoundError:
        return new_manifest_db()
    return normalize_db(json.loads(data.decode("utf-8")))


def write_remote_manifest(config, db):
    remote_write(config, MANIFEST_NAME, json.dumps(db, ensure_ascii=False, indent=2).encode("utf-8"))


def download_paper_files(config, paper_id, local_paper_dir):
    local_paper_dir.mkdir(parents=True, exist_ok=True)
    for name in SYNCED_PAPER_FILES:
        try:
            data = remote_read(config, f"{REMOTE_PAPERS_DIR}/{paper_id}/{name}")
        except FileNotFoundError:
            if name == "paper.pdf":
                raise
            data = default_paper_file_bytes(name)
        (local_paper_dir / name).write_bytes(data)


def upload_paper_files(config, paper_id, local_paper_dir):
    for name in SYNCED_PAPER_FILES:
        path = local_paper_dir / name
        if path.exists():
            remote_write(config, f"{REMOTE_PAPERS_DIR}/{paper_id}/{name}", path.read_bytes())


def ensure_local_sync_hashes(library_dir, db):
    for paper_id, record in db.get("papers", {}).items():
        paper_dir = Path(library_dir) / record.get("folder", f"papers/{paper_id}")
        if (paper_dir / "paper.pdf").exists():
            update_paper_sync_hash(paper_dir)


def update_paper_sync_hash(paper_dir):
    paper_dir = Path(paper_dir)
    highlights_path = paper_dir / "highlights.json"
    discussion_path = paper_dir / "discussion.json"
    highlights = normalize_highlights_with_hash(read_json(highlights_path, []))
    discussion = normalize_discussion_payload(read_json(discussion_path, {}))
    write_json(highlights_path, highlights)
    write_json(discussion_path, discussion)
    state = {
        "version": 1,
        "highlightsHash": hash_highlights_file(highlights_path),
        "discussionHash": hash_discussion_file(discussion_path),
        "updatedAt": utc_now(),
    }
    write_json(paper_dir / PAPER_SYNC_HASH_FILE, state)
    return state


def sync_hash_differs(config, paper_id, local_paper_dir):
    local_state = read_json(Path(local_paper_dir) / PAPER_SYNC_HASH_FILE, {})
    local_highlights_hash = local_state.get("highlightsHash") or hash_highlights_file(Path(local_paper_dir) / "highlights.json")
    local_discussion_hash = local_state.get("discussionHash") or hash_discussion_file(Path(local_paper_dir) / "discussion.json")
    try:
        remote_state = json.loads(remote_read(config, f"{REMOTE_PAPERS_DIR}/{paper_id}/{PAPER_SYNC_HASH_FILE}").decode("utf-8"))
        remote_highlights_hash = remote_state.get("highlightsHash", "")
        remote_discussion_hash = remote_state.get("discussionHash", "")
    except (FileNotFoundError, json.JSONDecodeError):
        remote_highlights_hash = ""
        remote_discussion_hash = ""
    if not remote_highlights_hash:
        try:
            remote_highlights_hash = hash_highlights_bytes(remote_read(config, f"{REMOTE_PAPERS_DIR}/{paper_id}/highlights.json"))
        except FileNotFoundError:
            remote_highlights_hash = ""
    if not remote_discussion_hash:
        try:
            remote_discussion_hash = hash_discussion_bytes(remote_read(config, f"{REMOTE_PAPERS_DIR}/{paper_id}/discussion.json"))
        except FileNotFoundError:
            remote_discussion_hash = ""
    highlights_changed = bool(local_highlights_hash or remote_highlights_hash) and local_highlights_hash != remote_highlights_hash
    discussion_changed = bool(local_discussion_hash or remote_discussion_hash) and local_discussion_hash != remote_discussion_hash
    return highlights_changed or discussion_changed


def merge_paper_discussion_files(config, paper_id, local_paper_dir):
    local_paper_dir = Path(local_paper_dir)
    changed = {"highlights": False, "discussion": False}
    local_highlights = read_json(local_paper_dir / "highlights.json", [])
    try:
        remote_highlights = json.loads(remote_read(config, f"{REMOTE_PAPERS_DIR}/{paper_id}/highlights.json").decode("utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        remote_highlights = []
    merged = merge_highlight_lists(local_highlights, remote_highlights)
    write_json(local_paper_dir / "highlights.json", merged)
    changed["highlights"] = hash_highlights_bytes(json.dumps(local_highlights, ensure_ascii=False).encode("utf-8")) != hash_highlights_bytes(json.dumps(merged, ensure_ascii=False).encode("utf-8"))

    local_discussion = read_json(local_paper_dir / "discussion.json", {})
    try:
        remote_discussion = json.loads(remote_read(config, f"{REMOTE_PAPERS_DIR}/{paper_id}/discussion.json").decode("utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        remote_discussion = {}
    merged_discussion = merge_discussion_payloads(local_discussion, remote_discussion)
    write_json(local_paper_dir / "discussion.json", merged_discussion)
    changed["discussion"] = hash_discussion_bytes(json.dumps(local_discussion, ensure_ascii=False).encode("utf-8")) != hash_discussion_bytes(json.dumps(merged_discussion, ensure_ascii=False).encode("utf-8"))
    update_paper_sync_hash(local_paper_dir)
    return changed


def merge_highlight_lists(*highlight_lists):
    merged = []
    seen = set()
    for highlights in highlight_lists:
        if not isinstance(highlights, list):
            continue
        for highlight in highlights:
            if isinstance(highlight, dict):
                highlight = normalize_highlight_hash(highlight)
                key = highlight["hash"]
            else:
                key = hashlib.sha256(str(highlight).encode("utf-8")).hexdigest()
            if key in seen:
                continue
            seen.add(key)
            merged.append(highlight)
    return merged


def normalize_highlights_with_hash(highlights):
    if not isinstance(highlights, list):
        return []
    return [normalize_highlight_hash(highlight) for highlight in highlights if isinstance(highlight, dict)]


def normalize_highlight_hash(highlight):
    normalized = dict(highlight)
    normalized["hash"] = normalized.get("hash") or make_highlight_hash(normalized)
    return normalized


def make_highlight_hash(highlight):
    stable = {key: value for key, value in highlight.items() if key != "hash"}
    normalized = json.dumps(stable, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def hash_highlights_file(path):
    return hash_highlights_bytes(Path(path).read_bytes() if Path(path).exists() else b"[]")


def hash_highlights_bytes(data):
    try:
        value = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        value = []
    normalized_value = normalize_highlights_with_hash(value if isinstance(value, list) else [])
    normalized = json.dumps(normalized_value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def normalize_discussion_payload(discussion):
    if isinstance(discussion, list):
        messages = normalize_discussion_messages(discussion)
        if not messages:
            return {"threads": []}
        thread = {
            "id": "discussion-legacy",
            "title": make_discussion_title(messages),
            "messages": messages,
            "createdAt": "",
            "updatedAt": "",
        }
        thread["hash"] = make_discussion_thread_hash(thread)
        return {"threads": [thread]}
    if not isinstance(discussion, dict):
        return {"threads": []}

    threads = []
    raw_threads = discussion.get("threads", [])
    if not isinstance(raw_threads, list):
        return {"threads": []}
    for index, item in enumerate(raw_threads[:100]):
        if not isinstance(item, dict):
            continue
        thread = {
            "id": str(item.get("id", "")).strip()[:80] or f"discussion-{index}",
            "title": str(item.get("title", "")).strip()[:120] or "New discussion",
            "messages": normalize_discussion_messages(item.get("messages", [])),
            "createdAt": str(item.get("createdAt", "")).strip(),
            "updatedAt": str(item.get("updatedAt", "")).strip() or str(item.get("createdAt", "")).strip(),
        }
        if not thread["messages"] and thread["title"] == "New discussion":
            continue
        thread["hash"] = make_discussion_thread_hash(thread)
        threads.append(thread)
    return {"threads": threads}


def normalize_discussion_messages(messages):
    if not isinstance(messages, list):
        return []
    normalized = []
    for item in messages[-200:]:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role", "")).strip()
        content = str(item.get("content", "")).strip()
        if role in {"user", "assistant"} and content:
            normalized.append({"role": role, "content": content[:3000]})
    return normalized


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


def hash_discussion_file(path):
    return hash_discussion_bytes(Path(path).read_bytes() if Path(path).exists() else b'{"threads":[]}')


def hash_discussion_bytes(data):
    try:
        value = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        value = {}
    normalized_value = normalize_discussion_payload(value)
    normalized = json.dumps(normalized_value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def merge_discussion_payloads(*payloads):
    merged_by_id = {}
    for payload in payloads:
        discussion = normalize_discussion_payload(payload)
        for thread in discussion.get("threads", []):
            key = thread.get("id") or thread.get("hash")
            existing = merged_by_id.get(key)
            if not existing or thread_is_newer(thread, existing):
                if key:
                    merged_by_id[key] = thread
    threads = []
    seen_hashes = set()
    for thread in merged_by_id.values():
        thread_hash = thread.get("hash", "")
        if thread_hash and thread_hash in seen_hashes:
            continue
        if thread_hash:
            seen_hashes.add(thread_hash)
        threads.append(thread)
    threads.sort(key=lambda item: item.get("updatedAt", ""), reverse=True)
    return {"threads": threads}


def thread_is_newer(candidate, existing):
    candidate_time = str(candidate.get("updatedAt", ""))
    existing_time = str(existing.get("updatedAt", ""))
    if candidate_time != existing_time:
        return candidate_time > existing_time
    return len(candidate.get("messages", [])) >= len(existing.get("messages", []))


def default_paper_file_bytes(name):
    if name == "metadata.json" or name == PAPER_SYNC_HASH_FILE:
        return b"{}"
    if name == "discussion.json":
        return b'{"threads":[]}'
    return b"[]"


def remote_read(config, relative_path):
    if config.get("provider") == "local":
        path = safe_local_path(config["local_dir"], relative_path)
        if not path.exists():
            raise FileNotFoundError(str(path))
        return path.read_bytes()
    if config.get("provider") == "webdav":
        try:
            return webdav_request(config, "GET", relative_path)
        except RuntimeError as exc:
            if "HTTP 401" in str(exc):
                raise ValueError("WebDAV authentication failed. 请检查账号和应用密码；坚果云需要使用第三方应用密码，不是登录密码。") from exc
            if any(code in str(exc) for code in ("HTTP 404", "HTTP 405", "HTTP 501")):
                raise FileNotFoundError(relative_path) from exc
            raise
    raise ValueError("Unsupported cloud sync provider.")


def remote_write(config, relative_path, data):
    if config.get("provider") == "local":
        path = safe_local_path(config["local_dir"], relative_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return
    if config.get("provider") == "webdav":
        ensure_webdav_dirs(config, Path(relative_path).parent)
        try:
            webdav_request(config, "PUT", relative_path, data)
        except RuntimeError as exc:
            if "HTTP 401" in str(exc):
                raise ValueError("WebDAV authentication failed. 请检查账号和应用密码；坚果云需要使用第三方应用密码，不是登录密码。") from exc
            raise
        return
    raise ValueError("Unsupported cloud sync provider.")


def safe_local_path(root, relative_path):
    root_path = Path(root).expanduser().resolve()
    candidate = (root_path / relative_path).resolve()
    try:
        candidate.relative_to(root_path)
    except ValueError as exc:
        raise ValueError("Invalid remote path.") from exc
    return candidate


def ensure_webdav_dirs(config, relative_dir):
    current = Path()
    for part in [part for part in relative_dir.parts if part not in {"", "."}]:
        current = current / part
        try:
            webdav_request(config, "MKCOL", str(current).replace("\\", "/"))
        except RuntimeError as exc:
            if "HTTP 401" in str(exc):
                raise ValueError("WebDAV authentication failed. 请检查账号和应用密码；坚果云需要使用第三方应用密码，不是登录密码。") from exc
            if not any(code in str(exc) for code in ("HTTP 405", "HTTP 409", "HTTP 501")):
                raise


def webdav_request(config, method, relative_path, data=None):
    encoded_path = "/".join(urllib.parse.quote(part) for part in str(relative_path).replace("\\", "/").split("/") if part)
    url = f"{config['webdav_url']}/{encoded_path}" if encoded_path else config["webdav_url"]
    headers = {"User-Agent": "PaperLantern/1.0"}
    if config.get("username") or config.get("password"):
        token = base64.b64encode(f"{config.get('username')}:{config.get('password')}".encode("utf-8")).decode("ascii")
        headers["Authorization"] = f"Basic {token}"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"WebDAV {method} failed: HTTP {exc.code} {detail}") from exc


def read_json(path, fallback):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return fallback


def write_json(path, data):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def write_sync_state(config, state):
    state_file = config.get("state_file")
    if state_file:
        Path(state_file).parent.mkdir(parents=True, exist_ok=True)
        Path(state_file).write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def read_sync_state(config):
    state_file = config.get("state_file")
    if not state_file or not Path(state_file).exists():
        return {}
    try:
        data = json.loads(Path(state_file).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return {key: data[key] for key in ("action", "syncedAt", "downloaded", "uploaded", "highlightsMerged", "mergedPapers") if key in data}
