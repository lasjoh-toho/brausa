<script lang="ts">
  /**
   * Zoom preview. The image grows out of its tile (FLIP) to fill the whole
   * window, flowing underneath the toolbar, which turns into tinted glass.
   */
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import { app } from '../state/app.svelte';
  import { category, formatDate, formatSize, family } from '../core/format';
  import TextPreview from './TextPreview.svelte';
  import HtmlPreview from './HtmlPreview.svelte';
  import { tagColor } from '../core/tags';
  import Icon from './Icon.svelte';
  import { t } from '../i18n/index.svelte';

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
  const cat = $derived(category(e.ext));
  // Media plays straight from the file; when the system cannot play it, offer the default app.
  let media = $state<string | null>(null);
  $effect(() => {
    const entry = e;
    media = null;
    if (category(entry.ext) === 'video' || category(entry.ext) === 'audio')
      app.backend.localUrl(entry.path).then((u) => entry === e && (media = u)).catch(() => (mediaFailed = true));
  });
  let mediaFailed = $state(false);
  $effect(() => {
    void e;
    mediaFailed = false;
    if (category(e.ext) !== 'image') onaccent(null);
  });
  let box = $state<Box | null>(null);
  let animate = $state(false);
  /** While zooming or panning by hand the frame follows without easing. */
  let direct = $state(false);
  let closing = false;
  let natural = { w: 4, h: 3 };

  /** Height of the menu band: the picture first fits below it. */
  function barHeight(): number {
    if (app.presenting) return 0;
    return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--toolbar-h')) || 52;
  }
  let bar = $state(52);

  // Scrolling and swiping go through the selection (several files chosen) or else all files shown.
  const files = $derived.by(() => {
    const sel = app.selectedEntries.filter((x) => x.kind === 'file');
    return sel.length > 1 && sel.some((x) => x.path === e.path) ? sel : app.visible.filter((x) => x.kind === 'file');
  });

  function fitted(): Box {
    bar = barHeight();
    const W = window.innerWidth;
    const H = window.innerHeight - bar;
    const s = Math.min(W / natural.w, H / natural.h);
    const width = natural.w * s;
    const height = natural.h * s;
    return { left: (W - width) / 2, top: bar + (H - height) / 2, width, height };
  }

  /** Zoomed in so far that the picture reaches under the menu band: the whole top row turns to glass. */
  const under = $derived(!!box && family(e.ext) === 'image' && box.top < bar - 0.5);
  $effect(() => {
    app.previewUnderBar = under;
  });
  $effect(() => () => (app.previewUnderBar = false));

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
    direct = false;
    if (!animate) {
      box = fromRect(p.from);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          animate = true;
          box = fitted();
        })
      );
    } else box = fitted();
    const c = averageColor(img);
    tint = c?.color ?? null;
    onaccent(c);
  }
  let tint = $state<string | null>(null);

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
    direct = false;
    const tile = document.querySelector<HTMLElement>(`.tile[data-path="${CSS.escape(e.path)}"] .thumb`);
    if (tile && box) box = fromRect(tile.getBoundingClientRect());
    onaccent(null);
    setTimeout(() => (app.preview = null), tile ? 260 : 0);
  }

  function step(d: number) {
    const i = files.findIndex((x) => x.path === e.path);
    const next = files[(i + d + files.length) % files.length];
    if (next && next !== e) {
      // Within a selection the selection stays; otherwise the file shown becomes the selection.
      if (!(app.selection.size > 1 && app.selection.has(next.path))) app.select(next.path, 'replace');
      else app.cursor = next.path;
      app.preview = { entry: next, from: null };
    }
  }

  // ---------------------------------------------------------------- zoom and pan

  const MAX_ZOOM = 12;

  /** Scale the picture by `f` around the screen point (x, y); never smaller than fitting. */
  function zoomBy(f: number, x: number, y: number) {
    if (!box || family(e.ext) !== 'image') return;
    const fit = fitted();
    const w = Math.min(Math.max(box.width * f, fit.width), fit.width * MAX_ZOOM);
    if (w <= fit.width + 0.5) {
      box = fit;
      return;
    }
    const k = w / box.width;
    box = { left: x - (x - box.left) * k, top: y - (y - box.top) * k, width: w, height: box.height * k };
  }

  function panBy(dx: number, dy: number) {
    if (!box || !zoomed()) return;
    const W = window.innerWidth;
    const H = window.innerHeight;
    // Keep some of the picture on screen.
    const left = Math.min(Math.max(box.left + dx, W * 0.5 - box.width), W * 0.5);
    const top = Math.min(Math.max(box.top + dy, H * 0.5 - box.height), H * 0.5);
    box = { ...box, left, top };
  }

  const zoomed = () => !!box && box.width > fitted().width + 0.5;

  // Wheel: a pinch on the trackpad (ctrl + wheel) zooms; scrolling and swiping step through the files.
  let wheelSum = 0;
  let wheelLock = 0;
  function wheel(ev: WheelEvent) {
    if ((ev.target as HTMLElement).closest('.sheet')) return;
    ev.preventDefault();
    if (ev.ctrlKey) {
      direct = true;
      zoomBy(Math.exp(-ev.deltaY * 0.01), ev.clientX, ev.clientY);
      return;
    }
    const now = performance.now();
    if (now < wheelLock) return;
    wheelSum += Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
    if (Math.abs(wheelSum) >= 60) {
      step(wheelSum > 0 ? 1 : -1);
      wheelSum = 0;
      wheelLock = now + 280;
    }
  }

  // Pointers: two fingers pinch (and move); a mouse drag to the right zooms in, to the left out
  // (up and down move a zoomed picture); one finger swipes to the next file or moves a zoomed one.
  const pts = new Map<number, { x: number; y: number }>();
  let start: { x: number; y: number; t: number; type: string } | null = null;
  let last: { x: number; y: number } | null = null;
  let pinch: { d: number; x: number; y: number } | null = null;

  const ignore = (ev: PointerEvent) => !!(ev.target as HTMLElement).closest('.sheet, .info, .nav, .close, .doc .open');

  function down(ev: PointerEvent) {
    if (ignore(ev) || ev.button > 0) return;
    pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    (ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId);
    if (pts.size === 1) {
      start = { x: ev.clientX, y: ev.clientY, t: performance.now(), type: ev.pointerType };
      last = { x: ev.clientX, y: ev.clientY };
    } else if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      start = null;
    }
  }

  function move(ev: PointerEvent) {
    if (!pts.has(ev.pointerId)) return;
    pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pinch && pts.size >= 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const x = (a.x + b.x) / 2;
      const y = (a.y + b.y) / 2;
      direct = true;
      if (pinch.d > 0) zoomBy(d / pinch.d, x, y);
      panBy(x - pinch.x, y - pinch.y);
      pinch = { d, x, y };
      return;
    }
    if (!start || !last) return;
    const dx = ev.clientX - last.x;
    const dy = ev.clientY - last.y;
    last = { x: ev.clientX, y: ev.clientY };
    if (start.type === 'mouse') {
      direct = true;
      if (dx) zoomBy(Math.exp(dx * 0.004), start.x, start.y);
      if (dy) panBy(0, dy);
    } else if (zoomed()) {
      direct = true;
      panBy(dx, dy);
    }
  }

  function up(ev: PointerEvent) {
    if (!pts.delete(ev.pointerId)) return;
    if (pts.size < 2) pinch = null;
    if (start && start.type !== 'mouse' && !zoomed()) {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && performance.now() - start.t < 800) step(dx < 0 ? 1 : -1);
    }
    if (!pts.size) start = last = null;
  }

  function key(ev: KeyboardEvent) {
    if (ev.key === 'Escape' || ev.key === ' ') close();
    else if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') step(1);
    else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') step(-1);
    else if (ev.key === '+' || ev.key === '=') ((direct = false), zoomBy(1.4, innerWidth / 2, innerHeight / 2));
    else if (ev.key === '-') ((direct = false), zoomBy(1 / 1.4, innerWidth / 2, innerHeight / 2));
    else if (ev.key === '0') ((direct = false), (box = fitted()));
    else return;
    ev.preventDefault();
    ev.stopPropagation();
  }

  onMount(() => {
    window.addEventListener('keydown', key, true);
    const onResize = () => ((direct = true), (box = fitted()));
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', onResize);
    };
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="preview"
  transition:fade={{ duration: 200 }}
  role="dialog"
  tabindex="-1"
  aria-label={e.name}
  onwheel={wheel}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
  ondblclick={(ev) => family(e.ext) === 'image' && !ignore(ev as unknown as PointerEvent) && close()}
>
  <div class="scrim"></div>
  <!-- The whole top row turns to tinted glass once the picture reaches under it. -->
  <div class="band" class:on={under} style:height="{bar}px" style:--tint={tint}></div>
  {#if src && family(e.ext) === 'image'}
    <div
      class="frame"
      class:animate
      class:direct
      style:left="{box?.left ?? 0}px"
      style:top="{box?.top ?? 0}px"
      style:width="{box?.width ?? 0}px"
      style:height="{box?.height ?? 0}px"
      style:opacity={box ? 1 : 0}
    >
      <img {src} alt={e.name} onload={loaded} draggable="false" />
    </div>
  {:else if (cat === 'video' || cat === 'audio') && media && !mediaFailed}
    <div class="sheet media" class:audio={cat === 'audio'}>
      {#if cat === 'video'}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video src={media} controls autoplay onerror={() => (mediaFailed = true)}></video>
      {:else}
        <Icon name="audio" size={72} />
        <audio src={media} controls autoplay onerror={() => (mediaFailed = true)}></audio>
      {/if}
    </div>
  {:else if cat === 'pdf'}
    <div class="sheet dark">
      {#await import('./PdfPages.svelte') then m}<m.default path={e.path} />{/await}
    </div>
  {:else if cat === 'text'}
    <div class="sheet"><TextPreview entry={e} /></div>
  {:else if cat === 'web'}
    <div class="sheet"><HtmlPreview entry={e} /></div>
  {:else}
    <div class="doc">
      <Icon name={family(e.ext) === 'other' ? 'file' : family(e.ext)} size={64} />
      <span>{e.ext.toUpperCase()}</span>
      {#if mediaFailed}<span class="hint">{t('preview.cannotPlay')}</span>{/if}
      <button class="btn open" onclick={() => app.open(e)}><Icon name="open" size={14} /> {t('preview.openDefault')}</button>
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
  <button class="close" style:top="{bar + 12}px" onclick={close} title={t('viewer.close')} aria-label={t('viewer.close')}><Icon name="x" size={18} /></button>
  <button class="nav l" onclick={() => step(-1)} aria-label={t('preview.previous')}><Icon name="back" size={20} /></button>
  <button class="nav r" onclick={() => step(1)} aria-label={t('preview.next')}><Icon name="forward" size={20} /></button>
</div>

<style>
  .preview {
    position: fixed;
    inset: 0;
    z-index: 25;
  }
  .preview {
    touch-action: none;
  }
  .scrim {
    position: absolute;
    inset: 0;
    background: #0b0b0a;
    cursor: ew-resize;
  }
  .band {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 2;
    pointer-events: none;
    background: transparent;
    transition:
      background 0.25s,
      backdrop-filter 0.25s;
  }
  .band.on {
    background: color-mix(in srgb, var(--tint, #000) 35%, transparent);
    backdrop-filter: blur(24px) saturate(1.4);
    -webkit-backdrop-filter: blur(24px) saturate(1.4);
  }
  .close {
    position: absolute;
    right: 16px;
    z-index: 3;
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    color: #fff;
    background: rgba(255, 255, 255, 0.14);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }
  .close:hover {
    background: rgba(255, 255, 255, 0.26);
  }
  .frame {
    position: absolute;
    overflow: hidden;
    border-radius: 10px;
    pointer-events: none;
  }
  .frame.animate.direct {
    transition: none;
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
  .doc .hint {
    font-family: var(--font, inherit);
    font-size: 13px;
  }
  .doc .open {
    pointer-events: auto;
    font-family: var(--font, inherit);
    color: #fff;
    background: rgba(255, 255, 255, 0.12);
  }
  /* Documents and players: a panel between the toolbar and the info bar. */
  .sheet {
    position: absolute;
    top: 60px;
    bottom: 110px;
    left: 50%;
    transform: translateX(-50%);
    width: min(1100px, calc(100% - 140px));
    border-radius: 10px;
    overflow: hidden;
    background: #fff;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
  }
  .sheet.dark {
    background: #2a2a28;
  }
  .sheet.media {
    display: grid;
    place-items: center;
    background: #000;
    box-shadow: none;
    width: calc(100% - 140px);
  }
  .sheet.media video {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .sheet.audio {
    background: transparent;
    align-content: center;
    gap: 24px;
    color: #8a8a85;
  }
  .sheet.audio audio {
    width: min(520px, 90%);
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
