<script lang="ts">
  // Drop grid while dragging (opens on the drop-zone button or by shaking the files).
  // It dives through folders: top left one level up, next to it "drop here", then the
  // subfolders; pausing over a folder goes into it. The configured targets follow below.
  import { scale } from 'svelte/transition';
  import { app } from '../state/app.svelte';
  import { drag } from '../state/drag.svelte';
  import { tagColor } from '../core/tags';
  import { basename, dirname } from '../core/paths';
  import Icon from './Icon.svelte';
  import { t } from '../i18n/index.svelte';

  const cfg = $derived(app.gridConfig);
  const favorites = $derived(cfg.cells.map((c, i) => ({ c, i })).filter((x) => !!x.c));
  const dir = $derived(drag.gridDir);
  const parent = $derived(dir ? dirname(dir) : '');
  const hasParent = $derived(!!parent && parent !== dir);
  const isHit = (path: string) => drag.hit?.kind === 'folder' && drag.hit.path === path;
</script>

{#if drag.active && drag.gridOpen}
  <div class="backdrop">
    <div class="panel" data-autoscroll transition:scale={{ start: 0.94, duration: 160 }}>
      {#if dir}
        <div class="where"><Icon name="folder" size={13} /> {dir}</div>
        <div class="grid">
          {#if hasParent}
            <div class="cell up" class:hit={drag.hit?.kind === 'grid-up'} data-drop="grid-up" data-dive={parent}>
              <Icon name="up" size={22} />
              <span class="label">{t('grid.up')}</span>
              <span class="sub">{basename(parent) || parent}</span>
            </div>
          {/if}
          <div class="cell here" class:hit={isHit(dir)} data-drop="folder" data-path={dir}>
            <Icon name="dropIn" size={22} />
            <span class="label">{t('grid.here')}</span>
            <span class="sub">{basename(dir) || dir}</span>
          </div>
          {#each drag.gridDirs as d (d.path)}
            <div class="cell" class:hit={isHit(d.path)} data-drop="folder" data-path={d.path} data-dive={d.path}>
              <Icon name="folder" size={22} />
              <span class="label">{d.name}</span>
            </div>
          {/each}
        </div>
        <p class="hint">{t('grid.diveHint')}</p>
      {/if}
      {#if favorites.length}
        <div class="grid favs">
          {#each favorites as { c, i } (i)}
            {#if c}
              <div
                class="cell"
                class:tag={!!c.tag}
                class:hit={drag.hit?.kind === 'grid-cell' && drag.hit.cell === i}
                data-drop="grid-cell"
                data-cell={i}
                style:--c={c.tag ? tagColor(c.tag) : 'var(--accent)'}
              >
                <Icon name={c.tag ? 'tag' : 'folder'} size={18} />
                <span class="label">{c.label}</span>
              </div>
            {/if}
          {/each}
        </div>
      {/if}
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
    padding: 20px;
    background: color-mix(in srgb, var(--bg) 55%, transparent);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
  }
  .panel {
    width: min(860px, 100%);
    max-height: 100%;
    overflow: auto;
    padding: 4px;
  }
  .where {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 4px 8px;
    font-size: 12px;
    color: var(--fg-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 10px;
  }
  .favs {
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid var(--line);
  }
  .cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 5px;
    min-width: 0;
    height: 96px;
    padding: 0 8px;
    border-radius: 14px;
    background: var(--bg-elev);
    box-shadow:
      var(--shadow),
      0 0 0 1px var(--line);
    color: var(--fg-muted);
    --c: var(--accent);
    transition:
      transform 0.12s,
      background 0.12s,
      color 0.12s;
  }
  .favs .cell {
    height: 64px;
  }
  .cell.here {
    box-shadow:
      var(--shadow),
      0 0 0 2px var(--accent);
  }
  .cell.hit {
    transform: scale(1.04);
    background: var(--c);
    color: #fff;
  }
  .label {
    max-width: 100%;
    font-weight: 600;
    font-size: 13px;
    color: inherit;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cell:not(.hit) .label {
    color: var(--fg);
  }
  .sub {
    max-width: 100%;
    font-size: 11px;
    opacity: 0.7;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hint {
    margin: 8px 4px 0;
    font-size: 11px;
    color: var(--fg-faint);
  }
</style>
