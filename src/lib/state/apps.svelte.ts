/**
 * Installed programs: the "Programme" section of the sidebar (sorted by function,
 * a program may sit in several) and "Öffnen mit …" in the context menu.
 *
 * The core guesses each program's functions; what the user changes is kept here
 * (per program path), as are the user's own functions and the programs last used
 * per file extension.
 */
import { app } from './app.svelte';
import { store } from '../platform';
import { suggest } from '../core/apps';
import type { Entry } from '../core/types';
import type { AppInfo } from '../backend/types';
import { t } from '../i18n/index.svelte';

/** Built-in functions, in the order the sidebar shows them. */
export const APP_CATEGORIES = ['office', 'writing', 'graphics', 'media', 'web', 'dev', 'utilities', 'learn', 'games', 'system'] as const;
/** Programs without any function land here. */
export const OTHER = 'other';

class Apps {
  list = $state<AppInfo[]>([]);
  loaded = $state(false);
  loading = $state(false);
  folders = $state<string[]>([]);
  /** Functions the user set, by program path (replaces the guess). */
  overrides = $state<Record<string, string[]>>(store.get('appCategories', {}));
  /** The user's own functions, besides the built-in ones. */
  custom = $state<string[]>(store.get('appCustomCategories', []));
  /** Programs last used per extension, newest first. */
  recent = $state<Record<string, string[]>>(store.get('openWithRecent', {}));

  async load(force = false) {
    if ((this.loaded || this.loading) && !force) return;
    this.loading = true;
    try {
      [this.list, this.folders] = await Promise.all([app.backend.apps(), app.backend.appFolders()]);
      this.loaded = true;
    } catch (e) {
      app.toast(String(e).replace(/^Error: /, ''), true);
    } finally {
      this.loading = false;
    }
  }

  categoriesOf(a: AppInfo): string[] {
    const c = this.overrides[a.path] ?? a.categories;
    return c.length ? c : [OTHER];
  }

  /** Every function that has programs or was made by the user, in sidebar order. */
  categories = $derived.by(() => {
    const used = new Set(this.list.flatMap((a) => this.categoriesOf(a)));
    const keys = [...APP_CATEGORIES.filter((k) => used.has(k)), ...this.custom, ...[...used].filter((k) => !APP_CATEGORIES.includes(k as never) && !this.custom.includes(k) && k !== OTHER)];
    if (used.has(OTHER)) keys.push(OTHER);
    return keys;
  });

  label(key: string): string {
    return APP_CATEGORIES.includes(key as never) || key === OTHER ? t(`apps.cat.${key}`) : key;
  }

  inCategory(key: string): AppInfo[] {
    return this.list.filter((a) => this.categoriesOf(a).includes(key));
  }

  count(key: string): number {
    return this.inCategory(key).length;
  }

  setCategories(a: AppInfo, cats: string[]) {
    const clean = [...new Set(cats.filter((c) => c && c !== OTHER))];
    const same = clean.length === a.categories.length && clean.every((c) => a.categories.includes(c));
    const next = { ...this.overrides };
    if (same) delete next[a.path];
    else next[a.path] = clean;
    this.overrides = next;
    store.set('appCategories', next);
  }

  toggleCategory(a: AppInfo, key: string) {
    const cur = this.categoriesOf(a).filter((c) => c !== OTHER);
    this.setCategories(a, cur.includes(key) ? cur.filter((c) => c !== key) : [...cur, key]);
  }

  addCustom(name: string) {
    const n = name.trim();
    if (!n || this.custom.includes(n) || APP_CATEGORIES.includes(n as never)) return;
    this.custom = [...this.custom, n];
    store.set('appCustomCategories', this.custom);
  }

  removeCustom(name: string) {
    this.custom = this.custom.filter((c) => c !== name);
    store.set('appCustomCategories', this.custom);
    const next: Record<string, string[]> = {};
    for (const [p, c] of Object.entries(this.overrides)) next[p] = c.filter((x) => x !== name);
    this.overrides = next;
    store.set('appCategories', next);
  }

  suggestions(e: Entry): AppInfo[] {
    return suggest(this.list, e, this.recent[e.ext.toLowerCase()] ?? []);
  }

  async launch(a: AppInfo) {
    try {
      await app.backend.launchApp(a.path, []);
    } catch (err) {
      app.toast(String(err).replace(/^Error: /, ''), true);
    }
  }

  /** Open files in a program and remember it for their extensions. */
  async openWith(files: Entry[], a: AppInfo) {
    const next = { ...this.recent };
    for (const ext of new Set(files.map((f) => f.ext.toLowerCase()).filter(Boolean))) next[ext] = [a.path, ...(next[ext] ?? []).filter((p) => p !== a.path)].slice(0, 5);
    this.recent = next;
    store.set('openWithRecent', next);
    try {
      await app.backend.launchApp(a.path, files.map((f) => f.path));
    } catch (err) {
      app.toast(String(err).replace(/^Error: /, ''), true);
    }
  }
}

export const apps = new Apps();
