<script lang="ts">
  /**
   * "Programme" in the sidebar: the installed programs sorted by function, as a
   * drill-down (functions → programs). A program can sit under several functions;
   * the pencil next to it changes them, and own functions can be added.
   */
  import { app } from '../state/app.svelte';
  import { apps, APP_CATEGORIES, OTHER } from '../state/apps.svelte';
  import type { AppInfo } from '../backend/types';
  import { store } from '../platform';
  import Icon from './Icon.svelte';
  import { t } from '../i18n/index.svelte';

  let open = $state<boolean>(store.get('appsOpen', false));
  /** The function shown (null: the list of functions; '*': all programs). */
  let cat = $state<string | null>(store.get('appsCategory', null));
  /** Program whose functions are being changed. */
  let editing = $state<string | null>(null);
  let naming = $state<string | null>(null);
  let query = $state('');

  $effect(() => {
    if (open) void apps.load();
  });

  function toggle() {
    open = !open;
    store.set('appsOpen', open);
  }

  function show(c: string | null) {
    cat = c;
    editing = null;
    query = '';
    store.set('appsCategory', c);
  }

  const shown = $derived.by(() => {
    if (cat === null) return [];
    const list = cat === '*' ? apps.list : apps.inCategory(cat);
    const q = query.trim().toLowerCase();
    return q ? list.filter((a) => a.name.toLowerCase().includes(q)) : list;
  });

  // A function that lost its last program (or was removed): back to the list.
  $effect(() => {
    if (cat && cat !== '*' && apps.loaded && !apps.categories.includes(cat)) show(null);
  });

  function addCategory() {
    const n = (naming ?? '').trim();
    naming = null;
    if (!n) return;
    apps.addCustom(n);
  }

  function openFolder() {
    const f = apps.folders[0];
    if (f) void app.navigate(f);
  }

  const isCustom = (c: string) => apps.custom.includes(c);
  const cats = (a: AppInfo) => apps.categoriesOf(a).filter((c) => c !== OTHER);
</script>

<div class="section with-action">
  <button class="head" onclick={toggle} aria-expanded={open}>
    <Icon name={open ? 'chevronDown' : 'chevron'} size={10} />
    {t('apps.title')}
  </button>
  <span class="grow"></span>
  {#if open}
    {#if apps.folders.length}
      <button class="add" title={t('apps.openFolder')} onclick={openFolder}><Icon name="folder" size={12} /></button>
    {/if}
    <button class="add" title={t('apps.reload')} onclick={() => apps.load(true)}><Icon name="sync" size={12} /></button>
  {/if}
</div>

{#if open}
  {#if cat === null}
    {#if apps.loading && !apps.loaded}<div class="note">{t('apps.loading')}</div>{/if}
    {#each apps.categories as c (c)}
      <div class="row">
        <button class="place" onclick={() => show(c)}>
          <Icon name="grid" size={14} />
          <span class="pname">{apps.label(c)}</span>
          <span class="n">{apps.count(c)}</span>
        </button>
        {#if isCustom(c)}
          <button class="rm" title={t('apps.removeCategory')} onclick={() => apps.removeCustom(c)}><Icon name="x" size={11} /></button>
        {/if}
      </div>
    {/each}
    {#if apps.loaded}
      <button class="place" onclick={() => show('*')}>
        <Icon name="layers" size={14} />
        <span class="pname">{t('apps.all')}</span>
        <span class="n">{apps.list.length}</span>
      </button>
      {#if naming !== null}
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="pinput"
          bind:value={naming}
          placeholder={t('apps.categoryName')}
          autofocus
          onkeydown={(e) => (e.key === 'Enter' ? addCategory() : e.key === 'Escape' && (naming = null))}
          onblur={addCategory}
        />
      {:else}
        <button class="place faint" onclick={() => (naming = '')}><Icon name="plus" size={13} /><span class="pname">{t('apps.newCategory')}</span></button>
      {/if}
    {/if}
  {:else}
    <div class="crumb">
      <button class="add" onclick={() => show(null)} aria-label={t('common.back')}><Icon name="back" size={12} /></button>
      <b>{cat === '*' ? t('apps.all') : apps.label(cat)}</b>
    </div>
    {#if shown.length > 12 || query}
      <input class="pinput" bind:value={query} placeholder={t('apps.search')} />
    {/if}
    {#each shown as a (a.path)}
      <div class="row">
        <button class="place" onclick={() => apps.launch(a)} title={t('apps.launch', { name: a.name })}>
          <Icon name="open" size={13} />
          <span class="pname">{a.name}</span>
        </button>
        <button class="rm" class:on={editing === a.path} title={t('apps.editCategories')} onclick={() => (editing = editing === a.path ? null : a.path)}><Icon name="pencil" size={11} /></button>
      </div>
      {#if editing === a.path}
        <div class="cats">
          {#each [...APP_CATEGORIES, ...apps.custom] as c (c)}
            <label><input type="checkbox" checked={cats(a).includes(c)} onchange={() => apps.toggleCategory(a, c)} />{apps.label(c)}</label>
          {/each}
        </div>
      {/if}
    {:else}
      <div class="note">{t('apps.none')}</div>
    {/each}
  {/if}
{/if}

<style>
  .section {
    display: flex;
    align-items: center;
    margin: 14px 8px 6px;
    font-size: 11px;
    font-weight: 600;
    color: var(--fg-faint);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 4px;
    color: inherit;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
  }
  .grow {
    flex: 1;
  }
  .add {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 5px;
    color: var(--fg-muted);
  }
  .add:hover {
    background: var(--bg-sunken);
    color: var(--fg);
  }
  .row {
    position: relative;
    display: flex;
    align-items: center;
  }
  .place {
    flex: none;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 28px;
    padding: 0 8px;
    border-radius: 7px;
    color: var(--fg-muted);
    text-align: left;
    user-select: none;
  }
  .row .place {
    flex: 1;
  }
  .place:hover {
    background: var(--bg-sunken);
    color: var(--fg);
  }
  .place.faint {
    color: var(--fg-faint);
  }
  .pname {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .n {
    font-size: 11px;
    color: var(--fg-faint);
  }
  .rm {
    position: absolute;
    right: 4px;
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 5px;
    color: var(--fg-faint);
    opacity: 0;
  }
  .row:hover .rm,
  .rm.on {
    opacity: 1;
  }
  .rm:hover,
  .rm.on {
    background: var(--bg-sunken);
    color: var(--fg);
  }
  .crumb {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 6px 4px;
    font-size: 13px;
  }
  .note {
    padding: 4px 10px;
    font-size: 12px;
    color: var(--fg-faint);
  }
  .pinput {
    width: calc(100% - 8px);
    margin: 2px 4px 4px;
    padding: 4px 8px;
    border: 1px solid var(--line);
    border-radius: 7px;
    background: var(--bg-elev);
    color: var(--fg);
    font: inherit;
    font-size: 12px;
  }
  .cats {
    display: grid;
    gap: 2px;
    margin: 0 6px 6px 30px;
    padding: 6px 8px;
    border-radius: 8px;
    background: var(--bg-sunken);
    font-size: 12px;
  }
  .cats label {
    display: flex;
    align-items: center;
    gap: 6px;
  }
</style>
