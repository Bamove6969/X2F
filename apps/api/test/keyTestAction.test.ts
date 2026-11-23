// Security review of wip/lead-notes-all 656d259c, L1: the #94 key test confirmed `extend-session`
// and so minted a live token that extended the session if redeemed. Now it confirms its own action,
// `key-test`: the server verifies the assertion exactly as for any confirm and issues no token. A
// password or PGP key cannot confirm it, and a recovery session cannot run it (403 recovery-session).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { testApp } from './helpers/app.js';
import { fixtureLeakedList } from './helpers/leaked.js';
import { SIG } from './helpers/signature.js';
import { createSoftAuthenticator } from './helpers/softAuthenticator.js';
import { Browser, ORIGIN, addTestLogin } from './helpers/totp.js';

const T0 = new Date('2026-11-09T06:00:00Z');
const GOOD = 'Correct-Horse-9';
let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let step = 0;
let n = 0;
let cleanup: () => Promise<void>;
beforeAll(async () => {
  const fixture = await fixtureLeakedList();
  cleanup = fixture.cleanup;
  ({ app, deps, setNow } = await testApp({ leaked: fixture.list }));
  addTestLogin(app, deps);
});
afterAll(async () => {
  await app.close();
  await cleanup();
});
beforeEach(() => setNow(new Date(T0.getTime() + ++step * 24 * 3600_000)));

/** A password sign-up that adds a security key inside its window. */
async function withKey() {
  const b = new Browser(app);
  const nm = { loginName: `kta${process.pid % 1000}x${++n}`, displayName: `Kta${process.pid % 1000}x${n}` };
  expect((await b.post('/v1/register/password', { ...nm, password: GOOD, deviceLabel: 'P', acceptedTerms: deps.config.termsVersion, termsSignature: SIG })).statusCode).toBe(201);
  const key = createSoftAuthenticator({ backedUp: false, userVerified: true });
  const s = await b.post('/v1/account/webauthn/start', { kind: 'security-key' });
  expect((await b.post('/v1/account/webauthn/finish', { challengeId: s.json().challengeId, response: key.register(s.json().options, ORIGIN) })).statusCode).toBe(201);
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

  it('a password cannot confirm key-test', async () => {
    const { b } = await withKey();
    const res = await b.post('/v1/confirm/password', { password: GOOD, action: { kind: 'key-test' } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'method-not-allowed' });
  });

  it('a recovery session cannot run it (403 recovery-session)', async () => {
    const { b } = await withKey();
    const me = (await b.get('/v1/account/sessions')).json() as unknown;
    expect(me).toBeTruthy();
    const { rows } = await deps.db.query<{ id: string }>("select account_id as id from sessions order by created_at desc limit 1");
    const r = new Browser(app);
    expect((await r.post('/t/login', { accountId: rows[0]!.id, level: 'recovery' })).statusCode).toBe(200);
    const res = await r.post('/v1/confirm/webauthn/start', { action: { kind: 'key-test' } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'recovery-session' });
  });
});
