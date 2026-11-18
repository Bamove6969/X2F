// Chat membership design task 8 (design section 4; lead 18 Nov): one's own staff-web device keys.
// The certification is a tap bound to exactly this person and these keys (single use); the API
// keeps no device table: the moderation gate reads the used tap itself.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { staffDeviceKeyId } from '@x2f/staff';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { liveDevices, STAFF_DEVICE_LIFETIME_MS, STAFF_DEVICE_MAX } from '../../src/staff/devices.js';
import { errorOf, insertSession, logEntries, StaffBrowser } from '../helpers/staffApp.js';
import { attestedStaffApps, staffWithKeys, tap, type AttestedStaffApps } from '../helpers/staffKeys.js';

const NOW = new Date('2026-11-18T12:00:00Z');
let t: AttestedStaffApps;
beforeAll(async () => {
  t = await attestedStaffApps();
  t.setNow(NOW);
});
afterAll(async () => t.close());

const keys = () => {
  const signPublic = randomBytes(32).toString('hex');
  return { signPublic, boxPublic: randomBytes(32).toString('hex'), deviceKeyId: staffDeviceKeyId(signPublic) };
};

describe('staff device keys', () => {
  it('certifies a device with a tap bound to this person and these keys; lists it for 365 days; logs its id only', async () => {
    const mod = await staffWithKeys(t, { role: 'mod' });
    const k = keys();
    const post = (tapId: string, b = { signPublic: k.signPublic, boxPublic: k.boxPublic }) => mod.browser.post('/staff/v1/devices', { ...b, tapId });
    // A tap for other keys, or for another person, certifies nothing.
    const other = keys();
    expect(errorOf(await post(await tap(mod, { kind: 'certify-device', accountId: mod.id, ...other })))).toBe('tap-invalid');
    expect(errorOf(await post(await tap(mod, { kind: 'certify-device', accountId: '00000000-0000-4000-8000-000000000000', ...k })))).toBe('tap-invalid');
    expect((await mod.browser.post('/staff/v1/devices', { signPublic: 'x', boxPublic: k.boxPublic, tapId: 'y' })).statusCode).toBe(400);
    const ok = await post(await tap(mod, { kind: 'certify-device', accountId: mod.id, ...k }));
    expect([ok.statusCode, ok.json()]).toEqual([201, { deviceKeyId: k.deviceKeyId, expiresAt: new Date(NOW.getTime() + STAFF_DEVICE_LIFETIME_MS).toISOString() }]);
    const list = (await mod.browser.get('/staff/v1/devices')).json() as { devices: Array<{ deviceKeyId: string }> };
    expect(list.devices.map((d) => d.deviceKeyId)).toEqual([k.deviceKeyId]);
    expect(await logEntries(t.deps, 'staff.device-certified')).toContainEqual({ actor_kind: 'staff', detail: JSON.stringify({ deviceKeyId: k.deviceKeyId }) });
    // The stored tap is what the gate re-verifies: its intent names exactly these keys, with its signed start time.
    const { rows } = await t.deps.db.query<{ intent: string }>("select intent from key_taps where account_id = $1 and used_at is not null and intent::jsonb ->> 'kind' = 'certify-device'", [mod.id]);
    expect(JSON.parse(rows[0]!.intent)).toEqual({ kind: 'certify-device', accountId: mod.id, ...k, issuedAt: NOW.toISOString() });
    // A live key id again: 409, and the tap stays unused.
    const again = await post(await tap(mod, { kind: 'certify-device', accountId: mod.id, ...k }));
    expect([again.statusCode, errorOf(again)]).toEqual([409, 'device-exists']);
    // A year on, it is gone from the list.
    expect(await liveDevices(t.deps.db, mod.id, new Date(NOW.getTime() + STAFF_DEVICE_LIFETIME_MS - 1))).toHaveLength(1);
    expect(await liveDevices(t.deps.db, mod.id, new Date(NOW.getTime() + STAFF_DEVICE_LIFETIME_MS))).toEqual([]);
  });

  it(`at most ${STAFF_DEVICE_MAX} live devices; a revoke-device tap naming the id frees a place`, async () => {
    const mod = await staffWithKeys(t, { role: 'senior' });
    const made = [];
    for (let i = 0; i < STAFF_DEVICE_MAX; i++) {
      const k = keys();
      made.push(k);
      expect((await mod.browser.post('/staff/v1/devices', { signPublic: k.signPublic, boxPublic: k.boxPublic, tapId: await tap(mod, { kind: 'certify-device', accountId: mod.id, ...k }) })).statusCode).toBe(201);
    }
    const k4 = keys();
    const fourth = await mod.browser.post('/staff/v1/devices', { signPublic: k4.signPublic, boxPublic: k4.boxPublic, tapId: await tap(mod, { kind: 'certify-device', accountId: mod.id, ...k4 }) });
    expect([fourth.statusCode, errorOf(fourth)]).toEqual([409, 'device-limit']);
    const gone = made[0]!.deviceKeyId;
    // A revoke tap for another id does not revoke this one.
    expect(errorOf(await mod.browser.post(`/staff/v1/devices/${gone}/revoke`, { tapId: await tap(mod, { kind: 'revoke-device', accountId: mod.id, deviceKeyId: made[1]!.deviceKeyId }) }))).toBe('tap-invalid');
    expect((await mod.browser.post(`/staff/v1/devices/${gone}/revoke`, { tapId: await tap(mod, { kind: 'revoke-device', accountId: mod.id, deviceKeyId: gone }) })).statusCode).toBe(204);
    expect(await logEntries(t.deps, 'staff.device-revoked')).toContainEqual({ actor_kind: 'staff', detail: JSON.stringify({ deviceKeyId: gone }) });
    const list = ((await mod.browser.get('/staff/v1/devices')).json() as { devices: Array<{ deviceKeyId: string }> }).devices.map((d) => d.deviceKeyId);
    expect(list.sort()).toEqual([made[1]!.deviceKeyId, made[2]!.deviceKeyId].sort());
    expect((await mod.browser.post('/staff/v1/devices', { signPublic: k4.signPublic, boxPublic: k4.boxPublic, tapId: await tap(mod, { kind: 'certify-device', accountId: mod.id, ...k4 }) })).statusCode).toBe(201);
    // Revoking an id that is not live: 404.
    expect((await mod.browser.post(`/staff/v1/devices/${gone}/revoke`, { tapId: await tap(mod, { kind: 'revoke-device', accountId: mod.id, deviceKeyId: gone }) })).statusCode).toBe(404);
  });

  // Review N4: the gate revokes every device of a person it sees switched off, removed or reset; this
  // API's own view (what DeviceCard shows, and what decides `device-exists` / `device-limit`) must
  // drop those certifications too, or the person can never certify again.
  describe('review N4: a switch-off, a removal or a security reset ends every certification issued before it', () => {
    const MIN = 60_000;
    let owner: Awaited<ReturnType<typeof staffWithKeys>>;
    beforeAll(async () => {
      owner = await staffWithKeys(t, { role: 'owner' });
    });
    const certify = async (p: { id: string; browser: StaffBrowser; keys: Parameters<typeof tap>[0]['keys'] }, k: ReturnType<typeof keys>) =>
      p.browser.post('/staff/v1/devices', { signPublic: k.signPublic, boxPublic: k.boxPublic, tapId: await tap(p as Parameters<typeof tap>[0], { kind: 'certify-device', accountId: p.id, ...k }) });

    it('switched off and on again: nothing is live; the same key certifies again (201) and is listed', async () => {
      t.setNow(NOW);
      const helper = await staffWithKeys(t, { role: 'helper' });
      const k = keys();
      expect((await certify(helper, k)).statusCode).toBe(201);
      t.setNow(new Date(NOW.getTime() + MIN));
      expect((await owner.browser.post(`/staff/v1/members/${helper.id}/switch-off`, {})).statusCode).toBe(200);
      t.setNow(new Date(NOW.getTime() + 2 * MIN));
      const on = await owner.browser.post(`/staff/v1/members/${helper.id}/switch-on`, { tapId: await tap(owner, { kind: 'switch-on', accountId: helper.id, role: 'helper' }) });
      expect(on.statusCode).toBe(200);
      expect(await liveDevices(t.deps.db, helper.id, t.deps.clock())).toEqual([]);
      // A new session (switch-off ended the old ones): the list is empty, and the same key certifies again.
      const back = { ...helper, browser: new StaffBrowser(t.app).withSession((await insertSession(t.deps, helper.id, 'staff')).token) };
      expect(((await back.browser.get('/staff/v1/devices')).json() as { devices: unknown[] }).devices).toEqual([]);
      t.setNow(new Date(NOW.getTime() + 3 * MIN));
      const again = await certify(back, k);
      expect(again.statusCode).toBe(201);
      expect(((await back.browser.get('/staff/v1/devices')).json() as { devices: Array<{ deviceKeyId: string }> }).devices.map((d) => d.deviceKeyId)).toEqual([k.deviceKeyId]);
      t.setNow(NOW);
    });

    it('a security reset, or a removal, ends them too', async () => {
      t.setNow(NOW);
      const reset = await staffWithKeys(t, { role: 'helper' });
      const removed = await staffWithKeys(t, { role: 'helper' });
      for (const p of [reset, removed]) expect((await certify(p, keys())).statusCode).toBe(201);
      t.setNow(new Date(NOW.getTime() + MIN));
      const token = randomBytes(32).toString('base64url');
      const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
      const inviteId = randomUUID();
      const expiresAt = new Date(t.deps.clock().getTime() + 3_600_000).toISOString();
      const tapId = await tap(owner, { kind: 'reset-staff-security', accountId: reset.id, inviteId, tokenHash, expiresAt });
      expect((await owner.browser.post(`/staff/v1/members/${reset.id}/reset-security`, { inviteId, token, expiresAt, tapId })).statusCode).toBe(201);
      expect((await owner.browser.send('DELETE', `/staff/v1/members/${removed.id}`, { tapId: await tap(owner, { kind: 'remove-staff', accountId: removed.id }) })).statusCode).toBe(204);
      expect(await liveDevices(t.deps.db, reset.id, t.deps.clock())).toEqual([]);
      expect(await liveDevices(t.deps.db, removed.id, t.deps.clock())).toEqual([]);
      t.setNow(NOW);
    });
  });
});
