<script lang="ts">
  /** Confirmation for changes that cannot simply be undone (app.ask). */
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import { app } from '../state/app.svelte';

  const d = $derived(app.dialog);
  let okBtn = $state<HTMLButtonElement>();

  onMount(() => okBtn?.focus());

  function key(e: KeyboardEvent) {
    if (!d) return;
    if (e.key === 'Escape') d.resolve(false);
    else if (e.key === 'Enter') d.resolve(true);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
</script>

<svelte:window onkeydowncapture={key} />

{#if d}
  <div class="scrim" transition:fade={{ duration: 120 }} onpointerdown={(e) => e.target === e.currentTarget && d.resolve(false)} role="presentation">
    <div class="box" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
      <h2 id="confirm-title">{d.title}</h2>
      <p>{d.text}</p>
      <div class="row">
        <button class="btn" onclick={() => d.resolve(false)}>Abbrechen</button>
        <button class="btn primary" class:danger={d.danger} bind:this={okBtn} onclick={() => d.resolve(true)}>{d.ok}</button>
      </div>
    </div>
  </div>
{/if}

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
    width: min(440px, calc(100% - 32px));
    padding: 18px 20px 16px;
    border-radius: 12px;
    background: var(--bg-elev);
    border: 1px solid var(--line);
    box-shadow: 0 18px 50px rgba(0, 0, 0, 0.28);
  }
  h2 {
    margin: 0 0 8px;
    font-size: 15px;
  }
  p {
    margin: 0 0 16px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--fg-muted);
  }
  .row {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .btn.primary {
    background: var(--accent);
    color: #fff;
    border-color: transparent;
  }
  .btn.primary.danger {
    background: #c0392b;
  }
</style>
