import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../extension/api.js', import.meta.url), 'utf8');
const api = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
globalThis.chrome = { storage: { local: { get: async () => ({ apiBase: 'http://localhost:8000' }) } } };
const originalTimeout = globalThis.setTimeout;
globalThis.setTimeout = (callback) => originalTimeout(callback, 0);

async function run(responses, expectedPaths) {
  const paths = [];
  globalThis.fetch = async (url) => {
    paths.push(new URL(url).pathname);
    assert.ok(responses.length, 'Unexpected request');
    const { body, status = 200 } = responses.shift();
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    return await api.importRemotePdf('https://example.com/paper.pdf');
  } finally {
    assert.deepEqual(paths, expectedPaths);
    assert.equal(responses.length, 0);
  }
}

const start = '/api/library/remote-pdf';
const status = '/api/library/import/status';
const paper = { id: 'paper-1', title: 'Test paper' };
assert.deepEqual((await run([
  { status: 202, body: { job: { jobId: 'job-1', state: 'downloading' } } },
  { body: { job: { jobId: 'job-1', state: 'writing_library' } } },
  { body: { job: { jobId: 'job-1', state: 'completed', paperId: paper.id } } },
  { body: { paper } },
], [start, status, status, '/api/library/paper'])).data.paper, paper);
assert.deepEqual((await run([{ body: { paper } }], [start])).data.paper, paper);
assert.deepEqual((await run([
  { body: { job: { jobId: 'job-1', state: 'completed', paperId: paper.id } } },
  { body: { paper } },
], [start, '/api/library/paper'])).data.paper, paper);
for (const state of ['failed', 'cancelled']) {
  await assert.rejects(run([
    { status: 202, body: { job: { jobId: 'job-1', state: 'downloading' } } },
    { body: { job: { jobId: 'job-1', state, error: 'Import stopped' } } },
  ], [start, status]), /Import stopped/);
}
await assert.rejects(run([{ body: {} }], [start]), /未返回论文或任务/);
await assert.rejects(run([
  { status: 202, body: { job: { jobId: 'job-1', state: 'downloading' } } },
  { status: 404, body: { error: 'Job not found' } },
], [start, status]), /Job not found/);
console.log('Extension import tests passed');
