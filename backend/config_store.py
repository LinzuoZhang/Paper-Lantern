import base64
import ctypes
import json
import os
import tempfile
import threading
import uuid
from ctypes import wintypes
from pathlib import Path


CONFIG_FILE_NAME = "paperlantern_config.json"
CONFIG_LOCK = threading.RLock()
AI_MODULES = (
    ("overview", "论文概览", "标题、基本信息、三行摘要与讨论引用论文的摘要"),
    ("summary", "方法解析", "方法拆解、归纳与完整总结"),
    ("keywords", "关键词解释", "论文关键词的释义与背景"),
    ("translate", "划词翻译", "论文与笔记中选中文字的翻译"),
    ("explain", "划词解释", "结合全文解释选中的术语或段落"),
    ("discuss", "AI 讨论", "论文与笔记的讨论、追问及最终回答"),
    ("research", "论文查阅", "讨论中独立查阅其他论文正文"),
    ("discussionTitle", "讨论标题", "自动生成讨论线程标题"),
    ("autoHighlight", "自动高亮", "筛选重要原文，包含 Research MCP 自动高亮"),
)


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
        config = default_config()
        normalize_ai_profiles(config)
        return config
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        data = {}
    merged = default_config()
    for section in ("ai", "sync"):
        if isinstance(data.get(section), dict):
            merged[section].update(data[section])
    normalize_ai_profiles(merged)
    return merged


AI_PROFILE_FIELDS = ("baseUrl", "model", "thinkMode", "apiKey", "apiKeyTail")


def normalize_ai_profiles(config):
    """Keep the legacy AI fields as a view of the selected profile."""
    ai = config.setdefault("ai", {})
    profiles = ai.get("profiles")
    if not isinstance(profiles, list) or not profiles:
        profiles = [{"id": "default", "name": "默认配置", **{
            key: ai.get(key, False if key == "thinkMode" else "") for key in AI_PROFILE_FIELDS
        }}]
    ai["profiles"] = profiles
    active = next((profile for profile in profiles if profile["id"] == ai.get("activeProfileId")), profiles[0])
    ai["activeProfileId"] = active["id"]
    for key in AI_PROFILE_FIELDS:
        ai[key] = active.get(key, False if key == "thinkMode" else "")
    saved_modules = ai.get("modules") if isinstance(ai.get("modules"), dict) else {}
    profile_ids = {profile["id"] for profile in profiles}
    modules = {}
    for module_id, _name, _description in AI_MODULES:
        setting = saved_modules.get(module_id, {})
        setting = setting if isinstance(setting, dict) else {}
        profile_id = setting.get("profileId", "")
        modules[module_id] = {
            "profileId": profile_id if profile_id in profile_ids else "",
            "thinkMode": bool(setting.get("thinkMode", False if module_id == "translate" else ai.get("thinkMode", False))),
        }
    ai["modules"] = modules


def update_ai_profile(profile, payload):
    for key in ("name", "baseUrl", "model"):
        if key in payload:
            profile[key] = str(payload[key] or "").strip()
    if "thinkMode" in payload:
        profile["thinkMode"] = bool(payload["thinkMode"])
    api_key = str(payload.get("apiKey") or "").strip()
    if api_key:
        profile["apiKey"] = protect_secret(api_key)
        profile["apiKeyTail"] = secret_tail(api_key)


def save_ai_profiles(current, payload):
    ai = current["ai"]
    if "profiles" in payload:
        incoming = payload["profiles"]
        if not isinstance(incoming, list) or not incoming:
            raise ValueError("至少保留一组 AI 配置。")
        existing = {profile["id"]: profile for profile in ai["profiles"]}
        profiles = []
        seen = set()
        for item in incoming:
            if not isinstance(item, dict):
                raise ValueError("AI 配置必须是对象。")
            profile_id = str(item.get("id") or uuid.uuid4().hex).strip()
            if not profile_id or profile_id in seen:
                raise ValueError("AI 配置 ID 不能为空或重复。")
            seen.add(profile_id)
            # Only an existing ID can retain its saved secret. Never inherit
            # another provider's key when creating or switching a profile.
            profile = dict(existing.get(profile_id, {
                "id": profile_id, "name": "新配置", "baseUrl": "", "model": "",
                "thinkMode": False, "apiKey": "", "apiKeyTail": "",
            }))
            update_ai_profile(profile, item)
            profiles.append(profile)
        ai["profiles"] = profiles
    elif any(key in payload for key in (*AI_PROFILE_FIELDS, "name")):
        active = next(profile for profile in ai["profiles"] if profile["id"] == ai["activeProfileId"])
        update_ai_profile(active, payload)
    if "activeProfileId" in payload:
        profile_id = str(payload["activeProfileId"])
        if not any(profile["id"] == profile_id for profile in ai["profiles"]):
            raise ValueError("当前 AI 配置不存在。")
        ai["activeProfileId"] = profile_id
    if "modules" in payload:
        if not isinstance(payload["modules"], dict):
            raise ValueError("模块配置必须是对象。")
        valid_modules = {item[0] for item in AI_MODULES}
        profile_ids = {profile["id"] for profile in ai["profiles"]}
        for module_id, setting in payload["modules"].items():
            if module_id not in valid_modules or not isinstance(setting, dict):
                raise ValueError("未知模块或无效的模块配置。")
            current_setting = dict(ai["modules"].get(module_id, {}))
            if "profileId" in setting:
                profile_id = str(setting["profileId"] or "")
                if profile_id and profile_id not in profile_ids:
                    raise ValueError("模块所选的 AI 配置不存在。")
                current_setting["profileId"] = profile_id
            if "thinkMode" in setting:
                current_setting["thinkMode"] = bool(setting["thinkMode"])
            ai["modules"][module_id] = current_setting
    normalize_ai_profiles(current)


def save_config(base_dir, payload):
    with CONFIG_LOCK:
        return _save_config(base_dir, payload)


def _save_config(base_dir, payload):
    current = load_config(base_dir)
    if isinstance(payload.get("ai"), dict):
        save_ai_profiles(current, payload["ai"])
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
    # Readers always see a complete file, even while a threaded request saves.
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as temporary:
            temporary_path = Path(temporary.name)
            json.dump(current, temporary, ensure_ascii=False, indent=2)
        os.replace(temporary_path, path)
    finally:
        if temporary_path and temporary_path.exists():
            temporary_path.unlink()
    return current


def public_config(config):
    normalize_ai_profiles(config)
    return {
        "ai": {
            "modules": config["ai"]["modules"],
            "moduleDefinitions": [{"id": key, "name": name, "description": description} for key, name, description in AI_MODULES],
            "activeProfileId": config["ai"]["activeProfileId"],
            "profiles": [public_ai_profile(profile) for profile in config["ai"]["profiles"]],
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


def public_ai_profile(profile):
    secret = unprotect_secret(profile.get("apiKey", ""))
    return {
        "id": profile["id"], "name": profile.get("name", ""),
        "baseUrl": profile.get("baseUrl", ""), "model": profile.get("model", ""),
        "thinkMode": bool(profile.get("thinkMode", False)),
        "hasApiKey": bool(secret),
        "apiKeyTail": profile.get("apiKeyTail", "") or secret_tail(secret),
    }


def get_secret(config, section, key):
    return unprotect_secret(config.get(section, {}).get(key, ""))


def secret_tail(value):
    text = str(value or "")
    return text[-4:] if text else ""


def ensure_secret_tails(config):
    for profile in config.get("ai", {}).get("profiles", []):
        secret = unprotect_secret(profile.get("apiKey", ""))
        profile["apiKeyTail"] = secret_tail(secret)
    normalize_ai_profiles(config)
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
