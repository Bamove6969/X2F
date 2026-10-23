/**
 * End-to-end harness: a real `buildApi` listening on 127.0.0.1:0 over Postgres from the API's
 * test harness (its vitest globalSetup), with the leaked-password fixture, and browsers that keep
 * cookies and send `Origin: https://x2f.test` as a page on the site would.
 */
import type { AuthenticationResponseJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON } from '@simplewebauthn/browser';
import type { FastifyInstance } from 'fastify';
import type { AddressValidator, Deps } from '../../../../apps/api/src/app.js';
import { LISTEN_OPTIONS } from '../../../../apps/api/src/app.js';
import { testApp } from '../../../../apps/api/test/helpers/app.js';
import { fixtureLeakedList } from '../../../../apps/api/test/helpers/leaked.js';
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
  /** The route pattern each request matched, in order (undefined: no route, the 404 handler). */
  routes: Array<string | undefined>;
  close(): Promise<void>;
}

export async function startServer(o: { addresses?: AddressValidator } = {}): Promise<Server> {
  const leaked = await fixtureLeakedList();
  const t = await testApp({ leaked: leaked.list, ...(o.addresses ? { addresses: o.addresses } : {}) });
  let now = T0;
  const setNow = (d: Date) => {
    now = d;
    t.setNow(d);
  };
  setNow(T0);
  const routes: Array<string | undefined> = [];
  t.app.addHook('onRequest', async (req) => {
    routes.push(req.is404 ? undefined : req.routeOptions.url);
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
    close: async () => {
      await t.app.close();
      await leaked.cleanup();
    },
  };
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
/** A fresh valid username per call (5-20 characters). */
export const uniqueName = (prefix = 'user'): string => `${prefix}${String(++seq).padStart(4, '0')}x`;
