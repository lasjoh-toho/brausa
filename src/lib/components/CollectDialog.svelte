<script lang="ts">
  /** Before collecting pictures from the web panel: where to, from which size, which formats. */
  import { web, type CollectCfg } from '../state/web.svelte';
  import FolderPicker from './FolderPicker.svelte';
  import Icon from './Icon.svelte';
  import { t } from '../i18n/index.svelte';

  const FORMATS = ['jpg', 'png', 'webp', 'gif', 'avif', 'svg'];
  let cfg = $state<CollectCfg>(structuredClone($state.snapshot(web.collectCfg)));

  function toggle(x: string) {
    cfg.exts = cfg.exts.includes(x) ? cfg.exts.filter((e) => e !== x) : [...cfg.exts, x];
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (web.collectDialog = false)} />

<div class="backdrop" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && (web.collectDialog = false)}>
  <div class="panel" role="dialog" aria-label={t('collect.title')}>
    <div class="head"><span class="rec"></span><b>{t('collect.title')}</b></div>
    <h3>{t('collect.where')}</h3>
    <FolderPicker bind:value={cfg.dir} />
    <h3>{t('collect.what')}</h3>
    <label class="row">
      {t('collect.min')}
      <input type="number" min="0" max="4000" step="50" bind:value={cfg.min} /> px
    </label>
    <div class="formats">
      {#each FORMATS as f (f)}
        <label><input type="checkbox" checked={cfg.exts.includes(f)} onchange={() => toggle(f)} />{f.toUpperCase()}</label>
      {/each}
    </div>
    <div class="foot">
      <button class="btn" onclick={() => (web.collectDialog = false)}>{t('common.cancel')}</button>
      <button class="btn primary" disabled={!cfg.dir || !cfg.exts.length} onclick={() => web.startCollect($state.snapshot(cfg))}>
        <Icon name="image" size={13} />{t('collect.start')}
      </button>
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
    gap: 8px;
    width: min(460px, calc(100% - 32px));
    max-height: calc(100% - 48px);
    overflow: auto;
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
  .rec {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--danger);
  }
  h3 {
    margin: 6px 0 0;
    font-size: 12px;
    font-weight: 600;
    color: var(--fg-muted);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
  }
  .row input {
    width: 80px;
    padding: 3px 6px;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--fg);
  }
  .formats {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    font-size: 13px;
  }
  .formats label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .foot {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    margin-top: 6px;
  }
  .foot .btn {
    gap: 5px;
  }
</style>
