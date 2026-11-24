/**
 * Leinwand ("canvas"): folders as windows on a zoomable surface. A folder row
 * opened in a window becomes a child window, joined to that row by a line.
 *
 * This file is pure: the tree of open windows, the three layouts and the
 * anchor points of the connecting lines. Leinwand.svelte draws them.
 */

export type LeinwandLayout = 'right' | 'down' | 'star';
export const LAYOUTS: LeinwandLayout[] = ['right', 'down', 'star'];

/** Geometry of a window, in canvas units (zoom 1). */
export const WIN = {
  w: 480,
  header: 32,
  cols: 22,
  row: 26,
  maxRows: 16,
  gapX: 90,
  gapY: 28
};

/** An open window: a folder and the window (folder) it was opened from. */
export interface OpenWin {
  path: string;
  parent: string | null;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Height of a window that lists `rows` entries (at most WIN.maxRows visible, then it scrolls). */
export function winHeight(rows: number): number {
  return WIN.header + WIN.cols + Math.max(1, Math.min(rows, WIN.maxRows)) * WIN.row + 6;
}

/** Children of each window, in the order their rows appear in the parent (`rowOf`). */
function childrenOf(wins: OpenWin[], rowOf: (w: OpenWin) => number): Map<string | null, OpenWin[]> {
  const known = new Set(wins.map((w) => w.path));
  const kids = new Map<string | null, OpenWin[]>();
  for (const w of wins) {
    const p = w.parent !== null && known.has(w.parent) ? w.parent : null;
    kids.set(p, [...(kids.get(p) ?? []), w]);
  }
  for (const list of kids.values()) list.sort((a, b) => rowOf(a) - rowOf(b));
  return kids;
}

/**
 * Positions of all windows (top left corner). The root sits at 0,0 ("right",
 * "down") or is centred on 0,0 ("star").
 * - right: depth goes to the right, siblings stack below each other (deep paths)
 * - down: depth goes down, siblings sit side by side (wide fan-out)
 * - star: the root in the middle, each level on a ring around it
 */
export function layout(
  wins: OpenWin[],
  mode: LeinwandLayout,
  size: (path: string) => { w: number; h: number },
  rowOf: (w: OpenWin) => number = () => 0
): Map<string, Point> {
  const kids = childrenOf(wins, rowOf);
  const roots = kids.get(null) ?? [];
  const out = new Map<string, Point>();
  if (!roots.length) return out;

  if (mode === 'star') {
    // Leaves decide how much of the circle a branch gets.
    const leaves = new Map<string, number>();
    const countLeaves = (w: OpenWin): number => {
      const k = kids.get(w.path) ?? [];
      const n = k.length ? k.reduce((s, c) => s + countLeaves(c), 0) : 1;
      leaves.set(w.path, n);
      return n;
    };
    roots.forEach(countLeaves);
    const diag = (p: string) => {
      const s = size(p);
      return Math.hypot(s.w, s.h) / 2;
    };
    // Radius per depth: far enough that neighbouring levels do not touch.
    const depthMax: number[] = [];
    const walk = (w: OpenWin, d: number) => {
      depthMax[d] = Math.max(depthMax[d] ?? 0, diag(w.path));
      for (const c of kids.get(w.path) ?? []) walk(c, d + 1);
    };
    roots.forEach((r) => walk(r, 0));
    const radius: number[] = [0];
    for (let d = 1; d < depthMax.length; d++) radius[d] = radius[d - 1] + depthMax[d - 1] + depthMax[d] + WIN.gapX * 0.6;
    // Enough room on each ring for its windows side by side.
    for (let d = 1; d < depthMax.length; d++) {
      const onRing = wins.filter((w) => depthOf(w, wins) === d).length;
      const need = (onRing * (depthMax[d] * 2 + WIN.gapY)) / (2 * Math.PI);
      if (radius[d] < need) {
        const add = need - radius[d];
        for (let e = d; e < radius.length; e++) radius[e] += add;
      }
    }
    const place = (w: OpenWin, d: number, a0: number, a1: number) => {
      const s = size(w.path);
      const a = (a0 + a1) / 2;
      const r = radius[d] ?? 0;
      out.set(w.path, {
        x: Math.cos(a) * r - s.w / 2,
        y: Math.sin(a) * r - s.h / 2
      });
      const k = kids.get(w.path) ?? [];
      const total = leaves.get(w.path) ?? 1;
      let at = a0;
      for (const c of k) {
        const span = ((a1 - a0) * (leaves.get(c.path) ?? 1)) / total;
        place(c, d + 1, at, at + span);
        at += span;
      }
    };
    const total = roots.reduce((s, r) => s + (leaves.get(r.path) ?? 1), 0);
    let at = -Math.PI;
    for (const r of roots) {
      const span = (2 * Math.PI * (leaves.get(r.path) ?? 1)) / total;
      place(r, 0, at, at + span);
      at += span;
    }
    return out;
  }

  // Tidy tree. "main" is the axis of depth, "cross" the axis siblings stack on.
  const right = mode === 'right';
  const mainOf = (p: string) => (right ? size(p).w : size(p).h);
  const crossOf = (p: string) => (right ? size(p).h : size(p).w);
  const gapMain = right ? WIN.gapX : WIN.gapX * 0.6;
  const gapCross = right ? WIN.gapY : WIN.gapY * 1.5;

  const depthSize: number[] = [];
  const measure = (w: OpenWin, d: number) => {
    depthSize[d] = Math.max(depthSize[d] ?? 0, mainOf(w.path));
    for (const c of kids.get(w.path) ?? []) measure(c, d + 1);
  };
  roots.forEach((r) => measure(r, 0));
  const mainAt: number[] = [0];
  for (let d = 1; d < depthSize.length; d++) mainAt[d] = mainAt[d - 1] + depthSize[d - 1] + gapMain;

  const span = new Map<string, number>();
  const measureSpan = (w: OpenWin): number => {
    const k = kids.get(w.path) ?? [];
    const kidsSpan = k.reduce((s, c) => s + measureSpan(c), 0) + Math.max(0, k.length - 1) * gapCross;
    const s = Math.max(crossOf(w.path), kidsSpan);
    span.set(w.path, s);
    return s;
  };
  const place = (w: OpenWin, d: number, start: number) => {
    // A parent sits at the start of its branch, so the lines to its first children stay short.
    out.set(w.path, right ? { x: mainAt[d], y: start } : { x: start, y: mainAt[d] });
    let at = start;
    for (const c of kids.get(w.path) ?? []) {
      place(c, d + 1, at);
      at += (span.get(c.path) ?? 0) + gapCross;
    }
  };
  let at = 0;
  for (const r of roots) {
    measureSpan(r);
    place(r, 0, at);
    at += (span.get(r.path) ?? 0) + gapCross * 2;
  }
  return out;
}

function depthOf(w: OpenWin, wins: OpenWin[]): number {
  const byPath = new Map(wins.map((x) => [x.path, x]));
  let d = 0;
  let p = w.parent;
  const seen = new Set<string>();
  while (p !== null && byPath.has(p) && !seen.has(p)) {
    seen.add(p);
    d++;
    p = byPath.get(p)!.parent;
  }
  return d;
}

/**
 * The line from a folder row in its window to the child window. `row` is the
 * row's index, `scroll` how far the parent's list is scrolled (px). A row
 * scrolled out of sight anchors at the window's top or bottom edge.
 */
export function edge(parent: Box, row: number, scroll: number, child: Box): { from: Point; to: Point; c1: Point; c2: Point } {
  const listTop = parent.y + WIN.header + WIN.cols;
  const listBottom = parent.y + parent.h - 6;
  const y = Math.min(Math.max(listTop + row * WIN.row - scroll + WIN.row / 2, listTop), listBottom);
  const childCx = child.x + child.w / 2;
  const parentCx = parent.x + parent.w / 2;
  const toRight = childCx >= parentCx;
  const from = { x: toRight ? parent.x + parent.w : parent.x, y };
  // Into the side of the child that faces the row, at the height of its title.
  const below = child.y > parent.y + parent.h;
  const above = child.y + child.h < parent.y;
  const sideways = child.x >= parent.x + parent.w || child.x + child.w <= parent.x;
  let to: Point;
  if (sideways || (!below && !above))
    to = {
      x: toRight ? child.x : child.x + child.w,
      y: child.y + WIN.header / 2
    };
  // Above or below: into the top (bottom) edge, on the side the line leaves from, so it runs past the parent, not behind it.
  else
    to = {
      x: Math.min(Math.max(from.x, child.x + 30), child.x + child.w - 30),
      y: below ? child.y : child.y + child.h
    };
  const dx = Math.max(40, Math.abs(to.x - from.x) / 2);
  const c1 = { x: from.x + (toRight ? dx : -dx), y: from.y };
  const dy = Math.max(40, Math.abs(to.y - from.y) / 2);
  const c2 = sideways || (!below && !above) ? { x: to.x + (toRight ? -dx : dx), y: to.y } : { x: to.x, y: to.y + (below ? -dy : dy) };
  return { from, to, c1, c2 };
}

/** Open or close the window of a folder row. Closing also closes every window opened from it. */
export function toggleWin(wins: OpenWin[], path: string, parent: string): OpenWin[] {
  if (wins.some((w) => w.path === path)) return closeWin(wins, path);
  return [...wins, { path, parent }];
}

export function closeWin(wins: OpenWin[], path: string): OpenWin[] {
  const gone = new Set([path]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const w of wins)
      if (w.parent !== null && gone.has(w.parent) && !gone.has(w.path)) {
        gone.add(w.path);
        grew = true;
      }
  }
  return wins.filter((w) => !gone.has(w.path));
}

/** Zoom by `factor` around a screen point, keeping that point still. */
export function zoomAt(view: { x: number; y: number; z: number }, px: number, py: number, factor: number, min = 0.1, max = 2.5) {
  const z = Math.min(max, Math.max(min, view.z * factor));
  const k = z / view.z;
  return { x: px - (px - view.x) * k, y: py - (py - view.y) * k, z };
}

/** View (pan and zoom) that fits all boxes into a viewport of `vw`×`vh`. */
export function fit(boxes: Box[], vw: number, vh: number, pad = 40, max = 1): { x: number; y: number; z: number } {
  if (!boxes.length) return { x: pad, y: pad, z: 1 };
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  const z = Math.max(0.1, Math.min(max, (vw - 2 * pad) / (x1 - x0 || 1), (vh - 2 * pad) / (y1 - y0 || 1)));
  return {
    x: (vw - (x1 - x0) * z) / 2 - x0 * z,
    y: (vh - (y1 - y0) * z) / 2 - y0 * z,
    z
  };
}
