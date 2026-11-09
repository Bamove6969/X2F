import type { FastifyInstance } from 'fastify';
import { withTx } from '../auth/hold.js';
import { ApiError } from '../errors.js';
import { appendLog } from '../log/append.js';
import { MAX_VERIFIED_USD_CENTS, setVerifiedPastRepUsd } from '../pastrep/store.js';
import { requireStaff } from './guard.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `PUT /staff/v1/past-rep/:id/verified-usd { usdCents }` (perm `reputation.verify`: senior moderators
 * and the owner, owner 2026-11-02) sets a live past-reputation claim's verified dollar figure in whole
 * US cents, at most $100,000 (owner Q58); `usdCents: null` clears it. Only through
 * `setVerifiedPastRepUsd`, with the signed-in staff member's role from the database. The activity log
 * gets the claim id and whether it was cleared, never the figure, in the same transaction.
 * Answers: 200 `{ ok: true }`; 400 `bad-request` (a bad body or amount); 404 `not-found`; 409
 * `not-live` (revoked, removed or rejected).
 */
export function staffPastRepRoutes(app: FastifyInstance): void {
  const perm = 'reputation.verify' as const;
  app.put('/staff/v1/past-rep/:id/verified-usd', { config: { perm }, preHandler: requireStaff(perm) }, async (req) => {
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) throw new ApiError(404, 'not-found');
    const body = req.body;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'bad-request');
    const { usdCents, ...rest } = body as Record<string, unknown>;
    if (Object.keys(rest).length > 0) throw new ApiError(400, 'bad-request');
    if (usdCents !== null && !(typeof usdCents === 'number' && Number.isSafeInteger(usdCents) && usdCents > 0 && usdCents <= MAX_VERIFIED_USD_CENTS)) {
      throw new ApiError(400, 'bad-request', { field: 'usdCents' });
    }
    const { db, clock } = req.server.deps;
    const now = clock();
    return withTx(db, async (c) => {
      const r = await setVerifiedPastRepUsd(c, id.toLowerCase(), usdCents, { accountId: req.staff.accountId, role: req.staff.role }, now);
      if (!r.ok) {
        if (r.reason === 'not-found') throw new ApiError(404, 'not-found');
        if (r.reason === 'not-live') throw new ApiError(409, 'not-live');
        if (r.reason === 'bad-amount') throw new ApiError(400, 'bad-request', { field: 'usdCents' });
        throw new ApiError(403, 'forbidden');
      }
      await appendLog(c, {
        at: now, actor: { kind: 'staff', id: req.staff.accountId, role: req.staff.role }, tradeCode: null,
        action: 'pastrep.verified-usd-set', detail: { claimId: id.toLowerCase(), cleared: usdCents === null },
      });
      return { ok: true };
    });
  });
}
