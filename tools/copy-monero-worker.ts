// Gap 1 (the regtest e2e; the demo's browser run, 8 Nov): monero-ts runs every wallet in its own
// prebuilt worker, dist/monero.worker.js, which no build served, so no escrow wallet could start in
// a real browser. This copies that file, unchanged, from the pinned monero-ts (0.11.16, pinned in
// packages/escrow/package.json) into apps/web/public/monero/ (git-ignored, rebuilt) and checks it
// against tools/monero-worker.sha256, computed from the npm tarball itself. It is never re-bundled:
// the served bytes are monero-ts's own. The API serves it with its own CSP (apps/api/src/static/
// serve.ts `moneroWorkerCspFor`), and the escrow worker points monero-ts at it
// (apps/web/src/escrow/moneroWorker.ts).
//
// Every vite build runs this (apps/web/vite.config.ts `moneroWorker`); a file that differs fails the
// build. Run by hand from the repo root: npx tsx tools/copy-monero-worker.ts [--check]
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyPinned, readPinnedManifest, verifyPinned, type PinnedSet } from './pinned-assets.js';

const REPO = fileURLToPath(new URL('..', import.meta.url));
export const MONERO_MANIFEST = join(REPO, 'tools', 'monero-worker.sha256');
export const MONERO_OUT_DIR = join(REPO, 'apps', 'web', 'public', 'monero');

export const MONERO_WORKER_ASSETS: ReadonlyArray<{ from: string; to: string }> = [
  { from: 'monero-ts/dist/monero.worker.js', to: 'monero.worker.js' },
];

const SET: PinnedSet = { label: 'monero-worker', manifest: MONERO_MANIFEST, assets: MONERO_WORKER_ASSETS };

export function readMoneroManifest(): Promise<Map<string, string>> {
  return readPinnedManifest(SET);
}

/** Throws unless `outDir` holds exactly monero.worker.js, with the pinned SHA-256. */
export function verifyMoneroWorker(outDir = MONERO_OUT_DIR): Promise<void> {
  return verifyPinned(SET, outDir);
}

export function copyMoneroWorker(o: { nodeModules?: string; outDir?: string } = {}): Promise<void> {
  return copyPinned(SET, { nodeModules: o.nodeModules ?? join(REPO, 'node_modules'), outDir: o.outDir ?? MONERO_OUT_DIR });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) await verifyMoneroWorker();
  else await copyMoneroWorker();
}
