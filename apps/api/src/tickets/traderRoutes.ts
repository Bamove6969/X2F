/**
 * Support tickets on the trader API (Plan 4 Task 30; spec 6.6). A trader opens a ticket in a
 * category, follows its thread, writes more and closes it. Every route is the account owner's own
 * (team members get 403 `owner-only`, as every route that does not name them: their
 * `support-open` / `support-see` boxes are not built, team/abilities.ts), needs a full session on the
 * current Terms, and sees only the caller's own tickets: anyone else's id is 404, as an unknown one.
 *
 * - `POST /v1/tickets { category, body, tradeCode? }` → 201 `{ id }`. `category` one of
 *   TICKET_CATEGORIES (else 400); `tradeCode` optional, one of the caller's own trades (any spelling
 *   normalizeTradeCode takes; 404 `not-found` for a code that is not theirs or does not exist).
 * - `GET /v1/tickets` → `{ items: { id, category, status, tradeCode, createdAt, updatedAt, lastFrom }[] }`,
 *   last activity first.
 * - `GET /v1/tickets/:id` → the thread: `{ id, category, status, tradeCode, createdAt, updatedAt, messages: { from, body, at }[] }`.
 *   A staff message never says which staff member wrote it.
 * - `POST /v1/tickets/:id/messages { body }` → the thread; the ticket is `open` again (waiting for
 *   staff). 409 `ticket-closed` on a closed ticket (the trader opens a new one).
 * - `POST /v1/tickets/:id/close` → the thread, `closed` (closing a closed ticket answers it as is).
 *
 * Limits: a message is 1..TICKET_BODY_MAX characters with no hidden control or direction marks
 * (400 `bad-request`); one write (open or message) per TICKET_WRITE_GAP_S per account (429
 * `slow-down` `{ retryAfterSeconds }`, kept in memory, as the feedback form's); at most
 * TICKET_OPEN_AT_ONCE tickets not closed (409 `too-many-tickets`), TICKET_OPEN_DAILY new tickets and
 * TICKET_REPLIES_DAILY messages in any 24 hours (429 `slow-down` `{ retryAfterSeconds, limit: 'daily' }`),
 * both counted from the stored rows under the account's lock, so they hold across restarts.
 */
import { normalizeTradeCode, TICKET_CATEGORIES, TICKET_OPEN_AT_ONCE, TICKET_OPEN_DAILY, type TicketCategory } from '@x2f/core';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { lockAccount, withTx } from '../auth/liveSession.js';
import { requireSession } from '../auth/sessions.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { SendGap } from '../feedback/form.js';
import { addMessage, cleanBody, loadTicket, messagesOf, ticketIdOf, type TicketRow } from './store.js';

/** One write (a new ticket or a message) per this many seconds per account (in memory only). */
export const TICKET_WRITE_GAP_S = 10;
/** Trader messages (after the first) per account in any 24 hours. */
export const TICKET_REPLIES_DAILY = 50;
const DAY_MS = 86_400_000;

function parseOpen(body: unknown): { category: TicketCategory; text: string; tradeCode: string | null } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'bad-request');
  const { category, body: text, tradeCode, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length > 0) throw new ApiError(400, 'bad-request');
  if (typeof category !== 'string' || !(TICKET_CATEGORIES as readonly string[]).includes(category)) throw new ApiError(400, 'bad-request');
  let code: string | null = null;
  if (tradeCode !== undefined && tradeCode !== null && tradeCode !== '') {
    code = typeof tradeCode === 'string' ? normalizeTradeCode(tradeCode) : null;
    if (code === null) throw new ApiError(400, 'bad-request');
  }
  return { category: category as TicketCategory, text: cleanBody(text), tradeCode: code };
}

function parseMessage(body: unknown): string {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'bad-request');
  const { body: text, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length > 0) throw new ApiError(400, 'bad-request');
  return cleanBody(text);
}

/** 429 `slow-down` with `limit: 'daily'` until the oldest of the counted rows leaves the 24 hours. */
function daily(oldest: Date, now: Date): ApiError {
  return new ApiError(429, 'slow-down', { retryAfterSeconds: Math.max(1, Math.ceil((oldest.getTime() + DAY_MS - now.getTime()) / 1000)), limit: 'daily' });
}

/** The caller's own ticket, locked when asked; 404 for an unknown id and for anyone else's. */
async function ownTicket(q: Queryable, req: FastifyRequest, o: { lock?: boolean } = {}): Promise<TicketRow> {
  const t = await loadTicket(q, ticketIdOf(req.params), o);
  if (t === null || t.account_id !== req.auth.accountId) throw new ApiError(404, 'not-found');
  return t;
}

async function threadOf(q: Queryable, req: FastifyRequest, t: TicketRow) {
  const messages = await messagesOf(q, req.server.deps.config, t.id);
  return {
    id: t.id, category: t.category, status: t.status, tradeCode: t.trade_code,
    createdAt: t.created_at.toISOString(), updatedAt: t.updated_at.toISOString(),
    // Never which staff member wrote a line (the staff id stays on the server).
    messages: messages.map((m) => ({ from: m.from, body: m.body, at: m.at })),
  };
}

export function ticketTraderRoutes(app: FastifyInstance): void {
  const gap = new SendGap(TICKET_WRITE_GAP_S * 1000);
  // The account owner's own (no `member`: a team member gets 403 owner-only), a full session on the current Terms.
  const trader = requireSession({ kinds: ['trader'] });

  /** Takes the write gap synchronously (before any await, so a parallel burst gets one), and gives it back if `fn` fails. */
  async function gapped<T>(req: FastifyRequest, fn: () => Promise<T>): Promise<T> {
    const until = gap.take(req.auth.accountId, req.server.deps.clock().getTime());
    try {
      return await fn();
    } catch (e) {
      gap.give(req.auth.accountId, until);
      throw e;
    }
  }

  app.post('/v1/tickets', { preHandler: trader }, async (req, reply) => {
    const o = parseOpen(req.body);
    const { db, clock, config } = req.server.deps;
    const accountId = req.auth.accountId;
    const id = await gapped(req, () =>
      withTx(db, async (c) => {
        const now = clock();
        await lockAccount(c, accountId);
        const { rows } = await c.query<{ open: number; recent: number; oldest: Date | null }>(
          `select count(*) filter (where status <> 'closed')::int as open,
                  count(*) filter (where created_at > $2)::int as recent,
                  min(created_at) filter (where created_at > $2) as oldest
             from tickets where account_id = $1`,
          [accountId, new Date(now.getTime() - DAY_MS)],
        );
        const n = rows[0]!;
        if (n.open >= TICKET_OPEN_AT_ONCE) throw new ApiError(409, 'too-many-tickets');
        if (n.recent >= TICKET_OPEN_DAILY) throw daily(n.oldest!, now);
        if (o.tradeCode !== null) {
          const mine = await c.query('select 1 from trades where code = $1 and (seller_account_id = $2 or buyer_account_id = $2)', [o.tradeCode, accountId]);
          if (mine.rowCount === 0) throw new ApiError(404, 'not-found');
        }
        const ticketId = randomUUID();
        await c.query(
          "insert into tickets (id, account_id, category, trade_code, status, created_at, updated_at) values ($1, $2, $3, $4, 'open', $5, $5)",
          [ticketId, accountId, o.category, o.tradeCode, now],
        );
        await addMessage(c, config, { ticketId, sender: 'trader', staffId: null, text: o.text, at: now });
        return ticketId;
      }),
    );
    return reply.code(201).send({ id });
  });

  app.get('/v1/tickets', { preHandler: trader }, async (req) => {
    const { rows } = await req.server.deps.db.query<TicketRow & { last_from: 'trader' | 'staff' }>(
      `select t.id, t.category, t.status, t.trade_code, t.created_at, t.updated_at,
              (select m.sender from ticket_messages m where m.ticket_id = t.id order by m.seq desc limit 1) as last_from
         from tickets t where t.account_id = $1
        order by t.updated_at desc, t.id limit 100`,
      [req.auth.accountId],
    );
    return {
      items: rows.map((r) => ({
        id: r.id, category: r.category, status: r.status, tradeCode: r.trade_code,
        createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(), lastFrom: r.last_from,
      })),
    };
  });

  app.get('/v1/tickets/:id', { preHandler: trader }, async (req) => {
    const db = req.server.deps.db;
    return threadOf(db, req, await ownTicket(db, req));
  });

  app.post('/v1/tickets/:id/messages', { preHandler: trader }, async (req) => {
    const text = parseMessage(req.body);
    const { db, clock, config } = req.server.deps;
    const accountId = req.auth.accountId;
    return gapped(req, () =>
      withTx(db, async (c) => {
        const now = clock();
        await lockAccount(c, accountId);
        const t = await ownTicket(c, req, { lock: true });
        if (t.status === 'closed') throw new ApiError(409, 'ticket-closed');
        // Every trader line after a ticket's first, across the account's tickets, in the last 24 hours.
        const { rows } = await c.query<{ n: number; oldest: Date | null }>(
          `select count(*)::int as n, min(m.at) as oldest from ticket_messages m join tickets t on t.id = m.ticket_id
            where t.account_id = $1 and m.sender = 'trader' and m.seq > 1 and m.at > $2`,
          [accountId, new Date(now.getTime() - DAY_MS)],
        );
        if (rows[0]!.n >= TICKET_REPLIES_DAILY) throw daily(rows[0]!.oldest!, now);
        await addMessage(c, config, { ticketId: t.id, sender: 'trader', staffId: null, text, at: now });
        await c.query("update tickets set status = 'open', updated_at = $2 where id = $1", [t.id, now]);
        return threadOf(c, req, { ...t, status: 'open', updated_at: now });
      }),
    );
  });

  app.post('/v1/tickets/:id/close', { preHandler: trader }, async (req) => {
    const { db, clock } = req.server.deps;
    return withTx(db, async (c) => {
      const t = await ownTicket(c, req, { lock: true });
      if (t.status === 'closed') return threadOf(c, req, t);
      const now = clock();
      await c.query("update tickets set status = 'closed', closed_at = $2, updated_at = $2 where id = $1", [t.id, now]);
      return threadOf(c, req, { ...t, status: 'closed', closed_at: now, updated_at: now });
    });
  });
}
