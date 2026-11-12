import type { FastifyInstance, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { withTx } from '../auth/hold.js';
import { ApiError } from '../errors.js';
import { requireStaff } from './guard.js';
import { log } from './members.js';

/**
 * O-040 (owner Q35, 6 Nov 2026): the owner's notifications on the staff site. Owner alerts (price
 * sources failing or recovered, market prices paused or resumed, the fee sweep, the vendor
 * auto-close cap, a refund after a ruling, and the owner account's own login alerts) are rows of
 * the owner account's `alerts` (`addOwnerAlert`). Perm `self`, the owner only (anyone else 403
 * `forbidden`, as the owner-key routes), and only the owner account's own rows:
 *
 * - `GET /staff/v1/owner/alerts[?before=<cursor>]` → `{ items, unread, next }`: 50 at a time,
 *   newest first; each `{ id, kind, message, detail, createdAt, seenAt }` (`message` is the alert's
 *   own sentence when it has one); `unread` counts every unseen one (the shell's badge).
 * - `POST /staff/v1/owner/alerts/:id/read` → 204 (404 for an id that is not the owner's).
 * - `POST /staff/v1/owner/alerts/read-all` → 204.
 * Marking read is logged `staff.alert-seen` when it changes anything (lead review 7 Nov M1: a stolen
 * session cannot silence alerts unseen), with the alert's kind, or for read-all how many (review OA2).
 */

export const OWNER_ALERTS_PAGE = 50;

const ownerOnly: preHandlerAsyncHookHandler = async function (req: FastifyRequest) {
  if (req.staff.role !== 'owner') throw new ApiError(403, 'forbidden');
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** A page cursor: the last item's time and id, `<iso>_<uuid>`. */
function parseCursor(v: unknown): { at: Date; id: string } | null {
  if (v === undefined) return null;
  if (typeof v !== 'string') throw new ApiError(400, 'bad-request');
  const [at, id, extra] = v.split('_');
  if (at === undefined || id === undefined || extra !== undefined || !ISO.test(at) || !UUID.test(id) || !Number.isFinite(Date.parse(at))) {
    throw new ApiError(400, 'bad-request');
  }
  return { at: new Date(at), id: id.toLowerCase() };
}

interface Row {
  id: string;
  kind: string;
  detail: Record<string, unknown> | null;
  created_at: Date;
  seen_at: Date | null;
}

const messageOf = (d: Record<string, unknown> | null): string | null => {
  const m = d?.message;
  return typeof m === 'string' && m.length > 0 ? m.slice(0, 500) : null;
};

export function staffOwnerAlertRoutes(app: FastifyInstance): void {
  const opts = { config: { perm: 'self' as const }, preHandler: [...requireStaff('self'), ownerOnly] };

  app.get('/staff/v1/owner/alerts', opts, async (req) => {
    const cursor = parseCursor((req.query as Record<string, unknown> | undefined)?.before);
    const { db } = req.server.deps;
    const params: unknown[] = [req.staff.accountId, OWNER_ALERTS_PAGE + 1];
    let where = 'account_id = $1';
    if (cursor !== null) {
      params.push(cursor.at, cursor.id);
      where += ' and (created_at, id) < ($3, $4::uuid)';
    }
    const { rows } = await db.query<Row>(
      `select id::text, kind, detail, created_at, seen_at from alerts where ${where} order by created_at desc, id desc limit $2`,
      params,
    );
    const page = rows.slice(0, OWNER_ALERTS_PAGE);
    const last = page.at(-1);
    const unread = (await db.query<{ n: number }>('select count(*)::int as n from alerts where account_id = $1 and seen_at is null', [req.staff.accountId])).rows[0]!.n;
    return {
      items: page.map((a) => ({
        id: a.id, kind: a.kind, message: messageOf(a.detail), detail: a.detail ?? {},
        createdAt: a.created_at.toISOString(), seenAt: a.seen_at?.toISOString() ?? null,
      })),
      unread,
      next: rows.length > OWNER_ALERTS_PAGE && last ? `${last.created_at.toISOString()}_${last.id}` : null,
    };
  });

  app.post('/staff/v1/owner/alerts/read-all', opts, async (req, reply) => {
    const { db, clock } = req.server.deps;
    await withTx(db, async (c) => {
      const r = await c.query('update alerts set seen_at = $2 where account_id = $1 and seen_at is null', [req.staff.accountId, clock()]);
      if ((r.rowCount ?? 0) > 0) await log(c, req, 'staff.alert-seen', { count: r.rowCount ?? 0 });
    });
    return reply.code(204).send();
  });

  app.post('/staff/v1/owner/alerts/:id/read', opts, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) throw new ApiError(404, 'not-found');
    const { db, clock } = req.server.deps;
    await withTx(db, async (c) => {
      const r = await c.query<{ kind: string }>(
        'update alerts set seen_at = $3 where id = $1 and account_id = $2 and seen_at is null returning kind',
        [id.toLowerCase(), req.staff.accountId, clock()],
      );
      if (r.rows[0]) {
        await log(c, req, 'staff.alert-seen', { kind: r.rows[0].kind });
        return;
      }
      const { rows } = await c.query('select 1 from alerts where id = $1 and account_id = $2', [id.toLowerCase(), req.staff.accountId]);
      if (rows.length === 0) throw new ApiError(404, 'not-found');
    });
    return reply.code(204).send();
  });
}
