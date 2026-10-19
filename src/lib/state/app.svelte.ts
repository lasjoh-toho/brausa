/**
 * Central application state (Svelte 5 runes). Components read from `app` and
 * call its methods; all file-system effects go through the Backend.
 */
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import type { Entry, MetaPatch, TransferMode } from '../core/types';
import type { Backend } from '../backend';
import type { IndexReport, LibraryInfo, MediaInfo } from '../backend/types';
import { createBackend } from '../backend';
import { parseCategories } from '../core/pattern';
import { archiveName, archiveRoot, inArchive, isArchive } from '../core/archive';
import type { ProjectInfo } from '../backend/types';
import { filterEntries, groupEntries, tagCounts, type GroupBy, type SortKey, type ViewMode } from '../core/views';
import { basename, dirname, isWithin } from '../core/paths';
import { selectByPattern } from '../core/pattern';
import { uniqueTags } from '../core/tags';
import { inRange, type DateField, type DateRange } from '../core/dates';
import { family, formatSize } from '../core/format';
import { extras, keeper } from '../core/dupes';
import { renameOrder, type RenameStep } from '../core/rename';
import { store } from '../platform';
import { t, tn } from '../i18n/index.svelte';
import { describe, dropProject, followMoves, placeName, suggestName, toggleLink, type SmartFolder, type SmartView } from '../core/smart';

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
  /** Label of the button that runs `undo` (default: Undo). */
  action?: string;
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
  /** Projects: folders with their own index. */
  libraries = $state<LibraryInfo[]>([]);
  /** Projects: named collections of files and folders from anywhere. */
  projects = $state<ProjectInfo[]>([]);
  /** Project shown instead of a folder (all its files, wherever they are). */
  project = $state<string | null>(store.get('project', null));
  currentProject = $derived(this.projects.find((p) => p.id === this.project) ?? null);
  /** Last project worked on; the map view falls back to it. */
  lastProject = $state<string | null>(store.get('lastProject', null));
  /** Standard places as the core names them (German); `places` shows them in the UI language. */
  private placesRaw = $state<{ name: string; path: string }[]>([]);
  places = $derived(this.placesRaw.map((p) => ({ ...p, name: t(`places.${p.name}`) === `places.${p.name}` ? p.name : t(`places.${p.name}`) })));
  cwd = $state('');
  history = $state<string[]>([]);
  future = $state<string[]>([]);
  raw = $state<Entry[]>([]);
  loading = $state(false);

  recursive = $state(store.get('recursive', false));
  view = $state<ViewMode>(store.get('view', 'stream'));
  kanbanBy = $state<Exclude<GroupBy, 'none' | 'month'>>(store.get('kanbanBy', 'tag'));
  tagDepth = $state(store.get('tagDepth', 1));
  sort = $state<SortKey>(store.get('sort', 'name'));
  desc = $state(store.get('desc', false));
  /** Width of the preview column in the three-panel view. */
  previewWidth = $state(store.get('previewWidth', 420));
  search = $state('');
  searchMode = $state<'filter' | 'select'>('filter');
  funnel = $state<string | null>(null);
  /** Type filter from the toolbar (Bilder, Videos, …); null shows everything. */
  typeFilter = $state<string | null>(store.get('typeFilter', null));
  tileSize = $state(store.get('tileSize', 180));

  selection = new SvelteSet<string>();
  anchor = $state<string | null>(null);
  staging = $state<Entry[]>(store.get('staging', []));

  // Tree: which folders are open, and their (dir-only) children.
  expanded = new SvelteSet<string>(store.get<string[]>('expanded', []));
  children = new SvelteMap<string, Entry[]>();

  preview = $state<{ entry: Entry; from: DOMRect | null } | null>(null);
  /** Folder shown in the second panel (null: closed). */
  pane = $state<string | null>(store.get('pane', null));
  /** Bumped after brausa changed files, so other views (second panel) reload. */
  fsVersion = $state(0);
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
  /** Entries in the batch rename dialog (null: closed). */
  batchRenaming = $state<Entry[] | null>(null);
  menu = $state<{ x: number; y: number; entry: Entry | null } | null>(null);
  /** Open confirmation dialog (see ask()). */
  dialog = $state<{ title: string; text: string; ok: string; danger?: boolean; resolve: (yes: boolean) => void } | null>(null);

  /** Saved searches/filters (intelligente Ordner). */
  smartFolders = $state<SmartFolder[]>([]);

  /** The current place and filters, as a smart folder would store them. */
  currentView = $derived<SmartView>({
    scope: this.project ? { project: this.project } : { folder: this.cwd },
    search: this.searchMode === 'filter' ? this.search : '',
    typeFilter: this.typeFilter,
    recursive: this.recursive,
    date: this.dateFilter
  });

  /** Entries after all filters except the date range (the calendar shows these). */
  undated = $derived(
    filterEntries(this.raw, {
      search: this.searchMode === 'filter' ? this.search : '',
      funnel: this.funnel,
      cats: this.typeFilter ? parseCategories(this.typeFilter) : null,
      showDirs: !this.recursive && !this.typeFilter && !this.project,
      sort: this.sort,
      desc: this.desc
    })
  );

  /** The project the map view works on: the open one, else one holding this folder, else the last one. */
  boardProject = $derived(
    this.currentProject ?? this.projectOf(this.cwd) ?? this.projects.find((p) => p.id === this.lastProject) ?? null
  );

  /** Duplicate search result (groups of paths with equal content); null: not looking for duplicates. */
  dupes = $state<string[][] | null>(null);
  dupeBusy = $state(false);

  /** What the canvas shows. */
  visible = $derived.by(() => {
    const dated = this.dateFilter ? this.undated.filter((e) => e.kind === 'file' && inRange(e, this.dateFilter!)) : this.undated;
    if (!this.dupes) return dated;
    const keep = new Set(this.dupes.flat());
    return dated.filter((e) => keep.has(e.path));
  });

  /** Duplicate groups as entries, still present and visible (groups of one drop out after deleting). */
  dupeGroups = $derived.by(() => {
    if (!this.dupes) return [];
    const by = new Map(this.visible.map((e) => [e.path, e]));
    return this.dupes
      .map((g) => g.flatMap((p) => by.get(p) ?? []))
      .filter((g) => g.length > 1)
      .map((g) => {
        // The copy that stays comes first.
        const k = keeper(g);
        return [k, ...g.filter((e) => e !== k)];
      });
  });

  groups = $derived.by(() => {
    if (this.dupes)
      return this.dupeGroups.map((g) => ({ key: g[0].path, label: t('app.dupeGroup', { name: g[0].name, size: formatSize(g[0].size) }), entries: g }));
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
    // The last session hung in a view: start plain, so it does not hang again.
    const stuck = await this.backend.stuckView().catch(() => null);
    if (stuck) this.startPlain(stuck);
    this.heartbeat();
    this.placesRaw = await this.backend.places();
    if (!this.gridConfig.cells.length) this.gridConfig = defaultGrid(this.places);
    const last = store.get<string>('cwd', '');
    await this.navigate(last || this.home, false).catch(() => this.navigate(this.home, false));
    if (!this.expanded.size) this.expanded.add(this.home);
    for (const p of this.expanded) this.loadChildren(p);
    await this.backend.onChange((paths) => this.onFsChange(paths));
    await this.loadLibraries();
    await this.loadProjects();
    await this.loadSmartFolders();
    if (this.project) await this.refresh();
    await this.backend.onIndexReport((r) => this.onIndexReport(r));
  }

  /** Tell the core's watchdog that the interface responds, and what it shows. */
  private heartbeat() {
    const beat = () => {
      const where = this.currentProject?.name ?? basename(this.cwd);
      void this.backend.alive(`${t('toolbar.view.' + this.view)}${where ? ' · ' + where : ''}`).catch(() => {});
    };
    beat();
    setInterval(beat, 2000);
  }

  /** Plain tiles of the home folder, without Stream and filters. */
  private startPlain(stuck: string) {
    this.view = 'stream';
    store.set('view', 'stream');
    this.recursive = false;
    store.set('recursive', false);
    this.typeFilter = null;
    store.set('typeFilter', null);
    this.setProject(null);
    store.set('cwd', '');
    this.toast(t('app.startedPlain', { view: stuck }), true);
  }

  // ---------------------------------------------------------------- projects

  async loadProjects() {
    this.projects = await this.backend.projects();
    if (this.project && !this.projects.some((p) => p.id === this.project)) this.setProject(null);
  }

  private setProject(id: string | null) {
    this.project = id;
    store.set('project', id);
    if (id) {
      this.lastProject = id;
      store.set('lastProject', id);
    }
  }

  /** A project holding this folder (as one of its folders), if any. */
  projectOf(path: string): ProjectInfo | null {
    return this.projects.find((p) => p.folders.some((f) => isWithin(path, f))) ?? null;
  }

  /** Show a project: all its files from all places, in every view. */
  async openProject(id: string) {
    // Back (⌘[) returns to the folder shown before.
    if (!this.project && this.cwd) {
      this.history.push(this.cwd);
      this.future = [];
    }
    this.setProject(id);
    this.dupes = null;
    this.funnel = null;
    this.dateFilter = null;
    this.selection.clear();
    this.anchor = null;
    await this.refresh();
  }

  async createProject(name: string, open = true) {
    try {
      const p = await this.backend.createProject(name);
      await this.loadProjects();
      if (open) await this.openProject(p.id);
      return p;
    } catch (e) {
      this.toast(String(e).replace(/^Error: /, ''), true);
      return null;
    }
  }

  async renameProject(id: string, name: string) {
    try {
      await this.backend.updateProject(id, { name });
      await this.loadProjects();
    } catch (e) {
      this.toast(String(e).replace(/^Error: /, ''), true);
    }
  }

  async deleteProject(id: string) {
    const p = this.projects.find((x) => x.id === id);
    await this.backend.deleteProject(id);
    const kept = dropProject(this.smartFolders, id);
    if (kept.length !== this.smartFolders.length || kept.some((f, i) => f !== this.smartFolders[i])) {
      this.smartFolders = kept;
      this.saveSmartFolders();
    }
    if (this.project === id) await this.navigate(this.cwd);
    await this.loadProjects();
    this.toast(t('app.projectDeleted', { name: p?.name ?? '' }));
  }

  /** Files and folders join a project; they stay where they are. */
  async addToProject(id: string, entries: Entry[]) {
    const p = this.projects.find((x) => x.id === id);
    try {
      const n = await this.backend.addToProject(id, entries.map((e) => e.path));
      await this.loadProjects();
      this.toast(n ? tn('app.addedToProject', n, { name: p?.name ?? '' }) : t('app.alreadyInProject', { name: p?.name ?? '' }));
      if (this.project === id) await this.refresh(true);
    } catch (e) {
      this.toast(String(e).replace(/^Error: /, ''), true);
    }
  }

  /** Takes files out of the open project (not from the disk). */
  async removeFromProject(entries: Entry[]) {
    const p = this.currentProject;
    if (!p || !entries.length) return;
    const n = await this.backend.removeFromProject(p.id, entries.map((e) => e.path));
    const left = entries.length - n;
    this.toast(left ? t('app.removedFromProjectKept', { n, name: p.name, left }) : t('app.removedFromProject', { n, name: p.name }));
    await this.loadProjects();
    await this.refresh(true);
  }

  // ---------------------------------------------------------------- projects / index

  // ---------------------------------------------------------------- duplicates

  /** Look for files with equal content among the files shown (with subfolders). */
  async findDuplicates() {
    if (this.dupeBusy) return;
    this.dupes = null;
    if (!this.recursive && !this.project) {
      this.recursive = true;
      store.set('recursive', true);
      await this.refresh();
    }
    const files = this.visible.filter((e) => e.kind === 'file' && !inArchive(e.path));
    if (files.length < 2) {
      this.toast(t('app.nothingToCompare'));
      return;
    }
    this.dupeBusy = true;
    try {
      const groups = await this.backend.findDuplicates(files.map((e) => e.path));
      if (!groups.length) this.toast(tn('app.noDupes', files.length));
      else {
        this.selection.clear();
        this.dupes = groups;
      }
    } catch (e) {
      this.toast(String(e).replace(/^Error: /, ''), true);
    } finally {
      this.dupeBusy = false;
    }
  }

  endDuplicates() {
    this.dupes = null;
    this.selection.clear();
  }

  /** Select every copy but one per group, ready for the trash. */
  selectExtras() {
    this.setSelection(extras(this.dupeGroups).map((e) => e.path));
  }

  // ---------------------------------------------------------------- smart folders

  smartPlace(f: SmartView) {
    return placeName(f.scope, (id) => this.projects.find((p) => p.id === id)?.name);
  }

  smartSummary(f: SmartView) {
    return describe(f, this.smartPlace(f));
  }

  suggestSmartName() {
    return suggestName(this.currentView, this.smartPlace(this.currentView));
  }

  /** Smart folders live in the core (smart.json); older versions kept them in the browser storage. */
  private async loadSmartFolders() {
    try {
      const saved = await this.backend.smartFolders();
      if (saved) this.smartFolders = saved;
      else {
        this.smartFolders = store.get<SmartFolder[]>('smartFolders', []);
        this.saveSmartFolders();
      }
    } catch (e) {
      this.toast(String(e), true);
    }
  }

  private saveSmartFolders() {
    this.backend.saveSmartFolders($state.snapshot(this.smartFolders) as SmartFolder[]).catch((e) => this.toast(String(e), true));
  }

  /** Show a smart folder under a project too, or no longer. */
  linkSmart(id: string, project: string) {
    this.smartFolders = this.smartFolders.map((f) => (f.id === id ? toggleLink(f, project) : f));
    this.saveSmartFolders();
  }

  /** Save the current place and filters under a name. */
  saveSmart(name: string) {
    const v = $state.snapshot(this.currentView) as SmartView;
    const f: SmartFolder = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name.trim() || this.suggestSmartName(), ...v };
    this.smartFolders = [...this.smartFolders, f];
    this.saveSmartFolders();
    this.toast(t('app.smartSaved', { name: f.name }));
    return f;
  }

  /** Open the place and restore every filter of a smart folder. */
  async openSmart(id: string) {
    const f = this.smartFolders.find((x) => x.id === id);
    if (!f) return;
    if ('project' in f.scope && !this.projects.some((p) => 'project' in f.scope && p.id === f.scope.project)) {
      this.toast(t('app.smartProjectGone', { name: f.name }), true);
      return;
    }
    // Set the filters before loading, so the place is read only once.
    this.typeFilter = f.typeFilter;
    store.set('typeFilter', f.typeFilter);
    this.searchMode = 'filter';
    this.search = f.search;
    if ('project' in f.scope) await this.openProject(f.scope.project);
    else {
      this.recursive = f.recursive;
      store.set('recursive', f.recursive);
      await this.navigate(f.scope.folder);
    }
    if (f.date) {
      this.dateField = f.date.field;
      store.set('dateField', f.date.field);
      if (f.date.field === 'taken') void this.loadMediaInfo();
    }
    this.dateFilter = f.date;
  }

  renameSmart(id: string, name: string) {
    if (!name.trim()) return;
    this.smartFolders = this.smartFolders.map((f) => (f.id === id ? { ...f, name: name.trim() } : f));
    this.saveSmartFolders();
  }

  /** Replace a smart folder's filters with the current ones. */
  updateSmart(id: string) {
    const v = $state.snapshot(this.currentView) as SmartView;
    this.smartFolders = this.smartFolders.map((f) => (f.id === id ? { ...f, ...v } : f));
    this.saveSmartFolders();
  }

  /** Keep smart folders pointing at folders that were moved or renamed. */
  private followSmart(moved: Record<string, string>) {
    const next = followMoves(this.smartFolders, moved);
    if (next) {
      this.smartFolders = next;
      this.saveSmartFolders();
    }
  }

  removeSmart(id: string) {
    const f = this.smartFolders.find((x) => x.id === id);
    if (!f) return;
    const at = this.smartFolders.indexOf(f);
    this.smartFolders = this.smartFolders.filter((x) => x.id !== id);
    this.saveSmartFolders();
    this.toast(t('app.smartRemoved', { name: f.name }), false, async () => {
      this.smartFolders = [...this.smartFolders.slice(0, at), f, ...this.smartFolders.slice(at)];
      this.saveSmartFolders();
    });
  }

  async loadLibraries() {
    this.libraries = (await this.backend.libraries()).sort((a, b) => a.name.localeCompare(b.name));
  }

  private onIndexReport(r: IndexReport) {
    const parts: string[] = [];
    if (r.relinked.length) parts.push(t('app.indexRelinked', { n: r.relinked.length }));
    if (r.imported) parts.push(t('app.indexImported', { n: r.imported }));
    if (r.restored) parts.push(t('app.indexRestored', { n: r.restored }));
    if (r.orphaned.length) parts.push(t('app.indexOrphaned', { n: r.orphaned.length }));
    if (parts.length) this.toast(t('app.indexReport', { parts: parts.join(' · ') }));
    void this.loadLibraries();
    void this.refresh(true);
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
    this.setProject(null);
    this.dupes = null;
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
      const fresh = this.project
        ? await this.backend.projectEntries(this.project)
        : recursive
          ? await this.backend.walk(this.cwd, { maxDepth: 12 })
          : await this.backend.listDir(this.cwd);
      // Keep lazily loaded EXIF data across refreshes.
      const prev = new Map(this.raw.map((e) => [e.path, e]));
      this.raw = fresh.map((e) => {
        const o = prev.get(e.path);
        return o && o.mtime === e.mtime && (o.taken !== undefined || o.geo) ? { ...e, taken: e.taken ?? o.taken, geo: e.geo ?? o.geo } : e;
      });
      this.learnTags(this.raw.flatMap((e) => e.tags));
      if (!quiet && !this.project) this.backend.watch(this.cwd, recursive).catch(() => {});
      if (this.view === 'map' || (this.view === 'calendar' && this.dateField === 'taken') || this.sort === 'taken') void this.loadMediaInfo();
    } catch (e) {
      this.toast(String(e), true);
      this.raw = [];
    } finally {
      this.loading = false;
    }
  }

  /** Show only one kind of file; picking one also turns on Stream so subfolders count too. */
  setTypeFilter(v: string | null) {
    this.typeFilter = v;
    store.set('typeFilter', v);
    if (v && !this.recursive) this.setRecursive(true);
  }

  /** Sort every view; picking the current key again flips the direction. */
  setSort(key: SortKey, desc?: boolean) {
    this.desc = desc ?? (key === this.sort ? !this.desc : key !== 'name' && key !== 'ext');
    this.sort = key;
    store.set('sort', key);
    store.set('desc', this.desc);
    if (key === 'taken') void this.loadMediaInfo();
  }

  setPreviewWidth(w: number) {
    this.previewWidth = Math.max(240, Math.min(1200, w));
    store.set('previewWidth', this.previewWidth);
  }

  /** Last entry clicked or reached with the arrow keys; the three-panel view previews it. */
  cursor = $state<string | null>(null);
  current = $derived(
    (this.cursor && this.selection.has(this.cursor) ? this.visible.find((e) => e.path === this.cursor) : undefined) ??
      this.selectedEntries[0] ??
      null
  );

  /** Arrow keys: next/previous entry in the list (Shift extends the selection). */
  step(delta: number, extend = false) {
    const list = this.visible;
    if (!list.length) return;
    const at = this.cursor ? list.findIndex((e) => e.path === this.cursor) : -1;
    const next = list[Math.max(0, Math.min(list.length - 1, at < 0 ? 0 : at + delta))];
    this.select(next.path, extend && this.anchor ? 'range' : 'replace');
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
  /** Reading photo data (date taken, location) in the background; null: idle or quick. */
  mediaProgress = $state<{ done: number; total: number } | null>(null);
  private mediaRun = 0;

  async loadMediaInfo() {
    const run = ++this.mediaRun;
    const todo = this.raw.filter(
      (e) => e.kind === 'file' && ['jpg', 'jpeg', 'tif', 'tiff', 'heic', 'png', 'webp'].includes(e.ext) && !this.mediaLoaded.has(this.thumbKey(e))
    );
    if (!todo.length) return;
    const started = Date.now();
    let shown = started;
    const found = new Map<string, MediaInfo>();
    // Results go into the view about once a second, not per batch: every update re-sorts and redraws everything.
    const flush = () => {
      if (!found.size) return;
      const got = new Map(found);
      found.clear();
      this.raw = this.raw.map((e) => {
        const m = got.get(e.path);
        return m ? { ...e, geo: e.geo ?? m.geo, taken: m.taken } : e;
      });
      shown = Date.now();
    };
    try {
      for (let i = 0; i < todo.length; i += 200) {
        // Cancelled, or another folder was opened.
        if (run !== this.mediaRun) break;
        const batch = todo.slice(i, i + 200);
        for (const m of await this.backend.mediaInfo(batch.map((e) => e.path))) found.set(m.path, m);
        for (const e of batch) this.mediaLoaded.add(this.thumbKey(e));
        if (run === this.mediaRun && Date.now() - started > 800) this.mediaProgress = { done: i + batch.length, total: todo.length };
        if (Date.now() - shown > 1200) flush();
      }
    } finally {
      flush();
      if (run === this.mediaRun) this.mediaProgress = null;
    }
  }

  /** Stop reading photo data; what was read so far stays. */
  cancelMediaInfo() {
    this.mediaRun++;
    this.mediaProgress = null;
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

  /** Filters narrowing the view right now (the empty view offers to remove them). */
  activeFilters = $derived.by(() => {
    const f: { kind: 'search' | 'type' | 'date' | 'funnel'; label: string }[] = [];
    if (this.searchMode === 'filter' && this.search.trim()) f.push({ kind: 'search', label: this.search.trim() });
    if (this.typeFilter) f.push({ kind: 'type', label: this.typeFilter });
    if (this.dateFilter) f.push({ kind: 'date', label: '' });
    if (this.funnel) f.push({ kind: 'funnel', label: basename(this.funnel) });
    return f;
  });

  clearFilter(kind: 'search' | 'type' | 'date' | 'funnel') {
    if (kind === 'search') this.search = '';
    else if (kind === 'type') this.setTypeFilter(null);
    else if (kind === 'date') this.setDateFilter(null);
    else this.setFunnel(null);
  }

  clearFilters() {
    for (const f of this.activeFilters) this.clearFilter(f.kind);
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
    this.cursor = path;
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

  /** Asks before something that cannot simply be undone; resolves to the answer. */
  ask(o: { title: string; text: string; ok: string; danger?: boolean }): Promise<boolean> {
    this.dialog?.resolve(false);
    return new Promise((resolve) => {
      this.dialog = {
        ...o,
        resolve: (yes) => {
          this.dialog = null;
          resolve(yes);
        }
      };
    });
  }

  /** Into an archive: always a copy, after asking (and naming what gets replaced). */
  private async packInto(entries: Entry[], targetDir: string) {
    const name = archiveName(targetDir);
    if (entries.some((e) => archiveName(e.path) === name && inArchive(e.path))) {
      this.toast(t('app.noMoveInArchive'), true);
      return;
    }
    let replaced: string[] = [];
    try {
      replaced = await this.backend.archiveConflicts(targetDir, entries.map((e) => basename(e.path)));
    } catch {
      /* the archive itself will report the problem */
    }
    const n = entries.length;
    const ok = await this.ask({
      title: t('app.packTitle', { name: basename(name) }),
      text: [
        tn('app.packText', n, { name: entries[0].name }),
        ...(replaced.length ? [t('app.packReplaced', { names: replaced.map((r) => t('app.quoted', { name: r })).join(', ') })] : []),
        t('app.archiveBackup')
      ].join(' '),
      ok: t('app.packOk'),
      danger: replaced.length > 0
    });
    if (!ok) return;
    try {
      const res = await this.backend.transfer(
        entries.map((e) => e.path),
        targetDir,
        'copy'
      );
      const k = Object.keys(res.moved).length;
      this.toast(tn('app.packed', k, { name: basename(name) }));
    } catch (e) {
      this.toast(String(e).replace(/^Error: /, ''), true);
    }
    await this.afterFsChange();
  }

  async compress(entries: Entry[]) {
    if (!entries.length) return;
    try {
      const p = await this.backend.compress(entries.map((e) => e.path));
      await this.afterFsChange();
      if (!inArchive(entries[0].path)) this.select(p, 'replace');
      this.toast(t('app.created', { name: basename(p) }));
    } catch (e) {
      this.toast(String(e).replace(/^Error: /, ''), true);
    }
  }

  async transfer(entries: Entry[], targetDir: string, mode: TransferMode) {
    if (inArchive(targetDir)) return this.packInto(entries, targetDir);
    // Out of an archive is always a copy: the archive stays as it is.
    if (entries.some((e) => inArchive(e.path))) mode = 'copy';
    const paths = entries.map((e) => e.path).filter((p) => !(mode === 'move' && dirname(p) === targetDir));
    if (!paths.length) return;
    const res = await this.backend.transfer(paths, targetDir, mode);
    const n = Object.keys(res.moved).length;
    if (res.errors.length) this.toast(res.errors.map((e) => e.message).join(' · '), true);
    if (n) {
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
      this.toast(tn(mode === 'move' ? 'app.moved' : 'app.copied', n, { folder: targetDir.split(/[\\/]/).pop() ?? '' }), false, undo);
    }
    // Keep the tray pointing at the new locations.
    if (mode === 'move' && n) {
      this.staging = this.staging.map((e) => (res.moved[e.path] ? { ...e, path: res.moved[e.path] } : e));
      this.persistStaging();
      this.followSmart(res.moved);
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
      t('app.assigned', { n: entries.length, tags: tags.map((x) => '#' + x).join(' ') })
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
      const p = await this.mkdir(t('app.newFolder'));
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
      this.followSmart({ [path]: e.path });
      await this.afterFsChange();
      this.select(e.path, 'replace');
    } catch (err) {
      this.toast(String(err), true);
    }
  }

  /** Names already used in a folder (as far as the current listing knows). */
  siblingNames(dir: string): string[] {
    return this.raw.filter((e) => dirname(e.path) === dir).map((e) => e.name);
  }

  /**
   * Rename one by one; names wanted by another entry of the batch are moved
   * aside to a temporary name first, so swaps work. Returns what was done.
   */
  private async runRenames(steps: RenameStep[]): Promise<{ from: string; to: string }[]> {
    const order = renameOrder(steps);
    const done: { from: string; to: string }[] = [];
    const aside = new Map<RenameStep, string>();
    try {
      for (const o of order)
        if (o.viaTemp) aside.set(o.step, (await this.backend.rename(o.step.entry.path, `.brausa-${Date.now().toString(36)}-${o.step.entry.name}`)).path);
      for (const o of order) {
        const e = await this.backend.rename(aside.get(o.step) ?? o.step.entry.path, o.step.name);
        aside.delete(o.step);
        done.push({ from: o.step.entry.path, to: e.path });
      }
    } catch (err) {
      this.toast(String(err).replace(/^Error: /, ''), true);
      // Files still parked under a temporary name get their old name back.
      for (const [st, p] of aside) await this.backend.rename(p, st.entry.name).catch(() => {});
    }
    return done;
  }

  /** Apply a planned batch rename (see core/rename), with undo. */
  async batchRename(steps: RenameStep[]) {
    this.batchRenaming = null;
    const done = await this.runRenames(steps);
    const moved = Object.fromEntries(done.map((d) => [d.from, d.to]));
    const follow = (m: Record<string, string>) => {
      this.staging = this.staging.map((e) => (m[e.path] ? { ...e, path: m[e.path], name: basename(m[e.path]) } : e));
      this.persistStaging();
      this.followSmart(m);
    };
    follow(moved);
    await this.afterFsChange();
    if (!done.length) return;
    this.setSelection(done.map((d) => d.to));
    this.toast(tn('app.renamed', done.length), false, async () => {
      const back = done.map((d) => ({
        entry: { ...this.raw.find((e) => e.path === d.to), path: d.to, name: basename(d.to) } as Entry,
        name: basename(d.from),
        changed: true
      }));
      const undone = await this.runRenames(back);
      follow(Object.fromEntries(undone.map((d) => [d.from, d.to])));
      await this.afterFsChange();
    });
  }

  async trash(entries: Entry[]) {
    if (!entries.length) return;
    const packed = entries.filter((e) => inArchive(e.path));
    if (packed.length) {
      const archives = [...new Set(packed.map((e) => basename(archiveName(e.path))))];
      const n = packed.length;
      const ok = await this.ask({
        title: t('app.trashArchiveTitle', { names: archives.map((a) => t('app.quoted', { name: a })).join(', ') }),
        text: tn('app.trashArchiveText', n, { name: packed[0].name }),
        ok: t('common.delete'),
        danger: true
      });
      if (!ok) return;
    }
    const res = await this.backend.trash(entries.map((e) => e.path));
    const n = Object.keys(res.moved).length;
    if (res.errors.length) this.toast(res.errors.map((e) => e.message).join(' · '), true);
    if (n) this.toast(tn(entries.some((e) => inArchive(e.path)) ? 'app.deletedFromArchive' : 'app.trashed', n));
    this.unstage(Object.keys(res.moved));
    await this.afterFsChange();
  }

  async open(e: Entry) {
    if (e.kind === 'dir') return this.navigate(e.path);
    // Archives open like folders (read only).
    if (isArchive(e.path) && !inArchive(e.path)) return this.navigate(archiveRoot(e.path));
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

  setPane(path: string | null) {
    this.pane = path;
    store.set('pane', path);
  }

  private async afterFsChange() {
    this.fsVersion++;
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
  toast(text: string, error = false, undo?: () => Promise<void>, opts: { action?: string; ms?: number } = {}) {
    const id = ++this.toastId;
    text = text.replace(/^Error: /, '');
    this.toasts = [...this.toasts, { id, text, error, undo, action: opts.action }];
    setTimeout(() => this.dismiss(id), opts.ms ?? (undo ? 7000 : 3500));
  }

  dismiss(id: number) {
    this.toasts = this.toasts.filter((t) => t.id !== id);
  }
}

export const app = new AppState();
