<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { app } from '../state/app.svelte';
  import { board } from '../state/board.svelte';
  import { drag } from '../state/drag.svelte';
  import type { Entry } from '../core/types';
  import {
    type NoteCard,
    HEADER,
    PAD,
    MIN_H,
    MIN_W,
    addCard,
    addLink,
    ancestors,
    applyFrame,
    bringToFront,
    contentRect,
    contextCard,
    deleteCards,
    edgePoint,
    fitRect,
    focusCard,
    growToFit,
    innerOf,
    stackInsert,
    stackOf,
    tidyStacks,
    isInside,
    planeFrame,
    reparent,
    screenToWorld,
    toPlane,
    toScreen,
    worldRect,
    zoomAt,
    DEFAULT_STATUSES,
    type CardRef,
    type Frame,
    type MapCard,
    type ProjectMap,
    type Rect
  } from '../core/map';
  import { renderMarkdown } from '../core/markdown';
  import type { Snippet } from '../core/snippets';
  import { isToggleKey, modLabel } from '../platform';
  import Icon from './Icon.svelte';
  import BoardSwitch from './BoardSwitch.svelte';
  import { t, tn } from '../i18n/index.svelte';

  /** Default statuses are stored in German; show them in the UI language. */
  const STATUS_KEYS: Record<string, string> = { Offen: 'map.status.open', 'In Arbeit': 'map.status.doing', Erledigt: 'map.status.done' };
  const statusLabel = (s: string) => (STATUS_KEYS[s] ? t(STATUS_KEYS[s]) : s);

  const COLORS = ['#0090ff', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#64748b'];

  interface Vis {
    id: string;
    c: MapCard;
    r: Rect;
    k: number;
    lod: 'dot' | 'title' | 'full';
    open: boolean;
  }

  let el: HTMLElement;

  onMount(() => {
    drag.onBoardDrop = dropFiles;
  });
  onDestroy(() => {
    drag.onBoardDrop = null;
    drag.boardHint = '';
  });

  const m = $derived(board.map);
  const cam = $derived(board.cam);
  const ctx = $derived(m ? contextCard(m, cam, board.vw, board.vh) : null);
  const focus = $derived(m ? focusCard(m, cam, board.vw, board.vh) : null);
  const trail = $derived(m && focus ? [...ancestors(m, focus), focus] : []);

  /** Cards to draw, in paint order, with level of detail. */
  const vis = $derived.by(() => {
    const out: Vis[] = [];
    if (!m) return out;
    const { vw, vh } = board;
    const walk = (ids: string[], f: Frame) => {
      for (const id of ids) {
        const c = m.cards[id];
        const r = { x: f.ox + c.x * f.k, y: f.oy + c.y * f.k, w: c.w * f.k, h: c.h * f.k };
        if (r.w < 3 || r.x > vw || r.y > vh || r.x + r.w < 0 || r.y + r.h < 0) continue;
        const lod = r.w < 44 || r.h < 16 ? 'dot' : f.k * 13 < 8 ? 'title' : 'full';
        const s = innerOf(c) * f.k;
        const open = c.children.length > 0 && lod !== 'dot' && (c.w - 2 * PAD) * s > 48;
        out.push({ id, c, r, k: f.k, lod, open });
        if (open) walk(c.children, { ox: r.x + PAD * f.k, oy: r.y + HEADER * f.k, k: s });
      }
    };
    walk(ctx ? m.cards[ctx].children : m.roots, toScreen(cam, planeFrame(m, ctx)));
    return out;
  });

  const byId = $derived(new Map(vis.map((v) => [v.id, v])));

  /** First file reference: what a file card shows and opens. */
  const fileRef = (c: MapCard): CardRef | undefined => c.refs?.find((r) => r.kind === 'file');

  $effect(() => {
    for (const v of vis) {
      const r = fileRef(v.c);
      if (v.lod !== 'dot' && board.isImage(r)) board.requestThumb(r!);
    }
  });

  function screenRect(id: string): Rect {
    const c = m!.cards[id];
    return applyFrame(toScreen(cam, planeFrame(m!, c.parent)), c);
  }

  /** Where a link endpoint is drawn: the card itself, or the closest ancestor that is drawn. */
  function anchor(id: string): { id: string; r: Rect } | null {
    if (ctx && !isInside(m!, id, ctx)) return null;
    if (id === ctx) return null;
    const chain = [...ancestors(m!, id), id].filter((x) => !ctx || (x !== ctx && isInside(m!, x, ctx)));
    let best: string | null = null;
    for (const x of chain) {
      const p = m!.cards[x].parent;
      if (p && p !== ctx && !byId.get(p)?.open) break;
      best = x;
    }
    return best ? { id: best, r: byId.get(best)?.r ?? screenRect(best) } : null;
  }

  const lines = $derived.by(() => {
    if (!m) return [];
    return m.links.flatMap((l) => {
      const a = anchor(l.from), b = anchor(l.to);
      if (!a || !b || a.id === b.id) return [];
      const p = edgePoint(a.r, b.r.x + b.r.w / 2, b.r.y + b.r.h / 2);
      const q = edgePoint(b.r, a.r.x + a.r.w / 2, a.r.y + a.r.h / 2);
      return [{ l, p, q }];
    });
  });

  // ---------------------------------------------------------------- files

  type Target = { id: string | null; zone: 'nest' | 'link' | 'before' | 'after' };

  /** Snippets join into stacks when dropped on the top or bottom edge of a snippet (or a stacked card). */
  function canStack(target: string, snippet: boolean) {
    const t = m!.cards[target];
    return t.kind !== 'stack' && (snippet || t.kind === 'snippet' || !!stackOf(m!, target));
  }

  function rectOf(id: string) {
    return document.querySelector(`[data-card="${id}"]`)!.getBoundingClientRect();
  }

  function stackZone(id: string, y: number): 'before' | 'after' | null {
    const r = rectOf(id);
    const band = Math.min(r.height * 0.25, 28);
    return y < r.top + band ? 'before' : y > r.bottom - band ? 'after' : null;
  }

  /** Where dropped files go: onto the free plane, into a card, or (right edge) linked to a card. */
  function fileTarget(x: number, y: number, snippet: boolean): Target {
    const id = cardAt({ clientX: x, clientY: y });
    if (!id) return { id: null, zone: 'nest' };
    const stack = canStack(id, snippet) ? stackZone(id, y) : null;
    if (stack) return { id, zone: stack };
    const r = rectOf(id);
    return { id, zone: x > r.right - Math.min(r.width * 0.35, 120) ? 'link' : 'nest' };
  }

  const isSnippetDrag = $derived(!!(drag.data as { snippet?: Snippet } | undefined)?.snippet);
  const fileDrop = $derived(drag.active && drag.hit?.kind === 'board' && m ? fileTarget(drag.x, drag.y, isSnippetDrag) : null);

  $effect(() => {
    const tg = fileDrop;
    const title = tg?.id ? m!.cards[tg.id].title || t('map.untitled') : '';
    const sn = isSnippetDrag ? 'Snippet' : 'Card';
    drag.boardHint = !tg
      ? ''
      : tg.zone === 'link'
        ? t('map.drop.link', { title })
        : tg.zone === 'before'
          ? t('map.drop.stackAbove', { title })
          : tg.zone === 'after'
            ? t('map.drop.stackBelow', { title })
            : tg.id
              ? t(`map.drop.into${sn}`, { title })
              : t(`map.drop.place${sn}`);
  });

  /** Card height for a snippet so its quote fits (about 34 characters per line). */
  const snippetHeight = (quote: string) => Math.min(420, Math.max(96, HEADER + 30 + Math.ceil(quote.length / 34) * 19));

  async function dropFiles(items: Entry[], x: number, y: number, data?: unknown) {
    if (!m) return;
    // A note or snippet from the thread: becomes a card where it is dropped.
    const note = (data as { note?: NoteCard } | undefined)?.note;
    if (note) {
      const tg = fileTarget(x, y, note.kind === 'snippet');
      const stackOn = tg.id && (tg.zone === 'before' || tg.zone === 'after') ? { id: tg.id, where: tg.zone } : null;
      const parent = stackOn ? null : tg.id && tg.zone !== 'link' ? tg.id : ctx;
      const p = local({ clientX: x, clientY: y });
      let id = '';
      board.mutate((mm) => {
        id = placeCard(mm, stackOn ? mm.cards[stackOn.id].parent : parent, p.x, p.y, 0.1, board.noteCard(note));
        if (stackOn) stackInsert(mm, id, stackOn.id, stackOn.where);
        if (parent) growToFit(mm, parent);
      });
      board.removeNote(note.id);
      board.selection.clear();
      board.selection.add(id);
      return;
    }
    const snippet = (data as { snippet?: Snippet } | undefined)?.snippet;
    const tg = fileTarget(x, y, !!snippet);
    let refs: CardRef[];
    try {
      refs = await board.refsFor(items);
    } catch (e) {
      return app.toast(String(e), true);
    }
    if (snippet) refs = [{ ...refs[0], ...snippet, quote: snippet.quote }];
    if (tg.id && tg.zone === 'link') return attach(tg.id, refs);
    const stackOn = tg.id && (tg.zone === 'before' || tg.zone === 'after') ? { id: tg.id, where: tg.zone } : null;
    const parent = stackOn ? null : (tg.id ?? ctx);
    const p = local({ clientX: x, clientY: y });
    const created: string[] = [];
    board.mutate((mm) => {
      refs.forEach((ref, i) => {
        const init: Partial<MapCard> = snippet
          ? { kind: 'snippet', title: ref.page ? t('map.snippetTitle', { name: ref.name ?? '', page: ref.page }) : (ref.name ?? ''), text: snippet.quote, refs: [ref], w: 260, h: snippetHeight(snippet.quote) }
          : { title: ref.name ?? '', refs: [ref], h: board.isImage(ref) ? 190 : 120 };
        const id = placeCard(mm, stackOn ? mm.cards[stackOn.id].parent : parent, p.x, p.y, 0.1, init);
        // Several files: a small grid from the drop point.
        const c = mm.cards[id];
        c.x += (i % 4) * 240;
        c.y += Math.floor(i / 4) * 210;
        if (stackOn) stackInsert(mm, id, stackOn.id, stackOn.where);
        created.push(id);
      });
      if (parent) growToFit(mm, parent);
    });
    board.selection.clear();
    created.forEach((id) => board.selection.add(id));
  }

  /** Add file references to a card (e.g. an idea that belongs to a document). */
  function attach(id: string, refs: CardRef[]) {
    const c = m!.cards[id];
    const fresh = refs.filter((r) => !c.refs?.some((x) => x.id === r.id));
    if (!fresh.length) return;
    board.mutate((mm) => (mm.cards[id].refs = [...(mm.cards[id].refs ?? []), ...fresh]));
    app.toast(t('map.linked', { title: c.title || t('map.card'), files: fresh.map((r) => r.name).join(', ') }));
  }

  /** A file (tray, file list) under the pointer while dragging a card. */
  function fileAt(e: { clientX: number; clientY: number }): HTMLElement | null {
    for (const n of document.elementsFromPoint(e.clientX, e.clientY)) {
      const f = (n as HTMLElement).closest?.<HTMLElement>('[data-file-path]');
      if (f) return f;
    }
    return null;
  }

  // ---------------------------------------------------------------- gestures

  let drop = $state<string | null | undefined>(undefined); // undefined = no reparent pending
  let moving = $state<Set<string>>(new Set());
  let wire = $state<{ from: string; x: number; y: number; to: string | null } | null>(null);
  let linkTo = $state<HTMLElement | null>(null);
  let stackHint = $state<{ id: string; where: 'before' | 'after' } | null>(null);

  function local(e: { clientX: number; clientY: number }) {
    const b = el.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  }

  function cardAt(e: { clientX: number; clientY: number }, exclude: (id: string) => boolean = () => false): string | null {
    for (const n of document.elementsFromPoint(e.clientX, e.clientY)) {
      const id = (n as HTMLElement).closest?.<HTMLElement>('[data-card]')?.dataset.card;
      if (id && !exclude(id)) return id;
    }
    return null;
  }

  function track(onMove: (ev: PointerEvent) => void, onUp: (ev: PointerEvent) => void) {
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', up);
      onUp(ev);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', up);
  }

  function down(e: PointerEvent) {
    if (!m || (e.target as HTMLElement).closest('.editor, .ui, .linkbar')) return;
    if (board.editing) commitEdit();
    const t = e.target as HTMLElement;
    const handle = t.closest<HTMLElement>('[data-handle]')?.dataset.handle;
    const linkId = t.closest<SVGElement>('[data-link]')?.dataset.link;
    const id = t.closest<HTMLElement>('[data-card]')?.dataset.card ?? null;
    el.focus();

    if (e.button === 1 || (e.button === 0 && !id && !linkId)) return pan(e);
    if (e.button !== 0) return;
    if (linkId) {
      board.selection.clear();
      board.link = linkId;
      return;
    }
    if (!id) return;
    board.link = null;
    const ref = t.closest<HTMLElement>('[data-ref]')?.dataset.ref;
    if (ref !== undefined) {
      const r = m.cards[id].refs?.[Number(ref)];
      if (r) void board.openRef(r);
      return;
    }
    if (handle === 'zoom') return flyInto(id);
    if (handle === 'resize') return resize(e, id);
    if (handle === 'connect') return connect(e, id);

    if (e.shiftKey || isToggleKey(e)) {
      if (board.selection.has(id)) board.selection.delete(id);
      else board.selection.add(id);
      return;
    }
    if (!board.selection.has(id)) {
      board.selection.clear();
      board.selection.add(id);
    }
    move(e, id);
  }

  function pan(e: PointerEvent) {
    const s = local(e);
    const c0 = { ...board.cam };
    let moved = false;
    track(
      (ev) => {
        const p = local(ev);
        if (!moved && Math.hypot(p.x - s.x, p.y - s.y) < 3) return;
        moved = true;
        board.setCam({ ...c0, x: c0.x - (p.x - s.x) / c0.z, y: c0.y - (p.y - s.y) / c0.z });
      },
      () => {
        if (!moved) {
          board.selection.clear();
          board.link = null;
        }
      }
    );
  }

  function move(e: PointerEvent, grabbed: string) {
    const parent = m!.cards[grabbed].parent;
    const ids = [...board.selection].filter((id) => m!.cards[id]?.parent === parent);
    const start = new Map(ids.map((id) => [id, { x: m!.cards[id].x, y: m!.cards[id].y }]));
    const k = toScreen(board.cam, planeFrame(m!, parent)).k;
    const s = local(e);
    const before = board.snapshot();
    let active = false;
    track(
      (ev) => {
        const p = local(ev);
        if (!active && Math.hypot(p.x - s.x, p.y - s.y) < 4) return;
        if (!active) {
          active = true;
          moving = new Set(ids);
          ids.forEach((id) => bringToFront(m!, id));
        }
        for (const id of ids) {
          const c = m!.cards[id], o = start.get(id)!;
          c.x = o.x + (p.x - s.x) / k;
          c.y = o.y + (p.y - s.y) / k;
          if (parent) (c.x = Math.max(0, c.x)), (c.y = Math.max(0, c.y));
        }
        // Over a file outside the map (tray, file list): link instead of moving.
        const f = fileAt(ev);
        linkTo?.classList.remove('link-target');
        linkTo = f;
        f?.classList.add('link-target');
        const hovered = cardAt(ev, (x) => ids.some((i) => isInside(m!, x, i)));
        // Top/bottom edge of a snippet: stack instead of nesting.
        const z = !f && !ev.altKey && ids.length === 1 && hovered && canStack(hovered, m!.cards[ids[0]].kind === 'snippet') ? stackZone(hovered, ev.clientY) : null;
        stackHint = z ? { id: hovered!, where: z } : null;
        // Alt keeps the card on its level; otherwise the card under the pointer becomes its new parent.
        const target = f || ev.altKey || z ? parent : (hovered ?? ctx);
        drop = target !== parent ? target : undefined;
      },
      () => {
        const file = linkTo;
        if (file) {
          file.classList.remove('link-target');
          linkTo = null;
          for (const id of ids) Object.assign(m!.cards[id], start.get(id));
          const path = file.dataset.filePath!;
          const name = path.split(/[\\/]/).pop() ?? path;
          void board
            .refsFor([{ path, name, ext: name.includes('.') ? name.split('.').pop()!.toLowerCase() : '', kind: file.dataset.dir ? 'dir' : 'file', size: 0, mtime: 0, ctime: 0, tags: [] }])
            .then((refs) => ids.forEach((id) => attach(id, refs)))
            .catch((e) => app.toast(String(e), true));
        } else if (active) {
          const target = drop;
          if (stackHint) stackInsert(m!, ids[0], stackHint.id, stackHint.where);
          else if (target !== undefined)
            for (const id of ids) {
              const r = worldRect(m!, id);
              reparent(m!, id, target, { x: r.x, y: r.y });
            }
          else if (parent) growToFit(m!, parent);
          tidyStacks(m!);
          board.checkpoint(before);
        }
        moving = new Set();
        drop = undefined;
        stackHint = null;
      }
    );
  }

  function resize(e: PointerEvent, id: string) {
    const c = m!.cards[id];
    const k = toScreen(board.cam, planeFrame(m!, c.parent)).k;
    const s = local(e);
    const w0 = c.w, h0 = c.h;
    const before = board.snapshot();
    track(
      (ev) => {
        const p = local(ev);
        c.w = Math.max(MIN_W, w0 + (p.x - s.x) / k);
        c.h = Math.max(MIN_H, h0 + (p.y - s.y) / k);
      },
      () => {
        growToFit(m!, id);
        if (c.parent) growToFit(m!, c.parent);
        tidyStacks(m!);
        board.checkpoint(before);
      }
    );
  }

  function connect(e: PointerEvent, from: string) {
    const s = local(e);
    wire = { from, x: s.x, y: s.y, to: null };
    track(
      (ev) => {
        const p = local(ev);
        wire = { from, x: p.x, y: p.y, to: cardAt(ev, (x) => x === from) };
      },
      () => {
        const to = wire?.to;
        wire = null;
        if (to) board.mutate((mm) => void addLink(mm, from, to));
      }
    );
  }

  function wheel(e: WheelEvent) {
    if (!m) return;
    e.preventDefault();
    const p = local(e);
    if (e.shiftKey) {
      board.setCam({ ...board.cam, x: board.cam.x + (e.deltaX || e.deltaY) / board.cam.z });
      return;
    }
    const unit = e.deltaMode === 1 ? 30 : 1;
    const speed = e.ctrlKey ? 0.01 : 0.0018; // pinch gestures arrive as ctrl+wheel with small deltas
    board.setCam(zoomAt(board.cam, p.x, p.y, Math.exp(-e.deltaY * unit * speed)));
  }

  function dblclick(e: MouseEvent) {
    if (!m || (e.target as HTMLElement).closest('.editor, .ui, .linkbar, [data-handle]')) return;
    const t = e.target as HTMLElement;
    const id = t.closest<HTMLElement>('[data-card]')?.dataset.card ?? null;
    if (id && t.closest('.head')) return startEdit(id);
    // File cards open their file; a card with children keeps double-click for new sub-cards.
    const ref = id ? fileRef(m.cards[id]) : undefined;
    if (id && ref && !m.cards[id].children.length) return void board.openRef(ref);
    const parent = id ?? ctx;
    const p = local(e);
    let created = '';
    board.mutate((mm) => (created = placeCard(mm, parent, p.x, p.y, 0.1)));
    board.selection.clear();
    board.selection.add(created);
    startEdit(created);
  }

  // ---------------------------------------------------------------- navigation

  function flyInto(id: string) {
    const r = contentRect(m!, id);
    board.flyTo(fitRect(r, board.vw, board.vh, 0.06));
  }

  /** One level up: show the plane that holds the current card. */
  function up() {
    const p = focus ? m!.cards[focus].parent : null;
    if (p) flyInto(p);
    else board.overview();
  }

  /**
   * New card on `parent`'s plane at a screen point (`anchor` = where the point
   * sits inside the card). Cards always start at the same size in plane units,
   * so title bar and text keep their proportions on every level.
   */
  function placeCard(mm: ProjectMap, parent: string | null, sx: number, sy: number, anchor: number, init: Partial<MapCard> = {}): string {
    const w = init.w ?? 220, h = init.h ?? 140;
    const wp = screenToWorld(board.cam, sx, sy);
    const at = toPlane(planeFrame(mm, parent), wp.x, wp.y);
    const x = at.x - w * anchor, y = at.y - h * anchor;
    return addCard(mm, parent, { x: parent ? Math.max(0, x) : x, y: parent ? Math.max(0, y) : y }, { ...init, w, h }).id;
  }

  function newCardAtCenter() {
    if (!m) return;
    let id = '';
    board.mutate((mm) => (id = placeCard(mm, focus, board.vw / 2, board.vh / 2, 0.5)));
    board.selection.clear();
    board.selection.add(id);
    startEdit(id);
  }

  // ---------------------------------------------------------------- editing

  let draft = $state({ title: '', text: '' });
  let titleEl = $state<HTMLInputElement>();

  function startEdit(id: string) {
    const c = m!.cards[id];
    draft = { title: c.title, text: c.text };
    board.editing = id;
    queueMicrotask(() => titleEl?.focus());
  }

  function commitEdit() {
    const id = board.editing;
    board.editing = null;
    if (!id || !m?.cards[id]) return;
    const c = m.cards[id];
    if (c.title !== draft.title || c.text !== draft.text)
      board.mutate((mm) => {
        mm.cards[id].title = draft.title.trim();
        mm.cards[id].text = draft.text;
      });
  }

  function editKey(e: KeyboardEvent) {
    if (e.key === 'Escape' || (e.key === 'Enter' && (isToggleKey(e) || (e.target as HTMLElement).tagName === 'INPUT'))) {
      commitEdit();
      el.focus();
      e.preventDefault();
    }
    e.stopPropagation();
  }

  const editRect = $derived.by(() => {
    if (!board.editing || !m?.cards[board.editing]) return null;
    const r = byId.get(board.editing)?.r ?? screenRect(board.editing);
    const w = Math.max(300, Math.min(r.w, 520));
    return { x: Math.min(Math.max(8, r.x), board.vw - w - 8), y: Math.min(Math.max(8, r.y), board.vh - 260), w };
  });

  const statuses = $derived(m?.statuses ?? DEFAULT_STATUSES);
  const selInKanban = $derived(m ? [...board.selection].every((id) => m.cards[id]?.status) : false);

  /** The Kanban is a view on the cards: sending a card there means giving it a status. */
  function toKanban() {
    const on = !selInKanban;
    board.mutate((mm) => board.selection.forEach((id) => (mm.cards[id].status = on ? (mm.cards[id].status ?? statuses[0]) : null)));
    app.toast(on ? t('map.toKanban', { status: statusLabel(statuses[0]) }) : t('map.fromKanban'));
  }

  function setColor(color: string | null) {
    board.mutate((mm) => board.selection.forEach((id) => (mm.cards[id].color = color)));
  }

  function removeSelected() {
    if (board.link) {
      const l = board.link;
      board.mutate((mm) => (mm.links = mm.links.filter((x) => x.id !== l)));
      board.link = null;
    } else if (board.selection.size) {
      const ids = [...board.selection];
      board.mutate((mm) => {
        deleteCards(mm, ids);
        tidyStacks(mm);
      });
      board.selection.clear();
    }
  }

  const selLink = $derived(m && board.link ? m.links.find((l) => l.id === board.link) : null);
  const selLine = $derived(lines.find((x) => x.l.id === board.link));

  function key(e: KeyboardEvent) {
    if (app.view !== 'board' || !m || board.editing) return;
    const t = e.target as HTMLElement;
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
    const mod = isToggleKey(e);
    const k = e.key.toLowerCase();
    if (mod && k === 'z') {
      if (e.shiftKey) board.redo();
      else board.undo();
    } else if (mod && k === 'y') board.redo();
    else if (mod && k === 'a') {
      board.selection.clear();
      (focus ? m.cards[focus].children : m.roots).forEach((id) => board.selection.add(id));
    } else if (e.key === 'Delete' || e.key === 'Backspace') removeSelected();
    else if (e.key === 'F2' && board.selection.size === 1) startEdit([...board.selection][0]);
    else if (e.key === 'Enter' && board.selection.size === 1) flyInto([...board.selection][0]);
    else if (e.key === 'Escape') {
      if (board.selection.size || board.link) {
        board.selection.clear();
        board.link = null;
      } else up();
    } else if (e.key === 'Home' || e.key === '0') board.overview();
    else if (k === 'n' && !mod) newCardAtCenter();
    else return;
    e.preventDefault();
  }

  // ---------------------------------------------------------------- map menu

  let menuOpen = $state(false);
  let naming = $state<'new' | 'rename' | null>(null);
  let nameDraft = $state('');

  function startNaming(kind: 'new' | 'rename') {
    naming = kind;
    nameDraft = kind === 'rename' ? (m?.title ?? '') : '';
    menuOpen = false;
  }

  async function finishNaming() {
    const kind = naming;
    naming = null;
    if (!nameDraft.trim()) return;
    if (kind === 'new') await board.create(nameDraft.trim());
    else await board.rename(nameDraft);
  }

  function autofocus(n: HTMLElement) {
    n.focus();
  }
</script>

<svelte:window onkeydown={key} onbeforeunload={() => void board.flush()} />

<section
  class="board"
  class:narrow={board.vw < 760}
  bind:this={el}
  bind:clientWidth={board.vw}
  bind:clientHeight={board.vh}
  onpointerdown={down}
  ondblclick={dblclick}
  onwheel={wheel}
  oncontextmenu={(e) => e.preventDefault()}
  tabindex="-1"
  role="application"
  aria-label={t('map.switch.map')}
  data-drop="board"
>
  {#if m}
    {#if ctx}
      <div class="backdrop" style:--c={m.cards[ctx].color ?? 'var(--fg-faint)'}></div>
    {/if}

    {#each vis as v (v.id)}
      {@const c = v.c}
      {@const ref = fileRef(c)}
      {@const pic = ref && board.isImage(ref) ? board.thumbs.get(ref.path!) : null}
      {@const hint = stackHint?.id === v.id ? stackHint.where : fileDrop?.id === v.id && (fileDrop.zone === 'before' || fileDrop.zone === 'after') ? fileDrop.zone : null}
      <div
        class="card {v.lod} {c.kind ?? ''}"
        class:stack-before={hint === 'before'}
        class:stack-after={hint === 'after'}
        class:sel={board.selection.has(v.id)}
        class:drop={fileDrop?.id === v.id && fileDrop.zone === 'nest'}
        class:linkzone={fileDrop?.id === v.id && fileDrop.zone === 'link'}
        class:target={drop === v.id}
        class:moving={[...moving].some((x) => isInside(m, v.id, x))}
        class:wired={wire?.to === v.id}
        data-card={v.id}
        style:left="{v.r.x}px"
        style:top="{v.r.y}px"
        style:width="{v.r.w}px"
        style:height="{v.r.h}px"
        style:--c={c.color ?? 'var(--line)'}
      >
        {#if v.lod === 'full'}
          <div class="inner" style:width="{c.w}px" style:height="{c.h}px" style:transform="scale({v.k})">
            <div class="head" style:height="{HEADER}px">
              <span class="t">{c.kind === 'stack' ? t('map.stack', { n: c.children.length }) : c.title || t('map.untitled')}</span>
              {#if c.status}<span class="status">{statusLabel(c.status)}</span>{/if}
            </div>
            {#if pic}<img class="pic" class:full={!c.text} src={pic} alt="" draggable="false" />{/if}
            {#if c.kind === 'snippet'}
              <blockquote class="quote">{c.text}</blockquote>
            {:else if c.text}<div class="text">{@html renderMarkdown(c.text)}</div>{/if}
            {#if c.refs?.length}
              <div class="refs">
                {#each c.refs as r, i (r.id ?? r.href ?? i)}
                  <button class="ref" class:missing={r.missing} data-ref={i} title={r.missing ? t('map.notFound') : r.path}>
                    <Icon name={r.dir ? 'folder' : 'file'} size={11} />{r.name ?? r.title ?? r.href}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        {:else if v.lod === 'title'}
          {#if pic}<img class="pic mini-pic" src={pic} alt="" draggable="false" />{/if}
          <div class="mini">{c.title || t('map.untitled')}</div>
        {/if}
        {#if c.children.length && !v.open && v.lod !== 'dot'}
          <span class="count" title={tn('map.subcards', c.children.length)}>{c.children.length}</span>
        {/if}
        {#if v.lod !== 'dot' && v.r.w > 70}
          <button class="h zoom" data-handle="zoom" title={t('map.zoomIn')}><Icon name="zoomIn" size={13} /></button>
          <span class="h connect" data-handle="connect" title={t('map.connect')}></span>
          <span class="h resize" data-handle="resize"></span>
        {/if}
      </div>
    {/each}

    <svg class="links" width={board.vw} height={board.vh}>
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10z" fill="context-stroke" />
        </marker>
      </defs>
      {#each lines as { l, p, q } (l.id)}
        <g data-link={l.id} class:sel={board.link === l.id}>
          <line class="hit" x1={p.x} y1={p.y} x2={q.x} y2={q.y} />
          <line class="ln" x1={p.x} y1={p.y} x2={q.x} y2={q.y} marker-end={l.directed ? 'url(#arrow)' : undefined} />
          {#if l.label}
            <text x={(p.x + q.x) / 2} y={(p.y + q.y) / 2 - 6} text-anchor="middle">{l.label}</text>
          {/if}
        </g>
      {/each}
      {#if wire}
        {@const a = byId.get(wire.from)?.r ?? screenRect(wire.from)}
        {@const s = edgePoint(a, wire.x, wire.y)}
        <line class="ln wire" x1={s.x} y1={s.y} x2={wire.x} y2={wire.y} marker-end="url(#arrow)" />
      {/if}
    </svg>

    {#if selLink && selLine}
      <div class="linkbar ui" style:left="{(selLine.p.x + selLine.q.x) / 2}px" style:top="{(selLine.p.y + selLine.q.y) / 2 + 10}px">
        <input
          placeholder={t('map.link.label')}
          value={selLink.label ?? ''}
          onchange={(e) => {
            const v = e.currentTarget.value.trim();
            board.mutate(() => (selLink.label = v || undefined));
          }}
          onkeydown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
          }}
        />
        <button class="btn icon" title={t('map.link.direction')} onclick={() => board.mutate(() => (selLink.directed = !selLink.directed))}>
          <Icon name={selLink.directed ? 'arrow' : 'line'} size={14} />
        </button>
        <button class="btn icon" title={t('map.link.delete')} onclick={removeSelected}><Icon name="trash" size={14} /></button>
      </div>
    {/if}

    {#if board.editing && editRect}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="editor ui" style:left="{editRect.x}px" style:top="{editRect.y}px" style:width="{editRect.w}px" onkeydown={editKey}>
        <input bind:this={titleEl} bind:value={draft.title} placeholder={t('map.edit.title')} />
        <textarea bind:value={draft.text} rows="6" placeholder={t('map.edit.text')}></textarea>
        <div class="row">
          <span class="hint">{modLabel}↵ {t('map.edit.doneHint')} · Esc</span>
          <button class="btn primary" onclick={commitEdit}>{t('common.done')}</button>
        </div>
      </div>
    {/if}

    <nav class="crumbs ui">
      <div class="mapmenu">
        {#if naming}
          <input
            class="name"
            use:autofocus
            bind:value={nameDraft}
            placeholder={naming === 'new' ? t('map.menu.newName') : t('map.menu.rename')}
            onkeydown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') finishNaming();
              if (e.key === 'Escape') naming = null;
            }}
            onblur={finishNaming}
          />
        {:else}
          <button class="crumb root" onclick={() => board.overview()} ondblclick={() => startNaming('rename')} title={t('map.menu.rootTitle')}>
            {m.title}
          </button>
          <button class="btn icon" onclick={() => (menuOpen = !menuOpen)} aria-label={t('map.menu.maps')}><Icon name="chevronDown" size={13} /></button>
        {/if}
        {#if menuOpen}
          <div class="menu">
            {#each board.maps as mi (mi.id)}
              <button class:on={mi.id === m.id} onclick={() => ((menuOpen = false), board.load(mi.id))}>{mi.title}</button>
            {/each}
            <hr />
            <button onclick={() => startNaming('new')}><Icon name="plus" size={13} /> {t('map.menu.new')}</button>
            <button onclick={() => startNaming('rename')}><Icon name="pencil" size={13} /> {t('common.rename')}</button>
            <button class="danger" onclick={() => ((menuOpen = false), board.remove())}><Icon name="trash" size={13} /> {t('map.menu.delete')}</button>
          </div>
        {/if}
      </div>
      {#each trail as id (id)}
        <span class="sep">›</span>
        <button class="crumb" onclick={() => flyInto(id)}>{m.cards[id]?.title || t('map.untitled')}</button>
      {/each}
    </nav>

    <div class="tools ui">
      <BoardSwitch />
      <span class="div"></span>
      <button class="btn" onclick={newCardAtCenter} title={t('map.tools.newCard')}><Icon name="plus" size={14} /> {t('map.card')}</button>
      <button class="btn icon" onclick={up} disabled={!focus} title={t('map.tools.up')}><Icon name="zoomOut" size={15} /></button>
      <button class="btn icon" onclick={() => board.overview()} title={t('map.tools.overview')}><Icon name="fit" size={15} /></button>
      <button class="btn icon" onclick={() => board.undo()} disabled={!board.canUndo} title="{t('common.undo')} ({modLabel}Z)"><Icon name="undo" size={15} /></button>
      <button class="btn icon" onclick={() => board.redo()} disabled={!board.canRedo} title={t('map.tools.redo')}><Icon name="redo" size={15} /></button>
    </div>

    {#if board.selection.size && !board.editing}
      <div class="selbar ui">
        {#each COLORS as col (col)}
          <button class="swatch" style:background={col} onclick={() => setColor(col)} aria-label={t('map.sel.color', { color: col })}></button>
        {/each}
        <button class="swatch none" onclick={() => setColor(null)} aria-label={t('map.sel.noColor')}></button>
        <span class="div"></span>
        {#if board.selection.size === 1}
          <button class="btn icon" title={t('map.sel.edit')} onclick={() => startEdit([...board.selection][0])}><Icon name="pencil" size={14} /></button>
          <button class="btn icon" title={t('map.zoomIn')} onclick={() => flyInto([...board.selection][0])}><Icon name="zoomIn" size={14} /></button>
        {/if}
        <button class="btn" class:on={selInKanban} title={selInKanban ? t('map.sel.fromKanban') : t('map.sel.toKanban')} onclick={toKanban}>
          <Icon name="kanban" size={14} /> Kanban
        </button>
        <button class="btn icon" title={t('map.sel.toThread')} onclick={() => board.toThread([...board.selection])}><Icon name="doc" size={14} /></button>
        <button class="btn icon" title={t('map.sel.delete')} onclick={removeSelected}><Icon name="trash" size={14} /></button>
      </div>
    {/if}

    {#if !m.roots.length}
      <p class="hint-empty">{t('map.empty')}</p>
    {/if}
  {/if}
</section>

<style>
  .board {
    position: relative;
    flex: 1;
    min-height: 0;
    /* clip, not hidden: text selection in the reader must not auto-scroll the map */
    overflow: clip;
    outline: none;
    background-color: var(--bg);
    background-image: radial-gradient(circle, var(--line) 1px, transparent 1.2px);
    background-size: 22px 22px;
    cursor: default;
    touch-action: none;
  }
  .backdrop {
    position: absolute;
    inset: 0;
    background: color-mix(in srgb, var(--c) 7%, var(--bg-elev));
  }
  .card {
    position: absolute;
    border-radius: 6px;
    background: var(--bg-elev);
    border: 1px solid color-mix(in srgb, var(--c) 55%, var(--line));
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
    overflow: hidden;
  }
  .card.dot {
    background: color-mix(in srgb, var(--c) 45%, var(--bg-elev));
    border-radius: 2px;
  }
  .card.sel {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
    overflow: visible;
  }
  .card.target,
  .card.drop,
  .card.wired {
    outline: 2px dashed var(--accent);
    outline-offset: 2px;
    background: color-mix(in srgb, var(--accent) 8%, var(--bg-elev));
  }
  .card.stack {
    background: transparent;
    border-style: dashed;
    box-shadow: none;
  }
  .card.stack .head {
    background: transparent;
    border-bottom: 0;
  }
  .card.stack .head .t {
    font-size: 12px;
    font-weight: 500;
    color: var(--fg-muted);
  }
  .card.snippet {
    border-left: 3px solid color-mix(in srgb, var(--c) 60%, #f5b301);
  }
  .card.snippet .head .t {
    font-size: 12px;
    font-weight: 500;
    color: var(--fg-muted);
  }
  .quote {
    margin: 0;
    padding: 6px 12px 0;
    font-size: 13px;
    line-height: 1.45;
    color: var(--fg);
    overflow: hidden;
    max-height: calc(100% - 30px - 28px);
    white-space: pre-wrap;
  }
  .card.stack-before::after,
  .card.stack-after::after {
    content: '';
    position: absolute;
    left: -4px;
    right: -4px;
    height: 4px;
    border-radius: 2px;
    background: var(--accent);
    z-index: 3;
  }
  .card.stack-before::after {
    top: -6px;
  }
  .card.stack-after::after {
    bottom: -6px;
  }
  .card.stack-before,
  .card.stack-after {
    overflow: visible;
  }
  .card.linkzone {
    outline: 2px solid var(--attr);
    outline-offset: 2px;
    box-shadow: inset -36px 0 0 var(--attr-soft);
  }
  .card.moving {
    pointer-events: none;
    opacity: 0.85;
    box-shadow: var(--shadow);
  }
  .card:hover {
    overflow: visible;
  }
  .inner {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
    pointer-events: none;
  }
  .head {
    display: flex;
    align-items: center;
    padding: 0 10px;
    background: color-mix(in srgb, var(--c) 16%, var(--bg-elev));
    border-bottom: 1px solid color-mix(in srgb, var(--c) 30%, var(--line));
    pointer-events: auto;
  }
  .head .t {
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .text {
    padding: 6px 10px;
    font-size: 13px;
    line-height: 1.45;
    color: var(--fg-muted);
    overflow: hidden;
    max-height: calc(100% - 30px);
  }
  .text :global(h1),
  .text :global(h2),
  .text :global(h3) {
    margin: 0.2em 0;
    font-size: 1.1em;
    color: var(--fg);
  }
  .text :global(p),
  .text :global(ul),
  .text :global(ol) {
    margin: 0.3em 0;
    padding-left: 0;
  }
  .text :global(li) {
    margin-left: 1.2em;
  }
  .text :global(code) {
    font-family: var(--mono);
    font-size: 0.9em;
    background: var(--bg-sunken);
    padding: 0 3px;
    border-radius: 3px;
  }
  .status {
    margin-left: auto;
    padding: 1px 7px;
    border-radius: 9px;
    font-size: 11px;
    font-weight: 600;
    color: var(--fg-muted);
    background: var(--bg-elev);
    white-space: nowrap;
  }
  .pic {
    display: block;
    width: 100%;
    height: 60%;
    object-fit: cover;
    background: var(--bg-sunken);
  }
  .pic.full {
    height: calc(100% - 30px - 26px);
  }
  .mini-pic {
    position: absolute;
    inset: 0;
    height: 100%;
    opacity: 0.85;
  }
  .refs {
    position: absolute;
    left: 6px;
    right: 6px;
    bottom: 5px;
    display: flex;
    gap: 4px;
    overflow: hidden;
  }
  .ref {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    max-width: 100%;
    padding: 2px 7px;
    border-radius: 6px;
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--fg-muted);
    background: var(--bg-sunken);
    pointer-events: auto;
    cursor: pointer;
  }
  .ref:hover {
    color: var(--accent);
  }
  .ref.missing {
    text-decoration: line-through;
    color: var(--danger);
  }
  :global(.link-target) {
    outline: 2px solid var(--attr) !important;
    outline-offset: 2px;
  }
  .mini {
    position: relative;
    padding: 1px 4px;
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    background: color-mix(in srgb, var(--c) 16%, var(--bg-elev));
  }
  .count {
    position: absolute;
    right: 4px;
    bottom: 4px;
    min-width: 16px;
    padding: 0 4px;
    border-radius: 8px;
    font-size: 10px;
    font-weight: 600;
    text-align: center;
    color: var(--fg-muted);
    background: var(--bg-sunken);
  }
  .h {
    position: absolute;
    display: none;
    z-index: 2;
  }
  .card:hover > .h,
  .card.sel > .h {
    display: grid;
  }
  .zoom {
    top: 3px;
    right: 3px;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 5px;
    background: var(--bg-elev);
    color: var(--fg-muted);
    border: 1px solid var(--line);
  }
  .zoom:hover {
    color: var(--accent);
  }
  .connect {
    right: -7px;
    top: calc(50% - 6px);
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--accent);
    border: 2px solid var(--bg-elev);
    cursor: crosshair;
  }
  .resize {
    right: 0;
    bottom: 0;
    width: 12px;
    height: 12px;
    cursor: nwse-resize;
    background: linear-gradient(135deg, transparent 50%, var(--fg-faint) 50%);
    border-bottom-right-radius: 5px;
  }
  .links {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: visible;
  }
  .links g {
    pointer-events: stroke;
    cursor: pointer;
  }
  .links .hit {
    stroke: transparent;
    stroke-width: 12;
  }
  .links .ln {
    stroke: var(--fg-muted);
    stroke-width: 1.5;
  }
  .links g.sel .ln {
    stroke: var(--accent);
    stroke-width: 2.2;
  }
  .links .wire {
    stroke: var(--accent);
    stroke-dasharray: 4 3;
  }
  .links text {
    font-size: 11px;
    fill: var(--fg-muted);
    paint-order: stroke;
    stroke: var(--bg);
    stroke-width: 3px;
  }
  .ui {
    position: absolute;
    z-index: 10;
  }
  .crumbs {
    top: 10px;
    left: 12px;
    display: flex;
    align-items: center;
    gap: 4px;
    max-width: calc(100% - 300px);
    padding: 3px 6px;
    border-radius: 9px;
    background: color-mix(in srgb, var(--bg-elev) 92%, transparent);
    box-shadow: var(--shadow);
  }
  /* Narrow map (reader open): breadcrumb below the tools, switch without labels. */
  .narrow .crumbs {
    top: 92px;
    max-width: calc(100% - 24px);
  }
  .narrow :global(.lbl) {
    display: none;
  }
  .crumb {
    padding: 3px 6px;
    border-radius: 6px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 200px;
    color: var(--fg-muted);
  }
  .crumb:hover {
    background: var(--bg-sunken);
    color: var(--fg);
  }
  .crumb.root {
    font-weight: 650;
    color: var(--fg);
  }
  .sep {
    color: var(--fg-faint);
  }
  .mapmenu {
    position: relative;
    display: flex;
    align-items: center;
  }
  .name {
    width: 200px;
  }
  .menu {
    position: absolute;
    top: 32px;
    left: 0;
    min-width: 200px;
    padding: 4px;
    border-radius: 9px;
    background: var(--bg-elev);
    box-shadow: var(--shadow);
    border: 1px solid var(--line);
    display: flex;
    flex-direction: column;
  }
  .menu button {
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 6px 8px;
    border-radius: 6px;
    text-align: left;
  }
  .menu button:hover,
  .menu button.on {
    background: var(--bg-sunken);
  }
  .menu .danger {
    color: var(--danger);
  }
  .menu hr {
    border: 0;
    border-top: 1px solid var(--line);
    margin: 4px 0;
  }
  .tools {
    top: 10px;
    right: 12px;
    max-width: calc(100% - 24px);
    flex-wrap: wrap;
    justify-content: flex-end;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px;
    border-radius: 9px;
    background: color-mix(in srgb, var(--bg-elev) 92%, transparent);
    box-shadow: var(--shadow);
  }
  .selbar {
    max-width: calc(100% - 24px);
    flex-wrap: wrap;
    justify-content: center;
    left: 50%;
    bottom: 16px;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 5px 8px;
    border-radius: 10px;
    background: var(--bg-elev);
    box-shadow: var(--shadow);
  }
  .swatch {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 2px solid var(--bg-elev);
    box-shadow: 0 0 0 1px var(--line);
  }
  .swatch.none {
    background: linear-gradient(135deg, var(--bg-elev) 45%, var(--danger) 45%, var(--danger) 55%, var(--bg-elev) 55%);
  }
  .div {
    width: 1px;
    height: 18px;
    background: var(--line);
    margin: 0 4px;
  }
  .linkbar {
    transform: translateX(-50%);
    display: flex;
    gap: 2px;
    padding: 3px;
    border-radius: 8px;
    background: var(--bg-elev);
    box-shadow: var(--shadow);
  }
  .linkbar input {
    width: 140px;
  }
  .editor {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border-radius: 10px;
    background: var(--bg-elev);
    box-shadow: var(--shadow);
    border: 1px solid var(--accent);
  }
  .editor input {
    font-weight: 600;
    font-size: 14px;
  }
  .editor textarea {
    resize: vertical;
    font: inherit;
    line-height: 1.45;
  }
  .editor input,
  .editor textarea,
  .linkbar input,
  .name {
    padding: 5px 7px;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--fg);
    outline: none;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .hint {
    font-size: 11px;
    color: var(--fg-faint);
  }
  .hint-empty {
    position: absolute;
    left: 50%;
    top: 45%;
    transform: translate(-50%, -50%);
    max-width: 420px;
    text-align: center;
    color: var(--fg-faint);
    pointer-events: none;
  }
</style>
