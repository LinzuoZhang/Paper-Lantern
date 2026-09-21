# Paper Lantern Research MCP

This plugin exposes local MCP tools for the current Paper Lantern project.

It operates on the same library directory as `server.py`:

- default: `literature_library/`
- override: `PAPER_LIBRARY_DIR`

## Tools

- `library_overview`: list categories and recent library items.
- `search_library`: search papers or notes by title, id, or category id.
- `get_item`: read one paper or standalone note.
- `import_paper_from_url`: download a PDF URL or arXiv link into the library.
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
