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
import { addCard, bounds } from '../core/map';
import { decisionFor, remember, type ScriptDecisions } from '../core/htmlpreview';
import type { WebBounds, WebEvent } from '../backend/types';
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

  toggle(open = !this.open) {
    this.open = open;
    store.set('webOpen', open);
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

  setCollect(on: boolean) {
    const dir = this.collectDir();
    if (on && !dir) return app.toast(t('web.noFolder'), true);
    this.collect = on;
    if (this.collectTimer) clearInterval(this.collectTimer);
    this.collectTimer = null;
    if (!on) return;
    app.toast(t('web.collectOn', { folder: dir! }));
    const run = async () => {
      const d = this.collectDir();
      if (!d || !this.started || this.home || this.mode !== 'web' || this.local) return;
      const n = await app.backend.webCollectImages(d).catch(() => 0);
      if (n) {
        app.toast(tn('web.collected', n, { folder: basename(d) }));
        if (dirname(d) === app.cwd || d === app.cwd) await app.refresh(true);
      }
    };
    void run();
    this.collectTimer = setInterval(run, 5000);
  }

  private collectDir(): string | null {
    const dir = this.target();
    return dir ? dir.replace(/[\/]+$/, '') + '/Web-Bilder' : null;
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

  /** A local HTML file as a website: its folder is served, its scripts run only if allowed. */
  async openLocal(path: string) {
    const root = dirname(path);
    const d = store.get<ScriptDecisions>('htmlScripts', { files: {}, dirs: {} });
    const scripts = decisionFor(d, path) ?? false;
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
      const path = await app.backend.webSavePage(dir);
      await this.joinProject(path);
      app.toast(t('web.pageSaved', { name: basename(path) }));
    } catch (e) {
      app.toast(String(e).replace(/^Error: /, ''), true);
    }
  }

  private async downloaded(path: string | null, ok: boolean) {
    if (!ok || !path) return app.toast(t('web.downloadFailed'), true);
    await this.joinProject(path);
    app.toast(t('web.downloaded', { name: basename(path), folder: basename(dirname(path)) }));
  }

  private async joinProject(path: string) {
    const p = app.currentProject;
    if (p && !p.folders.some((f) => path.startsWith(f))) await app.backend.addToProject(p.id, [path]);
    await app.loadProjects();
    if (app.project || dirname(path) === app.cwd) await app.refresh(true);
  }

  /**
   * The page, or the text marked in it, as a card on the project's map:
   * a link back to the page, and the quote as a snippet.
   */
  async clip() {
    const p = app.boardProject;
    if (!p) return app.toast(t('web.noProject'), true);
    try {
      const sel = await app.backend.webSelection();
      if (board.root !== p.root || !board.map) await board.open(p.root);
      const quote = sel.text.trim();
      const ref = { kind: 'url' as const, href: sel.url, title: sel.title || sel.url, name: sel.title || sel.url, ...(quote ? { quote } : {}) };
      board.mutate((m) => {
        const b = bounds(m, m.roots);
        const at = { x: b ? b.x + b.w + 40 : 0, y: b ? b.y : 0 };
        addCard(m, null, at, quote
          ? { kind: 'snippet', title: sel.title || sel.url, text: quote, refs: [ref], w: 260, h: Math.min(420, Math.max(96, 70 + Math.ceil(quote.length / 34) * 19)) }
          : { title: sel.title || sel.url, text: sel.url, refs: [ref] });
      });
      app.toast(t(quote ? 'web.clippedQuote' : 'web.clippedPage', { project: p.name }));
    } catch (e) {
      app.toast(String(e).replace(/^Error: /, ''), true);
    }
  }
}

export const web = new WebState();
