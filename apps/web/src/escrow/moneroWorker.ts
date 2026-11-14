/**
 * monero-ts runs its wallets in a worker of its own (`monero.worker.js`), which it loads from
 * "/monero.worker.js" by default: a file the app's build never had, so in a real browser every
 * escrow wallet failed to start ("Escrow setup stopped"). Found by the demo's two-device browser
 * run (2026-11-08). The escrow worker installs a loader that lets Vite bundle monero-ts's own worker
 * file as a same-origin asset (CSP `worker-src 'self'`), before any wallet is made.
 */
import { LibraryUtils } from 'monero-ts';

export type WorkerFactory = () => Worker;

/** Vite turns this exact `new Worker(new URL(..., import.meta.url))` into a bundled asset URL. */
export const makeMoneroWorker: WorkerFactory = () => new Worker(new URL('monero-ts/dist/monero.worker.js', import.meta.url));

export function installMoneroWorker(setLoader: (f: WorkerFactory) => void = (f) => LibraryUtils.setWorkerLoader(f), make: WorkerFactory = makeMoneroWorker): void {
  setLoader(make);
}
