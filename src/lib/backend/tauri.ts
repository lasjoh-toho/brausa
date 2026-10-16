import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import type { Entry, MetaPatch, TransferMode } from '../core/types';
import { family } from '../core/format';
import type { Backend, TransferResult, WalkOptions } from './types';

/** Rust returns entries without thumbnails; image files are served via the asset protocol. */
function withThumb(e: Entry): Entry {
  return family(e.ext, e.kind) === 'image' ? { ...e, thumb: convertFileSrc(e.path) } : e;
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
}
