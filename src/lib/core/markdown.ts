/**
 * Small, safe Markdown subset for card text: headings, paragraphs, lists,
 * bold, italic, inline code and http(s) links. Everything is escaped first,
 * so card text can never inject markup. Full TiddlyWiki rendering (wikitext,
 * macros) comes with the TiddlyWiki core, see docs/PLAN-PROJEKTE.md.
 */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

export function renderMarkdown(src: string): string {
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para = [];
  };
  const close = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const line of src.split(/\r?\n/)) {
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const li = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (h) {
      flush();
      close();
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
    } else if (li) {
      flush();
      const kind = /\d/.test(li[1]) ? 'ol' : 'ul';
      if (list !== kind) {
        close();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inline(li[2])}</li>`);
    } else if (!line.trim()) {
      flush();
      close();
    } else {
      close();
      para.push(line);
    }
  }
  flush();
  close();
  return out.join('');
}
