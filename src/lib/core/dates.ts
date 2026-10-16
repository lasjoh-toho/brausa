/**
 * Date bucketing for the calendar heatmap and the date-range filter.
 * All buckets use local time, like a wall calendar.
 */
import type { Entry } from './types';

export type DateField = 'mtime' | 'ctime' | 'taken';
export type CalLevel = 'years' | 'year' | 'month';

export interface DateRange {
  field: DateField;
  /** inclusive, ms */
  from: number;
  /** exclusive, ms */
  to: number;
}

export const DATE_FIELD_LABEL: Record<DateField, string> = {
  mtime: 'Geändert',
  ctime: 'Erstellt',
  taken: 'Aufgenommen'
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
  return t >= r.from && t < r.to;
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

/** Month calendar: leading blanks (Monday first) and the days of the month. */
export function monthGrid(y: number, m: number): { lead: number; days: { key: string; date: number; day: number }[] } {
  const first = new Date(y, m, 1);
  const lead = (first.getDay() + 6) % 7;
  const days: { key: string; date: number; day: number }[] = [];
  for (let d = new Date(first); d.getMonth() === m; d.setDate(d.getDate() + 1))
    days.push({ key: dayKey(d.getTime()), date: d.getTime(), day: d.getDate() });
  return { lead, days };
}

export function formatRange(r: DateRange, locale = 'de-DE'): string {
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
