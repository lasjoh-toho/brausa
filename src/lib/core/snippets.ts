/**
 * Snippets: excerpts from documents with an anchor that leads back to the
 * source. PDFs anchor by page and rectangles; text documents by quote plus
 * a little context before and after (like the W3C TextQuoteSelector), so the
 * anchor survives small edits of the document.
 */

export interface Snippet {
  quote: string;
  page?: number;
  rects?: { x: number; y: number; w: number; h: number }[];
  prefix?: string;
  suffix?: string;
}

const CONTEXT = 32;

/**
 * Where `quote` occurs in `text`. With several matches the one whose
 * surroundings agree best with prefix/suffix wins; -1 if not found.
 */
export function locateQuote(text: string, quote: string, prefix = '', suffix = ''): number {
  if (!quote) return -1;
  let best = -1;
  let score = -1;
  for (let i = text.indexOf(quote); i >= 0; i = text.indexOf(quote, i + 1)) {
    const before = text.slice(Math.max(0, i - prefix.length), i);
    const after = text.slice(i + quote.length, i + quote.length + suffix.length);
    const s = common(before, prefix, true) + common(after, suffix, false);
    if (s > score) (best = i), (score = s);
  }
  return best;
}

/** Length of the common end (fromEnd) or start of two strings. */
function common(a: string, b: string, fromEnd: boolean): number {
  let n = 0;
  while (n < a.length && n < b.length && (fromEnd ? a[a.length - 1 - n] === b[b.length - 1 - n] : a[n] === b[n])) n++;
  return n;
}

/** Text nodes below `root` with their offsets in the concatenated text. */
function textIndex(root: Node) {
  const nodes: { node: Text; start: number }[] = [];
  let text = '';
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    nodes.push({ node: n as Text, start: text.length });
    text += n.nodeValue ?? '';
  }
  return { nodes, text };
}

/** Anchor for a selection inside a text document. */
export function anchorText(root: HTMLElement, range: Range): Snippet {
  const before = document.createRange();
  before.setStart(root, 0);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  const raw = range.toString();
  const { text } = textIndex(root);
  return {
    quote: raw,
    prefix: text.slice(Math.max(0, start - CONTEXT), start),
    suffix: text.slice(start + raw.length, start + raw.length + CONTEXT)
  };
}

/** The range of a quote anchor inside a rendered text document, or null. */
export function findQuote(root: HTMLElement, s: { quote?: string; prefix?: string; suffix?: string }): Range | null {
  if (!s.quote) return null;
  const { nodes, text } = textIndex(root);
  const at = locateQuote(text, s.quote, s.prefix, s.suffix);
  if (at < 0) return null;
  const pos = (offset: number) => {
    let i = nodes.length - 1;
    while (i > 0 && nodes[i].start > offset) i--;
    return { node: nodes[i].node, offset: offset - nodes[i].start };
  };
  const a = pos(at);
  const b = pos(at + s.quote.length);
  const r = document.createRange();
  r.setStart(a.node, Math.min(a.offset, a.node.length));
  r.setEnd(b.node, Math.min(b.offset, b.node.length));
  return r;
}

const DROP = 'script,style,link,meta,iframe,frame,object,embed,base,form,input,button,select,textarea,noscript';

/**
 * Untrusted HTML → static, readable markup: no scripts, styles, frames,
 * forms or event handlers; links open nothing; relative images go through
 * `resolve` (or are removed).
 */
export function sanitizeHtml(src: string, resolve: (relative: string) => string | null): string {
  const d = new DOMParser().parseFromString(src, 'text/html');
  d.querySelectorAll(DROP).forEach((n) => n.remove());
  for (const el of d.body.querySelectorAll('*')) {
    for (const a of [...el.attributes]) {
      const name = a.name.toLowerCase();
      const v = a.value.trim().toLowerCase();
      if (name.startsWith('on') || name === 'style' || name === 'srcset' || v.startsWith('javascript:') || v.startsWith('data:text'))
        el.removeAttribute(a.name);
    }
    if (el.tagName === 'A') el.removeAttribute('href');
    if (el.tagName === 'IMG') {
      const s = el.getAttribute('src') ?? '';
      const url = /^(https?:|data:image\/)/i.test(s) ? null : s ? resolve(s) : null;
      if (url) el.setAttribute('src', url);
      else el.remove();
    }
  }
  return d.body.innerHTML;
}
