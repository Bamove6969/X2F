// Chat membership design task 8 (design section 4; lead 18 Nov): staff device certification in the
// ruling gate. A device key is certified only by its own person's security-key tap bound to exactly
// that key (single use), for at most 365 days, at most 3 live per person, never twice while live;
// a revoke-device tap names the key id; revoking a person revokes all their devices.
import { randomBytes } from 'node:crypto';
import { staffDeviceKeyId, type KeyTapIntent } from '@x2f/staff';
import { describe, expect, it } from 'vitest';
import { deviceLive } from '../src/gate/devices.js';
import { syncRegistry } from '../src/gate/registry.js';
import { MAX_STAFF_DEVICES, STAFF_DEVICE_LIFETIME_MS } from '../src/gate/store.js';
import { gateDevices } from '../src/internal/grant.js';
import { ctx, NOW, tapBy, world, resetSecurity, type Person, type World } from './gateWorld.js';

const hex = (n: number) => randomBytes(n).toString('hex');
function deviceKeys() {
  const signPublic = hex(32);
  return { signPublic, boxPublic: hex(32), deviceKeyId: staffDeviceKeyId(signPublic) };
}
const certify = (p: Person, k = deviceKeys(), o: { accountId?: string; issuedAt?: Date } = {}) => {
  const intent: KeyTapIntent = { kind: 'certify-device', accountId: o.accountId ?? p.id, ...k };
  return { k, tap: tapBy(p, intent, o.issuedAt ? { issuedAt: o.issuedAt } : {}) };
};
const revoke = (by: Person, accountId: string, deviceKeyId: string, issuedAt?: Date) =>
  tapBy(by, { kind: 'revoke-device', accountId, deviceKeyId }, issuedAt ? { issuedAt } : {});
const at = (ms: number) => new Date(NOW.getTime() + ms);
const sync = (w: World, now = NOW, reasons: string[] = []) => syncRegistry(w.api, w.gate, { ...ctx(), now: () => now, log: (e) => reasons.push(e.reason) });

async function staffed() {
  const w = await world();
  const mod = w.hire('mod');
  await sync(w);
  return { w, mod };
}

describe('the gate: certify-device', () => {
  it('certifies a device key by its own person\'s tap for 365 days from the signed issuedAt; the grant side reads its keys', async () => {
    const { w, mod } = await staffed();
    const { k, tap } = certify(mod);
    w.api.taps.push(tap);
    await sync(w);
    expect(w.gate.devices[k.deviceKeyId]).toEqual({ accountId: mod.id, signPublic: k.signPublic, boxPublic: k.boxPublic, certifiedAt: NOW.toISOString(), expiresAt: at(STAFF_DEVICE_LIFETIME_MS).toISOString(), revokedAt: null });
    expect(deviceLive(w.gate, mod.id, k.deviceKeyId, at(STAFF_DEVICE_LIFETIME_MS - 1))).not.toBeNull();
    expect(deviceLive(w.gate, mod.id, k.deviceKeyId, at(STAFF_DEVICE_LIFETIME_MS))).toBeNull();
    // Certified to exactly this person.
    expect(deviceLive(w.gate, w.owner.id, k.deviceKeyId, NOW)).toBeNull();
    let syncs = 0;
    const devices = gateDevices({ state: w.gate, sync: async () => { syncs += 1; } });
    expect(await devices.device(mod.id, k.deviceKeyId, NOW)).toEqual({ signPublic: k.signPublic, boxPublic: k.boxPublic });
    expect(await devices.device(w.owner.id, k.deviceKeyId, NOW)).toBeNull();
    expect(syncs).toBe(2);
  });

  it('the owner certifies their own devices too', async () => {
    const { w } = await staffed();
    const { k, tap } = certify(w.owner);
    w.api.taps.push(tap);
    await sync(w);
    expect(deviceLive(w.gate, w.owner.id, k.deviceKeyId, NOW)).not.toBeNull();
  });

  it('refuses a tap for someone else, an id that is not the signing key\'s, bad keys, an issuedAt in the future or a day old, a person it does not know, and spends each tap', async () => {
    const { w, mod } = await staffed();
    const other = w.hire('mod');
    await sync(w);
    const good = deviceKeys();
    const stranger: Person = { ...mod, id: '00000000-0000-4000-8000-000000000000' };
    const cases: Array<[string, ReturnType<typeof certify>['tap'], string]> = [
      ['for someone else', certify(mod, deviceKeys(), { accountId: other.id }).tap, 'gate.refused.device-not-self'],
      ['wrong id', certify(mod, { ...good, deviceKeyId: staffDeviceKeyId(hex(32)) }).tap, 'gate.refused.device-key'],
      ['bad box key', certify(mod, { ...deviceKeys(), boxPublic: 'zz'.repeat(32) }).tap, 'gate.refused.device-key'],
      ['future', certify(mod, deviceKeys(), { issuedAt: at(3 * 60_000) }).tap, 'gate.refused.device-issued-at'],
      ['old', certify(mod, deviceKeys(), { issuedAt: at(-25 * 3_600_000) }).tap, 'gate.refused.device-issued-at'],
      ['unknown person', certify(stranger).tap, 'gate.refused.device-unknown-key'],
    ];
    for (const [why, tap, reason] of cases) {
      const reasons: string[] = [];
      w.api.taps.push(tap);
      await sync(w, NOW, reasons);
      expect(reasons, why).toContain(reason);
      expect(w.gate.usedNonces[tap.nonceHex], why).toMatch(/^device-refused:/);
    }
    expect(Object.keys(w.gate.devices)).toEqual([]);
  });

  it('a tap counts once (its nonce), and a live key id is never certified again', async () => {
    const { w, mod } = await staffed();
    const { k, tap } = certify(mod);
    w.api.taps.push(tap);
    await sync(w);
    await sync(w);
    expect(Object.keys(w.gate.devices)).toEqual([k.deviceKeyId]);
    const reasons: string[] = [];
    w.api.taps.push(certify(mod, k, { issuedAt: at(1000) }).tap);
    await sync(w, at(2000), reasons);
    expect(reasons).toContain('gate.refused.device-live');
    expect(w.gate.devices[k.deviceKeyId]!.certifiedAt).toBe(NOW.toISOString());
  });

  it(`at most ${MAX_STAFF_DEVICES} live devices per person; an expired one frees a place`, async () => {
    const { w, mod } = await staffed();
    for (let i = 0; i < MAX_STAFF_DEVICES; i++) w.api.taps.push(certify(mod).tap);
    await sync(w);
    expect(Object.keys(w.gate.devices)).toHaveLength(MAX_STAFF_DEVICES);
    const reasons: string[] = [];
    const fourth = certify(mod);
    w.api.taps.push(fourth.tap);
    await sync(w, NOW, reasons);
    expect(reasons).toContain('gate.refused.device-limit');
    expect(w.gate.devices[fourth.k.deviceKeyId]).toBeUndefined();
    const later = at(STAFF_DEVICE_LIFETIME_MS + 1000);
    const fifth = certify(mod, deviceKeys(), { issuedAt: later });
    w.api.taps.push(fifth.tap);
    await sync(w, later);
    expect(deviceLive(w.gate, mod.id, fifth.k.deviceKeyId, later)).not.toBeNull();
  });
});

describe('the gate: revoke-device and revoking a person', () => {
  it('a revoke-device tap by the person or the owner revokes that key id only; a stale certify tap issued before it never brings it back; a later one does', async () => {
    const { w, mod } = await staffed();
    const a = certify(mod);
    const b = certify(mod);
    w.api.taps.push(a.tap, b.tap);
    await sync(w);
    w.api.taps.push(revoke(mod, mod.id, a.k.deviceKeyId));
    await sync(w, at(1000));
    expect(deviceLive(w.gate, mod.id, a.k.deviceKeyId, at(1000))).toBeNull();
    expect(deviceLive(w.gate, mod.id, b.k.deviceKeyId, at(1000))).not.toBeNull();
    w.api.taps.push(revoke(w.owner, mod.id, b.k.deviceKeyId));
    await sync(w, at(2000));
    expect(deviceLive(w.gate, mod.id, b.k.deviceKeyId, at(2000))).toBeNull();
    const reasons: string[] = [];
    w.api.taps.push(certify(mod, a.k, { issuedAt: at(-1000) }).tap);
    await sync(w, at(3000), reasons);
    expect(reasons).toContain('gate.refused.device-before-revoke');
    w.api.taps.push(certify(mod, a.k, { issuedAt: at(5000) }).tap);
    await sync(w, at(6000));
    expect(deviceLive(w.gate, mod.id, a.k.deviceKeyId, at(6000))).not.toBeNull();
  });

  it('another staff member cannot revoke someone else\'s device', async () => {
    const { w, mod } = await staffed();
    const other = w.hire('senior');
    await sync(w);
    const a = certify(mod);
    w.api.taps.push(a.tap);
    await sync(w);
    const reasons: string[] = [];
    w.api.taps.push(revoke(other, mod.id, a.k.deviceKeyId));
    await sync(w, NOW, reasons);
    expect(reasons).toContain('gate.refused.device-revoke');
    expect(deviceLive(w.gate, mod.id, a.k.deviceKeyId, NOW)).not.toBeNull();
  });

  it('a switch-off revokes all the person\'s devices for good (a switch-on does not bring them back); a removal and a security reset too', async () => {
    const { w, mod } = await staffed();
    const a = certify(mod);
    w.api.taps.push(a.tap);
    await sync(w);
    w.api.staffRows.set(mod.id, { ...w.api.staffRows.get(mod.id)!, switchedOff: true });
    await sync(w, at(1000));
    expect(w.gate.devices[a.k.deviceKeyId]!.revokedAt).toBe(at(1000).toISOString());
    // A certify tap issued before the switch-off this gate saw is refused even once switched on.
    w.api.staffRows.set(mod.id, { ...w.api.staffRows.get(mod.id)!, switchedOff: false });
    w.api.taps.push(tapBy(w.owner, { kind: 'switch-on', accountId: mod.id, role: 'mod' }, { issuedAt: at(5 * 60_000) }));
    await sync(w, at(6 * 60_000));
    expect(deviceLive(w.gate, mod.id, a.k.deviceKeyId, at(6 * 60_000))).toBeNull();
    const reasons: string[] = [];
    w.api.taps.push(certify(mod, deviceKeys(), { issuedAt: at(-3 * 60_000) }).tap);
    await sync(w, at(6 * 60_000), reasons);
    expect(reasons).toContain('gate.refused.device-before-off');

    const senior = w.hire('senior');
    await sync(w, at(6 * 60_000));
    const s = certify(senior, deviceKeys(), { issuedAt: at(6 * 60_000) });
    w.api.taps.push(s.tap);
    await sync(w, at(6 * 60_000));
    expect(deviceLive(w.gate, senior.id, s.k.deviceKeyId, at(6 * 60_000))).not.toBeNull();
    resetSecurity(w, senior);
    await sync(w, at(7 * 60_000));
    expect(w.gate.devices[s.k.deviceKeyId]!.revokedAt).not.toBeNull();

    const helper = w.hire('helper');
    await sync(w, at(7 * 60_000));
    const h = certify(helper, deviceKeys(), { issuedAt: at(7 * 60_000) });
    w.api.taps.push(h.tap);
    await sync(w, at(7 * 60_000));
    w.api.taps.push(tapBy(w.owner, { kind: 'remove-staff', accountId: helper.id }, { issuedAt: at(8 * 60_000) }));
    await sync(w, at(8 * 60_000));
    expect(w.gate.devices[h.k.deviceKeyId]!.revokedAt).not.toBeNull();
  });

  it('review N5: switched off and on again between two syncs (the gate never saw the switch-off): the switch-on still revokes the devices', async () => {
    const { w, mod } = await staffed();
    const a = certify(mod);
    w.api.taps.push(a.tap);
    await sync(w);
    expect(deviceLive(w.gate, mod.id, a.k.deviceKeyId, NOW)).not.toBeNull();
    // Off at +30 s and on at +60 s by the API, both before the next sync at +2 min.
    w.api.taps.push(tapBy(w.owner, { kind: 'switch-on', accountId: mod.id, role: 'mod' }, { issuedAt: at(60_000) }));
    // Certified again after the switch-on (a new tap of the same key), before that sync.
    const again = certify(mod, a.k, { issuedAt: at(90_000) });
    w.api.taps.push(again.tap);
    await sync(w, at(2 * 60_000));
    // The old certification was revoked as of the switch-on; the tap issued after it certifies again.
    expect(w.gate.devices[a.k.deviceKeyId]!.certifiedAt).toBe(at(90_000).toISOString());
    expect(deviceLive(w.gate, mod.id, a.k.deviceKeyId, at(2 * 60_000))).not.toBeNull();
    // Another device certified before the switch-on, and never again: not live.
    const { w: w2, mod: mod2 } = await staffed();
    const b = certify(mod2);
    w2.api.taps.push(b.tap);
    await sync(w2);
    w2.api.taps.push(tapBy(w2.owner, { kind: 'switch-on', accountId: mod2.id, role: 'mod' }, { issuedAt: at(60_000) }));
    await sync(w2, at(2 * 60_000));
    expect(deviceLive(w2.gate, mod2.id, b.k.deviceKeyId, at(2 * 60_000))).toBeNull();
    expect(w2.gate.devices[b.k.deviceKeyId]!.revokedAt).toBe(at(60_000).toISOString());
  });

  it('review N8: a device tap is refused out of order when its key\'s counter is at or below the key\'s mark', async () => {
    const { w, mod } = await staffed();
    const first = certify(mod);
    const second = certify(mod);
    // The later tap (higher counter) is applied first; the older one, shown afterwards, is out of order.
    w.api.taps.push(second.tap);
    await sync(w);
    const reasons: string[] = [];
    w.api.taps.push(first.tap);
    await sync(w, NOW, reasons);
    expect(reasons).toContain('gate.refused.device-out-of-order');
    expect(w.gate.usedNonces[first.tap.nonceHex]).toBe('device-refused:out-of-order');
    expect(deviceLive(w.gate, mod.id, first.k.deviceKeyId, NOW)).toBeNull();
    expect(deviceLive(w.gate, mod.id, second.k.deviceKeyId, NOW)).not.toBeNull();
  });

  it('leaves every other kind of tap alone (unspent) for its own step', async () => {
    const { w, mod } = await staffed();
    // A set-role for someone the gate does not know yet is kept for later, never spent by the device step.
    const later = tapBy(w.owner, { kind: 'set-role', accountId: '11111111-1111-4111-8111-111111111111', role: 'mod' });
    w.api.taps.push(later, certify(mod).tap);
    await sync(w);
    expect(Object.hasOwn(w.gate.usedNonces, later.nonceHex)).toBe(false);
  });
});
