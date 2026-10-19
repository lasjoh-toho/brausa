<script lang="ts">
  import { app } from '../state/app.svelte';
  import { drag } from '../state/drag.svelte';
  import { tagColor } from '../core/tags';
  import { UNTAGGED, within } from '../core/views';
  import { Shown } from './more.svelte';
  import { WALK_LIMIT } from '../backend/types';
  import { isToggleKey } from '../platform';
  import { extras, waste } from '../core/dupes';
  import { formatSize } from '../core/format';
  import Icon from './Icon.svelte';
  import Tile from './Tile.svelte';
  import MapView from './MapView.svelte';
  import CalendarView from './CalendarView.svelte';
  import FileList from './FileList.svelte';
  import ProjectStart from './ProjectStart.svelte';
  import NoResults from './NoResults.svelte';
  import PreviewPane from './PreviewPane.svelte';
  import { t, tn, loc } from '../i18n/index.svelte';

  let el: HTMLElement;

  // Draw tiles page by page; a new folder or filter starts at the first page again.
  const shown = new Shown();
  $effect(() => {
    void app.viewKey;
    shown.reset();
  });
  const total = $derived(app.groups.reduce((n, g) => n + g.entries.length, 0));
  const drawn = $derived(within(app.groups, shown.limit));
  let lasso = $state<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  /** ⌘/Ctrl + scroll (or pinch) sizes the tiles; beyond the largest size the selected file opens full screen. */
  function wheel(e: WheelEvent) {
    if (!(e.ctrlKey || e.metaKey) || app.view === 'panes' || app.view === 'table' || app.view === 'map') return;
    e.preventDefault();
    app.zoomTiles(e.deltaY);
  }

  /** Rubber-band selection on empty canvas space. */
  function down(e: PointerEvent) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.tile, button, input, .cal, .leaflet-container, .pv')) return;
    const additive = e.shiftKey || isToggleKey(e);
    const base = additive ? new Set(app.selection) : new Set<string>();
    if (!additive) app.selection.clear();
    const r0 = el.getBoundingClientRect();
    const sx = e.clientX - r0.left + el.scrollLeft;
    const sy = e.clientY - r0.top + el.scrollTop;
    lasso = { x0: sx, y0: sy, x1: sx, y1: sy };

    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      lasso = { x0: sx, y0: sy, x1: ev.clientX - r.left + el.scrollLeft, y1: ev.clientY - r.top + el.scrollTop };
      const L = Math.min(lasso.x0, lasso.x1) + r.left - el.scrollLeft;
      const T = Math.min(lasso.y0, lasso.y1) + r.top - el.scrollTop;
      const R = Math.max(lasso.x0, lasso.x1) + r.left - el.scrollLeft;
      const B = Math.max(lasso.y0, lasso.y1) + r.top - el.scrollTop;
      const hits = new Set(base);
      for (const t of el.querySelectorAll<HTMLElement>('.tile[data-path]')) {
        const b = t.getBoundingClientRect();
        if (b.right > L && b.left < R && b.bottom > T && b.top < B) hits.add(t.dataset.path!);
      }
      app.setSelection(hits);
      if (ev.clientY > r.bottom - 30) el.scrollTop += 12;
      else if (ev.clientY < r.top + 30) el.scrollTop -= 12;
    };
    const up = () => {
      lasso = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const extraCount = $derived(app.dupes ? extras(app.dupeGroups).length : 0);
  const canvasHit = $derived(drag.active && drag.hit?.kind === 'canvas' && drag.source !== 'canvas');
</script>

<section
  class="canvas"
  class:hit={canvasHit}
  class:panes={(app.view === 'panes' || app.view === 'table') && !app.dupes}
  bind:this={el}
  data-drop="canvas"
  data-autoscroll
  style:--tile="{app.tileSize}px"
  onpointerdown={down}
  onwheel={wheel}
  oncontextmenu={(e) => {
    if ((e.target as HTMLElement).closest('.tile, .cal, .leaflet-container, .pv')) return;
    e.preventDefault();
    app.menu = { x: e.clientX, y: e.clientY, entry: null };
  }}
  role="listbox"
  aria-multiselectable="true"
  tabindex="-1"
>
  {#if app.stuck}
    {@const s = app.stuck}
    <div class="dupebar stuckbar">
      <Icon name="warn" size={15} />
      <span>{t('files.stuck', { place: app.stuckPlace(s) })}</span>
      <span class="grow"></span>
      <button class="btn primary" onclick={() => app.resumeStuck()}>{t('files.stuckResume', { place: app.stuckPlace(s) })}</button>
      <button class="btn" onclick={() => (app.stuck = null)}>{t('common.close')}</button>
    </div>
  {/if}
  {#if app.truncated && !app.dupes}
    <p class="truncated"><Icon name="warn" size={13} />{t('files.truncated', { n: WALK_LIMIT.toLocaleString(loc()) })}</p>
  {/if}
  {#if app.dupes}
    <div class="dupebar">
      <Icon name="copy" size={15} />
      {#if app.dupeGroups.length}
        <span
          ><b>{tn('files.dupeExtras', extraCount)}</b>
          {t('files.dupeSummary', { groups: tn('files.dupeGroups', app.dupeGroups.length), size: formatSize(waste(app.dupeGroups)) })}</span
        >
        <span class="grow"></span>
        <button
          class="btn"
          title={t('files.selectExtrasHint')}
          onclick={() => app.selectExtras()}>{t('files.selectExtras')}</button
        >
      {:else}
        <span>{t('files.noDupes')}</span>
        <span class="grow"></span>
      {/if}
      <button class="btn" onclick={() => app.endDuplicates()}>{t('common.done')}</button>
    </div>
  {/if}
  {#if app.view === 'start' && app.currentProject && !app.dupes}
    <ProjectStart />
  {:else if app.view === 'panes' && !app.dupes}
    <FileList />
    <PreviewPane />
  {:else if app.view === 'table' && !app.dupes}
    <FileList table />
  {:else if app.view === 'kanban' && !app.dupes}
    <div class="kanban">
      {#each app.groups as g (g.key)}
        {@const hit = drag.active && drag.hit?.kind === 'column' && drag.hit.key === g.key}
        <div class="col" class:hit data-drop="column" data-key={g.key}>
          <div class="col-head">
            {#if app.kanbanBy === 'tag' && g.key !== UNTAGGED}<span class="dot" style:background={tagColor(g.label)}></span>{/if}
            <span class="col-title">{g.label}</span>
            <span class="count">{g.entries.length}</span>
          </div>
          <div class="col-body">
            {#each g.entries.slice(0, shown.limit) as e (e.path)}
              <Tile entry={e} source={'column:' + g.key} compact />
            {/each}
            {#if g.entries.length > shown.limit}<div class="more" use:shown.sentinel></div>{/if}
          </div>
        </div>
      {:else}
        {#if app.activeFilters.length}<NoResults />{:else}<p class="empty">{t('files.noFiles')}</p>{/if}
      {/each}
    </div>
  {:else}
    {#if app.view === 'calendar' && !app.dupes}<CalendarView />{/if}
    {#if app.view === 'map' && !app.dupes}<MapView />{/if}
    {#each drawn as g (g.key)}
      {#if app.view === 'timeline' || app.dupes}
        <h3 class="group-head" class:plain={!!app.dupes}><span>{g.label}</span><span class="count">{g.entries.length}</span></h3>
      {/if}
      <div class="grid">
        {#each g.entries as e (e.path)}
          <Tile entry={e} />
        {/each}
      </div>
    {/each}
    {#if total > shown.limit}
      {#key shown.limit}<div class="more" use:shown.sentinel>{t('files.moreBelow', { n: (total - shown.limit).toLocaleString(loc()) })}</div>{/key}
    {/if}
    {#if !app.visible.length && !app.loading && app.activeFilters.length}
      <NoResults />
    {:else if !app.visible.length && !app.loading}
      <p class="empty">
        {app.search ? t('files.nothingFound') : app.project ? t('files.projectEmpty') : t('files.folderEmpty')}
        {#if !app.recursive}<button class="btn" onclick={() => app.setRecursive(true)}>{t('files.showStream')}</button>{/if}
      </p>
    {/if}
  {/if}

  {#if lasso}
    <div
      class="lasso"
      style:left="{Math.min(lasso.x0, lasso.x1)}px"
      style:top="{Math.min(lasso.y0, lasso.y1)}px"
      style:width="{Math.abs(lasso.x1 - lasso.x0)}px"
      style:height="{Math.abs(lasso.y1 - lasso.y0)}px"
    ></div>
  {/if}
</section>

<style>
  .canvas {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 14px 16px 104px;
    outline: none;
    transition: box-shadow 0.15s;
  }
  /* Three-panel and table view: the list (and preview) scroll on their own. */
  .canvas.panes {
    display: flex;
    padding: 0;
    overflow: hidden;
  }
  .canvas.hit {
    box-shadow: inset 0 0 0 2px var(--accent);
    background: color-mix(in srgb, var(--accent-soft) 40%, transparent);
  }
  .dupebar {
    position: sticky;
    top: -14px;
    z-index: 3;
    display: flex;
    align-items: center;
    gap: 10px;
    margin: -14px -16px 12px;
    padding: 9px 16px;
    font-size: 13px;
    color: var(--fg-muted);
    background: color-mix(in srgb, var(--bg) 88%, transparent);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--line);
  }
  .dupebar b {
    color: var(--fg);
    font-weight: 600;
  }
  .grow {
    flex: 1;
  }
  .truncated {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 0 10px;
    font-size: 12px;
    color: var(--fg-muted);
  }
  .more {
    padding: 18px 0;
    text-align: center;
    font-size: 12px;
    color: var(--fg-faint);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--tile), 1fr));
    gap: 4px;
  }
  .group-head.plain {
    position: static;
  }
  .group-head {
    position: sticky;
    top: -14px;
    z-index: 2;
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 18px 0 8px;
    padding: 8px 6px;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.01em;
    background: var(--bg);
  }
  .group-head:first-child {
    margin-top: 0;
  }
  .count {
    font-size: 11px;
    font-weight: 500;
    color: var(--fg-faint);
  }
  .kanban {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    min-height: 100%;
  }
  .col {
    flex: 0 0 calc(var(--tile) + 60px);
    display: flex;
    flex-direction: column;
    border-radius: 14px;
    background: var(--bg-sunken);
    max-height: 100%;
    transition: box-shadow 0.12s;
  }
  .col.hit {
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .col-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 12px 12px 6px;
    font-weight: 600;
  }
  .col-title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .col-body {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(calc(var(--tile) * 0.55), 1fr));
    gap: 2px;
    padding: 4px 6px 10px;
    min-height: 80px;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    margin-top: 80px;
    color: var(--fg-faint);
    text-align: center;
    width: 100%;
  }
  .lasso {
    position: absolute;
    z-index: 5;
    border: 1px solid var(--accent);
    background: var(--accent-soft);
    border-radius: 4px;
    pointer-events: none;
  }
</style>
