import type { SmartFolder } from '../core/smart';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Entry, MetaPatch, TransferMode } from '../core/types';
import { inArchive } from '../core/archive';
import { t } from '../i18n/index.svelte';
import type { ProjectMap } from '../core/map';
import type {
  Backend,
  IndexReport,
  LibraryInfo,
  ProjectInfo,
  WebBounds,
  WebEvent,
  MapInfo,
  MediaInfo,
  TransferResult,
  WalkOptions,
  OverlayResolution,
  WikiBag,
  WikiLayer,
  WikiOverlay,
  WikiRecipe,
  WikiSyncReport
} from './types';

/** Formats the webview can show as-is. Raster thumbnails come from the Rust cache instead. */
const WEB_IMAGE = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'bmp']);

/** Vector graphics need no thumbnail; everything else is requested lazily by the tile. */
function withThumb(e: Entry): Entry {
  return e.kind === 'file' && e.ext === 'svg' ? { ...e, thumb: convertFileSrc(e.path) } : e;
}

export class TauriBackend implements Backend {
  readonly name = 'tauri' as const;

  homeDir() {
    return invoke<string>('home_dir');
  }

  places() {
    return invoke<{ name: string; path: string }[]>('places');
  }

  async listDir(path: string, opts: { includeHidden?: boolean } = {}) {
    return (await invoke<Entry[]>('list_dir', { path, includeHidden: opts.includeHidden ?? false })).map(withThumb);
  }

  async walk(root: string, opts: WalkOptions = {}) {
    const r = await invoke<Entry[]>('walk', {
      root,
      maxDepth: opts.maxDepth ?? 32,
      includeHidden: opts.includeHidden ?? false,
      limit: opts.limit ?? 20000
    });
    return r.map(withThumb);
  }

  transfer(paths: string[], targetDir: string, mode: TransferMode) {
    return invoke<TransferResult>('transfer', { paths, targetDir, mode });
  }

  async updateMeta(paths: string[], patch: MetaPatch) {
    return (await invoke<Entry[]>('update_meta', { paths, patch })).map(withThumb);
  }

  mkdir(parent: string, name: string) {
    return invoke<string>('mkdir', { parent, name });
  }

  folderMeta(path: string) {
    return invoke<{ tags: string[]; color: string | null }>('folder_meta', { path });
  }

  async thumbnail(entry: Entry, size: number) {
    if (entry.thumb) return entry.thumb;
    try {
      return convertFileSrc(await invoke<string>('thumbnail', { path: entry.path, size }));
    } catch {
      return null; // unsupported format or broken file → icon
    }
  }

  fileUrl(entry: Entry) {
    // Inside an archive the preview uses a large thumbnail (unpacked by the core).
    return WEB_IMAGE.has(entry.ext) && !inArchive(entry.path) ? convertFileSrc(entry.path) : null;
  }

  async localUrl(path: string) {
    return convertFileSrc(inArchive(path) ? await invoke<string>('archive_extract', { path }) : path);
  }

  assetUrl(path: string) {
    return convertFileSrc(path);
  }

  // Files are read through the asset protocol (scope: all files), like thumbnails.
  async fileData(path: string) {
    const r = await fetch(await this.localUrl(path));
    if (!r.ok) throw new Error(t('demo.readFailed', { path, status: r.status }));
    return r.arrayBuffer();
  }

  async readText(path: string) {
    return new TextDecoder().decode(await this.fileData(path));
  }

  mediaInfo(paths: string[]) {
    return invoke<MediaInfo[]>('media_info', { paths });
  }

  async rename(path: string, newName: string) {
    return withThumb(await invoke<Entry>('rename', { path, newName }));
  }

  compress(paths: string[]) {
    return invoke<string>('compress', { paths });
  }

  smartFolders() {
    return invoke<SmartFolder[] | null>('smart_folders');
  }

  saveSmartFolders(list: SmartFolder[]) {
    return invoke<void>('save_smart_folders', { list });
  }

  alive(view: string) {
    return invoke<void>('alive', { view });
  }

  stuckView() {
    return invoke<string | null>('stuck_view');
  }

  findDuplicates(paths: string[]) {
    return invoke<string[][]>('find_duplicates', { paths });
  }

  archiveConflicts(dir: string, names: string[]) {
    return invoke<string[]>('archive_conflicts', { dir, names });
  }

  trash(paths: string[]) {
    return invoke<TransferResult>('trash', { paths });
  }

  openDefault(path: string) {
    return invoke<void>('open_default', { path });
  }

  reveal(path: string) {
    return invoke<void>('reveal', { path });
  }

  watch(path: string, recursive: boolean) {
    return invoke<void>('watch', { path, recursive });
  }

  onChange(cb: (paths: string[]) => void) {
    return listen<{ paths: string[] }>('fs-change', (ev) => cb(ev.payload.paths));
  }

  libraries() {
    return invoke<LibraryInfo[]>('libraries');
  }

  addLibrary(root: string, name?: string) {
    return invoke<LibraryInfo>('add_library', { root, name: name ?? null });
  }

  removeLibrary(root: string) {
    return invoke<void>('remove_library', { root });
  }

  projects() {
    return invoke<ProjectInfo[]>('projects');
  }

  async createProject(name: string) {
    const p = await invoke<{ id: string }>('create_project', { name });
    return (await this.projects()).find((x) => x.id === p.id)!;
  }

  updateProject(id: string, patch: { name?: string; color?: string | null }) {
    return invoke<void>('update_project', { id, name: patch.name ?? null, color: 'color' in patch ? patch.color : undefined });
  }

  deleteProject(id: string) {
    return invoke<void>('delete_project', { id });
  }

  addToProject(id: string, paths: string[]) {
    return invoke<number>('project_add', { id, paths });
  }

  removeFromProject(id: string, paths: string[]) {
    return invoke<number>('project_remove', { id, paths });
  }

  projectEntries(id: string) {
    return invoke<Entry[]>('project_entries', { id });
  }

  webOpen(url: string, bounds: WebBounds) {
    return invoke<void>('web_open', { url, bounds });
  }

  webPlace(bounds: WebBounds, visible: boolean) {
    return invoke<void>('web_place', { bounds, visible });
  }

  webClose() {
    return invoke<void>('web_close');
  }

  webGo(how: 'back' | 'forward' | 'reload') {
    return invoke<void>('web_go', { how });
  }

  webSelection() {
    return invoke<{ text: string; url: string; title: string }>('web_selection');
  }

  webSavePage(dir: string) {
    return invoke<string>('web_save_page', { dir });
  }

  webTarget(dir: string | null) {
    return invoke<void>('web_target', { dir });
  }

  webServe(root: string, scripts: boolean) {
    return invoke<string>('web_serve', { root, scripts });
  }

  async onWeb(cb: (e: WebEvent) => void) {
    const offs = await Promise.all([
      listen<{ url: string; loading: boolean }>('web-nav', (ev) => cb({ kind: 'nav', ...ev.payload })),
      listen<string>('web-title', (ev) => cb({ kind: 'title', title: ev.payload })),
      listen<{ url: string; path: string | null; success: boolean }>('web-download', (ev) => cb({ kind: 'download', ...ev.payload }))
    ]);
    return () => offs.forEach((off) => off());
  }

  onIndexReport(cb: (r: IndexReport) => void) {
    return listen<IndexReport>('index-report', (ev) => cb(ev.payload));
  }

  listMaps(root: string) {
    return invoke<MapInfo[]>('list_maps', { root });
  }

  loadMap(root: string, id: string) {
    return invoke<ProjectMap>('load_map', { root, id });
  }

  saveMap(root: string, map: ProjectMap) {
    return invoke<void>('save_map', { root, map });
  }

  deleteMap(root: string, id: string) {
    return invoke<void>('delete_map', { root, id });
  }

  linkFiles(paths: string[]) {
    return invoke<{ path: string; id: string }[]>('link_files', { paths });
  }

  locateFiles(ids: string[]) {
    return invoke<Record<string, string | null>>('locate_files', { ids });
  }

  wikiBags() {
    return invoke<WikiBag[]>('tw_bags');
  }

  putWikiBag(bag: Omit<WikiBag, 'tiddlers'>) {
    return invoke<void>('tw_put_bag', { bag });
  }

  deleteWikiBag(name: string) {
    return invoke<void>('tw_delete_bag', { name });
  }

  wikiRecipes() {
    return invoke<WikiRecipe[]>('tw_recipes');
  }

  putWikiRecipe(recipe: WikiRecipe) {
    return invoke<WikiRecipe>('tw_put_recipe', { recipe });
  }

  deleteWikiRecipe(name: string) {
    return invoke<void>('tw_delete_recipe', { name });
  }

  syncWiki(name: string) {
    return invoke<WikiSyncReport>('tw_sync', { name });
  }

  wikiLayers(recipe: string) {
    return invoke<WikiLayer[]>('tw_layers', { recipe });
  }

  wikiOverlays() {
    return invoke<WikiOverlay[]>('tw_overlays');
  }

  resolveOverlay(title: string, bag: string, how: OverlayResolution) {
    return invoke<void>('tw_resolve_overlay', { title, bag, how });
  }

  wikiPlugins() {
    return invoke<[string, string][]>('tw_plugins');
  }
}
