import { addressEnd } from '@x2f/accounts';
import { CLOSED_STATES, apply, isRulingKind, type By, type Trade, type TradeEvent, type TradeState } from '@x2f/trade';
import type pg from 'pg';
import type { Deps } from '../app.js';
import type { Queryable } from '../db/pool.js';
import { openSystemDispute } from '../disputes/store.js';
import { ApiError } from '../errors.js';
import { tradeHeldSql } from '../tickets/held.js';
import { actorOfBy, appendLog, tradeLogDetail } from '../log/append.js';
import { bookTradeRevenue } from '../staff/revenue.js';
import { settleRecovery } from '../disputes/recovery.js';
import { eraseReversedReviews } from '../reviews/store.js';
import { countActionTimes, countFastPayment } from '../traders/actionTimes.js';
import { countCancel, countTradeTotals } from '../traders/tradedTotal.js';
import { restoreOneTimeWallets } from '../wallets/routes.js';

/**
 * Called after an event is committed (the app passes Task 19's `tradeEventPublisher`: SSE, Web
 * Push, final alert). The store's default is `noPublish`. A publish failure never undoes or fails the event.
 */
export type TradePublisher = (t: Trade, e: TradeEvent, by: By) => void | Promise<void>;
export const noPublish: TradePublisher = () => undefined;

/** What the store needs: the pool, the server clock (never the device's), and the publish hook. */
export type TradeDeps = Pick<Deps, 'db' | 'clock'> & { publish?: TradePublisher };

/** The trade's columns besides the `Trade` fields (Task 5 fills them at take and from the wallet route). */
export interface TradeSides {
  buyerPayout: string | null;
  sellerRefund: string | null;
  sellerWalletApp: string | null;
  /** J-16 (490): the chosen method's instructions for the chosen currency, locked at take; '' when absent. */
  methodInstructions?: string;
}

/** A `trades` row as pg returns it: numeric columns arrive as strings. */
export interface TradeRow {
  code: string;
  offer_id: string;
  poster: 'seller' | 'buyer';
  seller_account_id: string;
  buyer_account_id: string;
  method_id: string;
  /** J-16 (490): the chosen method's instructions, locked at take. */
  method_instructions: string;
  amount_atomic: string;
  fee_atomic: string;
  seller_funds_atomic: string;
  locked_currency: string;
  locked_cents_per_xmr: string;
  fiat_cents: string;
  confirm_window_min: number;
  /** Migration 124 (owner p9-6): the method's time to pay, fixed at take. */
  pay_window_min: number;
  min_fiat_cents: string;
  max_fiat_cents: string;
  grown_at: Date | null;
  grown_from_atomic: string | null;
  grown_from_fiat_cents: string | null;
  state: TradeState;
  escrow_address: string | null;
  received_atomic: string;
  unlocked_atomic: string;
  confirmations: number;
  releasable: boolean;
  taken_at: Date;
  setup_by: Date | null;
  fund_by: Date | null;
  funding_seen_at: Date | null;
  /** Migration 116 (Revision 2026-10-29b): when the seller tapped "Fund escrow". */
  fund_started_at: Date | null;
  lapsed_at: Date | null;
  secured_at: Date | null;
  pay_by: Date | null;
  extensions: number;
  paid_at: Date | null;
  confirm_by: Date | null;
  // The retired final-alert columns (final_alert_at, final_alert_seen_at; owner's 8 Nov reversal,
  // migration 120) stay in the table for old rows; nothing in src reads or writes them.
  cancel_proposed_by: 'buyer' | 'seller' | null;
  settling: Trade['settling'];
  settle_from: TradeState | null;
  settle_by: Date | null;
  release_claimed_at: Date | null;
  paused_at: Date | null;
  tx_hash: string | null;
  dispute_by: By | null;
  dispute_at: Date | null;
  closed_at: Date | null;
  /** Migration 116: the seller's "Confirm cancel" after a buyer-cancel refund (owner 2026-10-29). */
  cancel_confirmed_at: Date | null;
  /** Migration 116: when the seller's Confirm cancel became available (the refund fully confirmed). */
  cancel_confirmable_at: Date | null;
  /**
   * Migration 119: when the seller first nudged the buyer after the escrow was secured. Written
   * only by the nudge route, never by `stateColumns` (no event changes it). A record only since the
   * owner made nudges optional (8 Nov, p6-1): no rule reads it.
   */
  seller_nudged_at: Date | null;
  buyer_payout: string | null;
  seller_refund: string | null;
  seller_wallet_app: string | null;
  /**
   * Migration 301 (Plan 5 Task 3): the trade's US-dollar value at take, in cents (bigint as a
   * string), written once by the take; null before 301 or with no quote. Read only for a review's
   * weight, never returned.
   */
  usd_cents: string | null;
  /** Migration 891 (owner 27 Nov 2026): the seller's lien recovery fixed at take, '0' for none. */
  seller_lien_recovery_atomic?: string;
}

const big = (s: string): bigint => BigInt(s);
const bigOrNull = (s: string | null): bigint | null => (s === null ? null : BigInt(s));

export function rowToTrade(r: TradeRow): Trade {
  const grownFromAtomic = bigOrNull(r.grown_from_atomic);
  const grownFromFiat = bigOrNull(r.grown_from_fiat_cents);
  const sellerLien = r.seller_lien_recovery_atomic === undefined ? 0n : BigInt(r.seller_lien_recovery_atomic);
  return {
    code: r.code,
    offerId: r.offer_id,
    poster: r.poster,
    sellerId: r.seller_account_id,
    buyerId: r.buyer_account_id,
    methodId: r.method_id,
    amountAtomic: big(r.amount_atomic),
    feeAtomic: big(r.fee_atomic),
    sellerFundsAtomic: big(r.seller_funds_atomic),
    ...(sellerLien > 0n ? { sellerLienRecoveryAtomic: sellerLien } : {}),
    lockedRate: { currency: r.locked_currency, centsPerXmr: big(r.locked_cents_per_xmr) },
    fiatCents: big(r.fiat_cents),
    confirmWindowMin: r.confirm_window_min,
    payWindowMin: r.pay_window_min,
    minFiatCents: big(r.min_fiat_cents),
    maxFiatCents: big(r.max_fiat_cents),
    grown:
      r.grown_at !== null && grownFromAtomic !== null && grownFromFiat !== null
        ? { at: r.grown_at, fromAtomic: grownFromAtomic, fromFiatCents: grownFromFiat }
        : null,
    state: r.state,
    escrowAddress: r.escrow_address,
    receivedAtomic: big(r.received_atomic),
    unlockedAtomic: big(r.unlocked_atomic),
    confirmations: r.confirmations,
    releasable: r.releasable,
    takenAt: r.taken_at,
    setupBy: r.setup_by,
    fundBy: r.fund_by,
    fundingSeenAt: r.funding_seen_at,
    fundStartedAt: r.fund_started_at,
    lapsedAt: r.lapsed_at,
    securedAt: r.secured_at,
    payBy: r.pay_by,
    extensions: r.extensions,
    paidAt: r.paid_at,
    confirmBy: r.confirm_by,
    cancelProposedBy: r.cancel_proposed_by,
    settling: r.settling,
    settleFrom: r.settle_from,
    settleBy: r.settle_by,
    releaseClaimedAt: r.release_claimed_at ?? null,
    pausedAt: r.paused_at,
    txHash: r.tx_hash,
    dispute: r.dispute_by !== null && r.dispute_at !== null ? { by: r.dispute_by, at: r.dispute_at } : null,
    closedAt: r.closed_at,
    cancelConfirmedAt: r.cancel_confirmed_at,
    cancelConfirmableAt: r.cancel_confirmable_at,
    sellerNudgedAt: r.seller_nudged_at ?? null,
  };
}

/** The columns `apply` can change, in a fixed order, with their values for `t`. Bigints go to pg as strings. */
function stateColumns(t: Trade): [string, unknown][] {
  return [
    ['amount_atomic', t.amountAtomic.toString()],
    ['fee_atomic', t.feeAtomic.toString()],
    ['seller_funds_atomic', t.sellerFundsAtomic.toString()],
    ['fiat_cents', t.fiatCents.toString()],
    ['grown_at', t.grown?.at ?? null],
    ['grown_from_atomic', t.grown?.fromAtomic.toString() ?? null],
    ['grown_from_fiat_cents', t.grown?.fromFiatCents.toString() ?? null],
    ['state', t.state],
    ['escrow_address', t.escrowAddress],
    ['received_atomic', t.receivedAtomic.toString()],
    ['unlocked_atomic', t.unlockedAtomic.toString()],
    ['confirmations', t.confirmations],
    ['releasable', t.releasable],
    ['setup_by', t.setupBy],
    ['fund_by', t.fundBy],
    ['funding_seen_at', t.fundingSeenAt],
    ['fund_started_at', t.fundStartedAt],
    ['lapsed_at', t.lapsedAt],
    ['secured_at', t.securedAt],
    ['pay_by', t.payBy],
    ['extensions', t.extensions],
    ['paid_at', t.paidAt],
    ['confirm_by', t.confirmBy],
    ['cancel_proposed_by', t.cancelProposedBy],
    ['settling', t.settling],
    ['settle_from', t.settleFrom],
    ['settle_by', t.settleBy],
    ['release_claimed_at', t.releaseClaimedAt],
    ['paused_at', t.pausedAt],
    ['tx_hash', t.txHash],
    ['dispute_by', t.dispute?.by ?? null],
    ['dispute_at', t.dispute?.at ?? null],
    ['closed_at', t.closedAt],
    ['cancel_confirmed_at', t.cancelConfirmedAt],
    ['cancel_confirmable_at', t.cancelConfirmableAt],
  ];
}

/**
 * Inserts a new trade (Task 5's take, and tests). Fields fixed at take (offer, parties, method,
 * locked rate, confirm window, offer limits, taken_at) are written only here.
 */
/**
 * Inserts a new trade. `usdCents` is the take's US-dollar value (301; the starter-limit check's
 * number, null with no quote), kept only to weigh the trade's reviews (Plan 5 Task 3).
 */
/** `giftCardTerms`: the gift-card terms version the taker ticked (J-17); null on every other method. */
export async function insertTrade(
  q: Queryable,
  t: Trade,
  sides: TradeSides,
  usdCents: bigint | null = null,
  giftCardTerms: string | null = null,
): Promise<void> {
  const cols: [string, unknown][] = [
    ['code', t.code],
    ['offer_id', t.offerId],
    ['poster', t.poster],
    ['seller_account_id', t.sellerId],
    ['buyer_account_id', t.buyerId],
    ['method_id', t.methodId],
    ['locked_currency', t.lockedRate.currency],
    ['locked_cents_per_xmr', t.lockedRate.centsPerXmr.toString()],
    ['confirm_window_min', t.confirmWindowMin],
    ['pay_window_min', t.payWindowMin],
    ['min_fiat_cents', t.minFiatCents.toString()],
    ['max_fiat_cents', t.maxFiatCents.toString()],
    ['taken_at', t.takenAt],
    ...stateColumns(t),
    ['buyer_payout', sides.buyerPayout],
    ['seller_refund', sides.sellerRefund],
    ['seller_wallet_app', sides.sellerWalletApp],
    ['method_instructions', sides.methodInstructions ?? ''],
    ['usd_cents', usdCents === null ? null : usdCents.toString()],
    ['gift_card_terms', giftCardTerms],
    // Owner 27 Nov 2026: written once, never changed (migration 891's trigger); none is the column's
    // default 0, so the column is named only when there is an extra (older schemas in migration tests).
    ...((t.sellerLienRecoveryAtomic ?? 0n) > 0n ? [['seller_lien_recovery_atomic', t.sellerLienRecoveryAtomic!.toString()] as [string, unknown]] : []),
  ];
  // Column names are the fixed literals above, never input.
  await q.query(
    `insert into trades (${cols.map(([c]) => c).join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
    cols.map(([, v]) => v),
  );
}

/** The trade and its extra columns, or null. `forUpdate` locks the row (inside a transaction). */
export async function loadTradeRow(q: Queryable, code: string, forUpdate = false): Promise<TradeRow | null> {
  const { rows } = await q.query<TradeRow>(`select * from trades where code = $1${forUpdate ? ' for update' : ''}`, [code]);
  return rows[0] ?? null;
}

export async function loadTrade(q: Queryable, code: string): Promise<Trade | null> {
  const row = await loadTradeRow(q, code);
  return row ? rowToTrade(row) : null;
}

/** How a stored event field is written: as is (a bigint as a decimal string), or an address cut to its last 6. */
type Kept = 'value' | 'addressEnd';
type FieldsOf<T extends TradeEvent['type']> = Exclude<keyof Extract<TradeEvent, { type: T }>, 'type'>;

/**
 * Every field of every event type and how it is stored (P3-I12). The type makes this exhaustive:
 * a new event type, or a new field on one (a `to`, `payouts` or `refundTo`), does not compile
 * until it is listed here, and a field missing from this list is never stored.
 */
const STORED = {
  'setup-done': { escrowAddress: 'addressEnd' },
  chain: { receivedAtomic: 'value', unlockedAtomic: 'value', confirmations: 'value' },
  'mark-paid': { fiatCents: 'value' },
  extend: {},
  'request-refund': {},
  'buyer-cancel': {},
  'propose-cancel': {},
  'accept-cancel': {},
  'withdraw-cancel': {},
  'fund-started': {},
  'walk-away': {},
  'confirm-cancel': { returnConfirmations: 'value' },
  'return-confirmed': { confirmations: 'value' },
  'release-started': {},
  settled: { kind: 'value', txHash: 'value' },
  'open-dispute': {},
  escalate: {},
  'release-claimed': {},
  pause: {},
  resume: {},
  'system-cancel': {},
  tick: {},
} as const satisfies { [T in TradeEvent['type']]: Record<FieldsOf<T>, Kept> };

/**
 * The event as it is stored in `trade_events.event`: only the fields STORED lists for its type,
 * bigints as decimal strings, and each address replaced by `<name>End` holding its last 6
 * characters (P3-I12). Any other field is dropped. Throws TypeError for an unknown type or a
 * listed field that is not a plain string, number, boolean or bigint, so nothing nested is ever
 * stored whole.
 */
export function eventRecord(e: TradeEvent): Record<string, unknown> {
  if (!Object.hasOwn(STORED, e.type)) throw new TypeError('unknown event type');
  const fields: Readonly<Record<string, Kept>> = STORED[e.type];
  const src = e as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { type: e.type };
  for (const [k, how] of Object.entries(fields)) {
    if (!Object.hasOwn(src, k)) continue;
    const v = src[k];
    if (how === 'addressEnd') {
      if (typeof v !== 'string') throw new TypeError(`event field ${k} is not an address`);
      out[`${k}End`] = addressEnd(v);
    } else if (typeof v === 'bigint') {
      out[k] = v.toString();
    } else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v;
    } else {
      throw new TypeError(`event field ${k} is not a plain value`);
    }
  }
  return out;
}

/** A column value in a comparable form (dates by their instant). */
const comparable = (v: unknown): unknown => (v instanceof Date ? v.getTime() : v);

/** True when `next` would write exactly the columns `prev` already has. */
function unchanged(prev: Trade, next: Trade): boolean {
  const a = stateColumns(prev);
  const b = stateColumns(next);
  return a.every(([, v], i) => comparable(v) === comparable(b[i]![1]));
}

/**
 * Applies one event to one trade: locks the row, runs the pure state machine on the server's
 * clock, writes the new state and appends the (address-free) event, all in one transaction; then
 * publishes. An event that leaves every column as it was is a no-op: nothing is written,
 * appended or published. Throws ApiError 404 `not-found` for an unknown code and the machine's TradeRuleError
 * unchanged (callers map it); on any throw nothing is written.
 *
 * `within` runs inside the same transaction, after the trade and its event are written and before
 * the activity-log entry and the commit, with the locked row's trade before and after (Task 27 writes the dispute row there, so
 * a trade is never disputed without one). It does not run for a no-op event. If it throws, nothing
 * is written.
 *
 * `before` runs in the same transaction right after the trade row is locked, before anything is
 * worked out or written (Tasks 16-17 review round 5 M2: the events route re-checks its session
 * there; lock order trade row, then account, as `/v1/trades/:code/wallet`). If it throws, nothing
 * is written.
 */
export async function applyEvent(
  deps: TradeDeps,
  code: string,
  e: TradeEvent,
  by: By,
  within?: (client: pg.PoolClient, prev: Trade, next: Trade, now: Date) => Promise<void>,
  /**
   * Runs after the trade row lock, before the machine. Returning `'stop'` stops the event:
   * `before`'s own writes commit, the trade is not changed and nothing is published (a held
   * trade's buyer-cancel, or a resume another hold still blocks: trades/held.ts).
   */
  before?: (client: pg.PoolClient, now: Date, prev: Trade) => Promise<void | 'stop'>,
): Promise<Trade> {
  const client: pg.PoolClient = await deps.db.connect();
  let next: Trade;
  try {
    await client.query('begin');
    try {
      const row = await loadTradeRow(client, code, true);
      if (!row) throw new ApiError(404, 'not-found');
      const now = deps.clock();
      // D-059 (J-14, ported): while the buyer's or the seller's account is locked by a compromised
      // report, no trader event moves the trade (the other party's neither); system events (chain,
      // reports, the timer's pause) still apply. Read under the trade's row lock. Nor does a system
      // `resume`: a recovery-code hold's end (trades/held.ts) or maintenance's end resumes the trades
      // it paused, and a trade the lock also holds must stay paused until staff unlock it (409
      // `trade-held`, which only those system paths see).
      // Review of feat/lockout, item 5 (lead default, owner question pending): the other trader must
      // not learn of the lock, so a party's event is refused as on any paused trade (409
      // `wrong-state`, the machine's answer, with the room's ordinary pause copy), and opening a
      // dispute goes through as it does on any paused trade (owner G7: a paused trade's parties still
      // reach a moderator); the dispute is then paused with the trade (disputes/timers.ts), and staff
      // with `rulings.approve` may still rule on it (disputes/rulings.ts).
      if (by !== 'system' || e.type === 'resume') {
        const held = await client.query<{ held: boolean }>(`select ${tradeHeldSql('t')} as held from trades t where t.code = $1`, [code]);
        if (held.rows[0]?.held === true) {
          if (by === 'system') throw new ApiError(409, 'trade-held');
          if (e.type !== 'open-dispute') throw new ApiError(409, 'wrong-state');
        }
      }
      const prev = rowToTrade(row);
      // Review of wip/third-trade-wallet 17 Nov (b), B2: a trade in setup that used up a one-time
      // wallet may give it back below (`restoreOneTimeWallets`), which locks the wallet owner's
      // account. Lock both parties here, in id order, right after the trade row and before `before`
      // (whose live-session check locks the caller's account): the lock order is then "trade row,
      // then both accounts in id order" (migration 016's), the later account locks are re-entrant,
      // and a take (which locks [taker, poster] in id order and holds no trade row) cannot close a cycle.
      if (prev.state === 'setup') {
        const used = await client.query('select 1 from wallets where used_by_trade = $1 limit 1', [code]);
        if (used.rows.length > 0) {
          await client.query('select id from accounts where id = any($1) order by id for update', [[prev.sellerId, prev.buyerId]]);
        }
      }
      if (before && (await before(client, now, prev)) === 'stop') {
        await client.query('commit');
        return prev;
      }
      next = apply(prev, e, by, now);
      // An event that changes nothing (the same chain numbers again, a tick with nothing due)
      // writes no row, appends no event and publishes nothing.
      if (unchanged(prev, next)) {
        await client.query('rollback');
        return next;
      }
      // Task 5 (Revision 2026-10-24, starter limits): the cap check on growth goes here, inside
      // this transaction and before the write. When `e.type === 'chain'` and `next.grown` differs
      // from the stored one, a growth above either side's cap must keep the trade at its current
      // size (the extra returns to the seller, as for "above the offer's maximum").
      const cols = stateColumns(next);
      await client.query(
        `update trades set ${cols.map(([c], i) => `${c} = $${i + 2}`).join(', ')} where code = $1`,
        [code, ...cols.map(([, v]) => v)],
      );
      const record = eventRecord(e);
      await client.query('insert into trade_events (code, at, by, event) values ($1, $2, $3, $4)', [
        code, now, by, JSON.stringify(record),
      ]);
      // Task 27: a system escalation writes its dispute row with the trade (a trader's own
      // opening writes it through `within`, with the reason they gave).
      if (e.type === 'escalate' && next.state === 'disputed') await openSystemDispute(client, next, now);
      // C12b: a completed trade adds its take-time USD value to both sides' running totals; J-21: a
      // cancel of any kind adds one to the cancel figure of the side that ended it (idempotent per
      // trade; traders/tradedTotal.ts). A trade closed as `cancelled` pays nothing, so only the figure.
      // Owner 17 Nov 2026 (note #6 Q10): a trade that ends straight from setup, nothing funded, gives
      // back the one-time wallets it used up (wallet bookkeeping only; wallets/routes.ts). Never once
      // the trade got past setup or any XMR was seen. Before countCancel, which writes an account row.
      if (prev.state === 'setup' && next.state === 'cancelled' && next.receivedAtomic === 0n && next.fundingSeenAt === null) {
        await restoreOneTimeWallets(client, code, [next.sellerId, next.buyerId], now);
      }
      if (next.state !== prev.state && next.state === 'cancelled') await countCancel(client, code);
      if (next.state !== prev.state && (next.state === 'released' || next.state === 'refunded')) {
        await countTradeTotals(client, code);
        // R-011: a disputed trade that ends reversed (a decided dispute with no ruling follows the
        // trade's own end) loses its reviews here; disputes/store.ts saveDispute covers the rulings.
        await eraseReversedReviews(client, code);
        // Plan 4 Task 32: the 1% the settlement paid to the fee wallet goes into the aggregate
        // revenue ledger, once per trade; a cancel or a refund pays none (staff/revenue.ts).
        // A ruling's payout (Plan 4 Task 14, R-M2) names no settlement on the row: its own kind decides the fee.
        await bookTradeRevenue(client, code, e.type === 'settled' && isRulingKind(e.kind) ? e.kind : undefined);
      }
      // P5-A8: a release by the seller adds both sides' action times to their running lists (once; traders/actionTimes.ts).
      if (next.state !== prev.state && next.state === 'released') {
        await countActionTimes(client, code);
        // R-042: a payment sent in under half the time to pay counts toward the buyer's Fast badge (once).
        await countFastPayment(client, code);
      }
      // Lien recovery (owner 16 Nov 2026, docs/lien-recovery.md): a trade's reserved recovery is
      // recorded only once the completed-trade payout was seen on chain (`settled` into
      // `released`: rule 4, evidence before enforcement); any other end releases it.
      // Review M2: a refund seen on chain releases it; a cancel with an escrow keeps it while late
      // coins could still be ruled for the buyer.
      const recoveryLogs =
        next.state !== prev.state && CLOSED_STATES.includes(next.state)
          ? await settleRecovery(
              client,
              code,
              e.type === 'settled' ? (next.state === 'released' && (e.kind === 'release' || e.kind === 'dispute-buyer') ? 'completed' : 'refunded') : 'closed',
              next.escrowAddress !== null,
              now,
              next.receivedAtomic,
            )
          : [];
      if (within) await within(client, prev, next, now);
      // Plan 4 Task 3: one activity-log entry per stored event, in the same transaction. It is the
      // last statement before the commit (M2): the log lock serialises every append on the site,
      // so it is held only for the commit, never while `within` or anything else is awaited.
      const action = `trade.${e.type}` as const;
      await appendLog(client, { at: now, actor: actorOfBy(by), tradeCode: code, action, detail: tradeLogDetail(record, action) });
      for (const l of recoveryLogs) await appendLog(client, { at: now, actor: { kind: 'system' }, tradeCode: code, action: l.action, detail: l.detail });
      await client.query('commit');
    } catch (err) {
      await client.query('rollback');
      throw err;
    }
  } finally {
    client.release();
  }
  try {
    await (deps.publish ?? noPublish)(next, e, by);
  } catch {
    // Delivery is best-effort: the event is committed, and apps re-read the trade.
  }
  return next;
}
