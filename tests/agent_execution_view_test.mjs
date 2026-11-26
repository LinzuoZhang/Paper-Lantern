import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../assets/js/components/agent_execution_view.js', import.meta.url), 'utf8');
const { executionModel, executionDiff, createExecutionView } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const operations = [
  { id: 'a', tool: 'set_item_categories', arguments: { id: 'paper-a' } },
  { id: 'b', tool: 'set_item_categories', arguments: { id: 'paper-b' } },
  { id: 'c', tool: 'batch_update_flags', arguments: { ids: ['paper-a', 'paper-b'], flags: ['read'], operation: 'add' } },
  { id: 'd', tool: 'set_item_categories', arguments: { categoryIds: [{ ref: 'a.categoryId' }] } },
];
const plan = { id: 'test', version: 2, state: 'awaiting_approval', proposal: { summary: '整理文献', operations },
  preview: [{ id: 'a', tool: 'set_item_categories', changes: [{ title: 'A very long paper title '.repeat(15),
    before: { categoryIds: ['uncategorized'], title: 'unchanged' }, after: { categoryIds: ['World Model/RL结合方案/04 神经仿真器策略优化/'.repeat(8)], title: 'unchanged' } }] }], results: [] };

assert.deepEqual(executionModel(plan).groups.map(group => group.operations.length), [2, 1, 1], 'Only adjacent operations group together');
assert.deepEqual(executionModel(plan).operations.map(op => op.id), ['a', 'b', 'c', 'd']);
assert.equal(executionModel(plan).counts.success, 0, 'A validated preview is not execution');
assert.equal(executionModel({ ...plan, state: 'completed' }).status, 'warning', 'Plan-level completion does not prove writes');
const partial = { ...plan, state: 'failed', failure: { operationId: 'b', error: 'Write failed', possiblePartialWrite: true },
  results: [{ id: 'a', status: 'completed' }, { id: 'b', status: 'failed', error: 'Write failed' }, { id: 'c', status: 'skipped' }] };
assert.equal(executionModel(partial).status, 'partial');
assert.equal(executionModel(partial).counts.success, 1);
assert.equal(executionModel(partial).counts.failed, 1);
assert.equal(executionModel(partial).counts.pending, 1);
assert.equal(executionModel(partial).counts.skipped, 1);
assert.equal(executionModel({ ...plan, state: 'failed', results: [] }).status, 'failed');
assert.equal(executionModel({ ...plan, state: 'completed', results: operations.map(op => ({ id: op.id, status: 'completed' })) }).status, 'success');
assert.equal(executionModel({ state: 'completed', results: [{ id: 'old', tool: 'legacy_tool', status: 'unknown-new-status', output: 'raw' }] }).counts.unknown, 1);
assert.equal(executionModel({ state: 'completed', results: [{ id: 'orphan', status: 'completed' }] }).operations.length, 1);
assert.deepEqual(executionDiff(plan.preview[0].changes[0]).map(field => field.key), ['categoryIds']);
assert.deepEqual(executionDiff({ before: '分类：unknown', after: '分类：Topic' }), [], 'Never guess structured changes from text');
assert.deepEqual(executionDiff({ after: { title: 'Created' } }), []);

class Element {
  children = []; attributes = {}; dataset = {}; handlers = {}; open = false; textContent = '';
  append(...nodes) { for (const node of nodes) { node.remove(); node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes) { for (const child of this.children) child.parent = null; this.children = []; this.append(...nodes); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(item => item !== this); this.parent = null; }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { (this.handlers[name] ||= []).push(callback); }
  click() { this.handlers.click?.forEach(callback => callback()); }
  querySelector(selector) { return this.querySelectorAll(selector)[0]; }
  querySelectorAll(selector) { return this.children.flatMap(child => [
    ...(selector[0] === '.' ? child.className?.split(' ').includes(selector.slice(1)) ? [child] : [] : child.tagName === selector ? [child] : []),
    ...child.querySelectorAll(selector),
  ]); }
}
globalThis.document = { createElement: tag => Object.assign(new Element(), { tagName: tag }) };
const host = new Element(), view = createExecutionView(host);
let approvals = 0;
const actions = [{ label: '确认操作', run: () => { approvals++; } }];
view.update(plan, { actions });
assert.equal(host.querySelector('.execution-plan-text').textContent, '整理文献');
assert.equal(host.querySelector('.execution-plan-text').hidden, false);
assert.equal(host.querySelectorAll('details').length, 0);
assert.equal(host.querySelectorAll('pre').length, 0);
assert.equal(host.querySelector('.execution-outcome').children.length, 0, 'Do not imply execution before confirmation');
assert.equal(host.querySelectorAll('button').length, 1);
host.querySelector('button').click();
assert.equal(approvals, 1);
view.update(plan, { busy: true, actions });
assert.equal(host.querySelector('button').disabled, true);
assert.match(host.querySelector('.execution-result-text').textContent, /正在执行已确认/);
assert.equal(host.querySelector('.execution-plan-text').hidden, true);
view.update(partial);
assert.match(host.querySelector('.execution-result-text').textContent, /部分完成：1 项已完成，1 项失败，2 项未执行/);
assert.match(host.querySelector('.execution-error').textContent, /Write failed/);
assert.match(host.querySelector('.execution-warning').textContent, /可能已产生部分修改/);
assert.equal(host.querySelectorAll('details').length, 0);
const complete = { ...plan, state: 'completed', results: operations.map(op => ({ id: op.id, status: 'completed' })) };
view.update(complete);
assert.match(host.querySelector('.execution-result-text').textContent, /^已替换文献分类/);
assert.equal(host.querySelector('.execution-plan-text').hidden, true, 'Completed results must not retain the proposal in future tense');
assert.ok(host.querySelectorAll('.execution-result-text').every(result => !/共完成|已完成 \d+ 项/.test(result.textContent)));
assert.equal(host.querySelectorAll('button').length, 0);
assert.equal(host.querySelector('.execution-error'), undefined, 'Clear old failures when the plan changes');
assert.equal(host.dataset.state, 'success');
view.update({ ...plan, state: 'completed' });
assert.match(host.querySelector('.execution-result-text').textContent, /暂时无法确认/);
view.update({ ...plan, state: 'failed', failure: { stage: 'preview', error: '分类不存在' } });
assert.match(host.querySelector('.execution-result-text').textContent, /未执行任何修改/);
view.update({ ...complete, syncError: 'Offline' });
assert.match(host.querySelector('.execution-warning').textContent, /修改已保存，但同步未完成：Offline/);
view.update({ id: 'old', state: 'completed', legacyResult: { report: '已将两篇文献归入专题。' } });
assert.equal(host.querySelector('.execution-result-text').textContent, '已将两篇文献归入专题。');
view.update({ id: 'superseded', state: 'superseded', proposal: { summary: '旧方案' }, legacyResult: { kind: 'plan', report: '旧方案' } });
assert.equal(host.querySelector('.execution-result-text').textContent, '此计划已由新方案替代。');
view.update({ ...complete, results: [{ id: 'a', status: 'completed' }, { id: 'b', status: 'unrecognized' }] });
assert.match(host.querySelector('.execution-result-text').textContent, /1 项结果待核对/);
view.update({ id: 'category', state: 'completed', proposal: { summary: '创建专题', operations: [{ id: 'cat', tool: 'create_category', arguments: { name: '专题' } }] },
  results: [{ id: 'cat', status: 'completed', output: { categoryId: '专题' } }] });
assert.equal(host.querySelector('.execution-result-text').textContent, '已创建分类：“专题”。');
const notePlan = { id: 'monthly-note', state: 'completed', proposal: { summary: '总结将包含五个章节。', operations: [
  { id: 'note', tool: 'create_note', arguments: { title: '十月研究总结', categoryIds: [{ ref: 'category.categoryId' }] } },
] }, preview: [{ id: 'note', tool: 'create_note', arguments: { title: '十月研究总结', categoryIds: ['日报文献/2026年10月'] },
  changes: [{ before: null, after: { title: '十月研究总结', categoryIds: ['日报文献/2026年10月'] } }] }],
  results: [{ id: 'note', tool: 'create_note', status: 'completed', output: { noteId: 'saved-note-id' } }] };
view.update(notePlan);
assert.equal(host.querySelector('.execution-result-text').textContent, '已新建独立笔记《十月研究总结》，保存到“日报文献/2026年10月”。');
assert.equal(host.querySelector('.execution-plan-text').hidden, true);
assert.equal(host.querySelector('.execution-result-link').href, './note.html?id=saved-note-id');
assert.equal(host.querySelector('.execution-result-link').attributes['aria-label'], '打开笔记《十月研究总结》');
view.update({ ...notePlan, state: 'failed', failure: { stage: 'execution', error: '保存失败' },
  results: [{ id: 'note', tool: 'create_note', status: 'failed', error: '保存失败' }] });
assert.equal(host.querySelector('.execution-result-link'), undefined, 'A failed write must not expose a fabricated saved note');
assert.ok(host.querySelectorAll('.execution-result-text').every(result => !result.textContent.includes('已新建')));
view.update({ ...notePlan, results: [{ id: 'note', tool: 'create_note', status: 'completed', output: {} }] });
assert.equal(host.querySelector('.execution-result-link'), undefined, 'Only link to a note ID present in an execution receipt');
// A failed load may temporarily replace the host with an error message.
host.replaceChildren(); view.update(plan, { actions });
assert.equal(host.querySelector('.execution-plan-text').textContent, '整理文献');
assert.equal(host.querySelectorAll('details').length, 0);
console.log('Agent execution view passed: readable plans, confirmation, receipt-backed results and failure explanations.');
