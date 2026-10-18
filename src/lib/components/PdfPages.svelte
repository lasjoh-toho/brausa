<script lang="ts">
  // PDF pages for the preview: rendered when they scroll into view, text selectable.
  import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
  import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
  import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
  import './textlayer.css';
  import { app } from '../state/app.svelte';

  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  let { path }: { path: string } = $props();

  let scroller = $state<HTMLElement>();
  let width = $state(800);
  let pdf = $state.raw<PDFDocumentProxy | null>(null);
  let sizes = $state<{ w: number; h: number }[]>([]);
  let error = $state('');

  $effect(() => {
    const p = path;
    let cancelled = false;
    pdf = null;
    sizes = [];
    error = '';
    (async () => {
      try {
        const data = new Uint8Array(await app.backend.fileData(p));
        const d = await pdfjs.getDocument({ data }).promise;
        const s: { w: number; h: number }[] = [];
        for (let i = 1; i <= d.numPages; i++) {
          const v = (await d.getPage(i)).getViewport({ scale: 1 });
          s.push({ w: v.width, h: v.height });
        }
        if (cancelled) return void d.destroy();
        sizes = s;
        pdf = d;
      } catch (e) {
        if (!cancelled) error = String(e).replace(/^Error: /, '');
      }
    })();
    return () => {
      cancelled = true;
      pdf?.destroy();
    };
  });

  const scale = $derived(sizes.length ? Math.min(2, (width - 32) / Math.max(...sizes.map((s) => s.w))) : 1);

  function page(node: HTMLElement, args: { n: number; scale: number }) {
    let done = '';
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && void render(), { root: scroller, rootMargin: '800px 0px' });
    io.observe(node);
    async function render() {
      const key = `${args.n}@${args.scale}`;
      if (!pdf || done === key) return;
      done = key;
      const p = await pdf.getPage(args.n);
      const vp = p.getViewport({ scale: args.scale });
      const dpr = window.devicePixelRatio || 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width * dpr);
      canvas.height = Math.floor(vp.height * dpr);
      canvas.style.width = `${vp.width}px`;
      canvas.style.height = `${vp.height}px`;
      try {
        await p.render({ canvas, viewport: p.getViewport({ scale: args.scale * dpr }) }).promise;
      } catch {
        return;
      }
      const text = document.createElement('div');
      text.className = 'textLayer';
      node.replaceChildren(canvas, text);
      await new pdfjs.TextLayer({ textContentSource: p.streamTextContent(), container: text, viewport: vp }).render();
    }
    return {
      update(a: { n: number; scale: number }) {
        args = a;
        done = '';
        void render();
      },
      destroy: () => io.disconnect()
    };
  }
</script>

<div class="pdf" bind:this={scroller} bind:clientWidth={width}>
  {#if error}
    <p class="msg">{error}</p>
  {:else if !pdf}
    <p class="msg">PDF wird geladen …</p>
  {:else}
    {#each sizes as s, i (i)}
      <div class="page" style="width: {s.w * scale}px; height: {s.h * scale}px; --total-scale-factor: {scale}; --scale-round-x: 1px; --scale-round-y: 1px" use:page={{ n: i + 1, scale }}></div>
    {/each}
  {/if}
</div>

<style>
  .pdf {
    height: 100%;
    overflow: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }
  .page {
    position: relative;
    flex: none;
    background: #fff;
    box-shadow: 0 1px 6px rgba(0, 0, 0, 0.3);
  }
  .msg {
    color: #aaa;
  }
</style>
