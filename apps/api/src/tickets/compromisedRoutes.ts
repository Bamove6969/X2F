/**
 * "My account has been compromised" (owner D-059; J-14, ported onto main's tickets): a report that
 * needs no login, the full lockout it starts (tickets/lock.ts), and the staff routes that read it
 * and lift the lock.
 *
 * Trader app, no session (`PUBLIC_ROUTES`: the person may have lost every way in):
 * - `POST /v1/tickets/compromised { loginName, methodsLeft, comment? }` → 202 `{ number, moderatorUrl }`,
 *   whatever the name matched. The login name is looked up by its keyed tags only (never stored,
 *   never logged); the report keeps the account it matched (a trader or a team member's login), or
 *   none. A matched account is locked at once: FULL LOCKOUT. `methodsLeft`: the kinds of login method
 *   the sender says are still theirs (COMPROMISED_METHODS, none at all allowed: "None of these"),
 *   never a secret. `comment` (optional, up to TICKET_BODY_MAX) is the report's first message, sealed.
 *   - The answer is the same for a name that matched nothing, a staff or owner name (never locked by
 *     the form), and an account already locked, so the form never says whether a name exists; it
 *     never lists the account's trades either (lead default, owner question pending: the board
 *     "Compromised" shows the paused trades on its result, which would tell anyone typing a name
 *     what that account trades). `moderatorUrl` is the site's moderator contact link (settings), the
 *     same for everyone. The 202 is sent before the after-lock work (session revokes, trade pauses)
 *     runs (J-14 review J4), so its timing says nothing either.
 *   - At most COMPROMISED_PER_NAME_DAILY a day per typed name (by its HMAC tag, `daily_counts`), and
 *     the form's own site-wide budget, COMPROMISED_BUCKET, apart from the login starts (review J5;
 *     503 `busy`).
 *
 * Staff app, perm `accounts.freeze` (senior moderators and the owner, the people who may freeze an
 * account; lead default, owner question pending on whether moderators see reports too). Staff talk
 * with the sender off the site (the moderator contact link).
 * - `GET /staff/v1/compromised?status=open|closed` → `{ items }`: the reports, open ones oldest first.
 *   Metadata only, never the comment.
 * - `GET /staff/v1/compromised/:id` → the report, the sender's comment and ticked methods, and the
 *   matched account (display name, kind, created, lock, its open trades' codes and states: owner,
 *   "the account's trade info helps staff identify the real owner"). Logged `account.report-viewed`
 *   (ids only) before the comment is opened.
 * - `POST /staff/v1/compromised/:id/unlock { tapId }` (tap `unlock-account`, bound to the account and
 *   the report) → `{ status: 'unlocked' }`: the lock is lifted (`unlockAccount`), logged
 *   `account.unlocked`; trades resume on the timer loop's next pass. No active lock → 409 `wrong-state`.
 * - `POST /staff/v1/compromised/:id/close` → the report, closed; refused 409 `account-locked` while
 *   the account it names is still locked, so a lock never outlives its report unseen.
 */
import { COMPROMISED_METHODS, TICKET_BODY_MAX } from '@x2f/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { loginNameLookup, loginTagMatch } from '../accounts.js';
import { withTx } from '../auth/hold.js';
import { dailyCap } from '../auth/throttle.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { HIDDEN } from '../feedback/form.js';
import { requireStaff } from '../staff/guard.js';
import { consumeKeyTap } from '../staff/keyTap.js';
import { body, log, tapIdOf } from '../staff/members.js';
import type { TradePublisher } from '../trades/store.js';
import { activeLock, afterLock, LOCKABLE_KINDS, placeLock, unlockAccount, type PlacedLock } from './lock.js';
import { addMessage, loadTicket, messagesOf, ticketIdOf, type TicketRow } from './store.js';

/** Reports per typed login name per UTC day (its HMAC tag; a lead default, the owner may change it). */
export const COMPROMISED_PER_NAME_DAILY = 3;

/** The after-lock work still running (J4: it runs after the reply). */
const pendingAfterLocks = new Set<Promise<void>>();

/** Resolves once every after-lock run started so far has finished (tests, shutdown). */
export async function afterLocksSettled(): Promise<void> {
  while (pendingAfterLocks.size > 0) await Promise.allSettled([...pendingAfterLocks]);
}

interface CompromisedForm {
  loginName: string;
  methodsLeft: string[];
  comment: string;
}

function parseForm(v: unknown): CompromisedForm {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new ApiError(400, 'bad-request');
  const { loginName, methodsLeft, comment, ...rest } = v as Record<string, unknown>;
  if (Object.keys(rest).length > 0) throw new ApiError(400, 'bad-request');
  if (typeof loginName !== 'string' || loginName.length < 1 || loginName.length > 256) throw new ApiError(400, 'bad-request', { field: 'loginName' });
  if (!Array.isArray(methodsLeft) || methodsLeft.some((x) => typeof x !== 'string' || !(COMPROMISED_METHODS as readonly string[]).includes(x))) {
    throw new ApiError(400, 'bad-request', { field: 'methodsLeft' });
  }
  const methods = [...new Set(methodsLeft as string[])].sort();
  if (methods.length !== methodsLeft.length) throw new ApiError(400, 'bad-request', { field: 'methodsLeft' });
  let text = '';
  if (comment !== undefined && comment !== null) {
    if (typeof comment !== 'string' || comment.length > TICKET_BODY_MAX * 4) throw new ApiError(400, 'bad-request', { field: 'comment' });
    text = comment.replace(/\r\n?/g, '\n').trim();
    if ([...text].length > TICKET_BODY_MAX || HIDDEN.test(text)) throw new ApiError(400, 'bad-request', { field: 'comment' });
  }
  return { loginName, methodsLeft: methods, comment: text };
}

/** The trader app's no-login report route. `publish`: the app's trade publisher, for the pauses. */
export function compromisedReportRoute(app: FastifyInstance, o: { publish?: TradePublisher } = {}): void {
  // J4: the after-lock work runs after the reply; closing the app waits for it.
  app.addHook('onClose', afterLocksSettled);

  // No `requireSession`: nothing here reads or changes an account except the lock itself.
  app.post('/v1/tickets/compromised', async (req, reply) => {
    const deps = req.server.deps;
    // J5: its own budget, so reports never starve the login starts.
    req.server.budgets.compromised.take();
    const f = parseForm(req.body);
    const name = loginNameLookup(deps.config, f.loginName);
    await dailyCap(deps, `ticket-compromised:${name.tag}`, COMPROMISED_PER_NAME_DAILY);
    const now = deps.clock();
    const { number, lock, moderatorUrl } = await withTx(deps.db, async (c) => {
      // Always one lookup under every key of the ring: a malformed name's tags match no account.
      const found = (
        await c.query<{ id: string; kind: string }>(`select a.id, a.kind from accounts a where ${loginTagMatch('a', 1)}`, [name.candidates.ids, name.candidates.tags])
      ).rows[0];
      const accountId = found && (LOCKABLE_KINDS as readonly string[]).includes(found.kind) ? found.id : null;
      const { rows } = await c.query<{ id: string; number: string }>(
        `insert into tickets (kind, account_id, category, methods_left, status, created_at, updated_at)
         values ('compromised', $1, 'compromised', $2::text[], 'open', $3, $3) returning id, number`,
        [accountId, f.methodsLeft, now],
      );
      const t = rows[0]!;
      // Sealed like every message (the sender may have typed credentials here).
      if (f.comment !== '') await addMessage(c, deps.config, { ticketId: t.id, sender: 'trader', staffId: null, text: f.comment, at: now });
      const lock: PlacedLock | null = accountId !== null ? await placeLock(c, accountId, t.id, now) : null;
      const s = await c.query<{ url: string | null }>('select moderator_contact_url as url from settings where id = 1');
      return { number: Number(t.number), lock, moderatorUrl: s.rows[0]?.url ?? null };
    });
    // J4: the answer goes out first, the same for every name; the session revokes and trade pauses
    // run once it has been sent. The account is refused and its trades held from the commit on
    // (disabled_at, tradeHeldSql), so nothing waits on this; a pause that fails is left to the timer loop.
    if (lock !== null) {
      const afterDeps = { db: deps.db, clock: deps.clock, events: req.server.events, ...(o.publish ? { publish: o.publish } : {}), log: (reason: string) => req.log.warn({ reason }) };
      let started = false;
      const run = () => {
        if (started) return;
        started = true;
        const p: Promise<void> = afterLock(afterDeps, lock)
          .catch(() => req.log.warn({ reason: 'lock-after-failed' }))
          .finally(() => pendingAfterLocks.delete(p));
        pendingAfterLocks.add(p);
      };
      reply.raw.once('finish', run);
      reply.raw.once('close', run);
    }
    return reply.code(202).send({ number, moderatorUrl });
  });
}

function statusOf(req: FastifyRequest): 'open' | 'closed' {
  const s = (req.query as { status?: unknown }).status ?? 'open';
  if (s !== 'open' && s !== 'closed') throw new ApiError(400, 'bad-request');
  return s;
}

async function reportOf(q: Queryable, req: FastifyRequest, o: { lock?: boolean } = {}): Promise<TicketRow> {
  const t = await loadTicket(q, ticketIdOf(req.params), { ...o, kind: 'compromised' });
  if (t === null) throw new ApiError(404, 'not-found');
  return t;
}

const summary = (t: TicketRow) => ({
  id: t.id, number: Number(t.number), status: t.status, methodsLeft: t.methods_left,
  createdAt: t.created_at.toISOString(), closedAt: t.closed_at?.toISOString() ?? null,
});

/** The staff app's report routes (perm `accounts.freeze`). */
export function staffCompromisedRoutes(app: FastifyInstance): void {
  const perm = 'accounts.freeze' as const;
  const opts = { config: { perm }, preHandler: requireStaff(perm) };

  app.get('/staff/v1/compromised', opts, async (req) => {
    const status = statusOf(req);
    const order = status === 'closed' ? 'desc' : 'asc';
    const { rows } = await req.server.deps.db.query<TicketRow & { display_name: string | null; locked: boolean }>(
      `select t.id, t.number, t.status, t.methods_left, t.account_id, t.created_at, t.closed_at,
              case when a.kind = 'member' then null else a.display_name end as display_name,
              exists (select 1 from account_locks l where l.account_id = t.account_id and l.unlocked_at is null) as locked
         from tickets t left join accounts a on a.id = t.account_id
        where t.kind = 'compromised' and (t.status = 'closed') = $1
        order by t.created_at ${order}, t.number ${order} limit 200`,
      [status === 'closed'],
    );
    // A team member's login has no public name of its own: shown as a member login (displayName null).
    return { items: rows.map((r) => ({ ...summary(r), matched: r.account_id !== null, displayName: r.display_name, locked: r.locked })) };
  });

  app.get('/staff/v1/compromised/:id', opts, async (req) => {
    const { db, config } = req.server.deps;
    const t = await reportOf(db, req);
    let account = null;
    if (t.account_id !== null) {
      const { rows } = await db.query<{ display_name: string; kind: string; created_at: Date; team: string | null }>(
        `select a.display_name, a.kind, a.created_at,
                (select o.display_name from team_members tm join accounts o on o.id = tm.account_id where tm.member_account_id = a.id) as team
           from accounts a where a.id = $1`,
        [t.account_id],
      );
      const lock = await activeLock(db, t.account_id);
      const trades = await db.query<{ code: string; state: string; seller: boolean; paused_at: Date | null }>(
        `select code, state, seller_account_id = $1 as seller, paused_at from trades
          where (seller_account_id = $1 or buyer_account_id = $1) and closed_at is null order by taken_at, code`,
        [t.account_id],
      );
      const a = rows[0];
      account = a
        ? {
            // The unlock's tap is bound to this id (`unlock-account`).
            id: t.account_id,
            displayName: a.kind === 'member' ? null : a.display_name,
            kind: a.kind,
            // A member's login: the team it works for (its lead's public name).
            team: a.kind === 'member' ? a.team : null,
            createdAt: a.created_at.toISOString(),
            lockedAt: lock?.lockedAt.toISOString() ?? null,
            openTrades: trades.rows.map((r) => ({ code: r.code, state: r.state, side: r.seller ? 'seller' : 'buyer', paused: r.paused_at !== null })),
          }
        : null;
    }
    // J6: staff reads are audited, ids only; the row is written before the sealed comment (the
    // sender's typed credentials, if any) is opened.
    await withTx(db, (c) => log(c, req, 'account.report-viewed', { ticketId: t.id }));
    const comment = (await messagesOf(db, config, t.id)).find((m) => m.from === 'trader')?.body ?? null;
    return { ...summary(t), comment, account };
  });

  app.post('/staff/v1/compromised/:id/unlock', opts, async (req) => {
    const tapId = tapIdOf(body(req));
    const now = req.server.deps.clock();
    await withTx(req.server.deps.db, async (c) => {
      const t = await reportOf(c, req, { lock: true });
      if (t.account_id === null) throw new ApiError(409, 'wrong-state');
      const accountId = t.account_id;
      await c.query('select 1 from accounts where id = $1 for no key update', [accountId]);
      if ((await activeLock(c, accountId)) === null) throw new ApiError(409, 'wrong-state');
      await consumeKeyTap(c, tapId, req.staff.accountId, { kind: 'unlock-account', accountId, ticketId: t.id }, now, { sessionId: req.auth.sessionId });
      await unlockAccount(c, accountId, req.staff.accountId, now);
      await log(c, req, 'account.unlocked', { accountId, ticketId: t.id });
    });
    return { status: 'unlocked' as const };
  });

  app.post('/staff/v1/compromised/:id/close', opts, async (req) => {
    const now = req.server.deps.clock();
    const t = await withTx(req.server.deps.db, async (c) => {
      const t = await reportOf(c, req, { lock: true });
      if (t.status === 'closed') return t;
      if (t.account_id !== null && (await activeLock(c, t.account_id)) !== null) throw new ApiError(409, 'account-locked');
      await c.query("update tickets set status = 'closed', closed_at = $2, updated_at = $2 where id = $1", [t.id, now]);
      await log(c, req, 'account.report-closed', { ticketId: t.id });
      return { ...t, status: 'closed' as const, closed_at: now, updated_at: now };
    });
    return summary(t);
  });
}
