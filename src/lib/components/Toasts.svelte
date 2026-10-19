<script lang="ts">
  import { fly } from 'svelte/transition';
  import { app } from '../state/app.svelte';
  import { t as tr } from '../i18n/index.svelte';
</script>

<div class="toasts" aria-live="polite">
  {#each app.toasts as t (t.id)}
    <div class="toast" class:error={t.error} transition:fly={{ x: 30, duration: 180 }}>
      <span>{t.text}</span>
      {#if t.undo}
        <button
          onclick={async () => {
            app.dismiss(t.id);
            await t.undo?.();
          }}>{t.action ?? tr('common.undo')}</button
        >
      {/if}
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: absolute;
    right: 16px;
    bottom: 92px;
    z-index: 90;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
    pointer-events: none;
  }
  .toast {
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: 420px;
    padding: 9px 12px;
    border-radius: 10px;
    background: var(--fg);
    color: var(--bg);
    box-shadow: var(--shadow);
    pointer-events: auto;
  }
  .toast.error {
    background: var(--danger);
    color: #fff;
  }
  button {
    font-weight: 600;
    color: #8db1ff;
  }
</style>
