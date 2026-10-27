import { normalizeTradeCode } from '@x2f/core';
import { CLIENT_EVENTS, TradeRuleError, type Trade, type TradeEvent } from '@x2f/trade';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireSession } from '../auth/sessions.js';
import { ApiError } from '../errors.js';
import { applyEvent, loadTradeRow, noPublish, rowToTrade, type TradePublisher, type TradeRow } from './store.js';
import { roleOf, toTradeView, traderSummary, type TradeView } from './view.js';

/** Task 3's `getProfile`; the default (until Task 3 is wired in) knows no profiles. */
export type ProfileLookup = (methodId: string) => unknown;

export interface TradeRouteOptions {
  /** Task 19's event bus; a no-op until then. */
  publish?: TradePublisher;
  profile?: ProfileLookup;
}

type ClientEventType = (typeof CLIENT_EVENTS)[number];
const CLIENT = new Set<string>(CLIENT_EVENTS);
/** A total in the currency's minor units: a plain non-negative decimal, at most 18 digits. */
const CENTS = /^(0|[1-9][0-9]{0,17})$/;

/**
 * The event a participant may post, from the body. Only CLIENT_EVENTS pass (P3-C2); every other
 * field, a `by` included, is ignored except `fiatCents` on `mark-paid`.
 */
function clientEvent(body: unknown): TradeEvent {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'bad-request');
  const b = body as Record<string, unknown>;
  const type = b.type;
  if (typeof type !== 'string' || !CLIENT.has(type)) throw new ApiError(400, 'event-not-allowed');
  if (type === 'mark-paid') {
    const cents = b.fiatCents;
    if (typeof cents !== 'string' || !CENTS.test(cents)) throw new ApiError(400, 'bad-request');
    return { type, fiatCents: BigInt(cents) };
  }
  return { type: type as Exclude<ClientEventType, 'mark-paid'> };
}

/** The trade for a path code, or 404 for a malformed or unknown code. */
async function tradeFor(req: FastifyRequest): Promise<TradeRow> {
  const raw = (req.params as { code?: unknown }).code;
  const code = typeof raw === 'string' ? normalizeTradeCode(raw) : null;
  if (code === null) throw new ApiError(404, 'not-found');
  const row = await loadTradeRow(req.server.deps.db, code);
  if (!row) throw new ApiError(404, 'not-found');
  return row;
}

/**
 * `GET /v1/trades/:code` and `POST /v1/trades/:code/events` (Task 6). Trader sessions only, and
 * participants only: anyone else gets the same 404 as for an unknown code.
 */
export function tradeRoutes(app: FastifyInstance, opts: TradeRouteOptions = {}): void {
  const session = requireSession({ kinds: ['trader'] });
  const hook = opts.publish ?? noPublish;
  const profile = opts.profile ?? (() => null);
  // A failed delivery is logged as a fixed line: the error is reduced to its class and code by the
  // logger, and nothing about the trade is written.
  const publish: TradePublisher = async (t, e, by) => {
    try {
      await hook(t, e, by);
    } catch (err) {
      app.log.error({ err }, 'trade publish failed');
    }
  };

  /** The view of `t` (the trade after this request's change, if any) with the row's non-machine columns. */
  const view = async (req: FastifyRequest, t: Trade, row: TradeRow): Promise<TradeView> => {
    const deps = req.server.deps;
    const me = req.auth.accountId;
    const other = t.buyerId === me ? t.sellerId : t.buyerId;
    const now = deps.clock();
    return toTradeView(t, me, now, {
      counterparty: await traderSummary(deps.db, other, now),
      profile: profile(t.methodId) ?? null,
      sellerWalletApp: row.seller_wallet_app,
      finalAlertSeenAt: row.final_alert_seen_at,
    });
  };

  app.get('/v1/trades/:code', { preHandler: session }, async (req) => {
    const row = await tradeFor(req);
    const t = rowToTrade(row);
    if (roleOf(t, req.auth.accountId) === null) throw new ApiError(404, 'not-found');
    return view(req, t, row);
  });

  /**
   * `POST /v1/trades/:code/final-alert-seen` → 204: the buyer's device has shown the final alert
   * (Task 25's FinalAlert, once per finalAlertAt, only while the alert is on screen). The only way
   * `final_alert_delivered` becomes true; a stream being open or a push service answering 201
   * never does (P3-I13). `final_alert_seen_at` keeps the first receipt's time (Task 10 counts the
   * buyer's 15 minutes from it). Idempotent. An unknown code and someone else's trade get the same
   * 404; the seller gets 409 `wrong-party`; before a refund is requested, 409 `wrong-state`.
   */
  app.post('/v1/trades/:code/final-alert-seen', { preHandler: session }, async (req, reply) => {
    const t = rowToTrade(await tradeFor(req));
    const role = roleOf(t, req.auth.accountId);
    if (role === null) throw new ApiError(404, 'not-found');
    if (role !== 'buyer') throw new ApiError(409, 'wrong-party');
    // The state conditions live in the UPDATE, not only in the read above: a mark-paid that
    // commits between the two leaves the (now paid) trade unflagged, and the answer comes from
    // the row count (review 2026-10-27, minor 5).
    const { db, clock } = req.server.deps;
    const r = await db.query(
      `update trades set final_alert_delivered = true, final_alert_seen_at = coalesce(final_alert_seen_at, $3)
        where code = $1 and buyer_account_id = $2 and state = 'refund_requested' and final_alert_at is not null`,
      [t.code, req.auth.accountId, clock()],
    );
    if ((r.rowCount ?? 0) === 0) throw new ApiError(409, 'wrong-state');
    return reply.code(204).send();
  });

  /**
   * `POST /v1/account/final-alert-seen` → 204: the service worker has shown a trade push. Pushes
   * carry no trade code (spec 4), so this marks every trade where the caller is the buyer and a
   * refund is requested. Idempotent; touches no other account's trades.
   */
  app.post('/v1/account/final-alert-seen', { preHandler: session }, async (req, reply) => {
    const { db, clock } = req.server.deps;
    await db.query(
      `update trades set final_alert_delivered = true, final_alert_seen_at = coalesce(final_alert_seen_at, $2)
        where buyer_account_id = $1 and state = 'refund_requested' and final_alert_at is not null and final_alert_delivered is not true`,
      [req.auth.accountId, clock()],
    );
    return reply.code(204).send();
  });

  app.post('/v1/trades/:code/events', { preHandler: session }, async (req) => {
    const e = clientEvent(req.body);
    const row = await tradeFor(req);
    // `by` is the session's side in this trade (P3-C2); the two sides never change after take.
    const by = roleOf(rowToTrade(row), req.auth.accountId);
    if (by === null) throw new ApiError(404, 'not-found');
    const deps = req.server.deps;
    let next: Trade;
    try {
      next = await applyEvent({ db: deps.db, clock: deps.clock, publish }, row.code, e, by);
    } catch (err) {
      if (err instanceof TradeRuleError) throw new ApiError(409, err.code);
      throw err;
    }
    return view(req, next, row);
  });
}
