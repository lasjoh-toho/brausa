<script lang="ts">
  /**
   * Second panel next to the canvas: another folder as a compact list, for
   * moving files between two places by dragging (both ways, ⌥/Strg copies).
   * Folders in the list and the empty list area are drop targets.
   */
  import { app } from '../state/app.svelte';
  import { drag } from '../state/drag.svelte';
  import type { Entry } from '../core/types';
  import { basename, dirname } from '../core/paths';
  import { family, formatDate, formatSize } from '../core/format';
  import { isToggleKey, store } from '../platform';
  import Icon from './Icon.svelte';
  import { t, tn } from '../i18n/index.svelte';
  import { archiveRoot, inArchive, isArchive } from '../core/archive';

  const path = $derived(app.pane!);
  let entries = $state<Entry[]>([]);
  let error = $state('');
  let back = $state<string[]>([]);
  let sel = $state(new Set<string>());
  let anchor = $state<string | null>(null);
  let width = $state<number>(store.get('paneWidth', 380));

  async function load(p: string) {
    try {
      const list = await app.backend.listDir(p);
      const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
      entries = list.sort((a, b) => (a.kind === b.kind ? coll.compare(a.name, b.name) : a.kind === 'dir' ? -1 : 1));
      error = '';
      for (const e of entries) if (family(e.ext, e.kind) === 'image') app.requestThumb(e);
    } catch (e) {
      entries = [];
      error = String(e).replace(/^Error: /, '');
    }
  }

  // Reload when the folder changes or brausa moved files somewhere.
  $effect(() => {
    void app.fsVersion;
    void load(path);
  });

  function go(p: string, remember = true) {
    if (p === path) return;
    if (remember) back = [...back, path].slice(-30);
    sel = new Set();
    app.setPane(p);
  }

  function goBack() {
    const p = back.at(-1);
    if (!p) return;
    back = back.slice(0, -1);
    go(p, false);
  }

  function click(e: Entry, ev: PointerEvent) {
    const next = new Set(sel);
    if (ev.shiftKey && anchor) {
      const a = entries.findIndex((x) => x.path === anchor);
      const b = entries.findIndex((x) => x.path === e.path);
      for (const x of entries.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(x.path);
    } else if (isToggleKey(ev)) {
      if (next.has(e.path)) next.delete(e.path);
      else next.add(e.path);
      anchor = e.path;
    } else {
      next.clear();
      next.add(e.path);
      anchor = e.path;
    }
    sel = next;
  }

  /** What a drag from a row carries: the selection if the row is part of it, else just the row. */
  function dragItems(e: Entry): Entry[] {
    return sel.has(e.path) ? entries.filter((x) => sel.has(x.path)) : [e];
  }

  function open(e: Entry) {
    if (e.kind === 'dir') go(e.path);
    else void app.open(e);
  }

  /** Swap the folders of the main view and the panel. */
  function swap() {
    const main = app.cwd;
    void app.navigate(path);
    go(main);
  }

  function resize(e: PointerEvent) {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = width;
    const move = (ev: PointerEvent) => (width = Math.max(260, Math.min(900, w0 + x0 - ev.clientX)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      store.set('paneWidth', width);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const hitHere = $derived(drag.active && drag.hit?.kind === 'folder' && drag.hit.path === path);
  // Places and project folders, each folder once (a project folder can also be a place).
  const places = $derived(
    [...app.places, ...app.projects.flatMap((p) => p.folders.map((f) => ({ name: `${p.name}: ${basename(f)}`, path: f })))].filter(
      (p, i, all) => all.findIndex((q) => q.path === p.path) === i
    )
  );
</script>

<aside class="pane" style:width="{width}px">
  <div class="grip" onpointerdown={resize} role="separator" aria-orientation="vertical" aria-label={t('panel.resize')}></div>
  <div class="head">
    <button class="btn icon" disabled={!back.length} onclick={goBack} aria-label={t('panel.back')}><Icon name="back" size={14} /></button>
    <button class="btn icon" disabled={dirname(path) === path} onclick={() => go(dirname(path))} aria-label={t('panel.up')}><Icon name="up" size={14} /></button>
    <span class="title" title={path}>{basename(path) || path}</span>
    <select class="places" value="" onchange={(ev) => {
        const v = ev.currentTarget.value;
        ev.currentTarget.value = '';
        if (v) go(v);
      }} aria-label={t('panel.pickPlace')}>
      <option value="">{t('panel.places')}</option>
      {#each places as p (p.path)}<option value={p.path}>{p.name}</option>{/each}
      {#if app.volumes.length}
        <optgroup label={t('sidebar.media')}>
          {#each app.volumes as v (v.path)}<option value={v.path}>{v.name}</option>{/each}
        </optgroup>
      {/if}
      {#if app.cwd !== path}<option value={app.cwd}>{t('panel.sameAsLeft', { name: basename(app.cwd) })}</option>{/if}
    </select>
    <button class="btn icon" onclick={swap} title={t('panel.swapTitle')} aria-label={t('panel.swap')}><Icon name="sync" size={14} /></button>
    <button class="btn icon" onclick={() => app.setPane(null)} aria-label={t('panel.close')}><Icon name="x" size={14} /></button>
  </div>

  <div class="list" class:hit={hitHere} data-drop="folder" data-path={path} data-autoscroll>
    {#if error}<p class="msg">{error}</p>{/if}
    {#each entries as e (e.path)}
      {@const thumb = app.thumbOf(e)}
      {@const fam = family(e.ext, e.kind)}
      {@const target = e.kind === 'dir' ? e.path : isArchive(e.path) && !inArchive(e.path) ? archiveRoot(e.path) : undefined}
      <div
        class="row"
        class:sel={sel.has(e.path)}
        class:hit={drag.active && !!target && drag.hit?.kind === 'folder' && drag.hit.path === target}
        data-drop={target ? 'folder' : undefined}
        data-path={target}
        role="button"
        tabindex="-1"
        onpointerdown={(ev) => drag.begin(ev, () => dragItems(e), 'pane', (pe) => click(e, pe))}
        ondblclick={() => open(e)}
      >
        <span class="ico">
          {#if thumb}<img src={thumb} alt="" draggable="false" />{:else}<Icon name={fam === 'dir' ? 'folder' : fam === 'other' ? 'file' : fam} size={16} />{/if}
        </span>
        <span class="name">{e.name}</span>
        <span class="meta">{e.kind === 'dir' ? '' : formatSize(e.size)}</span>
        <span class="meta date">{formatDate(e.mtime)}</span>
      </div>
    {:else}
      {#if !error}<p class="msg">{t('panel.empty')}</p>{/if}
    {/each}
  </div>
  <div class="foot">{tn('common.objects', entries.length)}{sel.size ? ` · ${t('panel.selected', { n: sel.size })}` : ''} · {t('panel.dragHint')}</div>
</aside>

<style>
  .pane {
    position: relative;
    flex: none;
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-left: 1px solid var(--line);
    background: var(--bg-elev);
  }
  .grip {
    position: absolute;
    left: -3px;
    top: 0;
    bottom: 0;
    width: 6px;
    cursor: col-resize;
    z-index: 2;
  }
  .grip:hover,
  .grip:active {
    background: color-mix(in srgb, var(--accent) 45%, transparent);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 8px 6px;
    border-bottom: 1px solid var(--line);
  }
  .title {
    flex: 1;
    min-width: 0;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .places {
    max-width: 110px;
    border: 0;
    background: transparent;
    color: var(--fg-muted);
    font: inherit;
    font-size: 12px;
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 4px 6px 12px;
  }
  .list.hit {
    box-shadow: inset 0 0 0 2px var(--accent);
    background: color-mix(in srgb, var(--accent-soft) 40%, transparent);
  }
  .row {
    display: grid;
    grid-template-columns: 26px 1fr auto auto;
    align-items: center;
    gap: 8px;
    padding: 3px 6px;
    border-radius: 6px;
    cursor: default;
    user-select: none;
  }
  .row:hover {
    background: var(--bg-sunken);
  }
  .row.sel {
    background: var(--accent-soft);
  }
  .row.hit {
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .ico {
    width: 26px;
    height: 22px;
    display: grid;
    place-items: center;
    color: var(--fg-muted);
  }
  .ico img {
    width: 26px;
    height: 22px;
    object-fit: cover;
    border-radius: 3px;
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    font-size: 11px;
    color: var(--fg-faint);
    white-space: nowrap;
  }
  .msg {
    padding: 16px;
    color: var(--fg-faint);
    text-align: center;
  }
  .foot {
    padding: 6px 10px;
    font-size: 11px;
    color: var(--fg-faint);
    border-top: 1px solid var(--line);
  }
</style>
