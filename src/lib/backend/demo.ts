/**
 * In-memory backend so the UI runs in any browser (dev, tests, screenshots).
 * Generates a believable folder structure with procedural "photos".
 */
import type { Entry, MetaPatch, TransferMode } from '../core/types';
import { applyTagPatch, parseFilenameTags, uniqueTags } from '../core/tags';
import { basename, dirname, extOf, isWithin, joinPath, relativeTo } from '../core/paths';
import type { Backend, TransferResult, WalkOptions } from './types';

interface Node {
  entry: Entry;
  children?: Map<string, Node>;
}

const HOME = '/Users/demo';
const DAY = 86400e3;

// Deterministic PRNG so the demo looks the same on every load.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

const SCENES = [
  ['#0b1d3a', '#f97316', '#fde68a'],
  ['#0f766e', '#99f6e4', '#f0fdfa'],
  ['#1e1b4b', '#a855f7', '#f5d0fe'],
  ['#3f1d0b', '#ea580c', '#fed7aa'],
  ['#082f49', '#38bdf8', '#e0f2fe'],
  ['#14532d', '#84cc16', '#ecfccb'],
  ['#450a0a', '#f43f5e', '#ffe4e6'],
  ['#18181b', '#71717a', '#f4f4f5']
];

function photo(seed: number, w = 1200, h = 800): string {
  const r = rng(seed);
  const [dark, mid, light] = SCENES[Math.floor(r() * SCENES.length)];
  const sunX = 200 + r() * 800;
  const sunY = 150 + r() * 250;
  const ridge = (base: number, amp: number) => {
    let d = `M0 ${h}`;
    for (let x = 0; x <= w; x += 60) d += ` L${x} ${base - r() * amp}`;
    return d + ` L${w} ${h} Z`;
  };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${mid}"/></linearGradient></defs>
<rect width="${w}" height="${h}" fill="url(#s)"/>
<circle cx="${sunX}" cy="${sunY}" r="${50 + r() * 70}" fill="${light}" opacity=".9"/>
<path d="${ridge(h * 0.62, 160)}" fill="${mid}" opacity=".55"/>
<path d="${ridge(h * 0.75, 120)}" fill="${dark}" opacity=".7"/>
<path d="${ridge(h * 0.9, 60)}" fill="${dark}"/></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function logo(seed: number): string {
  const r = rng(seed);
  const hue = Math.floor(r() * 360);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="hsl(${hue} 30% 96%)"/>
<circle cx="200" cy="170" r="90" fill="hsl(${hue} 70% 50%)"/><rect x="110" y="270" width="180" height="26" rx="13" fill="hsl(${hue} 40% 25%)"/></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

export class DemoBackend implements Backend {
  readonly name = 'demo' as const;
  private root: Node;
  private folderMetaStore = new Map<string, { tags: string[]; color: string | null }>();

  constructor() {
    this.root = this.dirNode('/', 0);
    this.seed();
  }

  private dirNode(path: string, mtime: number): Node {
    return {
      entry: { path, name: basename(path) || '/', ext: '', kind: 'dir', size: 0, mtime, ctime: mtime, tags: [] },
      children: new Map()
    };
  }

  private find(path: string): Node | undefined {
    if (path === '/') return this.root;
    let n: Node | undefined = this.root;
    for (const part of path.split('/').filter(Boolean)) n = n?.children?.get(part);
    return n;
  }

  private ensureDir(path: string): Node {
    let n = this.root;
    let acc = '';
    for (const part of path.split('/').filter(Boolean)) {
      acc += '/' + part;
      let c = n.children!.get(part);
      if (!c) n.children!.set(part, (c = this.dirNode(acc, Date.now() - 30 * DAY)));
      n = c;
    }
    return n;
  }

  private addFile(dir: string, name: string, p: Partial<Entry> = {}) {
    const d = this.ensureDir(dir);
    const path = joinPath(dir, name);
    const ft = parseFilenameTags(name);
    d.children!.set(name, {
      entry: {
        path,
        name,
        ext: extOf(name),
        kind: 'file',
        size: 2e5,
        mtime: Date.now() - DAY,
        ctime: Date.now() - DAY,
        ...p,
        tags: uniqueTags([...(p.tags ?? []), ...ft.tags])
      }
    });
  }

  private seed() {
    const r = rng(42);
    const now = Date.now();
    const photos: [string, number, string[], [number, number] | null][] = [
      [`${HOME}/Bilder/2026/Urlaub`, 14, ['Privat/Urlaub'], [43.55, 7.02]],
      [`${HOME}/Bilder/2026/Wandern`, 9, ['Privat/Natur'], [47.42, 10.98]],
      [`${HOME}/Bilder/2025`, 10, [], [52.52, 13.4]],
      [`${HOME}/Projekte/Brausa/Assets/2026/Raw`, 12, ['ToReview'], null],
      [`${HOME}/Projekte/Brausa/Assets/2026/Final`, 6, ['Work/Design/UI'], null],
      [`${HOME}/Downloads`, 7, [], null]
    ];
    let seed = 1;
    for (const [dir, count, tags, geo] of photos) {
      for (let i = 0; i < count; i++) {
        const age = Math.floor(r() * 200) * DAY;
        const name = `IMG_${String(1000 + seed).padStart(4, '0')}.jpg`;
        this.addFile(dir, name, {
          size: Math.round(1e6 + r() * 9e6),
          mtime: now - age,
          ctime: now - age,
          tags: r() > 0.4 ? tags : [],
          geo: geo ? { lat: geo[0] + (r() - 0.5) * 0.4, lon: geo[1] + (r() - 0.5) * 0.4 } : null,
          thumb: photo(seed * 7919)
        });
        seed++;
      }
    }
    for (let i = 0; i < 5; i++)
      this.addFile(`${HOME}/Projekte/Brausa/Assets/Logos`, `logo-${i + 1}.svg`, {
        size: 4000 + i * 900,
        tags: ['Work/Design/Logo'],
        thumb: logo(i * 13 + 3),
        mtime: now - i * 9 * DAY
      });
    this.addFile(`${HOME}/Projekte/Brausa`, 'Konzept[Work planung].pdf', { size: 340_000, mtime: now - 2 * DAY });
    this.addFile(`${HOME}/Projekte/Brausa`, 'notizen.md', { size: 4_100, tags: ['Work'] });
    this.addFile(`${HOME}/Dokumente`, 'Steuer-2025.pdf', { size: 1_200_000, tags: ['Privat/Finanzen'], mtime: now - 90 * DAY });
    this.addFile(`${HOME}/Dokumente`, 'Mietvertrag.pdf', { size: 800_000, tags: ['Privat/Wohnung'], mtime: now - 400 * DAY });
    this.addFile(`${HOME}/Downloads`, 'installer.dmg', { size: 180_000_000 });
    this.addFile(`${HOME}/Downloads`, 'Rechnung_0815.pdf', { size: 90_000, tags: ['ToReview'] });
    this.ensureDir(`${HOME}/Desktop`);
    this.ensureDir(`${HOME}/Projekte/Archiv`);
    this.folderMetaStore.set(`${HOME}/Projekte/Archiv`, { tags: ['Archiv'], color: '#71717a' });
    this.folderMetaStore.set(`${HOME}/Bilder/2026/Urlaub`, { tags: ['Privat/Urlaub'], color: '#0090ff' });
  }

  async homeDir() {
    return HOME;
  }

  async places() {
    return [
      { name: 'Home', path: HOME },
      { name: 'Schreibtisch', path: `${HOME}/Desktop` },
      { name: 'Bilder', path: `${HOME}/Bilder` },
      { name: 'Projekte', path: `${HOME}/Projekte` },
      { name: 'Dokumente', path: `${HOME}/Dokumente` },
      { name: 'Downloads', path: `${HOME}/Downloads` }
    ];
  }

  async listDir(path: string): Promise<Entry[]> {
    const n = this.find(path);
    if (!n?.children) throw new Error(`Kein Ordner: ${path}`);
    return [...n.children.values()].map((c) => this.decorate(c.entry));
  }

  async walk(root: string, opts: WalkOptions = {}): Promise<Entry[]> {
    const out: Entry[] = [];
    const max = opts.maxDepth ?? 32;
    const limit = opts.limit ?? 20000;
    const rec = (n: Node, depth: number) => {
      for (const c of n.children?.values() ?? []) {
        if (out.length >= limit) return;
        if (c.children) {
          if (depth < max) rec(c, depth + 1);
        } else out.push({ ...this.decorate(c.entry), relDir: relativeTo(dirname(c.entry.path), root) });
      }
    };
    const n = this.find(root);
    if (n) rec(n, 0);
    return out;
  }

  private decorate(e: Entry): Entry {
    if (e.kind === 'dir') {
      const m = this.folderMetaStore.get(e.path);
      return { ...e, tags: m?.tags ?? [], color: m?.color ?? null };
    }
    return { ...e };
  }

  async transfer(paths: string[], targetDir: string, mode: TransferMode): Promise<TransferResult> {
    const target = this.find(targetDir);
    const res: TransferResult = { moved: {}, errors: [] };
    if (!target?.children) return { moved: {}, errors: paths.map((p) => ({ path: p, message: 'Ziel fehlt' })) };
    for (const p of paths) {
      const src = this.find(p);
      const parent = this.find(dirname(p));
      if (!src || !parent?.children) {
        res.errors.push({ path: p, message: 'Nicht gefunden' });
        continue;
      }
      if (src.children && isWithin(targetDir, p)) {
        res.errors.push({ path: p, message: 'Ordner kann nicht in sich selbst verschoben werden' });
        continue;
      }
      if (mode === 'move' && dirname(p) === targetDir) continue;
      let name = src.entry.name;
      for (let i = 2; target.children.has(name); i++) name = src.entry.name.replace(/(\.[^.]*)?$/, ` ${i}$1`);
      const dest = joinPath(targetDir, name);
      const clone = this.retarget(mode === 'copy' ? structuredClone(src) : src, dest);
      target.children.set(name, clone);
      if (mode === 'move') parent.children.delete(src.entry.name);
      res.moved[p] = dest;
    }
    return res;
  }

  private retarget(n: Node, dest: string): Node {
    const old = n.entry.path;
    n.entry = { ...n.entry, path: dest, name: basename(dest) };
    const fm = this.folderMetaStore.get(old);
    if (fm) this.folderMetaStore.set(dest, fm);
    for (const [name, c] of n.children ?? []) this.retarget(c, joinPath(dest, name));
    return n;
  }

  async updateMeta(paths: string[], patch: MetaPatch): Promise<Entry[]> {
    const out: Entry[] = [];
    for (const p of paths) {
      const n = this.find(p);
      if (!n) continue;
      if (n.children) {
        const m = this.folderMetaStore.get(p) ?? { tags: [], color: null };
        m.tags = applyTagPatch(m.tags, patch.addTags, patch.removeTags);
        if (patch.color !== undefined) m.color = patch.color;
        this.folderMetaStore.set(p, m);
      } else {
        n.entry.tags = applyTagPatch(n.entry.tags, patch.addTags, patch.removeTags);
        if (patch.color !== undefined) n.entry.color = patch.color;
      }
      out.push(this.decorate(n.entry));
    }
    return out;
  }

  async mkdir(parent: string, name: string): Promise<string> {
    const path = joinPath(parent, name);
    this.ensureDir(path);
    return path;
  }

  async folderMeta(path: string) {
    return this.folderMetaStore.get(path) ?? { tags: [], color: null };
  }
}
