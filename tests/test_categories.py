import copy
import importlib.util
import io
import json
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

import cloud_sync
import server
from category_model import category_ids, set_record_categories


class LibraryFixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.library = self.root / "library"
        values = {
            "LIBRARY_DIR": self.library, "DB_FILE": self.library / "library_db.json",
            "PAPER_STORAGE_DIR": self.library / "papers", "NOTE_STORAGE_DIR": self.library / "notes",
            "FLAGS_FILE": self.library / "flags.json", "IMPORT_JOBS_FILE": self.root / "jobs.json",
            "ARCHIVE_ROOT": self.library / ".trash", "ARCHIVE_ITEMS_DIR": self.library / ".trash" / "items",
            "ARCHIVE_INDEX_FILE": self.library / ".trash" / "index.json",
        }
        self.patches = patch.multiple(server, **values)
        self.patches.start()
        self.auto_sync = patch.object(server, "maybe_auto_sync_library", return_value=None)
        self.auto_sync.start()
        for name in ("A", "B", "C"):
            server.create_category("", name)
        self.counter = 0

    def tearDown(self):
        for thread in list(server.IMPORT_THREADS.values()):
            thread.join(timeout=5)
        self.auto_sync.stop()
        self.patches.stop()
        self.temp.cleanup()

    def paper(self, ids="A"):
        self.counter += 1
        return server.add_paper_to_db(f"Paper {self.counter}", ids, io.BytesIO(f"%PDF-1.4\n{self.counter}".encode()))


class CategoryTests(LibraryFixture):
    def test_legacy_record_migrates_without_reimporting(self):
        paper = self.paper()
        db = server.load_library_db()
        for key in ("categoryIds", "categoryMemberships"):
            db["papers"][paper["id"]].pop(key)
        db["version"] = 1
        server.save_library_db(db)
        loaded = server.read_paper(paper["id"])
        self.assertEqual(loaded["categoryIds"], ["A"])
        self.assertEqual(loaded["category"], "A")
        self.assertEqual(server.load_library_db()["version"], 2)
        self.assertTrue((self.library / "library_db.v1.backup.json").exists())
        self.assertEqual(len(list(server.PAPER_STORAGE_DIR.iterdir())), 1)

    def test_membership_add_remove_and_uncategorized(self):
        paper = self.paper(["A", "B", "A", "uncategorized"])
        self.assertEqual(paper["categoryIds"], ["A", "B"])
        updated = server.update_paper_categories(paper["id"], ["C"], "add_categories")
        self.assertEqual(updated["categoryIds"], ["A", "B", "C"])
        updated = server.update_paper_categories(paper["id"], ["A"], "remove_categories")
        self.assertEqual(updated["categoryIds"], ["B", "C"])
        self.assertEqual(updated["category"], "B")
        server.update_paper_categories(paper["id"], [])
        self.assertEqual(server.read_paper(paper["id"])["categoryIds"], ["uncategorized"])
        tree = server.read_library_tree()
        self.assertEqual([node["id"] for node in tree["folders"] if node["papers"]], ["uncategorized"])

    def test_metadata_mirrors_manifest_and_storage_is_shared(self):
        paper = self.paper(["A", "B"])
        server.write_paper_notes(server.paper_dir_from_id(paper["id"]), "Shared notes")
        for node in server.read_library_tree()["folders"]:
            if node["id"] in {"A", "B"}:
                self.assertEqual(node["papers"][0]["id"], paper["id"])
                self.assertEqual(node["papers"][0]["notes"], "Shared notes")
        metadata = server.read_json(server.paper_dir_from_id(paper["id"]) / "metadata.json", {})
        self.assertEqual(metadata["categoryIds"], ["A", "B"])
        self.assertEqual(len(list(server.PAPER_STORAGE_DIR.iterdir())), 1)

    def test_delete_parent_only_removes_its_memberships(self):
        server.create_category("A", "child")
        paper = self.paper(["A", "A/child", "B"])
        only_child = self.paper("A/child")
        stale = copy.deepcopy(server.load_library_db())
        server.delete_category("A")
        self.assertEqual(server.read_paper(paper["id"])["categoryIds"], ["B"])
        self.assertEqual(server.read_paper(only_child["id"])["categoryIds"], ["uncategorized"])
        merged = cloud_sync.merge_dbs(stale, server.load_library_db())
        self.assertNotIn("A", merged["categories"])
        self.assertNotIn("A/child", merged["categories"])
        self.assertEqual(merged["papers"][paper["id"]]["categoryIds"], ["B"])

    def test_rename_and_move_remap_every_membership(self):
        server.create_category("A", "child")
        paper = self.paper(["A", "A/child", "B"])
        stale = copy.deepcopy(server.load_library_db())
        server.rename_category("A", "Renamed")
        self.assertEqual(server.read_paper(paper["id"])["categoryIds"], ["B", "Renamed", "Renamed/child"])
        server.move_category("Renamed", "C")
        ids = ["B", "C/Renamed", "C/Renamed/child"]
        self.assertEqual(server.read_paper(paper["id"])["categoryIds"], ids)
        for local, remote in [(stale, server.load_library_db()), (server.load_library_db(), stale)]:
            self.assertEqual(cloud_sync.merge_dbs(local, remote)["papers"][paper["id"]]["categoryIds"], ids)

    def test_sync_merges_independent_additions_and_keeps_removals(self):
        paper = self.paper("A")
        first = server.load_library_db()
        second = copy.deepcopy(first)
        set_record_categories(first["papers"][paper["id"]], ["B"], "2030-01-01T00:00:01+00:00")
        set_record_categories(second["papers"][paper["id"]], ["A", "C"], "2030-01-01T00:00:02+00:00")
        for local, remote in [(first, second), (second, first)]:
            merged = cloud_sync.merge_dbs(local, remote)
            self.assertEqual(merged["papers"][paper["id"]]["categoryIds"], ["B", "C"])
            # Repeated sync with stale replicas must not resurrect A.
            self.assertEqual(cloud_sync.merge_dbs(merged, second)["papers"][paper["id"]]["categoryIds"], ["B", "C"])

    def test_local_folder_sync_round_trip(self):
        paper = self.paper(["A", "B"])
        note = server.add_note_to_db("Note", ["A", "B"])
        config = {"provider": "local", "local_dir": str(self.root / "remote")}
        cloud_sync.sync_library(self.library, config)
        other = self.root / "other"
        cloud_sync.sync_library(other, config)
        db = cloud_sync.read_json(other / "library_db.json", {})
        self.assertEqual(db["papers"][paper["id"]]["categoryIds"], ["A", "B"])
        self.assertTrue((other / f"notes/{note['id']}/notes.md").exists())
        set_record_categories(db["papers"][paper["id"]], ["B"], "2030-01-01T00:00:01+00:00")
        cloud_sync.write_json(other / "library_db.json", db)
        cloud_sync.sync_library(other, config)
        cloud_sync.sync_library(self.library, config)
        self.assertEqual(server.read_paper(paper["id"])["categoryIds"], ["B"])
        metadata = server.read_json(server.paper_dir_from_id(paper["id"]) / "metadata.json", {})
        self.assertEqual(metadata["categoryIds"], ["B"])

    def test_removal_wins_a_tie_and_later_readdition_survives(self):
        paper = self.paper("A")
        first = server.load_library_db()
        second = copy.deepcopy(first)
        stamp = "2030-01-01T00:00:01+00:00"
        first["papers"][paper["id"]]["categoryMemberships"]["A"] = {"present": True, "updatedAt": stamp}
        set_record_categories(second["papers"][paper["id"]], [], stamp)
        merged = cloud_sync.merge_dbs(first, second)
        self.assertEqual(merged["papers"][paper["id"]]["categoryIds"], ["uncategorized"])
        set_record_categories(merged["papers"][paper["id"]], ["A"], "2030-01-01T00:00:02+00:00")
        self.assertEqual(cloud_sync.merge_dbs(second, merged)["papers"][paper["id"]]["categoryIds"], ["A"])

    def test_deleted_category_can_be_recreated_explicitly(self):
        paper = self.paper("A")
        server.delete_category("A")
        stale = copy.deepcopy(server.load_library_db())
        server.create_category("", "A")
        server.update_paper_categories(paper["id"], ["A"])
        merged = cloud_sync.merge_dbs(stale, server.load_library_db())
        self.assertIn("A", merged["categories"])
        self.assertEqual(merged["papers"][paper["id"]]["categoryIds"], ["A"])

    def test_merging_duplicate_records_preserves_all_categories(self):
        first, second = self.paper("A"), self.paper(["B", "C"])
        result = server.merge_duplicate_items(first["id"], [second["id"]])
        self.assertEqual(result["canonical"]["categoryIds"], ["A", "B", "C"])
        self.assertEqual(len(server.load_library_db()["papers"]), 1)

    def test_duplicate_pdf_import_adds_categories_to_existing_item(self):
        first = server.add_paper_to_db("First", "A", io.BytesIO(b"%PDF-same"))
        second = server.add_paper_to_db("Second", ["B", "C"], io.BytesIO(b"%PDF-same"))
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(second["categoryIds"], ["A", "B", "C"])
        self.assertEqual(len(server.load_library_db()["papers"]), 1)

    def test_restore_retains_surviving_categories(self):
        paper = self.paper(["A", "B"])
        server.archive_item(paper["id"])
        server.delete_category("A")
        restored = server.restore_item(paper["id"])
        self.assertEqual(restored["categoryIds"], ["B"])

    def test_note_uses_the_same_membership_rules(self):
        note = server.add_note_to_db("Note", ["A", "B"])
        self.assertEqual(note["categoryIds"], ["A", "B"])
        self.assertEqual(server.update_paper_categories(note["id"], ["A"], "remove_categories")["categoryIds"], ["B"])

    def test_mcp_search_and_category_updates_use_all_memberships(self):
        module_path = Path(server.__file__).parent / "plugins/paper-lantern-research-mcp/scripts/paper_lantern_research_mcp.py"
        spec = importlib.util.spec_from_file_location("category_test_mcp", module_path)
        mcp = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mcp)
        paper = self.paper(["A", "B"])
        result = mcp.tool_search_library({"categoryId": "B"})
        matches = json.loads(result["content"][0]["text"])["matches"]
        self.assertEqual([item["id"] for item in matches], [paper["id"]])
        self.assertEqual(matches[0]["categoryIds"], ["A", "B"])
        mcp.tool_update_paper({"id": paper["id"], "addCategoryIds": ["C"], "removeCategoryIds": ["A"]})
        self.assertEqual(server.read_paper(paper["id"])["categoryIds"], ["B", "C"])


class CategoryAPITests(LibraryFixture):
    def setUp(self):
        super().setUp()
        class Handler(server.PaperReaderHandler):
            def log_message(self, *_args):
                pass
        self.http = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.http.server_port}"
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join()
        super().tearDown()

    def post(self, route, payload):
        request = urllib.request.Request(self.base + route, json.dumps(payload).encode(), {"Content-Type": "application/json"})
        try:
            with self.opener.open(request) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            return error.code, json.load(error)

    def test_api_set_add_remove_and_legacy_move(self):
        paper = self.paper()
        route = "/api/library/paper"
        for action, ids, expected in [("set_categories", ["A", "B"], ["A", "B"]), ("add_categories", ["C"], ["A", "B", "C"]), ("remove_categories", ["A"], ["B", "C"]), ("set_categories", [], ["uncategorized"])]:
            status, data = self.post(route, {"action": action, "id": paper["id"], "categoryIds": ids})
            self.assertEqual(status, 200, data)
            self.assertEqual(data["paper"]["categoryIds"], expected)
        status, data = self.post(route, {"action": "move", "id": paper["id"], "category": "B"})
        self.assertEqual((status, data["paper"]["categoryIds"]), (200, ["B"]))

    def test_save_categories_and_notes_in_one_request(self):
        paper = self.paper()
        status, data = self.post("/api/library/paper", {"id": paper["id"], "categoryIds": ["B", "C"], "notes": "Updated notes", "title": "Updated"})
        self.assertEqual(status, 200)
        self.assertEqual(data["paper"]["categoryIds"], ["B", "C"])
        self.assertEqual(data["paper"]["notes"], "Updated notes")
        self.assertEqual(data["paper"]["title"], "Updated")

    def test_invalid_categories_do_not_change_memberships(self):
        paper = self.paper()
        for value in ("A", {}, [None], ["missing"]):
            status, _ = self.post("/api/library/paper", {"action": "set_categories", "id": paper["id"], "categoryIds": value})
            self.assertEqual(status, 400)
            self.assertEqual(server.read_paper(paper["id"])["categoryIds"], ["A"])

    def test_multipart_import_accepts_json_and_repeated_category_ids(self):
        for index, fields in enumerate([[("categoryIds", '["A","B"]')], [("categoryIds", "B"), ("categoryIds", "C")], [("category", "A")]]):
            boundary = "category-test-boundary"
            body = b""
            for key, value in fields:
                body += f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode()
            body += f'--{boundary}\r\nContent-Disposition: form-data; name="pdf"; filename="test.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-{index}\r\n--{boundary}--\r\n'.encode()
            request = urllib.request.Request(self.base + "/api/library/upload", body, {"Content-Type": f"multipart/form-data; boundary={boundary}"})
            with self.opener.open(request) as response:
                data = json.load(response)
            self.assertEqual(data["paper"]["categoryIds"], [["A", "B"], ["B", "C"], ["A"]][index])

    def test_async_import_and_retry_attach_requested_categories(self):
        with patch.object(server, "download_remote_pdf", return_value=(b"%PDF-async", "Remote", "https://example.com/paper.pdf", 10)):
            status, data = self.post("/api/library/remote-pdf", {"pdfUrl": "https://example.com/paper.pdf", "categoryIds": ["B", "A"]})
            self.assertIn(status, (200, 202))
            job_id = data["job"]["jobId"]
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                job = server.get_import_status(job_id)
                if job["state"] in server.IMPORT_JOB_TERMINAL_STATES:
                    break
                time.sleep(0.01)
            self.assertEqual(job["state"], "completed", job)
            paper_id = job["paperId"]
            self.assertEqual(server.read_paper(paper_id)["categoryIds"], ["A", "B"])
            server.update_paper_categories(paper_id, ["C"])
            _, retry = self.post("/api/library/remote-pdf", {"pdfUrl": "https://example.com/paper.pdf", "categoryIds": ["A", "B"]})
            self.assertEqual(retry["job"]["jobId"], job_id)
            self.assertEqual(server.read_paper(paper_id)["categoryIds"], ["A", "B", "C"])


if __name__ == "__main__":
    unittest.main()
