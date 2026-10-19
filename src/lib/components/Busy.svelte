<script lang="ts">
  /** Long background work (reading photo data) with progress and a way to stop it. */
  import { app } from '../state/app.svelte';
  import { t, loc } from '../i18n/index.svelte';

  const p = $derived(app.mediaProgress);
</script>

{#if p}
  <div class="busy" role="status">
    <span class="bar"><span style:width="{Math.round((p.done / p.total) * 100)}%"></span></span>
    <span>{t('app.readingMedia', { done: p.done.toLocaleString(loc()), total: p.total.toLocaleString(loc()) })}</span>
    <button onclick={() => app.cancelMediaInfo()}>{t('common.cancel')}</button>
  </div>
{/if}

<style>
  .busy {
    position: absolute;
    left: 50%;
    bottom: 92px;
    z-index: 90;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    border-radius: 10px;
    background: var(--fg);
    color: var(--bg);
    box-shadow: var(--shadow);
    font-size: 12px;
    white-space: nowrap;
  }
  .bar {
    width: 90px;
    height: 4px;
    border-radius: 2px;
    background: color-mix(in srgb, var(--bg) 25%, transparent);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: #8db1ff;
  }
  button {
    font-weight: 600;
    color: #8db1ff;
  }
</style>
