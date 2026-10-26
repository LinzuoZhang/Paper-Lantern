import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

class Element {
  value = '';
  checked = false;
  disabled = false;
  hidden = true;
  handlers = {};
  children = [];
  attributes = {};
  classList = { add() {}, remove() {}, toggle() {} };
  addEventListener(name, callback) { this.handlers[name] = callback; }
  dispatchEvent(event) { this.handlers[event.type]?.(event); return true; }
  setAttribute(name, value) { this.attributes[name] = value; }
  contains(element) { return element === this || this.children.includes(element); }
  replaceChildren(...children) { this.children = children; }
  append(...children) { this.children.push(...children); }
  focus() {}
  querySelector(selector) { return this.parts?.[selector]; }
  querySelectorAll() { return this.controls || []; }
  fire(name) { return this.handlers[name]?.({ target: this, preventDefault() {} }); }
}

const source = await readFile(new URL('../assets/js/components/settings_modal.js', import.meta.url), 'utf8');
const { initSettingsModal } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const flush = async () => { for (let tick = 0; tick < 40; tick++) await Promise.resolve(); };
const response = data => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => data });
const initial = () => ({ ai: { activeProfileId: 'a', profiles: [
  { id: 'a', name: '阅读', baseUrl: 'https://a.test/v1', model: 'fast', hasApiKey: true, apiKeyTail: 'aaaa' },
  { id: 'b', name: '研究', baseUrl: 'https://b.test/v1', model: 'deep', thinkMode: true, hasApiKey: true, apiKeyTail: 'bbbb' },
], modules: {
  summary: { profileId: 'b', thinkMode: true },
  translate: { profileId: '', thinkMode: false },
}, moduleDefinitions: [
  { id: 'summary', name: '方法解析', description: '方法拆解与总结' },
  { id: 'translate', name: '划词翻译', description: '选中文字的翻译' },
] }, sync: {} });

function setup(intercept = () => null) {
  const elements = {};
  let inserted = false;
  let timerId = 0;
  const timers = new Map();
  const requests = [];
  globalThis.document = {
    body: { insertAdjacentHTML(_, html) {
      for (const match of html.matchAll(/<(\w+)[^>]*id="([^"]+)"[^>]*>/g)) {
        const element = elements[match[2]] = new Element();
        element.tagName = match[1].toUpperCase();
        element.type = match[0].match(/type="([^"]+)"/)?.[1] || '';
      }
      elements.cloudConfigForm.controls = Object.values(elements).filter(el => ['INPUT', 'SELECT', 'BUTTON'].includes(el.tagName));
      elements.aiApiTestStatus.parts = Object.fromEntries(['main', 'sub'].map(key => [`.ai-api-status-${key}`, new Element()]));
      inserted = true;
    } },
    getElementById: id => inserted ? elements[id] : null,
    createElement: () => new Element(),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  globalThis.window = {
    location: { search: '' },
    confirm: () => true,
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  };
  const stored = initial();
  const api = initSettingsModal({ apiFetch: async (url, options) => {
    if (!options) return response(structuredClone(stored));
    const payload = JSON.parse(options.body);
    requests.push({ url, payload });
    const overridden = intercept(url, payload);
    if (overridden) return overridden;
    if (url.endsWith('test-ai')) return response({ model: payload.ai.model });
    const definitions = stored.ai.moduleDefinitions;
    stored.ai = { ...structuredClone(payload.ai), moduleDefinitions: definitions };
    stored.ai.profiles = stored.ai.profiles.map(profile => {
      const { apiKey, ...publicProfile } = profile;
      return { ...publicProfile, hasApiKey: true, apiKeyTail: apiKey?.slice(-4) || (profile.id === 'a' ? 'aaaa' : 'bbbb') };
    });
    stored.sync = {};
    return response({ settings: structuredClone(stored), sync: {} });
  } });
  return {
    api, elements, requests,
    async autosave() {
      for (const [id, callback] of [...timers]) { timers.delete(id); callback(); }
      await flush();
    },
    edit(id, value) { elements[id].value = value; elements[id].fire('input'); },
    select(id) { elements.aiProfileSelect.value = id; elements.aiProfileSelect.fire('change'); },
  };
}

// Editing and switching while a save is in flight must not restore old fields
// or send the prior provider's visible password into the newly selected one.
{
  let finishFirst;
  let first = true;
  const fixture = setup((url, payload) => {
    if (url === '/api/settings' && first) {
      first = false;
      return new Promise(resolve => { finishFirst = () => resolve(response({
        settings: { ...payload, ai: { ...payload.ai, profiles: payload.ai.profiles.map(({ apiKey, ...profile }) => ({
          ...profile, hasApiKey: true, apiKeyTail: apiKey ? apiKey.slice(-4) : 'bbbb',
        })) } }, sync: {},
      })); });
    }
  });
  await flush();
  const { elements: el } = fixture;
  assert.equal(el.aiModelInput.value, 'fast');
  assert.equal(el.aiApiKeyInput.placeholder, '****aaaa');
  fixture.edit('aiApiKeyInput', 'new-a-secret');
  await fixture.autosave();
  fixture.edit('aiModelInput', 'updated-fast');
  await fixture.autosave();
  fixture.select('b');
  await fixture.autosave();
  assert.equal(fixture.requests.length, 1, 'saves must be serialized');
  assert.equal(el.aiApiKeyInput.value, '');
  assert.equal(el.aiApiKeyInput.placeholder, '****bbbb');
  finishFirst();
  await flush();
  assert.deepEqual(fixture.requests.map(request => request.payload.ai.activeProfileId), ['a', 'a', 'b']);
  assert.equal(el.aiModelInput.value, 'deep', 'old responses must not change current selection');
  const latest = fixture.requests.at(-1).payload.ai.profiles;
  assert.equal(latest.find(profile => profile.id === 'a').model, 'updated-fast');
  assert.equal(latest.find(profile => profile.id === 'b').apiKey, '');
  fixture.select('a');
  assert.equal(el.aiModelInput.value, 'updated-fast');
  assert.equal(el.aiApiKeyInput.value, '');
}

// New configurations start without a key; test requests use the exact draft,
// and deleting a configuration removes it from the persisted collection.
{
  const fixture = setup();
  await flush();
  const { elements: el } = fixture;
  el.aiProfileAddButton.fire('click');
  const addedId = el.aiProfileSelect.value;
  assert.ok(!['a', 'b'].includes(addedId));
  assert.equal(el.aiApiKeyInput.value, '');
  fixture.edit('aiProfileNameInput', '<custom model>');
  fixture.edit('aiBaseUrlInput', 'https://custom.test/v1');
  fixture.edit('aiModelInput', 'custom-model');
  fixture.edit('aiApiKeyInput', 'custom-secret');
  await el.aiApiTestButton.fire('click');
  assert.deepEqual(fixture.requests[0].payload.ai, {
    id: addedId, name: '<custom model>', baseUrl: 'https://custom.test/v1',
    model: 'custom-model', apiKey: 'custom-secret', thinkMode: false,
  });
  assert.equal(el.aiProfileSelect.children.at(-1).textContent, '<custom model>');
  await fixture.autosave();
  assert.equal(el.aiApiKeyInput.value, '', 'saved keys must be removed from the input');
  assert.equal(el.aiApiKeyInput.placeholder, '****cret');
  el.aiProfileDeleteButton.fire('click');
  await fixture.autosave();
  assert.equal(fixture.requests.at(-1).payload.ai.profiles.some(profile => profile.id === addedId), false);
  el.aiProfileDeleteButton.fire('click');
  await fixture.autosave();
  assert.equal(el.aiProfileDeleteButton.disabled, true);
  assert.equal(fixture.requests.at(-1).payload.ai.profiles.length, 1);
}

// Password reveal is presentation-only, and cancelling deletion preserves the
// selected profile without triggering a settings write.
{
  const fixture = setup();
  await flush();
  const { elements: el } = fixture;
  fixture.edit('aiApiKeyInput', 'draft-secret');
  el.aiApiKeyToggle.fire('click');
  assert.equal(el.aiApiKeyInput.type, 'text');
  assert.equal(el.aiApiKeyToggle.attributes['aria-pressed'], 'true');
  assert.equal(el.aiApiKeyInput.value, 'draft-secret');
  fixture.select('b');
  assert.equal(el.aiApiKeyInput.type, 'password');
  assert.equal(el.aiApiKeyToggle.attributes['aria-pressed'], 'false');
  fixture.edit('cloudPasswordInput', 'sync-secret');
  el.cloudPasswordToggle.fire('click');
  assert.equal(el.cloudPasswordInput.type, 'text');
  assert.equal(fixture.requests.length, 0);
  await fixture.autosave();
  assert.equal(fixture.requests.at(-1).payload.sync.password, 'sync-secret');
  el.aiProfileMenuButton.fire('click');
  assert.equal(el.aiProfileMenu.hidden, false);
  const count = fixture.requests.length;
  window.confirm = () => false;
  el.aiProfileDeleteButton.fire('click');
  await fixture.autosave();
  assert.equal(el.aiProfileMenu.hidden, true);
  assert.equal(el.aiProfileSelect.value, 'b');
  assert.equal(el.aiProfileSelect.children.length, 2);
  assert.equal(fixture.requests.length, count);
}

// A connection result for the previous profile must not label the new one.
{
  let finishTest;
  const fixture = setup(url => url.endsWith('test-ai') && new Promise(resolve => {
    finishTest = () => resolve(response({ model: 'fast' }));
  }));
  await flush();
  const testing = fixture.elements.aiApiTestButton.fire('click');
  fixture.select('b');
  finishTest();
  await testing;
  assert.equal(fixture.elements.aiApiTestStatus.parts['.ai-api-status-main'].textContent, '');
  assert.equal(fixture.elements.aiApiTestButton.disabled, false);
}

// Module choices and Think survive saves and reloads; changing the default
// does not overwrite explicitly selected modules.
{
  const fixture = setup();
  await flush();
  const { elements: el } = fixture;
  const [summary, translate] = el.aiModuleRows.children;
  assert.equal(el.aiThinkModeInput, undefined);
  assert.equal(summary.children[1].value, 'b');
  assert.equal(summary.children[2].checked, true);
  translate.children[1].value = 'a';
  translate.children[1].fire('change');
  translate.children[2].checked = true;
  translate.children[2].fire('change');
  fixture.select('b');
  await fixture.autosave();
  assert.deepEqual(fixture.requests.at(-1).payload.ai.modules, {
    summary: {profileId:'b', thinkMode:true}, translate: {profileId:'a', thinkMode:true},
  });
  await fixture.api.load();
  assert.equal(el.aiProfileSelect.value, 'b');
  assert.equal(el.aiModuleRows.children[1].children[1].value, 'a');
  assert.equal(el.aiModuleRows.children[1].children[2].checked, true);
  window.confirm = () => true;
  el.aiProfileDeleteButton.fire('click');
  await fixture.autosave();
  assert.equal(fixture.requests.at(-1).payload.ai.modules.summary.profileId, '');
  assert.equal(fixture.requests.at(-1).payload.ai.modules.summary.thinkMode, true);
}

// An old server must not falsely report success or clear an unsaved key when
// it silently ignores the multi-profile payload.
{
  const fixture = setup(url => url === '/api/settings' && response({settings:{ai:{model:'legacy'},sync:{}},sync:{}}));
  await flush();
  fixture.edit('aiApiKeyInput', 'keep-this-unsaved-key');
  const previousError = console.error;
  try {
    console.error = () => {};
    await fixture.autosave();
  } finally { console.error = previousError; }
  assert.match(fixture.elements.settingsSaveStatus.textContent, /重启/);
  assert.equal(fixture.elements.aiApiKeyInput.value, 'keep-this-unsaved-key');
}

// Automatic discovery reads the active profile; choosing a suggestion and
// entering a custom model both use the existing autosave mechanism.
{
  const fixture = setup(url => url.endsWith('/models') && response({models:['provider-fast','provider-deep']}));
  await flush();
  fixture.elements.aiModelSelect.value='';
  fixture.elements.aiModelSelect.fire('change');
  assert.equal(fixture.elements.aiModelInput.hidden,false);
  fixture.edit('aiModelInput','my-custom-model');
  fixture.api.open();
  await fixture.autosave();
  const {elements:el} = fixture;
  assert.equal(el.aiModelInput.value,'my-custom-model');
  assert.deepEqual(el.aiModelSelect.children.map(option=>option.value),['my-custom-model','provider-fast','provider-deep','']);
  assert.equal(el.aiModelSelect.value,'');
  assert.equal(el.aiModelInput.hidden,false,'loading models must preserve manual editing');
  const request=fixture.requests.find(request=>request.url.endsWith('/models'));
  assert.equal(request.payload.ai.id,'a');
  assert.equal(request.payload.ai.baseUrl,'https://a.test/v1');
  el.aiModelSelect.value='provider-deep';
  el.aiModelSelect.fire('change');
  await fixture.autosave();
  assert.equal(el.aiModelInput.hidden,true);
  assert.equal(el.aiModelSelect.value,'provider-deep');
  assert.equal(fixture.requests.at(-1).payload.ai.profiles[0].model,'provider-deep');
  fixture.edit('aiBaseUrlInput','https://changed.test/v1');
  assert.deepEqual(el.aiModelSelect.children.map(option=>option.value),['provider-deep','']);
  el.aiBaseUrlInput.fire('change');
  await fixture.autosave();
  assert.equal(fixture.requests.filter(request=>request.url.endsWith('/models')).at(-1).payload.ai.baseUrl,'https://changed.test/v1');
  fixture.api.close();
}

// A late response for a previous API cannot replace the selected API's list.
{
  let finishOld;
  const fixture=setup((url,payload)=> url.endsWith('/models') && (payload.ai.id==='a'
    ? new Promise(resolve=>{finishOld=()=>resolve(response({models:['old-model']}));})
    : response({models:['current-model']})));
  await flush();
  const pending=fixture.elements.aiModelsLoadButton.fire('click');
  fixture.select('b');
  await fixture.elements.aiModelsLoadButton.fire('click');
  finishOld();
  await pending;
  assert.deepEqual(fixture.elements.aiModelSelect.children.map(option=>option.value),['deep','current-model','']);
  assert.equal(fixture.elements.aiModelSelect.value,'deep');
  assert.equal(fixture.elements.aiModelInput.value,'deep');
}

// Providers without a models endpoint still allow saving any manually entered ID.
{
  const fixture=setup(url=>url.endsWith('/models') && {...response({error:'不支持模型列表，可手动输入。'}),ok:false});
  await flush();
  await fixture.elements.aiModelsLoadButton.fire('click');
  assert.match(fixture.elements.aiModelsStatus.textContent,/手动/);
  assert.equal(fixture.elements.aiModelInput.disabled,false);
  fixture.elements.aiModelSelect.value='';
  fixture.elements.aiModelSelect.fire('change');
  assert.equal(fixture.elements.aiModelInput.hidden,false);
  fixture.edit('aiModelInput','private-model-id');
  await fixture.autosave();
  assert.equal(fixture.requests.at(-1).payload.ai.profiles[0].model,'private-model-id');
}

// An old backend's HTML 404 and a network error give actionable inline text.
for (const failure of ['old-server','network']) {
  const fixture=setup(url=>{
    if(!url.endsWith('/models')) return null;
    if(failure==='network') throw new TypeError('Failed to fetch Tried: private-local-ports');
    return {status:404,ok:false,headers:{get:()=> 'text/html'}};
  });
  await flush();
  await fixture.elements.aiModelsLoadButton.fire('click');
  assert.match(fixture.elements.aiModelsStatus.textContent,failure==='network'?/无法连接/:/旧服务/);
  assert.match(fixture.elements.aiModelsStatus.textContent,/手动/);
  assert.doesNotMatch(fixture.elements.aiModelsStatus.textContent,/Failed to fetch|Tried:/);
  assert.equal(fixture.elements.aiModelInput.disabled,false);
}
