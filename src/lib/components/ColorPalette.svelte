<script lang="ts">
  /**
   * The palette button: opens a grid of colours (and a picker for any other),
   * plus "no colour". `extra` adds content below the grid (e.g. the card colour mode).
   */
  import type { Snippet } from 'svelte';
  import { PALETTE } from '../core/map';
  import Icon from './Icon.svelte';
  import { t } from '../i18n/index.svelte';

  let {
    value = null,
    onpick,
    allowNone = true,
    up = false,
    extra
  }: { value?: string | null; onpick: (c: string | null) => void; allowNone?: boolean; up?: boolean; extra?: Snippet } = $props();

  let open = $state(false);
  let root = $state<HTMLElement>();

  function pick(c: string | null) {
    onpick(c);
    open = false;
  }

  function outside(e: PointerEvent) {
    if (open && root && !root.contains(e.target as Node)) open = false;
  }
</script>

<svelte:window onpointerdown={outside} />

<span class="palette" bind:this={root}>
  <button class="btn icon trigger" class:on={open} title={t('common.palette')} aria-label={t('common.palette')} onclick={() => (open = !open)}>
    <span class="cur" style:background={value ?? 'transparent'}></span>
    <Icon name="palette" size={14} />
  </button>
  {#if open}
    <div class="pop" class:up>
      <div class="grid">
        {#each PALETTE as c (c)}
          <button class="sw" class:on={value === c} style:background={c} aria-label={c} title={c} onclick={() => pick(c)}></button>
        {/each}
      </div>
      <div class="row">
        {#if allowNone}<button class="btn" onclick={() => pick(null)}><span class="sw none"></span>{t('common.noColor')}</button>{/if}
        <label class="btn custom" title={t('common.customColor')}>
          <input type="color" value={value ?? '#0090ff'} onchange={(e) => pick(e.currentTarget.value)} />
          {t('common.customColor')}
        </label>
      </div>
      {#if extra}{@render extra()}{/if}
    </div>
  {/if}
</span>

<style>
  .palette {
    position: relative;
    display: inline-flex;
  }
  .trigger {
    position: relative;
  }
  .cur {
    position: absolute;
    right: 3px;
    bottom: 3px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    box-shadow: 0 0 0 1px var(--bg-elev);
  }
  .pop {
    position: absolute;
    top: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 30;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    border-radius: 12px;
    background: var(--bg-elev);
    box-shadow:
      var(--shadow),
      0 0 0 1px var(--line);
  }
  .pop.up {
    top: auto;
    bottom: calc(100% + 6px);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(7, 20px);
    gap: 5px;
  }
  .sw {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.12);
  }
  .sw.on {
    box-shadow:
      0 0 0 2px var(--bg-elev),
      0 0 0 3.5px var(--fg-muted);
  }
  .sw.none {
    display: inline-block;
    width: 12px;
    height: 12px;
    background: linear-gradient(135deg, transparent 45%, #ef4444 45%, #ef4444 55%, transparent 55%);
    box-shadow: inset 0 0 0 1px var(--line);
  }
  .row {
    display: flex;
    gap: 6px;
  }
  .row .btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    white-space: nowrap;
  }
  .custom {
    position: relative;
    cursor: pointer;
  }
  .custom input {
    width: 16px;
    height: 16px;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
  }
</style>
