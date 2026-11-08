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
 * Every write re-checks its session under the account lock (`requireLiveSessionInTx`,
 * `LIVE_SESSION_ROUTES`). Team members get 403 `owner-only` (`requireSession`'s default).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ApiError } from '../errors.js';
import { holdInTx, holdRefusal, lockAccount, requireLiveSessionInTx, requireNotHeld, settleOf, weakOf, weakRefusal, withTx } from './hold.js';
import { HOLD_CHANGE_ACTIONS_PER_DAY, approveChanges, cancelChanges, changesWait, holdActionsKey, listChanges, settleChangesInTx, submitChanges } from './holdChanges.js';
import { dailyCap } from './throttle.js';
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

export function holdRoutes(app: FastifyInstance): void {
  app.get('/v1/account/hold', { preHandler: requireSession({ allowRecovery: true, allowHeld: true, kinds: ['trader'] }) }, async (req) => {
    const deps = req.server.deps;
    const { accountId, sessionId } = req.auth;
    const now = deps.clock();
    const hold = await withTx(deps.db, async (db) => {
      await lockAccount(db, accountId);
      await settleChangesInTx(db, settleOf(req), accountId, now);
      return holdInTx(db, settleOf(req), accountId, now);
    });
    return {
      accountHold: hold === null ? null : { until: hold.holdUntil.toISOString(), reason: hold.reason },
      ...(await listChanges(deps.db, accountId, sessionId)),
      changesWait: await changesWait(req),
    };
  });

  app.post('/v1/account/hold/changes/submit', { preHandler: [requireSession({ kinds: ['trader'] }), requireNotHeld] }, async (req) => {
    const ids = idsOf(req);
    const deps = req.server.deps;
    const now = deps.clock();
    await dailyCap(deps, holdActionsKey(req.auth.accountId), HOLD_CHANGE_ACTIONS_PER_DAY);
    const out = await withTx(deps.db, async (db) => {
      await requireLiveSessionInTx(db, req.auth, now);
      const hold = await holdInTx(db, settleOf(req), req.auth.accountId, now);
      if (hold !== null) throw holdRefusal(hold.holdUntil);
      await settleChangesInTx(db, settleOf(req), req.auth.accountId, now);
      return submitChanges(db, req.auth.accountId, req.auth.sessionId, ids, now);
    });
    // The owner hears at once on every device (Jabber later).
    void req.server.push.send(req.auth.accountId, 'alert').catch(() => undefined);
    return { status: 'queued' as const, ...out };
  });

  // Owner G58 (7 Nov): a strong session approves waiting changes now (a weak one 403 weak-session).
  app.post('/v1/account/hold/changes/approve', { preHandler: [requireSession({ kinds: ['trader'] }), requireNotHeld] }, async (req) => {
    const ids = idsOf(req);
    const deps = req.server.deps;
    const now = deps.clock();
    await dailyCap(deps, holdActionsKey(req.auth.accountId), HOLD_CHANGE_ACTIONS_PER_DAY);
    const n = await withTx(deps.db, async (db) => {
      const live = await requireLiveSessionInTx(db, req.auth, now);
      if (weakOf(live, now)) throw weakRefusal();
      const hold = await holdInTx(db, settleOf(req), req.auth.accountId, now);
      if (hold !== null) throw holdRefusal(hold.holdUntil);
      return approveChanges(db, settleOf(req), req.auth.accountId, ids, now);
    });
    if (n > 0) void req.server.push.send(req.auth.accountId, 'alert').catch(() => undefined);
    return { status: 'applied' as const, count: n };
  });

  const cancel = async (req: FastifyRequest, id: string | null): Promise<void> => {
    const deps = req.server.deps;
    const now = deps.clock();
    await dailyCap(deps, holdActionsKey(req.auth.accountId), HOLD_CHANGE_ACTIONS_PER_DAY);
    const n = await withTx(deps.db, async (db) => {
      await requireLiveSessionInTx(db, req.auth, now);
      await settleChangesInTx(db, settleOf(req), req.auth.accountId, now);
      return cancelChanges(db, req.auth.accountId, req.auth.sessionId, id, now);
    });
    if (id !== null && n === 0) throw new ApiError(404, 'not-found');
    if (n > 0) void req.server.push.send(req.auth.accountId, 'alert').catch(() => undefined);
  };
  // A recovery session cancels too, during its hold (owner G32: the recovery-code login keeps the
  // waiting changes; cancelling only takes power away).
  const cancelOpts = { preHandler: requireSession({ kinds: ['trader'], allowRecovery: true, allowHeld: true }) };
  app.delete('/v1/account/hold/changes', cancelOpts, async (req, reply) => {
    await cancel(req, null);
    return reply.code(204).send();
  });
  app.delete('/v1/account/hold/changes/:id', cancelOpts, async (req, reply) => {
    const id = (req.params as { id?: unknown }).id;
    if (typeof id !== 'string' || !UUID.test(id)) throw new ApiError(404, 'not-found');
    await cancel(req, id.toLowerCase());
    return reply.code(204).send();
  });
}
