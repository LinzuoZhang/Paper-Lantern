# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Paper Lantern (formerly "openmoonlight") is a local-first paper reader and literature manager. It imports PDFs, renders them in-browser, and uses an OpenAI-compatible Chat Completions API to generate structured Chinese summaries, method breakdowns, and answer discussion questions. All UI strings are Chinese (`<html lang="zh-CN">`).

There is **no frontend build step, no bundler, and no linter**. The backend uses the Python standard library; the frontend is vanilla ES modules with vendored libraries and no CDN. Existing Python and JavaScript tests live in `tests/`.

## Commands

```bash
# Run the app (defaults to http://127.0.0.1:8000/)
python server.py

# Run all existing Python and JavaScript tests (Node.js must be on PATH)
python scripts/check.py

# Optional: only needed for PDF/Notes export endpoints
pip install pymupdf markdown-it-py matplotlib
```

To see a change: restart `python server.py` for Python edits; for frontend edits just refresh the browser (static files are read per-request). Use `PORT` to change the port and `PAPER_LIBRARY_DIR` to relocate the data directory. See `doc/development.md` for module responsibilities and stylesheet order.

## Architecture

A single Python HTTP server (`server.py`) serves both the static frontend and a JSON API. All data is stored as JSON files on disk under a "library directory" (default `literature_library/`, overridable via `PAPER_LIBRARY_DIR`).

### Backend (Python, stdlib only)

- **`server.py`** — application entry point, HTTP routes, library persistence and AI orchestration. `PaperReaderHandler(SimpleHTTPRequestHandler)` inside a `ThreadingHTTPServer`. `do_GET` serves static files and read endpoints; `do_POST` handles mutations and AI calls. `/api/*` routes are dispatched with a chain of `if request_path == ...` checks (no router framework).
  - AI calls go through `urllib.request` against an OpenAI-compatible endpoint (`build_chat_completions_url`), including SSE streaming for `/api/discuss`.
  - Library persistence is plain JSON: `read_json`/`write_json` helpers, `library_db.json` as the category+paper index ("manifest"), and per-paper folders under `papers/<paper-id>/`.
- **`backend/config_store.py`** — config + secret encryption. On Windows, secrets are encrypted with DPAPI via `ctypes` (`CryptProtectData`); elsewhere base64. `public_config()` never returns raw secrets, only `hasApiKey`/`apiKeyTail` (last 4 chars). Config lives in `.env/paperlantern_config.json`.
- **`backend/cloud_sync.py`** — bidirectional sync to a local folder or WebDAV (Jianguoyun/Nextcloud) using stdlib `urllib`. Hash-based three-way merge: SHA-256 file index + `updatedAt`, with content-hash merging for `highlights.json`/`discussion.json` and legacy-index migration.
- **`backend/category_model.py`**, **`backend/crossref.py`**, **`backend/link_preview.py`** and **`backend/llm_diagnostics.py`** — category semantics/locking, citation metadata, link previews and request timing. Import these through the `backend` package.

### Data layout

```
literature_library/
├── library_db.json              # categories + paper index (the source of truth for the tree)
├── paperlantern-sync-index.json # sync index (hash map of every synced file)
└── papers/<paper-id>/
    ├── paper.pdf
    ├── metadata.json            # title, category, summary, basicInfo, notes
    ├── highlights.json          # highlights + comments + translations
    ├── discussion.json          # {"threads": [...]}
    ├── extracted_text.txt       # browser-extracted text cache (skips re-extraction)
    ├── sync_hash.json           # content hashes used for sync conflict resolution
    └── ai_runs/<timestamp>/     # per-run debug artifacts from the summarize pipeline
```

`paper-id` is a hash of the title (`make_paper_id`), with a numeric suffix for collisions (`unique_paper_dir`).

### AI summarize pipeline (multi-stage, not one call)

`summarize_paper` orchestrates several sequential AI calls, each writing debug output via `write_ai_stage` into `ai_runs/`:

1. `extract_paper_overview` — keywords, basicInfo, methodPoints, three-line summary (`overview.txt`).
2. `summarize_method_points` - one call per method point, sequentially in the summary conversation (`method_point.txt`).
3. `method_polish` - combine the completed per-point drafts in that conversation (`method_polish.txt`), then correct formatting (`method_format.txt`). Chat Completions is stateless, so each request still transmits the conversation history; the repeated prefix may benefit from provider caching.

Prompt templates live in `prompts/ai/*.txt` and are rendered with `render_prompt`, which uses Python `str.format`. Templates must escape literal JSON braces as `{{`/`}}`.

### Frontend (vanilla ES modules, no framework)

- **`index.html` + `assets/js/pages/app.js`** — library home: category tree, paper list, upload (local file / PDF URL / arXiv), settings modal, cloud-sync controls.
- **`reader.html` + `assets/js/pages/reader.js`** — the PDF reader. Renders PDF with vendored `vendor/pdfjs/`, extracts text in-browser, and drives the highlight/comment/translate/explain selection menu, discussion threads (streaming), and a notes editor with markdown preview and PDF export. Formulas render via vendored KaTeX + `markdown-it-texmath`; the reader module also has a custom inline-math tokenizer for the summary/method sections.
- **`note.html` + `assets/js/pages/note.js`** — standalone note editor and discussion.
- **`assets/js/components/`** and **`assets/js/lib/`** — shared UI components and utilities. Relative ES module imports resolve from the module location; page navigation still resolves from root HTML documents.
- **`assets/css/`** — load `styles.css`, then `workspace.css` (design tokens/shared states), then `note.css` (shared editor styles), followed by `library.css` or `reader.css` for those pages. Preserve this order when editing HTML.
- **`vendor/`** — pdfjs, katex, markdown-it, markdown-it-texmath (all local; no CDN).

### Frontend ↔ backend contract

The browser extracts PDF text itself and POSTs `paperText` to `/api/summarize`, `/api/overview`, `/api/translate`, `/api/explain`, `/api/discuss`; the server returns JSON. `saveCurrentPaper` POSTs the merged paper state back to `/api/library/paper`. The `apiFetch` helper probes several base URLs (current origin, `127.0.0.1:8000`, `localhost:8000`, `8010`, `8765`) to locate the server, so the page can be opened by file path and still reach the API.

## Conventions & gotchas

- The reader **must** be served by `python server.py`; a plain static server breaks `/api/*` (the UI detects this and errors accordingly).
- `.env/`, `.cache/`, `literature_library/`, and `__pycache__/` are gitignored. `.env/paperlantern_config.json` and `.env/*.env` hold real API keys/WebDAV passwords — never print their contents into a commit or response.
- All JSON responses use `ensure_ascii=False`; keep Chinese user-facing strings intact.
- `server.py` defines many `MAX_*`/`MAX_*_CHARS` constants that cap paper text, translation length, discussion history, etc.; respect them when changing payload handling.
