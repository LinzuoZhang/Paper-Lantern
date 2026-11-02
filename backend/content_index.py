"""Incremental SQLite FTS5 passage index, stored outside the literature library."""

import hashlib
import importlib.util
import importlib.metadata
import json
import os
from pathlib import Path
import sqlite3
import sys

from backend.paper_content import normalize_search, score_passage


def library_cache_dir(library_dir, base_dir=None):
    key = hashlib.sha256(os.path.normcase(str(Path(library_dir).resolve())).encode("utf-8")).hexdigest()[:32]
    return Path(base_dir or Path(__file__).resolve().parents[1]) / ".cache" / "reading-agent" / key


def content_fingerprint(directory, source):
    names = ["metadata.json"]
    if source == "notes":
        names.append("notes.md")
    engine = "stored"
    if source == "full_text":
        names += ["paper.pdf", "extracted_text.txt"]
        if "fitz" in sys.modules:
            module = sys.modules["fitz"]
            engine = (str(getattr(module, "VersionBind", id(module))) + "|" + str(getattr(module, "__file__", ""))) if module else "no-pdf"
        else:
            spec = importlib.util.find_spec("fitz")
            if spec:
                try:
                    version = importlib.metadata.version("PyMuPDF")
                except importlib.metadata.PackageNotFoundError:
                    version = "unknown"
                engine = version + "|" + str(spec.origin)
            else:
                engine = "no-pdf"
    files = []
    for name in names:
        path = directory / name
        try:
            stat = path.stat()
            files.append((name, stat.st_size, stat.st_mtime_ns))
        except FileNotFoundError:
            files.append((name, None, None))
    return hashlib.sha256(json.dumps(["index-v1", engine, files]).encode()).hexdigest()


class ContentIndex:
    def __init__(self, path):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, timeout=60)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS documents (
                paper_id TEXT NOT NULL, source TEXT NOT NULL, fingerprint TEXT NOT NULL,
                metadata TEXT NOT NULL, warnings TEXT NOT NULL,
                PRIMARY KEY (paper_id, source)
            );
            CREATE TABLE IF NOT EXISTS passages (
                id INTEGER PRIMARY KEY, paper_id TEXT NOT NULL, source TEXT NOT NULL,
                normalized TEXT NOT NULL, payload TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS passages_document ON passages(paper_id, source);
        """)
        try:
            with self.db:
                existing = self.db.execute("SELECT 1 FROM sqlite_master WHERE name='passage_fts'").fetchone()
                self.db.execute("CREATE VIRTUAL TABLE IF NOT EXISTS passage_fts USING fts5(normalized, tokenize='trigram')")
                if not existing:
                    self.db.execute("INSERT INTO passage_fts(rowid,normalized) SELECT id,normalized FROM passages")
            self.fts = True
        except sqlite3.OperationalError:
            self.fts = False

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.db.close()

    def _remove(self, paper_id, source):
        if self.fts:
            self.db.execute("DELETE FROM passage_fts WHERE rowid IN (SELECT id FROM passages WHERE paper_id=? AND source=?)", (paper_id, source))
        self.db.execute("DELETE FROM passages WHERE paper_id=? AND source=?", (paper_id, source))
        self.db.execute("DELETE FROM documents WHERE paper_id=? AND source=?", (paper_id, source))

    def prune(self, active_ids):
        with self.db:
            for row in self.db.execute("SELECT paper_id, source FROM documents").fetchall():
                if row["paper_id"] not in active_ids:
                    self._remove(row["paper_id"], row["source"])

    def refresh(self, records, sources, directory_for, read_content):
        warnings, refreshed = [], 0
        for record in records:
            paper_id = record["id"]
            changed, fingerprints = [], {}
            for source in sources:
                fingerprint = content_fingerprint(directory_for(record), source)
                # Membership/title changes in the manifest must update returned metadata.
                fingerprint += hashlib.sha256(json.dumps(record, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
                fingerprints[source] = fingerprint
                row = self.db.execute("SELECT fingerprint, warnings FROM documents WHERE paper_id=? AND source=?", (paper_id, source)).fetchone()
                if row is None or row["fingerprint"] != fingerprint:
                    changed.append(source)
                else:
                    warnings.extend(json.loads(row["warnings"]))
            if not changed:
                continue
            try:
                paper, documents, notices = read_content(paper_id, changed)
            except (OSError, ValueError, RuntimeError) as exc:
                paper, documents = {}, {}
                notices = [{"hash": paper_id, "message": str(exc)}]
            warnings.extend(notices)
            with self.db:
                for source in changed:
                    self._remove(paper_id, source)
                    document = documents.get(source)
                    source_notices = [item for item in notices if item.get("source", source) == source]
                    # Do not cache failures: repaired files must be retried even
                    # when the original error was transient or dependency-related.
                    if document is None:
                        continue
                    self.db.execute("INSERT INTO documents VALUES (?,?,?,?,?)", (
                        paper_id, source, fingerprints[source], json.dumps(paper, ensure_ascii=False), json.dumps(source_notices, ensure_ascii=False),
                    ))
                    for passage in document["passages"]:
                        normalized = normalize_search(passage["text"])
                        cursor = self.db.execute("INSERT INTO passages(paper_id,source,normalized,payload) VALUES (?,?,?,?)", (
                            paper_id, source, normalized, json.dumps(passage, ensure_ascii=False),
                        ))
                        if self.fts:
                            self.db.execute("INSERT INTO passage_fts(rowid,normalized) VALUES (?,?)", (cursor.lastrowid, normalized))
                    refreshed += 1
        return warnings, refreshed

    def search(self, paper_ids, sources, terms, match):
        if not paper_ids:
            return []
        # Scope is a temporary table instead of a giant IN clause (SQLite's
        # variable limit varies across the project's supported Python builds).
        self.db.execute("CREATE TEMP TABLE IF NOT EXISTS search_scope (paper_id TEXT PRIMARY KEY)")
        self.db.execute("DELETE FROM search_scope")
        self.db.executemany("INSERT INTO search_scope VALUES (?)", ((key,) for key in paper_ids))
        params = list(sources)
        conditions = ["p.paper_id IN (SELECT paper_id FROM search_scope)", f"p.source IN ({','.join('?' for _ in sources)})"]
        # Trigrams support literal substrings in both English and Chinese.
        # One/two-character words use LIKE, preserving Chinese short queries.
        if self.fts and all(len(term) >= 3 for term in terms):
            expression = (" AND " if match == "all" else " OR ").join('"' + term.replace('"', '""') + '"' for term in terms)
            conditions.append("p.id IN (SELECT rowid FROM passage_fts WHERE passage_fts MATCH ?)")
            params.append(expression)
        else:
            conditions.append("(" + (" AND " if match == "all" else " OR ").join("p.normalized LIKE ? ESCAPE '\\'" for _ in terms) + ")")
            params.extend("%" + term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%" for term in terms)
        rows = self.db.execute("SELECT p.payload,d.metadata FROM passages p JOIN documents d ON d.paper_id=p.paper_id AND d.source=p.source WHERE " + " AND ".join(conditions), params)
        result = []
        for row in rows:
            found = score_passage(json.loads(row["payload"]), terms, match)
            if found is not None:
                result.append({**json.loads(row["metadata"]), **found})
        return result
