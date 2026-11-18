import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const component = await readFile(new URL('../assets/js/components/paper_analysis_progress.js', import.meta.url), 'utf8');
const { createPaperAnalysisProgress } = await import(`data:text/javascript;base64,${Buffer.from(component).toString('base64')}`);
class Element {
  children = [];
  attributes = {};
  hidden = false;
  ownerDocument = { createElement: tag => new Element(tag) };
  constructor(tag = 'div') { this.tagName = tag; }
  get textContent() { return this.children.map(child => typeof child === 'string' ? child : child.textContent).join(''); }
  set textContent(text) { this.children = [String(text)]; }
  append(...children) { children.forEach(child => { child.parent = this; this.children.push(child); }); }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(key, value) { this.attributes[key] = value; }
  get firstElementChild() { return this.children.find(child => child instanceof Element); }
  remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); }
}

const source = await readFile(new URL('../assets/js/pages/reader.js', import.meta.url), 'utf8');
const requests = [], saved = [], statuses = [];
const old = {
  paperTitle: 'Existing', keywords: ['old keyword'], keywordExplanations: { 'old keyword': 'original explanation' },
  threeLineSummary: { challenges: 'old challenge', method: 'old method', conclusion: 'old conclusion' },
  methodOverview: 'old overview', methodSections: [{ title: 'old breakdown', motivation: '', content: 'old mechanism' }],
  methodConclusion: 'old synthesis', basicInfo: { authors: ['old author'] },
};
const generated = {
  keywords: ['attention'], keywordExplanations: { attention: '注意力机制' },
  threeLineSummary: { challenges: '挑战', method: '方法', conclusion: '结论' },
  methodOverview: '机制概览', methodSections: [{ title: '生成的方法', content: '机制解释' }],
  methodConclusion: '各步骤相互衔接', paperTitle: 'Original Title', basicInfo: { authors: ['New Author'] },
};
const progress = {
  source: 'agent', phase: '分析方法结构', completed: '已定位上下文聚合的原文说明。', next: '解释信息流并校验格式。',
  detail: '分析方法结构', round: 2, maxRounds: 24, roundsRemaining: 22,
};
const nodes = Object.fromEntries(['keywords', 'challenges', 'method', 'conclusion', 'methodSections',
  'threeLineSummary', 'threeLineProgress', 'basicInfoProgress', 'basicInfoTitle'].map(name => [name, new Element()]));
let scenario = {};
let cancellations = 0, releases = 0;
function stream(events, onRead = () => {}) {
  let index = 0;
  return { ok: true, headers: { get: () => 'text/event-stream' }, body: { getReader: () => ({
    async read() {
      onRead(index);
      if (index >= events.length) return { done: true };
      const event = events[index++];
      return { value: new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`), done: false };
    },
    async cancel() { cancellations++; }, releaseLock() { releases++; },
  }) } };
}
const context = vm.createContext({
  ...nodes, createPaperAnalysisProgress, TextDecoder, Uint8Array,
  currentPaper: { id: 'paper', title: old.paperTitle, ...structuredClone(old) }, lastExtractedText: 'paper text '.repeat(20),
  getSummarySectionRefreshButton: () => null,
  clearStatus() {}, setStatus: value => statuses.push(value),
  queueWithAiScrollBottomButtonUpdate() {},
  renderKeywords(items) { nodes.keywords.textContent = items.join(' '); },
  renderSummaryLine(node, text) { node.textContent = text || ''; },
  renderMethodSections(sections) { nodes.methodSections.textContent = JSON.stringify(sections); },
  renderSummary(summary) {
    nodes.keywords.textContent = summary.keywords?.join(' ') || '';
    nodes.methodSections.textContent = JSON.stringify(summary.methodSections || []);
    for (const key of ['challenges', 'method', 'conclusion']) nodes[key].textContent = summary.threeLineSummary?.[key] || '';
  },
  renderBasicInfoLoading() { nodes.basicInfoTitle.textContent = ''; },
  renderBasicInfo(info) { nodes.basicInfoTitle.textContent = info.authors?.join(' ') || ''; },
  setReaderPaperTitle() {}, formatBasicInfoValue: text => text || '',
  console: { error() {} },
  paperToSummary: paper => structuredClone(paper),
  saveCurrentPaper: async value => {
    saved.push(value);
    context.currentPaper = { ...context.currentPaper, ...value.summary };
  },
  apiFetch: async (url, options) => {
    requests.push({ url, payload: JSON.parse(options.body) });
    scenario.onRequest?.();
    const count = saved.length;
    return stream(scenario.events || [{ stage: 'agent_progress', summary: progress }, { stage: 'complete', summary: generated }], index => {
      if (index === 1) {
        assert.equal(saved.length, count, 'Work summaries must never persist analysis drafts');
        scenario.onProgress?.();
      }
      scenario.onRead?.(index);
    });
  },
});
vm.runInContext(
  source.slice(source.indexOf('async function summarizeText('), source.indexOf('function getSummarySectionRefreshButton(')) +
  source.slice(source.indexOf('function setSummarySectionLoading('), source.indexOf('async function getPdfMetadataTitle(')), context,
);
function reset() {
  context.currentPaper = { id: 'paper', title: old.paperTitle, ...structuredClone(old) };
  context.renderSummary(old);
  nodes.basicInfoTitle.textContent = 'old author';
  nodes.threeLineSummary.hidden = false;
  scenario = {};
}
for (const [section, goal] of [['keywords', 'keywords'], ['threeLine', 'threeLine'], ['method', 'method']]) {
  reset();
  const target = section === 'keywords' ? nodes.keywords : section === 'method' ? nodes.methodSections : nodes.threeLineProgress;
  scenario = {
    onRequest() {
      assert.ok(target.textContent.includes('解析进度'), 'Loading must replace the old content before requesting');
      assert.ok(!target.textContent.includes('old'));
      if (section !== 'method') assert.ok(nodes.methodSections.textContent.includes('old breakdown'));
      if (section === 'threeLine') {
        assert.equal(nodes.challenges.textContent, '');
        assert.equal(nodes.threeLineSummary.hidden, true);
      }
    },
    onProgress() {
      assert.ok(target.textContent.includes(progress.completed));
      assert.ok(target.textContent.includes('剩余 22 轮'));
    },
  };
  await vm.runInContext(`regenerateSummarySection('${section}')`, context);
  assert.equal(requests.at(-1).url, '/api/summarize');
  assert.deepEqual(requests.at(-1).payload.goals, [goal]);
  assert.equal(requests.at(-1).payload.stream, true);
  assert.ok(!target.textContent.includes('解析进度') || target.hidden);
}
assert.equal(saved[0].summary.methodSections[0].title, 'old breakdown');
assert.equal(saved[2].summary.methodSections[0].title, '生成的方法');
assert.equal(nodes.threeLineSummary.hidden, false);

reset();
scenario = { onProgress() {
  for (const target of [nodes.keywords, nodes.methodSections, nodes.threeLineProgress, nodes.basicInfoProgress]) {
    assert.ok(target.textContent.includes(progress.completed));
  }
} };
await vm.runInContext('summarizeText("paper")', context);
assert.equal(saved.at(-1).summary.paperTitle, generated.paperTitle);

reset();
scenario = { onRequest() { assert.equal(nodes.basicInfoTitle.textContent, ''); },
  onProgress() { assert.ok(nodes.basicInfoProgress.textContent.includes(progress.completed)); } };
await vm.runInContext('refreshOverviewInfo("paper")', context);
assert.deepEqual(requests.at(-1).payload.goals, ['metadata']);
assert.equal(saved.at(-1).summary.keywords[0], 'old keyword');
assert.equal(nodes.basicInfoProgress.hidden, true);

reset();
const beforeFailure = saved.length;
scenario = { events: [{ stage: 'agent_progress', summary: progress }] };
await vm.runInContext('regenerateSummarySection("method")', context);
assert.equal(saved.length, beforeFailure);
assert.ok(nodes.methodSections.textContent.includes('old breakdown'), 'Failed regeneration restores the saved section');
assert.match(statuses.at(-1), /ended early/);
assert.equal(cancellations, 1);

reset();
const beforeNavigation = saved.length;
scenario = { onProgress() {
  context.currentPaper = { id: 'another-paper' };
  nodes.methodSections.textContent = 'another paper';
} };
await vm.runInContext('regenerateSummarySection("method")', context);
assert.equal(saved.length, beforeNavigation);
assert.equal(nodes.methodSections.textContent, 'another paper');
assert.equal(releases, 7);
vm.runInContext('clearAnalysisProgress()', context);
assert.equal(nodes.threeLineSummary.hidden, false);
assert.equal(nodes.threeLineProgress.hidden, true);
assert.equal(nodes.basicInfoProgress.hidden, true);

// Decode split UTF-8 and CRLF boundaries, including a final event without a blank line.
const fragmented = new TextEncoder().encode('data: {"stage":"agent_progress","summary":{"detail":"读取原文"}}\r\n\r\ndata: {"stage":"complete","summary":{"keywords":["中文关键词"]}}');
context.apiFetch = async () => ({ ok: true, headers: { get: () => 'text/event-stream' }, body: { getReader: () => {
  let index = 0;
  return {
    async read() { return index < fragmented.length ? { value: fragmented.slice(index, ++index), done: false } : { done: true }; },
    async cancel() {}, releaseLock() {},
  };
} } });
const decoded = await vm.runInContext('fetchFullSummary("paper", ["keywords"])', context);
assert.equal(decoded.keywords[0], '中文关键词');

context.apiFetch = async () => stream([{ stage: 'error', summary: { detail: '格式修正失败' } }]);
await assert.rejects(vm.runInContext('fetchFullSummary("paper")', context), /格式修正失败/);

const safeTarget = new Element();
const view = createPaperAnalysisProgress(safeTarget);
view.update({ source: 'runtime', detail: '正在读取原文', reasoning_content: 'private reasoning' });
assert.ok(!safeTarget.textContent.includes('private reasoning'));
const untrusted = { ...progress, completed: '<img src=x onerror=alert(1)>' };
view.update(untrusted);
view.update(untrusted);
const history = safeTarget.firstElementChild.children[2];
assert.equal(history.children.length, 1);
assert.equal(history.firstElementChild.children[1].textContent, untrusted.completed);
for (let index = 0; index < 10; index++) view.update({ ...progress, phase: `阶段 ${index}` });
assert.equal(history.children.length, 6);
assert.ok(history.textContent.includes('阶段 9'));
console.log('Paper analysis passed: scoped clearing, live public summaries, budgets, safe text, persistence, failure recovery, and navigation.');
