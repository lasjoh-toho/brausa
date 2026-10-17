<script lang="ts">
  import type { Entry } from '../core/types';
  import { app } from '../state/app.svelte';
  import { drag } from '../state/drag.svelte';
  import { tagColor } from '../core/tags';
  import TreeNode from './TreeNode.svelte';
  import Icon from './Icon.svelte';

  const homeEntry = $derived<Entry>({
    path: app.home,
    name: app.home.split(/[\\/]/).filter(Boolean).pop() ?? app.home,
    ext: '',
    kind: 'dir',
    size: 0,
    mtime: 0,
    ctime: 0,
    tags: []
  });

  const topTags = $derived(
    [...app.tagIndex.entries()]
      .filter(([t]) => !t.includes('/') || app.search.includes('#' + t.split('/')[0]))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 14)
  );

  function filterTag(t: string) {
    const term = '#' + t;
    app.searchMode = 'filter';
    app.search = app.search.trim() === term ? '' : term;
  }
</script>

<aside class="sidebar">
  <div class="brand" data-tauri-drag-region>
    brausa
    {#if app.backend.name === 'demo'}<span class="demo" title="Läuft im Browser mit Beispieldaten">Demo</span>{/if}
  </div>

  <div class="section">Orte</div>
  {#each app.places as p (p.path)}
    {@const hit = drag.active && drag.hit?.kind === 'folder' && drag.hit.path === p.path}
    <div
      class="place"
      class:current={app.cwd === p.path}
      class:hit
      data-drop="folder"
      data-path={p.path}
      role="button"
      tabindex="0"
      onpointerdown={(e) =>
        drag.begin(
          e,
          () => [{ ...homeEntry, path: p.path, name: p.name }],
          'tree',
          () => app.navigate(p.path)
        )}
      onkeydown={(e) => e.key === 'Enter' && app.navigate(p.path)}
    >
      <Icon name={p.path === app.home ? 'home' : 'folder'} size={15} />
      {p.name}
    </div>
  {/each}

  <div class="section with-action">
    Projekte
    {#if app.cwd && !app.libraries.some((l) => l.root === app.cwd)}
      <button class="add" title="Aktuellen Ordner als Projekt einbeziehen" onclick={() => app.addProject(app.cwd)}>
        <Icon name="plus" size={13} />
      </button>
    {/if}
  </div>
  {#each app.libraries as l (l.id)}
    {@const hit = drag.active && drag.hit?.kind === 'folder' && drag.hit.path === l.root}
    <div
      class="place project"
      class:current={app.cwd === l.root}
      class:hit
      data-drop="folder"
      data-path={l.root}
      role="button"
      tabindex="0"
      title="{l.root}&#10;{l.files} Dateien mit Metadaten{l.orphans ? ` · ${l.orphans} vermisst` : ''}"
      onpointerdown={(e) => drag.begin(e, () => [{ ...homeEntry, path: l.root!, name: l.name }], 'tree', () => app.navigate(l.root!))}
      onkeydown={(e) => e.key === 'Enter' && app.navigate(l.root!)}
    >
      <Icon name="kanban" size={15} />
      <span class="pname">{l.name}</span>
      {#if l.orphans}<span class="warn" title="{l.orphans} Dateien vermisst">{l.orphans}</span>{/if}
      <button
        class="rm"
        title="Nicht mehr als Projekt führen (Dateien bleiben)"
        onpointerdown={(e) => e.stopPropagation()}
        onclick={() => app.removeProject(l.root!)}><Icon name="x" size={11} /></button
      >
    </div>
  {:else}
    <p class="hint">Ordner öffnen und mit + als Projekt einbeziehen.</p>
  {/each}

  <div class="section">Ordner</div>
  <div class="tree" data-autoscroll role="tree">
    {#if app.home}
      <TreeNode entry={homeEntry} />
    {/if}
  </div>

  {#if topTags.length}
    <div class="section">Tags</div>
    <div class="tags">
      {#each topTags as [t, n] (t)}
        <button class="chip tag" class:on={app.search.trim() === '#' + t} onclick={() => filterTag(t)}>
          <span class="dot" style:background={tagColor(t)}></span>{t}<span class="n">{n}</span>
        </button>
      {/each}
    </div>
  {/if}
</aside>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    flex: none;
    width: var(--sidebar-w);
    padding: 0 10px 16px;
    overflow-y: auto;
    border-right: 1px solid var(--line);
    background: var(--bg);
    min-height: 0;
  }
  .brand {
    height: var(--toolbar-h);
    display: flex;
    align-items: center;
    padding-left: 8px;
    font-weight: 650;
    letter-spacing: -0.02em;
    font-size: 15px;
  }
  .demo {
    margin-left: 8px;
    padding: 1px 6px;
    border-radius: 5px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--fg-faint);
    background: var(--bg-sunken);
  }
  .section {
    margin: 14px 8px 6px;
    font-size: 11px;
    font-weight: 600;
    color: var(--fg-faint);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .place {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 28px;
    padding: 0 8px;
    border-radius: 7px;
    color: var(--fg-muted);
    user-select: none;
  }
  .place:hover,
  .place.current {
    background: var(--bg-sunken);
    color: var(--fg);
  }
  .place.hit {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1.5px var(--accent);
    color: var(--fg);
  }
  .tree {
    flex: none;
  }
  .with-action {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .add {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 5px;
    color: var(--fg-muted);
  }
  .add:hover {
    background: var(--bg-sunken);
    color: var(--fg);
  }
  .pname {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .warn {
    font-size: 10px;
    font-weight: 600;
    padding: 0 5px;
    border-radius: 8px;
    background: var(--attr-soft);
    color: var(--attr);
  }
  .project .rm {
    display: none;
    color: var(--fg-faint);
  }
  .project:hover .rm {
    display: grid;
  }
  .hint {
    margin: 0 8px;
    font-size: 11px;
    color: var(--fg-faint);
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 0 6px;
  }
  .tag:hover,
  .tag.on {
    color: var(--fg);
    background: var(--line);
  }
  .n {
    color: var(--fg-faint);
    margin-left: 2px;
  }
</style>
