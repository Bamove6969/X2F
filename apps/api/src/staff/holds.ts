import type { FastifyInstance } from 'fastify';
import { endHoldByModerator, extendHoldByModerator, lockAccount, withTx } from '../auth/hold.js';
import { ApiError } from '../errors.js';
import { appendLog } from '../log/append.js';
import { requireStaff } from './guard.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A moderator moves a hold's end at most this far ahead of now. */
export const MAX_HOLD_EXTEND_MS = 30 * 86_400_000;

/**
 * A trader account's recovery-code hold, by staff (lead hold v3 review, minor; owner G35, 7 Nov:
 * every action is auditable). Perm `accounts.freeze` (senior moderators and the owner). Each writes
 * the activity log with the account and, for an extension, the new end.
 * - `POST /staff/v1/accounts/:id/hold/extend { until }` (an ISO time after now, at most 30 days
 *   ahead; never earlier than the hold's end) → 200 `{ holdUntil }`; 404 when no hold runs.
 * - `POST /staff/v1/accounts/:id/hold/end` → 204; 404 when no hold runs. The held trades resume.
 */
export function staffHoldRoutes(app: FastifyInstance): void {
  const perm = 'accounts.freeze' as const;
  const opts = { config: { perm }, preHandler: requireStaff(perm) };
  const accountOf = (params: unknown): string => {
    const id = (params as { id?: unknown }).id;
    if (typeof id !== 'string' || !UUID.test(id)) throw new ApiError(404, 'not-found');
    return id.toLowerCase();
  };
  const actor = (req: { staff: { accountId: string; role: string } }) => ({ kind: 'staff' as const, id: req.staff.accountId, role: req.staff.role as never });

  app.post('/staff/v1/accounts/:id/hold/extend', opts, async (req) => {
    const accountId = accountOf(req.params);
    const b = req.body;
    const raw = b !== null && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
    if (raw === null || Object.keys(raw).some((k) => k !== 'until') || typeof raw.until !== 'string') throw new ApiError(400, 'bad-request');
    const until = new Date(raw.until);
    const { db, clock } = req.server.deps;
    const now = clock();
    if (Number.isNaN(until.getTime()) || until.getTime() <= now.getTime() || until.getTime() > now.getTime() + MAX_HOLD_EXTEND_MS) {
      throw new ApiError(400, 'bad-request', { field: 'until' });
    }
    return withTx(db, async (c) => {
      await lockAccount(c, accountId);
      if (!(await extendHoldByModerator(c, accountId, until, now, { staffId: req.staff.accountId }))) throw new ApiError(404, 'not-found');
      const { rows } = await c.query<{ hold_until: Date }>('select hold_until from account_holds where account_id = $1', [accountId]);
      const holdUntil = rows[0]!.hold_until.toISOString();
      await appendLog(c, { at: now, actor: actor(req), tradeCode: null, action: 'hold.extended', detail: { accountId, holdUntil } });
      return { holdUntil };
    });
  });

  app.post('/staff/v1/accounts/:id/hold/end', opts, async (req, reply) => {
    const accountId = accountOf(req.params);
    const deps = req.server.deps;
    const ended = await endHoldByModerator(deps, accountId, { staffId: req.staff.accountId }, req.server.events);
    if (!ended) throw new ApiError(404, 'not-found');
    // The hold ended in its own transaction; the log entry follows it.
    await withTx(deps.db, (c) => appendLog(c, { at: deps.clock(), actor: actor(req), tradeCode: null, action: 'hold.ended', detail: { accountId } }));
    return reply.code(204).send();
  });
}
