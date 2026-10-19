/**
 * Archives open like read-only folders: `/a/b.zip!/docs/x.pdf` is a file
 * inside `b.zip` (the Rust core lists and unpacks them).
 */
const ARCHIVE = /\.(zip|tar|tgz|tar\.gz)$/i;

/** Can this file be opened like a folder? */
export function isArchive(path: string): boolean {
  return ARCHIVE.test(path);
}

/** Is this a path inside an archive (or an archive's root)? */
export function inArchive(path: string): boolean {
  return /\.(zip|tar|tgz|tar\.gz)!([\\/]|$)/i.test(path);
}

/** The folder view of an archive file. */
export function archiveRoot(path: string): string {
  return path + '!';
}

/** The archive file a path inside it belongs to (`/a/b.zip!/x` → `/a/b.zip`); other paths unchanged. */
export function archiveName(path: string): string {
  const m = /^(.*?\.(zip|tar|tgz|tar\.gz))!([\\/]|$)/i.exec(path);
  return m ? m[1] : path;
}
