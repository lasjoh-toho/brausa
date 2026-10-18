<script lang="ts">
  import type { Entry } from '../core/types';
  import { app } from '../state/app.svelte';
  import { wikis } from '../state/wikis.svelte';
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

  /** New project being named (null: no input), project being renamed, project asking to confirm deletion. */
  let naming = $state<string | null>(null);
  let renaming = $state<string | null>(null);
  let deleting = $state<string | null>(null);

  // Map bags list the projects' maps, so reload when projects change.
  $effect(() => {
    void app.projects.length;
    void wikis.load();
  });

  function openTarget(path: string, kind: string) {
    if (kind === 'folder') app.navigate(path);
    else void app.backend.openDefault(path).catch((e) => app.toast(String(e).replace(/^Error: /, ''), true));
  }

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
      class:current={!app.project && app.cwd === p.path}
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
    <button class="add" title="Neues Projekt (frei benannt, Dateien von überall)" onclick={() => ((naming = ''), (renaming = null))}>
      <Icon name="plus" size={13} />
    </button>
  </div>
  {#if naming !== null}
    <!-- svelte-ignore a11y_autofocus -->
    <input
      class="pinput"
      bind:value={naming}
      placeholder="Projektname"
      autofocus
      onkeydown={(e) => {
        if (e.key === 'Enter' && naming?.trim()) void app.createProject(naming).then(() => (naming = null));
        else if (e.key === 'Escape') naming = null;
      }}
      onblur={() => !naming?.trim() && (naming = null)}
    />
  {/if}
  {#each app.projects as p (p.id)}
    {@const hit = drag.active && drag.hit?.kind === 'project' && drag.hit.key === p.id}
    {#if renaming === p.id}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="pinput"
        value={p.name}
        autofocus
        onkeydown={(e) => {
          if (e.key === 'Enter') void app.renameProject(p.id, e.currentTarget.value).then(() => (renaming = null));
          else if (e.key === 'Escape') renaming = null;
        }}
        onblur={() => (renaming = null)}
      />
    {:else}
      <div
        class="place project"
        class:current={app.project === p.id}
        class:hit
        data-drop="project"
        data-key={p.id}
        role="button"
        tabindex="0"
        title="{p.name}: {p.files.length} Dateien{p.folders.length ? `, ${p.folders.length} Ordner` : ''}&#10;Dateien und Ordner hierher ziehen fügt sie hinzu (sie bleiben, wo sie sind)."
        onclick={() => app.openProject(p.id)}
        ondblclick={() => (renaming = p.id)}
        onkeydown={(e) => e.key === 'Enter' && app.openProject(p.id)}
      >
        <Icon name="kanban" size={15} />
        <span class="pname">{p.name}</span>
        {#if deleting === p.id}
          <button class="rm sure" onclick={(e) => (e.stopPropagation(), (deleting = null), void app.deleteProject(p.id))}>Löschen?</button>
        {:else}
          <button class="rm" title="Umbenennen" onclick={(e) => (e.stopPropagation(), (renaming = p.id))}><Icon name="pencil" size={11} /></button>
          <button
            class="rm"
            title="Projekt löschen (die Dateien bleiben, wo sie sind)"
            onclick={(e) => (e.stopPropagation(), (deleting = p.id), setTimeout(() => deleting === p.id && (deleting = null), 3000))}
            ><Icon name="x" size={11} /></button
          >
        {/if}
      </div>
    {/if}
  {:else}
    {#if naming === null}<p class="hint">Mit + ein Projekt anlegen, dann Dateien und Ordner von überall darauf ziehen.</p>{/if}
  {/each}

  <div class="section with-action">
    Wikis
    <span class="grow"></span>
    {#if wikis.overlays.length}
      <button class="ov" class:pending={wikis.pending} title="Überdeckungen gemeinsamer Bags prüfen und auflösen" onclick={() => (wikis.overlaysOpen = true)}>
        <Icon name="layers" size={12} />{wikis.pending || ''}
      </button>
    {/if}
    <button class="add" title="Neues Wiki aus Bags zusammenstellen (TiddlyWiki)" onclick={() => wikis.open('')}>
      <Icon name="plus" size={13} />
    </button>
  </div>
  {#each wikis.recipes as w (w.name)}
    <div
      class="place project"
      role="button"
      tabindex="0"
      title="{w.target.path}&#10;{w.bags.length} Bags{w.lastSync ? ` · zuletzt abgeglichen ${new Date(w.lastSync).toLocaleString()}` : ''}"
      onclick={() => wikis.open(w.name)}
      onkeydown={(e) => e.key === 'Enter' && wikis.open(w.name)}
    >
      <Icon name="book" size={15} />
      <span class="pname">{w.name}</span>
      <button class="rm" title="Wiki öffnen" onclick={(e) => (e.stopPropagation(), openTarget(w.target.path, w.target.kind))}>
        <Icon name="open" size={11} />
      </button>
      <button
        class="sync"
        class:spin={wikis.syncing === w.name}
        title="Abgleichen: Änderungen aus dem Wiki übernehmen, dann ins Wiki schreiben"
        onclick={(e) => (e.stopPropagation(), wikis.sync(w.name))}><Icon name="sync" size={12} /></button
      >
    </div>
  {:else}
    <p class="hint">Maps und gemeinsame Bags als TiddlyWiki – mit + anlegen.</p>
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
  .pinput {
    width: 100%;
    margin: 2px 0;
    padding: 4px 8px;
    border-radius: 7px;
    border: 1px solid var(--accent);
    background: var(--bg);
    color: var(--fg);
    font: inherit;
  }
  .rm.sure {
    width: auto;
    padding: 0 6px;
    color: var(--danger);
    font-size: 11px;
    opacity: 1;
  }
  .pname {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .project .rm {
    display: none;
    color: var(--fg-faint);
  }
  .project:hover .rm {
    display: grid;
  }
  .project .rm.sure {
    display: inline-flex;
  }
  .grow {
    flex: 1;
  }
  .ov {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    height: 18px;
    padding: 0 5px;
    margin-right: 4px;
    border-radius: 9px;
    font-size: 10px;
    color: var(--fg-faint);
  }
  .ov.pending {
    color: var(--attr);
    background: var(--attr-soft);
  }
  .sync {
    display: grid;
    place-items: center;
    color: var(--fg-faint);
  }
  .sync:hover {
    color: var(--accent);
  }
  .sync.spin :global(svg) {
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
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
