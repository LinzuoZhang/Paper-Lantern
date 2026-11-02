import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

class Element {
  handlers = {}; children = []; attributes = {}; value = ''; disabled = false; hidden = false;
  classList = { values: new Set(), toggle(name, flag) { flag ? this.values.add(name) : this.values.delete(name); } };
  addEventListener(type, handler) { this.handlers[type] = handler; }
  setAttribute(key, value) { this.attributes[key] = value; }
  replaceChildren(...nodes) { this.children = nodes; }
  requestSubmit() { this.submissions = (this.submissions || 0) + 1; }
  fire(type, values = {}) { return this.handlers[type]?.({ target: this, preventDefault() { this.prevented = true; }, ...values }); }
}
globalThis.document = { createElement: () => new Element(), addEventListener() {} };
const source = await readFile(new URL('../assets/js/components/discussion_composer.js', import.meta.url), 'utf8');
const { initDiscussionComposer } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

// Keyboard and send/stop behavior is identical for both request transports.
{
  const form = new Element(), input = new Element(), send = new Element();
  let stops = 0, blocked = false;
  const composer = initDiscussionComposer({ form, input, send, isBlocked: () => blocked, onStop: () => stops++ });
  assert.equal(send.disabled, true);
  input.value = 'Question'; input.fire('input');
  assert.equal(send.disabled, false);
  for (const values of [{ key: 'Enter', shiftKey: true }, { key: 'Enter', isComposing: true }, { key: 'Enter', keyCode: 229 }]) {
    input.fire('keydown', values);
    assert.equal(form.submissions || 0, 0);
  }
  input.fire('keydown', { key: 'Enter' });
  assert.equal(form.submissions, 1);
  blocked = true; input.fire('keydown', { key: 'Enter' }); assert.equal(form.submissions, 1);
  composer.setBusy(true);
  assert.equal(input.disabled, true); assert.equal(send.type, 'button');
  assert.equal(send.attributes['aria-label'], '停止'); assert.match(send.innerHTML, /rect/);
  input.fire('keydown', { key: 'Enter' }); assert.equal(form.submissions, 1);
  send.fire('click'); assert.equal(stops, 1);
  composer.setBusy(true, { stopping: true }); send.fire('click');
  assert.equal(send.disabled, true); assert.equal(stops, 1);
  blocked = false; input.value = '   '; composer.setBusy(false);
  assert.equal(input.disabled, false); assert.equal(send.disabled, true);
  assert.equal(send.attributes['aria-label'], '发送'); assert.match(send.innerHTML, /path/);
}

// Saving a profile must update only the intended module, block sending during
// persistence, and restore the previous profile and draft on failure.
for (const moduleId of ['discuss', 'readingAgent']) for (const fail of [false, true]) {
  const form = new Element(), input = new Element(), send = new Element(), modelSelect = new Element(), modelStatus = new Element();
  input.value = 'Unsent draft';
  const ai = { activeProfileId: 'a', profiles: [{ id: 'a', model: 'Fast' }, { id: 'b', model: 'Deep' }],
    modules: { discuss: { profileId: 'a' }, readingAgent: { profileId: 'b' } } };
  let finishSave, patch, settingsListener;
  const initial = ai.modules[moduleId].profileId, requested = initial === 'a' ? 'b' : 'a';
  const composer = initDiscussionComposer({ form, input, send, modelSelect, modelStatus, moduleId,
    documentNode: { createElement: () => new Element(), addEventListener: (_, callback) => { settingsListener = callback; } },
    apiFetch: async (url, options) => {
      assert.equal(url, '/api/settings');
      if (options.method === 'POST') {
        patch = JSON.parse(options.body);
        return new Promise(resolve => { finishSave = () => resolve({ ok: !fail, data: fail ? { error: 'Save failed' }
          : { settings: { ai: { ...ai, modules: { ...ai.modules, [moduleId]: { profileId: requested } } } } } }); });
      }
      return { ok: true, data: { ai } };
    }, readJsonResponse: response => response.data,
  });
  await tick();
  assert.equal(modelSelect.value, initial);
  modelSelect.value = requested;
  const saving = modelSelect.fire('change');
  assert.deepEqual(patch, { ai: { modules: { [moduleId]: { profileId: requested } } } });
  assert.equal(send.disabled, true); assert.equal(modelSelect.disabled, true);
  input.fire('keydown', { key: 'Enter' }); assert.equal(form.submissions || 0, 0);
  finishSave(); await saving;
  assert.equal(modelSelect.value, fail ? initial : requested);
  assert.equal(input.value, 'Unsent draft'); assert.equal(send.disabled, false);
  assert.equal(modelStatus.hidden, !fail);
  if (fail) assert.equal(modelStatus.textContent, 'Save failed');
  composer.setBusy(true);
  settingsListener({ detail: { ai: { ...ai, modules: { ...ai.modules, [moduleId]: { profileId: requested } } } } });
  composer.setBusy(false);
  assert.equal(modelSelect.value, requested, 'Settings updates received during generation apply after completion');
}
console.log('Discussion composer passed: Enter/Shift+Enter, IME, blank drafts, send/stop, model persistence, module isolation, rollback and deferred settings.');
