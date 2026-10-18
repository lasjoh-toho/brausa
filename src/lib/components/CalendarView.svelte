<script lang="ts">
  /**
   * Zoomable calendar heatmap. Three zoom levels: all years (months as cells),
   * one year (days, GitHub-style) and one month (large day cells with a photo).
   * Drag across cells to select a date range; it filters every view.
   * Double-click or ⌘/Ctrl + scroll (pinch on trackpads) zooms in and out.
   */
  import { app } from '../state/app.svelte';
  import {
    countDates,
    dateOf,
    DATE_FIELD_LABEL,
    dayKey,
    formatRange,
    frameRange,
    level,
    unionRange,
    weekdayOf,
    yearRange,
    type DateRange,
    monthGrid,
    monthRange,
    yearGrid,
    type CalLevel,
    type DateField
  } from '../core/dates';
  import { family } from '../core/format';
  import type { Entry } from '../core/types';
  import Icon from './Icon.svelte';

  const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

  const counts = $derived(countDates(app.undated, app.dateField));
  const years = $derived.by(() => {
    if (counts.min === null || counts.max === null) return [new Date().getFullYear()];
    const a = new Date(counts.min).getFullYear();
    const b = new Date(counts.max).getFullYear();
    return Array.from({ length: b - a + 1 }, (_, i) => b - i); // newest first
  });

  let zoom = $state<CalLevel | null>(null);
  let year = $state<number | null>(null);
  let month = $state(0);
  /** Year opened below the overview (click on a year), as a day heatmap with weekdays. */
  let openYear = $state<number | null>(null);

  // Pick a sensible starting zoom once data is there: one year if it all fits, else the overview.
  const lvl = $derived<CalLevel>(zoom ?? (years.length > 1 ? 'years' : 'year'));
  const y = $derived(year ?? years[0]);

  const maxMonth = $derived(Math.max(1, ...counts.months.values()));
  const maxDay = $derived(Math.max(1, ...counts.days.values()));

  // First image per day, for the month view.
  const cover = $derived.by(() => {
    const m = new Map<string, Entry>();
    if (lvl !== 'month') return m;
    for (const e of app.undated) {
      if (e.kind !== 'file' || family(e.ext) !== 'image') continue;
      const k = dayKey(dateOf(e, app.dateField));
      if (!m.has(k)) m.set(k, e);
    }
    return m;
  });

  // ------------------------------------------------------------ brushing

  let brush = $state<DateRange | null>(null);
  const shown = $derived(brush ?? app.dateFilter);

  function cellRange(el: Element | null): [number, number] | null {
    const c = el?.closest<HTMLElement>('[data-from]');
    return c ? [Number(c.dataset.from), Number(c.dataset.to)] : null;
  }

  /** A day cell of the year heatmap: its week column and weekday row. */
  function gridCell(el: Element | null): { date: number; col: number; row: number } | null {
    const c = el?.closest<HTMLElement>('[data-row]');
    return c ? { date: Number(c.dataset.from), col: Number(c.dataset.col), row: Number(c.dataset.row) } : null;
  }

  /**
   * Drag across cells to choose a date range. In the year heatmap the drag
   * draws a frame: weeks across, weekdays down, so a frame over the Monday row
   * picks every Monday in those weeks. ⌘/Strg adds to the current selection.
   */
  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    const r = cellRange(e.target as Element);
    if (!r) return;
    e.preventDefault();
    const anchor = gridCell(e.target as Element);
    const add = (e.metaKey || e.ctrlKey) && app.dateFilter ? app.dateFilter : null;
    const span = (to: Element | null): DateRange | null => {
      if (anchor) {
        const g = gridCell(to);
        return g ? frameRange(app.dateField, anchor, g) : null;
      }
      const c = cellRange(to);
      return c ? { field: app.dateField, from: Math.min(r[0], c[0]), to: Math.max(r[1], c[1]) } : null;
    };
    brush = span(e.target as Element);
    const move = (ev: PointerEvent) => {
      const next = span(document.elementFromPoint(ev.clientX, ev.clientY));
      if (next) brush = next;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!brush) return;
      const f = app.dateFilter;
      const same = f && f.from === brush.from && f.to === brush.to && String(f.weekdays) === String(brush.weekdays);
      // Clicking the exact current selection again clears it.
      if (same && !add) app.setDateFilter(null);
      else app.setDateFilter(add ? unionRange(add, brush) : brush);
      brush = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /** Click on a weekday label: only that weekday (or add/remove it) in the selected span. */
  function toggleWeekday(w: number) {
    const f = app.dateFilter;
    if (!f) {
      const [from, to] = yearRange(heatYear ?? y);
      return app.setDateFilter({ field: app.dateField, from, to, weekdays: [w] });
    }
    const cur = f.weekdays ?? [0, 1, 2, 3, 4, 5, 6];
    const next = cur.includes(w) ? cur.filter((x) => x !== w) : [...cur, w].sort((a, b) => a - b);
    if (!next.length) return app.setDateFilter({ ...f, weekdays: undefined });
    app.setDateFilter({ ...f, weekdays: next.length === 7 ? undefined : next });
  }

  function selected(from: number, to: number) {
    if (!shown || from < shown.from || to > shown.to) return false;
    // Day cells also have to be on a chosen weekday; month cells count when inside the span.
    return !shown.weekdays || to - from > 1.5 * 86400e3 || shown.weekdays.includes(weekdayOf(from));
  }

  // ------------------------------------------------------------ zoom

  function zoomInto(from: number) {
    const d = new Date(from);
    if (lvl === 'years') {
      year = d.getFullYear();
      month = d.getMonth();
      zoom = 'year';
    } else if (lvl === 'year') {
      year = d.getFullYear();
      month = d.getMonth();
      zoom = 'month';
    }
  }

  function zoomOut() {
    if (lvl === 'month') zoom = 'year';
    else if (lvl === 'year' && years.length > 1) zoom = 'years';
  }

  function dbl(e: MouseEvent) {
    const r = cellRange(e.target as Element);
    if (r) zoomInto(r[0]);
  }

  function wheel(e: WheelEvent) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    if (e.deltaY < 0) {
      const r = cellRange(e.target as Element);
      if (r) zoomInto(r[0]);
    } else zoomOut();
  }

  function step(d: number) {
    if (lvl === 'year') year = y + d;
    else if (lvl === 'month') {
      const n = new Date(y, month + d, 1);
      year = n.getFullYear();
      month = n.getMonth();
    }
  }

  function setField(f: DateField) {
    app.setDateField(f);
  }

  // The day heatmap is shown at the year level, and below the overview for the opened year.
  const heatYear = $derived(lvl === 'year' ? y : lvl === 'years' && openYear !== null && years.includes(openYear) ? openYear : null);
  const yg = $derived(heatYear !== null ? yearGrid(heatYear) : []);
  /** Files per weekday (Mo … So) in the shown year. */
  const perWeekday = $derived.by(() => {
    const sums = Array(7).fill(0);
    for (const d of yg) sums[d.row] += counts.days.get(d.key) ?? 0;
    return sums;
  });
  const maxWeekday = $derived(Math.max(1, ...perWeekday));
  const ycols = $derived(yg.length ? yg[yg.length - 1].col + 1 : 53);
  const monthStarts = $derived(
    yg.filter((d) => d.key.endsWith('-01')).map((d) => ({ col: d.col, label: MONTHS[new Date(d.date).getMonth()], m: new Date(d.date).getMonth() }))
  );
  const mg = $derived(lvl === 'month' ? monthGrid(y, month) : { lead: 0, days: [] });

  $effect(() => {
    // Request photos for the month view.
    for (const e of cover.values()) app.requestThumb(e);
  });
</script>

{#snippet heatmap()}
  <div class="year" style:--cols={ycols}>
    <div class="months" style:grid-template-columns="repeat({ycols}, 1fr)">
      {#each monthStarts as ms (ms.m)}
        <button class="mlabel" style:grid-column="{ms.col + 1} / span 4" onclick={() => ((year = heatYear), (month = ms.m), (zoom = 'month'))}>{ms.label}</button>
      {/each}
    </div>
    <div class="wd">
      {#each WEEKDAYS as w, i (w)}
        <button class:we={i > 4} class:on={!!app.dateFilter?.weekdays?.includes(i)} onclick={() => toggleWeekday(i)} title="Nur {w} (Klick schaltet um)">{w}</button>
      {/each}
    </div>
    <div class="days" style:grid-template-columns="repeat({ycols}, 1fr)">
      {#each yg as d (d.key)}
        {@const n = counts.days.get(d.key) ?? 0}
        <div
          class="cell l{level(n, maxDay)}"
          class:we={d.row > 4}
          class:sel={selected(d.date, d.date + 86400e3)}
          style:grid-column={d.col + 1}
          style:grid-row={d.row + 1}
          data-row={d.row}
          data-col={d.col}
          data-from={d.date}
          data-to={new Date(new Date(d.date).setDate(new Date(d.date).getDate() + 1)).getTime()}
          title="{new Date(d.date).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'long' })}: {n} Dateien"
        ></div>
      {/each}
    </div>
    <div class="wsum" title="Dateien je Wochentag in {heatYear}">
      {#each perWeekday as n, i (i)}
        <span><i style:width="{(n / maxWeekday) * 100}%"></i><em>{n}</em></span>
      {/each}
    </div>
  </div>
{/snippet}

<div class="cal" role="application" aria-label="Kalender">
  <div class="head">
    <nav class="zoom">
      {#if years.length > 1}
        <button class="crumb" class:on={lvl === 'years'} onclick={() => (zoom = 'years')}>Alle Jahre</button>
      {/if}
      {#if lvl !== 'years'}
        {#if years.length > 1}<span class="sep">›</span>{/if}
        <button class="crumb" class:on={lvl === 'year'} onclick={() => (zoom = 'year')}>{y}</button>
      {/if}
      {#if lvl === 'month'}
        <span class="sep">›</span><span class="crumb on">{new Date(y, month).toLocaleDateString('de-DE', { month: 'long' })}</span>
      {/if}
      {#if lvl !== 'years'}
        <span class="steps">
          <button class="btn icon" onclick={() => step(-1)} aria-label="Zurück"><Icon name="back" size={14} /></button>
          <button class="btn icon" onclick={() => step(1)} aria-label="Weiter"><Icon name="forward" size={14} /></button>
        </span>
      {/if}
    </nav>

    <div class="seg">
      {#each ['mtime', 'ctime', 'taken'] as const as f (f)}
        <button class="btn" class:on={app.dateField === f} onclick={() => setField(f)}>{DATE_FIELD_LABEL[f]}</button>
      {/each}
    </div>

    {#if app.dateFilter}
      <span class="chip sel">
        {formatRange(app.dateFilter)} · {app.visible.length}
        <button onclick={() => app.setDateFilter(null)} aria-label="Zeitfilter entfernen"><Icon name="x" size={11} /></button>
      </span>
    {/if}
  </div>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="body" onpointerdown={down} ondblclick={dbl} onwheel={wheel}>
    {#if lvl === 'years'}
      <div class="years">
        <span></span>
        {#each MONTHS as m (m)}<span class="mlabel">{m}</span>{/each}
        {#each years as yr (yr)}
          <button class="ylabel" class:open={openYear === yr} title="Tage und Wochentage von {yr} zeigen" onclick={() => (openYear = openYear === yr ? null : yr)}>
            {yr} <Icon name={openYear === yr ? 'chevronDown' : 'chevron'} size={10} />
          </button>
          {#each MONTHS as _, m (m)}
            {@const [from, to] = monthRange(yr, m)}
            {@const n = counts.months.get(`${yr}-${String(m + 1).padStart(2, '0')}`) ?? 0}
            <div
              class="cell big l{level(n, maxMonth)}"
              class:sel={selected(from, to)}
              data-from={from}
              data-to={to}
              title="{MONTHS[m]} {yr}: {n} Dateien"
            >
              {#if n}<span class="n">{n}</span>{/if}
            </div>
          {/each}
        {/each}
      </div>
      {#if heatYear !== null}
        <div class="opened">
          <div class="otitle">
            <b>{heatYear}</b>
            <button class="btn" onclick={() => ((year = heatYear), (zoom = 'year'))}>Ganz öffnen</button>
            <button class="btn icon" onclick={() => (openYear = null)} aria-label="Schließen"><Icon name="x" size={12} /></button>
          </div>
          {@render heatmap()}
        </div>
      {/if}
    {:else if lvl === 'year'}
      {@render heatmap()}
    {:else}
      <div class="month">
        {#each WEEKDAYS as w (w)}<span class="wdh">{w}</span>{/each}
        {#each Array(mg.lead) as _, i (i)}<span></span>{/each}
        {#each mg.days as d (d.key)}
          {@const n = counts.days.get(d.key) ?? 0}
          {@const c = cover.get(d.key)}
          {@const src = c ? app.thumbOf(c) : null}
          <div
            class="cell day l{level(n, maxDay)}"
            class:sel={selected(d.date, d.date + 86400e3)}
            data-from={d.date}
            data-to={new Date(new Date(d.date).setDate(d.day + 1)).getTime()}
          >
            {#if src}<img {src} alt="" draggable="false" />{/if}
            <span class="dnum">{d.day}</span>
            {#if n}<span class="dn">{n}</span>{/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <div class="legend">
    <span>Ziehen: Zeitraum wählen, in der Jahres-Heatmap als Rahmen über Wochen und Wochentage · ⌘/Strg + Ziehen fügt hinzu · Klick auf Mo … So: nur diese Tage · Doppelklick oder ⌘/Strg + Scrollen: zoomen</span>
    <span class="scale">weniger {#each [0, 1, 2, 3, 4] as l (l)}<i class="cell l{l}"></i>{/each} mehr</span>
  </div>
</div>

<style>
  .cal {
    margin-bottom: 18px;
    padding: 12px 14px 10px;
    border-radius: 14px;
    background: var(--bg-elev);
    box-shadow: 0 0 0 1px var(--line);
    user-select: none;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 10px;
  }
  .zoom {
    display: flex;
    align-items: center;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }
  .crumb {
    padding: 3px 7px;
    border-radius: 6px;
    color: var(--fg-muted);
    font-weight: 500;
  }
  .crumb.on {
    color: var(--fg);
    font-weight: 650;
    font-size: 14px;
  }
  button.crumb:hover {
    background: var(--bg-sunken);
  }
  .sep {
    color: var(--fg-faint);
  }
  .steps {
    display: inline-flex;
    margin-left: 6px;
  }
  .icon {
    padding: 0 5px;
    height: 24px;
  }
  .chip.sel {
    background: var(--accent);
    color: #fff;
    height: 24px;
    font-size: 12px;
  }
  .chip.sel button {
    display: grid;
    color: inherit;
  }

  /* intensity scale */
  .cell {
    border-radius: 3px;
    background: var(--bg-sunken);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--fg) 4%, transparent);
  }
  .l1 {
    background: color-mix(in srgb, var(--accent) 22%, var(--bg-sunken));
  }
  .l2 {
    background: color-mix(in srgb, var(--accent) 45%, var(--bg-sunken));
  }
  .l3 {
    background: color-mix(in srgb, var(--accent) 70%, var(--bg-sunken));
  }
  .l4 {
    background: var(--accent);
  }
  .cell.sel {
    box-shadow:
      0 0 0 1.5px var(--bg-elev),
      0 0 0 3px var(--attr);
    position: relative;
    z-index: 1;
  }
  .body {
    cursor: crosshair;
    touch-action: none;
  }

  .years {
    display: grid;
    grid-template-columns: 48px repeat(12, 1fr);
    gap: 4px;
  }
  .mlabel {
    font-size: 10px;
    color: var(--fg-faint);
    text-align: left;
    white-space: nowrap;
  }
  .ylabel {
    font-size: 12px;
    font-weight: 600;
    color: var(--fg-muted);
    text-align: left;
  }
  .ylabel:hover {
    color: var(--accent);
  }
  .cell.big {
    height: 30px;
    display: grid;
    place-items: center;
  }
  .n {
    font-size: 10px;
    font-weight: 600;
    color: var(--fg);
    mix-blend-mode: luminosity;
  }
  .l3 .n,
  .l4 .n {
    color: #fff;
    mix-blend-mode: normal;
  }

  .opened {
    margin-top: 14px;
    padding-top: 10px;
    border-top: 1px solid var(--line);
  }
  .otitle {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
    font-size: 13px;
  }
  .ylabel {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .ylabel.open {
    color: var(--accent);
  }
  .wd button {
    text-align: left;
    font: inherit;
    color: inherit;
    padding: 0 2px;
    border-radius: 3px;
  }
  .wd button:hover,
  .wd button.on {
    color: var(--accent);
    background: var(--accent-soft);
  }
  .wd .we {
    color: var(--fg-muted);
    font-weight: 600;
  }
  .days .cell.we:not(.l1):not(.l2):not(.l3):not(.l4) {
    background: color-mix(in srgb, var(--bg-sunken) 60%, var(--line));
  }
  .wsum {
    grid-column: 3;
    grid-row: 2;
    display: grid;
    grid-template-rows: repeat(7, 1fr);
    gap: 3px;
    width: 64px;
    font-size: 9px;
    color: var(--fg-faint);
  }
  .wsum span {
    position: relative;
    display: flex;
    align-items: center;
  }
  .wsum i {
    position: absolute;
    left: 0;
    top: 20%;
    bottom: 20%;
    border-radius: 2px;
    background: color-mix(in srgb, var(--accent) 35%, transparent);
  }
  .wsum em {
    position: relative;
    font-style: normal;
    padding-left: 3px;
  }
  .year {
    display: grid;
    grid-template-columns: 22px 1fr 64px;
    grid-template-rows: auto auto;
    column-gap: 4px;
    row-gap: 4px;
  }
  .months {
    grid-column: 2;
    display: grid;
    gap: 3px;
  }
  .months .mlabel:hover {
    color: var(--accent);
  }
  .wd {
    grid-column: 1;
    display: grid;
    grid-template-rows: repeat(7, 1fr);
    gap: 3px;
    font-size: 9px;
    color: var(--fg-faint);
    align-items: center;
  }
  .days {
    grid-column: 2;
    display: grid;
    grid-template-rows: repeat(7, auto);
    gap: 3px;
  }
  .days .cell {
    aspect-ratio: 1;
    min-width: 6px;
  }

  .month {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 5px;
  }
  .wdh {
    font-size: 11px;
    color: var(--fg-faint);
    padding-left: 4px;
  }
  .cell.day {
    position: relative;
    height: 74px;
    overflow: hidden;
    border-radius: 8px;
  }
  .day img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0.85;
    pointer-events: none;
  }
  .dnum,
  .dn {
    position: absolute;
    font-size: 11px;
    font-weight: 600;
    padding: 1px 5px;
    border-radius: 5px;
  }
  .dnum {
    left: 4px;
    top: 4px;
    color: var(--fg);
    background: color-mix(in srgb, var(--bg-elev) 80%, transparent);
  }
  .dn {
    right: 4px;
    bottom: 4px;
    color: #fff;
    background: color-mix(in srgb, var(--accent) 85%, #000);
  }

  .legend {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    margin-top: 10px;
    font-size: 11px;
    color: var(--fg-faint);
  }
  .scale {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .scale i {
    display: inline-block;
    width: 10px;
    height: 10px;
  }
</style>
