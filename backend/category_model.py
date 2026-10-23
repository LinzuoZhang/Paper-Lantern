"""Shared category membership rules for the library and cloud manifests."""

from copy import deepcopy
from functools import wraps
import threading

LIBRARY_LOCK = threading.RLock()


def library_locked(function):
    @wraps(function)
    def locked(*args, **kwargs):
        with LIBRARY_LOCK:
            return function(*args, **kwargs)
    return locked

UNCATEGORIZED_ID = "uncategorized"
LEGACY_TIMESTAMP = "1970-01-01T00:00:00+00:00"


def normalize_category_ids(value):
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise ValueError("categoryIds must be an array of strings.")
    ids = {item.strip().replace("\\", "/") for item in value if item.strip()}
    ids -= {UNCATEGORIZED_ID, "Uncategorized", "未分类"}
    return sorted(ids) or [UNCATEGORIZED_ID]


def category_ids(record):
    states = record.get("categoryMemberships")
    if isinstance(states, dict):
        return normalize_category_ids([
            key for key, state in states.items()
            if isinstance(state, dict) and state.get("present") is True
        ])
    return normalize_category_ids(record.get("categoryIds", record.get("categoryId", record.get("category", ""))))


def normalize_record_categories(record, valid_ids=None):
    if not isinstance(record.get("categoryMemberships"), dict):
        record["categoryMemberships"] = {
            key: {"present": True, "updatedAt": LEGACY_TIMESTAMP}
            for key in category_ids(record) if key != UNCATEGORIZED_ID
        }
    ids = category_ids(record)
    if valid_ids is not None:
        ids = [key for key in ids if key in valid_ids] or [UNCATEGORIZED_ID]
    record["categoryIds"] = ids
    record["categoryId"] = ids[0]  # Compatibility for older readers and importers.
    return record


def set_record_categories(record, ids, timestamp):
    desired = set(normalize_category_ids(ids)) - {UNCATEGORIZED_ID}
    normalize_record_categories(record)
    states = record["categoryMemberships"]
    current = set(category_ids(record)) - {UNCATEGORIZED_ID}
    for key in current ^ desired:
        states[key] = {"present": key in desired, "updatedAt": timestamp}
    normalize_record_categories(record)
    return record


def merge_record_categories(local, remote):
    local, remote = deepcopy(local), deepcopy(remote)
    normalize_record_categories(local)
    normalize_record_categories(remote)
    states = {}
    for record in (remote, local):
        for key, state in record["categoryMemberships"].items():
            if not isinstance(state, dict):
                continue
            # Each relationship merges independently; a removal wins a tie.
            rank = (str(state.get("updatedAt", "")), state.get("present") is not True)
            previous = states.get(key, {})
            previous_rank = (str(previous.get("updatedAt", "")), previous.get("present") is not True)
            if key not in states or rank > previous_rank:
                states[key] = deepcopy(state)
    local["categoryMemberships"] = states
    return normalize_record_categories(local)


def copy_category_fields(metadata, record):
    """metadata is a portable mirror; the manifest owns category membership."""
    for key in ("categoryIds", "categoryMemberships"):
        metadata[key] = deepcopy(record[key])
    metadata["category"] = record["categoryId"]
    return metadata


def normalize_manifest_categories(db):
    db["version"] = 2
    deleted = db.setdefault("deletedCategories", {})
    categories = db.setdefault("categories", {})
    for key in list(categories):
        if key != UNCATEGORIZED_ID and key in deleted and str(categories[key].get("updatedAt", "")) <= deleted[key]:
            categories.pop(key)
    # An offline child of a deleted category must not become an orphan.
    while True:
        orphans = [key for key, item in categories.items() if item.get("parentId") and item["parentId"] not in categories]
        if not orphans:
            break
        for key in orphans:
            parent = categories.pop(key).get("parentId")
            deleted[key] = max(deleted.get(key, ""), deleted.get(parent, LEGACY_TIMESTAMP))
    for record in db.setdefault("papers", {}).values():
        normalize_record_categories(record)
        for key, state in record["categoryMemberships"].items():
            if key in deleted and str(state.get("updatedAt", "")) <= deleted[key]:
                state.update(present=False, updatedAt=deleted[key])
        normalize_record_categories(record, categories)
    return db
