<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from './lib/state/app.svelte';
  import { drag } from './lib/state/drag.svelte';
  import { isMac, isToggleKey } from './lib/platform';
  import Sidebar from './lib/components/Sidebar.svelte';
  import Toolbar from './lib/components/Toolbar.svelte';
  import Canvas from './lib/components/Canvas.svelte';
  import Tray from './lib/components/Tray.svelte';
  import DropBar from './lib/components/DropBar.svelte';
  import DropGrid from './lib/components/DropGrid.svelte';
  import DragGhost from './lib/components/DragGhost.svelte';
  import TagBar from './lib/components/TagBar.svelte';
  import Preview from './lib/components/Preview.svelte';
  import GridEditor from './lib/components/GridEditor.svelte';
  import Toasts from './lib/components/Toasts.svelte';
  import ContextMenu from './lib/components/ContextMenu.svelte';
  import ProjectMap from './lib/components/ProjectMap.svelte';

  let toolbar: Toolbar;
  let accent = $state<{ color: string; light: boolean } | null>(null);
  let tagSource = $state<'selection' | 'staging' | null>(null);
  const tagTargets = $derived(tagSource === 'staging' ? app.staging : app.selectedEntries);

  onMount(() => {
    app.init();
  });

  function openPreview() {
    const first = app.selectedEntries.find((x) => x.kind === 'file');
    if (!first) return;
    const thumb = document.querySelector<HTMLElement>(`.tile[data-path="${CSS.escape(first.path)}"] .thumb`);
    app.preview = { entry: first, from: thumb?.getBoundingClientRect() ?? null };
  }

  function typing(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
  }

  function key(e: KeyboardEvent) {
    const mod = isToggleKey(e);
    if (mod && e.key.toLowerCase() === 'f') {
      toolbar.focusSearch();
      e.preventDefault();
      return;
    }
    if (app.view === 'board' || typing(e) || drag.active || tagSource || app.preview || app.menu || app.renaming) return;

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
      e.preventDefault();
    } else if ((isMac && mod && e.key === 'Backspace') || (!isMac && e.key === 'Delete')) {
      app.trash(sel);
      e.preventDefault();
    } else if (mod && e.key.toLowerCase() === 'a') {
      app.selectAll();
      e.preventDefault();
    } else if (e.key === 't' || e.key === 'T') {
      if (app.selection.size) tagSource = 'selection';
      else if (app.staging.length) tagSource = 'staging';
      else app.toast('Erst Dateien auswählen (oder in die Ablage legen).');
      e.preventDefault();
    } else if (e.key === 's' && !mod) {
      app.stage(app.selectedEntries);
    } else if (e.key === ' ') {
      openPreview();
      e.preventDefault();
    } else if (e.key === 'Enter') {
      sel.forEach((x) => app.open(x));
    } else if (e.key === 'Escape') {
      if (app.funnel) app.setFunnel(null);
      else app.selection.clear();
    } else if ((e.key === 'ArrowUp' && mod) || e.key === 'Backspace') {
      app.up();
    } else if (e.key === '[' && mod) app.back();
    else if (e.key === ']' && mod) app.forward();
  }
</script>

<svelte:window onkeydown={key} />

<div class="app">
  <Sidebar />
  <main>
    <Toolbar bind:this={toolbar} {accent} />
    {#if app.view === 'board'}<ProjectMap />{:else}<Canvas />{/if}
    <Tray onTag={() => (tagSource = 'staging')} />
  </main>

  <DropBar />
  <DropGrid />
  {#if app.preview}<Preview onaccent={(c) => (accent = c)} />{/if}
  {#if tagSource && tagTargets.length}<TagBar targets={tagTargets} onclose={() => (tagSource = null)} />{/if}
  {#if app.gridEditorOpen}<GridEditor onclose={() => (app.gridEditorOpen = false)} />{/if}
  {#if app.menu}<ContextMenu onTag={() => (tagSource = 'selection')} onPreview={openPreview} />{/if}
  <Toasts />
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
</style>
