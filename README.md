# Open Moonlight Paper Reader

一个轻量网页论文阅读工具。当前版本实现：

- 左侧上传并预览 PDF。
- 上传 PDF 后自动抽取文本并调用 DeepSeek 生成总结。
- 右侧展示关键词词典和三行摘要。
- 也可以手动修改抽取文本后点击“重新生成”。
- DeepSeek prompt 模板放在 `prompts/deepseek/`，后端运行时读取。

## 配置

DeepSeek API Key 放在 `.env/deepseek.env`：

```text
DEEPSEEK_API_KEY=sk-your-real-deepseek-api-key
```

## 启动

```powershell
python server.py
```

打开：

```text
http://127.0.0.1:8000
```

PDF 文本抽取依赖浏览器加载 PDF.js CDN。若网络无法访问 CDN，可以后续改成本地静态依赖。
