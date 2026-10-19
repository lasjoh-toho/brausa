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
  import { filterPages, shortUrl } from '../core/web';
  import { t, loc } from '../i18n/index.svelte';

  let view = $state<HTMLElement>();
  let address = $state(web.url);
  let editing = $state(false);

  $effect(() => {
    if (!editing) address = web.url;
  });

  // Anything brausa draws over the panel must not end up under the native page.
  const covered = $derived(
    !!web.listOpen || !!app.preview || !!app.menu || !!app.dialog || !!app.batchRenaming || app.gridEditorOpen || app.tagBarOpen || wikis.editing !== null || wikis.overlaysOpen || wikis.overviewOpen || drag.active
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
    measure();
  });

  onMount(() => {
    // Reopen the last page; addresses of local sites are only valid while the app runs.
    if (!web.started && web.url && !/^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]+\//.test(web.url)) void web.go(web.url);
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

  const when = (ms: number) => new Date(ms).toLocaleString(loc(), { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
</script>

<aside class="web" style:width="{web.width}px">
  <div class="grip" onpointerdown={resize} role="separator" aria-orientation="vertical" aria-label={t('webpane.resize')}></div>
  <div class="bar">
    <button class="btn icon" disabled={!web.started} onclick={() => web.nav('back')} aria-label={t('webpane.back')}><Icon name="back" size={14} /></button>
    <button class="btn icon" disabled={!web.started} onclick={() => web.nav('forward')} aria-label={t('webpane.forward')}><Icon name="forward" size={14} /></button>
    <button class="btn icon" disabled={!web.started} onclick={() => web.nav('reload')} aria-label={t('webpane.reload')}><Icon name="sync" size={14} /></button>
    <form class="addr" onsubmit={(e) => (e.preventDefault(), (editing = false), address.trim() && void web.go(address))}>
      <Icon name={web.local ? 'folder' : secure ? 'globe' : 'warn'} size={12} />
      <input
        bind:value={address}
        onfocus={(e) => ((editing = true), e.currentTarget.select())}
        onblur={() => (editing = false)}
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
  <div class="bar tools">
    <button class="btn" disabled={!web.started} onclick={() => web.clip()} title={t('webpane.clipTitle')}>
      <Icon name="nodes" size={13} /> {t('webpane.clip')}
    </button>
    <button class="btn" disabled={!web.started} onclick={() => web.savePage()} title={t('webpane.saveTitle')}>
      <Icon name="tray" size={13} /> {t('common.save')}
    </button>
    <button class="btn" class:on={web.listOpen === 'bookmarks'} onclick={() => openList('bookmarks')} title={t('webpane.bookmarksOf', { scope: scopeName })}>
      <Icon name="star" size={13} /> {t('webpane.bookmarks')}
    </button>
    <button class="btn icon" class:on={web.listOpen === 'history'} onclick={() => openList('history')} title={t('webpane.historyOf', { scope: scopeName })} aria-label={t('webpane.history')}>
      <Icon name="clock" size={13} />
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
  <div class="view" bind:this={view}>
    {#if web.listOpen}
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
    {:else if !web.started}
      <div class="start">
        <Icon name="globe" size={28} />
        <p>{t('webpane.startHint')}</p>
        <p class="muted">{t('webpane.startInfo')}</p>
        <p class="muted">{t('webpane.startLocal')}</p>
        {#if lib.bookmarks.length}
          <div class="marks">
            {#each lib.bookmarks as p (p.url)}
              <button class="chip" title={p.url} onclick={() => web.pick(p.url)}><Icon name="star" size={11} />{p.title || shortUrl(p.url)}</button>
            {/each}
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
  .marks {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
    max-width: 460px;
    margin-top: 6px;
  }
  .marks .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .muted {
    color: var(--fg-faint);
    font-size: 12px;
    max-width: 420px;
  }
</style>
