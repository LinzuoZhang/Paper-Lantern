"""Persistent search reuse, literal matching, invalidation and scope isolation."""

from unittest.mock import patch

import server
from backend.content_index import ContentIndex, library_cache_dir
from test_mcp_content import MCPContentFixture


class ContentIndexTests(MCPContentFixture):
    def setUp(self):
        super().setUp()
        self.base = patch.object(server, "BASE_DIR", self.root)
        self.base.start()
        self.addCleanup(self.base.stop)

    def search(self, query, **kwargs):
        return self.call("search_paper_content", {"query": query, "sources": ["full_text"], **kwargs})

    def test_warm_index_does_not_reread_and_file_change_invalidates(self):
        paper = self.paper()
        self.cache(paper, "Original experiment evidence")
        self.assertEqual(self.search("experiment")["refreshedSources"], 1)
        with patch.object(self.mcp, "read_article_content", side_effect=AssertionError("warm index reread")):
            warm = self.search("experiment")
        self.assertEqual(warm["refreshedSources"], 0)
        self.assertEqual(warm["matchedPaperCount"], 1)
        self.cache(paper, "Revised evaluation data")
        self.assertEqual(self.search("experiment")["matchedPaperCount"], 0)
        self.assertEqual(self.search("evaluation")["matchedPaperCount"], 1)
        path = library_cache_dir(self.library, self.root) / "content.sqlite3"
        self.assertTrue(path.exists())
        self.assertFalse(path.is_relative_to(self.library))

    def test_chinese_short_terms_unicode_and_literal_punctuation(self):
        self.cache(self.paper(), '机器人实验 ＡＢＣ alpha_beta 10% x"y')
        for query in ("机", "实验", "机器人", "abc", "alpha_beta", "10%", 'x"y'):
            with self.subTest(query=query):
                self.assertEqual(self.search(query)["matchedPaperCount"], 1)
        self.assertEqual(self.search("alpha%beta")["matchedPaperCount"], 0)

    def test_scope_and_metadata_changes_never_leak_warm_results(self):
        first, second = self.paper("A"), self.paper("B")
        for paper in (first, second):
            self.cache(paper, "Shared experiment evidence")
        self.assertEqual(self.search("experiment")["matchedPaperCount"], 2)
        scoped = self.search("experiment", categoryIds=["A"])
        self.assertEqual([p["hash"] for p in scoped["matches"]], [first["id"]])
        self.assertEqual(self.search("experiment", hashes=[second["id"]])["matchedPaperCount"], 1)
        server.update_paper_categories(first["id"], ["C"])
        self.assertEqual(self.search("experiment", categoryIds=["A"])["matchedPaperCount"], 0)
        self.assertEqual(self.search("experiment", categoryIds=["C"])["matches"][0]["categoryIds"], ["C"])

    def test_deleted_sources_and_archived_records_are_removed(self):
        paper = self.paper()
        directory = self.cache(paper, "Original experiment evidence")
        self.search("experiment")
        (directory / server.EXTRACTED_TEXT_FILE).unlink()
        self.assertEqual(self.search("experiment")["matchedPaperCount"], 0)
        self.cache(paper, "Original experiment evidence")
        self.search("experiment")
        server.archive_item(paper["id"])
        self.assertEqual(self.search("experiment")["matchedPaperCount"], 0)
        with ContentIndex(library_cache_dir(self.library, self.root) / "content.sqlite3") as index:
            self.assertEqual(index.db.execute("SELECT count(*) FROM passages").fetchone()[0], 0)

    def test_like_fallback_has_the_same_literal_results(self):
        paper = self.paper()
        self.cache(paper, "机器人实验 alpha_beta experiment")
        self.search("experiment")
        with ContentIndex(library_cache_dir(self.library, self.root) / "content.sqlite3") as index:
            index.fts = False
            self.assertEqual(len(index.search([paper["id"]], ["full_text"], ["机器人", "experiment"], "all")), 1)
            self.assertEqual(len(index.search([paper["id"]], ["full_text"], ["alpha%beta"], "all")), 0)

    def test_new_fts_table_backfills_an_existing_passage_cache(self):
        paper = self.paper()
        self.cache(paper, "Original experiment evidence")
        self.search("experiment")
        path = library_cache_dir(self.library, self.root) / "content.sqlite3"
        with ContentIndex(path) as index:
            if not index.fts:
                self.skipTest("SQLite does not support trigram FTS")
            with index.db:
                index.db.execute("DROP TABLE passage_fts")
        with patch.object(self.mcp, "read_article_content", side_effect=AssertionError("Unnecessary source reread")):
            self.assertEqual(self.search("experiment")["matchedPaperCount"], 1)
