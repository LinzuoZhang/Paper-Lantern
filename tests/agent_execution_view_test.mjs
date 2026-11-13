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
view.update(plan);
assert.equal(host.querySelectorAll('.execution-group').length, 3);
assert.equal(host.querySelectorAll('.execution-operation').length, 4);
assert.ok(host.querySelectorAll('.execution-group').every(group => !group.open));
assert.equal(host.querySelector('.execution-diff').querySelectorAll('td')[1].textContent, plan.preview[0].changes[0].after.categoryIds[0], 'Long paths remain intact');
const group = host.querySelector('.execution-group'), row = host.querySelector('.execution-operation');
group.querySelector('summary').click(); group.open = true;
row.querySelector('summary').click(); row.open = true;
const raw = row.querySelector('.execution-raw'); raw.querySelector('summary').click(); raw.open = true;
view.update({ ...plan, state: 'executing', results: [{ id: 'a', status: 'completed' }, { id: 'b', status: 'running' }] });
assert.equal(host.querySelector('.execution-operation'), row, 'Reuse rows during streamed updates');
assert.equal(row.open, true);
assert.equal(row.querySelector('.execution-raw'), raw);
assert.equal(raw.open, true, 'Keep raw disclosures open during receipt updates');
view.update(partial);
const failed = host.querySelectorAll('.execution-operation')[1];
assert.equal(failed.open, true);
assert.equal(failed.dataset.state, 'failed');
host.querySelector('.execution-controls').children[1].click();
assert.ok(host.querySelectorAll('details').every(detail => !detail.open));
view.update(partial);
assert.equal(failed.open, false, 'Respect deliberate collapse after surfacing a failure');
host.querySelector('.execution-controls').children[0].click();
assert.ok(host.querySelectorAll('details').every(detail => detail.open));
const complete = { ...plan, state: 'completed', results: operations.map(op => ({ id: op.id, status: 'completed' })) };
view.update(complete);
assert.equal(group.open, true, 'Manual expansion survives completion');
const many = { id: 'many', state: 'completed', proposal: { operations: Array.from({ length: 150 }, (_, i) => ({ id: `${i}`, tool: 'unknown_tool', arguments: { i } })) },
  results: Array.from({ length: 150 }, (_, i) => ({ id: `${i}`, status: 'completed', output: { i } })) };
view.update(many);
assert.equal(host.querySelectorAll('.execution-group').length, 1);
assert.equal(host.querySelectorAll('.execution-operation').length, 150);
assert.ok(host.querySelectorAll('details').every(detail => !detail.open));
assert.equal(host.dataset.state, 'success');
// A failed load may temporarily replace the host with an error message.
host.replaceChildren(); view.update(many);
assert.equal(host.querySelectorAll('.execution-operation').length, 150);
console.log('Agent execution view passed: receipt statistics, ordered groups, structured changes, legacy fallbacks and stable disclosures.');
