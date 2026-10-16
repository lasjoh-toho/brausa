<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from './lib/state/app.svelte';
  import { drag } from './lib/state/drag.svelte';
  import { isToggleKey } from './lib/platform';
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

  let toolbar: Toolbar;
  let accent = $state<{ color: string; light: boolean } | null>(null);
  let tagSource = $state<'selection' | 'staging' | null>(null);
  const tagTargets = $derived(tagSource === 'staging' ? app.staging : app.selectedEntries);

  onMount(() => {
    app.init();
  });

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
    if (typing(e) || drag.active || tagSource || app.preview) return;

    if (mod && e.key.toLowerCase() === 'a') {
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
      const first = app.selectedEntries.find((x) => x.kind === 'file');
      if (first) {
        const thumb = document.querySelector<HTMLElement>(`.tile[data-path="${CSS.escape(first.path)}"] .thumb`);
        app.preview = { entry: first, from: thumb?.getBoundingClientRect() ?? null };
      }
      e.preventDefault();
    } else if (e.key === 'Enter') {
      const dir = app.selectedEntries.find((x) => x.kind === 'dir');
      if (dir) app.navigate(dir.path);
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
    <Canvas />
    <Tray onTag={() => (tagSource = 'staging')} />
  </main>

  <DropBar />
  <DropGrid />
  {#if app.preview}<Preview onaccent={(c) => (accent = c)} />{/if}
  {#if tagSource && tagTargets.length}<TagBar targets={tagTargets} onclose={() => (tagSource = null)} />{/if}
  {#if app.gridEditorOpen}<GridEditor onclose={() => (app.gridEditorOpen = false)} />{/if}
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
