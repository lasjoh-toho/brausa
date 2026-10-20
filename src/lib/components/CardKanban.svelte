<script lang="ts">
  /**
   * The project's cards with a status as a Kanban board, modelled on
   * TiddlyVisuals' Kanban: coloured columns with settings, "+" per column,
   * a search with saved searches, swimlanes by the card holding the cards,
   * cards sorted by dragging, a card viewer, full screen. Same data as the map.
   */
  import { tick } from 'svelte';
  import { app } from '../state/app.svelte';
  import { board } from '../state/board.svelte';
  import { drag } from '../state/drag.svelte';
  import { DEFAULT_STATUSES, ancestors, addCard, bounds, columnColor, kanbanOrder, type MapCard } from '../core/map';
  import ColorPalette from './ColorPalette.svelte';
  import BoardSwitch from './BoardSwitch.svelte';
  import Icon from './Icon.svelte';
  import { t, tn } from '../i18n/index.svelte';

  const m = $derived(board.map);
  const k = $derived(m?.kanban ?? {});

  let query = $state('');
  const words = $derived(query.toLowerCase().split(/\s+/).filter(Boolean));
  const matches = (c: MapCard) => !words.length || words.every((w) => `${c.title} ${c.text}`.toLowerCase().includes(w));

  const statuses = $derived.by(() => {
    if (!m) return [];
    const base = m.statuses ?? DEFAULT_STATUSES;
    const extra = [...new Set(Object.values(m.cards).filter((c) => c.status).map((c) => c.status!))].filter((s) => !base.includes(s));
    return [...base, ...extra];
  });
  const cards = $derived(m ? kanbanOrder(m, Object.values(m.cards).filter((c) => c.status && matches(c))) : []);

  /** Swimlanes: the card holding the cards on the map (top level: no lane title). */
  const lanes = $derived.by(() => {
    if (!k.lanes || !m) return [{ key: '', label: '' }];
    const keys = [...new Set(cards.map((c) => c.parent ?? ''))];
    return keys.map((key) => ({ key, label: key ? m.cards[key]?.title || t('map.untitled') : t('map.kanban.topLevel') }));
  });
  const cell = (status: string, lane: string) => cards.filter((c) => c.status === status && (!k.lanes || (c.parent ?? '') === lane));

  /** Default statuses are stored in German; show them in the UI language. */
  const STATUS_KEYS: Record<string, string> = { Offen: 'map.status.open', 'In Arbeit': 'map.status.doing', Erledigt: 'map.status.done' };
  const statusLabel = (s: string) => (STATUS_KEYS[s] ? t(STATUS_KEYS[s]) : s);
  const colOf = (s: string) => k.columns?.[s] ?? {};
  const fileRef = (c: MapCard) => c.refs?.find((r) => r.kind === 'file');
  const path = (c: MapCard) => (m ? ancestors(m, c.id).map((id) => m.cards[id].title || '…').join(' › ') : '');

  $effect(() => {
    for (const c of cards) if (board.isImage(fileRef(c))) board.requestThumb(fileRef(c)!);
  });

  function setKanban(fn: (k: NonNullable<typeof m>['kanban'] & object) => void) {
    board.mutate((mm) => fn((mm.kanban ??= {})));
  }

  // ---------------------------------------------------------------- dragging cards

  let dragging = $state<{ id: string; x: number; y: number; status: string | null; before: string | null } | null>(null);
  let folded = $state(new Set<string>());

  let overThread = false;

  function down(e: PointerEvent, c: MapCard) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    let active = false;
    const move = (ev: PointerEvent) => {
      if (!active && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
      active = true;
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const col = el?.closest<HTMLElement>('[data-status]');
      // Drop before the card under the pointer (upper half) or after it.
      const under = el?.closest<HTMLElement>('[data-kcard]');
      let before: string | null = null;
      if (under && under.dataset.kcard !== c.id) {
        const r = under.getBoundingClientRect();
        before = ev.clientY < r.top + r.height / 2 ? under.dataset.kcard! : (under.nextElementSibling as HTMLElement | null)?.dataset.kcard ?? '__end';
      }
      dragging = { id: c.id, x: ev.clientX, y: ev.clientY, status: col?.dataset.status ?? null, before };
      overThread = !!el?.closest('[data-notes-thread]');
      document.querySelector('[data-notes-thread]')?.classList.toggle('hit', overThread);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const d = dragging;
      dragging = null;
      if (!active) return void (viewing = c.id);
      // Onto the notes & snippets thread: the card goes back into it.
      if (overThread) {
        overThread = false;
        document.querySelector('[data-notes-thread]')?.classList.remove('hit');
        return board.toThread([c.id]);
      }
      if (!d?.status) return;
      const status = d.status === '__none' ? null : d.status;
      board.mutate((mm) => {
        mm.cards[c.id].status = status;
        // New place in the board order.
        const ids = kanbanOrder(mm, Object.values(mm.cards).filter((x) => x.status)).map((x) => x.id).filter((id) => id !== c.id);
        const at = d.before && d.before !== '__end' ? ids.indexOf(d.before) : -1;
        ids.splice(at < 0 ? ids.length : at, 0, c.id);
        (mm.kanban ??= {}).order = ids;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // ---------------------------------------------------------------- columns

  let adding = $state(false);
  let newCol = $state('');
  let settings = $state<string | null>(null);
  let newCard = $state<{ status: string; title: string } | null>(null);

  function addColumn() {
    const name = newCol.trim();
    adding = false;
    newCol = '';
    if (!name || statuses.includes(name)) return;
    board.mutate((mm) => (mm.statuses = [...(mm.statuses ?? DEFAULT_STATUSES), name]));
  }

  function renameColumn(from: string, to: string) {
    to = to.trim();
    if (!to || to === from || statuses.includes(to)) return;
    board.mutate((mm) => {
      mm.statuses = (mm.statuses ?? DEFAULT_STATUSES).map((s) => (s === from ? to : s));
      for (const c of Object.values(mm.cards)) if (c.status === from) c.status = to;
      if (mm.kanban?.columns?.[from]) {
        mm.kanban.columns[to] = mm.kanban.columns[from];
        delete mm.kanban.columns[from];
      }
    });
    settings = to;
  }

  function moveColumn(s: string, by: number) {
    board.mutate((mm) => {
      const list = [...(mm.statuses ?? DEFAULT_STATUSES)];
      const i = list.indexOf(s);
      if (i < 0 || i + by < 0 || i + by >= list.length) return;
      [list[i], list[i + by]] = [list[i + by], list[i]];
      mm.statuses = list;
    });
  }

  function removeColumn(s: string) {
    settings = null;
    // The cards leave the Kanban; they stay on the map.
    board.mutate((mm) => {
      mm.statuses = (mm.statuses ?? DEFAULT_STATUSES).filter((x) => x !== s);
      for (const c of Object.values(mm.cards)) if (c.status === s) c.status = null;
    });
  }

  function setColumn(s: string, patch: { color?: string; view?: 'full' | 'fold' | 'compact' }) {
    setKanban((kk) => {
      kk.columns = { ...kk.columns, [s]: { ...kk.columns?.[s], ...patch } };
    });
  }

  /** "+" in a column: a new card with that status, placed on the map next to the others. */
  function createCard() {
    const n = newCard;
    newCard = null;
    if (!n?.title.trim() || !m) return;
    board.mutate((mm) => {
      const b = bounds(mm, mm.roots);
      const c = addCard(mm, null, { x: b ? b.x : 0, y: b ? b.y + b.h + 40 : 0 }, { title: n.title.trim(), status: n.status });
      (mm.kanban ??= {}).order = [...(mm.kanban.order ?? []), c.id];
    });
  }

  // ---------------------------------------------------------------- saved searches

  let searchesOpen = $state(false);
  function saveSearch() {
    const q = query.trim();
    if (q && !k.searches?.includes(q)) setKanban((kk) => (kk.searches = [...(kk.searches ?? []), q]));
  }

  // ---------------------------------------------------------------- viewer

  let viewing = $state<string | null>(null);
  const viewed = $derived(viewing && m ? m.cards[viewing] : null);

  async function showOnMap(id: string) {
    viewing = null;
    board.setMode('map');
    await tick();
    requestAnimationFrame(() => board.reveal(id));
  }

  function isUndo(e: KeyboardEvent) {
    const el = e.target as HTMLElement;
    return (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA';
  }

  function autofocus(n: HTMLElement) {
    n.focus();
  }
</script>

<section class="ck">
  <header>
    <span class="title">{m?.title ?? ''} · Kanban</span>
    <div class="search">
      <Icon name="search" size={13} />
      <input bind:value={query} placeholder={t('map.kanban.search')} />
      <button class="btn icon" class:on={searchesOpen} onclick={() => (searchesOpen = !searchesOpen)} title={t('map.kanban.saved')}><Icon name="chevronDown" size={12} /></button>
      {#if searchesOpen}
        <div class="pop">
          {#each k.searches ?? [] as s (s)}
            <div class="row">
              <button class="pick" onclick={() => ((query = s), (searchesOpen = false))}>{s}</button>
              <button class="btn icon" onclick={() => setKanban((kk) => (kk.searches = (kk.searches ?? []).filter((x) => x !== s)))} aria-label="−">−</button>
            </div>
          {:else}
            <p class="muted">{t('map.kanban.noSaved')}</p>
          {/each}
          <button class="btn" disabled={!query.trim()} onclick={saveSearch}><Icon name="plus" size={12} />{t('map.kanban.saveSearch')}</button>
        </div>
      {/if}
    </div>
    <label class="lanes" title={t('map.kanban.lanesHint')}>
      <input type="checkbox" checked={!!k.lanes} onchange={(e) => setKanban((kk) => (kk.lanes = e.currentTarget.checked))} />{t('map.kanban.lanes')}
    </label>
    <div class="right">
      <button class="btn icon" class:on={app.presenting} onclick={() => app.setPresenting(!app.presenting)} title={t('map.kanban.fullscreen')}><Icon name="fit" size={14} /></button>
      <BoardSwitch />
    </div>
  </header>

  <div class="board">
    <div class="heads" style:--n={statuses.length}>
      {#each statuses as s (s)}
        {@const col = colOf(s)}
        <div class="colhead" style:--cc={m ? columnColor(m, s) : 'var(--fg-faint)'} ondblclick={() => (settings = s)} role="presentation">
          <span class="dot"></span>
          <span class="name">{statusLabel(s)}</span>
          <span class="n">{cards.filter((c) => c.status === s).length}</span>
          <button class="btn icon" onclick={() => (newCard = { status: s, title: '' })} title={t('map.kanban.addCard')}><Icon name="plus" size={12} /></button>
          <button class="btn icon" class:on={settings === s} onclick={() => (settings = settings === s ? null : s)} title={t('map.kanban.columnSettings')}><Icon name="gear" size={12} /></button>
          {#if settings === s}
            <div class="pop colset">
              <input value={s} onchange={(e) => renameColumn(s, e.currentTarget.value)} />
              <div class="swatches">
                <ColorPalette value={m ? columnColor(m, s) : null} allowNone={false} onpick={(c) => c && setColumn(s, { color: c })} />
              </div>
              <div class="seg">
                {#each ['full', 'fold', 'compact'] as const as v (v)}
                  <button class="btn" class:on={(col.view ?? 'full') === v} onclick={() => setColumn(s, { view: v })}>{t(`map.kanban.view.${v}`)}</button>
                {/each}
              </div>
              <div class="row">
                <button class="btn icon" onclick={() => moveColumn(s, -1)} aria-label={t('map.kanban.left')}><Icon name="back" size={12} /></button>
                <button class="btn icon" onclick={() => moveColumn(s, 1)} aria-label={t('map.kanban.right')}><Icon name="forward" size={12} /></button>
                <span class="grow"></span>
                <button class="btn danger" onclick={() => removeColumn(s)}>{t('map.kanban.removeColumn')}</button>
              </div>
            </div>
          {/if}
        </div>
      {/each}
      <div class="colhead add">
        {#if adding}
          <input use:autofocus bind:value={newCol} placeholder={t('map.kanban.columnName')} onkeydown={(e) => (e.key === 'Enter' ? addColumn() : e.key === 'Escape' && (adding = false))} onblur={addColumn} />
        {:else}
          <button class="btn" onclick={() => (adding = true)}><Icon name="plus" size={13} /> {t('map.kanban.column')}</button>
        {/if}
      </div>
    </div>

    {#each lanes as lane (lane.key)}
      {#if k.lanes}<div class="lane">{lane.label}</div>{/if}
      <div class="row-cells" style:--n={statuses.length}>
        {#each statuses as s (s)}
          {@const col = colOf(s)}
          <div
            class="cell"
            class:over={dragging?.status === s || (drag.active && drag.hit?.kind === 'kanban' && drag.hit.key === s)}
            data-status={s}
            data-drop="kanban"
            data-key={s}
            style:--cc={m ? columnColor(m, s) : 'var(--fg-faint)'}
          >
            {#if newCard?.status === s && lane.key === lanes[0].key}
              <input class="newcard" use:autofocus bind:value={newCard.title} placeholder={t('map.kanban.cardTitle')} onkeydown={(e) => (e.key === 'Enter' ? createCard() : e.key === 'Escape' && (newCard = null))} onblur={createCard} />
            {/if}
            {#each cell(s, lane.key) as c (c.id)}
              {@const r = fileRef(c)}
              {@const pic = r && board.isImage(r) ? board.thumbs.get(r.path!) : null}
              {@const view = col.view ?? 'full'}
              <div
                class="card {view}"
                class:ghost={dragging?.id === c.id}
                class:before={dragging?.before === c.id}
                data-kcard={c.id}
                style:--c={c.color ?? 'var(--line)'}
                role="button"
                tabindex="-1"
                onpointerdown={(e) => down(e, c)}
              >
                {#if view === 'full' && pic}<img src={pic} alt="" draggable="false" />{/if}
                <div class="t">
                  {c.title || t('map.untitled')}
                  {#if view === 'fold'}
                    <button class="btn icon fold" onclick={() => (folded = folded.has(c.id) ? new Set([...folded].filter((x) => x !== c.id)) : new Set([...folded, c.id]))} aria-label="↕">↕</button>
                  {/if}
                </div>
                {#if view === 'full' || (view === 'fold' && folded.has(c.id))}
                  {#if c.text}<div class="x">{c.text.slice(0, 220)}</div>{/if}
                  {#if path(c) && !k.lanes}<div class="p">{path(c)}</div>{/if}
                  {#if c.refs?.length}
                    <div class="refs">
                      {#each c.refs as ref, i (ref.id ?? i)}
                        <button class="ref" class:missing={ref.missing} onclick={() => board.openRef(ref)}><Icon name={ref.dir ? 'folder' : 'file'} size={11} />{ref.name}</button>
                      {/each}
                    </div>
                  {/if}
                {/if}
              </div>
            {/each}
          </div>
        {/each}
      </div>
    {/each}
    <div class="none" class:over={dragging?.status === '__none'} data-status="__none">{t('map.kanban.dropRemove')}</div>
  </div>

  {#if dragging}
    {@const c = m?.cards[dragging.id]}
    <div class="float" style:left="{dragging.x + 8}px" style:top="{dragging.y + 8}px">{c?.title || t('map.untitled')}</div>
  {/if}
  {#if m && !cards.length}
    <p class="empty">{query ? t('map.kanban.nothingFound') : t('map.kanban.empty')}</p>
  {/if}

  {#if viewed}
    <div class="viewer-bg" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && (viewing = null)}>
      <div class="viewer" role="dialog" aria-label={viewed.title}>
        <input class="vt" value={viewed.title} onchange={(e) => board.mutate((mm) => (mm.cards[viewed.id].title = e.currentTarget.value))} />
        <div class="vrow">
          <select value={viewed.status ?? ''} onchange={(e) => board.mutate((mm) => (mm.cards[viewed.id].status = e.currentTarget.value || null))}>
            {#each statuses as s (s)}<option value={s}>{statusLabel(s)}</option>{/each}
            <option value="">{t('map.kanban.notOnBoard')}</option>
          </select>
          <div class="swatches">
            <ColorPalette value={viewed.color ?? null} onpick={(c) => board.mutate((mm) => (mm.cards[viewed.id].color = c))} />
          </div>
        </div>
        <textarea rows="10" value={viewed.text} onchange={(e) => board.mutate((mm) => (mm.cards[viewed.id].text = e.currentTarget.value))}></textarea>
        {#if path(viewed)}<p class="muted">{path(viewed)}</p>{/if}
        <div class="vrow">
          <button class="btn" onclick={() => showOnMap(viewed.id)}><Icon name="nodes" size={13} />{t('map.kanban.showOnMap')}</button>
          <span class="grow"></span>
          <button class="btn primary" onclick={() => (viewing = null)}>{t('common.done')}</button>
        </div>
      </div>
    </div>
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
  .search {
    position: relative;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 4px 0 8px;
    border-radius: 8px;
    background: var(--bg-sunken);
    color: var(--fg-faint);
  }
  .search input {
    width: 180px;
    padding: 5px 0;
    border: 0;
    background: none;
    color: var(--fg);
    font: inherit;
    font-size: 13px;
    outline: none;
  }
  .pop {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 30;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 220px;
    padding: 8px;
    border-radius: 10px;
    background: var(--bg-elev);
    box-shadow:
      var(--shadow),
      0 0 0 1px var(--line);
    color: var(--fg);
  }
  .pop .row {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .pick {
    flex: 1;
    padding: 4px 6px;
    border-radius: 6px;
    text-align: left;
    font-size: 13px;
  }
  .pick:hover {
    background: var(--bg-sunken);
  }
  .muted {
    margin: 0;
    font-size: 12px;
    color: var(--fg-faint);
  }
  .lanes {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    color: var(--fg-muted);
  }
  .right {
    margin-left: auto;
    display: flex;
    gap: 4px;
  }
  .board {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 0 14px 14px;
  }
  .heads,
  .row-cells {
    display: grid;
    grid-template-columns: repeat(var(--n), 270px) 200px;
    gap: 12px;
  }
  .row-cells {
    grid-template-columns: repeat(var(--n), 270px);
  }
  .colhead {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 9px 10px;
    border-radius: 10px 10px 0 0;
    background: color-mix(in srgb, var(--cc) 16%, var(--bg-sunken));
    font-weight: 600;
  }
  .colhead.add {
    background: none;
  }
  .colhead.add input {
    width: 100%;
    padding: 5px 8px;
    border-radius: 7px;
    border: 1px solid var(--line);
    background: var(--bg-elev);
    color: var(--fg);
  }
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--cc);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .n {
    color: var(--fg-faint);
    font-weight: 500;
    font-size: 12px;
  }
  .colset {
    left: auto;
    right: 0;
    font-weight: 400;
  }
  .colset input {
    padding: 4px 6px;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--fg);
    font: inherit;
  }
  .swatches {
    display: flex;
    gap: 5px;
  }
  .sw {
    width: 16px;
    height: 16px;
    border-radius: 50%;
  }
  .sw.on {
    box-shadow:
      0 0 0 2px var(--bg-elev),
      0 0 0 3.5px var(--fg-muted);
  }
  .seg {
    display: flex;
    gap: 2px;
  }
  .seg .btn {
    flex: 1;
    font-size: 11px;
  }
  .grow {
    flex: 1;
  }
  .danger {
    color: var(--danger);
  }
  .lane {
    margin: 10px 0 4px;
    padding-bottom: 2px;
    border-bottom: 1px dashed var(--line);
    font-size: 12px;
    font-weight: 600;
    color: var(--fg-muted);
  }
  .cell {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 60px;
    padding: 6px 8px 10px;
    background: color-mix(in srgb, var(--cc) 7%, var(--bg-sunken));
  }
  .cell.over {
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .newcard {
    padding: 6px 8px;
    border-radius: 7px;
    border: 1px solid var(--accent);
    background: var(--bg-elev);
    color: var(--fg);
    font: inherit;
  }
  .card {
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--bg-elev);
    border-left: 3px solid var(--c);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
    cursor: grab;
  }
  .card.compact {
    padding: 4px 8px;
  }
  .card.compact .t {
    font-weight: 500;
    font-size: 12.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .card.ghost {
    opacity: 0.4;
  }
  .card.before {
    box-shadow: 0 -3px 0 var(--accent);
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
    display: flex;
    align-items: center;
    gap: 4px;
    font-weight: 600;
  }
  .fold {
    margin-left: auto;
    font-size: 11px;
  }
  .x {
    margin-top: 4px;
    font-size: 12px;
    color: var(--fg-muted);
    white-space: pre-wrap;
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
  .none {
    margin-top: 12px;
    padding: 14px 12px;
    font-size: 12px;
    color: var(--fg-faint);
    border: 1px dashed var(--line);
    border-radius: 10px;
  }
  .none.over {
    box-shadow: inset 0 0 0 2px var(--accent);
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
  .viewer-bg {
    position: absolute;
    inset: 0;
    z-index: 40;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.18);
  }
  .viewer {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: min(620px, calc(100% - 32px));
    max-height: calc(100% - 32px);
    overflow: auto;
    padding: 16px;
    border-radius: 14px;
    background: var(--bg-elev);
    box-shadow:
      var(--shadow),
      0 0 0 1px var(--line);
  }
  .vt {
    padding: 4px 6px;
    border: 0;
    border-bottom: 1px solid var(--line);
    background: none;
    color: var(--fg);
    font: 650 17px var(--font);
  }
  .vrow {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .vrow select,
  textarea {
    padding: 6px 8px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--fg);
    font: inherit;
  }
  textarea {
    resize: vertical;
  }
  .vrow .btn {
    gap: 5px;
  }
</style>
