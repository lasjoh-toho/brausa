<script lang="ts">
  import { drag } from '../state/drag.svelte';
  import { copyLabel } from '../platform';

  const stack = $derived(drag.items.slice(0, 3));
</script>

{#if drag.active}
  <div class="ghost" style:transform="translate({drag.x + 14}px, {drag.y + 14}px)">
    <div class="stack">
      {#each stack as e, i (e.path)}
        <div class="card" style:rotate="{(i - 1) * 5}deg" style:z-index={3 - i}>
          {#if e.thumb}<img src={e.thumb} alt="" />{:else}<span>{e.ext || '▢'}</span>{/if}
        </div>
      {/each}
      {#if drag.items.length > 1}<span class="badge">{drag.items.length}</span>{/if}
    </div>
    {#if drag.label}
      <div class="label" class:copy={drag.copy}>{drag.label}</div>
    {:else}
      <div class="label hint">{copyLabel} = kopieren · Esc = abbrechen</div>
    {/if}
  </div>
{/if}

<style>
  .ghost {
    position: fixed;
    left: 0;
    top: 0;
    z-index: 1000;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    pointer-events: none;
  }
  .stack {
    position: relative;
    width: 64px;
    height: 64px;
  }
  .card {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    border-radius: 10px;
    overflow: hidden;
    background: var(--bg-elev);
    box-shadow: var(--shadow);
    border: 2px solid var(--bg-elev);
    font-family: var(--mono);
    font-size: 10px;
    color: var(--fg-faint);
    text-transform: uppercase;
  }
  .card img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .badge {
    position: absolute;
    top: -8px;
    right: -8px;
    z-index: 5;
    min-width: 22px;
    height: 22px;
    padding: 0 6px;
    border-radius: 11px;
    background: var(--accent);
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    display: grid;
    place-items: center;
  }
  .label {
    margin-top: 18px;
    padding: 5px 9px;
    border-radius: 8px;
    background: var(--fg);
    color: var(--bg);
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    box-shadow: var(--shadow);
  }
  .label.copy {
    background: #15803d;
    color: #fff;
  }
  .label.hint {
    background: var(--bg-elev);
    color: var(--fg-muted);
  }
</style>
