/**
 * TiddlyWiki connection in the UI: wikis (recipes), shared bags and sync.
 * The logic lives in the Rust core (src-tauri/src/tw.rs).
 */
import { app } from './app.svelte';
import { board } from './board.svelte';
import type { WikiBag, WikiRecipe } from '../backend/types';

class WikiState {
  recipes = $state<WikiRecipe[]>([]);
  bags = $state<WikiBag[]>([]);
  /** Recipe being edited (null = closed, '' = new). */
  editing = $state<string | null>(null);
  syncing = $state<string | null>(null);
  /** Project maps that can be used as bags: `@map:<root>|<id>` → title. */
  maps = $state<{ bag: string; title: string; project: string }[]>([]);

  async load() {
    try {
      [this.recipes, this.bags] = await Promise.all([app.backend.wikiRecipes(), app.backend.wikiBags()]);
      const perProject = await Promise.all(
        app.libraries
          .filter((l) => l.root)
          .map(async (l) =>
            (await app.backend.listMaps(l.root!).catch(() => [])).map((m) => ({ bag: `@map:${l.root}|${m.id}`, title: m.title, project: l.name }))
          )
      );
      this.maps = perProject.flat();
    } catch (e) {
      app.toast(String(e), true);
    }
  }

  /** Open the editor with fresh lists (maps may have been created since). */
  async open(name: string) {
    await board.flush(true);
    await this.load();
    this.editing = name;
  }

  async save(r: WikiRecipe, previous: string | null) {
    const saved = await app.backend.putWikiRecipe(r);
    if (previous && previous !== r.name) await app.backend.deleteWikiRecipe(previous);
    await this.load();
    return saved;
  }

  async remove(name: string) {
    await app.backend.deleteWikiRecipe(name);
    await this.load();
    app.toast(`Wiki „${name}“ entfernt. Wiki-Dateien und Bags bleiben erhalten.`);
  }

  async addBag(name: string, readonly: boolean, description = '') {
    await app.backend.putWikiBag({ name, readonly, description });
    await this.load();
  }

  /** Two-way sync. The open map is saved first and reloaded if the wiki changed it. */
  async sync(name: string) {
    if (this.syncing) return;
    this.syncing = name;
    try {
      await board.flush(true);
      const r = await app.backend.syncWiki(name);
      const parts = [`${r.pushed} ins Wiki geschrieben`];
      if (r.pulled.length) parts.push(`${r.pulled.length} aus dem Wiki übernommen`);
      if (r.deleted.length) parts.push(`${r.deleted.length} gelöscht`);
      app.toast(`„${name}“ abgeglichen: ${parts.join(' · ')}`);
      if (r.conflicts.length) app.toast(`Konflikte: ${r.conflicts.join(', ')}`, true);
      for (const w of r.warnings) app.toast(w, true);
      for (const [root, id] of r.maps) if (board.root === root && board.map?.id === id) await board.load(id);
      await this.load();
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
    if (m) return `${m.title} (Map in ${m.project})`;
    const [root, id] = bag.slice(5).split('|');
    return `Map ${id} (${root.split(/[\\/]/).pop()})`;
  }
}

export const wikis = new WikiState();
