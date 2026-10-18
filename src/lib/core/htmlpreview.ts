/**
 * HTML files in the preview: whether a page has scripts, where its relative
 * resources live, and the remembered answer to "show with scripts?".
 */

/** Does the page run code (script tags, inline handlers, javascript: links)? */
export function hasScripts(html: string): boolean {
  return /<script\b|\son[a-z]+\s*=|javascript:/i.test(html);
}

/** Directory of a file path, for resolving the page's relative resources. */
export function dirOf(path: string): string {
  return path.replace(/[\\/][^\\/]*$/, '');
}

/**
 * The file a resource reference of a local page points to, or null when it is
 * not a local file (http:, data:, an anchor …). `/x` counts from the disk root.
 */
export function resolveLocal(dir: string, ref: string): string | null {
  const r = ref.trim();
  if (!r || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(r)) return null;
  const clean = decodeURI(r.split(/[?#]/)[0]);
  if (clean.startsWith('/')) return clean;
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  const parts = dir.split(/[\\/]/);
  for (const seg of clean.split('/')) {
    if (seg === '..') parts.length > 1 && parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join(sep);
}

export type ScriptChoice = { allow: boolean; scope: 'file' | 'dir' };

export interface ScriptDecisions {
  files: Record<string, boolean>;
  dirs: Record<string, boolean>;
}

/** The remembered answer for this file: its own first, else the one for its folder. */
export function decisionFor(d: ScriptDecisions, path: string): boolean | null {
  if (path in d.files) return d.files[path];
  const dir = dirOf(path);
  if (dir in d.dirs) return d.dirs[dir];
  return null;
}

export function remember(d: ScriptDecisions, path: string, c: ScriptChoice): ScriptDecisions {
  const files = { ...d.files };
  const dirs = { ...d.dirs };
  if (c.scope === 'file') files[path] = c.allow;
  else {
    dirs[dirOf(path)] = c.allow;
    delete files[path];
  }
  return { files, dirs };
}

/** Forget what was decided for this file and its folder, so the question comes again. */
export function forget(d: ScriptDecisions, path: string): ScriptDecisions {
  const files = { ...d.files };
  const dirs = { ...d.dirs };
  delete files[path];
  delete dirs[dirOf(path)];
  return { files, dirs };
}
