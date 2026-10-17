<script lang="ts">
  import { onDestroy } from 'svelte';
  import { app } from '../state/app.svelte';
  import { board } from '../state/board.svelte';
  import {
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
    isInside,
    planeFrame,
    reparent,
    screenToWorld,
    toPlane,
    toScreen,
    worldRect,
    zoomAt,
    type Frame,
    type MapCard,
    type ProjectMap,
    type Rect
  } from '../core/map';
  import { renderMarkdown } from '../core/markdown';
  import { isToggleKey, modLabel } from '../platform';
  import Icon from './Icon.svelte';

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
  const project = $derived(app.libraryOf(app.cwd));

  $effect(() => {
    void board.open(project?.root ?? null);
  });
  onDestroy(() => void board.flush(true));

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

  // ---------------------------------------------------------------- gestures

  let drop = $state<string | null | undefined>(undefined); // undefined = no reparent pending
  let moving = $state<Set<string>>(new Set());
  let wire = $state<{ from: string; x: number; y: number; to: string | null } | null>(null);

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
        // Alt keeps the card on its level; otherwise the card under the pointer becomes its new parent.
        const target = ev.altKey ? parent : (cardAt(ev, (x) => ids.some((i) => isInside(m!, x, i))) ?? ctx);
        drop = target !== parent ? target : undefined;
      },
      () => {
        if (active) {
          const target = drop;
          if (target !== undefined)
            for (const id of ids) {
              const r = worldRect(m!, id);
              reparent(m!, id, target, { x: r.x, y: r.y });
            }
          else if (parent) growToFit(m!, parent);
          board.checkpoint(before);
        }
        moving = new Set();
        drop = undefined;
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
  function placeCard(mm: ProjectMap, parent: string | null, sx: number, sy: number, anchor: number): string {
    const w = 220, h = 140;
    const wp = screenToWorld(board.cam, sx, sy);
    const at = toPlane(planeFrame(mm, parent), wp.x, wp.y);
    const x = at.x - w * anchor, y = at.y - h * anchor;
    return addCard(mm, parent, { x: parent ? Math.max(0, x) : x, y: parent ? Math.max(0, y) : y }, { w, h }).id;
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
      board.mutate((mm) => deleteCards(mm, ids));
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
  bind:this={el}
  bind:clientWidth={board.vw}
  bind:clientHeight={board.vh}
  onpointerdown={down}
  ondblclick={dblclick}
  onwheel={wheel}
  oncontextmenu={(e) => e.preventDefault()}
  tabindex="-1"
  role="application"
  aria-label="Projektmap"
>
  {#if !project}
    <div class="empty">
      <Icon name="nodes" size={28} />
      <p>Maps gehören zu einem Projekt.</p>
      <button class="btn primary" onclick={() => app.addProject(app.cwd)}>„{app.cwd.split(/[\\/]/).pop()}“ als Projekt einbeziehen</button>
    </div>
  {:else if m}
    {#if ctx}
      <div class="backdrop" style:--c={m.cards[ctx].color ?? 'var(--fg-faint)'}></div>
    {/if}

    {#each vis as v (v.id)}
      {@const c = v.c}
      <div
        class="card {v.lod}"
        class:sel={board.selection.has(v.id)}
        class:drop={drop === v.id}
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
            <div class="head" style:height="{HEADER}px"><span class="t">{c.title || 'Ohne Titel'}</span></div>
            {#if c.text}<div class="text">{@html renderMarkdown(c.text)}</div>{/if}
          </div>
        {:else if v.lod === 'title'}
          <div class="mini">{c.title || 'Ohne Titel'}</div>
        {/if}
        {#if c.children.length && !v.open && v.lod !== 'dot'}
          <span class="count" title="{c.children.length} Unterkarten">{c.children.length}</span>
        {/if}
        {#if v.lod !== 'dot' && v.r.w > 70}
          <button class="h zoom" data-handle="zoom" title="Hineinzoomen (Enter)"><Icon name="zoomIn" size={13} /></button>
          <span class="h connect" data-handle="connect" title="Ziehen: Pfeil zu einer anderen Karte"></span>
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
          placeholder="Beschriftung"
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
        <button class="btn icon" title="Richtung umschalten" onclick={() => board.mutate(() => (selLink.directed = !selLink.directed))}>
          <Icon name={selLink.directed ? 'arrow' : 'line'} size={14} />
        </button>
        <button class="btn icon" title="Verbindung löschen" onclick={removeSelected}><Icon name="trash" size={14} /></button>
      </div>
    {/if}

    {#if board.editing && editRect}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="editor ui" style:left="{editRect.x}px" style:top="{editRect.y}px" style:width="{editRect.w}px" onkeydown={editKey}>
        <input bind:this={titleEl} bind:value={draft.title} placeholder="Titel" />
        <textarea bind:value={draft.text} rows="6" placeholder="Text (Markdown) …"></textarea>
        <div class="row">
          <span class="hint">{modLabel}↵ fertig · Esc</span>
          <button class="btn primary" onclick={commitEdit}>Fertig</button>
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
            placeholder={naming === 'new' ? 'Name der neuen Map' : 'Neuer Name'}
            onkeydown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') finishNaming();
              if (e.key === 'Escape') naming = null;
            }}
            onblur={finishNaming}
          />
        {:else}
          <button class="crumb root" onclick={() => board.overview()} ondblclick={() => startNaming('rename')} title="Ganze Map zeigen (0) · Doppelklick: umbenennen">
            {m.title}
          </button>
          <button class="btn icon" onclick={() => (menuOpen = !menuOpen)} aria-label="Maps"><Icon name="chevronDown" size={13} /></button>
        {/if}
        {#if menuOpen}
          <div class="menu">
            {#each board.maps as mi (mi.id)}
              <button class:on={mi.id === m.id} onclick={() => ((menuOpen = false), board.load(mi.id))}>{mi.title}</button>
            {/each}
            <hr />
            <button onclick={() => startNaming('new')}><Icon name="plus" size={13} /> Neue Map</button>
            <button onclick={() => startNaming('rename')}><Icon name="pencil" size={13} /> Umbenennen</button>
            <button class="danger" onclick={() => ((menuOpen = false), board.remove())}><Icon name="trash" size={13} /> Map löschen</button>
          </div>
        {/if}
      </div>
      {#each trail as id (id)}
        <span class="sep">›</span>
        <button class="crumb" onclick={() => flyInto(id)}>{m.cards[id]?.title || 'Ohne Titel'}</button>
      {/each}
    </nav>

    <div class="tools ui">
      <button class="btn" onclick={newCardAtCenter} title="Neue Karte (N) – oder Doppelklick auf eine freie Stelle"><Icon name="plus" size={14} /> Karte</button>
      <button class="btn icon" onclick={up} disabled={!focus} title="Eine Ebene hinauf (Esc)"><Icon name="zoomOut" size={15} /></button>
      <button class="btn icon" onclick={() => board.overview()} title="Ganze Map (0)"><Icon name="fit" size={15} /></button>
      <button class="btn icon" onclick={() => board.undo()} disabled={!board.canUndo} title="Rückgängig ({modLabel}Z)"><Icon name="undo" size={15} /></button>
      <button class="btn icon" onclick={() => board.redo()} disabled={!board.canRedo} title="Wiederholen"><Icon name="redo" size={15} /></button>
    </div>

    {#if board.selection.size && !board.editing}
      <div class="selbar ui">
        {#each COLORS as col (col)}
          <button class="swatch" style:background={col} onclick={() => setColor(col)} aria-label="Farbe {col}"></button>
        {/each}
        <button class="swatch none" onclick={() => setColor(null)} aria-label="Keine Farbe"></button>
        <span class="div"></span>
        {#if board.selection.size === 1}
          <button class="btn icon" title="Bearbeiten (F2)" onclick={() => startEdit([...board.selection][0])}><Icon name="pencil" size={14} /></button>
          <button class="btn icon" title="Hineinzoomen (Enter)" onclick={() => flyInto([...board.selection][0])}><Icon name="zoomIn" size={14} /></button>
        {/if}
        <button class="btn icon" title="Löschen (Entf)" onclick={removeSelected}><Icon name="trash" size={14} /></button>
      </div>
    {/if}

    {#if !m.roots.length}
      <p class="hint-empty">Doppelklick legt eine Karte an. Karten auf andere ziehen macht sie zu Unterkarten, der Punkt am rechten Rand zieht Pfeile.</p>
    {/if}
  {/if}
</section>

<style>
  .board {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
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
  .card.drop,
  .card.wired {
    outline: 2px dashed var(--accent);
    outline-offset: 2px;
    background: color-mix(in srgb, var(--accent) 8%, var(--bg-elev));
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
  .mini {
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
    display: flex;
    gap: 2px;
    padding: 3px;
    border-radius: 9px;
    background: color-mix(in srgb, var(--bg-elev) 92%, transparent);
    box-shadow: var(--shadow);
  }
  .selbar {
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
  .empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 10px;
    color: var(--fg-muted);
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
