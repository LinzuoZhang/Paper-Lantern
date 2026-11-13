"""Reviewed capabilities; MCP supplies schemas, the executor owns write access."""

import importlib.util
from functools import lru_cache
from pathlib import Path


READ_CAPABILITIES = {
    "library_overview": "查看分类树与文献库概况",
    "search_library": "按标题、分类、类型分页查找论文或笔记",
    "list_paper_summaries": "批量读取论文标题与摘要",
    "get_paper_summary": "查看论文摘要",
    "search_paper_content": "搜索文献原文",
    "get_paper_passages": "读取论文原文片段",
    "get_paper_highlights": "分页读取论文高亮及其批注",
    "get_paper_annotations": "分页读取论文批注和翻译",
    "get_item": "读取文献或笔记详情",
    "list_flags": "查看标记和待办定义",
}
WRITE_CAPABILITIES = {
    "create_category": "创建分类",
    "rename_category": "重命名分类及其子分类",
    "move_category": "移动分类或调整排序",
    "delete_category": "删除分类，保留文献及其他归属",
    "set_item_categories": "替换文献分类",
    "add_item_categories": "添加文献分类",
    "remove_item_categories": "移除文献分类",
    "update_paper": "修改标题、元数据、笔记、分类或待办",
    "batch_update_items": "批量修改文献或笔记",
    "create_flag": "创建标记",
    "update_flag": "修改标记颜色或图标",
    "batch_update_flags": "批量添加或移除标记",
    "create_note": "创建笔记",
    "write_note": "替换、追加或前置笔记内容",
    "add_paper_highlight": "按页码和原文新增论文高亮",
    "add_paper_annotation": "向论文高亮追加批注或翻译",
}


@lru_cache(maxsize=1)
def mcp_module():
    path = Path(__file__).resolve().parents[2] / "plugins/paper-lantern-research-mcp/scripts/paper_lantern_research_mcp.py"
    spec = importlib.util.spec_from_file_location("paper_lantern_agent_tools", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def tool_catalog(definitions, names=()):
    result = []
    for name, label in {**READ_CAPABILITIES, **WRITE_CAPABILITIES}.items():
        if name not in definitions or (names and name not in names):
            continue
        description, schema, _handler = definitions[name]
        item = {"name": name, "label": label, "effect": "write" if name in WRITE_CAPABILITIES else "read",
                "approvalRequired": name in WRITE_CAPABILITIES}
        if names:
            item.update(description=description, parameters=schema)
        result.append(item)
    return result
