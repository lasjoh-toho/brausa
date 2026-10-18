<script lang="ts">
  import type { Entry } from '../core/types';
  import type { ProjectInfo } from '../backend/types';
  import { basename } from '../core/paths';
  import { app } from '../state/app.svelte';
  import { drag } from '../state/drag.svelte';
  import { board, READABLE } from '../state/board.svelte';
  import { filterEntries } from '../core/views';
  import { family } from '../core/format';
  import Icon from './Icon.svelte';

  /**
   * "Bausteine": the project's files and folders, to drag onto the map
   * (or to drop a card on, which links the card to that file).
   */
  let { project }: { project: ProjectInfo } = $props();

  let files = $state<Entry[]>([]);
  let dirs = $state<Entry[]>([]);
  let q = $state('');
  let loading = $state(false);

  $effect(() => {
    const id = project.id;
    void app.fsVersion;
    loading = true;
    app.backend
      .projectEntries(id)
      .then((f) => {
        if (id !== project.id) return;
        files = f.filter((e) => e.kind === 'file');
      })
      .catch((e) => app.toast(String(e), true))
      .finally(() => (loading = false));
  });
  // The project's folders, to drag onto the map as a whole.
  $effect(() => {
    dirs = project.folders.map((path) => ({ path, name: basename(path), ext: '', kind: 'dir', size: 0, mtime: 0, ctime: 0, tags: [] }));
  });

  const shown = $derived(filterEntries(files, { search: q, sort: 'mtime', desc: true }).slice(0, 300));

  $effect(() => {
    for (const e of shown.slice(0, 60)) app.requestThumb(e);
  });
</script>

<aside class="panel">
  <div class="head">
    <Icon name="folder" size={14} /> Dateien
    <span class="n">{files.length}</span>
  </div>
  <input class="search" bind:value={q} placeholder="Filtern … *.pdf #tag" spellcheck="false" />
  <div class="hint">Auf die Map ziehen legt eine Karte an; rechter Kartenrand verknüpft. Karte hierher ziehen verknüpft sie mit der Datei.</div>

  {#if dirs.length && !q}
    <div class="sec">Ordner</div>
    <div class="dirs">
      {#each dirs as d (d.path)}
        <div
          class="dir"
          role="button"
          tabindex="-1"
          data-file-path={d.path}
          data-dir=""
          onpointerdown={(e) => drag.begin(e, () => [d], 'panel')}
        >
          <Icon name="folder" size={13} />{d.name}
        </div>
      {/each}
    </div>
  {/if}

  <div class="sec">{q ? 'Treffer' : 'Zuletzt geändert'}</div>
  <div class="list" data-autoscroll>
    {#each shown as e (e.path)}
      {@const t = app.thumbOf(e)}
      <div
        class="item"
        role="button"
        tabindex="-1"
        title={e.path}
        data-file-path={e.path}
        onpointerdown={(ev) => drag.begin(ev, () => [e], 'panel')}
        ondblclick={() => (READABLE.has(e.ext) ? board.openReader({ kind: 'file', path: e.path, name: e.name, ext: e.ext }) : app.open(e))}
      >
        <div class="thumb">
          {#if t}<img src={t} alt="" draggable="false" />{:else}<span>{e.ext || family(e.ext)}</span>{/if}
        </div>
        <div class="meta">
          <div class="name">{e.name}</div>
          {#if e.relDir}<div class="rel">{e.relDir}</div>{/if}
        </div>
      </div>
    {:else}
      <p class="none">{loading ? 'Lädt …' : 'Keine Dateien'}</p>
    {/each}
  </div>
</aside>

<style>
  .panel {
    flex: none;
    width: 260px;
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-left: 1px solid var(--line);
    background: var(--bg);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 12px 12px 6px;
    font-weight: 600;
  }
  .n {
    margin-left: auto;
    font-size: 11px;
    color: var(--fg-faint);
  }
  .search {
    margin: 0 10px;
    padding: 6px 8px;
    border-radius: 7px;
    border: 1px solid var(--line);
    background: var(--bg-elev);
    color: var(--fg);
    outline: none;
  }
  .hint {
    margin: 6px 12px 0;
    font-size: 11px;
    color: var(--fg-faint);
  }
  .sec {
    margin: 12px 12px 4px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-faint);
  }
  .dirs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 0 10px;
  }
  .dir {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    border-radius: 7px;
    background: var(--bg-sunken);
    color: var(--fg-muted);
    cursor: grab;
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 6px 12px;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border-radius: 7px;
    cursor: grab;
  }
  .item:hover {
    background: var(--bg-sunken);
  }
  .thumb {
    flex: none;
    width: 38px;
    height: 38px;
    display: grid;
    place-items: center;
    border-radius: 5px;
    overflow: hidden;
    background: var(--bg-sunken);
    font-size: 10px;
    color: var(--fg-faint);
    text-transform: uppercase;
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .meta {
    min-width: 0;
  }
  .name,
  .rel {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .rel {
    font-size: 11px;
    color: var(--fg-faint);
  }
  .none {
    padding: 0 8px;
    color: var(--fg-faint);
  }
</style>
