import { addressEnd } from '@x2f/accounts';
import { apply, type By, type Trade, type TradeEvent, type TradeState } from '@x2f/trade';
import type pg from 'pg';
import type { Deps } from '../app.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';

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
}

/** A `trades` row as pg returns it: numeric columns arrive as strings. */
export interface TradeRow {
  code: string;
  offer_id: string;
  poster: 'seller' | 'buyer';
  seller_account_id: string;
  buyer_account_id: string;
  method_id: string;
  amount_atomic: string;
  fee_atomic: string;
  seller_funds_atomic: string;
  locked_currency: string;
  locked_cents_per_xmr: string;
  fiat_cents: string;
  confirm_window_min: number;
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
  lapsed_at: Date | null;
  secured_at: Date | null;
  pay_by: Date | null;
  extensions: number;
  paid_at: Date | null;
  confirm_by: Date | null;
  final_alert_at: Date | null;
  cancel_proposed_by: 'buyer' | 'seller' | null;
  settling: Trade['settling'];
  settle_from: TradeState | null;
  settle_by: Date | null;
  paused_at: Date | null;
  tx_hash: string | null;
  dispute_by: By | null;
  dispute_at: Date | null;
  closed_at: Date | null;
  buyer_payout: string | null;
  seller_refund: string | null;
  seller_wallet_app: string | null;
}

const big = (s: string): bigint => BigInt(s);
const bigOrNull = (s: string | null): bigint | null => (s === null ? null : BigInt(s));

export function rowToTrade(r: TradeRow): Trade {
  const grownFromAtomic = bigOrNull(r.grown_from_atomic);
  const grownFromFiat = bigOrNull(r.grown_from_fiat_cents);
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
    lockedRate: { currency: r.locked_currency, centsPerXmr: big(r.locked_cents_per_xmr) },
    fiatCents: big(r.fiat_cents),
    confirmWindowMin: r.confirm_window_min,
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
    lapsedAt: r.lapsed_at,
    securedAt: r.secured_at,
    payBy: r.pay_by,
    extensions: r.extensions,
    paidAt: r.paid_at,
    confirmBy: r.confirm_by,
    finalAlertAt: r.final_alert_at,
    cancelProposedBy: r.cancel_proposed_by,
    settling: r.settling,
    settleFrom: r.settle_from,
    settleBy: r.settle_by,
    pausedAt: r.paused_at,
    txHash: r.tx_hash,
    dispute: r.dispute_by !== null && r.dispute_at !== null ? { by: r.dispute_by, at: r.dispute_at } : null,
    closedAt: r.closed_at,
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
    ['lapsed_at', t.lapsedAt],
    ['secured_at', t.securedAt],
    ['pay_by', t.payBy],
    ['extensions', t.extensions],
    ['paid_at', t.paidAt],
    ['confirm_by', t.confirmBy],
    ['final_alert_at', t.finalAlertAt],
    ['cancel_proposed_by', t.cancelProposedBy],
    ['settling', t.settling],
    ['settle_from', t.settleFrom],
    ['settle_by', t.settleBy],
    ['paused_at', t.pausedAt],
    ['tx_hash', t.txHash],
    ['dispute_by', t.dispute?.by ?? null],
    ['dispute_at', t.dispute?.at ?? null],
    ['closed_at', t.closedAt],
  ];
}

/**
 * Inserts a new trade (Task 5's take, and tests). Fields fixed at take (offer, parties, method,
 * locked rate, confirm window, offer limits, taken_at) are written only here.
 */
export async function insertTrade(q: Queryable, t: Trade, sides: TradeSides): Promise<void> {
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
    ['min_fiat_cents', t.minFiatCents.toString()],
    ['max_fiat_cents', t.maxFiatCents.toString()],
    ['taken_at', t.takenAt],
    ...stateColumns(t),
    ['buyer_payout', sides.buyerPayout],
    ['seller_refund', sides.sellerRefund],
    ['seller_wallet_app', sides.sellerWalletApp],
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
  'release-started': {},
  settled: { kind: 'value', txHash: 'value' },
  'open-dispute': {},
  escalate: {},
  pause: {},
  resume: {},
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
 */
export async function applyEvent(deps: TradeDeps, code: string, e: TradeEvent, by: By): Promise<Trade> {
  const client: pg.PoolClient = await deps.db.connect();
  let next: Trade;
  try {
    await client.query('begin');
    try {
      const row = await loadTradeRow(client, code, true);
      if (!row) throw new ApiError(404, 'not-found');
      const now = deps.clock();
      const prev = rowToTrade(row);
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
      await client.query('insert into trade_events (code, at, by, event) values ($1, $2, $3, $4)', [
        code, now, by, JSON.stringify(eventRecord(e)),
      ]);
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
