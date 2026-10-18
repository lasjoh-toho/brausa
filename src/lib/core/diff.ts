/** Line diff (longest common subsequence) for comparing tiddler versions. */

export interface DiffLine {
  op: 'same' | 'add' | 'del';
  text: string;
}

/** Lines of `a` → lines of `b`: kept lines, deleted lines of `a`, added lines of `b`. */
export function lineDiff(a: string, b: string): DiffLine[] {
  const x = a.split('\n');
  const y = b.split('\n');
  // Common prefix and suffix keep the table small for long, mostly equal texts.
  let start = 0;
  while (start < x.length && start < y.length && x[start] === y[start]) start++;
  let endX = x.length;
  let endY = y.length;
  while (endX > start && endY > start && x[endX - 1] === y[endY - 1]) endX--, endY--;
  const xs = x.slice(start, endX);
  const ys = y.slice(start, endY);
  const n = xs.length;
  const m = ys.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) lcs[i][j] = xs[i] === ys[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: DiffLine[] = x.slice(0, start).map((text) => ({ op: 'same', text }));
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (xs[i] === ys[j]) out.push({ op: 'same', text: xs[i++] }), j++;
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ op: 'del', text: xs[i++] });
    else out.push({ op: 'add', text: ys[j++] });
  }
  while (i < n) out.push({ op: 'del', text: xs[i++] });
  while (j < m) out.push({ op: 'add', text: ys[j++] });
  for (const text of x.slice(endX)) out.push({ op: 'same', text });
  return out;
}

/** Fields (other than text and dates) whose values differ, for the overlay tool. */
export function changedFields(a: Record<string, string>, b: Record<string, string>): string[] {
  const skip = new Set(['text', 'created', 'modified', 'creator', 'modifier']);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !skip.has(k) && a[k] !== b[k]).sort();
}
