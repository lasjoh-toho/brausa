// brausa: dragging marked text, a picture or a link out of the web panel.
// The page cannot talk to brausa; it keeps the drag in window.__brausaDrag
// and brausa reads it while the mouse button is down.
(() => {
  if (window.__brausaDragInit) return;
  window.__brausaDragInit = true;
  let st = null;
  const pick = (t) => {
    const el = t && t.nodeType === 1 ? t : t && t.parentElement;
    const img = el && el.closest('img');
    const a = el && el.closest('a[href]');
    const sel = getSelection();
    const text = String(sel).trim();
    if (img && (img.currentSrc || img.src)) return { kind: 'image', src: img.currentSrc || img.src, alt: img.alt || '', href: a ? a.href : '' };
    if (text) {
      let html = '';
      try {
        const d = document.createElement('div');
        d.appendChild(sel.getRangeAt(0).cloneContents());
        html = d.innerHTML;
      } catch (_) {}
      return { kind: 'text', text, html };
    }
    if (a) return { kind: 'link', href: a.href, text: (a.textContent || '').trim() };
    return null;
  };
  addEventListener('dragstart', (e) => {
    const p = pick(e.target);
    if (!p || window.top !== window) return;
    e.preventDefault();
    st = Object.assign(p, { url: location.href, title: document.title, x: e.clientX, y: e.clientY, down: true, id: Date.now() });
    window.__brausaDrag = st;
  }, true);
  addEventListener('mousemove', (e) => {
    if (st && st.down) { st.x = e.clientX; st.y = e.clientY; }
  }, true);
  addEventListener('mouseup', (e) => {
    if (st && st.down) { st.x = e.clientX; st.y = e.clientY; st.down = false; }
  }, true);
  addEventListener('keydown', (e) => {
    if (st && st.down && e.key === 'Escape') { st.cancel = true; st.down = false; }
  }, true);
})();

// brausa: find in the page. Every hit is highlighted (CSS highlights where
// the engine has them, otherwise <mark> elements), the current one stronger.
(() => {
  if (window.__brausaFind) return;
  const HL = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight === 'function';
  let ranges = [];
  let marks = [];
  let cur = -1;
  let last = '';
  let style = null;
  const ensureStyle = () => {
    if (style) return;
    style = document.createElement('style');
    style.textContent = '::highlight(brausa-hit){background:rgba(255,170,0,.45)}::highlight(brausa-cur){background:rgba(255,100,0,.8);color:#000}' +
      'mark.__brausa-hit{background:rgba(255,170,0,.45);color:inherit;padding:0}mark.__brausa-hit.__brausa-cur{background:rgba(255,100,0,.8);color:#000}';
    (document.head || document.documentElement).appendChild(style);
  };
  const clear = () => {
    if (HL) {
      CSS.highlights.delete('brausa-hit');
      CSS.highlights.delete('brausa-cur');
    }
    for (const m of marks) {
      const p = m.parentNode;
      if (!p) continue;
      while (m.firstChild) p.insertBefore(m.firstChild, m);
      p.removeChild(m);
      p.normalize();
    }
    marks = [];
    ranges = [];
    cur = -1;
  };
  const collect = (q) => {
    const needle = q.toLocaleLowerCase();
    const out = [];
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        const p = n.parentElement;
        if (!p || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA)$/.test(p.tagName)) return NodeFilter.FILTER_REJECT;
        return n.data.toLocaleLowerCase().includes(needle) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const hay = n.data.toLocaleLowerCase();
      for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) {
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + needle.length);
        out.push(r);
      }
    }
    return out;
  };
  const show = () => {
    if (cur < 0) return;
    if (HL) {
      CSS.highlights.set('brausa-cur', new Highlight(ranges[cur]));
      const el = ranges[cur].startContainer.parentElement;
      el && el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else {
      marks.forEach((m, i) => m.classList.toggle('__brausa-cur', i === cur));
      marks[cur] && marks[cur].scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  };
  // q: the query (the same one again steps); dir: 1 next, -1 previous, 0 start over.
  window.__brausaFind = (q, dir) => {
    q = (q || '').trim();
    if (q !== last || dir === 0) {
      clear();
      last = q;
      if (!q) return JSON.stringify({ n: 0, i: -1 });
      ensureStyle();
      ranges = collect(q);
      if (HL) CSS.highlights.set('brausa-hit', new Highlight(...ranges));
      else
        // Wrap from the end, so earlier ranges stay valid.
        for (let i = ranges.length - 1; i >= 0; i--) {
          const m = document.createElement('mark');
          m.className = '__brausa-hit';
          try {
            ranges[i].surroundContents(m);
            marks.unshift(m);
          } catch (_) {}
        }
      cur = ranges.length ? 0 : -1;
    } else if (ranges.length) {
      cur = (cur + (dir || 1) + ranges.length) % ranges.length;
    }
    show();
    return JSON.stringify({ n: HL ? ranges.length : marks.length, i: cur });
  };
})();
