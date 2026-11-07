<script lang="ts">
  /**
   * Every plugin brausa has (bundled ones and those taken from web wikis or added),
   * one row each, and a switch per wiki: which plugins that wiki uses.
   */
  import { app } from '../state/app.svelte';
  import { wikis } from '../state/wikis.svelte';
  import type { PluginInfo, PluginOverview } from '../backend/types';
  import Icon from './Icon.svelte';
  import { t } from '../i18n/index.svelte';

  let data = $state<PluginOverview | null>(null);
  let busy = $state(false);

  async function load() {
    data = await app.backend.wikiPluginOverview().catch((e) => {
      app.toast(String(e).replace(/^Error: /, ''), true);
      return null;
    });
  }
  void load();

  const names = $derived(data ? Object.keys(data.wikis).sort((a, b) => a.localeCompare(b)) : []);
  const uses = (wiki: string, p: PluginInfo) => !!data?.wikis[wiki]?.includes(p.title);

  async function toggle(wiki: string, p: PluginInfo) {
    if (!data) return;
    const on = !uses(wiki, p);
    try {
      data.wikis[wiki] = await app.backend.wikiSetPlugin(wiki, p.title, on);
      // In use from the next sync of the wiki.
      app.toast(t(on ? 'plugins.switchedOn' : 'plugins.switchedOff', { plugin: p.name, wiki }));
    } catch (e) {
      app.toast(String(e).replace(/^Error: /, ''), true);
    }
  }

  async function add() {
    busy = true;
    try {
      const title = await app.backend.wikiAddPluginFile();
      if (title) {
        app.toast(t('plugins.added', { title }));
        await load();
      }
    } catch (e) {
      app.toast(String(e).replace(/^Error: /, ''), true);
    } finally {
      busy = false;
    }
  }

  async function remove(p: PluginInfo) {
    if (!(await app.ask({ title: t('plugins.removeTitle'), text: t('plugins.removeText', { name: p.name }), ok: t('plugins.remove'), danger: true }))) return;
    await app.backend.wikiRemoveOwnPlugin(p.title).catch((e) => app.toast(String(e).replace(/^Error: /, ''), true));
    await load();
  }

  const kindLabel = (k: string) => (k === 'theme' ? t('plugins.theme') : k === 'language' ? t('plugins.language') : t('plugins.plugin'));
</script>

<div class="bar">
  <p class="muted">{t('plugins.intro')}</p>
  <button class="btn" disabled={busy} onclick={add}><Icon name="plus" size={13} />{t('plugins.add')}</button>
</div>

{#if !data}
  <p class="muted">…</p>
{:else}
  <div class="scroll">
    <table>
      <thead>
        <tr>
          <th class="plugin">{t('plugins.plugin')}</th>
          {#each names as w (w)}
            <th class="wiki" title={w}><span>{w}</span></th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each data.plugins as p (p.title)}
          <tr>
            <td class="plugin">
              <div class="top">
                <b>{p.name}</b>
                <span class="ver">{p.version}</span>
                <span class="tag" class:own={p.source === 'own'}>{p.source === 'own' ? t('plugins.own') : t('plugins.bundled')}</span>
                {#if p.kind !== 'plugin'}<span class="tag">{kindLabel(p.kind)}</span>{/if}
                {#if p.source === 'own'}
                  <button class="btn icon rm" title={t('plugins.remove')} aria-label={t('plugins.remove')} onclick={() => remove(p)}><Icon name="trash" size={12} /></button>
                {/if}
              </div>
              {#if p.description}<div class="desc">{p.description}</div>{/if}
              <code>{p.title}</code>
            </td>
            {#each names as w (w)}
              <td class="wiki">
                <button
                  class="sw"
                  class:on={uses(w, p)}
                  role="switch"
                  aria-checked={uses(w, p)}
                  title={t(uses(w, p) ? 'plugins.inWiki' : 'plugins.notInWiki', { wiki: w })}
                  onclick={() => toggle(w, p)}
                ><span></span></button>
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  {#if !names.length}<p class="muted">{t('plugins.noWikis')}</p>{/if}
  <p class="muted">{t('plugins.note')}</p>
{/if}

<style>
  .bar {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }
  .bar .muted {
    flex: 1;
  }
  .muted {
    margin: 4px 0 8px;
    font-size: 12px;
    color: var(--fg-faint);
  }
  .scroll {
    overflow: auto;
    max-height: 60vh;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--bg-elev);
    text-align: left;
    font-weight: 500;
    font-size: 11px;
    color: var(--fg-faint);
    padding: 4px 6px;
  }
  th.wiki {
    text-align: center;
    max-width: 90px;
  }
  th.wiki span {
    display: inline-block;
    max-width: 90px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg);
    font-weight: 600;
  }
  td {
    padding: 7px 6px;
    border-top: 1px solid var(--line);
    vertical-align: top;
  }
  td.wiki {
    text-align: center;
    vertical-align: middle;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .ver {
    color: var(--fg-faint);
    font-size: 12px;
  }
  .tag {
    padding: 0 6px;
    border-radius: 999px;
    font-size: 10.5px;
    color: var(--fg-muted);
    background: var(--hover, rgb(0 0 0 / 0.05));
  }
  .tag.own {
    color: #fff;
    background: var(--accent);
  }
  .rm {
    margin-left: auto;
  }
  .desc {
    margin-top: 2px;
    font-size: 12px;
    color: var(--fg-muted);
  }
  code {
    font-size: 10.5px;
    color: var(--fg-faint);
  }
  .sw {
    position: relative;
    width: 30px;
    height: 17px;
    border-radius: 999px;
    background: var(--line);
    transition: background 0.15s;
  }
  .sw span {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.25);
    transition: transform 0.15s;
  }
  .sw.on {
    background: var(--accent);
  }
  .sw.on span {
    transform: translateX(13px);
  }
</style>
