/**
 * Project maps: an infinite, zoomable surface of cards (iMapping-style).
 *
 * Coordinates: every card lives on the *plane* of its parent (the root plane
 * for top-level cards). A card's own plane starts below its title bar and is
 * scaled by `inner`, so children appear shrunk inside their parent and grow
 * as you zoom in. All functions here are pure apart from mutating the map
 * passed in, so they work on Svelte state proxies as well as plain objects.
 */

export const HEADER = 30;
export const PAD = 10;
export const DEFAULT_INNER = 0.25;
export const MIN_W = 90;
export const MIN_H = HEADER + 18;
export const DEFAULT_STATUSES = ['Offen', 'In Arbeit', 'Erledigt'];

export interface CardRef {
  kind: 'file' | 'url' | 'tiddler';
  /** Index id (files) — survives moves outside brausa. */
  id?: string;
  /** Last known path; refreshed from the index when the map opens. */
  path?: string;
  name?: string;
  ext?: string;
  dir?: boolean;
  /** Set at load time when the index no longer finds the file. */
  missing?: boolean;
  /** Snippet anchor: PDF page (1-based) and rectangles on it (0..1 of the page). */
  page?: number;
  rects?: { x: number; y: number; w: number; h: number }[];
  /** Snippet anchor for text documents (W3C text quote selector). */
  quote?: string;
  prefix?: string;
  suffix?: string;
  href?: string;
  title?: string;
}

export interface MapCard {
  id: string;
  /** Plain card (default), excerpt from a document, or a stack of excerpts. */
  kind?: 'snippet' | 'stack';
  title: string;
  /** Markdown (TiddlyWiki wikitext later, see PLAN-PROJEKTE.md). */
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color?: string | null;
  status?: string | null;
  /** The wiki bag the card is kept in (none: the map's own bag). */
  bag?: string | null;
  fields?: Record<string, string>;
  refs?: CardRef[];
  parent: string | null;
  /** Child ids, back to front. */
  children: string[];
  /** Scale of this card's plane relative to the card. */
  inner?: number;
}

export interface MapLink {
  id: string;
  from: string;
  to: string;
  label?: string;
  type?: string;
  directed: boolean;
}

export interface ProjectMap {
  v: 1;
  id: string;
  title: string;
  cards: Record<string, MapCard>;
  /** Top-level card ids, back to front. */
  roots: string[];
  links: MapLink[];
  /** Kanban columns for cards (`status`); see DEFAULT_STATUSES. */
  statuses?: string[];
  /** Last camera, restored when the map is opened again. */
  view?: Camera;
  updated?: string;
  /** Kanban settings, as in TiddlyVisuals' Kanban: per column look, card order, saved searches. */
  kanban?: KanbanSettings;
  /** Presentation paths, as in TiddlyVisuals' Pinboard (exported to the wiki as stories). */
  stories?: Story[];
  /** The story shown and played. */
  story?: string;
}

export interface KanbanSettings {
  /** By status: colour and how its cards look. */
  columns?: Record<string, { color?: string; view?: 'full' | 'fold' | 'compact' }>;
  /** Card ids in board order (cards not listed follow). */
  order?: string[];
  /** Saved searches. */
  searches?: string[];
  /** Swimlanes: one per card holding the cards on the map (true), or one per wiki bag ('bag'). */
  lanes?: boolean | 'bag';
  /** Cards on the map show their own colour, or the colour of their Kanban column. */
  cardColors?: 'own' | 'status';
}

/** Cards in Kanban order: as listed in `order`, the rest after them. */
export function kanbanOrder(m: ProjectMap, cards: MapCard[]): MapCard[] {
  const pos = new Map((m.kanban?.order ?? []).map((id, i) => [id, i]));
  return [...cards].sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
}

/** A stop of a story: a card, or a view of the map. `level` makes it a sub-point (outline). */
export interface Step {
  id: string;
  kind: 'card' | 'view';
  /** Card id (kind card). */
  ref?: string;
  /** Camera (kind view). */
  cam?: Camera;
  level?: number;
}

export interface Story {
  id: string;
  title: string;
  color?: string;
  steps: Step[];
}

export const MAX_LEVEL = 5;
/** Colours offered by the palette button: six hues in four shades, plus greys. */
export const PALETTE = [
  '#fecaca', '#fed7aa', '#fef08a', '#bbf7d0', '#bfdbfe', '#ddd6fe', '#fbcfe8',
  '#f87171', '#fb923c', '#facc15', '#4ade80', '#60a5fa', '#a78bfa', '#f472b6',
  '#ef4444', '#f59e0b', '#eab308', '#10b981', '#0090ff', '#8b5cf6', '#ec4899',
  '#b91c1c', '#c2410c', '#a16207', '#047857', '#1d4ed8', '#6d28d9', '#be185d',
  '#f1f5f9', '#cbd5e1', '#94a3b8', '#64748b', '#475569', '#1e293b', '#14b8a6'
];

/** Column colours before one is chosen: open, doing, done, then the palette. */
const STATUS_DEFAULTS = ['#64748b', '#f59e0b', '#10b981', '#0090ff', '#8b5cf6', '#ec4899', '#ef4444'];

export function columnColor(m: ProjectMap, status: string): string {
  const i = (m.statuses ?? DEFAULT_STATUSES).indexOf(status);
  return m.kanban?.columns?.[status]?.color ?? STATUS_DEFAULTS[(i < 0 ? 0 : i) % STATUS_DEFAULTS.length];
}

/** The colour a card shows on the map: its own, or its column's when the map says so. */
export function cardColor(m: ProjectMap, c: MapCard): string | null {
  if (m.kanban?.cardColors === 'status' && c.status) return columnColor(m, c.status);
  return c.color ?? null;
}

export const STORY_COLORS = ['#e0503f', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#1f2937'];

/** The story shown (created when the map has none). */
export function activeStory(m: ProjectMap): Story {
  m.stories ??= [];
  let s = m.stories.find((x) => x.id === m.story);
  if (!s) {
    s = m.stories[0] ?? { id: uid('s'), title: 'Story 1', color: STORY_COLORS[0], steps: [] };
    if (!m.stories.length) m.stories.push(s);
    m.story = s.id;
  }
  return s;
}

/** Indent (+1) or outdent (-1): at most one level below the step before, as in an outline. */
export function indentStep(steps: Step[], i: number, by: number): boolean {
  const s = steps[i];
  if (!s) return false;
  const before = i > 0 ? (steps[i - 1].level ?? 0) : -1;
  const level = Math.max(0, Math.min((s.level ?? 0) + by, before + 1, MAX_LEVEL));
  if (level === (s.level ?? 0)) return false;
  s.level = level;
  // Sub-points that now hang too deep move up with it.
  for (let j = i + 1; j < steps.length && (steps[j].level ?? 0) > level; j++) {
    steps[j].level = Math.min(steps[j].level ?? 0, (steps[j - 1].level ?? 0) + 1);
  }
  return true;
}

/** Stops whose card no longer exists drop out. */
export function liveSteps(m: ProjectMap, s: Story): Step[] {
  return s.steps.filter((x) => x.kind === 'view' || (x.ref && m.cards[x.ref]));
}

/** screen = (world - (x, y)) * z */
export interface Camera {
  x: number;
  y: number;
  z: number;
}

/** Maps plane coordinates to root-world coordinates: world = o + p * k. */
export interface Frame {
  ox: number;
  oy: number;
  k: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const IDENTITY: Frame = { ox: 0, oy: 0, k: 1 };

/** A card in a project's notes & snippets thread (not placed on a map). */
export interface NoteCard {
  id: string;
  kind?: 'snippet' | 'note';
  title: string;
  text: string;
  refs?: CardRef[];
  color?: string | null;
  w?: number;
  h?: number;
  /** ms: when it came into the thread */
  at: number;
}

/** A map card as it goes into the thread (its children stay on the map). */
export function toNote(c: MapCard): NoteCard {
  return { id: c.id, kind: c.kind === 'snippet' ? 'snippet' : 'note', title: c.title, text: c.text, refs: c.refs, color: c.color ?? null, w: c.w, h: c.h, at: Date.now() };
}

export function uid(prefix: string): string {
  return prefix + '_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

export function newMap(title: string, id = uid('m')): ProjectMap {
  return { v: 1, id, title, cards: {}, roots: [], links: [] };
}

/** Repairs maps written by older or foreign tools (missing arrays, dangling ids). */
export function normalizeMap(raw: Partial<ProjectMap> & { id: string }): ProjectMap {
  const m: ProjectMap = { ...newMap(raw.title ?? 'Map', raw.id), ...raw, v: 1 };
  m.cards ??= {};
  m.links = (m.links ?? []).filter((l) => m.cards[l.from] && m.cards[l.to]);
  for (const c of Object.values(m.cards)) {
    c.text ??= '';
    if (c.parent && !m.cards[c.parent]) c.parent = null;
  }
  // A card inside itself (A in B, B in A) would make every walk up the parents endless.
  for (const c of Object.values(m.cards)) {
    const seen = new Set<string>([c.id]);
    for (let p = c.parent; p; p = m.cards[p].parent) {
      if (seen.has(p)) {
        c.parent = null;
        break;
      }
      seen.add(p);
    }
  }
  for (const c of Object.values(m.cards)) {
    c.children = [...new Set(c.children ?? [])].filter((id) => m.cards[id]?.parent === c.id);
  }
  const roots = new Set((m.roots ?? []).filter((id) => m.cards[id] && !m.cards[id].parent));
  for (const c of Object.values(m.cards)) {
    if (!c.parent) roots.add(c.id);
    else if (!m.cards[c.parent].children.includes(c.id)) m.cards[c.parent].children.push(c.id);
  }
  m.roots = [...roots];
  return m;
}

export const innerOf = (c: MapCard) => c.inner ?? DEFAULT_INNER;

export function siblings(m: ProjectMap, parent: string | null): string[] {
  return parent ? m.cards[parent].children : m.roots;
}

/** Ancestors from the top-level card down to the direct parent. */
export function ancestors(m: ProjectMap, id: string): string[] {
  const out: string[] = [];
  for (let p = m.cards[id]?.parent; p; p = m.cards[p]?.parent) out.unshift(p);
  return out;
}

export function isInside(m: ProjectMap, id: string, container: string): boolean {
  for (let p: string | null = id; p; p = m.cards[p]?.parent ?? null) if (p === container) return true;
  return false;
}

/** Frame of the plane that holds the children of `parent` (null = root plane). */
export function planeFrame(m: ProjectMap, parent: string | null): Frame {
  if (!parent) return IDENTITY;
  const c = m.cards[parent];
  const f = planeFrame(m, c.parent);
  return { ox: f.ox + (c.x + PAD) * f.k, oy: f.oy + (c.y + HEADER) * f.k, k: f.k * innerOf(c) };
}

export function applyFrame(f: Frame, r: Rect): Rect {
  return { x: f.ox + r.x * f.k, y: f.oy + r.y * f.k, w: r.w * f.k, h: r.h * f.k };
}

export function worldRect(m: ProjectMap, id: string): Rect {
  const c = m.cards[id];
  return applyFrame(planeFrame(m, c.parent), c);
}

export function toPlane(f: Frame, wx: number, wy: number): { x: number; y: number } {
  return { x: (wx - f.ox) / f.k, y: (wy - f.oy) / f.k };
}

export function toScreen(cam: Camera, f: Frame): Frame {
  return { ox: (f.ox - cam.x) * cam.z, oy: (f.oy - cam.y) * cam.z, k: f.k * cam.z };
}

export function screenToWorld(cam: Camera, sx: number, sy: number) {
  return { x: cam.x + sx / cam.z, y: cam.y + sy / cam.z };
}

/** Zoom by `factor` keeping the screen point (sx, sy) fixed. */
export function zoomAt(cam: Camera, sx: number, sy: number, factor: number, min = 1e-3, max = 1e9): Camera {
  const z = Math.min(max, Math.max(min, cam.z * factor));
  const w = screenToWorld(cam, sx, sy);
  return { x: w.x - sx / z, y: w.y - sy / z, z };
}

/** Camera that shows `r` (world) centred in a viewport of vw × vh with a margin. */
export function fitRect(r: Rect, vw: number, vh: number, margin = 0.08): Camera {
  const z = Math.min((vw * (1 - 2 * margin)) / Math.max(r.w, 1e-9), (vh * (1 - 2 * margin)) / Math.max(r.h, 1e-9));
  return { x: r.x + r.w / 2 - vw / 2 / z, y: r.y + r.h / 2 - vh / 2 / z, z };
}

/** Bounding box of the given plane's cards (in plane coordinates). */
export function bounds(m: ProjectMap, ids: string[]): Rect | null {
  if (!ids.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const id of ids) {
    const c = m.cards[id];
    x0 = Math.min(x0, c.x);
    y0 = Math.min(y0, c.y);
    x1 = Math.max(x1, c.x + c.w);
    y1 = Math.max(y1, c.y + c.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The rectangle (world) of a card's inner plane — what "flying into" a card shows. */
export function contentRect(m: ProjectMap, id: string): Rect {
  const r = worldRect(m, id);
  const f = planeFrame(m, m.cards[id].parent).k;
  return { x: r.x + PAD * f, y: r.y + HEADER * f, w: r.w - 2 * PAD * f, h: r.h - (HEADER + PAD) * f };
}

/** The deepest card whose screen rectangle passes `test`, descending through the planes. */
function deepest(m: ProjectMap, cam: Camera, test: (r: Rect) => boolean): string | null {
  let found: string | null = null;
  let plane = m.roots;
  let f = IDENTITY;
  for (;;) {
    const s = toScreen(cam, f);
    const hit = [...plane].reverse().find((id) => {
      const c = m.cards[id];
      return test({ x: s.ox + c.x * s.k, y: s.oy + c.y * s.k, w: c.w * s.k, h: c.h * s.k });
    });
    if (!hit) return found;
    found = hit;
    const c = m.cards[hit];
    f = { ox: f.ox + (c.x + PAD) * f.k, oy: f.oy + (c.y + HEADER) * f.k, k: f.k * innerOf(c) };
    plane = c.children;
  }
}

/**
 * The deepest card that covers the whole viewport. Rendering starts there, so
 * deep zoom levels never hand huge numbers to CSS.
 */
export function contextCard(m: ProjectMap, cam: Camera, vw: number, vh: number): string | null {
  return deepest(m, cam, (r) => r.x <= 0 && r.y <= 0 && r.x + r.w >= vw && r.y + r.h >= vh);
}

/**
 * The card you are "in": the deepest one that holds the centre of the view and
 * fills at least half of it. Drives the breadcrumb, Esc and new cards.
 */
export function focusCard(m: ProjectMap, cam: Camera, vw: number, vh: number): string | null {
  return deepest(m, cam, (r) => {
    if (r.x > vw / 2 || r.y > vh / 2 || r.x + r.w < vw / 2 || r.y + r.h < vh / 2) return false;
    const ix = Math.min(vw, r.x + r.w) - Math.max(0, r.x), iy = Math.min(vh, r.y + r.h) - Math.max(0, r.y);
    return ix * iy >= 0.5 * vw * vh;
  });
}

// ---------------------------------------------------------------- mutations

export function addCard(m: ProjectMap, parent: string | null, at: { x: number; y: number }, init: Partial<MapCard> = {}): MapCard {
  const c: MapCard = { id: uid('c'), title: '', text: '', w: 220, h: 140, ...init, x: at.x, y: at.y, parent, children: [] };
  m.cards[c.id] = c;
  siblings(m, parent).push(c.id);
  if (parent) growToFit(m, parent);
  return c;
}

export function bringToFront(m: ProjectMap, id: string) {
  const list = siblings(m, m.cards[id].parent);
  const i = list.indexOf(id);
  if (i >= 0 && i < list.length - 1) {
    list.splice(i, 1);
    list.push(id);
  }
}

/** Grow a card (and its ancestors) until all children fit on its plane. */
export function growToFit(m: ProjectMap, id: string) {
  const c = m.cards[id];
  let b = bounds(m, c.children);
  if (!b) return;
  // Children never sit above or left of the plane origin.
  if (b.x < 0 || b.y < 0) {
    const dx = Math.max(0, -b.x), dy = Math.max(0, -b.y);
    for (const k of c.children) {
      m.cards[k].x += dx;
      m.cards[k].y += dy;
    }
    b = bounds(m, c.children)!;
  }
  const s = innerOf(c);
  const needW = (b.x + b.w) * s + 2 * PAD, needH = (b.y + b.h) * s + HEADER + PAD;
  let grew = false;
  if (needW > c.w) (c.w = needW), (grew = true);
  if (needH > c.h) (c.h = needH), (grew = true);
  if (grew && c.parent) growToFit(m, c.parent);
}

/**
 * Move a card to another plane, keeping its world position under the pointer.
 * Its size stays the same in plane units, so it shrinks into containers and
 * grows when taken out — like putting a sheet into a folder.
 */
export function reparent(m: ProjectMap, id: string, parent: string | null, worldTopLeft: { x: number; y: number }): boolean {
  const c = m.cards[id];
  if (parent === c.parent) return false;
  if (parent && isInside(m, parent, id)) return false;
  const from = siblings(m, c.parent);
  from.splice(from.indexOf(id), 1);
  const p = toPlane(planeFrame(m, parent), worldTopLeft.x, worldTopLeft.y);
  c.x = parent ? Math.max(0, p.x) : p.x;
  c.y = parent ? Math.max(0, p.y) : p.y;
  c.parent = parent;
  siblings(m, parent).push(id);
  if (parent) growToFit(m, parent);
  return true;
}

export function deleteCards(m: ProjectMap, ids: string[]) {
  const gone = new Set<string>();
  const collect = (id: string) => {
    if (gone.has(id) || !m.cards[id]) return;
    gone.add(id);
    m.cards[id].children.forEach(collect);
  };
  ids.forEach(collect);
  for (const id of gone) {
    const c = m.cards[id];
    if (!gone.has(c.parent ?? '')) {
      const list = siblings(m, c.parent);
      list.splice(list.indexOf(id), 1);
    }
  }
  for (const id of gone) delete m.cards[id];
  m.links = m.links.filter((l) => !gone.has(l.from) && !gone.has(l.to));
}

export function addLink(m: ProjectMap, from: string, to: string, directed = true): MapLink | null {
  if (from === to || !m.cards[from] || !m.cards[to]) return null;
  if (m.links.some((l) => (l.from === from && l.to === to) || (l.from === to && l.to === from))) return null;
  const l: MapLink = { id: uid('l'), from, to, directed };
  m.links.push(l);
  return l;
}

/** Point where the ray from the centre of `r` towards (px, py) leaves the rectangle. */
export function edgePoint(r: Rect, px: number, py: number): { x: number; y: number } {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const dx = px - cx, dy = py - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const t = Math.min(dx ? r.w / 2 / Math.abs(dx) : Infinity, dy ? r.h / 2 / Math.abs(dy) : Infinity);
  return { x: cx + dx * Math.min(t, 1), y: cy + dy * Math.min(t, 1) };
}

// ---------------------------------------------------------------- stacks

export const STACK_GAP = 6;

/** Snippets (and plain cards) can be joined into a vertical stack, like in LiquidText. */
export function stackOf(m: ProjectMap, id: string): string | null {
  const p = m.cards[id]?.parent;
  return p && m.cards[p].kind === 'stack' ? p : null;
}

/** Put `id` above or below `target`; creates a stack where `target` is if needed. */
export function stackInsert(m: ProjectMap, id: string, target: string, where: 'before' | 'after') {
  if (id === target || isInside(m, target, id)) return;
  let stack = stackOf(m, target);
  if (!stack) {
    const t = m.cards[target];
    const s = addCard(m, t.parent, { x: t.x, y: t.y }, { kind: 'stack', title: '', inner: 1, w: t.w, h: t.h });
    stack = s.id;
    moveInto(m, target, stack, 0);
  }
  const list = m.cards[stack].children;
  const from = stackOf(m, id);
  if (from === stack) list.splice(list.indexOf(id), 1);
  const at = list.indexOf(target) + (where === 'after' ? 1 : 0);
  if (from === stack) list.splice(at, 0, id);
  else moveInto(m, id, stack, at);
  tidyStacks(m);
}

function moveInto(m: ProjectMap, id: string, parent: string, index: number) {
  const c = m.cards[id];
  const old = siblings(m, c.parent);
  old.splice(old.indexOf(id), 1);
  c.parent = parent;
  m.cards[parent].children.splice(index, 0, id);
}

/** Lay out every stack (children top to bottom) and dissolve stacks with fewer than two cards. */
export function tidyStacks(m: ProjectMap) {
  for (const s of Object.values(m.cards).filter((c) => c.kind === 'stack')) {
    if (s.children.length < 2) {
      // A stack of one is just a card again.
      for (const id of s.children) {
        const c = m.cards[id];
        c.parent = s.parent;
        c.x = s.x;
        c.y = s.y;
        siblings(m, s.parent).push(id);
      }
      const list = siblings(m, s.parent);
      list.splice(list.indexOf(s.id), 1);
      m.links = m.links.filter((l) => l.from !== s.id && l.to !== s.id);
      delete m.cards[s.id];
      continue;
    }
    let y = 0;
    let w = 0;
    for (const id of s.children) {
      const c = m.cards[id];
      c.x = 0;
      c.y = y;
      y += c.h + STACK_GAP;
      w = Math.max(w, c.w);
    }
    s.inner = 1;
    s.w = w + 2 * PAD;
    s.h = HEADER + y - STACK_GAP + PAD;
    if (s.parent) growToFit(m, s.parent);
  }
}
