# Paper Lantern Research MCP

This plugin exposes local MCP tools for the current Paper Lantern project.

It operates on the same library directory as `server.py`:

- default: `literature_library/`
- override: `PAPER_LIBRARY_DIR`

## Tools

- `library_overview`: list categories, unique direct/subtree item counts, and recent items with all category IDs and names.
- `search_library`: search papers or notes by title, ID, or category name/ID; filter by multiple categories.
- `get_item`: read one paper or standalone note.
- `auto_highlight_paper`: use the configured LLM to select important original text and save purple PDF highlights; supports a preview with `save: false`.
- `start_import`: start an idempotent asynchronous PDF/arXiv import.
- `get_import_status`: inspect import stage, byte progress, final URL, duplicate result, and retry safety.
- `cancel_import`: cancel an import before it begins writing to the library.
- `import_paper_from_url`: backward-compatible alias for `start_import`.
- `archive_item`: move an item into the recoverable archive.
- `restore_item`: restore an archived item.
- `delete_item`: archive by default, or permanently delete only with `permanent: true`.
- `list_duplicates`: find duplicates by PDF hash, DOI, source URL, or normalized title.
- `merge_duplicate_items`: merge research data into a canonical item and archive the duplicates.
- `create_category`: create a category.
- `update_paper`: update paper/note metadata, category memberships, notes, or local read/todo state.
- `set_item_categories`: replace all memberships of a paper or note; `categoryIds: []` clears them.
- `add_item_categories`: add memberships while preserving all others.
- `remove_item_categories`: remove selected memberships; optional `includeDescendants: true` also removes memberships in subcategories.
- `create_note`: create a standalone note or report.
- `write_note`: replace, append, or prepend Markdown content in a standalone note.
- `make_paper_link`: generate the Paper Lantern note link format.

## Multiple Categories (v0.2.0)

Paper and note results include parallel `categoryIds` and `categoryNames` arrays. Summary results from `search_library` and `library_overview` retain the legacy `categoryId` and `categoryName` fields, reflecting the first category. An item with no memberships appears in `uncategorized`; its PDF, notes, and annotations remain shared across all categories.

`start_import`, `import_paper_from_url`, and `create_note` accept `categoryIds`. Empty or omitted memberships mean Uncategorized; a duplicate import adds the requested memberships to the existing article. Existing single-category `categoryId` requests remain supported. When both parameters are supplied, `categoryIds` takes precedence.

For membership updates, categories must already exist (obtain IDs from `library_overview` or create them with `create_category`). The legacy `update_paper.categoryId` retains its previous behavior of creating a missing category path.

Use these arguments with MCP `tools/call`:

```json
{"name":"set_item_categories","arguments":{"id":"paper-id","categoryIds":["Research/RAG","References"]}}
{"name":"add_item_categories","arguments":{"id":"paper-id","categoryIds":["To reproduce"]}}
{"name":"remove_item_categories","arguments":{"id":"paper-id","categoryIds":["Research"],"includeDescendants":true}}
{"name":"set_item_categories","arguments":{"id":"paper-id","categoryIds":[]}}
```

Membership removal retains the article and all memberships outside the requested scope. Removing the last membership places the article in Uncategorized. Empty arrays on add/remove are no-ops. Category IDs are deduplicated. `update_paper` also accepts `categoryIds`, `addCategoryIds`, and `removeCategoryIds` together: replacement is applied first, then additions, then removals. Invalid parameters or unknown categories are rejected before any part of the update is saved. These writes follow the configured automatic sync setting; read/todo-only updates remain local.

Search supports `categoryIds`, `categoryMatch: "any" | "all"` (default `"any"`), and `includeDescendants` (default `true`). Empty `categoryIds` applies no category filter. The legacy `categoryId` filter remains available; an explicit `categoryIds` overrides it. Results and counts always deduplicate by item ID, and `totalMatches` gives the count before `limit`.

```json
{"name":"search_library","arguments":{"categoryIds":["Research","References"],"categoryMatch":"all","includeDescendants":true}}
{"name":"start_import","arguments":{"url":"https://arxiv.org/abs/2401.12345","categoryIds":["Research/RAG","References"]}}
{"name":"create_note","arguments":{"title":"Reading notes","categoryIds":["Research/RAG","References"]}}
```

Restart the MCP server/connection after updating so clients refresh the tool declarations.

## Automatic Highlights (v0.3.0)

Ask your MCP client, for example: “Find this paper in my library, preview its important passages, then save the automatic highlights when I ask.” Use `search_library` to obtain its ID, then `auto_highlight_paper` to generate highlights. The selection uses the AI service configured in Paper Lantern Settings, independently of the model used by the MCP client. For the PDF toolbar workflow, see the [Chinese usage guide](../../doc/usage.md#自动高亮重要原文).

Install `PyMuPDF` in the Python environment that runs the MCP server:

```powershell
python -m pip install pymupdf
```

Configure the AI service in Paper Lantern Settings, then call:

```json
{"name":"auto_highlight_paper","arguments":{"id":"<paper-id>"}}
```

To preview without saving:

```json
{"name":"auto_highlight_paper","arguments":{"id":"<paper-id>","save":false}}
```

These objects are the `params` of an MCP `tools/call` request. `id` is a required nonblank string; `save` is an optional boolean defaulting to `true`. Unknown arguments are rejected.

The tool reads the library PDF directly; the HTTP server and PDF reader do not need to be open. It shares the reader's bounded LLM selection and exact-quotation validation. `save` defaults to `true`; `false` still calls the LLM and returns proposed rectangles, but writes no files and triggers no sync. Existing highlights, comments and translations are preserved; identical quotations on the same page are skipped. New highlights use `color: "purple"` and `source: "auto-highlight"`.

Results include `id`, `saved`, `addedCount` (quotation groups, or proposed groups in preview), `duplicateCount`, `unmatchedCount`, `quotes`, `highlights` (normalized rectangles), `unmatched`, `color`, `colorMeaning: "自动高亮"`, `openPath` and `sync`. Refresh an open reader after saving. Purple labels default to “自动高亮” when automatic highlights exist; explicit browser color labels still take precedence and can be edited inline.

Each rectangle contains `pageNumber` (starting at 1), `left`, `top`, `width`, `height` (fractions of the rotated page), `groupId`, `selectedText`, `color: "purple"`, `source: "auto-highlight"` and `text: []`. A quotation spanning multiple lines produces multiple rectangles with one shared `groupId`, so `addedCount` can be smaller than the length of `highlights`. `saved` reflects the requested save mode; zero new groups is a successful result, including when all selected quotations were duplicates. Saving follows the library's automatic sync setting; preview and duplicate-only results do not trigger sync.

The tool uses the same 24,000-character batches and maximum of six quotations per batch as the HTTP path. Input must contain at least 80 extractable characters and at most 1,000 pages. Original PDF bytes are not rewritten; highlights are stored in the paper's `highlights.json`. The model call runs without holding the library lock, then the tool checks the PDF is unchanged and reloads current annotations before merging.

Only PDF papers with extractable text are supported; standalone notes, scanned PDFs without OCR, missing AI configuration, and papers exceeding 500,000 extracted characters return tool errors without saving. Updating the plugin to v0.3.0 requires restarting/reconnecting the MCP server so clients discover the new tool.

## Paper Links

Paper Lantern notes can jump to a library paper with this Markdown form:

```markdown
[label](hash:<paper-id>)
```

Use `make_paper_link` to generate this format from a known `paper_id`.

## Markdown Write Contract

`create_note.content`, `write_note.content`, and `update_paper.notes` enforce the same Markdown rules on the MCP server:

- Inline formulas use `$...$`; display formulas use `$$...$$`. Inline formulas must close on the same line. Delimiters must match and contain nonempty content.
- LaTeX `\(...\)` / `\[...\]` delimiters are rejected. Math environments and common math commands must be inside dollar delimiters. Escape literal currency dollars as `\$`.
- Library citations use `[label](hash:<paper-id>)`, with an ID that exists in the current library. Obtain IDs with `search_library` / `get_item` and generate links with `make_paper_link`. Bare `hash:` IDs, reference-style/HTML hash links, and reader page URLs are rejected. Ordinary external links remain supported.
- Fenced and inline code examples are exempt from these checks.

Validation runs before note creation or update side effects. Invalid content returns an MCP tool error with a line number and correction guidance; it is not silently rewritten. Append/prepend operations validate the combined final document, so legacy invalid content must be corrected with a replacement before appending. Content exceeding the note size limit is rejected rather than truncated.

These checks recognize explicit syntax, not the meaning of arbitrary prose: they cannot identify every unwrapped mathematical expression or every plain-text mention of a paper. Tool and parameter descriptions instruct AI clients to follow the contract as well. The contract applies to MCP writes; manual editor writes are unchanged.

Restart/reconnect the MCP connection after updating to refresh the tool descriptions.
