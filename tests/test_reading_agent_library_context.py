"""General task memory must retain coverage and stop repeated collection."""

import asyncio
from collections import Counter
from copy import deepcopy
import json
import unittest
from unittest.mock import patch

import server
from backend.reading_agent.context import json_size
from backend.reading_agent.library_agent import LibraryState, PLANNING_VERSION, proposal_definition
from backend.reading_agent.capabilities import mcp_module
from backend.reading_agent.library_context import cached_read, observation_view, read_arguments, read_definition, result_page, task_memory
from backend.reading_agent.mcp_client import ResearchMCPClient
from backend.reading_agent.plans import PlanStore, preview_plan
from backend.reading_agent.store import JobStore
from backend.reading_agent.worker import execute_job
from test_categories import LibraryFixture
from test_reading_agent import HAS_RUNTIME


def reply(calls, key):
    return {"role": "assistant", "content": "正在整理已读资料。", "tool_calls": [
        {"id": f"{key}-{i}", "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}
        for i, (name, args) in enumerate(calls)]}


class LibraryContextTests(unittest.TestCase):
    def test_proposal_exposes_required_item_ids_and_object_reference_schema(self):
        module = mcp_module()
        schemas = [{"name": name, "parameters": module.TOOLS[name][1]}
                   for name in ("create_category", "add_item_categories", "batch_update_items")]
        before = deepcopy(schemas)
        definition = proposal_definition(schemas)
        variants = definition["function"]["parameters"]["properties"]["operations"]["items"]["anyOf"]
        assign = next(item for item in variants if item["properties"]["tool"]["enum"] == ["add_item_categories"])
        arguments = assign["properties"]["arguments"]
        with self.assertRaisesRegex(ValueError, "arguments.id is required"):
            module.validate_value({"categoryIds": ["Topic"]}, arguments)
        refs = arguments["properties"]["categoryIds"]["items"]["anyOf"]
        self.assertTrue(any(schema.get("required") == ["ref"] for schema in refs))
        batch = next(item for item in variants if item["properties"]["tool"]["enum"] == ["batch_update_items"])
        self.assertNotIn("dryRun", batch["properties"]["arguments"]["properties"])
        self.assertIn("id", batch["properties"]["arguments"]["properties"]["items"]["items"]["required"])
        self.assertEqual(schemas, before)

    def test_reference_strings_are_not_interpolated_inside_note_content(self):
        from backend.reading_agent.plans import resolve
        content = "An example: {ref:topic.categoryId}"
        self.assertEqual(resolve(content, {"topic": {"categoryId": "Topic"}}), content)
        self.assertEqual(resolve('{"ref":"topic.categoryId"}', {}), '{"ref":"topic.categoryId"}')

    def test_memory_keeps_all_pages_and_summary_status_without_large_metadata(self):
        items = [{"id": f"paper-{i}", "title": f"Paper {i}", "categoryIds": ["uncategorized"],
                  "categoryNames": ["unused " * 200]} for i in range(70)]
        facts = [{"tool": "library_overview", "arguments": {}, "result": {"categories": [
            {"id": "A", "name": "Control", "parentId": "", "extra": "unused " * 20_000}]}}]
        for offset in (0, 30, 60):
            facts.append({"tool": "search_library", "arguments": {"categoryIds": ["uncategorized"], "offset": offset},
                "result": {"totalMatches": 70, "matches": items[offset:offset + 30], "nextOffset": offset + 30 if offset < 60 else None}})
        for start in range(0, 70, 12):
            batch = [{**item, "abstract": "exact summary " * 300, "hasSummary": True} for item in items[start:start + 12]]
            facts.append({"tool": "list_paper_summaries", "arguments": {"hashes": [item["id"] for item in batch]}, "result": {"papers": batch}})
        original = deepcopy(facts)
        memory = task_memory(facts)
        self.assertEqual({item["id"] for item in memory["items"]}, {item["id"] for item in items})
        self.assertEqual(memory["summaryReadCount"], 70)
        self.assertEqual(memory["searches"][0]["loadedCount"], 70)
        self.assertTrue(memory["searches"][0]["complete"])
        self.assertIsNone(memory["searches"][0]["nextOffset"])
        self.assertLessEqual(json_size(memory), 40_000)
        self.assertNotIn("extra", memory["categories"][0])
        self.assertEqual(facts, original)
        self.assertLess(json_size(observation_view(facts[0])), 1000)
        self.assertEqual(cached_read(facts, "search_library", {"categoryIds": ["uncategorized"], "offset": 0, "limit": 200}), 1)
        self.assertIsNone(cached_read(facts, "search_library", {"categoryIds": ["A"]}))

    def test_cached_result_recall_is_paginated_and_fulltext_observations_stay_intact(self):
        facts = [{"tool": "search_library", "result": {"matches": [{"id": str(i)} for i in range(30)], "nextOffset": 30}},
                 {"tool": "search_library", "cachedFrom": 0, "result": {"cached": True}}]
        page = result_page(facts, 1, 12, 12)
        self.assertEqual(page["observation"], 0)
        self.assertEqual([item["id"] for item in page["result"]["matches"]], [str(i) for i in range(12, 24)])
        self.assertEqual(page["nextResultOffset"], 24)
        self.assertEqual(page["result"]["nextOffset"], 30)
        original = {"tool": "search_paper_content", "result": {"matches": [
            {"hash": "paper", "passageId": "source-version", "text": "Exact original text", "sourceVersion": "v1"}]}}
        self.assertEqual(observation_view(original), original)

    def test_annotation_tools_have_bounded_reads_and_recall_groups(self):
        for name in ("get_paper_highlights", "get_paper_annotations"):
            schema = mcp_module().TOOLS[name][1]
            adapted = read_definition({"type": "function", "function": {"name": name, "parameters": schema}})
            self.assertEqual(adapted["function"]["parameters"]["properties"]["limit"]["maximum"], 5)
            self.assertEqual(read_arguments(name, {"id": "paper"})["limit"], 5)
            self.assertEqual(read_arguments(name, {"id": "paper", "limit": 50})["limit"], 5)
        facts = [{"tool": "get_paper_annotations", "result": {"id": "paper", "total": 20,
                  "groups": [{"groupId": str(i)} for i in range(20)], "nextOffset": None}}]
        page = result_page(facts, 0, 12, 5)
        self.assertEqual([group["groupId"] for group in page["result"]["groups"]], [str(i) for i in range(12, 17)])
        self.assertEqual(page["nextResultOffset"], 17)


@unittest.skipUnless(HAS_RUNTIME, "Install Agent runtime")
class GeneralTaskMemoryTests(LibraryFixture):
    def files(self):
        return {str(path.relative_to(self.library)): path.read_bytes() for path in self.library.rglob("*") if path.is_file()}

    def test_seventy_uncategorized_papers_produce_reviewable_plan_without_repeated_reads(self):
        papers = [self.paper([]) for _ in range(70)]
        for paper in papers:
            path = server.paper_dir_from_id(paper["id"]) / "metadata.json"
            metadata = server.read_json(path, {})
            metadata.update(abstract="Learning-based control and safe planning. " * 20,
                            threeLineSummary={"method": "Model predictive control"})
            server.write_json(path, metadata)
        for i in range(54):
            server.create_category("", f"Topic {i}")
        store = JobStore(self.root / "jobs.sqlite3")
        job, _ = store.create({"task": "梳理现有文献库没有分类的论文，提出一个分类计划", "agentVersion": "general-v1"}, self.library)
        case = self

        class Model:
            calls = 0
            async def complete(self, messages, tools):
                self.calls += 1
                context = json.loads(messages[-1]["content"])
                memory = context["workspace"]
                if self.calls == 1:
                    calls = [("discover_tools", {"names": ["library_overview", "search_library", "list_paper_summaries", "create_category", "batch_update_items"]})]
                elif self.calls in (2, 3):
                    calls = [("library_overview", {}), ("search_library", {"categoryIds": ["uncategorized"], "itemType": "paper", "offset": 0})]
                elif not memory["searches"][0]["complete"]:
                    calls = [("search_library", {"categoryIds": ["uncategorized"], "itemType": "paper", "offset": memory["searches"][0]["nextOffset"]})]
                else:
                    unread = [item["id"] for item in memory["items"] if not item.get("summaryRead")]
                    if unread:
                        calls = [("list_paper_summaries", {"hashes": unread[i:i + 12]}) for i in range(0, min(len(unread), 36), 12)]
                    else:
                        case.assertEqual(memory["itemCount"], 70)
                        case.assertEqual(memory["summaryReadCount"], 70)
                        case.assertEqual(len(memory["categories"]), 58)  # includes locked Uncategorized
                        case.assertEqual(len(memory["writeSchemas"]), 2)
                        case.assertLess(self.calls, 20)
                        calls = [("propose_library_plan", {"summary": "创建控制主题并归类全部70篇论文", "operations": [
                            {"id": "topic", "tool": "create_category", "arguments": {"name": "Control"}},
                            {"id": "group", "tool": "batch_update_items", "arguments": {"items": [
                                {"id": item["id"], "addCategoryIds": [{"ref": "topic.categoryId"}]} for item in memory["items"]]}}]})]
                return reply(calls, self.calls)

        counts = Counter()
        original_call = ResearchMCPClient.call
        async def observed(client, name, arguments):
            counts[name] += 1
            return await original_call(client, name, arguments)
        before = self.files()
        with patch.object(ResearchMCPClient, "call", observed):
            asyncio.run(execute_job(store, job["id"], 1, Model))
        pending = store.get(job["id"])
        self.assertEqual(pending["status"], "awaiting_approval", pending["error"])
        self.assertEqual(counts["library_overview"], 1)
        self.assertEqual(counts["search_library"], 3)
        self.assertEqual(counts["list_paper_summaries"], 6)
        preview = preview_plan(server, PlanStore(store), pending["result"]["planId"], job["id"])
        self.assertEqual(len(preview["preview"][1]["changes"]), 70)
        self.assertEqual(self.files(), before)

    def test_old_exhausted_checkpoint_recovers_into_plan_stage_without_new_reads(self):
        from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
        from langgraph.graph import END, START, StateGraph

        paper = self.paper([])
        store = JobStore(self.root / "jobs.sqlite3")
        job, _ = store.create({"task": "提出分类计划", "agentVersion": "general-v1"}, self.library)
        facts = [{"tool": "search_library", "arguments": {"categoryIds": ["uncategorized"]},
                  "result": {"totalMatches": 1, "matches": [paper], "nextOffset": None}}]
        async def seed():
            async with AsyncSqliteSaver.from_conn_string(str(store.path.with_name("library_agent_checkpoints.sqlite3"))) as saver:
                builder = StateGraph(LibraryState)
                builder.add_node("tools", lambda state: {})
                builder.add_node("agent", lambda state: {})
                builder.add_edge(START, "tools"); builder.add_edge("tools", "agent"); builder.add_edge("agent", END)
                graph = builder.compile(checkpointer=saver)
                await graph.aupdate_state({"configurable": {"thread_id": job["id"]}},
                    {"facts": facts, "catalog": [], "selected": ["search_library"], "rounds": 24, "tool_calls": 41}, as_node="tools")
        asyncio.run(seed())
        store.finish(job["id"], 1, "failed", error="通用任务达到分析预算")
        resumed = store.resume(job["id"], self.library)
        case = self
        class Model:
            async def complete(self, messages, tools):
                context = json.loads(messages[-1]["content"])
                case.assertEqual(context["taskPhase"], "finalizing")
                case.assertEqual(context["remainingModelCalls"], 4)
                case.assertEqual(context["workspace"]["items"][0]["id"], paper["id"])
                case.assertNotIn("search_library", [tool["function"]["name"] for tool in tools])
                return reply([("propose_library_plan", {"summary": "添加控制分类", "operations": [
                    {"id": "cat", "tool": "create_category", "arguments": {"name": "Control"}}]})], "recovered")
        before = self.files()
        with patch.object(ResearchMCPClient, "call", side_effect=AssertionError("Must reuse checkpoint results")):
            asyncio.run(execute_job(store, job["id"], resumed["attempt"], Model))
        pending = store.get(job["id"])
        self.assertEqual(pending["status"], "awaiting_approval", pending["error"])
        self.assertTrue(any(event.get("agent", {}).get("type") == "planning_recovered" for event in store.events(job["id"])))
        async def version():
            async with AsyncSqliteSaver.from_conn_string(str(store.path.with_name("library_agent_checkpoints.sqlite3"))) as saver:
                saved = await saver.aget_tuple({"configurable": {"thread_id": job["id"]}})
                return saved.checkpoint["channel_values"]["planning_version"]
        self.assertEqual(asyncio.run(version()), PLANNING_VERSION)
        self.assertEqual(self.files(), before)
