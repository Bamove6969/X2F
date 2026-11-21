// Gap 1 (the regtest e2e; the demo's browser run, 8 Nov, f7a28d2a on wip/lead-demo-r4): the escrow
// worker points monero-ts at its own prebuilt wallet worker, copied unchanged into the build at
// /monero/monero.worker.js (tools/copy-monero-worker.ts), before any wallet is made. monero-ts's
// default, "/monero.worker.js", was a file no build ever served.
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { MONERO_WORKER_URL, installMoneroWorker } from '../src/escrow/moneroWorker.js';

it('gives monero-ts the served worker path', () => {
  expect(MONERO_WORKER_URL).toBe('/monero/monero.worker.js');
  const setPath = vi.fn();
  installMoneroWorker(setPath);
  expect(setPath).toHaveBeenCalledWith('/monero/monero.worker.js');
});

it('the default installs it on monero-ts itself', async () => {
  const { LibraryUtils } = await import('monero-ts');
  const before = LibraryUtils.WORKER_DIST_PATH;
  try {
    installMoneroWorker();
    expect(LibraryUtils.WORKER_DIST_PATH).toBe('/monero/monero.worker.js');
  } finally {
    LibraryUtils.setWorkerDistPath(before);
  }
});

it('worker.ts installs it before the escrow runtime can make a wallet', () => {
  const worker = readFileSync(new URL('../src/escrow/worker.ts', import.meta.url), 'utf8');
  expect(worker.indexOf('installMoneroWorker();')).toBeGreaterThan(-1);
  expect(worker.indexOf('installMoneroWorker();')).toBeLessThan(worker.indexOf('serveEscrow(globalThis'));
});
