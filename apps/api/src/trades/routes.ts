import { addressEnd } from '@x2f/accounts';
import { normalizeTradeCode } from '@x2f/core';
import { CLIENT_EVENTS, TradeRuleError, UNLOCK_CONFIRMATIONS, type Trade, type TradeEvent } from '@x2f/trade';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { cancelWaiting, counterpartyProblem, refuseHeldTradeEvent } from './held.js';
import { requireSession } from '../auth/sessions.js';
import { requireLiveSessionInTx } from '../auth/hold.js';
import { ApiError } from '../errors.js';
import { assertLiveMember, auditLead, auditMember, type AuditAction } from '../team/audit.js';
import { assertMemberMay, assertMemberMaySend, EVENT_ABILITY, eventAbility, MEMBER_EVENT_ABILITIES, TRADE_READ, tradePartAbility } from '../team/perms.js';
import { recordReturnConfirmed } from './cancelReturn.js';
import { noConfirmations, type TxConfirmations } from './chain.js';
import { applyEvent, loadTradeRow, noPublish, rowToTrade, type TradePublisher, type TradeRow } from './store.js';
import { actorOfBy, appendLog } from '../log/append.js';
import { roleOf, toTradeView, traderSummary, type TradeView } from './view.js';

/** Task 3's `getProfile`; the default (until Task 3 is wired in) knows no profiles. */
export type ProfileLookup = (methodId: string) => unknown;

export interface TradeRouteOptions {
  /** Task 19's event bus; a no-op until then. */
  publish?: TradePublisher;
  profile?: ProfileLookup;
  /** X2F's own node (the confirmations route's lookup): the seller's `confirm-cancel` needs the refund's confirmations. */
  txConfirmations?: TxConfirmations;
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
  // open-dispute is a client event, but only POST /v1/trades/:code/dispute (Task 27) sends it, so
  // every dispute a trader opens has its reason row.
  if (typeof type !== 'string' || !CLIENT.has(type) || type === 'open-dispute') throw new ApiError(400, 'event-not-allowed');
  if (type === 'mark-paid') {
    const cents = b.fiatCents;
    if (typeof cents !== 'string' || !CENTS.test(cents)) throw new ApiError(400, 'bad-request');
    return { type, fiatCents: BigInt(cents) };
  }
  // The count is filled in by the route from X2F's own node, never from the body.
  if (type === 'confirm-cancel') return { type, returnConfirmations: 0 };
  return { type: type as Exclude<ClientEventType, 'mark-paid' | 'confirm-cancel'> };
}

/** The trade for a path code, or 404 for a malformed or unknown code. */
export async function tradeFor(req: FastifyRequest): Promise<TradeRow> {
  const raw = (req.params as { code?: unknown }).code;
  const code = typeof raw === 'string' ? normalizeTradeCode(raw) : null;
  if (code === null) throw new ApiError(404, 'not-found');
  const row = await loadTradeRow(req.server.deps.db, code);
  if (!row) throw new ApiError(404, 'not-found');
  return row;
}

/**
 * Plan 2 Task 17 and R42: trades already open can be finished during the 24-hour hold, from a
 * backup (recovery) session too, held or not: reading the trade, every trade event (mark paid,
 * release started and its signals, the buyer's cancel), the confirmations, and opening a dispute (disputes/routes.ts). Starting a trade stays refused
 * (`take` checks the hold and takes full sessions only).
 */
export const FINISH_OPEN_TRADES = { kinds: ['trader'], allowRecovery: true, allowHeld: true } as const satisfies Parameters<typeof requireSession>[0];

/**
 * `GET /v1/trades/:code` and `POST /v1/trades/:code/events` (Task 6). Trader sessions only, and
 * participants only: anyone else gets the same 404 as for an unknown code.
 */
export function tradeRoutes(app: FastifyInstance, opts: TradeRouteOptions = {}): void {
  // The account owner, or a team member with a box that covers the step (Plan 2 Task 18, Job 1c):
  // reading a trade (active or past), the trade events (each
  // event's own box, checked again in the handler: EVENT_ABILITY).
  const readTrade = requireSession({ ...FINISH_OPEN_TRADES, member: TRADE_READ });
  const sendEvent = requireSession({ ...FINISH_OPEN_TRADES, member: MEMBER_EVENT_ABILITIES });
  const hook = opts.publish ?? noPublish;
  const profile = opts.profile ?? (() => null);
  const txConfirmations = opts.txConfirmations ?? noConfirmations;
  // Delivery (Task 19: streams, pushes) runs after the actor's request, as the
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
      counterparty: await traderSummary(deps.db, other, now, me, other === t.sellerId ? 'seller' : 'buyer'),
      profile: profile(t.methodId) ?? null,
      sellerWalletApp: row.seller_wallet_app,
      counterpartyProblem: await counterpartyProblem(deps.db, t.code, other),
      cancelWaiting: await cancelWaiting(deps.db, t.code),
      paymentInstructions: row.method_instructions,
    });
  };

  app.get('/v1/trades/:code', { preHandler: readTrade }, async (req) => {
    const row = await tradeFor(req);
    const t = rowToTrade(row);
    if (roleOf(t, req.auth.accountId) === null) throw new ApiError(404, 'not-found');
    // Review trades-list I1: a member reads an open trade with See active trades and a completed
    // one with See trade history, as the trades list does (the guard let in either box).
    assertMemberMay(req.auth, tradePartAbility(row.closed_at));
    return view(req, t, row);
  });

  // `POST /v1/trades/:code/final-alert-seen` is gone with the final alert (owner 8 Nov, p6-1): an
  // old client's receipt now gets the router's 404.

  app.post('/v1/trades/:code/events', { preHandler: sendEvent }, async (req) => {
    const e = clientEvent(req.body);
    // Task 18 (R44): no team member signs escrow until a per-member key scheme exists, and never
    // releases on the lead's sell trades (p10-2); then the event's own box (Job 1c), and a box that
    // reads the trade it acts on (review 2026-11-09 m1: no acting on a trade one cannot see).
    assertMemberMaySend(req.auth.memberId, e.type);
    assertMemberMay(req.auth, eventAbility(e.type));
    assertMemberMay(req.auth, TRADE_READ);
    const row = await tradeFor(req);
    // `by` is the session's side in this trade (P3-C2); the two sides never change after take.
    const by = roleOf(rowToTrade(row), req.auth.accountId);
    if (by === null) throw new ApiError(404, 'not-found');
    const deps = req.server.deps;
    // Once the server recorded the full count (cancel_confirmable_at) the node is not asked again (review M1).
    if (e.type === 'confirm-cancel' && row.tx_hash !== null && row.cancel_confirmable_at === null) {
      // "Confirm cancel" stays greyed out until the returned XMR has all its confirmations (owner
      // 2026-10-29): the count is X2F's node's for this trade's own refund tx; unknown counts as 0.
      let n: number | null = null;
      try {
        n = await txConfirmations(row.tx_hash);
      } catch (err) {
        req.log.warn({ err }, 'confirmations lookup failed');
      }
      e.returnConfirmations = n ?? 0;
      // The first full count also starts the 48 hours, if the watcher has not yet (cancelReturn.ts).
      // A member's request records it only while still a live Trades member: the check runs in the
      // record's transaction, as auditMember's does for the event (Task 18 review round 2, n2).
      await recordReturnConfirmed({ db: deps.db, clock: deps.clock, publish }, row, n, (client) => assertLiveMember(client, req.auth, EVENT_ABILITY['confirm-cancel']));
    }
    let next: Trade;
    try {
      // A member's event is in the account owner's audit log, in the event's transaction (only when it changed the trade).
      // Review round 5 M2 (Task 17): the session must still be live under the account lock, taken after the
      // trade row's (a mark-paid in flight across the owner's proof or a logout writes nothing; 401).
      next = await applyEvent(
        { db: deps.db, clock: deps.clock, publish },
        row.code,
        e,
        by,
        async (client, _prev, _next, now) => {
          await auditMember(client, req.auth, { action: e.type as AuditAction, tradeCode: row.code }, now);
          // T-076 (p7-1): on a team account the lead's release is in the team log too, with the amount.
          if (e.type === 'release-started') await auditLead(client, req.auth, { action: 'release-started', tradeCode: row.code }, now);
        },
        async (client, now, prev) => {
          await requireLiveSessionInTx(client, req.auth, now);
          // Hold model v3: a trade held by a recovery-code hold moves for nobody (trades/held.ts);
          // the partner's buyer-cancel is only recorded while coins are in escrow (owner G7, I5).
          // R-C1: the dry run is the caller's real side (`by`); a seller's buyer-cancel falls through to the machine (409 wrong-party).
          const held = await refuseHeldTradeEvent(client, row.code, req.auth.accountId, e.type, { prev, now, by });
          if (held === 'stop') {
            await auditMember(client, req.auth, { action: e.type as AuditAction, tradeCode: row.code }, now);
            // Recorded only; the cancel itself is logged as `trade.buyer-cancel` when the sync applies it (lead review 8 Nov I5).
            await appendLog(client, { at: now, actor: actorOfBy(by), tradeCode: row.code, action: 'trade.buyer-cancel-recorded', detail: {} });
          }
          return held;
        },
      );
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
export function confirmationsRoute(app: FastifyInstance, lookup: TxConfirmations = noConfirmations, hook: TradePublisher = noPublish): void {
  const session = requireSession({ ...FINISH_OPEN_TRADES, member: TRADE_READ });
  // A recorded `return-confirmed` (Task 39) is delivered after the response, as tradeRoutes does.
  const publish: TradePublisher = async (t, e, by) => {
    setImmediate(() => {
      Promise.resolve()
        .then(() => hook(t, e, by))
        .catch((err: unknown) => app.log.error({ err }, 'trade publish failed'));
    });
  };
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
    // A buyer's cancel: the first full count makes the seller's Confirm cancel available (owner 2026-10-29).
    // A member's read records it only while still a live member who may read the trade (Task 18 review round 2, n2).
    await recordReturnConfirmed({ db: req.server.deps.db, clock: req.server.deps.clock, publish }, row, confirmations, (client) =>
      assertLiveMember(client, req.auth, TRADE_READ),
    );
    const out: ConfirmationsView = { confirmations, target: UNLOCK_CONFIRMATIONS };
    if (role === 'buyer' && t.state === 'released' && row.buyer_payout !== null) out.payoutEnd = addressEnd(row.buyer_payout);
    return out;
  });
}
