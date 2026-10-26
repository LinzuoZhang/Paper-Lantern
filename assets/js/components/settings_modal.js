// 共享设置弹窗，由文献库和阅读器的页面入口初始化。
// 单一来源：本模块在运行时把设置弹窗 HTML 注入 document.body，并自持全部设置逻辑。
// 宿主只需调用 initSettingsModal(options) 并传入少量回调。

const SETTINGS_HTML = `
  <div id="cloudConfigOverlay" class="cloud-config-overlay" hidden>
    <form id="cloudConfigForm" class="cloud-config-card" role="dialog" aria-modal="true" aria-labelledby="settingsTitle" tabindex="-1">
      <header class="cloud-config-header">
        <h2 id="settingsTitle">设置</h2>
        <button id="cloudConfigCloseButton" class="drawer-close-button" type="button" aria-label="关闭设置"></button>
      </header>
      <div class="settings-split">
        <nav class="settings-nav" role="tablist" aria-label="设置分组" aria-orientation="vertical">
          <button id="settingsNavAi" class="settings-nav-item is-active" type="button" role="tab" aria-selected="true" aria-controls="settingsPageAi">
            <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4.5" y="4.5" width="11" height="11" rx="2"/><path d="M8 1.5v3m4-3v3m-4 11v3m4-3v3M1.5 8h3m-3 4h3m11-4h3m-3 4h3"/><path d="M8 8h4v4H8z"/></svg>
            <span>AI 接口</span>
          </button>
          <button id="settingsNavCloud" class="settings-nav-item" type="button" role="tab" tabindex="-1" aria-selected="false" aria-controls="settingsPageCloud">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15.5 7a6 6 0 0 0-10-1L3 8m0-4v4h4m-2.5 5a6 6 0 0 0 10 1l2.5-2m0 4v-4h-4"/></svg>
            <span>同步设置</span>
          </button>
          <button id="settingsNavModules" class="settings-nav-item" type="button" role="tab" tabindex="-1" aria-selected="false" aria-controls="settingsPageModules">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 5h12M4 10h12M4 15h12"/><circle cx="7" cy="5" r="2"/><circle cx="13" cy="10" r="2"/><circle cx="8" cy="15" r="2"/></svg>
            <span>模块配置</span>
          </button>
        </nav>
        <div class="settings-content">
          <section id="settingsPageAi" class="settings-page" role="tabpanel" aria-labelledby="settingsNavAi" tabindex="0">
            <div class="settings-page-heading">
              <h3>AI 接口</h3>
              <p>管理模型与服务接口，为阅读和研究选择合适的配置。</p>
            </div>
            <div class="settings-profile-toolbar">
              <div class="settings-field">
                <label for="aiProfileSelect">默认接口配置</label>
                <select id="aiProfileSelect"></select>
              </div>
              <button id="aiProfileAddButton" class="settings-button" type="button">
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>新建
              </button>
              <div id="aiProfileMenuWrap" class="settings-menu-wrap">
                <button id="aiProfileMenuButton" class="settings-button settings-icon-button" type="button" aria-label="更多配置操作" aria-haspopup="menu" aria-expanded="false" aria-controls="aiProfileMenu">
                  <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3" cy="8" r=".8"/><circle cx="8" cy="8" r=".8"/><circle cx="13" cy="8" r=".8"/></svg>
                </button>
                <div id="aiProfileMenu" class="settings-menu" role="menu" aria-label="配置操作" hidden>
                  <button id="aiProfileDeleteButton" type="button" role="menuitem">删除配置…</button>
                </div>
              </div>
            </div>
            <section class="settings-group" aria-labelledby="aiConnectionTitle">
              <h4 id="aiConnectionTitle">连接参数</h4>
              <div class="settings-fields">
                <div class="settings-field">
                  <label for="aiProfileNameInput">配置名称</label>
                  <input id="aiProfileNameInput" type="text" placeholder="例如：日常阅读" />
                </div>
                <div class="settings-field">
                  <label for="aiBaseUrlInput">接口地址</label>
                  <input id="aiBaseUrlInput" type="url" placeholder="https://api.openai.com/v1" spellcheck="false" />
                </div>
                <div class="settings-field">
                  <label for="aiModelSelect">模型 ID</label>
                  <div class="settings-model-control">
                    <select id="aiModelSelect" aria-describedby="aiModelsStatus"></select>
                    <button id="aiModelsLoadButton" class="settings-button" type="button" aria-controls="aiModelSelect" title="从当前接口加载可用模型">加载模型</button>
                  </div>
                  <input id="aiModelInput" type="text" placeholder="输入自定义模型 ID" spellcheck="false" autocomplete="off" aria-label="自定义模型 ID" aria-describedby="aiModelsStatus" hidden />
                  <p id="aiModelsStatus" class="settings-hint" role="status" aria-live="polite">可从下拉列表选择，或选择“手动输入”填写模型 ID。</p>
                </div>
                <div class="settings-field">
                  <label for="aiApiKeyInput">API 密钥</label>
                  <div class="settings-secret-wrap">
                    <input id="aiApiKeyInput" type="password" autocomplete="new-password" placeholder="留空以保留现有密钥" aria-describedby="aiApiKeyHint" />
                    <button id="aiApiKeyToggle" class="settings-secret-toggle" type="button" aria-label="显示 API 密钥" aria-pressed="false" aria-controls="aiApiKeyInput">
                      <svg viewBox="0 0 20 20" aria-hidden="true"><g class="settings-eye-open"><path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Z"/><circle cx="10" cy="10" r="2"/></g><g class="settings-eye-closed"><path d="m3 3 14 14M8 5.3A9 9 0 0 1 10 5c5 0 8 5 8 5a15 15 0 0 1-2.5 3M5 6.3A17 17 0 0 0 2 10s3 5 8 5a9 9 0 0 0 3-.5"/></g></svg>
                    </button>
                  </div>
                  <p id="aiApiKeyHint" class="settings-hint">留空保留当前配置的密钥；已保存的密钥仅显示尾号。</p>
                </div>
              </div>
              <div class="ai-api-test-row">
                <button id="aiApiTestButton" class="settings-button ai-api-test-button" type="button">测试连接</button>
                <p id="aiApiTestStatus" class="ai-api-test-status" role="status" aria-live="polite">
                  <span class="ai-api-status-indicator" aria-hidden="true"></span>
                  <span class="ai-api-status-main"></span>
                  <span class="ai-api-status-sub"></span>
                </p>
              </div>
            </section>
          </section>
          <section id="settingsPageModules" class="settings-page" role="tabpanel" aria-labelledby="settingsNavModules" tabindex="0" hidden>
            <div class="settings-page-heading">
              <h3>模块配置</h3>
              <p>为各功能选择接口配置，并独立设置 Think 模式。</p>
            </div>
            <section class="settings-group" aria-labelledby="aiModulesTitle">
              <h4 id="aiModulesTitle">模块调用</h4>
              <p class="settings-hint settings-modules-hint">选择“跟随默认”时使用 AI 接口页的默认配置。Think 由各模块单独控制。</p>
              <div class="settings-module-columns" aria-hidden="true"><span>模块</span><span>接口配置</span><span>Think</span></div>
              <div id="aiModuleRows" class="settings-module-rows"></div>
            </section>
          </section>
          <section id="settingsPageCloud" class="settings-page" role="tabpanel" aria-labelledby="settingsNavCloud" tabindex="0" hidden>
            <div class="settings-page-heading">
              <h3>同步设置</h3>
              <p>将文献、笔记与批注同步到本地文件夹或 WebDAV。</p>
            </div>
            <section class="settings-group" aria-labelledby="cloudConnectionTitle">
              <h4 id="cloudConnectionTitle">同步配置</h4>
              <div class="settings-fields">
                <div class="settings-field">
                  <label for="cloudProviderSelect">同步方式</label>
                  <select id="cloudProviderSelect">
                    <option value="local">Google Drive / 本地同步文件夹</option>
                    <option value="webdav">坚果云 / WebDAV</option>
                  </select>
                </div>
                <div class="settings-field">
                  <label for="cloudLocalDirInput">本地同步文件夹</label>
                  <input id="cloudLocalDirInput" type="text" placeholder="C:\\Users\\you\\Google Drive\\PaperLantern" spellcheck="false" />
                </div>
                <div class="settings-field">
                  <label for="cloudWebdavUrlInput">WebDAV 地址</label>
                  <input id="cloudWebdavUrlInput" type="url" placeholder="https://dav.jianguoyun.com/dav/PaperLantern" spellcheck="false" />
                </div>
                <div class="settings-field-pair">
                  <div class="settings-field">
                    <label for="cloudUsernameInput">账号</label>
                    <input id="cloudUsernameInput" type="text" autocomplete="username" />
                  </div>
                  <div class="settings-field">
                    <label for="cloudPasswordInput">应用密码</label>
                    <div class="settings-secret-wrap">
                      <input id="cloudPasswordInput" type="password" autocomplete="new-password" placeholder="留空以保留现有密码" aria-describedby="cloudPasswordHint" />
                      <button id="cloudPasswordToggle" class="settings-secret-toggle" type="button" aria-label="显示应用密码" aria-pressed="false" aria-controls="cloudPasswordInput">
                        <svg viewBox="0 0 20 20" aria-hidden="true"><g class="settings-eye-open"><path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Z"/><circle cx="10" cy="10" r="2"/></g><g class="settings-eye-closed"><path d="m3 3 14 14M8 5.3A9 9 0 0 1 10 5c5 0 8 5 8 5a15 15 0 0 1-2.5 3M5 6.3A17 17 0 0 0 2 10s3 5 8 5a9 9 0 0 0 3-.5"/></g></svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              <p id="cloudPasswordHint" class="settings-hint">WebDAV 请使用服务商提供的应用密码；留空保留现有密码。</p>
            </section>
            <div class="settings-preference-row">
              <div>
                <label id="cloudAutoPushLabel" for="cloudAutoPushInput">库变更后自动同步</label>
                <p id="cloudAutoPushHint" class="settings-hint">文献、笔记或批注更新后自动同步到已配置的位置。</p>
              </div>
              <input id="cloudAutoPushInput" class="settings-switch" type="checkbox" role="switch" aria-labelledby="cloudAutoPushLabel" aria-describedby="cloudAutoPushHint" />
            </div>
            <section class="settings-group settings-sync-group" aria-labelledby="settingsSyncTitle">
              <div class="settings-group-heading">
                <h4 id="settingsSyncTitle">同步状态</h4>
                <button id="settingsSyncRefreshButton" class="settings-text-button" type="button">刷新状态</button>
              </div>
              <dl class="settings-sync-status" role="status" aria-live="polite">
                <div><dt>状态</dt><dd id="settingsSyncState">正在读取…</dd></div>
                <div><dt>上次同步</dt><dd id="settingsSyncTime">—</dd></div>
              </dl>
              <p id="settingsSyncError" class="settings-inline-error" role="status" hidden></p>
            </section>
          </section>
        </div>
      </div>
      <footer class="settings-footer">
        <p id="settingsSaveStatus" role="status" aria-live="polite">更改会自动保存</p>
        <span class="settings-keyboard-hint"><kbd>Esc</kbd> 关闭</span>
      </footer>
    </form>
  </div>`;

let apiBaseUrl = ""; // 模块自持的 base 探测缓存，与宿主的互不干扰

export function initSettingsModal(options = {}) {
  if (document.getElementById("cloudConfigOverlay")) return api(); // 幂等守卫

  document.body.insertAdjacentHTML("beforeend", SETTINGS_HTML);

  const overlay = document.getElementById("cloudConfigOverlay");
  const form = document.getElementById("cloudConfigForm");
  const closeButton = document.getElementById("cloudConfigCloseButton");
  const aiProfileSelect = document.getElementById("aiProfileSelect");
  const aiProfileNameInput = document.getElementById("aiProfileNameInput");
  const aiProfileAddButton = document.getElementById("aiProfileAddButton");
  const aiProfileDeleteButton = document.getElementById("aiProfileDeleteButton");
  const aiProfileMenuButton = document.getElementById("aiProfileMenuButton");
  const aiProfileMenu = document.getElementById("aiProfileMenu");
  const aiProfileMenuWrap = document.getElementById("aiProfileMenuWrap");
  const aiBaseUrlInput = document.getElementById("aiBaseUrlInput");
  const aiModelInput = document.getElementById("aiModelInput");
  const aiModelSelect = document.getElementById("aiModelSelect");
  const aiModelsLoadButton = document.getElementById("aiModelsLoadButton");
  const aiModelsStatus = document.getElementById("aiModelsStatus");
  const aiApiKeyInput = document.getElementById("aiApiKeyInput");
  const aiModuleRows = document.getElementById("aiModuleRows");
  const aiApiTestButton = document.getElementById("aiApiTestButton");
  const aiApiTestStatus = document.getElementById("aiApiTestStatus");
  const cloudProviderSelect = document.getElementById("cloudProviderSelect");
  const cloudLocalDirInput = document.getElementById("cloudLocalDirInput");
  const cloudWebdavUrlInput = document.getElementById("cloudWebdavUrlInput");
  const cloudUsernameInput = document.getElementById("cloudUsernameInput");
  const cloudPasswordInput = document.getElementById("cloudPasswordInput");
  const cloudAutoPushInput = document.getElementById("cloudAutoPushInput");
  const saveStatus = document.getElementById("settingsSaveStatus");
  const syncRefreshButton = document.getElementById("settingsSyncRefreshButton");
  const syncState = document.getElementById("settingsSyncState");
  const syncTime = document.getElementById("settingsSyncTime");
  const syncError = document.getElementById("settingsSyncError");
  const secretControls = [
    [aiApiKeyInput, document.getElementById("aiApiKeyToggle"), "API 密钥"],
    [cloudPasswordInput, document.getElementById("cloudPasswordToggle"), "应用密码"],
  ];

  const doFetch = typeof options.apiFetch === "function" ? options.apiFetch : apiFetch;
  const setBusy = typeof options.setBusy === "function" ? options.setBusy : () => {};
  const setStatus = typeof options.setStatus === "function" ? options.setStatus : () => {};
  const onSaved = typeof options.onSettingsSaved === "function" ? options.onSettingsSaved : () => {};

  let saveTimer = null;
  let profiles = [];
  let activeProfileId = "";
  let moduleSettings = {};
  const moduleControls = new Map();
  let revision = 0;
  let saveQueue = Promise.resolve();
  let testRevision = 0;
  let previousFocus = null;
  let syncStatusRevision = 0;
  let modelsRevision = 0;
  let modelsTimer = null;
  let availableModels = [];
  let manualModel = false;
  document.addEventListener?.("paperlantern:ai-settings-changed", (event) => {
    if (event.detail?.source !== "discussion" || !moduleSettings.discuss) return;
    moduleSettings.discuss.profileId = event.detail.ai.modules.discuss.profileId;
    const select = moduleControls.get("discuss")?.select;
    if (select) select.value = moduleSettings.discuss.profileId;
  });

  function renderModelSelect() {
    const current = aiModelInput.value.trim();
    const models = current && !availableModels.includes(current) ? [current, ...availableModels] : availableModels;
    const options = models.map((model) => {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      return option;
    });
    const manual = document.createElement("option");
    manual.value = "";
    manual.textContent = "手动输入模型 ID…";
    aiModelSelect.replaceChildren(...options, manual);
    aiModelSelect.value = manualModel || !current ? "" : current;
    aiModelInput.hidden = !manualModel && Boolean(current);
  }

  function resetModelOptions() {
    modelsRevision += 1;
    window.clearTimeout(modelsTimer);
    availableModels = [];
    renderModelSelect();
    aiModelsLoadButton.disabled = false;
    aiModelsLoadButton.textContent = "加载模型";
    aiModelsLoadButton.setAttribute("aria-busy", "false");
    aiModelsStatus.textContent = "可从下拉列表选择，或选择“手动输入”填写模型 ID。";
    aiModelsStatus.classList.remove("settings-inline-error");
  }

  function scheduleModelLoad() {
    window.clearTimeout(modelsTimer);
    if (!isOpen() || !activeProfile() || !aiBaseUrlInput.value.trim()
        || !(activeProfile().hasApiKey || aiApiKeyInput.value.trim())) return;
    modelsTimer = window.setTimeout(loadModels, 700);
  }

  async function loadModels() {
    window.clearTimeout(modelsTimer);
    if (aiModelsLoadButton.disabled || !activeProfile()) return;
    const requestRevision = ++modelsRevision;
    const ai = { id: activeProfileId, baseUrl: aiBaseUrlInput.value.trim(), apiKey: aiApiKeyInput.value };
    aiModelsLoadButton.disabled = true;
    aiModelsLoadButton.textContent = "加载中…";
    aiModelsLoadButton.setAttribute("aria-busy", "true");
    aiModelsStatus.textContent = "正在读取可用模型…";
    aiModelsStatus.classList.remove("settings-inline-error");
    try {
      const response = await doFetch("/api/settings/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ai }),
      });
      if (response.status === 404 && !(response.headers.get("content-type") || "").includes("application/json")) {
        throw new Error("当前服务未加载模型列表接口，请关闭旧服务并重启。仍可手动填写模型 ID。");
      }
      const data = await readJsonResponse(response);
      if (requestRevision !== modelsRevision) return;
      if (!response.ok) throw new Error(data.error || "加载模型失败，仍可手动填写模型 ID。");
      if (!Array.isArray(data.models)) throw new Error("接口未返回模型列表，仍可手动填写模型 ID。");
      const models = [...new Set(data.models.filter((model) => typeof model === "string" && model.trim()).map((model) => model.trim()))];
      availableModels = models;
      renderModelSelect();
      aiModelsStatus.textContent = models.length ? `已加载 ${models.length} 个模型，也可选择“手动输入”。` : "接口未返回可用模型，可选择“手动输入”填写模型 ID。";
    } catch (error) {
      if (requestRevision !== modelsRevision) return;
      const message = error.message || "";
      aiModelsStatus.textContent = /Failed to fetch|NetworkError|Load failed|Tried:/i.test(message)
        ? "无法连接 Paper Lantern 本地服务，请确认服务正在运行。仍可手动填写模型 ID。"
        : message || "加载模型失败，仍可手动填写模型 ID。";
      aiModelsStatus.classList.add("settings-inline-error");
    } finally {
      if (requestRevision === modelsRevision) {
        aiModelsLoadButton.disabled = false;
        aiModelsLoadButton.textContent = availableModels.length ? "重新加载" : "加载模型";
        aiModelsLoadButton.setAttribute("aria-busy", "false");
      }
    }
  }

  function showSaveStatus(message, isError = false) {
    saveStatus.textContent = message;
    saveStatus.classList.toggle("settings-inline-error", isError);
  }

  function closeProfileMenu(restoreFocus = false) {
    aiProfileMenu.hidden = true;
    aiProfileMenuButton.setAttribute("aria-expanded", "false");
    if (restoreFocus) aiProfileMenuButton.focus();
  }

  function setSecretVisible(input, button, label, visible) {
    input.type = visible ? "text" : "password";
    button.setAttribute("aria-pressed", String(visible));
    button.setAttribute("aria-label", `${visible ? "隐藏" : "显示"}${label}`);
    button.title = `${visible ? "隐藏" : "显示"}${label}`;
  }

  function activeProfile() {
    return profiles.find((profile) => profile.id === activeProfileId);
  }

  function captureProfile() {
    const profile = activeProfile();
    if (!profile) return;
    Object.assign(profile, {
      name: aiProfileNameInput.value.trim(),
      baseUrl: aiBaseUrlInput.value.trim(),
      model: aiModelInput.value.trim(),
      apiKey: aiApiKeyInput.value,
    });
  }

  function renderProfileOptions() {
    aiProfileSelect.replaceChildren(...profiles.map((profile) => {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = profile.name || profile.model || "未命名配置";
      return option;
    }));
    aiProfileSelect.value = activeProfileId;
    aiProfileDeleteButton.disabled = profiles.length <= 1;
    aiProfileDeleteButton.title = profiles.length <= 1 ? "至少保留一组配置" : "删除当前配置";
    renderModuleOptions();
  }

  function renderModuleOptions() {
    for (const [id, { select }] of moduleControls) {
      const options = [{ id: "", name: `跟随默认 · ${activeProfile()?.name || activeProfile()?.model || "未命名配置"}` }, ...profiles];
      select.replaceChildren(...options.map((profile) => {
        const option = document.createElement("option");
        option.value = profile.id;
        option.textContent = profile.name || profile.model || "未命名配置";
        return option;
      }));
      if (!profiles.some((profile) => profile.id === moduleSettings[id].profileId)) moduleSettings[id].profileId = "";
      select.value = moduleSettings[id].profileId;
    }
  }

  function renderModules(ai) {
    moduleControls.clear();
    moduleSettings = {};
    const rows = (ai.moduleDefinitions || []).map((definition) => {
      const id = definition.id;
      const saved = ai.modules?.[id] || {};
      moduleSettings[id] = { profileId: saved.profileId || "", thinkMode: Boolean(saved.thinkMode) };
      const row = document.createElement("div");
      row.className = "settings-module-row";
      const description = document.createElement("div");
      const label = document.createElement("label");
      label.htmlFor = `aiModuleProfile-${id}`;
      label.textContent = definition.name;
      const hint = document.createElement("p");
      hint.id = `aiModuleHint-${id}`;
      hint.className = "settings-hint";
      hint.textContent = definition.description;
      description.append(label, hint);
      const select = document.createElement("select");
      select.id = `aiModuleProfile-${id}`;
      select.setAttribute("aria-describedby", hint.id);
      select.addEventListener("change", () => {
        moduleSettings[id].profileId = select.value;
        scheduleSave();
      });
      const think = document.createElement("input");
      think.id = `aiModuleThink-${id}`;
      think.type = "checkbox";
      think.className = "settings-switch";
      think.checked = moduleSettings[id].thinkMode;
      think.setAttribute("role", "switch");
      think.setAttribute("aria-label", `${definition.name} Think 模式`);
      think.addEventListener("change", () => {
        moduleSettings[id].thinkMode = think.checked;
        scheduleSave();
      });
      row.append(description, select, think);
      moduleControls.set(id, { select, think });
      return row;
    });
    aiModuleRows.replaceChildren(...rows);
    renderModuleOptions();
  }

  function renderActiveProfile() {
    resetModelOptions();
    closeProfileMenu();
    setSecretVisible(...secretControls[0], false);
    const profile = activeProfile() || {};
    aiProfileNameInput.value = profile.name || "";
    aiBaseUrlInput.value = profile.baseUrl || "";
    aiModelInput.value = profile.model || "";
    manualModel = !aiModelInput.value;
    renderModelSelect();
    aiApiKeyInput.value = profile.apiKey || "";
    aiApiKeyInput.placeholder = profile.hasApiKey ? maskSecretTail(profile.apiKeyTail) : "粘贴 API 密钥";
    renderProfileOptions();
    scheduleModelLoad();
  }

  function scheduleSave() {
    revision += 1;
    testRevision += 1;
    setTestBusy(false);
    setTestState("idle");
    showSaveStatus("等待自动保存…");
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => save(), 600);
  }

  function open() {
    if (!overlay) return;
    previousFocus = document.activeElement;
    overlay.hidden = false;
    form.focus();
    if (profiles.length) {
      loadSyncStatus();
      scheduleModelLoad();
    }
  }

  function close() {
    window.clearTimeout(modelsTimer);
    closeProfileMenu();
    secretControls.forEach((control) => setSecretVisible(...control, false));
    if (overlay) overlay.hidden = true;
    previousFocus?.focus();
  }

  function isOpen() {
    return Boolean(overlay && !overlay.hidden);
  }

  function wireNav() {
    const items = Array.from(document.querySelectorAll(".settings-nav-item"));
    const pages = Array.from(document.querySelectorAll(".settings-page"));
    if (!items.length || !pages.length) return;
    items.forEach((item, index) => {
      const activate = () => {
        const targetId = item.getAttribute("aria-controls");
        items.forEach((it) => {
          const active = it === item;
          it.classList.toggle("is-active", active);
          it.setAttribute("aria-selected", String(active));
          it.tabIndex = active ? 0 : -1;
        });
        pages.forEach((page) => {
          page.hidden = page.id !== targetId;
        });
        form.querySelector(".settings-content")?.scrollTo({ top: 0 });
        closeProfileMenu();
        if (targetId === "settingsPageCloud") loadSyncStatus();
      };
      item.addEventListener("click", activate);
      item.addEventListener("keydown", (event) => {
        const direction = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
        if (!direction && !["Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + direction + items.length) % items.length;
        items[nextIndex].focus();
        items[nextIndex].click();
      });
    });
  }

  function wireAutosave() {
    const fields = [
      aiProfileNameInput, aiBaseUrlInput, aiModelInput, aiApiKeyInput,
      cloudProviderSelect, cloudLocalDirInput, cloudWebdavUrlInput,
      cloudUsernameInput, cloudPasswordInput, cloudAutoPushInput,
    ];
    fields.forEach((field) => {
      if (!field) return;
      const eventName = field.type === "checkbox" || field.tagName === "SELECT" ? "change" : "input";
      field.addEventListener(eventName, () => {
        if (field === aiBaseUrlInput || field === aiApiKeyInput) resetModelOptions();
        if (field === aiModelInput) renderModelSelect();
        captureProfile();
        renderProfileOptions();
        scheduleSave();
      });
    });
  }

  function collectPayload() {
    captureProfile();
    return {
      ai: {
        activeProfileId,
        modules: Object.fromEntries(Object.entries(moduleSettings).map(([id, setting]) => [id, { ...setting }])),
        profiles: profiles.map((profile) => ({
          id: profile.id, name: profile.name, baseUrl: profile.baseUrl,
          model: profile.model, apiKey: profile.apiKey || "", thinkMode: Boolean(profile.thinkMode),
        })),
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
    profiles = (ai.profiles?.length ? ai.profiles : [{ ...ai, id: "default", name: "默认配置" }])
      .map((profile) => ({ ...profile, apiKey: "" }));
    activeProfileId = profiles.some((profile) => profile.id === ai.activeProfileId) ? ai.activeProfileId : profiles[0].id;
    renderModules(ai);
    renderActiveProfile();
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
    renderSyncStatus(status);
  }

  function renderSyncStatus(status) {
    // Reuse the existing sync endpoint's state; configured does not imply a
    // successful connection or transfer.
    syncStatusRevision += 1;
    const provider = status?.provider === "webdav" ? "WebDAV" : "本地文件夹";
    syncState.textContent = status?.configured ? `已配置 · ${provider}` : "尚未配置";
    const date = status?.syncedAt ? new Date(status.syncedAt) : null;
    syncTime.textContent = date && !Number.isNaN(date.getTime())
      ? date.toLocaleString("zh-CN", { hour12: false }) : "暂无记录";
    syncError.textContent = status?.error || "";
    syncError.hidden = !status?.error;
  }

  async function loadSyncStatus() {
    if (syncRefreshButton.disabled) return;
    const requestedRevision = syncStatusRevision;
    syncRefreshButton.disabled = true;
    syncRefreshButton.setAttribute("aria-busy", "true");
    try {
      const response = await doFetch("/api/cloud-sync");
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.error || "读取同步状态失败。");
      if (requestedRevision === syncStatusRevision) renderSyncStatus(data);
    } catch (error) {
      if (requestedRevision !== syncStatusRevision) return;
      syncState.textContent = "暂时无法读取";
      syncError.textContent = error.message || "读取同步状态失败。";
      syncError.hidden = false;
    } finally {
      syncRefreshButton.disabled = false;
      syncRefreshButton.setAttribute("aria-busy", "false");
    }
  }

  async function load() {
    showSaveStatus("正在加载设置…");
    const controls = Array.from(form.querySelectorAll("input, select, button"));
    const disabledBefore = controls.map((control) => control.disabled);
    controls.forEach((control) => { control.disabled = true; });
    try {
      const response = await doFetch("/api/settings");
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.error || "加载设置失败。");
      renderFields(data);
      showSaveStatus("更改会自动保存");
    } catch (error) {
      console.error(error);
      setStatus(error.message || "加载设置失败。", true);
      showSaveStatus(error.message || "加载设置失败。", true);
    } finally {
      controls.forEach((control, index) => { control.disabled = disabledBefore[index]; });
      aiProfileDeleteButton.disabled = profiles.length <= 1;
      aiModelsLoadButton.disabled = !profiles.length;
    }
    loadSyncStatus();
  }

  function save() {
    const payload = collectPayload();
    const savedRevision = revision;
    // Serialize requests so an older autosave cannot overwrite a later switch.
    saveQueue = saveQueue.then(() => persist(payload, savedRevision));
    return saveQueue;
  }

  async function persist(payload, savedRevision) {
    setBusy(true);
    if (savedRevision === revision) showSaveStatus("正在保存…");
    try {
      const response = await doFetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.error || "设置保存失败。");
      const savedAi = data.settings?.ai;
      if (!Array.isArray(savedAi?.profiles)
          || savedAi.profiles.length !== payload.ai.profiles.length
          || savedAi.activeProfileId !== payload.ai.activeProfileId
          || payload.ai.profiles.some((profile) => !savedAi.profiles.some((saved) => saved.id === profile.id))) {
        throw new Error("后端未保存多配置。请重启 python server.py 加载新版服务后重试。");
      }
      if (Object.entries(payload.ai.modules).some(([id, setting]) => {
        const saved = savedAi.modules?.[id];
        return !saved || saved.profileId !== setting.profileId || saved.thinkMode !== setting.thinkMode;
      })) throw new Error("模块配置未保存，请重启新版后端服务后重试。");
      // Update secret indicators without replacing newer edits or selection.
      for (const saved of data.settings.ai.profiles || []) {
        const local = profiles.find((profile) => profile.id === saved.id);
        const sent = payload.ai.profiles.find((profile) => profile.id === saved.id);
        if (local && local.apiKey === (sent?.apiKey || "")) {
          local.hasApiKey = saved.hasApiKey;
          local.apiKeyTail = saved.apiKeyTail;
          local.apiKey = "";
          if (local.id === activeProfileId) {
            aiApiKeyInput.value = "";
            aiApiKeyInput.placeholder = saved.hasApiKey ? maskSecretTail(saved.apiKeyTail) : "粘贴 API 密钥";
          }
        }
      }
      if (savedRevision === revision && cloudPasswordInput.value === payload.sync.password) {
        cloudPasswordInput.value = "";
        cloudPasswordInput.placeholder = data.settings.sync.hasPassword ? maskSecretTail(data.settings.sync.passwordTail) : "粘贴密码 / 应用密码";
      }
      onSaved(data.sync);
      document.dispatchEvent?.(new CustomEvent("paperlantern:ai-settings-changed", { detail: { source: "settings", ai: savedAi } }));
      renderSyncStatus(data.sync);
      if (savedRevision === revision) {
        setStatus("设置已自动保存");
        showSaveStatus("所有更改已保存");
      }
    } catch (error) {
      console.error(error);
      setStatus(error.message || "设置保存失败。", true);
      if (savedRevision === revision) showSaveStatus(error.message || "设置保存失败。", true);
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
    captureProfile();
    const profile = { ...activeProfile() };
    const currentTest = ++testRevision;
    setTestBusy(true);
    setTestState("testing");
    try {
      const response = await doFetch("/api/settings/test-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ai: profile }),
      });
      const data = await readJsonResponse(response);
      if (currentTest !== testRevision) return;
      if (!response.ok) {
        setTestState("error", { detail: formatTestError(data) });
        return;
      }
      const model = data.model || aiModelInput?.value.trim() || "model";
      setTestState("success", { model });
    } catch (error) {
      console.error(error);
      if (currentTest !== testRevision) return;
      setTestState("error", { detail: error.message || "AI 接口测试失败。" });
    } finally {
      if (currentTest === testRevision) setTestBusy(false);
    }
  }

  closeButton?.addEventListener("click", close);
  overlay?.addEventListener("pointerdown", (event) => {
    if (!aiProfileMenuWrap.contains(event.target)) closeProfileMenu();
    if (event.target === overlay) close();
  });
  form.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (!aiProfileMenu.hidden) closeProfileMenu(true);
      else close();
    } else if (event.key === "Tab") {
      closeProfileMenu();
      const controls = Array.from(form.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]'))
        .filter((control) => control.tabIndex !== -1 && control.getClientRects().length);
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === form)) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  });
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
  });
  aiApiTestButton?.addEventListener("click", testAi);
  aiModelsLoadButton.addEventListener("click", loadModels);
  aiModelSelect.addEventListener("change", () => {
    manualModel = !aiModelSelect.value;
    if (manualModel) {
      aiModelInput.hidden = false;
      aiModelInput.focus();
      return;
    }
    aiModelInput.value = aiModelSelect.value;
    aiModelInput.hidden = true;
    aiModelInput.dispatchEvent(new Event("input", { bubbles: true }));
  });
  [aiBaseUrlInput, aiApiKeyInput].forEach((field) => field.addEventListener("change", scheduleModelLoad));
  syncRefreshButton.addEventListener("click", loadSyncStatus);
  secretControls.forEach(([input, button, label]) => {
    button.addEventListener("click", () => setSecretVisible(input, button, label, input.type === "password"));
  });
  aiProfileMenuButton.addEventListener("click", () => {
    const show = aiProfileMenu.hidden;
    aiProfileMenu.hidden = !show;
    aiProfileMenuButton.setAttribute("aria-expanded", String(show));
    if (show && !aiProfileDeleteButton.disabled) aiProfileDeleteButton.focus();
  });
  aiProfileMenuButton.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    aiProfileMenu.hidden = false;
    aiProfileMenuButton.setAttribute("aria-expanded", "true");
    if (!aiProfileDeleteButton.disabled) aiProfileDeleteButton.focus();
  });
  aiProfileSelect.addEventListener("change", () => {
    captureProfile();
    activeProfileId = aiProfileSelect.value;
    renderActiveProfile();
    scheduleSave();
  });
  aiProfileAddButton.addEventListener("click", () => {
    captureProfile();
    const id = globalThis.crypto?.randomUUID?.() || `profile-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    profiles.push({ id, name: `配置 ${profiles.length + 1}`, baseUrl: "https://api.openai.com/v1", model: "", apiKey: "", thinkMode: false });
    activeProfileId = id;
    renderActiveProfile();
    scheduleSave();
    aiProfileNameInput.focus();
  });
  aiProfileDeleteButton.addEventListener("click", () => {
    if (profiles.length <= 1) return;
    const name = activeProfile()?.name || activeProfile()?.model || "未命名配置";
    closeProfileMenu(true);
    const inUse = Object.values(moduleSettings).some((setting) => setting.profileId === activeProfileId);
    if (!window.confirm(`删除配置“${name}”？该配置及其已保存的密钥将被移除。${inUse ? "使用此配置的模块将改为跟随默认接口。" : ""}`)) return;
    profiles = profiles.filter((profile) => profile.id !== activeProfileId);
    activeProfileId = profiles[0].id;
    renderActiveProfile();
    scheduleSave();
  });
  (options.openButtons || []).forEach((selector) => {
    document.querySelector(selector)?.addEventListener("click", open);
  });
  wireNav();
  wireAutosave();

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

  // Once settings locate the backend, every request stays with that instance.
  // A model provider's 404 must be returned to the UI, not trigger port probing.
  const bases = apiBaseUrl ? [apiBaseUrl] : buildApiBaseCandidates();
  const discovering = !apiBaseUrl && url === "/api/settings";
  let lastNotFound = null;
  for (const base of bases) {
    try {
      const response = await fetch(`${base}${url}`, options);
      if (response.status === 404 && discovering) {
        lastNotFound = response;
        continue;
      }
      apiBaseUrl = base;
      return response;
    } catch {
      // Only the first settings request discovers a backend. Later failures
      // must not send a settings write or secret to a different local service.
      if (!discovering) break;
    }
  }
  if (lastNotFound) return lastNotFound;
  throw new Error(
    "无法连接 Paper Lantern 本地服务，请确认已运行 python server.py，再刷新页面重试。",
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
