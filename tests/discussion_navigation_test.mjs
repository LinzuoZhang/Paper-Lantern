import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Execute reader callbacks and navigation with spies, without loading a PDF or AI service.
const source = await readFile(new URL('../assets/js/pages/reader.js', import.meta.url), 'utf8');
const callbacks = source.slice(source.indexOf('  onActivate: () => {'), source.indexOf('  contextType: "paper",'));
const navigation = source.slice(source.indexOf('function openActiveDiscussionReference() {'), source.indexOf('function retryApplyReferenceHighlight('));
let reference = null;
const calls = [];
let completeJump;
const context = vm.createContext({
  console,
  getActiveDiscussionReference: () => reference,
  setActiveReaderTab: tab => calls.push(['tab', tab]),
  setSummaryPaneCollapsed: (collapsed, refresh) => calls.push(['pane', collapsed, refresh]),
  clearDiscussionReferenceHighlights: () => calls.push(['clear']),
  retryApplyReferenceHighlight: () => calls.push(['highlight']),
  scrollWithAiPanelToBottom() {},
  jumpToPdfPageAsync: async (page, behavior) => {
    calls.push(['jump', page, behavior]);
    if (completeJump) await completeJump;
  },
  pdfViewer: { querySelector: selector => {
    calls.push(['page', selector]);
    return { querySelector: () => ({ scrollIntoView: options => calls.push(['scroll', options]) }) };
  } },
  saveReadingPositionNow: () => calls.push(['savePosition']),
});
vm.runInContext(`${navigation}\nglobalThis.callbacks = ({${callbacks}});`, context);

context.callbacks.onActivate();
context.callbacks.onReferenceChange(null);
assert.deepEqual(calls, [['tab', 'withAiTab'], ['pane', false, false], ['clear']]);

calls.length = 0;
reference = { text: '引用', page: 3, ranges: [{ pageNumber: 3, top: 0.6 }] };
context.callbacks.onReferenceChange(reference);
for (let tick = 0; tick < 5; tick++) await Promise.resolve();
assert.ok(calls.some(call => call[0] === 'jump' && call[1] === 3));
assert.ok(calls.some(call => call[0] === 'scroll' && call[1].block === 'center'));
assert.ok(calls.some(call => call[0] === 'savePosition'));

// Changing to a discussion without a reference cancels late selection scrolling.
calls.length = 0;
let resolveJump;
completeJump = new Promise(resolve => { resolveJump = resolve; });
context.callbacks.onReferenceChange(reference);
reference = null;
context.callbacks.onReferenceChange(null);
resolveJump();
for (let tick = 0; tick < 5; tick++) await Promise.resolve();
assert.ok(!calls.some(call => call[0] === 'scroll' || call[0] === 'highlight'));
console.log('Discussion navigation tests passed (reference, no reference, and rapid switching).');
