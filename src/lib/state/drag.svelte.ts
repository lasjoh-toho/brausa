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
import { isWithin, basename, dirname } from '../core/paths';
import { UNTAGGED } from '../core/views';
import { isCopyKey } from '../platform';
import { archiveRoot, inArchive } from '../core/archive';
import { app } from './app.svelte';
import type { NoteCard } from '../core/map';
import { t } from '../i18n/index.svelte';

export type DropKind = 'folder' | 'crumb' | 'tray' | 'canvas' | 'column' | 'grid-trigger' | 'grid-cell' | 'grid-up' | 'board' | 'project' | 'notes' | 'kanban' | 'wiki' | 'places';

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
  /** Folder the drop grid shows (up, "drop here", its subfolders); pausing over a subfolder goes into it. */
  gridDir = $state<string | null>(null);
  gridDirs = $state<Entry[]>([]);
  private diveTimer: ReturnType<typeof setTimeout> | null = null;
  private divePath: string | null = null;
  /** Where the pointer was when the grid changed: whatever lands under it only counts after a move. */
  private jumpAt: { x: number; y: number } | null = null;
  /** Recent horizontal turns of the pointer: shaking the files opens the grid. */
  private turns: number[] = [];
  private lastX = 0;
  private lastDir = 0;
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
    const name = h.path ? basename(h.path).replace(/!$/, '') : '';
    switch (h.kind) {
      case 'folder':
        return h.zone === 'attr' ? t('drag.assignAttributes', { name }) : t(this.verb(), { name });
      case 'crumb':
        return t(this.verb(), { name });
      case 'tray':
        return t('drag.toTray');
      case 'project':
        return t('drag.addTo', { name: app.projects.find((p) => p.id === h.key)?.name ?? '' });
      case 'canvas':
        if (app.currentProject) return this.source === 'canvas' ? '' : t('drag.addTo', { name: app.currentProject.name });
        return this.isFolderFunnel() ? t('drag.funnel') : this.source === 'canvas' ? '' : t('drag.moveHere');
      case 'column':
        return app.kanbanBy === 'tag' ? (h.key === UNTAGGED ? t('drag.removeTag') : t('drag.setTag', { tag: h.key ?? '' })) : t('drag.moveTo', { name: h.key ?? '' });
      case 'notes':
        return t('drag.toThread');
      case 'places':
        return t('drag.toPlaces');
      case 'wiki':
        return t('drag.toWiki', { name: h.key ?? '' });
      case 'kanban':
        return t('drag.toColumn', { name: h.key ?? '' });
      case 'grid-trigger':
        return t('drag.openGrid');
      case 'grid-up':
        return t('drag.gridUp');
      case 'board':
        return this.boardHint;
      case 'grid-cell': {
        const c = app.gridConfig.cells[h.cell ?? -1];
        return c?.tag ? t('drag.assignTag', { tag: c.tag }) : c ? t(this.copy ? 'drag.copyTo' : 'drag.moveTo', { name: c.label }) : '';
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
      // Out of the window: hand the files to the system, so they can go to Finder/Explorer or another app.
      if (this.active && !opts.data && outside(ev)) return dragOut();
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
      this.shake(ev.clientX);
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
        else if (snap.hit) void performDrop(snap.hit, snap.items, snap.source, snap.copy, snap.data);
      } else onClick?.(ev);
    };

    const key = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && this.active) end();
      else if (this.active) this.copy = isCopyKey(ev);
    };

    const outside = (ev: MouseEvent) => ev.clientX <= 0 || ev.clientY <= 0 || ev.clientX >= window.innerWidth - 1 || ev.clientY >= window.innerHeight - 1;
    const dragOut = () => {
      const paths = this.items.filter((i) => !inArchive(i.path)).map((i) => i.path);
      end();
      if (paths.length) void app.backend.dragOut(paths);
    };
    const leave = (ev: MouseEvent) => {
      if (this.active && !opts.data && !ev.relatedTarget) dragOut();
    };

    const end = () => {
      document.documentElement.removeEventListener('mouseleave', leave);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', key);
      this.reset();
    };

    this.cleanup?.();
    this.cleanup = end;
    document.documentElement.addEventListener('mouseleave', leave);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', key);
  }

  // ------------------------------------------------ files from other apps

  /** Files dragged in from Finder/Explorer: the same targets as a drag inside brausa (no ⌥ for copy there). */
  externalEnter(items: Entry[]) {
    this.cleanup?.();
    this.items = items;
    this.source = 'external';
    this.copy = false;
    this.active = items.length > 0;
    if (this.active) document.body.classList.add('dragging');
  }

  externalOver(x: number, y: number) {
    if (this.source !== 'external' || !this.active) return;
    this.x = x;
    this.y = y;
    this.hitTest(x, y);
  }

  async externalDrop(items: Entry[], x: number, y: number) {
    if (!items.length) return this.reset();
    this.items = items;
    this.hitTest(x, y);
    const hit = this.hit;
    this.reset();
    if (hit?.kind === 'board') await this.onBoardDrop?.(items, x, y);
    else if (hit) await performDrop(hit, items, 'external', false);
  }

  externalLeave() {
    if (this.source === 'external') this.reset();
  }

  // ------------------------------------------------ out of the web panel

  /** Marked text, a picture or a link is dragged out of the web panel (brausa follows the page's pointer). */
  webEnter(items: Entry[], data: unknown, accepts: DropKind[] | null, title: string) {
    this.cleanup?.();
    this.items = items;
    this.source = 'web';
    this.data = data;
    this.accepts = accepts;
    this.title = title;
    this.copy = false;
    this.active = true;
    document.body.classList.add('dragging');
  }

  webOver(x: number, y: number) {
    if (this.source !== 'web' || !this.active) return;
    this.x = x;
    this.y = y;
    this.hitTest(x, y);
  }

  /** `resolve` turns the drag into what is dropped (a picture is downloaded only now). */
  async webDrop(x: number, y: number, resolve: (hit: DropHit) => Promise<{ items: Entry[]; data?: unknown } | null>) {
    if (this.source !== 'web') return;
    this.hitTest(x, y);
    const hit = this.hit;
    this.reset();
    if (!hit) return;
    try {
      const r = await resolve(hit);
      if (!r) return;
      if (hit.kind === 'board') await this.onBoardDrop?.(r.items, x, y, r.data);
      else await performDrop(hit, r.items, 'web', false, r.data);
    } catch (e) {
      app.toast(String(e).replace(/^Error: /, ''), true);
    }
  }

  webCancel() {
    if (this.source === 'web') this.reset();
  }

  // ------------------------------------------------ drop grid

  /** Open the grid on a folder (the current one at first). */
  openGrid(dir = app.funnel ?? app.cwd) {
    this.gridOpen = true;
    void this.gridGo(dir);
  }

  async gridGo(dir: string) {
    this.jumpAt = { x: this.x, y: this.y };
    this.gridDir = dir;
    this.gridDirs = [];
    try {
      const list = (await app.backend.listDir(dir)).filter((e) => e.kind === 'dir');
      if (this.gridDir === dir) this.gridDirs = list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    } catch {
      // Unreadable folder: only "up" and "drop here".
    }
  }

  /** Three quick turns left-right within ¾ s count as shaking. */
  private shake(x: number) {
    const dx = x - this.lastX;
    if (Math.abs(dx) < 18) return;
    const dir = Math.sign(dx);
    this.lastX = x;
    if (dir !== this.lastDir) {
      const now = performance.now();
      this.turns = [...this.turns.filter((t) => now - t < 750), now];
      this.lastDir = dir;
      if (this.turns.length >= 4 && !this.gridOpen) {
        this.turns = [];
        this.openGrid();
      }
    }
  }

  /** Pausing over a grid folder (or "up") goes there. */
  private dive(path: string | null) {
    if (path === this.divePath) return;
    if (this.diveTimer) clearTimeout(this.diveTimer);
    this.diveTimer = null;
    this.divePath = path;
    if (!path) return;
    if (this.jumpAt) {
      if (Math.hypot(this.x - this.jumpAt.x, this.y - this.jumpAt.y) < 40) {
        this.divePath = null;
        return;
      }
      this.jumpAt = null;
    }
    this.diveTimer = setTimeout(() => {
      if (this.active && this.gridOpen && this.divePath === path) {
        this.divePath = null;
        void this.gridGo(path);
      }
    }, app.springDelay + 250);
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
    this.source = '';
    this.hit = null;
    this.trail = null;
    this.gridOpen = false;
    this.gridDir = null;
    this.gridDirs = [];
    this.dive(null);
    this.turns = [];
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
      this.dive(null);
      return;
    }
    const kind = t.dataset.drop as DropKind;
    if (this.accepts && !this.accepts.includes(kind)) {
      this.hit = null;
      this.spring(null);
      this.dive(null);
      return;
    }
    const hit: DropHit = { kind, path: t.dataset.target ?? t.dataset.path, key: t.dataset.key };
    if (kind === 'grid-cell') hit.cell = Number(t.dataset.cell);
    if (kind === 'folder') {
      const r = t.getBoundingClientRect();
      hit.zone = t.dataset.zones === 'dual' && x > r.left + r.width / 2 ? 'attr' : 'move';
      // Never offer dropping a folder into itself.
      if (this.items.some((i) => (i.kind === 'dir' && isWithin(hit.path!, i.path)) || hit.path === archiveRoot(i.path))) {
        this.hit = null;
        return;
      }
    }
    if (kind === 'folder' || (kind === 'crumb' && !this.trail)) this.trail = hit.path ?? null;
    if (kind === 'grid-trigger' && !this.gridOpen) this.openGrid();
    this.dive(t.dataset.dive ?? null);
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

  /** Out of an archive is unpacking; otherwise ⌥/Ctrl decides between copy and move. */
  private verb() {
    if (this.source === 'web') return 'drag.saveTo';
    if (this.hit?.path && inArchive(this.hit.path)) return 'drag.packInto';
    return this.items.some((i) => inArchive(i.path)) ? 'drag.unpackTo' : this.copy ? 'drag.copyTo' : 'drag.moveTo';
  }

  private isFolderFunnel() {
    return this.items.length === 1 && this.items[0].kind === 'dir' && this.source !== 'pane';
  }
}

export const drag = new DragController();

/** Executes a drop with a snapshot of the gesture (the controller resets synchronously on pointerup). */
export async function performDrop(h: DropHit, items: Entry[], source: string, copy: boolean, data?: unknown) {
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
      case 'project': {
        // A snippet (or a note from a thread) goes into the project's thread.
        const d = data as { snippet?: { quote: string; page?: number }; note?: NoteCard; fresh?: boolean } | undefined;
        const p = app.projects.find((x) => x.id === h.key);
        if (p && (d?.snippet || d?.note)) {
          const { board } = await import('./board.svelte');
          if (d.note && d.fresh) {
            await board.addNote({ ...d.note, id: undefined }, p.root);
            app.toast(t('board.notes.added', { name: p.name }));
          } else if (d.note) {
            if (p.root !== board.root) await board.sendNote(d.note.id, p.root, p.name);
          } else {
            const [ref] = await board.refsFor(items);
            await board.addNote({ kind: 'snippet', title: items[0]?.name ?? '', text: d.snippet!.quote, refs: ref ? [{ ...ref, ...d.snippet }] : [] }, p.root);
            app.toast(t('board.notes.added', { name: p.name }));
          }
        } else await app.addToProject(h.key!, items);
        break;
      }
      case 'canvas': {
        if (app.project) {
          // In a project the drop adds to it; nothing moves.
          if (source !== 'canvas') await app.addToProject(app.project, items);
        } else if (items.length === 1 && items[0].kind === 'dir' && source !== 'canvas' && source !== 'pane' && source !== 'external') {
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
          else await app.patchMeta(items, { addTags: [label], removeTags: fromLabel ? [fromLabel] : [] }, t('drag.tagSet', { tag: label }));
        } else {
          const target = key === '.' ? app.cwd : app.cwd.replace(/[\\/]+$/, '') + '/' + key;
          await app.transfer(items, target, mode);
        }
        break;
      }
      case 'grid-cell': {
        const c = app.gridConfig.cells[h.cell ?? -1];
        if (c?.tag) await app.patchMeta(items, { addTags: [c.tag] }, t('drag.tagAssigned', { tag: c.tag }));
        else if (c?.path) await app.transfer(items, c.path, mode);
        break;
      }
      case 'notes': {
        // Into the project's notes & snippets thread.
        const { board } = await import('./board.svelte');
        const d = data as { snippet?: { quote: string; page?: number }; note?: NoteCard; fresh?: boolean } | undefined;
        if (d?.note && d.fresh) await board.addNote({ ...d.note, id: undefined });
        else if (d?.note) break;
        else if (d?.snippet) {
          const [ref] = await board.refsFor(items);
          await board.addNote({ kind: 'snippet', title: items[0]?.name ?? '', text: d.snippet.quote, refs: ref ? [{ ...ref, ...d.snippet }] : [] });
        } else {
          const refs = await board.refsFor(items);
          for (const r of refs) await board.addNote({ kind: 'note', title: r.name ?? '', text: '', refs: [r] });
        }
        break;
      }
      case 'kanban': {
        // Into a Kanban column: a card with that status.
        const { board } = await import('./board.svelte');
        const d = data as { note?: NoteCard; fresh?: boolean } | undefined;
        if (d?.note) board.noteToColumn(d.note, h.key!, !d.fresh);
        else for (const r of await board.refsFor(items)) board.addToColumn({ title: r.name ?? '', refs: [r], h: board.isImage(r) ? 190 : 120 }, h.key!);
        break;
      }
      case 'places': {
        // Folders become places (files: the folder they are in).
        for (const e of items) app.addPlace(e.kind === 'dir' ? e.path : dirname(e.path));
        break;
      }
      case 'wiki': {
        // A tiddler in the wiki's own bag: snippets with their source, files as links.
        const d = data as { snippet?: { quote: string; page?: number }; note?: NoteCard } | undefined;
        const name = h.key!;
        const tiddlers: Record<string, string>[] = [];
        if (d?.note) tiddlers.push(noteTiddler(d.note));
        else if (d?.snippet)
          tiddlers.push({ title: items[0]?.name ?? 'Snippet', text: `<<<\n${d.snippet.quote}\n<<< [ext[${items[0]?.name ?? ''}|file://${encodeURI(items[0]?.path ?? '')}]]`, tags: 'Snippet' });
        else for (const e of items) tiddlers.push({ title: e.name, text: `[ext[${e.name}|file://${encodeURI(e.path)}]]`, tags: 'brausa' });
        for (const f of tiddlers) {
          const title = await app.backend.wikiAddTiddler(name, f);
          app.toast(t('drag.wikiAdded', { title, name }));
        }
        break;
      }
      case 'grid-trigger':
        break;
    }
  } catch (e) {
    app.toast(String(e), true);
  }
}

/** A note or snippet as a tiddler: the text, its source as a link, the kind as a tag. */
export function noteTiddler(n: Pick<NoteCard, 'title' | 'text' | 'refs'> & { kind?: string }): Record<string, string> {
  const ref = n.refs?.[0];
  const src = ref?.href ? `[ext[${ref.title || ref.href}|${ref.href}]]` : ref?.path ? `[ext[${ref.name ?? ref.path}|file://${encodeURI(ref.path)}]]` : '';
  const text = n.kind === 'snippet' ? `<<<\n${n.text}\n<<< ${src}` : `${n.text}${src ? `\n\n${src}` : ''}`;
  return { title: n.title || n.text.slice(0, 60) || 'Snippet', text, tags: n.kind === 'snippet' ? 'Snippet' : 'Notiz', ...(ref?.href ? { source: ref.href } : {}) };
}
