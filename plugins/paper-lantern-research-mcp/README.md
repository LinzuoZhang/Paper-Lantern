# Paper Lantern Research MCP

This plugin exposes local MCP tools for the current Paper Lantern project.

It operates on the same library directory as `server.py`:

- default: `literature_library/`
- override: `PAPER_LIBRARY_DIR`

## Tools

- `library_overview`: list categories, unique direct/subtree item counts, and recent items with all category IDs and names.
- `search_library`: search papers or notes by title, ID, or category name/ID; filter by multiple categories.
- `get_item`: read one paper or standalone note.
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

## Paper Links

Paper Lantern notes can jump to a library paper with this Markdown form:

```markdown
[label](hash:<paper-id>)
```

Use `make_paper_link` to generate this format from a known `paper_id`.
