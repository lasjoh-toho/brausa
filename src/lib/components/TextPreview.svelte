<script lang="ts">
  // Text and source code in the preview, with syntax colours; Markdown rendered (source on request).
  import { app } from '../state/app.svelte';
  import type { Entry } from '../core/types';
  import { renderMarkdown } from '../core/markdown';
  import { t } from '../i18n/index.svelte';

  let { entry }: { entry: Entry } = $props();

  const MAX = 4_000_000; // larger files only show their beginning
  const LANG: Record<string, string> = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    php: 'php', css: 'css', scss: 'scss', sass: 'scss', less: 'less', json: 'json', jsonl: 'json',
    xml: 'xml', svelte: 'xml', vue: 'xml', astro: 'xml', yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', cfg: 'ini',
    conf: 'ini', properties: 'properties', py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin',
    kts: 'kotlin', c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', cs: 'csharp', swift: 'swift', m: 'objectivec',
    sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash', ps1: 'powershell', bat: 'dos', cmd: 'dos', sql: 'sql',
    tex: 'latex', r: 'r', lua: 'lua', pl: 'perl', dart: 'dart', gradle: 'gradle', diff: 'diff', patch: 'diff', md: 'markdown', markdown: 'markdown'
  };

  let text = $state('');
  let cut = $state(false);
  let html = $state('');
  let error = $state('');
  let source = $state(false);
  const markdown = $derived(entry.ext === 'md' || entry.ext === 'markdown');

  $effect(() => {
    const e = entry;
    let cancelled = false;
    text = html = error = '';
    cut = false;
    source = false;
    app.backend
      .readText(e.path)
      .then((t) => {
        if (cancelled) return;
        cut = t.length > MAX;
        text = cut ? t.slice(0, MAX) : t;
      })
      .catch((err) => !cancelled && (error = String(err).replace(/^Error: /, '')));
    return () => (cancelled = true);
  });

  // Colours are loaded on demand; highlight.js only knows the languages registered here.
  $effect(() => {
    const t = text;
    const lang = LANG[entry.ext];
    html = '';
    if (!t || !lang || (markdown && !source) || t.length > 500_000) return;
    let cancelled = false;
    import('../core/highlight').then(({ highlight }) => {
      if (!cancelled) html = highlight(t, lang);
    });
    return () => (cancelled = true);
  });
</script>

<div class="text">
  {#if markdown}
    <button class="btn toggle" onclick={() => (source = !source)}>{source ? t('preview.formatted') : t('preview.source')}</button>
  {/if}
  {#if error}
    <p class="msg">{error}</p>
  {:else if markdown && !source}
    <article class="md">{@html renderMarkdown(text)}</article>
  {:else if html}
    <pre class="hljs"><code>{@html html}</code></pre>
  {:else}
    <pre><code>{text}</code></pre>
  {/if}
  {#if cut}<p class="msg">{t('preview.truncated')}</p>{/if}
</div>

<style>
  .text {
    position: relative;
    height: 100%;
    overflow: auto;
    background: #fbfbf9;
    color: #1d1d1b;
    -webkit-user-select: text;
    user-select: text;
  }
  pre {
    margin: 0;
    padding: 16px 20px;
    font-family: var(--mono);
    font-size: 12.5px;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
    tab-size: 4;
  }
  .md {
    max-width: 760px;
    margin: 0 auto;
    padding: 24px 28px;
    font-size: 15px;
    line-height: 1.6;
  }
  .toggle {
    position: sticky;
    top: 8px;
    float: right;
    margin: 8px 8px 0 0;
    background: #fff;
    border: 1px solid #ddd;
    z-index: 1;
  }
  .msg {
    padding: 0 20px;
    color: #888;
  }
  /* highlight.js colours (GitHub-like) */
  .text :global(.hljs-comment),
  .text :global(.hljs-quote) {
    color: #6a737d;
    font-style: italic;
  }
  .text :global(.hljs-keyword),
  .text :global(.hljs-selector-tag),
  .text :global(.hljs-literal),
  .text :global(.hljs-type) {
    color: #d73a49;
  }
  .text :global(.hljs-string),
  .text :global(.hljs-regexp),
  .text :global(.hljs-addition) {
    color: #032f62;
  }
  .text :global(.hljs-number),
  .text :global(.hljs-attr),
  .text :global(.hljs-attribute),
  .text :global(.hljs-variable),
  .text :global(.hljs-template-variable),
  .text :global(.hljs-selector-attr),
  .text :global(.hljs-selector-class),
  .text :global(.hljs-selector-id) {
    color: #005cc5;
  }
  .text :global(.hljs-title),
  .text :global(.hljs-section),
  .text :global(.hljs-name),
  .text :global(.hljs-built_in) {
    color: #6f42c1;
  }
  .text :global(.hljs-tag),
  .text :global(.hljs-meta) {
    color: #22863a;
  }
  .text :global(.hljs-deletion) {
    color: #b31d28;
    background: #ffeef0;
  }
</style>
