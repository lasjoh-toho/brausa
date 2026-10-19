/**
 * Columns of the file list. The table view lets the user choose, order and
 * size them; the three-panel view uses a fixed compact set.
 */
import type { SortKey } from './views';
import { t } from '../i18n/index.svelte';

export type ColumnId = 'name' | 'mtime' | 'ctime' | 'taken' | 'size' | 'kind' | 'ext' | 'tags' | 'folder' | 'path' | 'geo' | 'color';

export interface ColumnDef {
  id: ColumnId;
  label: string;
  /** Sort key behind the header, if the column can sort. */
  sort: SortKey | null;
  width: number;
}

/** One column as shown: in the table view from the stored config. */
export interface ColumnConf {
  id: ColumnId;
  show: boolean;
  width: number;
}

export const MIN_WIDTH = 60;

const DEFS: [ColumnId, string, SortKey | null, number][] = [
  ['name', 'colName', 'name', 280],
  ['mtime', 'colModified', 'mtime', 140],
  ['ctime', 'colCreated', 'ctime', 140],
  ['taken', 'colTaken', 'taken', 140],
  ['size', 'colSize', 'size', 80],
  ['kind', 'colKind', null, 80],
  ['ext', 'colExt', 'ext', 70],
  ['tags', 'colTags', null, 160],
  ['folder', 'colFolder', 'folder', 140],
  ['path', 'colPath', null, 260],
  ['geo', 'colGeo', null, 150],
  ['color', 'colColor', null, 60]
];

export const COLUMNS: ColumnDef[] = DEFS.map(([id, key, sort, width]) => ({
  id,
  get label() {
    return t(`files.${key}`);
  },
  sort,
  width
}));

export const columnDef = (id: ColumnId) => COLUMNS.find((c) => c.id === id)!;

const SHOWN: ColumnId[] = ['name', 'mtime', 'size', 'kind', 'tags'];

/** Default table: every column in its natural order, the common ones shown. */
export function defaultColumns(): ColumnConf[] {
  return COLUMNS.map((c) => ({ id: c.id, show: SHOWN.includes(c.id), width: c.width }));
}

/**
 * A stored config made safe: unknown ids dropped, missing ones appended
 * hidden, name always first and shown, widths at least MIN_WIDTH.
 */
export function normalizeColumns(raw: unknown): ColumnConf[] {
  if (!Array.isArray(raw)) return defaultColumns();
  const seen = new Set<ColumnId>();
  const out: ColumnConf[] = [];
  for (const r of raw as Partial<ColumnConf>[]) {
    const def = COLUMNS.find((c) => c.id === r?.id);
    if (!def || seen.has(def.id)) continue;
    seen.add(def.id);
    const w = typeof r.width === 'number' && isFinite(r.width) ? r.width : def.width;
    out.push({ id: def.id, show: r.show !== false, width: Math.max(MIN_WIDTH, Math.round(w)) });
  }
  for (const c of COLUMNS) if (!seen.has(c.id)) out.push({ id: c.id, show: false, width: c.width });
  const name = out.splice(
    out.findIndex((c) => c.id === 'name'),
    1
  )[0];
  return [{ ...name, show: true }, ...out];
}

/** Move a column up or down; name stays first. */
export function moveColumn(cols: ColumnConf[], id: ColumnId, delta: number): ColumnConf[] {
  const at = cols.findIndex((c) => c.id === id);
  const to = at + delta;
  if (id === 'name' || at < 0 || to < 1 || to >= cols.length) return cols;
  const out = [...cols];
  [out[at], out[to]] = [out[to], out[at]];
  return out;
}
