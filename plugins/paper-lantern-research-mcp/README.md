# Paper Lantern Research MCP

This plugin exposes local MCP tools for the current Paper Lantern project.

It operates on the same library directory as `server.py`:

- default: `literature_library/`
- override: `PAPER_LIBRARY_DIR`

## Tools

- `library_overview`: list categories and recent library items.
- `search_library`: search papers or notes by title, id, or category id.
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
- `update_paper`: update paper metadata, category, notes, or local read/todo state.
- `create_note`: create a standalone note or report.
- `write_note`: replace, append, or prepend Markdown content in a standalone note.
- `make_paper_link`: generate the Paper Lantern note link format.

## Paper Links

Paper Lantern notes can jump to a library paper with this Markdown form:

```markdown
[label](hash:<paper-id>)
```

Use `make_paper_link` to generate this format from a known `paper_id`.
