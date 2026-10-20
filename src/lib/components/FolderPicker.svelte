<script lang="ts">
  /** Pick a folder: browse up and into folders, create a new one. */
  import { app } from '../state/app.svelte';
  import type { Entry } from '../core/types';
  import { dirname } from '../core/paths';
  import Icon from './Icon.svelte';
  import { t } from '../i18n/index.svelte';

  let { value = $bindable() }: { value: string } = $props();

  let dirs = $state<Entry[]>([]);
  let naming = $state<string | null>(null);

  $effect(() => {
    const p = value;
    void app.backend
      .listDir(p)
      .then((l) => p === value && (dirs = l.filter((e) => e.kind === 'dir').sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))))
      .catch(() => (dirs = []));
  });

  async function create() {
    const name = naming?.trim();
    naming = null;
    if (!name) return;
    try {
      value = await app.backend.mkdir(value, name);
    } catch (e) {
      app.toast(String(e).replace(/^Error: /, ''), true);
    }
  }
</script>

<div class="picker">
  <div class="path">
    <button class="btn icon" disabled={dirname(value) === value} onclick={() => (value = dirname(value))} aria-label={t('picker.up')} title={t('picker.up')}><Icon name="up" size={13} /></button>
    <span title={value}>{value}</span>
    <button class="btn icon" onclick={() => (naming = '')} title={t('picker.newFolder')} aria-label={t('picker.newFolder')}><Icon name="plus" size={13} /></button>
  </div>
  {#if naming !== null}
    <!-- svelte-ignore a11y_autofocus -->
    <input class="name" bind:value={naming} placeholder={t('picker.folderName')} autofocus onkeydown={(e) => (e.key === 'Enter' ? create() : e.key === 'Escape' && (naming = null))} />
  {/if}
  <ul>
    {#each dirs as d (d.path)}
      <li><button ondblclick={() => (value = d.path)} onclick={() => (value = d.path)}><Icon name="folder" size={13} />{d.name}</button></li>
    {:else}
      <li class="none">{t('picker.noFolders')}</li>
    {/each}
  </ul>
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 6px;
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 6px;
    background: var(--bg);
  }
  .path {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
  }
  .path span {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl;
    text-align: left;
  }
  .name {
    padding: 4px 8px;
    border-radius: 6px;
    border: 1px solid var(--accent);
    background: var(--bg);
    color: var(--fg);
    font: inherit;
  }
  ul {
    max-height: 180px;
    overflow: auto;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li button {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 4px 6px;
    border-radius: 6px;
    font-size: 13px;
    text-align: left;
  }
  li button:hover {
    background: var(--bg-sunken);
  }
  .none {
    padding: 4px 6px;
    font-size: 12px;
    color: var(--fg-faint);
  }
</style>
