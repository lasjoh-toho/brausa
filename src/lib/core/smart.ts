/**
 * Smart folders: a saved combination of place (folder or project), search,
 * type filter and calendar frame. Opening one restores all of it.
 */
import { CATEGORIES } from './format';
import { basename, isWithin, joinPath, relativeTo, sep } from './paths';
import { weekdayShort, type DateRange } from './dates';
import { loc, t } from '../i18n/index.svelte';

export interface SmartFolder {
  id: string;
  name: string;
  /** A folder (path) or a project (id). */
  scope: { folder: string } | { project: string };
  search: string;
  typeFilter: string | null;
  /** Include subfolders (Stream). */
  recursive: boolean;
  date: DateRange | null;
}

/** The parts of the current view a smart folder captures. */
export type SmartView = Omit<SmartFolder, 'id' | 'name'>;

/** Worth saving: something narrows the view beyond the place itself. */
export function hasFilter(v: SmartView): boolean {
  return !!(v.search.trim() || v.typeFilter || v.date);
}

const day = (ms: number) => new Date(ms).toLocaleDateString(loc(), { day: 'numeric', month: 'numeric', year: 'numeric' });

export function describeDate(r: DateRange): string {
  // `to` is exclusive; show the last day included.
  const last = r.to - 1;
  let s = day(r.from) === day(last) ? day(r.from) : `${day(r.from)} – ${day(last)}`;
  if (r.weekdays?.length && r.weekdays.length < 7) s += ' (' + r.weekdays.map((d) => weekdayShort()[d]).join(', ') + ')';
  return s;
}

/** Short summary of the filters, e.g. "#work · Bilder · 1.7.2026 – 31.10.2026". */
export function describe(v: SmartView, placeName: string): string {
  const parts = [placeName];
  if (v.search.trim()) parts.push(v.search.trim());
  if (v.typeFilter) parts.push(v.typeFilter.split(',').map((k) => CATEGORIES.find((c) => c.key === k)?.label ?? k).join(', '));
  if (v.date) parts.push(describeDate(v.date));
  if (v.recursive && !v.typeFilter && !('project' in v.scope)) parts.push(t('core.smart.withSubfolders'));
  return parts.join(' · ');
}

/** Name suggested when saving: the search or type, else the folder name. */
export function suggestName(v: SmartView, placeName: string): string {
  const type = v.typeFilter ? (CATEGORIES.find((c) => c.key === v.typeFilter)?.label ?? v.typeFilter) : '';
  const what = [v.search.trim(), type].filter(Boolean).join(' ');
  return what ? t('core.smart.nameIn', { what, place: placeName }) : placeName;
}

function sameDate(a: DateRange | null, b: DateRange | null): boolean {
  if (!a || !b) return a === b;
  return a.field === b.field && a.from === b.from && a.to === b.to && (a.weekdays ?? []).join() === (b.weekdays ?? []).join();
}

/** Does the current view show exactly this smart folder? */
export function matches(f: SmartFolder, v: SmartView): boolean {
  const scope =
    'project' in f.scope ? 'project' in v.scope && v.scope.project === f.scope.project : 'folder' in v.scope && v.scope.folder === f.scope.folder;
  return (
    scope &&
    f.search.trim() === v.search.trim() &&
    (f.typeFilter ?? null) === (v.typeFilter ?? null) &&
    // Projects always show every file; Stream only matters for folders.
    ('project' in f.scope || f.recursive === v.recursive) &&
    sameDate(f.date, v.date)
  );
}

export function placeName(scope: SmartFolder['scope'], projectName: (id: string) => string | undefined): string {
  return 'project' in scope ? (projectName(scope.project) ?? t('core.smart.project')) : basename(scope.folder) || scope.folder;
}

/** Follow moved or renamed folders; returns null when nothing changed. */
export function followMoves(folders: SmartFolder[], moved: Record<string, string>): SmartFolder[] | null {
  let changed = false;
  const out = folders.map((f) => {
    if (!('folder' in f.scope)) return f;
    for (const [from, to] of Object.entries(moved)) {
      if (isWithin(f.scope.folder, from)) {
        const rest = relativeTo(f.scope.folder, from);
        changed = true;
        return { ...f, scope: { folder: rest ? joinPath(to, rest.replace(/\//g, sep(to))) : to } };
      }
    }
    return f;
  });
  return changed ? out : null;
}
