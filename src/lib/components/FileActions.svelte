<script lang="ts">
  /**
   * Side menu at the right edge of the viewer: what can be done with the file shown.
   * It slides in while the pointer is over the viewer; on touch screens a tap on the
   * handle shows and hides it.
   */
  import { app } from '../state/app.svelte';
  import { board } from '../state/board.svelte';
  import type { Entry } from '../core/types';
  import { isMac } from '../platform';
  import Icon from './Icon.svelte';
  import { t } from '../i18n/index.svelte';

  let { entry }: { entry: Entry } = $props();
  let pinned = $state(false);

  function withSelection(run: () => void) {
    // Tagging and the tray work on the selection: make it this file.
    app.select(entry.path, 'replace');
    run();
  }

  type Act = { icon: string; label: string; run: (ev: MouseEvent) => void; danger?: boolean };
  const acts = $derived<Act[]>([
    { icon: 'zoomIn', label: t('viewer.large'), run: () => (app.preview = { entry, from: null }) },
    { icon: 'open', label: t('menu.openDefault'), run: () => void app.openExternal(entry) },
    { icon: 'layers', label: t('menu.openWith'), run: (ev) => (app.menu = { x: ev.clientX - 260, y: ev.clientY, entry, withOpen: true }) },
    { icon: 'folder', label: isMac ? t('menu.revealFinder') : t('menu.revealFiles'), run: () => void app.reveal(entry) },
    { icon: 'tag', label: t('menu.tag'), run: () => withSelection(() => (app.tagSource = 'selection')) },
    { icon: 'tray', label: t('menu.stage'), run: () => app.stage([entry]) },
    { icon: 'copy', label: t('viewer.copyPath'), run: () => void navigator.clipboard?.writeText(entry.path).then(() => app.toast(t('viewer.pathCopied'))) },
    { icon: 'trash', label: t('menu.trash'), danger: true, run: () => void app.trash([entry]).then(() => board.closeReader()) }
  ]);
</script>

<div class="side" class:pinned>
  <button
    class="handle"
    aria-label={t('viewer.actions')}
    aria-expanded={pinned}
    onpointerup={(e) => e.pointerType !== 'mouse' && (pinned = !pinned)}><Icon name="menu" size={13} /></button
  >
  <div class="acts" role="toolbar" aria-label={t('viewer.actions')}>
    {#each acts as a (a.icon)}
      <button class="act" class:danger={a.danger} title={a.label} aria-label={a.label} onclick={(ev) => ((pinned = false), a.run(ev))}><Icon name={a.icon} size={15} /></button>
    {/each}
  </div>
</div>

<style>
  .side {
    position: absolute;
    top: 50%;
    right: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    transform: translateY(-50%);
    pointer-events: none;
  }
  .handle {
    pointer-events: auto;
    display: grid;
    place-items: center;
    width: 18px;
    height: 44px;
    margin-right: 2px;
    border-radius: 6px 0 0 6px;
    color: var(--fg-muted);
    background: color-mix(in srgb, var(--bg-elev) 80%, transparent);
    opacity: 0.55;
    transition: opacity 0.15s;
  }
  .acts {
    pointer-events: auto;
    display: grid;
    gap: 2px;
    padding: 5px;
    border-radius: 12px 0 0 12px;
    background: color-mix(in srgb, var(--bg-elev) 92%, transparent);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    box-shadow:
      var(--shadow),
      0 0 0 1px var(--line);
    transform: translateX(110%);
    opacity: 0;
    transition:
      transform 0.18s ease-out,
      opacity 0.18s;
  }
  /* Shown while the pointer is over the viewer (the parent has class .with-actions), or pinned by a tap. */
  :global(.with-actions:hover) .acts,
  .pinned .acts {
    transform: none;
    opacity: 1;
  }
  :global(.with-actions:hover) .handle,
  .pinned .handle {
    opacity: 0;
    pointer-events: none;
  }
  .pinned .handle {
    opacity: 1;
    pointer-events: auto;
  }
  @media (hover: none) {
    :global(.with-actions:hover) .acts {
      transform: translateX(110%);
      opacity: 0;
    }
    .pinned .acts {
      transform: none;
      opacity: 1;
    }
    :global(.with-actions:hover) .handle {
      opacity: 0.55;
      pointer-events: auto;
    }
  }
  .act {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    color: var(--fg-muted);
  }
  .act:hover {
    background: var(--accent);
    color: #fff;
  }
  .act.danger:hover {
    background: var(--danger);
  }
</style>
