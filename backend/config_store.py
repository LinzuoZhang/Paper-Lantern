import base64
import ctypes
import json
import os
from ctypes import wintypes
from pathlib import Path


CONFIG_FILE_NAME = "paperlantern_config.json"


def config_path(base_dir):
    return Path(base_dir) / ".env" / CONFIG_FILE_NAME


def default_config():
    return {
        "ai": {
            "baseUrl": os.environ.get("AI_API_BASE_URL", os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")),
            "model": os.environ.get("AI_MODEL", "gpt-4o-mini"),
            "thinkMode": os.environ.get("AI_THINK_MODE", "").lower() in {"1", "true", "yes", "on"},
            "apiKey": protect_secret(os.environ.get("AI_API_KEY", "")),
            "apiKeyTail": secret_tail(os.environ.get("AI_API_KEY", "")),
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
    for section in ("ai", "sync"):
        if isinstance(data.get(section), dict):
            merged[section].update(data[section])
    return merged


def save_config(base_dir, payload):
    current = load_config(base_dir)
    if isinstance(payload.get("ai"), dict):
        ai = payload["ai"]
        current["ai"]["baseUrl"] = str(ai.get("baseUrl", current["ai"].get("baseUrl", ""))).strip()
        current["ai"]["model"] = str(ai.get("model", current["ai"].get("model", ""))).strip()
        current["ai"]["thinkMode"] = bool(ai.get("thinkMode", current["ai"].get("thinkMode", False)))
        if "apiKey" in ai and str(ai.get("apiKey", "")).strip():
            api_key = str(ai.get("apiKey", "")).strip()
            current["ai"]["apiKey"] = protect_secret(api_key)
            current["ai"]["apiKeyTail"] = secret_tail(api_key)
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
    ensure_secret_tails(current)
    path = config_path(base_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")
    return current


def public_config(config):
    return {
        "ai": {
            "baseUrl": config.get("ai", {}).get("baseUrl", ""),
            "model": config.get("ai", {}).get("model", ""),
            "thinkMode": bool(config.get("ai", {}).get("thinkMode", False)),
            "hasApiKey": bool(unprotect_secret(config.get("ai", {}).get("apiKey", ""))),
            "apiKeyTail": config.get("ai", {}).get("apiKeyTail", "") or secret_tail(unprotect_secret(config.get("ai", {}).get("apiKey", ""))),
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
    }


def get_secret(config, section, key):
    return unprotect_secret(config.get(section, {}).get(key, ""))


def secret_tail(value):
    text = str(value or "")
    return text[-4:] if text else ""


def ensure_secret_tails(config):
    ai_secret = unprotect_secret(config.get("ai", {}).get("apiKey", ""))
    sync_secret = unprotect_secret(config.get("sync", {}).get("password", ""))
    if ai_secret and not config["ai"].get("apiKeyTail"):
        config["ai"]["apiKeyTail"] = secret_tail(ai_secret)
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
