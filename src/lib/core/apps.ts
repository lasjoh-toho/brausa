/** Programs for "Öffnen mit …" (pure, for tests). */
import { category } from './format';
import type { AppInfo } from '../backend/types';

/** Matching programs for a file, best first: used before for this extension, then those that name the extension, then the kind. */
export function suggest(list: AppInfo[], e: { ext: string }, recent: string[] = []): AppInfo[] {
  const ext = e.ext.toLowerCase();
  const kind = category(ext);
  const score = (a: AppInfo) => {
    const r = recent.indexOf(a.path);
    if (r >= 0) return 100 - r;
    if (ext && a.exts.includes(ext)) return 50;
    if (kind && a.kinds.includes(kind)) return 40;
    // Office files: office programs, even when they declare nothing.
    if (kind === 'office' && a.categories.includes('office') && !a.kinds.length && !a.exts.length) return 20;
    return 0;
  };
  return list
    .map((a) => ({ a, s: score(a) }))
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s || x.a.name.localeCompare(y.a.name))
    .map((x) => x.a);
}

