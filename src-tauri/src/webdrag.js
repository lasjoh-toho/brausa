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
