<script lang="ts">
  import type { Entry } from '../core/types';
  import { app } from '../state/app.svelte';
  import { drag } from '../state/drag.svelte';
  import { family, formatSize } from '../core/format';
  import { tagColor, leaf } from '../core/tags';
  import { isToggleKey } from '../platform';
  import Icon from './Icon.svelte';
  import { archiveRoot, inArchive, isArchive } from '../core/archive';
  import { t } from '../i18n/index.svelte';

  let { entry, source = 'canvas', compact = false }: { entry: Entry; source?: string; compact?: boolean } = $props();

  const selected = $derived(app.selection.has(entry.path));
  const fam = $derived(family(entry.ext, entry.kind));
  const staged = $derived(app.staging.some((s) => s.path === entry.path));
  // A closed archive takes drops too: they are packed into it.
  const packable = $derived(entry.kind === 'file' && isArchive(entry.path) && !inArchive(entry.path));
  const dropPath = $derived(packable ? archiveRoot(entry.path) : entry.path);
  const isHit = $derived(drag.active && drag.hit?.kind === 'folder' && drag.hit.path === dropPath);
  const dragging = $derived(drag.active && drag.items.some((i) => i.path === entry.path));

  const src = $derived(app.thumbOf(entry));
  const renaming = $derived(app.renaming === entry.path);

  /** Ask for a thumbnail only once the tile is (nearly) on screen. */
  function lazyThumb(node: HTMLElement) {
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((x) => x.isIntersecting)) {
          app.requestThumb(entry);
          io.disconnect();
        }
      },
      { rootMargin: '400px' }
    );
    io.observe(node);
    return { destroy: () => io.disconnect() };
  }

  /** Select the name without the extension, like Finder/Explorer. */
  function renameField(node: HTMLInputElement) {
    node.focus();
    const dot = entry.kind === 'file' ? entry.name.lastIndexOf('.') : -1;
    node.setSelectionRange(0, dot > 0 ? dot : entry.name.length);
  }

  function renameKey(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Enter') app.rename(entry.path, (e.currentTarget as HTMLInputElement).value);
    else if (e.key === 'Escape') app.renaming = null;
  }

  function menu(e: MouseEvent) {
    e.preventDefault();
    if (!selected) app.select(entry.path, 'replace');
    app.menu = { x: e.clientX, y: e.clientY, entry };
  }

  function down(e: PointerEvent) {
    if (renaming || e.button !== 0) return;
    if (e.shiftKey || isToggleKey(e)) {
      // Modifier clicks only change the selection.
      app.select(entry.path, e.shiftKey ? 'range' : 'toggle');
      return;
    }
    // A second click on a selected file (without moving it) deselects it.
    const was = selected;
    if (!selected) app.select(entry.path, 'replace');
    drag.begin(
      e,
      () => (app.selection.has(entry.path) ? app.selectedEntries : [entry]),
      source,
      () => (was ? app.select(entry.path, 'toggle') : app.select(entry.path, 'replace'))
    );
  }

  function open() {
    if (!renaming) app.open(entry);
  }
</script>

<div
  class="tile"
  class:selected
  class:dragging
  class:compact
  class:hit-move={isHit && drag.hit?.zone === 'move'}
  class:hit-attr={isHit && drag.hit?.zone === 'attr'}
  data-path={entry.path}
  data-drop={entry.kind === 'dir' || packable ? 'folder' : undefined}
  data-target={packable ? dropPath : undefined}
  data-zones={entry.kind === 'dir' ? 'dual' : undefined}
  role="option"
  aria-selected={selected}
  tabindex="-1"
  onpointerdown={down}
  ondblclick={open}
  oncontextmenu={menu}
>
  <div class="thumb" use:lazyThumb>
    {#if src}
      <img {src} alt="" draggable="false" loading="lazy" />
    {:else}
      <div class="ph ph-{fam}" style:color={entry.color ?? undefined}>
        <Icon name={fam === 'dir' ? 'folder' : fam === 'other' ? 'file' : fam} size={compact ? 26 : 38} />
        {#if fam !== 'dir' && entry.ext}<span class="ext">{entry.ext}</span>{/if}
      </div>
    {/if}
    {#if entry.relDir}
      <span class="path" title={entry.relDir}>{entry.relDir}</span>
    {/if}
    {#if entry.hit}
      <span class="snip" title={entry.hit.snippet}>{#if entry.hit.page}<b>{t('files.page', { n: entry.hit.page })}</b> {/if}{entry.hit.snippet}</span>
    {/if}
    {#if staged}<span class="staged" title={t('files.inTray')}><Icon name="tray" size={11} /></span>{/if}
    {#if isHit && !packable}
      <div class="zones" aria-hidden="true">
        <span class="z" class:on={drag.hit?.zone === 'move'}>{drag.copy ? t('files.dropCopy') : t('files.dropMove')}</span>
        <span class="z attr" class:on={drag.hit?.zone === 'attr'}>{t('files.dropTag')}</span>
      </div>
    {/if}
  </div>
  <div class="meta">
    {#if renaming}
      <input
        class="rename"
        value={entry.name}
        use:renameField
        onkeydown={renameKey}
        onblur={(e) => app.rename(entry.path, e.currentTarget.value)}
        onpointerdown={(e) => e.stopPropagation()}
        spellcheck="false"
      />
    {:else}
      <span class="name" title={entry.name}>{entry.name}</span>
    {/if}
    {#if !compact}
      <span class="sub">
        {#each entry.tags.slice(0, 3) as t (t)}
          <span class="dot" style:background={tagColor(t)} title={t}></span>
        {/each}
        {#if entry.tags.length}<span class="tagtxt">{entry.tags.map(leaf).join(', ')}</span>{:else if entry.kind === 'file'}{formatSize(entry.size)}{/if}
      </span>
    {/if}
  </div>
</div>

<style>
  .tile {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px;
    border-radius: calc(var(--radius) + 4px);
    user-select: none;
    transition:
      opacity 0.15s,
      transform 0.15s;
  }
  .tile:hover {
    background: var(--bg-sunken);
  }
  .tile.selected {
    background: var(--accent-soft);
  }
  .tile.selected .thumb {
    box-shadow: 0 0 0 2px var(--accent);
  }
  .tile.dragging {
    opacity: 0.35;
  }
  .tile.hit-move .thumb {
    box-shadow: 0 0 0 2px var(--accent);
  }
  .tile.hit-attr .thumb {
    box-shadow: 0 0 0 2px var(--attr);
  }
  .thumb {
    position: relative;
    aspect-ratio: 4 / 3;
    border-radius: var(--radius);
    overflow: hidden;
    background: var(--bg-sunken);
  }
  .compact .thumb {
    aspect-ratio: 1;
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    pointer-events: none;
  }
  .ph {
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
    align-content: center;
    gap: 4px;
    color: var(--fg-faint);
  }
  .ph-dir {
    color: var(--fg-muted);
  }
  .ext {
    font-family: var(--mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .snip {
    position: absolute;
    top: 6px;
    left: 6px;
    right: 6px;
    padding: 4px 6px;
    border-radius: 6px;
    font-size: 10.5px;
    line-height: 1.3;
    color: var(--fg);
    background: color-mix(in srgb, var(--bg-elev) 92%, transparent);
    box-shadow: 0 0 0 1px var(--line);
    display: -webkit-box;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .path {
    position: absolute;
    left: 6px;
    bottom: 6px;
    max-width: calc(100% - 12px);
    padding: 2px 6px;
    border-radius: 6px;
    font-size: 10px;
    color: #fff;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(6px);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0.75;
    transition: opacity 0.15s;
  }
  .tile:hover .path {
    opacity: 1;
  }
  .staged {
    position: absolute;
    top: 6px;
    right: 6px;
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    color: #fff;
    background: var(--accent);
  }
  .zones {
    position: absolute;
    inset: 0;
    display: flex;
    pointer-events: none;
  }
  .z {
    flex: 1;
    display: grid;
    place-items: center;
    font-size: 11px;
    font-weight: 600;
    color: #fff;
    background: rgba(47, 107, 255, 0.25);
    opacity: 0.35;
    transition: opacity 0.1s;
  }
  .z.attr {
    background: rgba(194, 65, 12, 0.3);
  }
  .z.on {
    opacity: 1;
    background: var(--accent);
  }
  .z.attr.on {
    background: var(--attr);
  }
  .meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0 2px;
    min-width: 0;
  }
  .name {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rename {
    width: 100%;
    padding: 1px 4px;
    margin: -2px -4px;
    border: 0;
    border-radius: 4px;
    outline: 2px solid var(--accent);
    background: var(--bg-elev);
    font-weight: 500;
  }
  .sub {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--fg-faint);
    min-width: 0;
  }
  .tagtxt {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
