<script lang="ts">
  import { app } from '../state/app.svelte';
  import { drag } from '../state/drag.svelte';
  import { crumbs, relativeTo } from '../core/paths';
  import { formatRange } from '../core/dates';
  import { SORT_KEYS, type ViewMode } from '../core/views';
  import { modLabel } from '../platform';
  import Icon from './Icon.svelte';
  import { CATEGORIES } from '../core/format';
  import { web } from '../state/web.svelte';
  import { t } from '../i18n/index.svelte';

  let { accent = null }: { accent?: { color: string; light: boolean } | null } = $props();

  const path = $derived(crumbs(app.cwd, app.home));
  const typeLabel = $derived(
    !app.typeFilter ? t('toolbar.allTypes') : app.typeFilter === 'medien' ? t('toolbar.media') : (CATEGORIES.find((c) => c.key === app.typeFilter)?.label ?? app.typeFilter)
  );
  const views: { id: ViewMode; icon: string }[] = [
    { id: 'stream', icon: 'grid' },
    { id: 'panes', icon: 'columns' },
    { id: 'table', icon: 'table' },
    { id: 'kanban', icon: 'kanban' },
    { id: 'timeline', icon: 'timeline' },
    { id: 'calendar', icon: 'calendar' },
    { id: 'map', icon: 'map' },
    { id: 'board', icon: 'nodes' }
  ];

  // Sort menu: picking the current key again reverses the order.
  let sortMenu = $state<{ x: number; y: number } | null>(null);
  function openSort(e: MouseEvent) {
    if (sortMenu) return void (sortMenu = null);
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    sortMenu = { x: r.left, y: r.bottom + 4 };
  }
  function outside(e: PointerEvent) {
    if (sortMenu && !(e.target as HTMLElement).closest('.sort-menu, .sort-btn')) sortMenu = null;
  }

  let searchEl: HTMLInputElement;
  export function focusSearch() {
    searchEl?.focus();
    searchEl?.select();
  }

  function onSearchKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && app.searchMode === 'select') {
      const n = app.selectPattern(app.search);
      app.toast(t('toolbar.selected', { n }));
    } else if (e.key === 'Escape') {
      app.search = '';
      searchEl.blur();
    }
  }
</script>

<svelte:window onpointerdown={outside} onkeydown={(ev) => sortMenu && ev.key === 'Escape' && (sortMenu = null)} />

{#if sortMenu}
  <div class="sort-menu" style:left="{sortMenu.x}px" style:top="{sortMenu.y}px" role="menu">
    {#each SORT_KEYS as k (k.key)}
      <button class:on={app.sort === k.key} role="menuitemradio" aria-checked={app.sort === k.key} onclick={() => app.setSort(k.key)}>
        <span>{k.label}</span>
        {#if app.sort === k.key}<Icon name={app.desc ? 'sortDown' : 'sortUp'} size={13} />{/if}
      </button>
    {/each}
    <p>{t('toolbar.sortAgain')}</p>
  </div>
{/if}

<header data-tauri-drag-region class="toolbar" class:over={!!app.preview} class:light={accent?.light} style:--tint={accent?.color}>
  <div class="nav">
    <button class="btn icon" onclick={() => app.back()} disabled={!app.history.length} title={t('toolbar.back')}>
      <Icon name="back" />
    </button>
    <button class="btn icon" onclick={() => app.forward()} disabled={!app.future.length} title={t('toolbar.forward')}>
      <Icon name="forward" />
    </button>
  </div>

  <nav class="crumbs" aria-label={t('toolbar.path')}>
    {#if app.currentProject}
      <span class="crumb last proj" title={t('toolbar.projectHint')}>
        <Icon name="kanban" size={13} />
        {app.currentProject.name}
      </span>
    {/if}
    {#each app.currentProject ? [] : path as c, i (c.path)}
      {#if i > 0}<span class="sep">/</span>{/if}
      <button
        class="crumb"
        class:last={i === path.length - 1}
        class:hit={drag.active && drag.hit?.kind === 'crumb' && drag.hit.path === c.path}
        data-drop="crumb"
        data-path={c.path}
        onclick={() => app.navigate(c.path)}>{c.name.replace(/!$/, '')}</button
      >
    {/each}
    {#if app.funnel}
      <span class="chip funnel">
        <Icon name="filter" size={11} />
        {relativeTo(app.funnel, app.cwd)}
        <button onclick={() => app.setFunnel(null)} aria-label={t('toolbar.removeFilter')}><Icon name="x" size={11} /></button>
      </span>
    {/if}
    {#if app.dateFilter && app.view !== 'calendar'}
      <span class="chip funnel">
        <Icon name="calendar" size={11} />
        {formatRange(app.dateFilter)}
        <button onclick={() => app.setDateFilter(null)} aria-label={t('toolbar.removeDateFilter')}><Icon name="x" size={11} /></button>
      </span>
    {/if}
  </nav>

  <div class="search" class:select={app.searchMode === 'select'}>
    <button
      class="mode"
      title={app.searchMode === 'filter' ? t('toolbar.modeFilter') : t('toolbar.modeSelect')}
      onclick={() => (app.searchMode = app.searchMode === 'filter' ? 'select' : 'filter')}
    >
      <Icon name={app.searchMode === 'filter' ? 'search' : 'select'} size={14} />
    </button>
    <input
      bind:this={searchEl}
      bind:value={app.search}
      onkeydown={onSearchKey}
      placeholder={app.searchMode === 'filter' ? t('toolbar.searchPlaceholder') : t('toolbar.selectPlaceholder')}
      spellcheck="false"
    />
    <kbd>{modLabel}F</kbd>
  </div>

  <div class="seg" role="tablist">
    {#each views as v (v.id)}
      <button class="btn" class:on={app.view === v.id} onclick={() => app.setView(v.id)} title={t(`toolbar.view.${v.id}`)} role="tab" aria-selected={app.view === v.id}>
        <Icon name={v.icon} size={15} />
      </button>
    {/each}
  </div>

  {#if app.view === 'kanban'}
    <div class="seg">
      <button class="btn" class:on={app.kanbanBy === 'tag'} onclick={() => app.setKanbanBy('tag')}>{t('toolbar.byTag')}</button>
      <button class="btn" class:on={app.kanbanBy === 'subfolder'} onclick={() => app.setKanbanBy('subfolder')}>{t('toolbar.bySubfolder')}</button>
    </div>
  {/if}

  {#if app.view !== 'board'}
    <div class="seg mode" role="radiogroup" aria-label={t('toolbar.mode')}>
      <button class="btn" class:on={!app.recursive} role="radio" aria-checked={!app.recursive} onclick={() => app.recursive && app.setRecursive(false)} title={t('toolbar.modeFolderHint')}>
        <Icon name="folder" size={14} />{t('toolbar.modeFolder')}
      </button>
      <button class="btn" class:on={app.recursive} role="radio" aria-checked={app.recursive} onclick={() => !app.recursive && app.setRecursive(true)} title={t('toolbar.streamHint')}>
        <Icon name="stream" size={14} />{t('toolbar.modeFlat')}
      </button>
    </div>
    <label class="btn types" class:on={!!app.typeFilter || (app.showSystem && app.systemAllowed)} title={t('toolbar.typeHint')}>
      <span>{typeLabel}{app.showSystem && app.systemAllowed ? ' + ' + t('toolbar.system') : ''}</span>
      <select
        value={app.typeFilter ?? ''}
        onchange={(ev) => {
          const v = ev.currentTarget.value;
          if (v === '__system') {
            ev.currentTarget.value = app.typeFilter ?? '';
            app.setShowSystem(!app.showSystem);
          } else app.setTypeFilter(v || null);
        }}
      >
        <option value="">{t('toolbar.allTypes')}</option>
        <option value="medien">{t('toolbar.media')}</option>
        {#each CATEGORIES as c (c.key)}<option value={c.key}>{c.label}</option>{/each}
        {#if app.systemAllowed}
          <option disabled>──────</option>
          <option value="__system">{app.showSystem ? '✓ ' : ''}{t('toolbar.showSystem')}</option>
        {/if}
      </select>
      <Icon name="chevronDown" size={12} />
    </label>

    <div class="sortbox">
      <button class="btn types sort-btn" class:on={!!sortMenu} title={t('toolbar.sortBy')} onclick={openSort}>
        <span>{SORT_KEYS.find((k) => k.key === app.sort)?.label ?? 'Name'}</span>
        <Icon name="chevronDown" size={12} />
      </button>
      <button
        class="btn icon"
        onclick={() => app.setSort(app.sort, !app.desc)}
        title={app.desc ? t('toolbar.descending') : t('toolbar.ascending')}
        aria-label={t('toolbar.sortDirection')}><Icon name={app.desc ? 'sortDown' : 'sortUp'} size={14} /></button
      >
    </div>

    {#if app.view !== 'panes' && app.view !== 'table'}
    <input
      class="zoom"
      type="range"
      min="96"
      max="360"
      step="4"
      value={app.tileSize}
      oninput={(e) => app.setTileSize(Number(e.currentTarget.value))}
      onwheel={(e) => {
        e.preventDefault();
        app.zoomTiles(e.deltaY);
      }}
      title={t('toolbar.zoomHint')}
      aria-label={t('toolbar.tileSize')}
    />
    {/if}
  {/if}

  <button class="btn icon" class:on={web.open} onclick={() => web.toggle()} title={t('toolbar.webHint')} aria-label={t('toolbar.web')}>
    <Icon name="globe" size={15} />
  </button>
  <button class="btn icon" class:on={!!app.pane} onclick={() => app.setPane(app.pane ? null : app.cwd)} title={t('toolbar.paneHint')} aria-label={t('toolbar.pane')}>
    <Icon name="split" size={15} />
  </button>
  <button
    class="btn icon drop-trigger"
    class:hot={drag.active}
    class:hit={drag.hit?.kind === 'grid-trigger'}
    data-drop="grid-trigger"
    onclick={() => (app.gridEditorOpen = true)}
    title={t('toolbar.dropHint')}
    aria-label={t('toolbar.drop')}
  >
    <Icon name="dropIn" size={16} />
  </button>
  <button class="btn icon" class:on={!!app.tagSource} onclick={() => app.openTags()} title={t('toolbar.tagHint')} aria-label={t('toolbar.tags')}>
    <Icon name="tag" size={15} />
  </button>
</header>

<style>
  .proj {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .sortbox {
    display: flex;
    align-items: center;
  }
  .types {
    position: relative;
    cursor: pointer;
  }
  /* The select is invisible over its label, so the button is only as wide as the chosen option. */
  .types select {
    position: absolute;
    inset: 0;
    width: 100%;
    opacity: 0;
    cursor: pointer;
  }
  .types select option {
    color: initial;
  }
  .toolbar {
    position: relative;
    z-index: 30;
    display: flex;
    align-items: center;
    gap: 8px;
    height: var(--toolbar-h);
    padding: 0 12px;
    border-bottom: 1px solid var(--line);
    background: var(--bg);
    transition:
      background 0.35s,
      border-color 0.35s,
      color 0.35s;
  }
  /* While previewing, the image flows underneath: the toolbar becomes glass tinted by the image. */
  .toolbar.over {
    background: color-mix(in srgb, var(--tint, #000) 35%, transparent);
    backdrop-filter: blur(24px) saturate(1.4);
    -webkit-backdrop-filter: blur(24px) saturate(1.4);
    border-color: transparent;
    color: #fff;
  }
  .toolbar.over :global(.btn),
  .toolbar.over .crumb,
  .toolbar.over .sep {
    color: rgba(255, 255, 255, 0.85);
  }
  .toolbar.over .search,
  .toolbar.over .seg {
    background: rgba(255, 255, 255, 0.14);
  }
  .toolbar.over :global(.btn.on) {
    background: rgba(255, 255, 255, 0.22);
    box-shadow: none;
  }
  .toolbar.over.light :global(.btn.on) {
    background: rgba(0, 0, 0, 0.1);
  }
  .toolbar.over.light {
    color: #111;
  }
  .toolbar.over.light :global(.btn),
  .toolbar.over.light .crumb,
  .toolbar.over.light .sep {
    color: rgba(0, 0, 0, 0.72);
  }
  .toolbar.over.light .search,
  .toolbar.over.light .seg {
    background: rgba(0, 0, 0, 0.08);
  }
  .nav {
    display: flex;
  }
  .icon {
    padding: 0 6px;
  }
  .crumbs {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 2px;
    overflow: hidden;
  }
  .crumb {
    padding: 4px 6px;
    border-radius: 6px;
    color: var(--fg-muted);
    white-space: nowrap;
  }
  .crumb:hover {
    background: var(--bg-sunken);
    color: var(--fg);
  }
  .crumb.last {
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
  .funnel {
    margin-left: 6px;
    background: var(--accent-soft);
    color: var(--accent);
  }
  .funnel button {
    display: grid;
    color: inherit;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 0 1 260px;
    min-width: 150px;
    height: 30px;
    padding: 0 8px;
    border-radius: 8px;
    background: var(--bg-sunken);
    transition: box-shadow 0.15s;
  }
  .search:focus-within {
    box-shadow: 0 0 0 2px var(--accent-soft);
  }
  .search.select {
    box-shadow: inset 0 0 0 1.5px var(--accent);
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: none;
  }
  .search .mode {
    display: grid;
    color: var(--fg-muted);
  }
  .search.select .mode {
    color: var(--accent);
  }
  .zoom {
    width: 80px;
    accent-color: var(--fg-muted);
  }
  .drop-trigger.hot {
    color: var(--accent);
    box-shadow: inset 0 0 0 1.5px var(--accent);
    animation: pulse 1.2s ease-in-out infinite;
  }
  .drop-trigger.hit {
    background: var(--accent);
    color: #fff;
  }
  @keyframes pulse {
    50% {
      box-shadow: inset 0 0 0 1.5px transparent;
    }
  }
  .sort-menu {
    position: fixed;
    z-index: 80;
    min-width: 170px;
    padding: 5px;
    border-radius: 9px;
    border: 1px solid var(--line);
    background: var(--bg-elev);
    box-shadow: var(--shadow);
  }
  .sort-menu button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 5px 8px;
    border-radius: 6px;
    font-size: 13px;
    color: var(--fg);
  }
  .sort-menu button:hover {
    background: var(--bg-sunken);
  }
  .sort-menu button.on {
    font-weight: 600;
    color: var(--accent);
  }
  .sort-menu p {
    margin: 4px 8px 2px;
    font-size: 11px;
    color: var(--fg-faint);
  }
  .mode .btn {
    gap: 5px;
  }
</style>
