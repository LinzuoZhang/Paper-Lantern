import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const moduleSource = await readFile(new URL('../assets/js/lib/reference_citations.js', import.meta.url), 'utf8');
const { extractReferenceEntries, findReferenceCitations, getReferenceLabel } = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`);

const numbered = extractReferenceEntries(`Introduction (O’Neill et al., 2024). References
[1] Abby O'Neill, Abdul Rehman, and Abhiram Maddukuri. Open X-Embodiment: Robotic learning datasets. In ICRA, 2024.
[2] García, J., and Lee, A. (2024a). A different reference title.
[3] A. Smith, B. Lee. Earlier work with a similar title. 2023.`);
assert.equal(numbered.size, 3);
for (const citation of ["O’Neill et al., 2024", "O'Neill et al., 2024", 'OʼNeill et al. (2024)', 'O’Neill et al.,\n2024']) {
  const matches = findReferenceCitations(`Before (${citation}); after.`, numbered);
  assert.equal(matches.length, 1, citation);
  assert.deepEqual(matches[0].keys, ['1']);
  assert.equal(`Before (${citation}); after.`.slice(matches[0].index, matches[0].index + matches[0].text.length), matches[0].text);
}
assert.deepEqual(findReferenceCitations('García et al., 2024a', numbered)[0].keys, ['2']);
assert.deepEqual(findReferenceCitations('García et al., 2024b; Smith et al., 2024; Missing et al., 2024; O’Neill et al., 20240', numbered), []);
assert.deepEqual(findReferenceCitations('See [1, 2] and [3–1].', numbered).map(match => match.keys), [['1', '2'], ['3', '2', '1']]);

const unnumbered = extractReferenceEntries(`Body (O’Neill et al., 2024; Smith et al., 2023). References
Abby O’Neill, Abdul Rehman, and Abhiram Maddukuri. Open X-Embodiment: Robotic learning datasets. In ICRA, 2024.
A. Smith, B. Lee, and C. Jones. Earlier work with a similar title. 2023.
García, J., and Lee, A. (2024a). A different reference title.
Appendix Extra material (O’Neill et al., 2024).`);
assert.equal(unnumbered.size, 3);
const authorMatches = findReferenceCitations('O’Neill et al., 2024; Smith et al. (2023); García et al., 2024a', unnumbered);
assert.equal(authorMatches.length, 3);
assert.match(unnumbered.get(authorMatches[0].keys[0]), /^Abby O’Neill.*ICRA, 2024\.$/);
assert.match(unnumbered.get(authorMatches[1].keys[0]), /^A\. Smith.*2023\.$/);
assert.equal(getReferenceLabel('1'), '[1]');
assert.equal(getReferenceLabel(authorMatches[0].keys[0]), 'O’Neill · 2024');
assert.equal(extractReferenceEntries('An ordinary paragraph with O’Neill et al., 2024 but no bibliography.').size, 0);
assert.equal(extractReferenceEntries('正文 参考文献 [1] Abby O’Neill, Abdul Rehman. Open X-Embodiment. 2024.').size, 1);

const expanded = extractReferenceEntries(`References
[1] Yann LeCun. A path towards autonomous machine intelligence. 2022.
[2] Richard S Sutton and Andrew G. Barto. An adaptive network that constructs and uses an internal model. 1981.
[3] Sutton, R. S., & Barto, A. G. Reinforcement learning: An introduction. 1998.
[4] Richard Sutton and Jane Smith. Another paper from the same year. 1981.`);
for (const citation of ['LeCun, 2022', 'LeCun (2022)', 'LeCun 2022', 'LeCun，2022', 'LeCun（2022）']) {
  const matches = findReferenceCitations(`See ${citation}.`, expanded);
  assert.equal(matches.length, 1, citation);
  assert.deepEqual(matches[0].keys, ['1']);
  assert.ok(matches[0].text.startsWith('LeCun'));
}
for (const citation of ['Sutton and Barto, 1981', 'Sutton & Barto (1981)', 'Sutton and Barto 1981', 'Sutton and\nBarto, 1981', 'Sutton, Barto, 1981']) {
  const matches = findReferenceCitations(citation, expanded);
  assert.equal(matches.length, 1, citation);
  assert.equal(matches[0].index, 0);
  assert.deepEqual(matches[0].keys, ['2'], 'Both named authors must match, even with the same first author and year');
}
assert.deepEqual(findReferenceCitations('Sutton and Smith, 1981', expanded)[0].keys, ['4']);
assert.deepEqual(findReferenceCitations('Sutton and Missing, 1981; LeCun, 2023; LeCun, 20220', expanded), []);
assert.deepEqual(findReferenceCitations('Sutton and Barto, 1981, 1998', expanded)[0].keys, ['2', '3']);

const expandedUnnumbered = extractReferenceEntries(`Body (LeCun, 2022; Sutton and Barto, 1981, 1998). References
Yann LeCun. A path towards autonomous machine intelligence. 2022.
Richard S Sutton and Andrew G. Barto. An adaptive network that constructs and uses an internal model. 1981.
Richard S Sutton and Andrew G Barto. Reinforcement learning: An introduction, volume 1. MIT Press, 1998.`);
assert.equal(expandedUnnumbered.size, 3, 'Single and two-author entries need no comma after their author names');
const expandedMatches = findReferenceCitations('LeCun, 2022; Sutton and Barto, 1981, 1998', expandedUnnumbered);
assert.equal(expandedMatches.length, 2);
assert.equal(expandedMatches[1].keys.length, 2);
assert.match(expandedUnnumbered.get(expandedMatches[0].keys[0]), /^Yann LeCun\..*2022\.$/);
assert.match(expandedUnnumbered.get(expandedMatches[1].keys[0]), /^Richard S Sutton.*1981\.$/);

// Exercise the reader's real DOM range mapping when a citation crosses PDF.js spans.
const reader = await readFile(new URL('../assets/js/pages/reader.js', import.meta.url), 'utf8');
const context = vm.createContext({
  referenceEntries: numbered, findReferenceCitations, getReferenceLabel,
  NodeFilter: { SHOW_TEXT: 4 }, Node: { TEXT_NODE: 3 },
  document: {
    createTreeWalker(layer) {
      let i = -1;
      return { nextNode() { this.currentNode = layer.nodes[++i]; return Boolean(this.currentNode); } };
    },
    createRange() {
      return { setStart(node, offset) { context.rangeStart = [node, offset]; }, setEnd(node, offset) { context.rangeEnd = [node, offset]; }, getClientRects: () => context.clientRects || [{ left: 10, top: 10, width: 40, height: 12 }], detach() {} };
    },
    createElement: () => ({ dataset: {}, style: {}, setAttribute() {}, addEventListener() {} }),
  },
});
vm.runInContext(reader.slice(reader.indexOf('function collectReferenceText('), reader.indexOf('function refreshReferenceCitations(')), context);
vm.runInContext(reader.slice(reader.indexOf('function getCitationAtPoint('), reader.indexOf('function getTextRangeAtPoint(')), context);
const layer = { nodes: ["See O’Neill", 'et al.', ',', '2024', 'for details.'].map(nodeValue => ({ nodeValue, nodeType: 3 })) };
layer.nodes.forEach(node => { node.parentElement = { closest: () => layer }; });
context.layer = layer;
const cues = [];
context.page = {
  getBoundingClientRect: () => ({ left: 0, top: 0 }),
  querySelectorAll: () => cues.slice(),
  appendChild(button) {
    context.button = button;
    button.remove = () => { cues.splice(cues.indexOf(button), 1); };
    cues.push(button);
  },
};
context.getTextRangeAtPoint = () => ({ startContainer: layer.nodes[1], startOffset: 2 });
vm.runInContext('decorateReferenceCitations(page, layer)', context);
assert.equal(context.button.dataset.references, '1');
assert.equal(context.rangeStart[0], layer.nodes[0]);
assert.equal(context.rangeStart[1], 4);
assert.equal(context.rangeEnd[0], layer.nodes[3]);
assert.equal(context.rangeEnd[1], 4);
assert.deepEqual(context.getCitationAtPoint(0, 0), ['1']);
context.referenceEntries = expanded;
const pairLayer = { nodes: ['See Sutton', 'and', 'Barto,', '1981.'].map(nodeValue => ({ nodeValue, nodeType: 3 })) };
pairLayer.nodes.forEach(node => { node.parentElement = { closest: () => pairLayer }; });
context.layer = pairLayer;
context.getTextRangeAtPoint = () => ({ startContainer: pairLayer.nodes[2], startOffset: 2 });
vm.runInContext('decorateReferenceCitations(page, layer)', context);
assert.equal(context.button.dataset.references, '2');
assert.equal(context.rangeStart[0], pairLayer.nodes[0]);
assert.equal(context.rangeStart[1], 4);
assert.equal(context.rangeEnd[0], pairLayer.nodes[3]);
assert.equal(context.rangeEnd[1], 4);
assert.deepEqual(context.getCitationAtPoint(0, 0), ['2']);

// A range crossing PDF spans returns overlapping element and text rectangles.
// Adjacent fragments on one line get one cue; wrapped lines and columns stay separate.
context.clientRects = [
  { left: 10, top: 10, width: 80, height: 14 },
  { left: 10, top: 11, width: 25, height: 12 },
  { left: 10, top: 11, width: 25, height: 12 },
  { left: 38, top: 11, width: 52, height: 12 },
  { left: 10, top: 30, width: 22, height: 14 },
  { left: 10, top: 31, width: 22, height: 12 },
  { left: 200, top: 30, width: 30, height: 14 },
  { left: 0, top: 0, width: 0, height: 12 },
];
vm.runInContext('decorateReferenceCitations(page, layer)', context);
assert.equal(cues.length, 3, 'Nested range rectangles must not produce stacked highlights');
assert.deepEqual(cues.map(cue => [cue.style.left, cue.style.top, cue.style.width, cue.style.height]), [
  ['10px', '10px', '80px', '14px'],
  ['10px', '30px', '22px', '14px'],
  ['200px', '30px', '30px', '14px'],
]);
vm.runInContext('decorateReferenceCitations(page, layer)', context);
assert.equal(cues.length, 3, 'Decorating the same page again replaces its existing cues');
context.clientRects = [
  { left: 10, top: 10, width: 20, height: 14 },
  { left: 34, top: 10, width: 20, height: 14 },
];
vm.runInContext('decorateReferenceCitations(page, layer)', context);
assert.equal(cues.length, 1, 'Adjacent text fragments on the same line form one highlight');
assert.equal(cues[0].style.width, '44px');
context.referenceEntries = new Map();
vm.runInContext('decorateReferenceCitations(page, layer)', context);
assert.equal(cues.length, 0, 'Clearing references removes stale cues');
console.log('Reference citations passed: author/year forms, bibliographies, split PDF spans, merged highlight rectangles, and repeated decoration.');
