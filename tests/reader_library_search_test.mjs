import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function loadModule(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}
const { collectUniquePapers, categorySearchText } = await loadModule('../assets/js/components/category_manager.js');
const { getPaperFlagIds } = await loadModule('../assets/js/components/paper_flags.js');
const source = await readFile(new URL('../assets/js/components/library_sidebar.js', import.meta.url), 'utf8');
const render = source.slice(source.indexOf('  function render() {'), source.indexOf('  function createPaperRow('));
const sort = source.slice(source.indexOf('  function sortPapers(items) {'), source.indexOf('  window.addEventListener("paper-lantern-library-updated"'));
const a = { id: 'a', title: 'Target current', category: 'A', todo: true, uploadedAt: '2025-01-01', viewedAt: '2026-10-25' };
const b = { id: 'b', title: 'Target outside', category: 'B', basicInfo: { authors: ['Bob Smith'] }, flags: ['flag-review'], uploadedAt: '2026-01-01' };
const shared = { id: 'shared', title: 'Shared paper', categoryIds: ['A', 'B'] };
const tree = { papers: [], folders: [{ id: 'A', name: 'A', papers: [a, shared] }, { id: 'B', name: 'B', papers: [b, shared] }] };
const container = () => ({ children: [], replaceChildren() { this.children = []; }, appendChild(child) { this.children.push(child); } });
const paperList = container();
const context = vm.createContext({
  tree, inlineEditing: false, selectedId: 'A', query: '', sortKey: 'uploadedAt', sortDirection: 'desc',
  ALL_ID: '__library', RECENT_ID: '__recent', TODO_ID: '__todo', icons: {},
  categoryList: container(), paperList, locationName: {}, locationCount: {}, locationCurrent: {}, title: {}, sortButton: {},
  flagDefinitions: [{ id: 'flag-review', name: '重点参考' }],
  flattenCategories: () => tree.folders, collectPapers: collectUniquePapers,
  categorySearchText, getPaperFlagIds, recentPapers: () => [a],
  getRecentPaperRecords: () => [], getPaperViewedAt: paper => paper.viewedAt,
  holdsCurrent: () => false, specialRow: () => ({}), isCurrentTodo: () => false,
  toggleCurrentTodo() {}, startCreate() {}, isCollapsedForDisplay: () => true,
  findCategory: (_tree, id) => tree.folders.find(folder => folder.id === id),
  createPaperRow: paper => paper, document: { createElement: () => ({}) },
});
vm.runInContext(`${sort}\n${render}\nglobalThis.renderList = render;`, context);

function search(selectedId, query) {
  Object.assign(context, { selectedId, query });
  context.renderList();
  return paperList.children.filter(item => item.id).map(item => item.id);
}
for (const selected of ['A', '__recent', '__todo']) {
  assert.deepEqual(search(selected, 'outside'), ['b'], `Search all papers from ${selected}`);
  assert.equal(context.locationName.textContent, '全库搜索');
  assert.equal(context.locationCount.textContent, '1');
  assert.equal(context.sortButton.hidden, false);
  assert.deepEqual(search(selected, 'bob 重点参考'), ['b']);
  assert.deepEqual(search(selected, 'shared'), ['shared'], 'Multi-category papers appear once');
}
assert.deepEqual(search('__recent', 'target'), ['b', 'a'], 'Global search does not inherit the Recent sort order');
assert.deepEqual(search('A', ''), ['a', 'shared'], 'Clearing search restores the original category');
assert.equal(context.locationName.textContent, 'A');
assert.deepEqual(search('__recent', ''), ['a']);
assert.equal(context.sortButton.hidden, true);
assert.deepEqual(search('__todo', ''), ['a']);
assert.deepEqual(search('A', 'missing'), []);
assert.equal(context.locationCount.textContent, '0');
assert.equal(context.sortButton.hidden, true);
console.log('Reader library search passed: global scope, deduplication, matching, counts, sorting, and restoring the selected view.');
