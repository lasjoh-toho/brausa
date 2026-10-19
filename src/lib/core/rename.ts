/**
 * Batch rename: a name pattern with placeholders, search and replace, case.
 * `planRenames` previews every new name and flags conflicts before anything
 * is touched; `renameOrder` sorts the steps so names can be swapped.
 */
import type { Entry } from './types';
import { basename, dirname } from './paths';
import { i18n, loc, t } from '../i18n/index.svelte';

export interface RenameOptions {
  /** New name without extension: {name} {n} {n:3} {datum} {zeit} {ordner} {ext} (also {date} {time} {folder}). */
  pattern: string;
  find: string;
  replace: string;
  regex: boolean;
  /** First value of {n}. */
  start: number;
  case: 'keep' | 'lower' | 'upper' | 'title';
}

export const DEFAULT_RENAME: RenameOptions = { pattern: '{name}', find: '', replace: '', regex: false, start: 1, case: 'keep' };

/** Placeholder with German and English token (both work in a pattern); token and label follow the UI language. */
const placeholder = (de: string, en: string, key: string): { token: string; label: string } => ({
  get token() {
    return i18n.lang === 'en' ? en : de;
  },
  get label() {
    return t(key);
  }
});

export const PLACEHOLDERS: { token: string; label: string }[] = [
  placeholder('{name}', '{name}', 'core.rename.phName'),
  placeholder('{n}', '{n}', 'core.rename.phNumber'),
  placeholder('{n:3}', '{n:3}', 'core.rename.phNumberPadded'),
  placeholder('{datum}', '{date}', 'core.rename.phDate'),
  placeholder('{zeit}', '{time}', 'core.rename.phTime'),
  placeholder('{ordner}', '{folder}', 'core.rename.phFolder')
];

export interface RenameStep {
  entry: Entry;
  name: string;
  changed: boolean;
  error?: string;
}

function split(e: Entry): [string, string] {
  if (e.kind === 'dir') return [e.name, ''];
  const i = e.name.lastIndexOf('.');
  return i > 0 ? [e.name.slice(0, i), e.name.slice(i)] : [e.name, ''];
}

const two = (n: number) => String(n).padStart(2, '0');

function caseOf(s: string, c: RenameOptions['case']): string {
  const l = loc();
  if (c === 'lower') return s.toLocaleLowerCase(l);
  if (c === 'upper') return s.toLocaleUpperCase(l);
  if (c === 'title') return s.toLocaleLowerCase(l).replace(/(^|[\s_-])(\p{L})/gu, (_, a, b) => a + b.toLocaleUpperCase(l));
  return s;
}

/** Compile the search; an invalid regular expression is reported, not thrown. */
export function searchOf(o: RenameOptions): RegExp | string | null {
  if (!o.find) return null;
  if (!o.regex) return o.find;
  try {
    return new RegExp(o.find, 'g');
  } catch {
    return null;
  }
}

export function newName(e: Entry, index: number, o: RenameOptions): string {
  const [stem, ext] = split(e);
  const d = new Date(e.taken ?? e.mtime);
  let s = o.pattern.replace(/\{(name|n|n:(\d+)|datum|date|zeit|time|ordner|folder|ext)\}/g, (_, key: string, pad?: string) => {
    if (key === 'name') return stem;
    if (key === 'ext') return ext.slice(1);
    if (key === 'datum' || key === 'date') return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
    if (key === 'zeit' || key === 'time') return `${two(d.getHours())}-${two(d.getMinutes())}-${two(d.getSeconds())}`;
    if (key === 'ordner' || key === 'folder') return basename(dirname(e.path));
    const n = o.start + index;
    return pad ? String(n).padStart(Number(pad), '0') : String(n);
  });
  const q = searchOf(o);
  if (q !== null) s = typeof q === 'string' ? s.split(q).join(o.replace) : s.replace(q, o.replace);
  return caseOf(s, o.case).trim() + ext;
}

const BAD = /[/\\:*?"<>|\u0000-\u001f]/;
const key = (dir: string, name: string) => dir + '\u0000' + name.toLocaleLowerCase(loc());

/**
 * New names for `entries` (in this order) with conflicts flagged. `siblings`
 * lists other names already in a folder, so collisions show before renaming.
 */
export function planRenames(entries: Entry[], o: RenameOptions, siblings: (dir: string) => Iterable<string>): RenameStep[] {
  const steps: RenameStep[] = entries.map((e, i) => {
    const name = newName(e, i, o);
    return { entry: e, name, changed: name !== e.name };
  });
  if (o.regex && o.find && searchOf(o) === null) return steps.map((s) => ({ ...s, name: s.entry.name, changed: false, error: t('core.rename.badRegex') }));

  // Names that will be free: those of entries in the batch.
  const leaving = new Set(entries.map((e) => key(dirname(e.path), e.name)));
  const taken = new Map<string, number>();
  for (const s of steps) taken.set(key(dirname(s.entry.path), s.name), (taken.get(key(dirname(s.entry.path), s.name)) ?? 0) + 1);
  const outside = new Map<string, Set<string>>();
  const others = (dir: string) => {
    let set = outside.get(dir);
    if (!set) {
      set = new Set([...siblings(dir)].map((n) => key(dir, n)).filter((k) => !leaving.has(k)));
      outside.set(dir, set);
    }
    return set;
  };

  for (const s of steps) {
    const dir = dirname(s.entry.path);
    const stem = s.entry.kind === 'dir' ? s.name : s.name.slice(0, s.name.length - split(s.entry)[1].length);
    if (!stem.trim() || s.name === '.' || s.name === '..') s.error = t('core.rename.empty');
    else if (BAD.test(s.name)) s.error = t('core.rename.badChars');
    else if ((taken.get(key(dir, s.name)) ?? 0) > 1) s.error = t('core.rename.duplicate');
    else if (s.changed && others(dir).has(key(dir, s.name)) && s.name.toLocaleLowerCase(loc()) !== s.entry.name.toLocaleLowerCase(loc()))
      s.error = t('core.rename.exists');
  }
  return steps;
}

/**
 * The changed steps, each marked whether it first needs a temporary name:
 * its current name is wanted by another entry of the batch. Renaming those to
 * temporary names first, then everything to the new names, makes swaps
 * like a ↔ b work.
 */
export function renameOrder(steps: RenameStep[]): { step: RenameStep; viaTemp: boolean }[] {
  const todo = steps.filter((s) => s.changed && !s.error);
  const wanted = new Map<string, RenameStep>();
  for (const s of todo) wanted.set(key(dirname(s.entry.path), s.name), s);
  return todo.map((s) => {
    const w = wanted.get(key(dirname(s.entry.path), s.entry.name));
    return { step: s, viaTemp: !!w && w !== s };
  });
}
