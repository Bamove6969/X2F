import { mkdtemp, rm } from 'node:fs/promises';
import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { codesPage, createCodesHandler } from '../demo/codes-page.js';
import { createGateway } from '../demo/gateway-core.js';
import { createNotesHandler, notesFiles } from '../demo/notes-server.js';
import { fillSelf, isSelfOrigin, requestHosts, SELF_HTTP, SELF_WS, selfOriginOf } from '../demo/self-origin.js';
import { stepOf, totpCode } from '../demo/totp.js';

describe('the request\'s own origin', () => {
  it('is https://<Host or X-Forwarded-Host> only', () => {
    expect(isSelfOrigin('https://p.example', { host: 'p.example' })).toBe(true);
    expect(isSelfOrigin('https://p.example', { host: '127.0.0.1:4400', 'x-forwarded-host': 'p.example' })).toBe(true);
    expect(isSelfOrigin('https://p.example:8443', { host: 'p.example:8443' })).toBe(true);
    // http is never one (a page that rebinds a name to 127.0.0.1 can only be http here).
    expect(isSelfOrigin('http://p.example', { host: 'p.example' })).toBe(false);
    expect(isSelfOrigin('https://evil.example', { host: 'p.example', 'x-forwarded-host': 'q.example' })).toBe(false);
    expect(isSelfOrigin('https://p.example/', { host: 'p.example' })).toBe(false);
    expect(isSelfOrigin('https://P.example', { host: 'p.example' })).toBe(false);
    expect(isSelfOrigin('https://p.example', { host: 'p.example:443' })).toBe(false);
    expect(isSelfOrigin('null', { host: 'p.example' })).toBe(false);
    expect(isSelfOrigin(undefined, { host: 'p.example' })).toBe(false);
    expect([...requestHosts({ host: 'a.example', 'x-forwarded-host': 'b.example, c d, e@f' })]).toEqual(['a.example', 'b.example']);
  });

  it('is http on loopback, https behind a front, and follows X-Forwarded-Proto', () => {
    expect(selfOriginOf({ host: 'localhost:4400' })).toEqual({ http: 'http://localhost:4400', ws: 'ws://localhost:4400' });
    expect(selfOriginOf({ host: '127.0.0.1:4400', 'x-forwarded-host': 'p.example', 'x-forwarded-proto': 'https' })).toEqual({ http: 'https://p.example', ws: 'wss://p.example' });
    expect(selfOriginOf({ host: 'p.example' })).toEqual({ http: 'https://p.example', ws: 'wss://p.example' });
    expect(selfOriginOf({ host: 'localhost:4400', 'x-forwarded-proto': 'https' })?.http).toBe('https://localhost:4400');
    expect(selfOriginOf({})).toBeNull();
    expect(selfOriginOf({ host: 'a/b' })).toBeNull();
  });

  it('fills both placeholders', () => {
    const js = `a:\`${SELF_WS}/relay\`,b:\`${SELF_HTTP}\``;
    expect(fillSelf(js, { http: 'https://p.example', ws: 'wss://p.example' })).toBe('a:`wss://p.example/relay`,b:`https://p.example`');
  });
});

const PRIMARY = 'http://localhost:4400';
const WORKER = `relay:"${SELF_WS}/relay",node:"${SELF_HTTP}"`;
const CSP = `default-src 'none'; connect-src 'self' ${SELF_WS} ${SELF_HTTP}`;

let servers: Server[];
let hits: { url: string; origin: string | undefined }[];
let base: string;
let dir: string;

function listen(s: Server): Promise<number> {
  servers.push(s);
  return new Promise((resolve) => s.listen(0, '127.0.0.1', () => resolve((s.address() as AddressInfo).port)));
}

beforeEach(async () => {
  servers = [];
  hits = [];
  dir = await mkdtemp(join(tmpdir(), 'x2f-self-'));
  const upstream = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    hits.push({ url: req.url ?? '', origin: req.headers.origin });
    if (req.url === '/assets/worker-x.js') {
      const gz = gzipSync(WORKER);
      res.writeHead(200, { 'content-type': 'text/javascript', 'content-encoding': 'gzip', 'content-length': gz.length, etag: '"w"', 'cache-control': 'public, max-age=31536000, immutable' });
      return res.end(gz);
    }
    if (req.url === '/assets/style.css') {
      res.writeHead(200, { 'content-type': 'text/css' });
      return res.end(SELF_HTTP);
    }
    const headers: Record<string, string> = { 'content-type': 'text/html', 'content-security-policy': CSP };
    if (req.headers.origin === PRIMARY) headers['access-control-allow-origin'] = PRIMARY;
    res.writeHead(200, headers);
    res.end('<html><head></head></html>');
  });
  const up = await listen(upstream);
  const origins = new Set([PRIMARY]);
  const notes = createNotesHandler({ files: notesFiles({ DEMO_NOTES_FILE: join(dir, 'n.jsonl') }), origins, clientJs: Buffer.from('//') });
  const gw = createGateway({ api: up, relay: up, node: up, primary: PRIMARY, origins, demo: notes });
  base = `http://127.0.0.1:${await listen(http.createServer(gw.handle(gw.web)))}`;
});

afterEach(async () => {
  for (const s of servers) {
    s.closeAllConnections();
    s.close();
  }
  await rm(dir, { recursive: true, force: true });
});

const FRONT = { 'x-forwarded-host': 'p.example', 'x-forwarded-proto': 'https' };

describe('the gateway under a foreign https origin', () => {
  it('fills the app\'s JavaScript with the request\'s own origin, unencoded, with the right length', async () => {
    const r = await fetch(`${base}/assets/worker-x.js`, { headers: { ...FRONT, 'if-none-match': '"w"' } });
    const body = await r.text();
    expect(body).toBe('relay:"wss://p.example/relay",node:"https://p.example"');
    expect(r.headers.get('content-length')).toBe(String(Buffer.byteLength(body)));
    expect(r.headers.get('etag')).toBeNull();
    expect(r.headers.get('vary')).toContain('X-Forwarded-Host');
    // On localhost, as before: the gateway's own http origin.
    expect(await (await fetch(`${base}/assets/worker-x.js`)).text()).toBe(`relay:"ws://127.0.0.1:${new URL(base).port}/relay",node:"${base}"`);
    // Nothing but the built JavaScript is touched.
    expect(await (await fetch(`${base}/assets/style.css`, { headers: FRONT })).text()).toBe(SELF_HTTP);
  });

  it('fills the CSP', async () => {
    const r = await fetch(`${base}/`, { headers: { ...FRONT, accept: 'text/html' } });
    expect(r.headers.get('content-security-policy')).toBe("default-src 'none'; connect-src 'self' wss://p.example https://p.example");
  });

  it('gives the API and the node proxy its own https origin as the primary one, and answers CORS to it', async () => {
    const r = await fetch(`${base}/v1/login/password`, { method: 'POST', headers: { ...FRONT, origin: 'https://p.example' }, body: '{}' });
    expect(hits.at(-1)).toEqual({ url: '/v1/login/password', origin: PRIMARY });
    expect(r.headers.get('access-control-allow-origin')).toBe('https://p.example');
    await fetch(`${base}/json_rpc`, { method: 'POST', headers: { ...FRONT, origin: 'https://p.example' }, body: '{}' });
    expect(hits.at(-1)).toEqual({ url: '/json_rpc', origin: PRIMARY });
  });

  it('passes any other origin on unchanged (the API refuses it)', async () => {
    for (const origin of ['https://evil.example', 'http://p.example']) {
      await fetch(`${base}/v1/login/password`, { method: 'POST', headers: { ...FRONT, origin }, body: '{}' });
      expect(hits.at(-1)?.origin).toBe(origin);
    }
    // A Host that is not the gateway's, over http (DNS rebinding): not its own origin.
    await new Promise<void>((resolve, reject) => {
      const q = http.request(`${base}/v1/x`, { method: 'POST', headers: { host: 'evil.example', origin: 'http://evil.example' } }, (r) => {
        r.resume();
        r.on('end', resolve);
      });
      q.on('error', reject);
      q.end('{}');
    });
    expect(hits.at(-1)?.origin).toBe('http://evil.example');
  });

  it('takes comments from its own https origin', async () => {
    const note = { pathname: '/', hash: '', dataScreen: 'home', viewport: { width: 390, height: 844 }, x: 1, y: 1, xPercent: 1, yPercent: 1, element: { css: 'main', text: '', offsetXPercent: 1, offsetYPercent: 1 }, screenName: 'demo_ana', text: 'hi' };
    const post = (origin: string) => fetch(`${base}/__demo/notes`, { method: 'POST', headers: { ...FRONT, 'content-type': 'application/json', origin }, body: JSON.stringify(note) });
    expect((await post('https://p.example')).status).toBe(201);
    expect((await post('https://evil.example')).status).toBe(403);
    expect(hits).toEqual([]);
  });
});

describe('/__demo/codes', () => {
  const secrets = { 'ana-demo': 'JBSWY3DPEHPK3PXP' };
  const now = 1_700_000_000_000;

  it('shows each seeded account\'s current code, escaped', () => {
    const page = codesPage({ ...secrets, '<x>': 'JBSWY3DPEHPK3PXP' }, now);
    expect(page).toContain(`<td>ana-demo</td><td><b>${totpCode(secrets['ana-demo'], stepOf(now))}</b></td>`);
    expect(page).toContain('&#60;x&#62;');
    expect(page).not.toContain('<x>');
  });

  it('is GET only, not cached, and only on the demo\'s hosts or behind an https front', async () => {
    const h = createCodesHandler({ origins: new Set([PRIMARY]), secrets: () => secrets, now: () => now });
    const port = await listen(http.createServer(h));
    const get = (headers: Record<string, string>, method = 'GET') =>
      new Promise<{ status: number; cache: string | undefined }>((resolve, reject) => {
        const q = http.request({ host: '127.0.0.1', port, path: '/__demo/codes', method, headers }, (r) => {
          r.resume();
          resolve({ status: r.statusCode ?? 0, cache: r.headers['cache-control'] });
        });
        q.on('error', reject);
        q.end();
      });
    expect(await get({ host: 'localhost:4400' })).toEqual({ status: 200, cache: 'no-store' });
    expect((await get({ host: 'p.example', 'x-forwarded-proto': 'https' })).status).toBe(200);
    expect((await get({ host: 'evil.example' })).status).toBe(403);
    expect((await get({ host: 'localhost:4400' }, 'POST')).status).toBe(405);
  });
});
