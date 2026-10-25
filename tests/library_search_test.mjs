import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function loadModule(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}
const { categorySearchText } = await loadModule('../assets/js/components/category_manager.js');
const { initPaperFlags } = await loadModule('../assets/js/components/paper_flags.js');
globalThis.document = { addEventListener() {} };
globalThis.window = { addEventListener() {} };
const paperFlags = initPaperFlags({});
paperFlags.setDefinitions([
  { id: 'flag-close-reading', name: '精读' },
  { id: 'flag-reproduce', name: '待复现' },
  { id: 'flag-unused', name: '已放弃' },
]);

const source = await readFile(new URL('../assets/js/pages/app.js', import.meta.url), 'utf8');
const filterSource = source.slice(source.indexOf('function filterPapers('), source.indexOf('function findPaperCategory('));
const context = vm.createContext({ categorySearchText, paperFlags });
vm.runInContext(`${filterSource}\nglobalThis.search = filterPapers;`, context);
const papers = [
  { id: 'world', title: 'World Models for Planning', basicInfo: { authors: ['Danijar Hafner', 'Jurgis Pasukonis'] }, categoryIds: ['models'], categoryNames: ['世界模型'], keywords: ['Dreamer'], read: true, flags: ['flag-close-reading'] },
  { id: 'robot', title: 'Safe Robot Navigation', basicInfo: { authors: ['张三', 'Alice Chen'] }, categoryIds: ['robotics'], categoryNames: ['机器人'], todo: true, flags: ['flag-reproduce'] },
  { id: 'note', title: 'Reading Notes', itemType: 'note', category: 'notes' },
  { id: 'legacy', title: 'Legacy Metadata', basicInfo: { authors: '李四' }, flags: [] },
];
const matches = query => Array.from(context.search(papers, query), paper => paper.id);
assert.deepEqual(matches('  HAFNER  '), ['world']);
assert.deepEqual(matches('jurgis pasukonis'), ['world']);
assert.deepEqual(matches('张'), ['robot']);
assert.deepEqual(matches('ALICE'), ['robot']);
assert.deepEqual(matches('李四'), ['legacy']);
assert.deepEqual(matches('已读'), ['world']);
assert.deepEqual(matches('待办'), ['robot']);
assert.deepEqual(matches('精读'), ['world']);
assert.deepEqual(matches('待复现'), ['robot']);
assert.deepEqual(matches('已放弃'), [], 'Unused definitions do not match papers');
assert.deepEqual(matches('flag-close-reading'), [], 'Search the visible flag name, not its internal ID');
assert.deepEqual(matches('hafner 精读'), ['world']);
assert.deepEqual(matches('hafner 待复现'), []);
assert.deepEqual(matches('world planning'), ['world']);
assert.deepEqual(matches('世界模型'), ['world']);
assert.deepEqual(matches('Dreamer'), ['world']);
assert.deepEqual(matches('reading'), ['note']);
assert.deepEqual(matches('  '), ['world', 'robot', 'note', 'legacy']);
papers[0].flags = [];
assert.deepEqual(matches('精读'), [], 'Removing a flag updates search results');
assert.deepEqual(matches('已读'), ['world'], 'Legacy read/todo booleans still match builtins');
paperFlags.setDefinitions([{ id: 'flag-reproduce', name: '重点参考' }]);
assert.deepEqual(matches('重点参考'), ['robot']);
assert.deepEqual(matches('待复现'), [], 'Search uses the current definition names');
console.log('Library search passed: authors, active flags, combined terms, and existing title/category/keyword search.');
