import unittest
from unittest.mock import patch

import server


class SummaryTimingTests(unittest.TestCase):
    def test_overview_emits_all_three_lines_before_keyword_explanations(self):
        lines = {"challenges": "挑战", "method": " 方法 $d$ ", "conclusion": "结论"}
        stages = []

        def explain(*args):
            self.assertEqual(stages[0][0], "overview")
            self.assertEqual(stages[0][1]["threeLineSummary"], {**lines, "method": "方法 $d$"})
            return {}

        with patch("server.call_chat_completions", return_value=({"threeLineSummary": lines}, "raw")), \
                patch("server.explain_keywords", side_effect=explain):
            overview, _ = server.extract_paper_overview("key", "model", "url", "paper", on_stage=lambda *event: stages.append(event))
        self.assertEqual(overview["threeLineSummary"]["method"], "方法 $d$")
        self.assertEqual([stage for stage, _ in stages], ["overview", "keywords"])

    def test_completion_preserves_early_method_with_fallback_for_missing_value(self):
        for early_method in ("简洁方法摘要", ""):
            with self.subTest(method=early_method), \
                    patch("server.extract_paper_overview", return_value=({"threeLineSummary": {"method": early_method}}, "raw")), \
                    patch("server.summarize_method_points", return_value=[]), \
                    patch("server.call_conversation_completion", return_value=({}, "raw")), \
                    patch("server.format_method_breakdown", return_value=({"method": "详细方法"}, "raw")):
                summary, _ = server.summarize_paper("key", "model", "url", "paper")
            self.assertEqual(summary["threeLineSummary"]["method"], early_method or "详细方法")


if __name__ == "__main__":
    unittest.main()
