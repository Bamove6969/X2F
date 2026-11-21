import { createHash } from 'node:crypto';
import { deviceLive } from '../gate/devices.js';
import type { GateState } from '../gate/store.js';

/**
 * Design build task 9 (design-chat-membership-keys-2026-11-08; lead 18 Nov): who may be granted a
 * disputed trade's chat key, and who may send as the moderator, by this process's own records.
 * `server.ts` runs these checks for `POST /internal/chat/grant` and `POST /internal/chat/send`.
 */

/**
 * OWNER: p12-1. "Moderators can never read a chat unless there is a dispute": the owner included.
 * Built to the design's recommendation (yes) until the owner answers page 12.
 */
export const OWNER_NEEDS_DISPUTE = true;

/**
 * OWNER: p12-4. Seniors and the owner join a disputed case the same way as moderators (one logged
 * grant per case, no master key), and may join any disputed case, not only one assigned to them.
 * Built to the design's recommendation until the owner answers page 12. False: only the assignee.
 */
export const SENIOR_OR_OWNER_JOINS_ANY_CASE = true;

/** A staff member as the ruling gate knows them: the owner, live joined staff with a role, or nobody (null). */
export type StaffStanding = { kind: 'owner' } | { kind: 'staff'; role: 'senior' | 'mod' | 'helper' } | null;

/** Who someone is, from the owner-rooted ruling gate (Plan 4 Task 13), never from the API's staff table. */
export interface StaffDirectory {
  standing(accountId: string): Promise<StaffStanding>;
}

/**
 * The live certified staff device keys (design task 8, the `certify-device` tap). `device` answers
 * the device's certified public keys (hex) only for a certification of exactly this key to exactly
 * this person, unexpired and unrevoked at `at` (this process's clock), while the person still
 * stands in the gate; else null.
 */
export interface DeviceCertificates {
  device(accountId: string, deviceKeyId: string, at: Date): Promise<{ signPublic: string; boxPublic: string } | null>;
}

/** The certified device keys on the gate's state (design task 8); syncs the registry first, as `gateStaffDirectory`. */
export function gateDevices(g: { readonly state: GateState; sync(): Promise<void> }): DeviceCertificates {
  return {
    async device(accountId, deviceKeyId, at) {
      await g.sync();
      const d = deviceLive(g.state, accountId, deviceKeyId, at);
      return d === null ? null : { signPublic: d.signPublic, boxPublic: d.boxPublic };
    },
  };
}

/** No gate: no device key is certified, so no grant passes. */
export const NO_CERTIFIED_DEVICES: DeviceCertificates = { device: async () => null };

/** Lead 18 Nov: a staff device key's id is SHA-256 of its Ed25519 signing public key, hex, first 32 characters. */
export function deviceKeyIdOf(signPublic: Uint8Array): string {
  if (!(signPublic instanceof Uint8Array) || signPublic.length !== 32) throw new TypeError('device signing public key must be 32 bytes');
  return createHash('sha256').update(signPublic).digest('hex').slice(0, 32);
}

export const DEVICE_KEY_ID = /^[0-9a-f]{32}$/;

/**
 * The directory on the gate's state. `sync` brings the registry up to date first (as `gateCheck`
 * does), so a switch-off or removal the API already shows counts at once, not at the next periodic
 * sync. Only the gate's owner and staff who joined and are neither switched off nor removed stand.
 */
export function gateStaffDirectory(g: { readonly state: GateState; sync(): Promise<void> }): StaffDirectory {
  return {
    async standing(accountId) {
      await g.sync();
      const s = g.state;
      if (s.ownerAccountId !== null && s.ownerAccountId === accountId) return { kind: 'owner' };
      if (s.removedIds.includes(accountId)) return null;
      const e = Object.hasOwn(s.staff, accountId) ? s.staff[accountId] : undefined;
      if (!e || e.revoked || e.removed || !e.joined) return null;
      return { kind: 'staff', role: e.role };
    },
  };
}

/**
 * Whether this person is on this case: the assigned moderator (a moderator or senior the gate knows,
 * named as the current dispute's assignee), or a senior or the owner (OWNER p12-4). A helper never is.
 */
export function onCase(who: StaffStanding, accountId: string, assignee: string | null): boolean {
  if (who === null) return false;
  if (who.kind === 'staff' && who.role === 'helper') return false;
  const isAssignee = assignee !== null && assignee.toLowerCase() === accountId;
  if (isAssignee) return true;
  if (who.kind === 'owner' || who.role === 'senior') return SENIOR_OR_OWNER_JOINS_ANY_CASE;
  return false;
}
