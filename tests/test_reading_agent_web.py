"""Web bridge validation, streaming, errors and process cleanup without a model."""

import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from unittest.mock import patch

from backend.reading_agent import web_bridge
from backend.reading_agent import service
from test_categories import LibraryFixture
import server


class DurableJobHTTPTests(LibraryFixture):
    def test_plan_routes_bind_approval_to_preview_and_reject_stale_or_cancelled_plans(self):
        from backend.reading_agent.plans import PlanStore

        class Handler(server.PaperReaderHandler):
            def log_message(self, *_args):
                pass

        httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        base = f"http://127.0.0.1:{httpd.server_port}/api/reading-agent/jobs"

        def request(suffix, data):
            req = urllib.request.Request(base + suffix, data=json.dumps(data).encode(),
                                         headers={"Content-Type": "application/json"})
            with opener.open(req, timeout=5) as response:
                return json.loads(response.read())

        def rejected(suffix, data, code):
            with self.assertRaises(urllib.error.HTTPError) as error:
                request(suffix, data)
            self.assertEqual(error.exception.code, code)

        try:
            with patch.object(server, "BASE_DIR", self.root), patch.object(service, "launch"):
                job = request("", {"task": "Organize"})["job"]
                store = service.store_for(self.library, self.root)
                plans = PlanStore(store)

                def propose(name):
                    plan = plans.create(job["id"], job["id"], {"summary": "Create category", "operations": [
                        {"id": "cat", "tool": "create_category", "arguments": {"name": name}}]})
                    store.finish(job["id"], store.get(job["id"])["attempt"], "awaiting_approval",
                                 {"kind": "plan", "planId": plan["id"], "report": "Plan"})
                    return {"jobId": job["id"], "planId": plan["id"]}

                payload = propose("Reviewed")
                rejected("/plan/approve", payload, 409)
                preview = request("/plan/preview", payload)["plan"]
                self.assertNotIn("Reviewed", server.load_library_db()["categories"])
                rejected("/plan/approve", {**payload, "digest": "wrong"}, 409)
                rejected("/plan/approve", {**payload, "digest": preview["digest"], "operations": []}, 400)
                with patch.object(server, "create_category", wraps=server.create_category) as create:
                    approved = request("/plan/approve", {**payload, "digest": preview["digest"]})
                    self.assertEqual(approved["plan"]["state"], "completed")
                    self.assertEqual(approved["job"]["status"], "queued")
                    request("/plan/approve", {**payload, "digest": preview["digest"]})
                    self.assertEqual(create.call_count, 1)

                payload = propose("Stale")
                preview = request("/plan/preview", payload)["plan"]
                server.create_category("", "Concurrent")
                stale = request("/plan/approve", {**payload, "digest": preview["digest"]})
                self.assertEqual(stale["plan"]["state"], "stale")
                self.assertEqual(stale["job"]["status"], "queued")
                self.assertNotIn("Stale", server.load_library_db()["categories"])
                rejected("/plan/approve", {**payload, "digest": "wrong"}, 409)
                replacement = request("/plan/retry", payload)
                self.assertNotEqual(replacement["plan"]["id"], payload["planId"])
                self.assertEqual(replacement["job"]["status"], "awaiting_approval")
                self.assertNotIn("Stale", server.load_library_db()["categories"])
                payload["planId"] = replacement["plan"]["id"]
                cancelled = request("/plan/cancel", payload)
                self.assertEqual(cancelled["job"]["status"], "cancelled")
                rejected("/resume", {"jobId": job["id"]}, 409)
                rejected("/plan/approve", {**payload, "digest": replacement["plan"]["digest"]}, 409)
                self.assertNotIn("Stale", server.load_library_db()["categories"])
                with patch.object(server, "LIBRARY_DIR", self.root / "other"):
                    rejected("/plan/preview", payload, 404)
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join(timeout=5)

    def test_create_replay_cancel_resume_save_and_library_isolation(self):
        class Handler(server.PaperReaderHandler):
            def log_message(self, *_args):
                pass

        httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        base = f"http://127.0.0.1:{httpd.server_port}/api/reading-agent/jobs"

        def request(suffix="", data=None):
            req = urllib.request.Request(base + suffix, data=json.dumps(data).encode() if data is not None else None,
                                         headers={"Content-Type": "application/json"})
            with opener.open(req, timeout=5) as response:
                return json.loads(response.read())

        try:
            with patch.object(server, "BASE_DIR", self.root), patch.object(service, "launch") as launch:
                payload = {"task": "Compare", "requestId": "c" * 32}
                job = request(data=payload)["job"]
                self.assertEqual(request(data=payload)["job"]["id"], job["id"])
                self.assertEqual(launch.call_count, 1)
                self.assertEqual(len(request()["jobs"]), 1)
                with self.assertRaises(urllib.error.HTTPError) as error:
                    request(data={"task": "Other"})
                self.assertEqual(error.exception.code, 409)
                self.assertEqual(request("/cancel", {"jobId": job["id"]})["job"]["status"], "cancelled")
                resumed = request("/resume", {"jobId": job["id"]})["job"]
                self.assertEqual(resumed["attempt"], 2)
                store = service.store_for(self.library, self.root)
                paper = self.paper()
                store.finish(job["id"], 2, "completed", result={"report": f"# Report heading\n\n[Paper](hash:{paper['id']})", "claims": []})
                self.assertEqual(request(f"/status?jobId={job['id']}")["job"]["status"], "completed")
                cursor = store.events(job["id"])[-2]["seq"]
                with opener.open(base + f"/events?jobId={job['id']}&after={cursor}", timeout=5) as response:
                    events = [json.loads(line[6:]) for line in response.read().decode().splitlines()
                              if line.startswith("data: {")]
                self.assertEqual([item["seq"] for item in events if "seq" in item], [store.events(job["id"])[-1]["seq"]])
                saved = request("/save", {"jobId": job["id"]})
                self.assertEqual(saved["job"]["noteId"], saved["note"]["id"])
                self.assertEqual(saved["note"]["title"], "Report heading")
                self.assertEqual(request("/save", {"jobId": job["id"]})["note"]["id"], saved["note"]["id"])
                original_id = saved["note"]["id"]
                server.archive_item(original_id)
                saved = request("/save", {"jobId": job["id"]})
                self.assertNotEqual(saved["note"]["id"], original_id)
                self.assertEqual(saved["job"]["noteId"], saved["note"]["id"])
                self.assertEqual(saved["note"]["title"], "Report heading")
                self.assertIn(original_id, server._load_archive_index()["items"])
                renamed = request("/rename", {"jobId": job["id"], "title": "Custom research title"})["job"]
                self.assertEqual(renamed["title"], "Custom research title")
                self.assertEqual(renamed["task"], "Compare")
                self.assertEqual(request("/title", {"jobId": job["id"], "title": "Late AI title", "expectedRevision": 0})["job"]["title"], "Custom research title")
                with self.assertRaises(urllib.error.HTTPError) as error:
                    request("/rename", {"jobId": job["id"], "title": " "})
                self.assertEqual(error.exception.code, 400)
                with patch.object(server, "LIBRARY_DIR", self.root / "different"):
                    with self.assertRaises(urllib.error.HTTPError) as error:
                        request(f"/status?jobId={job['id']}")
                    self.assertEqual(error.exception.code, 404)
                    with self.assertRaises(urllib.error.HTTPError) as error:
                        request("/delete", {"jobId": job["id"]})
                    self.assertEqual(error.exception.code, 404)
                followup_payload = {"jobId": job["id"], "requestId": "d" * 32, "task": "Explain the previous answer"}
                followup = request(data=followup_payload)["job"]
                self.assertEqual(followup["id"], job["id"])
                self.assertEqual(followup["conversation"][0]["task"], "Compare")
                self.assertEqual(followup["conversation"][0]["noteId"], saved["note"]["id"])
                self.assertEqual(followup["title"], "Custom research title")
                launch_count = launch.call_count
                self.assertEqual(request(data=followup_payload)["job"]["turnId"], "d" * 32)
                self.assertEqual(launch.call_count, launch_count)
                self.assertEqual(len(request()["jobs"]), 1)
                archived_save = request("/save", {"jobId": job["id"], "turnId": job["id"]})
                self.assertEqual(archived_save["note"]["id"], saved["note"]["id"])
                store.finish(job["id"], followup["attempt"], "completed", result={"report": f"Second answer [Paper](hash:{paper['id']})", "claims": []})
                second_save = request("/save", {"jobId": job["id"], "turnId": "d" * 32})
                self.assertNotEqual(second_save["note"]["id"], saved["note"]["id"])
                self.assertEqual(request("/save", {"jobId": job["id"], "turnId": "d" * 32})["note"]["id"], second_save["note"]["id"])
                self.assertIn("Second answer", second_save["note"]["notes"])
                self.assertEqual(request("/delete", {"jobId": job["id"]})["jobs"], [])
                self.assertIn(saved["note"]["id"], server.load_library_db()["papers"])
                with self.assertRaises(urllib.error.HTTPError) as error:
                    request(f"/status?jobId={job['id']}")
                self.assertEqual(error.exception.code, 404)
                running = request(data={"task": "Delete while running"})["job"]
                store.claim(running["id"], 1, 12345)
                request("/delete", {"jobId": running["id"]})
                self.assertFalse(store.alive(running["id"], 1))
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join(timeout=5)


class Process:
    def __init__(self, output="Report", progress=None, code=0):
        self.stdout = io.StringIO(output)
        self.stderr = io.StringIO(progress or json.dumps({"type": "model_started", "call": 1}) + "\n")
        self.returncode = code
        self.terminated = False

    def poll(self):
        return self.returncode

    def wait(self, **_kwargs):
        self.returncode = self.returncode or 0

    def terminate(self):
        self.terminated = True


class AgentWebBridgeTests(unittest.TestCase):
    def test_scope_validation_rejects_empty_or_unknown_requests(self):
        for payload in ({}, {"task": " "}, {"task": "x", "hashes": []}, {"task": "x", "hashes": "p"},
                        {"task": "x", "categoryIds": [1]}, {"task": "x", "libraryDir": "outside"}, []):
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                web_bridge.validate_request(payload)
        self.assertEqual(web_bridge.validate_request({"task": " compare ", "hashes": ["p", "p"]}),
                         {"task": "compare", "hashes": ["p"], "categoryIds": []})

    def test_cli_stream_passes_scope_as_arguments_and_returns_report(self):
        process = Process()
        with patch.object(web_bridge, "agent_python", return_value="python"), patch.object(web_bridge.subprocess, "Popen", return_value=process) as start:
            events = list(web_bridge.run_events(web_bridge.validate_request({"task": "compare", "hashes": ["p"], "categoryIds": ["A"]}), Path("library")))
        self.assertEqual(events[-1], {"report": "Report"})
        self.assertTrue(any(event.get("agent", {}).get("type") == "model_started" for event in events))
        args = start.call_args.args[0]
        self.assertIn("--hash=p", args)
        self.assertIn("--category=A", args)
        self.assertIn("--task=compare", args)
        self.assertNotIn("shell", start.call_args.kwargs)
        self.assertFalse(web_bridge.RUN_LOCK.locked())

    def test_failure_is_returned_and_generator_close_terminates_process(self):
        with patch.object(web_bridge, "agent_python", return_value="python"), patch.object(web_bridge.subprocess, "Popen", return_value=Process("", "模型配置无效\n", 1)):
            events = list(web_bridge.run_events(web_bridge.validate_request({"task": "compare"}), Path("library")))
        self.assertEqual(events[-1], {"error": "模型配置无效"})
        process = Process()
        process.returncode = None
        with patch.object(web_bridge, "agent_python", return_value="python"), patch.object(web_bridge.subprocess, "Popen", return_value=process):
            stream = web_bridge.run_events(web_bridge.validate_request({"task": "compare"}), Path("library"))
            next(stream)
            stream.close()
        self.assertTrue(process.terminated)
        self.assertFalse(web_bridge.RUN_LOCK.locked())

    def test_simultaneous_run_does_not_start_a_second_process(self):
        web_bridge.RUN_LOCK.acquire()
        try:
            with patch.object(web_bridge.subprocess, "Popen") as start:
                result = list(web_bridge.run_events(web_bridge.validate_request({"task": "compare"}), Path("library")))
                self.assertIn("error", result[0])
                start.assert_not_called()
        finally:
            web_bridge.RUN_LOCK.release()

    def test_http_route_streams_progress_and_rejects_invalid_scope(self):
        class Handler(server.PaperReaderHandler):
            def log_message(self, *_args):
                pass

        httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            with tempfile.TemporaryDirectory() as temporary, patch.object(server, "LIBRARY_DIR", Path(temporary)), patch.object(
                web_bridge, "run_events", return_value=iter([{"status": "读取中"}, {"report": "研究报告"}]),
            ) as run:
                url = f"http://127.0.0.1:{httpd.server_port}/api/reading-agent/run"
                request = urllib.request.Request(url, data=json.dumps({"task": "比较", "hashes": ["p"]}).encode(),
                                                 headers={"Content-Type": "application/json"})
                with opener.open(request) as response:
                    self.assertIn("text/event-stream", response.headers["Content-Type"])
                    text = response.read().decode("utf-8")
                self.assertIn("研究报告", text)
                self.assertIn("[DONE]", text)
                self.assertEqual(run.call_args.args[0], {"task": "比较", "hashes": ["p"], "categoryIds": []})
                self.assertEqual(run.call_args.args[1], Path(temporary))
                invalid = urllib.request.Request(url, data=b'{"task":"x","hashes":[]}', headers={"Content-Type": "application/json"})
                with self.assertRaises(urllib.error.HTTPError) as error:
                    opener.open(invalid)
                self.assertEqual(error.exception.code, 400)
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join(timeout=5)
