"""Bounded task memory for general tools, independent of recent observations."""

from copy import deepcopy
import json

from .context import json_size


def brief(value, max_string=4000):
    if isinstance(value, str):
        return value if len(value) <= max_string else value[:max_string] + "\n[内容已截短]"
    if isinstance(value, list):
        return [brief(item, max_string) for item in value]
    if isinstance(value, dict):
        return {key: brief(item, max_string) for key, item in value.items() if key not in {"libraryRoot", "localPath", "pdfPath"}}
    return value


def read_arguments(name, arguments):
    args = deepcopy(arguments)
    caps = {"library_overview": 5, "search_library": 30, "get_paper_passages": 5, "search_paper_content": 5}
    if name in caps:
        args.setdefault("limit", caps[name])
        if type(args["limit"]) is int:
            args["limit"] = min(args["limit"], caps[name])
    if name == "search_library":
        for key, value in {"offset": 0, "query": "", "itemType": "", "categoryMatch": "any", "includeDescendants": True}.items():
            args.setdefault(key, value)
        args.setdefault("categoryIds", [args.pop("categoryId")] if "categoryId" in args else [])
        if isinstance(args.get("categoryIds"), list) and all(isinstance(value, str) for value in args["categoryIds"]):
            args["categoryIds"] = sorted(set(args["categoryIds"]))
    return args


def read_key(name, arguments):
    args = read_arguments(name, arguments)
    for key in ("hashes", "categoryIds", "sources"):
        if isinstance(args.get(key), list) and all(isinstance(value, str) for value in args[key]):
            args[key] = sorted(set(args[key]))
    return name, json.dumps(args, sort_keys=True, ensure_ascii=False)


def read_definition(definition):
    tool = deepcopy(definition)
    function = tool["function"]
    name = function["name"]
    schema = function["parameters"]
    caps = {"library_overview": 5, "search_library": 30, "get_paper_passages": 5, "search_paper_content": 5}
    if name in caps and "limit" in schema.get("properties", {}):
        schema["properties"]["limit"].update(maximum=caps[name], default=caps[name])
    if name == "list_paper_summaries":
        schema["properties"]["hashes"].update(minItems=1, maxItems=12)
        schema["required"] = list(dict.fromkeys(schema.get("required", []) + ["hashes"]))
    return tool


def cached_read(facts, name, args):
    wanted = read_key(name, args)
    for index in range(len(facts) - 1, -1, -1):
        fact = facts[index]
        if (fact["tool"] == name and "result" in fact and "cachedFrom" not in fact and not fact.get("stale")
                and read_key(name, fact.get("arguments", {})) == wanted):
            return index
    return None


def result_page(facts, index, offset=0, limit=12):
    seen = set()
    while "cachedFrom" in facts[index] and index not in seen:
        seen.add(index); index = facts[index]["cachedFrom"]
    fact = facts[index]
    data = deepcopy(fact.get("result", {"error": fact.get("error", "结果不存在。")}))
    field = next((key for key in ("papers", "matches", "categories", "tools", "passages") if isinstance(data.get(key), list)), None)
    result = {"observation": index, "tool": fact["tool"], "result": data}
    if fact.get("stale"):
        result["stale"] = True
        result["notice"] = "此结果早于文献库变更，仅供历史参考；请重新查询当前状态。"
    if field:
        rows = data[field]
        data[field] = rows[offset:offset + limit]
        while len(data[field]) > 1 and json_size(result) > 24_000:
            data[field].pop()
        end = offset + len(data[field])
        result.update(resultField=field, resultOffset=offset, nextResultOffset=end if end < len(rows) else None)
    return brief(result, 3000)


def observation_view(fact):
    if fact.get("stale"):
        return {"tool": fact["tool"], "arguments": fact.get("arguments", {}), "stale": True,
                "notice": "文献库可能已变化，请重新查询；旧结果仅供历史回看。"}
    value = deepcopy(fact)
    data = value.get("result")
    if not isinstance(data, dict):
        return value
    if fact["tool"] == "library_overview":
        data["categories"] = [{key: item[key] for key in ("id", "name", "parentId", "directItemCount", "itemCount") if key in item}
                              for item in data.get("categories", [])]
    fields = ("matches",) if fact["tool"] == "search_library" else ("papers",) if fact["tool"] == "list_paper_summaries" else ("recentItems",) if fact["tool"] == "library_overview" else ()
    for field in fields:
        if isinstance(data.get(field), list):
            data[field] = [{key: item[key] for key in ("id", "hash", "title", "itemType", "categoryIds", "abstract", "threeLineSummary", "hasSummary") if key in item}
                           for item in data[field]]
    return brief(value, 1200)


def task_memory(facts):
    items, categories, queries, schemas = {}, {}, {}, {}
    for index, fact in enumerate(facts):
        data = fact.get("result")
        if not isinstance(data, dict) or "cachedFrom" in fact or fact.get("stale"):
            continue
        name = fact["tool"]
        if name == "library_overview":
            categories = {item["id"]: {key: item[key] for key in ("id", "name", "parentId", "directItemCount", "itemCount") if key in item}
                          for item in data.get("categories", [])}
        elif name == "discover_tools":
            for tool in data.get("tools", []):
                if tool.get("effect") == "write" and tool.get("parameters"):
                    schemas[tool["name"]] = {"name": tool["name"], "parameters": tool["parameters"]}
        rows = (data.get("matches", []) if name == "search_library" else data.get("papers", []) if name == "list_paper_summaries"
                else [data] if name == "get_paper_summary" else [data["item"]] if name == "get_item" and data.get("item") else [])
        for row in rows:
            key = row.get("hash") or row.get("id")
            if not key:
                continue
            item = items.setdefault(key, {"id": key})
            item.update({field: row[field] for field in ("title", "categoryIds", "itemType") if field in row})
            if name in {"list_paper_summaries", "get_paper_summary"}:
                item["summaryRead"] = True
                item["hasSummary"] = row.get("hasSummary", False)
                item["summaryPreview"] = "\n".join(str(row.get(field) or "") if field == "abstract" else json.dumps(row.get(field) or {}, ensure_ascii=False)
                                                    for field in ("abstract", "threeLineSummary"))
                item["summaryObservation"] = index
        if name == "search_library":
            args = read_arguments(name, fact.get("arguments", {}))
            query = {key: value for key, value in args.items() if key not in {"offset", "limit"}}
            key = json.dumps(query, ensure_ascii=False, sort_keys=True)
            coverage = queries.setdefault(key, {"arguments": query, "totalMatches": data.get("totalMatches", 0), "pages": {}})
            coverage["totalMatches"] = data.get("totalMatches", coverage["totalMatches"])
            coverage["pages"][args["offset"]] = {"count": len(rows), "observation": index}
    searches = []
    for coverage in queries.values():
        covered = 0
        for offset, page in sorted(coverage["pages"].items()):
            if offset <= covered:
                covered = max(covered, offset + page["count"])
        searches.append({"arguments": coverage["arguments"], "totalMatches": coverage["totalMatches"], "loadedCount": covered,
                         "complete": covered >= coverage["totalMatches"], "nextOffset": covered if covered < coverage["totalMatches"] else None})
    memory = {"items": deepcopy(list(items.values())), "categories": list(categories.values()), "searches": searches,
              "itemCount": len(items), "summaryReadCount": sum(bool(item.get("summaryRead")) for item in items.values()),
              "writeSchemas": list(schemas.values()), "omittedItemCount": 0, "omittedCategoryCount": 0}
    for preview_limit in (600, 200, 60, 0):
        for item in memory["items"]:
            if "summaryPreview" in item:
                full = items[item["id"]]["summaryPreview"]
                item["summaryPreview"] = brief(full, preview_limit) if preview_limit else "[可按 summaryObservation 回看]"
            if "title" in item:
                item["title"] = brief(item["title"], 250)
        if json_size(memory) <= 36_000:
            break
    while json_size(memory) > 40_000 and (memory["items"] or memory["categories"]):
        field, omitted = ("items", "omittedItemCount") if len(memory["items"]) >= len(memory["categories"]) else ("categories", "omittedCategoryCount")
        memory[field].pop(); memory[omitted] += 1
    return memory
