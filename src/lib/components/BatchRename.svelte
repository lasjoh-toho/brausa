<script lang="ts">
  /** Rename several files at once: pattern, search and replace, case, with a live preview. */
  import { fade } from 'svelte/transition';
  import { app } from '../state/app.svelte';
  import { dirname } from '../core/paths';
  import { DEFAULT_RENAME, PLACEHOLDERS, planRenames, type RenameOptions } from '../core/rename';
  import { store } from '../platform';
  import { t, tn } from '../i18n/index.svelte';

  const entries = $derived(app.batchRenaming ?? []);
  let o = $state<RenameOptions>({ ...DEFAULT_RENAME, ...store.get<Partial<RenameOptions>>('renameOptions', {}), find: '', replace: '' });
  let patternEl = $state<HTMLInputElement>();

  const steps = $derived(planRenames(entries, o, (dir) => app.siblingNames(dir)));
  const changed = $derived(steps.filter((s) => s.changed && !s.error).length);
  const errors = $derived(steps.filter((s) => s.error).length);
  const dirs = $derived(new Set(entries.map((e) => dirname(e.path))).size);

  $effect(() => {
    patternEl?.focus();
    patternEl?.select();
  });

  function insert(token: string) {
    const el = patternEl;
    if (!el) return;
    const a = el.selectionStart ?? o.pattern.length;
    const b = el.selectionEnd ?? a;
    o.pattern = o.pattern.slice(0, a) + token + o.pattern.slice(b);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + token.length, a + token.length);
    });
  }

  function apply() {
    if (errors || !changed) return;
    store.set('renameOptions', { pattern: o.pattern, regex: o.regex, start: o.start, case: o.case });
    void app.batchRename(steps);
  }

  function key(e: KeyboardEvent) {
    if (e.key === 'Escape') app.batchRenaming = null;
    else if (e.key === 'Enter') apply();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
</script>

<svelte:window onkeydowncapture={key} />

<div class="scrim" transition:fade={{ duration: 120 }} onpointerdown={(e) => e.target === e.currentTarget && (app.batchRenaming = null)} role="presentation">
  <div class="box" role="dialog" aria-modal="true" aria-labelledby="rename-title">
    <h2 id="rename-title">{dirs > 1 ? tn('batch.titleIn', entries.length, { dirs }) : tn('batch.title', entries.length)}</h2>

    <label class="field">
      <span>{t('batch.name')}</span>
      <input bind:this={patternEl} bind:value={o.pattern} spellcheck="false" placeholder={'{name}'} />
    </label>
    <div class="tokens">
      {#each PLACEHOLDERS as p (p.token)}
        <button class="chip" tabindex="-1" title={p.label} onclick={() => insert(p.token)}>{p.token}</button>
      {/each}
      <span class="note">{t('batch.keepExt')}</span>
    </div>

    <div class="row">
      <label class="field grow">
        <span>{t('batch.replace')}</span>
        <input bind:value={o.find} spellcheck="false" placeholder={t('batch.find')} />
      </label>
      <label class="field grow">
        <span>{t('batch.with')}</span>
        <input bind:value={o.replace} spellcheck="false" placeholder={t('batch.nothing')} />
      </label>
      <label class="check" title={t('batch.regexTitle')}>
        <input type="checkbox" bind:checked={o.regex} /> {t('batch.regex')}
      </label>
    </div>

    <div class="row">
      <label class="field">
        <span>{t('batch.start')}</span>
        <input class="num" type="number" min="0" bind:value={o.start} />
      </label>
      <label class="field">
        <span>{t('batch.case')}</span>
        <select bind:value={o.case}>
          <option value="keep">{t('batch.caseKeep')}</option>
          <option value="lower">{t('batch.caseLower')}</option>
          <option value="upper">{t('batch.caseUpper')}</option>
          <option value="title">{t('batch.caseTitle')}</option>
        </select>
      </label>
    </div>

    <ol class="preview">
      {#each steps as s (s.entry.path)}
        <li class:same={!s.changed && !s.error} class:bad={!!s.error}>
          <span class="old" title={s.entry.path}>{s.entry.name}</span>
          <span class="arrow">→</span>
          <span class="new">{s.name}</span>
          {#if s.error}<span class="err">{s.error}</span>{/if}
        </li>
      {/each}
    </ol>

    <div class="foot">
      <span class="sum" class:bad={errors > 0}>
        {#if errors}{tn('batch.conflicts', errors)}{:else}{t('batch.willRename', { changed, total: entries.length })}{/if}
      </span>
      <button class="btn" onclick={() => (app.batchRenaming = null)}>{t('common.cancel')}</button>
      <button class="btn primary" disabled={!!errors || !changed} onclick={apply}>{t('common.rename')}</button>
    </div>
  </div>
</div>

<style>
  .scrim {
    position: absolute;
    inset: 0;
    z-index: 120;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, #000 28%, transparent);
  }
  .box {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: min(640px, calc(100% - 32px));
    max-height: calc(100% - 48px);
    padding: 18px 20px 16px;
    border-radius: 12px;
    background: var(--bg-elev);
    border: 1px solid var(--line);
    box-shadow: 0 18px 50px rgba(0, 0, 0, 0.28);
  }
  h2 {
    margin: 0 0 2px;
    font-size: 15px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 11px;
    color: var(--fg-faint);
  }
  .field input,
  .field select {
    padding: 6px 8px;
    border-radius: 7px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: 13px;
  }
  .field select {
    height: 32px;
    padding: 0 8px;
  }
  .field input:focus,
  .field select:focus {
    outline: none;
    border-color: var(--accent);
  }
  .num {
    width: 90px;
  }
  .row {
    display: flex;
    align-items: flex-end;
    gap: 10px;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 32px;
    font-size: 12px;
    color: var(--fg-muted);
  }
  .tokens {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    margin-top: -4px;
  }
  .tokens .chip {
    font-family: var(--mono, ui-monospace, monospace);
    font-size: 11px;
  }
  .note {
    margin-left: auto;
    font-size: 11px;
    color: var(--fg-faint);
  }
  .preview {
    flex: 1;
    min-height: 60px;
    max-height: 280px;
    margin: 4px 0 0;
    padding: 6px 0;
    overflow: auto;
    list-style: none;
    border-radius: 8px;
    background: var(--bg-sunken);
    font-size: 12px;
  }
  .preview li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto;
    align-items: baseline;
    gap: 8px;
    padding: 3px 10px;
  }
  .old,
  .new {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .old,
  .arrow {
    color: var(--fg-faint);
  }
  .new {
    color: var(--fg);
    font-weight: 500;
  }
  .same .new {
    color: var(--fg-faint);
    font-weight: 400;
  }
  .bad .new,
  .err,
  .sum.bad {
    color: var(--danger, #c0392b);
  }
  .err {
    font-size: 11px;
  }
  .foot {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
  }
  .sum {
    flex: 1;
    font-size: 12px;
    color: var(--fg-muted);
  }
  .btn.primary {
    background: var(--accent);
    color: #fff;
    border-color: transparent;
  }
  .btn.primary:disabled {
    opacity: 0.45;
  }
</style>
