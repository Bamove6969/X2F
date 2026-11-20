import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { connect, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MONERO_WORKER_PATH, OCR_WORKER_CSP, SERVICE_WORKER_CSP, cspFor, escrowWorkerCspFor, moneroWorkerCspFor, serveWeb, webOptionsFromEnv } from '../src/static/serve.js';
import { testApp } from './helpers/app.js';

const RELAY = 'wss://relay.x2f.test';
const NODE = 'https://node.x2f.test';
const WEB = ['https://x2f.test', 'https://www.x2f.test'];
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
  // The escrow worker, as vite names it (apps/web/src/escrow/worker.ts → assets/worker-<hash>.js).
  await writeFile(join(root, 'assets', 'worker-CzS2KofQ.js'), 'self.onmessage = () => undefined;');
  await writeFile(join(root, 'assets', 'not-a-worker-abc.js'), 'console.log(4)');
  ({ app } = await testApp());
  await serveWeb(app, { root, webOrigins: WEB, relayOrigin: RELAY, nodeProxyOrigin: NODE });
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

  it('a built asset gets the headers, no CSP and a long cache', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/app-abc123.js' });
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
  it('the policy is exactly the plan\'s: nothing but this origin, wasm allowed', () => {
    expect(OCR_WORKER_CSP).toBe("default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'");
  });

  it.each(['/ocr/worker.min.js', '/ocr/tesseract-core-simd-lstm.wasm.js', '/ocr/eng.traineddata.gz'])('%s carries the worker CSP', async (url) => {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    expectBaseHeaders(res.headers);
    expect(res.headers['content-security-policy']).toBe("default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'");
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

  it('review m-4: .gz is a file only under /ocr/: a profile named alice.gz is still the app page', async () => {
    for (const url of ['/u/alice.gz', '/u/backup.gz']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers['content-type'], url).toMatch(/^text\/html/);
    }
  });

  it('only the ocr folder gets it: a built asset named ocr-… keeps no CSP', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/ocr-abc123.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-security-policy']).toBeUndefined();
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

  it('only the monero folder gets it: a built asset named monero-… keeps no CSP and its long cache', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/monero-abc123.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-security-policy']).toBeUndefined();
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });
});

describe('every worker script carries its own CSP (lead call 20 Nov: a worker takes its CSP from its own response)', () => {
  const ESCROW_CSP =
    "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; " +
    'worker-src https://x2f.test/monero/monero.worker.js https://www.x2f.test/monero/monero.worker.js; ' +
    `connect-src 'self' ${RELAY} ${NODE}`;

  it("the escrow worker's policy (multisig and chat keys): the API on this origin, the relay, the node proxy; only monero-ts's worker may be started", () => {
    expect(escrowWorkerCspFor({ webOrigins: WEB, relayOrigin: RELAY, nodeProxyOrigin: NODE })).toBe(ESCROW_CSP);
  });

  it('the escrow worker is served with it, and keeps the long cache of a hashed asset', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/worker-CzS2KofQ.js' });
    expect(res.statusCode).toBe(200);
    expectBaseHeaders(res.headers);
    expect(String(res.headers['content-type'])).toMatch(/^application\/javascript/);
    expect(res.headers['content-security-policy']).toBe(ESCROW_CSP);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it("only assets/worker-*.js gets it: other assets keep no CSP", async () => {
    for (const url of ['/assets/not-a-worker-abc.js', '/assets/app-abc123.js']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.headers['content-security-policy'], url).toBeUndefined();
    }
  });

  it('the service worker (push only, no request) may do nothing that CSP governs', async () => {
    expect(SERVICE_WORKER_CSP).toBe("default-src 'none'");
    const res = await app.inject({ method: 'GET', url: '/sw.js' });
    expect(res.headers['content-security-policy']).toBe("default-src 'none'");
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it("the OCR worker's and monero-ts's worker's policies stay as pinned above", async () => {
    expect((await app.inject({ method: 'GET', url: '/ocr/worker.min.js' })).headers['content-security-policy']).toBe(OCR_WORKER_CSP);
    expect((await app.inject({ method: 'GET', url: MONERO_WORKER_PATH })).headers['content-security-policy']).toBe(
      `default-src 'none'; script-src 'wasm-unsafe-eval'; connect-src ${NODE}`,
    );
  });

  it('each web origin must be an exact http(s) origin, https unless loopback or allowed', () => {
    const o = { relayOrigin: RELAY, nodeProxyOrigin: NODE };
    for (const bad of [[], ['https://x2f.test/'], ['https://x2f.test/app'], ['wss://x2f.test'], ['http://x2f.test'], ['https://x2f.test', '*']]) {
      expect(() => escrowWorkerCspFor({ ...o, webOrigins: bad }), JSON.stringify(bad)).toThrow(/web origin/);
    }
    expect(escrowWorkerCspFor({ ...o, webOrigins: ['http://127.0.0.1:4317'] })).toContain('worker-src http://127.0.0.1:4317/monero/monero.worker.js;');
    expect(escrowWorkerCspFor({ ...o, webOrigins: ['http://x2f.test'], allowInsecureOrigins: true })).toContain('worker-src http://x2f.test/monero/monero.worker.js;');
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
    await serveWeb(live, { root, webOrigins: WEB, relayOrigin: RELAY, nodeProxyOrigin: NODE });
    await live.listen({ host: '127.0.0.1', port: 0 });
    port = (live.server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await live.close();
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

  const base = { X2F_WEB_ROOT: '/srv/web', X2F_ORIGINS: 'https://x2f.test', X2F_RELAY_ORIGIN: RELAY, X2F_NODE_PROXY_ORIGIN: NODE };

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
        webOrigins: ['https://x2f.test'],
        relayOrigin: value,
        nodeProxyOrigin: value,
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
      webOrigins: ['https://x2f.test'],
      relayOrigin: 'ws://relay.x2f.test',
      nodeProxyOrigin: 'http://node.x2f.test',
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
      await expect(serveWeb(other, { root, webOrigins: WEB, relayOrigin: 'ws://relay.x2f.test', nodeProxyOrigin: NODE })).rejects.toThrow(/https or wss/);
    } finally {
      await other.close();
    }
  });
});

describe('webOptionsFromEnv', () => {
  it('is null without X2F_WEB_ROOT', () => {
    expect(webOptionsFromEnv({})).toBeNull();
  });

  it('needs both connect origins and the web origins (X2F_ORIGINS) when the web app is served', () => {
    expect(() => webOptionsFromEnv({ X2F_WEB_ROOT: '/srv/web' })).toThrow(/X2F_RELAY_ORIGIN/);
    expect(() => webOptionsFromEnv({ X2F_WEB_ROOT: '/srv/web', X2F_RELAY_ORIGIN: RELAY })).toThrow(/X2F_NODE_PROXY_ORIGIN/);
    expect(() => webOptionsFromEnv({ X2F_WEB_ROOT: '/srv/web', X2F_RELAY_ORIGIN: RELAY, X2F_NODE_PROXY_ORIGIN: NODE })).toThrow(/X2F_ORIGINS/);
    expect(() => webOptionsFromEnv({ X2F_WEB_ROOT: '/srv/web', X2F_ORIGINS: 'https://x2f.test/', X2F_RELAY_ORIGIN: RELAY, X2F_NODE_PROXY_ORIGIN: NODE })).toThrow(/web origin/);
    expect(
      webOptionsFromEnv({ X2F_WEB_ROOT: '/srv/web', X2F_ORIGINS: 'https://x2f.test, https://www.x2f.test', X2F_RELAY_ORIGIN: RELAY, X2F_NODE_PROXY_ORIGIN: NODE }),
    ).toEqual({ root: '/srv/web', webOrigins: ['https://x2f.test', 'https://www.x2f.test'], relayOrigin: RELAY, nodeProxyOrigin: NODE });
  });
});
