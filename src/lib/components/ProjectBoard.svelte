<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { app } from '../state/app.svelte';
  import { board } from '../state/board.svelte';
  import ProjectMap from './ProjectMap.svelte';
  import CardKanban from './CardKanban.svelte';
  import FilePanel from './FilePanel.svelte';
  import Icon from './Icon.svelte';
  import { t } from '../i18n/index.svelte';

  /** Maps belong to a project: the open one, one holding this folder, or the last one used. */
  const project = $derived(app.boardProject);
  let naming = $state('');

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
      <p>{t('map.board.noProject')}</p>
      {#if app.projects.length}
        <div class="pick">
          {#each app.projects as p (p.id)}<button class="btn" onclick={() => app.openProject(p.id)}><Icon name="kanban" size={13} />{p.name}</button>{/each}
        </div>
      {/if}
      <form class="pick" onsubmit={(e) => (e.preventDefault(), naming.trim() && void app.createProject(naming).then(() => (naming = '')))}>
        <input bind:value={naming} placeholder={t('map.board.newProject')} />
        <button class="btn primary" disabled={!naming.trim()}>{t('map.board.create')}</button>
      </form>
    </div>
  {:else if board.mode === 'kanban'}
    <CardKanban />
  {:else}
    <ProjectMap />
  {/if}
  {#if project && board.panelOpen}
    <FilePanel {project} />
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
  .pick {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: center;
  }
  .pick input {
    padding: 5px 8px;
    border-radius: 7px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--fg);
  }
</style>
