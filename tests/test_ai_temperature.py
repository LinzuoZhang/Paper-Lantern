import io
import json
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

import server


class TemperatureCompatibilityTests(unittest.TestCase):
    def request(self, streaming=False):
        return urllib.request.Request(
            "https://example.com/v1/chat/completions",
            data=json.dumps({"model": "test", "temperature": 0, "stream": streaming,
                             "messages": [{"role": "user", "content": "test"}]}).encode(),
            headers={"Authorization": "Bearer test", "Content-Type": "application/json"},
        )

    def error(self, message, code=400):
        return urllib.error.HTTPError("https://example.com", code, "Bad Request", {},
                                      io.BytesIO(json.dumps({"error": {"message": message}}).encode()))

    def test_retries_regular_and_streaming_requests_without_temperature(self):
        for streaming in (False, True):
            with self.subTest(streaming=streaming):
                request = self.request(streaming)
                request.add_unredirected_header("Content-length", str(len(request.data)))
                response = object()
                with patch("server.urllib.request.urlopen", side_effect=[
                    self.error("invalid temperature: only 1 is allowed for this model"), response
                ]) as open_url:
                    self.assertIs(server.open_chat_completion_request(request, 30), response)
                retry = open_url.call_args.args[0]
                expected = json.loads(request.data)
                expected.pop("temperature")
                self.assertEqual(json.loads(retry.data), expected)
                self.assertEqual(retry.get_header("Authorization"), "Bearer test")
                self.assertIsNone(retry.get_header("Content-length"))
                self.assertEqual(open_url.call_count, 2)

    def test_preserves_unrelated_error_body(self):
        error = self.error("unsupported response_format")
        with patch("server.urllib.request.urlopen", side_effect=error) as open_url:
            with self.assertRaises(urllib.error.HTTPError) as caught:
                server.open_chat_completion_request(self.request(), 30)
        self.assertIn("response_format", caught.exception.read().decode())
        self.assertEqual(open_url.call_count, 1)

    def test_retry_failure_does_not_loop(self):
        with patch("server.urllib.request.urlopen", side_effect=[
            self.error("unsupported temperature"), self.error("unsupported temperature")
        ]) as open_url:
            with self.assertRaises(urllib.error.HTTPError):
                server.open_chat_completion_request(self.request(), 30)
        self.assertEqual(open_url.call_count, 2)

    def test_response_validation(self):
        for body, message in [
            (b"", "空响应"),
            (b"<html>gateway</html>", "网页"),
            (b"data: {}", "事件流"),
            (b"Bad gateway", "非 JSON"),
            (b"[]", "JSON 对象"),
            (b"{}", "choices"),
        ]:
            with self.subTest(body=body):
                with self.assertRaisesRegex(ValueError, message):
                    server.parse_chat_completion_response(io.BytesIO(body))
        payload = {"choices": [{"message": {"content": "OK"}}]}
        body = b"\xef\xbb\xbf" + json.dumps(payload).encode()
        self.assertEqual(server.parse_chat_completion_response(io.BytesIO(body)), payload)

    def test_proxy_reset_falls_back_to_direct_once(self):
        error = urllib.error.URLError(ConnectionResetError(10054, "reset"))
        def reset_after_proxy_setup(request, **kwargs):
            request.set_proxy("localhost:1234", "https")
            request.add_header("Proxy-authorization", "private-proxy-token")
            raise error
        with patch("server.urllib.request.urlopen", side_effect=reset_after_proxy_setup), \
             patch("server.urllib.request.getproxies", return_value={"https": "http://localhost:1234"}), \
             patch("server.urllib.request.proxy_bypass", return_value=False), \
             patch("server.urllib.request.build_opener") as build:
            response = server.open_ai_request(self.request(), 30)
        self.assertIs(response, build.return_value.open.return_value)
        build.return_value.open.assert_called_once()
        direct = build.return_value.open.call_args.args[0]
        self.assertEqual(direct.host, "example.com")
        self.assertIsNone(direct._tunnel_host)
        self.assertIsNone(direct.get_header("Proxy-authorization"))
        self.assertEqual(direct.get_header("Authorization"), "Bearer test")

    def test_unrelated_network_error_is_not_retried(self):
        error = urllib.error.URLError("DNS failed")
        with patch("server.urllib.request.urlopen", side_effect=error), \
             patch("server.urllib.request.build_opener") as build:
            with self.assertRaises(urllib.error.URLError):
                server.open_ai_request(self.request(), 30)
        build.assert_not_called()


if __name__ == "__main__":
    unittest.main()
