import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { copyMoneroWorker } from '../../tools/copy-monero-worker.js';
import { copyOcrAssets } from '../../tools/copy-ocr-assets.js';
import { moneroGlue } from './vite-monero-glue.js';

const empty = fileURLToPath(new URL('./src/empty.ts', import.meta.url));
const assertShim = fileURLToPath(new URL('./src/assertShim.ts', import.meta.url));

/**
 * Plan 5 Task 13: every build (and the dev server) first copies the self-hosted OCR files into
 * public/ocr/ and checks them against tools/ocr-assets.sha256; a file that differs fails the build.
 */
function ocrAssets(): Plugin {
  return { name: 'x2f-ocr-assets', buildStart: () => copyOcrAssets() };
}

/**
 * Gap 1: every build (and the dev server) first copies monero-ts's own prebuilt wallet worker into
 * public/monero/, unchanged, and checks it against tools/monero-worker.sha256; a file that differs
 * fails the build. Served at /monero/monero.worker.js (src/escrow/moneroWorker.ts).
 */
function moneroWorker(): Plugin {
  return { name: 'x2f-monero-worker', buildStart: () => copyMoneroWorker() };
}

/** tesseract.js's browser defaults, whose `workerPath` is a jsdelivr URL. */
const TESSERACT_DEFAULTS = /[\\/]tesseract\.js[\\/]src[\\/]worker[\\/]browser[\\/]defaultOptions\.js$/;
/** tesseract.js's browser `spawnWorker`, which can build a blob: worker. */
const TESSERACT_SPAWN = /[\\/]tesseract\.js[\\/]src[\\/]worker[\\/]browser[\\/]spawnWorker\.js$/;

/**
 * Plan 5 Task 13: replaces tesseract.js's browser defaults so no CDN URL reaches the bundle: the
 * defaults themselves point at this origin's /ocr/ and never use a blob: worker. proof/ocr.ts passes
 * the same paths explicitly; the worker CSP on /ocr/* is the backstop.
 */
function tesseractNoCdn(): Plugin {
  return {
    name: 'x2f-tesseract-no-cdn',
    enforce: 'pre',
    load(id) {
      const path = id.split('?', 1)[0] ?? '';
      if (TESSERACT_SPAWN.test(path)) {
        // Never a blob: worker, and the raw Worker goes to proof/ocr.ts's `onSpawn`, so a load that
        // hangs or fails can still be terminated (review m-2). Only named fields of the options are
        // ever posted to the worker, so the function never has to be cloned.
        return [
          "'use strict';",
          'module.exports = ({ workerPath, onSpawn }) => {',
          '  const worker = new Worker(workerPath);',
          "  if (typeof onSpawn === 'function') onSpawn(worker);",
          '  return worker;',
          '};',
        ].join('\n');
      }
      if (!TESSERACT_DEFAULTS.test(path)) return null;
      return [
        "'use strict';",
        "const defaultOptions = require('../../constants/defaultOptions');",
        "module.exports = { ...defaultOptions, workerPath: '/ocr/worker.min.js', workerBlobURL: false };",
      ].join('\n');
    },
  };
}

/** The only build mode that may carry fixture mode (Playwright's board fixtures); see `fixturesOn`. */
export const FIXTURES_BUILD_MODE = 'fixtures';
/** Where a fixtures-mode build goes, so it can never overwrite (or be deployed as) the production `dist`. */
export const FIXTURES_OUT_DIR = 'dist-fixtures';

/**
 * Fixture mode needs VITE_FIXTURES=1 and either the dev server (`vite`, not in production mode) or
 * `vite build --mode fixtures`. Every other build (production, staging, anything else) leaves it out.
 */
export function fixturesOn(command: 'build' | 'serve', mode: string, flag: string | undefined): boolean {
  if (flag !== '1') return false;
  return command === 'serve' ? mode !== 'production' : mode === FIXTURES_BUILD_MODE;
}

export default defineConfig(({ command, mode }) => {
  const env = { ...loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_'), ...process.env };
  const fixtures = fixturesOn(command, mode, env.VITE_FIXTURES);
  return {
    plugins: [react(), moneroGlue(), moneroWorker(), ocrAssets(), tesseractNoCdn()],
    // The escrow worker (where the wallets run) is bundled with its own plugin list.
    worker: { plugins: () => [moneroGlue()] },
    resolve: {
      // monero-ts pulls in Node's net and tls; the browser build gets an empty module (research §3, P3-M8).
      // and Node's `assert`, which monero-ts calls for its own checks: a working stand-in (src/assertShim.ts).
      alias: [
        { find: /^(node:)?(net|tls)$/, replacement: empty },
        { find: /^(node:)?assert$/, replacement: assertShim },
      ],
    },
    define: { __X2F_FIXTURES__: JSON.stringify(fixtures) },
    build: {
      outDir: mode === FIXTURES_BUILD_MODE ? FIXTURES_OUT_DIR : 'dist',
      // font-src and img-src allow 'self' only for fonts: never inline assets as data: URIs.
      assetsInlineLimit: 0,
      sourcemap: false,
    },
  };
});
