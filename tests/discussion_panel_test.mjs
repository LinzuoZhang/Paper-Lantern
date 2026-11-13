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
  scrollIntoView() {}
  fire(name) { return this.handlers[name]?.({ target: this, preventDefault() {}, stopPropagation() {} }); }
}

globalThis.document = { createElement: () => new Element() };
globalThis.window = { requestAnimationFrame: callback => callback() };
let source = await readFile(new URL('../assets/js/components/discussion_panel.js', import.meta.url), 'utf8');
const sharedHistory = await readFile(new URL('../assets/js/components/discussion_history.js', import.meta.url), 'utf8');
source = source.replace('./discussion_history.js', `data:text/javascript;base64,${Buffer.from(sharedHistory).toString('base64')}`);
const sharedComposer = await readFile(new URL('../assets/js/components/discussion_composer.js', import.meta.url), 'utf8');
source = source.replace('./discussion_composer.js', `data:text/javascript;base64,${Buffer.from(sharedComposer).toString('base64')}`);
const { initDiscussionPanel } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

// The composer selector changes only the discussion profile. Sending waits
// until that selection is saved, and failures restore the previous selection.
for (const fail of [false,true]) {
  const ids=['discussionForm','discussionInput','discussionMessages','sendDiscussionButton','discussionModelSelect','discussionModelStatus'];
  const elements=Object.fromEntries(ids.map(id=>[id,new Element()]));
  const ai={activeProfileId:'a',profiles:[
    {id:'a',name:'阅读',model:'fast-model'},{id:'b',name:'讨论',model:'deep-model'},
  ],modules:{discuss:{profileId:'a',thinkMode:true},translate:{profileId:'a',thinkMode:false}}};
  let finishSave, requestedPatch, discussionCalls=0;
  initDiscussionPanel({
    root:{querySelector:selector=>elements[selector.slice(1)] || null},
    getItem:()=>({id:'paper'}),getContextText:()=> '论文正文',saveItem:async()=>{},onScrollLatest(){},
    apiFetch:async(url,options)=>{
      if(url==='/api/settings' && !options?.method) return {ok:true,data:{ai}};
      if(url==='/api/settings') {
        requestedPatch=JSON.parse(options.body);
        return new Promise(resolve=>{finishSave=()=>resolve(fail
          ? {ok:false,data:{error:'保存失败'}}
          : {ok:true,data:{settings:{ai:{...ai,modules:{...ai.modules,discuss:{profileId:'b',thinkMode:true}}}}}});});
      }
      if(url==='/api/discuss') discussionCalls++;
      return {ok:true,headers:{get:()=> 'application/json'},data:{answer:'回答',title:'标题'}};
    },
    readJsonResponse:async response=>response.data,
  });
  for(let tick=0;tick<20;tick++) await Promise.resolve();
  assert.equal(elements.discussionModelSelect.value,'a');
  assert.deepEqual(elements.discussionModelSelect.children.map(option=>option.textContent),['fast-model','deep-model']);
  assert.equal(elements.discussionModelSelect.children.some(option=>!option.value),false);
  elements.discussionModelSelect.value='b';
  const saving=elements.discussionModelSelect.fire('change');
  assert.equal(elements.discussionModelSelect.disabled,true);
  assert.equal(elements.sendDiscussionButton.disabled,true);
  elements.discussionInput.value='比较方法';
  await elements.discussionForm.fire('submit');
  assert.equal(discussionCalls,0);
  assert.deepEqual(requestedPatch,{ai:{modules:{discuss:{profileId:'b'}}}});
  finishSave();
  await saving;
  assert.equal(elements.discussionModelSelect.value,fail?'a':'b');
  assert.equal(elements.sendDiscussionButton.disabled,false);
  assert.equal(elements.discussionInput.value,'比较方法');
  if(fail) assert.equal(elements.discussionModelStatus.textContent,'保存失败');
  else {
    await elements.discussionForm.fire('submit');
    assert.equal(discussionCalls,1);
  }
}

// Added paper chips are prepared before sending, clickable, and survive reload.
{
  const ids = ['discussionForm', 'discussionInput', 'discussionMessages', 'discussionThreadList', 'discussionPapers', 'discussionPaperStatus', 'addDiscussionPaperButton', 'sendDiscussionButton'];
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  let selectPaper, resolveSummary, request, opened;
  const paper = { id: 'paper-b', title: '论文B', authors: ['作者A', '作者B'] };
  const panel = initDiscussionPanel({
    root: { querySelector: selector => elements[selector.slice(1)] || null },
    getItem: () => ({ id: 'paper-a' }), getContextText: () => '正文',
    saveItem: async () => {}, onScrollLatest() {},
    paperReferences: { pickPaper: (_, select) => { selectPaper = select; }, showPaperInfo: (_, id) => { opened = id; } },
    apiFetch: async (url, options) => {
      if (url === '/api/discussion/paper-summary') return new Promise(resolve => { resolveSummary = resolve; });
      if (url === '/api/discuss') request = JSON.parse(options.body);
      return { ok: true, headers: { get: () => 'application/json' } };
    },
    readJsonResponse: async () => ({ answer: '回答', title: '标题' }),
  });
  elements.addDiscussionPaperButton.fire('click');
  const prepared = selectPaper(paper);
  assert.equal(elements.sendDiscussionButton.disabled, true);
  elements.discussionInput.value = '对比方法';
  await elements.discussionForm.fire('submit');
  assert.equal(request, undefined);
  resolveSummary({ ok: true });
  await prepared;
  assert.equal(elements.sendDiscussionButton.disabled, false);
  const chip = elements.discussionPapers.children[0];
  assert.equal(chip.children[0].textContent, '作者A et al.');
  chip.children[0].fire('click');
  assert.equal(opened, 'paper-b');
  await elements.discussionForm.fire('submit');
  assert.deepEqual(request.paperIds, ['paper-b']);
  assert.deepEqual(panel.getThreads()[0].messages[0].papers, [paper]);
  const stored = structuredClone(panel.getThreads());
  panel.renderHistory({ threads: stored });
  elements.discussionThreadList.children[0].fire('click');
  const links = elements.discussionMessages.children[0].querySelector('.discussion-message-papers');
  assert.equal(links.children[0].textContent, '作者A et al.');
  links.children[0].fire('click');
  assert.equal(opened, 'paper-b');
}

// Research statuses stay transient, and the current paper ID reaches the backend.
{
  const elements = Object.fromEntries(['discussionForm', 'discussionInput', 'discussionMessages', 'discussionThreadList'].map(id => [id, new Element()]));
  let request;
  const data = ['data: {"status":"正在查阅论文B"}\n\n', 'data: {"delta":"最终回答"}\n\n', 'data: [DONE]\n\n'];
  const panel = initDiscussionPanel({
    root: { querySelector: selector => elements[selector.slice(1)] || null },
    getItem: () => ({ id: 'current-paper' }),
    getContextText: () => '当前论文正文',
    saveItem: async () => {},
    onScrollLatest() {},
    apiFetch: async (url, options) => {
      if (url !== '/api/discuss') return { ok: true };
      request = JSON.parse(options.body);
      return { ok: true, headers: { get: () => 'text/event-stream' }, body: {
        getReader: () => ({ read: async () => data.length ? { value: new TextEncoder().encode(data.shift()), done: false } : { done: true } }),
      } };
    },
    readJsonResponse: async () => ({ title: '测试标题' }),
  });
  elements.discussionInput.value = '比较两篇论文';
  await elements.discussionForm.fire('submit');
  assert.equal(request.paperId, 'current-paper');
  const messages = panel.getThreads()[0].messages;
  assert.equal(messages.at(-1).content, '最终回答');
  assert.equal(JSON.stringify(messages).includes('正在查阅'), false);
}

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
// Agent mode is shared by reader/note, persisted per thread and locked while answering.
for (const contextType of ['paper', 'note']) {
  const ids = ['discussionForm', 'discussionInput', 'discussionMessages', 'discussionThreadList', 'discussionListView', 'discussionThreadView',
    'discussionModeChat', 'discussionModeWork', 'sendDiscussionButton', 'addDiscussionPaperButton'];
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  let request, finish, selectPaper, summaryCalls = 0;
  const saved = [];
  const panel = initDiscussionPanel({
    root: { querySelector: selector => elements[selector.slice(1)] || null },
    getItem: () => ({ id: 'current-item' }), getContextText: () => '当前内容', contextType,
    saveItem: async value => saved.push(structuredClone(value)), onScrollLatest() {},
    paperReferences: { pickPaper: (_, select) => { selectPaper = select; } },
    apiFetch: async (url, options) => {
      if (url === '/api/discussion/paper-summary') summaryCalls++;
      if (url === '/api/discuss') {
        request = JSON.parse(options.body);
        return new Promise(resolve => { finish = () => resolve({ ok: true, headers: { get: () => 'application/json' } }); });
      }
      return { ok: true };
    },
    readJsonResponse: async () => ({ answer: 'Agent回答', title: '讨论标题' }),
  });
  assert.equal(elements.discussionModeChat.checked, true);
  assert.equal(elements.discussionModeWork.checked, false);
  assert.equal(elements.discussionListView.hidden, false);
  assert.equal(elements.discussionThreadView.hidden, true);
  elements.discussionModeWork.checked = true;
  elements.discussionModeWork.fire('change');
  assert.equal(panel.getThreads().length, 0, 'Choosing a mode before the first message must not require a new discussion');
  assert.equal(elements.discussionModeChat.checked, false);
  elements.addDiscussionPaperButton.fire('click');
  await selectPaper({ id: 'related-paper', title: '相关论文' });
  assert.equal(summaryCalls, 0, 'Agent must not require AI-generated summaries before reading papers');
  elements.discussionInput.value = '比较方法';
  const sending = elements.discussionForm.fire('submit');
  for (let tick = 0; tick < 20; tick++) await Promise.resolve();
  assert.equal(elements.discussionModeChat.disabled, true);
  assert.equal(elements.discussionModeWork.disabled, true);
  assert.equal(elements.discussionThreadView.hidden, false);
  assert.equal(request.mode, 'agent');
  assert.equal(request.contextType, contextType);
  assert.equal(request.itemId, 'current-item');
  assert.equal(request.paperId, contextType === 'paper' ? 'current-item' : '');
  assert.deepEqual(request.paperIds, ['related-paper']);
  finish();
  await sending;
  assert.equal(elements.discussionModeWork.disabled, false);
  const stored = saved.at(-1).discussion;
  assert.equal(stored.threads[0].mode, 'agent');
  panel.renderHistory(stored);
  elements.discussionThreadList.children[0].fire('click');
  assert.equal(elements.discussionModeWork.checked, true);
  elements.discussionModeChat.checked = true;
  elements.discussionModeChat.fire('change');
  assert.equal(elements.discussionModeWork.checked, false);
  assert.equal(panel.getThreads()[0].mode, 'normal');
  panel.renderHistory({ threads: [{ id: 'legacy', messages: [{ role: 'user', content: '旧讨论' }] }] });
  elements.discussionThreadList.children[0].fire('click');
  assert.equal(elements.discussionModeChat.checked, true);
}

// Stopping an Agent request aborts its HTTP stream and restores the controls.
{
  const elements = Object.fromEntries(['discussionForm', 'discussionInput', 'discussionMessages',
    'discussionModeChat', 'discussionModeWork', 'sendDiscussionButton'].map(id => [id, new Element()]));
  let signal;
  initDiscussionPanel({
    root: { querySelector: selector => elements[selector.slice(1)] || null },
    getItem: () => ({ id: 'current' }), getContextText: () => '正文', saveItem: async () => {}, onScrollLatest() {},
    apiFetch: async (_, options) => new Promise((resolve, reject) => {
      signal = options.signal;
      signal.addEventListener('abort', () => reject(Object.assign(new Error('Stopped'), { name: 'AbortError' })));
    }), readJsonResponse: async () => ({}),
  });
  elements.discussionModeWork.checked = true; elements.discussionModeWork.fire('change');
  elements.discussionInput.value = '检索论文';
  const sending = elements.discussionForm.fire('submit');
  for (let tick = 0; tick < 20; tick++) await Promise.resolve();
  elements.sendDiscussionButton.fire('click');
  await sending;
  assert.equal(signal.aborted, true);
  assert.equal(elements.discussionModeWork.disabled, false);
  assert.equal(elements.discussionInput.disabled, false);
}
console.log('Discussion mode, context, stop, persistence and edit regeneration tests passed.');
