/**
 * Hold model v3 routes (hold.ts, holdChanges.ts):
 * - `GET /v1/account/hold` (the account owner's sessions, a held recovery session too) → `{
 *   accountHold: { until, reason } | null, changes: { count, takesEffectAt, items }, drafts,
 *   changesWait }`: the account's hold, the changes waiting their 24 h (every session's, each with
 *   the device that staged it and `mine`), this session's drafts to review, and whether this
 *   session's changes wait (the pop-up warns before the first one). Changes whose date has come
 *   apply first.
 * - `POST /v1/account/hold/changes/submit { ids }` → `{ status: 'queued', count, takesEffectAt }`:
 *   exactly the drafts this session reviewed (409 `changes-changed` otherwise); pushed to every
 *   device of the account.
 * - `DELETE /v1/account/hold/changes` and `DELETE /v1/account/hold/changes/:id` → 204: any session
 *   of the account owner, a username-and-password one included, cancels the waiting changes (or one of
 *   them, or one of its own drafts); 404 for nothing to cancel by that id.
 * - `POST /v1/account/hold/changes/approve { ids }`: a strong login applies those waiting changes now (G58).
 *
 * Team members (owner p4-8, 7 Nov 2026; the HoldMember board): the lead grants the "Holds and
 * waiting changes" rights (team/perms.ts). Every member reads `GET /v1/account/hold` with `rights`
 * and `lead` (the team's name): without a right (`none`, the default) it says only that a hold is
 * on (`changes.takesEffectAt`, no count, no list); `see` lists the waiting changes; `cancel` also
 * unticks or cancels them (never the lead's drafts); `end` also approves them now, from a strong
 * login. A member never cancels or approves a change that names them (their removal or roles: 403
 * `forbidden`, lead review 8 Nov I3), and never sees the lead's device names (`by` is null). Each member action writes a team audit row (G35). Submitting stays the lead's.
 *
 * Every write re-checks its session under the account lock (`requireLiveSessionInTx`,
 * `LIVE_SESSION_ROUTES`).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { auditMember } from '../team/audit.js';
import { holdRightOf } from '../team/perms.js';
import { holdInTx, holdRefusal, lockAccount, requireLiveSessionInTx, requireNotHeld, settleOf, weakOf, weakRefusal, withTx } from './hold.js';
import { HOLD_CHANGE_ACTIONS_PER_DAY, approveChanges, cancelChanges, changesWait, holdActionsKey, listChanges, settleChangesInTx, submitChanges } from './holdChanges.js';
import { dailyCapInTx } from './throttle.js';
import { requireSession } from './sessions.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idsOf(req: FastifyRequest): string[] {
  const b = req.body;
  const ids = b !== null && typeof b === 'object' ? (b as { ids?: unknown }).ids : undefined;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 50 || !ids.every((i) => typeof i === 'string' && UUID.test(i))) {
    throw new ApiError(400, 'bad-request');
  }
  return (ids as string[]).map((i) => i.toLowerCase());
}

const actor = (req: FastifyRequest) => ({ accountId: req.auth.accountId, memberId: req.auth.memberId });

export function holdRoutes(app: FastifyInstance): void {
  // Owner p4-8: every member reads the view; what it holds follows their hold right.
  const holdReader = requireSession({ allowRecovery: true, allowHeld: true, kinds: ['trader'], member: 'any' });
  app.get('/v1/account/hold', { preHandler: holdReader }, async (req) => {
    const deps = req.server.deps;
    const { accountId, sessionId, memberId } = req.auth;
    const now = deps.clock();
    const hold = await withTx(deps.db, async (db) => {
      await lockAccount(db, accountId);
      await settleChangesInTx(db, settleOf(req), accountId, now);
      return holdInTx(db, settleOf(req), accountId, now);
    });
    const accountHold = hold === null ? null : { until: hold.holdUntil.toISOString(), reason: hold.reason };
    const list = await listChanges(deps.db, accountId, sessionId);
    if (memberId === null) return { accountHold, ...list, changesWait: await changesWait(req) };
    const rights = holdRightOf(req.auth.memberAbilities);
    const lead = (await deps.db.query<{ display_name: string }>('select display_name from accounts where id = $1', [accountId])).rows[0]?.display_name ?? '';
    const changes = rights === 'none'
      ? { count: 0, takesEffectAt: list.changes.takesEffectAt, items: [] }
      // Lead review 8 Nov minor 11: never the lead's device names (`by`) to a member.
      : { ...list.changes, items: list.changes.items.map((i) => ({ ...i, by: null, mine: false })) };
    return { accountHold, changes, drafts: [], changesWait: false, rights, lead };
  });

  app.post('/v1/account/hold/changes/submit', { preHandler: [requireSession({ kinds: ['trader'] }), requireNotHeld] }, async (req) => {
    const ids = idsOf(req);
    const deps = req.server.deps;
    const now = deps.clock();
    const out = await withTx(deps.db, async (db) => {
      await requireLiveSessionInTx(db, req.auth, now);
      const hold = await holdInTx(db, settleOf(req), req.auth.accountId, now);
      if (hold !== null) throw holdRefusal(hold.holdUntil);
      await settleChangesInTx(db, settleOf(req), req.auth.accountId, now);
      const submitted = await submitChanges(db, req.auth.accountId, req.auth.sessionId, ids, now);
      await dailyCapInTx(db, holdActionsKey(req.auth.sessionId), HOLD_CHANGE_ACTIONS_PER_DAY, now);
      return submitted;
    });
    // The owner hears at once on every device (Jabber later).
    void req.server.push.send(req.auth.accountId, 'alert').catch(() => undefined);
    return { status: 'queued' as const, ...out };
  });

  // Owner G58 (7 Nov): a strong session approves waiting changes now (a weak one 403 weak-session).
  // Owner p4-8: a member with the "End a hold" right too, from their own strong login.
  const holdEnder = requireSession({ kinds: ['trader'], member: 'hold-end' });
  app.post('/v1/account/hold/changes/approve', { preHandler: [holdEnder, requireNotHeld] }, async (req) => {
    const ids = idsOf(req);
    const deps = req.server.deps;
    const now = deps.clock();
    const n = await withTx(deps.db, async (db) => {
      const live = await requireLiveSessionInTx(db, req.auth, now);
      if (weakOf(live, now)) throw weakRefusal();
      const hold = await holdInTx(db, settleOf(req), req.auth.accountId, now);
      if (hold !== null) throw holdRefusal(hold.holdUntil);
      const settled = await approveChanges(db, settleOf(req), req.auth.accountId, ids, now, req.auth.memberId !== null ? { memberId: req.auth.memberId } : {});
      await dailyCapInTx(db, holdActionsKey(req.auth.sessionId), HOLD_CHANGE_ACTIONS_PER_DAY, now);
      await auditMember(db, actor(req), { action: 'hold-changes-approved', detail: { count: settled } }, now);
      return settled;
    });
    if (n > 0) void req.server.push.send(req.auth.accountId, 'alert').catch(() => undefined);
    return { status: 'applied' as const, count: n };
  });

  /** Cancels (all, or `id`) under the account lock; `audit` writes the member's team audit row in the same transaction. */
  const cancel = async (req: FastifyRequest, id: string | null, audit: (db: Queryable, n: number) => Promise<void>): Promise<void> => {
    const deps = req.server.deps;
    const now = deps.clock();
    // Never rate-limited (lead review 8 Nov C1): cancelling only takes power away (g65), and a
    // shared limit let a thief lock the owner out of cancelling. It writes an alert only when a
    // waiting change went, and those are bounded by the staging limit.
    const n = await withTx(deps.db, async (db) => {
      await requireLiveSessionInTx(db, req.auth, now);
      await settleChangesInTx(db, settleOf(req), req.auth.accountId, now);
      const member = req.auth.memberId !== null ? { member: req.auth.memberName ?? '', memberId: req.auth.memberId } : {};
      const gone = await cancelChanges(db, req.auth.accountId, req.auth.sessionId, id, now, member);
      if (gone > 0) await audit(db, gone);
      return gone;
    });
    if (id !== null && n === 0) throw new ApiError(404, 'not-found');
    if (n > 0) void req.server.push.send(req.auth.accountId, 'alert').catch(() => undefined);
  };
  // A recovery session cancels too, during its hold (owner G32: the recovery-code login keeps the
  // waiting changes; cancelling only takes power away). Owner p4-8: a member with the "Untick or
  // cancel waiting changes" right (or "End a hold") cancels waiting changes, never the lead's drafts.
  const holdCanceller = requireSession({ kinds: ['trader'], allowRecovery: true, allowHeld: true, member: 'hold-cancel' });
  app.delete('/v1/account/hold/changes', { preHandler: holdCanceller }, async (req, reply) => {
    await cancel(req, null, (db, n) => auditMember(db, actor(req), { action: 'hold-changes-cancelled', detail: { count: n } }, req.server.deps.clock()));
    return reply.code(204).send();
  });
  app.delete('/v1/account/hold/changes/:id', { preHandler: holdCanceller }, async (req, reply) => {
    const id = (req.params as { id?: unknown }).id;
    if (typeof id !== 'string' || !UUID.test(id)) throw new ApiError(404, 'not-found');
    await cancel(req, id.toLowerCase(), (db, n) => auditMember(db, actor(req), { action: 'hold-changes-cancelled', detail: { count: n } }, req.server.deps.clock()));
    return reply.code(204).send();
  });
}
