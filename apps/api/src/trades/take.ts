import { newTradeCode, normalizeTradeCode } from '@x2f/core';
import {
  GIFT_CARD_TERMS_VERSION,
  LAUNCH_TRADE_CAP_USD_CENTS,
  fiatCents,
  newTrade,
  pickTier,
  posterRole,
  rangeAllows,
  tierRange,
  tierRate,
  tradeFiatLimits,
  type Price,
  type Side,
  type Tier,
} from '@x2f/trade';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { requireSession } from '../auth/sessions.js';
import { requireLiveSessionInTx, requireNotHeld } from '../auth/hold.js';
import { recoveryHoldHidesSql } from '../auth/holdSql.js';
import { linkChatToTrade } from '../chat/routes.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { auditMember } from '../team/audit.js';
import { ownerDeviceOnly } from '../team/perms.js';
import { acceptedEvent } from '../events/publicName.js';
import { isAvailable, isGiftCard, tradeProfile } from '../methods/profiles.js';
import { assertNoPendingReview, hasPendingReview } from '../reviews/gate.js';
import type { MarketPrices, MarketQuote } from '../price/market.js';
import { assertNotBlocked } from '../traders/blocks.js';
import { COMPLETED_TRADES_SQL, loadStarterSettings, tradeCap, usdCentsOf, type TradeCap } from '../traders/stage.js';
import { usableWallets, useUpOneTimeWallet, type Wallet } from '../wallets/routes.js';
import { assertWithinLaunchCap } from './launchCap.js';
import { insertTrade, loadTradeRow, rowToTrade, type TradeSides } from './store.js';
import { roleOf } from './view.js';
import { MARKET_PRICED, instructionsFor, loadFlex, tiersOf, type FlexMethod } from '../offers/routes.js';

/**
 * Plan 3 Task 5: taking an offer, and the poster's side of the new trade.
 *
 * - `POST /v1/offers/:id/take { amountAtomic, walletId, centsPerXmr, fiatCents, methodId, currency }`
 *   (`requireTrader`) → `{ code, centsPerXmr, fiatCents, maxFiatCents }` (`maxFiatCents`: the trade's
 *   growth ceiling, `growthCeiling`, the band's maximum clamped to the launch cap). The amount, the
 *   rates and the totals are decimal strings, the rates and totals in `currency`.
 *   Flexible offers (J-16, from claude2's Task 34): `currency` is one of the offer's currencies and
 *   `methodId` one of its methods offered in that currency (400 otherwise; owner: the buyer picks
 *   one, locked in). The band is chosen by @x2f/trade `pickTier`: that currency's bands holding the
 *   take (a fiat offer by the quoted total, an XMR offer by the amount) with this method, the best
 *   for the taker of those whose rule they meet (409 `out-of-range` when none holds it, 409
 *   `not-enough-trades` `{ minTrades }` when the taker meets none). The rate that locks is that band
 *   and method's final rate now (the currency's market + band margin + method adjustment), and the
 *   size must fit the band at that rate (409 `out-of-range`). The trade records the chosen currency
 *   and method, that method's instructions for that currency (`method_instructions`) and the band's
 *   fiat limits (the maximum clamped to the launch cap, owner p11-6: the trade's USD value, the
 *   larger of its total and its XMR at the market, is at most $5,000 for every stage).
 *   The client's rate and total are the ones the taker's quote showed; they are never locked (lead
 *   decision 2026-10-29, Task 5 review I2). The take always locks the server's own rate now
 *   (`offerRate`: the market plus the offer's margin) and that rate's total (OD-5), and answers
 *   with both so the device records the deal that locked; the client's rate only detects a move:
 *   past 0.5% of the server's → 409 `price-changed`. An offer stored as fixed before the owner's
 *   market-only rule (Q1) is not-found (offers/routes.ts MARKET_PRICED).
 *   So the taker gets the live price, within 0.5% of what they saw, and can never pick a better
 *   one. `walletId` is the taker's own: the buyer's payout wallet when the taker buys, the seller's
 *   refund and funding wallet when the taker sells. The trade starts in `setup` with the poster's
 *   side unset.
 * - `POST /v1/trades/:code/wallet { walletId }` (the poster only, in `setup`, once) → 204: the
 *   poster's side, from the "accepted your offer" sheet (Task 19).
 *
 * The deal and the payout and refund addresses never change once written (a trigger in 112_take.sql
 * refuses it for every role; only the retention purge may null an address, after close): Task 8
 * attests them, and both trader devices check the attested deal and addresses against what their
 * user confirmed.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ATOMIC = /^[1-9][0-9]{0,29}$/;
const PRICE = /^[1-9][0-9]{0,19}$/;
const CENTS = /^[1-9][0-9]{0,17}$/;
/** The largest move of a market offer's rate between the quote and the take: 0.5% (5 per mille). */
const TOLERANCE_PER_MILLE = 5n;

const bad = (): ApiError => new ApiError(400, 'bad-request');
const notFound = (): ApiError => new ApiError(404, 'not-found');

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

interface TakeBody {
  amountAtomic: bigint;
  walletId: string;
  centsPerXmr: bigint;
  fiatCents: bigint;
  /** The gift-card terms version the taker ticked (J-17, F13); only on a gift-card offer. */
  giftCardTerms: unknown;
  methodId: string;
  currency: string;
}

function parseTake(body: unknown): TakeBody {
  if (!isObject(body)) throw bad();
  const keys = Object.keys(body).filter((k) => k !== 'giftCardTerms').sort().join(',');
  if (keys !== 'amountAtomic,centsPerXmr,currency,fiatCents,methodId,walletId') throw bad();
  const { amountAtomic, walletId, centsPerXmr, fiatCents: cents, methodId, currency, giftCardTerms } = body;
  if (typeof methodId !== 'string' || methodId.length === 0 || methodId.length > 64) throw bad();
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) throw bad();
  if (typeof amountAtomic !== 'string' || !ATOMIC.test(amountAtomic)) throw bad();
  if (typeof walletId !== 'string' || !UUID.test(walletId)) throw bad();
  if (typeof centsPerXmr !== 'string' || !PRICE.test(centsPerXmr)) throw bad();
  if (typeof cents !== 'string' || !CENTS.test(cents)) throw bad();
  return { amountAtomic: BigInt(amountAtomic), walletId, centsPerXmr: BigInt(centsPerXmr), fiatCents: BigInt(cents), methodId, currency, giftCardTerms };
}

function parseWalletBody(body: unknown): string {
  if (!isObject(body) || Object.keys(body).length !== 1) throw bad();
  const id = body.walletId;
  if (typeof id !== 'string' || !UUID.test(id)) throw bad();
  return id;
}

/**
 * The account's usable wallet `walletId`: 409 `no-wallet` when it has no usable wallet at all
 * (spec 6.4), 409 `wallet-not-ready` when `walletId` is not one of them (still waiting, removed,
 * or not this account's).
 */
async function pickWallet(db: Queryable, accountId: string, walletId: string, now: Date): Promise<Wallet> {
  const usable = await usableWallets(db, accountId, now);
  if (usable.length === 0) throw new ApiError(409, 'no-wallet');
  const w = usable.find((x) => x.id === walletId);
  if (!w) throw new ApiError(409, 'wallet-not-ready');
  return w;
}

interface OfferRow {
  account_id: string;
  side: Side;
  /** The unit every band is in (migration 324; one per offer). */
  amount_unit: 'xmr' | 'fiat';
  status: 'live' | 'paused' | 'removed';
  /** The poster may be seen: a trader, not disabled, with no trading hold and no recovery-code hold (Task 4's LISTED). */
  poster_ok: boolean;
}

const OFFER_SQL = `select o.account_id, o.side, o.amount_unit, o.status,
    (a.kind = 'trader' and a.disabled_at is null
      and not exists (select 1 from trading_holds h where h.account_id = o.account_id and h.lifted_at is null)
      and not ${recoveryHoldHidesSql('o.account_id')}) as poster_ok
  from offers o join accounts a on a.id = o.account_id where o.id = $1 and ${MARKET_PRICED}`;

/**
 * The rate that locks: always the band and method's rate now in the chosen currency (`tierRate`),
 * never the client's (lead decision 2026-10-29). The client's quoted rate only detects a move: 409
 * `price-changed` when it differs from the rate now by more than 0.5%. 409 `price-unavailable` while
 * the currency has no market price: every offer is market-priced (owner Q1, F1), so no offer can be
 * taken without a price.
 */
function lockRate(currency: string, tier: Tier, method: FlexMethod, quoted: bigint, prices: MarketPrices): Price {
  const now = tierRate(currency, tier, method, prices.current(currency));
  if (now === null) throw new ApiError(409, 'price-unavailable');
  const diff = quoted > now.centsPerXmr ? quoted - now.centsPerXmr : now.centsPerXmr - quoted;
  if (diff * 1000n > now.centsPerXmr * TOLERANCE_PER_MILLE) throw new ApiError(409, 'price-changed');
  return now;
}

/**
 * What the trade counts against the starter caps, in US cents: the larger of its fiat total and its
 * XMR amount valued at the live market price (lead decision 2026-10-29, Task 5 review M5), so an
 * offer priced below the market (down to −50%) cannot move more XMR inside a cap. Both convert with `usdCentsOf`
 * at the market quote, exactly as Task 4's `opensAt` converts an offer's minimum (Task 4 review
 * M8), at the market quote `q` (the take has none to value the XMR with: no value, fails closed).
 */
function usdValue(currency: string, q: MarketQuote, amountAtomic: bigint, cents: bigint): bigint {
  const usd = (c: bigint): bigint => (currency === 'USD' ? c : usdCentsOf(c, { centsPerXmr: q.price.centsPerXmr, usdCentsPerXmr: q.usdCentsPerXmr }));
  const total = usd(cents);
  const market = usd(fiatCents(amountAtomic, q.price));
  return total > market ? total : market;
}

/**
 * The trade's growth ceiling, its `maxFiatCents` (launch-rules review F1): the largest fiat total,
 * at the locked rate, that extra XMR sent before "I've paid" may grow the trade to (machine.ts
 * `grow`, and both devices' `deviceAmount`). It is the lower of the offer's maximum and the
 * largest total whose every amount is within the launch cap by the take's own rule (`usdValue`:
 * the larger of the fiat total and the XMR at the market price, at the take's quote, rounded up).
 * So growth never takes a trade past $5,000 at the take's prices, however the offer was posted
 * (before the cap, relisted, a non-USD band after a rate move, a margin far below market).
 *
 * Worked out on amounts: `atCap` is the largest XMR amount within the cap (the value only rises
 * with the amount), and the ceiling is the largest total that no larger amount reaches. Never below
 * the take's own total, which the take has already checked against the cap: only when the next
 * amount past `atCap` rounds to that same total (a rate far below market) can that floor
 * apply, and it then lets the trade grow by less than one cent at the locked rate.
 */
function growthCeiling(
  currency: string,
  q: MarketQuote,
  rate: Price,
  a: { amountAtomic: bigint; totalCents: bigint; offerMaxCents: bigint },
): bigint {
  const within = (x: bigint): boolean => usdValue(currency, q, x, fiatCents(x, rate)) <= LAUNCH_TRADE_CAP_USD_CENTS;
  // The take amount is within the cap; find an amount above it, then the last one within.
  let lo = a.amountAtomic;
  let hi = lo * 2n;
  while (within(hi)) [lo, hi] = [hi, hi * 2n];
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n;
    if (within(mid)) lo = mid;
    else hi = mid;
  }
  const atCap = fiatCents(lo + 1n, rate) - 1n;
  const ceiling = atCap < a.offerMaxCents ? atCap : a.offerMaxCents;
  return ceiling < a.totalCents ? a.totalCents : ceiling;
}

async function openTrades(db: Queryable, accountId: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from trades where (seller_account_id = $1 or buyer_account_id = $1) and closed_at is null`,
    [accountId],
  );
  return rows[0]!.n;
}

/**
 * Both sides' starter limits (Revision 2026-10-24): the trade's USD equivalent within each side's
 * cap, and a Starter side below its open-trade limit. A refusal (409 `starter-limit`) names only
 * the caller's own stage and limit. The poster's cap gives `starter-limit` with nothing (their stage
 * is public on the card); the poster's open-trade count gives a generic 409 `offer-busy` ("this
 * offer can't take more trades right now"), so the taker learns nothing of how many trades the
 * poster has open (Task 5 review M6).
 */
async function checkStarterLimits(db: Queryable, a: { takerId: string; posterId: string; usd: () => bigint | null; now: Date }): Promise<void> {
  const settings = await loadStarterSettings(db);
  const caps: [TradeCap, string, boolean][] = [
    [await tradeCap(db, a.takerId, a.now, settings), a.takerId, true],
    [await tradeCap(db, a.posterId, a.now, settings), a.posterId, false],
  ];
  if (caps.some(([c]) => c.capUsdCents !== null)) {
    const usd = a.usd();
    // No price to count the cap with: fail closed.
    if (usd === null) throw new ApiError(409, 'price-unavailable');
    for (const [c, , own] of caps) {
      if (c.capUsdCents !== null && usd > c.capUsdCents) {
        throw new ApiError(409, 'starter-limit', own ? { stage: c.stage, capUsdCents: c.capUsdCents.toString() } : {});
      }
    }
  }
  for (const [c, id, own] of caps) {
    if (c.maxOpen !== null && (await openTrades(db, id)) >= c.maxOpen) {
      throw own ? new ApiError(409, 'starter-limit', { stage: c.stage, maxOpen: c.maxOpen }) : new ApiError(409, 'offer-busy');
    }
  }
}

async function inTransaction<T>(db: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('begin');
    try {
      const out = await fn(client);
      await client.query('commit');
      return out;
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
  } finally {
    client.release();
  }
}

/** A unique-index refusal of the trade insert, as the take's 409 (the race backstop of both limits). */
function raceRefusal(e: unknown): ApiError | null {
  const err = e as { code?: unknown; constraint?: unknown } | null;
  if (err?.code !== '23505') return null;
  if (err.constraint === 'trades_waiting_per_buyer') return new ApiError(409, 'already-waiting');
  if (err.constraint === 'trades_waiting_per_amount') return new ApiError(409, 'ad-busy');
  return null;
}

// The account owner; a team member with Trades passes the gate but `ownerDeviceOnly` then refuses
// them (403 member-cannot-sign) until Plan 3 Task 42 (Plan 2 Task 18 review I2).
// Job 1c: the Take and Accept boxes wait for member keys (`ownerDeviceOnly` refuses every member).
const requireTrader = [requireSession({ kinds: ['trader'], member: ['trades-take', 'trades-accept'] }), ownerDeviceOnly];

export function takeRoutes(app: FastifyInstance): void {
  app.post('/v1/offers/:id/take', { preHandler: [...requireTrader, requireNotHeld] }, async (req) => {
    const deps = req.server.deps;
    const id = (req.params as { id: string }).id;
    if (!UUID.test(id)) throw notFound();
    const b = parseTake(req.body);
    const takerId = req.auth.accountId;

    // Who posted it, to lock both accounts in a fixed order before anything is read for good.
    const first = (await deps.db.query<OfferRow>(OFFER_SQL, [id])).rows[0];
    if (!first) throw notFound();
    const posterId = first.account_id;

    const trade = await inTransaction(deps.db, async (c) => {
      // Both accounts, in id order (no deadlock between two takes): every take involving either
      // account waits here, so the Starter open-trade count and both waiting limits are read and
      // written by one take at a time. `for update`, as Task 4's assertMayPost: a trading hold
      // inserted for either account (its foreign key takes `for key share`) waits until this take
      // commits, so a hold can never land between the hold check below and the trade insert
      // (Task 5 review M1).
      await c.query('select id from accounts where id = any($1) order by id for update', [[takerId, posterId]]);
      // Tasks 16-17 review round 5 M2: the taker's session must still be live under that lock (a
      // take in flight across the owner's proof or a logout starts no trade; 401).
      await requireLiveSessionInTx(c, req.auth, deps.clock());
      // The offer, locked against a pause or removal (PATCH) until this take commits, and read
      // again with the poster's hold and the site pause inside the transaction (Task 4 review M1).
      const r = (await c.query<OfferRow>(`${OFFER_SQL} for share of o`, [id])).rows[0];
      if (!r || r.status !== 'live' || !r.poster_ok) throw notFound();
      // Blocked either way: as if the offer did not exist, before any refusal that shows it does.
      await assertNotBlocked(c, takerId, posterId);
      // The chosen currency must be one of the offer's and the chosen method one of its methods
      // offered in that currency (currencies, bands and methods never change after post, and the
      // offer row is locked above).
      const flex = (await loadFlex(c, [id])).get(id)!;
      const tiers = tiersOf(flex, b.currency);
      const method = flex.methods.find((m) => m.methodId === b.methodId);
      if (tiers === null || method === undefined || !method.currencies.includes(b.currency)) throw bad();
      if (!isAvailable(method.methodId)) throw new ApiError(409, 'method-unavailable');
      // J-17 (F13): a gift-card take (the chosen method is a gift card) carries the version of the
      // terms the taker ticked, the one the API has now (a page showing older words cannot agree to
      // these); any other take carries none.
      const giftCardTerms = isGiftCard(method.methodId) ? GIFT_CARD_TERMS_VERSION : null;
      if (b.giftCardTerms !== (giftCardTerms ?? undefined)) throw bad();
      if (posterId === takerId) throw new ApiError(409, 'own-offer');
      const now = deps.clock();
      const flags = (
        await c.query<{ paused: boolean | null; held: boolean }>(
          `select (select trading_paused from site_flags for share) as paused,
                  exists (select 1 from trading_holds where account_id = $1 and lifted_at is null) as held`,
          [takerId],
        )
      ).rows[0]!;
      // No site_flags row fails closed.
      if (flags.paused !== false) throw new ApiError(409, 'trading-paused');
      if (flags.held) throw new ApiError(409, 'trading-hold');
      // Plan 5 Task 3, the rate-first gate (spec 5.1, P5-A4), for both sides, under the account locks
      // above (a review submitted meanwhile is seen at the next take). The taker's own pending review
      // is named (409 `review-pending`); the poster's is the generic `offer-busy`, so a taker learns
      // nothing of the poster's account (as Task 5 review M6 does for the poster's open trades). The
      // offer lists already leave such a poster's offers out.
      await assertNoPendingReview(c, takerId, now);
      if (await hasPendingReview(c, posterId, now)) throw new ApiError(409, 'offer-busy');
      const wallet = await pickWallet(c, takerId, b.walletId, now);
      const completed = (
        await c.query<{ n: number }>(`select ${COMPLETED_TRADES_SQL}::int as n from accounts a where a.id = $1`, [takerId])
      ).rows[0]!.n;

      // The client's total must be its amount at its rate, as the quote works it out.
      if (fiatCents(b.amountAtomic, { currency: b.currency, centsPerXmr: b.centsPerXmr }) !== b.fiatCents) throw bad();
      // The band: that currency's bands holding the take with this method, the best for the taker
      // of those whose rule they meet (the rule goes with the refusal, Task 34 review I2).
      const pick = pickTier(tiers, r.amount_unit, b, method.methodId, r.side, completed);
      if ('refused' in pick) {
        throw pick.refused === 'out-of-range' ? new ApiError(409, 'out-of-range') : new ApiError(409, 'not-enough-trades', { minTrades: pick.minTrades });
      }
      // The rate that locks is this band's (lockRate), never the client's; the quoted rate only
      // detects a move past the 0.5% tolerance. So when two bands holding the take are priced within
      // 0.5% of each other (say +2.0% for anyone and +1.7% for 5 trades) and the quote came from the
      // band this taker does not qualify for (a stale viewerTrades on the card, or a trade count that
      // changed between the list and the take), the take is not refused: it goes through at the band
      // they do qualify for, up to 0.5% from the rate shown, and the answer below carries the rate
      // that locked (flex-offers review M2). Bands further apart refuse with `price-changed`, so a
      // quote from a better band never locks that band either way.
      const rate = lockRate(b.currency, pick.tier, method, b.centsPerXmr, deps.prices);
      const total = fiatCents(b.amountAtomic, rate);
      // The size in the poster's unit (owner, 8 Nov): an XMR band compares the amount, a fiat band
      // its total, both at the rate that locks (the margin and adjustment included).
      const range = tierRange(r.amount_unit, pick.tier);
      if (rangeAllows(range, b.amountAtomic, rate) !== 'ok') throw new ApiError(409, 'out-of-range');
      // The fiat limits the trade keeps (an XMR range's at the locked rate), for its growth cap.
      const limits = tradeFiatLimits(range, rate);
      // The trade's USD value, counted against the caps and kept (301) to weigh its reviews (Plan 5 Task 3).
      // One quote (the chosen currency's) for the value and the growth ceiling below, so both judge
      // the cap at the same price. lockRate already failed closed without one.
      const q = deps.prices.quote(b.currency);
      const usd = q === null ? null : usdValue(b.currency, q, b.amountAtomic, total);
      await checkStarterLimits(c, { takerId, posterId, usd: () => usd, now });
      // The launch cap (owner p11-6) for every stage, Graduated too: the same USD value, and no
      // price to count it with fails closed. After the starter caps, which are lower and say more.
      assertWithinLaunchCap(usd);
      // How far extra XMR may grow it before "I've paid": the band's maximum, clamped to the cap (F1).
      const maxFiatCents = growthCeiling(b.currency, q!, rate, {
        amountAtomic: b.amountAtomic, totalCents: total, offerMaxCents: limits.maxFiatCents,
      });

      const poster = posterRole(r.side);
      // The chosen method's confirm window (its own, a gift card's, or the Custom method's: owner
      // F9, G50) and time to pay, fixed on the trade here (owner p9-4, p9-6).
      const profile = tradeProfile(method.methodId);
      const t = newTrade(
        {
          code: newTradeCode(),
          offerId: id,
          poster,
          sellerId: poster === 'seller' ? posterId : takerId,
          buyerId: poster === 'buyer' ? posterId : takerId,
          methodId: method.methodId,
          amountAtomic: b.amountAtomic,
          lockedRate: rate,
          confirmWindowMin: profile.confirmWindowMin,
          payWindowMin: profile.payWindowMin,
          minFiatCents: limits.minFiatCents,
          maxFiatCents,
        },
        now,
      );
      // The taker's side now; the poster's from the accepted sheet. The method's instructions for the
      // chosen currency (its own where they differ, owner Q3) are locked with the trade.
      const methodInstructions = instructionsFor(method, b.currency);
      const sides: TradeSides =
        poster === 'seller'
          ? { buyerPayout: wallet.address, sellerRefund: null, sellerWalletApp: null, methodInstructions }
          : { buyerPayout: null, sellerRefund: wallet.address, sellerWalletApp: wallet.app, methodInstructions };
      try {
        await insertTrade(c, t, sides, usd, giftCardTerms);
      } catch (e) {
        const refusal = raceRefusal(e);
        if (refusal) throw refusal;
        throw e;
      }
      // Owner demo note #6: a one-time wallet is for this trade only (under the taker's account lock above).
      await useUpOneTimeWallet(c, takerId, wallet.id, t.code, now);
      // "A take reuses the chat" (Task 20): the pair's open pre-trade chat on this offer becomes the trade's.
      await linkChatToTrade(c, { offerId: id, buyerAccountId: t.buyerId, sellerAccountId: t.sellerId, tradeCode: t.code });
      // Task 18: a team member's take is in the account owner's audit log, in this transaction
      // (unreachable until Task 42 lifts `ownerDeviceOnly`; kept so the log is complete then).
      await auditMember(c, req.auth, { action: 'trade-taken', tradeCode: t.code, detail: { offerId: id } }, now);
      return t;
    });

    // "<display name> accepted your offer" to the poster, after the commit and outside the
    // response (as tradeRoutes delivers): their open streams, else the generic trade push.
    setImmediate(() => {
      void (async () => {
        const ev = await acceptedEvent(deps.db, trade.code, takerId);
        if (app.events.publish(posterId, ev) === 0) await app.push.send(posterId, 'trade');
      })().catch((err: unknown) => app.log.error({ err }, 'accepted publish failed'));
    });
    return {
      code: trade.code, centsPerXmr: trade.lockedRate.centsPerXmr.toString(), fiatCents: trade.fiatCents.toString(),
      maxFiatCents: trade.maxFiatCents.toString(),
    };
  });

  app.post('/v1/trades/:code/wallet', { preHandler: requireTrader }, async (req, reply) => {
    const deps = req.server.deps;
    const walletId = parseWalletBody(req.body);
    const raw = (req.params as { code?: unknown }).code;
    const code = typeof raw === 'string' ? normalizeTradeCode(raw) : null;
    if (code === null) throw notFound();
    const me = req.auth.accountId;
    // One transaction (Task 5 review M4): the trade row first, then the poster's account (`for
    // update`, so a trading hold inserted meanwhile waits; trade before account, the order a
    // dispute takes when it places a hold), then the wallet (`for share`, so it cannot be removed
    // before the write). Everything is checked again under those locks.
    await inTransaction(deps.db, async (c) => {
      const row = await loadTradeRow(c, code, true);
      if (!row) throw notFound();
      const t = rowToTrade(row);
      const role = roleOf(t, me);
      if (role === null) throw notFound();
      if (role !== t.poster) throw new ApiError(409, 'wrong-party');
      const now = deps.clock();
      const set = role === 'seller' ? row.seller_refund : row.buyer_payout;
      // Past setup_by the timer is about to cancel the trade: too late to set it up.
      if (t.state !== 'setup' || set !== null || (t.setupBy !== null && now.getTime() > t.setupBy.getTime())) {
        throw new ApiError(409, 'wrong-state');
      }
      await c.query('select id from accounts where id = $1 for update', [me]);
      const held = await c.query('select 1 from trading_holds where account_id = $1 and lifted_at is null', [me]);
      if ((held.rowCount ?? 0) > 0) throw new ApiError(409, 'trading-hold');
      // Plan 5 Task 3: the poster rates their last trade before setting up a new one (P5-A4).
      await assertNoPendingReview(c, me, now);
      await c.query('select id from wallets where id = $1 and account_id = $2 for share', [walletId, me]);
      const w = await pickWallet(c, me, walletId, now);
      // Once only, and only while in setup: the conditions stay in the UPDATE too.
      const r =
        role === 'seller'
          ? await c.query(
              `update trades set seller_refund = $3, seller_wallet_app = $4
                where code = $1 and seller_account_id = $2 and poster = 'seller' and state = 'setup' and seller_refund is null`,
              [code, me, w.address, w.app],
            )
          : await c.query(
              `update trades set buyer_payout = $3
                where code = $1 and buyer_account_id = $2 and poster = 'buyer' and state = 'setup' and buyer_payout is null`,
              [code, me, w.address],
            );
      if ((r.rowCount ?? 0) === 0) throw new ApiError(409, 'wrong-state');
      // Owner demo note #6: a one-time wallet is for this trade only (under the poster's account lock above).
      await useUpOneTimeWallet(c, me, w.id, code, now);
      await auditMember(c, req.auth, { action: 'trade-wallet-set', tradeCode: code, detail: { walletId } }, now);
    });
    return reply.code(204).send();
  });
}
