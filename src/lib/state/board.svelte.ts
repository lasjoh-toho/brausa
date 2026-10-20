/**
 * State of the project map ("board") view: which map of which project is
 * open, the camera, selection, undo history and debounced saving.
 */
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { app } from './app.svelte';
import type { MapInfo } from '../backend/types';
import {
  activeStory,
  indentStep,
  liveSteps,
  STORY_COLORS,
  type Story,
  addCard,
  contextCard,
  deleteCards,
  toNote,
  toPlane,
  tidyStacks,
  uid,
  type NoteCard,
  bounds,
  fitRect,
  newMap,
  normalizeMap,
  planeFrame,
  applyFrame,
  worldRect,
  type Camera,
  type CardRef,
  type MapCard,
  type ProjectMap
} from '../core/map';
import type { Entry } from '../core/types';
import { family } from '../core/format';
import { store } from '../platform';
import { t } from '../i18n/index.svelte';

type Snapshot = string;

/** Opened in brausa's reader instead of the default app (snippets need it). */
export const READABLE = new Set(['pdf', 'html', 'htm', 'md', 'markdown', 'txt', 'csv', 'json', 'xml', 'yml', 'yaml', 'log', 'tex', 'rtf']);

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
  /** The story panel (presentation paths) at the right of the map. */
  storiesOpen = $state(false);
  /** Playing a story: index of the stop shown. */
  presenting = $state<{ i: number } | null>(null);

  /** The project's notes & snippets thread (cards not on a map), shown at the right. */
  notes = $state<NoteCard[]>([]);
  notesOpen = $state(store.get('boardNotes', false));
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
    if (!root) return void (this.notes = []);
    void this.loadNotes();
    this.loading = true;
    try {
      this.maps = await app.backend.listMaps(root);
      const last = store.get<string>('map:' + root, '');
      const id = this.maps.find((m) => m.id === last)?.id ?? this.maps[0]?.id;
      if (id) await this.load(id);
      else await this.create(t('board.defaultTitle'));
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

  // ---------------------------------------------------------------- stories (presentation paths)

  get story(): Story | null {
    return this.map ? (this.map.stories?.find((s) => s.id === this.map!.story) ?? this.map.stories?.[0] ?? null) : null;
  }

  toggleStories(open = !this.storiesOpen) {
    this.storiesOpen = open;
    if (open) this.toggleNotes(false);
  }

  /** Selected cards (or, with none, the current view) become stops of the shown story. */
  addStops() {
    if (!this.map) return;
    const ids = [...this.selection];
    this.mutate((m) => {
      const s = activeStory(m);
      if (ids.length) for (const ref of ids) s.steps.push({ id: uid('t'), kind: 'card', ref });
      else s.steps.push({ id: uid('t'), kind: 'view', cam: { ...this.cam } });
    });
  }

  removeStep(id: string) {
    this.mutate((m) => {
      const s = activeStory(m);
      s.steps = s.steps.filter((x) => x.id !== id);
    });
  }

  moveStep(from: number, to: number) {
    this.mutate((m) => {
      const s = activeStory(m);
      const [x] = s.steps.splice(from, 1);
      s.steps.splice(Math.max(0, Math.min(to, s.steps.length)), 0, x);
    });
  }

  indent(i: number, by: number) {
    if (!this.map) return;
    const s = activeStory(this.map);
    const probe = s.steps.map((x) => ({ ...x }));
    if (indentStep(probe, i, by)) this.mutate((m) => indentStep(activeStory(m).steps, i, by));
  }

  newStory() {
    this.mutate((m) => {
      m.stories ??= [];
      const n = m.stories.length;
      const s = { id: uid('s'), title: `Story ${n + 1}`, color: STORY_COLORS[n % STORY_COLORS.length], steps: [] };
      m.stories.push(s);
      m.story = s.id;
    });
  }

  setStory(id: string) {
    this.mutate((m) => (m.story = id));
  }

  renameStory(title: string) {
    if (!title.trim()) return;
    this.mutate((m) => (activeStory(m).title = title.trim()));
  }

  deleteStory() {
    this.mutate((m) => {
      if (!m.stories || m.stories.length < 2) return;
      const s = activeStory(m);
      m.stories = m.stories.filter((x) => x.id !== s.id);
      m.story = m.stories[0].id;
    });
  }

  /** Play the shown story full screen, from stop `from`. */
  async present(from = 0) {
    const s = this.story;
    if (!this.map || !s || !liveSteps(this.map, s).length) return app.toast(t('board.story.empty'), true);
    this.presenting = { i: from };
    app.setPresenting(true);
    // The canvas grows to the whole screen: wait for its new size before flying.
    setTimeout(() => this.show(from), 250);
  }

  private show(i: number) {
    const m = this.map;
    const s = this.story;
    if (!m || !s || !this.presenting) return;
    const steps = liveSteps(m, s);
    const k = Math.max(0, Math.min(i, steps.length - 1));
    this.presenting = { i: k };
    const st = steps[k];
    this.selection.clear();
    if (st.kind === 'view' && st.cam) this.flyTo(st.cam, 700);
    else if (st.ref) this.flyTo(fitRect(worldRect(m, st.ref), this.vw, this.vh, 0.08), 700);
  }

  stepBy(by: number) {
    if (this.presenting) this.show(this.presenting.i + by);
  }

  goStep(i: number) {
    if (this.presenting) this.show(i);
  }

  endPresentation() {
    this.presenting = null;
    app.setPresenting(false);
  }

  // ---------------------------------------------------------------- notes & snippets thread

  toggleNotes(open = !this.notesOpen) {
    this.notesOpen = open;
    store.set('boardNotes', open);
    if (open) this.storiesOpen = false;
  }

  async loadNotes() {
    const root = this.root;
    if (!root) return void (this.notes = []);
    const n = await app.backend.loadNotes(root).catch(() => []);
    if (this.root === root) this.notes = n;
  }

  private saveNotes() {
    if (!this.root) return;
    void app.backend.saveNotes(this.root, $state.snapshot(this.notes) as NoteCard[]).catch((e) => app.toast(String(e), true));
  }

  /** Add to the thread of the project at `root` (this one, or another). */
  async addNote(note: Omit<NoteCard, 'id' | 'at'> & { id?: string }, root = this.root) {
    if (!root) return;
    const n: NoteCard = { ...note, id: note.id ?? uid('n'), at: Date.now() };
    if (root === this.root) {
      this.notes = [...this.notes, n];
      this.saveNotes();
    } else {
      const list = await app.backend.loadNotes(root).catch(() => []);
      await app.backend.saveNotes(root, [...list, n]);
    }
  }

  removeNote(id: string) {
    this.notes = this.notes.filter((n) => n.id !== id);
    this.saveNotes();
  }

  editNote(id: string, text: string) {
    this.notes = this.notes.map((n) => (n.id === id ? { ...n, text } : n));
    this.saveNotes();
  }

  /** Send a note to another project's thread. */
  async sendNote(id: string, root: string, name: string) {
    const n = this.notes.find((x) => x.id === id);
    if (!n || root === this.root) return;
    await this.addNote({ ...n, id: undefined }, root);
    this.removeNote(id);
    app.toast(t('board.notes.sent', { name }));
  }

  /** The card for a note, to place on the map at `at` (plane coordinates of `parent`). */
  noteCard(n: NoteCard) {
    return { kind: n.kind === 'snippet' ? ('snippet' as const) : undefined, title: n.title, text: n.text, refs: n.refs, color: n.color ?? null, w: n.w ?? 240, h: n.h ?? 140 };
  }

  /** A new card in a Kanban column, below everything on the map. */
  addToColumn(init: Partial<MapCard>, status: string, before: string | null = null) {
    let id = '';
    this.mutate((mm) => {
      const b = bounds(mm, mm.roots);
      const c = addCard(mm, null, { x: b ? b.x : 0, y: b ? b.y + b.h + 40 : 0 }, { ...init, status });
      id = c.id;
      const order = (mm.kanban ??= {}).order ?? [];
      const at = before ? order.indexOf(before) : -1;
      mm.kanban.order = at < 0 ? [...order, c.id] : [...order.slice(0, at), c.id, ...order.slice(at)];
    });
    return id;
  }

  /** A note from the thread into a Kanban column (it leaves the thread). */
  noteToColumn(n: NoteCard, status: string, fromThread = true) {
    this.addToColumn(this.noteCard(n), status);
    if (fromThread) this.removeNote(n.id);
  }

  /** Put a note in the middle of what the map shows, and take it out of the thread. */
  placeNote(id: string) {
    const n = this.notes.find((x) => x.id === id);
    if (!n || !this.map) return;
    const m = this.map;
    const ctx = contextCard(m, this.cam, this.vw, this.vh);
    const f = planeFrame(m, ctx);
    const k = f.k * this.cam.z;
    const c = toPlane(f, this.cam.x + this.vw / 2 / this.cam.z, this.cam.y + this.vh / 2 / this.cam.z);
    const init = this.noteCard(n);
    const w = init.w / k, h = init.h / k;
    let made = '';
    this.mutate((mm) => (made = addCard(mm, ctx, { x: c.x - w / 2, y: c.y - h / 2 }, { ...init, w, h }).id));
    this.removeNote(id);
    this.selection.clear();
    if (made) this.selection.add(made);
  }

  /** Selected map cards go back into the thread (cards holding others stay: empty them first). */
  toThread(ids: string[]) {
    if (!this.map) return;
    const m = this.map;
    const movable = ids.filter((id) => m.cards[id] && !m.cards[id].children.length && m.cards[id].kind !== 'stack');
    if (movable.length < ids.length) app.toast(t('board.notes.notContainers'), true);
    if (!movable.length) return;
    const notes = movable.map((id) => toNote(m.cards[id]));
    this.mutate((mm) => {
      deleteCards(mm, movable);
      tidyStacks(mm);
    });
    this.selection.clear();
    this.notes = [...this.notes, ...notes];
    this.saveNotes();
    this.toggleNotes(true);
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
    // Documents open in the web panel, next to the files or the map.
    void import('./web.svelte').then((m) => m.web.showDoc());
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
    // Web pages open in the web panel (loaded lazily to keep this module free of it).
    if (r.kind === 'url' && r.href) return (await import('./web.svelte')).web.go(r.href);
    if (!r.path || r.missing) return app.toast(t('board.notFound', { name: r.name ?? t('board.file') }), true);
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
    else await this.create(t('board.defaultTitle'));
    app.toast(t('board.deleted', { title }));
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
      app.toast(t('board.notSaved', { error: String(e) }), true);
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
