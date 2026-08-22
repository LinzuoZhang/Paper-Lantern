# Paper Lantern

一个本地优先、开源共享的论文阅读与文献管理工具。

有些论文阅读工具把本该贴近研究者日常的能力，藏进越来越高的订阅墙后面。Paper Lantern 想做一点相反的事：把论文阅读、总结、翻译、批注、问答这些核心能力放回用户自己手里。本项目主打开源共享，你可以在本地运行、自己改 prompt、自己管理文献库，也可以换成你喜欢的模型服务。

![Paper Lantern 阅读器预览](doc/demo.png)

## 功能

- 文献库首页：按分类管理论文，支持搜索、最近阅读、拖拽上传 PDF。
- arXiv 导入：输入 arXiv ID 或 URL，自动下载 PDF 并加入文献库。
- PDF 阅读器：基于本地 `vendor/pdfjs/` 渲染 PDF，不依赖外部 CDN。
- AI 总结：调用 DeepSeek 生成关键词、三行摘要、方法拆解和结论。
- 论文问答：围绕当前论文内容进行讨论，支持保留对话历史。
- 划词工具：选中文本后可高亮、评论或翻译。
- 批注保存：高亮、评论、翻译、摘要、讨论历史会写回本地文献库。
- 分类操作：支持新增、重命名、删除分类，以及移动、删除、下载论文。
- Prompt 可编辑：DeepSeek prompt 模板集中放在 `prompts/deepseek/`。

## 项目结构

```text
.
├── index.html              # 文献库首页
├── reader.html             # PDF 阅读器页面
├── app.js                  # 文献库前端逻辑
├── reader.js               # 阅读器、批注、总结、问答逻辑
├── server.py               # 本地 HTTP 服务与 API
├── styles.css              # 页面样式
├── prompts/deepseek/       # DeepSeek 提示词模板
├── vendor/pdfjs/           # 本地 PDF.js
├── vendor/katex/           # 本地 KaTeX，用于公式渲染
└── literature_library/     # 本地文献库数据，默认被 .gitignore 忽略
```

## 环境要求

- Python 3.9+
- 浏览器
- DeepSeek API Key

当前后端只使用 Python 标准库，不需要安装额外 Python 依赖。

## 配置

创建 `.env/deepseek.env`：

```text
DEEPSEEK_API_KEY=sk-your-real-deepseek-api-key
DEEPSEEK_MODEL=deepseek-chat
```

可选环境变量：

```text
PORT=8000
PAPER_LIBRARY_DIR=E:\your\paper_library
```

说明：

- `DEEPSEEK_MODEL` 默认是 `deepseek-chat`。
- `PAPER_LIBRARY_DIR` 不设置时，文献数据会保存在项目内的 `literature_library/`。
- `.env/` 和 `literature_library/` 已在 `.gitignore` 中忽略，避免误提交密钥和私人论文。

## 启动

在项目根目录运行：

```powershell
python server.py
```

打开：

```text
http://127.0.0.1:8000/
```

如果设置了 `PORT`，请使用对应端口。

## 使用流程

1. 打开文献库首页。
2. 点击 `Upload PDF` 上传本地 PDF，或选择 `arXiv upload` 导入 arXiv 论文。
3. 进入阅读器后，PDF 会在左侧显示，右侧显示 AI 总结、方法拆解和讨论区。
4. 在 PDF 中选中文本，可以进行高亮、评论或翻译。
5. 点击右侧刷新按钮，可重新生成当前论文摘要。

## 数据保存

默认数据目录为 `literature_library/`：

- `library_db.json`：分类、论文元数据、摘要、批注、讨论历史。
- `papers/`：上传或下载的 PDF 文件。

你可以通过 `PAPER_LIBRARY_DIR` 把文献库存到项目外，方便备份或多项目共用。

## API 概览

- `GET /api/library`：读取文献库树。
- `GET /api/library/paper?id=...`：读取单篇论文元数据。
- `GET /api/library/pdf?id=...`：读取论文 PDF。
- `POST /api/library/upload`：上传 PDF。
- `POST /api/library/arxiv`：从 arXiv 导入 PDF。
- `POST /api/library/paper`：更新、移动或删除论文。
- `POST /api/library/category`：新增、重命名或删除分类。
- `POST /api/summarize`：生成论文摘要。
- `POST /api/translate`：翻译选中文本。
- `POST /api/discuss`：围绕论文内容问答。

## 注意事项

- PDF 文本抽取在浏览器端完成，扫描版 PDF 可能无法正确提取文字。
- AI 能力依赖 DeepSeek API，调用会产生你自己账号下的费用。
- 当前项目适合个人本地使用，没有做多用户鉴权、权限隔离或公网部署加固。
