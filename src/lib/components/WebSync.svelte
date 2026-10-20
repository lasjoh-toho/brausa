<script lang="ts">
  /** A wiki compared with its web version: choose what to take over, and whether to upload. */
  import { wikis } from '../state/wikis.svelte';
  import type { WebChange } from '../backend/types';
  import Icon from './Icon.svelte';
  import { t, tn } from '../i18n/index.svelte';

  const s = wikis.webSync!;
  let take = $state(new Set([...s.preview.new, ...s.preview.changed].map((c) => c.title)));
  let plugins = $state(new Set<string>());
  let upload = $state(s.preview.hasPassword);
  let open = $state<string | null>(null);

  function flip(set: Set<string>, title: string) {
    const n = new Set(set);
    if (n.has(title)) n.delete(title);
    else n.add(title);
    return n;
  }

  const date = (tw: string | null) => (tw && tw.length >= 8 ? `${tw.slice(6, 8)}.${tw.slice(4, 6)}.${tw.slice(0, 4)}` : '–');
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && wikis.webCancel()} />

{#snippet list(items: WebChange[], label: string)}
  {#if items.length}
    <h3>{label} <span class="n">{items.length}</span></h3>
    <ul>
      {#each items as c (c.title)}
        <li>
          <label>
            <input type="checkbox" checked={take.has(c.title)} onchange={() => (take = flip(take, c.title))} />
            <span class="t">{c.title}</span>
            <span class="d">{t('websync.web')} {date(c.webModified)}{c.localModified ? ` · ${t('websync.here')} ${date(c.localModified)}` : ''}</span>
          </label>
          <button class="btn icon" onclick={() => (open = open === c.title ? null : c.title)} aria-label={t('websync.show')}><Icon name="eye" size={12} /></button>
          {#if open === c.title}
            <div class="cmp">
              <div><b>{t('websync.web')}</b><pre>{c.webText}</pre></div>
              {#if c.localModified !== null || c.localText}<div><b>{t('websync.here')}</b><pre>{c.localText}</pre></div>{/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
{/snippet}

<div class="backdrop" role="presentation">
  <div class="panel" role="dialog" aria-label={t('websync.title', { name: s.name })}>
    <div class="head"><Icon name="globe" size={15} /><b>{t('websync.title', { name: s.name })}</b></div>
    <p class="muted">{t('websync.intro')}</p>
    <div class="body">
      {@render list(s.preview.new, t('websync.new'))}
      {@render list(s.preview.changed, t('websync.changed'))}
      {#if s.preview.plugins.length}
        <h3>{t('websync.plugins')}</h3>
        <ul>
          {#each s.preview.plugins as p (p.title)}
            <li>
              <label>
                <input type="checkbox" disabled={p.have} checked={plugins.has(p.title)} onchange={() => (plugins = flip(plugins, p.title))} />
                <span class="t">{p.title}</span>
                <span class="d">{p.version}{p.have ? ' · ' + t('websync.have') : ''}</span>
              </label>
            </li>
          {/each}
        </ul>
        <p class="muted">{t('websync.pluginsNote')}</p>
      {/if}
    </div>
    <label class="upload" class:off={!s.preview.hasPassword}>
      <input type="checkbox" bind:checked={upload} disabled={!s.preview.hasPassword} />
      {s.preview.hasPassword ? t('websync.upload') : t('websync.noPassword')}
    </label>
    <div class="foot">
      <button class="btn" onclick={() => wikis.webCancel()}>{t('common.cancel')}</button>
      <button class="btn primary" onclick={() => wikis.webApply([...take], [...plugins], upload)}>
        {tn('websync.apply', take.size)}
      </button>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: absolute;
    inset: 0;
    z-index: 85;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.18);
  }
  .panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: min(720px, calc(100% - 32px));
    max-height: calc(100% - 48px);
    padding: 16px;
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
  .muted {
    margin: 0;
    font-size: 12px;
    color: var(--fg-faint);
  }
  .body {
    min-height: 0;
    overflow: auto;
  }
  h3 {
    margin: 10px 0 4px;
    font-size: 13px;
  }
  .n {
    color: var(--fg-faint);
    font-weight: 400;
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 4px 2px;
    border-top: 1px solid var(--line);
  }
  li label {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
    font-size: 13px;
  }
  .t {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .d {
    margin-left: auto;
    flex: none;
    font-size: 11px;
    color: var(--fg-faint);
  }
  .cmp {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    width: 100%;
  }
  pre {
    margin: 2px 0 0;
    padding: 6px;
    max-height: 160px;
    overflow: auto;
    white-space: pre-wrap;
    font-size: 11px;
    border-radius: 6px;
    background: var(--bg-sunken);
  }
  .upload {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .upload.off {
    color: var(--fg-faint);
  }
  .foot {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }
</style>
