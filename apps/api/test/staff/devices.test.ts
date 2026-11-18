// Chat membership design task 8 (design section 4; lead 18 Nov): one's own staff-web device keys.
// The certification is a tap bound to exactly this person and these keys (single use); the API
// keeps no device table: the moderation gate reads the used tap itself.
import { randomBytes } from 'node:crypto';
import { staffDeviceKeyId } from '@x2f/staff';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { liveDevices, STAFF_DEVICE_LIFETIME_MS, STAFF_DEVICE_MAX } from '../../src/staff/devices.js';
import { errorOf, logEntries } from '../helpers/staffApp.js';
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
});
