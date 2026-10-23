import type { SmartFolder } from '../core/smart';
/**
 * In-memory backend so the UI runs in any browser (dev, tests, screenshots).
 * Generates a believable folder structure with procedural "photos".
 */
import type { Entry, MetaPatch, TransferMode } from '../core/types';
import { applyTagPatch, parseFilenameTags, uniqueTags } from '../core/tags';
import { basename, dirname, extOf, isWithin, joinPath, relativeTo } from '../core/paths';
import type { Backend, LibraryInfo, MapInfo, ProjectInfo, MediaInfo, OverlayResolution, TransferResult, WalkOptions, WikiBag, WebPreview,
  MwsReport, WikiHit, WikiLayer, WikiOverlay, WikiRecipe } from './types';
import { WALK_LIMIT } from './types';
import { addCard, addLink, newMap, type NoteCard, type ProjectMap } from '../core/map';
import { DEMO_HTML, DEMO_PDF } from './demo-docs';
import { t } from '../i18n/index.svelte';

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
        const age = Math.floor(r() * r() * 700) * DAY;
        const name = `IMG_${String(1000 + seed).padStart(4, '0')}.jpg`;
        this.addFile(dir, name, {
          size: Math.round(1e6 + r() * 9e6),
          mtime: now - age,
          ctime: now - age,
          tags: r() > 0.4 ? tags : [],
          geo: geo ? { lat: geo[0] + (r() - 0.5) * 0.4, lon: geo[1] + (r() - 0.5) * 0.4 } : null,
          taken: now - age - Math.floor(r() * 400) * DAY,
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
    this.addFile(`${HOME}/Projekte/Brausa`, 'Recherche ZUI.html', { size: DEMO_HTML.length, mtime: now - 3 * DAY });
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

  async volumes() {
    return [{ name: 'USB-Stick', path: `${HOME}/Projekte` }];
  }

  async findNames(roots: string[], text: string, opts: { limit?: number } = {}) {
    const needle = text.toLowerCase();
    const limit = opts.limit ?? 2000;
    const out: Entry[] = [];
    for (const root of roots) {
      const rec = (n: Node) => {
        for (const c of n.children?.values() ?? []) {
          if (out.length >= limit) return;
          if (c.entry.name.toLowerCase().includes(needle)) out.push({ ...this.decorate(c.entry), relDir: relativeTo(dirname(c.entry.path), root) });
          if (c.children) rec(c);
        }
      };
      const n = this.find(root);
      if (n) rec(n);
    }
    return { entries: out, more: out.length >= limit };
  }

  async findContent(roots: string[], words: string[]) {
    const out: Entry[] = [];
    const ws = words.map((w) => w.toLowerCase());
    for (const root of roots) {
      const rec = async (n: Node) => {
        for (const c of n.children?.values() ?? []) {
          if (c.children) await rec(c);
          else if (['md', 'txt', 'html', 'pdf'].includes(extOf(c.entry.path))) {
            const text = extOf(c.entry.path) === 'pdf' ? `${c.entry.name} Vertrag Stadt Termin` : await this.readText(c.entry.path);
            const flat = text.replace(/\s+/g, ' ');
            const at = flat.toLowerCase().indexOf(ws[0] ?? '');
            if (ws.length && ws.every((w) => flat.toLowerCase().includes(w)))
              out.push({ ...this.decorate(c.entry), relDir: relativeTo(dirname(c.entry.path), root), hit: { snippet: flat.slice(Math.max(0, at - 60), at + 100), page: null } });
          }
        }
      };
      const n = this.find(root);
      if (n) await rec(n);
    }
    return { entries: out, more: false };
  }

  async listDir(path: string): Promise<Entry[]> {
    const n = this.find(path);
    if (!n?.children) throw new Error(t('demo.notAFolder', { path }));
    return [...n.children.values()].map((c) => this.decorate(c.entry));
  }

  async walk(root: string, opts: WalkOptions = {}): Promise<Entry[]> {
    const out: Entry[] = [];
    const max = opts.maxDepth ?? 32;
    const limit = opts.limit ?? WALK_LIMIT;
    const exts = opts.exts ? new Set(opts.exts) : null;
    const rec = (n: Node, depth: number) => {
      for (const c of n.children?.values() ?? []) {
        if (out.length >= limit) return;
        if (c.children) {
          if (depth < max) rec(c, depth + 1);
        } else if (!exts || exts.has(c.entry.ext)) out.push({ ...this.decorate(c.entry), relDir: relativeTo(dirname(c.entry.path), root) });
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
    if (!target?.children) return { moved: {}, errors: paths.map((p) => ({ path: p, message: t('demo.noTarget') })) };
    for (const p of paths) {
      const src = this.find(p);
      const parent = this.find(dirname(p));
      if (!src || !parent?.children) {
        res.errors.push({ path: p, message: t('demo.notFound') });
        continue;
      }
      if (src.children && isWithin(targetDir, p)) {
        res.errors.push({ path: p, message: t('demo.intoItself') });
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
      this.relink(p, dest);
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

  async thumbnail(entry: Entry) {
    return entry.thumb ?? this.find(entry.path)?.entry.thumb ?? null;
  }

  fileUrl(entry: Entry) {
    return entry.thumb ?? null;
  }

  assetUrl() {
    return null;
  }

  async localUrl() {
    return null;
  }

  async fileData(path: string) {
    if (!this.find(path)) throw new Error(t('demo.notFound'));
    if (extOf(path) !== 'pdf') throw new Error(t('demo.onlyPdfs'));
    return DEMO_PDF.slice().buffer as ArrayBuffer;
  }

  async readText(path: string) {
    if (!this.find(path)) throw new Error(t('demo.notFound'));
    if (extOf(path) === 'html') return DEMO_HTML;
    return '# Notizen\n\nDie Map soll **Snippets** aus PDFs und Webseiten aufnehmen.\n\n- Stapel wie in LiquidText\n- Rücksprung zur Quelle\n';
  }

  async mediaInfo(paths: string[]): Promise<MediaInfo[]> {
    return paths.map((p) => {
      const e = this.find(p)?.entry;
      return { path: p, geo: e?.geo ?? null, taken: e?.taken ?? null };
    });
  }

  async rename(path: string, newName: string): Promise<Entry> {
    const parent = this.find(dirname(path));
    const node = this.find(path);
    const name = newName.trim();
    if (!parent?.children || !node) throw new Error(t('demo.notFound'));
    if (!name || /[\\/]/.test(name)) throw new Error(t('demo.invalidName'));
    if (name !== node.entry.name && parent.children.has(name)) throw new Error(t('demo.exists', { name }));
    parent.children.delete(node.entry.name);
    this.retarget(node, joinPath(dirname(path), name));
    this.relink(path, joinPath(dirname(path), name));
    node.entry.ext = node.children ? '' : extOf(name);
    parent.children.set(name, node);
    return this.decorate(node.entry);
  }

  async compress(): Promise<string> {
    throw new Error(t('demo.compressAppOnly'));
  }

  private smart: SmartFolder[] | null = null;

  async smartFolders() {
    return this.smart ? structuredClone(this.smart) : null;
  }

  async saveSmartFolders(list: SmartFolder[]) {
    this.smart = structuredClone(list);
  }

  async entries(paths: string[]) {
    return paths.flatMap((p) => {
      const n = this.find(p);
      return n ? [this.decorate(n.entry)] : [];
    });
  }

  async onOsDrag() {}

  async dragOut() {}

  async alive() {}

  async stuckView() {
    return null;
  }

  /** Demo files have no content; equal size stands in for equal content. */
  async findDuplicates(paths: string[]): Promise<string[][]> {
    const by = new Map<number, string[]>();
    for (const p of paths) {
      const e = this.find(p)?.entry;
      if (e && e.kind === 'file' && e.size > 0) by.set(e.size, [...(by.get(e.size) ?? []), p]);
    }
    return [...by.values()].filter((g) => g.length > 1);
  }

  async archiveConflicts(): Promise<string[]> {
    return [];
  }

  async trash(paths: string[]): Promise<TransferResult> {
    const res: TransferResult = { moved: {}, errors: [] };
    for (const p of paths) {
      const parent = this.find(dirname(p));
      if (parent?.children?.delete(basename(p))) res.moved[p] = '';
      else res.errors.push({ path: p, message: t('demo.notFound') });
    }
    return res;
  }

  async openDefault(path: string) {
    throw new Error(t('demo.wouldOpen', { name: basename(path) }));
  }

  async reveal(path: string) {
    throw new Error(t('demo.wouldReveal', { name: basename(path) }));
  }

  async watch() {}

  async onChange() {
    return () => {};
  }

  private libs: LibraryInfo[] = [{ id: 'lib_demo', name: 'Brausa', root: `${HOME}/Projekte/Brausa`, files: 31, orphans: 0 }];

  async libraries() {
    return this.libs.map((l) => ({ ...l }));
  }

  async addLibrary(root: string, name?: string) {
    const have = this.libs.find((l) => l.root === root);
    if (have) return have;
    const lib = { id: 'lib_' + this.libs.length, name: name ?? basename(root), root, files: 0, orphans: 0 };
    this.libs.push(lib);
    return lib;
  }

  async removeLibrary(root: string) {
    this.libs = this.libs.filter((l) => l.root !== root);
  }

  async onIndexReport() {
    return () => {};
  }

  // Projects: the demo starts with the former folder project and a free one gathered from two places.
  private projs: ProjectInfo[] = [
    { id: 'p_brausa', name: 'Brausa', color: null, files: [], folders: [`${HOME}/Projekte/Brausa`], root: `${HOME}/Projekte/Brausa` },
    { id: 'p_reise', name: 'Reise 2026', color: null, files: [], folders: [], root: '/.projects/p_reise' }
  ];
  private projsSeeded = false;

  private async seedProjects() {
    if (this.projsSeeded) return;
    this.projsSeeded = true;
    // A few photos and a document from different folders.
    const pics = (await this.walk(`${HOME}/Bilder`, { limit: 200 })).filter((e) => e.kind === 'file').slice(0, 5);
    const docs = (await this.listDir(`${HOME}/Dokumente`)).filter((e) => e.kind === 'file').slice(0, 1);
    this.projs[1].files = (await this.linkFiles([...pics, ...docs].map((e) => e.path))).map((l) => l.id);
  }

  async projects() {
    await this.seedProjects();
    return this.projs.map((p) => ({ ...p, files: [...p.files], folders: [...p.folders] }));
  }

  async createProject(name: string) {
    if (!name.trim()) throw new Error(t('demo.projectNameMissing'));
    const id = 'p_' + Date.now().toString(36);
    const p: ProjectInfo = { id, name: name.trim(), color: null, files: [], folders: [], root: `/.projects/${id}` };
    this.projs.push(p);
    return { ...p };
  }

  private proj(id: string) {
    const p = this.projs.find((x) => x.id === id);
    if (!p) throw new Error(t('demo.noSuchProject', { id }));
    return p;
  }

  async updateProject(id: string, patch: { name?: string; color?: string | null }) {
    const p = this.proj(id);
    if (patch.name !== undefined) p.name = patch.name.trim() || p.name;
    if (patch.color !== undefined) p.color = patch.color;
  }

  async deleteProject(id: string) {
    this.projs = this.projs.filter((p) => p.id !== id);
  }

  async addToProject(id: string, paths: string[]) {
    const p = this.proj(id);
    const before = p.files.length + p.folders.length;
    const dirs = paths.filter((x) => this.find(x)?.entry.kind === 'dir');
    const ids = (await this.linkFiles(paths.filter((x) => !dirs.includes(x)))).map((l) => l.id);
    p.files = [...new Set([...p.files, ...ids])];
    p.folders = [...new Set([...p.folders, ...dirs])];
    return p.files.length + p.folders.length - before;
  }

  async removeFromProject(id: string, paths: string[]) {
    const p = this.proj(id);
    const before = p.files.length + p.folders.length;
    p.files = p.files.filter((f) => !paths.includes(this.linked.get(f) ?? ''));
    p.folders = p.folders.filter((d) => !paths.includes(d));
    return before - p.files.length - p.folders.length;
  }

  async projectEntries(id: string) {
    await this.seedProjects();
    const p = this.proj(id);
    const out: Entry[] = [];
    for (const f of p.files) {
      const n = this.linked.get(f) && this.find(this.linked.get(f)!);
      if (n) out.push({ ...n.entry, relDir: dirname(n.entry.path).split('/').pop() });
    }
    for (const d of p.folders) out.push(...(await this.walk(d, { limit: 5000 })));
    return [...new Map(out.map((e) => [e.path, e])).values()];
  }

  // Maps persist in localStorage so the demo keeps what you draw.
  private mapKey(root: string) {
    return 'brausa.demo.maps:' + root;
  }

  private readMaps(root: string): Record<string, ProjectMap> {
    try {
      const raw = localStorage.getItem(this.mapKey(root));
      if (raw) return JSON.parse(raw);
    } catch {
      /* private mode */
    }
    return root === this.libs[0]?.root ? { m_demo: demoMap() } : {};
  }

  private writeMaps(root: string, maps: Record<string, ProjectMap>) {
    try {
      localStorage.setItem(this.mapKey(root), JSON.stringify(maps));
    } catch {
      /* private mode */
    }
  }

  private requireProject(root: string) {
    if (!this.libs.some((l) => l.root === root) && !this.projs.some((p) => p.root === root)) throw new Error(t('demo.notAProject', { root }));
  }

  async listMaps(root: string): Promise<MapInfo[]> {
    this.requireProject(root);
    return Object.values(this.readMaps(root)).map((m) => ({ id: m.id, title: m.title, updated: m.updated ?? null }));
  }

  private notes = new Map<string, NoteCard[]>();
  async loadNotes(root: string) {
    return structuredClone(this.notes.get(root) ?? []);
  }
  async saveNotes(root: string, notes: NoteCard[]) {
    this.notes.set(root, structuredClone(notes));
  }

  async loadMap(root: string, id: string) {
    this.requireProject(root);
    const m = this.readMaps(root)[id];
    if (!m) throw new Error(t('demo.mapNotFound'));
    return structuredClone(m);
  }

  async saveMap(root: string, map: ProjectMap) {
    this.requireProject(root);
    this.writeMaps(root, { ...this.readMaps(root), [map.id]: structuredClone(map) });
  }

  /** File ids for map cards (id → path), kept in localStorage like the maps. */
  private linked = new Map<string, string>(
    (() => {
      try {
        return JSON.parse(localStorage.getItem('brausa.demo.linked') ?? '[]');
      } catch {
        return [];
      }
    })()
  );

  private saveLinked() {
    try {
      localStorage.setItem('brausa.demo.linked', JSON.stringify([...this.linked]));
    } catch {
      /* private mode */
    }
  }

  private relink(from: string, to: string) {
    for (const [id, p] of this.linked) if (p === from || isWithin(p, from)) this.linked.set(id, to + p.slice(from.length));
    this.saveLinked();
  }

  async linkFiles(paths: string[]) {
    const out = paths.map((path) => {
      let id = [...this.linked].find(([, p]) => p === path)?.[0];
      if (!id) this.linked.set((id = 'f_' + (this.linked.size + 1).toString(36) + Date.now().toString(36)), path);
      return { path, id };
    });
    this.saveLinked();
    return out;
  }

  async locateFiles(ids: string[]) {
    return Object.fromEntries(
      ids.map((id) => {
        const p = this.linked.get(id);
        return [id, p && this.find(p) ? p : null];
      })
    );
  }

  // The web panel is a native webview: only in the desktop app.
  private noWeb(): never {
    throw new Error(t('demo.webAppOnly'));
  }
  async webOpen() {
    this.noWeb();
  }
  async webCollectImages(): Promise<number> {
    return 0;
  }
  async webPeek() {
    return { y: 0, sel: false, drag: null };
  }
  async webFetchImage(): Promise<string> {
    this.noWeb();
  }
  async webDragDone() {}
  async webFind() {
    return { n: -1, i: -1 };
  }
  async webPlace() {}
  async webClose() {}
  async webGo() {}
  async webSelection(): Promise<{ text: string; url: string; title: string }> {
    this.noWeb();
  }
  async webSavePage(): Promise<{ path: string; wiki: boolean }> {
    this.noWeb();
  }
  async pickFolder() {
    // No system dialog in the browser: a folder of the demo stands in.
    return '/Users/demo/Dokumente';
  }
  async isTiddlyWiki() {
    return false;
  }
  async wikiView(): Promise<string> {
    this.noWeb();
  }
  async webTarget() {}
  async webServe(): Promise<string> {
    this.noWeb();
  }
  async onWeb() {
    return () => {};
  }

  // TiddlyWiki: bags and recipes in memory; syncing needs the real app (files on disk).
  private bags: WikiBag[] = [
    { name: 'glossar', description: 'Begriffe für alle Wikis', readonly: false, tiddlers: 12 },
    { name: 'vorlagen', description: 'Seitenvorlagen', readonly: true, tiddlers: 4 }
  ];
  private recipes: WikiRecipe[] = [];

  async wikiBags() {
    return this.bags.map((b) => ({ ...b }));
  }

  async putWikiBag(bag: Omit<WikiBag, 'tiddlers'>) {
    this.bags = [...this.bags.filter((b) => b.name !== bag.name), { ...bag, tiddlers: 0 }].sort((a, b) => a.name.localeCompare(b.name));
  }

  async deleteWikiBag(name: string) {
    if (this.recipes.some((r) => r.bags.includes(name))) throw new Error(t('demo.bagInUse', { name }));
    this.bags = this.bags.filter((b) => b.name !== name);
  }

  async wikiRecipes() {
    return structuredClone(this.recipes);
  }

  async putWikiRecipe(r: WikiRecipe) {
    const own = `wiki-${r.name}`;
    const top = r.bags[r.bags.length - 1];
    const bags = !top || top.startsWith('@map:') || this.bags.find((b) => b.name === top)?.readonly ? [...r.bags, own] : r.bags;
    if (!this.bags.some((b) => b.name === own) && bags.includes(own)) await this.putWikiBag({ name: own, description: `Eigener Bag von „${r.name}“`, readonly: false });
    const out = { ...r, bags, plugins: r.plugins ?? true, local: r.local ?? true };
    this.recipes = [...this.recipes.filter((x) => x.name !== r.name), out];
    return structuredClone(out);
  }

  async deleteWikiRecipe(name: string) {
    this.recipes = this.recipes.filter((r) => r.name !== name);
  }

  /** Two wikis that cover the same glossary entry, to try the overlay tool. */
  private overlays: WikiOverlay[] = [
    {
      title: 'Zoomable User Interface',
      bag: 'glossar',
      base: { title: 'Zoomable User Interface', tags: 'Glossar', text: 'Eine ZUI zeigt Inhalte auf einer unendlichen Fläche.\nMan zoomt hinein statt Fenster zu öffnen.' },
      variants: [
        {
          recipe: 'Brausa',
          identical: false,
          kept: false,
          fields: { title: 'Zoomable User Interface', tags: 'Glossar', text: 'Eine ZUI zeigt Inhalte auf einer unendlichen Fläche.\nMan zoomt hinein statt Fenster zu öffnen.\nBeispiele: Pad++, iMapping.' }
        },
        {
          recipe: 'Lehre',
          identical: false,
          kept: false,
          fields: { title: 'Zoomable User Interface', tags: 'Glossar', text: 'Eine ZUI zeigt Inhalte auf einer großen Fläche.\nMan zoomt hinein statt Fenster zu öffnen.' }
        }
      ]
    },
    {
      title: 'Snippet',
      bag: 'glossar',
      base: { title: 'Snippet', text: 'Ausschnitt aus einem Dokument.' },
      variants: [{ recipe: 'Brausa', identical: true, kept: false, fields: { title: 'Snippet', text: 'Ausschnitt aus einem Dokument.', modified: '20261017120000000' } }]
    }
  ];

  async wikiOverlays() {
    return structuredClone(this.overlays);
  }

  async resolveOverlay(title: string, bag: string, how: OverlayResolution) {
    const o = this.overlays.find((x) => x.title === title && x.bag === bag);
    if (!o) throw new Error(t('demo.notOverlaid', { title }));
    const drop = (recipe: string) => (o.variants = o.variants.filter((v) => v.recipe !== recipe));
    if (how.action === 'promote') {
      o.base = { ...o.variants.find((v) => v.recipe === how.recipe)!.fields };
      if (how.all) o.variants = [];
      else drop(how.recipe);
    } else if (how.action === 'merge') {
      o.base = { ...o.base, text: how.text };
      o.variants = [];
    } else if (how.action === 'discard') drop(how.recipe);
    else o.variants = o.variants.map((v) => (v.recipe === how.recipe ? { ...v, kept: how.keep } : v));
    this.overlays = this.overlays.filter((x) => x.variants.length);
  }

  /** Layers of a wiki, bottom first, with made-up titles where the demo has no tiddlers. */
  async wikiWebFetch(): Promise<WebPreview> {
    throw new Error(t('demo.webAppOnly'));
  }
  async wikiWebApply() {
    return 0;
  }
  async wikiWebDiscard() {}
  async wikiMwsLinked() {
    return false;
  }
  async wikiMwsSync(): Promise<MwsReport> {
    throw new Error(t('demo.webAppOnly'));
  }
  async wikiWebTexts() {
    return { webText: '', localText: '' };
  }
  async wikiWebUpload() {
    throw new Error(t('demo.webAppOnly'));
  }
  async wikiWebPassword() {}
  async wikiWebHasPassword() {
    return false;
  }

  /** Demo bags hold no texts: titles of the generated placeholder tiddlers only. */
  async wikiAddTiddler(_name: string, fields: Record<string, string>): Promise<string> {
    return fields.title ?? 'Snippet';
  }

  async wikiSearch(query: string): Promise<WikiHit[]> {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return this.bags
      .filter((b) => !b.name.startsWith('@'))
      .flatMap((b) => Array.from({ length: b.tiddlers }, (_, i) => ({ bag: b.name, title: `${b.name} ${i + 1}`, snippet: '' })))
      .filter((h) => words.every((w) => h.title.toLowerCase().includes(w)));
  }

  async wikiLayers(recipe: string): Promise<WikiLayer[]> {
    const r = this.recipes.find((x) => x.name === recipe);
    if (!r) throw new Error(recipe);
    const own = `wiki-${r.name}`;
    const fromWeb = (b: string) => b === `web-${r.name}` || b.startsWith('mws-');
    const stack = [...(r.plugins ? ['@plugins'] : []), ...r.bags.filter((b) => b !== own && !fromWeb(b)), ...(r.local ? ['lokal'] : []), ...r.bags.filter(fromWeb), own];
    const glossary = ['Zoomable User Interface', 'Snippet', 'Bag', 'Recipe', 'Tiddler', 'Karte', 'Projekt', 'Pinboard', 'Kanban', 'Markdown', 'Overlay', 'Wiki'];
    const titles = async (bag: string): Promise<string[]> => {
      if (bag === '@plugins') return (await this.wikiPlugins()).map(([n]) => `$:/plugins/brausa/${n.toLowerCase()}`);
      if (bag === 'lokal') return ['Datei: Notizen.md', 'Datei: Plan.pdf', 'Privat: Telefonnummern'];
      if (bag.startsWith('@map:')) {
        const [root, id] = bag.slice(5).split('|');
        return Object.values(this.readMaps(root)[id]?.cards ?? {}).map((c) => c.title).filter(Boolean);
      }
      if (bag === own) return ['Start', ...this.overlays.filter((o) => o.variants.some((v) => v.recipe === r.name)).map((o) => o.title)];
      if (bag === 'glossar') return glossary;
      const n = this.bags.find((b) => b.name === bag)?.tiddlers ?? 0;
      return Array.from({ length: n }, (_, i) => (i < 2 ? glossary[i] : `${bag} ${i + 1}`));
    };
    return Promise.all(stack.map(async (bag) => ({ bag, titles: await titles(bag) })));
  }

  async wikiPlugins(): Promise<[string, string][]> {
    return [
      ['Markdown', '5.3.8'],
      ['Graph', '1.11.0'],
      ['Vis-Network', '10.6.3'],
      ['Pinboard', '0.3.0'],
      ['Kanban', '0.1.0']
    ];
  }

  async syncWiki(): Promise<never> {
    throw new Error(t('demo.syncAppOnly'));
  }

  async deleteMap(root: string, id: string) {
    const maps = this.readMaps(root);
    delete maps[id];
    this.writeMaps(root, maps);
  }
}

/** A small roadmap that shows nesting and links. */
function demoMap(): ProjectMap {
  const m = newMap('Roadmap', 'm_demo');
  const idea = addCard(m, null, { x: 0, y: 0 }, { title: 'Idee', text: 'Ein Finder, der **Projekte** versteht.\n\n- Index\n- Maps\n- TiddlyWiki', color: '#f59e0b', w: 260, h: 170 });
  const web = addCard(m, null, { x: 380, y: -40 }, { title: 'Phase F: Web', w: 420, h: 300, color: '#0090ff' });
  addCard(m, web.id, { x: 20, y: 20 }, { title: 'Web-Pane', text: 'Seiten neben der Map öffnen', w: 380, h: 220 });
  const clip = addCard(m, web.id, { x: 460, y: 20 }, { title: 'Clipper', text: 'Seite als Datei ablegen', w: 380, h: 220 });
  addCard(m, web.id, { x: 20, y: 300 }, { title: 'Snippets', text: 'Text aus PDF/HTML auf die Map ziehen', w: 820, h: 300, color: '#10b981' });
  const tw = addCard(m, null, { x: 0, y: 260 }, { title: 'TiddlyWiki-Export', text: 'Karten → Tiddler, Pfeile → `brausa-links`', w: 300, h: 150, color: '#8b5cf6' });
  addLink(m, idea.id, web.id);
  addLink(m, idea.id, tw.id);
  addLink(m, clip.id, tw.id);
  return m;
}
