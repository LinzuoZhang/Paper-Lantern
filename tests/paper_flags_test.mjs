import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../assets/js/components/paper_flags.js', import.meta.url), 'utf8');
const { savePaperFlags, applyPaperFlagUpdates, filterPapersByFlags } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const jsonResponse = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

async function saveWithResponses(responses, options = {}) {
  const requests = [], saved = [], progress = [];
  const result = { requests, saved, progress };
  try {
    await savePaperFlags({
      papers: [{ id: 'a', read: false, todo: true, flags: ['todo', 'custom-a'] }, { id: 'b', flags: [] }],
      flagId: 'read', checked: true, bulk: true,
      apiFetch: async (path, init) => {
        requests.push({ path, payload: init?.body ? JSON.parse(init.body) : null });
        assert(responses.length, 'Unexpected request');
        return jsonResponse(...responses.shift());
      },
      readJsonResponse: response => response.json(),
      onSaved: data => saved.push(data),
      onProgress: (completed, total) => progress.push([completed, total]),
      ...options,
    });
  } catch (error) { result.error = error; }
  assert.equal(responses.length, 0);
  return result;
}

const batchData = { papers: [{ id: 'a', read: true, todo: true, flags: ['read', 'todo', 'custom-a'], viewedAt: '2026-10-25' }, { id: 'b', read: true, flags: ['read'] }], sync: null };
const batch = await saveWithResponses([[200, batchData]]);
assert.equal(batch.error, undefined);
assert.deepEqual(batch.requests.map(r => r.payload), [{ action: 'flags-many', ids: ['a', 'b'], flags: ['read'], operation: 'add', response: 'flags' }]);
assert.deepEqual(batch.saved, [batchData]);

// A paper can appear as separate objects in multiple categories. Update all copies without replacing content.
const article = { id: 'a', title: 'Keep title', notes: '# Keep notes', discussion: [{ content: 'Keep discussion' }], flags: ['custom-a'], uploadedAt: '2020-01-01' };
const tree = { papers: [{ ...article }], folders: [{ papers: [{ ...article }, { id: 'untouched', flags: ['todo'] }], folders: [] }] };
applyPaperFlagUpdates(tree, batchData.papers);
for (const updated of [tree.papers[0], tree.folders[0].papers[0]]) {
  assert.deepEqual(updated, { ...article, ...batchData.papers[0] });
}
assert.deepEqual(tree.folders[0].papers[1], { id: 'untouched', flags: ['todo'] });
applyPaperFlagUpdates(tree, [{ id: 'a', flags: [], todo: false }]);
assert.equal(tree.papers[0].read, true, 'Fields absent from a partial update remain unchanged');
assert.equal(tree.papers[0].viewedAt, '2026-10-25');
assert.deepEqual(tree.folders[0].papers[0].flags, []);

const single = await saveWithResponses([[200, { paper: { id: 'a', flags: ['custom-a'] } }]], { bulk: false, flagId: 'todo', checked: false });
assert.equal(single.error, undefined);
assert.deepEqual(single.requests[0].payload, { id: 'a', flags: ['custom-a'] });

const filterSource = [
  { id: 'read', read: true, flags: ['read', 'custom'] },
  { id: 'todo', todo: true, flags: ['todo'] },
  { id: 'custom', flags: ['custom', 'custom'] },
  { id: 'empty', flags: [] },
  { id: 'legacy', read: false, todo: false, flags: ['read', 'todo'] },
];
assert.equal(filterPapersByFlags(filterSource), filterSource, 'Clearing the filter preserves the full source list');
assert.deepEqual(filterPapersByFlags(filterSource, ['read']).map(p => p.id), ['read']);
assert.deepEqual(filterPapersByFlags(filterSource, new Set(['todo'])).map(p => p.id), ['todo']);
assert.deepEqual(filterPapersByFlags(filterSource, ['custom', 'todo']).map(p => p.id), ['read', 'todo', 'custom'], 'Multiple flags match any selected flag without duplicating rows');
assert.deepEqual(filterPapersByFlags(filterSource.slice(1), ['read']), [], 'Flag filtering stays inside the supplied category/search scope');
assert.deepEqual(filterPapersByFlags(filterSource, ['missing']), []);
assert.equal(filterSource.length, 5);

const legacy = await saveWithResponses([
  [404, { error: 'Paper not found.' }],
  [200, { paper: { id: 'a', read: false, todo: true, flags: ['todo', 'custom-a', 'new-since-loading'] } }],
  [200, { paper: { id: 'a', read: true, todo: true, flags: ['read', 'todo', 'custom-a', 'new-since-loading'] }, tree: { revision: 1 } }],
  [200, { paper: { id: 'b', read: true, flags: ['read', 'custom-b'] } }],
  [200, { paper: { id: 'b', read: true, flags: ['read', 'custom-b'] }, tree: { revision: 2 } }],
]);
assert.equal(legacy.error, undefined);
assert.deepEqual(legacy.requests.map(r => r.path), ['/api/library/paper', '/api/library/paper?id=a', '/api/library/paper', '/api/library/paper?id=b', '/api/library/paper']);
assert.deepEqual(legacy.requests[2].payload, { id: 'a', flags: ['todo', 'custom-a', 'new-since-loading', 'read'] });
assert.deepEqual(legacy.requests[4].payload, { id: 'b', flags: ['read', 'custom-b'] });
assert.equal(legacy.saved.length, 2);
assert.deepEqual(legacy.progress, [[0, 2], [1, 2], [2, 2]]);

// Actual missing papers and server errors must not be treated as unsupported batch APIs.
for (const [status, message] of [[404, 'Paper not found: missing'], [400, 'Invalid flags'], [503, 'Service unavailable']]) {
  const failure = await saveWithResponses([[status, { error: message }]]);
  assert.equal(failure.error.message, message);
  assert.equal(failure.requests.length, 1);
  assert.equal(failure.saved.length, 0);
}

// Partial legacy success is reported before a subsequent failure, so the UI can show the saved state.
const partial = await saveWithResponses([
  [404, { error: 'Paper not found.' }],
  [200, { paper: { id: 'a', todo: true, flags: ['todo'] } }],
  [200, { paper: { id: 'a', todo: true, read: true, flags: ['read', 'todo'] }, tree: { revision: 1 } }],
  [404, { error: 'Paper not found.' }],
]);
assert.equal(partial.error.message, 'Paper not found.');
assert.equal(partial.saved.length, 1);
assert.deepEqual(partial.progress, [[0, 2], [1, 2]]);

// Exercise the real app API discovery code: a JSON 404 is an API response, not an unavailable host.
const app = await readFile(new URL('../assets/js/pages/app.js', import.meta.url), 'utf8');
const apiSource = app.slice(app.indexOf('async function apiFetch('));
const tried = [];
const context = vm.createContext({
  apiBaseUrl: '',
  window: { location: { protocol: 'http:', origin: 'http://127.0.0.1:8000' } },
  fetch: async url => { tried.push(url); return jsonResponse(404, { error: 'Paper not found.' }); },
});
vm.runInContext(apiSource, context);
const notFound = await context.apiFetch('/api/library/paper', { method: 'POST', body: '{}' });
assert.equal(notFound.status, 404);
assert.deepEqual(tried, ['http://127.0.0.1:8000/api/library/paper']);
assert.equal(context.apiBaseUrl, 'http://127.0.0.1:8000');
tried.length = 0;
context.apiBaseUrl = '';
context.fetch = async url => {
  tried.push(url);
  return tried.length === 1 ? new Response('Static server 404', { status: 404 }) : jsonResponse(200, { tree: {} });
};
assert.equal((await context.apiFetch('/api/library')).status, 200);
assert.equal(tried.length, 2, 'Static HTML 404 still allows discovering the API server');

console.log('Paper flags passed: batch/single saves, legacy compatibility, fresh flags preservation, partial failure, and JSON 404 handling.');
