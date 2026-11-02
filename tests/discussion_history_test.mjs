import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

class Element {
  constructor(tag = 'div') { this.tagName = tag; }
  children = []; handlers = {}; attributes = {}; className = ''; style = {}; value = ''; hidden = false;
  offsetWidth = 320; offsetHeight = 260;
  append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
  appendChild(node) { this.append(node); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this); }
  insertAdjacentElement(_, node) { this.parentElement.append(node); }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(type, handler) { (this.handlers[type] ||= []).push(handler); }
  removeEventListener(type, handler) { this.handlers[type] = (this.handlers[type] || []).filter(value => value !== handler); }
  async fire(type, values = {}) {
    for (const handler of this.handlers[type] || []) await handler({ target: this, preventDefault() {}, stopPropagation() {}, ...values });
  }
  querySelector(selector) {
    for (const child of this.children) {
      if (selector.startsWith('.') ? child.className.split(' ').includes(selector.slice(1)) : child.tagName === selector) return child;
      const found = child.querySelector(selector); if (found) return found;
    }
    return null;
  }
  closest() { return this.tagName === 'button' || this.tagName === 'input' ? this : null; }
  getBoundingClientRect() { return { right: 480, bottom: 80, top: 50 }; }
  focus() { this.focused = true; }
  select() {}
}
const body = new Element();
const documentNode = new Element();
documentNode.body = body;
documentNode.createElement = tag => new Element(tag);
globalThis.document = documentNode;
globalThis.window = { innerWidth: 500, innerHeight: 800, requestAnimationFrame: callback => callback(), addEventListener() {}, removeEventListener() {} };
const source = await readFile(new URL('../assets/js/components/discussion_history.js', import.meta.url), 'utf8');
const { createDiscussionHistory, generateDiscussionTitle, showDiscussionConfirm } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

let threads = [
  { id: 'a', title: 'Alpha methods', updatedAt: '2026-11-01T01:00:00Z', messages: [{}] },
  { id: 'b', title: 'Beta experiments', updatedAt: '2026-11-01T02:00:00Z', messages: [{}] },
  { id: 'draft', title: 'Empty draft', messages: [] },
];
let active = 'a';
let opened = [], renamed = 0, finishRename;
const list = new Element(), title = new Element(), edit = new Element('button'), button = new Element('button');
const titleHost = new Element(); titleHost.append(title, edit);
const history = createDiscussionHistory({ documentNode, threadList: list, title, titleEdit: edit, historyButtons: [button],
  getThreads: () => threads, getActiveId: () => active,
  onOpen: id => { opened.push(id); active = id; },
  onRename: async (thread, value) => { renamed++; if (finishRename) await new Promise(resolve => { finishRename.resolve = resolve; }); thread.title = value; },
  onDelete: async thread => { threads = threads.filter(value => value.id !== thread.id); return true; },
});
history.render();
assert.deepEqual(list.children.map(row => row.children[0].children[0].textContent), ['Beta experiments', 'Alpha methods']);
await list.children[0].fire('keydown', { key: 'Enter' });
await tick();
assert.deepEqual(opened, ['b']);

// Both list and popup use the same editor, with Escape, Enter and blur handling.
await list.children[1].children[0].children[1].fire('click');
let input = list.children[1].querySelector('input');
input.value = 'Discard';
history.render();
assert.equal(list.children[1].querySelector('input'), input, 'Incoming history updates must preserve an unfinished title edit');
await input.fire('keydown', { key: 'Escape' });
assert.equal(renamed, 0);
await list.children[1].children[0].children[1].fire('click');
input = list.children[1].querySelector('input');
input.value = '  Renamed Alpha  '; await input.fire('keydown', { key: 'Enter' }); await input.fire('blur'); await tick();
assert.equal(renamed, 1);
assert.equal(threads[0].title, 'Renamed Alpha');

history.toggle(button);
let popup = body.children.at(-1);
const search = popup.querySelector('.discussion-history-search');
search.value = 'ALPHA'; await search.fire('input');
let popupList = popup.querySelector('.discussion-history-list');
assert.equal(popupList.children.length, 1);
assert.equal(popupList.children[0].children[0].children[0].textContent, 'Renamed Alpha');
await popupList.children[0].children[0].children[1].fire('click');
input = popupList.children[0].querySelector('input');
input.value = 'Alpha from popup'; await input.fire('blur'); await tick();
assert.equal(threads[0].title, 'Alpha from popup');
popupList = popup.querySelector('.discussion-history-list');
await popupList.children[0].children[2].fire('click');
assert.equal(threads.some(thread => thread.id === 'a'), false);
assert.equal(popupList.children[0].textContent, '没有匹配的讨论');
await documentNode.fire('keydown', { key: 'Escape' });
assert.equal(body.children.includes(popup), false);
assert.equal(button.attributes['aria-expanded'], 'false');

// Closing during an async rename restores the header and does not commit twice.
active = 'b'; finishRename = {};
history.renameActive();
input = titleHost.querySelector('input'); input.value = 'Saved asynchronously';
await input.fire('keydown', { key: 'Enter' }); await input.fire('blur');
assert.equal(renamed, 3);
assert.equal(input.disabled, true);
history.close();
assert.equal(title.hidden, false);
finishRename.resolve(); await tick();
assert.equal(renamed, 3);
assert.equal(titleHost.querySelector('input'), null);

const generated = await generateDiscussionTitle({ apiFetch: async (url, options) => {
  assert.equal(url, '/api/discussion-title'); assert.equal(JSON.parse(options.body).question, 'Question');
  return new Response(JSON.stringify({ title: '  Generated\n title  ' }));
}, readJsonResponse: response => response.json(), question: 'Question', answer: 'Answer' });
assert.equal(generated, 'Generated title');

const confirming = showDiscussionConfirm('Delete conversation?');
const overlay = body.children.at(-1);
await overlay.querySelector('.reader-floating-confirm-ok').fire('click');
assert.equal(await confirming, true);
assert.equal(body.children.includes(overlay), false);
console.log('Shared discussion history passed: sorting, search, keyboard navigation, inline rename, async races, deletion, title generation and confirmation.');
