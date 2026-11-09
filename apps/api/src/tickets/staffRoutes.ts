// Plan 4 Task 30 / J-14: support tickets on the staff API.
//
// Support tickets, perm `tickets.handle` (granted per person by the owner, owner Q60; the owner holds
// every perm). A helper sees the ticket, its thread, the account's public display name and any trade
// code the trader named; never dispute evidence (spec 6.6).
// - `GET /staff/v1/tickets?status=open|answered|closed` → `{ tickets }`: open and answered oldest
//   first (the queue by age), closed newest first; 100 at most.
// - `GET /staff/v1/tickets/:id` → `{ ticket, displayName, messages }` (staff messages name the staff
//   member, for the staff side only).
// - `POST /staff/v1/tickets/:id/messages { body }` → 201; the ticket becomes `answered`. Logged
//   `ticket.replied` with the ticket id only, never the text. Closed → 409 `ticket-closed`.
// - `POST /staff/v1/tickets/:id/close` → `{ ticket }`, logged `ticket.closed`.
//
// "My account has been compromised" tickets (D-059), perm `accounts.freeze` (senior moderators and
// the owner: the same people who may freeze an account; lead default, owner to confirm whether
// moderators should see them too). Staff talk with the sender off the site (Matrix or Jabber).
// - `GET /staff/v1/compromised?status=open|closed` → `{ tickets }` with `matched`, `locked`.
// - `GET /staff/v1/compromised/:id` → the ticket, the sender's comment and ticked methods, and the
//   matched account's status (display name, kind, created, lock, its open trades' codes and states:
//   owner, "the account's trade info helps staff identify the real owner").
// - `POST /staff/v1/compromised/:id/unlock { tapId }` (tap `unlock-account` bound to the account) →
//   `{ status: 'unlocked' }`: the lock is lifted (tickets/lock.ts `unlockAccount`), logged
//   `account.unlocked`; trades resume on the timer loop's next pass. No active lock → 409 `wrong-state`.
// - `POST /staff/v1/compromised/:id/close` → `{ ticket }`; refused 409 `account-locked` while the
//   account it names is still locked, so a lock never outlives its ticket unseen.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { withTx } from '../auth/hold.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { appendLog } from '../log/append.js';
import { requireStaff } from '../staff/guard.js';
import { consumeKeyTap } from '../staff/keyTap.js';
import { actorOf, tapIdOf } from '../staff/members.js';
import { activeLock, unlockAccount } from './lock.js';
import { bodyOf, ticketIdOf, ticketMessages, ticketView, type TicketRow } from './traderRoutes.js';

function rec(v: unknown): Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new ApiError(400, 'bad-request');
  return v as Record<string, unknown>;
}

function statusOf(req: FastifyRequest, allowed: readonly string[]): string {
  const s = (req.query as { status?: unknown }).status ?? 'open';
  if (typeof s !== 'string' || !allowed.includes(s)) throw new ApiError(400, 'bad-request', { field: 'status' });
  return s;
}

async function ticketOf(q: Queryable, id: string, kind: 'support' | 'compromised', forUpdate = false): Promise<TicketRow & { display_name: string | null }> {
  const { rows } = await q.query<TicketRow & { display_name: string | null }>(
    `select t.*, a.display_name from tickets t left join accounts a on a.id = t.account_id
      where t.id = $1 and t.kind = $2${forUpdate ? ' for update of t' : ''}`,
    [id, kind],
  );
  const t = rows[0];
  if (!t) throw new ApiError(404, 'not-found');
  return t;
}

export function staffTicketRoutes(app: FastifyInstance): void {
  const perm = 'tickets.handle' as const;
  const opts = { config: { perm }, preHandler: requireStaff(perm) };

  app.get('/staff/v1/tickets', opts, async (req) => {
    const status = statusOf(req, ['open', 'answered', 'closed']);
    const order = status === 'closed' ? 'desc' : 'asc';
    const { rows } = await req.server.deps.db.query<TicketRow & { display_name: string | null }>(
      `select t.*, a.display_name from tickets t left join accounts a on a.id = t.account_id
        where t.kind = 'support' and t.status = $1 order by t.created_at ${order}, t.number ${order} limit 100`,
      [status],
    );
    return { tickets: rows.map((r) => ({ ...ticketView(r), displayName: r.display_name })) };
  });

  app.get('/staff/v1/tickets/:id', opts, async (req) => {
    const t = await ticketOf(req.server.deps.db, ticketIdOf(req), 'support');
    const { rows: staff } = await req.server.deps.db.query<{ id: string; display_name: string }>(
      `select distinct a.id, a.display_name from ticket_messages m join accounts a on a.id = m.staff_id where m.ticket_id = $1`,
      [t.id],
    );
    const names = new Map(staff.map((s) => [s.id, s.display_name]));
    const messages = (await ticketMessages(req.server.deps.db, t.id)).map(({ staffId, ...m }) => ({
      ...m,
      staffName: staffId !== null ? (names.get(staffId) ?? null) : null,
    }));
    return { ticket: ticketView(t), displayName: t.display_name, messages };
  });

  app.post('/staff/v1/tickets/:id/messages', opts, async (req, reply) => {
    const id = ticketIdOf(req);
    const b = rec(req.body);
    if (Object.keys(b).some((k) => k !== 'body')) throw new ApiError(400, 'bad-request');
    const text = bodyOf(b.body);
    const now = req.server.deps.clock();
    await withTx(req.server.deps.db, async (c) => {
      const t = await ticketOf(c, id, 'support', true);
      if (t.status === 'closed') throw new ApiError(409, 'ticket-closed');
      await c.query("insert into ticket_messages (ticket_id, author, staff_id, body, at) values ($1, 'staff', $2, $3, $4)", [id, req.staff.accountId, text, now]);
      await c.query("update tickets set status = 'answered', updated_at = $2 where id = $1", [id, now]);
      await appendLog(c, { at: now, actor: actorOf(req), tradeCode: null, action: 'ticket.replied', detail: { ticketId: id } });
    });
    return reply.code(201).send({});
  });

  app.post('/staff/v1/tickets/:id/close', opts, async (req) => {
    const id = ticketIdOf(req);
    const now = req.server.deps.clock();
    const t = await withTx(req.server.deps.db, async (c) => {
      const t = await ticketOf(c, id, 'support', true);
      if (t.status === 'closed') return t;
      const { rows } = await c.query<TicketRow>("update tickets set status = 'closed', closed_at = $2, updated_at = $2 where id = $1 returning *", [id, now]);
      await appendLog(c, { at: now, actor: actorOf(req), tradeCode: null, action: 'ticket.closed', detail: { ticketId: id } });
      return rows[0]!;
    });
    return { ticket: ticketView(t) };
  });

  // ---- "My account has been compromised" (D-059)
  const freeze = 'accounts.freeze' as const;
  const fopts = { config: { perm: freeze }, preHandler: requireStaff(freeze) };

  app.get('/staff/v1/compromised', fopts, async (req) => {
    const status = statusOf(req, ['open', 'closed']);
    const order = status === 'closed' ? 'desc' : 'asc';
    const { rows } = await req.server.deps.db.query<TicketRow & { display_name: string | null; locked: boolean }>(
      `select t.*, case when a.kind = 'member' then null else a.display_name end as display_name,
              exists (select 1 from account_locks l where l.account_id = t.account_id and l.unlocked_at is null) as locked
         from tickets t left join accounts a on a.id = t.account_id
        where t.kind = 'compromised' and (t.status = 'closed') = $1
        order by t.created_at ${order}, t.number ${order} limit 100`,
      [status === 'closed'],
    );
    return {
      tickets: rows.map((r) => ({ ...ticketView(r), matched: r.account_id !== null, displayName: r.display_name, locked: r.locked, methodsLeft: r.methods_left })),
    };
  });

  app.get('/staff/v1/compromised/:id', fopts, async (req) => {
    const { db } = req.server.deps;
    const t = await ticketOf(db, ticketIdOf(req), 'compromised');
    const comment = (await ticketMessages(db, t.id)).find((m) => m.author === 'trader')?.body ?? null;
    let account = null;
    if (t.account_id !== null) {
      const { rows } = await db.query<{ display_name: string; kind: string; created_at: Date }>('select display_name, kind, created_at from accounts where id = $1', [t.account_id]);
      const lock = await activeLock(db, t.account_id);
      const trades = await db.query<{ code: string; state: string; seller: boolean; paused_at: Date | null }>(
        `select code, state, seller_account_id = $1 as seller, paused_at from trades
          where (seller_account_id = $1 or buyer_account_id = $1) and closed_at is null order by taken_at`,
        [t.account_id],
      );
      const a = rows[0];
      account = a
        ? {
            // The unlock's tap is bound to this id (`unlock-account`).
            id: t.account_id,
            displayName: a.kind === 'member' ? null : a.display_name,
            kind: a.kind,
            createdAt: a.created_at.toISOString(),
            lockedAt: lock?.lockedAt.toISOString() ?? null,
            openTrades: trades.rows.map((r) => ({ code: r.code, state: r.state, side: r.seller ? 'seller' : 'buyer', paused: r.paused_at !== null })),
          }
        : null;
    }
    return { ticket: ticketView(t), methodsLeft: t.methods_left, comment, account };
  });

  app.post('/staff/v1/compromised/:id/unlock', fopts, async (req) => {
    const id = ticketIdOf(req);
    const tapId = tapIdOf(rec(req.body));
    const now = req.server.deps.clock();
    await withTx(req.server.deps.db, async (c) => {
      const t = await ticketOf(c, id, 'compromised', true);
      if (t.account_id === null) throw new ApiError(409, 'wrong-state');
      const accountId = t.account_id;
      await c.query('select 1 from accounts where id = $1 for no key update', [accountId]);
      if ((await activeLock(c, accountId)) === null) throw new ApiError(409, 'wrong-state');
      await consumeKeyTap(c, tapId, req.staff.accountId, { kind: 'unlock-account', accountId }, now, { sessionId: req.auth.sessionId });
      await unlockAccount(c, accountId, req.staff.accountId, now);
      await appendLog(c, { at: now, actor: actorOf(req), tradeCode: null, action: 'account.unlocked', detail: { accountId } });
    });
    return { status: 'unlocked' as const };
  });

  app.post('/staff/v1/compromised/:id/close', fopts, async (req) => {
    const id = ticketIdOf(req);
    const now = req.server.deps.clock();
    const t = await withTx(req.server.deps.db, async (c) => {
      const t = await ticketOf(c, id, 'compromised', true);
      if (t.status === 'closed') return t;
      if (t.account_id !== null && (await activeLock(c, t.account_id)) !== null) throw new ApiError(409, 'account-locked');
      const { rows } = await c.query<TicketRow>("update tickets set status = 'closed', closed_at = $2, updated_at = $2 where id = $1 returning *", [id, now]);
      await appendLog(c, { at: now, actor: actorOf(req), tradeCode: null, action: 'ticket.closed', detail: { ticketId: id } });
      return rows[0]!;
    });
    return { ticket: ticketView(t) };
  });
}
