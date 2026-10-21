<script lang="ts">
  /** Empty view while filters hide everything: names the filters, each removable. */
  import { app } from '../state/app.svelte';
  import { t, tn } from '../i18n/index.svelte';
  import { CATEGORIES } from '../core/format';
  import { formatRange } from '../core/dates';
  import Icon from './Icon.svelte';

  // Files there are, before the filters.
  const hidden = $derived(app.raw.length);

  function label(f: (typeof app.activeFilters)[number]) {
    if (f.kind === 'search') return t('noresults.search', { q: f.label });
    if (f.kind === 'type')
      return t('noresults.type', { type: f.label === 'medien' ? t('toolbar.media') : (CATEGORIES.find((c) => c.key === f.label)?.label ?? f.label) });
    if (f.kind === 'date') return t('noresults.date', { range: app.dateFilter ? formatRange(app.dateFilter) : '' });
    return t('noresults.funnel', { folder: f.label });
  }
</script>

<div class="none">
  <Icon name="filter" size={28} />
  <b>{t('noresults.title')}</b>
  {#if hidden}<span>{t('noresults.hidden', { files: tn('common.files', hidden) })}</span>{/if}
  <div class="chips">
    {#each app.activeFilters as f (f.kind)}
      <button class="chip" title={t('noresults.removeOne')} onclick={() => app.clearFilter(f.kind)}>
        {label(f)}<Icon name="x" size={11} />
      </button>
    {/each}
  </div>
  {#if app.findText}
    <div class="scopes">
      {#if app.everywhere !== 'places'}
        <button class="btn" onclick={() => app.searchEverywhere('places')} title={t('noresults.everywhereHint')}>
          <Icon name="search" size={13} />
          {t('noresults.everywhere')}
        </button>
      {/if}
      {#if app.everywhere !== 'media' && app.volumes.length}
        <button class="btn" onclick={() => app.searchEverywhere('media')} title={t('noresults.mediaHint')}>
          <Icon name="drive" size={13} />
          {t('noresults.media')}
        </button>
      {/if}
    </div>
  {/if}
  <button class="btn primary" onclick={() => app.clearFilters()}>
    <Icon name="x" size={13} />
    {app.activeFilters.length === 1 ? t('noresults.clearOne') : t('noresults.clearAll')}
  </button>
</div>

<style>
  .none {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    margin: 80px auto 0;
    max-width: 460px;
    padding: 0 16px;
    text-align: center;
    color: var(--fg-muted);
    font-size: 13px;
  }
  .none :global(svg) {
    flex: none;
  }
  b {
    color: var(--fg);
    font-size: 14px;
  }
  .scopes {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-width: 320px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .btn.primary {
    background: var(--accent);
    color: #fff;
    border-color: transparent;
  }
</style>
