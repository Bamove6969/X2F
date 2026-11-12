// D-032 (owner G60, 7 Nov 2026): a moderator who loses their only key and has no recovery code
// reaches the owner, who vets them and resets their security; they then set their methods up again.
// "Build the owner's reset, tapped" (owner-decisions G60). Lead reading (owner question): the reset
// hands the person a one-time re-enrolment link on the invite pages, keeping their login name, role
// and hours, instead of a password (staff have no passwords; Q-B3).
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { KeyTapIntent } from '@x2f/staff';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { verifyLogChain } from '../../src/log/verify.js';
import { purgeStaffInviteLeftovers } from '../../src/staff/invites.js';
import { sealTermsSignature } from '../../src/termsSignature.js';
import { codeOf, decrypt, genKey, type Pair } from '../helpers/pgpKeys.js';
import { SIG } from '../helpers/signature.js';
import type { SoftAuthenticator } from '../helpers/softAuthenticator.js';
import { STAFF_ORIGIN, StaffBrowser, errorOf, insertSession, logEntries } from '../helpers/staffApp.js';
import { addPgpKey, attestedStaffApps, registerKey, resetBudgets, staffWithKeys, tap, type AttestedStaffApps, type Person } from '../helpers/staffKeys.js';

const NOW = new Date('2026-11-12T12:00:00Z');
const HOUR = 3_600_000;

let t: AttestedStaffApps;
let owner: Person;

beforeAll(async () => {
  t = await attestedStaffApps();
  t.setNow(NOW);
  owner = await staffWithKeys(t, { role: 'owner' });
});
afterAll(async () => t.close());
beforeEach(() => {
  t.setNow(NOW);
  resetBudgets(t);
});

/** What the owner's browser makes for a reset link (as for an invite: the token never leaves it but in the request). */
function newReset(accountId: string, ttlMs = 24 * HOUR) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
  const inviteId = randomUUID();
  const expiresAt = new Date(t.deps.clock().getTime() + ttlMs).toISOString();
  const intent: KeyTapIntent = { kind: 'reset-staff-security', accountId, inviteId, tokenHash, expiresAt };
  return { token, tokenHash, inviteId, expiresAt, intent };
}

const resetUrl = (id: string) => `/staff/v1/members/${id}/reset-security`;
const acceptUrl = (token: string, step = '') => `/staff/v1/invites/accept/${token}${step}`;

async function count(table: 'webauthn_credentials' | 'pgp_keys' | 'trusted_devices', id: string): Promise<number> {
  return (await t.deps.db.query<{ n: number }>(`select count(*)::int as n from ${table} where account_id = $1`, [id])).rows[0]!.n;
}

/** A moderator holding a security key, a PGP key and a passkey. */
async function fullMod(): Promise<Person> {
  const mod = await staffWithKeys(t, { role: 'mod' });
  await addPgpKey(t.deps, mod.id);
  await registerKey(t.app, mod.id, t.newKey({ passkey: true }), { passkey: true });
  return mod;
}

async function reset(target: string) {
  const r = newReset(target);
  const tapId = await tap(owner, r.intent);
  const res = await owner.browser.post(resetUrl(target), { inviteId: r.inviteId, token: r.token, expiresAt: r.expiresAt, tapId });
  return { ...r, res };
}

async function addKey(b: StaffBrowser, token: string, key: SoftAuthenticator, kind: 'security-key' | 'passkey') {
  const start = await b.post(acceptUrl(token, '/key/start'), { kind });
  if (start.statusCode !== 200) return start;
  return b.post(acceptUrl(token, '/key/finish'), { kind, response: key.register(start.json().options, STAFF_ORIGIN) });
}

async function addPgp(b: StaffBrowser, token: string, pair: Pair) {
  const start = await b.post(acceptUrl(token, '/pgp/start'), { publicKey: pair.publicKey });
  if (start.statusCode !== 200) return start;
  const { challengeId, encryptedMessage } = start.json();
  const code = codeOf(await decrypt(encryptedMessage, pair.privateKey, undefined, t.deps.clock()));
  return b.post(acceptUrl(token, '/pgp/finish'), { challengeId, code });
}

describe('the owner resets a staff member\'s security (D-032, owner G60)', () => {
  it('tapped and bound to the person and the link; the old methods are gone, every session ends, the account waits for the link', async () => {
    const mod = await fullMod();
    await t.deps.db.query('insert into trusted_devices (account_id, device_hash, created_at, last_used_at) values ($1, $2, $3, $3)', [mod.id, randomBytes(32), NOW]);
    expect((await mod.browser.get('/staff/v1/me')).statusCode).toBe(200);
    const r = newReset(mod.id);
    const body = { inviteId: r.inviteId, token: r.token, expiresAt: r.expiresAt };
    // No tap, or a tap for another person or another link: refused, nothing changed.
    expect(errorOf(await owner.browser.post(resetUrl(mod.id), body))).toBe('tap-invalid');
    const other = await tap(owner, { ...r.intent, accountId: owner.id } as KeyTapIntent);
    expect(errorOf(await owner.browser.post(resetUrl(mod.id), { ...body, tapId: other }))).toBe('tap-invalid');
    const otherLink = await tap(owner, { ...r.intent, tokenHash: 'a'.repeat(64) } as KeyTapIntent);
    expect(errorOf(await owner.browser.post(resetUrl(mod.id), { ...body, tapId: otherLink }))).toBe('tap-invalid');
    expect(await count('webauthn_credentials', mod.id)).toBe(2);

    const tapId = await tap(owner, r.intent);
    const res = await owner.browser.post(resetUrl(mod.id), { ...body, tapId });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toEqual({ inviteId: r.inviteId, link: `${STAFF_ORIGIN}/invite/${r.token}`, expiresAt: r.expiresAt });
    // Every old method and known device is gone (a found key must not work), and the token is never stored.
    expect([await count('webauthn_credentials', mod.id), await count('pgp_keys', mod.id), await count('trusted_devices', mod.id)]).toEqual([0, 0, 0]);
    expect(JSON.stringify((await t.deps.db.query('select * from staff_invites')).rows)).not.toContain(r.token);
    // The live session is over; a new one is refused while the account waits for the link.
    expect(errorOf(await mod.browser.get('/staff/v1/me'))).toBe('not-authenticated');
    const { token } = await insertSession(t.deps, mod.id, 'staff');
    expect(errorOf(await new StaffBrowser(t.app).withSession(token).get('/staff/v1/me'))).toBe('account-disabled');
    // Still a moderator, still on the list as such (not switched off), and no waiting invite row.
    const rows = (await owner.browser.get('/staff/v1/members')).json().members as Array<Record<string, unknown>>;
    expect(rows.find((x) => x.accountId === mod.id)).toMatchObject({ role: 'mod', status: 'active' });
    expect(rows.find((x) => x.inviteId === r.inviteId)).toBeUndefined();
    expect(await logEntries(t.deps, 'staff.security-reset')).toContainEqual({ actor_kind: 'staff', detail: JSON.stringify({ inviteId: r.inviteId, staffId: mod.id }) });
    expect(await verifyLogChain(t.deps.db)).toMatchObject({ ok: true });
  });

  it('the link re-enrols the same person: same login name, role and hours; a passkey and a PGP key finish (D-070); used once', async () => {
    const mod = await fullMod();
    const before = (await t.deps.db.query('select login_tag, display_name from accounts where id = $1', [mod.id])).rows[0];
    const r = await reset(mod.id);
    expect(r.res.statusCode, r.res.body).toBe(201);
    const b = new StaffBrowser(t.app);
    const view = await b.get(acceptUrl(r.token));
    expect(view.json()).toEqual({ role: 'mod', hours: 'any', expiresAt: r.expiresAt, resume: { keys: 0, passkeys: 0, pgp: 0, keyCheckCode: null }, reset: true });
    // The names and the Terms are already theirs.
    expect(errorOf(await b.post(acceptUrl(r.token, '/account'), { displayName: 'Other', loginName: 'other1', acceptedTerms: t.deps.config.termsVersion, termsSignature: SIG }))).toBe('wrong-state');
    expect((await addPgp(b, r.token, await genKey())).statusCode).toBe(201);
    const early = await b.post(acceptUrl(r.token, '/finish'), {});
    expect([early.statusCode, errorOf(early)]).toEqual([409, 'two-factors-required']);
    expect((await addKey(b, r.token, t.newKey({ passkey: true }), 'passkey')).statusCode).toBe(201);
    const fin = await b.post(acceptUrl(r.token, '/finish'), {});
    expect([fin.statusCode, fin.json()]).toEqual([201, { keyCheckCode: null }]);
    expect((await t.deps.db.query('select login_tag, display_name from accounts where id = $1', [mod.id])).rows[0]).toEqual(before);
    expect((await t.deps.db.query('select role, has_security_key, switched_off_at, removed_at from staff_members where account_id = $1', [mod.id])).rows)
      .toEqual([{ role: 'mod', has_security_key: false, switched_off_at: null, removed_at: null }]);
    const { token } = await insertSession(t.deps, mod.id, 'staff');
    expect((await new StaffBrowser(t.app).withSession(token).get('/staff/v1/me')).statusCode).toBe(200);
    expect(await logEntries(t.deps, 'staff.security-reset-finished')).toContainEqual({ actor_kind: 'staff', detail: JSON.stringify({ staffId: mod.id }) });
    expect(await logEntries(t.deps, 'staff.joined')).not.toContainEqual(expect.objectContaining({ detail: expect.stringContaining(mod.id) }));
    expect(errorOf(await b.get(acceptUrl(r.token)))).toBe('invite-invalid');
  });

  it('a switched-off member reset stays switched off after the link is used', async () => {
    const mod = await fullMod();
    expect((await owner.browser.post(`/staff/v1/members/${mod.id}/switch-off`, {})).statusCode).toBe(200);
    const r = await reset(mod.id);
    expect(r.res.statusCode, r.res.body).toBe(201);
    const b = new StaffBrowser(t.app);
    expect((await addPgp(b, r.token, await genKey())).statusCode).toBe(201);
    expect((await addKey(b, r.token, t.newKey({ passkey: true }), 'passkey')).statusCode).toBe(201);
    expect((await b.post(acceptUrl(r.token, '/finish'), {})).statusCode).toBe(201);
    const { token } = await insertSession(t.deps, mod.id, 'staff');
    expect(errorOf(await new StaffBrowser(t.app).withSession(token).get('/staff/v1/me'))).toBe('account-disabled');
  });

  it('a second reset replaces the first link; removing the member ends an open link', async () => {
    const mod = await fullMod();
    const first = await reset(mod.id);
    expect(first.res.statusCode).toBe(201);
    const second = await reset(mod.id);
    expect(second.res.statusCode, second.res.body).toBe(201);
    expect(errorOf(await new StaffBrowser(t.app).get(acceptUrl(first.token)))).toBe('invite-invalid');
    expect((await new StaffBrowser(t.app).get(acceptUrl(second.token))).statusCode).toBe(200);
    const removeTap = await tap(owner, { kind: 'remove-staff', accountId: mod.id });
    expect((await owner.browser.send('DELETE', `/staff/v1/members/${mod.id}`, { tapId: removeTap })).statusCode).toBe(204);
    expect(errorOf(await new StaffBrowser(t.app).get(acceptUrl(second.token)))).toBe('invite-invalid');
  });

  it('cancelling a reset link, or its expiry sweep, keeps the member\'s Terms signature (they are staff, not a half-made sign-up)', async () => {
    const signature = async (id: string) =>
      (await t.deps.db.query<{ terms_signature: Buffer | null }>('select terms_signature from accounts where id = $1', [id])).rows[0]!.terms_signature;
    const a = await fullMod();
    const b = await fullMod();
    for (const p of [a, b]) await t.deps.db.query('update accounts set terms_signature = $2 where id = $1', [p.id, sealTermsSignature(t.deps.config, SIG, p.id)]);
    const ra = await reset(a.id);
    const rb = await reset(b.id);
    expect((await owner.browser.send('DELETE', `/staff/v1/invites/${ra.inviteId}`)).statusCode).toBe(204);
    expect(await signature(a.id)).not.toBeNull();
    expect(errorOf(await new StaffBrowser(t.app).get(acceptUrl(ra.token)))).toBe('invite-invalid');
    t.setNow(new Date(NOW.getTime() + 26 * HOUR));
    await purgeStaffInviteLeftovers.run(t.deps.db, t.deps.clock());
    expect(await signature(b.id)).not.toBeNull();
    expect(errorOf(await new StaffBrowser(t.app).get(acceptUrl(rb.token)))).toBe('invite-invalid');
  });

  it('only the owner resets (staff.manage); never the owner; someone not on the staff is 404; the input is checked', async () => {
    const senior = await staffWithKeys(t, { role: 'senior' });
    const mod = await fullMod();
    const r = newReset(mod.id);
    expect((await senior.browser.post(resetUrl(mod.id), { inviteId: r.inviteId, token: r.token, expiresAt: r.expiresAt, tapId: 'x' })).statusCode).toBe(403);
    const self = newReset(owner.id);
    const selfTap = await tap(owner, self.intent);
    expect(errorOf(await owner.browser.post(resetUrl(owner.id), { inviteId: self.inviteId, token: self.token, expiresAt: self.expiresAt, tapId: selfTap }))).toBe('owner-protected');
    expect((await t.deps.db.query('select used_at from key_taps where id = $1', [selfTap])).rows).toEqual([{ used_at: null }]);
    const stranger = newReset(randomUUID());
    expect((await owner.browser.post(resetUrl(randomUUID()), { inviteId: stranger.inviteId, token: stranger.token, expiresAt: stranger.expiresAt, tapId: 'x' })).statusCode).toBe(404);
    for (const bad of [
      { inviteId: 'nope', token: r.token, expiresAt: r.expiresAt },
      { inviteId: r.inviteId, token: 'short', expiresAt: r.expiresAt },
      { inviteId: r.inviteId, token: r.token, expiresAt: new Date(NOW.getTime() + 25 * HOUR).toISOString() },
      { inviteId: r.inviteId, token: r.token, expiresAt: new Date(NOW.getTime() - HOUR).toISOString() },
    ]) {
      expect((await owner.browser.post(resetUrl(mod.id), { ...bad, tapId: 'x' })).statusCode, JSON.stringify(bad)).toBe(400);
    }
    expect(await count('webauthn_credentials', mod.id)).toBe(2);
  });
});
