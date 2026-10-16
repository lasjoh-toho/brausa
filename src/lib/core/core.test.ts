import { describe, expect, it } from 'vitest';
import {
  applyTagPatch,
  expandTag,
  formatFilenameTags,
  hasTag,
  indexTags,
  normalizeTag,
  parseFilenameTags,
  suggestTags
} from './tags';
import { parsePattern, selectByPattern } from './pattern';
import { crumbs, dirname, isWithin, relativeTo } from './paths';
import { filterEntries, groupEntries, UNTAGGED } from './views';
import type { Entry } from './types';

const DAY = 86400e3;
const NOW = Date.UTC(2026, 9, 16);

function entry(name: string, p: Partial<Entry> = {}): Entry {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  return {
    path: `/root/${p.relDir ? p.relDir + '/' : ''}${name}`,
    name,
    ext,
    kind: 'file',
    size: 1000,
    mtime: NOW - DAY,
    ctime: NOW - 10 * DAY,
    tags: [],
    ...p
  };
}

describe('tags', () => {
  it('normalizes input', () => {
    expect(normalizeTag('  #Work//Design/ ')).toBe('Work/Design');
    expect(normalizeTag('to review')).toBe('to-review');
  });

  it('expands hierarchy', () => {
    expect(expandTag('Work/Design/UI')).toEqual(['Work', 'Work/Design', 'Work/Design/UI']);
    expect(indexTags(['Work/Design/UI', 'work'])).toEqual(['Work', 'Work/Design', 'Work/Design/UI']);
  });

  it('matches parent tags case-insensitively', () => {
    expect(hasTag(['Work/Design/UI'], '#work')).toBe(true);
    expect(hasTag(['Work/Design/UI'], 'Work/Design')).toBe(true);
    expect(hasTag(['Work/Design/UI'], 'Design')).toBe(false);
  });

  it('applies patches', () => {
    expect(applyTagPatch(['a', 'b'], ['c', 'A'], ['b'])).toEqual(['a', 'c']);
  });

  it('parses and formats bracket filename tags', () => {
    const r = parseFilenameTags('Foto[urlaub strand].jpg');
    expect(r).toEqual({ base: 'Foto', tags: ['urlaub', 'strand'], ext: '.jpg' });
    expect(formatFilenameTags(r.base, r.tags, r.ext)).toBe('Foto[urlaub strand].jpg');
    expect(parseFilenameTags('plain.txt').tags).toEqual([]);
  });

  it('reads underscore tags only when known', () => {
    const known = new Set(['tag1', 'tag2']);
    expect(parseFilenameTags('Photo_tag1_tag2.jpg', { underscore: true, knownTags: known })).toEqual({
      base: 'Photo',
      tags: ['tag1', 'tag2'],
      ext: '.jpg'
    });
    expect(parseFilenameTags('my_holiday_pic.jpg', { underscore: true, knownTags: known }).tags).toEqual([]);
  });

  it('suggests tags by segment prefix', () => {
    const s = suggestTags('des', ['Work/Design/UI', 'Desk', 'Random'], []);
    expect(s).toEqual(['Desk', 'Work/Design/UI']);
  });
});

describe('pattern', () => {
  const entries = [
    entry('big.png', { size: 6e6 }),
    entry('small.png', { size: 1e5 }),
    entry('photo.jpg', { size: 8e6, tags: ['ToReview'] }),
    entry('old.png', { size: 7e6, mtime: NOW - 60 * DAY }),
    entry('logo.svg', { tags: ['Work/Design/Logo'] })
  ];

  it('handles the example from the spec', () => {
    expect(selectByPattern(entries, '*.png > 5MB', NOW).paths).toEqual(['/root/big.png', '/root/old.png']);
  });

  it('selects by tag incl. hierarchy and negation', () => {
    expect(selectByPattern(entries, '#ToReview', NOW).paths).toEqual(['/root/photo.jpg']);
    expect(selectByPattern(entries, '#Work', NOW).paths).toEqual(['/root/logo.svg']);
    expect(selectByPattern(entries, '*.png -#ToReview', NOW).paths.length).toBe(3);
  });

  it('selects by age with spaced or glued syntax', () => {
    expect(selectByPattern(entries, '*.png modified < 30d', NOW).paths).toEqual(['/root/big.png', '/root/small.png']);
    expect(selectByPattern(entries, '*.png modified<30d', NOW).paths.length).toBe(2);
    expect(selectByPattern(entries, 'modified > 30d', NOW).paths).toEqual(['/root/old.png']);
  });

  it('supports ext and text terms and reports errors', () => {
    expect(selectByPattern(entries, 'ext:svg,jpg', NOW).paths.length).toBe(2);
    expect(selectByPattern(entries, 'logo', NOW).paths).toEqual(['/root/logo.svg']);
    expect(parsePattern('size>5XB').errors.length).toBe(1);
  });
});

describe('paths', () => {
  it('builds crumbs for posix and windows', () => {
    expect(crumbs('/home/u/Project/Assets', '/home/u').map((c) => c.name)).toEqual(['u', 'Project', 'Assets']);
    expect(crumbs('C:\\Users\\me\\Pics').map((c) => c.path)).toEqual(['C:\\', 'C:\\Users', 'C:\\Users\\me', 'C:\\Users\\me\\Pics']);
  });

  it('computes relations', () => {
    expect(dirname('/a/b/c.txt')).toBe('/a/b');
    expect(dirname('/a')).toBe('/');
    expect(isWithin('/a/b/c', '/a/b')).toBe(true);
    expect(isWithin('/a/bc', '/a/b')).toBe(false);
    expect(relativeTo('/a/b/c/d.jpg', '/a/b')).toBe('c/d.jpg');
  });
});

describe('views', () => {
  const entries = [
    entry('a.jpg', { relDir: '2026/Raw', tags: ['Work/Design'] }),
    entry('b.jpg', { relDir: '2026', tags: ['Private'] }),
    entry('c.jpg', { relDir: '', tags: [] }),
    { ...entry('dir'), kind: 'dir' as const }
  ];

  it('filters dirs and funnels', () => {
    expect(filterEntries(entries, {}).length).toBe(3);
    expect(filterEntries(entries, { funnel: '/root/2026' }).map((e) => e.name)).toEqual(['a.jpg', 'b.jpg']);
  });

  it('groups by tag depth and subfolder', () => {
    const byTag = groupEntries(entries.slice(0, 3), 'tag');
    expect(byTag.map((g) => g.label)).toEqual(['Private', 'Work', 'Ohne Tag']);
    expect(byTag[2].key).toBe(UNTAGGED);
    expect(groupEntries(entries.slice(0, 3), 'tag', { depth: 2 }).map((g) => g.label)).toEqual(['Work/Design', 'Ohne Tag']);
    expect(groupEntries(entries.slice(0, 3), 'subfolder').map((g) => g.label)).toEqual(['(oberste Ebene)', '2026']);
  });
});
