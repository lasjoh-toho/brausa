<script lang="ts">
  import { app } from '../state/app.svelte';
  import { drag } from '../state/drag.svelte';
  import { tagColor } from '../core/tags';
  import { UNTAGGED } from '../core/views';
  import { isToggleKey } from '../platform';
  import { extras, waste } from '../core/dupes';
  import { formatSize } from '../core/format';
  import Icon from './Icon.svelte';
  import Tile from './Tile.svelte';
  import MapView from './MapView.svelte';
  import CalendarView from './CalendarView.svelte';

  let el: HTMLElement;
  let lasso = $state<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  /** Rubber-band selection on empty canvas space. */
  function down(e: PointerEvent) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.tile, button, input, .cal, .leaflet-container')) return;
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
  bind:this={el}
  data-drop="canvas"
  data-autoscroll
  style:--tile="{app.tileSize}px"
  onpointerdown={down}
  oncontextmenu={(e) => {
    if ((e.target as HTMLElement).closest('.tile, .cal, .leaflet-container')) return;
    e.preventDefault();
    app.menu = { x: e.clientX, y: e.clientY, entry: null };
  }}
  role="listbox"
  aria-multiselectable="true"
  tabindex="-1"
>
  {#if app.dupes}
    <div class="dupebar">
      <Icon name="copy" size={15} />
      {#if app.dupeGroups.length}
        <span
          ><b>{extraCount} überzählige {extraCount === 1 ? 'Kopie' : 'Kopien'}</b> in {app.dupeGroups.length}
          {app.dupeGroups.length === 1 ? 'Gruppe' : 'Gruppen'} · {formatSize(waste(app.dupeGroups))} frei zu machen</span
        >
        <span class="grow"></span>
        <button
          class="btn"
          title="Je Gruppe bleibt eine Datei stehen: nicht wie eine Kopie benannt, sonst die älteste. Danach Entf legt die Auswahl in den Papierkorb."
          onclick={() => app.selectExtras()}>Überzählige auswählen</button
        >
      {:else}
        <span>Keine Duplikate mehr.</span>
        <span class="grow"></span>
      {/if}
      <button class="btn" onclick={() => app.endDuplicates()}>Fertig</button>
    </div>
  {/if}
  {#if app.view === 'kanban' && !app.dupes}
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
            {#each g.entries as e (e.path)}
              <Tile entry={e} source={'column:' + g.key} compact />
            {/each}
          </div>
        </div>
      {:else}
        <p class="empty">Keine Dateien</p>
      {/each}
    </div>
  {:else}
    {#if app.view === 'calendar' && !app.dupes}<CalendarView />{/if}
    {#if app.view === 'map' && !app.dupes}<MapView />{/if}
    {#each app.groups as g (g.key)}
      {#if app.view === 'timeline' || app.dupes}
        <h3 class="group-head" class:plain={!!app.dupes}><span>{g.label}</span><span class="count">{g.entries.length}</span></h3>
      {/if}
      <div class="grid">
        {#each g.entries as e (e.path)}
          <Tile entry={e} />
        {/each}
      </div>
    {/each}
    {#if !app.visible.length && !app.loading}
      <p class="empty">
        {app.search ? 'Nichts gefunden.' : app.project ? 'Das Projekt ist noch leer. Dateien und Ordner von überall hierher oder auf das Projekt in der Seitenleiste ziehen; sie bleiben, wo sie sind.' : 'Dieser Ordner ist leer.'}
        {#if !app.recursive}<button class="btn" onclick={() => app.setRecursive(true)}>Unterordner als Stream zeigen</button>{/if}
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
