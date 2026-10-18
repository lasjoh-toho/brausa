<script lang="ts">
  import { board } from '../state/board.svelte';
  import Icon from './Icon.svelte';
</script>

<div class="seg">
  <button class="btn" class:on={board.mode === 'map'} onclick={() => board.setMode('map')} title="Projektmap">
    <Icon name="nodes" size={14} /><span class="lbl">Map</span>
  </button>
  <button class="btn" class:on={board.mode === 'kanban'} onclick={() => board.setMode('kanban')} title="Karten mit Status als Kanban">
    <Icon name="kanban" size={14} /><span class="lbl">Kanban</span>
  </button>
</div>
<button class="btn icon" class:on={board.panelOpen} onclick={() => board.togglePanel()} title="Dateien des Projekts zum Hineinziehen">
  <Icon name="folder" size={15} />
</button>
