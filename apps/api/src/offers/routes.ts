import { MAX_MARGIN_BPS, fiatCents, offerRate, rangeInBoth, type AmountUnit, type OfferRange, type Price, type Pricing, type Side } from '@x2f/trade';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Deps } from '../app.js';
import { requireInside } from '../auth/frontDoor.js';
import { requireSession } from '../auth/sessions.js';
import { holdRefusal, holdUntil, requireLiveSessionInTx, requireNotHeld } from '../auth/hold.js';
import type { AuthContext } from '../auth/sessions.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { auditMember } from '../team/audit.js';
import { getMethod, isAvailable } from '../methods/profiles.js';
import type { LiveOfferStats } from '../methods/routes.js';
import { currencyExponent } from '../price/currencies.js';
import type { MarketPrices } from '../price/market.js';
import { blockedEitherWaySql } from '../traders/blocks.js';
import { COMPLETED_TRADES_SQL, loadStarterSettings, opensAt, tradeCap, usdCentsOf } from '../traders/stage.js';
import { hasPendingReview, pendingReviewSql } from '../reviews/gate.js';
import { lastSeenSql, onlineSince, traderSummaries, type TraderSummary } from '../traders/summary.js';
import { usableWallets } from '../wallets/routes.js';
import { accountTypeOf, assertVendor } from '../routes/accountType.js';

/**
 * Plan 3 Task 4: offers (ads).
 *
 * - `POST /v1/offers` (`requireTrader`) → 201 `{ id }`. Only a vendor account posts or turns on
 *   offers (owner 2 Nov 2026; 403 `not-vendor`, routes/accountType.ts).
 * - `PATCH /v1/offers/:id { status }` (the poster only) → `{ id, status }`.
 * - `GET /v1/offers?side&method&currency&sort=best|online|trades` (no session, P3-M9) → `OfferCard[]`.
 * - `GET /v1/offers/:id` (no session) → `OfferDetail`; a paused offer only to its poster.
 * - Task 36: `GET /v1/account/offers` (`requireTrader`) → `MyOffer[]`, and
 *   `POST /v1/account/offers/status { ids: string[] | 'all', status }` → per-offer results.
 *
 * A signed-in trader never sees the offers of someone they blocked or who blocked them (Task 37,
 * traders/blocks.ts): the list leaves them out and the single-offer route answers 404.
 *
 * `side` is the ads' own side, what the poster does with XMR: someone buying XMR browses
 * `side=sell`. Amounts and prices are decimal strings (bigints), fiat in the currency's minor units.
 *
 * Trade size (owner, 8 Nov 2026, "Offer amounts in XMR or fiat"): an offer keeps its range in the
 * unit its poster chose, `amountUnit` 'xmr' (`minAtomic`/`maxAtomic`, atomic units) or 'fiat'
 * (`minFiatCents`/`maxFiatCents`). POST takes only its own unit's pair (no `amountUnit` is 'fiat',
 * as before). Every answer carries both pairs: the poster's own exactly, the other converted at the
 * offer's rate now (@x2f/trade `rangeInBoth`: the margin included, as the take locks it), or null
 * while there is no rate (a market offer with the feed down). The take checks the size in the
 * poster's unit at the rate it locks (`rangeAllows`, trades/take.ts).
 */

export interface OfferCard {
  id: string;
  poster: TraderSummary;
  /** The offer's price per XMR now (`offerRate`); null for a market offer while the feed is down. */
  rate: string | null;
  /** Always the market price moved by the margin (owner Q1, F1: there are no fixed-price offers). */
  pricing: { mode: 'market'; marginBps: number };
  /** The unit the poster set the range in; that pair is exact, the other is converted (see above). */
  amountUnit: AmountUnit;
  minAtomic: string | null;
  maxAtomic: string | null;
  minFiatCents: string | null;
  maxFiatCents: string | null;
  /** The completed trades a taker needs: 5, 10, 25 or 50, or null for no minimum (owner, 8 Nov). */
  minTrades: MinTrades;
  /** Gift-card offers only: the card's country, ISO 3166-1 alpha-2 (Revision 2026-10-27). */
  country?: string;
  /**
   * For a signed-in trader whose starter-limit cap is below the offer's minimum: the stage that
   * opens it (Revision 2026-10-24). Absent otherwise, and while the currency has no market price
   * to convert the minimum to US dollars (the take checks the cap again).
   */
  opensAt?: 'building' | 'graduated';
}

export interface OfferDetail extends OfferCard {
  side: Side;
  methodId: string;
  currency: string;
  terms: string;
  status: OfferStatus;
}

export type OfferStatus = 'live' | 'paused' | 'removed';

/** One of my offers on `GET /v1/account/offers` (Task 36): live or paused, never removed. */
export interface MyOffer {
  id: string;
  side: Side;
  methodId: string;
  /** The catalog's name for the method (the id when the catalog no longer has it). */
  methodName: string;
  currency: string;
  /** The offer's price per XMR now (`offerRate`); null for a market offer while the feed is down. */
  rate: string | null;
  pricing: OfferCard['pricing'];
  amountUnit: AmountUnit;
  minAtomic: string | null;
  maxAtomic: string | null;
  minFiatCents: string | null;
  maxFiatCents: string | null;
  minTrades: MinTrades;
  country?: string;
  status: 'live' | 'paused';
  /**
   * A live offer that nobody can see right now, and why (review M4): the site's emergency stop,
   * the account's trading hold, a trade it has not rated yet (Plan 5 Task 3, P5-A4; review round 1
   * M3), or its method under legal review. Absent when the offer is listed or paused.
   */
  hidden?: 'trading-paused' | 'trading-hold' | 'review-pending' | 'method-unavailable';
  createdAt: string;
}

/**
 * Why one offer was not switched by `POST /v1/account/offers/status`: the posting guards of
 * relisting (`not-vendor`, `trading-paused`, `trading-hold`, `no-wallet`, `too-many-offers`, `method-unavailable`),
 * or `not-found` for an id that is not one of my live or paused offers.
 */
export type OfferSwitchRefusal = 'not-vendor' | 'trading-paused' | 'trading-hold' | 'no-wallet' | 'too-many-offers' | 'method-unavailable' | 'not-found';

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
/**
 * "Minimum completed trades" is a fixed choice (owner, 8 Nov: "This will be 5, 10, 25, 50"): null is
 * no minimum (the default). Migration 315 moved every stored value down to the next lower choice.
 */
export const MIN_TRADES_CHOICES = [5, 10, 25, 50] as const;
export type MinTrades = (typeof MIN_TRADES_CHOICES)[number] | null;
const STATUSES = ['live', 'paused', 'removed'] as const;
export const TERMS_MAX = 4000;
/** Fiat amounts: at most 14 digits of minor units (the web form takes 12 whole digits and 2 decimals). */
const FIAT = /^\d{1,14}$/;
/** XMR amounts: atomic units, at most 20 digits (100 million XMR, far above the supply). */
const ATOMIC = /^\d{1,20}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/**
 * Refused in terms (review M2): C0 controls but newline and tab, DEL, C1 controls, and the bidi
 * embeddings, overrides and isolates (U+202A-202E, U+2066-2069), which can make text read in a
 * different order than it was written. Other format characters stay allowed: the zero-width
 * joiner inside emoji, soft hyphens, tag characters in flags. A CR or CRLF is stored as LF.
 * apps/web/src/screens/post/offerForm.ts mirrors this rule.
 */
export const BAD_TERMS_CHAR = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
/**
 * At most this many cards per list (a backstop: the per-account caps below keep lists short, and
 * the list is sorted by the database before the limit).
 */
const LIST_LIMIT = 500;

/**
 * Per-account offer caps (review I1; owner 6 Nov 2026, Q31): at most this many buying and this many
 * selling offers per account in all, whatever their methods and currencies. Live and paused offers
 * count (a paused one is not a way past the cap), removed ones do not. Owner settings override these
 * defaults.
 */
export const OFFER_CAP_DEFAULTS = Object.freeze({ buy: 3, sell: 3 });
export const OFFER_CAP_KEYS = Object.freeze({ buy: 'offers_max_buy', sell: 'offers_max_sell' });
const OFFER_CAP_MAX = 1000;

interface OfferRow {
  id: string;
  account_id: string;
  side: Side;
  method_id: string;
  currency: string;
  margin_bps: number;
  amount_unit: AmountUnit;
  min_atomic: string | null;
  max_atomic: string | null;
  min_fiat_cents: string | null;
  max_fiat_cents: string | null;
  min_trades: MinTrades;
  terms: string;
  country: string | null;
  status: OfferStatus;
}

const OFFER_COLUMNS = `o.id, o.account_id, o.side, o.method_id, o.currency, o.margin_bps,
  o.amount_unit, o.min_atomic, o.max_atomic, o.min_fiat_cents, o.max_fiat_cents, o.min_trades, o.terms, o.country, o.status`;

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
  and not coalesce((select f.trading_paused from site_flags f), true)`;

/**
 * Plan 5 Task 3 (P5-A4): an offer whose poster has a pending review is left out of every list, count
 * and single-offer read until they rate, so takers are never stranded (the take refuses it too).
 * `now` is the SQL parameter bound from the clock.
 */
const posterRated = (now: string): string => `not ${pendingReviewSql('o.account_id', now)}`;

/**
 * The offer's rate now in SQL, with the currency's market price bound as `param` (null while the feed
 * has none): the same number as @x2f/trade's `offerRate` (rateFor rounds half up:
 * (market × (10000 + margin) × 2 + 10000) div 20000), so the database can sort before the limit.
 * `div` is exact integer division; numeric `/` rounds its quotient to about 16 significant digits,
 * so from rates near 10^16 a `floor(… / 20000)` came out 1 above offerRate (round-2 review Minor 1).
 * Exported for the parity test.
 */
export function rateSql(param: string): string {
  return `(case when ${param}::numeric is null then null
    else div(${param}::numeric * (10000 + o.margin_bps) * 2 + 10000, 20000) end)`;
}

function pricingOf(r: Pick<OfferRow, 'margin_bps'>): Pricing {
  return { mode: 'market', marginBps: r.margin_bps };
}

function rateOf(r: OfferRow, prices: MarketPrices): bigint | null {
  return offerRate(pricingOf(r), r.currency, prices.current(r.currency))?.centsPerXmr ?? null;
}

/** The poster's range in the poster's unit, as stored. */
export function rangeOf(r: Pick<OfferRow, 'amount_unit' | 'min_atomic' | 'max_atomic' | 'min_fiat_cents' | 'max_fiat_cents'>): OfferRange {
  return r.amount_unit === 'xmr'
    ? { unit: 'xmr', min: BigInt(r.min_atomic!), max: BigInt(r.max_atomic!) }
    : { unit: 'fiat', min: BigInt(r.min_fiat_cents!), max: BigInt(r.max_fiat_cents!) };
}

/** Both pairs for an answer: the poster's own exactly, the other at `rate` (the offer's rate now) or null without one. */
function amountsOf(r: OfferRow, rate: bigint | null): Pick<OfferCard, 'amountUnit' | 'minAtomic' | 'maxAtomic' | 'minFiatCents' | 'maxFiatCents'> {
  const range = rangeOf(r);
  const own = range.unit === 'xmr'
    ? { minAtomic: range.min.toString(), maxAtomic: range.max.toString(), minFiatCents: null, maxFiatCents: null }
    : { minAtomic: null, maxAtomic: null, minFiatCents: range.min.toString(), maxFiatCents: range.max.toString() };
  if (rate === null) return { amountUnit: range.unit, ...own };
  const both = rangeInBoth(range, { currency: r.currency, centsPerXmr: rate });
  return {
    amountUnit: range.unit,
    minAtomic: both.minAtomic.toString(),
    maxAtomic: both.maxAtomic.toString(),
    minFiatCents: both.minFiat.toString(),
    maxFiatCents: both.maxFiat.toString(),
  };
}

/** The offer's smallest trade in fiat at its rate now (the starter caps' measure), or null without a rate. */
function minFiatNow(r: OfferRow, prices: MarketPrices): bigint | null {
  if (r.amount_unit === 'fiat') return BigInt(r.min_fiat_cents!);
  const rate = rateOf(r, prices);
  return rate === null ? null : fiatCents(BigInt(r.min_atomic!), { currency: r.currency, centsPerXmr: rate } satisfies Price);
}

function toCard(r: OfferRow, poster: TraderSummary, rate: bigint | null): OfferCard {
  const p = pricingOf(r);
  const card: OfferCard = {
    id: r.id,
    poster,
    rate: rate === null ? null : rate.toString(),
    pricing: { mode: 'market', marginBps: p.marginBps },
    ...amountsOf(r, rate),
    minTrades: r.min_trades,
  };
  if (r.country !== null) card.country = r.country;
  return card;
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
  methodId: string;
  currency: string;
  pricing: Pricing;
  range: OfferRange;
  minTrades: MinTrades;
  terms: string;
  country: string | null;
}

/**
 * `{ mode: 'market', marginBps }`, a whole number of basis points at most 50% above or below the
 * market (owner F1, 7 Nov: ±5000). Anything else is 400, a fixed price included (owner Q1: there
 * are no fixed-price offers).
 */
function parsePricing(v: unknown): Pricing {
  if (!isObject(v) || v.mode !== 'market' || Object.keys(v).sort().join(',') !== 'marginBps,mode') throw bad();
  const m = v.marginBps;
  if (typeof m !== 'number' || !Number.isSafeInteger(m) || Math.abs(m) > MAX_MARGIN_BPS) throw bad();
  return { mode: 'market', marginBps: m };
}

/** A positive whole amount as a decimal string matching `re`. */
function amount(v: unknown, re: RegExp): bigint {
  if (typeof v !== 'string' || !re.test(v)) throw bad();
  const n = BigInt(v);
  if (n <= 0n) throw bad();
  return n;
}

/**
 * The trade size: `amountUnit` 'xmr' with `minAtomic`/`maxAtomic`, or 'fiat' (also when absent, as
 * before 8 Nov) with `minFiatCents`/`maxFiatCents`; the other unit's keys are refused.
 */
function parseRange(b: Record<string, unknown>): OfferRange {
  const unit = b.amountUnit === undefined ? 'fiat' : b.amountUnit;
  if (unit === 'xmr') {
    if (b.minFiatCents !== undefined || b.maxFiatCents !== undefined) throw bad();
    const range: OfferRange = { unit, min: amount(b.minAtomic, ATOMIC), max: amount(b.maxAtomic, ATOMIC) };
    if (range.min > range.max) throw bad();
    return range;
  }
  if (unit !== 'fiat' || b.minAtomic !== undefined || b.maxAtomic !== undefined) throw bad();
  const range: OfferRange = { unit, min: amount(b.minFiatCents, FIAT), max: amount(b.maxFiatCents, FIAT) };
  if (range.min > range.max) throw bad();
  return range;
}

/** The body's shape; the method's availability and the gift-card country are checked by the caller. */
function parseNewOffer(body: unknown): NewOffer & { countryGiven: unknown } {
  if (!isObject(body)) throw bad();
  const { side, methodId, currency, pricing, amountUnit, minAtomic, maxAtomic, minFiatCents, maxFiatCents, minTrades, terms, country, ...rest } = body;
  if (Object.keys(rest).length > 0) throw bad();
  if (side !== 'sell' && side !== 'buy') throw bad();
  if (typeof methodId !== 'string' || methodId.length === 0 || methodId.length > 64) throw bad();
  if (typeof currency !== 'string' || currencyExponent(currency) === null) throw bad();
  const range = parseRange({ amountUnit, minAtomic, maxAtomic, minFiatCents, maxFiatCents });
  if (minTrades !== null && !(MIN_TRADES_CHOICES as readonly unknown[]).includes(minTrades)) throw bad();
  if (typeof terms !== 'string') throw bad();
  const cleanTerms = terms.replace(/\r\n?/g, '\n').trim();
  if ([...cleanTerms].length > TERMS_MAX || BAD_TERMS_CHAR.test(cleanTerms)) throw bad();
  return {
    side, methodId, currency, pricing: parsePricing(pricing), range, minTrades: minTrades as MinTrades,
    terms: cleanTerms, country: null, countryGiven: country,
  };
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
type AccountRefusal = 'not-vendor' | 'trading-paused' | 'trading-hold' | 'no-wallet';
async function accountRefusal(client: Queryable, accountId: string, now: Date): Promise<AccountRefusal | null> {
  if ((await accountTypeOf(client, accountId)) !== 'vendor') return 'not-vendor';
  const flags = await client.query<{ trading_paused: boolean }>('select trading_paused from site_flags for share');
  // No site_flags row fails closed.
  if (flags.rows[0]?.trading_paused !== false) return 'trading-paused';
  const held = await client.query('select 1 from trading_holds where account_id = $1 and lifted_at is null limit 1', [accountId]);
  if ((held.rowCount ?? 0) > 0) return 'trading-hold';
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

// Posting, pausing, relisting and removing: the account owner, or a team member with Offers (Task 18).
const requireTrader = requireSession({ kinds: ['trader'], member: 'offers' });
/**
 * Turning offers off, and reading my own offers, work on a stale Terms version too (lead decision
 * 2026-10-29 on R10: shutting things off never waits for new Terms). Anything that puts an offer
 * live still needs the current Terms (`assertTermsCurrent`); removing one is shutting off too
 * (round-2 review m1, lead decision 2026-10-29). A team member with Offers may do these too (Task 18).
 */
const requireTraderStaleOk = requireSession({ kinds: ['trader'], allowStaleTerms: true, member: 'offers' });

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
 * rates match the lists they open.
 */
export function liveOfferStats(deps: Pick<Deps, 'db' | 'prices' | 'clock'>): LiveOfferStats {
  return async ({ side, currency, viewerId = null }) => {
    const market = deps.prices.current(currency)?.centsPerXmr ?? null;
    const { rows } = await deps.db.query<{ method_id: string; offers: number; lo: string | null; hi: string | null }>(
      `select o.method_id, count(*)::int as offers, min(r.rate) as lo, max(r.rate) as hi
         from offers o join accounts a on a.id = o.account_id cross join lateral (select ${rateSql('$3')} as rate) r
        where ${LISTED} and ${posterRated('$5::timestamptz')} and o.side = $1 and o.currency = $2
          and not ${blockedEitherWaySql('o.account_id', '$4::uuid')}
        group by o.method_id`,
      [side, currency, market === null ? null : market.toString(), viewerId, deps.clock()],
    );
    return rows.map((r) => {
      // Buy ads pay the seller: the best is the highest. Sell ads charge the buyer: the lowest.
      const best = side === 'buy' ? r.hi : r.lo;
      return { methodId: r.method_id, offers: r.offers, bestCentsPerXmr: best === null ? null : BigInt(best) };
    });
  };
}

/** Adds `opensAt` to each card above the viewer's cap (Revision 2026-10-24). */
async function markOpensAt(deps: Deps, viewerId: string, rows: readonly OfferRow[], cards: OfferCard[]): Promise<void> {
  const settings = await loadStarterSettings(deps.db);
  const cap = await tradeCap(deps.db, viewerId, deps.clock(), settings);
  if (cap.capUsdCents === null) return;
  rows.forEach((r, i) => {
    // Never on the viewer's own offers (review M7).
    if (r.account_id === viewerId) return;
    const q = deps.prices.quote(r.currency);
    if (q === null) return;
    // An XMR range's smallest trade in fiat at the offer's rate now (the take checks the cap again).
    const min = minFiatNow(r, deps.prices);
    if (min === null) return;
    const usd = usdCentsOf(min, { centsPerXmr: q.price.centsPerXmr, usdCentsPerXmr: q.usdCentsPerXmr });
    const at = opensAt(settings, cap.stage, usd);
    if (at !== undefined) cards[i]!.opensAt = at;
  });
}

export function offerRoutes(app: FastifyInstance): void {
  app.post('/v1/offers', { preHandler: [requireTrader, requireNotHeld] }, async (req, reply) => {
    const deps = req.server.deps;
    const o = parseNewOffer(req.body);
    const method = getMethod(o.methodId);
    if (method === null) throw bad();
    assertMethodAvailable(o.methodId);
    // A gift-card offer names the card's country; no other offer has one (Revision 2026-10-27).
    if (method.giftCard) {
      if (typeof o.countryGiven !== 'string' || !/^[A-Z]{2}$/.test(o.countryGiven)) throw bad();
      o.country = o.countryGiven;
    } else if (o.countryGiven !== undefined) {
      throw bad();
    }
    const accountId = req.auth!.accountId;
    const now = deps.clock();
    const p = o.pricing;
    const id = await inTransaction(deps.db, async (client) => {
      await assertMayPost(client, req.auth!, now, o.side, null);
      const { rows } = await client.query<{ id: string }>(
      `insert into offers (account_id, side, method_id, currency, price_mode, margin_bps,
                           amount_unit, min_atomic, max_atomic, min_fiat_cents, max_fiat_cents, min_trades, terms, country, status, created_at, updated_at)
       values ($1, $2, $3, $4, 'market', $5, $6, $7, $8, $9, $10, $11, $12, $13, 'live', $14, $14) returning id`,
      [
        accountId, o.side, o.methodId, o.currency, p.marginBps, o.range.unit,
        o.range.unit === 'xmr' ? o.range.min.toString() : null, o.range.unit === 'xmr' ? o.range.max.toString() : null,
        o.range.unit === 'fiat' ? o.range.min.toString() : null, o.range.unit === 'fiat' ? o.range.max.toString() : null,
        o.minTrades, o.terms, o.country, now,
      ],
      );
      // Task 18: a team member's post is in the account owner's audit log, in this transaction.
      await auditMember(client, req.auth, { action: 'offer-posted', detail: { offerId: rows[0]!.id } }, now);
      return rows[0]!.id;
    });
    return reply.code(201).send({ id });
  });

  app.patch('/v1/offers/:id', { preHandler: requireTraderStaleOk }, async (req) => {
    const deps = req.server.deps;
    const id = (req.params as { id: string }).id;
    const body = req.body;
    if (!isObject(body) || Object.keys(body).length !== 1) throw bad();
    const status = body.status;
    if (typeof status !== 'string' || !(STATUSES as readonly string[]).includes(status)) throw bad();
    // Pausing and removing work on stale Terms (R10 lead decisions 2026-10-29: shutting off never
    // waits for new Terms); relisting does not.
    if (status === 'live') await assertTermsCurrent(deps, req.auth!);
    if (!UUID.test(id)) throw new ApiError(404, 'not-found');
    const { rows } = await deps.db.query<{ account_id: string; status: OfferStatus; method_id: string }>(
      `select account_id, status, method_id from offers o where id = $1 and ${MARKET_PRICED}`,
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
      // Relisting is posting again: the same checks, in one transaction with the write (review M1).
      assertMethodAvailable(row.method_id);
      await inTransaction(deps.db, async (client) => {
        const cur = await client.query<{ side: Side; method_id: string; currency: string }>(
          `select side, method_id, currency from offers o where id = $1 and account_id = $2 and status <> 'removed' and ${MARKET_PRICED}`,
          [id, accountId],
        );
        const m = cur.rows[0];
        if (!m) throw new ApiError(404, 'not-found');
        await assertMayPost(client, req.auth!, now, m.side, id);
        if ((await update(client)).rowCount !== 1) throw new ApiError(404, 'not-found');
        await auditMember(client, req.auth, { action: 'offer-relisted', detail: { offerId: id } }, now);
      });
    } else {
      // Pausing or removing: no guard but a live session (review round 5 M2), under the account lock.
      await inTransaction(deps.db, async (client) => {
        await lockAccountLive(client, req.auth!, now);
        if ((await update(client)).rowCount !== 1) throw new ApiError(404, 'not-found');
        await auditMember(client, req.auth, { action: status === 'paused' ? 'offer-paused' : 'offer-removed', detail: { offerId: id } }, now);
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
    if (currency === undefined || !/^[A-Z]{3}$/.test(currency) || sort === undefined) throw bad();
    if (!isAvailable(method)) return [];

    // Sorted by the database before the limit (review I1): the rate from the bound market price,
    // online from the newest live session (as traderSummaries: by bucket, hidden from someone the
    // poster blocked), trades from the completed count; ties newest first.
    const now = deps.clock();
    const viewerId = req.auth!.accountId;
    const market = deps.prices.current(currency)?.centsPerXmr ?? null;
    const byRate = `r.rate ${side === 'buy' ? 'desc' : 'asc'} nulls last`;
    const order =
      sort === 'online' ? `ls.online desc, ${byRate}`
      : sort === 'trades' ? `ct.completed desc, ${byRate}`
      : byRate;
    const { rows } = await deps.db.query<OfferRow>(
      `select ${OFFER_COLUMNS} from offers o join accounts a on a.id = o.account_id
         cross join lateral (select ${rateSql('$4')} as rate) r
         cross join lateral (select coalesce(${lastSeenSql('a.id', '$6::uuid')} >= $5::timestamptz, false) as online) ls
         cross join lateral (select ${COMPLETED_TRADES_SQL} as completed) ct
        where ${LISTED} and ${posterRated('$7::timestamptz')} and o.side = $1 and o.method_id = $2 and o.currency = $3
          and not ${blockedEitherWaySql('o.account_id', '$6::uuid')}
        order by ${order}, o.created_at desc, o.id limit ${LIST_LIMIT}`,
      [side, method, currency, market === null ? null : market.toString(), onlineSince(now), viewerId, now],
    );
    // A sell ad's poster releases; a buy ad's poster pays (the card's typical time, P5-A8).
    const role = side === 'sell' ? 'seller' : 'buyer';
    const posters = await traderSummaries(deps.db, rows.map((r) => r.account_id), now, viewerId, undefined, new Map(rows.map((r) => [r.account_id, role])));
    const entries = rows.map((r) => ({ r, poster: posters.get(r.account_id)!, rate: rateOf(r, deps.prices) }));
    const cards = entries.map((e) => toCard(e.r, e.poster, e.rate));
    await markOpensAt(deps, viewerId, entries.map((e) => e.r), cards);
    return cards;
  });

  app.get('/v1/offers/:id', { preHandler: requireInside }, async (req): Promise<OfferDetail> => {
    const deps = req.server.deps;
    const id = (req.params as { id: string }).id;
    if (!UUID.test(id)) throw new ApiError(404, 'not-found');
    const viewerId = req.auth!.accountId;
    const { rows } = await deps.db.query<OfferRow & { listed: boolean; blocked: boolean }>(
      `select ${OFFER_COLUMNS}, (${LISTED} and ${posterRated('$3::timestamptz')}) as listed, ${blockedEitherWaySql('o.account_id', '$2::uuid')} as blocked
         from offers o join accounts a on a.id = o.account_id where o.id = $1 and ${MARKET_PRICED}`,
      [id, viewerId, deps.clock()],
    );
    const r = rows[0];
    if (!r || r.status === 'removed') throw new ApiError(404, 'not-found');
    const mine = viewerId === r.account_id;
    // A block either way looks exactly like an offer that does not exist (Task 37).
    if (!mine && (r.blocked || !(r.listed && isAvailable(r.method_id)))) throw new ApiError(404, 'not-found');
    const now = deps.clock();
    const poster = (await traderSummaries(deps.db, [r.account_id], now, viewerId, undefined, new Map([[r.account_id, r.side === 'sell' ? 'seller' : 'buyer']]))).get(r.account_id)!;
    const card = toCard(r, poster, rateOf(r, deps.prices));
    if (!mine) await markOpensAt(deps, viewerId, [r], [card]);
    return { ...card, side: r.side, methodId: r.method_id, currency: r.currency, terms: r.terms, status: r.status };
  });

  /**
   * Task 36, My offers: every live and paused offer of mine, newest first. Removed offers are gone.
   */
  app.get('/v1/account/offers', { preHandler: requireTraderStaleOk }, async (req): Promise<MyOffer[]> => {
    const deps = req.server.deps;
    const accountId = req.auth!.accountId;
    const { rows } = await deps.db.query<OfferRow & { created_at: Date }>(
      `select ${OFFER_COLUMNS}, o.created_at from offers o
        where o.account_id = $1 and o.status <> 'removed' and ${MARKET_PRICED} order by o.created_at desc, o.id`,
      [accountId],
    );
    // Why a live offer is not listed now (review M4), in LISTED's terms; no site_flags row is a stop.
    const { rows: why } = await deps.db.query<{ paused: boolean; held: boolean }>(
      `select not coalesce((select f.trading_paused = false from site_flags f), false) as paused,
              exists (select 1 from trading_holds h where h.account_id = $1 and h.lifted_at is null) as held`,
      [accountId],
    );
    const accountHidden = why[0]!.paused
      ? 'trading-paused'
      : why[0]!.held
        ? 'trading-hold'
        : (await hasPendingReview(deps.db, accountId, deps.clock()))
          ? 'review-pending'
          : null;
    return rows.map((r) => {
      const p = pricingOf(r);
      const rate = rateOf(r, deps.prices);
      const out: MyOffer = {
        id: r.id, side: r.side, methodId: r.method_id, methodName: getMethod(r.method_id)?.name ?? r.method_id,
        currency: r.currency, rate: rate === null ? null : rate.toString(),
        pricing: { mode: 'market', marginBps: p.marginBps },
        ...amountsOf(r, rate),
        minTrades: r.min_trades, status: r.status as 'live' | 'paused',
        createdAt: r.created_at.toISOString(),
      };
      if (r.country !== null) out.country = r.country;
      if (r.status === 'live') {
        const hidden = accountHidden ?? (isAvailable(r.method_id) ? null : 'method-unavailable');
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
   * relisting counts them, the method's availability), in PATCH's order: method, account, caps.
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
  app.post('/v1/account/offers/status', { preHandler: requireTraderStaleOk }, async (req) => {
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
      const { rows: mine } = await client.query<{ id: string; side: Side; method_id: string; currency: string; status: 'live' | 'paused'; market: boolean }>(
        `select id, side, method_id, currency, status, ${MARKET_PRICED} as market from offers o where account_id = $1 and status <> 'removed'
          order by created_at desc, id for update`,
        [accountId],
      );
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
          // PATCH's order (review N1): the method first, then the account's guards, then the caps.
          let refused: OfferSwitchRefusal | null = isAvailable(o.method_id) ? refusedAll : 'method-unavailable';
          if (refused === null) {
            // As relisting counts: every other live or paused offer of mine on this side (this one left out).
            let same = 0;
            for (const x of mine) if (x.id !== id && x.side === o.side) same++;
            if (same >= caps![o.side]) refused = 'too-many-offers';
          }
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
          await auditMember(client, req.auth!, { action: status === 'paused' ? 'offer-paused' : 'offer-relisted', detail: { offerId: id } }, now);
        }
      }
      return out;
    });
    return { status, results };
  });
}
