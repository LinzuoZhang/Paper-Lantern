"""Search adapters, bounded page reading and public-network boundaries."""

import asyncio
from copy import deepcopy
from email.message import Message
import io
import json
import os
from pathlib import Path
import socket
import tempfile
import threading
from types import SimpleNamespace
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from unittest.mock import patch

import server
from backend import web_search as web
from backend.reading_agent.capabilities import mcp_module
from backend.reading_agent.context import json_size
from backend.reading_agent.library_context import cached_read, read_definition, result_page, task_memory, web_read_arguments
from backend.reading_agent.library_agent import LibraryAgent
from backend.reading_agent.mcp_client import ResearchMCPClient
from backend.reading_agent.store import JobStore
from backend.reading_agent.worker import execute_job
from test_categories import LibraryFixture
from test_reading_agent import HAS_RUNTIME


URL = "https://example.com/article"


def headers(content_type="text/html; charset=utf-8"):
    value = Message()
    value["Content-Type"] = content_type
    return value


class WebSearchTests(unittest.TestCase):
    def test_providers_normalize_results_and_keep_credentials_out_of_observations(self):
        for provider in ("tavily", "brave", "searxng"):
            row = {"url": URL, "title": "A source", "content": "Search snippet", "description": "Search snippet", "published_date": "2026-11-20"}
            rows = [row, row, {"url": "file:///secret"}]
            payload = {"web": {"results": rows}} if provider == "brave" else {"results": rows}
            config = {"PROVIDER": provider, "API_KEY": "SECRET_SENTINEL", "SEARXNG_URL": "http://localhost:8080/base"}
            with self.subTest(provider=provider), patch.object(web, "search_config", return_value=config), patch.object(web, "request_bytes", return_value=(json.dumps(payload).encode(), headers(), URL)) as fetch:
                result = web.web_search("  latest research  ", base_dir=".")
                self.assertEqual(len(result["results"]), 1)
                self.assertFalse(result["results"][0]["contentRead"])
                self.assertEqual(result["query"], "latest research")
                self.assertNotIn("SECRET_SENTINEL", json.dumps(result))
                if provider == "searxng":
                    self.assertTrue(fetch.call_args.args[0].startswith("http://localhost:8080/base/search?"))
                    self.assertFalse(fetch.call_args.kwargs["public_only"])
                elif provider == "tavily":
                    self.assertFalse(fetch.call_args.kwargs["payload"]["include_raw_content"])

    def test_config_file_environment_precedence_and_missing_key_error(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {}, clear=True):
            path = Path(directory) / ".env" / "web_search.env"
            path.parent.mkdir()
            path.write_text('# comment\nPAPER_LANTERN_SEARCH_PROVIDER="brave"\nPAPER_LANTERN_SEARCH_API_KEY=file-secret\n', encoding="utf-8-sig")
            self.assertEqual(web.search_config(directory)["PROVIDER"], "brave")
            with patch.dict(os.environ, {"PAPER_LANTERN_SEARCH_API_KEY": "env-secret"}):
                self.assertEqual(web.search_config(directory)["API_KEY"], "env-secret")
            path.unlink()
            with patch.object(web, "request_bytes") as fetch, self.assertRaisesRegex(ValueError, "尚未配置"):
                web.web_search("query", base_dir=directory)
            fetch.assert_not_called()

    def test_page_pagination_ignores_scripts_and_rejects_changed_source(self):
        html = '<title>Source &amp; title</title><nav>Navigation</nav><script>SECRET SCRIPT</script><main><p>' + "正文 Evidence " * 500 + '</p></main><footer>Footer</footer>'
        with patch.object(web, "request_bytes", return_value=(html.encode(), headers(), URL)):
            first = web.read_web_page(URL)
            second = web.read_web_page(URL, first["nextOffset"], source_version=first["sourceVersion"])
            text = "".join(item["text"] for item in first["passages"] + second["passages"])
            self.assertNotIn("Navigation", text)
            self.assertNotIn("SECRET SCRIPT", text)
            self.assertNotIn("Footer", text)
            self.assertEqual(first["title"], "Source & title")
            self.assertEqual(first["nextOffset"], 3)
            self.assertIsNone(second["nextOffset"])
            self.assertEqual(first["sourceVersion"], second["sourceVersion"])
            with self.assertRaisesRegex(ValueError, "content changed"):
                web.read_web_page(URL, 3, source_version="old")
        with patch.object(web, "request_bytes", return_value=(b"x" * 30_000, headers("text/plain"), URL)):
            result = web.read_web_page(URL, 18)
            self.assertTrue(result["truncated"])
            self.assertEqual(result["totalPassages"], 20)
            self.assertIsNone(result["nextOffset"])
        for content_type, body in (("application/pdf", b"%PDF"), ("text/html", b"<script>app()</script>")):
            with patch.object(web, "request_bytes", return_value=(body, headers(content_type), URL)), self.assertRaises(ValueError):
                web.read_web_page(URL)

    def test_url_validation_and_dns_reject_private_or_mixed_addresses(self):
        for url in ("file:///secret", "http://user:pass@example.com", "https://example.com:8080", "https://example.com/\r\nInjected:yes"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                web.clean_url(url)
        self.assertEqual(web.clean_url("http://localhost:8080", configured_service=True), "http://localhost:8080/")
        self.assertEqual(web.clean_url("https://example.com/中文?q=测试"), "https://example.com/%E4%B8%AD%E6%96%87?q=%E6%B5%8B%E8%AF%95")
        for ip in ("127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "::ffff:127.0.0.1", "224.0.0.1"):
            records = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443)),
                       (socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 443))]
            with self.subTest(ip=ip), patch.object(web.socket, "getaddrinfo", return_value=records), self.assertRaisesRegex(ValueError, "公网"):
                web.public_addresses("example.com", 443)

    def test_transport_checks_redirects_limits_and_hides_upstream_errors(self):
        class Response:
            status = 200
            headers = headers()
            def __init__(self, data=b"ok"):
                self.body = io.BytesIO(data)
            def getheader(self, name, default=None):
                return self.headers.get(name, default)
            def read1(self, size):
                return self.body.read(size)

        with patch.object(web, "public_addresses", return_value=["93.184.216.34"]) as resolve, patch.object(web.http.client, "HTTPSConnection") as factory:
            connection = factory.return_value
            connection.getresponse.return_value = Response()
            self.assertEqual(web.request_bytes(URL)[0], b"ok")
            with patch.object(web.socket, "create_connection") as create:
                connection._create_connection(("example.com", 443))
                self.assertEqual(create.call_args.args[0], ("93.184.216.34", 443))
            response = Response()
            response.status = 302
            response.headers = Message()
            response.headers["Location"] = "https://127.0.0.1/private"
            connection.getresponse.return_value = response
            resolve.side_effect = [["93.184.216.34"], ValueError("公网地址")]
            with self.assertRaisesRegex(ValueError, "公网"):
                web.request_bytes(URL)
            self.assertEqual(connection.request.call_count, 2)  # first success and redirect, never private target
            resolve.side_effect = None
            with self.assertRaisesRegex(ValueError, "重定向"):
                web.request_bytes(URL, headers={"Authorization": "SECRET_SENTINEL"})
            connection.getresponse.return_value = Response(b"x" * (web.MAX_BYTES + 1))
            with self.assertRaisesRegex(ValueError, "2 MiB"):
                web.request_bytes(URL)
            connection.request.side_effect = OSError("SECRET_SENTINEL")
            with self.assertRaises(ValueError) as error:
                web.request_bytes(URL)
            self.assertNotIn("SECRET_SENTINEL", str(error.exception))
            connection.request.side_effect = web.ssl.SSLCertVerificationError("private upstream detail")
            with self.assertRaisesRegex(ValueError, "SSL_CERT_FILE"):
                web.request_bytes(URL)
            self.assertTrue(connection.close.called)

    def test_html_declared_charset_is_used_when_http_charset_is_missing(self):
        body = '<meta charset="gb18030"><title>中文来源</title><p>中文正文</p>'.encode("gb18030")
        with patch.object(web, "request_bytes", return_value=(body, headers("text/html"), URL)):
            result = web.read_web_page(URL)
        self.assertEqual(result["title"], "中文来源")
        self.assertEqual(result["passages"][0]["text"], "中文正文")

    def test_memory_retains_sources_coverage_versions_and_result_recall(self):
        facts = [{"tool": "web_search", "arguments": {"query": "query"}, "result": {"query": "query", "results": [
            {"url": URL, "title": "Source", "snippet": "Search snippet", "contentRead": False}]}}]
        self.assertFalse(task_memory(facts)["webSources"][0]["contentRead"])
        with patch.object(web, "request_bytes", return_value=(b"x" * 4000, headers("text/plain"), URL)):
            first = web.read_web_page(URL)
            facts.append({"tool": "read_web_page", "arguments": {"url": URL}, "result": first})
            args = web_read_arguments({"url": URL, "offset": 3, "sourceVersion": "guessed"}, facts)
            self.assertEqual(args["sourceVersion"], first["sourceVersion"])
            second = web.read_web_page(URL, 3, source_version=args["sourceVersion"])
            facts.append({"tool": "read_web_page", "arguments": args, "result": second})
        original = deepcopy(facts)
        source = task_memory(facts)["webSources"][0]
        self.assertTrue(source["complete"])
        self.assertEqual(source["passageIndexes"], [0, 1, 2, 3])
        self.assertEqual(source["observations"], [0, 1, 2])
        self.assertEqual(result_page(facts, 0)["result"]["results"][0]["url"], URL)
        self.assertEqual(cached_read(facts, "web_search", {"query": " query "}), 0)
        self.assertEqual(facts, original)
        with self.assertRaisesRegex(ValueError, "第一页"):
            web_read_arguments({"url": URL, "offset": 3}, [])
        many = [deepcopy(facts[0]) for _ in range(80)]
        for i, fact in enumerate(many):
            fact["result"]["results"][0]["url"] = URL + str(i) + "x" * 4000
        self.assertLessEqual(json_size(task_memory(many)), 40_000)

    def test_search_credentials_file_cannot_be_downloaded_with_get_or_head(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".env").mkdir()
            (root / ".env" / "web_search.env").write_text("SECRET_SENTINEL")
            (root / ".env" / "key.js").write_text("SECRET_SENTINEL")
            (root / "ok.txt").write_text("public")
            class Handler(server.PaperReaderHandler):
                def __init__(self, *args, **kwargs):
                    super().__init__(*args, directory=directory, **kwargs)
                def log_message(self, *_args):
                    pass
            httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
            thread = threading.Thread(target=httpd.serve_forever, daemon=True)
            thread.start()
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            base = f"http://127.0.0.1:{httpd.server_port}"
            try:
                for method in ("GET", "HEAD"):
                    for path in ("/.env/web_search.env", "/%2eenv/web_search.env", "/.env/key.js"):
                        with self.subTest(method=method, path=path), self.assertRaises(urllib.error.HTTPError) as error:
                            opener.open(urllib.request.Request(base + path, method=method))
                        self.assertEqual(error.exception.code, 404)
                self.assertEqual(opener.open(base + "/ok.txt").read(), b"public")
            finally:
                httpd.shutdown()
                httpd.server_close()
                thread.join()


class WebMCPTests(LibraryFixture):
    def test_changed_redirected_page_invalidates_all_aliases_before_reread(self):
        canonical = "https://example.com/canonical"
        first = {"url": canonical, "requestedUrl": URL, "sourceVersion": "v1", "passages": [{"index": 0, "text": "Old"}]}
        second = {**first, "requestedUrl": canonical, "passages": [{"index": 3, "text": "Old tail"}]}
        facts = [{"tool": "read_web_page", "arguments": {"url": URL}, "result": first},
                 {"tool": "read_web_page", "arguments": {"url": canonical, "offset": 3}, "result": second}]
        async def changed(*_args):
            raise ValueError("Web page content changed")
        store = JobStore(self.root / "jobs.sqlite3")
        agent = LibraryAgent(None, None, store, "job", "turn", self.root / "checkpoints.sqlite3")
        agent.client = SimpleNamespace(call=changed)
        state = {"facts": facts, "selected": ["read_web_page"], "tool_calls": 0,
                 "reply": {"tool_calls": [{"id": "read", "function": {"name": "read_web_page", "arguments": json.dumps({"url": URL, "offset": 6})}}]}}
        result = asyncio.run(agent.tools(state))
        self.assertTrue(all(fact.get("stale") for fact in result["facts"][:2]))
        self.assertIsNone(cached_read(result["facts"], "read_web_page", {"url": URL}))
        self.assertEqual(task_memory(result["facts"])["webSources"], [])
        self.assertFalse(any(fact.get("stale") for fact in facts))

    def test_web_tools_are_discoverable_read_only_and_validate_arguments(self):
        module = mcp_module()
        with patch.dict(os.environ, {"PAPER_LANTERN_MCP_READ_ONLY": "1"}):
            self.assertTrue({"web_search", "read_web_page"} <= {tool["name"] for tool in module.list_tools()})
            catalog = module.TOOLS["agent_capabilities"][2]({"names": ["web_search", "read_web_page"]})
            tools = json.loads(catalog["content"][0]["text"])["tools"]
            self.assertTrue(all(tool["effect"] == "read" and not tool["approvalRequired"] for tool in tools))
            for name, args in (("web_search", {"query": "a", "limit": 6}), ("read_web_page", {"url": URL, "limit": 4})):
                result = module.handle_request({"id": 1, "method": "tools/call", "params": {"name": name, "arguments": args}})["result"]
                self.assertTrue(result["isError"])
        schema = read_definition({"function": {"name": "read_web_page", "parameters": module.TOOLS["read_web_page"][1]}})
        self.assertNotIn("sourceVersion", schema["function"]["parameters"]["properties"])

    @unittest.skipUnless(HAS_RUNTIME, "Install Agent runtime")
    def test_real_mcp_subprocess_calls_configured_searxng_server(self):
        queries = []
        class Handler(server.SimpleHTTPRequestHandler):
            def do_GET(self):
                queries.append(self.path)
                body = json.dumps({"results": [{"url": URL, "title": "Local test source", "content": "Snippet"}]}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            def log_message(self, *_args):
                pass
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        async def run():
            async with ResearchMCPClient(self.library, timeout=10) as client:
                return await client.call("web_search", {"query": "联网搜索", "limit": 1})
        try:
            with patch.dict(os.environ, {"PAPER_LANTERN_SEARCH_PROVIDER": "searxng", "PAPER_LANTERN_SEARCH_SEARXNG_URL": f"http://127.0.0.1:{httpd.server_port}"}):
                result = asyncio.run(run())
            self.assertEqual(result["results"][0]["url"], URL)
            self.assertEqual(len(queries), 1)
            self.assertIn("format=json", queries[0])
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join()

    @unittest.skipUnless(HAS_RUNTIME, "Install Agent runtime")
    def test_real_graph_discovers_searches_reads_pages_and_answers_with_source(self):
        self.paper()
        store = JobStore(self.root / "jobs.sqlite3")
        job, _ = store.create({"task": "联网查询并阅读来源", "agentVersion": "general-v1"}, self.library)
        original_call = ResearchMCPClient.call
        network_calls = []
        async def call(client, name, args):
            if name == "web_search":
                network_calls.append(name)
                return web.web_search(**args, base_dir=self.root)
            if name == "read_web_page":
                network_calls.append(name)
                return web.read_web_page(args["url"], args["offset"], args["limit"], args.get("sourceVersion"))
            return await original_call(client, name, args)
        case = self
        class Model:
            calls = 0
            async def complete(self, messages, tools):
                self.calls += 1
                memory = json.loads(messages[-1]["content"])["workspace"]
                if self.calls == 1:
                    name, args = "discover_tools", {"names": ["web_search", "read_web_page"]}
                elif self.calls == 2:
                    name, args = "web_search", {"query": "latest research"}
                elif self.calls == 3:
                    case.assertFalse(memory["webSources"][0]["contentRead"])
                    name, args = "read_web_page", {"url": URL}
                elif self.calls == 4:
                    source = memory["webSources"][0]
                    case.assertFalse(source["complete"])
                    name, args = "read_web_page", {"url": URL, "offset": source["nextOffset"]}
                elif self.calls == 5:
                    case.assertTrue(memory["webSources"][0]["complete"])
                    name, args = "get_task_result", {"index": 2}
                else:
                    return {"role": "assistant", "content": f"已阅读网页正文。[来源]({URL})"}
                return {"role": "assistant", "content": "", "tool_calls": [{"id": str(self.calls), "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}]}
        config = {"PROVIDER": "tavily", "API_KEY": "SECRET_SENTINEL", "SEARXNG_URL": ""}
        responses = [(json.dumps({"results": [{"url": URL, "title": "Source", "content": "Snippet"}]}).encode(), headers(), URL),
                     (b"Evidence " * 600, headers("text/plain"), URL), (b"Evidence " * 600, headers("text/plain"), URL)]
        before = {str(path): path.read_bytes() for path in self.library.rglob("*") if path.is_file()}
        with patch.object(ResearchMCPClient, "call", call), patch.object(web, "search_config", return_value=config), patch.object(web, "request_bytes", side_effect=responses):
            asyncio.run(execute_job(store, job["id"], 1, Model))
        finished = store.get(job["id"])
        self.assertEqual(finished["status"], "completed", finished["error"])
        self.assertIn(URL, finished["result"]["report"])
        self.assertEqual(network_calls, ["web_search", "read_web_page", "read_web_page"])
        self.assertNotIn("SECRET_SENTINEL", json.dumps(store.events(job["id"])))
        self.assertEqual(before, {str(path): path.read_bytes() for path in self.library.rglob("*") if path.is_file()})
