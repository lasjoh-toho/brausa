<script lang="ts">
  /** Wiki settings from the gear in the sidebar: bags, bundled plugins, search across all wikis. */
  import { scale } from 'svelte/transition';
  import { app } from '../state/app.svelte';
  import { wikis } from '../state/wikis.svelte';
  import type { WikiHit } from '../backend/types';
  import Icon from './Icon.svelte';
  import { t, tn } from '../i18n/index.svelte';

  let tab = $state<'bags' | 'plugins' | 'search'>('bags');
  let confirming = $state<string | null>(null);

  /** Wikis using each bag. */
  const usedBy = $derived(
    Object.fromEntries(wikis.bags.map((b) => [b.name, wikis.recipes.filter((r) => r.bags.includes(b.name)).map((r) => r.name)]))
  );

  let plugins = $state<[string, string][]>([]);
  $effect(() => {
    if (tab === 'plugins' && !plugins.length) void app.backend.wikiPlugins().then((p) => (plugins = p));
  });

  let query = $state('');
  let hits = $state<WikiHit[]>([]);
  let searching = $state(false);
  let timer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const q = query.trim();
    if (timer) clearTimeout(timer);
    if (q.length < wikis.searchMin) {
      hits = [];
      return;
    }
    timer = setTimeout(async () => {
      searching = true;
      hits = await app.backend.wikiSearch(q).catch(() => []);
      searching = false;
    }, 250);
  });

  function openWikiOf(bag: string) {
    const r = wikis.recipes.find((x) => x.bags.includes(bag));
    if (!r) return app.toast(t('wikisettings.notInWiki', { bag }));
    void app.backend.openDefault(r.target.path).catch((e) => app.toast(String(e).replace(/^Error: /, ''), true));
  }

  const close = () => (wikis.settingsOpen = false);
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && close()} />

<div class="backdrop" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && close()}>
  <div class="panel" role="dialog" aria-label={t('wikisettings.title')} transition:scale={{ start: 0.96, duration: 140 }}>
    <div class="head">
      <Icon name="gear" size={15} />
      <b>{t('wikisettings.title')}</b>
      <span class="grow"></span>
      <button class="btn" onclick={() => (close(), wikis.openOverview())} title={t('wikisettings.overviewHint')}>
        <Icon name="layers" size={13} />{t('wikisettings.overview')}
      </button>
      <button class="btn icon" onclick={close} aria-label={t('common.close')}><Icon name="x" size={14} /></button>
    </div>
    <div class="tabs" role="tablist">
      <button class:on={tab === 'bags'} role="tab" aria-selected={tab === 'bags'} onclick={() => (tab = 'bags')}>{t('wikisettings.bags')}</button>
      <button class:on={tab === 'plugins'} role="tab" aria-selected={tab === 'plugins'} onclick={() => (tab = 'plugins')}>{t('wikisettings.plugins')}</button>
      <button class:on={tab === 'search'} role="tab" aria-selected={tab === 'search'} onclick={() => (tab = 'search')}>{t('wikisettings.search')}</button>
    </div>

    <div class="body">
      {#if tab === 'bags'}
        <table>
          <thead>
            <tr><th>{t('wikisettings.bag')}</th><th>{t('wikisettings.tiddlers')}</th><th>{t('wikisettings.usedBy')}</th><th title={t('wikisettings.offerHint')}>{t('wikisettings.offer')}</th><th></th></tr>
          </thead>
          <tbody>
            {#each wikis.bags as b (b.name)}
              {@const used = usedBy[b.name] ?? []}
              {@const fixed = b.name.startsWith('@') || b.name === 'lokal'}
              <tr>
                <td>
                  <span class="name">{b.name}</span>
                  {#if b.readonly}<span class="badge">{t('wiki.readonly')}</span>{/if}
                  {#if b.description}<span class="desc">{b.description}</span>{/if}
                </td>
                <td class="num">{b.tiddlers}</td>
                <td class="used">{used.join(', ') || '–'}</td>
                <td><input type="checkbox" checked={!b.hidden} disabled={fixed} onchange={(e) => wikis.setHidden(b.name, !e.currentTarget.checked)} /></td>
                <td class="act">
                  {#if confirming === b.name}
                    <button class="btn danger" onclick={() => ((confirming = null), wikis.deleteBag(b.name))}>{t('sidebar.confirmDelete')}</button>
                  {:else}
                    <button
                      class="btn icon"
                      disabled={fixed || used.length > 0}
                      title={fixed ? t('wikisettings.fixed') : used.length ? t('wikisettings.inUse') : t('wikisettings.delete')}
                      onclick={() => ((confirming = b.name), setTimeout(() => confirming === b.name && (confirming = null), 3000))}><Icon name="trash" size={13} /></button
                    >
                  {/if}
                </td>
              </tr>
            {:else}
              <tr><td colspan="5" class="none">{t('wikisettings.noBags')}</td></tr>
            {/each}
          </tbody>
        </table>
      {:else if tab === 'plugins'}
        <p class="muted">{t('wikisettings.pluginsInfo')}</p>
        <ul class="plugins">
          {#each plugins as [name, version] (name)}
            <li><Icon name="book" size={13} /><span class="name">{name}</span><span class="ver">{version}</span></li>
          {/each}
        </ul>
      {:else}
        <!-- svelte-ignore a11y_autofocus -->
        <input class="q" bind:value={query} placeholder={t('wikisettings.searchPlaceholder', { n: wikis.searchMin })} autofocus />
        <label class="min">
          {t('wikisettings.searchMin')}
          <input type="number" min="1" max="20" value={wikis.searchMin} onchange={(e) => wikis.setSearchMin(Number(e.currentTarget.value))} />
        </label>
        {#if query.trim().length >= wikis.searchMin}
          <p class="muted">{searching ? t('wikisettings.searching') : tn('wikisettings.hits', hits.length)}</p>
          <ul class="hits">
            {#each hits as h (h.bag + '|' + h.title)}
              <li>
                <button onclick={() => openWikiOf(h.bag)} title={t('wikisettings.openWiki')}>
                  <span class="t">{h.title}</span>
                  <span class="b">{h.bag}{(usedBy[h.bag] ?? []).length ? ' · ' + usedBy[h.bag].join(', ') : ''}</span>
                  {#if h.snippet}<span class="s">… {h.snippet} …</span>{/if}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: absolute;
    inset: 0;
    z-index: 80;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.18);
  }
  .panel {
    display: flex;
    flex-direction: column;
    width: min(760px, calc(100% - 32px));
    max-height: calc(100% - 48px);
    padding: 14px 16px;
    border-radius: 16px;
    background: var(--bg-elev);
    box-shadow:
      var(--shadow),
      0 0 0 1px var(--line);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .head .btn {
    gap: 5px;
  }
  .grow {
    flex: 1;
  }
  .tabs {
    display: flex;
    gap: 2px;
    margin: 10px 0 0;
    border-bottom: 1px solid var(--line);
  }
  .tabs button {
    padding: 6px 12px;
    font-size: 13px;
    color: var(--fg-muted);
    border-bottom: 2px solid transparent;
  }
  .tabs button.on {
    color: var(--fg);
    border-bottom-color: var(--accent);
  }
  .body {
    min-height: 0;
    overflow: auto;
    padding-top: 10px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  th {
    text-align: left;
    font-weight: 500;
    font-size: 11px;
    color: var(--fg-faint);
    padding: 4px 6px;
  }
  td {
    padding: 6px;
    border-top: 1px solid var(--line);
    vertical-align: top;
  }
  .name {
    font-weight: 600;
  }
  .desc {
    display: block;
    font-size: 11px;
    color: var(--fg-faint);
  }
  .badge {
    margin-left: 6px;
    padding: 0 5px;
    border-radius: 4px;
    font-size: 10px;
    background: var(--bg-sunken);
    color: var(--fg-muted);
  }
  .num {
    text-align: right;
    color: var(--fg-muted);
  }
  .used {
    color: var(--fg-muted);
    font-size: 12px;
  }
  .act {
    text-align: right;
  }
  .danger {
    color: var(--danger);
  }
  .none {
    color: var(--fg-faint);
  }
  .muted {
    margin: 4px 0 8px;
    font-size: 12px;
    color: var(--fg-faint);
  }
  .plugins,
  .hits {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .plugins li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 4px;
    border-top: 1px solid var(--line);
    font-size: 13px;
  }
  .ver {
    margin-left: auto;
    color: var(--fg-faint);
    font-size: 12px;
  }
  .q {
    width: 100%;
    padding: 7px 10px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--fg);
    font: inherit;
  }
  .min {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 6px 0;
    font-size: 12px;
    color: var(--fg-muted);
  }
  .min input {
    width: 52px;
    padding: 2px 4px;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: var(--bg);
  }
  .hits button {
    display: flex;
    flex-direction: column;
    width: 100%;
    padding: 6px 8px;
    border-radius: 7px;
    text-align: left;
  }
  .hits button:hover {
    background: var(--bg-sunken);
  }
  .hits .t {
    font-weight: 600;
    font-size: 13px;
  }
  .hits .b,
  .hits .s {
    font-size: 11px;
    color: var(--fg-faint);
  }
</style>
