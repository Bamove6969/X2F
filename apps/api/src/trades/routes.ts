import { addressEnd } from '@x2f/accounts';
import { normalizeTradeCode } from '@x2f/core';
import { CLIENT_EVENTS, TradeRuleError, UNLOCK_CONFIRMATIONS, type Trade, type TradeEvent } from '@x2f/trade';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireSession } from '../auth/sessions.js';
import { ApiError } from '../errors.js';
import { noConfirmations, type TxConfirmations } from './chain.js';
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
  // Delivery (Task 19: streams, pushes, the final alert) runs after the actor's request, as the
  // nudge routes' `deliver` does: the store calls this after its commit, and setImmediate keeps
  // it out of the response, so the actor's response time says nothing about the counterparty's
  // subscriptions or open streams, and a slow push service never stalls the actor (review M8).
  // A failed delivery is logged as a fixed line: the error is reduced to its class and code by the
  // logger, and nothing about the trade is written.
  const publish: TradePublisher = async (t, e, by) => {
    setImmediate(() => {
      Promise.resolve()
        .then(() => hook(t, e, by))
        .catch((err: unknown) => app.log.error({ err }, 'trade publish failed'));
    });
  };

  /** The view of `t` (the trade after this request's change, if any) with the row's non-machine columns. */
  const view = async (req: FastifyRequest, t: Trade, row: TradeRow): Promise<TradeView> => {
    const deps = req.server.deps;
    const me = req.auth.accountId;
    const other = t.buyerId === me ? t.sellerId : t.buyerId;
    const now = deps.clock();
    return toTradeView(t, me, now, {
      counterparty: await traderSummary(deps.db, other, now, me),
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
   * (Task 25's FinalAlert, once per finalAlertAt, only while the alert is on screen; the service
   * worker posts nothing, since a notification in the tray is not proof it was read). The only way
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

/** What `GET /v1/trades/:code/confirmations` answers. */
export interface ConfirmationsView {
  /** From X2F's own node: 0 while in the pool, null when the node does not know the tx or cannot be asked. */
  confirmations: number | null;
  /** The count at which Monero unlocks the coins (the released screen's "1 of 10"). */
  target: number;
  /** The buyer's own payout address ending (`addressEnd`), on a release, for the buyer only. */
  payoutEnd?: string;
}

/**
 * `GET /v1/trades/:code/confirmations` (Task 24): the released screen's live confirmations of the
 * trade's settlement tx, read from X2F's own node (spec 2.2 step 10). Task 6's rules: a trader
 * session, participants only, and anyone else the same 404 as an unknown code. Only this trade's
 * own `tx_hash` is ever looked up (nothing in the request names a tx). Before the trade has
 * settled (no tx yet) → 409 `wrong-state`. The buyer of a release also gets their own payout
 * address ending; nobody gets an address, an amount or the tx hash.
 */
export function confirmationsRoute(app: FastifyInstance, lookup: TxConfirmations = noConfirmations): void {
  const session = requireSession({ kinds: ['trader'] });
  app.get('/v1/trades/:code/confirmations', { preHandler: session }, async (req): Promise<ConfirmationsView> => {
    const row = await tradeFor(req);
    const t = rowToTrade(row);
    const role = roleOf(t, req.auth.accountId);
    if (role === null) throw new ApiError(404, 'not-found');
    if (t.txHash === null || (t.state !== 'released' && t.state !== 'refunded')) throw new ApiError(409, 'wrong-state');
    let confirmations: number | null = null;
    try {
      confirmations = await lookup(t.txHash);
    } catch (err) {
      // A fixed line: the logger reduces the error to its class and code (never the hash or the node's URL).
      req.log.warn({ err }, 'confirmations lookup failed');
    }
    const out: ConfirmationsView = { confirmations, target: UNLOCK_CONFIRMATIONS };
    if (role === 'buyer' && t.state === 'released' && row.buyer_payout !== null) out.payoutEnd = addressEnd(row.buyer_payout);
    return out;
  });
}
