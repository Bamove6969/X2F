import { GRANTABLE_PERMS, validateHours, type LoginHours, type StaffRole } from '@x2f/staff';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { lockAccount, withTx } from '../auth/hold.js';
import { endAllSessions } from '../auth/sessions.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { appendLog } from '../log/append.js';
import type { LogAction } from '../log/actions.js';
import { requireStaff } from './guard.js';
import { consumeKeyTap } from './keyTap.js';

// Plan 4 Task 7: the owner's staff management (perm `staff.manage`).
//
// - `GET /staff/v1/members` → `{ members }`: every staff member who was not removed, the owner
//   included, then every invite still waiting (status `waiting`, with `expiresAt`).
// - `POST /staff/v1/members/:id/switch-off` → `{ status: 'switched-off' }`: at once, no tap (it only
//   removes power): `accounts.disabled_at` and `switched_off_at` set and logged in one transaction,
//   then every session ended (`endAllSessions` with the app's bus). Already off: 409 `wrong-state`.
// - `POST /staff/v1/members/:id/switch-on { tapId }` (tap `switch-on`, bound to the person and
//   their current role) → `{ status: 'active' }`.
// - `PUT /staff/v1/members/:id/hours { hours }` → `{ hours }` (`validateHours`; 400 `bad-request`).
// - `PUT /staff/v1/members/:id/role { role, tapId }` (tap `set-role`) → `{ role }`. A senior or mod
//   role needs an attested security key (409 `security-key-required`): they rule or approve.
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
async function lockTarget(c: Queryable, accountId: string): Promise<Target> {
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

/**
 * NEEDS_P4_CASE_ASSIGNEE (members.test.ts): disputes have no assignee until Tasks 10-12, so a
 * switched-off member holds no cases yet. Then: clear their open cases' assignee here, in the
 * switch-off transaction, logging each, and count them in `openCases`.
 */
async function unassignOpenCases(_c: Queryable, _accountId: string): Promise<void> {}

export interface MemberRow {
  accountId: string | null;
  inviteId: string | null;
  username: string | null;
  role: StaffRole;
  status: 'active' | 'switched-off' | 'waiting';
  hours: unknown;
  joinedAt: string | null;
  lastActiveAt: string | null;
  openCases: number;
  expiresAt: string | null;
}

export async function listMembers(db: Queryable, now: Date): Promise<MemberRow[]> {
  const { rows: staff } = await db.query<{
    account_id: string; display_name: string; role: StaffRole; hours: unknown; switched_off_at: Date | null; joined_at: Date; last_active: Date | null;
  }>(
    `select m.account_id, a.display_name, m.role, m.hours, m.switched_off_at, m.joined_at,
            (select max(s.last_seen_at) from sessions s where s.account_id = m.account_id and s.app = 'staff') as last_active
       from staff_members m join accounts a on a.id = m.account_id
      where m.removed_at is null
      order by (m.role = 'owner') desc, m.joined_at, m.account_id`,
  );
  const { rows: invites } = await db.query<{ id: string; role: StaffRole; hours: unknown; expires_at: Date; display_name: string | null }>(
    `select i.id, i.role, i.hours, i.expires_at, a.display_name
       from staff_invites i left join accounts a on a.id = i.account_id
      where i.used_at is null and i.cancelled_at is null and i.expires_at > $1
      order by i.created_at, i.id`,
    [now],
  );
  return [
    ...staff.map((r): MemberRow => ({
      accountId: r.account_id, inviteId: null, username: r.display_name, role: r.role,
      status: r.switched_off_at === null ? 'active' : 'switched-off', hours: r.hours,
      joinedAt: r.joined_at.toISOString(), lastActiveAt: r.last_active?.toISOString() ?? null, openCases: 0, expiresAt: null,
    })),
    ...invites.map((r): MemberRow => ({
      accountId: null, inviteId: r.id, username: r.display_name, role: r.role, status: 'waiting', hours: r.hours,
      joinedAt: null, lastActiveAt: null, openCases: 0, expiresAt: r.expires_at.toISOString(),
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
      await c.query('update staff_members set switched_off_at = $2 where account_id = $1', [id, now]);
      await unassignOpenCases(c, id);
      await log(c, req, 'staff.switched-off', { staffId: id });
    });
    // After the commit (disabled_at already refuses every request): revoke the sessions and end
    // their streams. NEEDS_P4_MODERATION_REVOKE: then tell the moderation process (Task 13).
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
      if ((role === 'mod' || role === 'senior') && keys === 0) throw new ApiError(409, 'security-key-required');
      await consumeKeyTap(c, tapId, req.staff.accountId, { kind: 'set-role', accountId: id, role }, now, { sessionId: req.auth.sessionId });
      await c.query('update staff_members set role = $2, has_security_key = $3 where account_id = $1', [id, role, keys > 0]);
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
    await withTx(req.server.deps.db, async (c) => {
      await lockTarget(c, id);
      await consumeKeyTap(c, tapId, req.staff.accountId, { kind: 'set-grants', accountId: id, grants }, now, { sessionId: req.auth.sessionId });
      await c.query('update staff_members set grants = $2::text[] where account_id = $1', [id, grants]);
      await log(c, req, 'staff.grants-set', { staffId: id, ticketsHandle: grants.includes('tickets.handle'), feedbackRead: grants.includes('feedback.read') });
    });
    return { grants };
  });

  app.delete('/staff/v1/members/:id', opts, async (req, reply) => {
    const id = idParam(req);
    const { db, clock } = req.server.deps;
    const now = clock();
    await withTx(db, async (c) => {
      const target = await lockTarget(c, id);
      await c.query('update accounts set disabled_at = coalesce(disabled_at, $2) where id = $1', [id, now]);
      await c.query('update staff_members set switched_off_at = coalesce(switched_off_at, $2), removed_at = $2 where account_id = $1', [id, now]);
      if (!target.switchedOff) await unassignOpenCases(c, id);
      await log(c, req, 'staff.removed', { staffId: id });
    });
    await endAllSessions({ db, clock, events: req.server.events }, id);
    return reply.code(204).send();
  });
}
