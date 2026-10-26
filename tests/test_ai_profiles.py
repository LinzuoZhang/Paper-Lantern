import json
import io
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
from http.server import ThreadingHTTPServer
from unittest.mock import patch

import server
from backend.config_store import AI_MODULES, config_path, get_secret, load_config, public_config, save_config


class AIProfileTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = self.temp.name

    def save_profiles(self):
        return save_config(self.base, {"ai": {"activeProfileId": "reading", "profiles": [
            {"id": "reading", "name": "阅读", "baseUrl": "https://reading.test/v1", "model": "fast", "apiKey": "reading-secret"},
            {"id": "research", "name": "研究", "baseUrl": "https://research.test/v1", "model": "deep", "apiKey": "research-secret", "thinkMode": True},
        ]}})

    def test_legacy_config_is_preserved_and_legacy_writes_update_active_profile(self):
        path = config_path(self.base)
        path.parent.mkdir()
        path.write_text(json.dumps({"ai": {"baseUrl": "https://legacy.test/v1", "model": "legacy-model",
                                            "apiKey": "legacy-secret", "thinkMode": True}}), encoding="utf-8")
        config = load_config(self.base)
        self.assertEqual(config["ai"]["activeProfileId"], "default")
        self.assertEqual(config["ai"]["profiles"][0]["apiKey"], "legacy-secret")
        save_config(self.base, {"ai": {"model": "updated"}, "sync": {"password": "sync-secret"}})
        restored = load_config(self.base)
        self.assertEqual(restored["ai"]["profiles"][0]["model"], "updated")
        self.assertEqual(get_secret(restored, "ai", "apiKey"), "legacy-secret")
        self.assertEqual(get_secret(restored, "sync", "password"), "sync-secret")

    def test_switch_and_reload_use_matching_model_endpoint_key_and_think_mode(self):
        self.save_profiles()
        save_config(self.base, {"ai": {"activeProfileId": "research"}})
        with patch.object(server, "BASE_DIR", self.base):
            self.assertEqual(server.get_ai_config(), ("research-secret", "deep", "https://research.test/v1/chat/completions", True))
            self.assertTrue(server.is_ai_think_mode_enabled())
        config = load_config(self.base)
        self.assertEqual(len(config["ai"]["profiles"]), 2)
        self.assertNotIn("research-secret", config_path(self.base).read_text(encoding="utf-8"))

    def test_public_round_trip_retains_each_key_by_id_when_reordered(self):
        public = public_config(self.save_profiles())
        self.assertNotIn("reading-secret", json.dumps(public))
        self.assertNotIn("research-secret", json.dumps(public))
        self.assertTrue(all("apiKey" not in profile for profile in public["ai"]["profiles"]))
        public["ai"]["profiles"].reverse()
        for profile in public["ai"]["profiles"]:
            profile["apiKey"] = ""
        saved = save_config(self.base, public)
        with patch.object(server, "BASE_DIR", self.base):
            self.assertEqual(server.get_ai_config()[0], "reading-secret")
        keys = {profile["id"]: profile["apiKey"] for profile in saved["ai"]["profiles"]}
        self.assertNotEqual(keys["reading"], keys["research"])
        self.assertEqual(saved["ai"]["model"], "fast")

    def test_new_profile_never_inherits_an_existing_key_and_deletion_is_persisted(self):
        self.save_profiles()
        saved = save_config(self.base, {"ai": {"activeProfileId": "new", "profiles": [
            {"id": "research"}, {"id": "new", "model": "another", "apiKey": ""},
        ]}})
        self.assertEqual(get_secret(saved, "ai", "apiKey"), "")
        self.assertEqual([profile["id"] for profile in load_config(self.base)["ai"]["profiles"]], ["research", "new"])
        save_config(self.base, {"ai": {"activeProfileId": "research"}})
        self.assertEqual(get_secret(load_config(self.base), "ai", "apiKey"), "research-secret")

    def test_invalid_profiles_do_not_overwrite_saved_configuration(self):
        self.save_profiles()
        original = config_path(self.base).read_bytes()
        for payload in [
            {"profiles": []}, {"profiles": "invalid"}, {"profiles": [None]},
            {"profiles": [{"id": "same"}, {"id": "same"}]}, {"activeProfileId": "missing"},
        ]:
            with self.subTest(payload=payload):
                with self.assertRaises(ValueError):
                    save_config(self.base, {"ai": payload})
                self.assertEqual(config_path(self.base).read_bytes(), original)

    def test_connection_test_uses_selected_profile_without_changing_active_configuration(self):
        self.save_profiles()
        with patch.object(server, "BASE_DIR", self.base), patch.object(server, "post_chat_completion", return_value={
            "choices": [{"message": {"content": "OK"}}],
        }) as post:
            server.test_ai_api({"ai": {"id": "research"}})
            self.assertEqual(post.call_args.args[:2], ("research-secret", "https://research.test/v1/chat/completions"))
            self.assertEqual(post.call_args.args[2]["model"], "deep")
            self.assertTrue(post.call_args.kwargs["think_mode"])
            with self.assertRaisesRegex(ValueError, "Missing AI API key"):
                server.test_ai_api({"ai": {"id": "unsaved", "baseUrl": "https://new.test/v1"}})
            self.assertEqual(post.call_count, 1)
        self.assertEqual(load_config(self.base)["ai"]["activeProfileId"], "reading")

    def test_module_api_and_think_are_independent_and_removed_profiles_fall_back(self):
        self.save_profiles()
        save_config(self.base, {"ai": {"modules": {
            "translate": {"profileId": "research", "thinkMode": True},
            "summary": {"profileId": "reading", "thinkMode": False},
            "discuss": {"profileId": "research", "thinkMode": False},
        }}})
        with patch.object(server, "BASE_DIR", self.base):
            self.assertEqual(server.get_ai_config("translate"), ("research-secret", "deep", "https://research.test/v1/chat/completions", True))
            self.assertEqual(server.get_ai_config("summary")[0:2], ("reading-secret", "fast"))
            self.assertFalse(server.get_ai_config("discuss")[3])
        config = save_config(self.base, {"ai": {"profiles": [{"id": "reading"}]}})
        self.assertEqual(config["ai"]["modules"]["translate"], {"profileId": "", "thinkMode": True})

    def test_discussion_picker_partial_update_only_changes_discussion_profile(self):
        self.save_profiles()
        before = save_config(self.base, {"ai": {"modules": {"discuss": {"profileId": "reading", "thinkMode": True}}}})
        after = save_config(self.base, {"ai": {"modules": {"discuss": {"profileId": "research"}}}})
        self.assertEqual(after["ai"]["activeProfileId"], before["ai"]["activeProfileId"])
        self.assertEqual(after["ai"]["profiles"], before["ai"]["profiles"])
        self.assertEqual(after["ai"]["modules"]["discuss"], {"profileId": "research", "thinkMode": True})
        for module, _, _ in AI_MODULES:
            if module != "discuss":
                self.assertEqual(after["ai"]["modules"][module], before["ai"]["modules"][module])

    def test_all_modules_route_regular_and_streaming_requests_with_their_think_setting(self):
        self.save_profiles()
        modules = {key: {"profileId": "research", "thinkMode": index % 2 == 0}
                   for index, (key, _, _) in enumerate(AI_MODULES)}
        save_config(self.base, {"ai": {"modules": modules}})
        with patch.object(server, "BASE_DIR", self.base):
            for module, setting in modules.items():
                with self.subTest(module=module), patch.object(server, "send_chat_completion", return_value={}) as send:
                    server.post_chat_completion("wrong-key", "https://wrong.test", {"model": "wrong-model"}, 30, module=module)
                    self.assertEqual(send.call_args.args[:2], ("research-secret", "https://research.test/v1/chat/completions"))
                    payload = send.call_args.args[2]
                    self.assertEqual(payload["model"], "deep")
                    self.assertEqual("reasoning_effort" in payload, setting["thinkMode"])
                with self.subTest(module=module, stream=True), patch.object(server, "open_chat_completion_request", return_value=io.BytesIO(b'data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n')) as send:
                    self.assertEqual(list(server.stream_chat_completion("wrong", "https://wrong.test", {"model": "wrong"}, 30, module=module)), ["OK"])
                    request = send.call_args.args[0]
                    self.assertEqual(request.get_header("Authorization"), "Bearer research-secret")
                    payload = json.loads(request.data)
                    self.assertEqual(payload["model"], "deep")
                    self.assertEqual("reasoning_effort" in payload, setting["thinkMode"])

    def test_invalid_module_references_do_not_overwrite_file(self):
        self.save_profiles()
        original = config_path(self.base).read_bytes()
        for modules in ([], {"unknown": {}}, {"translate": {"profileId": "missing"}}, {"summary": None}):
            with self.subTest(modules=modules), self.assertRaises(ValueError):
                save_config(self.base, {"ai": {"modules": modules}})
            self.assertEqual(config_path(self.base).read_bytes(), original)

    def test_http_save_get_and_server_restart_retain_profiles_modules_and_keys(self):
        class QuietHandler(server.PaperReaderHandler):
            def log_message(self, *args):
                pass

        self.save_profiles()
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with patch.object(server, "BASE_DIR", self.base):
            for phase in range(2):
                httpd = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
                thread = threading.Thread(target=httpd.serve_forever, daemon=True)
                thread.start()
                url = f"http://127.0.0.1:{httpd.server_port}/api/settings"
                try:
                    if phase == 0:
                        with opener.open(url) as response:
                            payload = json.load(response)
                        payload["ai"]["activeProfileId"] = "research"
                        payload["ai"]["modules"]["translate"] = {"profileId": "reading", "thinkMode": True}
                        request = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
                        with opener.open(request) as response:
                            self.assertEqual(len(json.load(response)["settings"]["ai"]["profiles"]), 2)
                    with opener.open(url) as response:
                        ai = json.load(response)["ai"]
                    self.assertEqual(ai["activeProfileId"], "research")
                    self.assertEqual([item["id"] for item in ai["profiles"]], ["reading", "research"])
                    self.assertEqual(ai["modules"]["translate"], {"profileId": "reading", "thinkMode": True})
                    self.assertTrue(all(item["hasApiKey"] for item in ai["profiles"]))
                    self.assertEqual(server.get_ai_config("translate")[0], "reading-secret")
                finally:
                    httpd.shutdown()
                    thread.join(timeout=5)
                    httpd.server_close()

    def test_model_discovery_uses_matching_saved_key_and_deduplicates_ids(self):
        self.save_profiles()
        body = {"data": [{"id": " z-model "}, {"id": "a-model"}, {"id": "a-model"},
                         {"id": ""}, {"id": None}, None, {"name": "skip"}]}
        with patch.object(server, "BASE_DIR", self.base), patch.object(server, "open_ai_request", return_value=io.BytesIO(b'\xef\xbb\xbf' + json.dumps(body).encode())) as upstream:
            self.assertEqual(server.list_ai_models({"ai": {"id": "research"}}), ["a-model", "z-model"])
        request = upstream.call_args.args[0]
        self.assertEqual(request.full_url, "https://research.test/v1/models")
        self.assertEqual(request.get_header("Authorization"), "Bearer research-secret")
        self.assertEqual(request.get_method(), "GET")

    def test_model_discovery_accepts_draft_credentials_without_persisting_them(self):
        self.save_profiles()
        before = config_path(self.base).read_bytes()
        with patch.object(server, "BASE_DIR", self.base), patch.object(server, "open_ai_request", return_value=io.BytesIO(b'{"data":[]}')) as upstream:
            self.assertEqual(server.list_ai_models({"ai": {"id": "new", "baseUrl": "https://draft.test/v1/chat/completions?tenant=one", "apiKey": "draft-secret"}}), [])
        request = upstream.call_args.args[0]
        self.assertEqual(request.full_url, "https://draft.test/v1/models?tenant=one")
        self.assertEqual(request.get_header("Authorization"), "Bearer draft-secret")
        self.assertEqual(config_path(self.base).read_bytes(), before)
        with patch.object(server, "BASE_DIR", self.base), patch.object(server, "open_ai_request", return_value=io.BytesIO(b'{"data":[]}')) as upstream:
            server.list_ai_models({"ai": {"id": "new", "baseUrl": "http://localhost:1234/v1"}})
        self.assertIsNone(upstream.call_args.args[0].get_header("Authorization"), "new profiles must not inherit the active key")

    def test_model_list_validation_and_url_variants(self):
        for base, expected in [
            ("https://api.test/v1/", "https://api.test/v1/models"),
            ("https://api.test/v1/chat/completions/", "https://api.test/v1/models"),
            ("http://localhost:1234/v1/models", "http://localhost:1234/v1/models"),
        ]:
            self.assertEqual(server.build_models_url(base), expected)
        for base in ("file:///private", "missing-host", "https:///v1"):
            with self.assertRaises(ValueError):
                server.build_models_url(base)
        for data in (b'<html>not an api</html>', b'{}', b'{"data":{}}', b'[]', b'\xff'):
            with self.subTest(data=data), patch.object(server, "BASE_DIR", self.base), patch.object(server, "open_ai_request", return_value=io.BytesIO(data)):
                with self.assertRaisesRegex(ValueError, "模型列表"):
                    server.list_ai_models({"ai": {"baseUrl": "https://test/v1"}})

    def test_model_route_preserves_upstream_error_status_without_leaking_response_body(self):
        handler = object.__new__(server.PaperReaderHandler)
        handler.path = "/api/settings/models"
        body = json.dumps({"ai": {"id": "reading"}}).encode()
        handler.headers = {"Content-Length": str(len(body))}
        handler.rfile = io.BytesIO(body)
        replies = []
        handler._send_json = lambda status, data: replies.append((status, data))
        error = urllib.error.HTTPError("https://api.test/models", 404, "missing", {}, io.BytesIO(b'upstream-private-body'))
        with patch.object(server, "list_ai_models", side_effect=error):
            handler.do_POST()
        self.assertEqual(replies[0][0], 404)
        self.assertIn("手动", replies[0][1]["error"])
        self.assertNotIn("upstream-private-body", json.dumps(replies))

    def test_server_rejects_a_second_listener_even_when_existing_server_allows_reuse(self):
        for server_class in (ThreadingHTTPServer, server.PaperLanternHTTPServer):
            with self.subTest(existing=server_class.__name__):
                with server_class(("127.0.0.1", 0), server.PaperReaderHandler) as existing:
                    with self.assertRaises(OSError):
                        server.PaperLanternHTTPServer(existing.server_address, server.PaperReaderHandler)


if __name__ == "__main__":
    unittest.main()
