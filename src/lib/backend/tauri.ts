import type { SmartFolder } from '../core/smart';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Entry, MetaPatch, TransferMode } from '../core/types';
import { inArchive } from '../core/archive';
import { t } from '../i18n/index.svelte';
import type { NoteCard, ProjectMap } from '../core/map';
import { WALK_LIMIT, type OsDrag, type WebDrag } from './types';
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
  WebPreview,
  WikiHit,
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

  volumes() {
    return invoke<{ name: string; path: string }[]>('volumes');
  }

  async findNames(roots: string[], text: string, opts: { includeHidden?: boolean; limit?: number } = {}) {
    const r = await invoke<{ entries: Entry[]; more: boolean }>('find', { roots, text, includeHidden: opts.includeHidden ?? false, limit: opts.limit ?? 2000 });
    return { entries: r.entries.map(withThumb), more: r.more };
  }

  async findContent(roots: string[], words: string[], opts: { includeHidden?: boolean; limit?: number } = {}) {
    const r = await invoke<{ entries: Entry[]; hits: Record<string, { snippet: string; page: number | null }>; more: boolean }>('find_content', {
      roots,
      words,
      includeHidden: opts.includeHidden ?? false,
      limit: opts.limit ?? 500
    });
    return { entries: r.entries.map((e) => ({ ...withThumb(e), hit: r.hits[e.path] })), more: r.more };
  }

  async listDir(path: string, opts: { includeHidden?: boolean } = {}) {
    return (await invoke<Entry[]>('list_dir', { path, includeHidden: opts.includeHidden ?? false })).map(withThumb);
  }

  async walk(root: string, opts: WalkOptions = {}) {
    const r = await invoke<Entry[]>('walk', {
      root,
      maxDepth: opts.maxDepth ?? 32,
      includeHidden: opts.includeHidden ?? false,
      limit: opts.limit ?? WALK_LIMIT,
      exts: opts.exts ?? null
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

  entries(paths: string[]) {
    return invoke<Entry[]>('entries', { paths }).then((r) => r.map(withThumb));
  }

  async onOsDrag(handler: (e: OsDrag) => void) {
    const { getCurrentWebview } = await import('@tauri-apps/api/webview');
    await getCurrentWebview().onDragDropEvent((ev) => {
      const p = ev.payload;
      const r = window.devicePixelRatio || 1;
      const pos = 'position' in p ? p.position : null;
      handler({ type: p.type, paths: 'paths' in p ? p.paths : [], x: pos ? pos.x / r : 0, y: pos ? pos.y / r : 0 });
    });
  }

  private dragIcon: string | null = null;
  async dragOut(paths: string[]) {
    const { startDrag } = await import('@crabnebula/tauri-plugin-drag');
    this.dragIcon ??= await invoke<string>('drag_icon');
    await startDrag({ item: paths, icon: this.dragIcon, mode: 'copy' }).catch(() => {});
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

  webOpen(url: string, bounds: WebBounds, adblock: boolean) {
    return invoke<void>('web_open', { url, bounds, adblock });
  }

  webCollectImages(dir: string, min: number, exts: string[]) {
    return invoke<number>('web_collect_images', { dir, min, exts });
  }

  webPeek() {
    return invoke<{ y: number; sel: boolean; drag: WebDrag | null }>('web_peek');
  }

  webFetchImage(url: string, dir: string) {
    return invoke<string>('web_fetch_image', { url, dir });
  }

  webFind(query: string, dir: number) {
    return invoke<{ n: number; i: number }>('web_find', { query, dir });
  }

  webDragDone() {
    return invoke<void>('web_drag_done');
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
    return invoke<{ path: string; wiki: boolean }>('web_save_page', { dir });
  }

  pickFolder(start?: string) {
    return invoke<string | null>('pick_folder', { start: start ?? null });
  }

  isTiddlyWiki(path: string) {
    return invoke<boolean>('is_tiddlywiki', { path });
  }

  wikiView(name: string) {
    return invoke<string>('tw_view', { name });
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
      listen<{ url: string; path: string | null; success: boolean }>('web-download', (ev) => cb({ kind: 'download', ...ev.payload })),
      listen<{ path: string; wiki: string | null; error: string | null }>('wiki-saved', (ev) => cb({ kind: 'saved', ...ev.payload }))
    ]);
    return () => offs.forEach((off) => off());
  }

  onIndexReport(cb: (r: IndexReport) => void) {
    return listen<IndexReport>('index-report', (ev) => cb(ev.payload));
  }

  listMaps(root: string) {
    return invoke<MapInfo[]>('list_maps', { root });
  }

  loadNotes(root: string) {
    return invoke<NoteCard[]>('load_notes', { root });
  }

  saveNotes(root: string, notes: NoteCard[]) {
    return invoke<void>('save_notes', { root, notes });
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

  wikiWebFetch(name: string) {
    return invoke<WebPreview>('tw_web_fetch', { name });
  }

  wikiWebApply(name: string, titles: string[], plugins: string[]) {
    return invoke<number>('tw_web_apply', { name, titles, plugins });
  }

  wikiWebTexts(name: string, title: string) {
    return invoke<{ webText: string; localText: string }>('tw_web_texts', { name, title });
  }

  wikiWebDiscard(name: string) {
    return invoke<void>('tw_web_discard', { name });
  }

  wikiWebUpload(name: string) {
    return invoke<void>('tw_web_upload', { name });
  }

  wikiWebPassword(name: string, password: string | null) {
    return invoke<void>('tw_web_password', { name, password });
  }

  wikiWebHasPassword(name: string) {
    return invoke<boolean>('tw_web_has_password', { name });
  }

  wikiAddTiddler(name: string, fields: Record<string, string>) {
    return invoke<string>('tw_add_tiddler', { name, fields });
  }

  wikiSearch(query: string) {
    return invoke<WikiHit[]>('tw_search', { query });
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
