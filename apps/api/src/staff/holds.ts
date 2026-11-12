import type { FastifyInstance } from 'fastify';
import { endHoldByModerator, extendHoldByModerator, lockAccount, withTx, type Hold } from '../auth/hold.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { appendLog } from '../log/append.js';
import type { StaffDeps } from './app.js';
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
 * - `POST /staff/v1/accounts/:id/hold/end { via? }` → 204; 404 when no hold runs. The held trades resume.
 *   D-064 (owner 30 Oct N50-N51: "we will also try to contact you via the secure Jabber account you
 *   had the option of setting up"; staff who reach the person there may end the hold): `via:
 *   'secure-jabber'` says staff reached the account holder on the account's own secure Jabber
 *   address. It needs an address proven before the hold began (Jabber set-up waits out a hold, so a
 *   later one would be whoever used the recovery code): else 409 `no-secure-jabber` and the hold
 *   stays. The log entry carries `via`. Without `via` the route works as before (lead hold v3).
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
    const b = req.body ?? {};
    const raw = b !== null && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
    if (raw === null || Object.keys(raw).some((k) => k !== 'via') || (Object.hasOwn(raw, 'via') && raw.via !== 'secure-jabber')) {
      throw new ApiError(400, 'bad-request');
    }
    const via = raw.via === 'secure-jabber' ? 'secure-jabber' : null;
    const deps = req.server.deps;
    const precheck = via === null ? undefined : async (c: Queryable, hold: Hold) => {
      const { rows } = await c.query(
        'select 1 from jabber_contacts where account_id = $1 and jid_sealed is not null and verified_at <= $2',
        [accountId, hold.startedAt],
      );
      if (rows.length === 0) throw new ApiError(409, 'no-secure-jabber');
    };
    // The log entry is written in the hold's own transaction (lead review 8 Nov minor 6, owner G35),
    // and the resumed trades are published to the trader app's live views.
    const ended = await endHoldByModerator(deps, accountId, { staffId: req.staff.accountId }, req.server.events, (deps as Partial<StaffDeps>).tradePublish, (c, now) =>
      appendLog(c, { at: now, actor: actor(req), tradeCode: null, action: 'hold.ended', detail: via === null ? { accountId } : { accountId, via } }), precheck);
    if (!ended) throw new ApiError(404, 'not-found');
    return reply.code(204).send();
  });
}
