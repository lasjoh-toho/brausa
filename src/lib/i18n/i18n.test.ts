import { describe, expect, it } from 'vitest';
import { keys, systemLang, t, tn, i18n } from './index.svelte';

describe('i18n', () => {
  it('has every text in both languages', () => {
    const de = new Set(keys('de'));
    const en = new Set(keys('en'));
    expect([...de].filter((k) => !en.has(k))).toEqual([]);
    expect([...en].filter((k) => !de.has(k))).toEqual([]);
  });

  it('keeps placeholders the same in both languages', () => {
    i18n.set('de');
    const de = Object.fromEntries(keys('de').map((k) => [k, t(k)]));
    i18n.set('en');
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
    const wrong = keys('en').filter((k) => ph(t(k)) !== ph(de[k]));
    expect(wrong).toEqual([]);
  });

  it('follows the system language and fills placeholders', () => {
    expect(systemLang(['de-AT', 'en'])).toBe('de');
    expect(systemLang(['fr-FR', 'en-US'])).toBe('en');
    expect(systemLang(['fr-FR'])).toBe('en');
    i18n.set('en');
    expect(tn('common.files', 1)).toBe('1 file');
    expect(tn('common.files', 3)).toBe('3 files');
    i18n.set('de');
    expect(t('updates.available', { version: '0.8.0' })).toBe('brausa 0.8.0 ist da.');
    expect(t('does.not.exist')).toBe('does.not.exist');
  });
});
