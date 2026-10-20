<script lang="ts">
  /**
   * Web panel next to the files. The page itself is a native webview that
   * brausa lays over `.view`; it is hidden while menus, dialogs or a drag
   * would otherwise end up underneath it.
   */
  import { onMount } from 'svelte';
  import { app } from '../state/app.svelte';
  import { drag } from '../state/drag.svelte';
  import { wikis } from '../state/wikis.svelte';
  import { web } from '../state/web.svelte';
  import Icon from './Icon.svelte';
  import FindBar from './FindBar.svelte';
  import { filterPages, shortUrl } from '../core/web';
  import { board } from '../state/board.svelte';
  // pdf.js is large: load the reader only when a document is opened.
  const loadReader = () => import('./Reader.svelte');
  import { t, loc } from '../i18n/index.svelte';

  let view = $state<HTMLElement>();
  /** Choosing the project for the marked text. */
  let sendOpen = $state(false);

  // Watch the page (scrolling, marked text) while it is shown.
  $effect(() => {
    web.watchPage(web.open && web.started && !web.home && web.mode === 'web');
    return () => web.watchPage(false);
  });
  $effect(() => {
    if (!web.hasSelection) sendOpen = false;
  });
  let address = $state(web.url);
  let editing = $state(false);

  $effect(() => {
    if (!editing) address = web.url;
  });

  // Anything brausa draws over the panel must not end up under the native page.
  const covered = $derived(
    !!web.listOpen || web.suggest || sendOpen || web.collectDialog || !!app.preview || !!app.menu || !!app.dialog || app.sizeSelectOpen || !!app.batchRenaming || app.gridEditorOpen || app.tagBarOpen || wikis.editing !== null || wikis.overlaysOpen || wikis.overviewOpen || wikis.settingsOpen || !!wikis.webSync || (drag.active && drag.source !== 'web')
  );

  function measure() {
    if (!view) return;
    const r = view.getBoundingClientRect();
    void web.place({ x: r.left, y: r.top, w: r.width, h: r.height }, !covered);
  }

  $effect(() => {
    void covered;
    void web.width;
    void web.started;
    void web.home;
    void web.mode;
    void board.reader;
    measure();
  });

  onMount(() => {
    // The panel starts with the speed dial, not with the last page.
    const ro = new ResizeObserver(measure);
    if (view) ro.observe(view);
    window.addEventListener('resize', measure);
    // Panels around it change size without resizing this element (sidebar, second panel).
    const timer = setInterval(measure, 500);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      clearInterval(timer);
      void web.place({ x: 0, y: 0, w: 1, h: 1 }, false);
    };
  });

  function resize(e: PointerEvent) {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = web.width;
    const move = (ev: PointerEvent) => web.setWidth(w0 + x0 - ev.clientX);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const secure = $derived(web.url.startsWith('https:'));
  let query = $state('');
  const lib = $derived(web.library);
  const shown = $derived(filterPages(web.listOpen === 'history' ? lib.history : [...lib.bookmarks].reverse(), query));
  const scopeName = $derived(web.scope.name ? t('webpane.scopeName', { name: web.scope.name }) : t('webpane.noProject'));

  function openList(which: 'bookmarks' | 'history') {
    query = '';
    web.listOpen = web.listOpen === which ? null : which;
  }

  // Recent pages under the address bar: everything at first, then what matches the typed text.
  const suggestions = $derived(
    filterPages([...lib.bookmarks].reverse().concat(lib.history.filter((h) => !lib.bookmarks.some((b) => b.url === h.url))), address === web.url ? '' : address).slice(0, 12)
  );
  const docName = $derived(board.reader?.ref.name ?? '');

  const when = (ms: number) => new Date(ms).toLocaleString(loc(), { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

  // ---------------------------------------------------------------- find in the page

  let finding = $state(false);
  let findQuery = '';
  let found = $state({ n: 0, i: -1 });

  async function find(q: string, dir: number) {
    findQuery = q;
    const r = await app.backend.webFind(q, dir).catch(() => ({ n: -1, i: -1 }));
    if (r.n < 0) app.toast(t('find.unavailable'), true);
    found = { n: Math.max(0, r.n), i: Math.max(0, r.i) };
  }

  function closeFind() {
    finding = false;
    found = { n: 0, i: -1 };
    if (findQuery) void app.backend.webFind('', 0).catch(() => {});
    findQuery = '';
  }

  // A new page: the old hits are gone.
  $effect(() => {
    void web.url;
    found = { n: 0, i: -1 };
    findQuery = '';
  });
</script>

<aside class="web" style:width="{web.width}px">
  <div class="grip" onpointerdown={resize} role="separator" aria-orientation="vertical" aria-label={t('webpane.resize')}></div>
  {#if web.mode !== 'doc' || !board.reader}
  <div class="bar" class:gone={web.barsHidden && !web.suggest}>
    <button class="btn icon" disabled={!web.started} onclick={() => web.nav('back')} aria-label={t('webpane.back')}><Icon name="back" size={14} /></button>
    <button class="btn icon" disabled={!web.started} onclick={() => web.nav('forward')} aria-label={t('webpane.forward')}><Icon name="forward" size={14} /></button>
    <button class="btn icon" disabled={!web.started} onclick={() => web.nav('reload')} aria-label={t('webpane.reload')}><Icon name="sync" size={14} /></button>
    <button class="btn icon" class:on={web.home && web.mode === 'web'} onclick={() => web.goHome()} title={t('webpane.home')} aria-label={t('webpane.home')}><Icon name="grid" size={14} /></button>
    <form class="addr" onsubmit={(e) => (e.preventDefault(), (editing = false), address.trim() && void web.go(address))}>
      <Icon name={web.local ? 'folder' : secure ? 'globe' : 'warn'} size={12} />
      <input
        bind:value={address}
        onfocus={(e) => ((editing = true), (web.suggest = true), e.currentTarget.select())}
        onblur={() => ((editing = false), setTimeout(() => (web.suggest = false), 150))}
        onkeydown={(e) => e.key === 'Escape' && (e.currentTarget.blur(), (address = web.url))}
        placeholder={t('webpane.address')}
        spellcheck="false"
      />
      {#if web.loading}<span class="spin"></span>{/if}
      {#if web.started && !web.local}
        <button
          type="button"
          class="star"
          class:on={web.bookmarked}
          title={web.bookmarked ? t('webpane.bookmarkRemove', { scope: scopeName }) : t('webpane.bookmarkAdd', { scope: scopeName })}
          onclick={() => web.toggleBookmark()}><Icon name="star" size={13} /></button
        >
      {/if}
    </form>
    <button class="btn icon" onclick={() => web.toggle(false)} aria-label={t('webpane.closePane')}><Icon name="x" size={14} /></button>
  </div>
  <div class="bar tools" class:gone={web.barsHidden && !web.suggest}>
    {#if web.hasSelection && app.projects.length}
      <button class="btn send-btn" class:on={sendOpen} onclick={() => (sendOpen = !sendOpen)} title={t('webpane.sendTitle')}>
        <Icon name="forward" size={13} /> {t('webpane.send')}
      </button>
    {/if}
    <button class="btn" disabled={!web.started} onclick={() => web.savePage()} title={t('webpane.saveTitle')}>
      <Icon name="tray" size={13} /> {t('common.save')}
    </button>
    <button class="btn" class:on={web.listOpen === 'bookmarks'} onclick={() => openList('bookmarks')} title={t('webpane.bookmarksOf', { scope: scopeName })}>
      <Icon name="star" size={13} /> {t('webpane.bookmarks')}
    </button>
    <button class="btn icon" class:on={web.listOpen === 'history'} onclick={() => openList('history')} title={t('webpane.historyOf', { scope: scopeName })} aria-label={t('webpane.history')}>
      <Icon name="clock" size={13} />
    </button>
    <button class="btn icon" class:on={finding} disabled={!web.started || web.home} onclick={() => (finding ? closeFind() : (finding = true))} title={t('find.open')} aria-label={t('find.open')}>
      <Icon name="search" size={13} />
    </button>
    <button class="btn icon" class:on={web.adblock} onclick={() => web.setAdblock(!web.adblock)} title={web.adblock ? t('webpane.adblockOn') : t('webpane.adblockOff')} aria-label={t('webpane.adblock')}>
      <Icon name="shield" size={13} />
    </button>
    <button class="btn icon rec-btn" class:rec={web.collect} onclick={() => web.toggleCollect()} title={web.collect ? t('webpane.collectOn') : t('webpane.collectOff')} aria-label={t('webpane.collect')}>
      <span class="dot"></span>
    </button>
    <span class="grow"></span>
    {#if web.local}
      <button class="btn" class:warn={web.local.scripts} onclick={() => web.setScripts(!web.local!.scripts)} title={t('webpane.scriptsRemember')}>
        <Icon name="warn" size={12} />
        {web.local.scripts ? t('webpane.scriptsOn') : t('webpane.scriptsOff')}
      </button>
    {:else}
      <span class="note" title={t('webpane.isolatedTitle')}>
        <Icon name="globe" size={12} /> {t('webpane.isolated')}
      </span>
    {/if}
  </div>
  {/if}
  {#if finding && web.mode === 'web' && !web.home}
    <FindBar count={found.n} current={found.i} onsearch={(q) => find(q, 0)} onstep={(by) => find(findQuery, by)} onclose={closeFind} />
  {/if}
  {#if board.reader}
    <div class="tabs" role="tablist">
      <button class:on={web.mode === 'web'} role="tab" aria-selected={web.mode === 'web'} onclick={() => (web.mode = 'web')}><Icon name="globe" size={12} />{t('webpane.tabWeb')}</button>
      <button class:on={web.mode === 'doc'} role="tab" aria-selected={web.mode === 'doc'} onclick={() => (web.mode = 'doc')} title={docName}><Icon name="doc" size={12} /><span>{docName}</span></button>
    </div>
  {/if}
  <div class="view" bind:this={view}>
    {#if sendOpen}
      <div class="sendto">
        <b>{t('webpane.sendWhere')}</b>
        {#each app.projects as p (p.id)}
          <button class="chip" onclick={() => ((sendOpen = false), web.sendTo(p.id))}><Icon name="kanban" size={12} />{p.name}</button>
        {/each}
      </div>
    {:else if web.mode === 'doc' && board.reader}
      {#await loadReader() then R}<R.default docked />{/await}
    {:else if web.suggest && suggestions.length}
      <ul class="suggest">
        {#each suggestions as p (p.url)}
          <li>
            <button class="page" onpointerdown={(e) => e.preventDefault()} onclick={() => ((address = p.url), web.pick(p.url))} title={p.url}>
              <span class="t">{p.title || shortUrl(p.url)}</span>
              <span class="u">{shortUrl(p.url)}</span>
            </button>
          </li>
        {/each}
      </ul>
    {:else if web.listOpen}
      <div class="list">
        <div class="list-head">
          <b>{web.listOpen === 'history' ? t('webpane.history') : t('webpane.bookmarks')}</b>
          <span class="scope">{scopeName}</span>
          <span class="grow"></span>
          {#if web.listOpen === 'history' && lib.history.length}
            <button class="btn" onclick={() => web.clearHistory()}>{t('webpane.clearHistory')}</button>
          {/if}
          <button class="btn icon" onclick={() => (web.listOpen = null)} aria-label={t('common.close')}><Icon name="x" size={13} /></button>
        </div>
        <!-- svelte-ignore a11y_autofocus -->
        <input class="filter" bind:value={query} placeholder={t('webpane.searchPlaceholder')} autofocus onkeydown={(e) => e.key === 'Enter' && shown[0] && web.pick(shown[0].url)} />
        <ul>
          {#each shown as p (p.url)}
            <li>
              <button class="page" onclick={() => web.pick(p.url)} title={p.url}>
                <span class="t">{p.title || shortUrl(p.url)}</span>
                <span class="u">{shortUrl(p.url)}</span>
              </button>
              {#if web.listOpen === 'history'}<span class="when">{when(p.at)}</span>{/if}
              <button
                class="rm"
                title={web.listOpen === 'history' ? t('webpane.removeFromHistory') : t('webpane.removeBookmark')}
                onclick={() => (web.listOpen === 'history' ? web.forget(p.url) : web.toggleBookmark(p))}><Icon name="x" size={11} /></button
              >
            </li>
          {:else}
            <li class="none">
              {#if query}{t('webpane.nothingFound')}{:else if web.listOpen === 'history'}{t('webpane.noHistory')}{:else}{t('webpane.noBookmarks')}{/if}
            </li>
          {/each}
        </ul>
        <p class="muted foot">{t('webpane.listFoot')}</p>
      </div>
    {:else if !web.started || web.home}
      <div class="dial">
        {#if web.dial.length}
          <div class="tiles">
            {#each web.dial as p (p.url)}
              <button class="tile" title={p.url} onclick={() => web.pick(p.url)}>
                <span class="fav">{(p.title || shortUrl(p.url)).slice(0, 1).toUpperCase()}</span>
                <span class="t">{p.title || shortUrl(p.url)}</span>
                <span class="u">{shortUrl(p.url)}</span>
              </button>
            {/each}
          </div>
        {:else}
          <div class="start">
            <Icon name="globe" size={28} />
            <p>{t('webpane.startHint')}</p>
            <p class="muted">{t('webpane.startInfo')}</p>
            <p class="muted">{t('webpane.startLocal')}</p>
          </div>
        {/if}
      </div>
    {:else if covered}
      <div class="start muted">…</div>
    {/if}
  </div>
</aside>

<style>
  .web {
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
  .bar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 8px;
  }
  .tools {
    padding-top: 0;
    border-bottom: 1px solid var(--line);
  }
  .addr {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
    height: 28px;
    border-radius: 8px;
    background: var(--bg-sunken);
    color: var(--fg-faint);
  }
  .addr input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    color: var(--fg);
    font: inherit;
    font-size: 12.5px;
    outline: none;
  }
  .spin {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 2px solid var(--line);
    border-top-color: var(--accent);
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .grow {
    flex: 1;
  }
  .note {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--fg-faint);
  }
  .btn.warn {
    color: #a15c00;
  }
  .view {
    position: relative;
    flex: 1;
    min-height: 0;
    background: #fff;
  }
  .start {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 8px;
    padding: 24px;
    text-align: center;
    color: var(--fg-muted);
    background: var(--bg);
  }
  .star {
    display: grid;
    place-items: center;
    color: var(--fg-faint);
  }
  .star:hover {
    color: var(--fg);
  }
  .star.on {
    color: #d49b00;
  }
  .star.on :global(path) {
    fill: currentColor;
  }
  .list {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 14px;
    background: var(--bg);
    overflow: hidden;
  }
  .list-head {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .scope {
    color: var(--fg-faint);
    font-size: 12px;
  }
  .filter {
    padding: 6px 9px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--bg-elev);
    color: var(--fg);
    font: inherit;
    font-size: 12.5px;
    outline: none;
  }
  .filter:focus {
    border-color: var(--accent);
  }
  .list ul {
    flex: 1;
    margin: 0;
    padding: 0;
    list-style: none;
    overflow: auto;
  }
  .list li {
    display: flex;
    align-items: center;
    gap: 8px;
    border-radius: 7px;
  }
  .list li:hover {
    background: var(--bg-sunken);
  }
  .page {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 5px 8px;
    text-align: left;
  }
  .t,
  .u {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .t {
    font-size: 13px;
    color: var(--fg);
  }
  .u,
  .when {
    font-size: 11px;
    color: var(--fg-faint);
  }
  .when {
    flex: none;
  }
  .rm {
    flex: none;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    margin-right: 4px;
    border-radius: 5px;
    color: var(--fg-faint);
    visibility: hidden;
  }
  .list li:hover .rm {
    visibility: visible;
  }
  .rm:hover {
    color: var(--fg);
    background: var(--line);
  }
  .none {
    padding: 8px;
    font-size: 12px;
    color: var(--fg-faint);
  }
  .foot {
    margin: 0;
    font-size: 11px;
  }
  .muted {
    color: var(--fg-faint);
    font-size: 12px;
    max-width: 420px;
  }
  .tabs {
    display: flex;
    gap: 2px;
    padding: 0 8px;
    border-bottom: 1px solid var(--line);
  }
  .tabs button {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-width: 50%;
    padding: 5px 10px;
    font-size: 12px;
    color: var(--fg-muted);
    border-bottom: 2px solid transparent;
  }
  .tabs button span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tabs button.on {
    color: var(--fg);
    border-bottom-color: var(--accent);
  }
  .view :global(.reader) {
    height: 100%;
  }
  .suggest {
    position: absolute;
    inset: 0;
    margin: 0;
    padding: 6px;
    list-style: none;
    overflow: auto;
    background: var(--bg);
  }
  .suggest .page {
    display: flex;
    flex-direction: column;
    width: 100%;
    padding: 6px 8px;
    border-radius: 7px;
    text-align: left;
  }
  .suggest .page:hover {
    background: var(--bg-sunken);
  }
  .suggest .t,
  .dial .t {
    font-size: 13px;
    color: var(--fg);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
  .suggest .u,
  .dial .u {
    font-size: 11px;
    color: var(--fg-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
  .dial {
    position: absolute;
    inset: 0;
    overflow: auto;
    padding: 16px;
    background: var(--bg);
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 10px;
  }
  .dial .tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    min-width: 0;
    padding: 14px 8px 10px;
    border-radius: 12px;
    background: var(--bg-elev);
    box-shadow: 0 0 0 1px var(--line);
  }
  .dial .tile:hover {
    box-shadow: 0 0 0 2px var(--accent);
  }
  .fav {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    margin-bottom: 4px;
    border-radius: 10px;
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 700;
    font-size: 17px;
  }
  .bar {
    transition:
      margin-top 0.18s,
      opacity 0.18s;
  }
  .bar.gone {
    margin-top: -38px;
    opacity: 0;
    pointer-events: none;
  }
  .rec-btn .dot {
    display: block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 1.5px solid var(--fg-muted);
  }
  .rec-btn.rec .dot {
    border-color: var(--danger);
    background: var(--danger);
    animation: rec 1.2s ease-in-out infinite;
  }
  @keyframes rec {
    50% {
      opacity: 0.4;
    }
  }
  .send-btn {
    color: var(--accent);
  }
  .sendto {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    padding: 16px;
    background: var(--bg);
  }
  .sendto .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 9px;
    background: var(--bg-elev);
    box-shadow: 0 0 0 1px var(--line);
  }
  .sendto .chip:hover {
    box-shadow: 0 0 0 2px var(--accent);
  }
</style>
