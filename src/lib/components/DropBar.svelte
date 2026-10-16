<script lang="ts">
  // Breadcrumb drop bar: while dragging, shows the path of the folder under the
  // pointer (or the current folder); every segment is a drop target.
  import { fly } from 'svelte/transition';
  import { app } from '../state/app.svelte';
  import { drag } from '../state/drag.svelte';
  import { crumbs } from '../core/paths';
  import Icon from './Icon.svelte';

  const trail = $derived(crumbs(drag.trail ?? app.funnel ?? app.cwd, app.home));
</script>

{#if drag.active}
  <div class="bar" transition:fly={{ y: -12, duration: 160 }}>
    <Icon name="folder" size={14} />
    {#each trail as c, i (c.path)}
      {#if i > 0}<span class="sep">›</span>{/if}
      <div
        class="crumb"
        class:hit={drag.hit?.kind === 'crumb' && drag.hit.path === c.path}
        data-drop="crumb"
        data-path={c.path}
      >
        {c.name}
      </div>
    {/each}
  </div>
{/if}

<style>
  .bar {
    position: absolute;
    top: calc(var(--toolbar-h) + 10px);
    left: 50%;
    z-index: 60;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 2px;
    max-width: calc(100% - 40px);
    padding: 4px 6px 4px 12px;
    border-radius: 12px;
    background: color-mix(in srgb, var(--bg-elev) 90%, transparent);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    box-shadow:
      var(--shadow),
      0 0 0 1px var(--line);
    color: var(--fg-muted);
    overflow: hidden;
  }
  .crumb {
    padding: 6px 10px;
    border-radius: 8px;
    white-space: nowrap;
    transition:
      background 0.1s,
      color 0.1s;
  }
  .crumb:last-child {
    color: var(--fg);
    font-weight: 600;
  }
  .crumb.hit {
    background: var(--accent);
    color: #fff;
  }
  .sep {
    color: var(--fg-faint);
  }
</style>
