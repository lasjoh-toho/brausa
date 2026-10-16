<script lang="ts">
  import { slide } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import type { Entry } from '../core/types';
  import { app } from '../state/app.svelte';
  import { drag } from '../state/drag.svelte';
  import { tagColor } from '../core/tags';
  import Icon from './Icon.svelte';
  import TreeNode from './TreeNode.svelte';

  let { entry, depth = 0 }: { entry: Entry; depth?: number } = $props();

  const open = $derived(app.expanded.has(entry.path));
  const kids = $derived(app.children.get(entry.path));
  const isHit = $derived(drag.active && drag.hit?.kind === 'folder' && drag.hit.path === entry.path);
  const current = $derived(app.cwd === entry.path);
  const leafKnown = $derived(kids !== undefined && kids.length === 0);
</script>

<div class="node">
  <div
    class="row"
    class:current
    class:hit-move={isHit && drag.hit?.zone === 'move'}
    class:hit-attr={isHit && drag.hit?.zone === 'attr'}
    style:padding-left="{8 + depth * 14}px"
    data-drop="folder"
    data-path={entry.path}
    data-zones="dual"
    data-expandable={leafKnown ? undefined : ''}
    role="treeitem"
    aria-selected={current}
    aria-expanded={open}
    tabindex="-1"
    onpointerdown={(e) => drag.begin(e, () => [entry], 'tree', () => app.navigate(entry.path))}
  >
    <button
      class="chev"
      class:open
      class:hidden={leafKnown}
      onpointerdown={(e) => e.stopPropagation()}
      onclick={() => app.toggle(entry.path)}
      aria-label={open ? 'Zuklappen' : 'Aufklappen'}><Icon name="chevron" size={12} /></button
    >
    <span class="ico" style:color={entry.color ?? undefined}><Icon name="folder" size={15} /></span>
    <span class="name">{entry.name}</span>
    {#if entry.tags.length}
      <span class="dot" style:background={tagColor(entry.tags[0])}></span>
    {/if}
    {#if isHit}
      <span class="pill" class:attr={drag.hit?.zone === 'attr'} aria-hidden="true">
        {drag.hit?.zone === 'attr' ? 'Taggen' : drag.copy ? 'Kopieren' : 'Verschieben'}
      </span>
    {/if}
  </div>

  {#if open && kids?.length}
    <div class="kids" transition:slide={{ duration: 220, easing: cubicOut }}>
      {#each kids as k (k.path)}
        <TreeNode entry={k} depth={depth + 1} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 5px;
    height: 27px;
    padding-right: 8px;
    border-radius: 7px;
    color: var(--fg-muted);
    cursor: default;
    user-select: none;
    transition: background 0.12s;
  }
  .row:hover {
    background: var(--bg-sunken);
    color: var(--fg);
  }
  .row.current {
    color: var(--fg);
    background: var(--bg-sunken);
    font-weight: 500;
  }
  .row.hit-move {
    background: linear-gradient(90deg, var(--accent-soft) 50%, transparent 50%);
    color: var(--fg);
    box-shadow: inset 0 0 0 1.5px var(--accent);
  }
  .row.hit-attr {
    background: linear-gradient(90deg, transparent 50%, var(--attr-soft) 50%);
    color: var(--fg);
    box-shadow: inset 0 0 0 1.5px var(--attr);
  }
  .chev {
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    border-radius: 4px;
    color: var(--fg-faint);
    transition: transform 0.18s cubic-bezier(0.2, 0.8, 0.2, 1);
    flex: none;
  }
  .chev.open {
    transform: rotate(90deg);
  }
  .chev.hidden {
    visibility: hidden;
  }
  .ico {
    display: grid;
    color: var(--fg-faint);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pill {
    flex: none;
    font-size: 10px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 6px;
    color: #fff;
    background: var(--accent);
    pointer-events: none;
  }
  .pill.attr {
    background: var(--attr);
  }
</style>
