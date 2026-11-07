<script lang="ts">
  import { web } from '../state/web.svelte';
  import { app } from '../state/app.svelte';
  import { isMac, modLabel } from '../platform';
  import Icon from './Icon.svelte';
  import { inArchive } from '../core/archive';
  import { apps } from '../state/apps.svelte';
  import { dirname } from '../core/paths';
  import type { AppInfo } from '../backend/types';
  import { t, tn } from '../i18n/index.svelte';

  let { onTag, onPreview }: { onTag: () => void; onPreview: () => void } = $props();

  // Fallback keeps the deriveds valid during the closing transition.
  const m = $derived(app.menu ?? { x: 0, y: 0, entry: null });
  const targets = $derived(m.entry ? (app.selection.has(m.entry.path) ? app.selectedEntries : [m.entry]) : []);
  const one = $derived(targets.length === 1 ? targets[0] : null);
  const files = $derived(targets.filter((t) => t.kind === 'file'));
  const packed = $derived(targets.some((t) => inArchive(t.path)));

  type Item = { label: string; icon: string; key?: string; run: () => void; danger?: boolean; keep?: boolean } | null;

  /** The list of programs for "Öffnen mit …" instead of the menu. */
  let withOpen = $state(!!app.menu?.withOpen);
  if (app.menu?.withOpen) void apps.load();
  let appQuery = $state('');
  const suggested = $derived(withOpen && files[0] ? apps.suggestions(files[0]).slice(0, 8) : []);
  const others = $derived(
    withOpen ? apps.list.filter((a) => !suggested.includes(a) && (!appQuery.trim() || a.name.toLowerCase().includes(appQuery.trim().toLowerCase()))) : []
  );
  function openWith(a: AppInfo) {
    void apps.openWith(files, a);
    app.menu = null;
  }
  // A search hit below the current folder: "Zum Ordner" narrows the search to its folder.
  const elsewhere = $derived(!!one && !app.project && dirname(one.path) !== app.cwd);

  const items = $derived<Item[]>(
    m.entry
      ? [
          { label: t('common.open'), icon: 'open', key: `${modLabel}O`, run: () => targets.forEach((t) => app.open(t)) },
          ...(one?.kind === 'file' ? [{ label: t('menu.openDefault'), icon: 'open', run: () => app.openExternal(one) }] : []),
          ...(files.length && files.length === targets.length && !packed
            ? [{ label: t('menu.openWith'), icon: 'open', keep: true, run: () => ((withOpen = true), void apps.load()) }]
            : []),
          ...(one?.kind === 'file' ? [{ label: t('menu.preview'), icon: 'eye', key: t('menu.keySpace'), run: onPreview }] : []),
          ...(one && (one.ext === 'html' || one.ext === 'htm') ? [{ label: t('menu.openInWeb'), icon: 'globe', run: () => web.openLocal(one.path) }] : []),
          ...(one && elsewhere ? [{ label: t('menu.goToFolder'), icon: 'folder', run: () => void app.goToFolderOf(one) }] : []),
          ...(one ? [{ label: isMac ? t('menu.revealFinder') : t('menu.revealFiles'), icon: 'folder', run: () => app.reveal(one) }] : []),
          null,
          ...(one ? [{ label: t('common.rename'), icon: 'pencil', key: isMac ? '↵' : 'F2', run: () => (app.renaming = one.path) }] : []),
          ...(targets.length > 1 && !packed
            ? [{ label: tn('menu.renameMany', targets.length), icon: 'pencil', key: isMac ? '↵' : 'F2', run: () => (app.batchRenaming = targets) }]
            : []),
          ...(files.length ? [{ label: t('menu.tag'), icon: 'tag', key: 'T', run: onTag }] : []),
          ...(files.length ? [{ label: t('menu.stage'), icon: 'tray', key: 'S', run: () => app.stage(files) }] : []),
          null,
          // Projects collect files from anywhere; adding never moves a file.
          ...app.projects
            .filter((p) => p.id !== app.project)
            .slice(0, 6)
            .map((p) => ({ label: t('menu.addToProject', { name: p.name }), icon: 'kanban', run: () => app.addToProject(p.id, targets) })),
          ...(app.currentProject
            ? [{ label: t('menu.removeFromProject', { name: app.currentProject.name }), icon: 'x', key: isMac ? '⌘⌫' : t('menu.keyDel'), run: () => app.removeFromProject(targets) }]
            : []),
          ...(one?.kind === 'dir' && !packed
            ? [{ label: t('menu.findDuplicatesIn', { name: one.name }), icon: 'copy', run: () => void app.navigate(one.path).then(() => app.findDuplicates()) }]
            : []),
          { label: targets.length === 1 ? t('menu.compressOne', { name: targets[0].name }) : tn('menu.compressMany', targets.length), icon: 'archive', run: () => app.compress(targets) },
          null,
          {
            label: packed ? t('menu.deleteFromArchive') : t('menu.trash'),
            icon: 'trash',
            key: app.project ? undefined : isMac ? '⌘⌫' : t('menu.keyDel'),
            danger: true,
            run: () => app.trash(targets)
          }
        ]
      : [
          { label: t('menu.newFolder'), icon: 'folderPlus', key: `${modLabel}⇧N`, run: () => app.newFolder() },
          { label: t('menu.selectAll'), icon: 'select', key: `${modLabel}A`, run: () => app.selectAll() },
          { label: t('sizeselect.menu'), icon: 'select', run: () => (app.sizeSelectOpen = true) },
          null,
          app.dupes
            ? { label: t('menu.endDuplicates'), icon: 'x', run: () => app.endDuplicates() }
            : { label: t('menu.findDuplicates'), icon: 'copy', run: () => void app.findDuplicates() }
        ]
  );

  function run(i: Exclude<Item, null>) {
    // Run first: the item closures read deriveds that vanish once the menu closes.
    i.run();
    if (!i.keep) app.menu = null;
  }

  // Keep the menu on screen.
  let el: HTMLElement | undefined = $state();
  const pos = $derived.by(() => {
    const w = el?.offsetWidth ?? 220;
    const h = el?.offsetHeight ?? 260;
    return { x: Math.min(m.x, innerWidth - w - 8), y: Math.min(m.y, innerHeight - h - 8) };
  });
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (app.menu = null)} onblur={() => (app.menu = null)} />

<div class="scrim" role="presentation" onpointerdown={() => (app.menu = null)} oncontextmenu={(e) => { e.preventDefault(); app.menu = null; }}></div>
<div class="menu" bind:this={el} style:left="{pos.x}px" style:top="{pos.y}px" role="menu">
  {#if withOpen}
    <div class="title with">
      <button class="back" onclick={() => (withOpen = false)} aria-label={t('common.back')}><Icon name="back" size={12} /></button>
      {t('menu.openWithTitle', { name: files.length === 1 ? files[0].name : tn('common.objects', files.length) })}
    </div>
    <!-- svelte-ignore a11y_autofocus -->
    <input class="q" bind:value={appQuery} placeholder={t('menu.searchApps')} autofocus onkeydown={(e) => e.key === 'Enter' && (suggested[0] ?? others[0]) && openWith(suggested[0] ?? others[0])} />
    <div class="apps">
      {#if apps.loading && !apps.loaded}<div class="title">{t('menu.loadingApps')}</div>{/if}
      {#each suggested.filter((a) => !appQuery.trim() || a.name.toLowerCase().includes(appQuery.trim().toLowerCase())) as a (a.path)}
        <button class="item" role="menuitem" onclick={() => openWith(a)} title={a.path}><Icon name="star" size={13} /><span>{a.name}</span></button>
      {/each}
      {#if suggested.length && others.length}<hr />{/if}
      {#each others as a (a.path)}
        <button class="item" role="menuitem" onclick={() => openWith(a)} title={a.path}><Icon name="open" size={13} /><span>{a.name}</span></button>
      {/each}
      {#if apps.loaded && !apps.list.length}<div class="title">{t('menu.noApps')}</div>{/if}
    </div>
  {:else}
  {#if targets.length > 1}<div class="title">{tn('common.objects', targets.length)}</div>{/if}
  {#each items as i, n (n)}
    {#if i}
      <button class="item" class:danger={i.danger} role="menuitem" onclick={() => run(i)}>
        <Icon name={i.icon} size={14} />
        <span>{i.label}</span>
        {#if i.key}<kbd>{i.key}</kbd>{/if}
      </button>
    {:else if n > 0}
      <hr />
    {/if}
  {/each}
  {/if}
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 95;
  }
  .menu {
    position: fixed;
    z-index: 96;
    min-width: 220px;
    padding: 5px;
    border-radius: 11px;
    background: color-mix(in srgb, var(--bg-elev) 92%, transparent);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    box-shadow:
      var(--shadow),
      0 0 0 1px var(--line);
  }
  .title {
    padding: 5px 9px 4px;
    font-size: 11px;
    color: var(--fg-faint);
  }
  .item {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    padding: 6px 9px;
    border-radius: 7px;
    text-align: left;
    color: var(--fg);
  }
  .item:hover {
    background: var(--accent);
    color: #fff;
  }
  .item span {
    flex: 1;
  }
  .item:hover kbd {
    color: #fff;
    border-color: rgba(255, 255, 255, 0.4);
  }
  .danger {
    color: var(--danger);
  }
  .danger:hover {
    background: var(--danger);
  }
  .with {
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: 300px;
  }
  .back {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 5px;
    color: var(--fg-muted);
  }
  .back:hover {
    background: var(--bg-sunken);
  }
  .q {
    width: calc(100% - 8px);
    margin: 2px 4px 4px;
    padding: 5px 8px;
    border: 1px solid var(--line);
    border-radius: 7px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
  }
  .apps {
    max-height: min(420px, 60vh);
    overflow: auto;
  }
  hr {
    border: 0;
    border-top: 1px solid var(--line);
    margin: 4px 6px;
  }
</style>
