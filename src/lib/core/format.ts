import { loc, t } from '../i18n/index.svelte';

export function formatSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = -1;
  do {
    v /= 1000;
    i++;
  } while (v >= 1000 && i < units.length - 1);
  const digits = v < 10 ? 1 : 0;
  return `${v.toLocaleString(loc(), { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false })} ${units[i]}`;
}

export function formatDate(ms: number, locale = loc()): string {
  return new Date(ms).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' });
}

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'bmp', 'heic', 'tif', 'tiff']);
const VIDEO_EXT = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'ogv']);
const AUDIO_EXT = new Set(['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'oga', 'opus', 'aif', 'aiff']);
const DOC_EXT = new Set(['pdf', 'doc', 'docx', 'odt', 'txt', 'md', 'rtf', 'pages']);
const WEB_EXT = new Set(['html', 'htm', 'xhtml']);
const OFFICE_EXT = new Set(['doc', 'docx', 'odt', 'rtf', 'pages', 'xls', 'xlsx', 'ods', 'numbers', 'ppt', 'pptx', 'odp', 'key', 'epub']);
// Plain text and source code: shown as text in the preview.
const TEXT_EXT = new Set(
  (
    'txt text md markdown log csv tsv json jsonl xml yml yaml toml ini cfg conf env properties ' +
    'php js mjs cjs ts tsx jsx css scss sass less svelte vue astro py rb go rs java kt kts c h cc cpp hpp cs swift m ' +
    'sh bash zsh fish ps1 bat cmd sql tex bib r lua pl dart gradle tid diff patch srt vtt'
  ).split(' ')
);

export type FileFamily = 'image' | 'video' | 'audio' | 'doc' | 'other' | 'dir';

export function family(ext: string, kind: 'dir' | 'file' = 'file'): FileFamily {
  if (kind === 'dir') return 'dir';
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (DOC_EXT.has(ext)) return 'doc';
  return 'other';
}

/** What a file is, for the type filter (`is:video`) and for choosing a viewer in the preview. */
export type Category = 'image' | 'video' | 'audio' | 'pdf' | 'web' | 'text' | 'office';

export const CATEGORIES: { key: Category; label: string }[] = (['image', 'video', 'audio', 'pdf', 'text', 'web', 'office'] as Category[]).map((key) => ({
  key,
  get label() {
    return t(`core.format.${key}`);
  }
}));

export function category(ext: string): Category | null {
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (ext === 'pdf') return 'pdf';
  if (WEB_EXT.has(ext)) return 'web';
  if (TEXT_EXT.has(ext)) return 'text';
  if (OFFICE_EXT.has(ext)) return 'office';
  return null;
}
