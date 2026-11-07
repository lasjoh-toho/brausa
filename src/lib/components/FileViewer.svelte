<script lang="ts">
  /**
   * brausa's own viewer for pictures, videos and sound in the right column, next
   * to the list: the files stay visible while one is shown, and a click on another
   * file in the list shows that one here. A double click opens the large preview.
   */
  import { app } from '../state/app.svelte';
  import { board } from '../state/board.svelte';
  import { category } from '../core/format';
  import type { Entry } from '../core/types';
  import Icon from './Icon.svelte';
  import { t } from '../i18n/index.svelte';

  let { entry }: { entry: Entry | null } = $props();

  const ref = $derived(board.reader?.ref);
  const cat = $derived(category((ref?.ext ?? '').toLowerCase()));

  let big = $state<string | null>(null);
  let media = $state<string | null>(null);
  let failed = $state(false);
  $effect(() => {
    const e = entry;
    big = null;
    media = null;
    failed = false;
    if (!e) return;
    if (cat === 'image' && !app.backend.fileUrl(e)) app.backend.thumbnail(e, 1600).then((u) => e === entry && (big = u)).catch(() => (failed = true));
    if (cat === 'video' || cat === 'audio')
      app.backend
        .localUrl(e.path)
        .then((u) => e === entry && (media = u))
        .catch(() => (failed = true));
  });
  const src = $derived(entry && cat === 'image' ? (app.backend.fileUrl(entry) ?? big ?? app.thumbOf(entry)) : null);

  function large() {
    if (!entry) return;
    app.preview = { entry, from: null };
  }
</script>

<div class="fv" class:dark={cat !== 'image'}>
  <header>
    <Icon name={cat === 'video' ? 'video' : cat === 'audio' ? 'audio' : 'image'} size={14} />
    <span class="name" title={ref?.path}>{ref?.name}</span>
    <button class="btn icon" title={t('viewer.large')} onclick={large}><Icon name="zoomIn" size={14} /></button>
    <button class="btn icon" title={t('reader.close')} onclick={() => board.closeReader()}><Icon name="x" size={14} /></button>
  </header>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="stage" ondblclick={large}>
    {#key ref?.path}
      {#if failed}
        <p class="msg">{cat === 'image' ? t('preview.noPreview') : t('preview.cannotPlay')}</p>
      {:else if src}
        <img {src} alt={ref?.name} draggable="false" />
      {:else if cat === 'video' && media}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video src={media} controls onerror={() => (failed = true)}></video>
      {:else if cat === 'audio' && media}
        <div class="audio"><Icon name="audio" size={56} /><audio src={media} controls onerror={() => (failed = true)}></audio></div>
      {:else}
        <p class="msg">{t('reader.loading')}</p>
      {/if}
    {/key}
  </div>
</div>

<style>
  .fv {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--bg-sunken);
  }
  .fv.dark .stage {
    background: #1c1c1a;
  }
  header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--line);
    background: var(--bg-elev);
    color: var(--fg-muted);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
    color: var(--fg);
  }
  .stage {
    flex: 1;
    min-height: 0;
    display: grid;
    place-items: center;
    overflow: hidden;
    cursor: zoom-in;
  }
  img {
    max-width: calc(100% - 24px);
    max-height: calc(100% - 24px);
    object-fit: contain;
    border-radius: 4px;
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.18);
  }
  video {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .audio {
    display: grid;
    justify-items: center;
    gap: 18px;
    color: #8a8a85;
  }
  .audio audio {
    width: min(360px, 90%);
  }
  .msg {
    color: var(--fg-faint);
    font-size: 13px;
  }
</style>
