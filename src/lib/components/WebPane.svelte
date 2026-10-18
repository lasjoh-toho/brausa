<script lang="ts">
  /**
   * Web panel next to the files. The page itself is a native webview that
   * brausa lays over `.view`; it is hidden while menus, dialogs or a drag
   * would otherwise end up underneath it.
   */
  import { onMount } from 'svelte';
  import { app } from '../state/app.svelte';
  import { drag } from '../state/drag.svelte';
  import { wikis } from '../state/wikis.svelte';
  import { web } from '../state/web.svelte';
  import Icon from './Icon.svelte';

  let view = $state<HTMLElement>();
  let address = $state(web.url);
  let editing = $state(false);

  $effect(() => {
    if (!editing) address = web.url;
  });

  // Anything brausa draws over the panel must not end up under the native page.
  const covered = $derived(
    !!app.preview || !!app.menu || app.gridEditorOpen || app.tagBarOpen || wikis.editing !== null || wikis.overlaysOpen || drag.active
  );

  function measure() {
    if (!view) return;
    const r = view.getBoundingClientRect();
    void web.place({ x: r.left, y: r.top, w: r.width, h: r.height }, !covered);
  }

  $effect(() => {
    void covered;
    void web.width;
    void web.started;
    measure();
  });

  onMount(() => {
    // Reopen the last page; addresses of local sites are only valid while the app runs.
    if (!web.started && web.url && !/^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]+\//.test(web.url)) void web.go(web.url);
    const ro = new ResizeObserver(measure);
    if (view) ro.observe(view);
    window.addEventListener('resize', measure);
    // Panels around it change size without resizing this element (sidebar, second panel).
    const t = setInterval(measure, 500);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      clearInterval(t);
      void web.place({ x: 0, y: 0, w: 1, h: 1 }, false);
    };
  });

  function resize(e: PointerEvent) {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = web.width;
    const move = (ev: PointerEvent) => web.setWidth(w0 + x0 - ev.clientX);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const secure = $derived(web.url.startsWith('https:'));
</script>

<aside class="web" style:width="{web.width}px">
  <div class="grip" onpointerdown={resize} role="separator" aria-orientation="vertical" aria-label="Breite ändern"></div>
  <div class="bar">
    <button class="btn icon" disabled={!web.started} onclick={() => web.nav('back')} aria-label="Zurück"><Icon name="back" size={14} /></button>
    <button class="btn icon" disabled={!web.started} onclick={() => web.nav('forward')} aria-label="Vor"><Icon name="forward" size={14} /></button>
    <button class="btn icon" disabled={!web.started} onclick={() => web.nav('reload')} aria-label="Neu laden"><Icon name="sync" size={14} /></button>
    <form class="addr" onsubmit={(e) => (e.preventDefault(), (editing = false), address.trim() && void web.go(address))}>
      <Icon name={web.local ? 'folder' : secure ? 'globe' : 'warn'} size={12} />
      <input
        bind:value={address}
        onfocus={(e) => ((editing = true), e.currentTarget.select())}
        onblur={() => (editing = false)}
        placeholder="Adresse oder Suchbegriff"
        spellcheck="false"
      />
      {#if web.loading}<span class="spin"></span>{/if}
    </form>
    <button class="btn icon" onclick={() => web.toggle(false)} aria-label="Web-Fenster schließen"><Icon name="x" size={14} /></button>
  </div>
  <div class="bar tools">
    <button class="btn" disabled={!web.started} onclick={() => web.clip()} title="Markierten Text (oder die Seite) als Karte auf die Map des Projekts legen">
      <Icon name="nodes" size={13} /> Auf die Map
    </button>
    <button class="btn" disabled={!web.started} onclick={() => web.savePage()} title="Seite als HTML in den Projektordner (oder den aktuellen Ordner) speichern">
      <Icon name="tray" size={13} /> Speichern
    </button>
    <span class="grow"></span>
    {#if web.local}
      <button class="btn" class:warn={web.local.scripts} onclick={() => web.setScripts(!web.local!.scripts)} title="Für alle Seiten in diesem Ordner merken">
        <Icon name="warn" size={12} />
        {web.local.scripts ? 'Skripte laufen · aus' : 'Skripte aus · erlauben'}
      </button>
    {:else}
      <span class="note" title="Eigene Cookies und Logins, getrennt vom normalen Browser; die Seite hat keinen Zugriff auf brausa und deine Dateien. Downloads landen im Projekt bzw. im aktuellen Ordner.">
        <Icon name="globe" size={12} /> abgeschottet
      </span>
    {/if}
  </div>
  <div class="view" bind:this={view}>
    {#if !web.started}
      <div class="start">
        <Icon name="globe" size={28} />
        <p>Adresse oder Suchbegriff oben eingeben.</p>
        <p class="muted">
          Das Web-Fenster hat eigene Cookies und Logins, getrennt von deinem Browser, und keinen Zugriff auf brausa oder deine Dateien.
          Downloads und gespeicherte Seiten landen im offenen Projekt (bzw. im aktuellen Ordner). „Auf die Map“ legt die Markierung als Karte mit Link auf die
          Projektmap.
        </p>
        <p class="muted">Lokale Webseiten: Rechtsklick auf eine HTML-Datei → „Im Web-Fenster öffnen“.</p>
      </div>
    {:else if covered}
      <div class="start muted">…</div>
    {/if}
  </div>
</aside>

<style>
  .web {
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
  .bar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 8px;
  }
  .tools {
    padding-top: 0;
    border-bottom: 1px solid var(--line);
  }
  .addr {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
    height: 28px;
    border-radius: 8px;
    background: var(--bg-sunken);
    color: var(--fg-faint);
  }
  .addr input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    color: var(--fg);
    font: inherit;
    font-size: 12.5px;
    outline: none;
  }
  .spin {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 2px solid var(--line);
    border-top-color: var(--accent);
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .grow {
    flex: 1;
  }
  .note {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--fg-faint);
  }
  .btn.warn {
    color: #a15c00;
  }
  .view {
    position: relative;
    flex: 1;
    min-height: 0;
    background: #fff;
  }
  .start {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 8px;
    padding: 24px;
    text-align: center;
    color: var(--fg-muted);
    background: var(--bg);
  }
  .muted {
    color: var(--fg-faint);
    font-size: 12px;
    max-width: 420px;
  }
</style>
