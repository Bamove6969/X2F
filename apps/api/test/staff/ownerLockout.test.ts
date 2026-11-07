// Plan 4 Task 7: the owner can never be locked out, demoted, switched off or "reset".
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { keyCheckCode } from '@x2f/staff';
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
    expect(res.json()).toEqual({ status: 'ok' });
    expect((await b.get('/staff/v1/me')).json()).toMatchObject({ role: 'owner' });
  }, 300_000);

  it('the owner logs in with the spare key alone', async () => {
    const { res } = await ownerLogin(owner.keys[1]!);
    expect(res.json()).toEqual({ status: 'ok' });
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
    // Two keys: removing either is refused.
    const del = await owner.browser.send('DELETE', `/staff/v1/owner/keys/${before[0]!.id}`);
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
    const tapId = await tap(owner, { kind: 'add-owner-key', credentialId: third.credentialId, publicKeySha256 }, owner.keys[1]);
    const fin = await owner.browser.post('/staff/v1/owner/keys/finish', { challengeId: start.json().challengeId, response, tapId });
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
    expect((await owner.browser.send('DELETE', `/staff/v1/owner/keys/${gone}`)).statusCode).toBe(204);
    expect(await logEntries(t.deps, 'owner.key-removed')).toContainEqual({ actor_kind: 'staff', detail: JSON.stringify({ credentialId: gone }) });
    expect(errorOf(await owner.browser.send('DELETE', `/staff/v1/owner/keys/${fin.json().id}`))).toBe('owner-needs-two-keys');
    // Not the owner's key: 404.
    expect((await owner.browser.send('DELETE', '/staff/v1/owner/keys/00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
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
    // The backup login (TOTP or a recovery code) and the password login: the same answer as any
    // wrong name (no oracle), never a session.
    for (const kind of ['totp', 'recovery-code']) {
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

  it('no staff route takes an email address or a reset', () => {
    for (const r of t.app.staffRoutes) expect(r.url, r.url).not.toMatch(/reset|recover|email|password/i);
    const dir = fileURLToPath(new URL('../../src/staff/', import.meta.url));
    for (const f of readdirSync(dir)) {
      const src = readFileSync(dir + f, 'utf8');
      expect(src, f).not.toMatch(/['"`]\/staff\/v1\/[^'"`]*(reset|recover|email)/i);
    }
  });

  it('maintenance and the emergency stop leave every staff route working', async () => {
    await t.deps.db.query('update site_flags set trading_paused = true, maintenance_since = $1', [MON_NOON]);
    try {
      expect((await owner.browser.get('/staff/v1/me')).statusCode).toBe(200);
      expect((await owner.browser.get('/staff/v1/members')).statusCode).toBe(200);
      expect((await owner.browser.get('/staff/v1/owner/keys')).statusCode).toBe(200);
      // keys[0] was removed by the owner-key test above; the spare logs in.
      const { res } = await ownerLogin(owner.keys[1]!);
      expect(res.json()).toEqual({ status: 'ok' });
    } finally {
      await t.deps.db.query('update site_flags set trading_paused = false, maintenance_since = null');
    }
  });
});
