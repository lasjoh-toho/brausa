/**
 * Updates: brausa asks GitHub for a newer release shortly after starting
 * (can be switched off) and installs it on request. Releases are signed; the
 * app only accepts updates signed with brausa's key.
 */
import { store } from '../platform';
import { app } from './app.svelte';
import { t } from '../i18n/index.svelte';

const RELEASES = 'https://github.com/lasjoh-toho/brausa/releases/latest';

type Update = { version: string; body?: string; downloadAndInstall: (cb?: (e: { event: string; data?: { contentLength?: number; chunkLength?: number } }) => void) => Promise<void> };

class Updates {
  auto = $state(store.get('autoUpdate', true));
  checking = $state(false);
  /** Download progress 0…1 while installing, else null. */
  progress = $state<number | null>(null);
  available = $state<Update | null>(null);
  version = $state('');

  constructor() {
    void import('@tauri-apps/api/app')
      .then((m) => m.getVersion())
      .then((v) => (this.version = v))
      .catch(() => {});
  }

  setAuto(v: boolean) {
    this.auto = v;
    store.set('autoUpdate', v);
  }

  /** On start: quietly, only when allowed and only in the app. */
  startup() {
    if (!this.auto || app.backend.name === 'demo') return;
    setTimeout(() => void this.check(true), 8000);
  }

  async check(quiet = false) {
    if (this.checking) return;
    if (app.backend.name === 'demo') return void window.open(RELEASES, '_blank');
    this.checking = true;
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const u = (await check()) as Update | null;
      this.available = u;
      if (u) app.toast(t('updates.available', { version: u.version }), false, () => this.install(), { action: t('updates.install'), ms: 30000 });
      else if (!quiet) app.toast(t('updates.current', { version: this.version }));
    } catch (e) {
      // No update information yet, offline, or GitHub not reachable: only say so when asked.
      if (!quiet) app.toast(t('updates.failed', { error: String(e).replace(/^Error: /, '') }), true);
    } finally {
      this.checking = false;
    }
  }

  async install() {
    const u = this.available;
    if (!u) return;
    let total = 0;
    let done = 0;
    this.progress = 0;
    try {
      await u.downloadAndInstall((e) => {
        if (e.event === 'Started') total = e.data?.contentLength ?? 0;
        else if (e.event === 'Progress') {
          done += e.data?.chunkLength ?? 0;
          this.progress = total ? done / total : null;
        }
      });
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (e) {
      this.progress = null;
      // E.g. installed from a .deb package: that one is updated by downloading the new package.
      app.toast(t('updates.installFailed', { error: String(e).replace(/^Error: /, '') }), true, async () => void window.open(RELEASES, '_blank'), { action: t('updates.download'), ms: 15000 });
    }
  }
}

export const updates = new Updates();
