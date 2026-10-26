import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const katex = require('../vendor/katex/katex.min.js');
const markdown = require('../vendor/markdown-it/markdown-it.min.js')({ html: false });
const source = await readFile(new URL('../assets/js/pages/reader.js', import.meta.url), 'utf8');
class Element {
  children = [];
  textContent = '';
  replaceChildren(...children) { this.children = children; }
  set innerHTML(html) {
    this.html = html;
    this.children = [];
    this.content = { childNodes: [{ html }] };
  }
}
const challenges = new Element();
const method = new Element();
const conclusion = new Element();
const context = vm.createContext({
  document: { createElement: () => new Element(), createTextNode: text => ({ textContent: text }) },
  window: { katex: { render: (formula, node, options) => { node.formula = formula; node.innerHTML = katex.renderToString(formula, options); } } },
  getDiscussionMarkdownRenderer: () => markdown,
  challenges, method, conclusion, keywords: new Element(), methodSections: new Element(),
  renderKeywords() {}, renderMethodSections() {}, queueWithAiScrollBottomButtonUpdate() {},
});
vm.runInContext(
  source.slice(source.indexOf('function renderSummaryLine('), source.indexOf('function renderKeywords(')) +
  source.slice(source.indexOf('function formatInlineTechnicalText('), source.indexOf('function setBusy(')), context,
);
context.summary = { threeLineSummary: {
  challenges: '预测噪声 $t$ 与步长 $d$。',
  method: '训练在 $d=0$ 匹配，并用 $2d$ 自举；目标为 \\(x_{t+d}\\)。',
  conclusion: '单步生成，提升 16%。<img src=x onerror=alert(1)>',
} };
vm.runInContext('renderSummary(summary)', context);
assert.deepEqual(challenges.children.filter(node => node.formula).map(node => node.formula), ['t', 'd']);
assert.deepEqual(method.children.filter(node => node.formula).map(node => node.formula), ['d=0', '2d', 'x_{t+d}']);
for (const node of [...challenges.children, ...method.children].filter(node => node.formula)) {
  assert.match(node.html, /class="katex"/);
  assert.doesNotMatch(node.html, /katex-error/);
}
assert.match(conclusion.children[0].html, /16%/);
assert.match(conclusion.children[0].html, /&lt;img/);
context.summary = { threeLineSummary: { method: '刷新后的 $d$' } };
vm.runInContext('renderSummary(summary)', context);
assert.deepEqual(method.children.filter(node => node.formula).map(node => node.formula), ['d']);
assert.equal(challenges.children[0].html, 'No response');
assert.equal(conclusion.children[0].html, 'No response');
context.window.katex = null;
vm.runInContext('renderSummary(summary)', context);
assert.equal(method.children.find(node => node.className === 'formula-inline').textContent, '$d$');
console.log('Three-line summary math passed: formulas, prose, escaping, replacement, missing values, and KaTeX fallback.');

// Drive the actual SSE consumer and inspect the UI before method breakdown arrives.
context.window.katex = { render: (formula, node, options) => {
  node.formula = formula;
  node.innerHTML = katex.renderToString(formula, options);
} };
const earlySummary = { threeLineSummary: {
  challenges: '早期挑战', method: '早期方法 $d$', conclusion: '早期结论',
} };
let reads = 0;
const saved = [];
Object.assign(context, {
  currentPaper: { id: 'paper' }, TextDecoder, Uint8Array,
  paperToSummary: () => ({ threeLineSummary: { method: '旧方法' } }),
  renderBasicInfo() {}, setReaderPaperTitle() {}, clearStatus() {},
  saveCurrentPaper: async ({ summary }) => saved.push(summary),
  apiFetch: async () => ({ ok: true, headers: { get: () => 'text/event-stream' }, body: { getReader: () => ({
    async read() {
      if (reads++ === 0) return { value: new TextEncoder().encode(`data: ${JSON.stringify({ stage: 'overview', summary: earlySummary })}\n\n`), done: false };
      if (reads === 2) {
        assert.match(challenges.children[0].html, /早期挑战/);
        assert.match(method.children[0].html, /早期方法/);
        assert.equal(method.children.find(node => node.formula)?.formula, 'd');
        assert.match(conclusion.children[0].html, /早期结论/);
        assert.equal(saved[0].threeLineSummary.method, earlySummary.threeLineSummary.method);
        return { value: new TextEncoder().encode(`data: ${JSON.stringify({ stage: 'complete', summary: earlySummary })}\n\n`), done: false };
      }
      return { done: true };
    },
  }) } }),
});
vm.runInContext(source.slice(source.indexOf('async function summarizeText('), source.indexOf('async function regenerateSummarySection(')), context);
await vm.runInContext('summarizeText("paper")', context);
console.log('Overview streaming passed: challenge, method, and conclusion render and persist before breakdown.');
