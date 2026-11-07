// Lead re-review 6 Nov, items 1 and 2: staff and the owner change their own login methods, end
// sessions, read alerts and subscribe to Web Push on the staff site (they are refused on the trader
// site: owner Q19, Q13). Method changes need a security-key tap bound to the exact change.
import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PushCall, PushTransport } from '../../src/push/send.js';
import { addAlert } from '../../src/alerts.js';
import { codeOf, decrypt, genKey } from '../helpers/pgpKeys.js';
import { errorOf, insertSession, logEntries } from '../helpers/staffApp.js';
import { addPgpKey, attestedStaffApps, staffWithKeys, tap, type AttestedStaffApps } from '../helpers/staffKeys.js';

const MON_NOON = new Date('2026-11-02T12:00:00Z');
const calls: PushCall[] = [];
const fake: PushTransport = async (call) => {
  calls.push(call);
  return { statusCode: 201 };
};

let t: AttestedStaffApps;
// One owner per database (`one_owner`): made once, shared.
let ownerP: Awaited<ReturnType<typeof staffWithKeys>> | undefined;
const theOwner = async () => (ownerP ??= await staffWithKeys(t, { role: 'owner', keys: 2 }));
beforeAll(async () => {
  t = await attestedStaffApps({ pushTransport: fake });
  t.setNow(MON_NOON);
});
afterAll(async () => t.close());

const methods = async (accountId: string) =>
  (await t.deps.db.query<{ fingerprint: string }>('select fingerprint from pgp_keys where account_id = $1 order by fingerprint', [accountId])).rows.map((r) => r.fingerprint);

describe('one\'s own PGP keys on the staff site', () => {
  it('adds a key: the code proves it, a tap bound to its fingerprint confirms it; a tap for another key adds nothing', async () => {
    const mod = await staffWithKeys(t, { role: 'mod' });
    const fresh = await genKey();
    const add = async (tapId: string) => {
      const start = await mod.browser.post('/staff/v1/account/pgp/start', { publicKey: fresh.publicKey });
      expect(start.statusCode, start.body).toBe(200);
      const code = codeOf(await decrypt(start.json().encryptedMessage, fresh.privateKey, undefined, t.deps.clock()));
      return mod.browser.post('/staff/v1/account/pgp/finish', { challengeId: start.json().challengeId, code, tapId });
    };
    const other = await tap(mod, { kind: 'add-pgp-key', fingerprint: 'a'.repeat(40) });
    const wrong = await add(other);
    expect(errorOf(wrong)).toBe('tap-invalid');
    expect(await methods(mod.id)).toEqual([]);
    const ok = await add(await tap(mod, { kind: 'add-pgp-key', fingerprint: fresh.fingerprint.toLowerCase() }));
    expect([ok.statusCode, ok.json()]).toEqual([200, { fingerprint: fresh.fingerprint }]);
    expect(await methods(mod.id)).toEqual([fresh.fingerprint]);
    expect(await logEntries(t.deps, 'staff.method-added')).toContainEqual({ actor_kind: 'staff', detail: JSON.stringify({ method: 'pgp' }) });
    expect(((await mod.browser.get('/staff/v1/account/methods')).json() as Array<{ type: string }>).map((m) => m.type).sort()).toEqual(['pgp', 'security-key']);
  });

  it('removes a key with a tap bound to it; other sessions end; the last way to log in stays (409)', async () => {
    const mod = await staffWithKeys(t, { role: 'mod' });
    const pairA = await addPgpKey(t.deps, mod.id);
    await addPgpKey(t.deps, mod.id);
    const ids = (await t.deps.db.query<{ id: string; fingerprint: string }>('select id, fingerprint from pgp_keys where account_id = $1', [mod.id])).rows;
    const a = ids.find((r) => r.fingerprint === pairA.fingerprint)!.id;
    const b = ids.find((r) => r.fingerprint !== pairA.fingerprint)!.id;
    const other = await insertSession(t.deps, mod.id, 'staff');
    const del = (id: string, tapId: string) => mod.browser.send('DELETE', `/staff/v1/account/methods/pgp/${id}`, { tapId });
    // A tap for another method does not remove this one.
    expect(errorOf(await del(a, await tap(mod, { kind: 'remove-method', methodType: 'pgp', methodId: b })))).toBe('tap-invalid');
    expect((await del(a, await tap(mod, { kind: 'remove-method', methodType: 'pgp', methodId: a }))).statusCode).toBe(204);
    const { rows: live } = await t.deps.db.query('select 1 from sessions where id = $1 and revoked_at is null', [other.sessionId]);
    expect(live).toEqual([]);
    expect((await mod.browser.get('/staff/v1/me')).statusCode).toBe(200);
    expect(await logEntries(t.deps, 'staff.method-removed')).toContainEqual({ actor_kind: 'staff', detail: JSON.stringify({ method: 'pgp' }) });
    // The last PGP key with one security key: removing it would leave no login pair.
    const last = await del(b, await tap(mod, { kind: 'remove-method', methodType: 'pgp', methodId: b }));
    expect([last.statusCode, errorOf(last)]).toEqual([409, 'last-login-method']);
  });

  it('the owner keeps two security keys (409 owner-needs-two-keys)', async () => {
    const owner = await theOwner();
    await addPgpKey(t.deps, owner.id);
    const keyIds = (await t.deps.db.query<{ id: string }>("select id from webauthn_credentials where account_id = $1 and kind = 'security-key' order by id", [owner.id])).rows.map((r) => r.id);
    const del = async (id: string) =>
      owner.browser.send('DELETE', `/staff/v1/account/methods/security-key/${id}`, { tapId: await tap(owner, { kind: 'remove-method', methodType: 'security-key', methodId: id }) });
    expect(errorOf(await del(keyIds[0]!))).toBe('owner-needs-two-keys');
  });

  it('lead review I-2: a moderator keeps one security key (409 security-key-required); a second may go', async () => {
    const mod = await staffWithKeys(t, { role: 'mod', keys: 2 });
    await addPgpKey(t.deps, mod.id);
    const ids = (await t.deps.db.query<{ id: string; credential_id: Buffer }>("select id, credential_id from webauthn_credentials where account_id = $1 and kind = 'security-key'", [mod.id])).rows;
    // Remove the key that is not keys[0], tapping with keys[0].
    const k0 = Buffer.from(mod.keys[0]!.credentialId, 'base64url');
    const other = ids.find((r) => !r.credential_id.equals(k0))!.id;
    const last = ids.find((r) => r.credential_id.equals(k0))!.id;
    const del = async (id: string) =>
      mod.browser.send('DELETE', `/staff/v1/account/methods/security-key/${id}`, { tapId: await tap(mod, { kind: 'remove-method', methodType: 'security-key', methodId: id }) });
    expect((await del(other)).statusCode).toBe(204);
    const res = await del(last);
    expect([res.statusCode, errorOf(res)]).toEqual([409, 'security-key-required']);
    const { rows } = await t.deps.db.query<{ has_security_key: boolean }>('select has_security_key from staff_members where account_id = $1', [mod.id]);
    expect(rows[0]!.has_security_key).toBe(true);
  });

  it('an unknown type or id is 404; a malformed tap intent is 400', async () => {
    const mod = await staffWithKeys(t, { role: 'mod' });
    expect((await mod.browser.send('DELETE', `/staff/v1/account/methods/password/${randomUUID()}`, { tapId: randomUUID() })).statusCode).toBe(404);
    expect((await mod.browser.send('DELETE', '/staff/v1/account/methods/pgp/nope', { tapId: randomUUID() })).statusCode).toBe(404);
    expect((await mod.browser.post('/staff/v1/taps/start', { kind: 'add-pgp-key', fingerprint: 'xyz' })).statusCode).toBe(400);
    expect((await mod.browser.post('/staff/v1/taps/start', { kind: 'remove-method', methodType: 'totp', methodId: randomUUID() })).statusCode).toBe(400);
  });
});

describe('sessions, alerts and push on the staff site', () => {
  it('lists the account\'s live sessions on both sites and ends one; another account\'s is 404', async () => {
    const mod = await staffWithKeys(t, { role: 'mod' });
    const old = await insertSession(t.deps, mod.id, 'trader');
    const list = (await mod.browser.get('/staff/v1/account/sessions')).json() as Array<{ id: string; site: string; current: boolean }>;
    expect(list.map((s) => s.site).sort()).toEqual(['staff', 'trader']);
    expect(list.filter((s) => s.current)).toHaveLength(1);
    expect((await mod.browser.send('DELETE', `/staff/v1/account/sessions/${old.sessionId}`)).statusCode).toBe(204);
    expect(((await mod.browser.get('/staff/v1/account/sessions')).json() as unknown[]).length).toBe(1);
    const stranger = await staffWithKeys(t, { role: 'helper' });
    expect((await stranger.browser.send('DELETE', `/staff/v1/account/sessions/${list.find((s) => s.current)!.id}`)).statusCode).toBe(404);
    expect(await logEntries(t.deps, 'staff.session-ended')).toHaveLength(1);
  });

  it('the owner reads alerts and marks one seen', async () => {
    const owner = await theOwner();
    await addAlert(t.deps.db, owner.id, 'market-prices-paused', { currency: 'GBP' }, t.deps.clock());
    const alerts = (await owner.browser.get('/staff/v1/account/alerts')).json() as Array<{ id: string; kind: string; seenAt: string | null }>;
    expect(alerts.map((a) => a.kind)).toContain('market-prices-paused');
    const a = alerts.find((x) => x.kind === 'market-prices-paused')!;
    expect((await owner.browser.post(`/staff/v1/account/alerts/${a.id}/seen`, {})).statusCode).toBe(204);
    expect(((await owner.browser.get('/staff/v1/account/alerts')).json() as Array<{ id: string; seenAt: string | null }>).find((x) => x.id === a.id)!.seenAt).not.toBeNull();
    expect((await owner.browser.post(`/staff/v1/account/alerts/${randomUUID()}/seen`, {})).statusCode).toBe(404);
  });

  it('lead review M1: marking an alert seen and unsubscribing are logged; a bare DELETE drops only this session\'s subscriptions', async () => {
    const owner = await theOwner();
    await addAlert(t.deps.db, owner.id, 'market-prices-paused', { currency: 'JPY' }, t.deps.clock());
    const a = ((await owner.browser.get('/staff/v1/account/alerts')).json() as Array<{ id: string; kind: string; seenAt: string | null }>).find((x) => x.seenAt === null)!;
    const before = (await logEntries(t.deps, 'staff.alert-seen')).length;
    await owner.browser.post(`/staff/v1/account/alerts/${a.id}/seen`, {});
    await owner.browser.post(`/staff/v1/account/alerts/${a.id}/seen`, {}); // already seen: not logged again
    expect(await logEntries(t.deps, 'staff.alert-seen')).toHaveLength(before + 1);
    const sub = () => {
      const ecdh = createECDH('prime256v1');
      ecdh.generateKeys();
      return { endpoint: `https://fcm.googleapis.com/fcm/send/${randomBytes(24).toString('base64url')}`, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
    };
    const other = await insertSession(t.deps, owner.id, 'staff');
    const { StaffBrowser } = await import('../helpers/staffApp.js');
    const second = new StaffBrowser(t.app).withSession(other.token);
    expect((await owner.browser.post('/staff/v1/account/push', sub())).statusCode).toBe(204);
    expect((await second.post('/staff/v1/account/push', sub())).statusCode).toBe(204);
    expect((await owner.browser.send('DELETE', '/staff/v1/account/push')).statusCode).toBe(204);
    const { rows } = await t.deps.db.query('select session_id from push_subscriptions where account_id = $1', [owner.id]);
    expect(rows).toEqual([{ session_id: other.sessionId }]);
    expect((await logEntries(t.deps, 'staff.push-removed')).length).toBeGreaterThan(0);
    await second.send('DELETE', '/staff/v1/account/push');
  });

  it('the owner subscribes on the staff site and the staff app pushes to it; unsubscribe removes it', async () => {
    const owner = await theOwner();
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    const sub = {
      endpoint: `https://fcm.googleapis.com/fcm/send/${randomBytes(24).toString('base64url')}`,
      keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') },
    };
    expect((await owner.browser.get('/staff/v1/account/push')).json()).toEqual({ vapidPublic: t.deps.config.vapidPublic });
    expect((await owner.browser.post('/staff/v1/account/push', sub)).statusCode).toBe(204);
    calls.length = 0;
    expect(await t.app.push.send(owner.id, 'alert')).toBe(true);
    expect(calls.map((c) => c.subscription.endpoint)).toEqual([sub.endpoint]);
    expect((await owner.browser.send('DELETE', '/staff/v1/account/push', { endpoint: sub.endpoint })).statusCode).toBe(204);
    expect(await t.app.push.send(owner.id, 'alert')).toBe(false);
  });
});
