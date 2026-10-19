/**
 * Date bucketing for the calendar heatmap and the date-range filter.
 * All buckets use local time, like a wall calendar.
 */
import type { Entry } from './types';
import { loc, t } from '../i18n/index.svelte';

export type DateField = 'mtime' | 'ctime' | 'taken';
export type CalLevel = 'years' | 'year' | 'month';

export interface DateRange {
  field: DateField;
  /** inclusive, ms */
  from: number;
  /** exclusive, ms */
  to: number;
  /** Only these weekdays (0 = Monday … 6 = Sunday); missing means every day. */
  weekdays?: number[];
}

/** Short weekday names, Monday first, in the UI language. */
export function weekdayShort(): string[] {
  return t('core.dates.weekdays').split(',');
}

/** Same as weekdayShort(), read on every access so a language switch takes effect. */
export const WEEKDAY_SHORT: readonly string[] = new Proxy([] as string[], {
  get: (_, p) => Reflect.get(weekdayShort(), p)
});

/** Weekday with Monday = 0, like the rows of the year heatmap. */
export function weekdayOf(ms: number): number {
  return (new Date(ms).getDay() + 6) % 7;
}

/** Midnight `days` days after `ms` (local time, safe across DST changes). */
export function addDays(ms: number, days: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days).getTime();
}

/**
 * The frame dragged from cell A to cell B of the year heatmap (columns are
 * weeks, rows weekdays): the days from the top-left to the bottom-right
 * corner, limited to the weekdays the frame covers (none when it covers all).
 */
export function frameRange(field: DateField, a: { date: number; col: number; row: number }, b: { col: number; row: number }): DateRange {
  const c1 = Math.min(a.col, b.col);
  const c2 = Math.max(a.col, b.col);
  const r1 = Math.min(a.row, b.row);
  const r2 = Math.max(a.row, b.row);
  const from = addDays(a.date, (c1 - a.col) * 7 + (r1 - a.row));
  const to = addDays(a.date, (c2 - a.col) * 7 + (r2 - a.row) + 1);
  const all = r1 === 0 && r2 === 6;
  return { field, from, to, weekdays: all ? undefined : Array.from({ length: r2 - r1 + 1 }, (_, i) => r1 + i) };
}

/** Two selections together: the span of both, and the weekdays of either. */
export function unionRange(a: DateRange, b: DateRange): DateRange {
  const weekdays = a.weekdays && b.weekdays ? [...new Set([...a.weekdays, ...b.weekdays])].sort((x, y) => x - y) : undefined;
  return { field: a.field, from: Math.min(a.from, b.from), to: Math.max(a.to, b.to), weekdays: weekdays?.length === 7 ? undefined : weekdays };
}

export const DATE_FIELD_LABEL: Record<DateField, string> = {
  get mtime() {
    return t('core.dates.mtime');
  },
  get ctime() {
    return t('core.dates.ctime');
  },
  get taken() {
    return t('core.dates.taken');
  }
};

/** Capture date falls back to the modification date for files without EXIF. */
export function dateOf(e: Entry, field: DateField): number {
  return field === 'taken' ? (e.taken ?? e.mtime) : e[field];
}

export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function monthKey(ms: number): string {
  return dayKey(ms).slice(0, 7);
}

export function startOfDay(y: number, m: number, d: number): number {
  return new Date(y, m, d).getTime();
}

/** Bucket counts per day ('YYYY-MM-DD') and per month ('YYYY-MM'). */
export function countDates(entries: Entry[], field: DateField) {
  const days = new Map<string, number>();
  const months = new Map<string, number>();
  let min = Infinity;
  let max = -Infinity;
  for (const e of entries) {
    if (e.kind !== 'file') continue;
    const t = dateOf(e, field);
    if (!t) continue;
    const dk = dayKey(t);
    days.set(dk, (days.get(dk) ?? 0) + 1);
    const mk = dk.slice(0, 7);
    months.set(mk, (months.get(mk) ?? 0) + 1);
    if (t < min) min = t;
    if (t > max) max = t;
  }
  return { days, months, min: isFinite(min) ? min : null, max: isFinite(max) ? max : null };
}

/**
 * Map a count to an intensity level 0–4. Uses the square root so that a few
 * very busy days don't wash out everything else.
 */
export function level(count: number, max: number): number {
  if (!count || max <= 0) return 0;
  return Math.min(4, 1 + Math.floor((Math.sqrt(count) / Math.sqrt(max)) * 3.999));
}

export function inRange(e: Entry, r: DateRange): boolean {
  const t = dateOf(e, r.field);
  return t >= r.from && t < r.to && (!r.weekdays || r.weekdays.includes(weekdayOf(t)));
}

/** Range covering a whole month (m = 0..11) or a whole year. */
export function monthRange(y: number, m: number): [number, number] {
  return [new Date(y, m, 1).getTime(), new Date(y, m + 1, 1).getTime()];
}

export function yearRange(y: number): [number, number] {
  return [new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime()];
}

/**
 * GitHub-style year grid: columns are weeks (Monday first), rows weekdays.
 * Returns one entry per day of the year with its column/row.
 */
export function yearGrid(y: number): { key: string; date: number; col: number; row: number }[] {
  const out: { key: string; date: number; col: number; row: number }[] = [];
  const first = new Date(y, 0, 1);
  const offset = (first.getDay() + 6) % 7; // Monday = 0
  for (let d = new Date(first); d.getFullYear() === y; d.setDate(d.getDate() + 1)) {
    const idx = Math.round((d.getTime() - first.getTime()) / 86400e3) + offset;
    out.push({ key: dayKey(d.getTime()), date: d.getTime(), col: Math.floor(idx / 7), row: (d.getDay() + 6) % 7 });
  }
  return out;
}

/**
 * Like yearGrid, but one continuous band of weeks from Jan 1 of `y1` to Dec 31
 * of `y2`, so weeks, frames and scrolling run across the turn of the year.
 */
export function bandGrid(y1: number, y2: number): { key: string; date: number; col: number; row: number }[] {
  const out: { key: string; date: number; col: number; row: number }[] = [];
  const offset = (new Date(y1, 0, 1).getDay() + 6) % 7; // Monday = 0
  for (let i = 0, d = new Date(y1, 0, 1); d.getFullYear() <= y2; i++, d = new Date(y1, 0, 1 + i)) {
    const idx = i + offset;
    out.push({ key: dayKey(d.getTime()), date: d.getTime(), col: Math.floor(idx / 7), row: idx % 7 });
  }
  return out;
}

/** Month calendar: leading blanks (Monday first) and the days of the month. */
export function monthGrid(y: number, m: number): { lead: number; days: { key: string; date: number; day: number }[] } {
  const first = new Date(y, m, 1);
  const lead = (first.getDay() + 6) % 7;
  const days: { key: string; date: number; day: number }[] = [];
  for (let d = new Date(first); d.getMonth() === m; d.setDate(d.getDate() + 1))
    days.push({ key: dayKey(d.getTime()), date: d.getTime(), day: d.getDate() });
  return { lead, days };
}

export function formatRange(r: DateRange, locale = loc()): string {
  const range = formatSpan(r, locale);
  if (!r.weekdays) return range;
  const names = weekdayShort();
  return t('core.dates.onlyWeekdays', { range, days: r.weekdays.map((w) => names[w]).join(', ') });
}

function formatSpan(r: DateRange, locale: string): string {
  const a = new Date(r.from);
  const b = new Date(r.to - 1);
  const sameDay = dayKey(r.from) === dayKey(r.to - 1);
  const wholeMonth = a.getDate() === 1 && new Date(r.to).getDate() === 1;
  if (sameDay) return a.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  if (wholeMonth && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear())
    return a.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  if (wholeMonth && a.getMonth() === 0 && b.getMonth() === 11 && a.getFullYear() === b.getFullYear()) return String(a.getFullYear());
  const f = (d: Date) => d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  return `${f(a)} – ${f(b)}`;
}
