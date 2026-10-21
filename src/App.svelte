<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from './lib/state/app.svelte';
  import { drag } from './lib/state/drag.svelte';
  import { isMac, isToggleKey } from './lib/platform';
  import Sidebar from './lib/components/Sidebar.svelte';
  import Toolbar from './lib/components/Toolbar.svelte';
  import SidePane from './lib/components/SidePane.svelte';
  import WebPane from './lib/components/WebPane.svelte';
  import { web } from './lib/state/web.svelte';
  import Canvas from './lib/components/Canvas.svelte';
  import Tray from './lib/components/Tray.svelte';
  import DropBar from './lib/components/DropBar.svelte';
  import DropGrid from './lib/components/DropGrid.svelte';
  import DragGhost from './lib/components/DragGhost.svelte';
  import TagBar from './lib/components/TagBar.svelte';
  import Preview from './lib/components/Preview.svelte';
  import GridEditor from './lib/components/GridEditor.svelte';
  import Toasts from './lib/components/Toasts.svelte';
  import Busy from './lib/components/Busy.svelte';
  import ContextMenu from './lib/components/ContextMenu.svelte';
  import Confirm from './lib/components/Confirm.svelte';
  import BatchRename from './lib/components/BatchRename.svelte';
  import { updates } from './lib/state/updates.svelte';
  import { inArchive } from './lib/core/archive';
  import ProjectBoard from './lib/components/ProjectBoard.svelte';
  import WikiEditor from './lib/components/WikiEditor.svelte';
  import OverlayTool from './lib/components/OverlayTool.svelte';
  import BagOverview from './lib/components/BagOverview.svelte';
  import WikiSettings from './lib/components/WikiSettings.svelte';
  import WebSync from './lib/components/WebSync.svelte';
  import CollectDialog from './lib/components/CollectDialog.svelte';
  import SizeSelect from './lib/components/SizeSelect.svelte';
  import { wikis } from './lib/state/wikis.svelte';
  import { board } from './lib/state/board.svelte';
  import { t } from './lib/i18n/index.svelte';

  let toolbar = $state<Toolbar>();
  let accent = $state<{ color: string; light: boolean } | null>(null);
  const tagTargets = $derived(app.tagSource === 'staging' ? app.staging : app.selectedEntries);

  // A search also looks below the folder (or everywhere) for matching names.
  $effect(() => {
    void [app.findText, app.cwd, app.everywhere, app.home];
    app.scheduleFind();
  });

  onMount(() => {
    app.init();
    updates.startup();
  });

  const openPreview = () => app.openPreview();

  function typing(e: KeyboardEvent) {
    const el = e.target as HTMLElement;
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
  }

  /** Where ⌘/Ctrl+F searches: in the open document (after a click there or opening it) or in the files. */
  let findInDoc = false;
  $effect(() => {
    if (board.reader) findInDoc = true;
  });
  function pointer(e: PointerEvent) {
    findInDoc = !!board.reader && !!(e.target as HTMLElement).closest?.('.reader, aside.web');
  }

  function key(e: KeyboardEvent) {
    const mod = isToggleKey(e);
    if (mod && e.key.toLowerCase() === 'f' && findInDoc && board.reader) {
      // The open document's search, not the file search.
      board.findSeq++;
      e.preventDefault();
      return;
    }
    if (mod && e.key.toLowerCase() === 'f') {
      toolbar?.focusSearch();
      e.preventDefault();
      return;
    }
    if (wikis.editing !== null || wikis.overlaysOpen || app.view === 'board' || typing(e) || drag.active || app.tagSource || app.preview || app.menu || app.dialog || app.renaming || app.batchRenaming) return;

    const sel = app.selectedEntries;
    const k = e.key.toLowerCase();
    if (mod && e.shiftKey && k === 'n') {
      app.newFolder();
      e.preventDefault();
    } else if (mod && k === 'o') {
      sel.forEach((x) => app.open(x));
      e.preventDefault();
    } else if (e.key === 'F2' || (isMac && e.key === 'Enter')) {
      if (sel.length === 1) app.renaming = sel[0].path;
      else if (sel.length > 1 && !sel.some((x) => inArchive(x.path))) app.batchRenaming = sel;
      e.preventDefault();
    } else if ((isMac && mod && e.key === 'Backspace') || (!isMac && e.key === 'Delete')) {
      // In a project, Entf takes files out of the project; they stay on disk.
      if (app.project) app.removeFromProject(sel);
      else app.trash(sel);
      e.preventDefault();
    } else if (mod && e.key.toLowerCase() === 'a') {
      app.selectAll();
      e.preventDefault();
    } else if (e.key === 't' || e.key === 'T') {
      app.openTags();
      e.preventDefault();
    } else if (e.key === 's' && !mod) {
      app.stage(app.selectedEntries);
    } else if (e.key === ' ') {
      openPreview();
      e.preventDefault();
    } else if (e.key === 'Enter') {
      sel.forEach((x) => app.open(x));
    } else if (!mod && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      // The lists of the three-panel and table view walk with the arrow keys.
      if (app.view !== 'panes' && app.view !== 'table') return;
      app.step(e.key === 'ArrowDown' ? 1 : -1, e.shiftKey);
      e.preventDefault();
    } else if (e.key === 'Escape') {
      if (app.funnel) app.setFunnel(null);
      else app.selection.clear();
    } else if ((e.key === 'ArrowUp' && mod) || e.key === 'Backspace') {
      app.up();
    } else if (e.key === '[' && mod) app.back();
    else if (e.key === ']' && mod) app.forward();
  }
</script>

<svelte:window onkeydown={key} onpointerdowncapture={pointer} />

<div class="app">
  {#if app.sidebarOpen && !app.presenting}<Sidebar />{/if}
  <main>
    {#if !app.presenting}<Toolbar bind:this={toolbar} {accent} />{/if}
    <div class="work">
      {#if app.view === 'board'}<ProjectBoard />{:else}<Canvas />{/if}
      {#if app.pane && app.view !== 'board'}<SidePane />{/if}
      {#if web.open}<WebPane />{/if}
    </div>
    <Tray onTag={() => (app.tagSource = 'staging')} />
  </main>

  <DropBar />
  <DropGrid />
  {#if app.preview}<Preview onaccent={(c) => (accent = c)} />{/if}
  {#if app.tagSource && tagTargets.length}<TagBar targets={tagTargets} onclose={() => (app.tagSource = null)} />{/if}
  {#if app.sizeSelectOpen}<SizeSelect onclose={() => (app.sizeSelectOpen = false)} />{/if}
  {#if wikis.editing !== null}<WikiEditor onclose={() => ((wikis.editing = null), (wikis.preset = null))} />{/if}
  {#if wikis.overlaysOpen}<OverlayTool onclose={() => (wikis.overlaysOpen = false)} />{/if}
  {#if wikis.overviewOpen}<BagOverview onclose={() => (wikis.overviewOpen = false)} />{/if}
  {#if wikis.settingsOpen}<WikiSettings />{/if}
  {#if wikis.webSync}<WebSync />{/if}
  {#if web.collectDialog}<CollectDialog />{/if}
  {#if app.gridEditorOpen}<GridEditor onclose={() => (app.gridEditorOpen = false)} />{/if}
  {#if app.menu}<ContextMenu onTag={() => (app.tagSource = 'selection')} onPreview={openPreview} />{/if}
  {#if app.dialog}<Confirm />{/if}
  {#if app.batchRenaming}<BatchRename />{/if}
  <Toasts />
  <Busy />
  <DragGhost />
</div>

<style>
  .app {
    position: relative;
    display: flex;
    height: 100vh;
  }
  main {
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .work {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .work > :global(:first-child) {
    flex: 1;
    min-width: 0;
  }
</style>
