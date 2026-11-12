"""Immutable proposals, virtual previews and user-approved, journaled execution."""

from copy import deepcopy
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import threading
import time
import uuid

from backend.category_model import category_ids, set_record_categories
from backend.mcp_markdown import validate_note_markdown
from .capabilities import WRITE_CAPABILITIES, mcp_module
from .store import JobConflict
from .annotation_actions import ANNOTATION_TOOLS, prepare_annotation_change


EXECUTION_LOCK = threading.RLock()


class PlanValidationError(ValueError):
    """A persisted preview failure that can be returned to the planning agent."""

    def __init__(self, plan):
        self.plan = plan
        super().__init__(plan["failure"]["error"])


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def digest(value):
    return hashlib.sha256(encode(value).encode("utf-8")).hexdigest()


def reference_value(value):
    # Older model responses encoded an entire reference as a string. Only
    # recognize this exact form; never interpolate references inside content.
    if isinstance(value, str):
        match = re.fullmatch(r"\{ref:([A-Za-z0-9_-]{1,80}\.(?:categoryId|flagId|noteId|groupId|entryId))\}", value)
        if match:
            return {"ref": match.group(1)}
    return value


def resolve(value, outputs):
    value = reference_value(value)
    if isinstance(value, dict):
        if set(value) == {"ref"}:
            if not isinstance(value["ref"], str):
                raise ValueError("操作引用须为字符串。")
            parts = value["ref"].split(".")
            result = outputs
            for part in parts:
                if not isinstance(result, dict) or part not in result:
                    raise ValueError("引用尚不存在或不是先前操作的返回字段：" + value["ref"])
                result = result[part]
            return deepcopy(result)
        return {key: resolve(item, outputs) for key, item in value.items()}
    if isinstance(value, list):
        return [resolve(item, outputs) for item in value]
    return value


class PlanStore:
    def __init__(self, jobs):
        self.jobs = jobs
        self.path = jobs.path.with_name("plans.sqlite3")
        with self.connect() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS plans (
                id TEXT PRIMARY KEY,job_id TEXT NOT NULL,turn_id TEXT NOT NULL,version INTEGER NOT NULL,
                state TEXT NOT NULL,data TEXT NOT NULL,updated_at REAL NOT NULL)""")

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.path, timeout=30)
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def create(self, job_id, turn_id, proposal, call_id=None):
        job = self.jobs.get(job_id)
        if job["request"].get("turnId", job_id) != turn_id:
            raise JobConflict("当前对话轮次已变化。")
        if job["status"] == "cancelled":
            raise JobConflict("对话已停止，不能提交计划。")
        if (not isinstance(proposal, dict) or set(proposal) - {"summary", "operations"}
                or not isinstance(proposal.get("summary"), str) or not 1 <= len(proposal["summary"].strip()) <= 1000):
            raise ValueError("计划须包含简短 summary 和 operations。")
        operations = proposal.get("operations")
        if not isinstance(operations, list) or not 1 <= len(operations) <= 100:
            raise ValueError("每份计划须有 1–100 项操作；批量操作可包含多篇文献。")
        if len(encode(proposal)) > 200_000:
            raise ValueError("计划过大，请分批提交。")
        ids = set()
        for operation in operations:
            if not isinstance(operation, dict) or set(operation) - {"id", "tool", "arguments", "reason"}:
                raise ValueError("计划操作格式无效。")
            key = operation.get("id")
            if not isinstance(key, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", key) or key in ids:
                raise ValueError("操作 ID 须唯一，使用字母、数字、下划线或短横线。")
            ids.add(key)
            if operation.get("tool") not in WRITE_CAPABILITIES or not isinstance(operation.get("arguments"), dict):
                raise ValueError("计划包含未开放的写工具或无效参数。")
            if "reason" in operation and (not isinstance(operation["reason"], str) or len(operation["reason"]) > 2000):
                raise ValueError("操作理由过长或格式无效。")
        plan_id = digest([job_id, turn_id, call_id])[:32] if call_id else uuid.uuid4().hex
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute("SELECT data FROM plans WHERE id=?", (plan_id,)).fetchone()
            if existing:
                data = json.loads(existing[0])
                if data["proposal"] != proposal:
                    raise JobConflict("同一计划请求不能包含不同操作。")
                return data
            version = db.execute("SELECT COALESCE(MAX(version),0)+1 FROM plans WHERE job_id=? AND turn_id=?", (job_id, turn_id)).fetchone()[0]
            db.execute("UPDATE plans SET state='superseded' WHERE job_id=? AND state IN ('draft','awaiting_approval','stale')", (job_id,))
            data = {"id": plan_id, "jobId": job_id, "turnId": turn_id, "version": version, "state": "draft",
                    "proposal": deepcopy(proposal), "preview": [], "revision": "", "digest": "", "results": []}
            db.execute("INSERT INTO plans VALUES (?,?,?,?,?,?,?)", (plan_id, job_id, turn_id, version, "draft", encode(data), time.time()))
        return data

    def get(self, plan_id, job_id, library):
        self.jobs.get(job_id, library)
        with self.connect() as db:
            row = db.execute("SELECT data,state FROM plans WHERE id=? AND job_id=?", (plan_id, job_id)).fetchone()
        if not row:
            raise FileNotFoundError("操作计划不存在。")
        data = json.loads(row[0]); data["state"] = row[1]
        return data

    def save(self, data):
        with self.connect() as db:
            db.execute("UPDATE plans SET state=?,data=?,updated_at=? WHERE id=?", (data["state"], encode(data), time.time(), data["id"]))

    def invalidate(self, job_id, state="cancelled"):
        with self.connect() as db:
            db.execute("UPDATE plans SET state=? WHERE job_id=? AND state IN ('draft','awaiting_approval','stale')", (state, job_id))


def snapshot(api):
    db = api.load_library_db()
    metadata, notes, local, signatures, highlights = {}, {}, {}, {}, {}
    for key, record in db["papers"].items():
        folder = api.paper_dir_from_record(record)
        metadata[key] = api.read_json(folder / "metadata.json", {})
        notes[key] = api.read_text_file(folder / api.NOTES_FILE) if (folder / api.NOTES_FILE).exists() else str(metadata[key].get("notes", ""))
        local[key] = api.paper_local_state(key, metadata[key])
        signatures[key] = {"metadata": metadata[key], "notes": notes[key], "local": local[key], "exists": folder.is_dir()}
        path = folder / "highlights.json"
        raw = path.read_bytes() if path.exists() else b"[]"
        signatures[key]["highlights"] = hashlib.sha256(raw).hexdigest()
        try:
            highlights[key] = json.loads(raw)
        except (ValueError, UnicodeError):
            highlights[key] = None
        pdf_path = folder / "paper.pdf"
        if pdf_path.is_file():
            stat = pdf_path.stat()
            signatures[key]["pdf"] = [stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns, stat.st_ino]
    flags = api.library_flag_definitions()
    revision = digest({"library": db, "items": signatures, "flags": flags})
    return {"db": deepcopy(db), "metadata": metadata, "notes": notes, "local": local, "highlights": highlights,
            "exists": {key: value["exists"] for key, value in signatures.items()},
            "flags": {flag["id"]: flag for flag in flags}}, revision


def item_view(state, key):
    record = state["db"]["papers"][key]
    return {"id": key, "title": record.get("title", key), "categoryIds": category_ids(record),
            "doi": state["metadata"].get(key, {}).get("doi", ""),
            "basicInfo": state["metadata"].get(key, {}).get("basicInfo", {}),
            "notes": state["notes"].get(key, ""), "flags": state["local"].get(key, {}).get("flags", [])}


def simulate(api, module, state, name, arguments, key, plan_id):
    """Validate against a virtual library, including the outputs of prior operations."""
    module.validate_value(arguments, module.TOOLS[name][1])
    if "dryRun" in arguments or "expectedRevision" in arguments:
        raise ValueError("计划由服务端统一预览和版本校验，不接受工具级 dryRun/expectedRevision。")
    db, args = state["db"], deepcopy(arguments)
    categories = db["categories"]
    changes, output = [], {}

    def valid_categories(values):
        if not isinstance(values, list) or any(not isinstance(value, str) for value in values):
            raise ValueError('categoryIds 须为分类 ID 数组；新分类请使用对象引用，例如 [{"ref":"create_topic.categoryId"}]。')
        missing = [value for value in values if value not in categories]
        if missing:
            raise ValueError("分类不存在：" + encode(missing) + '。请使用已有分类的确切 ID；新分类须先 create_category，再用 {"ref":"创建操作id.categoryId"} 引用。')
        return values

    def update_item(item):
        module.validate_value(item, module.TOOLS["update_paper"][1])
        item_id = item["id"]
        if item_id not in db["papers"]:
            raise FileNotFoundError("文献不存在：" + item_id)
        if state["exists"].get(item_id) is False:
            raise FileNotFoundError("文献目录缺失：" + item_id)
        if "categoryId" in item:
            raise ValueError("计划请使用 categoryIds，不允许隐式创建分类。")
        before = deepcopy(item_view(state, item_id))
        record = db["papers"][item_id]
        ids = set(category_ids(record))
        if "categoryIds" in item:
            ids = set(valid_categories(item["categoryIds"]))
        ids.update(valid_categories(item.get("addCategoryIds", [])))
        ids -= set(valid_categories(item.get("removeCategoryIds", [])))
        set_record_categories(record, sorted(ids), api.utc_now())
        if "title" in item:
            if not item["title"].strip() or len(item["title"]) > 200:
                raise ValueError("文献标题须为 1–200 字符。")
            record["title"] = item["title"].strip()
        for field in ("doi", "basicInfo"):
            if field in item:
                state["metadata"].setdefault(item_id, {})[field] = api.normalize_basic_info(item[field]) if field == "basicInfo" else item[field].strip()
        if "notes" in item:
            validate_note_markdown(item["notes"], db, api.MAX_NOTES_CHARS)
            state["notes"][item_id] = item["notes"]
        flags = set(before["flags"])
        if "flags" in item:
            if any(flag not in state["flags"] for flag in item["flags"]):
                raise ValueError("标记不存在。")
            flags = set(item["flags"])
        else:
            for field in ("read", "todo"):
                if field in item:
                    flags.add(field) if item[field] else flags.discard(field)
        state["local"][item_id] = {"flags": sorted(flags)}
        after = item_view(state, item_id)
        fields = [field for field in before if before[field] != after[field]]
        changes.append({"id": item_id, "title": record.get("title", item_id),
                        "before": {field: before[field] for field in fields}, "after": {field: after[field] for field in fields}})

    if name == "create_category":
        parent = args.get("parentId", "")
        child = api.clean_folder_name(args["name"])
        if not child or (parent and parent not in categories):
            raise ValueError("分类名称或父分类无效。")
        category_id = f"{parent}/{child}".strip("/")
        if category_id in categories:
            raise ValueError("分类已存在，请复用：" + category_id)
        categories[category_id] = {"id": category_id, "name": child, "parentId": parent, "locked": False,
                                   "order": api.next_category_order(db, parent)}
        output = {"categoryId": category_id}
        changes = [{"before": None, "after": categories[category_id]}]
    elif name in {"rename_category", "move_category", "delete_category"}:
        categories_before = deepcopy(categories)
        category_id = args["id"]
        category = categories.get(category_id)
        if not category or category.get("locked"):
            raise ValueError("分类不存在或不可修改。")
        descendants = api.category_descendants(db, category_id)
        before = {value: deepcopy(categories[value]) for value in descendants}
        if name == "delete_category":
            mapping = {value: None for value in descendants}
        else:
            parent = args.get("parentId", category.get("parentId", ""))
            if args.get("beforeId") and args.get("afterId"):
                raise ValueError("beforeId 和 afterId 不可同时指定。")
            for sibling in (args.get("beforeId"), args.get("afterId")):
                if sibling:
                    if sibling not in categories:
                        raise ValueError("目标相邻分类不存在。")
                    parent = categories[sibling].get("parentId", "")
            if parent and parent not in categories or parent in descendants:
                raise ValueError("目标父分类无效或形成循环。")
            new_name = api.clean_folder_name(args["name"]) if name == "rename_category" else category["name"]
            if not new_name:
                raise ValueError("分类名称不能为空。")
            new_id = f"{parent}/{new_name}".strip("/")
            mapping = {old: new_id + old[len(category_id):] for old in descendants}
            if any(new in categories and new not in descendants for new in mapping.values()):
                raise ValueError("目标分类已存在。")
            output = {"categoryId": new_id, "idMap": mapping}
        for old in descendants:
            item = categories.pop(old)
            new = mapping[old]
            if new:
                item["id"] = new
                item["parentId"] = parent if old == category_id else mapping.get(item.get("parentId"), item.get("parentId", ""))
                if old == category_id:
                    item["name"] = new_name
                categories[new] = item
        changes.append({"before": before, "after": {new: categories[new] for new in mapping.values() if new}})
        for item_id, record in db["papers"].items():
            if set(category_ids(record)).intersection(descendants):
                prior = category_ids(record)
                set_record_categories(record, [mapping.get(value, value) for value in prior if mapping.get(value, value)], api.utc_now())
                changes.append({"id": item_id, "title": record.get("title", item_id),
                                "before": {"categoryIds": prior}, "after": {"categoryIds": category_ids(record)}})
        if name == "move_category":
            api.reorder_category_siblings(db, parent, new_id, args.get("beforeId", ""), args.get("afterId", ""))
            for sibling_id in categories.keys() - set(mapping.values()) - set(descendants):
                if categories_before.get(sibling_id) != categories[sibling_id]:
                    changes.append({"id": sibling_id, "before": categories_before.get(sibling_id),
                                    "after": categories[sibling_id]})
    elif name in {"set_item_categories", "add_item_categories", "remove_item_categories"}:
        field = {"set_item_categories": "categoryIds", "add_item_categories": "addCategoryIds", "remove_item_categories": "removeCategoryIds"}[name]
        values = valid_categories(args["categoryIds"])
        if name == "remove_item_categories" and args.get("includeDescendants"):
            values = list({child for value in values for child in api.category_descendants(db, value)})
        update_item({"id": args["id"], field: values})
        output = {"itemId": args["id"]}
    elif name in {"update_paper", "batch_update_items"}:
        items = args.get("items", []) if name == "batch_update_items" else [args]
        if name == "batch_update_items" and ("expectedRevision" in args or "dryRun" in args):
            raise ValueError("计划由服务端统一预览和版本校验，不接受工具级 dryRun/expectedRevision。")
        if len({item["id"] for item in items}) != len(items):
            raise ValueError("同一批次中的文献 ID 不可重复。")
        for item in items:
            update_item(item)
    elif name == "create_flag":
        flag_name = args["name"].strip()
        if not 1 <= len(flag_name) <= 24 or any(ord(char) < 32 or ord(char) == 127 for char in flag_name):
            raise ValueError("标记名称须为 1–24 字符。")
        flag = next((value for value in state["flags"].values() if value["name"].casefold() == flag_name.casefold()), None)
        if flag is None:
            if sum(not value.get("builtin") for value in state["flags"].values()) >= 100:
                raise ValueError("自定义标记数量已达上限。")
            flag = {"id": "planned-flag-" + key, "name": flag_name, "builtin": False}
            state["flags"][flag["id"]] = flag
        output = {"flagId": flag["id"]}
        changes = [{"after": flag}]
    elif name == "update_flag":
        flag = state["flags"].get(args["id"])
        if not flag or not {"color", "icon"}.intersection(args):
            raise ValueError("标记不存在或缺少修改内容。")
        if "color" in args and not re.fullmatch(r"#[0-9a-fA-F]{6}", args["color"]):
            raise ValueError("颜色须为 #RRGGBB。")
        if "icon" in args and args["icon"] not in api.PAPER_FLAG_ICONS:
            raise ValueError("请选择预设图标。")
        before = deepcopy(flag)
        flag.update({field: args[field] for field in ("color", "icon") if field in args})
        if "color" in args:
            flag["color"] = args["color"].lower()
        changes = [{"before": before, "after": flag}]
    elif name == "batch_update_flags":
        if "dryRun" in args:
            raise ValueError("计划由服务端统一预览。")
        for item_id in args["ids"]:
            if item_id not in db["papers"] or any(flag not in state["flags"] for flag in args["flags"]):
                raise ValueError("文献或标记不存在。")
            current = set(item_view(state, item_id)["flags"])
            desired = current | set(args["flags"]) if args["operation"] == "add" else current - set(args["flags"])
            update_item({"id": item_id, "flags": sorted(desired)})
    elif name in ANNOTATION_TOOLS:
        args["id"] = args["id"].strip()
        record = db["papers"].get(args["id"])
        if not record or record.get("itemType", "paper") != "paper" or not state["exists"].get(args["id"]):
            raise ValueError("目标不是可用的 PDF 论文。")
        highlights = state["highlights"].get(args["id"])
        if not isinstance(highlights, list) or any(not isinstance(item, dict) for item in highlights):
            raise ValueError("论文高亮文件损坏，请先修复；本次未保存任何变更。")
        output, before, after = prepare_annotation_change(api.paper_dir_from_record(record), highlights, name, args, plan_id, key)
        changes = [{"id": args["id"], "title": record.get("title", args["id"]), "before": before, "after": after}]
    elif name == "create_note":
        title = args["title"].strip()
        if not 1 <= len(title) <= 200 or "categoryId" in args:
            raise ValueError("笔记标题须为 1–200 字符，分类请用 categoryIds。")
        ids = valid_categories(args.get("categoryIds", []))
        content = args.get("content", "")
        validate_note_markdown(content, db, api.MAX_NOTES_CHARS)
        note_id = hashlib.sha256(("research-report:agent-plan:" + plan_id + ":" + key).encode()).hexdigest()[:32]
        db["papers"][note_id] = {"id": note_id, "title": title, "itemType": "note", "categoryIds": ids}
        set_record_categories(db["papers"][note_id], ids, api.utc_now())
        state["metadata"][note_id] = {}; state["notes"][note_id] = content; state["local"][note_id] = {"flags": []}
        output = {"noteId": note_id}
        changes = [{"before": None, "after": item_view(state, note_id)}]
    elif name == "write_note":
        item_id = args["id"]
        if item_id not in db["papers"] or db["papers"][item_id].get("itemType") != "note":
            raise ValueError("目标不是独立笔记。")
        previous = state["notes"].get(item_id, "")
        content = args["content"]
        mode = args.get("mode", "replace")
        if mode == "append":
            content = previous.rstrip() + ("\n\n" if previous.strip() and content.strip() else "") + content
        elif mode == "prepend":
            content = content.rstrip() + ("\n\n" if previous.strip() and content.strip() else "") + previous
        update_item({"id": item_id, "notes": content})
        output = {"noteId": item_id}
    else:
        raise ValueError("该操作尚未注册执行器。")
    return output, changes


def preview_plan(api, plans, plan_id, job_id):
    with EXECUTION_LOCK, api.LIBRARY_LOCK, api.FLAGS_LOCK:
        data = plans.get(plan_id, job_id, api.LIBRARY_DIR)
        if data["state"] != "draft":
            return data
        state, revision = snapshot(api)
        module = mcp_module(); module.paper_server = api
        outputs, preview = {}, []
        for operation in data["proposal"]["operations"]:
            try:
                args = resolve(operation["arguments"], outputs)
                output, changes = simulate(api, module, state, operation["tool"], args, operation["id"], data["id"])
            except (ValueError, TypeError, OSError, RuntimeError) as error:
                data.update(state="failed", failure={"stage": "preview", "operationId": operation["id"],
                            "tool": operation["tool"], "error": str(error)[:2000], "possiblePartialWrite": False,
                            "parameterSchema": module.TOOLS[operation["tool"]][1]})
                plans.save(data)
                raise PlanValidationError(data) from error
            outputs[operation["id"]] = output
            preview.append(deepcopy({"id": operation["id"], "tool": operation["tool"], "label": WRITE_CAPABILITIES[operation["tool"]],
                            "reason": operation.get("reason", ""), "arguments": args, "changes": changes}))
        data.update(state="awaiting_approval", revision=revision, preview=preview)
        data["digest"] = digest({key: data[key] for key in ("id", "version", "proposal", "revision", "preview")})
        plans.save(data)
        return data


def apply_operation(api, module, name, args, plan_id, key):
    if name in ANNOTATION_TOOLS:
        args = {**args, "id": args["id"].strip()}
        directory, highlights = module.read_article_highlights(args["id"])
        output, _before, _after = prepare_annotation_change(directory, highlights, name, args, plan_id, key)
        if output["changed"]:
            api.write_json(directory / "highlights.json", highlights)
            api.update_paper_sync_hash(directory)
        return output
    if name == "create_category":
        return {"categoryId": api.create_category(args.get("parentId", ""), args["name"])}
    if name == "rename_category":
        descendants = api.category_descendants(api.load_library_db(), args["id"])
        new_id = api.rename_category(args["id"], args["name"])
        return {"categoryId": new_id, "idMap": {old: new_id + old[len(args["id"]):] for old in descendants}}
    if name == "move_category":
        descendants = api.category_descendants(api.load_library_db(), args["id"])
        new_id = api.move_category(args["id"], args.get("parentId", ""), args.get("beforeId", ""), args.get("afterId", ""))
        return {"categoryId": new_id, "idMap": {old: new_id + old[len(args["id"]):] for old in descendants}}
    if name == "delete_category":
        api.delete_category(args["id"]); return {"deletedCategoryId": args["id"]}
    if name == "create_flag":
        return {"flagId": api.create_library_flag(args["name"])["id"]}
    if name == "update_flag":
        api.update_library_flag_appearance(args["id"], {field: args[field] for field in ("color", "icon") if field in args})
        return {"flagId": args["id"]}
    if name == "batch_update_flags":
        api.update_papers_flags(args["ids"], args["flags"], args["operation"])
        return {"count": len(args["ids"])}
    if name == "create_note":
        note = api.add_note_to_db(args["title"], args.get("categoryIds", []),
                                  request_id="agent-plan:" + plan_id + ":" + key, content=args.get("content", ""))
        return {"noteId": note["id"]}
    if name == "write_note":
        db = api.load_library_db()
        folder = api.paper_dir_from_record(db["papers"][args["id"]])
        previous = api.read_text_file(folder / api.NOTES_FILE)
        content, mode = args["content"], args.get("mode", "replace")
        if mode == "append":
            content = previous.rstrip() + ("\n\n" if previous.strip() and content.strip() else "") + content
        elif mode == "prepend":
            content = content.rstrip() + ("\n\n" if previous.strip() and content.strip() else "") + previous
        api.write_paper_notes(folder, content)
        return {"noteId": args["id"]}
    if name in {"set_item_categories", "add_item_categories", "remove_item_categories"}:
        field = {"set_item_categories": "categoryIds", "add_item_categories": "addCategoryIds", "remove_item_categories": "removeCategoryIds"}[name]
        values = args["categoryIds"]
        if name == "remove_item_categories" and args.get("includeDescendants"):
            db = api.load_library_db()
            values = list({child for value in values for child in api.category_descendants(db, value)})
        items = [{"id": args["id"], field: values}]
    else:
        items = args["items"] if name == "batch_update_items" else [args]
    db = api.load_library_db()
    for item in items:
        prepared = module.prepare_item_update(item, db)
        module.apply_item_update(prepared, db)
    return {"itemId": args["id"]} if name in {"set_item_categories", "add_item_categories", "remove_item_categories"} else {"count": len(items)}


def approve_plan(api, plans, plan_id, job_id, expected_digest):
    with EXECUTION_LOCK, api.LIBRARY_LOCK, api.FLAGS_LOCK:
        data = plans.get(plan_id, job_id, api.LIBRARY_DIR)
        if not isinstance(expected_digest, str) or not expected_digest or expected_digest != data["digest"]:
            raise JobConflict("计划版本不匹配，请重新查看计划。")
        if data["state"] == "completed":
            return data
        if data["state"] != "awaiting_approval":
            raise JobConflict("该计划已失效、执行过或执行中断，请生成新计划后确认。")
        job = plans.jobs.get(job_id, api.LIBRARY_DIR)
        if job["status"] != "awaiting_approval" or job["request"].get("turnId", job_id) != data["turnId"]:
            raise JobConflict("该计划不再属于当前待确认的任务。")
        _state, revision = snapshot(api)
        if revision != data["revision"]:
            data.update(state="stale", failure={"stage": "revision", "error": "文献库已变化，原计划已失效；请核对当前状态并重新生成计划。",
                                               "possiblePartialWrite": False})
            plans.save(data)
            raise JobConflict("文献库已变化，原计划已失效；请重新生成计划并确认。")
        data["state"] = "executing"; plans.save(data)
        module = mcp_module(); module.paper_server = api
        outputs = {}
        for operation in data["proposal"]["operations"]:
            receipt = {"id": operation["id"], "tool": operation["tool"], "status": "running"}
            data["results"].append(receipt); plans.save(data)
            try:
                job = plans.jobs.get(job_id, api.LIBRARY_DIR)
                if job["status"] == "cancelled" or job["request"].get("turnId", job_id) != data["turnId"]:
                    raise JobConflict("对话已停止或开始了新的轮次，后续操作停止。")
                output = apply_operation(api, module, operation["tool"], resolve(operation["arguments"], outputs), data["id"], operation["id"])
                outputs[operation["id"]] = output
                receipt.update(status="completed", output=output)
                plans.save(data)
            except Exception as error:
                receipt.update(status="failed", error=str(error), possiblePartialWrite=True)
                data.update(state="failed", failure={"stage": "execution", "operationId": operation["id"],
                            "tool": operation["tool"], "error": str(error)[:2000], "possiblePartialWrite": True})
                plans.save(data)
                break
        else:
            data["state"] = "completed"; plans.save(data)
    if any(result["status"] == "completed" and result["tool"] not in {"create_flag", "update_flag", "batch_update_flags"}
           and result["output"].get("changed", True) for result in data["results"]):
        try:
            api.maybe_auto_sync_library()
        except Exception as error:
            data["syncError"] = str(error); plans.save(data)
    return data


def retry_plan(api, plans, plan_id, job_id):
    with EXECUTION_LOCK:
        data = plans.get(plan_id, job_id, api.LIBRARY_DIR)
        if data["state"] not in {"failed", "stale", "executing"}:
            raise JobConflict("只有失败、失效或中断的计划可以重新预览。")
        outputs = {result["id"]: result["output"] for result in data["results"] if result["status"] == "completed"}
        remaining = [deepcopy(operation) for operation in data["proposal"]["operations"] if operation["id"] not in outputs]
        for operation in remaining:
            def known_refs(value):
                value = reference_value(value)
                if isinstance(value, dict) and set(value) == {"ref"} and value["ref"].split(".")[0] in outputs:
                    return resolve(value, outputs)
                if isinstance(value, dict):
                    return {key: known_refs(item) for key, item in value.items()}
                if isinstance(value, list):
                    return [known_refs(item) for item in value]
                return value
            operation["arguments"] = known_refs(operation["arguments"])
        if not remaining:
            raise JobConflict("没有需要重试的操作。")
        uncertain = any(result.get("possiblePartialWrite") or result["status"] == "running" for result in data["results"])
        summary = ("上次可能已有部分写入，请核对当前状态后重新确认：" if uncertain else "重新确认：") + data["proposal"]["summary"]
        replacement = plans.create(job_id, data["turnId"], {"summary": summary[:1000], "operations": remaining})
        return preview_plan(api, plans, replacement["id"], job_id)
