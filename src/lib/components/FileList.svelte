<script lang="ts">
  /**
   * Detail list: one row per entry, sortable columns. The three-panel view
   * shows a fixed compact set; the table view (`table`) the configured columns.
   */
  import { untrack } from 'svelte';
  import type { Entry } from '../core/types';
  import { columnDef, type ColumnId } from '../core/columns';
  import { tableColumns } from '../state/columns.svelte';
  import { basename, dirname } from '../core/paths';
  import { app } from '../state/app.svelte';
  import { drag } from '../state/drag.svelte';
  import { family, formatSize } from '../core/format';
  import { tagColor, leaf } from '../core/tags';
  import { archiveRoot, inArchive, isArchive } from '../core/archive';
  import type { SortKey } from '../core/views';
  import { isToggleKey } from '../platform';
  import Icon from './Icon.svelte';
  import NoResults from './NoResults.svelte';
  import { t, loc } from '../i18n/index.svelte';
  import { Shown, STEP } from './more.svelte';

  // Rows are drawn page by page; the row under the cursor is always drawn.
  const paged = new Shown();
  $effect(() => {
    void app.viewKey;
    paged.reset();
  });
  $effect(() => {
    const p = app.cursor;
    if (!p) return;
    const i = app.visible.findIndex((e) => e.path === p);
    if (i >= untrack(() => paged.limit)) paged.limit = i + STEP;
  });
  const rows = $derived(app.visible.slice(0, paged.limit));

  let { table = false }: { table?: boolean } = $props();

  const GAP = 10;
  type Col = { id: ColumnId | 'date'; label: string; sort: SortKey | null; width: number };

  // The date column of the three-panel list follows the sort: created or taken when sorted by those.
  const dateKey = $derived<SortKey>(app.sort === 'ctime' || app.sort === 'taken' ? app.sort : 'mtime');
  const dateLabel = $derived(dateKey === 'ctime' ? t('files.colCreated') : dateKey === 'taken' ? t('files.colTaken') : t('files.colModified'));

  // Three-panel view: fixed compact columns. Table view: the user's choice.
  const cols = $derived<Col[]>(
    table
      ? tableColumns.list.filter((c) => c.show).map((c) => ({ ...columnDef(c.id), width: c.width }))
      : [
          { id: 'name', label: t('files.colName'), sort: 'name', width: 160 },
          { id: 'date', label: dateLabel, sort: dateKey, width: 140 },
          { id: 'size', label: t('files.colSize'), sort: 'size', width: 80 },
          { id: 'kind', label: t('files.colKind'), sort: 'ext', width: 70 }
        ]
  );
  const template = $derived(
    cols.map((c) => (c.id === 'name' ? `minmax(${c.width}px, 1fr)` : `${c.width}px`)).join(' ') + (table ? ' 24px' : '')
  );
  // Wide tables scroll sideways; rows keep the header's width.
  const minWidth = $derived(table ? cols.reduce((n, c) => n + c.width + GAP, 0) + 24 + 24 : 0);
  const shown = $derived(new Set(cols.map((c) => c.id)));

  // Capture date and GPS come from EXIF, loaded on demand.
  $effect(() => {
    if (!table || !(shown.has('taken') || shown.has('geo'))) return;
    void app.raw.length;
    void app.cwd;
    untrack(() => void app.loadMediaInfo());
  });

  const fmt = $derived(new Intl.DateTimeFormat(loc(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }));
  function dateOf(e: Entry, key: SortKey) {
    const ms = key === 'ctime' ? e.ctime || e.mtime : key === 'taken' ? (e.taken ?? null) : e.mtime;
    return ms ? fmt.format(ms) : '–';
  }

  function folderOf(e: Entry) {
    return e.relDir || basename(dirname(e.path)) || '–';
  }

  function geoOf(e: Entry) {
    return e.geo ? `${e.geo.lat.toFixed(4)}, ${e.geo.lon.toFixed(4)}` : '–';
  }

  function kindOf(e: Entry) {
    if (e.kind === 'dir') return t('files.kindFolder');
    if (isArchive(e.path)) return t('files.kindArchive');
    return e.ext ? e.ext.toUpperCase() : t('files.kindFile');
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
    // A second click on a selected row (without moving it) deselects it.
    const was = app.selection.has(entry.path);
    if (!was) app.select(entry.path, 'replace');
    else app.cursor = entry.path;
    drag.begin(
      e,
      () => (app.selection.has(entry.path) ? app.selectedEntries : [entry]),
      'canvas',
      () => (was ? app.select(entry.path, 'toggle') : app.select(entry.path, 'replace'))
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

  // Drag the right edge of a header cell to resize its column.
  function grip(e: PointerEvent, c: Col) {
    if (e.button !== 0 || c.id === 'date') return;
    e.preventDefault();
    e.stopPropagation();
    const id = c.id;
    const x0 = e.clientX;
    const w0 = c.width;
    const move = (ev: PointerEvent) => tableColumns.resize(id, w0 + ev.clientX - x0);
    const up = (ev: PointerEvent) => {
      tableColumns.resize(id, w0 + ev.clientX - x0, true);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // Column chooser: a popover under the button at the end of the header.
  let picker = $state<{ x: number; y: number } | null>(null);
  function openPicker(e: MouseEvent) {
    if (picker) return void (picker = null);
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    picker = { x: Math.max(8, r.right - 240), y: r.bottom + 4 };
  }
  function outside(e: PointerEvent) {
    if (picker && !(e.target as HTMLElement).closest('.picker, .cols-btn')) picker = null;
  }

  // Keep the row under the cursor in view while stepping with the arrow keys.
  let body = $state<HTMLElement>();
  $effect(() => {
    const p = app.cursor;
    if (!p || !body) return;
    body.querySelector<HTMLElement>(`[data-path="${CSS.escape(p)}"]`)?.scrollIntoView({ block: 'nearest' });
  });
</script>

<svelte:window onpointerdown={outside} onkeydown={(ev) => picker && ev.key === 'Escape' && (picker = null)} />

<div class="list" class:table role="grid" aria-multiselectable="true">
  <div class="body" bind:this={body} data-autoscroll>
    <div class="inner" style:min-width={minWidth ? `${minWidth}px` : undefined} style:--cols={template}>
      <div class="head" role="row">
        {#each cols as c (c.id)}
          <div class="th {c.id}" class:on={!!c.sort && app.sort === c.sort} role="columnheader">
            {#if c.sort}
              {@const key = c.sort}
              <button class="sort" onclick={() => app.setSort(key)}>
                <span class="lbl">{c.label}</span>
                {#if app.sort === key}<span class="dir">{app.desc ? '▼' : '▲'}</span>{/if}
              </button>
            {:else}
              <span class="lbl">{c.label}</span>
            {/if}
            {#if table}<span class="grip" role="separator" aria-orientation="vertical" onpointerdown={(ev) => grip(ev, c)}></span>{/if}
          </div>
        {/each}
        {#if table}
          <button class="cols-btn" class:on={!!picker} onclick={openPicker} title={t('files.columns')} aria-label={t('files.columns')}>
            <Icon name="columns" size={13} />
          </button>
        {/if}
      </div>
      <div class="rows">
        {#each rows as e (e.path)}
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
            {#each cols as c (c.id)}
              {#if c.id === 'name'}
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
                    <!-- Folder and tags sit in the name cell unless they have a column of their own. -->
                    {#if e.relDir && !shown.has('folder')}<span class="rel">{e.relDir}</span>{/if}
                    {#if !shown.has('tags')}
                      {#each e.tags.slice(0, 3) as tag (tag)}<span class="tag" title={tag}><i style:background={tagColor(tag)}></i>{leaf(tag)}</span>{/each}
                    {/if}
                  {/if}
                </span>
              {:else if c.id === 'date'}
                <span class="td date">{dateOf(e, dateKey)}</span>
              {:else if c.id === 'mtime' || c.id === 'ctime' || c.id === 'taken'}
                <span class="td date">{dateOf(e, c.id)}</span>
              {:else if c.id === 'size'}
                <span class="td size">{e.kind === 'dir' ? '–' : formatSize(e.size)}</span>
              {:else if c.id === 'kind'}
                <span class="td kind">{kindOf(e)}</span>
              {:else if c.id === 'ext'}
                <span class="td kind">{e.kind === 'file' && e.ext ? e.ext : '–'}</span>
              {:else if c.id === 'tags'}
                <span class="td tags" title={e.tags.join(', ')}>
                  {#each e.tags as tag (tag)}<span class="tag"><i style:background={tagColor(tag)}></i>{leaf(tag)}</span>{/each}
                </span>
              {:else if c.id === 'folder'}
                <span class="td kind" title={dirname(e.path)}>{folderOf(e)}</span>
              {:else if c.id === 'path'}
                <span class="td kind path" title={e.path}>{e.path}</span>
              {:else if c.id === 'geo'}
                <span class="td kind num">{geoOf(e)}</span>
              {:else if c.id === 'color'}
                <span class="td color">{#if e.color}<i style:background={e.color}></i>{/if}</span>
              {/if}
            {/each}
          </div>
        {:else}
          {#if app.loading}{''}{:else if app.activeFilters.length}<NoResults />{:else}<p class="empty">{t('files.noFiles')}</p>{/if}
        {/each}
        {#if app.visible.length > paged.limit}
          {#key paged.limit}<div class="more" use:paged.sentinel>{t('files.moreBelow', { n: (app.visible.length - paged.limit).toLocaleString(loc()) })}</div>{/key}
        {/if}
      </div>
    </div>
  </div>
</div>

{#if picker}
  <div class="picker" style:left="{picker.x}px" style:top="{picker.y}px" role="dialog" tabindex="-1" aria-label={t('files.columns')} onpointerdown={(ev) => ev.stopPropagation()} oncontextmenu={(ev) => ev.stopPropagation()}>
    {#each tableColumns.list as c, i (c.id)}
      <div class="pick">
        <label>
          <input type="checkbox" checked={c.show} disabled={c.id === 'name'} onchange={() => tableColumns.toggle(c.id)} />
          {columnDef(c.id).label}
        </label>
        <button class="mv" disabled={c.id === 'name' || i <= 1} onclick={() => tableColumns.move(c.id, -1)} title={t('files.columnUp')} aria-label={t('files.columnUp')}>▲</button>
        <button class="mv" disabled={c.id === 'name' || i === tableColumns.list.length - 1} onclick={() => tableColumns.move(c.id, 1)} title={t('files.columnDown')} aria-label={t('files.columnDown')}>▼</button>
      </div>
    {/each}
    <button class="btn reset" onclick={() => tableColumns.reset()}>{t('files.columnsReset')}</button>
  </div>
{/if}

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
    grid-template-columns: var(--cols);
    align-items: center;
    column-gap: 10px;
    padding: 0 12px;
  }
  .head {
    position: sticky;
    top: 0;
    z-index: 2;
    height: 30px;
    border-bottom: 1px solid var(--line);
    background: var(--bg);
  }
  .th {
    position: relative;
    display: flex;
    align-items: center;
    min-width: 0;
    height: 100%;
    font-size: 11.5px;
    color: var(--fg-faint);
  }
  .sort {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    height: 100%;
    font: inherit;
    color: inherit;
    text-align: left;
  }
  .lbl {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .th:has(.sort:hover),
  .th.on {
    color: var(--fg);
  }
  .th.size {
    justify-content: flex-end;
  }
  /* Resize handle: straddles the gap to the next column. */
  .grip {
    position: absolute;
    top: 6px;
    bottom: 6px;
    right: -8px;
    width: 6px;
    cursor: col-resize;
    border-radius: 2px;
  }
  .grip:hover {
    background: var(--line);
  }
  .cols-btn {
    position: sticky;
    right: 0;
    display: grid;
    place-items: center;
    width: 24px;
    height: 22px;
    border-radius: 5px;
    color: var(--fg-faint);
    background: var(--bg);
  }
  .cols-btn:hover,
  .cols-btn.on {
    color: var(--fg);
    background: var(--bg-sunken);
  }
  .dir {
    font-size: 8px;
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    scroll-padding-top: 30px;
  }
  .rows {
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
  .td.kind,
  .td.tags {
    font-size: 12px;
    color: var(--fg-muted);
  }
  .td.size {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .td.num {
    font-variant-numeric: tabular-nums;
  }
  .td.tags {
    display: flex;
    gap: 8px;
  }
  .td.color {
    display: flex;
    align-items: center;
  }
  .td.color i {
    width: 10px;
    height: 10px;
    border-radius: 50%;
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
  .picker {
    position: fixed;
    z-index: 40;
    width: 240px;
    max-height: 70vh;
    overflow: auto;
    padding: 6px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--bg);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
    font-size: 12.5px;
  }
  .pick {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px 4px;
    border-radius: 6px;
  }
  .pick:hover {
    background: var(--bg-sunken);
  }
  .pick label {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    padding: 3px 0;
    cursor: pointer;
  }
  .mv {
    width: 20px;
    height: 20px;
    border-radius: 4px;
    font-size: 8px;
    color: var(--fg-faint);
  }
  .mv:hover:not(:disabled) {
    color: var(--fg);
    background: var(--bg);
  }
  .mv:disabled {
    opacity: 0.3;
  }
  .reset {
    width: 100%;
    margin-top: 6px;
    justify-content: center;
  }
  .more {
    padding: 14px 0;
    text-align: center;
    font-size: 12px;
    color: var(--fg-faint);
  }
</style>
