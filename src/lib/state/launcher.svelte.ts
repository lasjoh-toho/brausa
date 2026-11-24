/**
 * Program tabs at the top of the main window ("Dateien" plus the user's own tabs
 * with program aliases). Kept in local storage.
 */
import { app } from './app.svelte';
import { store } from '../platform';
import { addAlias, dropAction, moveAlias, newTabId, removeAlias, tabsWith, type Alias, type LauncherTab } from '../core/launcher';
import { t } from '../i18n/index.svelte';

/** A program dropped on a tab whose alias already lies in other tabs: the user picks what happens. */
export interface Pending {
  alias: Alias;
  to: string;
  /** Tab it was dragged out of (moving between tabs). */
  from?: string;
  others: LauncherTab[];
}

class Launcher {
  tabs = $state<LauncherTab[]>(store.get('launcherTabs', []));
  /** The tab shown: null is "Dateien" (the file browser). */
  active = $state<string | null>(null);
  pending = $state<Pending | null>(null);

  private save() {
    store.set('launcherTabs', this.tabs);
  }

  activeTab = $derived(this.tabs.find((x) => x.id === this.active) ?? null);

  show(id: string | null) {
    this.active = id;
  }

  addTab(name?: string): string {
    const id = newTabId(this.tabs);
    this.tabs = [...this.tabs, { id, name: name?.trim() || t('launcher.newTab'), aliases: [] }];
    this.save();
    return id;
  }

  renameTab(id: string, name: string) {
    const n = name.trim();
    if (!n) return;
    this.tabs = this.tabs.map((x) => (x.id === id ? { ...x, name: n } : x));
    this.save();
  }

  async removeTab(id: string) {
    const tab = this.tabs.find((x) => x.id === id);
    if (!tab) return;
    if (tab.aliases.length && !(await app.ask({ title: t('launcher.removeTab'), text: t('launcher.removeTabText', { name: tab.name, n: tab.aliases.length }), ok: t('launcher.removeTab'), danger: true })))
      return;
    this.tabs = this.tabs.filter((x) => x.id !== id);
    if (this.active === id) this.active = null;
    this.save();
  }

  moveTab(from: number, to: number) {
    const next = [...this.tabs];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    this.tabs = next;
    this.save();
  }

  /** A program dropped on a tab (from the sidebar, the file view or another tab). */
  drop(alias: Alias, to: string, from?: string) {
    const name = this.tabs.find((x) => x.id === to)?.name ?? '';
    switch (dropAction(this.tabs, to, alias.path)) {
      case 'here':
        if (from === undefined) app.toast(t('launcher.already', { app: alias.name, tab: name }));
        return;
      case 'add':
        this.tabs = from ? moveAlias(this.tabs, from, to, alias) : addAlias(this.tabs, to, alias);
        this.save();
        app.toast(t(from ? 'launcher.moved' : 'launcher.added', { app: alias.name, tab: name }));
        return;
      case 'ask':
        this.pending = { alias, to, from, others: tabsWith(this.tabs, alias.path, to) };
    }
  }

  /** Answer to the question: an additional alias, or the alias in tab `drop` goes (it moves here). */
  resolve(choice: 'extra' | { drop: string } | null) {
    const p = this.pending;
    this.pending = null;
    if (!p || !choice) return;
    let next = addAlias(this.tabs, p.to, p.alias);
    if (choice !== 'extra') next = removeAlias(next, choice.drop, p.alias.path);
    this.tabs = next;
    this.save();
  }

  removeAlias(tabId: string, path: string) {
    this.tabs = removeAlias(this.tabs, tabId, path);
    this.save();
  }

  /** Reorder within a tab. */
  place(tabId: string, alias: Alias, index: number) {
    this.tabs = addAlias(this.tabs, tabId, alias, index);
    this.save();
  }
}

export const launcher = new Launcher();
