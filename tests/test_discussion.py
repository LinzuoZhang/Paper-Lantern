import json
import tempfile
import unittest
from pathlib import Path

import cloud_sync
import server


class DiscussionReferenceTests(unittest.TestCase):
    def setUp(self):
        self.reference = {
            "text": "引用原文", "paperTitle": "论文", "page": 3,
            "before": "前文", "after": "后文",
            "ranges": [{"pageNumber": 3, "left": 0.1, "top": 0.2,
                        "width": 0.3, "height": 0.04}],
        }
        self.payload = {"threads": [{
            "id": "discussion-test", "title": "引用提问",
            "messages": [{"role": "user", "content": "问题"}],
            "reference": self.reference, "updatedAt": "2026-10-12",
        }]}

    def test_save_hash_update_and_reload_preserve_reference(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "discussion.json"
            path.write_text(json.dumps(server.normalize_discussion_payload(self.payload)), encoding="utf-8")
            cloud_sync.update_paper_sync_hash(directory)
            loaded = server.normalize_discussion_payload(json.loads(path.read_text(encoding="utf-8")))
            self.assertEqual(loaded["threads"][0]["reference"], self.reference)

    def test_sync_merge_and_hash_include_reference(self):
        merged = cloud_sync.merge_discussion_payloads({}, self.payload)
        self.assertEqual(merged["threads"][0]["reference"], self.reference)
        original_hash = cloud_sync.hash_discussion_bytes(json.dumps(self.payload).encode())
        self.payload["threads"][0]["reference"]["page"] = 4
        self.assertNotEqual(original_hash, cloud_sync.hash_discussion_bytes(json.dumps(self.payload).encode()))

    def test_legacy_discussions_still_load(self):
        legacy = [{"role": "user", "content": "旧问题"}]
        self.assertEqual(cloud_sync.normalize_discussion_payload(legacy)["threads"][0]["messages"], legacy)


if __name__ == "__main__":
    unittest.main()
