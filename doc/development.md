# 开发说明

项目使用 Python 标准库 HTTP 服务和原生 JavaScript ES Modules，没有前端构建步骤。运行入口保持在仓库根目录：

```powershell
python server.py
```

页面地址仍为 `/`、`/reader.html?id=...` 和 `/note.html?id=...`。前端静态资源通过 `/assets/` 加载，第三方依赖继续由 `/vendor/` 提供。

## 代码位置与职责

| 位置 | 职责 |
| --- | --- |
| `server.py` | 服务启动、HTTP 路由、文献数据读写与 AI 流程 |
| `backend/category_model.py` | 多分类模型、归属合并与文献库锁 |
| `backend/config_store.py` | 配置存储与密钥加密 |
| `backend/cloud_sync.py` | 本地目录和 WebDAV 同步 |
| `backend/crossref.py` | 论文元数据查询与引用格式 |
| `backend/link_preview.py` | 网页链接预览 |
| `backend/llm_diagnostics.py` | AI 请求耗时记录 |
| `backend/auto_highlight.py` | 自动高亮的输入校验、分批 LLM 原文筛选与唯一引文校验 |
| `backend/pdf_highlights.py` | MCP 通过 PyMuPDF 将引文转换为阅读器使用的相对坐标 |
| `assets/js/pages/app.js` | 文献库页面入口 |
| `assets/js/pages/reader.js` | PDF 阅读页面入口 |
| `assets/js/pages/note.js` | 独立笔记页面入口 |
| `assets/js/components/` | 批注、讨论、笔记编辑器、文献侧栏、设置和分类组件 |
| `assets/js/lib/` | 最近阅读记录等共享工具 |
| `assets/js/lib/auto_highlight.js` | 阅读器自动高亮的原文标准化与文本层 Range 定位 |
| `prompts/ai/` | AI 提示词模板 |
| `extension/` | 浏览器扩展，独立加载 |
| `plugins/` | MCP 插件，通过根目录的 `server` 模块复用文献库能力 |

页面入口负责组合共享组件。ES Module 的 `import` 路径相对于模块文件；页面跳转、PDF worker 和 Vditor 的资源地址相对于根目录 HTML，调整文件位置时需要分别检查。

后端模块使用 `backend.*` 导入，包内部使用相对导入。`server.py` 留在根目录，因此配置、提示词、默认文献库位置，以及 MCP 插件的项目定位方式保持不变。

## 自动高亮的数据流

阅读器的 `#autoHighlightButton` 沿用 `.pdf-toolbar-button` 样式，入口为 `reader.js` 中的 `autoHighlightPaper()`。浏览器通过 PDF.js 提取分页文本，调用 `POST /api/auto-highlight`；服务端经 `auto_highlight_quotes()` 复用已配置的模型服务。`backend/auto_highlight.py` 将输入按最多 24,000 字符分批，每批最多接受 6 处引文，并剔除不在对应页唯一出现的内容。

HTTP 接口只返回页码和引文。前端用 `findAutoHighlightRange()` 在 PDF 文本层中精确定位，转换为相对矩形坐标，设置 `color: "purple"`、`source: "auto-highlight"` 和分组 ID，合并到现有批注后通过 `saveCurrentPaper()` 保存。定位忽略空白、软连字符和兼容字符差异，不使用跳词模糊匹配；相同页的相同标准化原文会去重。

Research MCP 的 `auto_highlight_paper` 直接读取库内 PDF，复用相同的模型筛选逻辑，再由 `backend/pdf_highlights.py` 提取逐字坐标、按行合并，并转换到旋转后的页面相对坐标。LLM 请求期间不持有文献库锁；写入前重新检查论文及 PDF 内容，并重读已有批注以合并期间新增的内容。保存会更新同步哈希并按设置尝试自动同步；`save: false` 返回预览，不写文件或触发同步。此路径需要 PyMuPDF，浏览器路径不需要。

## 样式加载顺序

保持 HTML 中的加载顺序，避免改变层叠结果：

1. 需要编辑器的页面先加载 `vendor/` 中的 KaTeX、texmath 和 Vditor 样式。
2. `assets/css/styles.css`：现有基础样式和组件默认布局。
3. `assets/css/workspace.css`：统一颜色、字体、间距、圆角和交互变量，以及全局工作区控件状态。
4. `assets/css/note.css`：共享编辑器控件、文档排版和独立笔记布局。
5. 文献库加载 `assets/css/library.css`；论文阅读器加载 `assets/css/reader.css`。

共享变量集中在 `workspace.css` 的 `body.workspace-page` 中。页面布局继续使用 `.library-page`、`.paper-reader-page` 和 `.standalone-note-*` 等选择器限定作用范围。

## 验证

需要 Python 和 PATH 中可用的 Node.js；测试无需安装前端包：

```powershell
python scripts/check.py
```

该脚本从项目目录运行 Python `unittest` 和全部 `tests/*_test.mjs`，任一检查失败都会返回非零退出码。也可以单独运行：

```powershell
python -m unittest discover -s tests -p "test_*.py"
node --test tests/discussion_navigation_test.mjs
```

修改前端后，刷新浏览器检查文献库、阅读器和笔记页；修改 Python 后，重启服务。涉及静态资源路径时，还需检查 PDF worker、编辑器动态资源和浏览器控制台。

自动高亮的检查覆盖原文校验、跨行与连字匹配、接口失败、切换论文、去重、MCP 参数、预览和保存。`tests/test_mcp_auto_highlight_native.py` 使用真实 PDF 验证跨行及旋转坐标、保存与重载；未安装 PyMuPDF 时会跳过该项。安装 `python -m pip install pymupdf` 后，可用以下命令单独运行：

```powershell
python -m unittest discover -s tests -p "test_mcp_auto_highlight_native.py"
```

## 本地数据

`.env/`、`.cache/`、`literature_library/`、`dist/` 和 `build/` 是被 Git 忽略的本地配置、缓存、文献或构建输出，不属于源码整理范围。默认数据路径以及 `PAPER_LIBRARY_DIR` 的覆盖方式保持不变。
