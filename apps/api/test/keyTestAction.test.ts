// Security review of wip/lead-notes-all 656d259c, L1: the #94 key test confirmed `extend-session`
// and so minted a live token that extended the session if redeemed. Now it confirms its own action,
// `key-test`: the server verifies the assertion exactly as for any confirm and issues no token. A
// PGP key cannot confirm it.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { testApp } from './helpers/app.js';
import { signUpWithKey } from './helpers/signup.js';
import { createSoftAuthenticator } from './helpers/softAuthenticator.js';
import { Browser, ORIGIN, addTestLogin } from './helpers/totp.js';

const T0 = new Date('2026-11-09T06:00:00Z');
let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let step = 0;
let n = 0;
let cleanup: () => Promise<void>;
beforeAll(async () => {
  cleanup = async () => {};
  ({ app, deps, setNow } = await testApp({}));
  addTestLogin(app, deps);
});
afterAll(async () => {
  await app.close();
  await cleanup();
});
beforeEach(() => setNow(new Date(T0.getTime() + ++step * 24 * 3600_000)));

/** A sign-up with a security key. */
async function withKey() {
  const b = new Browser(app);
  // Fixed-width parts: 10 and 11 characters whatever the pid (new names are 8–20, owner notes #126/#127).
  const p = String(process.pid % 1000).padStart(3, '0');
  const k = String(++n).padStart(2, '0');
  const nm = { loginName: `ktap${p}x${k}`, tradeTag: `Shown${p}k${k}` };
  const { res, auth: key } = await signUpWithKey(b, { ...nm, kind: 'security-key', acceptedTerms: deps.config.termsVersion });
  expect(res.statusCode, res.body).toBe(201);
  return { b, key };
}

describe('review L1: the key test confirms key-test and issues no token', () => {
  it('verifies the assertion and answers tested, with no confirm token stored', async () => {
    const { b, key } = await withKey();
    const before = (await deps.db.query<{ n: number }>('select count(*)::int as n from confirm_tokens')).rows[0]!.n;
    const cs = await b.post('/v1/confirm/webauthn/start', { action: { kind: 'key-test' } });
    expect(cs.statusCode, cs.body).toBe(200);
    expect(cs.json().options.allowCredentials.map((c: { id: string }) => c.id)).toContain(key.credentialId);
    const cf = await b.post('/v1/confirm/webauthn/finish', { challengeId: cs.json().challengeId, response: key.authenticate(cs.json().options, ORIGIN) });
    expect(cf.statusCode, cf.body).toBe(200);
    expect(cf.json()).toEqual({ tested: true });
    expect((await deps.db.query<{ n: number }>('select count(*)::int as n from confirm_tokens')).rows[0]!.n).toBe(before);
  });

  it('a forged answer still fails the server check (401 webauthn-failed)', async () => {
    const { b } = await withKey();
    const other = createSoftAuthenticator({ backedUp: false, userVerified: true });
    const cs = await b.post('/v1/confirm/webauthn/start', { action: { kind: 'key-test' } });
    const cf = await b.post('/v1/confirm/webauthn/finish', { challengeId: cs.json().challengeId, response: other.authenticate(cs.json().options, ORIGIN) });
    expect(cf.statusCode).toBe(401);
  });

});
