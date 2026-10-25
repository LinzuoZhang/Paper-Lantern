// Ignore PDF spacing and ligature differences, but require contiguous original text.
export function normalizeHighlightQuote(text) {
  return String(text || "").normalize("NFKC").replace(/[\s\u00ad]+/gu, "");
}

export function findAutoHighlightRange(layer, quote) {
  if (!layer) return null;
  const wanted = normalizeHighlightQuote(quote);
  if (!wanted) return null;
  const positions = [];
  let text = "";
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    let offset = 0;
    for (const character of node.nodeValue || "") {
      const normalized = normalizeHighlightQuote(character);
      text += normalized;
      for (let index = 0; index < normalized.length; index += 1) {
        positions.push({ node, start: offset, end: offset + character.length });
      }
      offset += character.length;
    }
  }
  const start = text.indexOf(wanted);
  // A repeated quote has no unique anchor; avoid silently marking the wrong occurrence.
  if (start < 0 || text.indexOf(wanted, start + 1) >= 0) return null;
  const first = positions[start];
  const last = positions[start + wanted.length - 1];
  const range = document.createRange();
  range.setStart(first.node, first.start);
  range.setEnd(last.node, last.end);
  return range;
}
