<script lang="ts">
  /**
   * Geo view: photos with GPS (EXIF or sidecar) on an OpenStreetMap map.
   * Nearby photos are merged into one marker per ~64 px so thousands stay fast.
   * Click a marker to select its photos (and zoom in if it is a group).
   */
  import { onMount } from 'svelte';
  import L from 'leaflet';
  import 'leaflet/dist/leaflet.css';
  import { app } from '../state/app.svelte';
  import { store } from '../platform';
  import type { Entry } from '../core/types';

  const TILE_URL = store.get('tileUrl', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');

  const located = $derived(app.undated.filter((e) => e.geo));
  const missing = $derived(app.undated.filter((e) => e.kind === 'file' && !e.geo).length);

  let el: HTMLDivElement;
  let map: L.Map | null = null;
  let layer: L.LayerGroup | null = null;
  let fitted = false;

  function esc(s: string) {
    return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  }

  function render() {
    if (!map || !layer) return;
    layer.clearLayers();
    const cell = 64;
    const buckets = new Map<string, Entry[]>();
    for (const e of located) {
      const pt = map.latLngToLayerPoint([e.geo!.lat, e.geo!.lon]);
      const k = `${Math.floor(pt.x / cell)}:${Math.floor(pt.y / cell)}`;
      buckets.set(k, [...(buckets.get(k) ?? []), e]);
    }
    for (const group of buckets.values()) {
      const lat = group.reduce((s, e) => s + e.geo!.lat, 0) / group.length;
      const lon = group.reduce((s, e) => s + e.geo!.lon, 0) / group.length;
      const first = group[0];
      app.requestThumb(first);
      const src = app.thumbOf(first);
      const sel = group.some((e) => app.selection.has(e.path));
      const html = `<div class="pin${sel ? ' sel' : ''}">${src ? `<img src="${esc(src)}" alt="">` : ''}${
        group.length > 1 ? `<span>${group.length}</span>` : ''
      }</div>`;
      const m = L.marker([lat, lon], { icon: L.divIcon({ html, className: 'brausa-pin', iconSize: [52, 52], iconAnchor: [26, 26] }) });
      m.on('click', () => {
        app.setSelection(group.map((e) => e.path));
        if (group.length > 1 && map!.getZoom() < 17) {
          map!.fitBounds(L.latLngBounds(group.map((e) => [e.geo!.lat, e.geo!.lon] as [number, number])).pad(0.3), { maxZoom: 17 });
        }
      });
      m.addTo(layer);
    }
    if (!fitted && located.length) {
      fitted = true;
      map.fitBounds(L.latLngBounds(located.map((e) => [e.geo!.lat, e.geo!.lon] as [number, number])).pad(0.15), { maxZoom: 14 });
    }
  }

  onMount(() => {
    map = L.map(el, { zoomControl: true, attributionControl: true, worldCopyJump: true }).setView([48, 10], 4);
    L.tileLayer(TILE_URL, {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
    layer = L.layerGroup().addTo(map);
    map.on('zoomend moveend', render);
    render();
    return () => {
      map?.remove();
      map = null;
    };
  });

  // Re-render when data, thumbnails or the selection change.
  $effect(() => {
    void located;
    void app.thumbs.size;
    void app.selection.size;
    render();
  });
</script>

<div class="wrap">
  <div class="map" bind:this={el}></div>
  <p class="note">
    {located.length} mit Ortsdaten{missing ? ` · ${missing} ohne` : ''} · Klick auf einen Marker wählt die Fotos aus
  </p>
</div>

<style>
  .wrap {
    position: relative;
    margin-bottom: 14px;
  }
  .map {
    height: min(62vh, 620px);
    border-radius: 14px;
    overflow: hidden;
    box-shadow: 0 0 0 1px var(--line);
    background: var(--bg-sunken);
    z-index: 0;
  }
  .note {
    margin: 6px 4px 0;
    font-size: 11px;
    color: var(--fg-faint);
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme='light']) .map :global(.leaflet-tile-pane) {
      filter: invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.9);
    }
  }
  .map :global(.brausa-pin) {
    background: none;
    border: 0;
  }
  .map :global(.pin) {
    position: relative;
    width: 52px;
    height: 52px;
    border-radius: 12px;
    overflow: hidden;
    background: var(--bg-elev);
    border: 2.5px solid #fff;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
    transition: transform 0.12s;
  }
  .map :global(.pin:hover) {
    transform: scale(1.12);
  }
  .map :global(.pin.sel) {
    border-color: var(--accent);
  }
  .map :global(.pin img) {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .map :global(.pin span) {
    position: absolute;
    right: 2px;
    bottom: 2px;
    min-width: 20px;
    padding: 0 5px;
    border-radius: 10px;
    background: var(--accent);
    color: #fff;
    font: 600 11px/18px var(--font);
    text-align: center;
  }
</style>
