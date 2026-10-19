<script lang="ts">
  import { web } from '../state/web.svelte';
  import { app } from '../state/app.svelte';
  import { isMac, modLabel } from '../platform';
  import Icon from './Icon.svelte';
  import { inArchive } from '../core/archive';

  let { onTag, onPreview }: { onTag: () => void; onPreview: () => void } = $props();

  // Fallback keeps the deriveds valid during the closing transition.
  const m = $derived(app.menu ?? { x: 0, y: 0, entry: null });
  const targets = $derived(m.entry ? (app.selection.has(m.entry.path) ? app.selectedEntries : [m.entry]) : []);
  const one = $derived(targets.length === 1 ? targets[0] : null);
  const files = $derived(targets.filter((t) => t.kind === 'file'));
  const packed = $derived(targets.some((t) => inArchive(t.path)));

  type Item = { label: string; icon: string; key?: string; run: () => void; danger?: boolean } | null;

  const items = $derived<Item[]>(
    m.entry
      ? [
          { label: 'Öffnen', icon: 'open', key: `${modLabel}O`, run: () => targets.forEach((t) => app.open(t)) },
          ...(one?.kind === 'file' ? [{ label: 'Vorschau', icon: 'eye', key: 'Leertaste', run: onPreview }] : []),
          ...(one && (one.ext === 'html' || one.ext === 'htm') ? [{ label: 'Im Web-Fenster öffnen', icon: 'globe', run: () => web.openLocal(one.path) }] : []),
          ...(one ? [{ label: isMac ? 'Im Finder zeigen' : 'Im Dateimanager zeigen', icon: 'folder', run: () => app.reveal(one) }] : []),
          null,
          ...(one ? [{ label: 'Umbenennen', icon: 'pencil', key: isMac ? '↵' : 'F2', run: () => (app.renaming = one.path) }] : []),
          ...(files.length ? [{ label: 'Taggen', icon: 'tag', key: 'T', run: onTag }] : []),
          ...(files.length ? [{ label: 'In die Ablage', icon: 'tray', key: 'S', run: () => app.stage(files) }] : []),
          null,
          // Projects collect files from anywhere; adding never moves a file.
          ...app.projects
            .filter((p) => p.id !== app.project)
            .slice(0, 6)
            .map((p) => ({ label: `Zu „${p.name}“ hinzufügen`, icon: 'kanban', run: () => app.addToProject(p.id, targets) })),
          ...(app.currentProject
            ? [{ label: `Aus „${app.currentProject.name}“ entfernen`, icon: 'x', key: isMac ? '⌘⌫' : 'Entf', run: () => app.removeFromProject(targets) }]
            : []),
          { label: targets.length === 1 ? `„${targets[0].name}“ komprimieren` : `${targets.length} Objekte komprimieren`, icon: 'archive', run: () => app.compress(targets) },
          null,
          {
            label: packed ? 'Aus dem Archiv löschen …' : 'In den Papierkorb',
            icon: 'trash',
            key: app.project ? undefined : isMac ? '⌘⌫' : 'Entf',
            danger: true,
            run: () => app.trash(targets)
          }
        ]
      : [
          { label: 'Neuer Ordner', icon: 'folderPlus', key: `${modLabel}⇧N`, run: () => app.newFolder() },
          { label: 'Alles auswählen', icon: 'select', key: `${modLabel}A`, run: () => app.selectAll() }
        ]
  );

  function run(i: Exclude<Item, null>) {
    // Run first: the item closures read deriveds that vanish once the menu closes.
    i.run();
    app.menu = null;
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
  {#if targets.length > 1}<div class="title">{targets.length} Objekte</div>{/if}
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
  hr {
    border: 0;
    border-top: 1px solid var(--line);
    margin: 4px 6px;
  }
</style>
