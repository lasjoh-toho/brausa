/**
 * View pipeline: source → filter → grouping → layout.
 * Every perspective (stream, kanban, timeline, map) consumes `Group[]`.
 */
import type { Entry } from './types';
import { TAG_SEPARATOR, indexTags } from './tags';
import { isWithin } from './paths';
import { matches, parsePattern } from './pattern';
import { inRange, type DateRange } from './dates';
import { category, type Category } from './format';
import { loc, t } from '../i18n/index.svelte';

export type ViewMode = 'start' | 'stream' | 'panes' | 'table' | 'kanban' | 'timeline' | 'calendar' | 'map' | 'board';
export type GroupBy = 'none' | 'tag' | 'subfolder' | 'month';
export type SortKey = 'name' | 'folder' | 'mtime' | 'ctime' | 'taken' | 'size' | 'ext';

export const SORT_KEYS: { key: SortKey; label: string }[] = (['name', 'folder', 'mtime', 'ctime', 'taken', 'size', 'ext'] as SortKey[]).map((key) => ({
  key,
  get label() {
    return t(`core.views.${key}`);
  }
}));

export interface Group {
  key: string;
  label: string;
  entries: Entry[];
}

/** The first `limit` entries across groups (a view draws no more at once; scrolling shows more). */
export function within(groups: Group[], limit: number): Group[] {
  const out: Group[] = [];
  let left = limit;
  for (const g of groups) {
    if (left <= 0) break;
    out.push(g.entries.length > left ? { ...g, entries: g.entries.slice(0, left) } : g);
    left -= g.entries.length;
  }
  return out;
}

export interface ViewQuery {
  /** Free-text search / pattern (same language as select-by-pattern). */
  search?: string;
  /** Breadcrumb funnel: restrict to this sub-branch. */
  funnel?: string | null;
  /** Calendar heatmap filter. */
  date?: DateRange | null;
  /** Type filter: only files of these categories. */
  cats?: Category[] | null;
  /** Show directories in the canvas (off in stream mode). */
  showDirs?: boolean;
  sort?: SortKey;
  desc?: boolean;
}

export const UNTAGGED = '__untagged__';

export function filterEntries(entries: Entry[], q: ViewQuery, now = Date.now()): Entry[] {
  let out = entries;
  if (!q.showDirs) out = out.filter((e) => e.kind === 'file');
  if (q.funnel) out = out.filter((e) => isWithin(e.path, q.funnel!));
  if (q.cats?.length) out = out.filter((e) => e.kind === 'file' && q.cats!.includes(category(e.ext)!));
  if (q.date) out = out.filter((e) => e.kind === 'file' && inRange(e, q.date!));
  if (q.search?.trim()) {
    const p = parsePattern(q.search);
    if (p.terms.length) out = out.filter((e) => matches(e, p, now));
  }
  return sortEntries(out, q.sort ?? 'name', q.desc ?? false);
}

export function sortEntries(entries: Entry[], key: SortKey, desc = false): Entry[] {
  const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const dirFirst = (a: Entry, b: Entry) => (a.kind === b.kind ? 0 : a.kind === 'dir' ? -1 : 1);
  const by: Record<SortKey, (a: Entry, b: Entry) => number> = {
    name: (a, b) => coll.compare(a.name, b.name),
    // Flat view: folder by folder, then by name.
    folder: (a, b) => coll.compare(a.relDir ?? '', b.relDir ?? '') || coll.compare(a.name, b.name),
    mtime: (a, b) => a.mtime - b.mtime,
    ctime: (a, b) => (a.ctime || a.mtime) - (b.ctime || b.mtime),
    // Files without EXIF date fall back to their modification date.
    taken: (a, b) => (a.taken ?? a.mtime) - (b.taken ?? b.mtime),
    size: (a, b) => a.size - b.size,
    ext: (a, b) => coll.compare(a.ext, b.ext) || coll.compare(a.name, b.name)
  };
  const f = by[key];
  return [...entries].sort((a, b) => dirFirst(a, b) || (desc ? -f(a, b) : f(a, b)));
}

/**
 * Group entries. For `tag`, `depth` chooses the hierarchy level used for the
 * columns (1 = top-level: `Work`, 2 = `Work/Design`, …). An entry appears in
 * every matching column.
 */
export function groupEntries(entries: Entry[], by: GroupBy, opts: { depth?: number; locale?: string } = {}): Group[] {
  if (by === 'none') return [{ key: 'all', label: t('core.views.all'), entries }];

  const map = new Map<string, Group>();
  const add = (key: string, label: string, e: Entry) => {
    let g = map.get(key);
    if (!g) map.set(key, (g = { key, label, entries: [] }));
    g.entries.push(e);
  };

  for (const e of entries) {
    if (by === 'tag') {
      const depth = opts.depth ?? 1;
      const level = indexTags(e.tags).filter((x) => x.split(TAG_SEPARATOR).length === depth);
      if (!level.length) add(UNTAGGED, t('core.views.untagged'), e);
      for (const tag of level) add(tag.toLowerCase(), tag, e);
    } else if (by === 'subfolder') {
      const rel = e.relDir ?? '';
      const top = rel.split(/[\\/]/)[0] ?? '';
      add(top || '.', top || t('core.views.topLevel'), e);
    } else if (by === 'month') {
      const d = new Date(e.taken ?? e.mtime);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString(opts.locale ?? loc(), { month: 'long', year: 'numeric' });
      add(key, label, e);
    }
  }

  const groups = [...map.values()];
  if (by === 'month') groups.sort((a, b) => b.key.localeCompare(a.key));
  else
    groups.sort((a, b) =>
      a.key === UNTAGGED ? 1 : b.key === UNTAGGED ? -1 : a.label.localeCompare(b.label, undefined, { numeric: true })
    );
  return groups;
}

/** All tags present in a set of entries, with counts (including derived ancestors). */
export function tagCounts(entries: Entry[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries) for (const t of indexTags(e.tags)) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}
