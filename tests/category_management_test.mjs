import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function loadModule(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}
const { collectUniquePapers, getCategoryIds, categorySearchText } = await loadModule('../assets/js/components/category_manager.js');
const { getRecentPapers } = await loadModule('../assets/js/lib/recent_papers.js');
const paper = { id: 'shared', title: 'Shared', categoryIds: ['Research', 'Research/Navigation', 'References'], categoryNames: ['Research', 'Navigation', 'References'], viewedAt: '2026-10-21T01:00:00Z', todo: true };
const other = { id: 'other', title: 'Other' };
const branch = { papers: [paper], folders: [{ papers: [paper], folders: [] }] };
const tree = { papers: [], folders: [branch, { papers: [paper, other], folders: [] }] };
assert.deepEqual(collectUniquePapers(tree).map(p => p.id), ['shared', 'other']);
assert.equal(collectUniquePapers(branch).length, 1, 'A paper assigned to a parent and child counts once');
assert.equal(collectUniquePapers(tree).filter(p => p.todo).length, 1);
assert.equal(getRecentPapers([paper, paper], []).length, 1);
assert.deepEqual(getCategoryIds({ category: 'legacy' }), ['legacy']);
assert.deepEqual(getCategoryIds({ categoryId: 'legacy' }), ['legacy']);
assert.ok(categorySearchText(paper).includes('Navigation'));

const api = await loadModule('../extension/api.js');
globalThis.chrome = { storage: { local: { get: async () => ({ apiBase: 'http://localhost:8000' }) } } };
let remotePayload;
let uploadedIds;
globalThis.fetch = async (url, options) => {
  if (url.startsWith('file:')) return new Response('%PDF-fixture', { headers: { 'Content-Type': 'application/pdf' } });
  if (options?.body instanceof FormData) uploadedIds = JSON.parse(options.body.get('categoryIds'));
  else remotePayload = JSON.parse(options.body);
  return new Response(JSON.stringify({ paper }), { headers: { 'Content-Type': 'application/json' } });
};
await api.importRemotePdf('https://example.com/paper.pdf', { categoryIds: ['Research', 'References'] });
assert.deepEqual(remotePayload.categoryIds, ['Research', 'References']);
await api.importLocalPdf('file:///fixture.pdf', { categoryIds: ['Research', 'References'] });
assert.deepEqual(uploadedIds, ['Research', 'References']);

// Exercise the reader's asynchronous import contract, including failed jobs.
const sidebar = await readFile(new URL('../assets/js/components/library_sidebar.js', import.meta.url), 'utf8');
const importer = sidebar.slice(sidebar.indexOf('  async function uploadRemotePaper('), sidebar.indexOf('  function uploadCategory()'));
async function runReaderImport(responses) {
  const opened = [], requests = [], messages = [];
  let refreshCount = 0;
  const context = vm.createContext({
    URLSearchParams, remoteButton: { disabled: false },
    uploadCategory: () => 'Research',
    window: { setTimeout: callback => callback() },
    apiFetch: async (url, options) => {
      requests.push({ url, payload: options?.body ? JSON.parse(options.body) : null });
      assert.ok(responses.length, 'Unexpected reader import request');
      return { ok: true, data: responses.shift() };
    },
    readJsonResponse: async response => response.data,
    refresh: async () => { refreshCount++; },
    setStatus: (message, error) => messages.push({ message, error }),
    openUrl: url => opened.push(url),
  });
  vm.runInContext(`${importer}\nthis.runImport = uploadRemotePaper;`, context);
  await context.runImport('https://example.com/paper.pdf');
  assert.equal(responses.length, 0);
  assert.equal(context.remoteButton.disabled, false);
  return { opened, requests, messages, refreshCount };
}
const imported = await runReaderImport([
  { job: { jobId: 'job', state: 'downloading' } },
  { job: { jobId: 'job', state: 'completed', paperId: 'shared' } },
]);
assert.deepEqual(imported.requests[0].payload.categoryIds, ['Research']);
assert.equal(imported.opened[0], './reader.html?id=shared');
assert.equal(imported.refreshCount, 1);
const failed = await runReaderImport([{ job: { jobId: 'job', state: 'failed', error: 'Download failed' } }]);
assert.equal(failed.opened.length, 0);
assert.equal(failed.messages.at(-1).message, 'Download failed');
assert.equal((await runReaderImport([{ paper: { id: 'legacy' } }])).opened[0], './reader.html?id=legacy');
console.log('Category deduplication and extension multi-category imports passed.');
