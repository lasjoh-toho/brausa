<script lang="ts">
  /**
   * A local web page in the preview, in a sandboxed frame. Pages with scripts
   * ask first whether to run them; the answer can be remembered for the file
   * or its folder. Without scripts the frame may not run any code at all.
   */
  import { app } from '../state/app.svelte';
  import type { Entry } from '../core/types';
  import { store } from '../platform';
  import { decisionFor, dirOf, forget, hasScripts, remember, resolveLocal, type ScriptDecisions } from '../core/htmlpreview';
  import Icon from './Icon.svelte';
  import { t } from '../i18n/index.svelte';

  let { entry }: { entry: Entry } = $props();

  let decisions = $state<ScriptDecisions>(store.get('htmlScripts', { files: {}, dirs: {} }));
  let text = $state<string | null>(null);
  let error = $state('');
  /** Answer given for this viewing only (not remembered). */
  let once = $state<boolean | null>(null);
  let scope = $state<'once' | 'file' | 'dir'>('once');

  $effect(() => {
    const e = entry;
    let cancelled = false;
    text = null;
    error = '';
    once = null;
    scope = 'once';
    app.backend
      .readText(e.path)
      .then((t) => !cancelled && (text = t))
      .catch((err) => !cancelled && (error = String(err).replace(/^Error: /, '')));
    return () => (cancelled = true);
  });

  const scripted = $derived(text !== null && hasScripts(text));
  const saved = $derived(decisionFor(decisions, entry.path));
  const allow = $derived(!scripted ? false : (once ?? saved));
  const asking = $derived(scripted && allow === null);
  const srcdoc = $derived(text === null || asking ? null : prepare(text, entry.path, !!allow));

  function decide(a: boolean) {
    if (scope === 'once') once = a;
    else {
      decisions = remember(decisions, entry.path, { allow: a, scope });
      store.set('htmlScripts', decisions);
    }
  }

  function reset() {
    once = null;
    decisions = forget(decisions, entry.path);
    store.set('htmlScripts', decisions);
  }

  /** Point the page's relative resources at the files next to it; without scripts, drop them. */
  function prepare(html: string, path: string, scripts: boolean): string {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const dir = dirOf(path);
    const url = (ref: string) => {
      const f = resolveLocal(dir, ref);
      return f ? app.backend.assetUrl(f) : null;
    };
    const fix = (sel: string, attr: string) =>
      doc.querySelectorAll(sel).forEach((el) => {
        const u = url(el.getAttribute(attr) ?? '');
        if (u) el.setAttribute(attr, u);
      });
    fix('[src]', 'src');
    fix('link[href], a[href]', 'href');
    fix('[poster]', 'poster');
    const css = (s: string) => s.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, _q, ref) => (url(ref) ? `url("${url(ref)}")` : m));
    doc.querySelectorAll('style').forEach((el) => (el.textContent = css(el.textContent ?? '')));
    doc.querySelectorAll('[style]').forEach((el) => el.setAttribute('style', css(el.getAttribute('style') ?? '')));
    if (!scripts) {
      doc.querySelectorAll('script').forEach((el) => el.remove());
      doc.querySelectorAll('*').forEach((el) => {
        for (const a of [...el.attributes]) if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
      });
    }
    return '<!doctype html>\n' + doc.documentElement.outerHTML;
  }
</script>

<div class="web">
  {#if error}
    <p class="msg">{error}</p>
  {:else if text === null}
    <p class="msg">{t('preview.loadingPage')}</p>
  {:else if asking}
    <div class="ask" role="alertdialog" aria-label={t('preview.runScripts')}>
      <div class="head"><Icon name="warn" size={22} /><b>{t('preview.hasScripts')}</b></div>
      <p>{t('preview.scriptsExplain')}</p>
      <p>{t('preview.scriptsAdvice')}</p>
      <div class="scope">
        <label><input type="radio" bind:group={scope} value="once" /> {t('preview.scopeOnce')}</label>
        <label><input type="radio" bind:group={scope} value="file" /> {t('preview.scopeFile')}</label>
        <label><input type="radio" bind:group={scope} value="dir" /> {t('preview.scopeDir')}</label>
      </div>
      <div class="actions">
        <button class="btn" onclick={() => decide(false)}>{t('preview.withoutScripts')}</button>
        <button class="btn warn" onclick={() => decide(true)}><Icon name="warn" size={13} /> {t('preview.withScripts')}</button>
      </div>
    </div>
  {:else if srcdoc !== null}
    {#key `${entry.path}|${allow}`}
      <iframe title={entry.name} {srcdoc} sandbox={allow ? 'allow-scripts allow-forms allow-popups' : ''}></iframe>
    {/key}
    {#if scripted}
      <div class="bar">
        <Icon name={allow ? 'warn' : 'globe'} size={12} />
        {t(`preview.${allow ? 'scriptsOn' : 'scriptsOff'}${saved !== null && once === null ? 'Saved' : ''}`)}
        <button onclick={reset}>{t('preview.change')}</button>
      </div>
    {/if}
  {/if}
</div>

<style>
  .web {
    position: relative;
    height: 100%;
    background: #fff;
  }
  iframe {
    width: 100%;
    height: 100%;
    border: 0;
    display: block;
    background: #fff;
  }
  .msg {
    padding: 16px 20px;
    color: #888;
  }
  .ask {
    max-width: 520px;
    margin: 48px auto;
    padding: 20px 22px;
    border-radius: 14px;
    background: #fff8eb;
    color: #3b2f17;
    border: 1px solid #f0d9a8;
    font-size: 14px;
    line-height: 1.5;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #a15c00;
    font-size: 16px;
  }
  .scope {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 12px 0;
  }
  .actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    flex-wrap: wrap;
  }
  .actions .btn {
    background: #fff;
    border: 1px solid #e3d3ad;
    color: #3b2f17;
  }
  .actions .btn.warn {
    background: #a15c00;
    border-color: #a15c00;
    color: #fff;
  }
  .bar {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    border-radius: 8px;
    background: rgba(20, 20, 18, 0.7);
    color: #fff;
    font-size: 11px;
  }
  .bar button {
    color: #ffd27a;
    text-decoration: underline;
  }
</style>
