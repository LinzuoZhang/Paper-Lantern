import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Import only the pure text anchor logic; browser integration is checked with
// the real editor separately, without changing its contenteditable DOM.
const source = await readFile(new URL('../assets/js/components/note_annotations.js', import.meta.url), 'utf8');
const { findNoteAnchor } = await import(`data:text/javascript;base64,${Buffer.from(source.replace(/^import .*;\r?\n/, '')).toString('base64')}`);

const text = '第一节：梯度下降用于优化。第二节：梯度下降需要学习率。';
const start = text.lastIndexOf('梯度下降');
const anchor = { quote: '梯度下降', start, before: '第二节：', after: '需要学习率。' };
assert.equal(findNoteAnchor(text, anchor), start);
assert.equal(findNoteAnchor('新增内容。' + text, anchor), start + '新增内容。'.length);
assert.equal(findNoteAnchor('梯度下降用于优化。正文。梯度下降需要学习率。', { ...anchor, before: '' }), '梯度下降用于优化。正文。'.length);
assert.equal(findNoteAnchor('已删除相关段落', anchor), -1);
assert.equal(findNoteAnchor('梯度下降。梯度下降。', { quote: '梯度下降', start: 100, before: '不存在', after: '不存在' }), -1);
assert.equal(findNoteAnchor('唯一的公式 $x^2$', { quote: '$x^2$', start: 100 }), 6);
assert.equal(findNoteAnchor(text, null), -1);
console.log('Note annotation anchor tests passed.');
