/**
 * End-to-end harness: a real `buildApi` listening on 127.0.0.1:0 over Postgres from the API's
 * test harness (its vitest globalSetup), and browsers that keep
 * cookies and send `Origin: https://x2f.test` as a page on the site would.
 */
import type { AuthenticationResponseJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON } from '@simplewebauthn/browser';
import type { FastifyInstance } from 'fastify';
import type { AddressValidator, Deps } from '../../../../apps/api/src/app.js';
import { LISTEN_OPTIONS } from '../../../../apps/api/src/app.js';
import { testApp } from '../../../../apps/api/test/helpers/app.js';
import type { SoftAuthenticator } from '../../../../apps/api/test/helpers/softAuthenticator.js';
// Brings in the harness's `pgUrl` declaration that the database helper reads.
import type {} from '../../../../apps/api/test/setup/postgres.js';
import { createAuthApi, type AuthApi, type AuthenticationCeremony, type RegistrationCeremony } from '../../src/index.js';

export const ORIGIN = 'https://x2f.test';
export const T0 = new Date('2026-10-17T12:00:00Z');

export interface Server {
  app: FastifyInstance;
  deps: Deps;
  baseUrl: string;
  now(): Date;
  setNow(d: Date): void;
  /** Moves the server clock on by `ms`. */
  advance(ms: number): void;
  /** `METHOD /pattern` of the route each request matched, in order (undefined: no route, the 404 handler). */
  routes: Array<string | undefined>;
  /** Every route the server has, as `METHOD /pattern` (HEAD, which fastify adds for each GET, left out). */
  serverRoutes(): string[];
  close(): Promise<void>;
}

export async function startServer(o: { addresses?: AddressValidator } = {}): Promise<Server> {
  const t = await testApp({ ...(o.addresses ? { addresses: o.addresses } : {}) });
  let now = T0;
  const setNow = (d: Date) => {
    now = d;
    t.setNow(d);
  };
  setNow(T0);
  const routes: Array<string | undefined> = [];
  t.app.addHook('onRequest', async (req) => {
    routes.push(req.is404 ? undefined : `${req.method} ${req.routeOptions.url}`);
  });
  await t.app.listen({ port: 0, host: '127.0.0.1', ...LISTEN_OPTIONS });
  const address = t.app.server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return {
    app: t.app,
    deps: t.deps,
    baseUrl: `http://127.0.0.1:${address.port}`,
    now: () => now,
    setNow,
    advance: (ms) => setNow(new Date(now.getTime() + ms)),
    routes,
    serverRoutes: () => listRoutes(t.app),
    close: async () => {
      await t.app.close();
    },
  };
}

/**
 * Reads the route table from `printRoutes({ commonPrefix: false })`: one line per node, each
 * indented 4 characters per level below its parent, as `├── /path (GET, HEAD, POST)`; a node's
 * full path is its ancestors' paths joined.
 */
function listRoutes(app: FastifyInstance): string[] {
  const out: string[] = [];
  const stack: string[] = [];
  for (const line of app.printRoutes({ commonPrefix: false }).split('\n')) {
    if (line.trim() === '') continue;
    const m = /^((?:│ {3}| {4})*)[├└]── (\S+)(?: \(([^)]*)\))?$/u.exec(line);
    if (m === null) throw new Error(`unexpected printRoutes line: ${line}`);
    const depth = m[1]!.length / 4;
    stack.length = depth;
    stack.push(m[2]!);
    const path = stack.join('');
    for (const method of (m[3] ?? '').split(', ').filter((x) => x !== '' && x !== 'HEAD')) out.push(`${method} ${path}`);
  }
  return out.sort();
}

/**
 * A browser on the site: keeps the cookies the API sets and sends them back (the session and the
 * device cookie), and sends the site's Origin. `keepCookies: false` is a client that never stores
 * any, so it never has a device cookie.
 */
export class Jar {
  readonly cookies = new Map<string, string>();
  readonly api: AuthApi;

  constructor(
    baseUrl: string,
    private readonly keepCookies = true,
  ) {
    this.api = createAuthApi({ baseUrl, fetch: this.fetch });
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('origin', ORIGIN);
    if (this.cookies.size > 0) headers.set('cookie', [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '));
    const res = await fetch(input, { ...init, headers });
    if (this.keepCookies) {
      for (const line of res.headers.getSetCookie()) {
        const pair = line.split(';', 1)[0]!;
        const eq = pair.indexOf('=');
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        if (value === '' || /;\s*max-age=0\b/i.test(line)) this.cookies.delete(name);
        else this.cookies.set(name, value);
      }
    }
    return res;
  };
}

/** The soft authenticator as the browser ceremony (`navigator.credentials`) on the site's origin. */
export function ceremonyOf(soft: SoftAuthenticator): RegistrationCeremony & AuthenticationCeremony {
  return {
    startRegistration: async ({ optionsJSON }) =>
      soft.register(optionsJSON as Parameters<SoftAuthenticator['register']>[0], ORIGIN) as unknown as RegistrationResponseJSON,
    startAuthentication: async ({ optionsJSON }: { optionsJSON: PublicKeyCredentialRequestOptionsJSON }) =>
      soft.authenticate(optionsJSON as Parameters<SoftAuthenticator['authenticate']>[0], ORIGIN) as unknown as AuthenticationResponseJSON,
  };
}

/** The error a call failed with (the test fails if it succeeded). */
export async function failure(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('expected the call to fail');
}

let seq = 0;
/** A fresh valid new username per call (8-20 characters, owner demo note #126). */
export const uniqueName = (prefix = 'user'): string => `${prefix}${String(++seq).padStart(6, '0')}x`;

/**
 * Plan 2 Task 16, for flows about something else: a trader login from a new browser while the
 * account is logged in elsewhere answers `approve-on-device`. This approves it as a logged-in device
 * would (straight in the database; the real decision is covered in flows-t11-t12 and the API's
 * deviceApproval.test.ts) and collects the session with `j`'s own poll. Other answers pass through.
 */
export async function approved(srv: Server, j: Jar, login: Promise<unknown>): Promise<unknown> {
  const r = (await login) as { status?: string; approvalId?: string };
  if (r.status !== 'approve-on-device' || r.approvalId === undefined) return r;
  const now = srv.now();
  await srv.deps.db.query(
    // As a logged-in device of the account would (API review round 4 R4-M2: the approving session must be live when it is collected).
    `update login_approvals l set outcome = 'approved', decided_at = $2, expires_at = $3,
            decided_by = (select s.id from sessions s where s.account_id = l.account_id and s.revoked_at is null and s.expires_at > $2
                           order by s.created_at, s.id limit 1)
      where l.id = $1 and l.outcome is null`,
    [r.approvalId, now, new Date(now.getTime() + 60_000)],
  );
  const polled = await j.api.pollLoginApproval(r.approvalId);
  return polled.status === 'ok' ? { status: 'ok' } : polled;
}
