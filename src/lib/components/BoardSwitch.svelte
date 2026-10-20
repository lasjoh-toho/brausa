<script lang="ts">
  import { board } from '../state/board.svelte';
  import Icon from './Icon.svelte';
  import { t } from '../i18n/index.svelte';
</script>

<div class="seg">
  <button class="btn" class:on={board.mode === 'map'} onclick={() => board.setMode('map')} title={t('map.switch.map')}>
    <Icon name="nodes" size={14} /><span class="lbl">{t('map.switch.mapLabel')}</span>
  </button>
  <button class="btn" class:on={board.mode === 'kanban'} onclick={() => board.setMode('kanban')} title={t('map.switch.kanban')}>
    <Icon name="kanban" size={14} /><span class="lbl">Kanban</span>
  </button>
</div>
{#if board.mode === 'map'}
  <button class="btn icon" class:on={board.storiesOpen} onclick={() => board.toggleStories()} title={t('board.story.title')}>
    <Icon name="play" size={14} />
  </button>
{/if}
<button class="btn icon" class:on={board.notesOpen} onclick={() => board.toggleNotes()} title={t('board.notes.title')}>
  <Icon name="doc" size={15} />{#if board.notes.length}<span class="badge">{board.notes.length}</span>{/if}
</button>

<style>
  .badge {
    margin-left: 3px;
    font-size: 10px;
    color: var(--accent);
  }
</style>
