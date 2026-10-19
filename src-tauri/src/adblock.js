// brausa's simple ad blocker for the web panel (runs before every page).
// The panel is a system webview without extensions, so this is no uBlock:
// it stops scripts, frames and images of common ad and tracking networks
// that pages insert later, and hides the usual ad containers.
(() => {
  const HOSTS = [
    'doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'google-analytics.com',
    'googletagmanager.com', 'googletagservices.com', 'adservice.google.com', 'adnxs.com', 'adsrvr.org',
    'amazon-adsystem.com', 'criteo.com', 'criteo.net', 'taboola.com', 'outbrain.com', 'pubmatic.com',
    'rubiconproject.com', 'openx.net', 'casalemedia.com', 'scorecardresearch.com', 'quantserve.com',
    'moatads.com', 'adform.net', 'smartadserver.com', 'yieldlab.net', 'teads.tv', 'media.net',
    'facebook.net', 'connect.facebook.net', 'hotjar.com', 'adition.com', 'ioam.de', 'xplosion.de',
    'adsafeprotected.com', 'serving-sys.com', 'zemanta.com', 'sharethrough.com', 'bidswitch.net'
  ];
  const bad = (url) => {
    try {
      const h = new URL(url, location.href).hostname;
      return HOSTS.some((d) => h === d || h.endsWith('.' + d));
    } catch {
      return false;
    }
  };
  const blocked = (n) =>
    n && n.nodeType === 1 && /^(SCRIPT|IFRAME|IMG)$/.test(n.tagName) && bad(n.src || n.getAttribute('src') || '');
  for (const m of ['appendChild', 'insertBefore', 'replaceChild']) {
    const orig = Node.prototype[m];
    Node.prototype[m] = function (n, ...rest) {
      if (blocked(n)) return n;
      return orig.call(this, n, ...rest);
    };
  }
  const css = [
    '[id^="google_ads"]', '[id^="div-gpt-ad"]', 'ins.adsbygoogle', '.adsbygoogle', '[data-ad-slot]',
    '[class*="ad-banner"]', '[class*="advert"]', '[id*="taboola"]', '[class*="taboola"]', '[class*="outbrain"]',
    'iframe[src*="doubleclick"]', 'iframe[src*="googlesyndication"]', '.ad-container', '.ad-slot', '.sponsored-content'
  ].join(',') + '{display:none!important}';
  const style = () => {
    if (document.getElementById('brausa-adblock')) return;
    const s = document.createElement('style');
    s.id = 'brausa-adblock';
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  };
  if (document.documentElement) style();
  document.addEventListener('DOMContentLoaded', () => {
    style();
    for (const n of document.querySelectorAll('script[src],iframe[src],img[src]')) if (blocked(n)) n.remove();
  });
})();
