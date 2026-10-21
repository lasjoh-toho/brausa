/**
 * The web panel: pages from the internet and local websites in a separate,
 * sealed-off webview next to the files. Pages and marked text can go into
 * the open project (as files or as cards on its map).
 */
import { app } from './app.svelte';
import { board } from './board.svelte';
import { store } from '../platform';
import { t, tn } from '../i18n/index.svelte';
import { basename, dirname } from '../core/paths';
import { decisionFor, remember, type ScriptDecisions } from '../core/htmlpreview';
import type { WebBounds, WebDrag, WebEvent } from '../backend/types';
import { drag, type DropHit } from './drag.svelte';
import type { Entry } from '../core/types';
import type { NoteCard } from '../core/map';
import { addVisit, setTitle, toggleBookmark, toUrl, type WebLibrary, type WebPage } from '../core/web';

export { toUrl };

class WebState {
  open = $state(store.get('webOpen', false));
  url = $state(store.get('webUrl', ''));
  title = $state('');
  loading = $state(false);
  /** The native webview exists (created on the first address). */
  started = $state(false);
  width = $state(store.get('webWidth', 620));
  /** A local website being shown: its folder and whether its scripts run. */
  local = $state<{ root: string; file: string; scripts: boolean } | null>(null);
  /** Bookmarks and history per project ('' = pages visited without a project). */
  libraries = $state<Record<string, WebLibrary>>(store.get('webLibraries', {}));
  /** Bookmark/history list shown over the page (the native page hides meanwhile). */
  listOpen = $state<'bookmarks' | 'history' | null>(null);
  /** Speed dial shown instead of the page (at the start, and with the home button). */
  home = $state(true);
  /** Recent pages under the address bar while typing there. */
  suggest = $state(false);
  /** What the panel shows: web pages, or a document (PDF, text) from which snippets go onto the map. */
  mode = $state<'web' | 'doc'>('web');
  /** Simple built-in ad blocker (applies when the panel is created). */
  adblock = $state(store.get('webAdblock', true));
  /** Pictures of visited pages are saved into the project's (or current) folder, subfolder "Web-Bilder". */
  collect = $state(false);
  private collectTimer: ReturnType<typeof setInterval> | null = null;
  /** Library the visit was recorded in, so a late title lands there too. */
  private visitScope = '';
  /** Area of the panel body; the webview is placed there. */
  rect: WebBounds | null = null;
  private listening = false;

  private async listen() {
    if (this.listening) return;
    this.listening = true;
    await app.backend.onWeb((e) => this.event(e));
  }

  private event(e: WebEvent) {
    if (e.kind === 'nav') {
      if (e.url !== this.url) this.title = '';
      this.url = e.url;
      this.loading = e.loading;
      store.set('webUrl', e.url);
      if (!e.loading) this.visit();
    } else if (e.kind === 'title') {
      this.title = e.title;
      this.edit(this.visitScope, (l) => ({ history: setTitle(l.history, this.url, e.title), bookmarks: setTitle(l.bookmarks, this.url, e.title) }));
    }
    else if (e.kind === 'download') void this.downloaded(e.path, e.success);
    else if (e.kind === 'saved') {
      if (e.error) app.toast(t('web.wikiSaveFailed', { error: e.error }), true);
      else app.toast(e.wiki ? t('web.wikiSavedFolder', { name: e.wiki }) : t('web.wikiSaved', { name: basename(e.path) }));
    }
  }

  // ---------------------------------------------------------------- bookmarks and history

  /** Pages belong to the open project, else to a project holding the current folder. */
  get scope(): { id: string; name: string | null } {
    const p = app.currentProject ?? app.projectOf(app.cwd);
    return { id: p?.id ?? '', name: p?.name ?? null };
  }

  get library(): WebLibrary {
    return this.libraries[this.scope.id] ?? { bookmarks: [], history: [] };
  }

  get bookmarked(): boolean {
    return this.library.bookmarks.some((p) => p.url === this.url);
  }

  private edit(id: string, f: (l: WebLibrary) => WebLibrary) {
    const cur = this.libraries[id] ?? { bookmarks: [], history: [] };
    const next = f(cur);
    if (next.bookmarks === cur.bookmarks && next.history === cur.history) return;
    this.libraries = { ...this.libraries, [id]: next };
    store.set('webLibraries', $state.snapshot(this.libraries));
  }

  private visit() {
    this.visitScope = this.scope.id;
    this.edit(this.visitScope, (l) => ({ ...l, history: addVisit(l.history, { url: this.url, title: this.title, at: Date.now() }) }));
  }

  toggleBookmark(page: WebPage = { url: this.url, title: this.title, at: Date.now() }) {
    if (!page.url) return;
    this.edit(this.scope.id, (l) => ({ ...l, bookmarks: toggleBookmark(l.bookmarks, page) }));
  }

  forget(url: string) {
    this.edit(this.scope.id, (l) => ({ ...l, history: l.history.filter((p) => p.url !== url) }));
  }

  clearHistory() {
    this.edit(this.scope.id, (l) => ({ ...l, history: [] }));
  }

  /** Open a page from the list. */
  async pick(url: string) {
    this.listOpen = null;
    await this.go(url);
  }

  /** Two areas at most: the panel takes the place of the second file pane. */
  toggle(open = !this.open) {
    this.open = open;
    store.set('webOpen', open);
    if (open) {
      if (app.pane) app.setPane(null);
      if (board.panelOpen) board.panelOpen = false;
    }
  }

  /** The globe: the browser, in place of a document shown in the panel. */
  openBrowser() {
    if (this.open && this.mode === 'web') return this.toggle(false);
    board.closeReader();
    this.mode = 'web';
    this.toggle(true);
  }

  setWidth(w: number) {
    this.width = Math.max(320, Math.min(1400, w));
    store.set('webWidth', this.width);
  }

  /** Where downloads and saved pages go: the open project's first folder, else the current folder. */
  target(): string | null {
    if (app.currentProject) return app.currentProject.folders[0] ?? null;
    return app.cwd || null;
  }

  async go(input: string) {
    const url = toUrl(input);
    this.local = null;
    await this.show(url);
  }

  /** Pages for the speed dial: bookmarks first, then recently visited ones. */
  get dial(): WebPage[] {
    const l = this.library;
    const seen = new Set(l.bookmarks.map((p) => p.url));
    return [...[...l.bookmarks].reverse(), ...l.history.filter((p) => !seen.has(p.url))].slice(0, 16);
  }

  setAdblock(on: boolean) {
    this.adblock = on;
    store.set('webAdblock', on);
    // The blocker is built into the page view: reload the page with the new setting.
    if (this.started && !this.home && this.mode === 'web' && this.url) void this.show(this.url);
  }

  /** Picture collector settings: where, from which size, which formats. */
  collectCfg = $state<CollectCfg>(store.get('webCollect', { dir: '', min: 200, exts: ['jpg', 'png', 'webp', 'gif'] }));
  /** The dialog asking where and what to collect. */
  collectDialog = $state(false);

  /** The record button: stop, or ask where and what before starting. */
  toggleCollect() {
    if (this.collect) return this.stopCollect();
    if (!this.collectCfg.dir) this.collectCfg = { ...this.collectCfg, dir: this.target() ?? app.home };
    this.collectDialog = true;
  }

  stopCollect() {
    this.collect = false;
    if (this.collectTimer) clearInterval(this.collectTimer);
    this.collectTimer = null;
  }

  startCollect(cfg: CollectCfg) {
    this.collectCfg = cfg;
    store.set('webCollect', $state.snapshot(cfg));
    this.collectDialog = false;
    this.collect = true;
    if (this.collectTimer) clearInterval(this.collectTimer);
    app.toast(t('web.collectOn', { folder: cfg.dir }));
    const run = async () => {
      const c = this.collectCfg;
      if (!this.collect || !this.started || this.home || this.mode !== 'web' || this.local) return;
      const n = await app.backend.webCollectImages(c.dir, c.min, c.exts).catch(() => 0);
      if (n) {
        app.toast(tn('web.collected', n, { folder: basename(c.dir) }));
        if (c.dir === app.cwd) await app.refresh(true);
      }
    };
    void run();
    this.collectTimer = setInterval(run, 5000);
  }

  // ---------------------------------------------------------------- the page: scrolling and marked text

  /** Text is marked in the page (the "send to project" button shows). */
  hasSelection = $state(false);
  /** The bars slide away while scrolling down, and come back when scrolling up. */
  barsHidden = $state(false);
  private lastY = 0;
  private peeking: ReturnType<typeof setInterval> | null = null;

  /** Watch the page while it is shown. */
  watchPage(on: boolean) {
    if (!on) {
      if (this.peeking) clearInterval(this.peeking);
      this.peeking = null;
      this.hasSelection = false;
      this.barsHidden = false;
      return;
    }
    if (this.peeking) return;
    this.peeking = setInterval(async () => {
      if (!this.started || this.home || this.mode !== 'web') return;
      const p = await app.backend.webPeek().catch(() => null);
      if (!p) return;
      this.hasSelection = p.sel;
      if (p.drag && p.drag.id !== this.dragId) this.followDrag(p.drag);
      const dy = p.y - this.lastY;
      if (p.y < 40) this.barsHidden = false;
      else if (dy > 12) this.barsHidden = true;
      else if (dy < -12) this.barsHidden = false;
      this.lastY = p.y;
    }, 150);
  }

  // ---------------------------------------------------------------- dragging out of the page

  /** The page's drag being followed (or handled), by its id. */
  private dragId = 0;

  /** What a drag out of the page carries: a snippet or link as a note, a picture as a file-to-be. */
  private dragPayload(d: WebDrag): { items: Entry[]; data?: unknown; title: string } {
    const name = d.kind === 'image' ? (d.alt || decodeURIComponent((d.src ?? '').split(/[?#]/)[0].split('/').pop() || 'Bild')) : d.title || d.url;
    const entry: Entry = { path: '', name, ext: '', kind: 'file', size: 0, mtime: 0, ctime: 0, tags: [] };
    if (d.kind === 'image') return { items: [entry], title: name };
    const href = d.kind === 'link' ? d.href! : d.url;
    const text = d.kind === 'link' ? d.text || d.href! : d.text!;
    const ref = { kind: 'url' as const, href, title: d.title || href, name: d.kind === 'link' ? text : d.title || href, ...(d.kind === 'text' ? { quote: text } : {}) };
    const note: NoteCard = { id: '', kind: d.kind === 'text' ? 'snippet' : 'note', title: d.kind === 'link' ? text : d.title || d.url, text: d.kind === 'text' ? text : href, refs: [ref], at: Date.now() };
    return { items: [entry], data: { note, fresh: true }, title: text.slice(0, 200) };
  }

  /** Follows the page's pointer while the button is down, then drops where it was let go. */
  private async followDrag(first: WebDrag) {
    this.dragId = first.id;
    const p = this.dragPayload(first);
    drag.webEnter(p.items, p.data, first.kind === 'image' ? null : ['board', 'project', 'notes', 'kanban', 'wiki'], p.title);
    let d: WebDrag | null = first;
    const at = (d: WebDrag) => ({ x: (this.rect?.x ?? 0) + d.x, y: (this.rect?.y ?? 0) + d.y });
    while (d && d.id === first.id && d.down) {
      const q = at(d);
      drag.webOver(q.x, q.y);
      await new Promise((r) => setTimeout(r, 30));
      d = (await app.backend.webPeek().catch(() => null))?.drag ?? null;
    }
    await app.backend.webDragDone().catch(() => {});
    if (!d || d.id !== first.id || d.cancel) return drag.webCancel();
    const q = at(d);
    await drag.webDrop(q.x, q.y, (hit) => this.resolveDrop(d!, hit));
  }

  /** A picture is downloaded only when it is dropped: into the folder it lands on, else the project's (or Downloads). */
  private async resolveDrop(d: WebDrag, hit: DropHit): Promise<{ items: Entry[]; data?: unknown } | null> {
    const p = this.dragPayload(d);
    if (d.kind !== 'image') return p;
    const dir = (hit.kind === 'folder' || hit.kind === 'crumb') && hit.path ? hit.path : this.target();
    if (!dir) {
      app.toast(t('web.noFolder'), true);
      return null;
    }
    const path = await app.backend.webFetchImage(d.src!, dir);
    const items = await app.backend.entries([path]);
    if (hit.kind === 'folder' || hit.kind === 'crumb') {
      // Already where it was dropped.
      app.toast(t('web.downloaded', { name: basename(path), folder: basename(dir) }));
      await app.refresh(true);
      return null;
    }
    return { items };
  }

  /** Show the speed dial instead of the page. */
  goHome() {
    this.home = true;
    this.mode = 'web';
  }

  private async show(url: string) {
    this.toggle(true);
    await this.listen();
    this.url = url;
    this.home = false;
    this.mode = 'web';
    this.suggest = false;
    try {
      await app.backend.webTarget(this.target());
      if (!this.rect) await new Promise((r) => requestAnimationFrame(r));
      await app.backend.webOpen(url, this.rect ?? { x: 0, y: 0, w: 1, h: 1 }, this.adblock);
      this.started = true;
    } catch (e) {
      app.toast(String(e).replace(/^Error: /, ''), true);
    }
  }

  /** A local HTML file as a website: its folder is served, its scripts run only if allowed.
   *  A TiddlyWiki runs (it is nothing without its scripts) and saves itself back into the file. */
  async openLocal(path: string) {
    const root = dirname(path);
    const d = store.get<ScriptDecisions>('htmlScripts', { files: {}, dirs: {} });
    const wiki = await app.backend.isTiddlyWiki(path).catch(() => false);
    const scripts = decisionFor(d, path) ?? wiki;
    await this.serveLocal(root, path, scripts);
  }

  private async serveLocal(root: string, file: string, scripts: boolean) {
    try {
      const base = await app.backend.webServe(root, scripts);
      this.local = { root, file, scripts };
      await this.show(base + file.slice(root.length + 1).split(/[\\/]/).map(encodeURIComponent).join('/'));
      this.local = { root, file, scripts };
    } catch (e) {
      app.toast(String(e).replace(/^Error: /, ''), true);
    }
  }

  /** Allow or forbid scripts for the shown local site; remembered for its folder. */
  async setScripts(allow: boolean) {
    if (!this.local) return;
    const d = store.get<ScriptDecisions>('htmlScripts', { files: {}, dirs: {} });
    store.set('htmlScripts', remember(d, this.local.file, { allow, scope: 'dir' }));
    await this.serveLocal(this.local.root, this.local.file, allow);
  }

  async place(r: WebBounds, visible: boolean) {
    this.rect = r;
    if (this.started) await app.backend.webPlace(r, visible && this.open && !this.home && this.mode === 'web').catch(() => {});
  }

  /** A document in the panel (instead of the page): snippets can be dragged from it onto the map. */
  showDoc() {
    this.toggle(true);
    this.mode = 'doc';
  }

  async nav(how: 'back' | 'forward' | 'reload') {
    await app.backend.webGo(how).catch((e) => app.toast(String(e).replace(/^Error: /, ''), true));
  }

  /** Saves the page as shown into the project's folder (or the current folder) and adds it to the project. */
  async savePage() {
    const dir = this.target();
    if (!dir) return app.toast(t('web.noFolder'), true);
    try {
      const { path, wiki } = await app.backend.webSavePage(dir);
      await this.joinProject(path);
      if (wiki) {
        // The wiki from now on is the copy here: it opens and saves into its file.
        app.toast(t('web.wikiDownloaded', { name: basename(path), folder: basename(dir) }));
        await this.openLocal(path);
      } else app.toast(t('web.pageSaved', { name: basename(path) }));
    } catch (e) {
      app.toast(String(e).replace(/^Error: /, ''), true);
    }
  }

  private async downloaded(path: string | null, ok: boolean) {
    if (!ok || !path) return app.toast(t('web.downloadFailed'), true);
    await this.joinProject(path);
    // A downloaded TiddlyWiki opens right away, as the copy in the project.
    if (/\.html?$/i.test(path) && (await app.backend.isTiddlyWiki(path).catch(() => false))) {
      app.toast(t('web.wikiDownloaded', { name: basename(path), folder: basename(dirname(path)) }));
      return this.openLocal(path);
    }
    app.toast(t('web.downloaded', { name: basename(path), folder: basename(dirname(path)) }));
  }

  private async joinProject(path: string) {
    const p = app.currentProject;
    if (p && !p.folders.some((f) => path.startsWith(f))) await app.backend.addToProject(p.id, [path]);
    await app.loadProjects();
    if (app.project || dirname(path) === app.cwd) await app.refresh(true);
  }

  /** The text marked in the page goes into a project's notes & snippets thread, with a link back. */
  async sendTo(projectId: string) {
    const p = app.projects.find((x) => x.id === projectId);
    if (!p) return;
    try {
      const sel = await app.backend.webSelection();
      const quote = sel.text.trim();
      if (!quote) return app.toast(t('web.nothingMarked'), true);
      const ref = { kind: 'url' as const, href: sel.url, title: sel.title || sel.url, name: sel.title || sel.url, quote };
      await board.addNote({ kind: 'snippet', title: sel.title || sel.url, text: quote, refs: [ref] }, p.root);
      app.toast(t('board.notes.added', { name: p.name }));
    } catch (e) {
      app.toast(String(e).replace(/^Error: /, ''), true);
    }
  }
}

export interface CollectCfg {
  dir: string;
  /** Smallest width and height in pixels. */
  min: number;
  exts: string[];
}

export const web = new WebState();
