// The escrow worker gives monero-ts a loader for its own worker file, bundled with the app, instead
// of monero-ts's default "/monero.worker.js" that no build ever served (the demo's browser run).
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { installMoneroWorker, makeMoneroWorker } from '../src/escrow/moneroWorker.js';

it('installs the bundled worker factory as monero-ts loader', () => {
  const setLoader = vi.fn();
  installMoneroWorker(setLoader);
  expect(setLoader).toHaveBeenCalledWith(makeMoneroWorker);
});

it('the factory names monero-ts own worker file in the form Vite bundles, and worker.ts installs it first', () => {
  const src = readFileSync(new URL('../src/escrow/moneroWorker.ts', import.meta.url), 'utf8');
  expect(src).toContain("new Worker(new URL('monero-ts/dist/monero.worker.js', import.meta.url))");
  const worker = readFileSync(new URL('../src/escrow/worker.ts', import.meta.url), 'utf8');
  expect(worker.indexOf('installMoneroWorker();')).toBeGreaterThan(-1);
  expect(worker.indexOf('installMoneroWorker();')).toBeLessThan(worker.indexOf('serveEscrow(globalThis'));
});
