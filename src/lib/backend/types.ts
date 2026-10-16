import type { Entry, MetaPatch, TransferMode } from '../core/types';

export interface WalkOptions {
  maxDepth?: number;
  includeHidden?: boolean;
  /** Stop after this many files (protects against walking $HOME by accident). */
  limit?: number;
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
}
