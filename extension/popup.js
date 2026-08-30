import { checkHealth, getApiBase, importRemotePdf, normalizeImportSource, readerUrl, setApiBase } from "./api.js";

const serviceStatus = document.querySelector("#serviceStatus");
const importCurrentButton = document.querySelector("#importCurrentButton");
const settingsForm = document.querySelector("#settingsForm");
const apiBaseInput = document.querySelector("#apiBaseInput");
const message = document.querySelector("#message");

init();

async function init() {
  apiBaseInput.value = await getApiBase();
  await refreshHealth();
}

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await setApiBase(apiBaseInput.value);
  await refreshHealth();
});

importCurrentButton.addEventListener("click", async () => {
  setMessage("正在识别当前页...");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const source = normalizeImportSource(tab?.url || "");
  if (!source) {
    setMessage("当前页不是可直接导入的 PDF 或 arXiv 页面。", true);
    return;
  }
  await runImport(() => importRemotePdf(source));
});

async function refreshHealth() {
  try {
    const { base } = await checkHealth(apiBaseInput.value);
    serviceStatus.textContent = `已连接 ${base}`;
    serviceStatus.classList.remove("error");
    setMessage("");
  } catch (error) {
    serviceStatus.textContent = "未连接本地服务";
    serviceStatus.classList.add("error");
    setMessage(error.message || "请先运行 python server.py。", true);
  }
}

async function runImport(importer) {
  importCurrentButton.disabled = true;
  setMessage("正在导入...");
  try {
    const { base, data } = await importer();
    const paper = data.paper;
    setMessage(`已导入：${paper.title || "PDF"}`);
    await chrome.tabs.create({ url: readerUrl(base, paper.id) });
  } catch (error) {
    setMessage(error.message || "导入失败，请确认本地服务已启动。", true);
  } finally {
    importCurrentButton.disabled = false;
  }
}

function setMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle("error", isError);
}
