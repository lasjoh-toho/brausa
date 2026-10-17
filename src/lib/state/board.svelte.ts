/**
 * State of the project map ("board") view: which map of which project is
 * open, the camera, selection, undo history and debounced saving.
 */
import { SvelteSet } from 'svelte/reactivity';
import { app } from './app.svelte';
import type { MapInfo } from '../backend/types';
import {
  bounds,
  fitRect,
  newMap,
  normalizeMap,
  planeFrame,
  applyFrame,
  type Camera,
  type ProjectMap
} from '../core/map';
import { store } from '../platform';

type Snapshot = string;

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
