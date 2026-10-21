export type EntryKind = 'dir' | 'file';

export interface Geo {
  lat: number;
  lon: number;
}

/** A file or directory as seen by the UI. Tags are the union of sidecar and filename tags. */
export interface Entry {
  path: string;
  name: string;
  ext: string;
  kind: EntryKind;
  size: number;
  /** Milliseconds since epoch. */
  mtime: number;
  ctime: number;
  tags: string[];
  color?: string | null;
  geo?: Geo | null;
  /** Capture time from EXIF (ms), loaded lazily for photos. */
  taken?: number | null;
  /** In recursive stream mode: directory path relative to the stream root ('' = root). */
  relDir?: string;
  /** Found by a search in documents: text around the words, and their page (PDFs). */
  hit?: { snippet: string; page?: number | null };
  /** Optional URL usable as <img src>; the backend decides how it is served. */
  thumb?: string | null;
}

/** On-disk sidecar format, stored at `<dir>/.brausa/<name>.meta.json`. */
export interface Sidecar {
  v: 1;
  tags: string[];
  color?: string | null;
  note?: string;
  geo?: Geo | null;
  source?: { url: string; title?: string; clippedAt?: string } | null;
  updated?: string;
}

export interface MetaPatch {
  addTags?: string[];
  removeTags?: string[];
  /** undefined = unchanged, null = clear */
  color?: string | null;
}

export type TransferMode = 'move' | 'copy';
