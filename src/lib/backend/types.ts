import type { SmartFolder } from '../core/smart';
import type { Entry, Geo, MetaPatch, TransferMode } from '../core/types';
import type { NoteCard, ProjectMap } from '../core/map';

export interface OsDrag {
  type: 'enter' | 'over' | 'drop' | 'leave';
  paths: string[];
  x: number;
  y: number;
}

/** Stream reads at most this many files. */
export const WALK_LIMIT = 20000;

export interface WalkOptions {
  maxDepth?: number;
  includeHidden?: boolean;
  /** Stop after this many files (protects against walking $HOME by accident). */
  limit?: number;
  /** Only files with these extensions (lower case). */
  exts?: string[];
}

export interface MediaInfo {
  path: string;
  geo: Geo | null;
  taken: number | null;
}

/** A project folder with its own index, or summary numbers for the overview. */
export interface LibraryInfo {
  id: string;
  name: string;
  root: string | null;
  /** Files carrying metadata. */
  files: number;
  /** Files whose metadata waits for the file to come back. */
  orphans: number;
}

export interface WebBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type WebEvent =
  | { kind: 'nav'; url: string; loading: boolean }
  | { kind: 'title'; title: string }
  | { kind: 'download'; url: string; path: string | null; success: boolean }
  /** A page saved itself (a TiddlyWiki); `wiki`: the folder wiki it showed. */
  | { kind: 'saved'; path: string; wiki: string | null; error: string | null };

/** A project: a named collection of files and folders from anywhere (not a folder). */
export interface ProjectInfo {
  id: string;
  name: string;
  color: string | null;
  /** Index ids of single files (they follow the file when it moves). */
  files: string[];
  /** Folders whose whole content belongs to the project. */
  folders: string[];
  /** Where the project's maps live (pass to listMaps & co.). */
  root: string;
}

export interface MapInfo {
  id: string;
  title: string;
  updated: string | null;
}

/** TiddlyWiki bag (MultiWikiServer model): a named set of tiddlers. */
export interface WikiBag {
  name: string;
  description: string;
  readonly: boolean;
  /** Not offered when a new wiki is put together. */
  hidden?: boolean;
  tiddlers: number;
}

/** A tiddler found by the search across all bags. */
export interface WikiHit {
  bag: string;
  title: string;
  snippet: string;
}

/** A wiki = ordered list of bags (later wins) synced with a wiki folder or single-file wiki. */
export interface WikiRecipe {
  name: string;
  description: string;
  /** `@map:<root>|<mapId>` uses a project map as bag. */
  bags: string[];
  target: { kind: 'folder' | 'file'; path: string };
  lastSync?: string | null;
  /** Put brausa's bundled plugins (Markdown, tw5-graph, Pinboard, Kanban) into the wiki. */
  plugins: boolean;
  /** Include the shared bag „lokal“ (file links to this computer, notes tagged lokal/privat) right below the wiki's own bag. */
  local: boolean;
  /** Overlays kept on purpose as this wiki's own variant. */
  kept?: string[];
  /** The same wiki as a single file on the web. */
  web?: { url: string; user: string } | null;
  /** The bags uploaded to the web; unset: all but the maps (cards, snippets) and „lokal“. */
  webBags?: string[] | null;
}

/** A tiddler that is new or different in the web version. */
export interface WebChange {
  title: string;
  webModified: string | null;
  localModified: string | null;
  webText: string;
  localText: string;
}

/** What the web version of a wiki brings. */
export interface WebPreview {
  new: WebChange[];
  changed: WebChange[];
  plugins: { title: string; version: string; have: boolean }[];
  hasPassword: boolean;
}

export type TiddlerFields = Record<string, string>;

/** One layer of a wiki: `@plugins` (built-in), real bags, `lokal`, `@map:…`, the wiki's own bag on top. */
export interface WikiLayer {
  bag: string;
  titles: string[];
}

/** A shared tiddler that wikis cover with their own version (MultiWikiServer-style overlay). */
export interface WikiOverlay {
  title: string;
  bag: string;
  base: TiddlerFields;
  variants: { recipe: string; fields: TiddlerFields; identical: boolean; kept: boolean }[];
}

export type OverlayResolution =
  | { action: 'promote'; recipe: string; all: boolean }
  | { action: 'merge'; text: string }
  | { action: 'discard'; recipe: string }
  | { action: 'keep'; recipe: string; keep: boolean };

export interface WikiSyncReport {
  pulled: string[];
  conflicts: string[];
  deleted: string[];
  pushed: number;
  maps: [string, string][];
  warnings: string[];
}

/** What a background reconcile changed. */
export interface IndexReport {
  relinked: [string, string][];
  orphaned: string[];
  restored: number;
  updated: number;
  purged: number;
  imported: number;
}

export interface TransferResult {
  /** old path → new path */
  moved: Record<string, string>;
  errors: { path: string; message: string }[];
}

/**
 * Everything the UI needs from the platform. Implemented by the Rust core via
 * Tauri, and by an in-memory demo for development in a plain browser.
 */
export interface Backend {
  readonly name: 'tauri' | 'demo';
  homeDir(): Promise<string>;
  /** Places shown in the sidebar (home, desktop, pictures, …). */
  places(): Promise<{ name: string; path: string }[]>;
  /** Mounted drives other than the system disk (USB sticks, memory cards, network shares). */
  volumes(): Promise<{ name: string; path: string }[]>;
  /** Files and folders whose name contains `text`, below each root (`more`: stopped early). */
  findNames(roots: string[], text: string, opts?: { includeHidden?: boolean; limit?: number }): Promise<{ entries: Entry[]; more: boolean }>;
  /** Documents below `roots` whose text (PDFs, Office files, text) holds all `words`; each entry carries its `hit`. */
  findContent(roots: string[], words: string[], opts?: { includeHidden?: boolean; limit?: number }): Promise<{ entries: Entry[]; more: boolean }>;
  listDir(path: string, opts?: { includeHidden?: boolean }): Promise<Entry[]>;
  /** Flattened recursive listing of files below root; `relDir` is set on each entry. */
  walk(root: string, opts?: WalkOptions): Promise<Entry[]>;
  transfer(paths: string[], targetDir: string, mode: TransferMode): Promise<TransferResult>;
  /** Apply a tag/color patch to many files at once (sidecar storage). */
  updateMeta(paths: string[], patch: MetaPatch): Promise<Entry[]>;
  mkdir(parent: string, name: string): Promise<string>;
  /** Folder's own meta (tags, color) — used by the right-half "assign attributes" drop zone. */
  folderMeta(path: string): Promise<{ tags: string[]; color: string | null }>;

  /** URL of a downscaled preview (longest edge ≈ size px), or null if the format has none. */
  thumbnail(entry: Entry, size: number): Promise<string | null>;
  /** URL for showing the original file in the webview (preview), or null. */
  fileUrl(entry: Entry): string | null;
  /** URL for a file to show in the webview; files inside archives are unpacked first. Null in the demo. */
  localUrl(path: string): Promise<string | null>;
  /** URL for any local file (images inside HTML documents), or null. */
  assetUrl(path: string): string | null;
  /** Raw bytes (PDF reader) and text (HTML/Markdown reader) of a file. */
  fileData(path: string): Promise<ArrayBuffer>;
  readText(path: string): Promise<string>;
  /** EXIF GPS + capture date, batched. */
  mediaInfo(paths: string[]): Promise<MediaInfo[]>;
  rename(path: string, newName: string): Promise<Entry>;
  /** Packs files and folders into a new ZIP next to the first one; returns its path. */
  compress(paths: string[]): Promise<string>;
  /** Saved smart folders; null before the first save. */
  smartFolders(): Promise<SmartFolder[] | null>;
  saveSmartFolders(list: SmartFolder[]): Promise<void>;
  /** Entries for paths (files dropped in from another app). */
  entries(paths: string[]): Promise<Entry[]>;
  /** Files dragged from another app over brausa (positions in CSS pixels). */
  onOsDrag(handler: (e: OsDrag) => void): Promise<void>;
  /** Hand files to the system's drag & drop (out of the window, to Finder/Explorer or another app). */
  dragOut(paths: string[]): Promise<void>;
  /** Heartbeat for the core's watchdog: the interface responds and shows `view`. */
  alive(view: string): Promise<void>;
  /** The view that hung last time (then start in a plain view), reported once. */
  stuckView(): Promise<string | null>;
  /** Groups of files with identical content among `paths`, largest waste first. */
  findDuplicates(paths: string[]): Promise<string[][]>;
  /** Names in an archive folder that dropping `names` there would replace. */
  archiveConflicts(dir: string, names: string[]): Promise<string[]>;
  /** Move to the system trash (inside an archive: remove from it). `moved` lists the removed paths. */
  trash(paths: string[]): Promise<TransferResult>;
  openDefault(path: string): Promise<void>;
  reveal(path: string): Promise<void>;
  /** Watch one folder; `onChange` fires with changed paths. Returns an unsubscribe function. */
  watch(path: string, recursive: boolean): Promise<void>;
  onChange(cb: (paths: string[]) => void): Promise<() => void>;

  /** Projects (each with its own index under `<root>/.brausa/`). */
  libraries(): Promise<LibraryInfo[]>;
  addLibrary(root: string, name?: string): Promise<LibraryInfo>;
  removeLibrary(root: string): Promise<void>;
  onIndexReport(cb: (r: IndexReport) => void): Promise<() => void>;

  /** Projects: free collections; adding a folder adds everything in it. */
  projects(): Promise<ProjectInfo[]>;
  createProject(name: string): Promise<ProjectInfo>;
  updateProject(id: string, patch: { name?: string; color?: string | null }): Promise<void>;
  /** Deletes the project and its maps; the files themselves stay. */
  deleteProject(id: string): Promise<void>;
  /** Adds files and folders; returns how many were new. */
  addToProject(id: string, paths: string[]): Promise<number>;
  /** Takes files and folders out of the project (they stay on disk); returns how many were members. */
  removeFromProject(id: string, paths: string[]): Promise<number>;
  /** All files of a project: its single files and the content of its folders. */
  projectEntries(id: string): Promise<Entry[]>;

  /** Project maps, stored in `<root>/.brausa/maps/`. `root` must be a project. */
  listMaps(root: string): Promise<MapInfo[]>;
  loadMap(root: string, id: string): Promise<ProjectMap>;
  /** The project's notes & snippets thread. */
  loadNotes(root: string): Promise<NoteCard[]>;
  saveNotes(root: string, notes: NoteCard[]): Promise<void>;
  saveMap(root: string, map: ProjectMap): Promise<void>;
  deleteMap(root: string, id: string): Promise<void>;
  /** Stable index ids for files placed on a map (they follow the file when it moves). */
  linkFiles(paths: string[]): Promise<{ path: string; id: string }[]>;
  /** Current path per id, null when the file is missing. */
  locateFiles(ids: string[]): Promise<Record<string, string | null>>;

  /**
   * Web panel: a separate webview over the area `b` (CSS px of the window),
   * with its own cookies and no access to brausa. Desktop app only.
   */
  webOpen(url: string, b: WebBounds, adblock: boolean): Promise<void>;
  /** Save the pictures of the shown page into `dir` (each only once); returns how many. */
  webCollectImages(dir: string, min: number, exts: string[]): Promise<number>;
  /** Scroll position of the page and whether text is marked in it. */
  webPeek(): Promise<{ y: number; sel: boolean; drag: WebDrag | null }>;
  /** Downloads a picture dragged out of the web panel into `dir`; returns its path. */
  webFetchImage(url: string, dir: string): Promise<string>;
  /** Find in the page of the web panel (dir 1/-1 steps, 0 starts over); n = -1: the page cannot be searched. */
  webFind(query: string, dir: number): Promise<{ n: number; i: number }>;
  /** The drag in the web panel was handled. */
  webDragDone(): Promise<void>;
  webPlace(b: WebBounds, visible: boolean): Promise<void>;
  webClose(): Promise<void>;
  webGo(how: 'back' | 'forward' | 'reload'): Promise<void>;
  /** Marked text of the page, with its address and title. */
  webSelection(): Promise<{ text: string; url: string; title: string }>;
  /** Saves the page as shown into `dir`; returns the file. */
  /** Saves the shown page; a TiddlyWiki as a complete wiki file (`wiki`). */
  webSavePage(dir: string): Promise<{ path: string; wiki: boolean }>;
  /** The system's folder dialog; null when cancelled. */
  pickFolder(start?: string): Promise<string | null>;
  /** Is the file a single-file TiddlyWiki? */
  isTiddlyWiki(path: string): Promise<boolean>;
  /** The wiki as one HTML file for the web panel (a folder wiki inside the bundled TiddlyWiki). */
  wikiView(name: string): Promise<string>;
  /** Folder for downloads (null: the system's Downloads folder). */
  webTarget(dir: string | null): Promise<void>;
  /** Serves a local folder as a website on this computer only; returns its address. */
  webServe(root: string, scripts: boolean): Promise<string>;
  onWeb(cb: (e: WebEvent) => void): Promise<() => void>;

  /** TiddlyWiki: bags, recipes and two-way sync (see docs/PLAN-PROJEKTE.md §3). */
  wikiBags(): Promise<WikiBag[]>;
  putWikiBag(bag: Omit<WikiBag, 'tiddlers'>): Promise<void>;
  deleteWikiBag(name: string): Promise<void>;
  wikiRecipes(): Promise<WikiRecipe[]>;
  putWikiRecipe(r: WikiRecipe): Promise<WikiRecipe>;
  deleteWikiRecipe(name: string): Promise<void>;
  syncWiki(name: string): Promise<WikiSyncReport>;
  /** Load the web version into a temporary bag and list what differs. */
  wikiWebFetch(name: string): Promise<WebPreview>;
  /** Take chosen tiddlers (into the wiki's own bag) and plugins (into bag „plugins“); the temporary bag goes. */
  wikiWebApply(name: string, titles: string[], plugins: string[]): Promise<number>;
  wikiWebDiscard(name: string): Promise<void>;
  /** Upload the wiki as a new version of its web file. */
  wikiWebUpload(name: string): Promise<void>;
  /** Store (or with null forget) the upload password. */
  wikiWebPassword(name: string, password: string | null): Promise<void>;
  wikiWebHasPassword(name: string): Promise<boolean>;
  wikiOverlays(): Promise<WikiOverlay[]>;
  /** The layers of a wiki in load order (bottom first, the last one wins): bag and its tiddler titles. */
  wikiLayers(recipe: string): Promise<WikiLayer[]>;
  /** Tiddlers in all bags whose title or text contains every word. */
  wikiSearch(query: string): Promise<WikiHit[]>;
  /** A snippet, note or card dropped onto a wiki: a tiddler in its own bag; returns the title. */
  wikiAddTiddler(name: string, fields: Record<string, string>): Promise<string>;
  resolveOverlay(title: string, bag: string, how: OverlayResolution): Promise<void>;
  /** [name, version] of the plugins brausa bundles. */
  wikiPlugins(): Promise<[string, string][]>;
}

/** Marked text, a picture or a link being dragged out of the web panel (see webdrag.js). */
export interface WebDrag {
  kind: 'text' | 'image' | 'link';
  id: number;
  /** Pointer in the page (CSS pixels of the panel). */
  x: number;
  y: number;
  down: boolean;
  cancel?: boolean;
  url: string;
  title: string;
  text?: string;
  html?: string;
  src?: string;
  alt?: string;
  href?: string;
}
