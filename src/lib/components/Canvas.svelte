<script lang="ts">
  import { app } from '../state/app.svelte';
  import { drag } from '../state/drag.svelte';
  import { tagColor } from '../core/tags';
  import { UNTAGGED } from '../core/views';
  import { isToggleKey } from '../platform';
  import Tile from './Tile.svelte';
  import MapView from './MapView.svelte';

  let el: HTMLElement;
  let lasso = $state<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  /** Rubber-band selection on empty canvas space. */
  function down(e: PointerEvent) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.tile, button, input')) return;
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
  role="listbox"
  aria-multiselectable="true"
  tabindex="-1"
>
  {#if app.view === 'map'}
    <MapView />
  {:else if app.view === 'kanban'}
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
    {#each app.groups as g (g.key)}
      {#if app.view === 'timeline'}
        <h3 class="group-head"><span>{g.label}</span><span class="count">{g.entries.length}</span></h3>
      {/if}
      <div class="grid">
        {#each g.entries as e (e.path)}
          <Tile entry={e} />
        {/each}
      </div>
    {/each}
    {#if !app.visible.length && !app.loading}
      <p class="empty">
        {app.search ? 'Nichts gefunden.' : 'Dieser Ordner ist leer.'}
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
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--tile), 1fr));
    gap: 4px;
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
