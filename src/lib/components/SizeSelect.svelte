<script lang="ts">
  /**
   * "Select by size": marks all pictures (or all files) at least or at most a
   * given size. The same as typing `is:bild >2MB` in the select field.
   */
  import { app } from '../state/app.svelte';
  import { store } from '../platform';
  import { t, tn } from '../i18n/index.svelte';

  let { onclose }: { onclose: () => void } = $props();

  const last = store.get<{ kind: string; op: string; value: number; unit: string }>('sizeSelect', { kind: 'bild', op: '>=', value: 2, unit: 'MB' });
  let kind = $state(last.kind);
  let op = $state(last.op);
  let value = $state(last.value);
  let unit = $state(last.unit);

  const pattern = $derived(`${kind ? `is:${kind} ` : ''}${op}${value}${unit}`);

  function apply() {
    store.set('sizeSelect', { kind, op, value, unit });
    const n = app.selectPattern(pattern);
    app.toast(tn('sizeselect.selected', n));
    onclose();
  }
</script>

<div class="scrim" role="presentation" onpointerdown={onclose}></div>
<div class="dlg" role="dialog" aria-label={t('sizeselect.title')}>
  <b>{t('sizeselect.title')}</b>
  <div class="row">
    <select bind:value={kind}>
      <option value="bild">{t('sizeselect.images')}</option>
      <option value="video">{t('sizeselect.videos')}</option>
      <option value="">{t('sizeselect.all')}</option>
    </select>
    <select bind:value={op}>
      <option value=">=">{t('sizeselect.atLeast')}</option>
      <option value="<=">{t('sizeselect.atMost')}</option>
    </select>
    <input type="number" min="0" step="0.1" bind:value onkeydown={(e) => e.key === 'Enter' && apply()} />
    <select bind:value={unit}>
      <option>KB</option>
      <option>MB</option>
      <option>GB</option>
    </select>
  </div>
  <p class="hint">{t('sizeselect.hint', { pattern })}</p>
  <div class="acts">
    <button class="btn" onclick={onclose}>{t('common.cancel')}</button>
    <button class="btn primary" onclick={apply}>{t('sizeselect.select')}</button>
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 90;
    background: rgb(0 0 0 / 0.15);
  }
  .dlg {
    position: fixed;
    z-index: 91;
    top: 120px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: min(440px, calc(100vw - 32px));
    padding: 16px;
    border-radius: 14px;
    background: var(--bg-elev);
    box-shadow:
      var(--shadow),
      0 0 0 1px var(--line);
  }
  .row {
    display: flex;
    gap: 6px;
  }
  select,
  input {
    height: 30px;
    padding: 0 8px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--fg);
    font: inherit;
  }
  input {
    width: 80px;
  }
  .hint {
    margin: 0;
    font-size: 12px;
    color: var(--fg-faint);
  }
  .acts {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }
  .btn.primary {
    background: var(--accent);
    color: #fff;
    border-color: transparent;
  }
</style>
