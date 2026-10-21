<script lang="ts">
  /** Search in a document or web page: hits counted and highlighted, ↑/↓ (or Enter / ⇧Enter) step through them. */
  import { untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import { t } from '../i18n/index.svelte';

  let {
    count,
    current,
    onsearch,
    onstep,
    onclose,
    initial = ''
  }: { count: number; current: number; onsearch: (q: string) => void; onstep: (by: 1 | -1) => void; onclose: () => void; initial?: string } = $props();

  // svelte-ignore state_referenced_locally
  let q = $state(initial);
  // Opened with a term (e.g. from a search in documents): search it right away.
  $effect(() => {
    if (initial) untrack(() => onsearch(initial));
  });
  let timer: ReturnType<typeof setTimeout> | undefined;

  function input() {
    clearTimeout(timer);
    timer = setTimeout(() => onsearch(q), 200);
  }

  function key(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      clearTimeout(timer);
      if (e.shiftKey) onstep(-1);
      else onstep(1);
      e.preventDefault();
    } else if (e.key === 'Escape') {
      onclose();
      e.preventDefault();
    }
    e.stopPropagation();
  }

  function focus(node: HTMLInputElement) {
    node.focus();
    node.select();
  }
</script>

<div class="find">
  <Icon name="search" size={13} />
  <input bind:value={q} oninput={input} onkeydown={key} placeholder={t('find.placeholder')} use:focus />
  <span class="n" class:none={!!q.trim() && !count}>{q.trim() ? (count ? t('find.count', { i: current + 1, n: count }) : t('find.none')) : ''}</span>
  <button class="btn icon" disabled={!count} onclick={() => onstep(-1)} title={t('find.prev')}><Icon name="up" size={13} /></button>
  <button class="btn icon" disabled={!count} onclick={() => onstep(1)} title={t('find.next')}><Icon name="down" size={13} /></button>
  <button class="btn icon" onclick={onclose} title={t('find.close')}><Icon name="x" size={13} /></button>
</div>

<style>
  .find {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    border-bottom: 1px solid var(--line);
    background: var(--bg-elev);
    color: var(--fg-muted);
  }
  input {
    flex: 1;
    min-width: 60px;
    height: 26px;
    padding: 0 8px;
    border-radius: 7px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: 13px;
  }
  .n {
    min-width: 54px;
    font-size: 12px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .n.none {
    color: var(--danger);
  }
</style>
