// The live-session route lists (auth/liveSession.ts; review round 5 M1): every route other than GET
// that runs with a session re-checks, under the account lock, that the session is still live, or is
// listed as exempt with its reason. Owner, 26 Nov 2026: no passwords and no 24-hour holds.
import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LIVE_SESSION_EXEMPT, LIVE_SESSION_ROUTES, SECURITY_CHANGE_ROUTES } from '../src/auth/liveSession.js';
import { tradeApp } from './helpers/tradeApp.js';

let app: FastifyInstance;

beforeAll(async () => {
  ({ app } = await tradeApp());
});

afterAll(async () => {
  await app.close();
});

describe('the route lists', () => {
  it('every route other than GET that runs with a session is classified: LIVE_SESSION_ROUTES or LIVE_SESSION_EXEMPT (review round 5 M1)', () => {
    const classified = [...LIVE_SESSION_ROUTES, ...Object.keys(LIVE_SESSION_EXEMPT)];
    expect(new Set(classified).size, 'listed twice').toBe(classified.length);
    // Both ways: a new route fails until it is classified, and a listed route must still exist.
    expect([...app.sessionWriteRoutes].sort()).toEqual(classified.sort());
    for (const [route, reason] of Object.entries(LIVE_SESSION_EXEMPT)) expect(reason.length, route).toBeGreaterThan(10);
  });

  it('the security routes exist and each is a live-session route', () => {
    for (const r of SECURITY_CHANGE_ROUTES) {
      const [method, url] = r.split(' ') as ['GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', string];
      expect(app.hasRoute({ method, url }), r).toBe(true);
      expect(LIVE_SESSION_ROUTES, r).toContain(r);
    }
  });

  it('no hold or password code is left in the API', () => {
    const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
    for (const f of ['auth/pgp.ts', 'auth/webauthn.ts', 'auth/totp.ts', 'auth/recovery.ts', 'auth/methods.ts', 'routes/account.ts', 'wallets/routes.ts', 'routes/team.ts', 'trades/take.ts', 'offers/routes.ts']) {
      for (const gone of ['gateChange', 'requireNotHeld', 'holdInTx', 'weakOf', 'stagedReply', 'from passwords']) expect(src(f), `${f}: ${gone}`).not.toContain(gone);
    }
  });
});
