import { describe, expect, it } from 'vitest';
import { addAlias, dropAction, moveAlias, newTabId, programName, removeAlias, tabsWith, type LauncherTab } from './launcher';

const word = { path: '/Applications/Word.app', name: 'Word' };
const gimp = { path: '/Applications/GIMP.app', name: 'GIMP' };
const tabs: LauncherTab[] = [
  { id: 't1', name: 'Büro', aliases: [word] },
  { id: 't2', name: 'Grafik', aliases: [gimp] }
];

describe('launcher tabs', () => {
  it('adds an alias once, at a position', () => {
    let t = addAlias(tabs, 't2', word);
    expect(t[1].aliases.map((a) => a.name)).toEqual(['GIMP', 'Word']);
    t = addAlias(t, 't2', word, 0);
    expect(t[1].aliases.map((a) => a.name)).toEqual(['Word', 'GIMP']);
    expect(t[0].aliases).toEqual([word]);
  });

  it('asks only when another tab has the program', () => {
    expect(dropAction(tabs, 't1', word.path)).toBe('here');
    expect(dropAction(tabs, 't2', word.path)).toBe('ask');
    expect(dropAction(tabs, 't2', '/Applications/Safari.app')).toBe('add');
    expect(tabsWith(tabs, word.path, 't2').map((t) => t.name)).toEqual(['Büro']);
  });

  it('moves and removes aliases', () => {
    const t = moveAlias(tabs, 't1', 't2', word);
    expect(t[0].aliases).toEqual([]);
    expect(t[1].aliases).toEqual([gimp, word]);
    expect(removeAlias(t, 't2', gimp.path)[1].aliases).toEqual([word]);
    expect(moveAlias(tabs, 't1', 't1', word)).toBe(tabs);
  });

  it('names programs and tabs', () => {
    expect(programName('/Applications/Microsoft Word.app')).toBe('Microsoft Word');
    expect(programName('C:\\Start Menu\\GIMP 2.lnk')).toBe('GIMP 2');
    expect(programName('/usr/share/applications/org.gimp.GIMP.desktop')).toBe('org.gimp.GIMP');
    expect(programName('/Applications/Foo.app/')).toBe('Foo');
    expect(newTabId(tabs)).toBe('t3');
    expect(newTabId([{ id: 't2', name: '', aliases: [] }])).toBe('t3');
  });
});
