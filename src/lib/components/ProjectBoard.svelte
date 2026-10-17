<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { app } from '../state/app.svelte';
  import { board } from '../state/board.svelte';
  import ProjectMap from './ProjectMap.svelte';
  import CardKanban from './CardKanban.svelte';
  import FilePanel from './FilePanel.svelte';
  import Icon from './Icon.svelte';

  /** Maps belong to the project the current folder is in. */
  const project = $derived(app.libraryOf(app.cwd));

  $effect(() => {
    void board.open(project?.root ?? null);
  });
  // The index repairs moved files in the background; cards follow.
  let unlisten: (() => void) | null = null;
  onMount(async () => {
    unlisten = await app.backend.onIndexReport(() => void board.refreshRefs());
  });
  onDestroy(() => {
    unlisten?.();
    void board.flush(true);
  });
</script>

<div class="pb">
  {#if !project}
    <div class="empty">
      <Icon name="nodes" size={28} />
      <p>Maps gehören zu einem Projekt.</p>
      <button class="btn primary" onclick={() => app.addProject(app.cwd)}>„{app.cwd.split(/[\\/]/).pop()}“ als Projekt einbeziehen</button>
    </div>
  {:else if board.mode === 'kanban'}
    <CardKanban />
  {:else}
    <ProjectMap />
  {/if}
  {#if project?.root && board.panelOpen}
    <FilePanel root={project.root} />
  {/if}
</div>

<style>
  .pb {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .empty {
    flex: 1;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 10px;
    color: var(--fg-muted);
  }
</style>
