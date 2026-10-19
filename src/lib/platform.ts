/** Platform conventions in one place so components never sniff the OS themselves. */

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
export const isMac = /Mac|iPhone|iPad/.test(ua);
export const isWindows = /Windows/.test(ua);

/** Cmd on macOS, Ctrl elsewhere: toggles items in a selection. */
export function isToggleKey(e: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return isMac ? e.metaKey : e.ctrlKey;
}

/** Option on macOS, Ctrl on Windows/Linux: copy instead of move while dragging. */
export function isCopyKey(e: { altKey: boolean; ctrlKey: boolean }): boolean {
  return isMac ? e.altKey : e.ctrlKey;
}

/** German keyboards say Strg, others Ctrl; read once at start (see i18n, which this file must not import). */
function ctrlName(): string {
  let choice = 'system';
  try {
    choice = JSON.parse(localStorage.getItem('brausa:lang') ?? '"system"');
  } catch {
    /* default */
  }
  const lang = choice === 'system' && typeof navigator !== 'undefined' ? (navigator.language ?? '') : choice;
  return lang.toLowerCase().startsWith('de') ? 'Strg' : 'Ctrl';
}

export const modLabel = isMac ? '⌘' : ctrlName();
export const copyLabel = isMac ? '⌥' : ctrlName();

/** localStorage that never throws (private windows, blocked storage). */
export const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem('brausa:' + key);
      return v === null ? fallback : (JSON.parse(v) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem('brausa:' + key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  }
};
