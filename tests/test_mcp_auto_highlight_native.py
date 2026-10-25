"""Optional native PDF integration test; install PyMuPDF to enable it."""

import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import server
from test_categories import LibraryFixture

try:
    import fitz
except ImportError:
    fitz = None


@unittest.skipIf(fitz is None, "PyMuPDF is optional")
class NativeMCPAutoHighlightTests(LibraryFixture):
    def test_real_pdf_multiline_rotated_geometry_preview_save_and_reload(self):
        quote = "Our method improves accuracy by forty percent."
        stream = (b"BT /F1 11 Tf 30 260 Td (Background and motivation for the experiment.) Tj "
                  b"0 -40 Td (Our method improves accuracy) Tj 0 -20 Td (by forty percent.) Tj ET")
        objects = [b"<< /Type /Catalog /Pages 2 0 R >>",
                   b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
                   b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 300] /Rotate 90 /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
                   b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
                   b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream"]
        content, offsets = b"%PDF-1.4\n", [0]
        for index, value in enumerate(objects, 1):
            offsets.append(len(content))
            content += f"{index} 0 obj\n".encode() + value + b"\nendobj\n"
        xref = len(content)
        content += b"xref\n0 6\n0000000000 65535 f \n"
        content += b"".join(f"{offset:010d} 00000 n \n".encode() for offset in offsets[1:])
        content += f"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
        paper = server.add_paper_to_db("Native PDF highlight test", [], io.BytesIO(content))
        path = Path(server.__file__).parent / "plugins/paper-lantern-research-mcp/scripts/paper_lantern_research_mcp.py"
        spec = importlib.util.spec_from_file_location("native_highlight_mcp", path)
        mcp = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mcp)

        def call(save):
            result = mcp.handle_request({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {
                "name": "auto_highlight_paper", "arguments": {"id": paper["id"], "save": save},
            }})["result"]
            self.assertFalse(result["isError"], result)
            return json.loads(result["content"][0]["text"])

        with patch.object(server, "get_ai_config", return_value=("key", "model", "https://example.test", False)), \
             patch.object(server, "call_chat_completions", return_value=({"highlights": [{"pageNumber": 1, "text": quote}]}, {})):
            preview = call(False)
            self.assertEqual(preview["addedCount"], 1)
            self.assertEqual(len(preview["highlights"]), 2)
            self.assertEqual(server.read_paper(paper["id"])["highlights"], [])
            saved = call(True)
            highlights = server.read_paper(paper["id"])["highlights"]
            self.assertEqual(len(highlights), 2)
            self.assertEqual(len({item["groupId"] for item in highlights}), 1)
            self.assertEqual(saved["addedCount"], 1)
            self.assertEqual(call(True)["duplicateCount"], 1)
        for item in highlights:
            self.assertEqual(item["color"], "purple")
            self.assertGreater(item["height"], 0)
            self.assertGreater(item["width"], 0)
            self.assertTrue(0 <= item["left"] < item["left"] + item["width"] <= 1)
            self.assertTrue(0 <= item["top"] < item["top"] + item["height"] <= 1)
            # At 90 degrees, horizontal source lines become tall, narrow marks.
            self.assertGreater(item["height"], item["width"])
