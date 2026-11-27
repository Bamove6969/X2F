import { staffDeviceKeyId } from '@x2f/staff';
import type { FastifyInstance } from 'fastify';
import { addAlert, addOwnerAlert } from '../alerts.js';
import { withTx } from '../auth/liveSession.js';
import { pushOwnerAlert } from '../push/ownerAlert.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { requireStaff } from './guard.js';
import { consumeKeyTap } from './keyTap.js';
import { body, log, tapIdOf } from './members.js';
import { retireStaffCopies } from './staffCopies.js';

/**
 * Chat membership design task 8 (design section 4; lead 18 Nov): a staff member's own staff-web
 * device keys (perm `self`, every role, own account only). Staff-web makes and keeps the key; this
 * API only carries the tapped certification to the moderation gate, which re-verifies it from the
 * stored tap (`key_taps`) and is the only judge of what is certified. What this API answers is its
 * own view, for the staff site's display.
 *
 * - `GET /staff/v1/devices` → `{ accountId, devices: [{ deviceKeyId, signPublic, boxPublic, certifiedAt, expiresAt }] }`:
 *   the caller's certifications not revoked and not expired, by the used taps, and (review N4) issued
 *   after the person's last switch-off, removal or security reset, as the gate revokes them.
 * - `POST /staff/v1/devices { signPublic, boxPublic, tapId }` → 201 `{ deviceKeyId, expiresAt }`: a
 *   `certify-device` tap bound to exactly this person and these keys (id `staffDeviceKeyId`) is used,
 *   and `staff.device-certified` logged, in one transaction. 409 `device-exists` for a key id still
 *   live, 409 `device-limit` at STAFF_DEVICE_MAX live devices (the gate enforces both itself too).
 *   Re-review 2 m3 (lead default, an owner question): every certification alerts the owner (in-app
 *   and pushed, `staff-device-certified`) and the person (their own alerts, and one Jabber
 *   account-change notice when they have Jabber set up), because a page script can plant a key pair
 *   of its own and have it certified with one routine-looking tap: this alert is the signal.
 * - `POST /staff/v1/devices/:id/revoke { tapId }` → 204: a `revoke-device` tap naming that key id;
 *   the device's chat key copies marked removed (review N11 e); `staff.device-revoked` logged.
 */

/** Lead 18 Nov: a certification lasts 365 days; at most 3 live devices per person (the gate's own rules). */
export const STAFF_DEVICE_LIFETIME_MS = 365 * 86_400_000;
export const STAFF_DEVICE_MAX = 3;
const HEX64 = /^[0-9a-f]{64}$/;
const DEVICE_KEY_ID = /^[0-9a-f]{32}$/;

interface Device {
  deviceKeyId: string;
  signPublic: string;
  boxPublic: string;
  certifiedAt: string;
  expiresAt: string;
}

/**
 * When the gate revoked all of a person's devices last, by this API's records (review N4): their last
 * switch-off, their removal, or the owner's used `reset-staff-security` tap for them, whichever is
 * latest; null if none. A certification issued at or before it is not live (the gate revokes it).
 */
async function devicesEndedAt(q: Queryable, accountId: string): Promise<number | null> {
  const { rows } = await q.query<{ at: Date | null }>(
    `select greatest(
       (select greatest(m.last_switched_off_at, m.removed_at) from staff_members m where m.account_id::text = $1),
       (select max(used_at) from key_taps where used_at is not null and (intent::jsonb ->> 'kind') = 'reset-staff-security' and (intent::jsonb ->> 'accountId') = $1)
     ) as at`,
    [accountId],
  );
  return rows[0]?.at == null ? null : rows[0].at.getTime();
}

/** The person's live certifications as this API's used taps show them (revocations by anyone applied). */
export async function liveDevices(q: Queryable, accountId: string, now: Date): Promise<Device[]> {
  const { rows } = await q.query<{ intent: string }>(
    `select intent from key_taps
      where used_at is not null and (intent::jsonb ->> 'kind') in ('certify-device', 'revoke-device')
        and (intent::jsonb ->> 'accountId') = $1
      order by used_at, (intent::jsonb ->> 'kind') = 'revoke-device', id`,
    [accountId],
  );
  // At the same used_at, a certification before a revocation (the revoke route needs the id live, so
  // it always follows its certification; the gate never certifies a key again at or before its
  // revocation). Ordering by the random id alone made a revocation sometimes come first.
  // Review N4: what the gate revoked with the person (switch-off, removal, security reset) is gone
  // here too. Strictly after, with no clock skew: the gate revokes at its own sync, later still.
  const ended = await devicesEndedAt(q, accountId);
  const live = new Map<string, Device>();
  for (const r of rows) {
    const i = JSON.parse(r.intent) as { kind: string; deviceKeyId: string; signPublic?: string; boxPublic?: string; issuedAt?: string };
    if (i.kind === 'revoke-device') {
      live.delete(i.deviceKeyId);
      continue;
    }
    const at = Date.parse(i.issuedAt ?? '');
    if (!Number.isFinite(at) || typeof i.signPublic !== 'string' || typeof i.boxPublic !== 'string') continue;
    if (ended !== null && !(at > ended)) {
      live.delete(i.deviceKeyId);
      continue;
    }
    live.set(i.deviceKeyId, { deviceKeyId: i.deviceKeyId, signPublic: i.signPublic, boxPublic: i.boxPublic, certifiedAt: new Date(at).toISOString(), expiresAt: new Date(at + STAFF_DEVICE_LIFETIME_MS).toISOString() });
  }
  return [...live.values()].filter((d) => Date.parse(d.expiresAt) > now.getTime());
}

export function staffDeviceRoutes(app: FastifyInstance): void {
  const opts = { config: { perm: 'self' as const }, preHandler: requireStaff('self') };

  app.get('/staff/v1/devices', opts, async (req) => ({ accountId: req.staff.accountId, devices: await liveDevices(req.server.deps.db, req.staff.accountId, req.server.deps.clock()) }));

  app.post('/staff/v1/devices', opts, async (req, reply) => {
    const b = body(req);
    if (Object.keys(b).length !== 3 || typeof b.signPublic !== 'string' || !HEX64.test(b.signPublic) || typeof b.boxPublic !== 'string' || !HEX64.test(b.boxPublic)) {
      throw new ApiError(400, 'bad-request');
    }
    const signPublic = b.signPublic;
    const boxPublic = b.boxPublic;
    const tapId = tapIdOf(b);
    const deviceKeyId = staffDeviceKeyId(signPublic);
    const { db, clock } = req.server.deps;
    const me = req.staff.accountId;
    const now = clock();
    let expiresAt = '';
    await withTx(db, async (c) => {
      await c.query("select pg_advisory_xact_lock(hashtextextended('staff-devices/' || $1, 0))", [me]);
      const live = await liveDevices(c, me, now);
      if (live.some((d) => d.deviceKeyId === deviceKeyId)) throw new ApiError(409, 'device-exists');
      if (live.length >= STAFF_DEVICE_MAX) throw new ApiError(409, 'device-limit');
      const tap = await consumeKeyTap(c, tapId, me, { kind: 'certify-device', accountId: me, deviceKeyId, signPublic, boxPublic }, now, { sessionId: req.auth.sessionId });
      const issued = Date.parse((JSON.parse(tap.intent) as { issuedAt?: string }).issuedAt ?? '');
      expiresAt = new Date(issued + STAFF_DEVICE_LIFETIME_MS).toISOString();
      await log(c as Parameters<typeof log>[0], req, 'staff.device-certified', { deviceKeyId });
      // COPY-UNSIGNED
      const detail = { staffId: me, deviceKeyId, message: 'A browser was confirmed to read disputed chats. If this was not you, revoke it and tell the owner.' };
      await addOwnerAlert(c, 'staff-device-certified', detail, now);
      if (req.staff.role !== 'owner') await addAlert(c, me, 'staff-device-certified', detail, now);
      // The account-change path (owner rule p5-7): one discreet notice, when the person set Jabber up.
      await c.query("select jabber_queue(j.account_id, j.jid_sealed) from jabber_contacts j where j.account_id = $1 and j.enabled and j.jid_sealed is not null", [me]);
    });
    await pushOwnerAlert({ db, push: req.server.push }, 'staff-device-certified').catch(() => undefined);
    return reply.code(201).send({ deviceKeyId, expiresAt });
  });

  app.post('/staff/v1/devices/:id/revoke', opts, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!DEVICE_KEY_ID.test(id)) throw new ApiError(404, 'not-found');
    const b = body(req);
    if (Object.keys(b).length !== 1) throw new ApiError(400, 'bad-request');
    const tapId = tapIdOf(b);
    const { db, clock } = req.server.deps;
    const me = req.staff.accountId;
    const now = clock();
    await withTx(db, async (c) => {
      await c.query("select pg_advisory_xact_lock(hashtextextended('staff-devices/' || $1, 0))", [me]);
      if (!(await liveDevices(c, me, now)).some((d) => d.deviceKeyId === id)) throw new ApiError(404, 'not-found');
      await consumeKeyTap(c, tapId, me, { kind: 'revoke-device', accountId: me, deviceKeyId: id }, now, { sessionId: req.auth.sessionId });
      await retireStaffCopies(c, me, id, now);
      await log(c as Parameters<typeof log>[0], req, 'staff.device-revoked', { deviceKeyId: id });
    });
    return reply.code(204).send();
  });
}
