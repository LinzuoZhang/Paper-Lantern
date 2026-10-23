import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../assets/js/components/notes_panel.js', import.meta.url), 'utf8');
const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const classify = module.getExternalNoteLink;
for (const url of [
  'https://arxiv.org/abs/2401.12345v2',
  'https://arxiv.org/pdf/hep-th/9901001.pdf',
  'https://example.org/PAPER.PDF?download=1#page=2',
]) assert.equal(classify(url).importable, true, url);
assert.equal(classify('https://arxiv.org/html/2401.12345').url, 'https://arxiv.org/abs/2401.12345');
assert.equal(classify('https://example.org/article').importable, false);
assert.equal(classify('https://arxiv.org.evil.test/abs/2401.12345').importable, false);
for (const url of ['javascript:alert(1)', 'file:///paper.pdf', 'hash:paper', '/local.pdf']) {
  assert.equal(classify(url), null);
}

const importer = source.slice(source.indexOf('  async function importExternalPaper'), source.indexOf('  function showExternalLinkPopover'));
const calls = [];
const events = [];
let jobs;
const context = vm.createContext({
  URLSearchParams,
  CustomEvent: class { constructor(type) { this.type = type; } },
  window: { setTimeout: fn => fn(), dispatchEvent: event => events.push(event.type) },
  apiFetch: async (url, options) => {
    calls.push([url, options]);
    return { ok: true, json: async () => ({ job: jobs.shift() }) };
  },
});
vm.runInContext(`${importer}\nglobalThis.run = importExternalPaper;`, context);
jobs = [{ jobId: 'j1', state: 'running', stage: 'downloading' }, { jobId: 'j1', state: 'completed', paperId: 'p1' }];
const progress = [];
assert.equal((await context.run('https://example.org/p.pdf', value => progress.push(value))).paperId, 'p1');
assert.equal(JSON.parse(calls[0][1].body).url, 'https://example.org/p.pdf');
assert.match(calls[1][0], /status\?jobId=j1/);
assert.equal(progress.length, 1);
assert.deepEqual(events, ['paper-lantern-library-updated']);
jobs = [{ jobId: 'j2', state: 'failed', error: 'download failed' }];
await assert.rejects(context.run('https://example.org/p.pdf', () => {}), /download failed/);
assert.equal(events.length, 1);
console.log('Notes external link classification and import tests passed.');
