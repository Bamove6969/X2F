// Plan 4 Task 30 / J-14: support tickets on the trader API (owner D-054, D-055, D-056, D-057, D-059).
//
// Support tickets (a live trader session; a team member's too, `member: 'any'`):
// - `POST /v1/tickets { category, body, tradeCode? }` → 201 `{ ticket }`. A ticket belongs to the
//   account: for a team that is the team account, so the team shares its tickets and its daily count
//   (owner Q69, "keep tickets shared"); each message records which member wrote it.
//   - One open ticket per account until it is resolved (D-055): a second → 409 `ticket-open`
//     `{ number }`. "Answered" is still open: only a closed ticket is resolved.
//   - At most TICKETS_DAILY opened per account per UTC day (owner Q67): the 11th → 429 `slow-down`
//     `{ limit: 'daily', retryAfterSeconds }` (to the next UTC midnight); the web explains it is
//     there to stop spam. Counted from the stored tickets, under the account's row lock, so a
//     parallel burst cannot pass either rule.
//   - `category` one of TICKET_CATEGORIES; `tradeCode` (optional) must be one of the account's own
//     trades, else 400 `bad-request` `{ field }`.
// - `GET /v1/tickets` → `{ tickets }`, the account's own, newest first.
// - `GET /v1/tickets/:id` → `{ ticket, messages }`; another account's ticket is 404. A staff message
//   never names the staff member; a member's message names the member.
// - `POST /v1/tickets/:id/messages { body }` → 201; the ticket goes back to `open`. Closed → 409
//   `ticket-closed`.
// - `POST /v1/tickets/:id/close` → `{ ticket }` (the trader resolves it themselves).
// Like the feedback form (owner 2026-10-29), a held backup session and stale Terms may still ask for
// help: a ticket changes nothing about the account.
//
// "My account has been compromised" (D-059), no session:
// - `POST /v1/tickets/compromised { loginName, methodsLeft, comment }` → 202 `{ number }`, whatever
//   the name matched. The login name is looked up by its keyed tag only (never stored, never
//   logged); the ticket keeps the account it matched (a trader or a member login), or none. A
//   matched account is locked at once (tickets/lock.ts): FULL LOCKOUT. `methodsLeft`: the kinds of
//   login method the sender says are still theirs (COMPROMISED_METHODS), never a secret.
//   - The answer is the same for a name that matched nothing, a staff or owner name (never locked by
//     the form), and an account already locked, so the form never says whether a name exists.
//   - At most COMPROMISED_PER_NAME_DAILY a day per typed name (by its HMAC tag, `daily_counts`), and
//     the app-wide login-start budget (503 `busy`).
import { normalizeTradeCode, COMPROMISED_METHODS, TICKETS_DAILY, TICKET_BODY_MAX, TICKET_CATEGORIES } from '@x2f/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { loginNameLookup, loginTagMatch } from '../accounts.js';
import { lockAccount, withTx } from '../auth/hold.js';
import { requireSession } from '../auth/sessions.js';
import { dailyCap } from '../auth/throttle.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { HIDDEN } from '../feedback/form.js';
import type { RetentionJob } from '../retention.js';
import type { TradePublisher } from '../trades/store.js';
import { afterLock, placeLock, type PlacedLock, LOCKABLE_KINDS } from './lock.js';

export { TICKETS_DAILY, TICKET_CATEGORIES };

const DAY_MS = 86_400_000;

/**
 * Days a closed ticket is kept (plan Task 30: `TICKET_KEEP_DAYS`, owner to decide; default 90). A
 * ticket naming a trade is kept while the trade is (trade retention), and goes the first purge after
 * both. An open ticket is never purged; a compromised one closes only after its lock is lifted.
 */
export const TICKET_KEEP_DAYS = 90;

export const purgeTickets: RetentionJob = {
  name: 'purgeTickets',
  async run(db: pg.Pool, now: Date): Promise<number> {
    const { rowCount } = await db.query(
      `delete from tickets t
        where t.status = 'closed' and t.closed_at <= $1
          and (t.trade_code is null or not exists (select 1 from trades where code = t.trade_code))`,
      [new Date(now.getTime() - TICKET_KEEP_DAYS * DAY_MS)],
    );
    return rowCount ?? 0;
  },
};

/** Compromised-form sends per typed login name per UTC day (its HMAC tag; a lead default). */
export const COMPROMISED_PER_NAME_DAILY = 3;

/** The after-lock work still running (J4: it runs after the reply). */
const pendingAfterLocks = new Set<Promise<void>>();

/** Resolves once every after-lock run started so far has finished (tests, shutdown). */
export async function afterLocksSettled(): Promise<void> {
  while (pendingAfterLocks.size > 0) await Promise.allSettled([...pendingAfterLocks]);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TicketStatus = 'open' | 'answered' | 'closed';

export interface TicketView {
  id: string;
  number: number;
  category: string;
  tradeCode: string | null;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface TicketMessageView {
  author: 'trader' | 'staff';
  /** The team member who wrote a trader message (null: the account owner); never set for staff. */
  memberName: string | null;
  body: string;
  at: string;
}

export interface TicketRow {
  id: string;
  number: string;
  kind: 'support' | 'compromised';
  account_id: string | null;
  category: string;
  trade_code: string | null;
  methods_left: string[];
  status: TicketStatus;
  created_at: Date;
  updated_at: Date;
  closed_at: Date | null;
}

export const ticketView = (r: TicketRow): TicketView => ({
  id: r.id,
  number: Number(r.number),
  category: r.category,
  tradeCode: r.trade_code,
  status: r.status,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
  closedAt: r.closed_at?.toISOString() ?? null,
});

function rec(v: unknown): Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new ApiError(400, 'bad-request');
  return v as Record<string, unknown>;
}

function only(r: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(r).some((k) => !keys.includes(k))) throw new ApiError(400, 'bad-request');
}

/** A message body: trimmed, CRLF to LF, 1..TICKET_BODY_MAX code points, no hidden characters. */
export function bodyOf(v: unknown, field = 'body', allowEmpty = false): string {
  if (typeof v !== 'string') throw new ApiError(400, 'bad-request', { field });
  const clean = v.replace(/\r\n?/g, '\n').trim();
  const n = [...clean].length;
  if ((n < 1 && !allowEmpty) || n > TICKET_BODY_MAX || HIDDEN.test(clean)) throw new ApiError(400, 'bad-request', { field });
  return clean;
}

/** The `:id` path parameter as a lower-case uuid; anything else is 404. */
export function ticketIdOf(req: FastifyRequest): string {
  const id = (req.params as { id?: unknown }).id;
  if (typeof id !== 'string' || !UUID.test(id)) throw new ApiError(404, 'not-found');
  return id.toLowerCase();
}

export async function ticketMessages(q: Queryable, ticketId: string): Promise<Array<TicketMessageView & { staffId: string | null }>> {
  const { rows } = await q.query<{ author: 'trader' | 'staff'; member_name: string | null; staff_id: string | null; body: string; at: Date }>(
    `select m.author, tm.display_name as member_name, m.staff_id, m.body, m.at
       from ticket_messages m left join team_members tm on tm.id = m.member_id
      where m.ticket_id = $1 order by m.seq`,
    [ticketId],
  );
  return rows.map((r) => ({ author: r.author, memberName: r.member_name, staffId: r.staff_id, body: r.body, at: r.at.toISOString() }));
}

/** The account's own support ticket, locked for update when `forUpdate`; else 404. */
async function ownTicket(q: Queryable, accountId: string, id: string, forUpdate = false): Promise<TicketRow> {
  const { rows } = await q.query<TicketRow>(
    `select * from tickets where id = $1 and account_id = $2 and kind = 'support'${forUpdate ? ' for update' : ''}`,
    [id, accountId],
  );
  const t = rows[0];
  if (!t) throw new ApiError(404, 'not-found');
  return t;
}

async function openTicket(c: pg.PoolClient, req: FastifyRequest): Promise<TicketRow> {
  const b = rec(req.body);
  only(b, ['category', 'body', 'tradeCode']);
  if (typeof b.category !== 'string' || !(TICKET_CATEGORIES as readonly string[]).includes(b.category)) {
    throw new ApiError(400, 'bad-request', { field: 'category' });
  }
  const text = bodyOf(b.body);
  const accountId = req.auth.accountId;
  let tradeCode: string | null = null;
  if (b.tradeCode !== undefined && b.tradeCode !== null) {
    tradeCode = typeof b.tradeCode === 'string' ? normalizeTradeCode(b.tradeCode) : null;
    const own =
      tradeCode !== null &&
      ((await c.query('select 1 from trades where code = $1 and (seller_account_id = $2 or buyer_account_id = $2)', [tradeCode, accountId])).rowCount ?? 0) > 0;
    if (!own) throw new ApiError(400, 'bad-request', { field: 'tradeCode' });
  }
  const now = req.server.deps.clock();
  // The account's row lock serialises its ticket opens (the team's members included).
  await lockAccount(c, accountId);
  const open = await c.query<{ number: string }>("select number from tickets where account_id = $1 and kind = 'support' and status <> 'closed'", [accountId]);
  if (open.rows[0]) throw new ApiError(409, 'ticket-open', { number: Number(open.rows[0].number) });
  const day = now.toISOString().slice(0, 10);
  const midnight = Date.parse(`${day}T00:00:00Z`) + DAY_MS;
  const count = await c.query<{ n: number }>(
    "select count(*)::int as n from tickets where account_id = $1 and kind = 'support' and created_at >= $2 and created_at < $3",
    [accountId, new Date(midnight - DAY_MS), new Date(midnight)],
  );
  if ((count.rows[0]?.n ?? 0) >= TICKETS_DAILY) {
    throw new ApiError(429, 'slow-down', { limit: 'daily', retryAfterSeconds: Math.max(1, Math.ceil((midnight - now.getTime()) / 1000)) });
  }
  const { rows } = await c.query<TicketRow>(
    `insert into tickets (kind, account_id, category, trade_code, created_at, updated_at) values ('support', $1, $2, $3, $4, $4) returning *`,
    [accountId, b.category, tradeCode, now],
  );
  const t = rows[0]!;
  await c.query("insert into ticket_messages (ticket_id, author, member_id, body, at) values ($1, 'trader', $2, $3, $4)", [t.id, req.auth.memberId, text, now]);
  return t;
}

interface CompromisedForm {
  loginName: string;
  methodsLeft: string[];
  comment: string;
}

function compromisedForm(v: unknown): CompromisedForm {
  const b = rec(v);
  only(b, ['loginName', 'methodsLeft', 'comment']);
  if (typeof b.loginName !== 'string' || b.loginName.length < 1 || b.loginName.length > 256) throw new ApiError(400, 'bad-request', { field: 'loginName' });
  const m = b.methodsLeft;
  if (!Array.isArray(m) || m.some((x) => typeof x !== 'string' || !(COMPROMISED_METHODS as readonly string[]).includes(x))) {
    throw new ApiError(400, 'bad-request', { field: 'methodsLeft' });
  }
  const methodsLeft = [...new Set(m as string[])].sort();
  if (methodsLeft.length !== m.length) throw new ApiError(400, 'bad-request', { field: 'methodsLeft' });
  return { loginName: b.loginName, methodsLeft, comment: bodyOf(b.comment ?? '', 'comment', true) };
}

export function ticketRoutes(app: FastifyInstance, o: { publish?: TradePublisher } = {}): void {
  const trader = requireSession({ kinds: ['trader'], allowRecovery: true, allowHeld: true, allowStaleTerms: true, member: 'any' });
  const reader = requireSession({ kinds: ['trader'], allowRecovery: true, allowHeld: true, allowStaleTerms: true, member: 'any', touch: false });

  app.post('/v1/tickets', { preHandler: trader }, async (req, reply) => {
    const t = await withTx(req.server.deps.db, (c) => openTicket(c, req));
    return reply.code(201).send({ ticket: ticketView(t) });
  });

  app.get('/v1/tickets', { preHandler: reader }, async (req) => {
    const { rows } = await req.server.deps.db.query<TicketRow>(
      "select * from tickets where account_id = $1 and kind = 'support' order by created_at desc, number desc limit 100",
      [req.auth.accountId],
    );
    return { tickets: rows.map(ticketView) };
  });

  app.get('/v1/tickets/:id', { preHandler: reader }, async (req) => {
    const t = await ownTicket(req.server.deps.db, req.auth.accountId, ticketIdOf(req));
    const messages = (await ticketMessages(req.server.deps.db, t.id)).map(({ staffId: _staff, ...m }) => ({
      ...m,
      // The trader never sees which staff member answered.
      memberName: m.author === 'staff' ? null : m.memberName,
    }));
    return { ticket: ticketView(t), messages };
  });

  app.post('/v1/tickets/:id/messages', { preHandler: trader }, async (req, reply) => {
    const id = ticketIdOf(req);
    const b = rec(req.body);
    only(b, ['body']);
    const text = bodyOf(b.body);
    const now = req.server.deps.clock();
    await withTx(req.server.deps.db, async (c) => {
      const t = await ownTicket(c, req.auth.accountId, id, true);
      if (t.status === 'closed') throw new ApiError(409, 'ticket-closed');
      await c.query("insert into ticket_messages (ticket_id, author, member_id, body, at) values ($1, 'trader', $2, $3, $4)", [id, req.auth.memberId, text, now]);
      await c.query("update tickets set status = 'open', updated_at = $2 where id = $1", [id, now]);
    });
    return reply.code(201).send({});
  });

  app.post('/v1/tickets/:id/close', { preHandler: trader }, async (req) => {
    const id = ticketIdOf(req);
    const now = req.server.deps.clock();
    const t = await withTx(req.server.deps.db, async (c) => {
      const t = await ownTicket(c, req.auth.accountId, id, true);
      if (t.status === 'closed') return t;
      const { rows } = await c.query<TicketRow>("update tickets set status = 'closed', closed_at = $2, updated_at = $2 where id = $1 returning *", [id, now]);
      return rows[0]!;
    });
    return { ticket: ticketView(t) };
  });

  // D-059: no session (the person may have lost every way in). Not `requireSession`: nothing here
  // reads or changes an account except the lock itself.
  app.post('/v1/tickets/compromised', async (req, reply) => {
    const deps = req.server.deps;
    req.server.budgets.start.take();
    const f = compromisedForm(req.body);
    const name = loginNameLookup(deps.config, f.loginName);
    await dailyCap(deps, `ticket-compromised:${name.tag}`, COMPROMISED_PER_NAME_DAILY);
    const now = deps.clock();
    const { number, lock } = await withTx(deps.db, async (c) => {
      // Always one lookup under every key of the ring: a malformed name's tags match no account.
      const found = (
        await c.query<{ id: string; kind: string }>(`select a.id, a.kind from accounts a where ${loginTagMatch('a', 1)}`, [
          name.candidates.ids,
          name.candidates.tags,
        ])
      ).rows[0];
      const accountId = found && (LOCKABLE_KINDS as readonly string[]).includes(found.kind) ? found.id : null;
      const { rows } = await c.query<{ id: string; number: string }>(
        `insert into tickets (kind, account_id, category, methods_left, created_at, updated_at)
         values ('compromised', $1, 'compromised', $2::text[], $3, $3) returning id, number`,
        [accountId, f.methodsLeft, now],
      );
      const t = rows[0]!;
      if (f.comment !== '') {
        await c.query("insert into ticket_messages (ticket_id, author, body, at) values ($1, 'trader', $2, $3)", [t.id, f.comment, now]);
      }
      const lock: PlacedLock | null = accountId !== null ? await placeLock(c, accountId, t.id, now) : null;
      return { number: Number(t.number), lock };
    });
    if (lock !== null) {
      await afterLock(
        { db: deps.db, clock: deps.clock, events: req.server.events, ...(o.publish ? { publish: o.publish } : {}), log: (reason) => req.log.warn({ reason }) },
        lock,
      );
    }
    return reply.code(202).send({ number });
  });
}
