/**
 * Support tickets on the staff API (Plan 4 Task 30; spec 6.6). Perm `tickets.handle`: the owner by
 * role, anyone else only when the owner ticked it for them (`GRANTABLE_PERMS`, Task 7), never by
 * role alone. Tickets show no dispute evidence (a Helper never sees any): only the ticket's own
 * category, status, times, the trade code the trader chose to name, and its messages.
 *
 * Least exposure (lead default, the plan is silent): the queue lists no text and no trader; a
 * ticket's thread is opened only to the staff member who took it. Who the trader is (account,
 * names) is never sent to staff at all.
 *
 * - `GET /staff/v1/tickets?category` → `{ items: { id, category, status, createdAt, updatedAt, waiting, taken }[] }`:
 *   every ticket not closed, oldest first (`waiting`: whose turn it is, `trader` or `staff`;
 *   `taken`: `me`, `other` or null). `category` filters to one of TICKET_CATEGORIES (else 400).
 * - `POST /staff/v1/tickets/:id/take` → the case. 409 `ticket-taken` while another staff member
 *   who can still work tickets has it (the owner may take it over); 409 `ticket-closed`.
 * - `GET /staff/v1/tickets/:id` → the case: `{ id, category, status, tradeCode, createdAt, updatedAt, messages: { from, body, at, mine }[] }`.
 * - `POST /staff/v1/tickets/:id/messages { body }` → the case, `answered`. 409 `ticket-closed`.
 * - `POST /staff/v1/tickets/:id/close` → the case, `closed`.
 * - `POST /staff/v1/tickets/:id/release` → `{ released: true }`: back to the queue.
 * The case routes answer 404 for an unknown id and 403 `forbidden-case` to anyone but the taker.
 *
 * The activity log (never the text, never the trader): `ticket.taken`, `ticket.released`,
 * `ticket.replied`, `ticket.closed`, and `ticket.opened` for a read of the thread (at most once per
 * staff session and ticket per TICKET_OPEN_LOG_WINDOW_MS, so a reload cannot flood the log).
 */
import { can } from '@x2f/staff';
import { TICKET_CATEGORIES, type TicketCategory } from '@x2f/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { withTx } from '../auth/hold.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { loadStaff, requireStaff } from '../staff/guard.js';
import { log } from '../staff/members.js';
import { addMessage, cleanBody, loadTicket, messagesOf, ticketIdOf, type TicketRow } from './store.js';

/** A ticket's read is logged at most once per staff session and ticket in this long. */
export const TICKET_OPEN_LOG_WINDOW_MS = 5 * 60_000;

/** The ticket and the caller's hold on it: 404 for an unknown id. */
async function ticketOf(q: Queryable, req: FastifyRequest, o: { lock?: boolean } = {}): Promise<TicketRow> {
  const t = await loadTicket(q, ticketIdOf(req.params), o);
  if (t === null) throw new ApiError(404, 'not-found');
  return t;
}

/** The ticket, which the caller must have taken (403 `forbidden-case` otherwise). */
async function takenTicket(q: Queryable, req: FastifyRequest, o: { lock?: boolean } = {}): Promise<TicketRow> {
  const t = await ticketOf(q, req, o);
  if (t.taken_by !== req.staff.accountId) throw new ApiError(403, 'forbidden-case');
  return t;
}

async function caseOf(q: Queryable, req: FastifyRequest, t: TicketRow) {
  const messages = await messagesOf(q, req.server.deps.config, t.id);
  return {
    id: t.id, category: t.category, status: t.status, tradeCode: t.trade_code,
    createdAt: t.created_at.toISOString(), updatedAt: t.updated_at.toISOString(),
    // Never which team member wrote a trader line (staff are not told who the trader is).
    messages: messages.map((m) => ({ from: m.from, body: m.body, at: m.at, mine: m.from === 'staff' && m.staffId === req.staff.accountId })),
  };
}

/** Whether the staff member who holds a ticket can still work it (live, not switched off, still granted). */
async function takerCanWork(q: Queryable, accountId: string): Promise<boolean> {
  const s = await loadStaff(q, accountId);
  return s !== null && !s.switchedOff && can(s.role, 'tickets.handle', s.grants);
}

function parseReply(body: unknown): string {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'bad-request');
  const { body: text, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length > 0) throw new ApiError(400, 'bad-request');
  return cleanBody(text);
}

export function staffTicketRoutes(app: FastifyInstance): void {
  const perm = 'tickets.handle' as const;
  const opts = { config: { perm }, preHandler: requireStaff(perm) };
  /** `<session> <ticket>` → when its read was logged (this API process; pruned as it goes). */
  const opened = new Map<string, number>();

  app.get('/staff/v1/tickets', opts, async (req) => {
    const raw = (req.query as { category?: unknown }).category;
    if (raw !== undefined && (typeof raw !== 'string' || !(TICKET_CATEGORIES as readonly string[]).includes(raw))) throw new ApiError(400, 'bad-request');
    const category = (raw as TicketCategory | undefined) ?? null;
    const { rows } = await req.server.deps.db.query<{ id: string; category: TicketCategory; status: 'open' | 'answered'; created_at: Date; updated_at: Date; taken_by: string | null }>(
      `select id, category, status, created_at, updated_at, taken_by from tickets
        where kind = 'support' and status <> 'closed' and ($1::text is null or category = $1)
        order by created_at, id limit 200`,
      [category],
    );
    const me = req.staff.accountId;
    return {
      items: rows.map((r) => ({
        id: r.id, category: r.category, status: r.status,
        createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
        waiting: r.status === 'open' ? 'staff' : 'trader',
        taken: r.taken_by === null ? null : r.taken_by === me ? 'me' : 'other',
      })),
    };
  });

  app.post('/staff/v1/tickets/:id/take', opts, async (req) =>
    withTx(req.server.deps.db, async (c) => {
      const t = await ticketOf(c, req, { lock: true });
      const me = req.staff.accountId;
      if (t.taken_by === me) return caseOf(c, req, t);
      if (t.status === 'closed') throw new ApiError(409, 'ticket-closed');
      if (t.taken_by !== null && req.staff.role !== 'owner' && (await takerCanWork(c, t.taken_by))) throw new ApiError(409, 'ticket-taken');
      await c.query('update tickets set taken_by = $2 where id = $1', [t.id, me]);
      await log(c, req, 'ticket.taken', { ticketId: t.id });
      return caseOf(c, req, { ...t, taken_by: me });
    }),
  );

  app.get('/staff/v1/tickets/:id', opts, async (req) => {
    const { db, clock } = req.server.deps;
    const t = await takenTicket(db, req);
    // Claimed synchronously before any await (parallel reads log once); given back if the read fails.
    const now = clock().getTime();
    for (const [k, at] of opened) if (now - at >= TICKET_OPEN_LOG_WINDOW_MS) opened.delete(k);
    const key = `${req.auth.sessionId} ${t.id}`;
    const due = !opened.has(key);
    if (due) opened.set(key, now);
    try {
      const view = await caseOf(db, req, t);
      if (due) await withTx(db, (c) => log(c, req, 'ticket.opened', { ticketId: t.id }));
      return view;
    } catch (e) {
      if (due && opened.get(key) === now) opened.delete(key);
      throw e;
    }
  });

  app.post('/staff/v1/tickets/:id/messages', opts, async (req) => {
    const text = parseReply(req.body);
    const { db, clock, config } = req.server.deps;
    return withTx(db, async (c) => {
      const t = await takenTicket(c, req, { lock: true });
      if (t.status === 'closed') throw new ApiError(409, 'ticket-closed');
      const now = clock();
      await addMessage(c, config, { ticketId: t.id, sender: 'staff', staffId: req.staff.accountId, text, at: now });
      await c.query("update tickets set status = 'answered', updated_at = $2 where id = $1", [t.id, now]);
      await log(c, req, 'ticket.replied', { ticketId: t.id });
      return caseOf(c, req, { ...t, status: 'answered', updated_at: now });
    });
  });

  app.post('/staff/v1/tickets/:id/close', opts, async (req) => {
    const { db, clock } = req.server.deps;
    return withTx(db, async (c) => {
      const t = await takenTicket(c, req, { lock: true });
      if (t.status === 'closed') return caseOf(c, req, t);
      const now = clock();
      await c.query("update tickets set status = 'closed', closed_at = $2, updated_at = $2 where id = $1", [t.id, now]);
      await log(c, req, 'ticket.closed', { ticketId: t.id });
      return caseOf(c, req, { ...t, status: 'closed', closed_at: now, updated_at: now });
    });
  });

  app.post('/staff/v1/tickets/:id/release', opts, async (req) => {
    return withTx(req.server.deps.db, async (c) => {
      const t = await takenTicket(c, req, { lock: true });
      await c.query('update tickets set taken_by = null where id = $1', [t.id]);
      await log(c, req, 'ticket.released', { ticketId: t.id });
      return { released: true };
    });
  });
}
