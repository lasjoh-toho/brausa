export function formatSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = -1;
  do {
    v /= 1000;
    i++;
  } while (v >= 1000 && i < units.length - 1);
  return `${v.toFixed(v < 10 ? 1 : 0).replace('.', ',')} ${units[i]}`;
}

export function formatDate(ms: number, locale = 'de-DE'): string {
  return new Date(ms).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' });
}

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'bmp', 'heic', 'tif', 'tiff']);
const VIDEO_EXT = new Set(['mp4', 'mov', 'webm', 'mkv', 'avi']);
const DOC_EXT = new Set(['pdf', 'doc', 'docx', 'odt', 'txt', 'md', 'rtf', 'pages']);

export type FileFamily = 'image' | 'video' | 'doc' | 'other' | 'dir';

export function family(ext: string, kind: 'dir' | 'file' = 'file'): FileFamily {
  if (kind === 'dir') return 'dir';
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  if (DOC_EXT.has(ext)) return 'doc';
  return 'other';
}
