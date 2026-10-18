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
import { category } from './format';
import { decisionFor, forget, hasScripts, remember, resolveLocal } from './htmlpreview';

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

import { countDates, formatRange, frameRange, inRange, level, unionRange, monthGrid, monthRange, yearGrid, yearRange } from './dates';

describe('dates', () => {
  const at = (y: number, m: number, d: number) => new Date(y, m, d, 12).getTime();
  const es = [
    entry('a.jpg', { mtime: at(2026, 0, 5), taken: at(2025, 6, 1) }),
    entry('b.jpg', { mtime: at(2026, 0, 5) }),
    entry('c.jpg', { mtime: at(2026, 2, 1) })
  ];

  it('counts per day and month, with taken falling back to mtime', () => {
    const c = countDates(es, 'mtime');
    expect(c.days.get('2026-01-05')).toBe(2);
    expect(c.months.get('2026-03')).toBe(1);
    const t = countDates(es, 'taken');
    expect(t.months.get('2025-07')).toBe(1);
    expect(t.months.get('2026-01')).toBe(1);
  });

  it('filters by date range via filterEntries', () => {
    const [from, to] = monthRange(2026, 0);
    expect(filterEntries(es, { date: { field: 'mtime', from, to } }).map((e) => e.name)).toEqual(['a.jpg', 'b.jpg']);
    const [yf, yt] = yearRange(2025);
    expect(filterEntries(es, { date: { field: 'taken', from: yf, to: yt } }).map((e) => e.name)).toEqual(['a.jpg']);
  });

  it('builds calendar grids Monday-first', () => {
    // 1 Jan 2026 is a Thursday → row 3 in a Monday-first grid.
    expect(yearGrid(2026)[0]).toMatchObject({ key: '2026-01-01', col: 0, row: 3 });
    expect(yearGrid(2024).length).toBe(366);
    expect(monthGrid(2026, 1)).toMatchObject({ lead: 6 }); // Feb 2026 starts on Sunday
    expect(monthGrid(2026, 1).days.length).toBe(28);
  });

  it('scales intensity and formats ranges', () => {
    expect(level(0, 10)).toBe(0);
    expect(level(10, 10)).toBe(4);
    expect(level(1, 100)).toBeGreaterThanOrEqual(1);
    const [f, t] = monthRange(2026, 9);
    expect(formatRange({ field: 'mtime', from: f, to: t })).toBe('Oktober 2026');
    const [yf, yt] = yearRange(2026);
    expect(formatRange({ field: 'mtime', from: yf, to: yt })).toBe('2026');
  });
});

describe('file types', () => {
  it('sorts extensions into categories', () => {
    expect(['a.MP4', 'b.mp3', 'c.php', 'd.html', 'e.pdf', 'f.heic', 'g.docx', 'h.zip'].map((n) => category(n.split('.')[1].toLowerCase()))).toEqual([
      'video', 'audio', 'text', 'web', 'pdf', 'image', 'office', null
    ]);
  });
  it('filters with is: in German and English, combined and negated', () => {
    const es = ['a.jpg', 'b.mov', 'c.mp3', 'd.css', 'e.pdf'].map((n) => entry(n));
    const names = (q: string) => filterEntries(es, { search: q }).map((e) => e.name);
    expect(names('is:video')).toEqual(['b.mov']);
    expect(names('is:medien')).toEqual(['a.jpg', 'b.mov', 'c.mp3']);
    expect(names('is:bild,pdf')).toEqual(['a.jpg', 'e.pdf']);
    expect(names('-is:medien')).toEqual(['d.css', 'e.pdf']);
    expect(parsePattern('is:quatsch').errors.length).toBe(1);
    expect(filterEntries(es, { cats: ['text'] }).map((e) => e.name)).toEqual(['d.css']);
  });
});

describe('html preview', () => {
  it('spots scripts', () => {
    expect(hasScripts('<p>hi</p>')).toBe(false);
    expect(hasScripts('<SCRIPT src=x.js></SCRIPT>')).toBe(true);
    expect(hasScripts('<img onerror="x()">')).toBe(true);
  });
  it('resolves local resources and leaves remote ones alone', () => {
    expect(resolveLocal('/a/b', 'img/x.png')).toBe('/a/b/img/x.png');
    expect(resolveLocal('/a/b', '../c%20d.css?v=1')).toBe('/a/c d.css');
    expect(resolveLocal('C:\\site', 'x.js')).toBe('C:\\site\\x.js');
    expect(resolveLocal('/a', 'https://example.org/x.js')).toBeNull();
    expect(resolveLocal('/a', 'data:image/png;base64,xx')).toBeNull();
    expect(resolveLocal('/a', '#top')).toBeNull();
  });
  it('remembers per file before per folder, and forgets both', () => {
    let d = remember({ files: {}, dirs: {} }, '/s/a.html', { allow: true, scope: 'dir' });
    expect(decisionFor(d, '/s/b.html')).toBe(true);
    d = remember(d, '/s/b.html', { allow: false, scope: 'file' });
    expect(decisionFor(d, '/s/b.html')).toBe(false);
    expect(decisionFor(d, '/t/c.html')).toBeNull();
    expect(decisionFor(forget(d, '/s/b.html'), '/s/a.html')).toBeNull();
  });
});

describe('calendar frames', () => {
  it('turns a frame over the heatmap into a span plus weekdays', () => {
    // 2026-03-02 is a Monday; frame from that Monday (col 9, row 0) to the Tuesday three weeks later.
    const mon = new Date(2026, 2, 2).getTime();
    const r = frameRange('mtime', { date: mon, col: 9, row: 0 }, { col: 12, row: 1 });
    expect(r.weekdays).toEqual([0, 1]);
    expect(r.from).toBe(mon);
    expect(r.to).toBe(new Date(2026, 2, 25).getTime()); // day after Tuesday 24th
    const e = (d: number) => entry('x.jpg', { mtime: new Date(2026, 2, d, 12).getTime() });
    expect(inRange(e(9), r)).toBe(true); // Monday
    expect(inRange(e(11), r)).toBe(false); // Wednesday
    expect(formatRange(r)).toContain('nur Mo, Di');
    const full = frameRange('mtime', { date: mon, col: 9, row: 0 }, { col: 9, row: 6 });
    expect(full.weekdays).toBeUndefined();
  });
  it('adds a second frame: both spans, weekdays of either', () => {
    const a = { field: 'mtime' as const, from: 10, to: 20, weekdays: [0] };
    const b = { field: 'mtime' as const, from: 15, to: 30, weekdays: [6] };
    expect(unionRange(a, b)).toEqual({ field: 'mtime', from: 10, to: 30, weekdays: [0, 6] });
  });
});

describe('web panel addresses', () => {
  it('adds https:// to addresses and searches for words', async () => {
    const { toUrl } = await import('./web');
    expect(toUrl('example.org/a')).toBe('https://example.org/a');
    expect(toUrl('http://x.de')).toBe('http://x.de');
    expect(toUrl('tiddlywiki pinboard')).toBe('https://duckduckgo.com/?q=tiddlywiki%20pinboard');
  });
});

describe('archives', () => {
  it('knows archives and paths inside them', async () => {
    const { isArchive, inArchive, archiveRoot } = await import('./archive');
    expect(isArchive('/a/Fotos.ZIP')).toBe(true);
    expect(isArchive('/a/x.tar.gz')).toBe(true);
    expect(isArchive('/a/x.gz')).toBe(false);
    expect(inArchive('/a/b.zip!/c/d.txt')).toBe(true);
    expect(inArchive('/a/b.zip!')).toBe(true);
    expect(inArchive('C:\\a\\b.zip!\\c')).toBe(true);
    expect(inArchive('/a/b.zip')).toBe(false);
    expect(archiveRoot('/a/b.zip')).toBe('/a/b.zip!');
  });
});
