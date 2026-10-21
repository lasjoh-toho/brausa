/**
 * TiddlyWiki connection in the UI: wikis (recipes), shared bags and sync.
 * The logic lives in the Rust core (src-tauri/src/tw.rs).
 */
import { app } from './app.svelte';
import { store } from '../platform';
import { board } from './board.svelte';
import { web } from './web.svelte';
import { t, tn } from '../i18n/index.svelte';
import type { OverlayResolution, WebPreview, WikiBag, WikiOverlay, WikiRecipe } from '../backend/types';

class WikiState {
  recipes = $state<WikiRecipe[]>([]);
  bags = $state<WikiBag[]>([]);
  /** Recipe being edited (null = closed, '' = new). */
  editing = $state<string | null>(null);
  syncing = $state<string | null>(null);
  /** Shared tiddlers covered by wikis' own versions (see the overlay tool). */
  overlays = $state<WikiOverlay[]>([]);
  overlaysOpen = $state(false);
  /** Bag overview (matrix, graph, layers). */
  overviewOpen = $state(false);
  /** Overlays that still need a decision (not identical, not kept). */
  pending = $derived(this.overlays.filter((o) => o.variants.some((v) => !v.kept)).length);
  /** Project maps that can be used as bags: `@map:<root>|<id>` → title. */
  maps = $state<{ bag: string; title: string; project: string }[]>([]);

  async load() {
    try {
      [this.recipes, this.bags] = await Promise.all([app.backend.wikiRecipes(), app.backend.wikiBags()]);
      const perProject = await Promise.all(
        app.projects.map(async (p) =>
          (await app.backend.listMaps(p.root).catch(() => [])).map((m) => ({ bag: `@map:${p.root}|${m.id}`, title: m.title, project: p.name }))
        )
      );
      this.maps = perProject.flat();
      this.overlays = await app.backend.wikiOverlays();
    } catch (e) {
      app.toast(String(e), true);
    }
  }

  async resolve(o: WikiOverlay, how: OverlayResolution, quiet = false) {
    try {
      await app.backend.resolveOverlay(o.title, o.bag, how);
      this.overlays = await app.backend.wikiOverlays();
      if (!quiet) app.toast(t('wikis.resolved'));
    } catch (e) {
      app.toast(String(e).replace(/^Error: /, ''), true);
    }
  }

  /** Overlays that only differ in dates: drop them all. */
  async discardIdentical() {
    let n = 0;
    for (const o of this.overlays)
      for (const v of o.variants)
        if (v.identical) {
          await app.backend.resolveOverlay(o.title, o.bag, { action: 'discard', recipe: v.recipe });
          n++;
        }
    this.overlays = await app.backend.wikiOverlays();
    app.toast(tn('wikis.discarded', n));
  }

  /** Bags a new wiki starts with (null: all maps of the project). */
  preset = $state<string[] | null>(null);
  /** After saving the new wiki: sync and open it (asked for from a story). */
  openAfterSave = false;

  /** A new wiki with this map as its bag; opened once saved. */
  async createFor(bag: string) {
    this.preset = bag ? [bag] : null;
    this.openAfterSave = true;
    await this.open('', true);
  }

  /** Sync a wiki, then open it (TiddlyDesktop or the browser shows the story there). */
  /** Brings the wiki up to date (with its web version, if it has one) and shows it in the web panel (it saves back from there). */
  async openStory(name: string) {
    if (this.recipes.find((x) => x.name === name)?.web) await this.webTakeNewer(name);
    await this.sync(name);
    try {
      await web.openLocal(await app.backend.wikiView(name));
    } catch (e) {
      app.toast(String(e).replace(/^Error: /, ''), true);
    }
  }

  /** Open the editor with fresh lists (maps may have been created since). */
  async open(name: string, keepPreset = false) {
    if (!keepPreset) {
      this.preset = null;
      this.openAfterSave = false;
    }
    await board.flush(true);
    await this.load();
    this.editing = name;
  }

  /** Open the bag overview with fresh lists. */
  async openOverview() {
    await this.load();
    this.overviewOpen = true;
  }

  async save(r: WikiRecipe, previous: string | null) {
    const saved = await app.backend.putWikiRecipe(r);
    if (previous && previous !== r.name) await app.backend.deleteWikiRecipe(previous);
    await this.load();
    this.preset = null;
    if (this.openAfterSave) {
      this.openAfterSave = false;
      void this.openStory(r.name);
    }
    return saved;
  }

  async remove(name: string) {
    await app.backend.deleteWikiRecipe(name);
    await this.load();
    app.toast(t('wikis.removed', { name }));
  }

  /** Wiki settings (bags, plugins, search), opened with the gear in the sidebar. */
  settingsOpen = $state(false);
  /** The search across wikis starts at this many characters. */
  searchMin = $state(store.get('wikiSearchMin', 5));

  setSearchMin(n: number) {
    this.searchMin = Math.max(1, Math.min(20, Math.round(n) || 5));
    store.set('wikiSearchMin', this.searchMin);
  }

  /** Offer a bag when a new wiki is put together, or not. */
  async setHidden(name: string, hidden: boolean) {
    const b = this.bags.find((x) => x.name === name);
    if (!b) return;
    await app.backend.putWikiBag({ name: b.name, description: b.description, readonly: b.readonly, hidden });
    await this.load();
  }

  async deleteBag(name: string) {
    try {
      await app.backend.deleteWikiBag(name);
      await this.load();
      app.toast(t('wikis.bagDeleted', { name }));
    } catch (e) {
      app.toast(String(e).replace(/^Error: /, ''), true);
    }
  }

  async addBag(name: string, readonly: boolean, description = '') {
    await app.backend.putWikiBag({ name, readonly, description });
    await this.load();
  }

  /** Two-way sync. The open map is saved first and reloaded if the wiki changed it. */
  /** Web comparison in progress (the dialog shows it). */
  webSync = $state<{ name: string; preview: WebPreview } | null>(null);
  webBusy = $state<string | null>(null);

  /** Compare a wiki with its web version. */
  async webCompare(name: string) {
    if (this.webBusy) return;
    this.webBusy = name;
    try {
      const preview = await app.backend.wikiWebFetch(name);
      if (!preview.new.length && !preview.changed.length && !preview.plugins.some((p) => !p.have)) {
        await app.backend.wikiWebDiscard(name);
        app.toast(t('wikis.webSame', { name }));
        if (preview.hasPassword) this.webSync = { name, preview };
      } else this.webSync = { name, preview };
    } catch (e) {
      app.toast(String(e).replace(/^Error: /, ''), true);
    } finally {
      this.webBusy = null;
    }
  }

  /** Without asking: what is new on the web or newer there comes over (into the web bag). */
  async webTakeNewer(name: string) {
    if (this.webBusy) return;
    this.webBusy = name;
    try {
      const p = await app.backend.wikiWebFetch(name);
      const titles = [...p.new, ...p.changed].filter((c) => c.newer).map((c) => c.title);
      const n = titles.length ? await app.backend.wikiWebApply(name, titles, []) : 0;
      const older = p.changed.length - p.changed.filter((c) => c.newer).length;
      if (n) {
        await this.load();
        app.toast(t('wikis.webAuto', { n, name }) + (older ? ' ' + t('wikis.webOlderKept', { n: older }) : ''));
      }
    } catch (e) {
      // Offline or unreachable: the wiki opens as it is here.
      app.toast(t('wikis.webUnreachable', { name, error: String(e).replace(/^Error: /, '') }), true);
    } finally {
      this.webBusy = null;
    }
  }

  /** Take the chosen changes, sync the wiki, and upload a new version if wanted. */
  async webApply(titles: string[], plugins: string[], upload: boolean) {
    const s = this.webSync;
    if (!s) return;
    this.webSync = null;
    try {
      const n = await app.backend.wikiWebApply(s.name, titles, plugins);
      if (n || plugins.length) app.toast(t('wikis.webTaken', { n, name: s.name }));
      await this.load();
      await this.sync(s.name);
      if (upload) {
        this.webBusy = s.name;
        await app.backend.wikiWebUpload(s.name);
        app.toast(t('wikis.webUploaded', { name: s.name }));
      }
    } catch (e) {
      app.toast(String(e).replace(/^Error: /, ''), true);
    } finally {
      this.webBusy = null;
    }
  }

  async webCancel() {
    const s = this.webSync;
    this.webSync = null;
    if (s) await app.backend.wikiWebDiscard(s.name).catch(() => {});
  }

  async sync(name: string) {
    if (this.syncing) return;
    this.syncing = name;
    try {
      await board.flush(true);
      const r = await app.backend.syncWiki(name);
      const parts = [t('wikis.pushed', { n: r.pushed })];
      if (r.pulled.length) parts.push(t('wikis.pulled', { n: r.pulled.length }));
      if (r.deleted.length) parts.push(t('wikis.deleted', { n: r.deleted.length }));
      app.toast(t('wikis.synced', { name, parts: parts.join(' · ') }));
      if (r.conflicts.length) app.toast(t('wikis.conflicts', { list: r.conflicts.join(', ') }), true);
      for (const w of r.warnings) app.toast(w, true);
      for (const [root, id] of r.maps) if (board.root === root && board.map?.id === id) await board.load(id);
      await this.load();
      if (this.pending) app.toast(tn('wikis.pending', this.pending));
    } catch (e) {
      app.toast(String(e).replace(/^Error: /, ''), true);
    } finally {
      this.syncing = null;
    }
  }

  /** Readable name of a bag in a recipe (map bags show project and map). */
  label(bag: string): string {
    if (!bag.startsWith('@map:')) return bag;
    const m = this.maps.find((x) => x.bag === bag);
    if (m) return t('wikis.mapBag', { title: m.title, project: m.project });
    const [root, id] = bag.slice(5).split('|');
    return t('wikis.mapBagUnknown', { id, folder: root.split(/[\\/]/).pop() ?? '' });
  }
}

export const wikis = new WikiState();
