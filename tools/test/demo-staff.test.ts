import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as openpgp from 'openpgp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileAttestationPolicy, parseAllowlist } from '../../apps/api/src/auth/attestation.js';
import { PORTS, STAFF_WEB_DIST, WEB_DIST } from '../demo/config.js';
import { createGateway } from '../demo/gateway-core.js';
import { guidePage, guideSteps, STAFF_SCREENS, type SeedSummary } from '../demo/guide-page.js';
import { NAV, type NavItem } from '@x2f/staff';
import { demoOrigins, DemoOriginError } from '../demo/origins.js';
import { bumpCounter, parseCookieHeader, softStaffLogin, STAFF_CAST, type StaffSecret } from '../demo/staff-accounts.js';
import { createStaffGateway, STAFF_DEMO_CSP, staffLoginPage, withoutCookies } from '../demo/staff-gateway-core.js';
import { demoMdsReadme, makeDemoMds, REPO_MDS_DIR } from '../demo/staff-mds.js';
import type { StaffSummary } from '../demo/staff-summary.js';
import { redeployFolders, staffBuildCommand } from '../demo/web-build.js';
import { KEY_AAGUID, newKey } from '../regtest/e2e/softKey.js';
import { newPgp } from '../regtest/e2e/staffClient.js';

const FUNNEL = { DEMO_PUBLIC_ORIGIN: 'https://x2f-lead.tail1.ts.net:8443', DEMO_PUBLIC_NODE_ORIGIN: 'https://x2f-lead.tail1.ts.net:10000' };

describe('the staff origin (its own port, never the trader one)', () => {
  it('is http://localhost:4402 by default, with the RP ID localhost', () => {
    const o = demoOrigins({});
    expect(PORTS.staffGateway).toBe(4402);
    expect(o.staff).toBe('http://localhost:4402');
    expect(o.staffRpId).toBe('localhost');
    expect(o.staffAllowed).toEqual(['http://localhost:4402', 'http://127.0.0.1:4402']);
    // Never one of the trader origins.
    for (const s of o.staffAllowed) expect(o.allowed).not.toContain(s);
  });

  it('is DEMO_PUBLIC_STAFF_ORIGIN when set: the Funnel host on 443, beside the trader app on 8443', () => {
    const o = demoOrigins({ ...FUNNEL, DEMO_PUBLIC_STAFF_ORIGIN: 'https://x2f-lead.tail1.ts.net' });
    expect(o.staff).toBe('https://x2f-lead.tail1.ts.net');
    expect(o.staffAllowed).toEqual(['http://localhost:4402', 'http://127.0.0.1:4402', 'https://x2f-lead.tail1.ts.net']);
    // A WebAuthn RP ID has no port: the staff one is the same host as the trader one.
    expect(o.staffRpId).toBe('x2f-lead.tail1.ts.net');
    expect(o.rpId).toBe('x2f-lead.tail1.ts.net');
    expect(o.allowed).not.toContain(o.staff);
    // Explicit 443 is the bare origin.
    expect(demoOrigins({ ...FUNNEL, DEMO_PUBLIC_STAFF_ORIGIN: 'https://x2f-lead.tail1.ts.net:443/' }).staff).toBe('https://x2f-lead.tail1.ts.net');
  });

  it('refuses a staff origin that is the trader or node one, http, or one with a path', () => {
    expect(() => demoOrigins({ ...FUNNEL, DEMO_PUBLIC_STAFF_ORIGIN: FUNNEL.DEMO_PUBLIC_ORIGIN })).toThrow(DemoOriginError);
    expect(() => demoOrigins({ ...FUNNEL, DEMO_PUBLIC_STAFF_ORIGIN: `${FUNNEL.DEMO_PUBLIC_NODE_ORIGIN}/` })).toThrow(DemoOriginError);
    for (const bad of ['http://x2f-lead.tail1.ts.net', 'https://x2f-lead.tail1.ts.net/staff', 'https://u:p@x2f-lead.tail1.ts.net']) {
      expect(() => demoOrigins({ ...FUNNEL, DEMO_PUBLIC_STAFF_ORIGIN: bad })).toThrow(DemoOriginError);
    }
    // Works without the trader's public origins too (a staff-only tunnel).
    expect(demoOrigins({ DEMO_PUBLIC_STAFF_ORIGIN: 'https://s.example' }).staff).toBe('https://s.example');
  });

  it('has a port of its own among the demo\'s', () => {
    const all = Object.values(PORTS);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('the staff build and demo:web', () => {
  it('builds apps/staff-web in production mode with only the moderation key pinned', () => {
    const c = staffBuildCommand('/x/out', { modSigningPublic: 'a'.repeat(64) }, { PATH: '/bin' });
    expect(c.cmd).toBe('npx');
    expect(c.args).toEqual(['vite', 'build', '--outDir', '/x/out', '--emptyOutDir', '--logLevel', 'warn']);
    expect(c.cwd.endsWith('apps/staff-web')).toBe(true);
    expect(c.env).toEqual({ PATH: '/bin', VITE_MOD_SIGNING_PUBLIC: 'a'.repeat(64) });
    // No --mode: vite.config's checkBuildEnv runs for the production build.
    expect(c.args).not.toContain('--mode');
    expect(() => staffBuildCommand('/x', { modSigningPublic: 'A'.repeat(64) })).toThrow(/64 lower-case hex/);
    // Its own folder, which separation-check skips like the web one (dist-demo).
    expect(STAFF_WEB_DIST.endsWith('apps/staff-web/dist-demo')).toBe(true);
  });

  it('swaps the web build always, and the staff build only when the running API serves it', () => {
    const web = { X2F_WEB_ROOT: WEB_DIST };
    expect(redeployFolders(web, WEB_DIST, STAFF_WEB_DIST)).toEqual([{ live: WEB_DIST, next: `${WEB_DIST}.next`, prev: `${WEB_DIST}.prev` }]);
    expect(redeployFolders({ ...web, X2F_STAFF_WEB_ROOT: STAFF_WEB_DIST }, WEB_DIST, STAFF_WEB_DIST)).toEqual([
      { live: WEB_DIST, next: `${WEB_DIST}.next`, prev: `${WEB_DIST}.prev` },
      { live: STAFF_WEB_DIST, next: `${STAFF_WEB_DIST}.next`, prev: `${STAFF_WEB_DIST}.prev` },
    ]);
    expect(() => redeployFolders({ X2F_WEB_ROOT: '/elsewhere' }, WEB_DIST, STAFF_WEB_DIST)).toThrow(/serves \/elsewhere/);
    expect(() => redeployFolders({ ...web, X2F_STAFF_WEB_ROOT: '/other' }, WEB_DIST, STAFF_WEB_DIST)).toThrow(/staff app from \/other/);
  });
});

describe('the demo\'s FIDO metadata (the repo snapshot plus the demo key)', () => {
  let dir = '';
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = '';
  });

  it('adds the demo key to both allowlists and keeps every real one', async () => {
    const real = await readFile(join(REPO_MDS_DIR, 'README.md'), 'utf8');
    const merged = demoMdsReadme(real);
    for (const kind of ['owner', 'staff'] as const) {
      const before = parseAllowlist(real, kind);
      const after = parseAllowlist(merged, kind);
      expect(after).toEqual([KEY_AAGUID, ...before]);
    }
    expect(() => demoMdsReadme('# no lists')).toThrow(/Owner allowlist/);
  });

  it('is a folder the API loads: every real statement, the demo one, and the merged README', async () => {
    dir = await mkdtemp(join(tmpdir(), 'x2f-mds-'));
    const ca = await makeDemoMds(join(dir, 'mds'));
    expect(ca.cert.length).toBeGreaterThan(100);
    const files = await readdir(join(dir, 'mds'));
    expect(files).toContain(`${KEY_AAGUID}.json`);
    for (const f of await readdir(REPO_MDS_DIR)) expect(files).toContain(f);
    const policy = fileAttestationPolicy(join(dir, 'mds'), { warn: () => undefined });
    await expect(policy.init()).resolves.toBeUndefined();
    expect(policy.isAllowed(KEY_AAGUID, 'packed', 'owner')).toBe(true);
    expect(policy.isAllowed(KEY_AAGUID, 'packed', 'staff')).toBe(true);
    expect(policy.isAllowed(KEY_AAGUID, 'none', 'staff')).toBe(false);
  }, 30_000);
});

describe('cookies across the two origins (one host, two ports)', () => {
  it('drops only the named cookies', () => {
    expect(withoutCookies('a=1; __Host-x2f_staff=s; __Host-x2f_dev=d', ['__Host-x2f_staff'])).toBe('a=1; __Host-x2f_dev=d');
    expect(withoutCookies('__Host-x2f_staff=s', ['__Host-x2f_staff'])).toBeUndefined();
    expect(withoutCookies(undefined, ['x'])).toBeUndefined();
    expect([...parseCookieHeader('a=1; b=x=y; bad')]).toEqual([['a', '1'], ['b', 'x=y']]);
  });
});

let servers: Server[] = [];
function listen(s: Server): Promise<number> {
  servers.push(s);
  return new Promise((resolve) => s.listen(0, '127.0.0.1', () => resolve((s.address() as AddressInfo).port)));
}
afterEach(() => {
  for (const s of servers) {
    s.closeAllConnections();
    s.close();
  }
  servers = [];
});

function raw(url: string, o: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const q = http.request(url, { method: o.method ?? 'GET', headers: o.headers ?? {} }, (r) => {
      let body = '';
      r.on('data', (c: Buffer) => (body += c.toString()));
      r.on('end', () => resolve({ status: r.statusCode ?? 0, headers: r.headers, body }));
    });
    q.on('error', reject);
    q.end(o.body);
  });
}

describe('the staff gateway', () => {
  const PRIMARY = 'https://staff.example';
  let hits: Array<{ url: string; origin: string | undefined; cookie: string | undefined }>;
  let logins: Array<{ as: string; cookies: Map<string, string> }>;
  let base: string;
  const HTML = '<!doctype html><html><head><title>staff</title></head><body></body></html>';
  const CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'";

  beforeEach(async () => {
    hits = [];
    logins = [];
    const staffApi = http.createServer((req: IncomingMessage, res: ServerResponse) => {
      hits.push({ url: req.url ?? '', origin: req.headers.origin, cookie: req.headers.cookie });
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP, 'cache-control': 'no-store', etag: '"e"' });
      res.end(HTML);
    });
    const api = await listen(staffApi);
    const gw = createStaffGateway({
      staffApi: api,
      primary: PRIMARY,
      origins: new Set(['http://localhost:4402', 'http://127.0.0.1:4402', PRIMARY]),
      people: () => STAFF_CAST,
      login: async (as, cookies) => {
        logins.push({ as, cookies });
        if (as === 'wren-demo') throw new Error('the key was refused');
        return ['__Host-x2f_staff=tok; Path=/; HttpOnly; Secure; SameSite=Strict', '__Host-x2f_dev=dev; Path=/; HttpOnly; Secure; SameSite=Strict'];
      },
    });
    base = `http://127.0.0.1:${await listen(http.createServer(gw))}`;
  });

  it('passes the staff API\'s pages on byte for byte: its CSP, no comment layer, no placeholder filling', async () => {
    const r = await raw(`${base}/disputes`, { headers: { accept: 'text/html', host: 'localhost:4402' } });
    expect(r.body).toBe(HTML);
    expect(r.headers['content-security-policy']).toBe(CSP);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers.etag).toBe('"e"');
    expect(r.body).not.toContain('/__demo/notes.js');
    expect(hits.at(-1)?.url).toBe('/disputes');
  });

  it('gives the staff API its one origin for the other staff origins and the request\'s own https one; any other is passed on unchanged', async () => {
    for (const origin of ['http://localhost:4402', 'http://127.0.0.1:4402', PRIMARY]) {
      await raw(`${base}/staff/v1/login/pgp/start`, { method: 'POST', headers: { origin }, body: '{}' });
      expect(hits.at(-1)?.origin).toBe(PRIMARY);
    }
    await raw(`${base}/staff/v1/x`, { method: 'POST', headers: { origin: 'https://p.example', 'x-forwarded-host': 'p.example', 'x-forwarded-proto': 'https' }, body: '{}' });
    expect(hits.at(-1)?.origin).toBe(PRIMARY);
    // The trader app's origins are not the staff app's: the staff API refuses them itself.
    for (const origin of ['http://localhost:4400', 'https://x2f-lead.tail1.ts.net:8443', 'https://evil.example', 'http://p.example']) {
      await raw(`${base}/staff/v1/x`, { method: 'POST', headers: { origin }, body: '{}' });
      expect(hits.at(-1)?.origin).toBe(origin);
    }
  });

  it('never sends the trader session cookie to the staff API', async () => {
    await raw(`${base}/staff/v1/me`, { headers: { cookie: '__Host-x2f_session=trader; __Host-x2f_staff=staff; __Host-x2f_dev=d' } });
    expect(hits.at(-1)?.cookie).toBe('__Host-x2f_staff=staff; __Host-x2f_dev=d');
    await raw(`${base}/staff/v1/me`, { headers: { cookie: '__Host-x2f_session=trader' } });
    expect(hits.at(-1)?.cookie).toBeUndefined();
  });

  it('serves the demo login page itself (never the API), with its own CSP', async () => {
    const r = await raw(`${base}/__demo/staff`, { headers: { host: 'localhost:4402' } });
    expect(r.status).toBe(200);
    expect(r.headers['content-security-policy']).toBe(STAFF_DEMO_CSP);
    expect(STAFF_DEMO_CSP).toContain("form-action 'self'");
    for (const p of STAFF_CAST) expect(r.body).toContain(`value="${p.loginName}"`);
    expect(hits).toEqual([]);
    expect((await raw(`${base}/__demo/notes.js`, { headers: { host: 'localhost:4402' } })).status).toBe(404);
    expect((await raw(`${base}/__demo/guide`, { headers: { host: 'localhost:4402' } })).status).toBe(404);
    // Only on the staff origins' hosts, or behind an https front.
    expect((await raw(`${base}/__demo/staff`, { headers: { host: 'evil.example' } })).status).toBe(403);
    expect((await raw(`${base}/__demo/staff`, { headers: { host: 'p.example', 'x-forwarded-proto': 'https' } })).status).toBe(200);
  });

  it('logs a seeded account in for this browser and hands it the API\'s cookies', async () => {
    const r = await raw(`${base}/__demo/staff/login`, {
      method: 'POST',
      headers: { host: 'localhost:4402', origin: 'http://localhost:4402', 'content-type': 'application/x-www-form-urlencoded', cookie: '__Host-x2f_dev=mine; __Host-x2f_session=trader' },
      body: 'as=lumen-demo',
    });
    expect(r.status).toBe(303);
    expect(r.headers.location).toBe('/');
    expect(r.headers['set-cookie']).toEqual(['__Host-x2f_staff=tok; Path=/; HttpOnly; Secure; SameSite=Strict', '__Host-x2f_dev=dev; Path=/; HttpOnly; Secure; SameSite=Strict']);
    expect(logins).toHaveLength(1);
    expect(logins[0]!.as).toBe('lumen-demo');
    // The browser's own device cookie goes with the login; its trader session does not.
    expect([...logins[0]!.cookies]).toEqual([['__Host-x2f_dev', 'mine']]);
    expect(hits).toEqual([]);
  });

  it('refuses a login from another site, an account it did not seed, a GET, and says why a login failed', async () => {
    const post = (origin: string, body: string) => raw(`${base}/__demo/staff/login`, { method: 'POST', headers: { host: 'localhost:4402', origin, 'content-type': 'application/x-www-form-urlencoded' }, body });
    expect((await post('https://evil.example', 'as=lumen-demo')).status).toBe(403);
    expect((await post('http://localhost:4400', 'as=lumen-demo')).status).toBe(403);
    expect((await post('http://localhost:4402', 'as=ana-demo')).status).toBe(400);
    expect((await raw(`${base}/__demo/staff/login`, { headers: { host: 'localhost:4402' } })).status).toBe(405);
    const failed = await post('http://localhost:4402', 'as=wren-demo');
    expect(failed.status).toBe(502);
    expect(failed.body).toContain('the key was refused');
    expect(logins.map((l) => l.as)).toEqual(['wren-demo']);
  });

  it('the login page escapes what it shows', () => {
    expect(staffLoginPage([{ tradeTag: '<b>', loginName: 'x"y', role: 'mod', sees: 'a&b' }], '<i>')).not.toMatch(/as <b>|<i>|x"y|a&b/);
  });
});

describe('the trader gateway keeps the staff session away from the trader side', () => {
  it('drops __Host-x2f_staff before the API sees the request', async () => {
    const seen: Array<string | undefined> = [];
    const up = await listen(http.createServer((req, res) => {
      seen.push(req.headers.cookie);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    }));
    const gw = createGateway({ api: up, relay: up, node: up, primary: 'http://localhost:4400', origins: new Set(['http://localhost:4400']), demo: (_q, r) => r.end() });
    const base = `http://127.0.0.1:${await listen(http.createServer(gw.handle(gw.web)))}`;
    await raw(`${base}/v1/site`, { headers: { cookie: '__Host-x2f_staff=s; __Host-x2f_session=t' } });
    await raw(`${base}/v1/site`, { headers: { cookie: '__Host-x2f_staff=s' } });
    expect(seen).toEqual(['__Host-x2f_session=t', undefined]);
  });
});

describe('the demo staff login (software keys, the real two steps)', () => {
  it('signs the security-key challenge, decrypts the PGP code, and returns the API\'s cookies', async () => {
    const pgp = await newPgp('Lumen_Prime');
    const who: StaffSecret = { tradeTag: 'Lumen_Prime', loginName: 'lumen-demo', role: 'owner', keys: [newKey()], pgp };
    const calls: Array<{ path: string; body: Record<string, unknown>; origin: string | null; cookie: string | null }> = [];
    const encrypted = await openpgp.encrypt({ message: await openpgp.createMessage({ text: 'X2F login code: K7Q2-M9XA\n' }), encryptionKeys: await openpgp.readKey({ armoredKey: pgp.publicKey }) });
    const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      const headers = new Headers(init?.headers);
      calls.push({ path, body: JSON.parse(String(init?.body)) as Record<string, unknown>, origin: headers.get('origin'), cookie: headers.get('cookie') });
      const json = (b: unknown, cookies: string[] = []) => {
        const h = new Headers({ 'content-type': 'application/json' });
        for (const c of cookies) h.append('set-cookie', c);
        return new Response(JSON.stringify(b), { status: 200, headers: h });
      };
      if (path.endsWith('/security-key/start')) return json({ challengeId: 'c1', options: { challenge: 'AAAA', rpId: 'staff.example' } }, ['__Host-x2f_dev=new; Path=/; Secure']);
      if (path.endsWith('/security-key/finish')) return json({ pendingId: 'p1' });
      if (path.endsWith('/pgp/start')) return json({ challengeId: 'c2', encryptedMessage: encrypted });
      return json({ status: 'ok' }, ['__Host-x2f_staff=session; Path=/; HttpOnly; Secure; SameSite=Strict']);
    }) as typeof fetch;
    const out = await softStaffLogin({ api: 'http://127.0.0.1:1', origin: 'https://staff.example', rpId: 'staff.example', now: () => 1_800_000_000_000, fetchImpl: fakeFetch }, who, new Map([['__Host-x2f_dev', 'old']]));
    expect(calls.map((c) => c.path)).toEqual(['/staff/v1/login/security-key/start', '/staff/v1/login/security-key/finish', '/staff/v1/login/pgp/start', '/staff/v1/login/pgp/finish']);
    expect(calls.every((c) => c.origin === 'https://staff.example')).toBe(true);
    expect(calls[0]!.cookie).toBe('__Host-x2f_dev=old');
    expect(calls[1]!.cookie).toBe('__Host-x2f_dev=new');
    expect(calls[0]!.body).toEqual({ loginName: 'lumen-demo' });
    const response = calls[1]!.body.response as { response: { clientDataJSON: string } };
    expect(JSON.parse(Buffer.from(response.response.clientDataJSON, 'base64url').toString())).toMatchObject({ type: 'webauthn.get', challenge: 'AAAA', origin: 'https://staff.example' });
    expect(calls[2]!.body).toEqual({ key: pgp.publicKey, pendingId: 'p1' });
    expect(calls[3]!.body).toMatchObject({ challengeId: 'c2', code: 'K7Q2-M9XA', pendingId: 'p1' });
    expect(out).toEqual(['__Host-x2f_dev=new; Path=/; Secure', '__Host-x2f_staff=session; Path=/; HttpOnly; Secure; SameSite=Strict']);
    // The counter moved on from a clock reading.
    expect(who.keys[0]!.counter).toBe(100_000_001);
  });

  it('never lets a key\'s counter go back', () => {
    const k = newKey();
    bumpCounter(k, 1_800_000_000_000);
    expect(k.counter).toBe(100_000_000);
    k.counter = 100_000_050;
    bumpCounter(k, 1_800_000_000_000);
    expect(k.counter).toBe(100_000_050);
  });
});

describe('the guide\'s staff step', () => {
  const seed: SeedSummary = {
    owner: [], cast: [], failures: [],
    trades: [{ code: 'DISP-1111', buyer: 'nightowl-login', seller: 'satoshi-login', offer: 'ZELLE USD 60', fiat: '60 USD', state: 'disputed', at: '2026-11-26T00:00:00.000Z' }],
    team: [{ shown: 'ana_desk', login: 'ana-desk-login', roles: ['trades'] }],
  };
  const staff: StaffSummary = {
    origin: 'https://x2f-lead.tail1.ts.net',
    people: STAFF_CAST.map((p) => ({ login: p.loginName, shown: p.tradeTag, role: p.role })),
    disputes: ['DISP-1111'], taken: ['DISP-1111'], news: 'Welcome to the X2F demo', failures: [],
  };

  it('links the staff origin\'s login, names every staff account and what each role sees', () => {
    const html = guidePage(seed, staff);
    expect(html).toContain('href="https://x2f-lead.tail1.ts.net/__demo/staff"');
    for (const p of STAFF_CAST) expect(html).toContain(`<code>${p.loginName}</code>`);
    expect(html).toContain('Owner (lumen-demo) sees everything');
    expect(html).toContain('Moderators (kestrel-demo, wren-demo) see Disputes');
    expect(html).toContain('href="/trade/DISP-1111"');
    expect(html).toContain('ana_desk (trades)');
    expect(html).toContain('key tap');
  });

  it('each role\'s line names every screen of its staff menu (packages/staff NAV), and no other role\'s', () => {
    const label: Record<NavItem, string> = {
      overview: 'Overview', disputes: 'Disputes', 'past-reputation': 'Past reputation', staff: 'Staff', performance: 'Performance',
      prices: 'Prices', training: 'Training', log: 'Activity log', feedback: 'Feedback', settings: 'Settings',
    };
    for (const role of ['owner', 'senior', 'mod'] as const) {
      const line = STAFF_SCREENS[role];
      for (const item of Object.keys(label) as NavItem[]) {
        // "Staff" also starts "Staff (invites ...)" only on the owner's line; word match.
        // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- fixed labels above
        const shown = new RegExp(`(^|[\\s:,])${label[item]}([\\s,(;]|$)`).test(line);
        expect([role, item, shown]).toEqual([role, item, NAV[role].includes(item)]);
      }
    }
  });

  it('says so when the staff seed has not run', () => {
    const step = guideSteps(seed, null).find((s) => s.title.endsWith('Staff screens'))!;
    expect(step.links).toEqual([]);
    expect(step.who).toContain('Not seeded');
  });
});
