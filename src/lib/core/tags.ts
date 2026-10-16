/**
 * Portable tag model.
 *
 * - Tags are hierarchical, separated by "/": `Work/Design/UI`.
 * - Only the leaf tag is stored; ancestors are derived for indexing/filtering.
 * - Tags can live in a sidecar file or in the filename: `Photo[beach sunset].jpg`.
 */

export const TAG_SEPARATOR = '/';

/** Normalize user input: strip "#", trim slashes/whitespace, collapse repeated separators. */
export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, '')
    .replace(/\s+/g, '-')
    .split(TAG_SEPARATOR)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(TAG_SEPARATOR);
}

/** `Work/Design/UI` → `['Work', 'Work/Design', 'Work/Design/UI']` */
export function expandTag(tag: string): string[] {
  const parts = normalizeTag(tag).split(TAG_SEPARATOR).filter(Boolean);
  return parts.map((_, i) => parts.slice(0, i + 1).join(TAG_SEPARATOR));
}

/** All tags an entry is indexed under, including ancestors (deduplicated, case-insensitive). */
export function indexTags(tags: string[]): string[] {
  const seen = new Map<string, string>();
  for (const t of tags) for (const e of expandTag(t)) if (!seen.has(e.toLowerCase())) seen.set(e.toLowerCase(), e);
  return [...seen.values()];
}

/** Does an entry with `tags` match the filter `query` (with hierarchy, case-insensitive)? */
export function hasTag(tags: string[], query: string): boolean {
  const q = normalizeTag(query).toLowerCase();
  if (!q) return false;
  return indexTags(tags).some((t) => t.toLowerCase() === q);
}

export function leaf(tag: string): string {
  const parts = tag.split(TAG_SEPARATOR);
  return parts[parts.length - 1];
}

export function uniqueTags(tags: string[]): string[] {
  const seen = new Map<string, string>();
  for (const t of tags.map(normalizeTag).filter(Boolean)) if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  return [...seen.values()];
}

export function applyTagPatch(current: string[], add: string[] = [], remove: string[] = []): string[] {
  const rm = new Set(remove.map((t) => normalizeTag(t).toLowerCase()));
  return uniqueTags([...current, ...add]).filter((t) => !rm.has(t.toLowerCase()));
}

// ---------------------------------------------------------------------------
// Filename tags
// ---------------------------------------------------------------------------

const BRACKET_RE = /\[([^\]]*)\]/;

export interface FilenameTagOptions {
  /** Also read `Photo_tag1_tag2.jpg` style tags (ambiguous, off by default). */
  underscore?: boolean;
  /** Required when `underscore` is set: only underscore parts that are already known tags count. */
  knownTags?: Set<string>;
}

/** Extract tags from a filename. Returns base name (without tags and extension), tags and extension. */
export function parseFilenameTags(
  filename: string,
  opts: FilenameTagOptions = {}
): { base: string; tags: string[]; ext: string } {
  const dot = filename.lastIndexOf('.');
  const ext = dot > 0 ? filename.slice(dot) : '';
  let stem = dot > 0 ? filename.slice(0, dot) : filename;
  let tags: string[] = [];

  const m = stem.match(BRACKET_RE);
  if (m) {
    tags = m[1].split(/\s+/).map(normalizeTag).filter(Boolean);
    stem = (stem.slice(0, m.index) + stem.slice((m.index ?? 0) + m[0].length)).trim();
  }

  if (opts.underscore && opts.knownTags) {
    const parts = stem.split('_');
    const known = opts.knownTags;
    const lower = new Set([...known].map((k) => k.toLowerCase()));
    // Peel tags from the end while they are known tags.
    while (parts.length > 1 && lower.has(parts[parts.length - 1].toLowerCase())) {
      tags.unshift(parts.pop()!);
    }
    stem = parts.join('_');
  }

  return { base: stem, tags: uniqueTags(tags), ext };
}

/** Build a filename with tags embedded in brackets: `Photo[beach sunset].jpg`. */
export function formatFilenameTags(base: string, tags: string[], ext: string): string {
  const t = uniqueTags(tags);
  return t.length ? `${base}[${t.join(' ')}]${ext}` : `${base}${ext}`;
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const PALETTE = ['#e5484d', '#f76b15', '#e5a50a', '#30a46c', '#12a594', '#0090ff', '#6e56cf', '#d6409f'];

/** Stable color for a tag (based on its top-level segment so related tags share hue). */
export function tagColor(tag: string): string {
  const root = normalizeTag(tag).split(TAG_SEPARATOR)[0].toLowerCase();
  let h = 0;
  for (let i = 0; i < root.length; i++) h = (h * 31 + root.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** Rank tag suggestions for autocomplete: prefix match on any segment, then recency. */
export function suggestTags(input: string, known: string[], recent: string[] = [], limit = 8): string[] {
  const q = normalizeTag(input).toLowerCase();
  const all = uniqueTags([...recent, ...known]);
  if (!q) return all.slice(0, limit);
  const score = (t: string) => {
    const l = t.toLowerCase();
    if (l === q) return 0;
    if (l.startsWith(q)) return 1;
    if (l.split(TAG_SEPARATOR).some((s) => s.startsWith(q))) return 2;
    if (l.includes(q)) return 3;
    return 9;
  };
  return all
    .map((t, i) => ({ t, s: score(t), i }))
    .filter((x) => x.s < 9)
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.t);
}
