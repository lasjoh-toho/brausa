<script lang="ts">
  /** Small settings popover: interface language and updates. */
  import { fade } from 'svelte/transition';
  import { i18n, LANGS, systemLang, t, type LangChoice } from '../i18n/index.svelte';
  import { updates } from '../state/updates.svelte';
  import Icon from './Icon.svelte';

  let { onclose }: { onclose: () => void } = $props();
  const sys = LANGS.find((l) => l.key === systemLang())?.label ?? 'English';
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="scrim" role="presentation" onpointerdown={onclose}></div>
<div class="pop" role="dialog" aria-label={t('settings.title')} transition:fade={{ duration: 100 }}>
  <h3>{t('settings.title')}</h3>

  <label class="row">
    <span>{t('settings.language')}</span>
    <select value={i18n.choice} onchange={(e) => i18n.set(e.currentTarget.value as LangChoice)}>
      <option value="system">{t('settings.system', { lang: sys })}</option>
      {#each LANGS as l (l.key)}<option value={l.key}>{l.label}</option>{/each}
    </select>
  </label>

  <div class="sep"></div>
  <div class="row head">
    <span>{t('settings.updates')}</span>
    {#if updates.version}<span class="ver">{t('settings.version', { version: updates.version })}</span>{/if}
  </div>
  <label class="check">
    <input type="checkbox" checked={updates.auto} onchange={(e) => updates.setAuto(e.currentTarget.checked)} />
    {t('settings.auto')}
  </label>
  <div class="row">
    {#if updates.progress !== null}
      <span class="progress"><i style:width="{Math.round(updates.progress * 100)}%"></i></span>
      <span class="ver">{t('updates.installing')}</span>
    {:else if updates.available}
      <button class="btn primary" onclick={() => updates.install()}><Icon name="sync" size={13} /> {t('updates.install')} {updates.available.version}</button>
    {:else}
      <button class="btn" disabled={updates.checking} onclick={() => updates.check()}>
        <Icon name="sync" size={13} />
        {updates.checking ? t('settings.checking') : t('settings.check')}
      </button>
    {/if}
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 95;
  }
  .pop {
    position: absolute;
    top: 44px;
    left: 10px;
    z-index: 96;
    width: 280px;
    padding: 12px 14px 14px;
    border-radius: 11px;
    background: var(--bg-elev);
    box-shadow:
      var(--shadow),
      0 0 0 1px var(--line);
    font-size: 13px;
  }
  h3 {
    margin: 0 0 10px;
    font-size: 13px;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin: 6px 0;
  }
  .row.head {
    font-weight: 600;
  }
  select {
    max-width: 160px;
    padding: 4px 6px;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: 12px;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--fg-muted);
  }
  .ver {
    font-size: 11px;
    font-weight: 400;
    color: var(--fg-faint);
  }
  .sep {
    height: 1px;
    margin: 10px 0;
    background: var(--line);
  }
  .btn.primary {
    background: var(--accent);
    color: #fff;
    border-color: transparent;
  }
  .progress {
    flex: 1;
    height: 6px;
    border-radius: 3px;
    background: var(--bg-sunken);
    overflow: hidden;
  }
  .progress i {
    display: block;
    height: 100%;
    background: var(--accent);
  }
</style>
