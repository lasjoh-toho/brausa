<script lang="ts">
  // Configurable N×M grid of standard drop targets. Opens while dragging when the
  // pointer touches the "Ablage" toolbar button.
  import { scale } from 'svelte/transition';
  import { app } from '../state/app.svelte';
  import { drag } from '../state/drag.svelte';
  import { tagColor } from '../core/tags';
  import Icon from './Icon.svelte';

  const cfg = $derived(app.gridConfig);
  const cells = $derived(Array.from({ length: cfg.cols * cfg.rows }, (_, i) => cfg.cells[i] ?? null));
</script>

{#if drag.active && drag.gridOpen}
  <div class="backdrop">
    <div
      class="grid"
      style:grid-template-columns="repeat({cfg.cols}, 1fr)"
      transition:scale={{ start: 0.94, duration: 160 }}
    >
      {#each cells as c, i (i)}
        {#if c}
          <div
            class="cell"
            class:tag={!!c.tag}
            class:hit={drag.hit?.kind === 'grid-cell' && drag.hit.cell === i}
            data-drop="grid-cell"
            data-cell={i}
            style:--c={c.tag ? tagColor(c.tag) : 'var(--accent)'}
          >
            <Icon name={c.tag ? 'tag' : 'folder'} size={22} />
            <span class="label">{c.label}</span>
            {#if c.path}<span class="sub">{c.path.split(/[\\/]/).slice(-2).join('/')}</span>{/if}
          </div>
        {:else}
          <div class="cell empty"></div>
        {/if}
      {/each}
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: absolute;
    inset: var(--toolbar-h) 0 0 0;
    z-index: 55;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--bg) 55%, transparent);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
  }
  .grid {
    display: grid;
    gap: 12px;
    width: min(760px, calc(100% - 48px));
  }
  .cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 128px;
    border-radius: 16px;
    background: var(--bg-elev);
    box-shadow:
      var(--shadow),
      0 0 0 1px var(--line);
    color: var(--fg-muted);
    transition:
      transform 0.12s,
      background 0.12s,
      color 0.12s;
  }
  .cell.hit {
    transform: scale(1.04);
    background: var(--c);
    color: #fff;
  }
  .cell.empty {
    background: none;
    box-shadow: inset 0 0 0 1.5px var(--line);
    border-style: dashed;
  }
  .label {
    font-weight: 600;
    font-size: 14px;
    color: inherit;
  }
  .cell:not(.hit) .label {
    color: var(--fg);
  }
  .sub {
    font-size: 11px;
    opacity: 0.7;
  }
</style>
