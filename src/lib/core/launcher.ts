/**
 * Program tabs ("Starter"): tabs at the top of the main window, each holding
 * aliases of programs. An alias is only a reference to the program (its path);
 * the same program may lie in several tabs.
 */

export interface Alias {
  /** The program: .app bundle, shortcut or .desktop file. */
  path: string;
  name: string;
}

export interface LauncherTab {
  id: string;
  name: string;
  aliases: Alias[];
}

/** Files that are programs and can become an alias. */
export const PROGRAM_EXT = new Set(['app', 'lnk', 'exe', 'desktop', 'appref-ms']);

export function newTabId(tabs: LauncherTab[]): string {
  let n = tabs.length + 1;
  while (tabs.some((t) => t.id === 't' + n)) n++;
  return 't' + n;
}

/** The tabs (other than `except`) that hold an alias of `path`. */
export function tabsWith(tabs: LauncherTab[], path: string, except?: string): LauncherTab[] {
  return tabs.filter((t) => t.id !== except && t.aliases.some((a) => a.path === path));
}

/** Put an alias into a tab (at `index`, else at the end). An alias already there only moves to `index`. */
export function addAlias(tabs: LauncherTab[], tabId: string, alias: Alias, index?: number): LauncherTab[] {
  return tabs.map((t) => {
    if (t.id !== tabId) return t;
    const rest = t.aliases.filter((a) => a.path !== alias.path);
    const at = index === undefined ? rest.length : Math.max(0, Math.min(index, rest.length));
    return { ...t, aliases: [...rest.slice(0, at), alias, ...rest.slice(at)] };
  });
}

export function removeAlias(tabs: LauncherTab[], tabId: string, path: string): LauncherTab[] {
  return tabs.map((t) => (t.id === tabId ? { ...t, aliases: t.aliases.filter((a) => a.path !== path) } : t));
}

/** Move: into `to`, out of `from`. */
export function moveAlias(tabs: LauncherTab[], from: string, to: string, alias: Alias): LauncherTab[] {
  if (from === to) return tabs;
  return removeAlias(addAlias(tabs, to, alias), from, alias.path);
}

/**
 * What a drop of a program onto a tab does:
 * - 'here': it is in this tab already
 * - 'add': no other tab has it, the alias is simply added
 * - 'ask': other tabs have it, the user chooses: an additional alias, or the one in another tab goes
 */
export function dropAction(tabs: LauncherTab[], tabId: string, path: string): 'here' | 'add' | 'ask' {
  const tab = tabs.find((t) => t.id === tabId);
  if (tab?.aliases.some((a) => a.path === path)) return 'here';
  return tabsWith(tabs, path, tabId).length ? 'ask' : 'add';
}

/** Program name from its path (without .app/.lnk/…). */
export function programName(path: string): string {
  const base = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path;
  const dot = base.lastIndexOf('.');
  return dot > 0 && PROGRAM_EXT.has(base.slice(dot + 1).toLowerCase()) ? base.slice(0, dot) : base;
}
