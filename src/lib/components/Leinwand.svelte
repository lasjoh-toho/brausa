<script lang="ts">
  import { untrack } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import type { Entry } from '../core/types';
  import { app } from '../state/app.svelte';
  import { drag } from '../state/drag.svelte';
  import { basename } from '../core/paths';
  import { formatSize } from '../core/format';
  import { copyLabel, isToggleKey, store } from '../platform';
  import { closeWin, edge, fit, layout, toggleWin, winHeight, zoomAt, LAYOUTS, WIN, type Box, type LeinwandLayout, type OpenWin, type Point } from '../core/leinwand';
  import Icon from './Icon.svelte';
  import { t, loc } from '../i18n/index.svelte';

  /** What is remembered per root folder: open windows, layout, windows moved by hand. */
  interface Saved {
    wins: OpenWin[];
    mode: LeinwandLayout;
    moved: Record<string, Point>;
  }
  const KEY = 'leinwand';
  const saved = (): Record<string, Saved> => store.get(KEY, {});

  let el: HTMLElement;
  let vw = $state(800);
  let vh = $state(600);

  const roots = $derived(app.currentProject ? app.currentProject.folders : [app.cwd]);
  const rootKey = $derived(app.currentProject ? 'project:' + app.currentProject.id : app.cwd);

  let wins = $state<OpenWin[]>([]);
  let mode = $state<LeinwandLayout>(store.get('leinwandMode', 'right'));
  let moved = $state<Record<string, Point>>({});
  let view = $state({ x: 40, y: 40, z: 1 });
  /** Fit the view once the windows of a new root have their sizes. */
  let fitPending = true;

  const lists = new SvelteMap<string, Entry[]>();
  const scrolls = new SvelteMap<string, number>();

  // Another folder or project: take up what was open there last time.
  $effect(() => {
    const key = rootKey;
    const rs = roots;
    const s = saved()[key];
    const keep = s?.wins.filter((w) => w.parent !== null || rs.includes(w.path)) ?? [];
    wins = [...rs.filter((r) => !keep.some((w) => w.path === r)).map((r) => ({ path: r, parent: null })), ...keep];
    if (s?.mode) mode = s.mode;
    moved = s?.moved ?? {};
    fitPending = true;
  });

  function persist() {
    const all = saved();
    all[rootKey] = { wins, mode, moved };
    store.set(KEY, all);
  }

  // Every open window lists its folder; again after brausa changed files.
  $effect(() => {
    void app.fsVersion;
    const paths = wins.map((w) => w.path);
    const hidden = app.showSystem && app.systemAllowed;
    untrack(() => {
      for (const p of [...lists.keys()]) if (!paths.includes(p)) lists.delete(p);
    });
    for (const p of paths)
      app.backend
        .listDir(p, { includeHidden: hidden })
        .then((es) => lists.set(p, sortEntries(es)))
        .catch(() => {
          // The folder is gone (moved, drive removed): close its window.
          if (!roots.includes(p)) wins = closeWin(wins, p);
          lists.delete(p);
        });
  });

  // The context menu and the selection know the entries of all windows.
  $effect(() => {
    app.shownElsewhere = [...lists.values()].flat();
    return () => (app.shownElsewhere = []);
  });

  function sortEntries(es: Entry[]): Entry[] {
    return [...es].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, loc(), { numeric: true }) : a.kind === 'dir' ? -1 : 1));
  }

  const size = (p: string) => ({ w: WIN.w, h: winHeight(lists.get(p)?.length ?? 0) });
  const rowOf = (w: OpenWin) => (w.parent ? (lists.get(w.parent)?.findIndex((e) => e.path === w.path) ?? 0) : 0);
  const auto = $derived(layout(wins, mode, size, rowOf));
  const boxes = $derived(
    new Map<string, Box>(wins.map((w) => [w.path, { ...(moved[w.path] ?? auto.get(w.path) ?? { x: 0, y: 0 }), ...size(w.path) }]))
  );

  /** Each open subfolder gets its own colour: its row, its line and its window frame. */
  const HUES = [140, 212, 0, 36, 280, 186, 330, 90];
  const hue = $derived(new Map(wins.filter((w) => w.parent).map((w, i) => [w.path, HUES[i % HUES.length]])));

  const lines = $derived(
    wins
      .filter((w) => w.parent && boxes.has(w.parent))
      .map((w) => {
        const row = rowOf(w);
        const e = edge(boxes.get(w.parent!)!, row < 0 ? 1e6 : row, scrolls.get(w.parent!) ?? 0, boxes.get(w.path)!);
        return { key: w.path, hue: hue.get(w.path) ?? 212, d: `M${e.from.x},${e.from.y} C${e.c1.x},${e.c1.y} ${e.c2.x},${e.c2.y} ${e.to.x},${e.to.y}` };
      })
  );

  $effect(() => {
    if (!fitPending || !wins.every((w) => lists.has(w.path))) return;
    fitPending = false;
    showAll();
  });

  function showAll() {
    view = fit([...boxes.values()], vw, vh, 40, 1);
  }

  function setMode(m: LeinwandLayout) {
    mode = m;
    moved = {};
    store.set('leinwandMode', m);
    persist();
    requestAnimationFrame(showAll);
  }

  function rearrange() {
    moved = {};
    persist();
    requestAnimationFrame(showAll);
  }

  function zoomBy(f: number, px = vw / 2, py = vh / 2) {
    view = zoomAt(view, px, py, f);
  }

  // ------------------------------------------------------------ pointer

  function wheel(e: WheelEvent) {
    const r = el.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      return zoomBy(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
    }
    // Inside a window that can still scroll, the list scrolls; otherwise the view pans.
    const rows = (e.target as HTMLElement).closest<HTMLElement>('.rows');
    if (rows && view.z >= FAR) {
      const canDown = rows.scrollTop + rows.clientHeight < rows.scrollHeight - 1;
      const canUp = rows.scrollTop > 0;
      if ((e.deltaY > 0 && canDown) || (e.deltaY < 0 && canUp)) return;
    }
    e.preventDefault();
    view = { ...view, x: view.x - e.deltaX, y: view.y - e.deltaY };
  }

  /** Dragging empty space pans the view. */
  function down(e: PointerEvent) {
    if (e.button !== 0 && e.button !== 1) return;
    if ((e.target as HTMLElement).closest('.win, .bar')) return;
    e.preventDefault();
    if (!e.shiftKey && !isToggleKey(e)) app.selection.clear();
    const sx = e.clientX - view.x;
    const sy = e.clientY - view.y;
    el.classList.add('panning');
    const move = (ev: PointerEvent) => (view = { ...view, x: ev.clientX - sx, y: ev.clientY - sy });
    const up = () => {
      el.classList.remove('panning');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /** The title bar moves a window; it then stays where it was put. */
  function moveWin(e: PointerEvent, path: string) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const b = boxes.get(path)!;
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (ev: PointerEvent) => (moved = { ...moved, [path]: { x: b.x + (ev.clientX - sx) / view.z, y: b.y + (ev.clientY - sy) / view.z } });
    const up = () => {
      persist();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function itemsFor(e: Entry): Entry[] {
    return app.selection.has(e.path) ? app.selectedEntries : [e];
  }

  function clickRow(ev: PointerEvent, e: Entry, win: string) {
    if (ev.shiftKey || isToggleKey(ev)) return app.select(e.path, 'toggle');
    app.select(e.path, 'replace');
    if (e.kind === 'dir') {
      wins = toggleWin(wins, e.path, win);
      persist();
    }
  }

  function close(path: string) {
    wins = closeWin(wins, path);
    const { [path]: _, ...rest } = moved;
    moved = rest;
    persist();
  }

  function stamp(ms: number) {
    return ms ? new Date(ms).toLocaleString(loc(), { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  }

  /** Below this zoom the windows only show name and counts: details shrink away, the overview stays. */
  const FAR = 0.45;
  const far = $derived(view.z < FAR);
  const copyKey = copyLabel;
</script>

<section
  class="lw"
  bind:this={el}
  bind:clientWidth={vw}
  bind:clientHeight={vh}
  onwheel={wheel}
  onpointerdown={down}
  oncontextmenu={(e) => e.preventDefault()}
  style:--z={view.z}
  style:background-position="{view.x}px {view.y}px"
  style:background-size="{24 * view.z}px {24 * view.z}px"
  role="application"
>
  <div class="bar">
    <div class="group">
      {#each LAYOUTS as m (m)}
        <button class="ib" class:on={mode === m} title={t('leinwand.' + m)} onclick={() => setMode(m)}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            {#if m === 'right'}<path d="M3 9h5v6H3zM16 3h5v5h-5zM16 16h5v5h-5zM8 12h4M12 5.5v13M12 5.5h4M12 18.5h4" />
            {:else if m === 'down'}<path d="M9 3h6v5H9zM3 16h5v5H3zM16 16h5v5h-5zM12 8v4M5.5 12h13M5.5 12v4M18.5 12v4" />
            {:else}<path d="M9.5 9.5h5v5h-5zM3 3h4v4H3zM17 3h4v4h-4zM3 17h4v4H3zM17 17h4v4h-4zM7 7l2.5 2.5M17 7l-2.5 2.5M7 17l2.5-2.5M17 17l-2.5-2.5" />{/if}
          </svg>
        </button>
      {/each}
      <span class="sep"></span>
      <button class="ib" title={t('leinwand.rearrange')} onclick={rearrange}><Icon name="tree" size={17} /></button>
    </div>
    <div class="group">
      <button class="ib" title={t('leinwand.zoomOut')} onclick={() => zoomBy(1 / 1.25)}>−</button>
      <button class="pct" title={t('leinwand.fit')} onclick={showAll}>{Math.round(view.z * 100)} %</button>
      <button class="ib" title={t('leinwand.zoomIn')} onclick={() => zoomBy(1.25)}>+</button>
    </div>
  </div>

  <div class="world" style:transform="translate({view.x}px, {view.y}px) scale({view.z})">
    <svg class="lines" width="1" height="1" overflow="visible">
      {#each lines as l (l.key)}
        <path d={l.d} style:stroke="hsl({l.hue} 55% 55%)" />
      {/each}
    </svg>

    {#each wins as w (w.path)}
      {@const b = boxes.get(w.path)}
      {@const list = lists.get(w.path) ?? []}
      {@const h = hue.get(w.path)}
      {@const hit = drag.active && drag.hit?.kind === 'folder' && drag.hit.path === w.path}
      {#if b}
        <div
          class="win"
          class:far
          class:hit
          style:left="{b.x}px"
          style:top="{b.y}px"
          style:width="{b.w}px"
          style:height="{b.h}px"
          style:--hue={h ?? ''}
          class:tinted={h !== undefined}
          data-drop="folder"
          data-path={w.path}
        >
          <div class="title" role="presentation" onpointerdown={(e) => moveWin(e, w.path)} ondblclick={() => app.navigate(w.path)}>
            <Icon name="folder" size={14} />
            <span class="tname">{basename(w.path) || w.path}</span>
            <span class="count">{list.length}</span>
            {#if w.parent}<button class="x" title={t('leinwand.close')} onclick={() => close(w.path)}><Icon name="x" size={12} /></button>{/if}
          </div>
          {#if far}
            <div class="summary">
              <div class="big">{basename(w.path) || w.path}</div>
              <div>{t('leinwand.summary', { dirs: list.filter((e) => e.kind === 'dir').length, files: list.filter((e) => e.kind === 'file').length })}</div>
            </div>
          {:else}
            <div class="cols">
              <span>{t('leinwand.name')}</span><span class="r">{t('leinwand.size')}</span><span>{t('leinwand.modified')}</span>
            </div>
            <div class="rows" data-autoscroll onscroll={(e) => scrolls.set(w.path, (e.currentTarget as HTMLElement).scrollTop)}>
              {#each list as e (e.path)}
                {@const open = hue.get(e.path)}
                {@const rowHit = e.kind === 'dir' && drag.active && drag.hit?.kind === 'folder' && drag.hit.path === e.path}
                <div
                  class="row"
                  class:sel={app.selection.has(e.path)}
                  class:open={open !== undefined}
                  class:hit={rowHit}
                  style:--hue={open ?? ''}
                  role="option"
                  aria-selected={app.selection.has(e.path)}
                  tabindex="-1"
                  title={e.path}
                  data-path={e.path}
                  data-drop={e.kind === 'dir' ? 'folder' : undefined}
                  onpointerdown={(ev) => drag.begin(ev, () => itemsFor(e), 'leinwand', (up) => clickRow(up, e, w.path))}
                  ondblclick={() => (e.kind === 'dir' ? app.navigate(e.path) : app.open(e))}
                  oncontextmenu={(ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    if (!app.selection.has(e.path)) app.select(e.path, 'replace');
                    app.menu = { x: ev.clientX, y: ev.clientY, entry: e };
                  }}
                >
                  <span class="n"><Icon name={e.kind === 'dir' ? 'folder' : 'file'} size={13} />{e.name}</span>
                  <span class="r">{e.kind === 'dir' ? '–' : formatSize(e.size)}</span>
                  <span class="d">{stamp(e.mtime)}</span>
                </div>
              {:else}
                <div class="none">{t('leinwand.empty')}</div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    {/each}
  </div>

  <p class="hint">{t('leinwand.hint', { key: copyKey })}</p>
</section>

<style>
  .lw {
    position: relative;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    background-color: var(--bg);
    background-image: radial-gradient(circle, var(--line) 1.2px, transparent 1.3px);
    cursor: default;
    touch-action: none;
  }
  .lw:global(.panning) {
    cursor: grabbing;
  }
  .world {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
  }
  .lines {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
  }
  .lines path {
    fill: none;
    stroke-width: calc(1.6px / var(--z));
    stroke-linecap: round;
  }
  .win {
    position: absolute;
    display: flex;
    flex-direction: column;
    border-radius: 9px;
    border: 1px solid var(--line);
    background: var(--bg-elev);
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18);
    overflow: hidden;
    font-size: 13px;
  }
  .win.tinted {
    border-color: hsl(var(--hue) 50% 50% / 0.8);
  }
  .win.hit {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .title {
    flex: none;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 0 10px;
    font-weight: 600;
    border-bottom: 1px solid var(--line);
    cursor: grab;
    position: relative;
  }
  .tname {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .title .count {
    position: absolute;
    right: 30px;
    font-size: 11px;
    font-weight: 400;
    color: var(--fg-faint);
  }
  .title .x {
    position: absolute;
    right: 6px;
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border: 0;
    border-radius: 5px;
    background: none;
    color: var(--fg-faint);
    cursor: pointer;
  }
  .title .x:hover {
    background: var(--bg-sunken);
    color: var(--fg);
  }
  .cols,
  .row {
    display: grid;
    grid-template-columns: 1fr 74px 118px;
    gap: 8px;
    align-items: center;
    padding: 0 10px;
  }
  .cols {
    flex: none;
    height: 22px;
    font-size: 11px;
    color: var(--fg-faint);
    border-bottom: 1px solid var(--line);
  }
  .rows {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-bottom: 6px;
  }
  .row {
    height: 26px;
    cursor: default;
    white-space: nowrap;
  }
  .row:nth-child(even) {
    background: color-mix(in srgb, var(--bg-sunken) 55%, transparent);
  }
  .row.open {
    background: hsl(var(--hue) 50% 45% / 0.28);
  }
  .row.sel {
    background: var(--accent-soft);
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .row.hit {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .n {
    display: flex;
    align-items: center;
    gap: 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .n :global(svg) {
    flex: none;
    color: var(--fg-faint);
  }
  .r {
    text-align: right;
    color: var(--fg-muted);
    font-variant-numeric: tabular-nums;
  }
  .d {
    color: var(--fg-muted);
    font-variant-numeric: tabular-nums;
  }
  .none {
    padding: 8px 10px;
    color: var(--fg-faint);
  }
  .summary {
    flex: 1;
    display: grid;
    place-content: center;
    text-align: center;
    gap: 0.3em;
    padding: 0 8px;
    overflow: hidden;
    color: var(--fg-muted);
    font-size: calc(11px / var(--z));
    line-height: 1.2;
  }
  .summary .big {
    font-size: 1.35em;
    font-weight: 600;
    color: var(--fg);
  }
  .win.far .title {
    visibility: hidden;
  }
  .bar {
    position: absolute;
    top: 10px;
    right: 12px;
    z-index: 2;
    display: flex;
    gap: 8px;
  }
  .group {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: var(--bg-elev);
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
  }
  .ib,
  .pct {
    display: grid;
    place-items: center;
    min-width: 30px;
    height: 28px;
    padding: 0 6px;
    border: 0;
    border-radius: 999px;
    background: none;
    color: var(--fg-muted);
    font-size: 15px;
    cursor: pointer;
  }
  .pct {
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    min-width: 52px;
  }
  .ib:hover,
  .pct:hover {
    background: var(--bg-sunken);
    color: var(--fg);
  }
  .ib.on {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .sep {
    width: 1px;
    height: 18px;
    margin: 0 3px;
    background: var(--line);
  }
  .hint {
    position: absolute;
    left: 14px;
    bottom: 8px;
    margin: 0;
    font-size: 11px;
    color: var(--fg-faint);
    pointer-events: none;
  }
</style>
