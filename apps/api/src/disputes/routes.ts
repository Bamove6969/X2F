import { addressEnd } from '@x2f/accounts';
import { TradeRuleError, type Party, type Trade } from '@x2f/trade';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { requireSession } from '../auth/sessions.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { auditMember } from '../team/audit.js';
import { applyEvent, noPublish, rowToTrade, type TradePublisher, type TradeRow } from '../trades/store.js';
import { tradeFor } from '../trades/routes.js';
import { roleOf } from '../trades/view.js';
import { NEXT_SEQ } from './store.js';

/**
 * Trader-side disputes (Plan 3 Task 27; spec 2.3, 6.6). Plan 3 opens disputes and takes appeals;
 * Plan 4 writes rulings, the ruling deadline and the moderator's join, which this file only reads.
 * Participants only (anyone else gets the same 404 as an unknown code), trader sessions only.
 */

/** Reason codes a trader may give, relative to whoever opens the dispute (108_disputes.sql). */
export const DISPUTE_REASONS = ['paid', 'silent', 'terms', 'other'] as const;
/** A stored reason: a trader's, or 'escalated' for a dispute the system opened (110). */
export type DisputeReason = (typeof DISPUTE_REASONS)[number] | 'escalated';
export const NOTE_MAX = 1000;
export const APPEAL_MIN = 10;
export const APPEAL_MAX = 1000;

export type RulingOutcome = 'release-to-buyer' | 'refund-to-seller' | 'seller-sends-xmr' | 'seller-returns-fiat' | 'no-action';

/** What `GET /v1/trades/:code/dispute` returns. Names are public display names; no address is ever whole. */
export interface DisputeView {
  /** 'system' when the timer loop escalated the trade (late funds, a lapse nobody refunded). */
  openedBy: Party | 'system';
  reason: DisputeReason;
  openedAt: string;
  afterRefund: boolean;
  /** The published ruling deadline, once Plan 4 sets it. */
  dueAt: string | null;
  status: 'open' | 'ruled' | 'appealed' | 'final' | 'closed';
  /** From server records only (Plan 4 writes it when a moderator first opens the chat). */
  moderator: { name: string; joinedAt: string } | null;
  /** The latest ruling (the appeal round over the first). */
  ruling: {
    round: 1 | 2;
    outcome: RulingOutcome;
    reason: string;
    evidence: string[];
    moderatorName: string;
    ruledAt: string;
    /** Null for a final (appeal-round) ruling. */
    appealUntil: string | null;
    /** Where the XMR goes, only for the side the ruling pays: its wallet app and address ending. */
    destination: { walletApp: string | null; addressEnd: string } | null;
  } | null;
  appeal: { by: Party; at: string } | null;
  serverNow: string;
}

interface DisputeRow {
  seq: number;
  opened_by: Party | 'system';
  reason: DisputeReason;
  opened_at: Date;
  after_refund: boolean;
  due_at: Date | null;
  status: DisputeView['status'];
  moderator_name: string | null;
  moderator_joined_at: Date | null;
}

interface RulingRow {
  round: 1 | 2;
  outcome: RulingOutcome;
  reason: string;
  evidence: unknown;
  moderator_name: string;
  ruled_at: Date;
  appeal_until: Date | null;
}

function bodyOf(req: FastifyRequest, keys: readonly string[]): Record<string, unknown> {
  const body = req.body;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'bad-request');
  const b = body as Record<string, unknown>;
  // Exactly these keys: a `by`, `type` or anything else is refused, never ignored.
  if (Object.keys(b).some((k) => !keys.includes(k))) throw new ApiError(400, 'bad-request');
  return b;
}

/**
 * Free text a trader writes: a string of at most `max` characters with no control character
 * except a line break or a tab (Postgres refuses U+0000 in text; the others are never typed).
 */
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;
const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max && !CONTROL.test(v);

const isReason = (v: unknown): v is (typeof DISPUTE_REASONS)[number] => typeof v === 'string' && (DISPUTE_REASONS as readonly string[]).includes(v);

/** The trade and the caller's side, or 404 for anyone who is not a participant. */
async function participant(req: FastifyRequest): Promise<{ row: TradeRow; t: Trade; side: Party }> {
  const row = await tradeFor(req);
  const t = rowToTrade(row);
  const side = roleOf(t, req.auth.accountId);
  if (side === null) throw new ApiError(404, 'not-found');
  return { row, t, side };
}

/** The wallet app of the account's wallet with this address (a removed one counts), or null. */
async function walletAppFor(q: Queryable, accountId: string, address: string): Promise<string | null> {
  const { rows } = await q.query<{ app: string }>(
    'select app from wallets where account_id = $1 and address = $2 order by created_at desc limit 1',
    [accountId, address],
  );
  return rows[0]?.app ?? null;
}

/** Which side an outcome pays XMR to (the after-refund outcomes pay nobody from an escrow). */
function paidSide(outcome: RulingOutcome): Party | null {
  if (outcome === 'release-to-buyer') return 'buyer';
  if (outcome === 'refund-to-seller') return 'seller';
  return null;
}

async function loadView(q: Queryable, row: TradeRow, side: Party, accountId: string, now: Date): Promise<DisputeView | null> {
  // The current dispute is the trade's latest (highest seq); earlier ones are kept but not shown.
  const d = (await q.query<DisputeRow>('select * from disputes where code = $1 order by seq desc limit 1', [row.code])).rows[0];
  if (!d) return null;
  const r = (await q.query<RulingRow>('select * from dispute_rulings where code = $1 and seq = $2 order by round desc limit 1', [row.code, d.seq])).rows[0];
  const a = (await q.query<{ by: Party; at: Date }>('select by, at from dispute_appeals where code = $1 and seq = $2', [row.code, d.seq])).rows[0];

  let ruling: DisputeView['ruling'] = null;
  if (r) {
    let destination: NonNullable<DisputeView['ruling']>['destination'] = null;
    if (paidSide(r.outcome) === side) {
      const address = side === 'buyer' ? row.buyer_payout : row.seller_refund;
      if (address !== null) {
        const walletApp = side === 'seller' ? row.seller_wallet_app : await walletAppFor(q, accountId, address);
        destination = { walletApp, addressEnd: addressEnd(address) };
      }
    }
    ruling = {
      round: r.round,
      outcome: r.outcome,
      reason: r.reason,
      evidence: Array.isArray(r.evidence) ? r.evidence.filter((x): x is string => typeof x === 'string') : [],
      moderatorName: r.moderator_name,
      ruledAt: r.ruled_at.toISOString(),
      appealUntil: r.appeal_until?.toISOString() ?? null,
      destination,
    };
  }
  return {
    openedBy: d.opened_by,
    reason: d.reason,
    openedAt: d.opened_at.toISOString(),
    afterRefund: d.after_refund,
    dueAt: d.due_at?.toISOString() ?? null,
    status: d.status,
    moderator:
      d.moderator_name !== null && d.moderator_joined_at !== null ? { name: d.moderator_name, joinedAt: d.moderator_joined_at.toISOString() } : null,
    ruling,
    appeal: a ? { by: a.by, at: a.at.toISOString() } : null,
    serverNow: now.toISOString(),
  };
}

async function inTransaction<T>(db: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('begin');
    try {
      const out = await fn(client);
      await client.query('commit');
      return out;
    } catch (err) {
      await client.query('rollback');
      throw err;
    }
  } finally {
    client.release();
  }
}

export interface DisputeRouteOptions {
  /** Task 19's event bus (the same hook the trade events route uses); a no-op until then. */
  publish?: TradePublisher;
}

export function disputeRoutes(app: FastifyInstance, opts: DisputeRouteOptions = {}): void {
  // The account owner, or a team member with Trades (Plan 2 Task 18).
  const trader = requireSession({ kinds: ['trader'], member: 'trades' });
  const hook = opts.publish ?? noPublish;
  const publish: TradePublisher = async (t, e, by) => {
    try {
      await hook(t, e, by);
    } catch (err) {
      app.log.error({ err }, 'trade publish failed');
    }
  };

  app.get('/v1/trades/:code/dispute', { preHandler: trader }, async (req) => {
    const { row, side } = await participant(req);
    const view = await loadView(req.server.deps.db, row, side, req.auth.accountId, req.server.deps.clock());
    if (view === null) throw new ApiError(404, 'not-found');
    return view;
  });

  // Opens the dispute: the trade's `open-dispute` (the state machine decides when it is allowed:
  // the buyer only after the seller's confirm window, a refunded trade only by the buyer within
  // 48 hours, TIMERS.disputeAfterRefundHours) and the dispute row, in one transaction. A trade opens at most one dispute: once its
  // `dispute` is set (by a trader or the system) a new one is refused, whatever rows exist, so a
  // purge of old dispute rows can never re-open a decided case.
  app.post('/v1/trades/:code/dispute', { preHandler: trader }, async (req) => {
    const b = bodyOf(req, ['reason', 'note']);
    if (!isReason(b.reason)) throw new ApiError(400, 'bad-request');
    if (!isText(b.note, NOTE_MAX)) throw new ApiError(400, 'bad-request');
    const reason = b.reason;
    const note = b.note;
    const { row, side } = await participant(req);
    const deps = req.server.deps;
    try {
      await applyEvent({ db: deps.db, clock: deps.clock, publish }, row.code, { type: 'open-dispute' }, side, async (client, prev, _next, now) => {
        if (prev.dispute !== null) throw new ApiError(409, 'dispute-exists');
        await client.query(
          `insert into disputes (code, seq, opened_by, reason, note, opened_at, after_refund) values ($1, ${NEXT_SEQ}, $2, $3, $4, $5, $6)`,
          [row.code, side, reason, note, now, prev.state === 'refunded'],
        );
        // Task 18: a team member's dispute is in the account owner's audit log (the reason, never the note).
        await auditMember(client, req.auth, { action: 'dispute-opened', tradeCode: row.code, detail: { reason } }, now);
      });
    } catch (err) {
      if (err instanceof TradeRuleError) {
        // A trade already in dispute (or that had one) refuses open-dispute as wrong-state; say why.
        const had = (await deps.db.query<{ dispute_by: string | null }>('select dispute_by from trades where code = $1', [row.code])).rows[0];
        throw new ApiError(409, had?.dispute_by != null ? 'dispute-exists' : err.code);
      }
      throw err;
    }
    const view = await loadView(deps.db, row, side, req.auth.accountId, deps.clock());
    return view;
  });

  // An appeal to a second moderator (spec 2.3): either side, once per dispute, only against a
  // first-round ruling and strictly before its appeal window ends.
  app.post('/v1/trades/:code/appeal', { preHandler: trader }, async (req) => {
    const b = bodyOf(req, ['why']);
    if (!isText(b.why, APPEAL_MAX) || b.why.trim().length < APPEAL_MIN) throw new ApiError(400, 'bad-request');
    const why = b.why;
    const { row, side } = await participant(req);
    const deps = req.server.deps;
    await inTransaction(deps.db, async (client) => {
      // The current dispute (highest seq), locked; an earlier dispute is never appealed again.
      const d = (await client.query<{ seq: number; status: string }>(
        'select seq, status from disputes where code = $1 order by seq desc limit 1 for update',
        [row.code],
      )).rows[0];
      // Only a published first-round ruling can be appealed (never an open, appealed, final or closed case).
      if (!d || d.status !== 'ruled') throw new ApiError(409, 'wrong-state');
      const now = deps.clock();
      const r = (await client.query<RulingRow>('select * from dispute_rulings where code = $1 and seq = $2 order by round desc limit 1', [row.code, d.seq])).rows[0];
      if (!r || r.round !== 1 || r.appeal_until === null) throw new ApiError(409, 'wrong-state');
      if (now.getTime() >= r.appeal_until.getTime()) throw new ApiError(409, 'too-late');
      const { rowCount } = await client.query(
        'insert into dispute_appeals (code, seq, by, why, at) values ($1, $2, $3, $4, $5) on conflict (code, seq) do nothing',
        [row.code, d.seq, side, why, now],
      );
      if (rowCount !== 1) throw new ApiError(409, 'wrong-state');
      // Guarded transition: ruled -> appealed only (the row is locked above; the guard keeps it so).
      const moved = await client.query(`update disputes set status = 'appealed' where code = $1 and seq = $2 and status = 'ruled'`, [row.code, d.seq]);
      if (moved.rowCount !== 1) throw new ApiError(409, 'wrong-state');
      await auditMember(client, req.auth, { action: 'appeal-filed', tradeCode: row.code }, now);
    });
    return loadView(deps.db, row, side, req.auth.accountId, deps.clock());
  });
}
