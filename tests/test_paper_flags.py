import json
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import server
from test_categories import LibraryFixture


class PaperFlagTests(LibraryFixture):
    def test_legacy_markers_and_custom_flags_remain_independent(self):
        paper = self.paper()
        custom = server.create_library_flag("精读")
        server.update_paper_local_state(paper["id"], {"flags": ["read", "todo", custom["id"]]})
        server.update_paper_local_state(paper["id"], {"todo": False, "viewedAt": "2026-10-25"})
        state = server.read_paper(paper["id"])
        self.assertEqual(state["flags"], ["read", custom["id"]])
        self.assertTrue(state["read"])
        self.assertFalse(state["todo"])
        self.assertEqual(state["viewedAt"], "2026-10-25")
        server.update_paper_local_state(paper["id"], {"flags": []})
        self.assertEqual(server.read_paper(paper["id"])["flags"], [])
        self.assertEqual(server.read_paper(paper["id"])["viewedAt"], "2026-10-25")

    def test_legacy_metadata_is_projected_into_flags(self):
        state = server.paper_local_state("legacy", {"read": True, "todo": True})
        self.assertEqual(state["flags"], ["read", "todo"])
        server.update_paper_local_state("legacy", {"read": False})
        self.assertEqual(server.paper_local_state("legacy", {"read": True, "todo": True})["flags"], ["todo"])

    def test_definitions_are_reusable_and_names_are_validated(self):
        flag = server.create_library_flag("  精读  ")
        self.assertEqual(server.create_library_flag("精读"), flag)
        self.assertEqual(server.create_library_flag("已读")["id"], "read")
        self.assertEqual(server.library_flag_definitions()[-1], flag)
        for invalid in (None, [], "", "x" * 25, "a\nb"):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                server.create_library_flag(invalid)
        for invalid in ("read", [None], ["missing"], {}):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                server.normalize_paper_flag_ids(invalid)

    def test_duplicate_merge_preserves_both_custom_flags(self):
        first, second = self.paper(), self.paper()
        a, b = server.create_library_flag("精读"), server.create_library_flag("待复现")
        server.update_paper_local_state(first["id"], {"flags": ["read", a["id"]]})
        server.update_paper_local_state(second["id"], {"flags": ["todo", b["id"]]})
        merged = server.merge_duplicate_items(first["id"], [second["id"]])["canonical"]
        self.assertEqual(set(merged["flags"]), {"read", "todo", a["id"], b["id"]})

    def test_http_creation_assignment_validation_and_local_storage(self):
        class Handler(server.PaperReaderHandler):
            def log_message(self, *_args):
                pass
        http = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=http.serve_forever, daemon=True)
        thread.start()
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

        def request(path, payload=None):
            body = json.dumps(payload).encode() if payload is not None else None
            req = urllib.request.Request(f"http://127.0.0.1:{http.server_port}{path}", body, {"Content-Type": "application/json"})
            try:
                with opener.open(req) as response:
                    return response.status, json.load(response)
            except urllib.error.HTTPError as error:
                return error.code, json.load(error)

        try:
            paper = self.paper()
            metadata = server.paper_dir_from_id(paper["id"]) / "metadata.json"
            before = metadata.read_bytes()
            status, data = request("/api/library/flags", {"name": "待复现"})
            self.assertEqual(status, 200)
            flag = data["flag"]
            self.assertIn(flag, request("/api/library/flags")[1]["flags"])
            self.assertIn(flag, request("/api/library")[1]["flags"])
            status, data = request("/api/library/paper", {"id": paper["id"], "flags": ["todo", flag["id"]]})
            self.assertEqual(status, 200)
            self.assertEqual(data["paper"]["flags"], ["todo", flag["id"]])
            self.assertEqual(metadata.read_bytes(), before)
            server.maybe_auto_sync_library.assert_not_called()
            for value in ("read", ["missing"], [None]):
                status, _ = request("/api/library/paper", {"id": paper["id"], "title": "Should not change", "flags": value})
                self.assertEqual(status, 400)
                self.assertEqual(metadata.read_bytes(), before)
            self.assertEqual(request("/api/library/flags", {"name": ""})[0], 400)
            self.assertEqual(request("/api/library/flags", [])[0], 400)
            self.assertEqual(request("/api/library/paper", {"id": paper["id"], "todo": False})[1]["paper"]["flags"], [flag["id"]])
        finally:
            http.shutdown()
            http.server_close()
            thread.join()
