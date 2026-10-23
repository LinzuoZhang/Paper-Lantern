import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Small DOM harness: exercise the actual form handlers without browser dependencies.
class Element {
  children = [];
  handlers = {};
  className = '';
  value = '';
  classList = { add() {}, remove() {}, toggle() {} };
  append(...nodes) { nodes.forEach(node => { node.parentElement = this; this.children.push(node); }); }
  appendChild(node) { this.append(node); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute() {}
  addEventListener(name, handler) { this.handlers[name] = handler; }
  querySelector(selector) {
    for (const child of this.children) {
      if (child.className.split(' ').includes(selector.slice(1))) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }
  after(node) { this.parentElement.append(node); }
  remove() { this.parentElement.children = this.parentElement.children.filter(node => node !== this); }
  focus() {}
  setSelectionRange() {}
  fire(name) { return this.handlers[name]?.({ target: this, preventDefault() {}, stopPropagation() {} }); }
}

globalThis.document = { createElement: () => new Element() };
globalThis.window = { requestAnimationFrame: callback => callback() };
const source = await readFile(new URL('../assets/js/components/discussion_panel.js', import.meta.url), 'utf8');
const { initDiscussionPanel } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

for (const editedIndex of [0, 2]) {
  const elements = Object.fromEntries(['discussionForm', 'discussionInput', 'discussionMessages', 'discussionThreadList'].map(id => [id, new Element()]));
  const reference = { text: '原文', page: 3, ranges: [] };
  const originalMessages = [
    { role: 'user', content: '首问' }, { role: 'assistant', content: '旧答案' },
    { role: 'user', content: '追问' }, { role: 'assistant', content: '旧追问答案' },
  ];
  let request;
  const saved = [];
  const panel = initDiscussionPanel({
    root: { querySelector: selector => elements[selector.slice(1)] || null },
    getItem: () => ({ discussion: { threads: [{ id: 'test', title: '自定义标题', reference, messages: originalMessages }] } }),
    getContextText: () => '全文',
    saveItem: async payload => saved.push(structuredClone(payload)),
    onScrollLatest() {},
    apiFetch: async (url, options) => {
      assert.equal(url, '/api/discuss');
      request = JSON.parse(options.body);
      return { ok: true, headers: { get: () => 'application/json' } };
    },
    readJsonResponse: async () => ({ answer: '新答案' }),
  });
  elements.discussionThreadList.children[0].fire('click');
  const message = elements.discussionMessages.children[editedIndex];
  message.querySelector('.discussion-message-actions').children[1].fire('click');
  message.querySelector('.discussion-edit-input').value = '修改后的问题';
  message.querySelector('.discussion-edit-form').fire('submit');
  assert.equal(elements.discussionInput.disabled, true);
  for (let tick = 0; tick < 10; tick++) await Promise.resolve();
  assert.equal(request.question, '修改后的问题');
  assert.deepEqual(request.history, originalMessages.slice(0, editedIndex));
  assert.deepEqual(request.selectionReference, reference);
  const thread = panel.getThreads()[0];
  assert.deepEqual(thread.messages, [...originalMessages.slice(0, editedIndex),
    { role: 'user', content: '修改后的问题' }, { role: 'assistant', content: '新答案' }]);
  assert.equal(thread.title, '自定义标题');
  assert.deepEqual(saved.at(-1).discussion.threads[0].messages, thread.messages);
  assert.equal(elements.discussionInput.disabled, false);
  assert.equal(elements.discussionMessages.children[0].querySelector('.discussion-reference-text').textContent, '原文');
  // Reload persisted JSON, then reopen the discussion as after a page refresh.
  panel.renderHistory(JSON.parse(JSON.stringify(saved.at(-1).discussion)));
  elements.discussionThreadList.querySelector('.discussion-thread-open').fire('click');
  const reloadedMessages = elements.discussionMessages.children;
  assert.equal(reloadedMessages[0].querySelector('.discussion-reference-text').textContent, '原文');
  assert.ok(reloadedMessages[0].querySelector('.discussion-reference-card'));
  assert.ok(reloadedMessages.slice(1).every(node => !node.querySelector('.discussion-reference-card')));
  assert.deepEqual(panel.getActiveReference(), reference);
}
console.log('Discussion edit regeneration tests passed (first question and follow-up).');
