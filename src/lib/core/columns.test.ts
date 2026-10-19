import { describe, expect, it } from 'vitest';
import { COLUMNS, MIN_WIDTH, defaultColumns, moveColumn, normalizeColumns } from './columns';

describe('table columns', () => {
  it('defaults to every column, name first and shown', () => {
    const d = defaultColumns();
    expect(d.map((c) => c.id)).toEqual(COLUMNS.map((c) => c.id));
    expect(d[0]).toMatchObject({ id: 'name', show: true });
  });

  it('repairs a stored config', () => {
    const n = normalizeColumns([{ id: 'size', show: true, width: 10 }, { id: 'bogus' }, { id: 'name', show: false, width: 300 }, { id: 'size' }]);
    expect(n[0]).toEqual({ id: 'name', show: true, width: 300 });
    expect(n[1]).toEqual({ id: 'size', show: true, width: MIN_WIDTH });
    expect(n).toHaveLength(COLUMNS.length);
    expect(n.find((c) => c.id === 'path')?.show).toBe(false);
    expect(normalizeColumns('junk')).toEqual(defaultColumns());
  });

  it('moves columns but keeps name first', () => {
    const d = defaultColumns();
    expect(moveColumn(d, 'mtime', -1)).toBe(d);
    expect(moveColumn(d, 'name', 1)).toBe(d);
    expect(moveColumn(d, 'ctime', -1).map((c) => c.id).slice(0, 3)).toEqual(['name', 'ctime', 'mtime']);
  });
});
