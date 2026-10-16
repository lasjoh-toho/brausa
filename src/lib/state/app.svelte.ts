/**
 * Central application state (Svelte 5 runes). Components read from `app` and
 * call its methods; all file-system effects go through the Backend.
 */
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import type { Entry, MetaPatch, TransferMode } from '../core/types';
import type { Backend } from '../backend';
import { createBackend } from '../backend';
import { filterEntries, groupEntries, tagCounts, type GroupBy, type SortKey, type ViewMode } from '../core/views';
import { basename, dirname, isWithin } from '../core/paths';
import { selectByPattern } from '../core/pattern';
import { uniqueTags } from '../core/tags';
import { inRange, type DateField, type DateRange } from '../core/dates';
import { family } from '../core/format';
import { store } from '../platform';

export interface DropCell {
  label: string;
  /** Move target folder … */
  path?: string;
  /** … or a tag to assign. */
  tag?: string;
}

export interface DropGridConfig {
  cols: number;
  rows: number;
  cells: (DropCell | null)[];
}

export interface Toast {
  id: number;
  text: string;
  undo?: () => Promise<void>;
  error?: boolean;
}

function defaultGrid(places: { name: string; path: string }[]): DropGridConfig {
  const folders = places.slice(1, 5).map((p) => ({ label: p.name, path: p.path }));
  return {
    cols: 3,
    rows: 2,
    cells: [...folders, { label: '#ToReview', tag: 'ToReview' }, { label: '#Work/Design', tag: 'Work/Design' }].slice(0, 6)
  };
}

class AppState {
  backend: Backend = createBackend();

  home = $state('');
  places = $state<{ name: string; path: string }[]>([]);
  cwd = $state('');
  history = $state<string[]>([]);
  future = $state<string[]>([]);
  raw = $state<Entry[]>([]);
  loading = $state(false);

  recursive = $state(store.get('recursive', false));
  view = $state<ViewMode>(store.get('view', 'stream'));
  kanbanBy = $state<Exclude<GroupBy, 'none' | 'month'>>(store.get('kanbanBy', 'tag'));
  tagDepth = $state(store.get('tagDepth', 1));
  sort = $state<SortKey>('name');
  desc = $state(false);
  search = $state('');
  searchMode = $state<'filter' | 'select'>('filter');
  funnel = $state<string | null>(null);
  tileSize = $state(store.get('tileSize', 180));

  selection = new SvelteSet<string>();
  anchor = $state<string | null>(null);
  staging = $state<Entry[]>(store.get('staging', []));

  // Tree: which folders are open, and their (dir-only) children.
  expanded = new SvelteSet<string>(store.get<string[]>('expanded', []));
  children = new SvelteMap<string, Entry[]>();

  preview = $state<{ entry: Entry; from: DOMRect | null } | null>(null);
  tagBarOpen = $state(false);
  gridConfig = $state<DropGridConfig>(store.get('dropGrid', { cols: 3, rows: 2, cells: [] }));
  gridEditorOpen = $state(false);
  recentTags = $state<string[]>(store.get('recentTags', []));
  /** Every tag seen so far, so autocomplete works across folders (until the index lands in phase 2). */
  tagUniverse = $state<string[]>(store.get('tagUniverse', []));
  toasts = $state<Toast[]>([]);
  springDelay = 550;

  /** Calendar heatmap: which date the heatmap counts, and the selected range (filters every view). */
  dateField = $state<DateField>(store.get('dateField', 'mtime'));
  dateFilter = $state<DateRange | null>(null);
  /** Lazily generated thumbnail URLs, keyed by path + mtime. */
  thumbs = new SvelteMap<string, string | null>();
  renaming = $state<string | null>(null);
  menu = $state<{ x: number; y: number; entry: Entry | null } | null>(null);

  /** Entries after all filters except the date range (the calendar shows these). */
  undated = $derived(
    filterEntries(this.raw, {
      search: this.searchMode === 'filter' ? this.search : '',
      funnel: this.funnel,
      showDirs: !this.recursive,
      sort: this.sort,
      desc: this.desc
    })
  );

  /** What the canvas shows. */
  visible = $derived(this.dateFilter ? this.undated.filter((e) => e.kind === 'file' && inRange(e, this.dateFilter!)) : this.undated);

  groups = $derived.by(() => {
    if (this.view === 'kanban') return groupEntries(this.visible, this.kanbanBy, { depth: this.tagDepth });
    if (this.view === 'timeline') return groupEntries(this.visible.filter((e) => e.kind === 'file'), 'month');
    return groupEntries(this.visible, 'none');
  });

  tagIndex = $derived(tagCounts(this.raw));
  knownTags = $derived(
    uniqueTags([
      ...this.tagIndex.keys(),
      ...this.tagUniverse,
      ...this.staging.flatMap((e) => e.tags),
      ...this.gridConfig.cells.flatMap((c) => (c?.tag ? [c.tag] : []))
    ])
  );
  selectedEntries = $derived(this.visible.filter((e) => this.selection.has(e.path)));

  async init() {
    this.home = await this.backend.homeDir();
    this.places = await this.backend.places();
    if (!this.gridConfig.cells.length) this.gridConfig = defaultGrid(this.places);
    const last = store.get<string>('cwd', '');
    await this.navigate(last || this.home, false).catch(() => this.navigate(this.home, false));
    if (!this.expanded.size) this.expanded.add(this.home);
    for (const p of this.expanded) this.loadChildren(p);
    await this.backend.onChange((paths) => this.onFsChange(paths));
  }

  private fsTimer: ReturnType<typeof setTimeout> | null = null;
  private fsDirs = new Set<string>();

  /** External changes (other apps, sync clients): refresh quietly, keep selection. */
  private onFsChange(paths: string[]) {
    for (const p of paths) this.fsDirs.add(dirname(p));
    if (this.fsTimer) clearTimeout(this.fsTimer);
    this.fsTimer = setTimeout(async () => {
      const dirs = [...this.fsDirs];
      this.fsDirs.clear();
      await this.refresh(true);
      await Promise.all(dirs.filter((d) => this.children.has(d)).map((d) => this.loadChildren(d)));
    }, 250);
  }

  // ---------------------------------------------------------------- navigation

  async navigate(path: string, push = true) {
    if (push && this.cwd && path !== this.cwd) {
      this.history.push(this.cwd);
      this.future = [];
    }
    this.cwd = path;
    this.funnel = null;
    this.dateFilter = null;
    this.selection.clear();
    this.anchor = null;
    store.set('cwd', path);
    await this.refresh();
  }

  back() {
    const p = this.history.pop();
    if (p) {
      this.future.push(this.cwd);
      this.navigate(p, false);
    }
  }

  forward() {
    const p = this.future.pop();
    if (p) {
      this.history.push(this.cwd);
      this.navigate(p, false);
    }
  }

  up() {
    const parent = dirname(this.cwd);
    if (parent && parent !== this.cwd) this.navigate(parent);
  }

  async refresh(quiet = false) {
    if (!quiet) this.loading = true;
    try {
      const forceRecursive = this.view === 'kanban' && this.kanbanBy === 'subfolder';
      const recursive = this.recursive || forceRecursive;
      const fresh = recursive ? await this.backend.walk(this.cwd, { maxDepth: 12 }) : await this.backend.listDir(this.cwd);
      // Keep lazily loaded EXIF data across refreshes.
      const prev = new Map(this.raw.map((e) => [e.path, e]));
      this.raw = fresh.map((e) => {
        const o = prev.get(e.path);
        return o && o.mtime === e.mtime && (o.taken !== undefined || o.geo) ? { ...e, taken: e.taken ?? o.taken, geo: e.geo ?? o.geo } : e;
      });
      this.learnTags(this.raw.flatMap((e) => e.tags));
      if (!quiet) this.backend.watch(this.cwd, recursive).catch(() => {});
      if (this.view === 'map' || (this.view === 'calendar' && this.dateField === 'taken')) void this.loadMediaInfo();
    } catch (e) {
      this.toast(String(e), true);
      this.raw = [];
    } finally {
      this.loading = false;
    }
  }

  setRecursive(v: boolean) {
    this.recursive = v;
    store.set('recursive', v);
    this.refresh();
  }

  setView(v: ViewMode) {
    this.view = v;
    store.set('view', v);
    this.refresh();
  }

  setDateField(f: DateField) {
    this.dateField = f;
    store.set('dateField', f);
    if (this.dateFilter) this.dateFilter = { ...this.dateFilter, field: f };
    if (f === 'taken') void this.loadMediaInfo();
  }

  setDateFilter(r: DateRange | null) {
    this.dateFilter = r;
    this.selection.clear();
  }

  // ---------------------------------------------------------------- media

  private thumbQueue: { entry: Entry; key: string }[] = [];
  private thumbActive = 0;

  thumbKey(e: Entry) {
    return `${e.path}|${e.mtime}`;
  }

  /** Called by tiles when they scroll into view. At most 4 thumbnails are generated at once. */
  requestThumb(e: Entry) {
    const key = this.thumbKey(e);
    if (e.thumb || this.thumbs.has(key) || family(e.ext, e.kind) !== 'image') return;
    this.thumbs.set(key, null);
    this.thumbQueue.push({ entry: e, key });
    this.pumpThumbs();
  }

  private pumpThumbs() {
    while (this.thumbActive < 4 && this.thumbQueue.length) {
      // Newest requests first: what the user scrolled to most recently.
      const job = this.thumbQueue.pop()!;
      this.thumbActive++;
      this.backend
        .thumbnail(job.entry, 480)
        .then((url) => this.thumbs.set(job.key, url))
        .catch(() => {})
        .finally(() => {
          this.thumbActive--;
          this.pumpThumbs();
        });
    }
  }

  thumbOf(e: Entry): string | null {
    return e.thumb ?? this.thumbs.get(this.thumbKey(e)) ?? null;
  }

  private mediaLoaded = new Set<string>();

  /** EXIF (GPS, capture date) for photos in the current listing, batched. */
  async loadMediaInfo() {
    const todo = this.raw.filter(
      (e) => e.kind === 'file' && ['jpg', 'jpeg', 'tif', 'tiff', 'heic', 'png', 'webp'].includes(e.ext) && !this.mediaLoaded.has(this.thumbKey(e))
    );
    for (let i = 0; i < todo.length; i += 200) {
      const batch = todo.slice(i, i + 200);
      for (const e of batch) this.mediaLoaded.add(this.thumbKey(e));
      const infos = new Map((await this.backend.mediaInfo(batch.map((e) => e.path))).map((m) => [m.path, m]));
      this.raw = this.raw.map((e) => {
        const m = infos.get(e.path);
        return m ? { ...e, geo: e.geo ?? m.geo, taken: m.taken } : e;
      });
    }
  }

  setKanbanBy(v: 'tag' | 'subfolder') {
    this.kanbanBy = v;
    store.set('kanbanBy', v);
    this.refresh();
  }

  setTileSize(v: number) {
    this.tileSize = v;
    store.set('tileSize', v);
  }

  setFunnel(path: string | null) {
    this.funnel = path;
    this.selection.clear();
  }

  // ---------------------------------------------------------------- tree

  async loadChildren(path: string) {
    try {
      const list = await this.backend.listDir(path);
      this.children.set(
        path,
        list.filter((e) => e.kind === 'dir').sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      );
    } catch {
      this.children.set(path, []);
    }
  }

  async expand(path: string) {
    if (!this.children.has(path)) await this.loadChildren(path);
    this.expanded.add(path);
    this.persistTree();
  }

  collapse(path: string) {
    this.expanded.delete(path);
    this.persistTree();
  }

  toggle(path: string) {
    this.expanded.has(path) ? this.collapse(path) : this.expand(path);
  }

  private persistTree() {
    store.set('expanded', [...this.expanded]);
  }

  // ---------------------------------------------------------------- selection

  select(path: string, mode: 'replace' | 'toggle' | 'range'): void {
    if (mode === 'replace') {
      this.selection.clear();
      this.selection.add(path);
      this.anchor = path;
    } else if (mode === 'toggle') {
      this.selection.has(path) ? this.selection.delete(path) : this.selection.add(path);
      this.anchor = path;
    } else {
      const order = this.visible.map((e) => e.path);
      const a = order.indexOf(this.anchor ?? path);
      const b = order.indexOf(path);
      if (a < 0 || b < 0) return this.select(path, 'replace');
      const [lo, hi] = a < b ? [a, b] : [b, a];
      this.selection.clear();
      for (const p of order.slice(lo, hi + 1)) this.selection.add(p);
    }
  }

  setSelection(paths: Iterable<string>, additive = false) {
    if (!additive) this.selection.clear();
    for (const p of paths) this.selection.add(p);
  }

  selectAll() {
    this.setSelection(this.visible.map((e) => e.path));
  }

  selectPattern(input: string): number {
    const pool = filterEntries(this.raw, { funnel: this.funnel, showDirs: !this.recursive });
    const { paths, errors } = selectByPattern(pool, input);
    if (errors.length) this.toast(errors.join(' · '), true);
    this.setSelection(paths);
    return paths.length;
  }

  // ---------------------------------------------------------------- staging tray

  stage(entries: Entry[]) {
    const have = new Set(this.staging.map((e) => e.path));
    this.staging = [...this.staging, ...entries.filter((e) => e.kind === 'file' && !have.has(e.path))];
    this.persistStaging();
  }

  unstage(paths: string[]) {
    const rm = new Set(paths);
    this.staging = this.staging.filter((e) => !rm.has(e.path));
    this.persistStaging();
  }

  clearStaging() {
    this.staging = [];
    this.persistStaging();
  }

  private persistStaging() {
    // Thumbnails can be large data URIs in the demo; don't persist them.
    store.set(
      'staging',
      this.staging.map((e) => ({ ...e, thumb: e.thumb?.startsWith('data:') ? null : e.thumb }))
    );
  }

  // ---------------------------------------------------------------- operations

  async transfer(entries: Entry[], targetDir: string, mode: TransferMode) {
    const paths = entries.map((e) => e.path).filter((p) => !(mode === 'move' && dirname(p) === targetDir));
    if (!paths.length) return;
    const res = await this.backend.transfer(paths, targetDir, mode);
    const n = Object.keys(res.moved).length;
    if (res.errors.length) this.toast(res.errors.map((e) => e.message).join(' · '), true);
    if (n) {
      const verb = mode === 'move' ? 'verschoben' : 'kopiert';
      const undo =
        mode === 'move'
          ? async () => {
              const byDir = new Map<string, string[]>();
              for (const [from, to] of Object.entries(res.moved)) {
                const d = dirname(from);
                byDir.set(d, [...(byDir.get(d) ?? []), to]);
              }
              for (const [d, ps] of byDir) await this.backend.transfer(ps, d, 'move');
              await this.afterFsChange();
            }
          : undefined;
      this.toast(`${n} ${n === 1 ? 'Objekt' : 'Objekte'} ${verb} → ${targetDir.split(/[\\/]/).pop()}`, false, undo);
    }
    // Keep the tray pointing at the new locations.
    if (mode === 'move' && n) {
      this.staging = this.staging.map((e) => (res.moved[e.path] ? { ...e, path: res.moved[e.path] } : e));
      this.persistStaging();
    }
    await this.afterFsChange();
  }

  async patchMeta(entries: Entry[], patch: MetaPatch, label?: string) {
    if (!entries.length) return;
    const updated = await this.backend.updateMeta(
      entries.map((e) => e.path),
      patch
    );
    const byPath = new Map(updated.map((e) => [e.path, e]));
    const merge = (e: Entry) => {
      const u = byPath.get(e.path);
      return u ? { ...e, tags: u.tags, color: u.color } : e;
    };
    this.raw = this.raw.map(merge);
    this.staging = this.staging.map(merge);
    this.persistStaging();
    if (patch.addTags?.length) this.rememberTags(patch.addTags);
    if (label) this.toast(label);
  }

  /** Right-half drop: copy a folder's tags/color onto files without moving them. */
  async applyFolderAttributes(entries: Entry[], folder: string) {
    const meta = await this.backend.folderMeta(folder);
    const name = folder.split(/[\\/]/).pop()!;
    const tags = meta.tags.length ? meta.tags : [name];
    await this.patchMeta(
      entries,
      { addTags: tags, color: meta.color ?? undefined },
      `${entries.length} × ${tags.map((t) => '#' + t).join(' ')} zugewiesen`
    );
  }

  private learnTags(tags: string[]) {
    const next = uniqueTags([...this.tagUniverse, ...tags]);
    if (next.length !== this.tagUniverse.length) {
      this.tagUniverse = next.slice(-500);
      store.set('tagUniverse', this.tagUniverse);
    }
  }

  rememberTags(tags: string[]) {
    this.learnTags(tags);
    this.recentTags = uniqueTags([...tags, ...this.recentTags]).slice(0, 12);
    store.set('recentTags', this.recentTags);
  }

  async mkdir(name: string) {
    const p = await this.backend.mkdir(this.funnel ?? this.cwd, name);
    await this.afterFsChange();
    return p;
  }

  /** New folder, then straight into rename mode (like Finder). */
  async newFolder() {
    try {
      const p = await this.mkdir('Neuer Ordner');
      this.select(p, 'replace');
      this.renaming = p;
    } catch (e) {
      this.toast(String(e), true);
    }
  }

  async rename(path: string, newName: string) {
    // Enter and the following blur both end editing; only the first one counts.
    if (this.renaming !== path) return;
    this.renaming = null;
    if (!newName.trim() || newName === basename(path)) return;
    try {
      const e = await this.backend.rename(path, newName);
      this.staging = this.staging.map((s) => (s.path === path ? { ...s, path: e.path, name: e.name } : s));
      await this.afterFsChange();
      this.select(e.path, 'replace');
    } catch (err) {
      this.toast(String(err), true);
    }
  }

  async trash(entries: Entry[]) {
    if (!entries.length) return;
    const res = await this.backend.trash(entries.map((e) => e.path));
    const n = Object.keys(res.moved).length;
    if (res.errors.length) this.toast(res.errors.map((e) => e.message).join(' · '), true);
    if (n) this.toast(`${n} ${n === 1 ? 'Objekt' : 'Objekte'} in den Papierkorb gelegt`);
    this.unstage(Object.keys(res.moved));
    await this.afterFsChange();
  }

  async open(e: Entry) {
    if (e.kind === 'dir') return this.navigate(e.path);
    try {
      await this.backend.openDefault(e.path);
    } catch (err) {
      this.toast(String(err).replace(/^Error: /, ''), true);
    }
  }

  async reveal(e: Entry) {
    try {
      await this.backend.reveal(e.path);
    } catch (err) {
      this.toast(String(err).replace(/^Error: /, ''), true);
    }
  }

  private async afterFsChange() {
    await this.refresh();
    // Reload every open tree branch (cheap; trees are shallow by nature).
    await Promise.all([...this.children.keys()].map((p) => this.loadChildren(p)));
    for (const p of [...this.selection]) if (!this.raw.some((e) => e.path === p)) this.selection.delete(p);
    if (this.funnel && !this.raw.some((e) => isWithin(e.path, this.funnel!))) this.funnel = null;
  }

  saveGrid(cfg: DropGridConfig) {
    this.gridConfig = cfg;
    store.set('dropGrid', cfg);
  }

  // ---------------------------------------------------------------- toasts

  private toastId = 0;
  toast(text: string, error = false, undo?: () => Promise<void>) {
    const id = ++this.toastId;
    text = text.replace(/^Error: /, '');
    this.toasts = [...this.toasts, { id, text, error, undo }];
    setTimeout(() => this.dismiss(id), undo ? 7000 : 3500);
  }

  dismiss(id: number) {
    this.toasts = this.toasts.filter((t) => t.id !== id);
  }
}

export const app = new AppState();
