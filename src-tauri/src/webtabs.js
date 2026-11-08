// brausa: links that want a new window (target="_blank", Ctrl/Cmd or middle click, window.open)
// open as a tab of the web panel. The page cannot talk to brausa, so it asks by navigating to an
// address brausa catches (and cancels) before the page is left.
(() => {
  if (window.__brausaTabsInit || window.top !== window) return;
  window.__brausaTabsInit = true;
  const ask = (url) => {
    try {
      const u = new URL(url, location.href);
      if (!/^https?:$/.test(u.protocol)) return false;
      location.href = 'http://brausa-newtab.invalid/?u=' + encodeURIComponent(u.href);
      return true;
    } catch (_) {
      return false;
    }
  };
  const open = (e) => {
    const a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a || e.defaultPrevented) return;
    const wants = a.target === '_blank' || e.ctrlKey || e.metaKey || e.button === 1;
    if (wants && ask(a.href)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  addEventListener('click', open, true);
  addEventListener('auxclick', (e) => e.button === 1 && open(e), true);
  const orig = window.open;
  window.open = function (url, name, features) {
    if (url && ask(String(url))) return null;
    return orig ? orig.call(window, url, name, features) : null;
  };
})();
