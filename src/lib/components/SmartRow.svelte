<script lang="ts">
  /** One smart folder in the sidebar: open, rename, replace, link to projects, remove. */
  import type { SmartFolder } from '../core/smart';
  import { app } from '../state/app.svelte';
  import Icon from './Icon.svelte';
  import { t } from '../i18n/index.svelte';

  let {
    folder: f,
    current,
    filtered,
    under = null,
    linked = false
  }: {
    folder: SmartFolder;
    /** It matches the current view. */
    current: boolean;
    /** The current view has filters that could replace this folder's. */
    filtered: boolean;
    /** Shown under this project (indented). */
    under?: string | null;
    /** Shown under `under` because it is linked there, not because it belongs to it. */
    linked?: boolean;
  } = $props();

  let renaming = $state(false);
  let picker = $state<{ x: number; y: number } | null>(null);
  const owner = $derived('project' in f.scope ? f.scope.project : null);

  function openPicker(e: MouseEvent) {
    e.stopPropagation();
    if (picker) return void (picker = null);
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    picker = { x: r.left, y: r.bottom + 4 };
  }
  function outside(e: PointerEvent) {
    if (picker && !(e.target as HTMLElement).closest('.links, .link-btn')) picker = null;
  }
</script>

<svelte:window onpointerdown={outside} onkeydown={(ev) => picker && ev.key === 'Escape' && (picker = null)} />

{#if renaming}
  <!-- svelte-ignore a11y_autofocus -->
  <input
    class="pinput"
    class:nested={!!under}
    value={f.name}
    autofocus
    onkeydown={(e) => {
      if (e.key === 'Enter') {
        app.renameSmart(f.id, e.currentTarget.value);
        renaming = false;
      } else if (e.key === 'Escape') renaming = false;
    }}
    onblur={() => (renaming = false)}
  />
{:else}
  <div
    class="place smart"
    class:nested={!!under}
    class:current
    role="button"
    tabindex="0"
    title={app.smartSummary(f) + (linked ? '\n' + t('sidebar.smartLinked') : '')}
    onclick={() => app.openSmart(f.id)}
    ondblclick={() => (renaming = true)}
    onkeydown={(e) => e.key === 'Enter' && app.openSmart(f.id)}
  >
    <Icon name={linked ? 'nodes' : 'filter'} size={under ? 13 : 15} />
    <span class="pname">{f.name}</span>
    {#if filtered && !current}
      <button
        class="rm"
        title={t('sidebar.replaceSmart', { summary: app.smartSummary(app.currentView) })}
        onclick={(e) => (e.stopPropagation(), app.updateSmart(f.id))}><Icon name="target" size={11} /></button
      >
    {/if}
    {#if app.projects.length && !(owner && app.projects.length === 1)}
      <button class="rm link-btn" class:on={!!picker} title={t('sidebar.linkSmart')} onclick={openPicker}><Icon name="nodes" size={11} /></button>
    {/if}
    <button class="rm" title={t('common.rename')} onclick={(e) => (e.stopPropagation(), (renaming = true))}><Icon name="pencil" size={11} /></button>
    {#if linked && under}
      {@const p = under}
      <button class="rm" title={t('sidebar.unlinkSmart')} onclick={(e) => (e.stopPropagation(), app.linkSmart(f.id, p))}><Icon name="x" size={11} /></button>
    {:else}
      <button class="rm" title={t('sidebar.removeSmart')} onclick={(e) => (e.stopPropagation(), app.removeSmart(f.id))}><Icon name="x" size={11} /></button>
    {/if}
  </div>
{/if}

{#if picker}
  <div class="links" style:left="{picker.x}px" style:top="{picker.y}px" role="menu">
    <div class="head">{t('sidebar.linkSmartHead')}</div>
    {#each app.projects as p (p.id)}
      {#if p.id !== owner}
        {@const on = f.projects?.includes(p.id) ?? false}
        <label class="row">
          <input type="checkbox" checked={on} onchange={() => app.linkSmart(f.id, p.id)} />
          <span>{p.name}</span>
        </label>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .place {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 28px;
    padding: 0 8px;
    border-radius: 7px;
    color: var(--fg-muted);
    user-select: none;
  }
  .place.nested {
    height: 24px;
    padding-left: 30px;
    font-size: 12px;
  }
  .place:hover,
  .place.current {
    background: var(--bg-sunken);
    color: var(--fg);
  }
  .pinput {
    width: 100%;
    margin: 2px 0;
    padding: 4px 8px;
    border-radius: 7px;
    border: 1px solid var(--accent);
    background: var(--bg);
    color: var(--fg);
    font: inherit;
  }
  .pinput.nested {
    margin-left: 22px;
    width: calc(100% - 22px);
  }
  .pname {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rm {
    display: none;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 5px;
    color: var(--fg-faint);
  }
  .rm:hover,
  .rm.on {
    color: var(--fg);
    background: var(--bg);
  }
  .smart:hover .rm,
  .rm.on {
    display: grid;
  }
  .links {
    position: fixed;
    z-index: 50;
    min-width: 180px;
    max-width: 260px;
    padding: 6px;
    border-radius: 9px;
    border: 1px solid var(--line);
    background: var(--bg-elev);
    box-shadow: var(--shadow);
  }
  .head {
    padding: 2px 6px 6px;
    font-size: 11px;
    color: var(--fg-faint);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border-radius: 6px;
    font-size: 12px;
    color: var(--fg);
  }
  .row:hover {
    background: var(--bg-sunken);
  }
  .row span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
