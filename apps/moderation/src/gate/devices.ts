import { staffDeviceKeyId, type KeyTapIntent } from '@x2f/staff';
import type { GateSource } from './registry.js';
import { MAX_STAFF_DEVICES, MAX_TAP_AGE_MS, STAFF_DEVICE_LIFETIME_MS, SWITCH_ON_SKEW_MS, type GateState, type StaffDevice } from './store.js';
import { noteCounter, olderThanSeen, verifyTap, type GateContext, type StoredTap } from './verify.js';

/**
 * Chat membership design task 8 (design section 4; lead 18 Nov): staff device certification, so the
 * API can never add a reader of its own. A staff member (or the owner) certifies a staff-web device
 * key with a security-key tap bound to exactly that key (`certify-device {accountId, deviceKeyId,
 * signPublic, boxPublic, issuedAt}`); the gate applies a tap only when:
 * - it verifies against the gate's own registry (`verifyTap`: a key the owner chain trusts for that
 *   person, who is live, the assertion valid for that intent), and its nonce was never used (single
 *   use, as every tap the gate relies on), and its key's signature counter is above the key's mark;
 * - the person tapped for themselves (`accountId` is the tap's account);
 * - the id is `staffDeviceKeyId(signPublic)` and both keys are 64 lower-case hex;
 * - its signed issuedAt is not in the future (beyond the skew), not older than MAX_TAP_AGE_MS, and
 *   after the person's last switch-off this gate saw (less the skew);
 * - the key id is not live already (lead 18 Nov: no re-certifying a live id), and a revoked id is
 *   certified again only by a tap issued after its revocation;
 * - the person has fewer than MAX_STAFF_DEVICES (3) live devices.
 * A certification lasts STAFF_DEVICE_LIFETIME_MS (365 days) from its signed issuedAt.
 * `revoke-device {accountId, deviceKeyId, issuedAt}` names the key id, tapped by the device's own
 * person or by the owner. Revoking a person (switch-off, removal, a security reset) revokes all of
 * their devices: `revokeDevicesOf`, and `deviceLive` checks the person stands as well. Review N5: so
 * does an applied owner switch-on (a switch-off this gate never saw, off and on between two syncs),
 * as of the switch-on's signed issuedAt.
 * Anything refused is spent (its nonce) and logged as `gate.refused.device-*`.
 */

const DEVICE_KINDS = ['certify-device', 'revoke-device'] as const satisfies readonly KeyTapIntent['kind'][];
const HEX64 = /^[0-9a-f]{64}$/;

/** Whether the person still stands in the gate: the owner, or joined live staff. */
export function personStands(g: GateState, accountId: string): boolean {
  if (g.ownerAccountId !== null && accountId === g.ownerAccountId) return true;
  if (g.removedIds.includes(accountId)) return false;
  const s = Object.hasOwn(g.staff, accountId) ? g.staff[accountId] : undefined;
  return s !== undefined && s.joined && !s.revoked && !s.removed;
}

const live = (d: StaffDevice, at: number): boolean => d.revokedAt === null && at < Date.parse(d.expiresAt) && at >= Date.parse(d.certifiedAt) - SWITCH_ON_SKEW_MS;

/** Revokes every live device of a person (their switch-off, removal or security reset), by the gate's clock. */
export function revokeDevicesOf(g: GateState, accountId: string, now: Date): void {
  for (const d of Object.values(g.devices)) if (d.accountId === accountId && d.revokedAt === null) d.revokedAt = now.toISOString();
}

/** A live certified device of exactly this person at `at` (this process's clock), or null. */
export function deviceLive(g: GateState, accountId: string, deviceKeyId: string, at: Date): StaffDevice | null {
  const d = Object.hasOwn(g.devices, deviceKeyId) ? g.devices[deviceKeyId] : undefined;
  if (d === undefined || d.accountId !== accountId || !personStands(g, accountId) || !live(d, at.getTime())) return null;
  return d;
}

/**
 * Review N8: what the registry sync hands the device step: each key's counter mark (by
 * `accountId\0credentialId`) before the sync began, and the counters the registry steps took in it.
 */
export interface CounterView {
  marksBefore: ReadonlyMap<string, number>;
  takenThisSync: ReadonlyMap<string, ReadonlySet<number>>;
}

/**
 * Applies new certify-device and revoke-device taps (the caller saves the gate). Review N8: the taps
 * are judged in each key's counter order, together with the registry taps of the same key in this
 * sync: a tap is out of order when its counter is at or below the key's mark before this sync (or
 * the counter of a device tap of the key applied just before it), or is a counter the registry
 * steps already took in this sync. Without `view`, the key's current mark.
 */
export async function syncDevices(source: GateSource, g: GateState, ctx: GateContext, view?: CounterView): Promise<void> {
  const now = ctx.now();
  const at = now.getTime();
  // Every person who no longer stands loses all their devices, whatever taps follow.
  for (const d of Object.values(g.devices)) if (d.revokedAt === null && !personStands(g, d.accountId)) d.revokedAt = now.toISOString();
  if (g.ownerAccountId === null) return;
  const refuse = (nonceHex: string, why: string): void => {
    g.usedNonces[nonceHex] = `device-refused:${why}`;
    ctx.log({ reason: `gate.refused.device-${why}` });
  };
  // Verified first, then judged in counter order (review N8).
  const verified: Array<{ tap: StoredTap; c: Extract<Awaited<ReturnType<typeof verifyTap>>, { ok: true }> }> = [];
  for (const tap of await source.usedTaps(DEVICE_KINDS)) {
    if (typeof tap?.nonceHex !== 'string' || Object.hasOwn(g.usedNonces, tap.nonceHex)) continue;
    // Only a device tap is ever touched here: any other kind is left for its own step, unspent.
    let kind: unknown;
    try {
      kind = (JSON.parse(tap.intent) as { kind?: unknown }).kind;
    } catch {
      continue;
    }
    if (!(DEVICE_KINDS as readonly unknown[]).includes(kind)) continue;
    const c = await verifyTap(g, tap, ctx);
    if (!c.ok) {
      refuse(tap.nonceHex, c.reason);
      continue;
    }
    verified.push({ tap, c });
  }
  verified.sort((a, b) => a.c.counter - b.c.counter);
  /** The running mark per key in this step: the mark before the sync, raised by each device tap applied. */
  const running = new Map<string, number>();
  const outOfOrder = (accountId: string, credentialId: string, counter: number): boolean => {
    if (view === undefined) return olderThanSeen(g, accountId, credentialId, counter);
    const k = `${accountId}\0${credentialId}`;
    const hw = running.get(k) ?? view.marksBefore.get(k) ?? 0;
    return (hw > 0 && counter <= hw) || (view.takenThisSync.get(k)?.has(counter) ?? false);
  };
  const applied = (accountId: string, credentialId: string, counter: number): void => {
    noteCounter(g, accountId, credentialId, counter);
    const k = `${accountId}\0${credentialId}`;
    running.set(k, Math.max(running.get(k) ?? view?.marksBefore.get(k) ?? 0, counter));
  };
  for (const { tap, c } of verified) {
    if (outOfOrder(c.accountId, c.credentialId, c.counter)) {
      refuse(tap.nonceHex, 'out-of-order');
      continue;
    }
    const i = c.intent;
    if (i.kind !== 'certify-device' && i.kind !== 'revoke-device') {
      refuse(tap.nonceHex, 'intent');
      continue;
    }
    const issued = Date.parse(i.issuedAt ?? '');
    if (!Number.isFinite(issued) || issued > at + SWITCH_ON_SKEW_MS || at - issued > MAX_TAP_AGE_MS) {
      refuse(tap.nonceHex, 'issued-at');
      continue;
    }
    const existing = Object.hasOwn(g.devices, i.deviceKeyId) ? g.devices[i.deviceKeyId] : undefined;
    if (i.kind === 'revoke-device') {
      const mayRevoke = c.accountId === i.accountId || c.role === 'owner';
      if (!mayRevoke || existing === undefined || existing.accountId !== i.accountId) {
        refuse(tap.nonceHex, 'revoke');
        continue;
      }
      g.usedNonces[tap.nonceHex] = `revoke-device:${i.deviceKeyId}`;
      applied(c.accountId, c.credentialId, c.counter);
      if (existing.revokedAt === null) existing.revokedAt = now.toISOString();
      continue;
    }
    if (c.accountId !== i.accountId) {
      refuse(tap.nonceHex, 'not-self');
      continue;
    }
    let id: string | null = null;
    try {
      id = HEX64.test(i.signPublic) && HEX64.test(i.boxPublic) ? staffDeviceKeyId(i.signPublic) : null;
    } catch {
      id = null;
    }
    if (id === null || id !== i.deviceKeyId) {
      refuse(tap.nonceHex, 'key');
      continue;
    }
    const s = Object.hasOwn(g.staff, i.accountId) ? g.staff[i.accountId] : undefined;
    if (s?.offSeenAt !== undefined && !(issued > Date.parse(s.offSeenAt) - SWITCH_ON_SKEW_MS)) {
      refuse(tap.nonceHex, 'before-off');
      continue;
    }
    if (existing !== undefined && live(existing, at)) {
      refuse(tap.nonceHex, 'live');
      continue;
    }
    if (existing?.revokedAt != null && !(issued > Date.parse(existing.revokedAt))) {
      refuse(tap.nonceHex, 'before-revoke');
      continue;
    }
    const count = Object.values(g.devices).filter((d) => d.accountId === i.accountId && live(d, at)).length;
    if (count >= MAX_STAFF_DEVICES) {
      refuse(tap.nonceHex, 'limit');
      continue;
    }
    g.usedNonces[tap.nonceHex] = `certify-device:${i.deviceKeyId}`;
    applied(c.accountId, c.credentialId, c.counter);
    g.devices[i.deviceKeyId] = {
      accountId: i.accountId,
      signPublic: i.signPublic,
      boxPublic: i.boxPublic,
      certifiedAt: new Date(issued).toISOString(),
      expiresAt: new Date(issued + STAFF_DEVICE_LIFETIME_MS).toISOString(),
      revokedAt: null,
    };
  }
}
