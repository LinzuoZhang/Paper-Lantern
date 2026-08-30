import { importRemotePdf, normalizeImportSource, readerUrl } from "./api.js";

const MENU_IMPORT_LINK = "paper-lantern-import-link";
const MENU_IMPORT_PAGE = "paper-lantern-import-page";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_IMPORT_LINK,
    title: "导入 PDF 到 Paper Lantern",
    contexts: ["link"],
    targetUrlPatterns: ["http://*/*", "https://*/*"],
  });
  chrome.contextMenus.create({
    id: MENU_IMPORT_PAGE,
    title: "导入当前页面到 Paper Lantern",
    contexts: ["page"],
    documentUrlPatterns: ["http://*/*", "https://*/*"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  const rawSource = info.menuItemId === MENU_IMPORT_LINK ? info.linkUrl : info.pageUrl;
  const source = normalizeImportSource(rawSource);
  if (!source) {
    notify("Paper Lantern", "没有识别到 PDF 或 arXiv 页面。");
    return;
  }
  await importAndOpen(source);
});

async function importAndOpen(source) {
  try {
    chrome.action.setBadgeText({ text: "..." });
    chrome.action.setBadgeBackgroundColor({ color: "#2563eb" });
    const { base, data } = await importRemotePdf(source);
    const paper = data.paper;
    chrome.action.setBadgeText({ text: "" });
    notify("Paper Lantern", `已导入：${paper.title || "PDF"}`);
    await chrome.tabs.create({ url: readerUrl(base, paper.id) });
  } catch (error) {
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#dc2626" });
    notify("Paper Lantern 导入失败", error.message || "请确认 python server.py 已启动。");
  }
}

function notify(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "figure.jpg",
    title,
    message,
  });
}
