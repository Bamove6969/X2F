import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { connect, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ASSET_SCRIPT_CSP, ESCROW_WORKER_FILE, MONERO_WORKER_PATH, SERVICE_WORKER_CSP, cspFor, escrowWorkerCspFor, moneroWorkerCspFor, ocrWorkerCspFor, serveWeb, webOptionsFromEnv } from '../src/static/serve.js';
import { testApp } from './helpers/app.js';

const RELAY = 'wss://relay.x2f.test';
const NODE = 'https://node.x2f.test';
const SITE = 'https://x2f.test';
/**
 * Lead call 20 Nov and review M-1: the OCR worker may load scripts and fetch only under this site's
 * /ocr/, and may start no worker of its own.
 */
const OCR_CSP = "default-src 'none'; script-src https://x2f.test/ocr/ 'wasm-unsafe-eval'; connect-src https://x2f.test/ocr/; worker-src 'none'";
const CSP =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; " +
  `connect-src 'self' ${RELAY} ${NODE}; img-src 'self' data:; style-src 'self'; font-src 'self'; ` +
  "manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

let app: FastifyInstance;
let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'x2f-web-'));
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'index.html'), '<!doctype html><html><body><div id="root"></div></body></html>');
  await writeFile(join(root, 'assets', 'app-abc123.js'), 'console.log(1)');
  await writeFile(join(root, 'assets', 'app-abc123.mjs'), 'console.log(1)');
  await writeFile(join(root, 'assets', 'app-abc123.css'), 'body{}');
  await writeFile(join(root, 'sw.js'), "self.addEventListener('push', () => undefined);");
  // Plan 5 Task 13: the self-hosted OCR files (tools/copy-ocr-assets.ts copies the real ones).
  await mkdir(join(root, 'ocr'));
  await writeFile(join(root, 'ocr', 'worker.min.js'), 'self.onmessage = () => undefined;');
  await writeFile(join(root, 'ocr', 'tesseract-core-simd-lstm.wasm.js'), 'var TesseractCore;');
  await writeFile(join(root, 'ocr', 'eng.traineddata.gz'), Buffer.from([0x1f, 0x8b, 0x08, 0x00, 1, 2, 3]));
  await writeFile(join(root, 'assets', 'ocr-abc123.js'), 'console.log(2)');
  // monero-ts's own wallet worker (tools/copy-monero-worker.ts copies the real, pinned one).
  await mkdir(join(root, 'monero'));
  await writeFile(join(root, 'monero', 'monero.worker.js'), 'self.onmessage = () => undefined;');
  await writeFile(join(root, 'assets', 'monero-abc123.js'), 'console.log(3)');
  // The escrow worker, as apps/web/vite.config.ts names it (assets/escrow-worker-<8-char hash>.js).
  await writeFile(join(root, 'assets', 'escrow-worker-CzS2KofQ.js'), 'self.onmessage = () => undefined;');
  // Vite's default worker name, and near misses: never the escrow worker's CSP.
  await writeFile(join(root, 'assets', 'worker-CzS2KofQ.js'), 'console.log(4)');
  await writeFile(join(root, 'assets', 'escrow-worker-CzS2Ko.js'), 'console.log(5)');
  await writeFile(join(root, 'assets', 'x-escrow-worker-CzS2KofQ.js'), 'console.log(6)');
  // Re-review n-1: scripts outside /assets/, /ocr/, /monero/ and /sw.js (a future public/*.js), and
  // a file that is not a script there.
  await writeFile(join(root, 'escrow-worker-AAAAAAAA.js'), 'console.log(7)');
  await writeFile(join(root, 'other.mjs'), 'console.log(8)');
  await writeFile(join(root, 'UPPER.JS'), 'console.log(9)');
  await mkdir(join(root, 'js'));
  await writeFile(join(root, 'js', 'extra.js'), 'console.log(10)');
  await writeFile(join(root, 'notes.txt'), 'User-agent: *');
  ({ app } = await testApp());
  await serveWeb(app, { root, relayOrigin: RELAY, nodeProxyOrigin: NODE, siteOrigins: [SITE] });
});

afterAll(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
});

function expectBaseHeaders(h: Record<string, unknown>): void {
  expect(h['referrer-policy']).toBe('no-referrer');
  expect(h['cross-origin-opener-policy']).toBe('same-origin');
  expect(h['strict-transport-security']).toBe('max-age=63072000; includeSubDomains');
  expect(h['x-content-type-options']).toBe('nosniff');
}

describe('security headers', () => {
  it('an API route gets the headers and no CSP', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expectBaseHeaders(res.headers);
    expect(res.headers['content-security-policy']).toBeUndefined();
  });

  it('an API 404 and an API error get the headers too', async () => {
    const notFound = await app.inject({ method: 'GET', url: '/v1/nothing-here' });
    expect(notFound.statusCode).toBe(404);
    expect(notFound.json()).toEqual({ error: 'not-found' });
    expectBaseHeaders(notFound.headers);
    expect(notFound.headers['content-security-policy']).toBeUndefined();
    const refused = await app.inject({ method: 'POST', url: '/v1/logout', payload: {} });
    expect(refused.statusCode).toBe(403);
    expectBaseHeaders(refused.headers);
  });

  it.each(['/', '/index.html', '/sell', '/trade/ABCD-EFGH-JKMN-PQRS', '/setup/username'])(
    '%s serves index.html with the CSP',
    async (url) => {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/^text\/html/);
      expect(res.body).toContain('<div id="root">');
      expectBaseHeaders(res.headers);
      expect(res.headers['content-security-policy']).toBe(CSP);
      expect(res.headers['cache-control']).toBe('no-cache');
    },
  );

  it("a built script gets the headers, a deny-all CSP (review M-1: started as a worker, it may reach nothing) and a long cache", async () => {
    expect(ASSET_SCRIPT_CSP).toBe("default-src 'none'");
    for (const url of ['/assets/app-abc123.js', '/assets/app-abc123.mjs']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
      expectBaseHeaders(res.headers);
      expect(res.headers['content-security-policy'], url).toBe("default-src 'none'");
      expect(res.headers['cache-control'], url).toBe('public, max-age=31536000, immutable');
    }
  });

  it('re-review n-1: a script anywhere outside /assets/, /ocr/, /monero/ and /sw.js gets the deny-all CSP too', async () => {
    for (const url of ['/escrow-worker-AAAAAAAA.js', '/other.mjs', '/UPPER.JS', '/js/extra.js', '/js/%65xtra.js', '/other.mjs?x=1']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
      expectBaseHeaders(res.headers);
      expect(res.headers['content-security-policy'], url).toBe(ASSET_SCRIPT_CSP);
    }
    // A file there that is not a script keeps no CSP.
    const txt = await app.inject({ method: 'GET', url: '/notes.txt' });
    expect(txt.statusCode).toBe(200);
    expect(txt.headers['content-security-policy']).toBeUndefined();
  });

  it('a built asset that is not a script gets the headers, no CSP and a long cache', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/app-abc123.css' });
    expect(res.statusCode).toBe(200);
    expectBaseHeaders(res.headers);
    expect(res.headers['content-security-policy']).toBeUndefined();
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('the service worker is served from this origin at /sw.js, revalidated on every load (Task 19)', async () => {
    const res = await app.inject({ method: 'GET', url: '/sw.js' });
    expect(res.statusCode).toBe(200);
    expectBaseHeaders(res.headers);
    expect(String(res.headers['content-type'])).toMatch(/javascript/);
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('a missing file is a 404, not the app page', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/missing.js' });
    expect(res.statusCode).toBe(404);
    expectBaseHeaders(res.headers);
    expect(res.headers['content-security-policy']).toBeUndefined();
  });
});

describe('the OCR files (Plan 5 Task 13, Global Constraints: the worker\'s own CSP)', () => {
  it('the policy: scripts and fetches only under /ocr/ on each site origin, wasm allowed, no nested worker (lead call 20 Nov, review M-1)', () => {
    expect(ocrWorkerCspFor({ siteOrigins: [SITE] })).toBe(OCR_CSP);
    expect(ocrWorkerCspFor({ siteOrigins: [SITE, 'http://x2fexample.onion'] })).toBe(
      "default-src 'none'; script-src https://x2f.test/ocr/ http://x2fexample.onion/ocr/ 'wasm-unsafe-eval'; " +
        "connect-src https://x2f.test/ocr/ http://x2fexample.onion/ocr/; worker-src 'none'",
    );
    expect(ocrWorkerCspFor({ siteOrigins: [SITE] })).not.toContain("'self'");
  });

  it('refuses no site origin, a path, a non-http scheme, or anything that is not a plain exact origin (review m-1, m-4)', () => {
    for (const bad of [[], ['https://x2f.test/'], ['https://x2f.test/ocr'], ['wss://x2f.test'], ["https://x2f.test 'unsafe-inline'"], ['https://x2f.test;'], ['https://x2f.test;sandbox'], ['https://a.test,b'], ["https://a.test'x"], ['https://*.x2f.test']]) {
      expect(() => ocrWorkerCspFor({ siteOrigins: bad }), JSON.stringify(bad)).toThrow();
    }
    expect(ocrWorkerCspFor({ siteOrigins: ['http://127.0.0.1:4317'] })).toContain('connect-src http://127.0.0.1:4317/ocr/;');
  });

  it.each(['/ocr/worker.min.js', '/ocr/tesseract-core-simd-lstm.wasm.js', '/ocr/eng.traineddata.gz'])('%s carries the worker CSP', async (url) => {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    expectBaseHeaders(res.headers);
    expect(res.headers['content-security-policy']).toBe(OCR_CSP);
  });

  it('the model is served as gzip bytes, not as a gzip-encoded response (tesseract.js reads the magic itself)', async () => {
    const res = await app.inject({ method: 'GET', url: '/ocr/eng.traineddata.gz', headers: { 'accept-encoding': 'gzip, br' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/gzip');
    expect(res.headers['content-encoding']).toBeUndefined();
    expect([...res.rawPayload.subarray(0, 2)]).toEqual([0x1f, 0x8b]);
  });

  it('a missing OCR file is a 404, never the app page (so a missing model fails OCR, not parses HTML)', async () => {
    for (const url of ['/ocr/missing.gz', '/ocr/tesseract-core-relaxedsimd-lstm.wasm.js']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(404);
      expect(res.headers['content-type'], url).not.toMatch(/^text\/html/);
    }
  });

  // (app.inject normalises dot segments and backslashes before routing; those are tested on a raw socket below.)
  it.each(['/ocr/..%2Fv1%2Fme', '/ocr/%2fx', '/ocr/a%5Cb', '/ocr/%252e%252e/x', '/OCR/%2F'])(
    'review m-2: %s (an encoded slash or dot, a backslash) is 400 under /ocr/',
    async (url) => {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(400);
      expect(res.headers['content-type']).toMatch(/^application\/json/);
      expect(res.headers['content-security-policy']).toBeUndefined();
    },
  );

  it('review m-2: the real files and other paths with dots are unchanged', async () => {
    expect((await app.inject({ method: 'GET', url: '/ocr/worker.min.js' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/u/a%2Fb' })).statusCode).not.toBe(400);
  });

  it('review m-4: .gz is a file only under /ocr/: a profile named alice.gz is still the app page', async () => {
    for (const url of ['/u/alice.gz', '/u/backup.gz']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers['content-type'], url).toMatch(/^text\/html/);
    }
  });

  it('only the ocr folder gets it: a built asset named ocr-… gets the deny-all script CSP (review M-1)', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/ocr-abc123.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-security-policy']).toBe("default-src 'none'");
  });
});

describe("monero-ts's wallet worker (Gap 1: no escrow wallet could start in a browser)", () => {
  const MONERO_CSP = `default-src 'none'; script-src 'wasm-unsafe-eval'; connect-src ${NODE}`;

  it('is served at /monero/monero.worker.js, the path the escrow worker gives monero-ts', () => {
    expect(MONERO_WORKER_PATH).toBe('/monero/monero.worker.js');
  });

  it('its policy: compile its inline WebAssembly, reach the node proxy, nothing else (no scripts, no relay, not even this origin)', () => {
    expect(moneroWorkerCspFor({ relayOrigin: RELAY, nodeProxyOrigin: NODE })).toBe(MONERO_CSP);
    // The node proxy origin is checked exactly as for the page.
    expect(() => moneroWorkerCspFor({ relayOrigin: RELAY, nodeProxyOrigin: 'http://node.x2f.test' })).toThrow(/https or wss/);
    expect(() => moneroWorkerCspFor({ relayOrigin: RELAY, nodeProxyOrigin: 'https://node.x2f.test;sandbox' })).toThrow(/exact origin/);
  });

  it('is served as JavaScript with its own CSP, the base headers and revalidated on every load', async () => {
    const res = await app.inject({ method: 'GET', url: MONERO_WORKER_PATH });
    expect(res.statusCode).toBe(200);
    expectBaseHeaders(res.headers);
    expect(String(res.headers['content-type'])).toMatch(/^application\/javascript/);
    expect(res.headers['content-security-policy']).toBe(MONERO_CSP);
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('a missing monero file is a 404, never the app page', async () => {
    const res = await app.inject({ method: 'GET', url: '/monero/monero.worker.js.map' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-security-policy']).toBeUndefined();
  });

  it('only the monero folder gets it: a built asset named monero-… gets the deny-all script CSP (review M-1) and its long cache', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/monero-abc123.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-security-policy']).toBe("default-src 'none'");
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });
});

describe('every worker script carries its own CSP (lead call 20 Nov: a worker takes its CSP from its own response)', () => {
  const ESCROW_CSP =
    "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; " +
    `worker-src ${SITE}/monero/monero.worker.js; connect-src 'self' ${RELAY} ${NODE}`;

  it("the escrow worker's policy (multisig and chat keys): the API on this origin, the relay, the node proxy; only monero-ts's worker may be started", () => {
    expect(escrowWorkerCspFor({ siteOrigins: [SITE], relayOrigin: RELAY, nodeProxyOrigin: NODE })).toBe(ESCROW_CSP);
    expect(escrowWorkerCspFor({ siteOrigins: [SITE, 'http://x2fexample.onion'], relayOrigin: RELAY, nodeProxyOrigin: NODE })).toContain(
      `worker-src ${SITE}/monero/monero.worker.js http://x2fexample.onion/monero/monero.worker.js;`,
    );
  });

  it('the escrow worker file is exactly assets/escrow-worker-<8-character hash>.js (vite.config.ts names it so)', () => {
    expect(ESCROW_WORKER_FILE.test('/srv/web/assets/escrow-worker-CzS2KofQ.js')).toBe(true);
    for (const p of ['/srv/web/assets/worker-CzS2KofQ.js', '/srv/web/assets/escrow-worker-CzS2Ko.js', '/srv/web/assets/x-escrow-worker-CzS2KofQ.js', '/srv/web/escrow-worker-CzS2KofQ.js']) {
      expect(ESCROW_WORKER_FILE.test(p), p).toBe(false);
    }
  });

  it('the escrow worker is served with it, revalidated on every load with an ETag like the monero worker (review m-1: its policy follows X2F_ORIGINS, which its hash does not cover)', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/escrow-worker-CzS2KofQ.js' });
    expect(res.statusCode).toBe(200);
    expectBaseHeaders(res.headers);
    expect(String(res.headers['content-type'])).toMatch(/^application\/javascript/);
    expect(res.headers['content-security-policy']).toBe(ESCROW_CSP);
    expect(res.headers['cache-control']).toBe('no-cache');
    const etag = res.headers.etag;
    expect(typeof etag).toBe('string');
    const again = await app.inject({ method: 'GET', url: '/assets/escrow-worker-CzS2KofQ.js', headers: { 'if-none-match': String(etag) } });
    expect(again.statusCode).toBe(304);
  });

  it('only that file gets it: other scripts, near misses included, get the deny-all script CSP (review M-1: a renamed escrow worker fails closed)', async () => {
    for (const url of ['/assets/worker-CzS2KofQ.js', '/assets/escrow-worker-CzS2Ko.js', '/assets/x-escrow-worker-CzS2KofQ.js', '/assets/app-abc123.js']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers['content-security-policy'], url).toBe("default-src 'none'");
      expect(res.headers['cache-control'], url).toBe('public, max-age=31536000, immutable');
    }
  });

  it('review m-3: serveWeb refuses to start unless assets/ holds exactly one escrow worker', async () => {
    const opts = { relayOrigin: RELAY, nodeProxyOrigin: NODE, siteOrigins: [SITE] };
    const cases: Array<[string, string[]]> = [
      ['none (renamed)', ['escrow-worker-CzS2Ko.js', 'worker-CzS2KofQ.js', 'app-abc123.js']],
      ['two', ['escrow-worker-CzS2KofQ.js', 'escrow-worker-AbCdEfGh.js']],
    ];
    for (const [label, files] of cases) {
      const dir = await mkdtemp(join(tmpdir(), 'x2f-web-m3-'));
      const other = (await testApp()).app;
      try {
        await mkdir(join(dir, 'assets'));
        await writeFile(join(dir, 'index.html'), '<!doctype html>');
        for (const f of files) await writeFile(join(dir, 'assets', f), 'x');
        await expect(serveWeb(other, { root: dir, ...opts }), label).rejects.toThrow(/exactly one escrow worker.*found/);
      } finally {
        await other.close();
        await rm(dir, { recursive: true, force: true });
      }
    }
    // A root with no app page and no assets folder (nothing built, e.g. API-only use) still starts.
    const bare = await mkdtemp(join(tmpdir(), 'x2f-web-m3-'));
    const ok = (await testApp()).app;
    try {
      await writeFile(join(bare, 'robots.txt'), 'User-agent: *');
      await expect(serveWeb(ok, { root: bare, ...opts })).resolves.toBeUndefined();
    } finally {
      await ok.close();
      await rm(bare, { recursive: true, force: true });
    }
  });

  it('re-review n-1: serveWeb refuses to start when index.html exists but assets/ does not (a changed build.assetsDir cannot skip the check)', async () => {
    const opts = { relayOrigin: RELAY, nodeProxyOrigin: NODE, siteOrigins: [SITE] };
    const dir = await mkdtemp(join(tmpdir(), 'x2f-web-n1-'));
    const other = (await testApp()).app;
    try {
      await writeFile(join(dir, 'index.html'), '<!doctype html>');
      await mkdir(join(dir, 'static'));
      await writeFile(join(dir, 'static', 'escrow-worker-CzS2KofQ.js'), 'x');
      await expect(serveWeb(other, { root: dir, ...opts })).rejects.toThrow(/index\.html but no assets folder/);
    } finally {
      await other.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('re-review n-2: serveWeb refuses to start when assets/ cannot be read for any reason but ENOENT (here: it is a file)', async () => {
    const opts = { relayOrigin: RELAY, nodeProxyOrigin: NODE, siteOrigins: [SITE] };
    for (const withPage of [true, false]) {
      const dir = await mkdtemp(join(tmpdir(), 'x2f-web-n2-'));
      const other = (await testApp()).app;
      try {
        if (withPage) await writeFile(join(dir, 'index.html'), '<!doctype html>');
        await writeFile(join(dir, 'assets'), 'not a folder');
        await expect(serveWeb(other, { root: dir, ...opts }), `index.html: ${withPage}`).rejects.toThrow(/ENOTDIR/);
      } finally {
        await other.close();
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  it('the service worker (push only, no request) may do nothing that CSP governs', async () => {
    expect(SERVICE_WORKER_CSP).toBe("default-src 'none'");
    const res = await app.inject({ method: 'GET', url: '/sw.js' });
    expect(res.headers['content-security-policy']).toBe("default-src 'none'");
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it("the OCR worker's and monero-ts's worker's policies stay as pinned above", async () => {
    expect((await app.inject({ method: 'GET', url: '/ocr/worker.min.js' })).headers['content-security-policy']).toBe(OCR_CSP);
    expect((await app.inject({ method: 'GET', url: MONERO_WORKER_PATH })).headers['content-security-policy']).toBe(
      `default-src 'none'; script-src 'wasm-unsafe-eval'; connect-src ${NODE}`,
    );
  });

  it('site origins pass the same checks as X2F_ORIGINS in config.ts (origins.ts plainOrigin and clearTextAllowed)', () => {
    const o = { relayOrigin: RELAY, nodeProxyOrigin: NODE };
    for (const bad of [[], ['https://x2f.test/'], ['https://x2f.test/app'], ['wss://x2f.test'], ['http://x2f.test'], ['https://x2f.test', '*'], ['https://x2f.test;sandbox'], ["https://x2f.test 'unsafe-inline'"]]) {
      expect(() => escrowWorkerCspFor({ ...o, siteOrigins: bad }), JSON.stringify(bad)).toThrow(/site origin/);
    }
    expect(escrowWorkerCspFor({ ...o, siteOrigins: ['http://127.0.0.1:4317'] })).toContain('worker-src http://127.0.0.1:4317/monero/monero.worker.js;');
    expect(escrowWorkerCspFor({ ...o, siteOrigins: ['http://x2f.test'], allowInsecureOrigins: true })).toContain('worker-src http://x2f.test/monero/monero.worker.js;');
    // A clear-text .onion relay is still refused (lead default, owner question).
    expect(() => escrowWorkerCspFor({ siteOrigins: [SITE], relayOrigin: 'ws://x2fexample.onion', nodeProxyOrigin: NODE })).toThrow(/https or wss/);
  });
});

describe('the file rule in the web catch-all', () => {
  it.each(['/u/mira.k', '/trade/ABCD.EFGH', '/u/a.b.c', '/sell/zelle.us', '/u/mira.k?tab=trades', '/v1x.k'])(
    'the app route %s (a dot in its last segment) is the app page',
    async (url) => {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('<div id="root">');
      expect(res.headers['content-security-policy']).toBe(CSP);
    },
  );

  it.each([
    '/assets/missing.css',
    '/assets/missing.mjs',
    '/assets/font.woff2',
    '/assets/font.woff',
    '/assets/app.js.map',
    '/assets/escrow.wasm',
    '/ASSETS/MISSING.JS',
    '/assets/missing.js?v=1',
    '/favicon.ico',
    '/icon.svg',
    '/icon.png',
    '/manifest.webmanifest',
    '/robots.txt',
    '/data.json',
  ])('the missing file %s is a 404, not the app page', async (url) => {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not-found' });
    expect(res.headers['content-security-policy']).toBeUndefined();
  });
});

describe('requests fastify refuses before routing', () => {
  it.each(['/%zz', '/v1/%zz', '/sell/%E0%A4%A'])('a malformed URL %s gets 400 bad-request with the headers, without echoing the path', async (url) => {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad-request' });
    expect(res.body).not.toContain('%');
    expectBaseHeaders(res.headers);
    expect(res.headers['content-security-policy']).toBeUndefined();
  });

  it('a non-GET unknown route reaches the root not-found handler, with the headers', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/nothing-here', headers: { origin: 'https://x2f.test' }, payload: {} });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not-found' });
    expectBaseHeaders(res.headers);
    expect(res.headers['content-security-policy']).toBeUndefined();
  });
});

/** Sends raw bytes and returns everything the server writes before it closes the socket. */
function rawExchange(port: number, request: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port });
    const chunks: Buffer[] = [];
    socket.on('data', (c: Buffer) => chunks.push(c));
    socket.on('error', (e: NodeJS.ErrnoException) => (e.code === 'ECONNRESET' || e.code === 'EPIPE' ? undefined : reject(e)));
    socket.on('close', () => resolve(Buffer.concat(chunks).toString('latin1')));
    socket.setTimeout(10_000, () => socket.destroy(new Error('no reply')));
    socket.end(request);
  });
}

function parseRaw(raw: string): { status: number; headers: Record<string, string>; body: string } {
  const [head = '', body = ''] = raw.split('\r\n\r\n', 2);
  const [statusLine = '', ...lines] = head.split('\r\n');
  const headers: Record<string, string> = {};
  for (const line of lines) {
    const i = line.indexOf(':');
    headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return { status: Number(statusLine.split(' ')[1]), headers, body };
}

describe('malformed HTTP that never reaches fastify routing (clientErrorHandler)', () => {
  let live: FastifyInstance;
  let port: number;

  beforeAll(async () => {
    ({ app: live } = await testApp());
    await serveWeb(live, { root, relayOrigin: RELAY, nodeProxyOrigin: NODE, siteOrigins: [SITE] });
    await live.listen({ host: '127.0.0.1', port: 0 });
    port = (live.server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await live.close();
  });

  it.each(['/ocr/../v1/me', '/ocr/x/../../v1/me', '/ocr/..', '/ocr/a\\..\\b', '/ocr/%2e%2e/v1/me', '/ocr/.%2E/v1/me', '/ocr/a\\b', '/ocr/..%2Fv1%2Fme', '/%6Fcr/..%2Fv1%2Fme', '/%4F%43%52/..%2Fv1', '/%ZZ/x', '/%E0%A4/x'])('review m-2, n-1: the raw path %s (not normalised by the client; the first segment decoded once) is 400', async (path) => {
    const res = parseRaw(await rawExchange(port, `GET ${path} HTTP/1.1\r\nHost: x2f.test\r\nConnection: close\r\n\r\n`));
    expect(res.status, path).toBe(400);
    expectBaseHeaders(res.headers);
  });

  it('a well-formed raw request is answered normally (the harness works)', async () => {
    const res = parseRaw(await rawExchange(port, 'GET /healthz HTTP/1.1\r\nHost: x2f.test\r\nConnection: close\r\n\r\n'));
    expect(res.status).toBe(200);
    expectBaseHeaders(res.headers);
  });

  it.each([
    ['a bad request line', 'NOT AN HTTP REQUEST\r\n\r\n'],
    ['a bad header line', 'GET /sell HTTP/1.1\r\nHost: x2f.test\r\nno colon here\r\n\r\n'],
    ['a bad HTTP version', 'GET /sell HTTP/9.9.9\r\nHost: x2f.test\r\n\r\n'],
  ])('%s gets 400 bad-request with the security headers', async (_name, request) => {
    const res = parseRaw(await rawExchange(port, request));
    expect(res.status).toBe(400);
    expectBaseHeaders(res.headers);
    expect(res.headers['content-security-policy']).toBeUndefined();
    expect(res.headers['content-type']).toBe('application/json');
    expect(res.headers.connection).toBe('close');
    expect(JSON.parse(res.body)).toEqual({ error: 'bad-request' });
  });

  it('oversized headers get 431 headers-too-large with the security headers', async () => {
    const big = 'x'.repeat(64 * 1024);
    const res = parseRaw(await rawExchange(port, `GET /sell HTTP/1.1\r\nHost: x2f.test\r\nX-Big: ${big}\r\n\r\n`));
    expect(res.status).toBe(431);
    expectBaseHeaders(res.headers);
    expect(res.headers['content-security-policy']).toBeUndefined();
    expect(JSON.parse(res.body)).toEqual({ error: 'headers-too-large' });
  });
});

describe('the /v1 check in the web catch-all', () => {
  it.each(['/V1/x', '/v1%2fx', '/%761/x', '/V1'])('%s is a JSON 404, never the app page', async (url) => {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not-found' });
    expect(res.headers['content-security-policy']).toBeUndefined();
  });

  it.each(['//v1/x', '///v1', '/v1.', '/v1./x', '/v1%2e/x', '/v1%20', '//V1//x', '/v1..'])(
    '%s behaves like /v1/x: a JSON 404, never the app page',
    async (url) => {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not-found' });
      expect(res.headers['content-security-policy']).toBeUndefined();
    },
  );

  it('a mix of trailing dots and spaces still behaves like /v1/x', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1%20.%20.%09/x' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not-found' });
  });

  it('a long crafted first segment of dots and spaces is judged in linear time', async () => {
    // '. . . … .x': a trailing-[.\s]+ regex tries every start and backtracks, quadratic in length.
    const url = `/.${'%20.'.repeat(50_000)}x`;
    const started = performance.now();
    const res = await app.inject({ method: 'GET', url });
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-security-policy']).toBe(CSP);
  });

  it('a path that only starts with the letters v1 is still the app page', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1x' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-security-policy']).toBe(CSP);
  });
});

describe('cspFor', () => {
  it('builds the Global Constraints policy', () => {
    expect(cspFor({ relayOrigin: RELAY, nodeProxyOrigin: NODE })).toBe(CSP);
  });

  it('review m-1: exactly 11 directives, one policy (no comma)', () => {
    const csp = cspFor({ relayOrigin: RELAY, nodeProxyOrigin: NODE });
    expect(csp.split('; ')).toHaveLength(11);
    expect(csp.split(';')).toHaveLength(11);
    expect(csp).not.toContain(',');
  });

  it.each(['wss://r.x2f.test;report-uri', 'wss://r.x2f.test;sandbox', 'wss://r.x2f.test,b', "wss://r.x2f.test'x", 'wss://*.x2f.test'])(
    'review m-1: refuses %j, which URL takes as an origin, for both connect origins',
    (bad) => {
      expect(new URL(bad).origin === bad || bad.includes('*')).toBe(true);
      expect(() => cspFor({ relayOrigin: bad, nodeProxyOrigin: NODE })).toThrow(/origin/);
      const node = bad.replace('wss:', 'https:');
      expect(() => cspFor({ relayOrigin: RELAY, nodeProxyOrigin: node })).toThrow(/origin/);
    },
  );

  it.each(['wss://relay.x2f.test/', 'wss://relay.x2f.test; script-src *', 'relay.x2f.test', 'ftp://relay.x2f.test', ''])(
    'refuses %j as an origin',
    (bad) => {
      expect(() => cspFor({ relayOrigin: bad, nodeProxyOrigin: NODE })).toThrow(/origin/);
      expect(() => cspFor({ relayOrigin: RELAY, nodeProxyOrigin: bad })).toThrow(/origin/);
    },
  );
});

describe('cspFor in production', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(['http://relay.x2f.test', 'ws://relay.x2f.test'])('refuses the clear-text origin %s', (bad) => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => cspFor({ relayOrigin: bad, nodeProxyOrigin: NODE })).toThrow(/https or wss/);
    expect(() => cspFor({ relayOrigin: RELAY, nodeProxyOrigin: bad })).toThrow(/https or wss/);
  });

  it('accepts https and wss origins', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(cspFor({ relayOrigin: RELAY, nodeProxyOrigin: NODE })).toBe(CSP);
  });

  it('outside production a local http or ws origin is allowed', () => {
    vi.stubEnv('NODE_ENV', 'test');
    expect(cspFor({ relayOrigin: 'ws://127.0.0.1:8090', nodeProxyOrigin: 'http://127.0.0.1:8091' })).toContain(
      "connect-src 'self' ws://127.0.0.1:8090 http://127.0.0.1:8091;",
    );
  });
});

describe('clear-text connect origins are decided by host, not NODE_ENV', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const base = { X2F_WEB_ROOT: '/srv/web', X2F_RELAY_ORIGIN: RELAY, X2F_NODE_PROXY_ORIGIN: NODE, X2F_ORIGINS: SITE };

  it.each([
    ['X2F_RELAY_ORIGIN', 'ws://relay.x2f.test'],
    ['X2F_RELAY_ORIGIN', 'http://relay.x2f.test'],
    ['X2F_NODE_PROXY_ORIGIN', 'http://node.x2f.test'],
    ['X2F_NODE_PROXY_ORIGIN', 'ws://10.0.0.5:8091'],
    ['X2F_RELAY_ORIGIN', 'ws://127.0.0.2:8090'],
    ['X2F_RELAY_ORIGIN', 'ws://localhost.evil.test'],
  ])('with NODE_ENV unset, %s=%s (not loopback) is refused', (name, value) => {
    vi.stubEnv('NODE_ENV', undefined);
    expect(process.env.NODE_ENV).toBeUndefined();
    expect(() => webOptionsFromEnv({ ...base, [name]: value })).toThrow(/https or wss/);
  });

  it.each(['ws://127.0.0.1:8090', 'ws://[::1]:8090', 'ws://localhost:8090', 'http://127.0.0.1', 'http://localhost'])(
    'with NODE_ENV unset, the loopback origin %s is allowed',
    (value) => {
      vi.stubEnv('NODE_ENV', undefined);
      expect(webOptionsFromEnv({ ...base, X2F_RELAY_ORIGIN: value, X2F_NODE_PROXY_ORIGIN: value })).toEqual({
        root: '/srv/web',
        relayOrigin: value,
        nodeProxyOrigin: value,
        siteOrigins: [SITE],
      });
    },
  );

  it('X2F_ALLOW_INSECURE_ORIGINS=1 allows a remote clear-text origin, deliberately', () => {
    vi.stubEnv('NODE_ENV', undefined);
    const env = { ...base, X2F_RELAY_ORIGIN: 'ws://relay.x2f.test', X2F_NODE_PROXY_ORIGIN: 'http://node.x2f.test' };
    expect(() => webOptionsFromEnv(env)).toThrow(/https or wss/);
    expect(() => webOptionsFromEnv({ ...env, X2F_ALLOW_INSECURE_ORIGINS: 'true' })).toThrow(/https or wss/);
    expect(webOptionsFromEnv({ ...env, X2F_ALLOW_INSECURE_ORIGINS: '1' })).toEqual({
      root: '/srv/web',
      relayOrigin: 'ws://relay.x2f.test',
      nodeProxyOrigin: 'http://node.x2f.test',
      siteOrigins: [SITE],
      allowInsecureOrigins: true,
    });
  });

  it('cspFor refuses a remote clear-text origin outside production too, unless allowed', () => {
    vi.stubEnv('NODE_ENV', 'test');
    expect(() => cspFor({ relayOrigin: 'ws://relay.x2f.test', nodeProxyOrigin: NODE })).toThrow(/https or wss/);
    expect(cspFor({ relayOrigin: 'ws://relay.x2f.test', nodeProxyOrigin: NODE, allowInsecureOrigins: true })).toContain(
      "connect-src 'self' ws://relay.x2f.test https://node.x2f.test;",
    );
  });

  it('serveWeb refuses a remote clear-text origin', async () => {
    const { app: other } = await testApp();
    try {
      await expect(serveWeb(other, { root, relayOrigin: 'ws://relay.x2f.test', nodeProxyOrigin: NODE, siteOrigins: [SITE] })).rejects.toThrow(/https or wss/);
    } finally {
      await other.close();
    }
  });
});

describe('webOptionsFromEnv', () => {
  it.each(['X2F_RELAY_ORIGIN', 'X2F_NODE_PROXY_ORIGIN'])("review m-1: %s with ';', ',' or a quote is refused", (name) => {
    const base = { X2F_WEB_ROOT: '/srv/web', X2F_RELAY_ORIGIN: RELAY, X2F_NODE_PROXY_ORIGIN: NODE, X2F_ORIGINS: SITE };
    const scheme = name === 'X2F_RELAY_ORIGIN' ? 'wss' : 'https';
    for (const v of [`${scheme}://a.x2f.test;sandbox`, `${scheme}://a.x2f.test,b`, `${scheme}://a.x2f.test'x`]) {
      expect(() => webOptionsFromEnv({ ...base, [name]: v }), v).toThrow(/origin/);
    }
  });

  it('is null without X2F_WEB_ROOT', () => {
    expect(webOptionsFromEnv({})).toBeNull();
  });

  it('needs both connect origins when the web app is served', () => {
    expect(() => webOptionsFromEnv({ X2F_WEB_ROOT: '/srv/web' })).toThrow(/X2F_RELAY_ORIGIN/);
    expect(() => webOptionsFromEnv({ X2F_WEB_ROOT: '/srv/web', X2F_RELAY_ORIGIN: RELAY })).toThrow(/X2F_NODE_PROXY_ORIGIN/);
    // Lead call 20 Nov: and the site's own origins, for the OCR worker's CSP.
    expect(() => webOptionsFromEnv({ X2F_WEB_ROOT: '/srv/web', X2F_RELAY_ORIGIN: RELAY, X2F_NODE_PROXY_ORIGIN: NODE })).toThrow(/X2F_ORIGINS/);
    expect(
      webOptionsFromEnv({ X2F_WEB_ROOT: '/srv/web', X2F_RELAY_ORIGIN: RELAY, X2F_NODE_PROXY_ORIGIN: NODE, X2F_ORIGINS: `${SITE}, https://x2fabcdef.example` }),
    ).toEqual({ root: '/srv/web', relayOrigin: RELAY, nodeProxyOrigin: NODE, siteOrigins: [SITE, 'https://x2fabcdef.example'] });
    expect(() => webOptionsFromEnv({ X2F_WEB_ROOT: '/srv/web', X2F_RELAY_ORIGIN: RELAY, X2F_NODE_PROXY_ORIGIN: NODE, X2F_ORIGINS: 'https://x2f.test/ocr' })).toThrow();
  });
});
