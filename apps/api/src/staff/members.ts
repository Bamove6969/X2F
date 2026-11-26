import { GRANTABLE_PERMS, can, grantableTo, validateHours, type GrantablePerm, type LoginHours, type StaffRole } from '@x2f/staff';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { lockAccount, withTx } from '../auth/liveSession.js';
import { endAllSessions } from '../auth/sessions.js';
import type { Queryable } from '../db/pool.js';
import { retireStaffCopies } from './staffCopies.js';
import { ApiError } from '../errors.js';
import { eraseTermsSignature } from '../termsSignature.js';
import { appendLog } from '../log/append.js';
import type { LogAction } from '../log/actions.js';
import { requireStaff } from './guard.js';
import { consumeKeyTap } from './keyTap.js';
import { THREE_METHOD_ROLES, holdsModeratorMethods } from './login.js';

// Plan 4 Task 7: the owner's staff management (perm `staff.manage`).
//
// - `GET /staff/v1/members` → `{ members }`: every staff member who was not removed, the owner
//   included, then every invite still waiting (status `waiting`, with `expiresAt`).
// - `POST /staff/v1/members/:id/switch-off` → `{ status: 'switched-off' }`: at once, no tap (it only
//   removes power): `accounts.disabled_at` and `switched_off_at` set and logged in one transaction,
//   then every session ended (`endAllSessions` with the app's bus). Already off: 409 `wrong-state`.
// - `POST /staff/v1/members/:id/switch-on { tapId }` (tap `switch-on`, bound to the person and
//   their current role) → `{ status: 'active' }`. A moderator or senior must hold a PGP key and a
//   passkey (D-070, changing G3; 409 `moderator-methods-required`, the tap left unused).
//   `GET /staff/v1/members` lists, per moderator and senior, the methods they still lack (`missingMethods`),
//   and per member the stored per-person checkboxes (`grants`, J-21).
// - `PUT /staff/v1/members/:id/hours { hours }` → `{ hours }` (`validateHours`; 400 `bad-request`).
// - `PUT /staff/v1/members/:id/role { role, tapId }` (tap `set-role`) → `{ role }`. A senior or mod
//   role needs a PGP key and a passkey (D-070, owner p11-19; 409 `moderator-methods-required`). The
//   security key is optional, though rulings and approvals are still tapped with one (owner question).
// - `DELETE /staff/v1/members/:id` → 204: removed (spec 6.6, "add, remove and switch off"): switched
//   off for good, gone from the list, never switched on again; the row and the log stay.
//
// Every one of them refuses 409 `owner-protected` when the target is the owner, whoever asks (the
// owner included), before any tap is used. A target that is not a (live) staff member: 404.
// The owner's own row is also guarded by the database (202's checks; 205's `removed_at` check).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const INVITABLE_ROLES = ['senior', 'mod', 'helper'] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export function body(req: FastifyRequest): Record<string, unknown> {
  const b = req.body ?? {};
  if (b === null || typeof b !== 'object' || Array.isArray(b)) throw new ApiError(400, 'bad-request');
  return b as Record<string, unknown>;
}

/** The `:id` path parameter as a lower-case uuid; anything else is 404 `not-found`. */
export function idParam(req: FastifyRequest): string {
  const id = (req.params as { id?: unknown }).id;
  if (typeof id !== 'string' || !UUID.test(id)) throw new ApiError(404, 'not-found');
  return id.toLowerCase();
}

export function roleOf(v: unknown): InvitableRole {
  if (typeof v !== 'string' || !(INVITABLE_ROLES as readonly string[]).includes(v)) throw new ApiError(400, 'bad-request');
  return v as InvitableRole;
}

export function hoursOf(v: unknown): LoginHours {
  try {
    return validateHours(v);
  } catch {
    throw new ApiError(400, 'bad-request');
  }
}

/** A tap id as sent; a missing one is refused exactly like a wrong one (403 `tap-invalid`). */
export const tapIdOf = (b: Record<string, unknown>): string => (typeof b.tapId === 'string' ? b.tapId : '');

/** The calling staff member as a log actor. */
export const actorOf = (req: FastifyRequest) => ({ kind: 'staff' as const, id: req.staff.accountId, role: req.staff.role });

export async function log(c: pg.PoolClient, req: FastifyRequest, action: LogAction, detail: object): Promise<void> {
  await appendLog(c, { at: req.server.deps.clock(), actor: actorOf(req), tradeCode: null, action, detail });
}

/** How many attested security keys the account holds (a ruling or an approval needs one). */
export async function attestedKeyCount(q: Queryable, accountId: string): Promise<number> {
  const { rows } = await q.query<{ n: number }>(
    "select count(*)::int as n from webauthn_credentials where account_id = $1 and kind = 'security-key' and attested",
    [accountId],
  );
  return rows[0]!.n;
}

interface Target {
  role: StaffRole;
  switchedOff: boolean;
}

/**
 * The target staff member, locked (`accounts` row first, then `staff_members`, the order every
 * staff write takes). 404 unless a live (not removed) staff member; 409 `owner-protected` for the
 * owner.
 */
export async function lockTarget(c: Queryable, accountId: string): Promise<Target> {
  await lockAccount(c, accountId);
  const { rows } = await c.query<{ role: StaffRole; switched_off_at: Date | null }>(
    'select role, switched_off_at from staff_members where account_id = $1 and removed_at is null for update',
    [accountId],
  );
  const r = rows[0];
  if (!r) throw new ApiError(404, 'not-found');
  if (r.role === 'owner') throw new ApiError(409, 'owner-protected');
  return { role: r.role, switchedOff: r.switched_off_at !== null };
}

/** A member's open cases: disputes assigned to them that still wait on a moderator (Task 10's statuses). */
const OPEN_CASE_STATUSES = ['open', 'appealed'] as const;

/**
 * Was NEEDS_P4_CASE_ASSIGNEE: a switched-off or removed member's open cases go back to the queue
 * (assignee cleared) in the same transaction, each logged as `dispute.unassigned` with its trade
 * code. A proposal already waiting for approval keeps its proposer: the approval is the senior's.
 */
export async function unassignOpenCases(c: pg.PoolClient, accountId: string, req: FastifyRequest): Promise<void> {
  const { rows } = await c.query<{ code: string }>(
    'update disputes set assignee = null where assignee = $1 and status = any($2::text[]) returning code',
    [accountId, OPEN_CASE_STATUSES],
  );
  for (const r of rows) {
    // Lead review 7 Nov: the system unassigns (a consequence of the switch-off, logged by its own entry).
    await appendLog(c, { at: req.server.deps.clock(), actor: { kind: 'system' }, tradeCode: r.code, action: 'dispute.unassigned', detail: { staffId: accountId } });
  }
}

export interface MemberRow {
  accountId: string | null;
  inviteId: string | null;
  tradeTag: string | null;
  role: StaffRole;
  status: 'active' | 'switched-off' | 'waiting';
  hours: unknown;
  joinedAt: string | null;
  lastActiveAt: string | null;
  openCases: number;
  expiresAt: string | null;
  /**
   * Owner G3 (review P-m2): the methods a moderator or senior moderator lacks of the three (an
   * attested security key, a PGP key, a passkey), so the owner can follow up with those who joined
   * before G3; empty for everyone else and for invites. Since D-070 a missing security key is listed
   * but no longer refuses anything (the moderator cannot tap rulings without one).
   */
  missingMethods: Array<'security-key' | 'pgp' | 'passkey'>;
  /**
   * J-21 (owner Q60): the per-person checkboxes as stored (only GRANTABLE_PERMS, sorted), for the
   * Staff page; [] for the owner and for invites. What a role holds anyway (a senior's Feedback) is
   * never a per-person box (review F5): it is left out here, a save does not store it and a role
   * change clears it (`perPersonGrants`).
   */
  grants: string[];
}

/**
 * J-21 review F5 (lead, 12 Nov): the per-person boxes worth storing for `role`: grantable perms the
 * role does not already hold, sorted. A box the role holds is shown ticked and fixed from the role
 * itself (staff-web StaffGrants), never from a stored grant, so it never comes back on its own after
 * a demotion.
 */
export function perPersonGrants(role: StaffRole, grants: readonly string[]): GrantablePerm[] {
  return [...new Set(grants)]
    .filter((g): g is GrantablePerm => grantableTo(role, g as GrantablePerm) && !can(role, g as GrantablePerm))
    .sort();
}

export async function listMembers(db: Queryable, now: Date): Promise<MemberRow[]> {
  const { rows: staff } = await db.query<{
    account_id: string; trade_tag: string; role: StaffRole; hours: unknown; switched_off_at: Date | null; joined_at: Date; last_active: Date | null;
    open_cases: number; keys: number; pgp: number; passkeys: number; grants: string[];
  }>(
    `select m.account_id, a.trade_tag, m.role, m.hours, m.switched_off_at, m.joined_at, m.grants,
            (select count(*)::int from webauthn_credentials w where w.account_id = m.account_id and w.kind = 'security-key' and w.attested) as keys,
            (select count(*)::int from pgp_keys p where p.account_id = m.account_id) as pgp,
            (select count(*)::int from webauthn_credentials w where w.account_id = m.account_id and w.kind = 'passkey') as passkeys,
            (select max(s.last_seen_at) from sessions s where s.account_id = m.account_id and s.app = 'staff') as last_active,
            (select count(*)::int from disputes d where d.assignee = m.account_id and d.status = any($1::text[])) as open_cases
       from staff_members m join accounts a on a.id = m.account_id
      where m.removed_at is null
      order by (m.role = 'owner') desc, m.joined_at, m.account_id`,
    [OPEN_CASE_STATUSES],
  );
  const { rows: invites } = await db.query<{ id: string; role: StaffRole; hours: unknown; expires_at: Date; trade_tag: string | null }>(
    `select i.id, i.role, i.hours, i.expires_at, a.trade_tag
       from staff_invites i left join accounts a on a.id = i.account_id
      where i.kind = 'invite' and i.used_at is null and i.cancelled_at is null and i.expires_at > $1
      order by i.created_at, i.id`,
    [now],
  );
  return [
    ...staff.map((r): MemberRow => ({
      accountId: r.account_id, inviteId: null, tradeTag: r.trade_tag, role: r.role,
      status: r.switched_off_at === null ? 'active' : 'switched-off', hours: r.hours,
      joinedAt: r.joined_at.toISOString(), lastActiveAt: r.last_active?.toISOString() ?? null, openCases: r.open_cases, expiresAt: null,
      missingMethods: THREE_METHOD_ROLES.includes(r.role)
        ? [...(r.keys > 0 ? [] : ['security-key' as const]), ...(r.pgp > 0 ? [] : ['pgp' as const]), ...(r.passkeys > 0 ? [] : ['passkey' as const])]
        : [],
      grants: r.role === 'owner' ? [] : perPersonGrants(r.role, r.grants),
    })),
    ...invites.map((r): MemberRow => ({
      accountId: null, inviteId: r.id, tradeTag: r.trade_tag, role: r.role, status: 'waiting', hours: r.hours,
      joinedAt: null, lastActiveAt: null, openCases: 0, expiresAt: r.expires_at.toISOString(), missingMethods: [], grants: [],
    })),
  ];
}

export function staffMemberRoutes(app: FastifyInstance): void {
  const perm = 'staff.manage' as const;
  const opts = { config: { perm }, preHandler: requireStaff(perm) };

  app.get('/staff/v1/members', opts, async (req) => ({ members: await listMembers(req.server.deps.db, req.server.deps.clock()) }));

  app.post('/staff/v1/members/:id/switch-off', opts, async (req) => {
    const id = idParam(req);
    const { db, clock } = req.server.deps;
    const now = clock();
    await withTx(db, async (c) => {
      const target = await lockTarget(c, id);
      if (target.switchedOff) throw new ApiError(409, 'wrong-state');
      await c.query('update accounts set disabled_at = $2 where id = $1', [id, now]);
      await c.query('update staff_members set switched_off_at = $2, last_switched_off_at = $2 where account_id = $1', [id, now]);
      // Review N11 (e): the gate revokes their devices; their chat key copies are marked removed.
      await retireStaffCopies(c, id, null, now);
      await unassignOpenCases(c, id, req);
      await log(c, req, 'staff.switched-off', { staffId: id });
    });
    // After the commit (disabled_at already refuses every request): revoke the sessions and end
    // their streams. The moderation gate reads the switch-off itself before every ruling it checks (Task 13).
    await endAllSessions({ db, clock, events: req.server.events }, id);
    return { status: 'switched-off' };
  });

  app.post('/staff/v1/members/:id/switch-on', opts, async (req) => {
    const id = idParam(req);
    const tapId = tapIdOf(body(req));
    const { db, clock } = req.server.deps;
    const now = clock();
    await withTx(db, async (c) => {
      const target = await lockTarget(c, id);
      if (!target.switchedOff) throw new ApiError(409, 'wrong-state');
      // Owner G3 (review P-m2), as D-070 changed it: a moderator or senior is switched on only holding
      // a PGP key and a passkey.
      if (THREE_METHOD_ROLES.includes(target.role) && !(await holdsModeratorMethods(c, id))) throw new ApiError(409, 'moderator-methods-required');
      await consumeKeyTap(c, tapId, req.staff.accountId, { kind: 'switch-on', accountId: id, role: target.role as InvitableRole }, now, { sessionId: req.auth.sessionId });
      await c.query('update accounts set disabled_at = null where id = $1', [id]);
      await c.query('update staff_members set switched_off_at = null where account_id = $1', [id]);
      await log(c, req, 'staff.switched-on', { staffId: id, role: target.role });
    });
    return { status: 'active' };
  });

  app.put('/staff/v1/members/:id/hours', opts, async (req) => {
    const id = idParam(req);
    const hours = hoursOf(body(req).hours);
    await withTx(req.server.deps.db, async (c) => {
      await lockTarget(c, id);
      await c.query('update staff_members set hours = $2 where account_id = $1', [id, JSON.stringify(hours)]);
      await log(c, req, 'staff.hours-set', { staffId: id });
    });
    return { hours };
  });

  app.put('/staff/v1/members/:id/role', opts, async (req) => {
    const id = idParam(req);
    const b = body(req);
    const role = roleOf(b.role);
    const tapId = tapIdOf(b);
    const now = req.server.deps.clock();
    await withTx(req.server.deps.db, async (c) => {
      const target = await lockTarget(c, id);
      const keys = await attestedKeyCount(c, id);
      // D-070 (owner p11-19, changing G3): a moderator or senior holds a PGP key and a passkey; the
      // security key is optional.
      if (THREE_METHOD_ROLES.includes(role) && !(await holdsModeratorMethods(c, id))) throw new ApiError(409, 'moderator-methods-required');
      await consumeKeyTap(c, tapId, req.staff.accountId, { kind: 'set-role', accountId: id, role }, now, { sessionId: req.auth.sessionId });
      // Review F5: what the new role holds is not kept as a per-person box; nor what the old role held
      // (re-verify R1: a box stored before F5 and hidden while the role held it would otherwise come
      // back on its own after a demotion).
      const { rows: held } = await c.query<{ grants: string[] }>('select grants from staff_members where account_id = $1', [id]);
      await c.query('update staff_members set role = $2, has_security_key = $3, grants = $4::text[] where account_id = $1', [
        id, role, keys > 0, perPersonGrants(role, perPersonGrants(target.role, held[0]?.grants ?? [])),
      ]);
      await log(c, req, 'staff.role-set', { staffId: id, from: target.role, to: role });
    });
    return { role };
  });

  // Owner Q60 / Q16: the per-person checkboxes (`grants`: tickets.handle, feedback.read), set with a
  // tap bound to the person and the exact list (sorted). The owner's own row has none (owner-protected).
  app.put('/staff/v1/members/:id/grants', opts, async (req) => {
    const id = idParam(req);
    const b = body(req);
    const raw = b.grants;
    if (!Array.isArray(raw) || raw.some((g) => typeof g !== 'string' || !(GRANTABLE_PERMS as readonly string[]).includes(g))) {
      throw new ApiError(400, 'bad-request', { field: 'grants' });
    }
    const grants = [...new Set(raw as string[])].sort();
    if (grants.length !== raw.length) throw new ApiError(400, 'bad-request', { field: 'grants' });
    const tapId = tapIdOf(b);
    const now = req.server.deps.clock();
    const stored = await withTx(req.server.deps.db, async (c) => {
      const target = await lockTarget(c, id);
      await consumeKeyTap(c, tapId, req.staff.accountId, { kind: 'set-grants', accountId: id, grants }, now, { sessionId: req.auth.sessionId });
      // Review F5: the tap is bound to the list as sent; what the role holds anyway is not stored.
      const kept = perPersonGrants(target.role, grants);
      await c.query('update staff_members set grants = $2::text[] where account_id = $1', [id, kept]);
      await log(c, req, 'staff.grants-set', { staffId: id, ticketsHandle: kept.includes('tickets.handle'), feedbackRead: kept.includes('feedback.read'), ban: kept.includes('accounts.ban'), liftBan: kept.includes('accounts.unban') });
      return kept;
    });
    return { grants: stored };
  });

  // Owner G4 (7 Nov): a permanent removal is tapped (`remove-staff` bound to the person).
  app.delete('/staff/v1/members/:id', opts, async (req, reply) => {
    const id = idParam(req);
    const tapId = tapIdOf(body(req));
    const { db, clock } = req.server.deps;
    const now = clock();
    await withTx(db, async (c) => {
      const target = await lockTarget(c, id);
      await consumeKeyTap(c, tapId, req.staff.accountId, { kind: 'remove-staff', accountId: id }, now, { sessionId: req.auth.sessionId });
      await c.query('update accounts set disabled_at = coalesce(disabled_at, $2) where id = $1', [id, now]);
      await c.query('update staff_members set switched_off_at = coalesce(switched_off_at, $2), last_switched_off_at = coalesce(switched_off_at, $2), removed_at = $2 where account_id = $1', [id, now]);
      await retireStaffCopies(c, id, null, now);
      // Removal closes the staff login for good (switch-off can be undone, so it keeps it).
      await eraseTermsSignature(c, id);
      // D-032: an open security-reset link of theirs ends with them.
      await c.query("update staff_invites set cancelled_at = $2 where account_id = $1 and kind = 'reset' and used_at is null and cancelled_at is null", [id, now]);
      if (!target.switchedOff) await unassignOpenCases(c, id, req);
      await log(c, req, 'staff.removed', { staffId: id });
    });
    await endAllSessions({ db, clock, events: req.server.events }, id);
    return reply.code(204).send();
  });
}
