import { LibraryUtils } from 'monero-ts';

/**
 * Where monero-ts loads its own prebuilt wallet worker from, in a browser. Its default,
 * "/monero.worker.js", is a file the web app does not serve; the app serves the pinned file,
 * unchanged, at its own path (Gap 1, tools/copy-monero-worker.ts). Must be set before the first
 * wallet is made: monero-ts makes the worker once and shares it.
 */
export function setMoneroWorkerPath(path: string): void {
  LibraryUtils.setWorkerDistPath(path);
}
