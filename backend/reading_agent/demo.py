"""Synthetic library and an offline Chat Completions fixture for repeatable P0 QA."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading


DEMO_TASK = "比较合成测试文献中的 flow control 与 baseline control，说明耗时差异和结论局限。"
DEMO_IDS = ("p0-flow-control", "p0-baseline-control")


def create_demo_library(root):
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    if (root / "library_db.json").exists():
        raise ValueError("演示库目录已有索引，不能覆盖。")
    categories = {"Demo": {"id": "Demo", "name": "合成测试文献", "parentId": "", "order": 0}}
    papers = {}
    for paper_id, title, text in (
        (DEMO_IDS[0], "Synthetic Flow Control（合成测试）",
         "SYNTHETIC TEST DATA, NOT A REAL PAPER. Flow control takes 1.0 second on the toy task. "
         "Both controllers use the same toy simulator and ten seeds. No real robot experiments were performed. "
         "This observation does not establish generalization to real robots."),
        (DEMO_IDS[1], "Synthetic Baseline Control（合成测试）",
         "SYNTHETIC TEST DATA, NOT A REAL PAPER. Baseline control takes 2.0 seconds on the same toy task. "
         "Both controllers use the same toy simulator and ten seeds. No real robot experiments were performed. "
         "The measurement concerns runtime only and does not show an accuracy advantage."),
    ):
        record = {"id": paper_id, "title": title, "itemType": "paper", "folder": f"papers/{paper_id}",
                  "categoryIds": ["Demo"], "uploadedAt": "2026-01-01T00:00:00+00:00"}
        papers[paper_id] = record
        directory = root / record["folder"]
        directory.mkdir(parents=True)
        (directory / "metadata.json").write_text(json.dumps({
            **record, "abstract": "Synthetic control comparison on a toy simulator; not real research.",
            "threeLineSummary": {"method": title},
        }, ensure_ascii=False, indent=2), encoding="utf-8")
        (directory / "extracted_text.txt").write_text(text, encoding="utf-8")
    (root / "library_db.json").write_text(json.dumps({
        "version": 2, "categories": categories, "papers": papers,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    return root


class DemoModelServer:
    """Local deterministic model endpoint; graph and MCP transport remain real."""

    def __enter__(self):
        fixture = self
        self.requests = []

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_POST(self):
                payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                fixture.requests.append(payload)
                tool_messages = [message for message in payload["messages"] if message["role"] == "tool"]
                tool_data = [json.loads(message["content"]) for message in tool_messages]
                read_data = [item for item in tool_data if item.get("passages")]
                claim_data = [item for item in tool_data if item.get("claimId")]
                contexts = [json.loads(message["content"].split("\n", 1)[1]) for message in payload["messages"]
                            if isinstance(message.get("content"), str) and message["content"].startswith("任务资料与已查阅证据")]
                if contexts:
                    read_data += [{"passages": [passage]} for passage in contexts[-1].get("evidence", [])]
                    claim_data += list(contexts[-1].get("claims", {}).values())
                if read_data and not claim_data:
                    calls = [("record_claim", {"statement": "合成任务中的耗时为1.0秒与2.0秒，前者为后者的一半（数值换算）。",
                              "kind": "inference", "supports": [{"passageId": item["passages"][0]["passageId"],
                              "quote": item["passages"][0]["text"]} for item in read_data]})]
                elif read_data and claim_data:
                    calls = []
                elif not tool_messages:
                    calls = [("search_paper_content", {"query": "control", "sources": ["abstract"]})]
                elif len(tool_messages) == 1:
                    hits = json.loads(tool_messages[0]["content"])["matches"]
                    ids = list(dict.fromkeys(hit["hash"] for hit in hits))[:2]
                    calls = [("get_paper_passages", {"hash": paper_id, "source": "full_text", "limit": 2}) for paper_id in ids]
                else:
                    calls = []
                message = {"role": "assistant", "content": ""}
                if any(tool.get("function", {}).get("name") == "research_library" for tool in payload.get("tools", [])):
                    calls = [("research_library", {"task": DEMO_TASK})]
                if calls:
                    message["tool_calls"] = [{"id": f"demo-{len(fixture.requests)}-{index}", "type": "function",
                                              "function": {"name": name, "arguments": json.dumps(arguments)}}
                                             for index, (name, arguments) in enumerate(calls)]
                else:
                    message["content"] = (
                        "# 合成文献调研演示\n\n这些资料是合成测试数据，不是真实研究论文。"
                        "两篇文献均与控制器耗时比较有关，因此纳入本次比较。\n\n"
                        "[Flow Control](hash:p0-flow-control) 在玩具任务中耗时 1.0 秒；"
                        "[Baseline Control](hash:p0-baseline-control) 在相同玩具任务中耗时 2.0 秒。"
                        "耗时相差 1.0 秒，前者为后者的一半；这不能解释为精度提升。[C1]\n\n"
                        "两者都使用同一模拟器和十个种子，没有真实机器人实验，不能据此推断真实场景泛化。"
                        "本次读取的是无分页文本缓存，无法提供 PDF 页码。"
                    )
                body = json.dumps({"choices": [{"message": message, "finish_reason": "tool_calls" if calls else "stop"}],
                                   "usage": {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150}},
                                  ensure_ascii=False).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_port}/v1/chat/completions"
        return self

    def __exit__(self, *_exc):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
