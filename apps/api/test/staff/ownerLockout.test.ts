// Plan 4 Task 7: the owner can never be locked out, demoted, switched off or "reset".
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GRANTABLE_PERMS, keyCheckCode } from '@x2f/staff';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { codeOf, decrypt, type Pair } from '../helpers/pgpKeys.js';
import type { SoftAuthenticator } from '../helpers/softAuthenticator.js';
import { STAFF_ORIGIN, StaffBrowser, errorOf, insertSession, logEntries } from '../helpers/staffApp.js';
import { addPgpKey, attestedStaffApps, resetBudgets, staffWithKeys, tap, type AttestedStaffApps, type Person } from '../helpers/staffKeys.js';

const MON_NOON = new Date('2026-11-02T12:00:00Z');
const MIN = 60_000;

let t: AttestedStaffApps;
let owner: Person;
let ownerPgp: Pair;

beforeAll(async () => {
  t = await attestedStaffApps();
  t.setNow(MON_NOON);
  owner = await staffWithKeys(t, { role: 'owner' });
  ownerPgp = await addPgpKey(t.deps, owner.id);
});
afterAll(async () => t.close());
beforeEach(() => {
  t.setNow(MON_NOON);
  // The in-memory budgets (limits.ts) are per process and shared by all; each test starts full.
  resetBudgets(t);
});

/** The owner's whole login on the staff app from a fresh browser: PGP first, then `key`. */
async function ownerLogin(key: SoftAuthenticator) {
  const b = new StaffBrowser(t.app);
  const start = await b.post('/staff/v1/login/pgp/start', { key: ownerPgp.publicKey });
  expect(start.statusCode, start.body).toBe(200);
  const { challengeId, encryptedMessage } = start.json();
  const code = codeOf(await decrypt(encryptedMessage, ownerPgp.privateKey, undefined, t.deps.clock()));
  const first = await b.post('/staff/v1/login/pgp/finish', { challengeId, code, deviceLabel: 'Desk' });
  expect(first.statusCode, first.body).toBe(200);
  const { pendingId } = first.json();
  const ks = await b.post('/staff/v1/login/security-key/start', { pendingId });
  expect(ks.statusCode, ks.body).toBe(200);
  const fin = await b.post('/staff/v1/login/security-key/finish', {
    challengeId: ks.json().challengeId, response: key.authenticate(ks.json().options, STAFF_ORIGIN), deviceLabel: 'Desk', pendingId,
  });
  return { b, res: fin };
}

describe('owner lockout', () => {
  it('1,000 cookie-less failed password and PGP logins, then the owner logs in with a security key', async () => {
    for (let i = 0; i < 1000; i++) {
      const pw = await t.trader.inject({
        method: 'POST', url: '/v1/login/password', headers: { origin: 'https://x2f.test' },
        payload: { loginName: owner.loginName, password: `wrong-password-${i}`, deviceLabel: 'x' },
      });
      expect(pw.statusCode).toBeGreaterThanOrEqual(400);
      const pgp = await t.app.inject({
        method: 'POST', url: '/staff/v1/login/pgp/finish', headers: { origin: STAFF_ORIGIN },
        payload: { challengeId: '00000000-0000-4000-8000-000000000000', code: 'AAAA-AAAA-AAAA', deviceLabel: 'x' },
      });
      expect(pgp.statusCode).toBeGreaterThanOrEqual(400);
    }
    // The in-memory start budget refills within a minute; nothing about the owner is stored.
    t.setNow(new Date(MON_NOON.getTime() + 2 * MIN));
    const { b, res } = await ownerLogin(owner.keys[0]!);
    expect(res.json(), res.body).toEqual({ status: 'ok' });
    expect((await b.get('/staff/v1/me')).json()).toMatchObject({ role: 'owner' });
  }, 300_000);

  it('the owner logs in with the spare key alone', async () => {
    const { res } = await ownerLogin(owner.keys[1]!);
    expect(res.json(), res.body).toEqual({ status: 'ok' });
  });

  it('switch-off, hours, role and delete targeting the owner each get owner-protected, even from the owner', async () => {
    const senior = await staffWithKeys(t, { role: 'senior' });
    const base = `/staff/v1/members/${owner.id}`;
    const tapOn = await tap(owner, { kind: 'switch-on', accountId: owner.id, role: 'mod' });
    const tapRole = await tap(owner, { kind: 'set-role', accountId: owner.id, role: 'mod' });
    const calls: Array<[string, string, unknown]> = [
      ['POST', `${base}/switch-off`, {}],
      ['POST', `${base}/switch-on`, { tapId: tapOn }],
      ['PUT', `${base}/hours`, { hours: { days: ['Mon'], start: '09:00', end: '17:00', tz: 'UTC' } }],
      ['PUT', `${base}/role`, { role: 'mod', tapId: tapRole }],
      ['DELETE', base, undefined],
    ];
    for (const [method, url, body] of calls) {
      const res = await owner.browser.send(method, url, body);
      expect({ url, method, status: res.statusCode, error: errorOf(res) }).toEqual({ url, method, status: 409, error: 'owner-protected' });
      // A senior moderator has no staff.manage at all.
      expect(errorOf(await senior.browser.send(method, url, body))).toBe('forbidden');
    }
    // The refused calls left the taps unused (their transactions rolled back) and the owner as is.
    const { rows } = await t.deps.db.query('select role, hours, switched_off_at, removed_at from staff_members where account_id = $1', [owner.id]);
    expect(rows).toEqual([{ role: 'owner', hours: 'any', switched_off_at: null, removed_at: null }]);
    // The database refuses it too.
    await expect(t.deps.db.query("update staff_members set switched_off_at = now() where account_id = $1", [owner.id])).rejects.toMatchObject({ code: '23514' });
    await expect(t.deps.db.query("update staff_members set role = 'mod' where account_id = $1", [owner.id])).rejects.toMatchObject({ code: '23514' });
  });

  it('adds an owner key with a tap by an existing key; removing below two keys gets owner-needs-two-keys', async () => {
    const list = async () => (await owner.browser.get('/staff/v1/owner/keys')).json().keys as Array<{ id: string; keyCheckCode: string }>;
    const before = await list();
    expect(before).toHaveLength(2);
    // Removing a key goes through the tapped account route (lead review 7 Nov I-1).
    // Owner G4: both owner keys tap (the second by keys[0] unless `second` is false).
    const delKey = async (id: string, second = true) => {
      const intent = { kind: 'remove-method' as const, methodType: 'security-key' as const, methodId: id };
      return owner.browser.send('DELETE', `/staff/v1/account/methods/security-key/${id}`, {
        tapId: await tap(owner, intent, owner.keys[1]),
        ...(second ? { secondTapId: await tap(owner, intent, owner.keys[0]) } : {}),
      });
    };
    expect((await owner.browser.send('DELETE', `/staff/v1/owner/keys/${before[0]!.id}`)).statusCode).toBe(404);
    // Two keys: removing either is refused.
    const del = await delKey(before[0]!.id);
    expect(del.statusCode).toBe(409);
    expect(errorOf(del)).toBe('owner-needs-two-keys');

    const third = t.newKey();
    const start = await owner.browser.post('/staff/v1/owner/keys/start', {});
    expect(start.statusCode, start.body).toBe(200);
    const response = third.register(start.json().options, STAFF_ORIGIN);
    const publicKeySha256 = createHash('sha256').update(third.cosePublicKey).digest('hex');
    // Without a tap, or with a tap for another key: refused, and the challenge can be used again.
    const noTap = await owner.browser.post('/staff/v1/owner/keys/finish', { challengeId: start.json().challengeId, response });
    expect(errorOf(noTap)).toBe('tap-invalid');
    const other = await tap(owner, { kind: 'add-owner-key', credentialId: third.credentialId, publicKeySha256: 'b'.repeat(64) });
    expect(errorOf(await owner.browser.post('/staff/v1/owner/keys/finish', { challengeId: start.json().challengeId, response, tapId: other }))).toBe('tap-invalid');
    const addIntent = { kind: 'add-owner-key' as const, credentialId: third.credentialId, publicKeySha256 };
    // Owner G4: one key's tap alone, or the same key twice, is not both keys.
    const one = await tap(owner, addIntent, owner.keys[1]);
    expect(errorOf(await owner.browser.post('/staff/v1/owner/keys/finish', { challengeId: start.json().challengeId, response, tapId: one }))).toBe('both-owner-keys-required');
    const same = [await tap(owner, addIntent, owner.keys[1]), await tap(owner, addIntent, owner.keys[1])];
    expect(errorOf(await owner.browser.post('/staff/v1/owner/keys/finish', { challengeId: start.json().challengeId, response, tapId: same[0], secondTapId: same[1] }))).toBe('both-owner-keys-required');
    const tapId = await tap(owner, addIntent, owner.keys[1]);
    const secondTapId = await tap(owner, addIntent, owner.keys[0]);
    const fin = await owner.browser.post('/staff/v1/owner/keys/finish', { challengeId: start.json().challengeId, response, tapId, secondTapId });
    expect(fin.statusCode, fin.body).toBe(201);
    expect(fin.json()).toEqual({ id: expect.any(String), keyCheckCode: keyCheckCode(new Uint8Array(third.cosePublicKey)) });
    expect(await logEntries(t.deps, 'owner.key-added')).toContainEqual({ actor_kind: 'staff', detail: JSON.stringify({ credentialId: fin.json().id }) });
    expect(await list()).toHaveLength(3);

    // Three keys: one may go, then no more. It is keys[0], picked by its credential: both keys were
    // added at the same clock time, so the list's order between them follows their random ids.
    const { rows: k0 } = await t.deps.db.query<{ id: string }>('select id from webauthn_credentials where credential_id = $1', [
      Buffer.from(owner.keys[0]!.credentialId, 'base64url'),
    ]);
    const gone = k0[0]!.id;
    expect(before.map((k) => k.id)).toContain(gone);
    expect((await delKey(gone)).statusCode).toBe(204);
    expect(await logEntries(t.deps, 'staff.method-removed')).toContainEqual({ actor_kind: 'staff', detail: JSON.stringify({ method: 'security-key' }) });
    expect(errorOf(await delKey(fin.json().id, false))).toBe('owner-needs-two-keys');
  });

  it('the owner key routes are the owner\'s only', async () => {
    const senior = await staffWithKeys(t, { role: 'senior' });
    expect(errorOf(await senior.browser.get('/staff/v1/owner/keys'))).toBe('forbidden');
    expect(errorOf(await senior.browser.post('/staff/v1/owner/keys/start', {}))).toBe('forbidden');
  });

  it("Plan 2's password, TOTP and recovery-code routes refuse the owner", async () => {
    const { token } = await insertSession(t.deps, owner.id, 'trader');
    const send = (method: 'POST' | 'PUT', url: string, payload: Record<string, unknown>) =>
      t.trader.inject({ method, url, headers: { origin: 'https://x2f.test' }, cookies: { '__Host-x2f_session': token }, payload });
    for (const [method, url] of [['PUT', '/v1/account/password'], ['POST', '/v1/account/totp/start'], ['POST', '/v1/account/recovery-codes']] as const) {
      const res = await send(method, url, { password: 'correct horse battery staple 1', confirmToken: 'x' });
      expect({ url, error: errorOf(res) }).toEqual({ url, error: 'method-not-allowed' });
    }
    // The backup login (a recovery code; an authenticator code is no backup, refused for everyone
    // before any lookup) and the password login: the same answer as any wrong name (no oracle),
    // never a session.
    for (const kind of ['recovery-code']) {
      const res = await t.trader.inject({
        method: 'POST', url: '/v1/login/backup', headers: { origin: 'https://x2f.test' },
        payload: { loginName: owner.loginName, kind, code: '123456', deviceLabel: 'x' },
      });
      expect(errorOf(res)).toBe('credentials-invalid');
    }
    const { rows } = await t.deps.db.query("select 1 from sessions where account_id = $1 and revoked_at is null and app = 'trader' and id <> all(select id from sessions where token_hash = $2)", [
      owner.id, createHash('sha256').update(token).digest(),
    ]);
    expect(rows).toEqual([]);
  });

  // D-032 (owner G60, 7 Nov, after Task 7 was written): the one reset there is: the owner's own,
  // tapped reset of another staff member's security (staff.manage; owner-protected, so never the
  // owner's; securityReset.test.ts). Nothing else may reset, recover or take an email or a password.
  const OWNER_RESET = '/staff/v1/members/:id/reset-security';
  it('no staff route takes an email address or a reset, but the owner\'s tapped reset of another staff member (D-032)', async () => {
    for (const r of t.app.staffRoutes) {
      if (r.url === OWNER_RESET) expect([r.method, r.perm]).toEqual(['POST', 'staff.manage']);
      else expect(r.url, r.url).not.toMatch(/reset|recover|email|password/i);
    }
    const dir = fileURLToPath(new URL('../../src/staff/', import.meta.url));
    for (const f of readdirSync(dir)) {
      const src = readFileSync(dir + f, 'utf8').replaceAll(`'${OWNER_RESET}'`, "''");
      expect(src, f).not.toMatch(/['"`]\/staff\/v1\/[^'"`]*(reset|recover|email)/i);
    }
    // And it never resets the owner, whoever asks (the owner included).
    const res = await owner.browser.post(`/staff/v1/members/${owner.id}/reset-security`, {
      inviteId: '00000000-0000-4000-8000-000000000000', token: 'A'.repeat(43), expiresAt: new Date(MON_NOON.getTime() + 60 * MIN).toISOString(), tapId: 'x',
    });
    expect([res.statusCode, errorOf(res)]).toEqual([409, 'owner-protected']);
  });

  // Review MF1: the reset is the owner role's own, so a grant can never hand it to anyone else.
  it('the reset refuses every non-owner, a senior holding every grantable perm included, and so does its tap', async () => {
    const target = await staffWithKeys(t, { role: 'mod' });
    const body = { inviteId: '00000000-0000-4000-8000-000000000000', token: 'A'.repeat(43), expiresAt: new Date(MON_NOON.getTime() + 60 * MIN).toISOString(), tapId: 'x' };
    for (const role of ['senior', 'mod', 'helper'] as const) {
      const p = await staffWithKeys(t, { role });
      await t.deps.db.query('update staff_members set grants = $2::text[] where account_id = $1', [p.id, [...GRANTABLE_PERMS]]);
      const res = await p.browser.post(`/staff/v1/members/${target.id}/reset-security`, body);
      expect([res.statusCode, errorOf(res)], role).toEqual([403, 'forbidden']);
      const start = await p.browser.post('/staff/v1/taps/start', {
        kind: 'reset-staff-security', accountId: target.id, inviteId: body.inviteId, tokenHash: 'a'.repeat(64), expiresAt: body.expiresAt,
      });
      expect([start.statusCode, errorOf(start)], role).toEqual([403, 'forbidden']);
    }
  });

  it('maintenance and the emergency stop leave every staff route working', async () => {
    await t.deps.db.query("update site_flags set trading_paused = true, maintenance_since = $1, maintenance_kind = 'unplanned'", [MON_NOON]);
    try {
      expect((await owner.browser.get('/staff/v1/me')).statusCode).toBe(200);
      expect((await owner.browser.get('/staff/v1/members')).statusCode).toBe(200);
      expect((await owner.browser.get('/staff/v1/owner/keys')).statusCode).toBe(200);
      // keys[0] was removed by the owner-key test above; the spare logs in.
      const { res } = await ownerLogin(owner.keys[1]!);
      expect(res.json(), res.body).toEqual({ status: 'ok' });
    } finally {
      await t.deps.db.query('update site_flags set trading_paused = false, maintenance_since = null, maintenance_kind = null');
    }
  });
});
