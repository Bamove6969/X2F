// Plan 4 Task 7: staff management (members, invites, switch off and on, hours, roles, removal).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { keyCheckCode, type LoginHours } from '@x2f/staff';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { verifyLogChain } from '../../src/log/verify.js';
import { codeOf, decrypt, genKey, type Pair } from '../helpers/pgpKeys.js';
import type { SoftAuthenticator } from '../helpers/softAuthenticator.js';
import { SESSION_COOKIE, STAFF_ORIGIN, StaffBrowser, errorOf, insertSession, logEntries, seedStaff } from '../helpers/staffApp.js';
import { attestedStaffApps, resetBudgets, newInvite, registerKey, staffWithKeys, tap, type AttestedStaffApps, type Person } from '../helpers/staffKeys.js';

const MON_NOON = new Date('2026-11-02T12:00:00Z');
const HOUR = 3_600_000;
const OFFICE: LoginHours = { days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], start: '09:00', end: '17:00', tz: 'UTC' };

let t: AttestedStaffApps;
let owner: Person;

beforeAll(async () => {
  t = await attestedStaffApps();
  t.setNow(MON_NOON);
  owner = await staffWithKeys(t, { role: 'owner' });
});
afterAll(async () => t.close());
beforeEach(() => {
  t.setNow(MON_NOON);
  // The in-memory budgets (limits.ts) are per process and shared by all; each test starts full.
  resetBudgets(t);
});

let names = 0;
const loginName = () => `invitee${++names}${Date.now().toString(36)}`;

/** The owner creates an invite (tap and all); returns the token and the reply. */
async function createInvite(role: 'senior' | 'mod' | 'helper', hours: LoginHours = OFFICE) {
  const inv = newInvite(t.deps.clock(), { role });
  const tapId = await tap(owner, inv.intent);
  const res = await owner.browser.post('/staff/v1/invites', { role, hours, inviteId: inv.inviteId, token: inv.token, expiresAt: inv.expiresAt, tapId });
  return { ...inv, res };
}

/** The invitee's browser on the staff origin (no session). */
const invitee = () => new StaffBrowser(t.app);
const acceptUrl = (token: string, step = '') => `/staff/v1/invites/accept/${token}${step}`;

async function pickNames(b: StaffBrowser, token: string) {
  const n = loginName();
  const res = await b.post(acceptUrl(token, '/account'), { username: `Mod${n}`, loginName: n });
  return { res, loginName: n, username: `Mod${n}` };
}

async function addInviteKey(b: StaffBrowser, token: string, key: SoftAuthenticator, kind: 'security-key' | 'passkey' = 'security-key') {
  const start = await b.post(acceptUrl(token, '/key/start'), { kind });
  if (start.statusCode !== 200) return start;
  return b.post(acceptUrl(token, '/key/finish'), { kind, response: key.register(start.json().options, STAFF_ORIGIN) });
}

async function addInvitePgp(b: StaffBrowser, token: string, pair: Pair) {
  const start = await b.post(acceptUrl(token, '/pgp/start'), { publicKey: pair.publicKey });
  if (start.statusCode !== 200) return start;
  const { challengeId, encryptedMessage } = start.json();
  const code = codeOf(await decrypt(encryptedMessage, pair.privateKey, undefined, t.deps.clock()));
  return b.post(acceptUrl(token, '/pgp/finish'), { challengeId, code });
}

/** A whole sign-up: names, a security key (unless `noKey`), one PGP key (two with `twoPgp`), finish. */
async function signUp(token: string, o: { noKey?: boolean; twoPgp?: boolean } = {}) {
  const b = invitee();
  const names = await pickNames(b, token);
  expect(names.res.statusCode, names.res.body).toBe(201);
  const key = t.newKey();
  if (!o.noKey) expect((await addInviteKey(b, token, key)).statusCode).toBe(201);
  expect((await addInvitePgp(b, token, await genKey())).statusCode).toBe(201);
  if (o.twoPgp) expect((await addInvitePgp(b, token, await genKey())).statusCode).toBe(201);
  const finish = await b.post(acceptUrl(token, '/finish'), {});
  return { b, key, finish, ...names };
}

async function accountOf(loginName: string): Promise<string> {
  const { accountIdByLoginName } = await import('../helpers/accounts.js');
  return (await accountIdByLoginName(t.deps, loginName))!;
}

describe('invites', () => {
  it('creates a moderator with a security key; the link works once', async () => {
    const inv = await createInvite('mod');
    expect(inv.res.statusCode, inv.res.body).toBe(201);
    expect(inv.res.json()).toEqual({ inviteId: inv.inviteId, link: `${STAFF_ORIGIN}/invite/${inv.token}`, expiresAt: inv.expiresAt });
    // The token is never stored: only its hash.
    const { rows } = await t.deps.db.query<{ token_hash: string; role: string; tap_id: string }>(
      'select token_hash, role, tap_id from staff_invites where id = $1',
      [inv.inviteId],
    );
    expect(rows).toEqual([{ token_hash: inv.tokenHash, role: 'mod', tap_id: expect.any(String) }]);
    const dump = JSON.stringify((await t.deps.db.query('select * from staff_invites')).rows);
    expect(dump).not.toContain(inv.token);
    expect(await logEntries(t.deps, 'staff.invite-created')).toContainEqual({ actor_kind: 'staff', detail: JSON.stringify({ inviteId: inv.inviteId, role: 'mod' }) });

    const view = await invitee().get(acceptUrl(inv.token));
    expect(view.json()).toEqual({ role: 'mod', hours: OFFICE, expiresAt: inv.expiresAt });

    const s = await signUp(inv.token);
    expect(s.finish.statusCode, s.finish.body).toBe(201);
    const id = await accountOf(s.loginName);
    const { rows: cred } = await t.deps.db.query<{ public_key: Buffer }>('select public_key from webauthn_credentials where account_id = $1', [id]);
    expect(s.finish.json()).toEqual({ keyCheckCode: keyCheckCode(new Uint8Array(cred[0]!.public_key)) });
    const { rows: m } = await t.deps.db.query('select role, hours, has_security_key, switched_off_at from staff_members where account_id = $1', [id]);
    expect(m).toEqual([{ role: 'mod', hours: OFFICE, has_security_key: true, switched_off_at: null }]);
    const { rows: a } = await t.deps.db.query('select kind, disabled_at from accounts where id = $1', [id]);
    expect(a).toEqual([{ kind: 'staff', disabled_at: null }]);
    expect(await logEntries(t.deps, 'staff.joined')).toContainEqual({ actor_kind: 'staff', detail: JSON.stringify({ role: 'mod', staffId: id }) });

    // A second use of the link.
    expect(errorOf(await invitee().get(acceptUrl(inv.token)))).toBe('invite-invalid');
    expect(errorOf(await invitee().post(acceptUrl(inv.token, '/account'), { username: 'Again1', loginName: 'againlogin1' }))).toBe('invite-invalid');
    expect(errorOf(await s.b.post(acceptUrl(inv.token, '/finish'), {}))).toBe('invite-invalid');
  });

  it('the registration challenge is inviteRegistrationChallenge(tokenHash)', async () => {
    const { inviteRegistrationChallenge } = await import('@x2f/staff');
    const inv = await createInvite('mod');
    const b = invitee();
    await pickNames(b, inv.token);
    const start = await b.post(acceptUrl(inv.token, '/key/start'), { kind: 'security-key' });
    expect(start.json().options.challenge).toBe(Buffer.from(inviteRegistrationChallenge(inv.tokenHash)).toString('base64url'));
  });

  it('a link is invalid after 24 hours, and once cancelled', async () => {
    const late = await createInvite('helper');
    t.setNow(new Date(MON_NOON.getTime() + 24 * HOUR));
    expect(errorOf(await invitee().get(acceptUrl(late.token)))).toBe('invite-invalid');
    t.setNow(MON_NOON);

    const gone = await createInvite('helper');
    const b = invitee();
    expect((await pickNames(b, gone.token)).res.statusCode).toBe(201);
    const del = await owner.browser.send('DELETE', `/staff/v1/invites/${gone.inviteId}`);
    expect(del.statusCode).toBe(204);
    expect(await logEntries(t.deps, 'staff.invite-cancelled')).toContainEqual({ actor_kind: 'staff', detail: JSON.stringify({ inviteId: gone.inviteId }) });
    expect(errorOf(await invitee().get(acceptUrl(gone.token)))).toBe('invite-invalid');
    expect(errorOf(await b.post(acceptUrl(gone.token, '/finish'), {}))).toBe('invite-invalid');
    // Cancelling twice, or an unknown invite: 404.
    expect((await owner.browser.send('DELETE', `/staff/v1/invites/${gone.inviteId}`)).statusCode).toBe(404);
    // A made-up token.
    expect(errorOf(await invitee().get(acceptUrl('A'.repeat(43))))).toBe('invite-invalid');
  });

  it('a moderator invitee with only PGP gets security-key-required; a helper with two PGP keys joins', async () => {
    const mod = await createInvite('mod');
    const m = await signUp(mod.token, { noKey: true, twoPgp: true });
    expect(m.finish.statusCode).toBe(409);
    expect(errorOf(m.finish)).toBe('security-key-required');
    // Still open: adding a key now finishes.
    expect((await addInviteKey(m.b, mod.token, t.newKey())).statusCode).toBe(201);
    expect((await m.b.post(acceptUrl(mod.token, '/finish'), {})).statusCode).toBe(201);

    const helper = await createInvite('helper');
    const h = await signUp(helper.token, { noKey: true, twoPgp: true });
    expect(h.finish.statusCode, h.finish.body).toBe(201);
    expect(h.finish.json()).toEqual({ keyCheckCode: null });
  });

  it('every staff login is two factors: one PGP key alone gets two-factors-required', async () => {
    const helper = await createInvite('helper');
    const h = await signUp(helper.token, { noKey: true });
    expect(h.finish.statusCode).toBe(409);
    expect(errorOf(h.finish)).toBe('two-factors-required');
    // A passkey is PGP's partner for staff (spec 6.6).
    expect((await addInviteKey(h.b, helper.token, t.newKey({ passkey: true }), 'passkey')).statusCode).toBe(201);
    expect((await h.b.post(acceptUrl(helper.token, '/finish'), {})).statusCode).toBe(201);
  });

  it('the account cannot log in before finish, and the names are picked once', async () => {
    const inv = await createInvite('mod');
    const b = invitee();
    const n = await pickNames(b, inv.token);
    const id = await accountOf(n.loginName);
    const { rows } = await t.deps.db.query<{ disabled_at: Date | null }>('select disabled_at from accounts where id = $1', [id]);
    expect(rows[0]!.disabled_at).not.toBeNull();
    const again = await b.post(acceptUrl(inv.token, '/account'), { username: 'Other1x', loginName: 'otherlogin1x' });
    expect(again.statusCode).toBe(409);
    // Keys and PGP before the names: refused.
    const fresh = await createInvite('mod');
    expect((await invitee().post(acceptUrl(fresh.token, '/key/start'), { kind: 'security-key' })).statusCode).toBe(409);
  });

  it('refuses an invite whose tap was for another invite, and a tap reused', async () => {
    const a = newInvite(t.deps.clock(), { role: 'mod' });
    const b = newInvite(t.deps.clock(), { role: 'mod' });
    const tapA = await tap(owner, a.intent);
    const wrong = await owner.browser.post('/staff/v1/invites', { role: 'mod', hours: OFFICE, inviteId: b.inviteId, token: b.token, expiresAt: b.expiresAt, tapId: tapA });
    expect(errorOf(wrong)).toBe('tap-invalid');
    // The role is in the intent too.
    const asSenior = await owner.browser.post('/staff/v1/invites', { role: 'senior', hours: OFFICE, inviteId: a.inviteId, token: a.token, expiresAt: a.expiresAt, tapId: tapA });
    expect(errorOf(asSenior)).toBe('tap-invalid');
    const ok = await owner.browser.post('/staff/v1/invites', { role: 'mod', hours: OFFICE, inviteId: a.inviteId, token: a.token, expiresAt: a.expiresAt, tapId: tapA });
    expect(ok.statusCode).toBe(201);
    const c = newInvite(t.deps.clock(), { role: 'mod' });
    const reused = await owner.browser.post('/staff/v1/invites', { role: 'mod', hours: OFFICE, inviteId: c.inviteId, token: c.token, expiresAt: c.expiresAt, tapId: tapA });
    expect(errorOf(reused)).toBe('tap-invalid');
  });

  it('checks the input: the role, the hours, the token and the expiry', async () => {
    const bad = async (patch: Record<string, unknown>, intentRole: 'mod' | 'helper' = 'mod') => {
      const inv = newInvite(t.deps.clock(), { role: intentRole });
      return owner.browser.post('/staff/v1/invites', {
        role: intentRole, hours: OFFICE, inviteId: inv.inviteId, token: inv.token, expiresAt: inv.expiresAt, tapId: '00000000-0000-4000-8000-000000000000', ...patch,
      });
    };
    expect(errorOf(await bad({ role: 'owner' }))).toBe('bad-request');
    expect(errorOf(await bad({ hours: { days: [], start: '09:00', end: '17:00', tz: 'UTC' } }))).toBe('bad-request');
    expect(errorOf(await bad({ token: 'short' }))).toBe('bad-request');
    expect(errorOf(await bad({ expiresAt: new Date(MON_NOON.getTime() + 25 * HOUR).toISOString() }))).toBe('bad-request');
    expect(errorOf(await bad({ expiresAt: new Date(MON_NOON.getTime() - 1).toISOString() }))).toBe('bad-request');
  });
});

describe('members', () => {
  it('lists staff and waiting invites', async () => {
    const mod = await staffWithKeys(t, { role: 'mod', hours: OFFICE });
    const inv = await createInvite('helper');
    const res = await owner.browser.get('/staff/v1/members');
    expect(res.statusCode).toBe(200);
    const rows = res.json().members as Array<Record<string, unknown>>;
    expect(rows).toContainEqual({
      accountId: mod.id, inviteId: null, username: `D${mod.loginName}`, role: 'mod', status: 'active', hours: OFFICE,
      joinedAt: MON_NOON.toISOString(), lastActiveAt: MON_NOON.toISOString(), openCases: 0, expiresAt: null,
    });
    expect(rows).toContainEqual({
      accountId: null, inviteId: inv.inviteId, username: null, role: 'helper', status: 'waiting', hours: OFFICE,
      joinedAt: null, lastActiveAt: null, openCases: 0, expiresAt: inv.expiresAt,
    });
    expect(rows.find((r) => r.accountId === owner.id)).toMatchObject({ role: 'owner', status: 'active', hours: 'any' });
  });

  it('switch-off takes effect at once; past log entries stay and the chain verifies', async () => {
    const mod = await staffWithKeys(t, { role: 'mod' });
    expect((await mod.browser.get('/staff/v1/me')).statusCode).toBe(200);
    // A trader-site session left from before the split (RV5 Q5): switch-off ends it as well.
    const old = await insertSession(t.deps, mod.id, 'trader');
    const before = (await t.deps.db.query('select id, hash from activity_log order by id')).rows;
    const res = await owner.browser.post(`/staff/v1/members/${mod.id}/switch-off`, {});
    expect(res.statusCode, res.body).toBe(200);
    // Its session is ended: the next request is refused.
    const me = await mod.browser.get('/staff/v1/me');
    expect(me.statusCode).toBe(401);
    expect(errorOf(me)).toBe('not-authenticated');
    const { rows: live } = await t.deps.db.query('select 1 from sessions where account_id = $1 and revoked_at is null', [mod.id]);
    expect(live).toEqual([]);
    const onTrader = await t.trader.inject({ method: 'GET', url: '/v1/account/me', headers: { cookie: `${SESSION_COOKIE}=${old.token}` } });
    expect(onTrader.statusCode).toBe(401);
    const { rows: a } = await t.deps.db.query<{ disabled_at: Date | null; switched_off_at: Date | null }>(
      'select a.disabled_at, m.switched_off_at from accounts a join staff_members m on m.account_id = a.id where a.id = $1',
      [mod.id],
    );
    expect(a[0]!.disabled_at).toEqual(MON_NOON);
    expect(a[0]!.switched_off_at).toEqual(MON_NOON);
    expect(await logEntries(t.deps, 'staff.switched-off')).toContainEqual({ actor_kind: 'staff', detail: JSON.stringify({ staffId: mod.id }) });
    const after = (await t.deps.db.query('select id, hash from activity_log order by id')).rows;
    expect(after.slice(0, before.length)).toEqual(before);
    expect(await verifyLogChain(t.deps.db)).toMatchObject({ ok: true });
    // Switched off already.
    expect(errorOf(await owner.browser.post(`/staff/v1/members/${mod.id}/switch-off`, {}))).toBe('wrong-state');
    expect((await owner.browser.get('/staff/v1/members')).json().members).toContainEqual(expect.objectContaining({ accountId: mod.id, status: 'switched-off' }));
  });

  it('switch-on needs a tap bound to the person and their role', async () => {
    const mod = await staffWithKeys(t, { role: 'mod' });
    await owner.browser.post(`/staff/v1/members/${mod.id}/switch-off`, {});
    expect(errorOf(await owner.browser.post(`/staff/v1/members/${mod.id}/switch-on`, {}))).toBe('tap-invalid');
    const wrongRole = await tap(owner, { kind: 'switch-on', accountId: mod.id, role: 'senior' });
    expect(errorOf(await owner.browser.post(`/staff/v1/members/${mod.id}/switch-on`, { tapId: wrongRole }))).toBe('tap-invalid');
    const tapId = await tap(owner, { kind: 'switch-on', accountId: mod.id, role: 'mod' });
    const res = await owner.browser.post(`/staff/v1/members/${mod.id}/switch-on`, { tapId });
    expect(res.statusCode, res.body).toBe(200);
    expect(await logEntries(t.deps, 'staff.switched-on')).toContainEqual({ actor_kind: 'staff', detail: JSON.stringify({ role: 'mod', staffId: mod.id }) });
    const { token } = await insertSession(t.deps, mod.id, 'staff');
    expect((await new StaffBrowser(t.app).withSession(token).get('/staff/v1/me')).statusCode).toBe(200);
  });

  it('sets login hours (checked), logged; the session follows the new hours at once', async () => {
    const mod = await staffWithKeys(t, { role: 'mod' });
    expect(errorOf(await owner.browser.send('PUT', `/staff/v1/members/${mod.id}/hours`, { hours: { days: ['Mon'], start: '09:00', end: '09:00', tz: 'UTC' } }))).toBe('bad-request');
    const night: LoginHours = { days: ['Sun'], start: '00:00', end: '00:01', tz: 'UTC' };
    const res = await owner.browser.send('PUT', `/staff/v1/members/${mod.id}/hours`, { hours: night });
    expect(res.statusCode, res.body).toBe(200);
    expect(await logEntries(t.deps, 'staff.hours-set')).toContainEqual({ actor_kind: 'staff', detail: JSON.stringify({ staffId: mod.id }) });
    expect(errorOf(await mod.browser.get('/staff/v1/me'))).toBe('outside-login-hours');
  });

  it('sets a role with a tap; a moderator role needs a security key', async () => {
    const helperOnlyPgp = await seedStaff(t.deps, { role: 'helper' });
    await t.deps.db.query('update staff_members set has_security_key = false where account_id = $1', [helperOnlyPgp.id]);
    const up = await tap(owner, { kind: 'set-role', accountId: helperOnlyPgp.id, role: 'mod' });
    expect(errorOf(await owner.browser.send('PUT', `/staff/v1/members/${helperOnlyPgp.id}/role`, { role: 'mod', tapId: up }))).toBe('security-key-required');

    const mod = await staffWithKeys(t, { role: 'mod' });
    expect(errorOf(await owner.browser.send('PUT', `/staff/v1/members/${mod.id}/role`, { role: 'senior' }))).toBe('tap-invalid');
    const wrong = await tap(owner, { kind: 'set-role', accountId: mod.id, role: 'helper' });
    expect(errorOf(await owner.browser.send('PUT', `/staff/v1/members/${mod.id}/role`, { role: 'senior', tapId: wrong }))).toBe('tap-invalid');
    const tapId = await tap(owner, { kind: 'set-role', accountId: mod.id, role: 'senior' });
    const res = await owner.browser.send('PUT', `/staff/v1/members/${mod.id}/role`, { role: 'senior', tapId });
    expect(res.statusCode, res.body).toBe(200);
    expect(await logEntries(t.deps, 'staff.role-set')).toContainEqual({ actor_kind: 'staff', detail: JSON.stringify({ from: 'mod', staffId: mod.id, to: 'senior' }) });
    expect((await mod.browser.get('/staff/v1/me')).json().role).toBe('senior');
    expect(errorOf(await owner.browser.send('PUT', `/staff/v1/members/${mod.id}/role`, { role: 'owner', tapId }))).toBe('bad-request');
  });

  it('removes a staff member: switched off for good, gone from the list', async () => {
    const mod = await staffWithKeys(t, { role: 'mod' });
    const res = await owner.browser.send('DELETE', `/staff/v1/members/${mod.id}`);
    expect(res.statusCode, res.body).toBe(204);
    expect(errorOf(await mod.browser.get('/staff/v1/me'))).toBe('not-authenticated');
    const { token } = await insertSession(t.deps, mod.id, 'staff');
    expect(errorOf(await new StaffBrowser(t.app).withSession(token).get('/staff/v1/me'))).toBe('account-disabled');
    expect((await owner.browser.get('/staff/v1/members')).json().members.map((r: { accountId: string }) => r.accountId)).not.toContain(mod.id);
    const tapId = await tap(owner, { kind: 'switch-on', accountId: mod.id, role: 'mod' });
    expect((await owner.browser.post(`/staff/v1/members/${mod.id}/switch-on`, { tapId })).statusCode).toBe(404);
    expect((await owner.browser.send('DELETE', `/staff/v1/members/${mod.id}`)).statusCode).toBe(404);
  });

  it('a member route for someone who is not staff: 404', async () => {
    const res = await owner.browser.post('/staff/v1/members/00000000-0000-4000-8000-000000000000/switch-off', {});
    expect(res.statusCode).toBe(404);
  });
});

describe('per-person grants (owner Q60)', () => {
  it('the owner ticks feedback for a moderator with a tap bound to the exact list; the moderator then reads feedback', async () => {
    const mod = await staffWithKeys(t, { role: 'mod' });
    expect((await mod.browser.get('/staff/v1/feedback')).statusCode).toBe(403);
    const put = (grants: unknown, tapId?: string) => owner.browser.send('PUT', `/staff/v1/members/${mod.id}/grants`, { grants, ...(tapId ? { tapId } : {}) });
    expect(errorOf(await put(['feedback.read']))).toBe('tap-invalid');
    // A tap for another list does not set this one.
    const both = await tap(owner, { kind: 'set-grants', accountId: mod.id, grants: ['feedback.read', 'tickets.handle'] });
    expect(errorOf(await put(['feedback.read'], both))).toBe('tap-invalid');
    const res = await put(['feedback.read'], await tap(owner, { kind: 'set-grants', accountId: mod.id, grants: ['feedback.read'] }));
    expect([res.statusCode, res.json()]).toEqual([200, { grants: ['feedback.read'] }]);
    expect((await mod.browser.get('/staff/v1/feedback')).statusCode).toBe(200);
    expect((await mod.browser.get('/staff/v1/me')).json().nav).toContain('feedback');
    expect(await logEntries(t.deps, 'staff.grants-set')).toContainEqual({
      actor_kind: 'staff', detail: JSON.stringify({ feedbackRead: true, staffId: mod.id, ticketsHandle: false }),
    });
    // Unknown or repeated grants are 400; the owner's own row is protected.
    expect((await put(['staff.manage'])).statusCode).toBe(400);
    expect((await put(['feedback.read', 'feedback.read'])).statusCode).toBe(400);
    expect(errorOf(await owner.browser.send('PUT', `/staff/v1/members/${owner.id}/grants`, { grants: [] }))).toBe('owner-protected');
  });

  it('a senior moderator reads feedback by role (owner Q60)', async () => {
    const senior = await staffWithKeys(t, { role: 'senior' });
    expect((await senior.browser.get('/staff/v1/feedback')).statusCode).toBe(200);
    expect((await senior.browser.get('/staff/v1/me')).json().nav).toEqual(['disputes', 'training', 'log', 'feedback']);
  });
});

describe('Task 7 tripwires (local tree only)', () => {
  const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
  const migrations = (): string => readdirSync(`${ROOT}apps/api/migrations`).map((f) => readFileSync(`${ROOT}apps/api/migrations/${f}`, 'utf8')).join('\n');

  it('NEEDS_P4_CASE_ASSIGNEE: switch-off unassigns open cases and the list counts them', () => {
    // When Tasks 10-12 add `disputes.assignee` (coordination "Columns on disputes"): in
    // staff/members.ts make `unassignOpenCases` clear it for the switched-off member (one
    // `dispute.assigned`-style log entry per case) and make `openCases` count them; test both.
    expect(/\bassignee\b/.test(migrations()), 'disputes.assignee landed: wire unassignOpenCases and openCases (see this test)').toBe(false);
  });

  it('NEEDS_P4_MODERATION_REVOKE: switch-off tells the moderation process', () => {
    // When Task 13's gate lands (apps/moderation/src/gate): give ModerationClient a revoke call and
    // make `switchOff` call it after the commit (revocation needs no signature).
    expect(existsSync(`${ROOT}apps/moderation/src/gate`), 'the ruling gate landed: notify it on switch-off (see this test)').toBe(false);
  });

});
