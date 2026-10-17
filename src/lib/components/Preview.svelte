<script lang="ts">
  /**
   * Zoom preview. The image grows out of its tile (FLIP) to fill the whole
   * window, flowing underneath the toolbar, which turns into tinted glass.
   */
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import { app } from '../state/app.svelte';
  import { formatDate, formatSize, family } from '../core/format';
  import { tagColor } from '../core/tags';
  import Icon from './Icon.svelte';

  let { onaccent }: { onaccent: (c: { color: string; light: boolean } | null) => void } = $props();

  type Box = { left: number; top: number; width: number; height: number };

  const p = $derived(app.preview!);
  const e = $derived(p.entry);
  // Original file when the webview can show it, else a large cached rendition (TIFF etc.).
  let big = $state<string | null>(null);
  $effect(() => {
    const entry = e;
    big = null;
    if (!app.backend.fileUrl(entry)) app.backend.thumbnail(entry, 1600).then((u) => entry === e && (big = u));
  });
  const src = $derived(app.backend.fileUrl(e) ?? big ?? app.thumbOf(e));
  let box = $state<Box | null>(null);
  let animate = $state(false);
  let closing = false;
  let natural = { w: 4, h: 3 };

  const files = $derived(app.visible.filter((x) => x.kind === 'file'));

  function fitted(): Box {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const s = Math.min(W / natural.w, H / natural.h);
    const width = natural.w * s;
    const height = natural.h * s;
    return { left: (W - width) / 2, top: (H - height) / 2, width, height };
  }

  function fromRect(r: DOMRect | null): Box {
    if (!r) {
      const f = fitted();
      return { left: f.left + f.width * 0.1, top: f.top + f.height * 0.1, width: f.width * 0.8, height: f.height * 0.8 };
    }
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }

  function loaded(ev: Event) {
    const img = ev.currentTarget as HTMLImageElement;
    natural = { w: img.naturalWidth || 4, h: img.naturalHeight || 3 };
    if (!animate) {
      box = fromRect(p.from);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          animate = true;
          box = fitted();
        })
      );
    } else box = fitted();
    onaccent(averageColor(img));
  }

  function averageColor(img: HTMLImageElement): { color: string; light: boolean } | null {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 8;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0, 8, 8);
      const d = ctx.getImageData(0, 0, 8, 3).data; // top rows: what sits under the toolbar
      let r = 0,
        g = 0,
        b = 0;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i];
        g += d[i + 1];
        b += d[i + 2];
      }
      const n = d.length / 4;
      [r, g, b] = [r / n, g / n, b / n].map(Math.round);
      // Relative luminance decides whether toolbar text goes dark or light.
      const light = 0.2126 * r + 0.7152 * g + 0.0722 * b > 150;
      return { color: `rgb(${r} ${g} ${b})`, light };
    } catch {
      return null; // tainted canvas (cross-origin asset) – keep neutral glass
    }
  }

  function close() {
    if (closing) return;
    closing = true;
    const tile = document.querySelector<HTMLElement>(`.tile[data-path="${CSS.escape(e.path)}"] .thumb`);
    if (tile && box) box = fromRect(tile.getBoundingClientRect());
    onaccent(null);
    setTimeout(() => (app.preview = null), tile ? 260 : 0);
  }

  function step(d: number) {
    const i = files.findIndex((x) => x.path === e.path);
    const next = files[(i + d + files.length) % files.length];
    if (next) {
      app.select(next.path, 'replace');
      app.preview = { entry: next, from: null };
    }
  }

  function key(ev: KeyboardEvent) {
    if (ev.key === 'Escape' || ev.key === ' ') close();
    else if (ev.key === 'ArrowRight') step(1);
    else if (ev.key === 'ArrowLeft') step(-1);
    else return;
    ev.preventDefault();
    ev.stopPropagation();
  }

  onMount(() => {
    window.addEventListener('keydown', key, true);
    const onResize = () => (box = fitted());
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', onResize);
    };
  });
</script>

<div class="preview" transition:fade={{ duration: 200 }} role="dialog" aria-label={e.name}>
  <button class="scrim" onclick={close} aria-label="Schließen"></button>
  {#if src && family(e.ext) === 'image'}
    <div
      class="frame"
      class:animate
      style:left="{box?.left ?? 0}px"
      style:top="{box?.top ?? 0}px"
      style:width="{box?.width ?? 0}px"
      style:height="{box?.height ?? 0}px"
      style:opacity={box ? 1 : 0}
    >
      <img {src} alt={e.name} onload={loaded} draggable="false" />
    </div>
  {:else}
    <div class="doc">
      <Icon name={family(e.ext) === 'other' ? 'file' : family(e.ext)} size={64} />
      <span>{e.ext.toUpperCase()}</span>
    </div>
  {/if}

  <div class="info">
    <div class="title">{e.name}</div>
    <div class="facts">
      {formatSize(e.size)} · {formatDate(e.mtime)}{e.relDir ? ` · ${e.relDir}` : ''}
    </div>
    {#if e.tags.length}
      <div class="tags">
        {#each e.tags as t (t)}<span class="chip"><span class="dot" style:background={tagColor(t)}></span>{t}</span>{/each}
      </div>
    {/if}
  </div>
  <button class="nav l" onclick={() => step(-1)} aria-label="Vorheriges"><Icon name="back" size={20} /></button>
  <button class="nav r" onclick={() => step(1)} aria-label="Nächstes"><Icon name="forward" size={20} /></button>
</div>

<style>
  .preview {
    position: fixed;
    inset: 0;
    z-index: 25;
  }
  .scrim {
    position: absolute;
    inset: 0;
    background: #0b0b0a;
    cursor: zoom-out;
  }
  .frame {
    position: absolute;
    overflow: hidden;
    border-radius: 10px;
    pointer-events: none;
  }
  .frame.animate {
    border-radius: 0;
    transition:
      left 0.42s cubic-bezier(0.2, 0.8, 0.2, 1),
      top 0.42s cubic-bezier(0.2, 0.8, 0.2, 1),
      width 0.42s cubic-bezier(0.2, 0.8, 0.2, 1),
      height 0.42s cubic-bezier(0.2, 0.8, 0.2, 1),
      border-radius 0.42s;
  }
  .frame img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .doc {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    align-content: center;
    gap: 12px;
    color: #8a8a85;
    pointer-events: none;
    font-family: var(--mono);
  }
  .info {
    position: absolute;
    left: 50%;
    bottom: 24px;
    transform: translateX(-50%);
    max-width: calc(100% - 140px);
    padding: 10px 16px;
    border-radius: 14px;
    background: rgba(20, 20, 18, 0.55);
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
    color: #fff;
    text-align: center;
  }
  .title {
    font-weight: 600;
  }
  .facts {
    font-size: 12px;
    opacity: 0.7;
    margin-top: 2px;
  }
  .tags {
    display: flex;
    justify-content: center;
    gap: 4px;
    margin-top: 8px;
  }
  .tags .chip {
    background: rgba(255, 255, 255, 0.14);
    color: #fff;
  }
  .nav {
    position: absolute;
    top: 50%;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    color: #fff;
    background: rgba(255, 255, 255, 0.1);
    opacity: 0;
    transition: opacity 0.2s;
  }
  .preview:hover .nav {
    opacity: 1;
  }
  .nav.l {
    left: 20px;
  }
  .nav.r {
    right: 20px;
  }
</style>
