// 共享设置弹窗：文献库主页（index.html/app.js）与阅读器（reader.html/reader.js）共用。
// 单一来源：本模块在运行时把设置弹窗 HTML 注入 document.body，并自持全部设置逻辑。
// 宿主只需调用 initSettingsModal(options) 并传入少量回调。

const SETTINGS_HTML = `
  <div id="cloudConfigOverlay" class="cloud-config-overlay" hidden>
    <form id="cloudConfigForm" class="cloud-config-card">
      <div class="cloud-config-header">
        <h2>设置</h2>
        <button id="cloudConfigCloseButton" class="drawer-close-button" type="button" aria-label="关闭"></button>
      </div>
      <div class="settings-split">
        <nav class="settings-nav" aria-label="设置分组">
          <button id="settingsNavAi" class="settings-nav-item is-active" type="button" aria-selected="true" aria-controls="settingsPageAi">AI 接口</button>
          <button id="settingsNavCloud" class="settings-nav-item" type="button" aria-selected="false" aria-controls="settingsPageCloud">同步设置</button>
        </nav>
        <div class="settings-content">
          <section id="settingsPageAi" class="settings-page" aria-labelledby="settingsNavAi">
            <label>
              <span>接口地址</span>
              <input id="aiBaseUrlInput" type="url" placeholder="https://api.openai.com/v1" />
            </label>
            <label>
              <span>模型</span>
              <div class="model-input-wrap">
                <input id="aiModelInput" type="text" placeholder="gpt-4o-mini" />
                <span class="think-mode-chip" role="checkbox" tabindex="0" aria-checked="false" title="think">
                  <input id="aiThinkModeInput" type="checkbox" />
                  <span class="think-mode-check" aria-hidden="true"></span>
                  <span class="think-mode-text">think</span>
                </span>
              </div>
            </label>
            <label>
              <span>API 密钥</span>
              <input id="aiApiKeyInput" type="password" autocomplete="new-password" placeholder="留空以保留现有密钥" />
            </label>
            <label class="think-mode-row" hidden>
              <input id="aiThinkModeLegacyInput" type="checkbox" />
              <span>Think 模式</span>
            </label>
            <div class="ai-api-test-row">
              <button id="aiApiTestButton" class="ai-api-test-button" type="button">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M10 2v7.5L4.5 19a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 9.5V2" />
                  <path d="M8.5 2h7" />
                  <path d="M7 16h10" />
                </svg>
                <span>测试连接</span>
              </button>
              <p id="aiApiTestStatus" class="ai-api-test-status" role="status">
                <span class="ai-api-status-indicator" aria-hidden="true"></span>
                <span class="ai-api-status-main"></span>
                <span class="ai-api-status-sub"></span>
              </p>
            </div>
          </section>
          <section id="settingsPageCloud" class="settings-page" aria-labelledby="settingsNavCloud" hidden>
            <label>
              <span>同步方式</span>
              <select id="cloudProviderSelect">
                <option value="local">Google Drive / 本地同步文件夹</option>
                <option value="webdav">坚果云 / WebDAV</option>
              </select>
            </label>
            <label>
              <span>本地同步文件夹</span>
              <input id="cloudLocalDirInput" type="text" placeholder="C:\\Users\\you\\Google Drive\\PaperLantern" />
            </label>
            <label>
              <span>WebDAV 地址</span>
              <input id="cloudWebdavUrlInput" type="url" placeholder="https://dav.jianguoyun.com/dav/PaperLantern" />
            </label>
            <label>
              <span>账号</span>
              <input id="cloudUsernameInput" type="text" autocomplete="username" />
            </label>
            <label>
              <span>密码 / 应用密码</span>
              <input id="cloudPasswordInput" type="password" autocomplete="new-password" placeholder="留空以保留现有密码" />
            </label>
            <label class="cloud-auto-sync-row">
              <input id="cloudAutoPushInput" type="checkbox" />
              <span>库变更后自动同步</span>
            </label>
          </section>
        </div>
      </div>
    </form>
  </div>`;

let apiBaseUrl = ""; // 模块自持的 base 探测缓存，与宿主的互不干扰

export function initSettingsModal(options = {}) {
  if (document.getElementById("cloudConfigOverlay")) return api(); // 幂等守卫

  document.body.insertAdjacentHTML("beforeend", SETTINGS_HTML);

  const overlay = document.getElementById("cloudConfigOverlay");
  const form = document.getElementById("cloudConfigForm");
  const closeButton = document.getElementById("cloudConfigCloseButton");
  const aiBaseUrlInput = document.getElementById("aiBaseUrlInput");
  const aiModelInput = document.getElementById("aiModelInput");
  const aiApiKeyInput = document.getElementById("aiApiKeyInput");
  const aiThinkModeInput = document.getElementById("aiThinkModeInput");
  const aiThinkModeChip = document.querySelector(".think-mode-chip");
  const aiApiTestButton = document.getElementById("aiApiTestButton");
  const aiApiTestStatus = document.getElementById("aiApiTestStatus");
  const cloudProviderSelect = document.getElementById("cloudProviderSelect");
  const cloudLocalDirInput = document.getElementById("cloudLocalDirInput");
  const cloudWebdavUrlInput = document.getElementById("cloudWebdavUrlInput");
  const cloudUsernameInput = document.getElementById("cloudUsernameInput");
  const cloudPasswordInput = document.getElementById("cloudPasswordInput");
  const cloudAutoPushInput = document.getElementById("cloudAutoPushInput");

  const doFetch = typeof options.apiFetch === "function" ? options.apiFetch : apiFetch;
  const setBusy = typeof options.setBusy === "function" ? options.setBusy : () => {};
  const setStatus = typeof options.setStatus === "function" ? options.setStatus : () => {};
  const onSaved = typeof options.onSettingsSaved === "function" ? options.onSettingsSaved : () => {};

  let saveTimer = null;

  function open() {
    if (!overlay) return;
    overlay.hidden = false;
    aiBaseUrlInput?.focus();
  }

  function close() {
    if (overlay) overlay.hidden = true;
  }

  function isOpen() {
    return Boolean(overlay && !overlay.hidden);
  }

  function wireNav() {
    const items = Array.from(document.querySelectorAll(".settings-nav-item"));
    const pages = Array.from(document.querySelectorAll(".settings-page"));
    if (!items.length || !pages.length) return;
    items.forEach((item) => {
      item.addEventListener("click", () => {
        const targetId = item.getAttribute("aria-controls");
        items.forEach((it) => {
          const active = it === item;
          it.classList.toggle("is-active", active);
          it.setAttribute("aria-selected", String(active));
        });
        pages.forEach((page) => {
          page.hidden = page.id !== targetId;
        });
      });
    });
  }

  function wireAutosave() {
    const fields = [
      aiBaseUrlInput, aiModelInput, aiApiKeyInput, aiThinkModeInput,
      cloudProviderSelect, cloudLocalDirInput, cloudWebdavUrlInput,
      cloudUsernameInput, cloudPasswordInput, cloudAutoPushInput,
    ];
    fields.forEach((field) => {
      if (!field) return;
      const eventName = field.type === "checkbox" || field.tagName === "SELECT" ? "change" : "input";
      field.addEventListener(eventName, () => {
        window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(() => {
          save().catch((error) => console.error("设置自动保存失败。", error));
        }, 600);
      });
    });
  }

  function wireThinkModeChip() {
    if (!aiThinkModeChip || !aiThinkModeInput) return;
    const toggle = () => {
      setThinkModeChecked(!aiThinkModeInput.checked);
      aiThinkModeInput.dispatchEvent(new Event("change", { bubbles: true }));
    };
    aiThinkModeChip.addEventListener("click", (event) => {
      event.preventDefault();
      toggle();
      aiThinkModeChip.blur();
    });
    aiThinkModeChip.addEventListener("keydown", (event) => {
      if (event.key !== " " && event.key !== "Enter") return;
      event.preventDefault();
      toggle();
    });
  }

  function setThinkModeChecked(isChecked) {
    if (aiThinkModeInput) aiThinkModeInput.checked = Boolean(isChecked);
    if (aiThinkModeChip) aiThinkModeChip.setAttribute("aria-checked", String(Boolean(isChecked)));
  }

  function collectPayload() {
    return {
      ai: {
        baseUrl: aiBaseUrlInput?.value.trim() || "",
        model: aiModelInput?.value.trim() || "",
        apiKey: aiApiKeyInput?.value || "",
        thinkMode: Boolean(aiThinkModeInput?.checked),
      },
      sync: {
        provider: cloudProviderSelect?.value || "local",
        localDir: cloudLocalDirInput?.value.trim() || "",
        webdavUrl: cloudWebdavUrlInput?.value.trim() || "",
        username: cloudUsernameInput?.value.trim() || "",
        password: cloudPasswordInput?.value || "",
        autoSync: Boolean(cloudAutoPushInput?.checked),
      },
    };
  }

  function maskSecretTail(tail) {
    return `****${tail || "****"}`;
  }

  // 用 public_config 形状 { ai, sync } 填充字段
  function renderFields(config) {
    const ai = config?.ai || {};
    const sync = config?.sync || {};
    if (aiBaseUrlInput) aiBaseUrlInput.value = ai.baseUrl || "";
    if (aiModelInput) aiModelInput.value = ai.model || "";
    setThinkModeChecked(Boolean(ai.thinkMode));
    if (aiApiKeyInput) aiApiKeyInput.placeholder = ai.hasApiKey ? maskSecretTail(ai.apiKeyTail) : "粘贴 API 密钥";
    if (cloudProviderSelect) cloudProviderSelect.value = sync.provider === "webdav" ? "webdav" : "local";
    if (cloudLocalDirInput) cloudLocalDirInput.value = sync.localDir || "";
    if (cloudWebdavUrlInput) cloudWebdavUrlInput.value = sync.webdavUrl || "";
    if (cloudUsernameInput) cloudUsernameInput.value = sync.username || "";
    if (cloudPasswordInput) cloudPasswordInput.placeholder = sync.hasPassword ? maskSecretTail(sync.passwordTail) : "粘贴密码 / 应用密码";
    if (cloudAutoPushInput) cloudAutoPushInput.checked = Boolean(sync.autoSync);
  }

  // 用 public_status 形状 { provider, target, autoPush } 更新字段（可选工具）
  function refreshFromStatus(status) {
    if (!status) return;
    if (cloudProviderSelect) cloudProviderSelect.value = status.provider === "webdav" ? "webdav" : "local";
    if (status.provider === "local" && cloudLocalDirInput) cloudLocalDirInput.value = status.target || cloudLocalDirInput.value;
    if (status.provider === "webdav" && cloudWebdavUrlInput) cloudWebdavUrlInput.value = status.target || cloudWebdavUrlInput.value;
    if (cloudAutoPushInput) cloudAutoPushInput.checked = Boolean(status.autoPush);
  }

  async function load() {
    try {
      const response = await doFetch("/api/settings");
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.error || "加载设置失败。");
      renderFields(data);
    } catch (error) {
      console.error(error);
    }
  }

  async function save() {
    setBusy(true);
    try {
      const response = await doFetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(collectPayload()),
      });
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.error || "设置保存失败。");
      renderFields(data.settings);
      onSaved(data.sync);
      setStatus("设置已自动保存");
    } catch (error) {
      console.error(error);
      setStatus(error.message || "设置保存失败。", true);
    } finally {
      setBusy(false);
    }
  }

  function setTestBusy(isBusy) {
    if (!aiApiTestButton) return;
    aiApiTestButton.disabled = isBusy;
    aiApiTestButton.setAttribute("aria-busy", String(isBusy));
  }

  // 状态机：idle / testing / success / error
  function setTestState(state, { model = "", detail = "" } = {}) {
    if (!aiApiTestStatus) return;
    aiApiTestStatus.classList.remove("ok", "error", "testing");
    const main = aiApiTestStatus.querySelector(".ai-api-status-main");
    const sub = aiApiTestStatus.querySelector(".ai-api-status-sub");
    if (state === "testing") {
      aiApiTestStatus.classList.add("testing");
      main.textContent = "正在测试连接…";
      sub.textContent = "";
    } else if (state === "success") {
      aiApiTestStatus.classList.add("ok");
      main.textContent = "已连接";
      sub.textContent = model;
    } else if (state === "error") {
      aiApiTestStatus.classList.add("error");
      main.textContent = "连接失败";
      sub.textContent = detail;
    } else {
      main.textContent = "";
      sub.textContent = "";
    }
  }

  function formatTestError(data) {
    const detail = String(data?.detail || "").replace(/\s+/g, " ").trim();
    return detail ? `${data.error || "AI 接口测试失败。"} ${detail.slice(0, 260)}` : data?.error || "AI 接口测试失败。";
  }

  async function testAi() {
    setTestBusy(true);
    setTestState("testing");
    try {
      const response = await doFetch("/api/settings/test-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ai: collectPayload().ai }),
      });
      const data = await readJsonResponse(response);
      if (!response.ok) {
        setTestState("error", { detail: formatTestError(data) });
        return;
      }
      const model = data.model || aiModelInput?.value.trim() || "model";
      setTestState("success", { model });
    } catch (error) {
      console.error(error);
      setTestState("error", { detail: error.message || "AI 接口测试失败。" });
    } finally {
      setTestBusy(false);
    }
  }

  closeButton?.addEventListener("click", close);
  overlay?.addEventListener("pointerdown", (event) => {
    if (event.target === overlay) close();
  });
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
  });
  aiApiTestButton?.addEventListener("click", testAi);
  (options.openButtons || []).forEach((selector) => {
    document.querySelector(selector)?.addEventListener("click", open);
  });
  wireNav();
  wireAutosave();
  wireThinkModeChip();

  load();
  if (options.autoOpen?.queryParam && new URLSearchParams(window.location.search).get(options.autoOpen.queryParam) === "1") {
    open();
  }

  return api();

  function api() {
    return { open, close, load, setSyncFields: renderFields, refreshFromStatus, isOpen };
  }
}

async function readJsonResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  const text = await response.text();
  const detail = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  throw new Error(
    response.status === 404
      ? "接口未找到，请确认使用 python server.py 启动服务，而不是普通静态服务器。"
      : detail || `服务器返回了非 JSON 响应：HTTP ${response.status}`,
  );
}

async function apiFetch(path, options = {}) {
  const url = String(path);
  if (!url.startsWith("/")) {
    return fetch(url, options);
  }

  const bases = buildApiBaseCandidates();
  let lastError = null;
  const tried = [];
  for (const base of bases) {
    try {
      tried.push(base || window.location.origin || "current origin");
      const response = await fetch(`${base}${url}`, options);
      if (response.status !== 404 || !url.startsWith("/api/")) {
        apiBaseUrl = base;
        return response;
      }
      lastError = new Error(`API not found at ${base || "current origin"}.`);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `${lastError?.message || "Failed to fetch"} Tried: ${tried.join(", ")}. Please start the Python server and open http://127.0.0.1:8000/ or http://localhost:8000/.`,
  );
}

function buildApiBaseCandidates() {
  const candidates = [];
  if (apiBaseUrl) candidates.push(apiBaseUrl);
  if (window.location.protocol === "http:" || window.location.protocol === "https:") {
    candidates.push(window.location.origin);
  }
  [
    "http://127.0.0.1:8000",
    "http://localhost:8000",
    "http://127.0.0.1:8010",
    "http://localhost:8010",
    "http://127.0.0.1:8765",
    "http://localhost:8765",
  ].forEach((base) => {
    if (window.location.origin !== base) candidates.push(base);
  });
  return [...new Set(candidates)];
}
