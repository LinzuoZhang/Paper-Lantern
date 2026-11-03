import asyncio
import hashlib
import json
import os
from pathlib import Path
import tempfile
import subprocess
import sys
import time
import urllib.request
import unittest
from unittest.mock import patch

import server
from backend.reading_agent.demo import DEMO_IDS, DEMO_TASK, DemoModelServer, create_demo_library
from backend.reading_agent.evidence import audit_report, quote_span, register_claim, report_title, report_with_paper_links, source_signatures
from backend.reading_agent.model import ConfiguredModel
from backend.reading_agent.state import AgentError
from backend.reading_agent.store import JobConflict, JobStore
from backend.reading_agent.worker import execute_job
from backend.reading_agent import service
from test_categories import LibraryFixture
from test_reading_agent import HAS_RUNTIME


class JobStoreTests(unittest.TestCase):
    def test_followup_preserves_turns_scope_notes_title_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            store = JobStore(Path(directory) / "jobs.sqlite3")
            job, _ = store.create({"task": "Initial", "hashes": ["paper"], "categoryIds": []}, directory)
            store.rename(job["id"], directory, "My topic")
            store.finish(job["id"], 1, "completed", {"report": "Initial answer", "claims": [{"claimId": "C1"}]})
            store.set_note(job["id"], "first-note")
            request = {"task": "Explain it", "hashes": [], "categoryIds": []}
            followup, created = store.follow_up(job["id"], directory, request, "1" * 32)
            self.assertTrue(created)
            self.assertEqual(followup["id"], job["id"])
            self.assertEqual(followup["attempt"], 2)
            self.assertEqual(followup["request"]["hashes"], ["paper"])
            self.assertEqual(followup["title"], "My topic")
            self.assertIsNone(followup["result"])
            self.assertIsNone(followup["note_id"])
            self.assertEqual(followup["conversation"][0]["result"]["report"], "Initial answer")
            self.assertEqual(followup["conversation"][0]["noteId"], "first-note")
            self.assertFalse(store.follow_up(job["id"], directory, request, "1" * 32)[1])
            self.assertFalse(store.finish(job["id"], 1, "completed", {"report": "stale"}))
            with self.assertRaises(JobConflict):
                store.follow_up(job["id"], directory, {**request, "task": "Changed"}, "1" * 32)
            with self.assertRaises(JobConflict):
                store.follow_up(job["id"], directory, request, "2" * 32)
            with self.assertRaises(FileNotFoundError):
                store.follow_up(job["id"], Path(directory) / "other", request, "2" * 32)
            store.finish(job["id"], 2, "completed", {"report": "Second answer"})
            next_turn, _ = store.follow_up(job["id"], directory, {**request, "hashes": ["new-paper"]}, "2" * 32, replace_scope=True)
            self.assertEqual(next_turn["request"]["hashes"], ["new-paper"])
            self.assertEqual(len(next_turn["conversation"]), 2)
            self.assertEqual(len(store.list(directory)), 1)
            self.assertEqual(len(JobStore(store.path).get(job["id"])["conversation"]), 2)
            self.assertNotIn("conversation", store.list(directory)[0])
            self.assertEqual(store.public(next_turn)["turnId"], "2" * 32)
            self.assertGreater(store.public(next_turn)["eventAfter"], 0)

    def test_titles_are_separate_from_tasks_and_manual_titles_win_late_generation(self):
        with tempfile.TemporaryDirectory() as directory:
            store = JobStore(Path(directory) / "jobs.sqlite3")
            job, _ = store.create({"task": "Original research question"}, directory)
            public = store.public(job)
            self.assertEqual(public["title"], "Original research question")
            self.assertEqual(public["titleRevision"], 0)
            manual = store.rename(job["id"], directory, "  Custom title  ")
            late = store.rename(job["id"], directory, "Generated title", generated=True, expected_revision=0)
            self.assertEqual(late["title"], "Custom title")
            self.assertEqual(late["request"]["task"], "Original research question")
            self.assertEqual(late["title_revision"], manual["title_revision"])
            store.cancel(job["id"], directory)
            second, _ = store.create({"task": "Second task"}, directory)
            generated = store.rename(second["id"], directory, "Generated", generated=True, expected_revision=0)
            self.assertEqual(generated["title_source"], "generated")
            stale = store.rename(second["id"], directory, "Duplicate generation", generated=True, expected_revision=0)
            self.assertEqual(stale["title"], "Generated")
            for title in ("", " " * 3, "x" * 121, [], None):
                with self.assertRaises(ValueError):
                    store.rename(second["id"], directory, title)
            with self.assertRaises(FileNotFoundError):
                store.rename(second["id"], Path(directory) / "other", "Outside")

    def test_deleted_running_conversations_stop_and_cannot_return_on_worker_finish(self):
        with tempfile.TemporaryDirectory() as directory:
            store = JobStore(Path(directory) / "jobs.sqlite3")
            job, _ = store.create({"task": "Original"}, directory, "e" * 32)
            store.claim(job["id"], 1, os.getpid())
            store.delete(job["id"], directory)
            self.assertFalse(store.alive(job["id"], 1))
            self.assertFalse(store.finish(job["id"], 1, "completed", {"report": "late response"}))
            self.assertEqual(store.list(directory), [])
            with self.assertRaises(FileNotFoundError):
                store.get(job["id"])
            with self.assertRaises(JobConflict):
                store.create({"task": "Original"}, directory, "e" * 32)
            next_job, _ = store.create({"task": "New"}, directory)
            self.assertEqual(len(store.list(directory)), 1)
            self.assertEqual(store.list(directory)[0]["id"], next_job["id"])

    def test_existing_job_databases_migrate_titles_without_losing_data(self):
        import sqlite3
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "jobs.sqlite3"
            store = JobStore(path)
            job, _ = store.create({"task": "Legacy research"}, directory)
            with store.connect() as db:
                for name in ("title", "title_source", "title_revision", "deleted_at"):
                    db.execute(f"ALTER TABLE jobs DROP COLUMN {name}")
            migrated = JobStore(path)
            self.assertEqual(migrated.public(migrated.get(job["id"]))["title"], "Legacy research")
            self.assertTrue(migrated.events(job["id"]))

    def test_launcher_pid_does_not_prevent_redirected_python_worker_claim(self):
        with tempfile.TemporaryDirectory() as directory:
            store = JobStore(Path(directory) / "jobs.sqlite3")
            job, _ = store.create({"task": "Compare"}, directory)
            with patch.object(service, "agent_python", return_value="python"), patch.object(service.subprocess, "Popen") as start:
                start.return_value.pid = 1001
                service.launch(store, job)
            self.assertTrue(store.claim(job["id"], 1, 2002))

    def test_invalid_runtime_path_is_a_durable_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            store = JobStore(Path(directory) / "jobs.sqlite3")
            job, _ = store.create({"task": "Compare"}, directory)
            with patch.object(service, "agent_python", side_effect=ValueError("invalid path")):
                service.launch(store, job)
            self.assertEqual(store.get(job["id"])["status"], "failed")

    def test_idempotency_leases_cancellation_and_event_replay(self):
        with tempfile.TemporaryDirectory() as directory:
            store = JobStore(Path(directory) / "jobs.sqlite3")
            request = {"task": "Compare", "hashes": [], "categoryIds": []}
            job, created = store.create(request, directory, "a" * 32)
            self.assertTrue(created)
            self.assertFalse(store.create(request, directory, "a" * 32)[1])
            with self.assertRaises(JobConflict):
                store.create({**request, "task": "Different"}, directory, "a" * 32)
            with self.assertRaises(JobConflict):
                store.create(request, directory)
            self.assertTrue(store.claim(job["id"], 1, os.getpid()))
            self.assertFalse(store.claim(job["id"], 1, os.getpid()))
            store.cancel(job["id"], directory)
            store.finish(job["id"], 1, "completed", {"report": "late result"})
            self.assertEqual(store.get(job["id"])["status"], "cancelled")
            resumed = store.resume(job["id"], directory)
            self.assertEqual(resumed["attempt"], 2)
            self.assertFalse(store.finish(job["id"], 1, "completed", {}), "An old worker cannot overwrite a newer attempt")
            events = store.events(job["id"])
            self.assertEqual(store.events(job["id"], events[-2]["seq"]), events[-1:])
            self.assertEqual(JobStore(store.path).get(job["id"])["attempt"], 2)

    def test_stale_worker_becomes_resumable_and_library_binding_is_checked(self):
        with tempfile.TemporaryDirectory() as directory:
            store = JobStore(Path(directory) / "jobs.sqlite3")
            job, _ = store.create({"task": "Compare"}, directory)
            with store.connect() as db:
                db.execute("UPDATE jobs SET heartbeat=0 WHERE id=?", (job["id"],))
            self.assertEqual(store.get(job["id"])["status"], "interrupted")
            with self.assertRaises(FileNotFoundError):
                store.get(job["id"], Path(directory) / "other")
            with self.assertRaises(ValueError):
                store.get("../../outside")


class EvidenceTests(unittest.TestCase):
    def test_claim_citations_use_all_distinct_library_papers_and_preserve_code(self):
        raw = "Finding [C1]; inference [C2]. Existing [Paper](hash:a). Code `[C1]`.\n```text\n[C2]\n```"
        result = {"report": raw, "claims": [
            {"claimId": "C1", "supports": [{"hash": "a"}, {"hash": "a"}, {"hash": "b"}]},
            {"claimId": "C2", "supports": [{"hash": "b"}]},
        ], "verification": {"reportDigest": "original"}}
        linked = report_with_paper_links(result, {"a": {"title": "Paper [A]"}, "b": {"title": "Paper B"}})
        self.assertIn("Finding [C1](hash:a)、[C1](hash:b)", linked["report"])
        self.assertIn("inference [C2](hash:b)", linked["report"])
        self.assertIn("Existing [Paper](hash:a)", linked["report"])
        self.assertIn("`[C1]`", linked["report"])
        self.assertIn("```text\n[C2]\n```", linked["report"])
        self.assertEqual(linked["verification"]["reportDigest"], hashlib.sha256(linked["report"].encode()).hexdigest())
        self.assertEqual(result["report"], raw)
        self.assertEqual(report_with_paper_links(linked, {"a": {"title": "Paper [A]"}, "b": {"title": "Paper B"}}), linked)

    def test_quote_normalization_preserves_original_unicode_offsets(self):
        text = "Prefix: ﬁle café evidence."
        start, end = quote_span(text, "file cafe\u0301 evidence.")
        self.assertEqual(text[start:end], "ﬁle café evidence.")

    def test_quotes_are_original_and_claims_link_to_exact_offsets(self):
        passage = {"hash": "paper", "source": "full_text", "text": "前言\nOur method uses 10 seeds.\n结束", "sourceVersion": "v1",
                   "pageNumber": 3, "startChar": 100, "offsetScope": "page", "textOrigin": "pdf"}
        args = {"statement": "Ten seeds were used", "kind": "finding", "supports": [{"passageId": "p1", "quote": "Our method uses 10 seeds."}]}
        claim = register_claim(args, {"p1": passage}, {})
        self.assertEqual(claim["claimId"], "C1")
        self.assertEqual(claim["supports"][0]["startChar"], 103)
        self.assertEqual(claim["supports"][0]["pageNumber"], 3)
        self.assertEqual(register_claim(args, {"p1": passage}, {"C1": claim}), claim)
        for support in ({"passageId": "unknown", "quote": "Our method uses 10 seeds."},
                        {"passageId": "p1", "quote": "Our method uses 100 seeds."}):
            with self.assertRaises(ValueError):
                register_claim({**args, "supports": [support]}, {"p1": passage}, {})
        self.assertEqual(audit_report("A finding [C1]", {"C1": claim})["claimCount"], 1)
        with self.assertRaises(ValueError):
            audit_report("A finding [C9]", {"C1": claim})
        with self.assertRaises(ValueError):
            audit_report("Only code `[C1]`", {"C1": claim})


@unittest.skipUnless(HAS_RUNTIME, "Install Agent runtime")
class DurableWorkerTests(unittest.TestCase):
    def test_real_detached_worker_survives_http_server_exit(self):
        with tempfile.TemporaryDirectory() as directory, DemoModelServer() as fixture:
            root = Path(directory)
            library = create_demo_library(root / "library")
            project = Path(server.__file__).parent
            scripts = root / "scripts"
            scripts.mkdir()
            wrapper = (f"import sys,runpy,asyncio\nsys.path.insert(0,{str(project)!r})\n"
                       "from backend.reading_agent import model\nOriginal=model.ConfiguredModel\n"
                       "class OfflineModel(Original):\n"
                       f" def __init__(self): super().__init__(connection=('offline','offline',{fixture.url!r},False),custom_prompt='')\n"
                       " async def stream_complete(self,messages,tools,on_delta):\n  await asyncio.sleep(.5)\n  return await super().stream_complete(messages,tools,on_delta)\n"
                       "model.ConfiguredModel=OfflineModel\n"
                       f"runpy.run_path({str(project / 'scripts/run_reading_agent.py')!r},run_name='__main__')\n")
            (scripts / "run_reading_agent.py").write_text(wrapper, encoding="utf-8")
            code = ("from http.server import ThreadingHTTPServer\nimport server\nfrom backend.reading_agent import service\n"
                    f"service.PROJECT_ROOT=server.BASE_DIR=server.Path({str(root)!r})\n"
                    "httpd=ThreadingHTTPServer(('127.0.0.1',0),server.PaperReaderHandler)\n"
                    "print(httpd.server_port,flush=True)\nhttpd.serve_forever()\n")
            # Use the actual interpreter for the server so terminate() targets
            # it directly, rather than a Windows virtualenv redirector.
            process = subprocess.Popen([getattr(sys, "_base_executable", sys.executable), "-X", "utf8", "-c", code],
                                       cwd=project, env={**os.environ, "PAPER_LIBRARY_DIR": str(library)},
                                       stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            store = service.store_for(library, root)
            try:
                port = int(process.stdout.readline())
                url = f"http://127.0.0.1:{port}/api/reading-agent/jobs"
                req = urllib.request.Request(url, data=json.dumps({"task": DEMO_TASK}).encode(), headers={"Content-Type": "application/json"})
                with opener.open(req, timeout=5) as response:
                    job = json.load(response)["job"]
                with opener.open(url + "/events?jobId=" + job["id"], timeout=5) as response:
                    self.assertTrue(response.readline().startswith(b"data:"))
                process.terminate()
                process.wait(timeout=5)
                deadline = time.monotonic() + 20
                while time.monotonic() < deadline:
                    current = store.get(job["id"])
                    if current["status"] not in {"queued", "running"}:
                        break
                    time.sleep(.1)
                self.assertEqual(current["status"], "completed", current["error"])
                self.assertTrue(current["result"]["verification"]["checks"]["sourcesRevalidated"])
            finally:
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=5)
                process.stdout.close()

    def test_cancel_retains_checkpoint_and_source_change_blocks_resume(self):
        with tempfile.TemporaryDirectory() as directory, DemoModelServer() as fixture:
            library = create_demo_library(Path(directory) / "library")
            store = JobStore(Path(directory) / "jobs.sqlite3")
            job, _ = store.create({"task": DEMO_TASK}, library)
            base = ConfiguredModel(connection=("offline", "offline", fixture.url, False), custom_prompt="")

            class CancellingModel:
                calls = 0

                async def complete(self, messages, tools):
                    self.calls += 1
                    if self.calls == 3:
                        store.cancel(job["id"], library)
                        await asyncio.sleep(5)
                        raise AssertionError("Cancellation monitor did not stop the model")
                    reply = await base.complete(messages, tools)
                    reply["reasoning_content"] = "PRIVATE_REASONING_SENTINEL_47382"
                    return reply

            asyncio.run(execute_job(store, job["id"], 1, CancellingModel))
            self.assertEqual(store.get(job["id"])["status"], "cancelled")
            checkpoint = Path(directory) / "checkpoints.sqlite3"
            self.assertNotIn(b"PRIVATE_REASONING_SENTINEL_47382", checkpoint.read_bytes())
            manifest = json.loads((library / "library_db.json").read_text(encoding="utf-8"))
            folder = manifest["papers"][DEMO_IDS[0]]["folder"]
            (library / folder / "extracted_text.txt").write_text("Changed original evidence", encoding="utf-8")
            resumed = store.resume(job["id"], library)
            model = CancellingModel()
            asyncio.run(execute_job(store, job["id"], resumed["attempt"], lambda: model))
            self.assertEqual(model.calls, 0, "Stale evidence must be rejected before a model call")
            self.assertEqual(store.get(job["id"])["status"], "failed")
            self.assertIn("原文", store.get(job["id"])["error"])

    def test_completed_checkpoint_recovers_result_without_another_model_call(self):
        from backend.reading_agent.graph import ReadingAgent
        from backend.reading_agent.state import AgentOptions

        with tempfile.TemporaryDirectory() as directory, DemoModelServer() as fixture:
            library = create_demo_library(Path(directory) / "library")
            checkpoint = Path(directory) / "checkpoints.sqlite3"
            options = AgentOptions(task=DEMO_TASK, library_dir=library)
            model = ConfiguredModel(connection=("offline", "offline", fixture.url, False), custom_prompt="")
            original = asyncio.run(ReadingAgent(options, model, checkpoint_path=checkpoint, thread_id="finished").run())
            with patch.object(model, "complete", side_effect=AssertionError("Repeated completed model run")):
                recovered = asyncio.run(ReadingAgent(options, model, checkpoint_path=checkpoint, thread_id="finished").run())
            self.assertEqual(recovered["report"], original["report"])
            self.assertEqual(recovered["modelCalls"], original["modelCalls"])

    def test_worker_completes_with_checked_claims_and_persistent_checkpoint(self):
        with tempfile.TemporaryDirectory() as directory, DemoModelServer() as fixture:
            library = create_demo_library(Path(directory) / "library")
            store = JobStore(Path(directory) / "jobs.sqlite3")
            job, _ = store.create({"task": DEMO_TASK}, library)
            factory = lambda: ConfiguredModel(connection=("offline", "offline", fixture.url, False), custom_prompt="")
            asyncio.run(execute_job(store, job["id"], 1, factory))
            completed = JobStore(store.path).get(job["id"])
            self.assertEqual(completed["status"], "completed", completed["error"])
            self.assertEqual(completed["result"]["verification"]["claimCount"], 1)
            self.assertEqual(completed["result"]["verification"]["reportDigest"],
                             hashlib.sha256(completed["result"]["report"].encode()).hexdigest())
            self.assertTrue(completed["result"]["verification"]["checks"]["sourcesRevalidated"])
            self.assertTrue((Path(directory) / "checkpoints.sqlite3").exists())
            self.assertEqual(completed["result"]["readPaperIds"], sorted(DEMO_IDS))
            first_call_count = len(fixture.requests)
            followup, _ = store.follow_up(job["id"], library, {"task": "Explain that comparison"}, "f" * 32)
            asyncio.run(execute_job(store, job["id"], followup["attempt"], factory))
            second = store.get(job["id"])
            self.assertEqual(second["status"], "completed", second["error"])
            self.assertGreater(len(fixture.requests), first_call_count)
            context = fixture.requests[first_call_count]["messages"][-1]["content"]
            self.assertIn(DEMO_TASK, context)
            self.assertIn(completed["result"]["report"], json.loads(context.split("\n", 1)[1].split("\n\n", 1)[0])[0]["answer"])
            self.assertIn("Explain that comparison", context)
            self.assertEqual(second["result"]["readPaperIds"], sorted(DEMO_IDS))
            self.assertEqual(len(second["conversation"]), 1)

    def test_resume_uses_completed_read_checkpoint_without_repeating_model_reads(self):
        with tempfile.TemporaryDirectory() as directory, DemoModelServer() as fixture:
            library = create_demo_library(Path(directory) / "library")
            store = JobStore(Path(directory) / "jobs.sqlite3")
            job, _ = store.create({"task": DEMO_TASK}, library)
            base = ConfiguredModel(connection=("offline", "offline", fixture.url, False), custom_prompt="")

            class FailingModel:
                calls = 0

                async def complete(self, messages, tools):
                    self.calls += 1
                    if self.calls == 3:
                        raise AgentError("模拟断线")
                    return await base.complete(messages, tools)

            asyncio.run(execute_job(store, job["id"], 1, FailingModel))
            self.assertEqual(store.get(job["id"])["status"], "failed")

            class ResumedModel:
                calls = 0

                async def complete(self, messages, _tools):
                    self.calls += 1
                    if self.calls == 1:
                        context = json.loads(messages[-1]["content"].split("\n", 1)[1])
                        args = {"statement": "Toy runtime comparison", "kind": "finding", "supports": [
                            {"passageId": p["passageId"], "quote": p["text"]} for p in context["evidence"]
                        ]}
                        return {"role": "assistant", "content": "", "tool_calls": [{"id": "claim", "type": "function",
                                "function": {"name": "record_claim", "arguments": json.dumps(args)}}]}
                    return {"role": "assistant", "content": "[Flow](hash:p0-flow-control) and [Baseline](hash:p0-baseline-control) are synthetic toy comparisons [C1]."}

            resumed = store.resume(job["id"], library)
            asyncio.run(execute_job(store, job["id"], resumed["attempt"], ResumedModel))
            completed = store.get(job["id"])
            self.assertEqual(completed["status"], "completed", completed["error"])
            self.assertEqual(completed["result"]["modelCalls"], 4)
            self.assertEqual(completed["result"]["toolCalls"], 4)
            self.assertTrue(any(event.get("agent", {}).get("type") == "checkpoint_resumed" for event in store.events(job["id"])))


class ReportSaveTests(LibraryFixture):
    def test_legacy_citations_are_linked_in_current_answers_history_and_saved_notes(self):
        paper = self.paper()
        result = {"report": "# Report\n\nA supported finding [C1].", "claims": [
            {"claimId": "C1", "kind": "finding", "statement": "A supported finding", "supports": [{"hash": paper["id"]}]}]}
        expected = f"# Report\n\nA supported finding [C1](hash:{paper['id']})."
        store = JobStore(self.root / "jobs.sqlite3")
        job, _ = store.create({"task": "Compare"}, self.library)
        store.finish(job["id"], 1, "completed", result)
        self.assertEqual(store.public(store.get(job["id"]))["result"]["report"], expected)
        self.assertEqual(store.get(job["id"])["result"]["report"], result["report"])
        handler = object.__new__(server.PaperReaderHandler)
        note, _ = handler._save_agent_report(store, store.get(job["id"]), {})
        self.assertEqual(note["notes"], expected)
        store.follow_up(job["id"], self.library, {"task": "Follow up"}, "f" * 32)
        self.assertEqual(store.public(store.get(job["id"]))["conversation"][0]["result"]["report"], expected)
        historical, _ = handler._save_agent_report(store, store.get(job["id"]), {"turnId": job["id"]})
        self.assertEqual(historical["notes"], expected)

    def test_report_title_comes_from_markdown_heading_without_formatting(self):
        self.assertEqual(report_title("```markdown\n# Code example\n```\n\n# **Control: methods / experiments?** [C1]\n"),
                         "Control: methods / experiments?")
        self.assertEqual(report_title("A `Q_learning` report\n=====================\n\nBody"), "A Q_learning report")
        self.assertEqual(report_title("## Section\n\n# Actual report title"), "Actual report title")
        self.assertEqual(report_title("No heading", "Conversation title"), "Conversation title")

    def test_report_save_is_idempotent_and_preserves_user_edits(self):
        paper = self.paper()
        directory = server.paper_dir_from_id(paper["id"])
        server.write_text_file(directory / server.EXTRACTED_TEXT_FILE, "Original evidence for the research report.")
        evidence = {"p": {"hash": paper["id"], "passageId": "p", "textOrigin": "cache"}}
        result = {"report": f"# **Control: methods / experiments?**\n\n[Paper](hash:{paper['id']}) supports this finding [C1].", "evidence": list(evidence.values()), "claims": [],
                  "verification": {"sourceSignatures": source_signatures(self.library, evidence)}}
        store = JobStore(self.root / "jobs.sqlite3")
        job, _ = store.create({"task": "Compare", "categoryIds": ["A"]}, self.library)
        store.finish(job["id"], 1, "completed", result)
        handler = object.__new__(server.PaperReaderHandler)
        note, created = handler._save_agent_report(store, store.get(job["id"]), {})
        self.assertTrue(created)
        self.assertEqual(note["title"], "Control: methods / experiments?")
        server.write_paper_notes(server.paper_dir_from_id(note["id"]), "User edited note")
        second, created = handler._save_agent_report(store, store.get(job["id"]), {})
        self.assertFalse(created)
        self.assertEqual(second["id"], note["id"])
        self.assertEqual(second["notes"], "User edited note")
        self.assertEqual(sum(p.get("itemType") == "note" for p in server.load_library_db()["papers"].values()), 1)

    def test_missing_report_notes_are_recreated_without_changing_archived_notes(self):
        paper = self.paper()
        result = {"report": f"# Report heading\n\n[Paper](hash:{paper['id']})", "claims": []}
        store = JobStore(self.root / "jobs.sqlite3")
        job, _ = store.create({"task": "Initial research"}, self.library)
        store.finish(job["id"], 1, "completed", result)
        handler = object.__new__(server.PaperReaderHandler)

        def save(turn_id=None):
            return handler._save_agent_report(store, store.get(job["id"]), {"turnId": turn_id} if turn_id else {})

        original, _ = save()
        server.write_paper_notes(server.paper_dir_from_id(original["id"]), "Archived user edits")
        archived = server.archive_item(original["id"])
        replacement, created = save()
        self.assertTrue(created)
        self.assertNotEqual(replacement["id"], original["id"])
        self.assertEqual(replacement["title"], "Report heading")
        self.assertEqual(server.read_text_file(Path(archived["archivePath"]) / server.NOTES_FILE), "Archived user edits")
        self.assertEqual(store.get(job["id"])["note_id"], replacement["id"])
        self.assertEqual(save()[0]["id"], replacement["id"])
        self.assertFalse(save()[1])
        server.delete_item(replacement["id"], permanent=True)
        recreated, created = save()
        self.assertTrue(created)
        self.assertNotEqual(recreated["id"], replacement["id"])
        # Also recover an index entry whose physical folder has gone missing.
        folder = server.paper_dir_from_id(recreated["id"]).resolve()
        detached = (self.root / "detached-note").resolve()
        self.assertTrue(folder.is_relative_to(self.root.resolve()))
        self.assertTrue(detached.is_relative_to(self.root.resolve()))
        folder.rename(detached)
        recovered, created = save()
        self.assertTrue(created)
        self.assertNotEqual(recovered["id"], recreated["id"])
        store.follow_up(job["id"], self.library, {"task": "Follow-up"}, "f" * 32)
        server.delete_item(recovered["id"], permanent=True)
        historical, created = save(job["id"])
        self.assertTrue(created)
        self.assertEqual(historical["title"], "Report heading")
        updated = store.get(job["id"])
        self.assertEqual(updated["conversation"][0]["noteId"], historical["id"])
        self.assertIsNone(updated["note_id"])

    def test_changed_original_cannot_be_saved_as_verified_report(self):
        paper = self.paper()
        path = server.paper_dir_from_id(paper["id"]) / server.EXTRACTED_TEXT_FILE
        server.write_text_file(path, "Original evidence")
        evidence = {"p": {"hash": paper["id"], "passageId": "p", "textOrigin": "cache"}}
        result = {"report": f"[Paper](hash:{paper['id']}) [C1]", "evidence": list(evidence.values()), "claims": [],
                  "verification": {"sourceSignatures": source_signatures(self.library, evidence)}}
        store = JobStore(self.root / "jobs.sqlite3")
        job, _ = store.create({"task": "Compare"}, self.library)
        store.finish(job["id"], 1, "completed", result)
        note, _ = object.__new__(server.PaperReaderHandler)._save_agent_report(store, store.get(job["id"]), {})
        server.archive_item(note["id"])
        server.write_text_file(path, "Changed evidence")
        with self.assertRaisesRegex(ValueError, "原文已变化"):
            object.__new__(server.PaperReaderHandler)._save_agent_report(store, store.get(job["id"]), {})
        self.assertEqual(sum(p.get("itemType") == "note" for p in server.load_library_db()["papers"].values()), 0)
