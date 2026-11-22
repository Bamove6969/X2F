import { randomBytes } from 'node:crypto';
import { newTradeCode } from '@x2f/core';
import { newTrade, type By, type Trade, type TradeEvent, type TradeState } from '@x2f/trade';
import type { Deps } from '../../src/app.js';
import { insertReview } from '../../src/reviews/store.js';
import { applyEvent, insertTrade, type TradeSides } from '../../src/trades/store.js';
import { insertOffer } from './offers.js';

export const XMR = 1_000_000_000_000n;
/** 1.25 XMR at $330.00: fiat total $412.50, fee 0.0125 XMR. */
export const AMOUNT = 1_250_000_000_000n;
export const RATE = { currency: 'USD', centsPerXmr: 33_000n };
export const FIAT = 41_250n;

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** A made-up 95-character address-shaped string (never a real key). */
export function fakeAddress(): string {
  const bytes = randomBytes(95);
  let s = '5';
  for (let i = 1; i < 95; i++) s += BASE58[bytes[i]! % BASE58.length];
  return s;
}

export interface SeededTrade {
  code: string;
  trade: Trade;
  sides: TradeSides;
}

/**
 * Inserts an offer directly for `seedTrade` (trades.offer_id references offers, migration 112). It
 * is stored as removed, so it never shows in an offer list or a method count.
 */
export async function seedOffer(
  deps: Pick<Deps, 'db' | 'clock'>, posterId: string, poster: 'seller' | 'buyer',
  o: { methodId?: string; status?: 'live' | 'paused' | 'removed' } = {},
): Promise<string> {
  return insertOffer(deps.db, {
    accountId: posterId, side: poster === 'seller' ? 'sell' : 'buy', methodId: o.methodId ?? 'zelle', currency: 'USD', min: 1000, max: 100000,
    status: o.status ?? 'removed', at: deps.clock(),
  });
}

/**
 * Inserts a trade directly in `setup`, as the take route does (with both payout addresses set
 * unless given), on a fresh offer of its own unless `offerId` is given.
 */
export async function seedTrade(
  deps: Pick<Deps, 'db' | 'clock'>,
  a: {
    sellerId: string; buyerId: string; poster: 'seller' | 'buyer'; amountAtomic?: bigint; offerId?: string; methodId?: string; usdCents?: bigint;
    /** The offer's fiat limits in cents (default 1,000 to 100,000); a test of large or tiny amounts widens them. */
    minFiatCents?: bigint; maxFiatCents?: bigint;
    /** The trade's time to pay in minutes (default TIMERS.payMin, 90). */
    payWindowMin?: number;
    /** A fixed trade code (default a fresh random one), for a test that must read the same texts every run. */
    code?: string;
    /** The trade's locked currency (default RATE's USD), e.g. a RUB trade from before migration 770. */
    lockedCurrency?: string;
  } & Partial<TradeSides>,
): Promise<SeededTrade> {
  const offerId = a.offerId ?? (await seedOffer(deps, a.poster === 'seller' ? a.sellerId : a.buyerId, a.poster));
  const trade = newTrade(
    {
      code: a.code ?? newTradeCode(),
      offerId,
      poster: a.poster,
      sellerId: a.sellerId,
      buyerId: a.buyerId,
      methodId: a.methodId ?? 'zelle',
      amountAtomic: a.amountAtomic ?? AMOUNT,
      lockedRate: a.lockedCurrency === undefined ? RATE : { ...RATE, currency: a.lockedCurrency },
      confirmWindowMin: 120,
      ...(a.payWindowMin === undefined ? {} : { payWindowMin: a.payWindowMin }),
      minFiatCents: a.minFiatCents ?? 1_000n,
      maxFiatCents: a.maxFiatCents ?? 100_000n,
    },
    deps.clock(),
  );
  const sides: TradeSides = {
    buyerPayout: a.buyerPayout !== undefined ? a.buyerPayout : fakeAddress(),
    sellerRefund: a.sellerRefund !== undefined ? a.sellerRefund : fakeAddress(),
    sellerWalletApp: a.sellerWalletApp !== undefined ? a.sellerWalletApp : 'cake',
    ...(a.methodInstructions !== undefined ? { methodInstructions: a.methodInstructions } : {}),
  };
  await insertTrade(deps.db, trade, sides, a.usdCents ?? null);
  return { code: trade.code, trade, sides };
}

/** The events (and who sends them) that move a fresh trade along the happy path, one state at a time. */
export function happyPath(t: Trade, escrowAddress: string): { to: TradeState; e: TradeEvent; by: By }[] {
  const funds = t.sellerFundsAtomic;
  return [
    { to: 'funding', e: { type: 'setup-done', escrowAddress }, by: 'system' },
    { to: 'securing', e: { type: 'chain', receivedAtomic: funds, unlockedAtomic: 0n, confirmations: 1 }, by: 'system' },
    { to: 'secured', e: { type: 'chain', receivedAtomic: funds, unlockedAtomic: funds, confirmations: 10 }, by: 'system' },
    { to: 'paid', e: { type: 'mark-paid', fiatCents: t.fiatCents }, by: 'buyer' },
    { to: 'settling', e: { type: 'release-started' }, by: 'seller' },
    { to: 'released', e: { type: 'settled', kind: 'release', txHash: randomBytes(32).toString('hex') }, by: 'system' },
  ];
}

/** Applies the happy path through the store until the trade is in `state`. */
export async function driveTo(deps: Pick<Deps, 'db' | 'clock'>, t: Trade, state: TradeState, escrowAddress = fakeAddress()): Promise<Trade> {
  let cur = t;
  if (cur.state === state) return cur;
  for (const step of happyPath(t, escrowAddress)) {
    cur = await applyEvent(deps, t.code, step.e, step.by);
    if (step.to === state) return cur;
  }
  throw new Error(`happy path never reaches ${state}`);
}

/**
 * Plan 5 Task 3: both sides of an ended trade leave a Neutral review, so a history seeded for
 * stages or counts does not trip the rate-first gate (a reviewable, unrated trade blocks the take
 * and hides the poster's offers). Inserted directly, as the review route would.
 */
export async function seedReviews(deps: Pick<Deps, 'db' | 'clock'>, code: string): Promise<void> {
  const { rows } = await deps.db.query<{ buyer_account_id: string; seller_account_id: string; method_id: string }>(
    'select buyer_account_id, seller_account_id, method_id from trades where code = $1',
    [code],
  );
  const t = rows[0]!;
  const now = deps.clock();
  for (const [reviewerRole, reviewerId, subjectId] of [
    ['buyer', t.buyer_account_id, t.seller_account_id],
    ['seller', t.seller_account_id, t.buyer_account_id],
  ] as const) {
    await insertReview(deps.db, {
      tradeCode: code, reviewerId, subjectId, reviewerRole, input: { neutral: true },
      methodId: t.method_id, createdAt: now,
    });
  }
}
