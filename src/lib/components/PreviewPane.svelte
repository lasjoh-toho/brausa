<script lang="ts">
  /** Right column of the three-panel view: the file under the cursor, with its details. */
  import { app } from '../state/app.svelte';
  import { category, family, formatSize } from '../core/format';
  import { tagColor } from '../core/tags';
  import { isArchive, inArchive } from '../core/archive';
  import { isMac } from '../platform';
  import TextPreview from './TextPreview.svelte';
  import HtmlPreview from './HtmlPreview.svelte';
  import Icon from './Icon.svelte';

  const e = $derived(app.current);
  const many = $derived(app.selection.size > 1 ? app.selectedEntries : []);
  const cat = $derived(e && e.kind === 'file' ? category(e.ext) : null);

  // Images: straight from the file where the web view can show it, else a large thumbnail from the core.
  let big = $state<string | null>(null);
  $effect(() => {
    const entry = e;
    big = null;
    if (entry && cat === 'image' && !app.backend.fileUrl(entry)) app.backend.thumbnail(entry, 1200).then((u) => entry === e && (big = u)).catch(() => {});
  });
  const src = $derived(e && cat === 'image' ? (app.backend.fileUrl(e) ?? big ?? app.thumbOf(e)) : null);

  let media = $state<string | null>(null);
  let mediaFailed = $state(false);
  $effect(() => {
    const entry = e;
    media = null;
    mediaFailed = false;
    if (entry && (cat === 'video' || cat === 'audio'))
      app.backend
        .localUrl(entry.path)
        .then((u) => entry === e && (media = u))
        .catch(() => (mediaFailed = true));
  });

  const fmt = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

  function resize(ev: PointerEvent) {
    ev.preventDefault();
    const x0 = ev.clientX;
    const w0 = app.previewWidth;
    const move = (m: PointerEvent) => app.setPreviewWidth(w0 + x0 - m.clientX);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
</script>

<aside class="pv" style:width="{app.previewWidth}px">
  <div class="grip" onpointerdown={resize} role="separator" aria-orientation="vertical" aria-label="Breite ändern"></div>
  {#if many.length}
    <div class="empty">
      <Icon name="select" size={36} />
      <b>{many.length} Objekte ausgewählt</b>
      <span>{formatSize(many.reduce((n, x) => n + (x.kind === 'file' ? x.size : 0), 0))}</span>
    </div>
  {:else if e}
    <div class="stage" class:doc={cat === 'text' || cat === 'web' || cat === 'pdf'} class:white={cat === 'text' || cat === 'web'} class:dark={cat === 'pdf' || cat === 'video'}>
      {#key e.path}
        {#if src}
          <img {src} alt={e.name} draggable="false" />
        {:else if (cat === 'video' || cat === 'audio') && media && !mediaFailed}
          {#if cat === 'video'}
            <!-- svelte-ignore a11y_media_has_caption -->
            <video src={media} controls onerror={() => (mediaFailed = true)}></video>
          {:else}
            <div class="audio"><Icon name="audio" size={48} /><audio src={media} controls onerror={() => (mediaFailed = true)}></audio></div>
          {/if}
        {:else if cat === 'pdf'}
          {#await import('./PdfPages.svelte') then m}<m.default path={e.path} />{/await}
        {:else if cat === 'text'}
          <TextPreview entry={e} />
        {:else if cat === 'web'}
          <HtmlPreview entry={e} />
        {:else}
          <div class="ph" style:color={e.color ?? undefined}>
            <Icon name={e.kind === 'dir' ? 'folder' : isArchive(e.path) && !inArchive(e.path) ? 'archive' : family(e.ext) === 'other' ? 'file' : family(e.ext)} size={64} />
            {#if e.kind === 'file'}
              <span class="ext">{e.ext.toUpperCase() || 'DATEI'}</span>
              {#if mediaFailed}<span class="hint">Dieses Format kann brausa hier nicht abspielen.</span>
              {:else if !cat || cat === 'office' || (cat === 'image' && !src)}<span class="hint">Keine Vorschau für diese Art.</span>{/if}
            {/if}
          </div>
        {/if}
      {/key}
    </div>
    <div class="facts">
      <div class="title" title={e.path}>{e.name}</div>
      <dl>
        {#if e.kind === 'file'}<dt>Größe</dt><dd>{formatSize(e.size)}</dd>{/if}
        <dt>Geändert</dt><dd>{fmt.format(e.mtime)}</dd>
        {#if e.ctime}<dt>Erstellt</dt><dd>{fmt.format(e.ctime)}</dd>{/if}
        {#if e.taken}<dt>Aufgenommen</dt><dd>{fmt.format(e.taken)}</dd>{/if}
        <dt>Ort</dt><dd class="path" title={e.path}>{'\u200e' + e.path}</dd>
      </dl>
      {#if e.tags.length}
        <div class="tags">
          {#each e.tags as t (t)}<span class="chip"><i style:background={tagColor(t)}></i>{t}</span>{/each}
        </div>
      {/if}
      <div class="actions">
        <button class="btn" onclick={() => app.open(e)}><Icon name="open" size={13} /> Öffnen</button>
        <button class="btn" onclick={() => app.reveal(e)}><Icon name="folder" size={13} /> {isMac ? 'Im Finder' : 'Im Dateimanager'}</button>
      </div>
    </div>
  {:else}
    <div class="empty">
      <Icon name="eye" size={36} />
      <span>Eine Datei auswählen, um sie hier zu sehen.</span>
      <span class="hint">↑ ↓ blättert, Leertaste zeigt groß.</span>
    </div>
  {/if}
</aside>

<style>
  .pv {
    position: relative;
    flex: none;
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-left: 1px solid var(--line);
    background: var(--bg-elev);
  }
  .grip {
    position: absolute;
    left: -3px;
    top: 0;
    bottom: 0;
    width: 6px;
    cursor: col-resize;
    z-index: 2;
  }
  .grip:hover,
  .grip:active {
    background: color-mix(in srgb, var(--accent) 45%, transparent);
  }
  .stage {
    position: relative;
    flex: 1;
    min-height: 120px;
    display: grid;
    place-items: center;
    overflow: hidden;
    background: var(--bg-sunken);
  }
  /* Documents scroll themselves and need a fixed height. */
  .stage.doc {
    display: block;
  }
  .stage.white {
    background: #fff;
  }
  .stage.dark {
    background: #2a2a28;
  }
  .stage img {
    max-width: calc(100% - 24px);
    max-height: calc(100% - 24px);
    object-fit: contain;
    border-radius: 4px;
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.18);
  }
  .stage video {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .audio {
    display: grid;
    justify-items: center;
    gap: 18px;
    color: var(--fg-faint);
  }
  .audio audio {
    width: min(360px, 90%);
  }
  .ph {
    display: grid;
    justify-items: center;
    gap: 8px;
    color: var(--fg-faint);
  }
  .ext {
    font-family: var(--mono, ui-monospace, monospace);
    font-size: 12px;
  }
  .hint {
    font-size: 12px;
    color: var(--fg-faint);
  }
  .facts {
    flex: none;
    max-height: 45%;
    overflow: auto;
    padding: 12px 14px 14px;
    border-top: 1px solid var(--line);
    font-size: 12px;
  }
  .title {
    margin-bottom: 8px;
    font-size: 14px;
    font-weight: 600;
    word-break: break-word;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 3px 12px;
    margin: 0;
  }
  dt {
    color: var(--fg-faint);
  }
  dd {
    margin: 0;
    min-width: 0;
    color: var(--fg-muted);
  }
  .path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl;
    text-align: left;
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 10px;
  }
  .tags .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .tags i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }
  .actions {
    display: flex;
    gap: 6px;
    margin-top: 12px;
  }
  .empty {
    flex: 1;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 8px;
    padding: 24px;
    text-align: center;
    color: var(--fg-muted);
    font-size: 13px;
  }
  .empty :global(svg) {
    color: var(--fg-faint);
  }
</style>
