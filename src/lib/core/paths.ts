/**
 * Path helpers that work on both POSIX and Windows paths. The backend always
 * hands out absolute paths; we only need to split/join them for display.
 */

export function sep(path: string): '/' | '\\' {
  return path.includes('\\') && !path.includes('/') ? '\\' : '/';
}

export function basename(path: string): string {
  const parts = splitPath(path);
  return parts.length ? parts[parts.length - 1] : path;
}

export function dirname(path: string): string {
  const s = sep(path);
  const trimmed = path.replace(/[\\/]+$/, '');
  const i = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (i < 0) return '';
  if (i === 0) return s;
  const head = trimmed.slice(0, i);
  // "C:" → "C:\"
  return /^[A-Za-z]:$/.test(head) ? head + s : head;
}

export function joinPath(dir: string, name: string): string {
  const s = sep(dir);
  return dir.endsWith('/') || dir.endsWith('\\') ? dir + name : dir + s + name;
}

export function splitPath(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean);
}

export interface Crumb {
  name: string;
  path: string;
}

/** Breadcrumbs from `root` (inclusive) down to `path`. If path is outside root, the full path is used. */
export function crumbs(path: string, root?: string): Crumb[] {
  const s = sep(path);
  const isAbsPosix = path.startsWith('/');
  const parts = splitPath(path);
  const out: Crumb[] = [];
  let acc = isAbsPosix ? '' : '';
  parts.forEach((p, i) => {
    acc = i === 0 ? (isAbsPosix ? s + p : /^[A-Za-z]:$/.test(p) ? p + s : p) : joinPath(acc, p);
    out.push({ name: p, path: acc });
  });
  if (root) {
    const idx = out.findIndex((c) => samePath(c.path, root));
    if (idx >= 0) return out.slice(idx);
  }
  return out;
}

export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/[\\/]+$/, '').replace(/\\/g, '/');
  return norm(a) === norm(b);
}

/** True if `child` is inside (or equal to) `parent`. */
export function isWithin(child: string, parent: string): boolean {
  const c = child.replace(/\\/g, '/').replace(/\/+$/, '');
  const p = parent.replace(/\\/g, '/').replace(/\/+$/, '');
  return c === p || c.startsWith(p + '/');
}

export function relativeTo(path: string, root: string): string {
  const c = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const r = root.replace(/\\/g, '/').replace(/\/+$/, '');
  if (c === r) return '';
  return c.startsWith(r + '/') ? c.slice(r.length + 1) : c;
}

export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}
