import {
  BAND_DIFFER_DEFAULT,
  GIFT_CARD_TERMS_VERSION,
  MAX_CURRENCIES,
  MAX_MARGIN_BPS,
  MAX_METHODS,
  adjustAllowed,
  atomicForFiat,
  bandsToTiers,
  checkBands,
  fiatCents,
  giftCardCurrencyOk,
  headlineTier,
  rangeInBoth,
  tierHolds,
  tierRange,
  tierRate,
  type AmountUnit,
  type Band,
  type BandDifference,
  type MinTrades,
  type Price,
  type Side,
  type Tier,
} from '@x2f/trade';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Deps } from '../app.js';
import { requireInside } from '../auth/frontDoor.js';
import { requireSession } from '../auth/sessions.js';
import { holdRefusal, holdUntil, requireLiveSessionInTx, requireNotHeld } from '../auth/hold.js';
import { recoveryHoldHidesSql } from '../auth/holdSql.js';
import { ACTIVE_LIEN_SQL, hasActiveLien } from '../disputes/lien.js';
import type { AuthContext } from '../auth/sessions.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { auditMember } from '../team/audit.js';
import { assertMemberMay } from '../team/perms.js';
import { memberBand, offerInsideBand } from '../team/limits.js';
import { getMethod, isAvailable, isGiftCard, tradeProfile } from '../methods/profiles.js';
import type { LiveOfferStats } from '../methods/routes.js';
import { currencyExponent } from '../price/currencies.js';
import type { MarketPrices } from '../price/market.js';
import { offerLaunchCapRefusal, throwLaunchCapRefusal } from '../trades/launchCap.js';
import { largestAtomicWithin, largestTotalWithin } from '../trades/capValue.js';
import { blockedEitherWaySql } from '../traders/blocks.js';
import { COMPLETED_TRADES_SQL, loadStarterSettings, opensAt, tradeCap, usdCentsOf, type StarterSettings, type TradeCap } from '../traders/stage.js';
import { hasPendingReview, pendingReviewSql } from '../reviews/gate.js';
import { lastSeenSql, onlineSince, traderSummaries, type TraderSummary } from '../traders/summary.js';
import { usableWallets } from '../wallets/routes.js';
import { accountTypeOf, assertVendor } from '../routes/accountType.js';

/**
 * Plan 3 Task 4: offers (ads); Tasks 34/35 (J-16): flexible offers.
 *
 * - `POST /v1/offers` (`requireTrader`) → 201 `{ id }`. Only a vendor account posts or turns on
 *   offers (owner 2 Nov 2026; 403 `not-vendor`, routes/accountType.ts).
 * - `PATCH /v1/offers/:id { status }` (the poster only) → `{ id, status }`.
 * - `GET /v1/offers?side&method&currency[&amount][&sort=best|online|trades]` (no session, P3-M9) → `OfferCard[]`.
 * - `GET /v1/offers/:id[?currency][&method][&amount]` (no session) → `OfferDetail`; a paused offer only to its poster.
 * - Task 36: `GET /v1/account/offers` (`requireTrader`) → `MyOffer[]`, and
 *   `POST /v1/account/offers/status { ids: string[] | 'all', status }` → per-offer results.
 *
 * A signed-in trader never sees the offers of someone they blocked or who blocked them (Task 37,
 * traders/blocks.ts): the list leaves them out and the single-offer route answers 404.
 *
 * `side` is the ads' own side, what the poster does with XMR: someone buying XMR browses
 * `side=sell`. Amounts and prices are decimal strings (bigints), fiat in the currency's minor units.
 *
 * Flexible offers (J-16, rebuilt from claude2's Task 34; @x2f/trade flexOffer.ts; migration 490):
 * an offer lists up to 5 currencies (`offer_currencies`), each with up to 3 price bands
 * (`offer_tiers`), and up to 5 payment methods (`offer_methods`), each offered in some or all of
 * those currencies with instructions per method and, where they differ, per currency
 * (`offer_method_currencies`). `POST` takes `{ side, amountUnit?, currencies, methods, terms,
 * country?, giftCardTerms? }` only: the old single-method shape is 400 (Task 34 review M1). Pricing
 * is market ± X% only (owner Q1): a band's margin plus the method's adjustment. A gift-card method
 * among the methods (J-17) needs the card's `country` and the `giftCardTerms` version, and may be
 * offered only in a currency of that country (T-081; lead ruling 10 Nov 2026).
 *
 * Trade size (owner, 8 Nov 2026, "Offer amounts in XMR or fiat"): one unit per offer, `amountUnit`
 * 'fiat' (the default) or 'xmr'; every band is in it. A card carries its currency's envelope (the
 * lowest band start to the highest band end) in both units: the poster's own exactly, the other
 * converted at the card's rate (@x2f/trade `rangeInBoth`), or null without a rate.
 *
 * Browsing filters by currency and method (owner 2 Nov). An offer is listed under a currency only
 * while that currency has a market price (owner Q5); the currency list itself (`GET
 * /v1/currencies`) keeps such a currency, marked unavailable (owner Q24). A card's `rate` is the
 * final rate for the card's currency, method and `amount` (fiat minor units; null when no band holds
 * it), else the best band the viewer qualifies for (Task 34 review M5).
 */

export interface OfferCard {
  id: string;
  poster: TraderSummary;
  /** The currency this card is in (the filtered one): its rate, bands and methods. */
  currency: string;
  /** Every currency of the offer, in the poster's order. */
  currencies: string[];
  /** The final price per XMR now for the card's currency, method and amount; null without a market price, and for an amount no band holds. */
  rate: string | null;
  /** The band's margin + the method's adjustment (market ± X% only, owner Q1, F1). */
  pricing: { mode: 'market'; marginBps: number };
  /** The unit the poster set the bands in; that pair is exact, the other is converted (see above). */
  amountUnit: AmountUnit;
  minAtomic: string | null;
  maxAtomic: string | null;
  minFiatCents: string | null;
  maxFiatCents: string | null;
  /** The lowest band rule of this currency: 5, 10, 25 or 50, or null for no minimum (owner, 8 Nov). */
  minTrades: MinTrades;
  /** This currency's bands as covered ranges in `amountUnit`'s minor units, by start. */
  tiers: Tier[];
  /** The methods offered in this currency, in the poster's order; `instructions` (this currency's) only on the poster's own offer. */
  methods: CardMethod[];
  /** Gift-card offers only: the card's country, ISO 3166-1 alpha-2 (Revision 2026-10-27). */
  country?: string;
  /**
   * For a signed-in trader whose starter-limit cap is below the offer's minimum: the stage that
   * opens it (Revision 2026-10-24). Absent otherwise, and while the currency has no market price
   * to convert the minimum to US dollars (the take checks the cap again).
   */
  opensAt?: 'building' | 'graduated';
  /**
   * For a signed-in trader on the list: their own completed trades, the count the take picks the
   * band by (@x2f/trade pickTier), so the quote prices the same band (J-16). Absent signed out.
   */
  viewerTrades?: number;
}

/** A method on a card: public without its instructions (the payment details); the poster sees them on their own offer. */
export interface CardMethod {
  methodId: string;
  adjustBps: number;
  instructions?: string;
}

export interface OfferDetail extends OfferCard {
  side: Side;
  /** The method `rate` and `pricing` are for: the `method` asked for, else the first one shown. */
  methodId: string;
  terms: string;
  status: OfferStatus;
}

export type OfferStatus = 'live' | 'paused' | 'removed';

/** One of my offers on `GET /v1/account/offers` (Task 36): live or paused, never removed. */
export interface MyOffer {
  id: string;
  side: Side;
  /** The offer's first method (position 0); every method is in `methods`. */
  methodId: string;
  /** The catalog's name for the method (the id when the catalog no longer has it). */
  methodName: string;
  /** The offer's first currency (position 0); every currency is in `currencies`. */
  currency: string;
  /** The price per XMR now in the first currency, for the first method offered in it and its best band; null without a market price. */
  rate: string | null;
  pricing: OfferCard['pricing'];
  amountUnit: AmountUnit;
  minAtomic: string | null;
  maxAtomic: string | null;
  minFiatCents: string | null;
  maxFiatCents: string | null;
  minTrades: MinTrades;
  /** The first currency's bands; the fields above are their envelope. */
  tiers: Tier[];
  /** Every currency in the poster's order, each priced as `rate` is. */
  currencies: MyOfferCurrency[];
  /** Every method in the poster's order, with its instructions (these are my own offers). */
  methods: MyOfferMethod[];
  country?: string;
  status: 'live' | 'paused';
  /** The buyer's time to pay with the offer's first method, in minutes (owner p9-6), as a take fixes it; each method's own is in `methods`. */
  payWindowMin: number;
  /**
   * A live offer that nobody can see right now, and why (review M4): the site's emergency stop,
   * the account's trading hold or active lien (Task 25), a trade it has not rated yet (Plan 5 Task 3, P5-A4), every one of its
   * methods under legal review, or none of its currencies with a market price now (Task 34 review
   * M4). Absent when the offer is listed or paused.
   */
  hidden?: 'trading-paused' | 'trading-hold' | 'lien' | 'recovery-hold' | 'review-pending' | 'method-unavailable' | 'no-price';
  createdAt: string;
}

/** One currency of one of my offers: its rate now (best band, first method in it) and its bands. */
export interface MyOfferCurrency {
  currency: string;
  rate: string | null;
  tiers: Tier[];
}

/** One method of one of my offers, as posted: shared instructions, its currencies and the per-currency texts. */
export interface MyOfferMethod {
  methodId: string;
  /** The catalog's name for the method (the id when the catalog no longer has it), as `MyOffer.methodName`. */
  methodName: string;
  adjustBps: number;
  instructions: string;
  currencies: string[];
  instructionsByCurrency: Record<string, string>;
  /** The buyer's time to pay with this method, in minutes (owner p9-6), as a take fixes it. */
  payWindowMin: number;
}

/**
 * Why one offer was not switched by `POST /v1/account/offers/status`: the posting guards of
 * relisting (`not-vendor`, `trading-paused`, `trading-hold`, `lien`, `no-wallet`, `too-many-offers`, `method-unavailable`,
 * and the launch cap's `launch-cap`, or `price-unavailable` when none of the offer's currencies has
 * a price to count its bands with), a team member's `outside-trade-band` (J-20 review F2: turning on
 * an offer outside their band; turning off is never banded), or `not-found` for an id that is not
 * one of my live or paused offers.
 */
export type OfferSwitchRefusal =
  | 'not-vendor' | 'trading-paused' | 'trading-hold' | 'lien' | 'no-wallet' | 'too-many-offers' | 'method-unavailable' | 'launch-cap' | 'price-unavailable'
  | 'outside-trade-band' | 'not-found';

/** One offer's outcome: its status after the call, and why it was not switched when it was refused. */
export interface OfferSwitchResult {
  id: string;
  /** Absent for `not-found`. */
  status?: 'live' | 'paused';
  refused?: OfferSwitchRefusal;
}

/** At most this many ids in one `POST /v1/account/offers/status` (the caps keep an account far below it). */
export const SWITCH_MAX_IDS = 100;

const SORTS = ['best', 'online', 'trades'] as const;
type Sort = (typeof SORTS)[number];
const CURRENCY = /^[A-Z]{3}$/;
/** "Minimum completed trades" (owner, 8 Nov: "5, 10, 25, 50"); null is no minimum. */
export { BAND_MIN_TRADES as MIN_TRADES_CHOICES } from '@x2f/trade';
export type { MinTrades } from '@x2f/trade';
/** A method's instructions: at most this many characters, refused characters as for terms (BAD_TERMS_CHAR). */
export const INSTRUCTIONS_MAX = 1000;
const STATUSES = ['live', 'paused', 'removed'] as const;
export const TERMS_MAX = 4000;
/**
 * A fiat amount query: at most 15 digits of minor units, the most a band can reach (12 whole digits
 * of a 3-decimal currency such as KWD, Task 34 review M2).
 */
const FIAT = /^\d{1,15}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/**
 * Refused in terms (review M2): C0 controls but newline and tab, DEL, C1 controls, and the bidi
 * embeddings, overrides and isolates (U+202A-202E, U+2066-2069), which can make text read in a
 * different order than it was written. Other format characters stay allowed: the zero-width
 * joiner inside emoji, soft hyphens, tag characters in flags. A CR or CRLF is stored as LF.
 * apps/web/src/screens/post/offerForm.ts mirrors this rule.
 */
export const BAD_TERMS_CHAR = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/u;
/**
 * At most this many cards per list (a backstop: the per-account caps below keep lists short, and
 * the list is sorted by the database before the limit).
 */
const LIST_LIMIT = 500;

/**
 * Per-account offer caps (review I1; owner 6 Nov 2026, Q31): at most this many buying and this many
 * selling offers per account in all, whatever their methods and currencies (an offer with several
 * currencies counts once). Live and paused offers count (a paused one is not a way past the cap),
 * removed ones do not. Owner settings override these defaults.
 */
export const OFFER_CAP_DEFAULTS = Object.freeze({ buy: 3, sell: 3 });
export const OFFER_CAP_KEYS = Object.freeze({ buy: 'offers_max_buy', sell: 'offers_max_sell' });
const OFFER_CAP_MAX = 1000;

/**
 * Which differences make two bands of a currency different (owner Q20/F3, not settled: p11-60).
 * The lead's default; one place to change it until the owner rules (or it moves to owner settings).
 */
export const BAND_DIFFER_RULE: readonly BandDifference[] = BAND_DIFFER_DEFAULT;

interface OfferRow {
  id: string;
  account_id: string;
  side: Side;
  amount_unit: AmountUnit;
  terms: string;
  country: string | null;
  status: OfferStatus;
}

const OFFER_COLUMNS = `o.id, o.account_id, o.side, o.amount_unit, o.terms, o.country, o.status`;

/**
 * Offers are market ± % only (owner Q1, 6 Nov 2026; F1, 7 Nov). A row stored as fixed before that
 * rule (migration 345 refuses new ones) is kept as data until the owner decides what happens to it
 * (J-02), but the API treats it as an offer that does not exist: it is never listed or counted,
 * shown (to its poster neither), switched on or off, relisted or taken (trades/take.ts).
 */
export const MARKET_PRICED = `o.price_mode = 'market'`;

/**
 * An offer anyone may see: market-priced (MARKET_PRICED), live, its poster neither disabled nor on a trading hold, and the site not
 * in an emergency stop (`site_flags.trading_paused`; review M6: during a stop nothing is listed,
 * and only the poster can still open their own offer). No site_flags row counts as stopped.
 */
const LISTED = `${MARKET_PRICED} and o.status = 'live' and a.kind = 'trader' and a.disabled_at is null
  and not exists (select 1 from trading_holds h where h.account_id = o.account_id and h.lifted_at is null)
  and not ${ACTIVE_LIEN_SQL('o.account_id')}
  and not ${recoveryHoldHidesSql('o.account_id')}
  and not coalesce((select f.trading_paused from site_flags f), true)`;

/**
 * Plan 5 Task 3 (P5-A4): an offer whose poster has a pending review is left out of every list, count
 * and single-offer read until they rate, so takers are never stranded (the take refuses it too).
 * `now` is the SQL parameter bound from the clock.
 */
const posterRated = (now: string): string => `not ${pendingReviewSql('o.account_id', now)}`;

/**
 * Plan 5 Task 5: how many of `accountId`'s offers anyone may see now (the profile's "Offers (n)"),
 * by the same rules as every list (LISTED, posterRated).
 */
export async function listedOfferCount(q: Queryable, accountId: string, now: Date): Promise<number> {
  const { rows } = await q.query<{ n: string }>(
    `select count(*) as n from offers o join accounts a on a.id = o.account_id
      where o.account_id = $1 and ${LISTED} and ${posterRated('$2::timestamptz')}`,
    [accountId, now],
  );
  return Number(rows[0]!.n);
}

/**
 * A rate in SQL, with the currency's market price bound as `param` (null while the feed has none)
 * and `bps` the basis points over it: the same number as @x2f/trade's `rateFor` (rounded half up:
 * (market × (10000 + bps) × 2 + 10000) div 20000), so the database can sort before the limit.
 * `div` is exact integer division; numeric `/` rounds its quotient to about 16 significant digits,
 * so from rates near 10^16 a `floor(… / 20000)` came out 1 above the JS rate (Task 4 round-2 review
 * Minor 1). Exported for the parity test.
 */
export function rateSql(param: string, bps = 'o.margin_bps'): string {
  return `(case when ${param}::numeric is null then null
    else div(${param}::numeric * (10000 + ${bps}) * 2 + 10000, 20000) end)`;
}

/** The final rate in SQL for the band `tier` and the method `method` (aliases of offer_tiers and offer_methods rows). */
export function finalRateSql(param: string, tier: string, method: string): string {
  return rateSql(param, `(${tier}.margin_bps + ${method}.adjust_bps)`);
}

/** One method of an offer: its shared instructions, its adjustment, its currencies and their own instructions. */
export interface FlexMethod {
  methodId: string;
  instructions: string;
  adjustBps: number;
  /** The offer currencies it is offered in, in the offer's currency order. */
  currencies: string[];
  /** The instructions for a currency where they differ from the shared ones (owner via the lead, 2 Nov, Q3). */
  byCurrency: Record<string, string>;
}

/** An offer's currencies (the poster's order) with their bands (by start), and its methods (the poster's order). */
export interface Flex {
  currencies: { currency: string; tiers: Tier[] }[];
  methods: FlexMethod[];
}

/** The instructions a trade in `currency` with method `m` locks: that currency's own, else the shared ones. */
export function instructionsFor(m: FlexMethod, currency: string): string {
  return Object.hasOwn(m.byCurrency, currency) ? m.byCurrency[currency]! : m.instructions;
}

/** The bands of `currency` on the offer, or null when the offer does not list it. */
export function tiersOf(flex: Flex, currency: string): Tier[] | null {
  return flex.currencies.find((c) => c.currency === currency)?.tiers ?? null;
}

/** The currencies, bands, methods and pairs of `ids`, from offer_currencies, offer_tiers, offer_methods and offer_method_currencies. */
export async function loadFlex(db: Queryable, ids: readonly string[]): Promise<Map<string, Flex>> {
  const out = new Map<string, Flex>(ids.map((id) => [id, { currencies: [], methods: [] }]));
  if (ids.length === 0) return out;
  const curs = await db.query<{ offer_id: string; currency: string }>(
    'select offer_id, currency from offer_currencies where offer_id = any($1::uuid[]) order by offer_id, position',
    [ids],
  );
  for (const c of curs.rows) out.get(c.offer_id)?.currencies.push({ currency: c.currency, tiers: [] });
  const tiers = await db.query<{ offer_id: string; currency: string; min_amount: string; max_amount: string; margin_bps: number; min_trades: number | null; method_ids: string[] | null }>(
    `select offer_id, currency, min_amount::text as min_amount, max_amount::text as max_amount, margin_bps, min_trades, method_ids
       from offer_tiers t where t.offer_id = any($1::uuid[]) order by t.offer_id, t.currency, t.position`,
    [ids],
  );
  for (const t of tiers.rows) {
    out.get(t.offer_id)?.currencies.find((c) => c.currency === t.currency)?.tiers.push({
      min: t.min_amount, max: t.max_amount, marginBps: t.margin_bps, minTrades: t.min_trades as MinTrades, methodIds: t.method_ids,
    });
  }
  const methods = await db.query<{ offer_id: string; method_id: string; instructions: string; adjust_bps: number }>(
    'select offer_id, method_id, instructions, adjust_bps from offer_methods where offer_id = any($1::uuid[]) order by offer_id, position',
    [ids],
  );
  for (const m of methods.rows) {
    out.get(m.offer_id)?.methods.push({ methodId: m.method_id, instructions: m.instructions, adjustBps: m.adjust_bps, currencies: [], byCurrency: {} });
  }
  const pairs = await db.query<{ offer_id: string; method_id: string; currency: string; instructions: string | null }>(
    `select p.offer_id, p.method_id, p.currency, p.instructions from offer_method_currencies p
       join offer_currencies c on c.offer_id = p.offer_id and c.currency = p.currency
      where p.offer_id = any($1::uuid[]) order by p.offer_id, c.position`,
    [ids],
  );
  for (const p of pairs.rows) {
    const m = out.get(p.offer_id)?.methods.find((x) => x.methodId === p.method_id);
    if (m === undefined) continue;
    m.currencies.push(p.currency);
    if (p.instructions !== null) m.byCurrency[p.currency] = p.instructions;
  }
  return out;
}

/** The viewer's completed trades, for the bands they qualify for (Task 34 review M5); 0 when signed out. */
async function viewerCompleted(db: Queryable, viewerId: string | null): Promise<number> {
  if (viewerId === null) return 0;
  const { rows } = await db.query<{ n: number }>(`select ${COMPLETED_TRADES_SQL}::int as n from accounts a where a.id = $1`, [viewerId]);
  return rows[0]?.n ?? 0;
}

/**
 * What a card shows in `currency` for `method`: with an `amount` (a fiat total), the best band for
 * the viewer among those holding it (an XMR band holds it when the XMR it buys at that band's rate
 * is inside), else no rate (priced as the headline band so `pricing` is still shown); without one,
 * the headline band (@x2f/trade `headlineTier`). Its final rate now (null while the currency has no
 * market price) and that band and method's margin + adjustment.
 */
function priceFor(
  side: Side, unit: AmountUnit, tiers: readonly Tier[], currency: string, method: Pick<FlexMethod, 'methodId' | 'adjustBps'>,
  amount: bigint | null, prices: MarketPrices, completed: number | null,
): { rate: bigint | null; pricing: OfferCard['pricing'] } {
  const market = prices.current(currency);
  const rateOf = (t: Tier): Price | null => tierRate(currency, t, method, market);
  const head = headlineTier(tiers, method.methodId, side, completed) ?? tiers[0]!;
  const pricingOf = (t: Tier): OfferCard['pricing'] => ({ mode: 'market', marginBps: t.marginBps + method.adjustBps });
  if (amount === null) return { rate: rateOf(head)?.centsPerXmr ?? null, pricing: pricingOf(head) };
  const holding = tiers.filter((t) => {
    if (t.methodIds !== null && !t.methodIds.includes(method.methodId)) return false;
    if (unit === 'fiat') return tierHolds('fiat', t, { amountAtomic: 0n, fiatCents: amount });
    const r = rateOf(t);
    return r !== null && tierHolds('xmr', t, { amountAtomic: atomicForFiat(amount, r), fiatCents: amount });
  });
  const best = headlineTier(holding, method.methodId, side, completed);
  if (best === null) return { rate: null, pricing: pricingOf(head) };
  return { rate: rateOf(best)?.centsPerXmr ?? null, pricing: pricingOf(best) };
}

/** A currency's envelope in the offer's unit: the lowest band start, the highest band end, the lowest band rule. */
function envelope(tiers: readonly Tier[]): { min: bigint; max: bigint; minTrades: MinTrades } {
  let min = BigInt(tiers[0]!.min);
  let max = BigInt(tiers[0]!.max);
  for (const t of tiers) {
    if (BigInt(t.min) < min) min = BigInt(t.min);
    if (BigInt(t.max) > max) max = BigInt(t.max);
  }
  const rules = tiers.map((t) => t.minTrades ?? 0);
  const lowest = Math.min(...rules);
  return { min, max, minTrades: lowest === 0 ? null : (lowest as MinTrades) };
}

/** The envelope in both units for an answer: the poster's own exactly, the other at `rate` (the card's) or null without one. */
function amountsOf(unit: AmountUnit, tiers: readonly Tier[], currency: string, rate: bigint | null): Pick<OfferCard, 'amountUnit' | 'minAtomic' | 'maxAtomic' | 'minFiatCents' | 'maxFiatCents' | 'minTrades'> {
  const e = envelope(tiers);
  const own = unit === 'xmr'
    ? { minAtomic: e.min.toString(), maxAtomic: e.max.toString(), minFiatCents: null, maxFiatCents: null }
    : { minAtomic: null, maxAtomic: null, minFiatCents: e.min.toString(), maxFiatCents: e.max.toString() };
  if (rate === null) return { amountUnit: unit, ...own, minTrades: e.minTrades };
  const both = rangeInBoth({ unit, min: e.min, max: e.max }, { currency, centsPerXmr: rate });
  return {
    amountUnit: unit,
    minAtomic: both.minAtomic.toString(),
    maxAtomic: both.maxAtomic.toString(),
    minFiatCents: both.minFiat.toString(),
    maxFiatCents: both.maxFiat.toString(),
    minTrades: e.minTrades,
  };
}

/** The smallest trade of a currency's bands in fiat at `rate` (the starter caps' measure), or null without a rate for an XMR offer. */
function minFiatAt(unit: AmountUnit, tiers: readonly Tier[], currency: string, rate: bigint | null): bigint | null {
  const e = envelope(tiers);
  if (unit === 'fiat') return e.min;
  return rate === null ? null : fiatCents(e.min, { currency, centsPerXmr: rate });
}

const copyTier = (t: Tier): Tier => ({ ...t, methodIds: t.methodIds === null ? null : [...t.methodIds] });

/**
 * Plan 4 Task 26, review M1 (lead call) and B1: a poster held by an account limit lists each band
 * only up to what the take allows, by the take's own rule (trades/capValue.ts: the larger of the
 * fiat total and the XMR at the market, and the same bisection as the launch cap's growth ceiling),
 * at the band's own rate for this method. An XMR band's top is the largest amount within; a fiat
 * band's is the largest total whose amount (`atomicForFiat`, as the quote works it out) is within.
 * A band wholly above it is dropped; null when none is left (not listed in this currency). Without
 * a price the bands are left as posted (the take fails closed). A price move between the list and
 * the take can still refuse a shown maximum, as it can for the launch cap.
 * Lead default, owner question: the clamped maximum is visible, so a taker can see the poster can't
 * take more than it, though never why.
 */
export function clampTiers(
  unit: AmountUnit, tiers: readonly Tier[], currency: string, method: Pick<FlexMethod, 'methodId' | 'adjustBps'>, prices: MarketPrices, capUsdCents: bigint,
): Tier[] | null {
  const q = prices.quote(currency);
  const market = prices.current(currency);
  if (q === null || market === null) return [...tiers];
  const out: Tier[] = [];
  for (const t of tiers) {
    const rate = tierRate(currency, t, method, market);
    if (rate === null) {
      out.push(t);
      continue;
    }
    const lo = largestAtomicWithin(currency, q, rate, capUsdCents);
    const top = unit === 'xmr' ? lo : largestTotalWithin(rate, lo);
    if (BigInt(t.min) > top) continue;
    out.push(BigInt(t.max) > top ? { ...t, max: top.toString() } : t);
  }
  return out.length > 0 ? out : null;
}

/**
 * The posters among `ids` whose own cap is lowered by an account limit (Task 26): their cap in US
 * cents. A poster with no limit, or one whose limit does not lower what their stage already allows
 * (review m8), is not clamped: they look exactly like any poster of their stage.
 */
async function limitedPosters(db: Queryable, ids: readonly string[], now: Date, settings: StarterSettings): Promise<Map<string, bigint>> {
  const out = new Map<string, bigint>();
  const { rows } = await db.query<{ account_id: string }>(
    'select distinct account_id from account_limits where account_id = any($1) and (until is null or until > $2)',
    [[...new Set(ids)], now],
  );
  for (const r of rows) {
    const c = await tradeCap(db, r.account_id, now, settings);
    if (c.limitBinds && c.capUsdCents !== null) out.set(r.account_id, c.capUsdCents);
  }
  return out;
}

function toCard(
  r: OfferRow, poster: TraderSummary, flex: Flex, currency: string, method: FlexMethod, amount: bigint | null,
  prices: MarketPrices, methods: CardMethod[], completed: number | null, posterCapUsdCents: bigint | null = null,
): OfferCard | null {
  const posted = tiersOf(flex, currency)!;
  let tiers: readonly Tier[] = posted;
  if (posterCapUsdCents !== null) {
    const clamped = clampTiers(r.amount_unit, posted, currency, method, prices, posterCapUsdCents);
    // No band for this method left: not listed for it (as the method counts).
    if (clamped === null || !clamped.some((t) => t.methodIds === null || t.methodIds.includes(method.methodId))) return null;
    tiers = clamped;
  }
  const { rate, pricing } = priceFor(r.side, r.amount_unit, tiers, currency, method, amount, prices, completed);
  // An amount asked for that no band of a limited poster holds any more: not listed (review B1).
  if (posterCapUsdCents !== null && amount !== null && rate === null && prices.current(currency) !== null) return null;
  const card: OfferCard = {
    id: r.id,
    poster,
    currency,
    currencies: flex.currencies.map((c) => c.currency),
    rate: rate === null ? null : rate.toString(),
    pricing,
    ...amountsOf(r.amount_unit, tiers, currency, rate),
    tiers: tiers.map(copyTier),
    methods,
  };
  if (r.country !== null) card.country = r.country;
  return card;
}

/** The public view of the methods offered in `currency`: no instructions, only methods that may be offered now (P3-I20). */
function publicMethods(flex: Flex, currency: string): CardMethod[] {
  return flex.methods.filter((m) => m.currencies.includes(currency) && isAvailable(m.methodId)).map((m) => ({ methodId: m.methodId, adjustBps: m.adjustBps }));
}

/** The poster's own view of the methods offered in `currency`, each with its instructions for that currency. */
function ownMethods(flex: Flex, currency: string): CardMethod[] {
  return flex.methods.filter((m) => m.currencies.includes(currency)).map((m) => ({ methodId: m.methodId, adjustBps: m.adjustBps, instructions: instructionsFor(m, currency) }));
}

/** The optional `amount` query (a fiat total in minor units): null when absent, 400 when malformed. */
function amountParam(q: unknown): bigint | null {
  if ((q as Record<string, unknown> | null)?.amount === undefined) return null;
  const v = single(q, 'amount');
  if (v === undefined || !FIAT.test(v) || BigInt(v) <= 0n) throw bad();
  return BigInt(v);
}

/** A query value given exactly once as a string, else undefined (a repeated key arrives as an array). */
function single(q: unknown, key: string): string | undefined {
  const v = (q as Record<string, unknown> | null)?.[key];
  return typeof v === 'string' ? v : undefined;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

const bad = (): ApiError => new ApiError(400, 'bad-request');

interface NewOffer {
  side: Side;
  unit: AmountUnit;
  /** The poster's order; each currency's bands as covered ranges, by start. */
  currencies: { currency: string; tiers: Tier[] }[];
  methods: FlexMethod[];
  terms: string;
  country: string | null;
  /** The gift-card terms version the poster ticked (J-17, F13); null on every other method. */
  giftCardTerms: string | null;
}

const OFFER_KEYS = ['side', 'currencies', 'methods', 'terms'];
const OFFER_OPTIONAL = ['amountUnit', 'country', 'giftCardTerms'];
const METHOD_KEYS = ['methodId', 'adjustBps', 'instructions'];
const METHOD_OPTIONAL = ['currencies', 'instructionsByCurrency'];

/** Exactly `keys`, plus any of `optional`. */
function keysAre(o: Record<string, unknown>, keys: readonly string[], optional: readonly string[]): boolean {
  const own = Object.keys(o);
  return keys.every((k) => own.includes(k)) && own.every((k) => keys.includes(k) || optional.includes(k));
}

/** Terms and instructions: CR and CRLF become LF, trimmed, at most `max` characters, no BAD_TERMS_CHAR. */
function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') throw bad();
  const clean = v.replace(/\r\n?/g, '\n').trim();
  if ([...clean].length > max || BAD_TERMS_CHAR.test(clean)) throw bad();
  return clean;
}

/**
 * `methods`: 1 to MAX_METHODS distinct methods (owner Q23: 5), each `{ methodId, adjustBps,
 * instructions, currencies?, instructionsByCurrency? }`; `adjustBps` is the owner's price change,
 * −5% to +10% in 0.5% steps (@x2f/trade `adjustAllowed`; review I4); `currencies` (absent: every
 * offer currency) names offer currencies only, and `instructionsByCurrency` only the method's own
 * currencies.
 */
function parseMethods(v: unknown, offerCurrencies: readonly string[]): FlexMethod[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_METHODS) throw bad();
  const seen = new Set<string>();
  return v.map((m: unknown) => {
    if (!isObject(m) || !keysAre(m, METHOD_KEYS, METHOD_OPTIONAL)) throw bad();
    const { methodId, adjustBps } = m;
    if (typeof methodId !== 'string' || methodId.length === 0 || methodId.length > 64 || seen.has(methodId)) throw bad();
    seen.add(methodId);
    if (!adjustAllowed(adjustBps)) throw bad();
    let currencies: string[];
    if (m.currencies === undefined) {
      currencies = [...offerCurrencies];
    } else {
      const list = m.currencies;
      if (!Array.isArray(list) || list.length === 0 || new Set(list).size !== list.length) throw bad();
      if (!list.every((c) => typeof c === 'string' && offerCurrencies.includes(c))) throw bad();
      // Kept in the offer's currency order.
      currencies = offerCurrencies.filter((c) => (list as string[]).includes(c));
    }
    const byCurrency: Record<string, string> = {};
    if (m.instructionsByCurrency !== undefined) {
      const by = m.instructionsByCurrency;
      if (!isObject(by)) throw bad();
      for (const [c, text] of Object.entries(by)) {
        if (!currencies.includes(c)) throw bad();
        byCurrency[c] = cleanText(text, INSTRUCTIONS_MAX);
      }
    }
    return { methodId, adjustBps, instructions: cleanText(m.instructions, INSTRUCTIONS_MAX), currencies, byCurrency };
  });
}

/**
 * A band's `methodIds` as stored: null when absent or naming every method offered in its currency
 * (the same set, so the band-must-differ rule compares like with like); otherwise in the offer's
 * method order. 400 for a method not offered in the currency.
 */
function bandMethods(ids: readonly string[] | undefined, offered: readonly string[]): string[] | undefined {
  if (ids === undefined) return undefined;
  if (!ids.every((m) => offered.includes(m))) throw bad();
  if (ids.length === offered.length) return undefined;
  return offered.filter((m) => ids.includes(m));
}

/**
 * The body (see the header; Task 34 review M1: the old single-method shape is gone); the methods'
 * availability and the gift-card country are checked by the caller. `currencies`: 1 to
 * MAX_CURRENCIES distinct currencies the price feed knows, each `{ currency, bands }` with bands
 * that pass @x2f/trade `checkBands` in the offer's unit (at most 3, no gap, the band-must-differ
 * rule BAND_DIFFER_RULE) once their `methodIds` are stored as `bandMethods` gives them. Every offer
 * currency has a method; every band margin + the adjustment of each method it is for stays within
 * ±MAX_MARGIN_BPS (rateFor's range).
 */
function parseNewOffer(body: unknown): NewOffer & { countryGiven: unknown; giftCardTermsGiven: unknown } {
  if (!isObject(body) || !keysAre(body, OFFER_KEYS, OFFER_OPTIONAL)) throw bad();
  const { side, terms, country, giftCardTerms } = body;
  if (side !== 'sell' && side !== 'buy') throw bad();
  const unit = body.amountUnit === undefined ? 'fiat' : body.amountUnit;
  if (unit !== 'fiat' && unit !== 'xmr') throw bad();
  const rawCurrencies = body.currencies;
  if (!Array.isArray(rawCurrencies) || rawCurrencies.length === 0 || rawCurrencies.length > MAX_CURRENCIES) throw bad();
  const named = rawCurrencies.map((c: unknown) => {
    if (!isObject(c) || Object.keys(c).sort().join(',') !== 'bands,currency') throw bad();
    if (typeof c.currency !== 'string' || !CURRENCY.test(c.currency) || currencyExponent(c.currency) === null) throw bad();
    return { currency: c.currency, bands: c.bands };
  });
  if (new Set(named.map((c) => c.currency)).size !== named.length) throw bad();
  const methods = parseMethods(body.methods, named.map((c) => c.currency));
  const currencies = named.map(({ currency, bands }) => {
    const offered = methods.filter((m) => m.currencies.includes(currency));
    if (offered.length === 0) throw bad();
    if (!Array.isArray(bands)) throw bad();
    const ids = offered.map((m) => m.methodId);
    const normal = bands.map((b: unknown) => {
      if (!isObject(b)) throw bad();
      const raw = b.methodIds;
      if (raw !== undefined && (!Array.isArray(raw) || !raw.every((x) => typeof x === 'string'))) throw bad();
      const kept = bandMethods(raw as string[] | undefined, ids);
      const { methodIds: _drop, ...rest } = b;
      return (kept === undefined ? rest : { ...rest, methodIds: kept }) as unknown as Band;
    });
    if (checkBands(normal, unit, BAND_DIFFER_RULE) !== null) throw bad();
    const tiers = bandsToTiers(normal, unit, currencyExponent(currency)!);
    for (const t of tiers) {
      for (const m of offered) {
        if ((t.methodIds === null || t.methodIds.includes(m.methodId)) && Math.abs(t.marginBps + m.adjustBps) > MAX_MARGIN_BPS) throw bad();
      }
    }
    return { currency, tiers };
  });
  return { side, unit, currencies, methods, terms: cleanText(terms, TERMS_MAX), country: null, giftCardTerms: null, countryGiven: country, giftCardTermsGiven: giftCardTerms };
}

/** 409 when the method may not be offered now (P3-I20: methods awaiting legal review). */
function assertMethodAvailable(methodId: string): void {
  if (!isAvailable(methodId)) throw new ApiError(409, 'method-unavailable');
}

async function loadOfferCaps(db: Queryable): Promise<Record<Side, number>> {
  const { rows } = await db.query<{ key: string; value: string }>('select key, value from owner_settings where key = any($1)', [
    [OFFER_CAP_KEYS.buy, OFFER_CAP_KEYS.sell],
  ]);
  const get = (k: string, d: number) => {
    const n = Number(rows.find((r) => r.key === k)?.value);
    return Number.isInteger(n) && n >= 1 && n <= OFFER_CAP_MAX ? n : d;
  };
  return { buy: get(OFFER_CAP_KEYS.buy, OFFER_CAP_DEFAULTS.buy), sell: get(OFFER_CAP_KEYS.sell, OFFER_CAP_DEFAULTS.sell) };
}

/**
 * 409 `too-many-offers` with the caps that refused it (`{ buy, sell }`, the owner settings in force;
 * review M2: the web says the API's numbers, not a fixed 3 + 3).
 */
function tooManyOffers(caps: Record<Side, number>): ApiError {
  return new ApiError(409, 'too-many-offers', { buy: caps.buy, sell: caps.sell });
}

/**
 * Posting or relisting, inside the caller's transaction (review M1): refused while the site's
 * trading is paused (409 `trading-paused`), while the account has a trading hold (409
 * `trading-hold`), without a usable payout wallet (409 `no-wallet`, spec 6.4; a wallet still in
 * its 24-hour wait does not count), and at the account's offer cap for the offer's side (409
 * `too-many-offers` `{ buy, sell }`, owner Q31; `except` is the offer being relisted).
 *
 * The account row is locked `for update` first, so one account's posts and relists run one at a
 * time (the cap cannot be raced) and a hold being inserted (its foreign key takes a key-share lock
 * on the same row) commits either before this check or after this write; the site_flags row is read
 * `for share`, so an emergency stop being set waits for this write or is seen by it.
 */
async function assertMayPost(
  client: Queryable,
  auth: AuthContext,
  now: Date,
  side: Side,
  except: string | null,
): Promise<void> {
  const accountId = auth.accountId;
  await lockAccountLive(client, auth, now);
  // Owner 2 Nov 2026: only a vendor posts or turns on offers (403 `not-vendor`), before the other guards.
  await assertVendor(client, accountId);
  const refused = await accountRefusal(client, accountId, now);
  if (refused !== null) throw new ApiError(409, refused);
  const caps = await loadOfferCaps(client);
  const { rows } = await client.query<{ same: number }>(
    `select count(*)::int as same
       from offers where account_id = $1 and side = $2 and status <> 'removed' and ($3::uuid is null or id <> $3::uuid)`,
    [accountId, side, except],
  );
  if (rows[0]!.same >= caps[side]) throw tooManyOffers(caps);
}

/**
 * The first lock every offer write of an account takes (Task 4 lock order: accounts(A) `for update`,
 * then site_flags `for share`, then offer rows). Task 5's take locks the accounts first too, then
 * the offer, so no path holds an offer row while waiting for an account row.
 */
async function lockAccount(client: Queryable, accountId: string): Promise<void> {
  await client.query('select 1 from accounts where id = $1 for update', [accountId]);
}

/**
 * `lockAccount`, then the calling session must still be live under that lock (Tasks 16-17 review
 * round 5 M2: an offer write in flight across the owner's proof or a logout acts for nobody; 401).
 */
async function lockAccountLive(client: Queryable, auth: AuthContext, now: Date): Promise<void> {
  await lockAccount(client, auth.accountId);
  await requireLiveSessionInTx(client, auth, now);
}

/**
 * Why this account may not put any offer live now, or null; run after `lockAccount`. First: only a
 * vendor posts or turns on offers (owner 2 Nov 2026; 403 `not-vendor`). A trader's offers from
 * before migration 198 stay listed while live, and can be paused or removed.
 */
type AccountRefusal = 'not-vendor' | 'trading-paused' | 'trading-hold' | 'lien' | 'no-wallet';
async function accountRefusal(client: Queryable, accountId: string, now: Date): Promise<AccountRefusal | null> {
  if ((await accountTypeOf(client, accountId)) !== 'vendor') return 'not-vendor';
  const flags = await client.query<{ trading_paused: boolean }>('select trading_paused from site_flags for share');
  // No site_flags row fails closed.
  if (flags.rows[0]?.trading_paused !== false) return 'trading-paused';
  const held = await client.query('select 1 from trading_holds where account_id = $1 and lifted_at is null limit 1', [accountId]);
  if ((held.rowCount ?? 0) > 0) return 'trading-hold';
  // Task 25 (J-06): an active lien takes away every trading privilege until it is repaid.
  if (await hasActiveLien(client, accountId)) return 'lien';
  if ((await usableWallets(client, accountId, now)).length === 0) return 'no-wallet';
  return null;
}

/** Runs `fn` in one transaction on its own client. */
async function inTransaction<T>(db: Deps['db'], fn: (client: Queryable) => Promise<T>): Promise<T> {
  const client = await db.connect();
  let ok = false;
  try {
    await client.query('begin');
    const out = await fn(client);
    await client.query('commit');
    ok = true;
    return out;
  } finally {
    if (!ok) await client.query('rollback').catch(() => undefined);
    client.release();
  }
}

// Posting: the account owner, or a team member with the Post a new offer box (Task 18, Job 1c).
const requireTrader = requireSession({ kinds: ['trader'], member: 'offers-post' });
/**
 * Turning offers off, and reading my own offers, work on a stale Terms version too (lead decision
 * 2026-10-29 on R10: shutting things off never waits for new Terms). Anything that puts an offer
 * live still needs the current Terms (`assertTermsCurrent`); removing one is shutting off too
 * (round-2 review m1, lead decision 2026-10-29). A team member may do these too with the box for
 * each (Task 18, Job 1c): See offers reads, Pause or resume turns offers off and on, Delete an offer
 * removes one (`PATCH` checks the exact box for the status asked).
 */
const requireSeeOffers = requireSession({ kinds: ['trader'], allowStaleTerms: true, member: 'offers-see' });
const requirePauseOffers = requireSession({ kinds: ['trader'], allowStaleTerms: true, member: 'offers-pause' });
const requireSetStatus = requireSession({ kinds: ['trader'], allowStaleTerms: true, member: ['offers-pause', 'offers-delete'] });

/** 403 `terms-required` `{ version }`, as requireSession answers, for a trader on a stale Terms version. */
async function assertTermsCurrent(deps: Deps, auth: { accountId: string; memberId: string | null }): Promise<void> {
  const { rows } = await deps.db.query<{ terms_version: string | null }>('select terms_version from accounts where id = $1', [auth.accountId]);
  if (rows[0]?.terms_version !== deps.config.termsVersion) throw new ApiError(403, 'terms-required', { version: deps.config.termsVersion });
  // A team member's own acceptance too (review 2026-11-08 F1, as requireSession checks it).
  if (auth.memberId !== null) {
    const m = await deps.db.query<{ terms_version: string | null }>(
      'select a.terms_version from team_members tm join accounts a on a.id = tm.member_account_id where tm.id = $1',
      [auth.memberId],
    );
    if (m.rows[0]?.terms_version !== deps.config.termsVersion) throw new ApiError(403, 'terms-required', { version: deps.config.termsVersion });
  }
}
/**
 * `/v1/methods`' live-offer counts (Task 3's `LiveOfferStats`), from the offers anyone may see, counted by the database;
 * for a signed-in viewer, without the offers a block hides from them (Task 37 review I1), so the counts and best
 * rates match the lists they open. J-16: an offer counts once under each method it offers in this currency; its best
 * rate there is over that currency's bands for that method. A currency with no market price now lists nothing
 * (owner Q5), as GET /v1/offers.
 */
export function liveOfferStats(deps: Pick<Deps, 'db' | 'prices' | 'clock'>): LiveOfferStats {
  return async ({ side, currency, viewerId = null }) => {
    const market = deps.prices.current(currency)?.centsPerXmr ?? null;
    if (market === null) return [];
    const now = deps.clock();
    // One row per method and offer, so an offer its poster's account limit unlists (Task 26, review
    // M1) can be left out of the count as it is left out of the list.
    const { rows } = await deps.db.query<{ method_id: string; offer_id: string; account_id: string; amount_unit: AmountUnit; lo: string | null; hi: string | null }>(
      `select m.method_id, o.id as offer_id, o.account_id, o.amount_unit, min(r.rate) as lo, max(r.rate) as hi
         from offers o join accounts a on a.id = o.account_id
         join offer_method_currencies mc on mc.offer_id = o.id and mc.currency = $2
         join offer_methods m on m.offer_id = o.id and m.method_id = mc.method_id
         join offer_tiers t on t.offer_id = o.id and t.currency = $2 and (t.method_ids is null or m.method_id = any(t.method_ids))
         cross join lateral (select ${finalRateSql('$3', 't', 'm')} as rate) r
        where ${LISTED} and ${posterRated('$5::timestamptz')} and o.side = $1
          and not ${blockedEitherWaySql('o.account_id', '$4::uuid')}
        group by m.method_id, o.id, o.account_id, o.amount_unit`,
      [side, currency, market.toString(), viewerId, now],
    );
    const caps = await limitedPosters(deps.db, rows.filter((r) => r.account_id !== viewerId).map((r) => r.account_id), now, await loadStarterSettings(deps.db));
    const flex = caps.size === 0 ? new Map<string, Flex>() : await loadFlex(deps.db, rows.filter((r) => caps.has(r.account_id)).map((r) => r.offer_id));
    const byMethod = new Map<string, { offers: number; lo: bigint | null; hi: bigint | null }>();
    for (const r of rows) {
      const cap = r.account_id === viewerId ? undefined : caps.get(r.account_id);
      if (cap !== undefined) {
        const f = flex.get(r.offer_id);
        const method = f?.methods.find((x) => x.methodId === r.method_id);
        const tiers = f === undefined ? null : tiersOf(f, currency);
        if (method === undefined || tiers === null) continue;
        const forMethod = tiers.filter((t) => t.methodIds === null || t.methodIds.includes(r.method_id));
        if (forMethod.length === 0 || clampTiers(r.amount_unit, forMethod, currency, method, deps.prices, cap) === null) continue;
      }
      const m = byMethod.get(r.method_id) ?? { offers: 0, lo: null, hi: null };
      m.offers += 1;
      if (r.lo !== null && (m.lo === null || BigInt(r.lo) < m.lo)) m.lo = BigInt(r.lo);
      if (r.hi !== null && (m.hi === null || BigInt(r.hi) > m.hi)) m.hi = BigInt(r.hi);
      byMethod.set(r.method_id, m);
    }
    return [...byMethod].map(([methodId, m]) => {
      // Buy ads pay the seller: the best is the highest. Sell ads charge the buyer: the lowest.
      const best = side === 'buy' ? m.hi : m.lo;
      return { methodId, offers: m.offers, bestCentsPerXmr: best };
    });
  };
}

/** Whether an account limit keeps the account from a trade of `usdCents` even at stage `at` (Task 26). */
function limitBlocks(cap: TradeCap, at: 'building' | 'graduated', usdCents: bigint): boolean {
  const l = cap.limit;
  if (l === null) return false;
  if (l.stage !== null && (l.stage === 'starter' || at === 'graduated')) return true;
  return l.capUsdCents !== null && usdCents > l.capUsdCents;
}

/** Adds `opensAt` to each card above the viewer's cap (Revision 2026-10-24), from the card's currency and smallest trade. */
async function markOpensAt(deps: Deps, viewerId: string, rows: readonly OfferRow[], flex: Map<string, Flex>, cards: OfferCard[], given?: StarterSettings): Promise<void> {
  const settings = given ?? (await loadStarterSettings(deps.db));
  const cap = await tradeCap(deps.db, viewerId, deps.clock(), settings);
  if (cap.capUsdCents === null) return;
  rows.forEach((r, i) => {
    // Never on the viewer's own offers (review M7).
    if (r.account_id === viewerId) return;
    const card = cards[i]!;
    const q = deps.prices.quote(card.currency);
    if (q === null) return;
    // An XMR band's smallest trade in fiat at the card's rate now (the take checks the cap again).
    const min = minFiatAt(r.amount_unit, tiersOf(flex.get(r.id)!, card.currency)!, card.currency, card.rate === null ? null : BigInt(card.rate));
    if (min === null) return;
    const usd = usdCentsOf(min, { centsPerXmr: q.price.centsPerXmr, usdCentsPerXmr: q.usdCentsPerXmr });
    const at = opensAt(settings, cap.stage, usd);
    // Review m5 (lead call): never promise a stage the viewer's account limit blocks; say nothing.
    if (at !== undefined && !limitBlocks(cap, at, usd)) cards[i]!.opensAt = at;
  });
}

export function offerRoutes(app: FastifyInstance): void {
  app.post('/v1/offers', { preHandler: [requireTrader, requireNotHeld] }, async (req, reply) => {
    const deps = req.server.deps;
    const o = parseNewOffer(req.body);
    const catalog = o.methods.map((m) => getMethod(m.methodId));
    if (catalog.some((m) => m === null)) throw bad();
    for (const m of o.methods) assertMethodAvailable(m.methodId);
    // A gift-card offer names the card's country; no other offer has one (Revision 2026-10-27).
    // Any gift-card method among its methods makes it a gift-card offer (J-17 on J-16, lead ruling
    // 10 Nov 2026): the gift-card terms apply to the offer, and each gift-card METHOD may be offered
    // only in a currency of the card's country (T-081); the offer's other methods and currencies are free.
    const giftMethods = o.methods.filter((m) => isGiftCard(m.methodId));
    if (giftMethods.length > 0) {
      if (typeof o.countryGiven !== 'string' || !/^[A-Z]{2}$/.test(o.countryGiven)) throw bad();
      // J-17 (T-081): the card's currency follows its country, for every currency the card method is offered in.
      for (const m of giftMethods) for (const c of m.currencies) if (!giftCardCurrencyOk(o.countryGiven, c)) throw bad();
      // J-17 (F13): the poster ticked the gift-card terms of the version the API has now (a page
      // showing older words cannot agree to these).
      if (o.giftCardTermsGiven !== GIFT_CARD_TERMS_VERSION) throw bad();
      o.country = o.countryGiven;
      o.giftCardTerms = GIFT_CARD_TERMS_VERSION;
    } else if (o.countryGiven !== undefined || o.giftCardTermsGiven !== undefined) {
      throw bad();
    }
    const accountId = req.auth!.accountId;
    const now = deps.clock();
    const id = await inTransaction(deps.db, async (client) => {
      await assertMayPost(client, req.auth!, now, o.side, null);
      // The launch cap (owner p11-6): every band's top edge in every currency of the offer, in US
      // dollars at that currency's market rate now (trades/launchCap.ts); a currency with no price
      // now fails closed (409 price-unavailable). The take checks the trade itself again.
      throwLaunchCapRefusal(offerLaunchCapRefusal(o.unit, o.currencies, deps.prices, false));
      const { rows } = await client.query<{ id: string }>(
        `insert into offers (account_id, side, price_mode, amount_unit, terms, country, gift_card_terms, status, created_at, updated_at)
         values ($1, $2, 'market', $3, $4, $5, $6, 'live', $7, $7) returning id`,
        [accountId, o.side, o.unit, o.terms, o.country, o.giftCardTerms, now],
      );
      const offerId = rows[0]!.id;
      // Same transaction: an offer never exists without its currencies, bands and methods.
      await client.query(
        `insert into offer_currencies (offer_id, position, currency)
         select $1, u.i - 1, u.c from unnest($2::text[]) with ordinality as u(c, i)`,
        [offerId, o.currencies.map((c) => c.currency)],
      );
      const bands = o.currencies.flatMap((c) => c.tiers.map((t, position) => ({ currency: c.currency, position, ...t })));
      // One row per band; method_ids as a Postgres array literal (or null), parsed by Postgres.
      for (const b of bands) {
        await client.query(
          `insert into offer_tiers (offer_id, currency, position, min_amount, max_amount, margin_bps, min_trades, method_ids)
           values ($1, $2, $3, $4, $5, $6, $7, $8::text[])`,
          [offerId, b.currency, b.position, b.min, b.max, b.marginBps, b.minTrades, b.methodIds],
        );
      }
      await client.query(
        `insert into offer_methods (offer_id, position, method_id, instructions, adjust_bps)
         select $1, u.i - 1, u.m, u.ins, u.a from unnest($2::text[], $3::text[], $4::int[]) with ordinality as u(m, ins, a, i)`,
        [offerId, o.methods.map((m) => m.methodId), o.methods.map((m) => m.instructions), o.methods.map((m) => m.adjustBps)],
      );
      const pairs = o.methods.flatMap((m) => m.currencies.map((c) => ({ methodId: m.methodId, currency: c, instructions: Object.hasOwn(m.byCurrency, c) ? m.byCurrency[c]! : null })));
      await client.query(
        `insert into offer_method_currencies (offer_id, method_id, currency, instructions)
         select $1, * from unnest($2::text[], $3::text[], $4::text[])`,
        [offerId, pairs.map((p) => p.methodId), pairs.map((p) => p.currency), pairs.map((p) => p.instructions)],
      );
      // Task 18: a team member's post is in the account owner's audit log, in this transaction, with
      // the offer's terms (review 2026-11-09 M2: `offerId`, not just the id in `detail`).
      await auditMember(client, req.auth, { action: 'offer-posted', offerId }, now);
      return offerId;
    });
    return reply.code(201).send({ id });
  });

  app.patch('/v1/offers/:id', { preHandler: requireSetStatus }, async (req) => {
    const deps = req.server.deps;
    const id = (req.params as { id: string }).id;
    const body = req.body;
    if (!isObject(body) || Object.keys(body).length !== 1) throw bad();
    const status = body.status;
    if (typeof status !== 'string' || !(STATUSES as readonly string[]).includes(status)) throw bad();
    // Job 1c: removing needs Delete an offer; pausing and relisting need Pause or resume.
    assertMemberMay(req.auth, status === 'removed' ? 'offers-delete' : 'offers-pause');
    // Pausing and removing work on stale Terms (R10 lead decisions 2026-10-29: shutting off never
    // waits for new Terms); relisting does not.
    if (status === 'live') await assertTermsCurrent(deps, req.auth!);
    if (!UUID.test(id)) throw new ApiError(404, 'not-found');
    const { rows } = await deps.db.query<{ account_id: string; status: OfferStatus; methods: string[] }>(
      `select o.account_id, o.status, array(select m.method_id from offer_methods m where m.offer_id = o.id order by m.position) as methods
         from offers o where o.id = $1 and ${MARKET_PRICED}`,
      [id],
    );
    const row = rows[0];
    // A removed offer is gone for good.
    if (!row || row.status === 'removed') throw new ApiError(404, 'not-found');
    const accountId = req.auth!.accountId;
    if (row.account_id !== accountId) throw new ApiError(403, 'wrong-party');
    const now = deps.clock();
    const update = (q: Queryable) =>
      q.query(`update offers set status = $2, updated_at = $3 where id = $1 and account_id = $4 and status <> 'removed'`, [id, status, now, accountId]);
    if (status === 'live') {
      // Task 17: an account on its 24-hour hold cannot turn an offer on (pausing or removing one is fine).
      const until = await holdUntil(deps, accountId, req.server.events);
      if (until !== null) throw holdRefusal(until);
      // Relisting is posting again: the same checks (every method may be offered now, as at post),
      // in one transaction with the write (review M1).
      for (const m of row.methods) assertMethodAvailable(m);
      await inTransaction(deps.db, async (client) => {
        const cur = await client.query<{ side: Side; amount_unit: AmountUnit }>(
          `select side, amount_unit from offers o where id = $1 and account_id = $2 and status <> 'removed' and ${MARKET_PRICED}`,
          [id, accountId],
        );
        const m = cur.rows[0];
        if (!m) throw new ApiError(404, 'not-found');
        await assertMayPost(client, req.auth!, now, m.side, id);
        // The launch cap, as posting checks it (launch-rules review F1): an offer from before the
        // cap, or a band whose currency's rate has since moved it above $5,000, does not go live
        // again. A currency with no price now is skipped and stays hidden until its rate returns
        // (OWNER QUESTION p11-95, the lead's default; trades/launchCap.ts `offerLaunchCapRefusal`).
        const flex = (await loadFlex(client, [id])).get(id)!;
        throwLaunchCapRefusal(offerLaunchCapRefusal(m.amount_unit, flex.currencies, deps.prices, true));
        if ((await update(client)).rowCount !== 1) throw new ApiError(404, 'not-found');
        await auditMember(client, req.auth, { action: 'offer-relisted', offerId: id }, now);
      });
    } else if (status === 'removed') {
      // Task 34 review M3: a removed offer keeps no payment details at rest (a trade keeps its own
      // locked copy, trades.method_instructions). Same transaction as the removal: the offer row's
      // lock orders it against a take, which reads the instructions only from a live offer.
      await inTransaction(deps.db, async (client) => {
        await lockAccountLive(client, req.auth!, now);
        if ((await update(client)).rowCount !== 1) throw new ApiError(404, 'not-found');
        await client.query(`update offer_methods set instructions = '' where offer_id = $1 and instructions <> ''`, [id]);
        await client.query(`update offer_method_currencies set instructions = null where offer_id = $1 and instructions is not null`, [id]);
        await auditMember(client, req.auth, { action: 'offer-removed', offerId: id }, now);
      });
    } else {
      // Pausing: no guard but a live session (review round 5 M2), under the account lock.
      await inTransaction(deps.db, async (client) => {
        await lockAccountLive(client, req.auth!, now);
        if ((await update(client)).rowCount !== 1) throw new ApiError(404, 'not-found');
        await auditMember(client, req.auth, { action: 'offer-paused', offerId: id }, now);
      });
    }
    return { id, status };
  });

  // Browsing is behind the front door (owner, 8 Nov 2026; it was open to anyone under P3-M9): a
  // live session of a set-up trader account; a team member browses as the account they work for.
  app.get('/v1/offers', { preHandler: requireInside }, async (req) => {
    const deps = req.server.deps;
    const side = single(req.query, 'side');
    const method = single(req.query, 'method');
    const currency = single(req.query, 'currency');
    const given = (req.query as Record<string, unknown> | null)?.sort !== undefined;
    const rawSort = single(req.query, 'sort');
    const sort: Sort | undefined = given ? SORTS.find((s) => s === rawSort) : 'best';
    if ((side !== 'sell' && side !== 'buy') || method === undefined || method.length === 0 || method.length > 64) throw bad();
    if (currency === undefined || !CURRENCY.test(currency) || sort === undefined) throw bad();
    const amount = amountParam(req.query);
    if (!isAvailable(method)) return [];
    // Owner Q5 (2 Nov): while this currency has no market price, its offers are hidden (the same
    // offers still list under their other currencies).
    const market = deps.prices.current(currency)?.centsPerXmr ?? null;
    if (market === null) return [];

    // Sorted by the database before the limit (review I1): the rate from the bound market price,
    // online from the newest live session (as traderSummaries: by bucket, hidden from someone the
    // poster blocked), trades from the completed count; ties newest first. The offers taking this
    // method in this currency; the sort rate is the best of that currency's bands for this method
    // that the viewer qualifies for (or the lowest rule's) and, for a fiat offer with an amount,
    // that hold it. A card's own rate is then worked out exactly (priceFor).
    const now = deps.clock();
    const viewerId = req.auth!.accountId;
    const completed = await viewerCompleted(deps.db, viewerId);
    const byRate = `r.rate ${side === 'buy' ? 'desc' : 'asc'} nulls last`;
    const best = side === 'buy' ? 'max' : 'min';
    const order =
      sort === 'online' ? `ls.online desc, ${byRate}`
      : sort === 'trades' ? `ct.completed desc, ${byRate}`
      : byRate;
    const forMethod = `t.offer_id = o.id and t.currency = $3 and (t.method_ids is null or $2 = any(t.method_ids))`;
    const { rows } = await deps.db.query<OfferRow>(
      `select ${OFFER_COLUMNS} from offers o join accounts a on a.id = o.account_id
         join offer_method_currencies mc on mc.offer_id = o.id and mc.currency = $3 and mc.method_id = $2
         join offer_methods m on m.offer_id = o.id and m.method_id = $2
         cross join lateral (select ${best}(${finalRateSql('$4', 't', 'm')}) as rate from offer_tiers t
                              where ${forMethod}
                                and coalesce(t.min_trades, 0) <= greatest($8::int, (select min(coalesce(t2.min_trades, 0)) from offer_tiers t2
                                      where t2.offer_id = o.id and t2.currency = $3 and (t2.method_ids is null or $2 = any(t2.method_ids))))
                                and ($7::numeric is null or o.amount_unit = 'xmr' or $7::numeric between t.min_amount and t.max_amount)) r
         cross join lateral (select coalesce(${lastSeenSql('a.id', '$6::uuid')} >= $5::timestamptz, false) as online) ls
         cross join lateral (select ${COMPLETED_TRADES_SQL} as completed) ct
        where ${LISTED} and ${posterRated('$9::timestamptz')} and o.side = $1
          and exists (select 1 from offer_tiers t where ${forMethod})
          and not ${blockedEitherWaySql('o.account_id', '$6::uuid')}
        order by ${order}, o.created_at desc, o.id limit ${LIST_LIMIT}`,
      [side, method, currency, market.toString(), onlineSince(now), viewerId, amount === null ? null : amount.toString(), completed, now],
    );
    // A sell ad's poster releases; a buy ad's poster pays (the card's typical time, P5-A8).
    const role = side === 'sell' ? 'seller' : 'buyer';
    const posters = await traderSummaries(deps.db, rows.map((r) => r.account_id), now, viewerId, undefined, new Map(rows.map((r) => [r.account_id, role])));
    const flex = await loadFlex(deps.db, rows.map((r) => r.id));
    // Review m7: the starter settings once per list. Review M1: posters held by an account limit.
    const settings = await loadStarterSettings(deps.db);
    const caps = await limitedPosters(deps.db, rows.map((r) => r.account_id), now, settings);
    const listed: OfferRow[] = [];
    const cards: OfferCard[] = [];
    for (const r of rows) {
      const f = flex.get(r.id)!;
      const own = r.account_id === viewerId;
      const card = toCard(r, posters.get(r.account_id)!, f, currency, f.methods.find((x) => x.methodId === method)!, amount, deps.prices, publicMethods(f, currency), completed, own ? null : (caps.get(r.account_id) ?? null));
      if (card === null) continue;
      listed.push(r);
      cards.push(card);
    }
    if (viewerId !== null) {
      await markOpensAt(deps, viewerId, listed, flex, cards, settings);
      for (const c of cards) c.viewerTrades = completed;
    }
    return cards;
  });

  app.get('/v1/offers/:id', { preHandler: requireInside }, async (req): Promise<OfferDetail> => {
    const deps = req.server.deps;
    const id = (req.params as { id: string }).id;
    if (!UUID.test(id)) throw new ApiError(404, 'not-found');
    const q = req.query as Record<string, unknown> | null;
    const asked = single(req.query, 'method');
    if (q?.method !== undefined && (asked === undefined || asked.length === 0 || asked.length > 64)) throw bad();
    const askedCurrency = single(req.query, 'currency');
    if (q?.currency !== undefined && (askedCurrency === undefined || !CURRENCY.test(askedCurrency))) throw bad();
    const amount = amountParam(req.query);
    const viewerId = req.auth!.accountId;
    const { rows } = await deps.db.query<OfferRow & { listed: boolean; blocked: boolean }>(
      `select ${OFFER_COLUMNS}, (${LISTED} and ${posterRated('$3::timestamptz')}) as listed, ${blockedEitherWaySql('o.account_id', '$2::uuid')} as blocked
         from offers o join accounts a on a.id = o.account_id where o.id = $1 and ${MARKET_PRICED}`,
      [id, viewerId, deps.clock()],
    );
    const r = rows[0];
    if (!r || r.status === 'removed') throw new ApiError(404, 'not-found');
    const mine = viewerId !== null && viewerId === r.account_id;
    const f = (await loadFlex(deps.db, [r.id])).get(r.id)!;
    // The currency asked for (404 when the offer does not list it), else its first one. Unlike the
    // list, a currency with no market price now is shown here, with a null rate (the take refuses).
    const currency = askedCurrency ?? f.currencies[0]!.currency;
    if (tiersOf(f, currency) === null) throw new ApiError(404, 'not-found');
    // Others see only the methods offered in this currency that may be offered now, without their
    // instructions (payment details: for the poster and, once the escrow is secured, the traders).
    const shown: CardMethod[] = mine ? ownMethods(f, currency) : publicMethods(f, currency);
    // A block either way looks exactly like an offer that does not exist (Task 37).
    if (!mine && (r.blocked || !(r.listed && shown.length > 0))) throw new ApiError(404, 'not-found');
    if (shown.length === 0) throw new ApiError(404, 'not-found');
    const methodId = asked ?? shown[0]!.methodId;
    const method = f.methods.find((m) => m.methodId === methodId);
    if (method === undefined || !shown.some((m) => m.methodId === methodId)) throw new ApiError(404, 'not-found');
    const now = deps.clock();
    const poster = (await traderSummaries(deps.db, [r.account_id], now, viewerId, undefined, new Map([[r.account_id, r.side === 'sell' ? 'seller' : 'buyer']]))).get(r.account_id)!;
    // Review M5: the poster's own view prices every band; anyone else, the bands they qualify for.
    const settings = await loadStarterSettings(deps.db);
    const posterCap = mine ? null : ((await limitedPosters(deps.db, [r.account_id], now, settings)).get(r.account_id) ?? null);
    const card = toCard(r, poster, f, currency, method, amount, deps.prices, shown, mine ? null : await viewerCompleted(deps.db, viewerId), posterCap);
    // Review M1: an offer wholly above its poster's account limit is not listed, here as in the list.
    if (card === null) throw new ApiError(404, 'not-found');
    if (viewerId !== null && !mine) await markOpensAt(deps, viewerId, [r], new Map([[r.id, f]]), [card], settings);
    return { ...card, side: r.side, methodId, terms: r.terms, status: r.status };
  });

  /**
   * Task 36, My offers: every live and paused offer of mine, newest first. Removed offers are gone.
   */
  app.get('/v1/account/offers', { preHandler: requireSeeOffers }, async (req): Promise<MyOffer[]> => {
    const deps = req.server.deps;
    const accountId = req.auth!.accountId;
    const { rows } = await deps.db.query<OfferRow & { created_at: Date }>(
      `select ${OFFER_COLUMNS}, o.created_at from offers o
        where o.account_id = $1 and o.status <> 'removed' and ${MARKET_PRICED} order by o.created_at desc, o.id`,
      [accountId],
    );
    // Why a live offer is not listed now (review M4), in LISTED's terms; no site_flags row is a stop.
    const { rows: why } = await deps.db.query<{ paused: boolean; held: boolean; lien: boolean; recovery: boolean }>(
      `select not coalesce((select f.trading_paused = false from site_flags f), false) as paused,
              exists (select 1 from trading_holds h where h.account_id = $1 and h.lifted_at is null) as held,
              ${ACTIVE_LIEN_SQL('$1::uuid')} as lien,
              ${recoveryHoldHidesSql('$1::uuid')} as recovery`,
      [accountId],
    );
    // Hold model v3's recovery-code hold before main's pending review: the account-wide hold is the
    // reason while it lasts (its sessions cannot rate a trade meanwhile anyway).
    const accountHidden = why[0]!.paused
      ? 'trading-paused'
      : why[0]!.held
        ? 'trading-hold'
        : why[0]!.lien
          ? 'lien'
          : why[0]!.recovery
            ? 'recovery-hold'
            : (await hasPendingReview(deps.db, accountId, deps.clock()))
              ? 'review-pending'
              : null;
    const flex = await loadFlex(deps.db, rows.map((r) => r.id));
    return rows.map((r) => {
      const f = flex.get(r.id)!;
      const first = f.methods[0]!;
      // Each currency priced as a card without an amount: its best band, the first method offered in it.
      const priced = f.currencies.map((c) => {
        const m = f.methods.find((x) => x.currencies.includes(c.currency))!;
        return { currency: c.currency, tiers: c.tiers, ...priceFor(r.side, r.amount_unit, c.tiers, c.currency, m, null, deps.prices, null) };
      });
      const head = priced[0]!;
      const out: MyOffer = {
        id: r.id, side: r.side, methodId: first.methodId, methodName: getMethod(first.methodId)?.name ?? first.methodId,
        currency: head.currency, rate: head.rate === null ? null : head.rate.toString(),
        pricing: head.pricing,
        ...amountsOf(r.amount_unit, head.tiers, head.currency, head.rate),
        tiers: head.tiers.map(copyTier),
        currencies: priced.map((c) => ({ currency: c.currency, rate: c.rate === null ? null : c.rate.toString(), tiers: c.tiers.map(copyTier) })),
        methods: f.methods.map((m) => ({
          methodId: m.methodId, methodName: getMethod(m.methodId)?.name ?? m.methodId, adjustBps: m.adjustBps, instructions: m.instructions,
          currencies: [...m.currencies], instructionsByCurrency: { ...m.byCurrency }, payWindowMin: tradeProfile(m.methodId).payWindowMin,
        })),
        status: r.status as 'live' | 'paused',
        payWindowMin: tradeProfile(first.methodId).payWindowMin,
        createdAt: r.created_at.toISOString(),
      };
      if (r.country !== null) out.country = r.country;
      if (r.status === 'live') {
        // Task 34 review M4: none of its currencies has a market price now, so no list shows it (owner Q5).
        const hidden =
          accountHidden ??
          (!f.methods.some((m) => isAvailable(m.methodId)) ? 'method-unavailable'
          : f.currencies.every((c) => deps.prices.current(c.currency) === null) ? 'no-price'
          : null);
        if (hidden !== null) out.hidden = hidden;
      }
      return out;
    });
  });

  /**
   * Task 36: `POST /v1/account/offers/status { ids: string[] | 'all', status: 'live' | 'paused' }`
   * turns some or all of my offers on or off → `{ status, results: OfferSwitchResult[] }`.
   *
   * Decided (Task 36 builder, 2026-10-29): **per-offer results in one transaction**, not
   * all-or-nothing. Every offer that may switch does, every one that may not stays as it was and is
   * named with its reason; the reply is 200 even when every offer was refused. Turning on runs the
   * relist guards for each offer (paused site, trading hold, no usable wallet, the caps counted as
   * relisting counts them, its methods' availability, the launch cap over every band of every
   * currency), in PATCH's order: methods, account, caps, launch cap.
   * Turning off has no guard: it always succeeds, under a hold, during an emergency stop and on a
   * stale Terms version too (R10 lead decision 2026-10-29); turning on needs the current Terms
   * (403 `terms-required` for the whole call). The web always sends explicit ids (review M1) in
   * batches of at most SWITCH_MAX_IDS (M5); `'all'` stays for other clients. Removed offers and other accounts' offers are
   * never touched (`not-found` when named). An offer already in the asked status counts as done.
   *
   * Locks follow Task 4's order: the account row `for update` first (so this and any post, relist or
   * take of the account run one at a time), then site_flags `for share` (turning on only), then the
   * account's offer rows `for update`.
   */
  app.post('/v1/account/offers/status', { preHandler: requirePauseOffers }, async (req) => {
    const deps = req.server.deps;
    const body = req.body;
    if (!isObject(body) || Object.keys(body).sort().join(',') !== 'ids,status') throw bad();
    const status = body.status;
    if (status !== 'live' && status !== 'paused') throw bad();
    const ids = body.ids;
    let wanted: string[] | 'all';
    if (ids === 'all') wanted = 'all';
    // An id that is not a (lower-case) UUID is not-found, as PATCH answers 404 for it (review N2).
    else if (Array.isArray(ids) && ids.length >= 1 && ids.length <= SWITCH_MAX_IDS && ids.every((i) => typeof i === 'string' && i.length <= 64)) {
      wanted = [...new Set(ids as string[])];
    } else throw bad();
    const accountId = req.auth!.accountId;
    // Turning off works on stale Terms (R10 lead decision 2026-10-29); turning on does not.
    if (status === 'live') await assertTermsCurrent(deps, req.auth!);
    // Task 17: no offer goes on during the account's 24-hour hold (403 `recovery-hold` for the whole call).
    if (status === 'live') {
      const until = await holdUntil(deps, accountId, req.server.events);
      if (until !== null) throw holdRefusal(until);
    }
    const now = deps.clock();

    const results = await inTransaction(deps.db, async (client) => {
      await lockAccountLive(client, req.auth!, now);
      const refusedAll = status === 'live' ? await accountRefusal(client, accountId, now) : null;
      const caps = status === 'live' ? await loadOfferCaps(client) : null;
      // Every live or paused offer of mine (the caps count them all), newest first as on the list.
      // An offer's methods are in offer_methods, written once at post (never changed).
      const { rows: mine } = await client.query<{ id: string; side: Side; amount_unit: AmountUnit; methods: string[]; status: 'live' | 'paused'; market: boolean }>(
        `select o.id, o.side, o.amount_unit, o.status, ${MARKET_PRICED} as market,
                array(select m.method_id from offer_methods m where m.offer_id = o.id order by m.position) as methods
           from offers o where o.account_id = $1 and o.status <> 'removed'
          order by o.created_at desc, o.id for update of o`,
        [accountId],
      );
      // Their currencies and bands, for the launch cap (turning on only; written once at post).
      const flex = status === 'live' ? await loadFlex(client, mine.map((o) => o.id)) : null;
      // J-20: a team member's trade-size band (turning on only; null for the owner or no band).
      const band = status === 'live' ? await memberBand(client, req.auth!.memberId) : null;
      // A row stored as fixed (MARKET_PRICED) is never switched: not-found, as PATCH answers. The caps
      // still count it, as assertMayPost does (J-02 leaves the caps alone).
      const byId = new Map(mine.filter((o) => o.market).map((o) => [o.id, o]));
      const targets = wanted === 'all' ? [...byId.keys()] : wanted;
      const out: OfferSwitchResult[] = [];
      const switched: string[] = [];
      for (const id of targets) {
        const o = byId.get(id);
        if (!o) {
          out.push({ id, refused: 'not-found' });
          continue;
        }
        if (o.status === status) {
          out.push({ id, status });
          continue;
        }
        if (status === 'live') {
          // PATCH's order (review N1): the methods first (every one may be offered now, as at post),
          // then the account's guards, then the caps.
          let refused: OfferSwitchRefusal | null = o.methods.every((m) => isAvailable(m)) ? refusedAll : 'method-unavailable';
          if (refused === null) {
            // As relisting counts: every other live or paused offer of mine on this side (this one left out).
            let same = 0;
            for (const x of mine) if (x.id !== id && x.side === o.side) same++;
            if (same >= caps![o.side]) refused = 'too-many-offers';
          }
          // Then the launch cap, as relisting checks it (launch-rules review F1): every band of every
          // currency; an unpriced currency is skipped and stays hidden (OWNER QUESTION p11-95).
          if (refused === null) refused = offerLaunchCapRefusal(o.amount_unit, flex!.get(id)!.currencies, deps.prices, true);
          // J-20 review F2: a member's band, per offer, so one offer outside it does not fail the batch.
          if (refused === null && !(await offerInsideBand(client, band, id))) refused = 'outside-trade-band';
          if (refused !== null) {
            out.push({ id, status: o.status, refused });
            continue;
          }
        }
        switched.push(id);
        out.push({ id, status });
      }
      if (switched.length > 0) {
        await client.query(`update offers set status = $2, updated_at = $3 where account_id = $1 and id = any($4::uuid[]) and status <> 'removed'`, [
          accountId, status, now, switched,
        ]);
        // Task 18: one audit row per offer a team member switched, in this transaction.
        for (const id of switched) {
          await auditMember(client, req.auth!, { action: status === 'paused' ? 'offer-paused' : 'offer-relisted', offerId: id }, now);
        }
      }
      return out;
    });
    return { status, results };
  });
}
