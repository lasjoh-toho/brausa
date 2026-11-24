import { describe, expect, it } from 'vitest';
import { closeWin, edge, fit, layout, toggleWin, winHeight, zoomAt, WIN, type Box, type OpenWin } from './leinwand';

const wins: OpenWin[] = [
  { path: '/a', parent: null },
  { path: '/a/x', parent: '/a' },
  { path: '/a/y', parent: '/a' },
  { path: '/a/x/deep', parent: '/a/x' }
];
const size = () => ({ w: 400, h: 200 });
const rows: Record<string, number> = { '/a/x': 0, '/a/y': 3, '/a/x/deep': 1 };
const rowOf = (w: OpenWin) => rows[w.path] ?? 0;

function boxes(pos: Map<string, { x: number; y: number }>): Box[] {
  return [...pos.values()].map((p) => ({ ...p, ...size() }));
}

function overlaps(bs: Box[]) {
  for (let i = 0; i < bs.length; i++)
    for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i];
      const b = bs[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) return true;
    }
  return false;
}

describe('leinwand layout', () => {
  it('right: depth goes right, siblings stack in row order', () => {
    const p = layout(wins, 'right', size, rowOf);
    expect(p.get('/a')).toEqual({ x: 0, y: 0 });
    expect(p.get('/a/x')!.x).toBeGreaterThan(400);
    expect(p.get('/a/x/deep')!.x).toBeGreaterThan(p.get('/a/x')!.x + 400);
    expect(p.get('/a/y')!.y).toBeGreaterThan(p.get('/a/x')!.y);
    expect(overlaps(boxes(p))).toBe(false);
  });

  it('down: depth goes down, siblings side by side', () => {
    const p = layout(wins, 'down', size, rowOf);
    expect(p.get('/a/x')!.y).toBeGreaterThan(200);
    expect(p.get('/a/y')!.x).toBeGreaterThan(p.get('/a/x')!.x);
    expect(p.get('/a/y')!.y).toBe(p.get('/a/x')!.y);
    expect(overlaps(boxes(p))).toBe(false);
  });

  it('star: root in the middle, children around it without overlap', () => {
    const many: OpenWin[] = [
      { path: '/r', parent: null },
      ...Array.from({ length: 9 }, (_, i) => ({
        path: `/r/${i}`,
        parent: '/r'
      }))
    ];
    const p = layout(many, 'star', size);
    expect(p.get('/r')).toEqual({ x: -200, y: -100 });
    expect(overlaps(boxes(p))).toBe(false);
  });

  it('a window whose parent is not open counts as a root', () => {
    const p = layout([{ path: '/b', parent: '/gone' }], 'right', size);
    expect(p.get('/b')).toEqual({ x: 0, y: 0 });
  });
});

describe('leinwand windows', () => {
  it('toggles a folder window and closes its descendants with it', () => {
    let w = toggleWin([{ path: '/a', parent: null }], '/a/x', '/a');
    w = toggleWin(w, '/a/x/deep', '/a/x');
    expect(w.map((x) => x.path)).toEqual(['/a', '/a/x', '/a/x/deep']);
    expect(toggleWin(w, '/a/x', '/a').map((x) => x.path)).toEqual(['/a']);
    expect(closeWin(w, '/a/x/deep').map((x) => x.path)).toEqual(['/a', '/a/x']);
  });

  it('window height follows the rows up to a maximum', () => {
    expect(winHeight(0)).toBe(winHeight(1));
    expect(winHeight(100)).toBe(winHeight(WIN.maxRows));
    expect(winHeight(3)).toBeLessThan(winHeight(4));
  });
});

describe('leinwand lines and view', () => {
  const parent = { x: 0, y: 0, w: 400, h: 300 };
  it('starts at the row and ends at the child title', () => {
    const e = edge(parent, 2, 0, { x: 500, y: 100, w: 400, h: 200 });
    expect(e.from).toEqual({
      x: 400,
      y: WIN.header + WIN.cols + 2.5 * WIN.row
    });
    expect(e.to).toEqual({ x: 500, y: 100 + WIN.header / 2 });
  });

  it('a row scrolled away anchors at the window edge', () => {
    expect(edge(parent, 40, 0, { x: 500, y: 0, w: 1, h: 1 }).from.y).toBe(300 - 6);
    expect(edge(parent, 0, 200, { x: 500, y: 0, w: 1, h: 1 }).from.y).toBe(WIN.header + WIN.cols);
  });

  it('a child below gets the line from above', () => {
    const e = edge(parent, 0, 0, { x: 0, y: 400, w: 400, h: 200 });
    expect(e.to).toEqual({ x: 370, y: 400 });
  });

  it('zooms around the pointer', () => {
    const v = zoomAt({ x: 0, y: 0, z: 1 }, 100, 100, 2);
    expect(v).toEqual({ x: -100, y: -100, z: 2 });
    expect(zoomAt({ x: 0, y: 0, z: 1 }, 0, 0, 100).z).toBe(2.5);
  });

  it('fits everything into the viewport', () => {
    const v = fit([{ x: 0, y: 0, w: 1000, h: 500 }], 540, 290, 20);
    expect(v.z).toBeCloseTo(0.5);
    expect(v.x).toBeCloseTo(20);
    expect(v.y).toBeCloseTo(20);
  });
});
