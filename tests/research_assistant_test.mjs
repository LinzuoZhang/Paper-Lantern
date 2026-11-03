import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

let source = await readFile(new URL('../assets/js/components/research_assistant.js', import.meta.url), 'utf8');
const sharedHistory = await readFile(new URL('../assets/js/components/discussion_history.js', import.meta.url), 'utf8');
source = source.replace('./discussion_history.js', `data:text/javascript;base64,${Buffer.from(sharedHistory).toString('base64')}`);
const sharedComposer = await readFile(new URL('../assets/js/components/discussion_composer.js', import.meta.url), 'utf8');
source = source.replace('./discussion_composer.js', `data:text/javascript;base64,${Buffer.from(sharedComposer).toString('base64')}`);
const sharedExecution = await readFile(new URL('../assets/js/components/agent_execution_view.js', import.meta.url), 'utf8');
source = source.replace('./agent_execution_view.js', `data:text/javascript;base64,${Buffer.from(sharedExecution).toString('base64')}`);
const { clampPosition, clampPanelWidth, readResearchStream, initResearchAssistant, researchProgressText } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

assert.match(researchProgressText({ catalogPaperCount: 12 }, '比较控制方法'), /比较控制方法.*12 篇候选文献/);
assert.match(researchProgressText({ summary: '核对两篇论文的实验条件', materialTitles: ['Control study'], readPaperCount: 2 }), /核对两篇论文的实验条件\n已读资料：《Control study》等 2 篇/);
assert.match(researchProgressText({ readPaperCount: 3 }), /已读取的 3 篇文献/);
assert.match(researchProgressText({ finalizing: true }), /核对引文并组织回答/);

assert.deepEqual(clampPosition({ x: -100, y: 9999 }, 800, 700), { x: 16, y: 646 });
assert.deepEqual(clampPosition({ x: 900, y: -10 }, 300, 400), { x: 246, y: 16 });
assert.equal(clampPanelWidth(-100), 360);
assert.equal(clampPanelWidth(900), 600);
assert.equal(clampPanelWidth(undefined), 420);

// UTF-8 and SSE records may split at arbitrary byte boundaries.
const bytes = new TextEncoder().encode('data: {"status":"阅读原文"}\r\n\r\ndata: {"report":"报告"}\n\ndata: [DONE]\n\n');
const events = [];
await readResearchStream(new Response(new ReadableStream({ start(controller) {
  for (let offset = 0; offset < bytes.length; offset += 3) controller.enqueue(bytes.slice(offset, offset + 3));
  controller.close();
} })), event => events.push(event));
assert.deepEqual(events, [{ status: '阅读原文' }, { report: '报告' }]);
let cancelled = false;
await assert.rejects(readResearchStream(new Response(new ReadableStream({ start(controller) {
  controller.enqueue(new TextEncoder().encode('data: {"error":"失败"}\n\n'));
}, cancel() { cancelled = true; } })), event => { throw new Error(event.error); }), /失败/);
assert.equal(cancelled, true);

class Element {
  hidden = false; disabled = false; value = ''; textContent = ''; style = { setProperty(name, value) { this[name] = value; } }; dataset = {}; attributes = {};
  scrollHeight = 600; clientHeight = 600;
  children = [];
  append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
  appendChild(node) { this.append(node); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this); }
  select() {}
  insertAdjacentElement(_, node) { this.parentElement.append(node); }
  replaceChildren(...nodes) { this.children = nodes; }
  handlers = {}; captured = null; scrollTop = 0;
  classList = { values: new Set(), add(name) { this.values.add(name); }, remove(name) { this.values.delete(name); },
    toggle(name, force) { force ? this.values.add(name) : this.values.delete(name); } };
  addEventListener(type, handler) { (this.handlers[type] ||= []).push(handler); }
  async fire(type, values = {}) { for (const handler of this.handlers[type] || []) await handler({ target: this, preventDefault() {}, stopPropagation() {}, ...values }); }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name]; }
  focus() { this.focused = true; }
  getBoundingClientRect() { return { width: 414, height: 610, left: 40, right: 454, top: 620, bottom: 650 }; }
  offsetWidth = 320; offsetHeight = 260;
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  requestSubmit() { return this.fire('submit'); }
  click() { return this.fire('click'); }
  scrollIntoView() {}
  setPointerCapture(id) { this.captured = id; }
  hasPointerCapture(id) { return this.captured === id; }
  releasePointerCapture() { this.captured = null; }
  querySelector(selector) {
    if (selector === '.research-launcher-dot') return this.dot;
    for (const child of this.children) {
      if (selector.startsWith('.') ? (child.className || '').split(' ').includes(selector.slice(1)) : child.tagName === selector) return child;
      const found = child.querySelector(selector); if (found) return found;
    }
    return null;
  }
  querySelectorAll() { return []; }
}
function fixture(stored, apiFetch, durable = false, config = {}) {
  const ids = ['researchLauncher', 'researchPanel', 'researchForm', 'researchTask', 'researchAnswer', 'researchSubmit',
    'researchAddPaper', 'researchPapers', 'researchStatus', 'researchReport', 'researchWelcome', 'researchCopy', 'researchContent', 'researchClose',
    'researchDock', 'researchResize', 'researchScope', 'researchConversationHeader', 'researchScrollBottom'];
  if (durable) ids.push('researchThreadList', 'researchThreadTitle', 'researchTitleEdit', 'researchHistoryButton', 'researchNew', 'researchBack', 'researchQuestion', 'researchMessages', 'researchResultActions', 'researchResume', 'researchSave', 'researchNote', 'researchPlan');
  if (config.withModels) ids.push('researchModelSelect', 'researchModelStatus');
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  if (durable) { const titleGroup = new Element(); titleGroup.append(elements.researchThreadTitle, elements.researchTitleEdit); }
  elements.researchPanel.hidden = true;
  elements.researchLauncher.dot = new Element();
  const storage = new Map(stored ? [['paperLanternResearchPosition', JSON.stringify(stored)]] : []);
  if (config.layout) storage.set('paperLanternResearchLayout', JSON.stringify(config.layout));
  globalThis.localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  globalThis.document = { getElementById: id => elements[id], body: new Element(), createElement: tag => { const element = new Element(); element.tagName = tag; return element; }, addEventListener() {}, removeEventListener() {} };
  const listeners = {};
  globalThis.window = { innerWidth: 1000, innerHeight: 900, addEventListener(type, handler) { listeners[type] = handler; }, removeEventListener() {}, requestAnimationFrame: callback => { callback(); return null; } };
  const agent = initResearchAssistant({ apiFetch: apiFetch || (() => {}), readJsonResponse: response => response.json(),
    getScope: () => ({ label: '已选文献 · 1 篇论文', hashes: ['paper-1'] }), ...config });
  return { elements, storage, listeners, agent };
}

{
  const { elements: e, storage, listeners } = fixture();
  const button = e.researchLauncher;
  assert.equal(button.style.left, '938px');
  assert.equal(button.style.top, '838px');
  await button.fire('pointerdown', { button: 0, isPrimary: true, pointerId: 1, clientX: 940, clientY: 840 });
  await button.fire('pointermove', { pointerId: 1, clientX: 440, clientY: 340 });
  await button.fire('pointerup', { pointerId: 1 });
  await button.fire('click');
  assert.equal(e.researchPanel.hidden, true, 'Dragging must not open the panel');
  assert.equal(button.style.left, '438px');
  assert.ok(storage.has('paperLanternResearchPosition'));
  await new Promise(resolve => setTimeout(resolve, 1));
  await button.fire('click');
  assert.equal(e.researchPanel.hidden, false);
  assert.equal(e.researchTask.focused, true);
  await e.researchClose.fire('click');
  assert.equal(e.researchPanel.hidden, true);
  window.innerWidth = 320; window.innerHeight = 500; listeners.resize();
  assert.equal(button.style.left, '266px');
  assert.equal(button.style.top, '338px');
  await button.fire('keydown', { shiftKey: true, key: 'ArrowLeft' });
  assert.equal(button.style.left, '246px');
}
{
  const { elements: e, storage, agent } = fixture();
  agent.open();
  assert.equal(e.researchPanel.dataset.mode, 'docked');
  assert.equal(e.researchPanel.style.width, '420px');
  assert.equal(e.researchLauncher.hidden, true);
  assert.equal(document.body.classList.values.has('research-docked-open'), true);
  await e.researchResize.fire('pointerdown', { button: 0, pointerId: 7, clientX: 600 });
  await e.researchResize.fire('pointermove', { pointerId: 7, clientX: 300 });
  await e.researchResize.fire('pointerup', { pointerId: 7 });
  assert.equal(e.researchPanel.style.width, '600px');
  assert.equal(e.researchResize.attributes['aria-valuenow'], '600');
  await e.researchResize.fire('keydown', { key: 'Home' });
  assert.equal(e.researchPanel.style.width, '360px');
  await e.researchDock.fire('click');
  assert.equal(e.researchPanel.dataset.mode, 'floating');
  assert.equal(document.body.classList.values.has('research-docked-open'), false);
  assert.equal(e.researchLauncher.hidden, false);
  assert.deepEqual(JSON.parse(storage.get('paperLanternResearchLayout')), { mode: 'floating', width: 360, open: true });
  await e.researchClose.fire('click');
  assert.equal(document.body.classList.values.has('research-details-collapsed'), false);
}
{
  const { elements: e } = fixture(null, undefined, false, { layout: { mode: 'floating', width: 520, open: true } });
  assert.equal(e.researchPanel.hidden, false);
  assert.equal(e.researchPanel.dataset.mode, 'floating');
  assert.equal(e.researchPanel.style.width, '520px');
}
{
  const { elements: e } = fixture({ x: 100, y: 200 });
  assert.equal(e.researchLauncher.style.left, '100px');
  await e.researchLauncher.fire('click');
  await e.researchPanel.fire('keydown', { key: 'Escape' });
  assert.equal(e.researchPanel.hidden, true);
}
{
  const calls = [];
  const id = 'a'.repeat(32);
  const claim = { claimId: 'C1', kind: 'finding', statement: 'Measured result', supports: [
    { hash: 'paper-1', quote: 'Original experiment evidence.', pageNumber: 2, startChar: 3, endChar: 32, sourceVersion: '12345678abcd' },
  ] };
  let job = { id, task: 'Compare experiments', status: 'running', result: null };
  const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  const { elements: e, agent, listeners, storage } = fixture(null, async (url, options = {}) => {
    calls.push({ url, payload: options.body ? JSON.parse(options.body) : null });
    if (url.includes('/events?')) {
      job = { ...job, status: 'completed', result: { report: 'Research report [Paper](hash:paper-1) [C1]', claims: [claim],
        readPaperIds: ['paper-1'], verification: { claimCount: 1, checks: { sourcesRevalidated: true } } } };
      const progress = [
        { agent: { type: 'analysis_progress', summary: '比较两篇文献的实验条件' } },
        { agent: { type: 'tool_started', name: 'get_paper_passages' } },
        { agent: { type: 'model_started', summary: '比较两篇文献的实验条件', materialTitles: ['Control study'], readPaperCount: 1 } },
        { seq: 7, job },
      ];
      return new Response(progress.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n');
    }
    if (url.endsWith('/save')) { job = { ...job, noteId: 'note-1' }; return json({ job }); }
    if (url.endsWith('/cancel')) { job = { ...job, status: 'cancelled', result: null }; return json({ job }); }
    if (url.endsWith('/resume')) { job = { ...job, status: 'running' }; return json({ job }); }
    if (options.method === 'POST') return json({ job });
    if (url.includes('/status?')) return json({ job });
    return json({ jobs: [], libraryKey: 'library-1' });
  }, true);
  const progressMessages = [];
  Object.defineProperty(e.researchStatus, 'textContent', { get() { return progressMessages.at(-1) || ''; },
    set(value) { progressMessages.push(value); } });
  agent.open();
  e.researchTask.value = 'Compare experiments';
  await e.researchForm.fire('submit');
  await new Promise(resolve => setTimeout(resolve, 20));
  const creation = calls.find(call => call.payload?.task);
  assert.equal(creation.url, '/api/reading-agent/jobs');
  assert.equal(creation.payload.task, 'Compare experiments');
  assert.deepEqual(creation.payload.hashes, ['paper-1']);
  assert.match(creation.payload.requestId, /^[a-f0-9]{32}$/);
  assert.match(e.researchReport.textContent, /Research report/);
  assert.equal(e.researchCopy.hidden, false);
  assert.equal(e.researchAnswer.hidden, false);
  assert.equal(e.researchResultActions.hidden, false);
  assert.equal(e.researchSave.hidden, false);
  assert.equal(e.researchNote.hidden, true);
  assert.equal(e.researchSubmit.disabled, true, 'An empty composer cannot resend the previous task');
  assert.equal(e.researchStatus.hidden, true);
  assert.ok(progressMessages.some(text => text.includes('阅读原文片段') && text.includes('比较两篇文献的实验条件')));
  assert.ok(progressMessages.some(text => text.includes('已读资料：《Control study》')));
  assert.equal(e.researchEvidence, undefined);
  assert.equal(e.researchAudit, undefined);
  assert.equal(JSON.parse(storage.get('paperLanternResearchJob:library-1')).cursor, 7);
  await e.researchSave.fire('click');
  assert.equal(e.researchNote.href, './note.html?id=note-1');
  assert.equal(e.researchSave.hidden, true);
  assert.equal(e.researchNote.hidden, false);
  assert.equal(e.researchStatus.hidden, true);
  job = { ...job, status: 'cancelled', result: null };
  await e.researchNew.fire('click');
  await e.researchThreadList.children[0].fire('click');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(e.researchResume.hidden, false);
  assert.equal(e.researchAnswer.hidden, true);
  assert.equal(e.researchResultActions.hidden, true);
  await e.researchResume.fire('click');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(calls.some(call => call.url.endsWith('/resume')));
  const beforeClose = calls.length;
  listeners.beforeunload();
  assert.equal(calls.length, beforeClose, 'Leaving the page must not cancel a durable job');
  await e.researchNew.fire('click');
  assert.equal(e.researchTask.value, '');
  assert.equal(e.researchResultActions.hidden, true);
  assert.equal(e.researchAnswer.hidden, true);
  assert.equal(e.researchResume.hidden, true);
}

// Opening a report validates on the server before navigation, repairs missing
// notes for both current and earlier turns, and closes the blank tab on error.
{
  const id = '6'.repeat(32), oldTurn = '5'.repeat(32);
  let current = { id, turnId: id, title: 'Topic', task: 'Latest question', status: 'completed', noteId: 'missing-current',
    result: { report: '# Current report' }, conversation: [{ turnId: oldTurn, task: 'Earlier question', status: 'completed',
      noteId: 'missing-earlier', result: { report: '# Earlier report' } }] };
  let finishSave, fail = false;
  const requests = [], tabs = [];
  const json = value => new Response(JSON.stringify(value));
  const { elements: e, listeners } = fixture(null, async (url, options = {}) => {
    if (url.endsWith('/save')) {
      const payload = JSON.parse(options.body); requests.push(payload);
      if (fail) return new Response(JSON.stringify({ error: 'Original evidence changed' }), { status: 400 });
      return new Promise(resolve => { finishSave = () => {
        const noteId = payload.turnId === oldTurn ? 'recreated-earlier' : 'recreated-current';
        current = payload.turnId === oldTurn
          ? { ...current, conversation: current.conversation.map(turn => ({ ...turn, noteId })) }
          : { ...current, noteId };
        resolve(json({ job: current, note: { id: noteId } }));
      }; });
    }
    if (url.includes('/status?')) return json({ job: current });
    return json({ jobs: [current], libraryKey: 'opening-reports' });
  }, true);
  window.location = { href: 'http://localhost/index.html' };
  window.open = () => {
    const tab = { urls: [], closed: false, opener: window, location: { replace(url) { tab.urls.push(url); } }, close() { this.closed = true; } };
    tabs.push(tab); return tab;
  };
  await new Promise(resolve => setTimeout(resolve, 10));
  await e.researchThreadList.children[0].fire('click');
  await new Promise(resolve => setTimeout(resolve, 10));
  let prevented = false;
  const opening = e.researchNote.fire('click', { preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(tabs.length, 1);
  assert.equal(tabs[0].opener, null);
  assert.deepEqual(tabs[0].urls, [], 'Do not navigate to an unvalidated stale note ID');
  await e.researchNote.fire('click');
  assert.equal(tabs.length, 1, 'Double clicks share the pending open operation');
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], { jobId: id, turnId: id });
  finishSave(); await opening;
  assert.equal(e.researchNote.href, './note.html?id=recreated-current');
  assert.deepEqual(tabs[0].urls, ['http://localhost/note.html?id=recreated-current']);
  const oldLink = e.researchMessages.children[1].children[1].children[1];
  const historical = oldLink.fire('click');
  assert.deepEqual(requests[1], { jobId: id, turnId: oldTurn });
  finishSave(); await historical;
  assert.deepEqual(tabs[1].urls, ['http://localhost/note.html?id=recreated-earlier']);
  fail = true;
  await e.researchNote.fire('click');
  assert.equal(tabs[2].closed, true);
  assert.deepEqual(tabs[2].urls, []);
  assert.equal(e.researchStatus.textContent, 'Original evidence changed');
  listeners.beforeunload();
}

// Report deltas render before job completion; retries replace the draft and
// repeated SSE events cannot duplicate content. The question is visible while
// the initial POST is still pending.
{
  const id = '7'.repeat(32);
  let current = { id, task: 'Stream a report', status: 'running', result: null };
  let stream, finishCreate;
  const json = data => new Response(JSON.stringify(data));
  const { elements: e, listeners } = fixture(null, async (url, options = {}) => {
    if (url.includes('/events?')) return new Response(new ReadableStream({ start(controller) { stream = controller; } }));
    if (options.method === 'POST') return new Promise(resolve => { finishCreate = () => resolve(json({ job: current })); });
    return json({ jobs: [], libraryKey: 'streaming' });
  }, true);
  await new Promise(resolve => setTimeout(resolve, 10));
  e.researchTask.value = current.task;
  const submitted = e.researchForm.fire('submit');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(e.researchQuestion.textContent, current.task);
  assert.equal(e.researchQuestion.hidden, false);
  assert.equal(e.researchStatus.hidden, false);
  finishCreate(); await submitted;
  const send = event => stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
  send({ seq: 1, agent: { type: 'report_started', streamId: 'draft' } });
  send({ seq: 2, agent: { type: 'report_delta', streamId: 'draft', delta: '# 标题\n\n' } });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(e.researchReport.textContent, '# 标题\n\n');
  assert.equal(e.researchAnswer.hidden, false);
  assert.equal(e.researchResultActions.hidden, true);
  assert.equal(e.researchCopy.hidden, true);
  send({ seq: 3, agent: { type: 'report_delta', streamId: 'draft', delta: '正文' } });
  send({ seq: 3, agent: { type: 'report_delta', streamId: 'draft', delta: '正文' } });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(e.researchReport.textContent, '# 标题\n\n正文');
  send({ seq: 4, agent: { type: 'report_reset', streamId: 'draft' } });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(e.researchAnswer.hidden, true);
  send({ seq: 5, agent: { type: 'report_started', streamId: 'repaired' } });
  send({ seq: 6, agent: { type: 'report_delta', streamId: 'repaired', delta: '修正后的报告' } });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(e.researchReport.textContent, '修正后的报告');
  current = { ...current, status: 'completed', result: { report: '修正后的报告（已核验）' } };
  send({ seq: 7, job: current }); stream.close();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(e.researchReport.textContent, '修正后的报告（已核验）');
  assert.equal(e.researchResultActions.hidden, false);
  assert.equal(e.researchCopy.hidden, false);
  assert.equal(e.researchStatus.hidden, true);
  listeners.beforeunload();
}

// Reopening an unfinished turn replays its deltas from the turn boundary even
// if a saved cursor points into the middle of that report.
{
  const id = '8'.repeat(32);
  const current = { id, task: 'Resume stream', status: 'running', eventAfter: 20 };
  const urls = [];
  const json = data => new Response(JSON.stringify(data));
  const { elements: e, storage, listeners } = fixture(null, async url => {
    urls.push(url);
    if (url.includes('/events?')) {
      const events = [
        { seq: 21, agent: { type: 'report_started', streamId: 'restored' } },
        { seq: 22, agent: { type: 'report_delta', streamId: 'restored', delta: '完整' } },
        { seq: 23, agent: { type: 'report_delta', streamId: 'restored', delta: '正文' } },
        { seq: 24, job: { ...current, status: 'completed', result: { report: '完整正文' } } },
      ];
      return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''));
    }
    if (url.includes('/status?')) return json({ job: current });
    return json({ jobs: [current], libraryKey: 'resume-stream' });
  }, true);
  storage.set('paperLanternResearchJob:resume-stream', JSON.stringify({ id, cursor: 22 }));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(urls.some(url => url.includes('/events?') && url.endsWith('after=20')));
  assert.equal(e.researchReport.textContent, '完整正文');
  listeners.beforeunload();
}

// Follow-ups share one history entry, retain earlier answers on screen and
// inherit server-side scope instead of silently switching with the library view.
{
  let current = { id: '9'.repeat(32), task: 'Initial question', title: 'Research topic', status: 'completed',
    turnId: '9'.repeat(32), noteId: 'saved-first', result: { report: 'Initial answer' }, conversation: [] };
  const calls = [];
  const json = data => new Response(JSON.stringify(data));
  const { elements: e, listeners } = fixture(null, async (url, options = {}) => {
    if (options.method === 'POST') {
      const payload = JSON.parse(options.body); calls.push(payload);
      if (payload.task === 'Rejected follow-up') return new Response(JSON.stringify({ error: 'Offline' }), { status: 400 });
      current = { ...current, task: payload.task, turnId: payload.requestId, noteId: null, eventAfter: 42,
        conversation: [...current.conversation, { task: current.task, result: current.result, noteId: current.noteId }],
        result: { report: 'Follow-up answer' } };
      if (payload.task === 'Lost follow-up response') throw new Error('Lost response');
      return json({ job: current });
    }
    if (url.includes('/status?')) return json({ job: current });
    return json({ jobs: [current], libraryKey: 'follow-ups' });
  }, true);
  await new Promise(resolve => setTimeout(resolve, 10));
  await e.researchThreadList.children[0].fire('click');
  await new Promise(resolve => setTimeout(resolve, 10));
  e.researchTask.value = 'Explain that result'; await e.researchTask.fire('input');
  await e.researchForm.fire('submit');
  assert.equal(calls[0].jobId, current.id);
  assert.equal(calls[0].hashes, undefined);
  assert.equal(calls[0].categoryIds, undefined);
  assert.equal(e.researchThreadList.children.length, 1);
  assert.equal(e.researchThreadTitle.textContent, 'Research topic');
  assert.equal(e.researchQuestion.textContent, 'Explain that result');
  assert.equal(e.researchReport.textContent, 'Follow-up answer');
  assert.equal(e.researchMessages.hidden, false);
  assert.equal(e.researchMessages.children[0].textContent, 'Initial question');
  assert.equal(e.researchMessages.children[1].children[0].textContent, 'Initial answer');
  assert.equal(e.researchMessages.children[1].children[1].children[1].href, './note.html?id=saved-first');
  e.researchTask.value = 'Rejected follow-up'; await e.researchTask.fire('input');
  await e.researchForm.fire('submit');
  assert.equal(e.researchTask.value, 'Rejected follow-up');
  assert.equal(e.researchReport.textContent, 'Follow-up answer');
  assert.equal(e.researchMessages.children.length, 2);
  e.researchTask.value = 'Lost follow-up response'; await e.researchTask.fire('input');
  await e.researchForm.fire('submit');
  assert.equal(calls.length, 3, 'A lost follow-up response must recover without another POST');
  assert.equal(e.researchTask.value, '');
  assert.equal(e.researchMessages.children.length, 4);
  assert.equal(e.researchThreadList.children.length, 1);
  await e.researchNew.fire('click');
  assert.equal(e.researchMessages.hidden, true);
  listeners.beforeunload();
}

// Plan previews never approve automatically; explicit buttons bind approval to
// the exact immutable digest, support revision and refresh the library on apply.
{
  const id = '4'.repeat(32), planId = '3'.repeat(32);
  let plan = { id: planId, version: 1, digest: 'reviewed-digest', state: 'awaiting_approval',
    proposal: { summary: 'Create a topic and group selected papers' },
    preview: [{ id: 'topic', label: '创建分类', reason: 'Relevant to the selected topic', changes: [{ before: null, after: { id: 'Topic' } }] }], results: [] };
  let current = { id, turnId: id, task: 'Organize papers', status: 'awaiting_approval', result: { kind: 'plan', planId, report: '# Proposed plan' } };
  const calls = [], updates = [];
  const json = data => new Response(JSON.stringify(data));
  const { elements: e, listeners } = fixture(null, async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url, body });
    if (url.endsWith('/plan/preview')) return json({ plan, job: current });
    if (url.endsWith('/plan/approve')) {
      assert.deepEqual(body, { jobId: id, planId, digest: 'reviewed-digest' });
      plan = { ...plan, state: 'completed', results: [{ id: 'topic', status: 'completed' }] };
      current = { ...current, status: 'completed', result: { ...current.result, kind: 'library', report: '# Completed' } };
      return json({ plan, job: current, tree: { folders: [] } });
    }
    if (url.includes('/status?')) return json({ job: current });
    return json({ libraryKey: 'plan-review', jobs: [current] });
  }, true, { onNoteSaved: data => updates.push(data) });
  await new Promise(resolve => setTimeout(resolve, 10));
  await e.researchThreadList.children[0].fire('click');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(e.researchPlan.hidden, false);
  assert.equal(e.researchPlan.dataset.state, 'approval');
  assert.equal(e.researchAnswer.hidden, true);
  assert.equal(e.researchResultActions.hidden, true);
  assert.equal(e.researchPlan.querySelector('.execution-group').tagName, 'details');
  assert.equal(calls.filter(call => call.url.endsWith('/plan/approve')).length, 0);
  assert.equal(e.researchTask.disabled, false, 'Users can revise a plan with a follow-up');
  let controls = e.researchPlan.querySelector('.research-plan-buttons');
  await controls.children[1].fire('click');
  assert.equal(e.researchTask.focused, true);
  assert.equal(calls.filter(call => call.body && call.url.endsWith('/plan/approve')).length, 0);
  await controls.children[0].fire('click');
  assert.equal(calls.filter(call => call.url.endsWith('/plan/approve')).length, 1);
  assert.equal(updates.length, 1);
  assert.equal(e.researchPlan.dataset.state, 'success');
  assert.equal(e.researchAnswer.hidden, true);
  assert.equal(e.researchReport.hidden, true);
  assert.equal(e.researchResultActions.hidden, true);
  assert.equal(e.researchSave.hidden, true);
  assert.equal(e.researchPlan.querySelector('.execution-operation').dataset.state, 'success');
  await e.researchNew.fire('click');
  assert.equal(e.researchPlan.hidden, true);
  listeners.beforeunload();
}

// A page reload restores the active job and only opens a monitoring GET.
{
  const job = { id: 'b'.repeat(32), task: 'Restore', status: 'running' };
  const calls = [];
  const json = data => new Response(JSON.stringify(data));
  const { elements: e, listeners } = fixture(null, async (url, options = {}) => {
    calls.push([url, options.method]);
    if (url.includes('/events?')) return new Response(`data: ${JSON.stringify({ job: { ...job, status: 'cancelled' } })}\n\ndata: [DONE]\n\n`);
    if (url.includes('/status?')) return json({ job });
    return json({ jobs: [job], libraryKey: 'restored' });
  }, true);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(e.researchTask.value, '');
  assert.equal(e.researchQuestion.textContent, 'Restore');
  assert.ok(calls.some(([url]) => url.includes('/events?')));
  assert.ok(calls.every(([, method]) => method !== 'POST'));
  listeners.beforeunload();
}

// A lost creation response can hide an already completed task. Recover its
// persisted request ID rather than creating another model run.
{
  let created = null;
  let posts = 0;
  const json = value => new Response(JSON.stringify(value));
  const { elements: e, listeners } = fixture(null, async (url, options = {}) => {
    if (options.method === 'POST') {
      posts++;
      const request = JSON.parse(options.body);
      created = { id: request.requestId, task: request.task, status: 'completed', result: { report: 'Recovered report' } };
      throw new Error('Lost response');
    }
    if (url.includes('/status?')) return json({ job: created });
    return json({ libraryKey: 'recovery', jobs: created ? [created] : [] });
  }, true);
  e.researchTask.value = 'Recover task';
  await e.researchForm.fire('submit');
  assert.equal(posts, 1);
  assert.equal(e.researchReport.textContent, 'Recovered report');
  assert.equal(e.researchSubmit.disabled, true, 'An empty composer cannot resend the previous task');
  listeners.beforeunload();
}

// Stop remains available while the create response is pending; cancellation
// is applied to the returned ID instead of aborting and orphaning the job.
{
  let finishCreate, requested, cancellations = 0, streams = 0;
  const json = data => new Response(JSON.stringify(data));
  const { elements: e, listeners } = fixture(null, async (url, options = {}) => {
    if (url.endsWith('/cancel')) { cancellations++; return json({ job: { id: requested.requestId, task: requested.task, status: 'cancelled' } }); }
    if (url.includes('/events?')) { streams++; throw new Error('Cancelled job must not open a monitoring stream'); }
    if (options.method === 'POST') {
      requested = JSON.parse(options.body);
      return new Promise(resolve => { finishCreate = () => resolve(json({ job: { id: requested.requestId, task: requested.task, status: 'queued' } })); });
    }
    return json({ jobs: [], libraryKey: 'pending-stop' });
  }, true);
  e.researchTask.value = 'Task to stop'; await e.researchTask.fire('input');
  const sending = e.researchForm.fire('submit');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(e.researchSubmit.attributes['aria-label'], '停止');
  assert.equal(e.researchSubmit.disabled, false);
  assert.equal(e.researchTask.disabled, true);
  await e.researchSubmit.fire('click');
  assert.equal(e.researchSubmit.attributes['aria-label'], '正在停止');
  finishCreate(); await sending;
  assert.equal(cancellations, 1); assert.equal(streams, 0);
  assert.equal(e.researchTask.value, '');
  assert.equal(e.researchTask.disabled, false);
  assert.equal(e.researchSubmit.attributes['aria-label'], '发送');
  listeners.beforeunload();
}

// Added papers are searchable by author/title, exclude notes, constrain the
// research scope, and clear only after an accepted request.
{
  let payload;
  const json = data => new Response(JSON.stringify(data));
  const papers = [
    { id: 'paper-a', title: 'Alpha method', basicInfo: { authors: ['Alice'] } },
    { id: 'paper-b', title: 'Beta experiments', basicInfo: { authors: ['Bob'] }, categoryIds: ['Control'] },
    { id: 'note', itemType: 'note', title: 'Beta note' },
  ];
  const { elements: e, listeners } = fixture(null, async (url, options = {}) => {
    if (options.method === 'POST') {
      payload = JSON.parse(options.body);
      return json({ job: { id: payload.requestId, task: payload.task, status: 'completed', result: { report: 'Scoped report' } } });
    }
    return json({ jobs: [], libraryKey: 'paper-attachments' });
  }, true, { getPapers: () => papers });
  await e.researchAddPaper.fire('click');
  const picker = document.body.children.at(-1);
  const search = picker.querySelector('.notes-paper-picker-search');
  search.value = 'Bob'; await search.fire('input');
  const list = picker.querySelector('.notes-paper-picker-list');
  assert.equal(list.children.length, 1);
  await picker.fire('keydown', { key: 'Enter', target: search });
  assert.equal(e.researchPapers.hidden, false);
  e.researchTask.value = 'Compare selected papers'; await e.researchTask.fire('input');
  await e.researchForm.fire('submit');
  assert.deepEqual(payload.hashes, ['paper-b']);
  assert.equal(payload.categoryIds, undefined);
  assert.equal(e.researchPapers.hidden, true);
  assert.equal(e.researchTask.value, '');
  listeners.beforeunload();
}

// A rejected create retains the draft and restores the send control for retry.
{
  const json = data => new Response(JSON.stringify(data));
  const { elements: e, listeners } = fixture(null, async (_url, options = {}) => {
    if (options.method === 'POST') throw new Error('Offline');
    return json({ jobs: [], libraryKey: 'retry-draft' });
  }, true);
  e.researchTask.value = 'Keep my draft'; await e.researchTask.fire('input');
  await e.researchForm.fire('submit');
  assert.equal(e.researchTask.value, 'Keep my draft');
  assert.equal(e.researchTask.disabled, false);
  assert.equal(e.researchSubmit.disabled, false);
  assert.equal(e.researchSubmit.attributes['aria-label'], '发送');
  listeners.beforeunload();
}

// Selecting history quickly keeps the last selected conversation even if an
// earlier status request arrives late.
{
  const entries = ['a', 'b'].map((letter, index) => ({ id: letter.repeat(32), task: `Task ${letter}`, title: `Title ${letter}`,
    status: 'completed', createdAt: index + 1, updatedAt: index + 1, result: { report: `Report ${letter}` } }));
  const pending = {};
  const json = value => new Response(JSON.stringify(value));
  const { elements: e, listeners } = fixture(null, async url => {
    if (url.includes('/status?')) {
      const id = new URL(url, 'http://local').searchParams.get('jobId');
      return new Promise(resolve => { pending[id] = () => resolve(json({ job: entries.find(item => item.id === id) })); });
    }
    return json({ libraryKey: 'switching', jobs: entries });
  }, true);
  await new Promise(resolve => setTimeout(resolve, 10));
  await e.researchThreadList.children[1].fire('click');
  await e.researchThreadList.children[0].fire('click');
  pending[entries[1].id]();
  await new Promise(resolve => setTimeout(resolve, 10));
  pending[entries[0].id]();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(e.researchThreadTitle.textContent, 'Title b');
  assert.equal(e.researchReport.textContent, 'Report b');
  listeners.beforeunload();
}

// Retrying a POST after a network failure or abort can create duplicate model runs.
{
  const id = 'f'.repeat(32);
  let job = { id, task: 'Original research question', title: 'Provisional title', titleSource: 'provisional', titleRevision: 0,
    status: 'completed', result: { report: 'Report text' }, createdAt: 1, updatedAt: 2 };
  let finishTitle;
  const calls = [];
  const json = value => new Response(JSON.stringify(value));
  const { elements: e, listeners } = fixture(null, async (url, options = {}) => {
    calls.push(url);
    const body = options.body ? JSON.parse(options.body) : {};
    if (url === '/api/discussion-title') return new Promise(resolve => { finishTitle = () => resolve(json({ title: 'Late automatic title' })); });
    if (url.endsWith('/rename')) { job = { ...job, title: body.title, titleSource: 'manual', titleRevision: 1 }; return json({ job }); }
    if (url.endsWith('/title')) { assert.equal(body.expectedRevision, 0); return json({ job }); }
    if (url.endsWith('/delete')) return json({ deleted: id, jobs: [] });
    if (options.method === 'POST' || url.includes('/status?')) return json({ job });
    return json({ libraryKey: 'titles', jobs: [job] });
  }, true, { showConfirm: async () => true });
  await new Promise(resolve => setTimeout(resolve, 10));
  await e.researchThreadList.children[0].fire('click');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(e.researchThreadTitle.textContent, 'Provisional title');
  await e.researchTitleEdit.fire('click');
  const input = e.researchThreadTitle.parentElement.querySelector('input');
  input.value = 'My manual title';
  await input.fire('keydown', { key: 'Enter' });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(e.researchThreadTitle.textContent, 'My manual title');
  finishTitle();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(e.researchThreadTitle.textContent, 'My manual title');
  assert.equal(job.task, 'Original research question');
  await e.researchBack.fire('click');
  assert.equal(e.researchThreadList.hidden, false);
  await e.researchThreadList.children[0].children[2].fire('click');
  assert.ok(calls.includes('/api/reading-agent/jobs/delete'));
  assert.equal(e.researchThreadList.children[0].textContent, '在下方输入问题，开始新的库内研究。');
  listeners.beforeunload();
}

// Retrying a POST after a network failure or abort can create duplicate model runs.
const app = await readFile(new URL('../assets/js/pages/app.js', import.meta.url), 'utf8');
const apiSource = app.slice(app.indexOf('async function apiFetch('));
for (const endpoint of ['run', 'jobs', 'jobs/resume', 'jobs/save', 'jobs/cancel']) for (const aborted of [false, true]) {
  let attempts = 0;
  const context = vm.createContext({ apiBaseUrl: '', window: { location: { protocol: 'http:', origin: 'http://localhost:8000' } },
    fetch: async () => { attempts++; const error = new Error('network'); if (aborted) error.name = 'AbortError'; throw error; } });
  vm.runInContext(`${apiSource}\nglobalThis.call = apiFetch;`, context);
  await assert.rejects(context.call(`/api/reading-agent/${endpoint}`, { method: 'POST' }));
  assert.equal(attempts, 1);
}
// A PDF evidence link must wait for asynchronous document rendering before
// jumping, and clamp an oversized page without navigating a different paper.
const readerSource = await readFile(new URL('../assets/js/pages/reader.js', import.meta.url), 'utf8');
const readerOpen = readerSource.slice(readerSource.indexOf('async function openReaderFromUrl()'), readerSource.indexOf('async function openLibraryPaper('));
for (const switched of [false, true]) {
  const jumps = [];
  let resolvePdf;
  const context = vm.createContext({ URLSearchParams, window: { location: { search: '?id=paper-1&page=99' } },
    currentPaper: null, currentPdfDocument: null, currentPdfReady: new Promise(resolve => { resolvePdf = resolve; }),
    setStatus() {}, openLibraryPaper: async id => { context.currentPaper = { id }; },
    jumpToPdfOutlinePageAsync: async page => jumps.push(page),
  });
  vm.runInContext(`${readerOpen}\nglobalThis.open = openReaderFromUrl;`, context);
  const opening = context.open();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(jumps, []);
  context.currentPdfDocument = { numPages: 5 };
  if (switched) context.currentPaper = { id: 'different-paper' };
  resolvePdf();
  await opening;
  assert.deepEqual(jumps, switched ? [] : [5]);
}
console.log('Research assistant passed: durable jobs, recovery, evidence, PDF links, drag controls, SSE, and no duplicate POST retry.');
