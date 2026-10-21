import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cspFor, serveWeb, webOptionsFromEnv } from '../src/static/serve.js';
import { testApp } from './helpers/app.js';

const RELAY = 'wss://relay.x2f.test';
const NODE = 'https://node.x2f.test';
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
  ({ app } = await testApp());
  await serveWeb(app, { root, relayOrigin: RELAY, nodeProxyOrigin: NODE });
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

  it('a missing file is a 404, not the app page', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/missing.js' });
    expect(res.statusCode).toBe(404);
    expectBaseHeaders(res.headers);
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

describe('the /v1 check in the web catch-all', () => {
  it.each(['/V1/x', '/v1%2fx', '/%761/x', '/V1'])('%s is a JSON 404, never the app page', async (url) => {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not-found' });
    expect(res.headers['content-security-policy']).toBeUndefined();
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

describe('webOptionsFromEnv', () => {
  it('is null without X2F_WEB_ROOT', () => {
    expect(webOptionsFromEnv({})).toBeNull();
  });

  it('needs both connect origins when the web app is served', () => {
    expect(() => webOptionsFromEnv({ X2F_WEB_ROOT: '/srv/web' })).toThrow(/X2F_RELAY_ORIGIN/);
    expect(() => webOptionsFromEnv({ X2F_WEB_ROOT: '/srv/web', X2F_RELAY_ORIGIN: RELAY })).toThrow(/X2F_NODE_PROXY_ORIGIN/);
    expect(
      webOptionsFromEnv({ X2F_WEB_ROOT: '/srv/web', X2F_RELAY_ORIGIN: RELAY, X2F_NODE_PROXY_ORIGIN: NODE }),
    ).toEqual({ root: '/srv/web', relayOrigin: RELAY, nodeProxyOrigin: NODE });
  });
});
