<script lang="ts">
  import { fly } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { app } from '../state/app.svelte';
  import { drag } from '../state/drag.svelte';
  import { family } from '../core/format';
  import Icon from './Icon.svelte';
  import { t } from '../i18n/index.svelte';

  let { onTag }: { onTag: () => void } = $props();

  const hit = $derived(drag.active && drag.hit?.kind === 'tray');
  const visible = $derived(!app.preview && (app.staging.length > 0 || (drag.active && drag.source !== 'tray')));
</script>

{#if visible}
  <div class="tray" class:hit data-drop="tray" transition:fly={{ y: 40, duration: 200 }}>
    <div
      class="handle"
      role="button"
      tabindex="-1"
      title={t('files.trayDragAll')}
      onpointerdown={(e) => drag.begin(e, () => app.staging, 'tray')}
    >
      <Icon name="tray" size={16} />
      <span class="count">{app.staging.length}</span>
    </div>

    <div class="items">
      {#each app.staging as e (e.path)}
        <div class="item" animate:flip={{ duration: 180 }} title={e.path} data-file-path={e.path} data-dir={e.kind === 'dir' ? '' : undefined}>
          <div
            class="thumb"
            role="button"
            tabindex="-1"
            onpointerdown={(ev) => drag.begin(ev, () => [e], 'tray')}
          >
            {#if e.thumb}<img src={e.thumb} alt="" draggable="false" />{:else}<span class="ext">{e.ext || family(e.ext)}</span>{/if}
          </div>
          <button class="rm" onclick={() => app.unstage([e.path])} aria-label={t('files.trayRemove')}><Icon name="x" size={10} /></button>
        </div>
      {:else}
        <span class="placeholder">{t('files.trayEmpty')}</span>
      {/each}
    </div>

    {#if app.staging.length}
      <div class="actions">
        <button class="btn" onclick={onTag} title={t('files.trayTag')}><Icon name="tag" size={14} /> {t('files.tag')}</button>
        <button class="btn" onclick={() => app.setSelection(app.staging.map((e) => e.path))}>{t('files.traySelect')}</button>
        <button class="btn" onclick={() => app.transfer(app.staging, app.funnel ?? app.cwd, 'move')} title={t('files.trayHereHint')}>
          {t('files.trayHere')}
        </button>
        <button class="btn" onclick={() => app.clearStaging()}>{t('files.trayClear')}</button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .tray {
    position: absolute;
    left: 50%;
    bottom: 14px;
    z-index: 40;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: min(920px, calc(100% - 32px));
    min-width: 360px;
    height: 64px;
    padding: 0 8px 0 10px;
    border-radius: 16px;
    background: color-mix(in srgb, var(--bg-elev) 88%, transparent);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    box-shadow:
      var(--shadow),
      0 0 0 1px var(--line);
    transition: box-shadow 0.15s;
  }
  .tray.hit {
    box-shadow:
      var(--shadow),
      0 0 0 2px var(--accent);
  }
  .handle {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 44px;
    padding: 0 10px;
    border-radius: 10px;
    background: var(--bg-sunken);
    cursor: grab;
    color: var(--fg-muted);
  }
  .count {
    font-weight: 600;
    color: var(--fg);
  }
  .items {
    flex: 1;
    min-width: 0;
    display: flex;
    gap: 6px;
    overflow-x: auto;
    padding: 6px 2px;
  }
  .item {
    position: relative;
    flex: none;
  }
  .thumb {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 8px;
    overflow: hidden;
    background: var(--bg-sunken);
    cursor: grab;
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
  }
  .ext {
    font-family: var(--mono);
    font-size: 9px;
    text-transform: uppercase;
    color: var(--fg-faint);
  }
  .rm {
    position: absolute;
    top: -5px;
    right: -5px;
    display: none;
    place-items: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--fg);
    color: var(--bg);
  }
  .item:hover .rm {
    display: grid;
  }
  .placeholder {
    align-self: center;
    color: var(--fg-faint);
    font-size: 12px;
  }
  .actions {
    display: flex;
    gap: 2px;
  }
</style>
