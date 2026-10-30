# API 说明

[返回 README](../README.md) · [使用指南](usage.md) · [Research MCP](../plugins/paper-lantern-research-mcp/README.md)

本文描述 `server.py` 提供的本地 HTTP API。默认服务地址为 `http://127.0.0.1:8000`；修改端口后请同步调整客户端地址。服务绑定本机回环地址，面向个人本地使用，未提供多用户鉴权。

## 请求与响应约定

- 除 PDF 上传外，POST 请求使用 `Content-Type: application/json`，正文编码为 UTF-8。
- 普通响应为 JSON；PDF 下载返回 `application/pdf`，流式 AI 响应返回 `text/event-stream`。
- 常见错误结构为 `{"error":"错误信息","detail":"可选详情"}`。部分文件下载或未知路由错误由 HTTP 服务器返回 HTML，客户端应先检查状态码与 Content-Type。
- 常见状态码：`200` 成功，`202` 导入任务已接受，`400` 参数错误，`403` 操作受限，`404` 资源不存在，`409` 冲突或同步取消，`500` 服务或 AI 配置错误。上游 AI 请求失败可能透传其 HTTP 状态码。
- `paper` 同时用于论文和独立笔记；新建笔记接口的响应字段为 `note`。ID 应从响应中获取。

## 文献库与文件

| 方法 | 路径 | 参数与返回 |
| --- | --- | --- |
| GET | `/api/health` | 返回 `{ok, app, root}`，其中 `root` 为文献库路径 |
| GET | `/api/library` | 返回 `{root, tree}`，包含分类与条目树 |
| GET | `/api/library/paper?id=<id>` | 返回 `{paper}`，包含笔记、批注、讨论和可用的文本缓存 |
| POST | `/api/library/upload` | multipart 上传，返回 `{paper, tree, sync}` |
| POST | `/api/library/note` | 创建独立笔记，返回 `{note, tree, sync}` |
| POST | `/api/library/paper` | 保存条目或执行分类、删除、阅读状态操作 |
| POST | `/api/library/category` | 创建、重命名、移动或删除分类 |
| GET | `/api/library/pdf?id=<id>` | 读取原始 PDF，支持 Range 请求；添加 `notes=1` 下载已保存笔记的 PDF |
| GET | `/api/library/export?id=<id>` | 下载带批注的 PDF；添加 `type=notes` 导出已保存笔记 |
| POST | `/api/library/notes/pdf` | 使用 `{id, notes}` 将请求中的 Markdown 导出为 PDF，不保存该正文 |

PDF 和笔记导出依赖见[使用指南](usage.md#写阅读笔记)。

### 上传 PDF 与新建笔记

上传使用 `multipart/form-data`：`pdf` 为必填文件字段，`title` 为可选标题，`categoryIds` 为可选分类列表，可使用 JSON 数组字符串或多个同名字段。

```powershell
curl.exe -F "pdf=@paper.pdf" http://127.0.0.1:8000/api/library/upload
```

新建笔记使用 JSON，`title` 缺省时为“新建笔记”。创建后通过 `/api/library/paper` 保存正文：

```json
{"title":"阅读记录","categoryIds":[]}
```

### 多分类约定

导入、新建笔记和分类归属操作支持 `categoryIds` 数组，优先于旧的单分类字段 `categoryId`、`category`。数组元素使用分类 ID，而非显示名称；可从分类树或创建分类的响应中获取。

条目返回平行的 `categoryIds`、`categoryNames` 数组，并保留单分类兼容字段。无归属的条目显示在“未分类”中。同一 PDF 重复导入时，会向已有条目增加指定分类。

`POST /api/library/paper` 的分类操作：

| action | 含义 |
| --- | --- |
| `set_categories` | 替换全部归属，`categoryIds: []` 清空归属 |
| `add_categories` | 增加归属，保留其他归属 |
| `remove_categories` | 移除指定归属，保留其他归属 |
| `move` | 兼容操作，替换分类归属 |
| `move-many` | 使用 `ids` 数组批量替换分类归属 |

```json
{"id":"<paper-id>","action":"set_categories","categoryIds":["<category-id-a>","<category-id-b>"]}
```

单条操作返回 `{paper, tree, sync}`；`move-many` 返回 `{papers, tree, sync}`。

### 保存内容与阅读状态

`POST /api/library/paper` 默认 `action` 为 `save`。请求必须包含 `id`，可按需提交以下字段：

- 内容与元数据：`title`、`notes`（Markdown 字符串）、`doi`、`basicInfo`、`summary`、`overviewInfo`。
- 批注与讨论：`highlights`（数组）、`discussion`（数组或包含线程的对象）。提交这些字段会替换相应已保存内容，客户端应先读取并合并。
- 分类：`categoryIds`。
- 本地状态：`read`、`todo`（布尔值），或 `flags`（完整的标志 ID 数组），仅保存在本机，不触发云同步。`flags` 替换当前全部标志，空数组清空；内置 ID `read`、`todo` 与原有布尔字段保持兼容。
- 文本缓存：`extractedText`（字符串）。

```json
{"id":"<paper-id>","notes":"# 阅读记录\n\n待复现的方法……","todo":true}
```

`action: "view"` 更新最近阅读时间，返回 `{id, viewedAt}`。

### 文献标志

`GET /api/library/flags` 返回 `{flags: [{id, name, builtin, color, icon}]}`，包含内置“已读”“待办”和已创建的自定义标志。`color` 为 `#RRGGBB` 格式的图标颜色，默认为 `#73777d`；`icon` 默认为 `flag`。`GET /api/library` 也提供同一 `flags` 列表；每篇文献的 `flags` 字段表示已选择的标志 ID。

`POST /api/library/flags` 接受 `{name: "精读"}`，创建可重复使用的自定义标志，返回 `{flag, flags}`。名称限 1–24 个字符，同名标志会复用已有 ID；最多创建 100 个自定义标志。创建定义后，通过保存接口分配给文献：

```json
{"id":"<paper-id>","flags":["read","<custom-flag-id>"]}
```

同一标志接口也接受 `{id: "todo", color: "#4776a8", icon: "star"}`，其中 `color`、`icon` 均可单独提交，返回 `{flag, flags}`。`icon` 支持 `flag`、`star`、`bookmark`、`circle`、`heart`、`bolt`、`check`、`tag`。支持内置和自定义标志，保留未提交的设置，不修改文献分配状态或触发云同步。

批量管理使用 `POST /api/library/paper` 的 `flags-many` 操作。`ids` 为文献 ID 数组，`flags` 为需要添加或移除的标志 ID 数组，`operation` 为 `add` 或 `remove`；每篇文献的其他标志保持不变。返回 `{papers, tree, sync: null}`，全部 ID 验证通过后才保存，不触发云同步。

文献库前端提交 `response: "flags"` 获取轻量响应：`{papers: [{id, read, todo, flags, viewedAt}], sync: null}`，只更新本地列表中的标志，不重新读取或返回整库正文、讨论及笔记。未指定该字段时保留完整响应。

```json
{"action":"flags-many","ids":["<paper-id-a>","<paper-id-b>"],"flags":["todo","<custom-flag-id>"],"operation":"add"}
```

定义和选择状态保存在文献库目录的 `paperlantern-flags.json`，与最近阅读记录共用本机状态文件。旧版 `read`、`todo` 更新仍可使用，并保留其他自定义标志。

`action: "delete"` 使用 `id` 归档条目；`delete-many` 使用 `ids` 数组批量归档，返回中包含 `deleted` 数量。当前 HTTP 删除操作会将条目移入可恢复归档；恢复与永久删除工具见 MCP 文档。

### 分类管理

`POST /api/library/category` 支持：

| action | 请求字段 |
| --- | --- |
| `create` | `name`，可选 `parentId` |
| `rename` | `id`、`name` |
| `move` | `id`，可选 `parentId`、`beforeId`、`afterId` |
| `delete` | `id` |

创建、重命名和移动返回 `{categoryId, tree, sync}`；删除返回 `{tree, sync}`。分类变化后应使用返回的树刷新客户端。

## 异步链接导入

1. `POST /api/library/import/start` 创建或复用任务。
2. `GET /api/library/import/status?jobId=<job-id>` 查询进度。
3. 如需停止，`POST /api/library/import/cancel`，正文为 `{"jobId":"<job-id>"}`。

开始请求支持 `url`、`pdfUrl` 或 `arxivId`，按 `pdfUrl`、`url`、`arxivId` 顺序取第一个非空值；另可传入 `title` 和 `categoryIds`。

```json
{"url":"https://arxiv.org/abs/1706.03762","categoryIds":[]}
```

响应为 `{job}`，新任务通常返回 `202`，复用已完成任务时返回 `200`。`job` 包含 `jobId`、`state`、`stage`、`downloadedBytes`、`totalBytes`、`finalUrl`、`paperId`、`existingItem`、`error` 和 `canSafelyRetry` 等字段。用返回的 `jobId` 继续查询，成功完成后使用 `paperId` 获取条目。

相同来源、标题和分类的有效任务可复用。取消只在开始写入文献库前生效，客户端应以查询返回的任务状态为准。旧路径 `/api/library/remote-pdf` 和 `/api/library/arxiv` 当前也进入同一异步流程，不应期待同步返回 `paper`。

## AI 接口

调用前需配置模型服务。正文文本由客户端提取，多数接口通过 `paperText` 提交，自动高亮通过 `pages` 提交分页文本；AI 生成结果需另行调用条目保存接口持久化。

以下路径均使用 POST：

| 路径 | 主要请求字段 | 普通响应 |
| --- | --- | --- |
| `/api/overview` | `paperText`，可选 `paperId` | `{overviewInfo, raw}` |
| `/api/summarize` | `paperText`，可选 `paperId`、`stream` | `{summary, raw}` |
| `/api/translate` | `text`，可选 `paperText`、`summary` | `{translation}` |
| `/api/explain` | `selectedText`、`paperText`，可选 `summary` | `{explanation}` |
| `/api/auto-highlight` | `pages: [{pageNumber, text}]`，页码从 1 开始 | `{highlights: [{pageNumber, text}]}` |
| `/api/discuss` | `question`、`paperText`，可选 `summary`、`history`、`selectionReference`、`contextType`、`taskInstruction`、`stream` | `{answer}` |
| `/api/discussion-title` | `question`，可选 `answer`、`paperTitle`、`selectionReference` | `{title}` |

概览、总结、解释和论文讨论要求去除首尾空白后的 `paperText` 至少 80 个字符。讨论设为 `contextType: "note"` 时使用笔记上下文，不受该最低长度限制；`history` 使用 `role`、`content` 消息对象数组。翻译的文本字段是 `text`，解释的文本字段是 `selectedText`。

### 自动高亮

`POST /api/auto-highlight` 使用当前配置的 LLM，按最多 24,000 字符分批挑选重要原文，每批最多接受 6 处引文。输入的 `pages` 为非空数组，元素包含互不重复、从 1 开始的整数 `pageNumber` 和原文字符串 `text`；最多 1,000 页，分页文本合计需至少 80 字符、最多 500,000 字符。

请求示例：

```json
{
  "pages": [
    {
      "pageNumber": 1,
      "text": "We study memory-efficient training for large models. Our method reduces memory usage by forty percent while preserving accuracy. Experiments compare the method with three baselines."
    }
  ]
}
```

响应结构示例（具体引文由模型选择，也可能返回空数组）：

```json
{
  "highlights": [
    {
      "pageNumber": 1,
      "text": "Our method reduces memory usage by forty percent while preserving accuracy."
    }
  ]
}
```

服务端会剔除无法在对应页唯一定位的引文，允许空白、软连字符和兼容字符的差异。接口不返回矩形坐标，也不保存批注。阅读器会进一步精确定位 PDF 文本层，将结果转换为紫色高亮，合并已有批注后调用 `/api/library/paper` 保存；相同页的相同原文不重复添加。成功新增并保存后，阅读器将紫色标签改为“自动高亮”。

无效页码、文本格式、文字不足或超出长度限制返回 `400`；未配置 AI、调用失败或模型响应格式无效会返回错误响应，上游 HTTP 错误可能透传其状态码。没有合适或可唯一定位的引文时仍返回 `200` 和 `{"highlights":[]}`。

Research MCP 提供 `auto_highlight_paper`：必填 `id`，可选布尔参数 `save`，默认为 `true`。它直接读取库内 PDF，默认合并保存紫色高亮，`save: false` 仅预览但仍调用 LLM；无需打开阅读器或 HTTP 服务。MCP 返回包含相对矩形坐标的 `highlights`、原文 `quotes`、新增或预览组数 `addedCount`、重复数 `duplicateCount`、无法定位数 `unmatchedCount`，以及 `color: "purple"`、`colorMeaning: "自动高亮"`。该路径依赖 PyMuPDF，完整调用示例见 [Research MCP 自动高亮](../plugins/paper-lantern-research-mcp/README.md#automatic-highlights-v030)。

### 流式响应

`/api/discuss` 和 `/api/summarize` 支持 `stream: true`。客户端应读取 POST 响应流，按 SSE 空行分隔事件并解析 `data:` 行。

讨论逐段返回增量，最后发送 `[DONE]`：

论文讨论可传入当前文献的 `paperId`，通过 `paperIds: ["文献ID", ...]` 指定对话中加入的论文，空数组表示不查阅其他论文。笔记讨论也支持 `paperIds`。兼容旧客户端：论文讨论传入 `paperId` 但省略 `paperIds` 时使用文献库中的其他论文。

流中可能先返回 `{"status":"正在查阅…"}` 进度事件；这些事件不是回答内容。主模型接收指定论文的编号和摘要，可通过结构化决策发起最多 4 轮、每轮最多 4 个独立论文问答，完成后才返回 `delta`。流开始后的错误通过 `{"error":"错误说明"}` 返回。非流式请求等待协作结束后返回最终 `answer`。

`POST /api/discussion/paper-summary` 接收 `{"paperId":"文献ID"}`，返回 `{paper}`。已有完整三行摘要时直接复用，否则读取文本缓存或用 PyMuPDF 提取 PDF，通过一次 LLM 调用生成三行摘要并合并保存到元数据。讨论消息支持可选字段 `papers: [{id, title, authors}]`（每条最多12篇），保存、同步、重载时保留。

```text
data: {"delta":"回答片段"}

data: [DONE]
```

总结按阶段返回 `{"stage":"阶段名","summary":{...}}`，阶段包括 `overview`、`keywords`、`method_progress` 和 `complete`。发生流内错误时返回 `stage: "error"`，详情位于 `summary.detail`；总结流不使用讨论的 `[DONE]` 结束标记。

## 设置与同步

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/settings` | 返回公开配置 `{ai, sync}`；密钥与密码仅返回是否存在及尾部标识 |
| POST | `/api/settings` | 保存 `{ai, sync}`，返回 `{settings, sync}` |
| POST | `/api/settings/test-ai` | 使用 `{ai: {...}}` 测试 AI 配置，支持 `id`、`baseUrl`、`model`、`apiKey`、`thinkMode`；提供 `id` 时从对应组补全配置，否则使用当前组 |
| POST | `/api/settings/models` | 使用 `{ai: {id, baseUrl, apiKey}}` 读取对应接口的可用模型，返回 `{models: ["模型 ID", ...]}`；不保存配置 |
| GET | `/api/cloud-sync` | 获取同步配置与状态 |
| GET | `/api/cloud-sync/progress` | 获取同步进度 |
| POST | `/api/cloud-sync/config` | 保存同步字段，返回公开同步状态 |
| POST | `/api/cloud-sync` | `action: "sync"` 执行同步，`action: "cancel"` 请求停止 |

AI 设置示例：

```json
{"ai":{"baseUrl":"https://api.example.com/v1","model":"your-model","apiKey":"your-api-key","thinkMode":false}}
```

多组模型和 API 配置示例：

```json
{
  "ai": {
    "activeProfileId": "reading",
    "profiles": [
      {"id": "reading", "name": "日常阅读", "baseUrl": "https://api.example.com/v1", "model": "fast-model", "apiKey": "key-one"},
      {"id": "research", "name": "深度分析", "baseUrl": "https://other.example.com/v1", "model": "reasoning-model", "apiKey": "key-two"}
    ],
    "modules": {
      "summary": {"profileId": "research", "thinkMode": true, "customPrompt": "优先解释实验依据，保留关键公式。"},
      "translate": {"profileId": "reading", "thinkMode": false},
      "discuss": {"profileId": "", "thinkMode": true}
    }
  }
}
```

`profiles` 为完整配置列表，省略已有组即删除该组，列表至少包含一组，`id` 必须唯一；新组可省略 `id`，由服务端生成。密钥省略或留空只会保留相同 ID 的密钥，新 ID 不继承其他组的密钥。仅切换时可提交 `{"ai":{"activeProfileId":"research"}}`。GET 返回每组的 `hasApiKey` 和 `apiKeyTail`，不返回密钥；顶层 `ai.baseUrl`、`model`、`thinkMode` 等字段继续反映当前组，旧版单组写入更新当前组。

测试指定组可提交 `{"ai":{"id":"research"}}`，也可同时传入表单中尚未保存的字段。测试不会修改已保存配置；未知 ID 没有可复用的已存密钥，需显式提供 `apiKey`。

读取模型列表使用同样的 `id`、`baseUrl`、`apiKey` 补全规则，向兼容 OpenAI 的 `/models` 接口发送 GET；完整 `/chat/completions` 地址也能转换为对应的 `/models` 地址。模型 ID 去重后排序返回。密钥留空复用同 ID 的已存密钥，新 ID 不继承默认密钥；无密钥的本地接口也可读取。接口未实现模型列表时仍可手动配置模型 ID。

`ai.modules` 支持部分更新，各模块包含 `profileId`（空字符串表示跟随 `activeProfileId`）和独立的 `thinkMode`。模块 ID 为 `overview`、`summary`、`keywords`、`translate`、`explain`、`discuss`、`research`、`discussionTitle` 和 `autoHighlight`。GET 另返回 `ai.moduleDefinitions`，包含模块 ID、名称和说明。普通请求、流式请求和 MCP 自动高亮均使用对应模块设置。旧版 profile 上的 `thinkMode` 仅用于兼容和初始化模块默认值；模块设置优先生效。

各模块还包含 `customPrompt` 字符串，默认 `""`。保存时省略该字段会保留已有提示词，传空字符串会清除；非字符串返回 400。提示词作为模块系统指令的补充，应用于后续普通和流式请求，保留默认任务及输出格式要求，不随接口切换或删除而清除。例如仅更新翻译提示词可提交 `{"ai":{"modules":{"translate":{"customPrompt":"保留专业术语的英文。"}}}}`。已有分析不会自动重新生成；关键词模块有非空提示词时跳过通用解释缓存，避免复用或覆盖不同要求的结果。

`/api/settings` 中 `sync` 的字段包括 `provider`（`local` 或 `webdav`）、`localDir`、`webdavUrl`、`username`、`password`、`autoSync`。本地同步示例：

```json
{"sync":{"provider":"local","localDir":"E:\\paperlantern-sync","autoSync":true}}
```

同步执行请求会等待同步结果；客户端可从另一个请求轮询进度或发送取消请求。

直接调用 `/api/cloud-sync/config` 时，上述同步字段放在请求顶层，自动同步开关使用 `autoPush`，而非 `/api/settings` 中的 `sync.autoSync`。

## 引用与链接预览

| 方法 | 路径 | 请求与响应 |
| --- | --- | --- |
| POST | `/api/citation` | 接受 `paperId` 或 `title`，可选 `authors`、`institutions`、`venue`、`publishedDate` / `year`、`doi`、`paperText`、`localOnly`；返回 `{doi, candidates}` |
| POST | `/api/citation/apply` | 使用 `{paperId, candidate}` 应用候选元数据，`candidate.title` 必填；返回 `{paper, tree, sync}` |
| POST | `/api/link-preview` | 使用 `{url}` 获取 `{preview}`；预览失败时返回空对象 |

引用查询默认可能访问 Crossref；`localOnly: true` 根据当前元数据生成引用结果。候选格式由查询响应提供，可直接选择候选提交给应用接口。

MCP 工具名称、参数与调用示例见 [Research MCP 文档](../plugins/paper-lantern-research-mcp/README.md)，不应直接作为 HTTP 路径调用。
