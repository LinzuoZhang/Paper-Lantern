import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../assets/js/lib/auto_highlight.js', import.meta.url), 'utf8');
const { findAutoHighlightRange, normalizeHighlightQuote } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
globalThis.NodeFilter = { SHOW_TEXT: 4 };
globalThis.document = {
  createTreeWalker(nodes) {
    let index = -1;
    return { nextNode() { this.currentNode = nodes[++index]; return Boolean(this.currentNode); } };
  },
  createRange() {
    return { setStart(node, offset) { this.start = [node, offset]; }, setEnd(node, offset) { this.end = [node, offset]; } };
  },
};
const nodes = [{nodeValue: 'Intro. An efﬁ'}, {nodeValue: 'cient method\n'}, {nodeValue: 'works well. End.'}];
const range = findAutoHighlightRange(nodes, 'An efficient method works well.');
assert.deepEqual(range.start, [nodes[0], 7]);
assert.deepEqual(range.end, [nodes[2], 11]);
assert.equal(findAutoHighlightRange(nodes, 'An efficient invented method'), null);
assert.equal(findAutoHighlightRange([{nodeValue: 'important finding important finding'}], 'important finding'), null);
assert.equal(findAutoHighlightRange(null, 'important finding'), null);
assert.equal(normalizeHighlightQuote('ﬁnd\u00adings \n today'), 'findingstoday');

// Run the real reader controller against PDF/DOM/API boundaries.
const reader = await readFile(new URL('../assets/js/pages/reader.js', import.meta.url), 'utf8');
const controller = reader.slice(reader.indexOf('function updateAutoHighlightButton()'), reader.indexOf('function highlightSelection()'));
async function run({ fail = false, switchPaper = false, saveFail = false } = {}) {
  const calls = { saves: 0, renders: 0, statuses: [] };
  const original = { pageNumber: 1, selectedText: 'Already highlighted sentence.', groupId: 'manual' };
  const pdf = { numPages: 2, getPage: async () => ({getTextContent: async () => ({items: [{str: 'Full paper text and original experimental results. '.repeat(3)}]})}) };
  const ctx = vm.createContext({
    currentPdfDocument: pdf, currentPaper: {id: 'paper'}, isPdfLoadingForReadingPosition: false,
    isAutoHighlighting: false, currentPdfTask: 'render', savedHighlights: [original],
    autoHighlightButton: {setAttribute() {}},
    pdfViewer: { querySelector: () => ({querySelector: () => nodes}) },
    normalizeHighlightQuote, findAutoHighlightRange: () => ({}),
    createAnnotationId: () => 'auto', createHighlightsFromRange: (_, extra) => [{pageNumber: 2, ...extra}],
    renderPdfPageInto: async () => {calls.renders++;},
    redrawHighlights() {}, refreshCommentsNavigation() {}, scheduleVisiblePdfRender() {},
    setStatus: message => calls.statuses.push(message),
    readJsonResponse: async response => response.data,
    saveCurrentPaper: async () => {calls.saves++; if (saveFail) throw Error('disk offline');},
    apiFetch: async () => {
      if (fail) throw Error('provider offline');
      if (switchPaper) ctx.currentPaper = {id: 'other'};
      return {ok: true, data: {highlights: [
        {pageNumber: 1, text: original.selectedText},
        {pageNumber: 2, text: 'An important experimental finding.'},
        {pageNumber: 2, text: 'An important experimental finding.'},
      ]}};
    },
  });
  vm.runInContext(controller, ctx);
  await vm.runInContext('autoHighlightPaper()', ctx);
  assert.equal(ctx.isAutoHighlighting, false);
  assert.equal(ctx.autoHighlightButton.disabled, false);
  assert.equal(ctx.savedHighlights[0], original);
  return {ctx, calls};
}
let result = await run();
assert.equal(result.calls.saves, 1);
assert.equal(result.ctx.savedHighlights.length, 2);
assert.equal(result.ctx.savedHighlights[1].source, 'auto-highlight');
assert.equal(result.ctx.savedHighlights[1].color, 'purple');
result = await run({fail: true});
assert.equal(result.calls.saves, 0);
assert.equal(result.ctx.savedHighlights.length, 1);
result = await run({switchPaper: true});
assert.equal(result.calls.saves, 0);
assert.equal(result.ctx.savedHighlights.length, 1);
result = await run({saveFail: true});
assert.equal(result.ctx.savedHighlights.length, 2);
assert.match(result.calls.statuses.at(-1), /disk offline/);
console.log('Automatic highlight matching and reader workflow tests passed.');
