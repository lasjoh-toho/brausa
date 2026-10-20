/**
 * Text search in documents shown by brausa: find every occurrence of a
 * query in the text of an element (across the text nodes it is split into,
 * as in a PDF text layer) and return DOM ranges for highlighting.
 */

/** Start offsets of `q` in `text`, ignoring case (and nothing for an empty query). */
export function findAll(text: string, q: string): number[] {
  const needle = q.trim().toLocaleLowerCase();
  if (!needle) return [];
  const hay = text.toLocaleLowerCase();
  const out: number[] = [];
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) out.push(i);
  return out;
}

/** Ranges of every occurrence of `q` in the text below `root`, in document order. */
export function matchRanges(root: Node, q: string): Range[] {
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    nodes.push(n);
    starts.push(text.length);
    text += n.data;
  }
  const len = q.trim().length;
  const at = (offset: number, end: boolean): [Text, number] => {
    // The node holding `offset` (an end offset belongs to the node before).
    let i = 0;
    while (i + 1 < nodes.length && (end ? starts[i + 1] < offset : starts[i + 1] <= offset)) i++;
    return [nodes[i], offset - starts[i]];
  };
  return findAll(text, q).map((s) => {
    const r = document.createRange();
    const [a, ao] = at(s, false);
    const [b, bo] = at(s + len, true);
    r.setStart(a, ao);
    r.setEnd(b, bo);
    return r;
  });
}
