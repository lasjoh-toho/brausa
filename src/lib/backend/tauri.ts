import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Entry, MetaPatch, TransferMode } from '../core/types';
import type { Backend, IndexReport, LibraryInfo, MediaInfo, TransferResult, WalkOptions } from './types';

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
    return WEB_IMAGE.has(entry.ext) ? convertFileSrc(entry.path) : null;
  }

  mediaInfo(paths: string[]) {
    return invoke<MediaInfo[]>('media_info', { paths });
  }

  async rename(path: string, newName: string) {
    return withThumb(await invoke<Entry>('rename', { path, newName }));
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

  onIndexReport(cb: (r: IndexReport) => void) {
    return listen<IndexReport>('index-report', (ev) => cb(ev.payload));
  }
}
