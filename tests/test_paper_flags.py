import json
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from unittest.mock import patch

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

    def test_icon_colors_persist_without_changing_paper_assignments(self):
        paper = self.paper()
        custom = server.create_library_flag("精读")
        server.update_paper_local_state(paper["id"], {"flags": ["todo", custom["id"]], "viewedAt": "2026-10-25"})
        paths = [server.DB_FILE, server.paper_dir_from_id(paper["id"]) / "metadata.json"]
        before = {path: path.read_bytes() for path in paths}
        self.assertEqual(server.update_library_flag_color("todo", "#4776A8")["color"], "#4776a8")
        colored = server.update_library_flag_color(custom["id"], "#55836B")
        self.assertEqual(server.create_library_flag("精读"), colored)
        self.assertIn(colored, server.library_flag_definitions())
        self.assertEqual(server.load_paper_flags()["flagColors"]["todo"], "#4776a8")
        self.assertEqual(server.read_paper(paper["id"])["flags"], ["todo", custom["id"]])
        self.assertEqual(server.read_paper(paper["id"])["viewedAt"], "2026-10-25")
        self.assertEqual({path: path.read_bytes() for path in paths}, before)
        server.maybe_auto_sync_library.assert_not_called()

    def test_invalid_colors_and_unknown_flags_do_not_change_local_state(self):
        server.update_library_flag_color("todo", "#4776a8")
        before = server.FLAGS_FILE.read_bytes()
        for color in (None, [], {}, "red", "#fff", "#zzzzzz", "#4776a8; color:red"):
            with self.subTest(color=color), self.assertRaises(ValueError):
                server.update_library_flag_color("todo", color)
            self.assertEqual(server.FLAGS_FILE.read_bytes(), before)
        for flag_id in (None, [], {}, "missing"):
            with self.subTest(flag_id=flag_id), self.assertRaises(ValueError):
                server.update_library_flag_color(flag_id, "#4776a8")
            self.assertEqual(server.FLAGS_FILE.read_bytes(), before)
        data = server.load_paper_flags()
        data["flagColors"] = {"todo": "url(invalid)", "read": 123}
        self.assertTrue(all(flag["color"] == server.DEFAULT_FLAG_COLOR for flag in server.library_flag_definitions(data)))

    def test_icon_presets_persist_and_preserve_colors_and_assignments(self):
        paper = self.paper()
        flag = server.create_library_flag("精读")
        self.assertEqual(flag["icon"], "flag")
        server.update_paper_local_state(paper["id"], {"flags": ["todo", flag["id"]]})
        before_assignments = server.load_paper_flags()["papers"]
        metadata = server.paper_dir_from_id(paper["id"]) / "metadata.json"
        before_metadata = metadata.read_bytes()
        server.update_library_flag_color(flag["id"], "#55836b")
        for icon in server.PAPER_FLAG_ICONS:
            updated = server.update_library_flag_appearance(flag["id"], {"icon": icon})
            self.assertEqual(updated["icon"], icon)
            self.assertEqual(updated["color"], "#55836b")
            self.assertEqual(server.create_library_flag("精读"), updated)
            self.assertEqual(server.load_paper_flags()["flagIcons"][flag["id"]], icon)
        server.update_library_flag_appearance("todo", {"icon": "check"})
        self.assertEqual(server.update_library_flag_color("todo", "#4776a8")["icon"], "check")
        both = server.update_library_flag_appearance(flag["id"], {"icon": "star", "color": "#AC6270"})
        self.assertEqual((both["icon"], both["color"]), ("star", "#ac6270"))
        self.assertEqual(server.load_paper_flags()["papers"], before_assignments)
        self.assertEqual(metadata.read_bytes(), before_metadata)
        server.maybe_auto_sync_library.assert_not_called()

    def test_invalid_appearance_does_not_partially_save(self):
        server.update_library_flag_appearance("todo", {"icon": "star", "color": "#4776a8"})
        before = server.FLAGS_FILE.read_bytes()
        for updates in (None, [], {}, {"icon": None}, {"icon": []}, {"icon": "<svg>"}, {"color": "#55836b", "icon": "unknown"}, {"icon": "heart", "color": "bad"}):
            with self.subTest(updates=updates), self.assertRaises(ValueError):
                server.update_library_flag_appearance("todo", updates)
            self.assertEqual(server.FLAGS_FILE.read_bytes(), before)
        data = server.load_paper_flags()
        data["flagIcons"] = {"todo": "<svg>", "read": []}
        self.assertTrue(all(flag["icon"] == "flag" for flag in server.library_flag_definitions(data)))

    def test_bulk_add_remove_preserves_other_flags_and_local_state(self):
        first, second, unselected = self.paper(), self.paper(), self.paper()
        a, b = server.create_library_flag("精读"), server.create_library_flag("待复现")
        server.update_paper_local_state(first["id"], {"flags": ["read", a["id"]], "viewedAt": "2026-10-25"})
        server.update_paper_local_state(second["id"], {"flags": ["todo", b["id"]]})
        server.update_paper_local_state(unselected["id"], {"flags": ["read"]})
        paths = [server.DB_FILE, *(server.paper_dir_from_id(p["id"]) / "metadata.json" for p in (first, second, unselected))]
        before = {path: path.read_bytes() for path in paths}
        ids = [first["id"], second["id"]]

        added = server.update_papers_flags(ids + ids, ["read", a["id"]], "add")
        self.assertEqual(len(added), 2)
        self.assertEqual(set(added[0]["flags"]), {"read", a["id"]})
        self.assertEqual(set(added[1]["flags"]), {"read", "todo", a["id"], b["id"]})
        removed = server.update_papers_flags(ids, ["read", a["id"]], "remove")
        self.assertEqual(removed[0]["flags"], [])
        self.assertEqual(set(removed[1]["flags"]), {"todo", b["id"]})
        self.assertEqual(removed[0]["viewedAt"], "2026-10-25")
        self.assertEqual(server.read_paper(unselected["id"])["flags"], ["read"])
        self.assertEqual({path: path.read_bytes() for path in paths}, before)
        server.maybe_auto_sync_library.assert_not_called()

    def test_bulk_validation_never_partially_changes_flags(self):
        paper = self.paper()
        server.update_paper_local_state(paper["id"], {"flags": ["todo"]})
        before = server.FLAGS_FILE.read_bytes()
        invalid = [
            ([], ["read"], "add", ValueError),
            ([paper["id"], "missing"], ["read"], "add", FileNotFoundError),
            ([paper["id"]], [], "add", ValueError),
            ([paper["id"]], ["read", "missing"], "add", ValueError),
            ([paper["id"]], "read", "add", ValueError),
            *[([paper["id"]], ["read"], op, ValueError) for op in (None, [], {}, "replace")],
        ]
        for ids, flags, operation, error in invalid:
            with self.subTest(ids=ids, flags=flags, operation=operation), self.assertRaises(error):
                server.update_papers_flags(ids, flags, operation)
            self.assertEqual(server.FLAGS_FILE.read_bytes(), before)

    def test_compact_batch_reads_state_once_without_loading_paper_content(self):
        first, second = self.paper(), self.paper()
        custom = server.create_library_flag("精读")
        server.update_paper_local_state(first["id"], {"flags": [custom["id"]], "viewedAt": "2026-10-25"})
        metadata_path = server.paper_dir_from_id(second["id"]) / "metadata.json"
        metadata = server.read_json(metadata_path, {})
        metadata.update(todo=True, viewedAt="2026-10-24")
        server.write_json(metadata_path, metadata)

        with patch.object(server, "load_paper_flags", wraps=server.load_paper_flags) as load, \
             patch.object(server, "save_paper_flags", wraps=server.save_paper_flags) as save, \
             patch.object(server, "read_paper", side_effect=AssertionError("Flag changes must not load full paper content")):
            states = server.update_papers_flags([first["id"], second["id"]], ["read"], "add", compact=True)
        self.assertEqual(load.call_count, 1)
        self.assertEqual(save.call_count, 1)
        self.assertEqual(states, [
            {"id": first["id"], "read": True, "todo": False, "flags": ["read", custom["id"]], "viewedAt": "2026-10-25"},
            {"id": second["id"], "read": True, "todo": True, "flags": ["read", "todo"], "viewedAt": "2026-10-24"},
        ])

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
            before_assignments = server.load_paper_flags()["papers"]
            for flag_id in ("todo", flag["id"]):
                status, data = request("/api/library/flags", {"id": flag_id, "color": "#4776A8"})
                self.assertEqual(status, 200)
                self.assertEqual(data["flag"]["color"], "#4776a8")
                self.assertIn(data["flag"], request("/api/library/flags")[1]["flags"])
                status, data = request("/api/library/flags", {"id": flag_id, "icon": "star"})
                self.assertEqual(status, 200)
                self.assertEqual(data["flag"]["icon"], "star")
                self.assertEqual(data["flag"]["color"], "#4776a8")
                self.assertIn(data["flag"], request("/api/library")[1]["flags"])
            self.assertEqual(server.load_paper_flags()["papers"], before_assignments)
            self.assertEqual(request("/api/library/flags", {"id": "todo", "icon": "unknown"})[0], 400)
            self.assertEqual(request("/api/library/flags", {"id": "todo", "color": "red"})[0], 400)
            self.assertEqual(request("/api/library/flags", {"id": "missing", "color": "#4776a8"})[0], 400)
            self.assertEqual(metadata.read_bytes(), before)
            server.maybe_auto_sync_library.assert_not_called()
            for value in ("read", ["missing"], [None]):
                status, _ = request("/api/library/paper", {"id": paper["id"], "title": "Should not change", "flags": value})
                self.assertEqual(status, 400)
                self.assertEqual(metadata.read_bytes(), before)
            self.assertEqual(request("/api/library/flags", {"name": ""})[0], 400)
            self.assertEqual(request("/api/library/flags", [])[0], 400)
            self.assertEqual(request("/api/library/paper", {"id": paper["id"], "todo": False})[1]["paper"]["flags"], [flag["id"]])
            second = self.paper()
            payload = {"action": "flags-many", "ids": [paper["id"], second["id"]], "flags": ["read"], "operation": "add"}
            status, data = request("/api/library/paper", payload)
            self.assertEqual(status, 200)
            self.assertEqual([p["id"] for p in data["papers"]], payload["ids"])
            self.assertEqual(data["papers"][0]["flags"], ["read", flag["id"]])
            self.assertEqual(data["papers"][1]["flags"], ["read"])
            self.assertIn("tree", data)
            self.assertIsNone(data["sync"])
            status, data = request("/api/library/paper", {**payload, "operation": "remove"})
            self.assertEqual(status, 200)
            self.assertEqual(data["papers"][0]["flags"], [flag["id"]])
            self.assertEqual(data["papers"][1]["flags"], [])
            with patch.object(server, "read_library_tree", side_effect=AssertionError("Compact response must not rebuild the library")), \
                 patch.object(server, "read_paper", side_effect=AssertionError("Compact response must not load full papers")):
                status, data = request("/api/library/paper", {**payload, "response": "flags"})
            self.assertEqual(status, 200)
            self.assertNotIn("tree", data)
            self.assertEqual(set(data["papers"][0]), {"id", "read", "todo", "flags", "viewedAt"})
            self.assertEqual(data["papers"][0]["flags"], ["read", flag["id"]])
            self.assertEqual(data["papers"][1]["flags"], ["read"])
            unchanged = server.FLAGS_FILE.read_bytes()
            for override, expected in (({"ids": [paper["id"], "missing"]}, 404), ({"flags": ["missing"]}, 400), ({"operation": []}, 400)):
                self.assertEqual(request("/api/library/paper", {**payload, **override})[0], expected)
                self.assertEqual(server.FLAGS_FILE.read_bytes(), unchanged)
            self.assertEqual(metadata.read_bytes(), before)
            server.maybe_auto_sync_library.assert_not_called()
        finally:
            http.shutdown()
            http.server_close()
            thread.join()
