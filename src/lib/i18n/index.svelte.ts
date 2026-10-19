/**
 * Interface language. brausa follows the desktop's language (German or
 * English, otherwise English) unless one is chosen in the settings.
 *
 * Texts live in `locales/<area>.ts`, each exporting `{ de, en }` with keys
 * relative to the area: `toolbar.ts` with `search` is `t('toolbar.search')`.
 * `{name}` in a text is filled from the parameters.
 */
import { store } from '../platform';

export type Lang = 'de' | 'en';
export type LangChoice = Lang | 'system';
type Dict = Record<string, string>;

export const LANGS: { key: Lang; label: string }[] = [
  { key: 'de', label: 'Deutsch' },
  { key: 'en', label: 'English' }
];

const modules = import.meta.glob<{ de: Dict; en: Dict }>('./locales/*.ts', { eager: true });
const dicts: Record<Lang, Dict> = { de: {}, en: {} };
for (const [file, m] of Object.entries(modules)) {
  const area = file.replace(/^.*\//, '').replace(/\.ts$/, '');
  for (const lang of ['de', 'en'] as Lang[]) for (const [k, v] of Object.entries(m[lang] ?? {})) dicts[lang][`${area}.${k}`] = v;
}

/** The desktop's language, as far as brausa speaks it. */
export function systemLang(languages: readonly string[] = typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language]): Lang {
  for (const l of languages) {
    const base = l.toLowerCase().split(/[-_]/)[0];
    if (base === 'de' || base === 'en') return base;
  }
  return 'en';
}

class I18n {
  choice = $state<LangChoice>(store.get('lang', 'system'));
  lang = $derived<Lang>(this.choice === 'system' ? systemLang() : this.choice);
  /** For dates and numbers. */
  locale = $derived(this.lang === 'de' ? 'de-DE' : 'en-GB');

  set(choice: LangChoice) {
    this.choice = choice;
    store.set('lang', choice);
  }
}

export const i18n = new I18n();

/** Text for `key`, with `{name}` placeholders filled in. Missing English falls back to German. */
export function t(key: string, params?: Record<string, string | number>): string {
  const s = dicts[i18n.lang][key] ?? dicts.de[key] ?? dicts.en[key] ?? key;
  return params ? s.replace(/\{(\w+)\}/g, (m, p) => (p in params ? String(params[p]) : m)) : s;
}

/** Singular or plural: `key.one` for 1, `key.other` otherwise; `{n}` is the count. */
export function tn(key: string, n: number, params?: Record<string, string | number>): string {
  return t(`${key}.${n === 1 ? 'one' : 'other'}`, { n, ...params });
}

/** Locale for toLocaleString and Intl. */
export function loc(): string {
  return i18n.locale;
}

/** For tests: every key of one language. */
export function keys(lang: Lang): string[] {
  return Object.keys(dicts[lang]);
}

// The Rust core writes some messages itself (errors, sync reports); keep it in step.
if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
  $effect.root(() => {
    $effect(() => {
      const lang = i18n.lang;
      void import('@tauri-apps/api/core').then((m) => m.invoke('set_lang', { lang })).catch(() => {});
    });
  });
}
