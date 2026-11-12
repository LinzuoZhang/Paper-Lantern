# Paper Lantern Research MCP

This plugin exposes local MCP tools for the current Paper Lantern project.

It operates on the same library directory as `server.py`:

- default: `literature_library/`
- override: `PAPER_LIBRARY_DIR`

The optional [reading agent](../../doc/reading-agent.md) connects through the official MCP SDK. It sets `PAPER_LANTERN_MCP_READ_ONLY=1`: only `library_overview`, `search_library`, `list_papers`, `list_paper_summaries`, `get_paper_summary`, `get_paper_full_text`, `search_paper_content`, `get_paper_passages`, `get_paper_highlights`, `get_paper_annotations`, `get_item`, `list_flags`, and `agent_capabilities` are exposed. The read-only `get_item` reads existing files without note migration. Other calls are rejected, including helpers that invoke AI. The existing v2 manifest is read without reconciliation or saving; legacy/missing manifests return errors instead of being migrated or initialized. Normal MCP connections retain their existing behavior.

`agent_capabilities` returns the reviewed general Agent capability catalog with read/write effects and approval requirements. Optional `names` (1–6 tool names) includes their existing MCP parameter schemas. Discovering a write schema does not make that tool callable on a read-only connection. Web Agent writes are submitted as concrete plans, simulated by the HTTP service, and executed there only after user approval; this does not change normal MCP clients' write access.

## Tools

- `get_paper_highlights`: read PDF highlight groups with original quotations, rectangles, colors and annotation entries.
- `get_paper_annotations`: read highlight groups containing comments or translations, including legacy annotations.
- `add_paper_highlight`: highlight an exact original quotation on a PDF page, without an AI call.
- `add_paper_annotation`: append a comment or translation to an existing highlight group.
- `list_papers`: list every article hash and its metadata, or select articles by `hashes`.
- `list_paper_summaries`: list every article hash with its stored abstract and three-line summary; optionally select `hashes`.
- `get_paper_summary`: read a single article's stored summary by `hash`.
- `get_paper_full_text`: read a single article's complete text by `hash`, using the text cache or PDF extraction.
- `search_paper_content`: search stored abstracts, summaries, attached notes and full text; return ranked, versioned passages with source locations.
- `get_paper_passages`: read bounded passages by article hash, passage IDs or PDF page numbers.
- `ask_paper`: ask a question about one article by `hash`, using Paper Lantern's configured discussion AI.
- `library_overview`: list categories, unique direct/subtree item counts, and recent items with all category IDs and names.
- `search_library`: search papers or notes by title, ID, or category name/ID; filter by multiple categories. Use `offset` (default 0) and `limit` (default 30, maximum 200) for pagination; results include `totalMatches` and `nextOffset` (null on the final page).
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
- `rename_category`: rename a category subtree and update article/note memberships.
- `move_category`: move a category subtree or reorder sibling categories.
- `delete_category`: delete a category subtree while preserving articles; supports a preview.
- `batch_update_items`: preview or apply per-item metadata, notes, category and flag updates for up to 1,000 papers/notes.
- `list_flags`: list built-in and custom flag definitions.
- `create_flag`: create or reuse a named custom flag.
- `update_flag`: change a flag's icon or color.
- `batch_update_flags`: add or remove flags on multiple articles/notes; supports a preview.
- `update_paper`: update paper/note metadata, category memberships, notes, or local read/todo state.
- `set_item_categories`: replace all memberships of a paper or note; `categoryIds: []` clears them.
- `add_item_categories`: add memberships while preserving other real categories; Uncategorized is automatically removed.
- `remove_item_categories`: remove selected memberships; optional `includeDescendants: true` also removes memberships in subcategories.
- `create_note`: create a standalone note or report.
- `write_note`: replace, append, or prepend Markdown content in a standalone note.
- `make_paper_link`: generate the Paper Lantern note link format.

## 读取与新增论文高亮、批注 (v0.7.0)

四个工具均使用论文库内 `id`（与文章工具的 `hash` 相同），不接受独立笔记 ID。读取高亮或批注无需 AI、PyMuPDF 或启动 HTTP 服务；新增高亮需要在 MCP 的 Python 环境安装 `pymupdf`，追加批注无需该依赖。更新插件后重启或重新连接 MCP，让客户端发现新接口。

分页读取高亮，或只读取带非空批注／翻译的高亮组：

```json
{"name":"get_paper_highlights","arguments":{"id":"<paper-id>"}}
{"name":"get_paper_annotations","arguments":{"id":"<paper-id>","pageNumber":2,"color":"green"}}
```

两者都返回 `{id, total, groups, offset, nextOffset}`，`total` 是分页前、筛选后的高亮组数。可选 `pageNumber` 从 1 开始，`color` 按颜色精确筛选；`offset` 默认 0，`limit` 默认 50、范围 1–50。`nextOffset` 非空时还有下一页。每组包含 `groupId`、`pageNumber`、`selectedText`、`color`、`entries` 和 `highlights`。`entries` 是 `{id, type, content}` 列表，`type` 为 `comment` 或 `translation`；`highlights` 保留原始矩形和其他字段。一段跨行原文对应多个矩形，同属一个 `groupId`。旧格式 `comment`、`translation` 和字符串 `text` 会转换到返回的 `entries` 中，读取时不迁移文件。旧矩形若没有 `groupId`，返回与阅读器一致的位置标识，可直接用于追加批注。

按原文新增高亮：

```json
{"name":"add_paper_highlight","arguments":{"id":"<paper-id>","pageNumber":2,"text":"An exact original quotation from this page.","color":"yellow"}}
```

`id`、`pageNumber`、`text` 必填。`text` 必须能在指定页唯一定位，允许原文跨行、空白和连字规范化；找不到或多次出现会报错，可提供更长的原文消除歧义。扫描 PDF 需先 OCR。`color` 默认 `yellow`，支持 `yellow/green/blue/pink/orange/purple/red`。返回 `{id, added, group, sync}`；同页相同原文已存在时 `added: false`，返回已有组，保留其颜色和批注，不重复写入或触发同步。

使用读取或新增结果中的 `groupId` 追加批注，也可以增加翻译条目：

```json
{"name":"add_paper_annotation","arguments":{"id":"<paper-id>","groupId":"<group-id>","content":"这里的实验条件需要与表 2 对照。"}}
{"name":"add_paper_annotation","arguments":{"id":"<paper-id>","groupId":"<group-id>","type":"translation","content":"这段原文的翻译。"}}
```

`id`、`groupId`、非空 `content` 必填，`type` 默认 `comment`。返回 `{id, entry, group, sync}`，每次调用追加一条新记录。保留原有批注、翻译、高亮颜色及其他组的数据，并更新该组所有矩形的 `text/comment/translation/type`，以兼容阅读器和 PDF 导出。新增内容存储到 `highlights.json`，遵循现有自动同步设置，不改写 PDF 字节。保存后刷新已打开的阅读器即可查看。无效目标、空内容、错误页码和损坏的批注 JSON 返回工具错误，不覆盖批注文件。

只读模式开放两个读取工具，隐藏并拒绝两个新增工具。网页阅读 Agent 可发现并调用两个读取接口，每次默认最多 5 组；两个新增接口已加入其计划能力，经服务端模拟、用户确认后执行。同一计划可先新增高亮，再通过 `{"ref":"highlight.groupId"}` 引用前一步高亮并追加批注。执行前重新检查论文与批注版本，库发生变化则要求重新预览。独立研究流程可读取范围内的高亮与批注作为线索，仍须通过正文片段核验科学结论。

## 批量整理、分类与自定义标志 (v0.5.0)

以下参数中的 `id` 是文章或独立笔记的库内编号，与文章工具中的 `hash` 相同；分类和标志则使用各自的 ID。所有工具均通过 MCP `tools/call` 调用，不需要启动 HTTP 服务。

### 批量更新

`batch_update_items` 接收 `items` 数组，每项包含 `id` 以及需要更新的字段。一次支持 1–1,000 个不同的文章或笔记 ID，拒绝重复 ID、未知字段和只有 `id` 的空更新。每篇可以提交不同的更新：

- `title`、`doi`、`basicInfo`、`notes`：与 `update_paper` 一致；`basicInfo` 替换基本信息，`notes` 替换笔记正文并遵守 Markdown 写入规则。
- `categoryIds`、`addCategoryIds`、`removeCategoryIds`：依次替换、增加、移除分类归属；分类须已存在。批量接口不接受会自动创建路径的旧参数 `categoryId`。`categoryIds: []` 清空归属，使条目显示在未分类中。
- `read`、`todo`、`flags`：本机阅读状态和标志。`flags` 替换全部标志，包含内置 `read`、`todo`；`flags: []` 清空全部标志。若同时提交 `flags` 和 `read`/`todo`，以 `flags` 为准。

先预览：

```json
{"name":"batch_update_items","arguments":{"dryRun":true,"items":[{"id":"<paper-id>","addCategoryIds":["Research/RAG"],"todo":true},{"id":"<note-id>","title":"RAG 调研汇总","notes":"# 调研汇总\n\n研究记录……"}]}}
```

预览返回 `dryRun: true`、`count`、`revision` 和逐项 `changes: [{id, before, after}]`。`before`/`after` 仅包含发生变化的字段；不写入更新、不迁移旧笔记、不触发同步，`results` 为空。

确认要应用的变更后，发送相同的 `items`，将 `dryRun` 设为 `false`（或省略），并可将预览的 `revision` 作为 `expectedRevision`：

```json
{"name":"batch_update_items","arguments":{"expectedRevision":"<revision-from-preview>","items":[{"id":"<paper-id>","addCategoryIds":["Research/RAG"],"todo":true},{"id":"<note-id>","title":"RAG 调研汇总","notes":"# 调研汇总\n\n研究记录……"}]}}
```

`expectedRevision` 校验这批条目的元数据、笔记、本机状态，以及分类和标志定义；有变化时拒绝写入，需重新预览。它是可选的并发编辑检查，不是强制审批流程。

应用前先校验整批 ID、分类、标志、Markdown 和参数，校验失败时不会应用任何条目更新。成功返回 `updatedCount` 和 `results: [{id, status: "updated"}]`；需要同步时整批至多触发一次自动同步，仅更新本机标志或阅读状态时不触发。

批量操作不提供磁盘事务回滚。遇到写入错误时停止后续条目，返回 MCP `isError: true`，并在 `results` 中区分 `updated`、`failed`、`skipped`；失败项含 `error` 和 `possiblePartialWrite: true`。已完成的条目保留，失败项可能已写入部分字段，应重新读取后决定重试。若只有同步失败，返回 `syncError`，已保存的更新仍保留。`revision` 始终表示应用前的状态。

### 分类管理

**未分类是保底分类。** 内置 ID 为 `uncategorized`（显示名“未分类” / `Uncategorized`），仅在条目没有任何正式分类时生效。为文献或笔记添加任一正式分类后，系统自动移出未分类；移除最后一个正式分类后，系统自动归回未分类。

Agent 分类时只提交目标正式分类 ID，不能为了“保留已有归属”把 `uncategorized` 一并保留、追加或重新加回，也不需要额外调用移除工具。保留其他已有归属仅指正式分类。例如，原归属为 `["uncategorized"]`，调用 `add_item_categories` 并传入 `["Research/RAG"]` 后，结果为 `["Research/RAG"]`。替换分类、批量更新、导入和创建笔记均遵守此规则；写入时混合传入未分类和正式分类，未分类会被忽略。查找尚未分类的条目仍可使用 `search_library` 的 `categoryIds: ["uncategorized"]` 筛选。

```json
{"name":"rename_category","arguments":{"id":"Research/RAG","name":"Retrieval"}}
{"name":"move_category","arguments":{"id":"Research/Retrieval","parentId":"References"}}
{"name":"move_category","arguments":{"id":"References/Retrieval","beforeId":"References/Other"}}
{"name":"delete_category","arguments":{"id":"References/Retrieval","dryRun":true}}
{"name":"delete_category","arguments":{"id":"References/Retrieval"}}
```

`rename_category` 必填 `id`、`name`。`move_category` 必填 `id`，可选 `parentId`、`beforeId` 或 `afterId`；`parentId: ""` 表示根目录。`beforeId`、`afterId` 最多提交一个，目标兄弟分类决定目标父分类；若还提交 `parentId`，二者必须一致。移动到自身或子树、同名冲突、未知分类和操作锁定分类均返回工具错误。

重命名或移动会更新子分类及全部文章/笔记的分类归属，返回 `categoryId`、旧到新分类 ID 的 `idMap`、最新 `tree` 和 `sync`。分类 ID 是路径，操作后可能变化；文章/笔记 ID 不变。

`delete_category` 删除目标分类及全部子分类，只移除对应归属，保留文章、笔记及它们在其他分类中的归属；无剩余归属的条目进入未分类。`dryRun: true` 返回拟删除的 `deletedCategoryIds`、`affectedCount`、`affectedItems: [{id, beforeCategoryIds, afterCategoryIds}]`，不删除或同步；实际删除后另返回最新 `tree`。内置未分类不能被重命名、移动或删除。

### 自定义标志

```json
{"name":"list_flags","arguments":{}}
{"name":"create_flag","arguments":{"name":"待复现"}}
{"name":"update_flag","arguments":{"id":"<flag-id>","color":"#4776A8","icon":"star"}}
{"name":"batch_update_flags","arguments":{"ids":["<paper-id>","<note-id>"],"flags":["<flag-id>","todo"],"operation":"add","dryRun":true}}
{"name":"batch_update_flags","arguments":{"ids":["<paper-id>","<note-id>"],"flags":["<flag-id>","todo"],"operation":"add"}}
{"name":"batch_update_flags","arguments":{"ids":["<paper-id>"],"flags":["todo"],"operation":"remove"}}
{"name":"update_paper","arguments":{"id":"<paper-id>","flags":[]}}
```

`list_flags` 返回 `{flags: [{id, name, builtin, color, icon}]}`。`create_flag` 接收 1–24 字符的名称，忽略名称首尾空白，不允许控制字符；同名（不区分大小写）复用已有定义，包括内置名称，最多 100 个自定义标志。创建只定义标志，不分配给文章。

`update_flag` 支持内置和自定义标志，必须提供 `color` 或 `icon` 中至少一个。颜色使用 `#RRGGBB`；图标支持 `flag`、`star`、`bookmark`、`circle`、`heart`、`bolt`、`check`、`tag`。它只更新外观，不改变文献上的标志分配。

`batch_update_flags` 必填 `ids`、非空的 `flags` 和 `operation: "add" | "remove"`，最多 1,000 个条目，重复条目及标志 ID 去重。全部 ID 校验通过才保存；增加/移除保留其他标志及最近阅读时间。支持 `dryRun`，返回 `changes: [{id, beforeFlags, afterFlags}]`；实际操作另返回轻量 `papers: [{id, read, todo, flags, viewedAt}]`。整组替换或清空使用 `update_paper.flags` / `batch_update_items`。

这些标志与元数据 `tags` 不同，沿用应用的本机状态语义，保存在 `paperlantern-flags.json`，不触发云同步。升级到 v0.5.0 后重启或重新连接 MCP，刷新新增工具声明。

## 正文检索与原文片段 (v0.6.0)

这两个工具只读取当前库内未归档的 PDF 文章（不检索独立笔记），不调用 AI、不修改文献库、不迁移旧笔记，也不触发同步，无需启动 HTTP 服务。搜索会在项目 `.cache/reading-agent/<库路径摘要>/content.sqlite3` 写入库外增量索引；片段读取不写缓存。

### `search_paper_content`

必填 `query`，按空白拆成 1–32 个检索词（最多 2,000 字符），经 Unicode NFKC 与大小写归一化后做字面子串匹配。默认 `match: "all"` 要求同一片段含全部检索词；`"any"` 匹配任一词。中文直接按子串匹配，无自动分词、同义词扩展或语义检索；英文也不做词干或整词限制。

可选参数：

- `sources`：`abstract`（原文摘要，兼容 `basicInfo.abstract`）、`summary`（已保存的三行总结）、`notes`（论文附属笔记）、`full_text`（正文）；默认全部。只提供部分来源可避免全文提取。`notes.md` 优先于旧版元数据中的 `notes`，只读不迁移；总结按字段名排序输出为 `key: value` 行。
- `hashes`：限定文章 ID，去重；省略为所有文章，`[]` 为不选文章。未知 ID、独立笔记 ID 或归档文章 ID 返回工具错误。
- `categoryIds`、`categoryMatch: "any" | "all"`、`includeDescendants`：分类筛选，与 `search_library` 相同，默认包含子分类。兼容 `categoryId`；显式 `categoryIds` 优先，`[]` 不筛选分类。文章列表和分类条件取交集，多分类文章不重复扫描。
- `offset`：从 0 开始，默认 0；`limit`：默认 20，范围 1–50。

返回 `{query, terms, match, sources, categoryIds, categoryMatch, includeDescendants, searchedPaperCount, matchedPaperCount, totalMatches, offset, nextOffset, matches, warnings}`。`totalMatches` 是分页前匹配片段数量，同一篇文章可贡献多个片段；`matchedPaperCount` 是匹配文章去重数。`searchedPaperCount` 是选定并尝试检索的文章数（包含读取失败的文章），需结合 `warnings` 判断资料覆盖情况。

`matches` 每项包含文章 `hash/id/title/categoryIds/categoryNames`、`paperLink`，以及下文的片段字段、`matchedTerms` 和 `score`。先按匹配词数降序，再按各词出现次数之和降序（每词计分上限 10），最后按文章 ID、来源顺序和原文位置稳定排序。SQLite FTS5 trigram 索引支持中英文字面子串；1–2 字查询使用转义 LIKE，不支持 trigram 的环境整体回退 LIKE。按文件大小、修改时间、元数据和提取引擎更新变化的来源，复用未变来源；下一次搜索清理已删除或归档文章。首次检索可能耗时，分页时库变化仍可能改变排序和数量。返回值新增 `searchEngine`（`sqlite-fts5-trigram` 或 `sqlite-like`，短词查询仍可能使用 LIKE）和 `refreshedSources`（本次重建来源数）。

### `get_paper_passages`

必填 `hash`；`source` 默认 `full_text`，可选来源与搜索相同。可用以下一种方式读取：

- `passageIds`：搜索结果或此前读取结果的片段 ID，1–50 个；须传相同的 `source`。按请求顺序返回，重复 ID 去重；任何未知、其他文章/来源或过期 ID 都返回工具错误，不返回部分结果。
- `pageNumbers`：1 起算的 PDF 物理页码，1–100 项；仅适用于 `full_text`，按文档顺序返回，重复页码去重。超出页数报错，空白页没有片段。不支持与 `passageIds` 同时使用。
- 两者均省略：列举该来源的全部片段，通过 `offset`、`limit` 分页（默认 10，范围 1–50）。没有摘要、总结或笔记时成功返回空列表。

可选 `sourceVersion` 用于校验此前读取的来源版本；不一致时返回错误，分页时建议携带。返回文章元数据及 `{source, sourceVersion, pageCount, sourcePassageCount, totalPassages, offset, nextOffset, passages, warnings}`。`totalPassages` 是选择条件过滤后的总片段数，`sourcePassageCount` 是来源的全部片段数，`nextOffset: null` 表示没有下一页。

每个片段包含：

| 字段 | 含义 |
| --- | --- |
| `passageId` / `sourceVersion` | 绑定文章 ID、来源、文本表示和完整来源内容的版本；来源变化后旧 ID 失效 |
| `source` / `textOrigin` | 来源及读取方式：`pdf`、`cache` 或 `stored` |
| `pageNumber` | PDF 物理页码；摘要、总结、笔记或无分页缓存返回 `null` |
| `offsetScope` | `page` 表示当前页原始提取文本；`source` 表示完整来源文本 |
| `startChar` / `endChar` | 0 起算、左闭右开的 Python Unicode 字符位置（不是字节或 JS UTF-16 下标） |
| `text` | 未归一化的原文片段，最多 1,200 字符；长文本相邻片段重叠 160 字符，末尾空白可影响边界 |

正文优先使用 PyMuPDF 按页提取；无依赖、PDF 无法读取或无文本时回退 `extracted_text.txt`。回退会在 `warnings` 中提示，缓存片段不附加推测页码；要求 `pageNumbers` 时必须有可读取的分页 PDF 文本。无 PDF 文本也无有效缓存时，读取片段返回工具错误；库内搜索保留其他来源的匹配，在 `warnings` 中报告该文章缺失的来源。两工具的 `warnings` 项含 `hash`、`message`，来源级告警另含 `source`。扫描 PDF 不自动 OCR。

调用示例（MCP `tools/call` 的 `params`）：

```json
{"name":"search_paper_content","arguments":{"query":"flow matching","categoryIds":["Research"],"sources":["abstract","full_text"],"limit":10}}
{"name":"get_paper_passages","arguments":{"hash":"<paper-id>","source":"full_text","passageIds":["<搜索结果中的 passageId>"]}}
{"name":"get_paper_passages","arguments":{"hash":"<paper-id>","pageNumbers":[2,3],"limit":20}}
{"name":"get_paper_passages","arguments":{"hash":"<paper-id>","source":"notes","offset":10,"limit":10,"sourceVersion":"<上一页的 sourceVersion>"}}
```

报告内仍用 `[标题](hash:<paper-id>)` 引用文献，将页码与原文单独记录；片段 ID 不是阅读器链接。升级后重启或重新连接 MCP，刷新工具列表。

## 文章查询与问答 (v0.4.0)

这里的 `hash` 就是文献库的文章 `id`（`hash:` 链接中的编号），不是 PDF 文件内容的校验值。这五个工具仅处理当前库内的 PDF 文章，不包含独立笔记或已归档条目。调用无需启动 HTTP 服务。

以下 JSON 是 MCP `tools/call` 的 `params`：

```json
{"name":"list_papers","arguments":{}}
{"name":"list_papers","arguments":{"hashes":["<hash-1>","<hash-2>"]}}
{"name":"list_paper_summaries","arguments":{}}
{"name":"get_paper_summary","arguments":{"hash":"<paper-hash>"}}
{"name":"get_paper_full_text","arguments":{"hash":"<paper-hash>"}}
{"name":"ask_paper","arguments":{"hash":"<paper-hash>","question":"这篇文章的方法和实验结论是什么？"}}
```

- `list_papers` 返回 `{total, hashes, papers}`，其中 `papers` 包含 `hash`、`id`、标题、分类与上传时间等元数据。省略 `hashes` 获取全部文章，不设隐式条数上限；传入数组则按指定顺序返回、去除重复 hash；`[]` 返回空列表。未知 hash 或笔记 ID 返回工具错误。
- `list_paper_summaries` 同样返回 `{total, hashes, papers}`，每条额外包含 `abstract`、`threeLineSummary` 和 `hasSummary`，也支持可选的 `hashes` 筛选。
- `get_paper_summary` 返回单篇文章的元数据与上述三个摘要字段。`abstract` 优先取已保存的原文摘要，其次取 `basicInfo.abstract`；`threeLineSummary` 是已有的结构化 AI 摘要。没有摘要时返回空字段和 `hasSummary: false`，不会自动调用 AI 生成。
- `get_paper_full_text` 返回文章元数据及 `text`、`charCount`，不截断文本。优先读取 `extracted_text.txt`，无缓存时使用 PyMuPDF 从 PDF 提取；不会写入缓存或修改文件。缺少 PyMuPDF 时可先安装 `python -m pip install pymupdf`，或在阅读器内完成文本提取。扫描件须先完成 OCR；无法提取正文时返回工具错误。
- `ask_paper` 必填 `hash` 和非空 `question`，可选 `history`。它读取该篇文章的正文及已有摘要，复用设置中 `discuss` 模块的模型、API 地址、密钥和思考模式，返回 `{hash, id, title, answer, contextCharCount, contextTruncated}`。正文上下文沿用 `MAX_PAPER_CHARS` 限制（当前为 5,000,000 字符），超长时 `contextTruncated` 为 `true`。仅查询指定文章，不自动查阅库中其他文章，也不保存讨论或触发同步。缺少 AI 配置、正文不足 80 字符或上游请求失败时返回工具错误。

连续提问时由调用方传递历史消息；历史格式与内部讨论接口一致，并沿用其历史长度限制：

```json
{"name":"ask_paper","arguments":{"hash":"<paper-hash>","question":"这些实验有什么局限？","history":[{"role":"user","content":"文章的主要结论是什么？"},{"role":"assistant","content":"上一轮回答内容"}]}}
```

更新到 v0.4.0 后重启或重新连接 MCP，让客户端刷新工具列表。所有工具保留原有调用方式。

## Multiple Categories (v0.2.0)

Paper and note results include parallel `categoryIds` and `categoryNames` arrays. Summary results from `search_library` and `library_overview` retain the legacy `categoryId` and `categoryName` fields, reflecting the first category. An item with no memberships appears in `uncategorized`; its PDF, notes, and annotations remain shared across all categories.

Uncategorized (`uncategorized`, displayed as 未分类 / Uncategorized) is a fallback only. Adding any real category automatically removes it; removing the last real category restores it. Agents must submit only the intended real category IDs when classifying an item. Do not preserve, append, or re-add `uncategorized` to keep existing memberships, and do not issue a separate removal call. Preserving other memberships means preserving other real categories. Mixed write arrays ignore Uncategorized when real categories are present. This applies to category tools, `update_paper`, `batch_update_items`, imports, and note creation. Searching with `categoryIds: ["uncategorized"]` still selects items without real categories.

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
