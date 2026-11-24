<script lang="ts">
  /** Tabs at the top of the main window: "Dateien" and the user's program tabs. Programs dropped on a tab become aliases there. */
  import { app } from '../state/app.svelte';
  import { drag } from '../state/drag.svelte';
  import { launcher } from '../state/launcher.svelte';
  import Icon from './Icon.svelte';
  import { t } from '../i18n/index.svelte';

  let editing = $state<string | null>(null);
  let name = $state('');

  function add() {
    const id = launcher.addTab();
    launcher.show(id);
    edit(id);
  }

  function edit(id: string) {
    editing = id;
    name = launcher.tabs.find((x) => x.id === id)?.name ?? '';
  }

  function commit() {
    if (editing) launcher.renameTab(editing, name);
    editing = null;
  }

  function hit(id: string) {
    return drag.active && drag.hit?.kind === 'apptab' && drag.hit.key === id;
  }
</script>

<nav class="tabs" class:bare={!app.sidebarOpen} data-tauri-drag-region>
  <button class="tab" class:on={launcher.active === null} title={t('launcher.filesHint')} onclick={() => launcher.show(null)}>
    <Icon name="folder" size={13} />{t('launcher.files')}
  </button>
  {#each launcher.tabs as tab (tab.id)}
    <div
      class="tab"
      class:on={launcher.active === tab.id}
      class:hit={hit(tab.id)}
      role="tab"
      tabindex="0"
      aria-selected={launcher.active === tab.id}
      title={t('launcher.renameHint')}
      data-drop="apptab"
      data-key={tab.id}
      onclick={() => launcher.show(tab.id)}
      onkeydown={(e) => e.key === 'Enter' && launcher.show(tab.id)}
      ondblclick={() => edit(tab.id)}
    >
      <Icon name="grid" size={12} />
      {#if editing === tab.id}
        <!-- svelte-ignore a11y_autofocus -->
        <input
          bind:value={name}
          autofocus
          onfocus={(e) => (e.currentTarget as HTMLInputElement).select()}
          onkeydown={(e) => (e.key === 'Enter' ? commit() : e.key === 'Escape' && (editing = null))}
          onblur={commit}
        />
      {:else}
        <span class="name">{tab.name}</span>
        <span class="n">{tab.aliases.length}</span>
        <button
          class="x"
          title={t('launcher.removeTab')}
          onclick={(e) => {
            e.stopPropagation();
            void launcher.removeTab(tab.id);
          }}><Icon name="x" size={10} /></button
        >
      {/if}
    </div>
  {/each}
  <button class="plus" title={t('launcher.addTab')} onclick={add}><Icon name="plus" size={13} /></button>
</nav>

{#if launcher.pending}
  {@const p = launcher.pending}
  {@const target = launcher.tabs.find((x) => x.id === p.to)?.name ?? ''}
  <div class="scrim" role="presentation" onclick={() => launcher.resolve(null)}></div>
  <div class="ask" role="dialog" aria-modal="true">
    <h3>{t('launcher.askTitle', { app: p.alias.name })}</h3>
    <p>{t('launcher.askText', { app: p.alias.name, tabs: p.others.map((o) => '„' + o.name + '“').join(', ') })}</p>
    <button class="btn primary" onclick={() => launcher.resolve('extra')}>{t('launcher.extra', { tab: target })}</button>
    {#each p.others as o (o.id)}
      <button class="btn" onclick={() => launcher.resolve({ drop: o.id })}>{t('launcher.dropIn', { tab: o.name })}</button>
    {/each}
    <button class="btn ghost" onclick={() => launcher.resolve(null)}>{t('launcher.cancel')}</button>
  </div>
{/if}

<style>
  .tabs {
    flex: none;
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 34px;
    padding: 0 10px;
    border-bottom: 1px solid var(--line);
    background: var(--bg-sunken);
    overflow-x: auto;
    scrollbar-width: none;
  }
  :global(:root[data-platform='mac']) .tabs.bare {
    padding-left: 78px;
  }
  .tab {
    flex: none;
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    max-width: 220px;
    padding: 0 10px;
    border: 1px solid transparent;
    border-bottom: 0;
    border-radius: 8px 8px 0 0;
    color: var(--fg-muted);
    font-size: 12.5px;
    cursor: default;
    user-select: none;
  }
  .tab:hover {
    color: var(--fg);
  }
  .tab.on {
    background: var(--bg);
    border-color: var(--line);
    color: var(--fg);
    margin-bottom: -1px;
    height: 29px;
  }
  .tab.hit {
    background: var(--accent-soft);
    color: var(--accent);
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .n {
    font-size: 10.5px;
    color: var(--fg-faint);
  }
  .x {
    display: none;
    place-items: center;
    width: 16px;
    height: 16px;
    border-radius: 4px;
    color: var(--fg-faint);
  }
  .tab:hover .x {
    display: grid;
  }
  .tab:hover .n {
    display: none;
  }
  .x:hover {
    background: var(--bg-sunken);
    color: var(--fg);
  }
  input {
    width: 120px;
    padding: 2px 4px;
    border: 1px solid var(--accent);
    border-radius: 4px;
    background: var(--bg-elev);
    color: var(--fg);
    font: inherit;
    outline: none;
  }
  .plus {
    flex: none;
    align-self: center;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 6px;
    color: var(--fg-muted);
  }
  .plus:hover {
    background: var(--bg);
    color: var(--fg);
  }
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 90;
    background: rgba(0, 0, 0, 0.3);
  }
  .ask {
    position: fixed;
    z-index: 91;
    left: 50%;
    top: 22%;
    transform: translateX(-50%);
    width: min(420px, calc(100vw - 32px));
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 18px;
    border-radius: 12px;
    border: 1px solid var(--line);
    background: var(--bg-elev);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
  }
  .ask h3 {
    margin: 0;
    font-size: 15px;
  }
  .ask p {
    margin: 0 0 6px;
    color: var(--fg-muted);
  }
  .ask .btn {
    justify-content: center;
  }
</style>
