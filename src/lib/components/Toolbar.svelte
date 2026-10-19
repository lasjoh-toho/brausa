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

  let { accent = null }: { accent?: { color: string; light: boolean } | null } = $props();

  const path = $derived(crumbs(app.cwd, app.home));
  const typeLabel = $derived(
    !app.typeFilter ? 'Alle Arten' : app.typeFilter === 'medien' ? 'Medien' : (CATEGORIES.find((c) => c.key === app.typeFilter)?.label ?? app.typeFilter)
  );
  const views: { id: ViewMode; icon: string; label: string }[] = [
    { id: 'stream', icon: 'grid', label: 'Kacheln' },
    { id: 'panes', icon: 'columns', label: 'Liste mit Vorschau (drei Spalten)' },
    { id: 'kanban', icon: 'kanban', label: 'Kanban' },
    { id: 'timeline', icon: 'timeline', label: 'Zeitachse' },
    { id: 'calendar', icon: 'calendar', label: 'Kalender' },
    { id: 'map', icon: 'map', label: 'Fotos auf der Landkarte' },
    { id: 'board', icon: 'nodes', label: 'Projektmap' }
  ];

  let searchEl: HTMLInputElement;
  export function focusSearch() {
    searchEl?.focus();
    searchEl?.select();
  }

  function onSearchKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && app.searchMode === 'select') {
      const n = app.selectPattern(app.search);
      app.toast(`${n} ausgewählt`);
    } else if (e.key === 'Escape') {
      app.search = '';
      searchEl.blur();
    }
  }
</script>

<header data-tauri-drag-region class="toolbar" class:over={!!app.preview} class:light={accent?.light} style:--tint={accent?.color}>
  <div class="nav">
    <button class="btn icon" onclick={() => app.back()} disabled={!app.history.length} title="Zurück">
      <Icon name="back" />
    </button>
    <button class="btn icon" onclick={() => app.forward()} disabled={!app.future.length} title="Vor">
      <Icon name="forward" />
    </button>
  </div>

  <nav class="crumbs" aria-label="Pfad">
    {#if app.currentProject}
      <span class="crumb last proj" title="Projekt: Dateien aus allen Orten. Ziehen fügt hinzu, Entf nimmt heraus (die Dateien bleiben).">
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
        <button onclick={() => app.setFunnel(null)} aria-label="Filter entfernen"><Icon name="x" size={11} /></button>
      </span>
    {/if}
    {#if app.dateFilter && app.view !== 'calendar'}
      <span class="chip funnel">
        <Icon name="calendar" size={11} />
        {formatRange(app.dateFilter)}
        <button onclick={() => app.setDateFilter(null)} aria-label="Zeitfilter entfernen"><Icon name="x" size={11} /></button>
      </span>
    {/if}
  </nav>

  <div class="search" class:select={app.searchMode === 'select'}>
    <button
      class="mode"
      title={app.searchMode === 'filter' ? 'Modus: Filtern (klicken für Auswählen)' : 'Modus: Auswählen per Muster'}
      onclick={() => (app.searchMode = app.searchMode === 'filter' ? 'select' : 'filter')}
    >
      <Icon name={app.searchMode === 'filter' ? 'search' : 'select'} size={14} />
    </button>
    <input
      bind:this={searchEl}
      bind:value={app.search}
      onkeydown={onSearchKey}
      placeholder={app.searchMode === 'filter' ? 'Suchen … *.png > 5MB #tag' : 'Auswählen: *.png > 5MB ↵'}
      spellcheck="false"
    />
    <kbd>{modLabel}F</kbd>
  </div>

  <div class="seg" role="tablist">
    {#each views as v (v.id)}
      <button class="btn" class:on={app.view === v.id} onclick={() => app.setView(v.id)} title={v.label} role="tab" aria-selected={app.view === v.id}>
        <Icon name={v.icon} size={15} />
      </button>
    {/each}
  </div>

  {#if app.view === 'kanban'}
    <div class="seg">
      <button class="btn" class:on={app.kanbanBy === 'tag'} onclick={() => app.setKanbanBy('tag')}>Tags</button>
      <button class="btn" class:on={app.kanbanBy === 'subfolder'} onclick={() => app.setKanbanBy('subfolder')}>Ordner</button>
    </div>
  {/if}

  {#if app.view !== 'board'}
    <button class="btn" class:on={app.recursive} onclick={() => app.setRecursive(!app.recursive)} title="Unterordner flach anzeigen">
      <Icon name="stream" size={15} /> Stream
    </button>
    <label class="btn types" class:on={!!app.typeFilter} title="Nur Dateien dieser Art zeigen (auch aus Unterordnern)">
      <span>{typeLabel}</span>
      <select value={app.typeFilter ?? ''} onchange={(ev) => app.setTypeFilter(ev.currentTarget.value || null)}>
        <option value="">Alle Arten</option>
        <option value="medien">Medien</option>
        {#each CATEGORIES as c (c.key)}<option value={c.key}>{c.label}</option>{/each}
      </select>
      <Icon name="chevronDown" size={12} />
    </label>

    <div class="sortbox">
      <label class="btn types" title="Sortieren nach">
        <span>{SORT_KEYS.find((k) => k.key === app.sort)?.label ?? 'Name'}</span>
        <select value={app.sort} onchange={(ev) => app.setSort(ev.currentTarget.value as typeof app.sort, app.desc)}>
          {#each SORT_KEYS as k (k.key)}<option value={k.key}>{k.label}</option>{/each}
        </select>
        <Icon name="chevronDown" size={12} />
      </label>
      <button
        class="btn icon"
        onclick={() => app.setSort(app.sort, !app.desc)}
        title={app.desc ? 'Absteigend (klicken: aufsteigend)' : 'Aufsteigend (klicken: absteigend)'}
        aria-label="Sortierrichtung"><Icon name={app.desc ? 'sortDown' : 'sortUp'} size={14} /></button
      >
    </div>

    {#if app.view !== 'panes'}
    <input
      class="zoom"
      type="range"
      min="96"
      max="360"
      step="4"
      value={app.tileSize}
      oninput={(e) => app.setTileSize(Number(e.currentTarget.value))}
      aria-label="Kachelgröße"
    />
    {/if}
  {/if}

  <button class="btn icon" class:on={web.open} onclick={() => web.toggle()} title="Web-Fenster: Seiten aus dem Internet und lokale Webseiten, abgeschottet" aria-label="Web-Fenster">
    <Icon name="globe" size={15} />
  </button>
  <button class="btn icon" class:on={!!app.pane} onclick={() => app.setPane(app.pane ? null : app.cwd)} title="Zweites Panel: zwei Ordner nebeneinander, Dateien hin und her ziehen" aria-label="Zweites Panel">
    <Icon name="split" size={15} />
  </button>
  <button
    class="btn drop-trigger"
    class:hot={drag.active}
    class:hit={drag.hit?.kind === 'grid-trigger'}
    data-drop="grid-trigger"
    onclick={() => (app.gridEditorOpen = true)}
    title="Ablagezonen: Datei hierher ziehen (klicken zum Konfigurieren)"
  >
    <Icon name="target" size={15} /> Ablage
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
</style>
