<script lang="ts">
  import { tick } from 'svelte';
  import { app } from '../state/app.svelte';
  import { board } from '../state/board.svelte';
  import { DEFAULT_STATUSES, ancestors, type MapCard } from '../core/map';
  import BoardSwitch from './BoardSwitch.svelte';
  import Icon from './Icon.svelte';

  /** The project's cards with a status, as columns. Same data as the map, another view. */
  const m = $derived(board.map);
  const columns = $derived.by(() => {
    if (!m) return [];
    const base = m.statuses ?? DEFAULT_STATUSES;
    const cards = Object.values(m.cards).filter((c) => c.status);
    const extra = [...new Set(cards.map((c) => c.status!))].filter((s) => !base.includes(s));
    return [...base, ...extra].map((s) => ({ status: s, cards: cards.filter((c) => c.status === s) }));
  });

  const fileRef = (c: MapCard) => c.refs?.find((r) => r.kind === 'file');

  $effect(() => {
    for (const col of columns) for (const c of col.cards) if (board.isImage(fileRef(c))) board.requestThumb(fileRef(c)!);
  });

  const path = (c: MapCard) => (m ? ancestors(m, c.id).map((id) => m.cards[id].title || '…').join(' › ') : '');

  let dragging = $state<{ id: string; x: number; y: number; over: string | null } | null>(null);

  function down(e: PointerEvent, c: MapCard) {
    if (e.button !== 0) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    let active = false;
    const move = (ev: PointerEvent) => {
      if (!active && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
      active = true;
      const col = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-status]');
      dragging = { id: c.id, x: ev.clientX, y: ev.clientY, over: col?.dataset.status ?? null };
    };
    const up = async () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const d = dragging;
      dragging = null;
      if (!active) {
        // Click: show the card where it lives on the map.
        board.setMode('map');
        await tick();
        requestAnimationFrame(() => board.reveal(c.id));
        return;
      }
      if (!d?.over) return;
      const status = d.over === '__none' ? null : d.over;
      if (status !== c.status) board.mutate((mm) => (mm.cards[c.id].status = status));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  let adding = $state(false);
  let newCol = $state('');

  function addColumn() {
    const name = newCol.trim();
    adding = false;
    newCol = '';
    if (!name || columns.some((c) => c.status === name)) return;
    board.mutate((mm) => (mm.statuses = [...(mm.statuses ?? DEFAULT_STATUSES), name]));
  }

  function isUndo(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    return (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && t.tagName !== 'INPUT';
  }

  function autofocus(n: HTMLElement) {
    n.focus();
  }
</script>

<section class="ck">
  <header>
    <span class="title">{m?.title ?? ''} · Kanban</span>
    <span class="hint">Karten kommen über „Kanban“ in der Map hierher. Klick zeigt die Karte auf der Map.</span>
    <div class="right"><BoardSwitch /></div>
  </header>

  <div class="cols">
    {#each columns as col (col.status)}
      <div class="col" class:over={dragging?.over === col.status} data-status={col.status}>
        <div class="col-head">{col.status}<span class="n">{col.cards.length}</span></div>
        <div class="col-body">
          {#each col.cards as c (c.id)}
            {@const r = fileRef(c)}
            {@const pic = r && board.isImage(r) ? board.thumbs.get(r.path!) : null}
            <div
              class="card"
              class:ghost={dragging?.id === c.id}
              style:--c={c.color ?? 'var(--line)'}
              role="button"
              tabindex="-1"
              onpointerdown={(e) => down(e, c)}
            >
              {#if pic}<img src={pic} alt="" draggable="false" />{/if}
              <div class="t">{c.title || 'Ohne Titel'}</div>
              {#if path(c)}<div class="p">{path(c)}</div>{/if}
              {#if c.refs?.length}
                <div class="refs">
                  {#each c.refs as ref, i (ref.id ?? i)}
                    <button
                      class="ref"
                      class:missing={ref.missing}
                      onpointerdown={(e) => e.stopPropagation()}
                      onclick={() => board.openRef(ref)}><Icon name={ref.dir ? 'folder' : 'file'} size={11} />{ref.name}</button
                    >
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/each}
    <div class="col add">
      {#if adding}
        <input
          use:autofocus
          bind:value={newCol}
          placeholder="Name der Spalte"
          onkeydown={(e) => {
            if (e.key === 'Enter') addColumn();
            if (e.key === 'Escape') adding = false;
          }}
          onblur={addColumn}
        />
      {:else}
        <button class="btn" onclick={() => (adding = true)}><Icon name="plus" size={13} /> Spalte</button>
      {/if}
      <div class="col none" class:over={dragging?.over === '__none'} data-status="__none">Hierher ziehen: aus dem Kanban nehmen</div>
    </div>
  </div>

  {#if dragging}
    {@const c = m?.cards[dragging.id]}
    <div class="float" style:left="{dragging.x + 8}px" style:top="{dragging.y + 8}px">{c?.title || 'Ohne Titel'}</div>
  {/if}
  {#if m && !columns.some((c) => c.cards.length)}
    <p class="empty">Noch keine Karten im Kanban. Karte in der Map auswählen und unten auf „Kanban“ klicken.</p>
  {/if}
</section>

<svelte:window onkeydown={(e) => app.view === 'board' && isUndo(e) && (e.shiftKey ? board.redo() : board.undo())} />

<style>
  .ck {
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
  }
  .title {
    font-weight: 650;
  }
  .hint {
    font-size: 12px;
    color: var(--fg-faint);
  }
  .right {
    margin-left: auto;
    display: flex;
    gap: 4px;
  }
  .cols {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 12px;
    padding: 4px 14px 14px;
    overflow-x: auto;
  }
  .col {
    flex: none;
    width: 270px;
    display: flex;
    flex-direction: column;
    border-radius: 10px;
    background: var(--bg-sunken);
  }
  .col.over {
    box-shadow: inset 0 0 0 2px var(--accent);
    background: var(--accent-soft);
  }
  .col-head {
    display: flex;
    justify-content: space-between;
    padding: 10px 12px 6px;
    font-weight: 600;
  }
  .n {
    color: var(--fg-faint);
    font-weight: 500;
  }
  .col-body {
    flex: 1;
    overflow-y: auto;
    padding: 4px 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .card {
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--bg-elev);
    border-left: 3px solid var(--c);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
    cursor: grab;
  }
  .card.ghost {
    opacity: 0.4;
  }
  .card img {
    display: block;
    width: 100%;
    height: 110px;
    object-fit: cover;
    border-radius: 5px;
    margin-bottom: 6px;
  }
  .t {
    font-weight: 600;
  }
  .p {
    font-size: 11px;
    color: var(--fg-faint);
    margin-top: 2px;
  }
  .refs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 6px;
  }
  .ref {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 7px;
    border-radius: 6px;
    font-size: 11px;
    color: var(--fg-muted);
    background: var(--bg-sunken);
  }
  .ref:hover {
    color: var(--accent);
  }
  .ref.missing {
    text-decoration: line-through;
    color: var(--danger);
  }
  .add {
    background: none;
    gap: 10px;
  }
  .add input {
    padding: 6px 8px;
    border-radius: 7px;
    border: 1px solid var(--line);
    background: var(--bg-elev);
    color: var(--fg);
  }
  .col.none {
    width: auto;
    padding: 18px 12px;
    font-size: 12px;
    color: var(--fg-faint);
    border: 1px dashed var(--line);
    background: none;
  }
  .float {
    position: fixed;
    z-index: 50;
    padding: 6px 10px;
    border-radius: 8px;
    background: var(--bg-elev);
    box-shadow: var(--shadow);
    pointer-events: none;
    font-weight: 600;
  }
  .empty {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    color: var(--fg-faint);
    pointer-events: none;
  }
</style>
