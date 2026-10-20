<script lang="ts">
  /**
   * A project's start page: its views at a glance — files, notes & snippets,
   * pinboard (maps), Kanban, wikis and smart folders — each one click away.
   */
  import { app } from '../state/app.svelte';
  import { board } from '../state/board.svelte';
  import { wikis } from '../state/wikis.svelte';
  import { DEFAULT_STATUSES } from '../core/map';
  import { ofProject } from '../core/smart';
  import Icon from './Icon.svelte';
  import { t, tn } from '../i18n/index.svelte';

  const p = $derived(app.currentProject!);

  // The maps (pinboards) of the project: open them so their cards can be shown here.
  $effect(() => {
    if (p && board.root !== p.root) void board.open(p.root);
  });

  const cards = $derived(board.root === p.root && board.map ? Object.values(board.map.cards) : []);
  // The thread first (newest on top), then snippets placed on the open map.
  const snippets = $derived(
    [...(board.root === p.root ? board.notes : [])].reverse().map((n) => ({ id: n.id, text: n.text, title: n.title, thread: true }))
      .concat(cards.filter((c) => c.kind === 'snippet').reverse().map((c) => ({ id: c.id, text: c.text, title: c.title, thread: false })))
      .slice(0, 8)
  );
  const statuses = $derived(board.map?.statuses ?? DEFAULT_STATUSES);
  const columns = $derived(statuses.map((s) => ({ s, n: cards.filter((c) => c.status === s).length })));
  const projectWikis = $derived(wikis.recipes.filter((r) => r.bags.some((b) => b.startsWith(`@map:${p.root}|`))));
  const smart = $derived(ofProject(app.smartFolders, p.id));
  const files = $derived(app.raw.filter((e) => e.kind === 'file').length);

  function openMap(id?: string) {
    board.setMode('map');
    if (id && board.map?.id !== id) void board.load(id);
    app.setView('board');
  }

  function openKanban() {
    board.setMode('kanban');
    app.setView('board');
  }

  function openWiki(path: string) {
    void app.backend.openDefault(path).catch((e) => app.toast(String(e).replace(/^Error: /, ''), true));
  }
</script>

<div class="start">
  <header>
    <span class="dot" style:background={p.color ?? 'var(--accent)'}></span>
    <h1>{p.name}</h1>
    <span class="meta">{tn('common.files', files)}{p.folders.length ? ' · ' + tn('sidebar.folders', p.folders.length) : ''}</span>
  </header>

  <div class="cards">
    <section class="card">
      <h2><Icon name="grid" size={15} />{t('start.files')}</h2>
      <p class="big">{files}</p>
      <div class="acts">
        <button class="btn" onclick={() => app.setView('stream')}>{t('start.tiles')}</button>
        <button class="btn" onclick={() => app.setView('table')}>{t('start.table')}</button>
      </div>
    </section>

    <section class="card wide">
      <h2><Icon name="doc" size={15} />{t('start.notes')}</h2>
      {#if snippets.length}
        <ul class="quotes">
          {#each snippets as c (c.id)}
            <li><button onclick={() => (c.thread && board.toggleNotes(true), openMap())} title={c.title}>{c.thread ? '' : '„'}{(c.text || c.title).slice(0, 160)}{c.thread ? '' : '“'}</button></li>
          {/each}
        </ul>
      {:else}
        <p class="muted">{t('start.noSnippets')}</p>
      {/if}
    </section>

    <section class="card">
      <h2><Icon name="nodes" size={15} />{t('start.pinboard')}</h2>
      <ul class="list">
        {#each board.root === p.root ? board.maps : [] as m (m.id)}
          <li><button onclick={() => openMap(m.id)}><Icon name="map" size={12} />{m.title}</button></li>
        {:else}
          <li class="muted">{t('start.noMaps')}</li>
        {/each}
      </ul>
      <div class="acts"><button class="btn" onclick={() => openMap()}>{t('start.openPinboard')}</button></div>
    </section>

    <section class="card">
      <h2><Icon name="kanban" size={15} />{t('start.kanban')}</h2>
      <div class="cols">
        {#each columns as c (c.s)}
          <button class="col" onclick={openKanban}><span class="n">{c.n}</span><span>{c.s}</span></button>
        {/each}
      </div>
    </section>

    <section class="card">
      <h2><Icon name="book" size={15} />{t('start.wikis')}</h2>
      <ul class="list">
        {#each projectWikis as w (w.name)}
          <li>
            <button onclick={() => openWiki(w.target.path)} title={w.target.path}><Icon name="book" size={12} />{w.name}</button>
            <button class="sync" class:spin={wikis.syncing === w.name} title={t('sidebar.syncWiki')} onclick={() => wikis.sync(w.name)}><Icon name="sync" size={12} /></button>
          </li>
        {:else}
          <li class="muted">{t('start.noWikis')}</li>
        {/each}
      </ul>
      <div class="acts"><button class="btn" onclick={() => wikis.open('')}>{t('start.newWiki')}</button></div>
    </section>

    {#if smart.length}
      <section class="card">
        <h2><Icon name="filter" size={15} />{t('sidebar.smartFolders')}</h2>
        <ul class="list">
          {#each smart as k (k.folder.id)}
            <li><button onclick={() => app.openSmart(k.folder.id)}><Icon name={k.linked ? 'nodes' : 'filter'} size={12} />{k.folder.name}</button></li>
          {/each}
        </ul>
      </section>
    {/if}
  </div>
</div>

<style>
  .start {
    max-width: 1100px;
    margin: 0 auto;
  }
  header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 6px 0 18px;
  }
  .dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
  }
  h1 {
    margin: 0;
    font-size: 22px;
    font-weight: 650;
    letter-spacing: -0.01em;
  }
  .meta {
    color: var(--fg-faint);
    font-size: 13px;
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 14px;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
    padding: 14px 16px;
    border-radius: 14px;
    background: var(--bg-elev);
    box-shadow:
      var(--shadow),
      0 0 0 1px var(--line);
  }
  .card.wide {
    grid-column: span 2;
  }
  @media (max-width: 760px) {
    .card.wide {
      grid-column: auto;
    }
  }
  h2 {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }
  .big {
    margin: 0;
    font-size: 30px;
    font-weight: 650;
  }
  .acts {
    display: flex;
    gap: 6px;
    margin-top: auto;
  }
  .muted {
    margin: 0;
    color: var(--fg-faint);
    font-size: 12px;
  }
  .list,
  .quotes {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .list li {
    display: flex;
    align-items: center;
  }
  .list button:first-child {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 0;
    padding: 4px 6px;
    border-radius: 6px;
    font-size: 13px;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .list button:hover,
  .quotes button:hover {
    background: var(--bg-sunken);
  }
  .quotes button {
    display: block;
    width: 100%;
    padding: 5px 6px;
    border-radius: 6px;
    text-align: left;
    font-size: 13px;
    color: var(--fg-muted);
  }
  .cols {
    display: flex;
    gap: 6px;
  }
  .col {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex: 1;
    padding: 8px 4px;
    border-radius: 10px;
    background: var(--bg-sunken);
    font-size: 11px;
    color: var(--fg-muted);
  }
  .col .n {
    font-size: 20px;
    font-weight: 650;
    color: var(--fg);
  }
  .sync {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    color: var(--fg-faint);
  }
  .sync.spin :global(svg) {
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
