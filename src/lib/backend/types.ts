import type { Entry, Geo, MetaPatch, TransferMode } from '../core/types';
import type { ProjectMap } from '../core/map';

export interface WalkOptions {
  maxDepth?: number;
  includeHidden?: boolean;
  /** Stop after this many files (protects against walking $HOME by accident). */
  limit?: number;
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
  tiddlers: number;
}

/** A wiki = ordered list of bags (later wins) synced with a wiki folder or single-file wiki. */
export interface WikiRecipe {
  name: string;
  description: string;
  /** `@map:<root>|<mapId>` uses a project map as bag. */
  bags: string[];
  target: { kind: 'folder' | 'file'; path: string };
  lastSync?: string | null;
}

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
  /** URL for any local file (images inside HTML documents), or null. */
  assetUrl(path: string): string | null;
  /** Raw bytes (PDF reader) and text (HTML/Markdown reader) of a file. */
  fileData(path: string): Promise<ArrayBuffer>;
  readText(path: string): Promise<string>;
  /** EXIF GPS + capture date, batched. */
  mediaInfo(paths: string[]): Promise<MediaInfo[]>;
  rename(path: string, newName: string): Promise<Entry>;
  /** Move to the system trash. `moved` lists the trashed paths. */
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

  /** Project maps, stored in `<root>/.brausa/maps/`. `root` must be a project. */
  listMaps(root: string): Promise<MapInfo[]>;
  loadMap(root: string, id: string): Promise<ProjectMap>;
  saveMap(root: string, map: ProjectMap): Promise<void>;
  deleteMap(root: string, id: string): Promise<void>;
  /** Stable index ids for files placed on a map (they follow the file when it moves). */
  linkFiles(paths: string[]): Promise<{ path: string; id: string }[]>;
  /** Current path per id, null when the file is missing. */
  locateFiles(ids: string[]): Promise<Record<string, string | null>>;

  /** TiddlyWiki: bags, recipes and two-way sync (see docs/PLAN-PROJEKTE.md §3). */
  wikiBags(): Promise<WikiBag[]>;
  putWikiBag(bag: Omit<WikiBag, 'tiddlers'>): Promise<void>;
  deleteWikiBag(name: string): Promise<void>;
  wikiRecipes(): Promise<WikiRecipe[]>;
  putWikiRecipe(r: WikiRecipe): Promise<WikiRecipe>;
  deleteWikiRecipe(name: string): Promise<void>;
  syncWiki(name: string): Promise<WikiSyncReport>;
}
