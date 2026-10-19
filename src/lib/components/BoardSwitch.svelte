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
<button class="btn icon" class:on={board.panelOpen} onclick={() => board.togglePanel()} title={t('map.switch.files')}>
  <Icon name="folder" size={15} />
</button>
