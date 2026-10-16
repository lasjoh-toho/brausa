<script lang="ts">
  // Lightweight geo view without tiles: entries are plotted on a fitted
  // Web-Mercator canvas. Real map tiles (Leaflet + offline OSM cache) follow in phase 2.
  import { app } from '../state/app.svelte';
  import Tile from './Tile.svelte';

  const located = $derived(app.visible.filter((e) => e.geo));
  const missing = $derived(app.visible.filter((e) => e.kind === 'file' && !e.geo).length);

  const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

  const bounds = $derived.by(() => {
    if (!located.length) return null;
    const xs = located.map((e) => e.geo!.lon);
    const ys = located.map((e) => merc(e.geo!.lat));
    const pad = 0.08;
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const w = Math.max(x1 - x0, 0.05);
    const h = Math.max(y1 - y0, 0.0005);
    return { x0: x0 - w * pad, w: w * (1 + 2 * pad), y0: y0 - h * pad, h: h * (1 + 2 * pad) };
  });

  function pos(lat: number, lon: number) {
    const b = bounds!;
    return { left: ((lon - b.x0) / b.w) * 100, top: (1 - (merc(lat) - b.y0) / b.h) * 100 };
  }
</script>

<div class="map">
  {#if bounds}
    <div class="plane">
      {#each located as e (e.path)}
        {@const p = pos(e.geo!.lat, e.geo!.lon)}
        <div class="pin" style:left="{p.left}%" style:top="{p.top}%">
          <Tile entry={e} compact />
        </div>
      {/each}
    </div>
  {:else}
    <p class="hint">Keine Dateien mit Ortsdaten in dieser Ansicht.</p>
  {/if}
  <p class="note">
    {located.length} mit Ortsdaten{missing ? ` · ${missing} ohne` : ''} · Kartenkacheln folgen in Phase 2
  </p>
</div>

<style>
  .map {
    position: relative;
    height: 100%;
    min-height: 420px;
    border-radius: 14px;
    background:
      linear-gradient(var(--line) 1px, transparent 1px) 0 0 / 48px 48px,
      linear-gradient(90deg, var(--line) 1px, transparent 1px) 0 0 / 48px 48px,
      var(--bg-sunken);
    overflow: hidden;
  }
  .plane {
    position: absolute;
    inset: 60px 80px;
  }
  .pin {
    position: absolute;
    width: 76px;
    transform: translate(-50%, -50%);
    transition: transform 0.15s;
  }
  .pin:hover {
    z-index: 3;
    transform: translate(-50%, -50%) scale(1.6);
  }
  .pin :global(.meta) {
    display: none;
  }
  .pin :global(.tile) {
    padding: 2px;
    background: var(--bg-elev);
    box-shadow: var(--shadow);
  }
  .hint {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: var(--fg-faint);
  }
  .note {
    position: absolute;
    left: 12px;
    bottom: 8px;
    margin: 0;
    font-size: 11px;
    color: var(--fg-faint);
  }
</style>
