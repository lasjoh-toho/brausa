<script lang="ts">
  // Edit a wiki (recipe): its bags, bottom to top, and the target wiki that TiddlyDesktop-RS opens.
  import { scale } from 'svelte/transition';
  import { app } from '../state/app.svelte';
  import { wikis } from '../state/wikis.svelte';
  import type { WikiRecipe } from '../backend/types';
  import Icon from './Icon.svelte';
  import { t, tn } from '../i18n/index.svelte';

  let { onclose }: { onclose: () => void } = $props();

  const original = wikis.editing ? (wikis.recipes.find((r) => r.name === wikis.editing) ?? null) : null;
  const project = app.boardProject;

  let r = $state<WikiRecipe>(
    original
      ? structuredClone($state.snapshot(original))
      : {
          name: project?.name ?? '',
          description: '',
          bags: wikis.maps.filter((m) => project && m.bag.startsWith(`@map:${project.root}|`)).map((m) => m.bag),
          target: { kind: 'folder', path: project ? `${project.folders[0] ?? app.cwd}/${project.name}-wiki` : '' },
          plugins: true,
          local: true
        }
  );
  let error = $state('');
  // The same wiki on the web: address, user, password (the password is only written, never read back).
  let webUrl = $state(original?.web?.url ?? '');
  let webUser = $state(original?.web?.user ?? '');
  let webPassword = $state('');
  let hasPassword = $state(false);
  if (original) app.backend.wikiWebHasPassword(original.name).then((h) => (hasPassword = h)).catch(() => {});
  let plugins = $state<[string, string][]>([]);
  app.backend.wikiPlugins().then((p) => (plugins = p)).catch(() => {});
  let newBag = $state('');
  let newReadonly = $state(false);

  const own = $derived(`wiki-${r.name.trim()}`);
  const available = $derived([
    ...wikis.bags.filter((b) => b.name !== own && !r.bags.includes(b.name) && !b.hidden).map((b) => ({ bag: b.name, label: b.name, sub: b.readonly ? t('wiki.readonlyBag') : tn('wiki.tiddlers', b.tiddlers) })),
    ...wikis.maps.filter((m) => !r.bags.includes(m.bag)).map((m) => ({ bag: m.bag, label: m.title, sub: t('wiki.mapIn', { project: m.project }) }))
  ]);
  const selectedHtml = $derived(app.selectedEntries.find((e) => e.ext === 'html' || e.ext === 'htm'));

  function move(i: number, d: number) {
    const b = [...r.bags];
    [b[i], b[i + d]] = [b[i + d], b[i]];
    r.bags = b;
  }

  async function createBag() {
    const name = newBag.trim();
    if (!name) return;
    try {
      await wikis.addBag(name, newReadonly);
      r.bags = [...r.bags.filter((b) => b !== own), name, ...(r.bags.includes(own) ? [own] : [])];
      newBag = '';
    } catch (e) {
      error = String(e).replace(/^Error: /, '');
    }
  }

  async function save(sync: boolean) {
    error = '';
    if (!r.name.trim() || !r.target.path.trim()) return void (error = t('wiki.missing'));
    try {
      const plain = $state.snapshot(r);
      const web = webUrl.trim() ? { url: webUrl.trim(), user: webUser.trim() } : null;
      const saved = await wikis.save({ ...plain, web, name: plain.name.trim(), target: { ...plain.target, path: plain.target.path.trim() } }, original?.name ?? null);
      if (webPassword) await app.backend.wikiWebPassword(saved.name, webPassword);
      else if (!web && hasPassword) await app.backend.wikiWebPassword(saved.name, null);
      onclose();
      if (sync) await wikis.sync(saved.name);
    } catch (e) {
      error = String(e).replace(/^Error: /, '');
    }
  }

  async function remove() {
    if (!original) return;
    await wikis.remove(original.name);
    onclose();
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="backdrop" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && onclose()}>
  <div class="panel" transition:scale={{ start: 0.96, duration: 140 }} role="dialog" aria-label="Wiki">
    <div class="head">
      <Icon name="book" size={16} />
      <b>{original ? t('wiki.title', { name: original.name }) : t('wiki.new')}</b>
      <span class="muted">{t('wiki.intro')}</span>
    </div>

    <div class="row">
      <label>{t('wiki.name')} <input bind:value={r.name} placeholder={t('wiki.namePlaceholder')} /></label>
      <label class="grow">{t('wiki.description')} <input bind:value={r.description} placeholder={t('wiki.optional')} /></label>
    </div>

    <div class="sec">{t('wiki.target')}</div>
    <div class="row">
      <div class="seg">
        <button class="btn" class:on={r.target.kind === 'folder'} onclick={() => (r.target.kind = 'folder')}>{t('wiki.folderWiki')}</button>
        <button class="btn" class:on={r.target.kind === 'file'} onclick={() => (r.target.kind = 'file')}>{t('wiki.singleFile')}</button>
      </div>
      <input class="grow mono" bind:value={r.target.path} placeholder={r.target.kind === 'folder' ? t('wiki.folderPath') : t('wiki.filePath')} />
      {#if r.target.kind === 'folder'}
        <button class="btn" title={t('wiki.hereTitle')} onclick={() => (r.target.path = `${app.cwd}/${r.name.trim() || 'wiki'}`)}>{t('wiki.here')}</button>
      {:else if selectedHtml}
        <button class="btn" title={t('wiki.selectionTitle')} onclick={() => (r.target.path = selectedHtml.path)}>{t('wiki.selection', { name: selectedHtml.name })}</button>
      {/if}
    </div>
    <p class="muted">
      {#if r.target.kind === 'folder'}
        {@html t('wiki.folderNote')}
      {:else}
        {@html t('wiki.fileNote')}
      {/if}
    </p>

    <div class="sec">{t('wiki.web')}</div>
    <div class="row">
      <input class="grow mono" bind:value={webUrl} placeholder={t('wiki.webUrl')} spellcheck="false" />
    </div>
    {#if webUrl.trim()}
      <div class="row">
        <label>{t('wiki.webUser')} <input bind:value={webUser} autocomplete="username" /></label>
        <label class="grow">{t('wiki.webPassword')} <input type="password" bind:value={webPassword} placeholder={hasPassword ? t('wiki.webPasswordStored') : t('wiki.optional')} autocomplete="new-password" /></label>
      </div>
      <p class="muted">{t('wiki.webNote')}</p>
    {/if}

    <label class="plugins">
      <input type="checkbox" bind:checked={r.plugins} />
      <span>
        <b>{t('wiki.plugins')}</b>
        {plugins.map(([n, v]) => `${n} ${v}`).join(' · ')}
        <span class="muted">– {t('wiki.pluginsNote')}</span>
      </span>
    </label>
    <label class="plugins">
      <input type="checkbox" bind:checked={r.local} />
      <span><b>{t('wiki.local')}</b></span>
    </label>

    <div class="cols">
      <div>
        <div class="sec">{t('wiki.bagsHere')}</div>
        <ol class="bags">
          {#each r.bags as b, i (b)}
            <li>
              <Icon name={b.startsWith('@map:') ? 'nodes' : 'tray'} size={13} />
              <span class="name">{wikis.label(b)}</span>
              {#if wikis.bags.find((x) => x.name === b)?.readonly}<span class="badge">{t('wiki.readonly')}</span>{/if}
              <button class="btn icon" disabled={i === 0} onclick={() => move(i, -1)} aria-label={t('wiki.moveUp')}><Icon name="up" size={12} /></button>
              <button class="btn icon" onclick={() => (r.bags = r.bags.filter((x) => x !== b))} aria-label={t('common.remove')}><Icon name="x" size={12} /></button>
            </li>
          {:else}
            <li class="muted">{t('wiki.noBags')}</li>
          {/each}
          {#if !r.bags.includes(own) && r.name.trim()}
            <li class="muted"><Icon name="tray" size={13} /> {t('wiki.ownBag', { bag: own })}</li>
          {/if}
        </ol>
      </div>
      <div>
        <div class="sec">{t('wiki.add')}</div>
        <div class="avail">
          {#each available as a (a.bag)}
            <button class="add" onclick={() => (r.bags = [...r.bags.filter((x) => x !== own), a.bag, ...(r.bags.includes(own) ? [own] : [])])}>
              <Icon name={a.bag.startsWith('@map:') ? 'nodes' : 'tray'} size={13} />
              <span class="name">{a.label}</span><span class="sub">{a.sub}</span>
            </button>
          {:else}
            <span class="muted">{t('wiki.allAdded')}</span>
          {/each}
        </div>
        <div class="row newbag">
          <input bind:value={newBag} placeholder={t('wiki.newBag')} onkeydown={(e) => e.key === 'Enter' && createBag()} />
          <label class="ro"><input type="checkbox" bind:checked={newReadonly} /> {t('wiki.readonly')}</label>
          <button class="btn" onclick={createBag} aria-label={t('wiki.createBag')}><Icon name="plus" size={13} /></button>
        </div>
      </div>
    </div>

    {#if error}<p class="err">{error}</p>{/if}
    <div class="foot">
      {#if original}<button class="btn danger" onclick={remove}>{t('common.remove')}</button>{/if}
      <span class="grow"></span>
      <button class="btn" onclick={onclose}>{t('common.cancel')}</button>
      <button class="btn" onclick={() => save(false)}>{t('common.save')}</button>
      <button class="btn primary" onclick={() => save(true)}>{t('wiki.saveSync')}</button>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: absolute;
    inset: 0;
    z-index: 80;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.18);
  }
  .panel {
    width: min(760px, calc(100% - 32px));
    max-height: calc(100% - 48px);
    overflow: auto;
    padding: 16px;
    border-radius: 16px;
    background: var(--bg-elev);
    box-shadow:
      var(--shadow),
      0 0 0 1px var(--line);
  }
  .head,
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .row {
    margin-top: 10px;
  }
  .row label {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--fg-muted);
  }
  .grow {
    flex: 1;
  }
  input:not([type='checkbox']) {
    padding: 5px 8px;
    border-radius: 7px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--fg);
    min-width: 0;
  }
  label.grow input {
    flex: 1;
  }
  .mono {
    font-family: var(--mono);
    font-size: 12px;
  }
  .muted {
    color: var(--fg-faint);
    font-size: 12px;
  }
  .muted :global(code) {
    font-family: var(--mono);
  }
  .sec {
    margin: 16px 0 6px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-faint);
  }
  .plugins {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-top: 12px;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--bg-sunken);
    font-size: 12px;
    line-height: 1.5;
  }
  .plugins input {
    margin-top: 3px;
  }
  .cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  .bags {
    margin: 0;
    padding: 0 0 0 18px;
  }
  .bags li {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 0;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .badge {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 8px;
    background: var(--bg-sunken);
    color: var(--fg-muted);
  }
  .avail {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 220px;
    overflow: auto;
  }
  .add {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    border-radius: 7px;
    text-align: left;
  }
  .add:hover {
    background: var(--bg-sunken);
  }
  .sub {
    font-size: 11px;
    color: var(--fg-faint);
    white-space: nowrap;
  }
  .newbag input:not([type='checkbox']) {
    flex: 1;
  }
  .ro {
    font-size: 12px;
    white-space: nowrap;
  }
  .err {
    color: var(--danger);
  }
  .foot {
    display: flex;
    gap: 8px;
    margin-top: 18px;
  }
  .danger {
    color: var(--danger);
  }
</style>
