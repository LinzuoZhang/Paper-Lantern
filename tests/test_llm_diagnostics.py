import unittest
from unittest.mock import patch

from llm_diagnostics import RequestTiming


class RequestTimingTests(unittest.TestCase):
    def test_records_first_event_and_finishes_once(self):
        with patch("llm_diagnostics.perf_counter", side_effect=[10, 11, 14]):
            timing = RequestTiming({"model": "test"}, "https://example.com/v1", True)
            timing.mark("first_content_s")
            timing.mark("first_content_s")
            timing.data["usage"] = {"total_tokens": 5}
            timing.finish()
            timing.finish()
            timing.mark("late_s")
        self.assertEqual(timing.data["first_content_s"], 1)
        self.assertEqual(timing.data["total_s"], 4)
        self.assertEqual(timing.data["usage"]["total_tokens"], 5)
        self.assertNotIn("late_s", timing.data)

    def test_does_not_retain_request_content_or_secrets(self):
        timing = RequestTiming(
            {"model": "test", "messages": [{"content": "private prompt"}]},
            "https://user:password@example.com/v1?key=secret",
        )
        timing.finish(ValueError("private response"))
        self.assertEqual(timing.data["host"], "example.com")
        self.assertEqual(timing.data["error_type"], "ValueError")
        for secret in ["private prompt", "password", "secret", "private response"]:
            self.assertNotIn(secret, repr(timing.data))


if __name__ == "__main__":
    unittest.main()
