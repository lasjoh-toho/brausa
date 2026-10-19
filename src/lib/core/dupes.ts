/**
 * Duplicate groups: which copy to keep, which ones are extra, how much space
 * the extras take.
 */
import type { Entry } from './types';

/** "Foto 2.jpg", "Foto (1).jpg", "Foto Kopie.jpg", "Copy of Foto.jpg", "Foto-copy.jpg" … */
const COPY = /(\s\d{1,2}|\s?\(\d+\)|[\s_-](kopie|copy)(\s\d+)?)$|^(kopie von|copy of)\s/i;

export function looksLikeCopy(name: string): boolean {
  const stem = name.replace(/\.[^.]+$/, '');
  return COPY.test(stem);
}

/** The copy to keep: not named like a copy, then the oldest, then the shortest path. */
export function keeper(group: Entry[]): Entry {
  return [...group].sort(
    (a, b) =>
      Number(looksLikeCopy(a.name)) - Number(looksLikeCopy(b.name)) ||
      a.mtime - b.mtime ||
      a.path.length - b.path.length ||
      a.path.localeCompare(b.path)
  )[0];
}

/** Everything but the keeper of each group. */
export function extras(groups: Entry[][]): Entry[] {
  return groups.flatMap((g) => {
    const k = keeper(g);
    return g.filter((e) => e !== k);
  });
}

/** Bytes that removing the extras would free. */
export function waste(groups: Entry[][]): number {
  return groups.reduce((n, g) => n + (g.length - 1) * (g[0]?.size ?? 0), 0);
}
