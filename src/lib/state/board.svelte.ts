/**
 * State of the project map ("board") view: which map of which project is
 * open, the camera, selection, undo history and debounced saving.
 */
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { app } from './app.svelte';
import type { MapInfo } from '../backend/types';
import {
  bounds,
  fitRect,
  newMap,
  normalizeMap,
  planeFrame,
  applyFrame,
  worldRect,
  type Camera,
  type CardRef,
  type ProjectMap
} from '../core/map';
import type { Entry } from '../core/types';
import { family } from '../core/format';
import { store } from '../platform';

type Snapshot = string;

/** Opened in brausa's reader instead of the default app (snippets need it). */
export const READABLE = new Set(['pdf', 'html', 'htm', 'md', 'markdown', 'txt']);

const HISTORY = 100;

class BoardState {
  root = $state<string | null>(null);
  maps = $state<MapInfo[]>([]);
  map = $state<ProjectMap | null>(null);
  cam = $state<Camera>({ x: -80, y: -80, z: 1 });
  /** Viewport size in px, set by the component. */
  vw = $state(800);
  vh = $state(600);
  selection = new SvelteSet<string>();
  link = $state<string | null>(null);
  editing = $state<string | null>(null);
  loading = $state(false);
  mode = $state<'map' | 'kanban'>(store.get('boardMode', 'map'));
  panelOpen = $state(store.get('boardPanel', false));
  /** Document open in the reader next to the map (PDF, HTML, Markdown, text). */
  reader = $state<{ ref: CardRef; seq: number } | null>(null);
  readerWidth = $state(store.get('readerWidth', 520));
  /** Preview images for file cards, by path. */
  thumbs = new SvelteMap<string, string | null>();

  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  canUndo = $state(false);
  canRedo = $state(false);
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private anim = 0;

  async open(root: string | null) {
    if (root === this.root && (this.map || this.loading)) return;
    await this.flush();
    this.root = root;
    this.map = null;
    this.reset();
    if (!root) return;
    this.loading = true;
    try {
      this.maps = await app.backend.listMaps(root);
      const last = store.get<string>('map:' + root, '');
      const id = this.maps.find((m) => m.id === last)?.id ?? this.maps[0]?.id;
      if (id) await this.load(id);
      else await this.create('Übersicht');
    } catch (e) {
      app.toast(String(e), true);
    } finally {
      this.loading = false;
    }
  }

  async load(id: string) {
    if (!this.root) return;
    await this.flush();
    const m = normalizeMap(await app.backend.loadMap(this.root, id));
    this.reset();
    this.map = m;
    store.set('map:' + this.root, id);
    if (m.view) this.cam = m.view;
    else this.overview(false);
    void this.refreshRefs();
  }

  setMode(mode: 'map' | 'kanban') {
    this.mode = mode;
    store.set('boardMode', mode);
  }

  togglePanel() {
    this.panelOpen = !this.panelOpen;
    store.set('boardPanel', this.panelOpen);
  }

  /** Files may have moved or vanished since the map was saved: ask the index. */
  async refreshRefs() {
    const m = this.map;
    if (!m) return;
    const refs = Object.values(m.cards).flatMap((c) => (c.refs ?? []).filter((r) => r.kind === 'file' && r.id));
    if (!refs.length) return;
    try {
      const where = await app.backend.locateFiles([...new Set(refs.map((r) => r.id!))]);
      let moved = false;
      for (const r of refs) {
        const p = where[r.id!];
        r.missing = p === null;
        if (p && p !== r.path) {
          r.path = p;
          r.name = p.split(/[\\/]/).pop();
          moved = true;
        }
      }
      if (moved) this.changed();
    } catch (e) {
      app.toast(String(e), true);
    }
  }

  /** Index ids for entries, as card references. */
  async refsFor(entries: Entry[]): Promise<CardRef[]> {
    const links = await app.backend.linkFiles(entries.map((e) => e.path));
    return entries.map((e, i) => ({ kind: 'file', id: links[i].id, path: e.path, name: e.name, ext: e.ext, dir: e.kind === 'dir' }));
  }

  isImage(r: CardRef | undefined): boolean {
    return !!r?.path && !r.dir && !r.missing && family(r.ext ?? '', 'file') === 'image';
  }

  requestThumb(r: CardRef) {
    const p = r.path!;
    if (this.thumbs.has(p)) return;
    this.thumbs.set(p, null);
    const e = { path: p, name: r.name ?? '', ext: r.ext ?? '', kind: 'file', size: 0, mtime: 0, ctime: 0, tags: [] } satisfies Entry;
    app.backend
      .thumbnail(e, 480)
      .then((url) => this.thumbs.set(p, url))
      .catch(() => {});
  }

  async openExternal(path: string) {
    try {
      await app.backend.openDefault(path);
    } catch (e) {
      app.toast(String(e).replace(/^Error: /, ''), true);
    }
  }

  /** Show a document in the reader; with an anchor (snippet) it scrolls there and flashes it. */
  openReader(r: CardRef) {
    const seq = (this.reader?.seq ?? 0) + 1;
    this.reader = { ref: r, seq };
    // Opened from the file list: get the index id so this document's snippets are highlighted.
    if (!r.id && r.path)
      void app.backend.linkFiles([r.path]).then(([l]) => {
        if (this.reader?.seq === seq) this.reader = { ref: { ...r, id: l.id }, seq };
      });
  }

  closeReader() {
    this.reader = null;
  }

  setReaderWidth(w: number) {
    this.readerWidth = Math.round(Math.min(Math.max(w, 300), this.vw + this.readerWidth - 240));
    store.set('readerWidth', this.readerWidth);
  }

  /** All snippet anchors on this map that point into the document with this index id. */
  snippetsOf(id: string | undefined): CardRef[] {
    if (!id || !this.map) return [];
    return Object.values(this.map.cards).flatMap((c) => (c.refs ?? []).filter((r) => r.id === id && (r.page || r.quote)));
  }

  async openRef(r: CardRef) {
    if (!r.path || r.missing) return app.toast(`„${r.name ?? 'Datei'}“ wurde nicht gefunden`, true);
    if (!r.dir && READABLE.has(r.ext ?? '')) return this.openReader(r);
    if (r.dir) {
      app.setView('stream');
      return app.navigate(r.path);
    }
    try {
      await app.backend.openDefault(r.path);
    } catch (e) {
      app.toast(String(e).replace(/^Error: /, ''), true);
    }
  }

  async create(title: string) {
    if (!this.root) return;
    await this.flush();
    const m = newMap(title);
    await app.backend.saveMap(this.root, m);
    this.maps = await app.backend.listMaps(this.root);
    await this.load(m.id);
  }

  async rename(title: string) {
    if (!this.map || !title.trim()) return;
    this.map.title = title.trim();
    await this.flush(true);
    if (this.root) this.maps = await app.backend.listMaps(this.root);
  }

  async remove() {
    if (!this.root || !this.map) return;
    const { id, title } = this.map;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    await app.backend.deleteMap(this.root, id);
    this.map = null;
    this.maps = await app.backend.listMaps(this.root);
    if (this.maps[0]) await this.load(this.maps[0].id);
    else await this.create('Übersicht');
    app.toast(`Map „${title}“ gelöscht`);
  }

  private reset() {
    this.selection.clear();
    this.link = null;
    this.editing = null;
    this.undoStack = [];
    this.redoStack = [];
    this.canUndo = this.canRedo = false;
  }

  // ---------------------------------------------------------------- history + saving

  snapshot(): Snapshot {
    const m = this.map!;
    return JSON.stringify({ cards: m.cards, roots: m.roots, links: m.links });
  }

  /** Remember the state before a change (`before` = a snapshot taken at gesture start). */
  checkpoint(before: Snapshot = this.snapshot()) {
    if (!this.map || before === this.snapshot()) return;
    this.undoStack.push(before);
    if (this.undoStack.length > HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this.canUndo = true;
    this.canRedo = false;
    this.changed();
  }

  /** Apply a change with undo. */
  mutate(fn: (m: ProjectMap) => void) {
    if (!this.map) return;
    const before = this.snapshot();
    fn(this.map);
    this.checkpoint(before);
  }

  undo() {
    this.step(this.undoStack, this.redoStack);
  }

  redo() {
    this.step(this.redoStack, this.undoStack);
  }

  private step(from: Snapshot[], to: Snapshot[]) {
    const s = from.pop();
    if (!s || !this.map) return;
    to.push(this.snapshot());
    Object.assign(this.map, JSON.parse(s));
    this.selection.clear();
    this.link = null;
    this.canUndo = this.undoStack.length > 0;
    this.canRedo = this.redoStack.length > 0;
    this.changed();
  }

  /** Something changed: save soon. */
  changed() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flush(true), 500);
  }

  async flush(force = false) {
    if (!this.saveTimer && !force) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.root || !this.map) return;
    const m = $state.snapshot(this.map) as ProjectMap;
    m.view = { ...this.cam };
    m.updated = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    try {
      await app.backend.saveMap(this.root, m);
    } catch (e) {
      app.toast('Map nicht gespeichert: ' + String(e), true);
    }
  }

  // ---------------------------------------------------------------- camera

  setCam(c: Camera) {
    cancelAnimationFrame(this.anim);
    this.cam = c;
    this.saveCamSoon();
  }

  private camTimer: ReturnType<typeof setTimeout> | null = null;
  /** The camera is saved with the map, but moving it is not an undoable change. */
  private saveCamSoon() {
    if (this.camTimer) clearTimeout(this.camTimer);
    this.camTimer = setTimeout(() => void this.flush(true), 1500);
  }

  /** Animate to a camera. Zoom is interpolated geometrically so deep flights feel even. */
  flyTo(to: Camera, ms = 380) {
    cancelAnimationFrame(this.anim);
    const from = { ...this.cam };
    const cx0 = from.x + this.vw / 2 / from.z, cy0 = from.y + this.vh / 2 / from.z;
    const cx1 = to.x + this.vw / 2 / to.z, cy1 = to.y + this.vh / 2 / to.z;
    const t0 = performance.now();
    const frame = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      const z = from.z * (to.z / from.z) ** e;
      // Move the centre in step with 1/z, so the target stays put while zooming.
      const u = Math.abs(1 / to.z - 1 / from.z) < 1e-12 ? e : (1 / z - 1 / from.z) / (1 / to.z - 1 / from.z);
      const cx = cx0 + (cx1 - cx0) * u, cy = cy0 + (cy1 - cy0) * u;
      this.cam = { x: cx - this.vw / 2 / z, y: cy - this.vh / 2 / z, z };
      if (t < 1) this.anim = requestAnimationFrame(frame);
      else this.saveCamSoon();
    };
    this.anim = requestAnimationFrame(frame);
  }

  /** Fly to a card (e.g. from the Kanban). */
  reveal(id: string) {
    if (!this.map?.cards[id]) return;
    this.selection.clear();
    this.selection.add(id);
    this.flyTo(fitRect(worldRect(this.map, id), this.vw, this.vh, 0.2));
  }

  /** Show the whole map (or a plane's content). */
  overview(animate = true) {
    const m = this.map;
    if (!m) return;
    const b = bounds(m, m.roots);
    const cam = b
      ? fitRect(applyFrame(planeFrame(m, null), b), this.vw, this.vh, 0.1)
      : { x: -this.vw / 2, y: -this.vh / 2, z: 1 };
    cam.z = Math.min(cam.z, 1.5);
    if (b) {
      cam.x = b.x + b.w / 2 - this.vw / 2 / cam.z;
      cam.y = b.y + b.h / 2 - this.vh / 2 / cam.z;
    }
    if (animate) this.flyTo(cam);
    else this.cam = cam;
  }
}

export const board = new BoardState();
