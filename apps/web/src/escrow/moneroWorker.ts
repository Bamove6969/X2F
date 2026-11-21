/**
 * Gap 1 (the regtest e2e; first found by the demo's two-device browser run, 8 Nov, f7a28d2a): monero-ts
 * runs every wallet in its own worker, which it loads from "/monero.worker.js" by default, a file no
 * build served, so in a real browser every escrow wallet failed to start ("Escrow setup stopped").
 *
 * The build copies monero-ts's own prebuilt worker, byte for byte the pinned 0.11.16 file (checked
 * against tools/monero-worker.sha256, never re-bundled), to /monero/monero.worker.js, and the API
 * serves it with its own CSP (apps/api/src/static/serve.ts `moneroWorkerCspFor`). The escrow worker
 * points monero-ts at it before any wallet is made.
 */
import { setMoneroWorkerPath } from '@x2f/escrow';

/** Same origin, under the page's `worker-src 'self'`. Kept equal to serve.ts `MONERO_WORKER_PATH`. */
export const MONERO_WORKER_URL = '/monero/monero.worker.js';

export function installMoneroWorker(setPath: (path: string) => void = setMoneroWorkerPath): void {
  setPath(MONERO_WORKER_URL);
}
