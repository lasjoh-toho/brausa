<script lang="ts">
  /**
   * Reader next to the project map (LiquidText-style): PDF via pdf.js,
   * HTML/Markdown/text as sanitised text. Selected text is dragged onto the
   * map as a snippet card; snippets of this document are highlighted, and
   * opening a snippet scrolls here and flashes it.
   */
  import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
  import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
  import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
  import './textlayer.css';
  import { app } from '../state/app.svelte';
  import { board } from '../state/board.svelte';
  import { drag } from '../state/drag.svelte';
  import type { CardRef } from '../core/map';
  import type { Entry } from '../core/types';
  import { renderMarkdown } from '../core/markdown';
  import { anchorText, findQuote, sanitizeHtml, type Snippet } from '../core/snippets';
  import Icon from './Icon.svelte';
  import { t } from '../i18n/index.svelte';

  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const doc = $derived(board.reader);
  const ref = $derived(doc?.ref);
  const kind = $derived(ref?.ext === 'pdf' ? 'pdf' : ref?.ext === 'html' || ref?.ext === 'htm' ? 'html' : ref?.ext === 'txt' ? 'txt' : 'md');

  let scroller = $state<HTMLElement>();
  let width = $state(500);
  let error = $state('');
  let loading = $state(false);

  // ---------------------------------------------------------------- loading

  let pdf = $state.raw<PDFDocumentProxy | null>(null);
  let sizes = $state<{ w: number; h: number }[]>([]);
  let html = $state('');
  let loadedPath = '';

  $effect(() => {
    const p = ref?.path;
    if (!p || p === loadedPath) return;
    loadedPath = p;
    void load(p, kind);
  });

  async function load(path: string, k: string) {
    loading = true;
    error = '';
    pdf?.destroy();
    pdf = null;
    sizes = [];
    html = '';
    try {
      if (k === 'pdf') {
        const data = new Uint8Array(await app.backend.fileData(path));
        const d = await pdfjs.getDocument({ data }).promise;
        const s: { w: number; h: number }[] = [];
        for (let i = 1; i <= d.numPages; i++) {
          const v = (await d.getPage(i)).getViewport({ scale: 1 });
          s.push({ w: v.width, h: v.height });
        }
        sizes = s;
        pdf = d;
      } else {
        const text = await app.backend.readText(path);
        const dir = path.replace(/[\\/][^\\/]*$/, '');
        html =
          k === 'html'
            ? sanitizeHtml(text, (src) => app.backend.assetUrl(dir + '/' + src))
            : k === 'md'
              ? renderMarkdown(text)
              : `<pre>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`;
      }
    } catch (e) {
      error = String(e).replace(/^Error: /, '');
    } finally {
      loading = false;
    }
  }

  const scale = $derived(sizes.length ? (width - 32) / Math.max(...sizes.map((s) => s.w)) : 1);

  // ---------------------------------------------------------------- PDF pages

  /** Renders a page (canvas + selectable text) once it scrolls into view. */
  function page(node: HTMLElement, args: { n: number; scale: number }) {
    let done = '';
    let task: { cancel(): void } | null = null;
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) void render();
      },
      { root: scroller, rootMargin: '600px 0px' }
    );
    io.observe(node);

    async function render() {
      const key = `${args.n}@${args.scale}`;
      if (!pdf || done === key) return;
      done = key;
      task?.cancel();
      const p = await pdf.getPage(args.n);
      const vp = p.getViewport({ scale: args.scale });
      const dpr = window.devicePixelRatio || 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width * dpr);
      canvas.height = Math.floor(vp.height * dpr);
      canvas.style.width = `${vp.width}px`;
      canvas.style.height = `${vp.height}px`;
      const text = document.createElement('div');
      text.className = 'textLayer';
      const r = p.render({ canvas, viewport: p.getViewport({ scale: args.scale * dpr }) });
      task = r;
      try {
        await r.promise;
      } catch {
        return; // cancelled by a newer render
      }
      node.querySelector('canvas')?.remove();
      node.querySelector('.textLayer')?.remove();
      node.prepend(canvas);
      node.append(text);
      await new pdfjs.TextLayer({ textContentSource: p.streamTextContent(), container: text, viewport: vp }).render();
    }

    return {
      update(a: { n: number; scale: number }) {
        args = a;
        const rect = node.getBoundingClientRect();
        const root = scroller?.getBoundingClientRect();
        if (root && rect.bottom > root.top - 600 && rect.top < root.bottom + 600) void render();
        else done = '';
      },
      destroy() {
        io.disconnect();
        task?.cancel();
      }
    };
  }

  // ---------------------------------------------------------------- highlights

  const marks = $derived(board.snippetsOf(ref?.id));
  const isFocus = (r: CardRef) => !!doc && r === doc.ref && (!!r.page || !!r.quote);

  let textEl = $state<HTMLElement>();
  /** Text documents: rectangles of each snippet, relative to the text container. */
  const textMarks = $derived.by(() => {
    void width;
    if (kind === 'pdf' || !textEl || !html) return [];
    return marks.flatMap((r) => {
      const range = findQuote(textEl!, r);
      if (!range) return [];
      const base = textEl!.getBoundingClientRect();
      return [...range.getClientRects()].map((c) => ({ r, x: c.left - base.left, y: c.top - base.top, w: c.width, h: c.height }));
    });
  });

  // Jump to the anchor of the snippet that opened the reader.
  $effect(() => {
    const d = doc;
    if (!d || !scroller || loading) return;
    void d.seq;
    const r = d.ref;
    requestAnimationFrame(() => {
      if (kind === 'pdf' && r.page && sizes.length) {
        const el = scroller!.querySelector<HTMLElement>(`[data-page="${r.page}"]`);
        if (el) scroller!.scrollTo({ top: el.offsetTop + (r.rects?.[0]?.y ?? 0) * el.offsetHeight - 80, behavior: 'smooth' });
      } else if (r.quote) {
        const m = textMarks.find((x) => x.r === r);
        if (m) scroller!.scrollTo({ top: m.y - 80, behavior: 'smooth' });
      }
    });
  });

  // ---------------------------------------------------------------- snippets

  /** Pressing on selected text drags it out as a snippet. */
  function down(e: PointerEvent) {
    const sel = getSelection();
    if (!ref || !sel || sel.isCollapsed || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const root = kind === 'pdf' ? scroller : textEl;
    if (!root?.contains(range.commonAncestorContainer)) return;
    const hit = [...range.getClientRects()].some((r) => e.clientX >= r.left - 3 && e.clientX <= r.right + 3 && e.clientY >= r.top - 3 && e.clientY <= r.bottom + 3);
    if (!hit) return;
    const snippet = kind === 'pdf' ? pdfSnippet(range) : anchorText(textEl!, range);
    if (!snippet?.quote) return;
    const entry: Entry = { path: ref.path!, name: ref.name ?? '', ext: ref.ext ?? '', kind: 'file', size: 0, mtime: 0, ctime: 0, tags: [] };
    drag.begin(e, () => [entry], 'reader', undefined, { data: { snippet }, accepts: ['board'], title: snippet.quote.slice(0, 200) });
  }

  function pdfSnippet(range: Range): Snippet | null {
    const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
    const pageEl = start?.closest<HTMLElement>('[data-page]');
    if (!pageEl) return null;
    const b = pageEl.getBoundingClientRect();
    const rects = [...range.getClientRects()]
      .filter((r) => r.width > 1 && r.height > 1 && r.top >= b.top - 2 && r.bottom <= b.bottom + 2)
      .map((r) => ({ x: (r.left - b.left) / b.width, y: (r.top - b.top) / b.height, w: r.width / b.width, h: r.height / b.height }));
    const quote = range.toString().replace(/\s+/g, ' ').trim();
    return { quote, page: Number(pageEl.dataset.page), rects };
  }

  // ---------------------------------------------------------------- resizing

  function resize(e: PointerEvent) {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = board.readerWidth;
    const move = (ev: PointerEvent) => board.setReaderWidth(w0 + ev.clientX - x0);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
</script>

{#if doc && ref}
  <aside class="reader" style:width="{board.readerWidth}px">
    <header>
      <Icon name="doc" size={14} />
      <span class="name" title={ref.path}>{ref.name}</span>
      <span class="hint">{t('reader.hint')}</span>
      <button class="btn icon" title={t('reader.openExternal')} onclick={() => board.openExternal(ref.path!)}><Icon name="open" size={14} /></button>
      <button class="btn icon" title={t('reader.close')} onclick={() => board.closeReader()}><Icon name="x" size={14} /></button>
    </header>

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="scroll" bind:this={scroller} bind:clientWidth={width} onpointerdown={down}>
      {#if error}
        <p class="msg err">{error}</p>
      {:else if loading}
        <p class="msg">{t('reader.loading')}</p>
      {:else if kind === 'pdf'}
        {#each sizes as s, i (i)}
          <div
            class="page"
            data-page={i + 1}
            style:width="{s.w * scale}px"
            style:height="{s.h * scale}px"
            style="--total-scale-factor: {scale}; --scale-round-x: 1px; --scale-round-y: 1px"
            use:page={{ n: i + 1, scale }}
          >
            {#each marks.filter((r) => r.page === i + 1) as r (r)}
              {#each r.rects ?? [] as q, j (j)}
                <div
                  class="mark"
                  class:flash={isFocus(r)}
                  style:left="{q.x * 100}%"
                  style:top="{q.y * 100}%"
                  style:width="{q.w * 100}%"
                  style:height="{q.h * 100}%"
                ></div>
              {/each}
            {/each}
          </div>
        {/each}
      {:else}
        <div class="text" bind:this={textEl}>
          {@html html}
          {#each textMarks as tm, j (j)}
            <div class="mark" class:flash={isFocus(tm.r)} style:left="{tm.x}px" style:top="{tm.y}px" style:width="{tm.w}px" style:height="{tm.h}px"></div>
          {/each}
        </div>
      {/if}
    </div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="grip" onpointerdown={resize}></div>
  </aside>
{/if}

<style>
  .reader {
    position: relative;
    flex: none;
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-right: 1px solid var(--line);
    background: var(--bg-sunken);
  }
  header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--line);
    background: var(--bg);
  }
  .name {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hint {
    margin-left: auto;
    font-size: 11px;
    color: var(--fg-faint);
    white-space: nowrap;
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 16px;
    -webkit-user-select: text;
    user-select: text;
  }
  .page {
    position: relative;
    margin: 0 auto 16px;
    background: white;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  }
  .page :global(canvas) {
    position: absolute;
    inset: 0;
  }
  .text {
    position: relative;
    max-width: 720px;
    margin: 0 auto;
    padding: 24px 28px;
    border-radius: 8px;
    background: var(--bg-elev);
    line-height: 1.6;
    font-size: 15px;
  }
  .text :global(img) {
    max-width: 100%;
  }
  .text :global(pre) {
    white-space: pre-wrap;
    font-family: var(--mono);
    font-size: 13px;
  }
  .mark {
    position: absolute;
    pointer-events: none;
    background: rgba(250, 204, 21, 0.35);
    mix-blend-mode: multiply;
    border-radius: 2px;
    z-index: 2;
  }
  .mark.flash {
    animation: flash 1.6s ease-out 2;
    background: rgba(250, 160, 21, 0.55);
  }
  @keyframes flash {
    0%,
    100% {
      box-shadow: 0 0 0 0 rgba(250, 160, 21, 0.7);
    }
    50% {
      box-shadow: 0 0 0 6px rgba(250, 160, 21, 0);
    }
  }
  .msg {
    color: var(--fg-muted);
    text-align: center;
  }
  .err {
    color: var(--danger);
  }
  .grip {
    position: absolute;
    top: 0;
    right: -4px;
    width: 8px;
    height: 100%;
    cursor: col-resize;
    z-index: 5;
  }
</style>
