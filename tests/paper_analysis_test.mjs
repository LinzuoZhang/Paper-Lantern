import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../assets/js/pages/reader.js', import.meta.url), 'utf8');
const requests = [];
const saved = [];
const context = vm.createContext({
  currentPaper: { id: 'paper' }, lastExtractedText: 'paper text '.repeat(20),
  getSummarySectionRefreshButton: () => null,
  clearStatus() {}, setStatus() {}, setSummarySectionLoading() {},
  renderKeywords() {}, renderSummaryLine() {}, renderMethodSections() {}, renderSummary() {},
  challenges: {}, method: {}, conclusion: {}, console,
  paperToSummary: () => ({ paperTitle: 'Existing', methodSections: [{ title: 'Keep this section' }] }),
  saveCurrentPaper: async value => saved.push(value),
  apiFetch: async (url, options) => {
    requests.push({ url, payload: JSON.parse(options.body) });
    return { ok: true };
  },
  readJsonResponse: async () => ({ summary: {
    keywords: ['attention'], keywordExplanations: { attention: '注意力机制' },
    threeLineSummary: { challenges: '挑战', method: '方法', conclusion: '结论' },
    methodOverview: '机制概览', methodSections: [{ title: '生成的方法', content: '机制解释' }],
    methodConclusion: '各步骤相互衔接',
  } }),
});
vm.runInContext(
  source.slice(source.indexOf('async function regenerateSummarySection('), source.indexOf('function getSummarySectionRefreshButton(')) +
  source.slice(source.indexOf('async function fetchFullSummary('), source.indexOf('async function fetchOverviewInfo(')), context,
);
for (const [section, goal] of [['keywords', 'keywords'], ['threeLine', 'threeLine'], ['method', 'method']]) {
  await vm.runInContext(`regenerateSummarySection('${section}')`, context);
  assert.equal(requests.at(-1).url, '/api/summarize');
  assert.deepEqual(requests.at(-1).payload.goals, [goal]);
  assert.ok(requests.at(-1).payload.goal);
}
assert.equal(saved[0].summary.methodSections[0].title, 'Keep this section');
assert.equal(saved[2].summary.methodSections[0].title, '生成的方法');

context.readJsonResponse = async () => {
  context.currentPaper = { id: 'another-paper' };
  return { summary: { keywords: ['stale result'] } };
};
const count = saved.length;
await vm.runInContext('regenerateSummarySection("keywords")', context);
assert.equal(saved.length, count, 'Results must not be saved to a different paper after navigation');
console.log('Goal-based regeneration passed: scoped requests, merged persistence, and navigation guard.');

// Progress carries no draft result and must never trigger persistence.
const statuses = [];
context.currentPaper = { id: 'paper' };
context.TextDecoder = TextDecoder;
context.Uint8Array = Uint8Array;
context.setStatus = value => statuses.push(value);
context.renderBasicInfo = () => {};
let reads = 0;
const beforeStream = saved.length;
context.apiFetch = async () => ({
  ok: true, headers: { get: () => 'text/event-stream' },
  body: { getReader: () => ({ read: async () => {
    if (reads++ === 0) return { value: new TextEncoder().encode('data: {"stage":"agent_progress","summary":{"detail":"正在检查格式"}}\n\n'), done: false };
    if (reads === 2) {
      assert.equal(saved.length, beforeStream);
      return { value: new TextEncoder().encode('data: {"stage":"complete","summary":{"keywords":["validated"]}}\n\n'), done: false };
    }
    return { done: true };
  } }) },
});
vm.runInContext(source.slice(source.indexOf('async function summarizeText('), source.indexOf('async function regenerateSummarySection(')), context);
await vm.runInContext('summarizeText("paper")', context);
assert.deepEqual(statuses, ['正在检查格式']);
assert.equal(saved.length, beforeStream + 1);
assert.equal(saved.at(-1).summary.keywords[0], 'validated');
console.log('Agent progress passed: status updates without persisting drafts, then one validated result.');
