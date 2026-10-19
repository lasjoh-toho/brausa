import { describe, expect, it } from 'vitest';
import {
  HEADER,
  PAD,
  addCard,
  addLink,
  contextCard,
  deleteCards,
  edgePoint,
  fitRect,
  focusCard,
  contentRect,
  newMap,
  normalizeMap,
  ancestors,
  reparent,
  stackInsert,
  tidyStacks,
  STACK_GAP,
  worldRect,
  zoomAt
} from './map';
import { renderMarkdown } from './markdown';
import { locateQuote } from './snippets';
import { changedFields, lineDiff } from './diff';

function sample() {
  const m = newMap('Test', 'm_t');
  const a = addCard(m, null, { x: 0, y: 0 }, { w: 400, h: 300, inner: 0.5 });
  const b = addCard(m, a.id, { x: 20, y: 20 }, { w: 100, h: 80 });
  const c = addCard(m, null, { x: 600, y: 0 });
  return { m, a, b, c };
}

describe('map geometry', () => {
  it('places children on the scaled plane below the title bar', () => {
    const { m, b } = sample();
    expect(worldRect(m, b.id)).toEqual({ x: PAD + 10, y: HEADER + 10, w: 50, h: 40 });
  });

  it('zooms around the pointer', () => {
    const cam = zoomAt({ x: 0, y: 0, z: 1 }, 100, 50, 2);
    expect(cam).toEqual({ x: 50, y: 25, z: 2 });
  });

  it('finds the deepest card covering the viewport', () => {
    const { m, a, b } = sample();
    expect(contextCard(m, { x: -10, y: -10, z: 1 }, 800, 600)).toBeNull();
    const ra = worldRect(m, a.id);
    expect(contextCard(m, { x: ra.x + 1, y: ra.y + 1, z: 4 }, 300, 200)).toBe(a.id);
    const rb = worldRect(m, b.id);
    expect(contextCard(m, { x: rb.x + 1, y: rb.y + 1, z: 40 }, 300, 200)).toBe(b.id);
  });

  it('treats a card you flew into as the focus even with margins around it', () => {
    const { m, a } = sample();
    const cam = fitRect(contentRect(m, a.id), 1200, 600, 0.06);
    expect(contextCard(m, cam, 1200, 600)).toBeNull();
    expect(focusCard(m, cam, 1200, 600)).toBe(a.id);
  });

  it('fits a rectangle into the viewport', () => {
    const cam = fitRect({ x: 0, y: 0, w: 100, h: 50 }, 1000, 1000, 0);
    expect(cam.z).toBe(10);
    expect(cam.x).toBe(0);
  });

  it('clips link endpoints to the card border', () => {
    expect(edgePoint({ x: 0, y: 0, w: 100, h: 50 }, 300, 25)).toEqual({ x: 100, y: 25 });
  });
});

describe('map mutations', () => {
  it('moves a card into another card and back, keeping its world position', () => {
    const { m, a, c } = sample();
    const before = worldRect(m, c.id);
    // Drop c inside a at world position (100, 100).
    expect(reparent(m, c.id, a.id, { x: 100, y: 100 })).toBe(true);
    expect(m.roots).not.toContain(c.id);
    expect(a.children).toContain(c.id);
    const inside = worldRect(m, c.id);
    expect(inside.x).toBeCloseTo(100);
    expect(inside.w).toBeCloseTo(before.w / 2); // shrinks into the container
    expect(a.w).toBeGreaterThanOrEqual(inside.x + inside.w - worldRect(m, a.id).x); // parent grew to fit
    reparent(m, c.id, null, { x: 700, y: 0 });
    expect(m.roots).toContain(c.id);
    expect(worldRect(m, c.id).w).toBe(before.w);
  });

  it('refuses to put a card into its own descendant', () => {
    const { m, a, b } = sample();
    expect(reparent(m, a.id, b.id, { x: 0, y: 0 })).toBe(false);
  });

  it('deletes whole subtrees with their links', () => {
    const { m, a, b, c } = sample();
    addLink(m, b.id, c.id);
    deleteCards(m, [a.id]);
    expect(Object.keys(m.cards)).toEqual([c.id]);
    expect(m.links).toEqual([]);
  });

  it('does not duplicate links or link a card to itself', () => {
    const { m, a, c } = sample();
    expect(addLink(m, a.id, c.id)).not.toBeNull();
    expect(addLink(m, c.id, a.id)).toBeNull();
    expect(addLink(m, a.id, a.id)).toBeNull();
  });

  it('repairs inconsistent files', () => {
    const m = normalizeMap({
      id: 'm_x',
      title: 'x',
      cards: {
        a: { id: 'a', title: '', text: '', x: 0, y: 0, w: 1, h: 1, parent: 'gone', children: ['nope'] },
        b: { id: 'b', title: '', text: '', x: 0, y: 0, w: 1, h: 1, parent: 'a', children: [] }
      },
      links: [{ id: 'l', from: 'a', to: 'zzz', directed: true }]
    } as never);
    expect(m.roots).toEqual(['a']);
    expect(m.cards.a.children).toEqual(['b']);
    expect(m.links).toEqual([]);
  });

  it('breaks cards nested in themselves', () => {
    const card = (id: string, parent: string) => ({ id, title: '', text: '', x: 0, y: 0, w: 1, h: 1, parent, children: [] });
    const m = normalizeMap({ id: 'm_c', title: 'c', cards: { a: card('a', 'b'), b: card('b', 'a'), c: card('c', 'a') } } as never);
    expect(m.roots.length).toBeGreaterThan(0);
    for (const id of Object.keys(m.cards)) expect(ancestors(m, id).length).toBeLessThan(3);
  });
});

describe('stacks', () => {
  it('joins snippets into a stack, keeps order and dissolves single-card stacks', () => {
    const m = newMap('S', 'm_s');
    const a = addCard(m, null, { x: 100, y: 50 }, { kind: 'snippet', h: 60 });
    const b = addCard(m, null, { x: 500, y: 0 }, { kind: 'snippet', h: 80 });
    const c = addCard(m, null, { x: 900, y: 0 }, { kind: 'snippet', h: 40 });
    stackInsert(m, b.id, a.id, 'after');
    const stack = m.cards[a.parent!];
    expect(stack.kind).toBe('stack');
    expect(stack.children).toEqual([a.id, b.id]);
    expect([stack.x, stack.y]).toEqual([100, 50]);
    expect(b.y).toBe(60 + STACK_GAP);
    stackInsert(m, c.id, a.id, 'before');
    expect(stack.children).toEqual([c.id, a.id, b.id]);
    // Reorder inside the stack.
    stackInsert(m, c.id, b.id, 'after');
    expect(stack.children).toEqual([a.id, b.id, c.id]);
    // Take two out: the stack disappears and the last card stays where the stack was.
    reparent(m, b.id, null, { x: 0, y: 0 });
    reparent(m, c.id, null, { x: 0, y: 300 });
    tidyStacks(m);
    expect(m.cards[stack.id]).toBeUndefined();
    expect(a.parent).toBeNull();
    expect([a.x, a.y]).toEqual([100, 50]);
    expect(m.roots).toContain(a.id);
  });
});

describe('snippet anchors', () => {
  it('finds the occurrence whose context matches best', () => {
    const text = 'Zoom ist gut. Hier steht Zoom nochmal. Ende mit Zoom.';
    expect(locateQuote(text, 'Zoom', 'steht ', ' nochmal')).toBe(25);
    expect(locateQuote(text, 'Zoom', 'mit ', '.')).toBe(48);
    expect(locateQuote(text, 'fehlt')).toBe(-1);
  });
});

describe('diff', () => {
  it('marks added and deleted lines and keeps the rest', () => {
    const d = lineDiff('a\nb\nc\nd', 'a\nB\nc\nd\ne');
    expect(d.map((l) => (l.op === 'same' ? ' ' : l.op === 'add' ? '+' : '-') + l.text)).toEqual([' a', '-b', '+B', ' c', ' d', '+e']);
    expect(lineDiff('x', 'x')).toEqual([{ op: 'same', text: 'x' }]);
  });

  it('lists changed fields without dates', () => {
    expect(changedFields({ title: 't', tags: 'a', modified: '1' }, { title: 't', tags: 'b', color: 'red', modified: '2' })).toEqual(['color', 'tags']);
  });
});

describe('markdown', () => {
  it('renders the subset and escapes html', () => {
    expect(renderMarkdown('# Ziel\n**fett** und *kursiv*\n\n- a\n- b')).toBe(
      '<h1>Ziel</h1><p><strong>fett</strong> und <em>kursiv</em></p><ul><li>a</li><li>b</li></ul>'
    );
    expect(renderMarkdown('<img src=x onerror=alert(1)>')).toBe('<p>&lt;img src=x onerror=alert(1)&gt;</p>');
    expect(renderMarkdown('[x](javascript:alert(1))')).not.toContain('<a');
  });
});
