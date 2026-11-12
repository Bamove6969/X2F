// Security review of sign-up v2 (12 Nov 2026), M1: the creating session's sign-up window
// (`onboarding_until`, 30 minutes) lets a method be ADDED without confirm-it's-you, never REPLACED,
// and it closes when sign-up ends (`POST /v1/account/onboarding/end`, sent on reaching Welcome).
// The reviewer's probe: replacing an existing password inside the window is refused (403).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { insertPgpKey } from '../src/auth/pgp.js';
import { hashPassword } from '../src/auth/password.js';
import { seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';
import { fixtureLeakedList } from './helpers/leaked.js';
import { genKey } from './helpers/pgpKeys.js';
import { Browser, addTestLogin } from './helpers/totp.js';

const T0 = new Date('2026-10-20T06:00:00Z');
const HOUR = 3600_000;

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let now = T0;
let day = 0;
let n = 0;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  let set: (d: Date) => void;
  const fixture = await fixtureLeakedList();
  cleanup = fixture.cleanup;
  ({ app, deps, setNow: set } = await testApp({ leaked: fixture.list }));
  setNow = (d) => {
    now = d;
    set(d);
  };
  addTestLogin(app, deps);
});

afterAll(async () => {
  await app.close();
  await cleanup();
});

beforeEach(() => {
  setNow(new Date(T0.getTime() + ++day * 24 * HOUR));
});

/** A trader and its creating session (first session: inside the 30-minute sign-up window). */
async function signedUp(): Promise<{ id: string; b: Browser }> {
  const id = await seedAccount(deps, { loginName: `win${String(++n).padStart(4, '0')}` });
  const b = new Browser(app);
  expect((await b.post('/t/login', { accountId: id, firstSession: true })).statusCode).toBe(200);
  return { id, b };
}

async function withPassword(accountId: string, password = 'Correct-Horse-9'): Promise<void> {
  const { hash, pepperId } = await hashPassword(deps.config, password);
  await deps.db.query('insert into passwords (account_id, hash, pepper_id, updated_at) values ($1, $2, $3, $4)', [accountId, hash, pepperId, now]);
}

const confirmNeeded = (res: { statusCode: number; json: () => unknown }) => {
  expect(res.statusCode).toBe(403);
  expect((res.json() as { error: string }).error).toBe('confirm-required');
};

describe('M1(b): inside the sign-up window a method may be added, never replaced', () => {
  it("the reviewer's probe: replacing an existing password inside the window gets 403", async () => {
    const { id, b } = await signedUp();
    await withPassword(id);
    confirmNeeded(await b.put('/v1/account/password', { password: 'Another-Lantern-58' }));
  });

  it('adding a first password inside the window needs no confirmation (the PGP-then-password path)', async () => {
    const { b } = await signedUp();
    const res = await b.put('/v1/account/password', { password: 'Another-Lantern-58' });
    expect(res.statusCode).toBe(200);
    // A second one is a replacement.
    confirmNeeded(await b.put('/v1/account/password', { password: 'Third-Harbour-77' }));
  });

  it('a first authenticator app is added freely; another one would replace it and needs confirmation', async () => {
    const { id, b } = await signedUp();
    expect((await b.post('/v1/account/totp/start', {})).statusCode).toBe(200);
    await deps.db.query('insert into totp (account_id, secret_enc, created_at) values ($1, $2, $3)', [id, Buffer.from('x'), now]);
    confirmNeeded(await b.post('/v1/account/totp/start', {}));
  });

  it('the first recovery code is made freely; a new one (replacing it) needs confirmation', async () => {
    const { b } = await signedUp();
    expect((await b.post('/v1/account/recovery-codes', {})).statusCode).toBe(200);
    confirmNeeded(await b.post('/v1/account/recovery-codes', {}));
  });

  it('a PGP key is not added freely to an account that already has one', async () => {
    const { id, b } = await signedUp();
    const first = await genKey();
    await insertPgpKey(deps.db, deps.config, { accountId: id, fingerprint: first.fingerprint, armored: first.publicKey, now });
    const second = await genKey();
    confirmNeeded(await b.post('/v1/account/pgp/start', { publicKey: second.publicKey }));
  });
});

describe('M1(a): the window closes when sign-up ends', () => {
  it('POST /v1/account/onboarding/end closes it: after that even a first method needs confirmation', async () => {
    const { id, b } = await signedUp();
    const res = await b.post('/v1/account/onboarding/end', {});
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    const { rows } = await deps.db.query<{ onboarding_until: Date | null }>('select onboarding_until from sessions where account_id = $1', [id]);
    expect(rows.map((r) => r.onboarding_until)).toEqual([null]);
    confirmNeeded(await b.put('/v1/account/password', { password: 'Another-Lantern-58' }));
    confirmNeeded(await b.post('/v1/account/recovery-codes', {}));
  });

  it('it needs a session, and only ever closes the caller\'s own window', async () => {
    const anon = await new Browser(app).post('/v1/account/onboarding/end', {});
    expect(anon.statusCode).toBe(401);
    const a = await signedUp();
    const other = await signedUp();
    expect((await a.b.post('/v1/account/onboarding/end', {})).statusCode).toBe(200);
    expect((await other.b.post('/v1/account/recovery-codes', {})).statusCode).toBe(200);
  });
});
