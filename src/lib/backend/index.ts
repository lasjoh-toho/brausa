import type { Backend } from './types';
import { DemoBackend } from './demo';
import { TauriBackend } from './tauri';

export type { Backend } from './types';

/** Tauri injects `__TAURI_INTERNALS__`; anywhere else (plain browser) we fall back to the demo. */
export function createBackend(): Backend {
  const forceDemo = new URLSearchParams(location.search).has('demo');
  const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  return inTauri && !forceDemo ? new TauriBackend() : new DemoBackend();
}
