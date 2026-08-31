import base64
import ctypes
import json
import os
from ctypes import wintypes
from pathlib import Path
from urllib.parse import urlparse


CONFIG_FILE_NAME = "paperlantern_config.json"
AI_TASK_NAMES = ("summary", "translate", "explain", "discuss")
RESERVED_API_EXTRA_PARAM_KEYS = {"model", "messages", "stream", "response_format"}
DEFAULT_DISCUSSION_WEB_URL = "https://chatgpt.com/"


def config_path(base_dir):
    return Path(base_dir) / ".env" / CONFIG_FILE_NAME


def default_ai_task_config():
    return {
        "useDefault": True,
        "baseUrl": "",
        "model": "",
        "apiKey": "",
        "apiKeyTail": "",
        "extraParams": {},
    }


def default_config():
    return {
        "ai": {
            "baseUrl": os.environ.get("AI_API_BASE_URL", os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")),
            "model": os.environ.get("AI_MODEL", "gpt-4o-mini"),
            "apiKey": protect_secret(os.environ.get("AI_API_KEY", "")),
            "apiKeyTail": secret_tail(os.environ.get("AI_API_KEY", "")),
            "extraParams": {},
            "tasks": {name: default_ai_task_config() for name in AI_TASK_NAMES},
        },
        "sync": {
            "provider": os.environ.get("CLOUD_SYNC_PROVIDER", ""),
            "localDir": os.environ.get("CLOUD_SYNC_LOCAL_DIR", ""),
            "webdavUrl": os.environ.get("CLOUD_SYNC_WEBDAV_URL", ""),
            "username": os.environ.get("CLOUD_SYNC_WEBDAV_USERNAME", ""),
            "password": protect_secret(os.environ.get("CLOUD_SYNC_WEBDAV_PASSWORD", "")),
            "passwordTail": secret_tail(os.environ.get("CLOUD_SYNC_WEBDAV_PASSWORD", "")),
            "autoSync": os.environ.get("CLOUD_SYNC_AUTO_PUSH", "").lower() in {"1", "true", "yes", "on"},
        },
        "web": {
            "discussionUrl": os.environ.get("PAPER_LANTERN_DISCUSSION_WEB_URL", DEFAULT_DISCUSSION_WEB_URL),
        },
    }


def load_config(base_dir):
    path = config_path(base_dir)
    if not path.exists():
        return default_config()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        data = {}
    merged = default_config()
    if isinstance(data.get("ai"), dict):
        saved_ai = data["ai"]
        merged["ai"].update({key: value for key, value in saved_ai.items() if key != "tasks"})
        saved_tasks = saved_ai.get("tasks", {})
        if isinstance(saved_tasks, dict):
            for name in AI_TASK_NAMES:
                if isinstance(saved_tasks.get(name), dict):
                    merged["ai"]["tasks"][name].update(saved_tasks[name])
    if isinstance(data.get("sync"), dict):
        merged["sync"].update(data["sync"])
    if isinstance(data.get("web"), dict):
        merged["web"].update(data["web"])
    merged["web"]["discussionUrl"] = normalize_discussion_web_url(merged["web"].get("discussionUrl"))
    merged["ai"]["extraParams"] = sanitize_api_extra_params(merged["ai"].get("extraParams"))
    for name in AI_TASK_NAMES:
        merged["ai"]["tasks"][name]["extraParams"] = sanitize_api_extra_params(
            merged["ai"]["tasks"][name].get("extraParams")
        )
    return merged


def save_config(base_dir, payload):
    current = load_config(base_dir)
    if isinstance(payload.get("ai"), dict):
        ai = payload["ai"]
        current["ai"]["baseUrl"] = str(ai.get("baseUrl", current["ai"].get("baseUrl", ""))).strip()
        current["ai"]["model"] = str(ai.get("model", current["ai"].get("model", ""))).strip()
        if "extraParams" in ai:
            current["ai"]["extraParams"] = validate_api_extra_params(ai["extraParams"], "Unified API extra parameters")
        if "apiKey" in ai and str(ai.get("apiKey", "")).strip():
            api_key = str(ai.get("apiKey", "")).strip()
            current["ai"]["apiKey"] = protect_secret(api_key)
            current["ai"]["apiKeyTail"] = secret_tail(api_key)
        task_payloads = ai.get("tasks", {})
        if isinstance(task_payloads, dict):
            for name in AI_TASK_NAMES:
                task = task_payloads.get(name)
                if not isinstance(task, dict):
                    continue
                target = current["ai"]["tasks"][name]
                target["useDefault"] = bool(task.get("useDefault", target.get("useDefault", True)))
                target["baseUrl"] = str(task.get("baseUrl", target.get("baseUrl", ""))).strip()
                target["model"] = str(task.get("model", target.get("model", ""))).strip()
                if "extraParams" in task:
                    target["extraParams"] = validate_api_extra_params(
                        task["extraParams"], f"{name} API extra parameters"
                    )
                if "apiKey" in task and str(task.get("apiKey", "")).strip():
                    api_key = str(task.get("apiKey", "")).strip()
                    target["apiKey"] = protect_secret(api_key)
                    target["apiKeyTail"] = secret_tail(api_key)
    if isinstance(payload.get("sync"), dict):
        sync = payload["sync"]
        current["sync"]["provider"] = str(sync.get("provider", current["sync"].get("provider", ""))).strip().lower()
        current["sync"]["localDir"] = str(sync.get("localDir", current["sync"].get("localDir", ""))).strip()
        current["sync"]["webdavUrl"] = str(sync.get("webdavUrl", current["sync"].get("webdavUrl", ""))).strip().rstrip("/")
        current["sync"]["username"] = str(sync.get("username", current["sync"].get("username", ""))).strip()
        current["sync"]["autoSync"] = bool(sync.get("autoSync", current["sync"].get("autoSync", False)))
        if "password" in sync and str(sync.get("password", "")).strip():
            password = str(sync.get("password", "")).strip()
            current["sync"]["password"] = protect_secret(password)
            current["sync"]["passwordTail"] = secret_tail(password)
    if isinstance(payload.get("web"), dict) and "discussionUrl" in payload["web"]:
        current["web"]["discussionUrl"] = normalize_discussion_web_url(payload["web"].get("discussionUrl"))
    ensure_secret_tails(current)
    path = config_path(base_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")
    return current


def public_config(config):
    ai = config.get("ai", {})
    tasks = ai.get("tasks", {}) if isinstance(ai.get("tasks", {}), dict) else {}
    public_tasks = {}
    for name in AI_TASK_NAMES:
        task = tasks.get(name, {}) if isinstance(tasks.get(name, {}), dict) else {}
        task_key = unprotect_secret(task.get("apiKey", ""))
        public_tasks[name] = {
            "useDefault": bool(task.get("useDefault", True)),
            "baseUrl": task.get("baseUrl", ""),
            "model": task.get("model", ""),
            "hasApiKey": bool(task_key),
            "apiKeyTail": task.get("apiKeyTail", "") or secret_tail(task_key),
            "extraParams": sanitize_api_extra_params(task.get("extraParams")),
        }
    return {
        "ai": {
            "baseUrl": ai.get("baseUrl", ""),
            "model": ai.get("model", ""),
            "hasApiKey": bool(unprotect_secret(ai.get("apiKey", ""))),
            "apiKeyTail": ai.get("apiKeyTail", "") or secret_tail(unprotect_secret(ai.get("apiKey", ""))),
            "extraParams": sanitize_api_extra_params(ai.get("extraParams")),
            "tasks": public_tasks,
        },
        "sync": {
            "provider": config.get("sync", {}).get("provider", ""),
            "localDir": config.get("sync", {}).get("localDir", ""),
            "webdavUrl": config.get("sync", {}).get("webdavUrl", ""),
            "username": config.get("sync", {}).get("username", ""),
            "hasPassword": bool(unprotect_secret(config.get("sync", {}).get("password", ""))),
            "passwordTail": config.get("sync", {}).get("passwordTail", "") or secret_tail(unprotect_secret(config.get("sync", {}).get("password", ""))),
            "autoSync": bool(config.get("sync", {}).get("autoSync", False)),
        },
        "web": {
            "discussionUrl": normalize_discussion_web_url(config.get("web", {}).get("discussionUrl")),
        },
    }


def get_secret(config, section, key):
    return unprotect_secret(config.get(section, {}).get(key, ""))


def sanitize_api_extra_params(value):
    if not isinstance(value, dict):
        return {}
    return {str(key): item for key, item in value.items() if str(key) not in RESERVED_API_EXTRA_PARAM_KEYS}


def validate_api_extra_params(value, label):
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be a JSON object.")
    blocked = sorted(str(key) for key in value if str(key) in RESERVED_API_EXTRA_PARAM_KEYS)
    if blocked:
        raise ValueError(f"{label} cannot override: {', '.join(blocked)}.")
    return dict(value)


def normalize_discussion_web_url(value):
    url = str(value or "").strip() or DEFAULT_DISCUSSION_WEB_URL
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("Discussion web URL must be a complete http(s) URL.")
    return url


def secret_tail(value):
    text = str(value or "")
    return text[-4:] if text else ""


def ensure_secret_tails(config):
    ai_secret = unprotect_secret(config.get("ai", {}).get("apiKey", ""))
    sync_secret = unprotect_secret(config.get("sync", {}).get("password", ""))
    if ai_secret and not config["ai"].get("apiKeyTail"):
        config["ai"]["apiKeyTail"] = secret_tail(ai_secret)
    tasks = config.get("ai", {}).get("tasks", {})
    if isinstance(tasks, dict):
        for name in AI_TASK_NAMES:
            task = tasks.get(name)
            if not isinstance(task, dict):
                continue
            task_secret = unprotect_secret(task.get("apiKey", ""))
            if task_secret and not task.get("apiKeyTail"):
                task["apiKeyTail"] = secret_tail(task_secret)
    if sync_secret and not config["sync"].get("passwordTail"):
        config["sync"]["passwordTail"] = secret_tail(sync_secret)


def protect_secret(value):
    if not value:
        return ""
    raw = str(value).encode("utf-8")
    protected = dpapi_protect(raw)
    if protected:
        return "dpapi:" + base64.b64encode(protected).decode("ascii")
    return "b64:" + base64.b64encode(raw).decode("ascii")


def unprotect_secret(value):
    if not value:
        return ""
    text = str(value)
    try:
        if text.startswith("dpapi:"):
            raw = dpapi_unprotect(base64.b64decode(text[6:]))
            return raw.decode("utf-8") if raw else ""
        if text.startswith("b64:"):
            return base64.b64decode(text[4:]).decode("utf-8")
    except Exception:
        return ""
    return text


class DataBlob(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]


def dpapi_protect(data):
    if os.name != "nt":
        return None
    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32
    in_blob = DataBlob(len(data), ctypes.cast(ctypes.create_string_buffer(data), ctypes.POINTER(ctypes.c_char)))
    out_blob = DataBlob()
    if not crypt32.CryptProtectData(ctypes.byref(in_blob), None, None, None, None, 0, ctypes.byref(out_blob)):
        return None
    try:
        return ctypes.string_at(out_blob.pbData, out_blob.cbData)
    finally:
        kernel32.LocalFree(out_blob.pbData)


def dpapi_unprotect(data):
    if os.name != "nt":
        return None
    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32
    in_blob = DataBlob(len(data), ctypes.cast(ctypes.create_string_buffer(data), ctypes.POINTER(ctypes.c_char)))
    out_blob = DataBlob()
    if not crypt32.CryptUnprotectData(ctypes.byref(in_blob), None, None, None, None, 0, ctypes.byref(out_blob)):
        return None
    try:
        return ctypes.string_at(out_blob.pbData, out_blob.cbData)
    finally:
        kernel32.LocalFree(out_blob.pbData)
