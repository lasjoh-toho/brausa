/** Column config of the table view, kept in the store under `tableColumns`. */
import { store } from '../platform';
import { MIN_WIDTH, defaultColumns, moveColumn, normalizeColumns, type ColumnConf, type ColumnId } from '../core/columns';

class TableColumns {
  list = $state<ColumnConf[]>(normalizeColumns(store.get<unknown>('tableColumns', null)));

  private save() {
    store.set('tableColumns', $state.snapshot(this.list));
  }

  toggle(id: ColumnId) {
    if (id === 'name') return;
    this.list = this.list.map((c) => (c.id === id ? { ...c, show: !c.show } : c));
    this.save();
  }

  move(id: ColumnId, delta: number) {
    this.list = moveColumn(this.list, id, delta);
    this.save();
  }

  /** While dragging a header edge; `done` stores it. */
  resize(id: ColumnId, width: number, done = false) {
    const w = Math.max(MIN_WIDTH, Math.round(width));
    this.list = this.list.map((c) => (c.id === id ? { ...c, width: w } : c));
    if (done) this.save();
  }

  reset() {
    this.list = defaultColumns();
    this.save();
  }
}

export const tableColumns = new TableColumns();
