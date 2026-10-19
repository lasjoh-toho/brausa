<script lang="ts">
  /** Detail list of the three-panel view: one row per entry, sortable columns. */
  import type { Entry } from '../core/types';
  import { app } from '../state/app.svelte';
  import { drag } from '../state/drag.svelte';
  import { family, formatSize } from '../core/format';
  import { tagColor, leaf } from '../core/tags';
  import { archiveRoot, inArchive, isArchive } from '../core/archive';
  import type { SortKey } from '../core/views';
  import { isToggleKey } from '../platform';
  import Icon from './Icon.svelte';

  const cols: { key: SortKey; label: string; cls: string }[] = [
    { key: 'name', label: 'Name', cls: 'name' },
    { key: 'mtime', label: 'Geändert', cls: 'date' },
    { key: 'size', label: 'Größe', cls: 'size' },
    { key: 'ext', label: 'Art', cls: 'kind' }
  ];
  // The date column follows the sort: created or taken when sorted by those.
  const dateKey = $derived<SortKey>(app.sort === 'ctime' || app.sort === 'taken' ? app.sort : 'mtime');
  const dateLabel = $derived(dateKey === 'ctime' ? 'Erstellt' : dateKey === 'taken' ? 'Aufgenommen' : 'Geändert');

  const fmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  function dateOf(e: Entry) {
    const ms = dateKey === 'ctime' ? e.ctime || e.mtime : dateKey === 'taken' ? (e.taken ?? null) : e.mtime;
    return ms ? fmt.format(ms) : '–';
  }

  function kindOf(e: Entry) {
    if (e.kind === 'dir') return 'Ordner';
    if (isArchive(e.path)) return 'Archiv';
    return e.ext ? e.ext.toUpperCase() : 'Datei';
  }

  function lazyThumb(node: HTMLElement, entry: Entry) {
    if (family(entry.ext, entry.kind) !== 'image') return;
    const io = new IntersectionObserver((es) => {
      if (es.some((x) => x.isIntersecting)) {
        app.requestThumb(entry);
        io.disconnect();
      }
    });
    io.observe(node);
    return { destroy: () => io.disconnect() };
  }

  function down(e: PointerEvent, entry: Entry) {
    if (app.renaming === entry.path || e.button !== 0) return;
    if (e.shiftKey || isToggleKey(e)) {
      app.select(entry.path, e.shiftKey ? 'range' : 'toggle');
      return;
    }
    if (!app.selection.has(entry.path)) app.select(entry.path, 'replace');
    else app.cursor = entry.path;
    drag.begin(
      e,
      () => (app.selection.has(entry.path) ? app.selectedEntries : [entry]),
      'canvas',
      () => app.select(entry.path, 'replace')
    );
  }

  function menu(e: MouseEvent, entry: Entry) {
    e.preventDefault();
    if (!app.selection.has(entry.path)) app.select(entry.path, 'replace');
    app.menu = { x: e.clientX, y: e.clientY, entry };
  }

  function renameField(node: HTMLInputElement, entry: Entry) {
    node.focus();
    const dot = entry.kind === 'file' ? entry.name.lastIndexOf('.') : -1;
    node.setSelectionRange(0, dot > 0 ? dot : entry.name.length);
  }

  // Keep the row under the cursor in view while stepping with the arrow keys.
  let body = $state<HTMLElement>();
  $effect(() => {
    const p = app.cursor;
    if (!p || !body) return;
    body.querySelector<HTMLElement>(`[data-path="${CSS.escape(p)}"]`)?.scrollIntoView({ block: 'nearest' });
  });
</script>

<div class="list" role="grid" aria-multiselectable="true">
  <div class="head" role="row">
    {#each cols as c (c.key)}
      {@const key = c.key === 'mtime' ? dateKey : c.key}
      <button class="th {c.cls}" class:on={app.sort === key} onclick={() => app.setSort(key)} role="columnheader">
        {c.key === 'mtime' ? dateLabel : c.label}
        {#if app.sort === key}<span class="dir">{app.desc ? '▼' : '▲'}</span>{/if}
      </button>
    {/each}
  </div>
  <div class="body" bind:this={body} data-autoscroll>
    {#each app.visible as e (e.path)}
      {@const fam = family(e.ext, e.kind)}
      {@const packable = e.kind === 'file' && isArchive(e.path) && !inArchive(e.path)}
      {@const dropPath = packable ? archiveRoot(e.path) : e.path}
      {@const hit = drag.active && drag.hit?.kind === 'folder' && drag.hit.path === dropPath}
      {@const thumb = fam === 'image' ? app.thumbOf(e) : null}
      <div
        class="tile row"
        class:selected={app.selection.has(e.path)}
        class:cursor={app.cursor === e.path}
        class:hit
        class:dragging={drag.active && drag.items.some((i) => i.path === e.path)}
        data-path={e.path}
        data-drop={e.kind === 'dir' || packable ? 'folder' : undefined}
        data-target={packable ? dropPath : undefined}
        role="row"
        aria-selected={app.selection.has(e.path)}
        tabindex="-1"
        onpointerdown={(ev) => down(ev, e)}
        ondblclick={() => app.renaming !== e.path && app.open(e)}
        oncontextmenu={(ev) => menu(ev, e)}
      >
        <span class="td name">
          <span class="ic" use:lazyThumb={e} style:color={e.color ?? undefined}>
            {#if thumb}<img src={thumb} alt="" draggable="false" />{:else}<Icon
                name={fam === 'dir' ? 'folder' : packable ? 'archive' : fam === 'other' ? 'file' : fam}
                size={15}
              />{/if}
          </span>
          {#if app.renaming === e.path}
            <input
              class="rename"
              value={e.name}
              use:renameField={e}
              onpointerdown={(ev) => ev.stopPropagation()}
              onkeydown={(ev) => {
                ev.stopPropagation();
                if (ev.key === 'Enter') app.rename(e.path, ev.currentTarget.value);
                else if (ev.key === 'Escape') app.renaming = null;
              }}
              onblur={(ev) => app.rename(e.path, ev.currentTarget.value)}
            />
          {:else}
            <span class="label" title={e.relDir ? `${e.relDir}/${e.name}` : e.name}>{e.name}</span>
            {#if e.relDir}<span class="rel">{e.relDir}</span>{/if}
            {#each e.tags.slice(0, 3) as t (t)}<span class="tag" title={t}><i style:background={tagColor(t)}></i>{leaf(t)}</span>{/each}
          {/if}
        </span>
        <span class="td date">{dateOf(e)}</span>
        <span class="td size">{e.kind === 'dir' ? '–' : formatSize(e.size)}</span>
        <span class="td kind">{kindOf(e)}</span>
      </div>
    {:else}
      {#if !app.loading}<p class="empty">{app.search ? 'Nichts gefunden.' : 'Keine Dateien'}</p>{/if}
    {/each}
  </div>
</div>

<style>
  .list {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
    font-size: 13px;
  }
  .head,
  .row {
    display: grid;
    grid-template-columns: minmax(160px, 1fr) 140px 80px 70px;
    align-items: center;
    column-gap: 10px;
    padding: 0 12px;
  }
  .head {
    flex: none;
    height: 30px;
    border-bottom: 1px solid var(--line);
    background: var(--bg);
  }
  .th {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 100%;
    font: inherit;
    font-size: 11.5px;
    color: var(--fg-faint);
    text-align: left;
  }
  .th:hover,
  .th.on {
    color: var(--fg);
  }
  .th.size {
    justify-content: flex-end;
  }
  .dir {
    font-size: 8px;
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 4px 0 96px;
  }
  .row {
    height: 28px;
    margin: 0 6px;
    padding: 0 6px;
    border-radius: 6px;
    color: var(--fg);
    user-select: none;
  }
  .row:nth-child(even) {
    background: color-mix(in srgb, var(--bg-sunken) 45%, transparent);
  }
  .row:hover {
    background: var(--bg-sunken);
  }
  .row.selected {
    background: var(--accent-soft);
  }
  .row.selected.cursor {
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 55%, transparent);
  }
  .row.hit {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1.5px var(--accent);
  }
  .row.dragging {
    opacity: 0.45;
  }
  .td {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .td.name {
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .td.date,
  .td.size,
  .td.kind {
    font-size: 12px;
    color: var(--fg-muted);
  }
  .td.size {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .ic {
    flex: none;
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    color: var(--fg-faint);
  }
  .ic img {
    width: 18px;
    height: 18px;
    object-fit: cover;
    border-radius: 3px;
  }
  .label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .rel {
    flex: none;
    max-width: 30%;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 11px;
    color: var(--fg-faint);
  }
  .tag {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 11px;
    color: var(--fg-faint);
  }
  .tag i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }
  .rename {
    flex: 1;
    min-width: 0;
    padding: 2px 5px;
    border: 1px solid var(--accent);
    border-radius: 5px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
  }
  .empty {
    padding: 24px;
    text-align: center;
    color: var(--fg-faint);
  }
</style>
