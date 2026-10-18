/**
 * Pointer-event based drag & drop controller.
 *
 * Drop targets are plain elements with data attributes:
 *   data-drop="folder|crumb|tray|canvas|column|grid-trigger|grid-cell|board|project"
 *   data-path="/abs/path"          (folder, crumb)
 *   data-zones="dual"              (folder: left = move/copy, right = assign attributes)
 *   data-expandable                (folder: spring-loads on hover)
 *   data-key="…"                   (column; project: its id)
 *   data-cell="3"                  (grid-cell)
 * Scroll containers marked with data-autoscroll scroll when dragging near their edges.
 */
import type { Entry } from '../core/types';
import { isWithin, basename } from '../core/paths';
import { UNTAGGED } from '../core/views';
import { isCopyKey } from '../platform';
import { app } from './app.svelte';

export type DropKind = 'folder' | 'crumb' | 'tray' | 'canvas' | 'column' | 'grid-trigger' | 'grid-cell' | 'board' | 'project';

/** The project map handles its own drops (where on which card), see ProjectMap.svelte. */
export type BoardDrop = (items: Entry[], x: number, y: number, data?: unknown) => void | Promise<void>;

export interface DragOptions {
  /** Extra payload for the drop target (e.g. a text snippet from the reader). */
  data?: unknown;
  /** Only these targets accept the drag (default: all). */
  accepts?: DropKind[];
  /** Short label for the ghost instead of file names. */
  title?: string;
}

export interface DropHit {
  kind: DropKind;
  path?: string;
  zone?: 'move' | 'attr';
  key?: string;
  cell?: number;
}

const THRESHOLD = 5;

class DragController {
  active = $state(false);
  items = $state<Entry[]>([]);
  source = $state('');
  x = $state(0);
  y = $state(0);
  copy = $state(false);
  hit = $state<DropHit | null>(null);
  /** Last folder hovered in the tree/canvas; drives the breadcrumb drop bar. */
  trail = $state<string | null>(null);
  gridOpen = $state(false);
  /** Set by the project map while hovering it: what a drop would do. */
  boardHint = $state('');
  onBoardDrop: BoardDrop | null = null;
  data = $state<unknown>(undefined);
  accepts: DropKind[] | null = null;
  title = $state('');

  private autoExpanded = new Set<string>();
  private springTimer: ReturnType<typeof setTimeout> | null = null;
  private springPath: string | null = null;
  private cleanup: (() => void) | null = null;

  /** What will happen on release, for the drag ghost. */
  label = $derived.by(() => {
    const h = this.hit;
    if (!h) return '';
    const name = h.path ? basename(h.path) : '';
    switch (h.kind) {
      case 'folder':
        return h.zone === 'attr' ? `Attribute von „${name}“ zuweisen` : `${this.copy ? 'Kopieren' : 'Verschieben'} nach „${name}“`;
      case 'crumb':
        return `${this.copy ? 'Kopieren' : 'Verschieben'} nach „${name}“`;
      case 'tray':
        return 'In die Ablage legen';
      case 'project':
        return `Zu „${app.projects.find((p) => p.id === h.key)?.name ?? ''}“ hinzufügen`;
      case 'canvas':
        if (app.currentProject) return this.source === 'canvas' ? '' : `Zu „${app.currentProject.name}“ hinzufügen`;
        return this.isFolderFunnel() ? 'Ansicht auf diesen Zweig filtern' : this.source === 'canvas' ? '' : 'Hierher verschieben';
      case 'column':
        return app.kanbanBy === 'tag' ? (h.key === UNTAGGED ? 'Tag entfernen' : `#${h.key} setzen`) : `Nach „${h.key}“ verschieben`;
      case 'grid-trigger':
        return 'Ablagezonen öffnen';
      case 'board':
        return this.boardHint;
      case 'grid-cell': {
        const c = app.gridConfig.cells[h.cell ?? -1];
        return c?.tag ? `#${c.tag} zuweisen` : c ? `${this.copy ? 'Kopieren' : 'Verschieben'} nach „${c.label}“` : '';
      }
    }
  });

  /**
   * Call from a pointerdown handler. The drag only starts after the pointer
   * moved a few pixels; a plain click calls `onClick` instead.
   */
  begin(e: PointerEvent, getItems: () => Entry[], source: string, onClick?: (e: PointerEvent) => void, opts: DragOptions = {}) {
    if (e.button !== 0) return;
    e.preventDefault(); // no native text selection / image drag
    const sx = e.clientX;
    const sy = e.clientY;

    const move = (ev: PointerEvent) => {
      if (!this.active) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < THRESHOLD) return;
        const items = getItems();
        if (!items.length) return end();
        this.items = items;
        this.source = source;
        this.data = opts.data;
        this.accepts = opts.accepts ?? null;
        this.title = opts.title ?? '';
        this.active = true;
        document.body.classList.add('dragging');
      }
      this.x = ev.clientX;
      this.y = ev.clientY;
      this.copy = isCopyKey(ev);
      this.hitTest(ev.clientX, ev.clientY);
    };

    const up = (ev: PointerEvent) => {
      const wasActive = this.active;
      const snap = { hit: this.hit, items: this.items, source: this.source, copy: this.copy, data: this.data };
      end();
      if (wasActive) {
        if (snap.hit?.kind === 'board') void this.onBoardDrop?.(snap.items, ev.clientX, ev.clientY, snap.data);
        else if (snap.hit) void performDrop(snap.hit, snap.items, snap.source, snap.copy);
      } else onClick?.(ev);
    };

    const key = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && this.active) end();
      else if (this.active) this.copy = isCopyKey(ev);
    };

    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', key);
      this.reset();
    };

    this.cleanup?.();
    this.cleanup = end;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', key);
  }

  private reset() {
    if (this.springTimer) clearTimeout(this.springTimer);
    this.springTimer = null;
    this.springPath = null;
    // Spring-loaded branches fold back once the gesture is over.
    for (const p of this.autoExpanded) app.collapse(p);
    this.autoExpanded.clear();
    this.active = false;
    this.items = [];
    this.data = undefined;
    this.accepts = null;
    this.title = '';
    this.hit = null;
    this.trail = null;
    this.gridOpen = false;
    this.cleanup = null;
    document.body.classList.remove('dragging');
  }

  private hitTest(x: number, y: number) {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    this.autoscroll(el, y);
    const t = el?.closest<HTMLElement>('[data-drop]');
    if (!t) {
      this.hit = null;
      this.spring(null);
      return;
    }
    const kind = t.dataset.drop as DropKind;
    if (this.accepts && !this.accepts.includes(kind)) {
      this.hit = null;
      this.spring(null);
      return;
    }
    const hit: DropHit = { kind, path: t.dataset.path, key: t.dataset.key };
    if (kind === 'grid-cell') hit.cell = Number(t.dataset.cell);
    if (kind === 'folder') {
      const r = t.getBoundingClientRect();
      hit.zone = t.dataset.zones === 'dual' && x > r.left + r.width / 2 ? 'attr' : 'move';
      // Never offer dropping a folder into itself.
      if (this.items.some((i) => i.kind === 'dir' && isWithin(hit.path!, i.path))) {
        this.hit = null;
        return;
      }
    }
    if (kind === 'folder' || (kind === 'crumb' && !this.trail)) this.trail = hit.path ?? null;
    if (kind === 'grid-trigger') this.gridOpen = true;
    this.hit = hit;
    this.spring(kind === 'folder' && t.hasAttribute('data-expandable') ? hit.path! : null);
  }

  private spring(path: string | null) {
    if (path === this.springPath) return;
    if (this.springTimer) clearTimeout(this.springTimer);
    this.springTimer = null;
    this.springPath = path;
    if (!path || app.expanded.has(path)) return;
    this.springTimer = setTimeout(() => {
      if (!this.active || this.springPath !== path) return;
      this.autoExpanded.add(path);
      app.expand(path);
    }, app.springDelay);
  }

  private autoscroll(el: HTMLElement | null, y: number) {
    const sc = el?.closest<HTMLElement>('[data-autoscroll]');
    if (!sc) return;
    const r = sc.getBoundingClientRect();
    const edge = 36;
    if (y < r.top + edge) sc.scrollTop -= 14;
    else if (y > r.bottom - edge) sc.scrollTop += 14;
  }

  private isFolderFunnel() {
    return this.items.length === 1 && this.items[0].kind === 'dir' && this.source !== 'pane';
  }
}

export const drag = new DragController();

/** Executes a drop with a snapshot of the gesture (the controller resets synchronously on pointerup). */
export async function performDrop(h: DropHit, items: Entry[], source: string, copy: boolean) {
  const mode = copy ? 'copy' : 'move';
  try {
    switch (h.kind) {
      case 'folder':
        if (h.zone === 'attr') await app.applyFolderAttributes(items.filter((i) => i.kind === 'file'), h.path!);
        else await app.transfer(items, h.path!, mode);
        break;
      case 'crumb':
        await app.transfer(items, h.path!, mode);
        break;
      case 'tray':
        if (source !== 'tray') app.stage(items);
        break;
      case 'project':
        await app.addToProject(h.key!, items);
        break;
      case 'canvas': {
        if (app.project) {
          // In a project the drop adds to it; nothing moves.
          if (source !== 'canvas') await app.addToProject(app.project, items);
        } else if (items.length === 1 && items[0].kind === 'dir' && source !== 'canvas' && source !== 'pane') {
          const dir = items[0].path;
          if (isWithin(dir, app.cwd) && dir !== app.cwd) {
            if (!app.recursive) app.setRecursive(true);
            app.setFunnel(dir);
          } else await app.navigate(dir);
        } else if (source !== 'canvas') await app.transfer(items, app.funnel ?? app.cwd, mode);
        break;
      }
      case 'column': {
        const key = h.key!;
        if (app.kanbanBy === 'tag') {
          const from = source.startsWith('column:') ? source.slice(7) : null;
          if (from === key) break;
          const label = app.groups.find((g) => g.key === key)?.label ?? key;
          const fromLabel = from && from !== UNTAGGED ? app.groups.find((g) => g.key === from)?.label : undefined;
          if (key === UNTAGGED) await app.patchMeta(items, { removeTags: fromLabel ? [fromLabel] : [] });
          else await app.patchMeta(items, { addTags: [label], removeTags: fromLabel ? [fromLabel] : [] }, `#${label} gesetzt`);
        } else {
          const target = key === '.' ? app.cwd : app.cwd.replace(/[\\/]+$/, '') + '/' + key;
          await app.transfer(items, target, mode);
        }
        break;
      }
      case 'grid-cell': {
        const c = app.gridConfig.cells[h.cell ?? -1];
        if (c?.tag) await app.patchMeta(items, { addTags: [c.tag] }, `#${c.tag} zugewiesen`);
        else if (c?.path) await app.transfer(items, c.path, mode);
        break;
      }
      case 'grid-trigger':
        break;
    }
  } catch (e) {
    app.toast(String(e), true);
  }
}
