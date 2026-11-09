import { MAX_MARGIN_BPS, rateFor, type Price, type Side } from './money.js';
import type { AmountUnit, OfferRange } from './offerRange.js';

/**
 * Plan 3 Tasks 34/35, flexible offers, rebuilt for J-16 (9 Nov 2026) from claude2's Task 34
 * (owner 29 Oct; several currencies 2 Nov) with the owner's later numbers.
 *
 * One offer lists up to MAX_CURRENCIES currencies, each with its own price bands by amount, and up
 * to MAX_METHODS payment methods; the buyer picks a currency and a method at take. There is no
 * conversion between the offer's currencies: the vendor types each currency's bands. Pricing is
 * market ± X% only (owner Q1, 6 Nov; there are no fixed-price offers).
 *
 * - A band (`Band`) is typed in the offer's amount unit (owner 8 Nov, "Offer amounts in XMR or
 *   fiat"; one unit per offer). In fiat, whole units of its currency: the bands of a currency cover
 *   one stretch with no gap, a next band starting one unit after the previous one ends (owner 2 Nov:
 *   200-500 then 501-800; O-018). In XMR (atomic units) a currency has one band: LEAD DEFAULT until
 *   the owner says how XMR bands follow on (`checkBands` 'xmr-one-band').
 * - At most MAX_BANDS bands per currency (owner Q23, 6 Nov: 3; O-009).
 * - A band may share amounts with another only when they differ by a condition (owner Q20/F3, 7 Nov,
 *   O-015: "same-amount bands only with modifiers"). Which differences count is a rule
 *   (`BandDifference`), BAND_DIFFER_DEFAULT the lead's list pending the owner (p11-60): a range that
 *   does not overlap, another minimum of completed trades, another margin, or another set of payment
 *   types. Every two bands of a currency must differ by one of the rule's differences.
 * - Each band has its margin over the market, its rule "the taker must have X completed trades" (no
 *   minimum, 5, 10, 25 or 50: owner 8 Nov) and optionally the payment types it is for (absent: all
 *   of the offer's methods in that currency).
 * - A `Tier` is a band as covered: an inclusive range in the unit's minor units (fiat minor units or
 *   atomic). Trade totals are not whole units, so a fiat band reaching up to where another band goes
 *   on covers every total up to just below that next unit; otherwise it ends at its own max exactly
 *   (owner 2 Nov evening: 200-500 covers 200.00-500.99 when a band starts at 501; 800 ends at 800.00).
 * - A method carries an optional price adjustment, a percent of the market (owner via design,
 *   29 Oct b: percent only). The final price is the chosen currency's market + the band's margin +
 *   the method's adjustment, rounded once, half up (`rateFor` of their sum). The API refuses an offer
 *   where any margin + adjustment passes ±MAX_MARGIN_BPS.
 * - When several bands hold an amount (they differ by a condition), a take is priced from the best
 *   one for the taker among those whose rule the taker meets (`pickTier`): LEAD DEFAULT, owner to
 *   confirm with p11-60.
 */

/** At most this many bands per currency (owner Q23, 6 Nov 2026; O-009). */
export const MAX_BANDS = 3;
/** At most this many payment methods per offer (owner Q23, 6 Nov 2026; O-010). */
export const MAX_METHODS = 5;
/** At most this many currencies on one offer (owner 2 Nov 2026, Q8). */
export const MAX_CURRENCIES = 5;
/** A method's price adjustment: at most ±20% (lead default 29 Oct; the owner's example is +2%). */
export const MAX_ADJUST_BPS = 2_000;
/** "Minimum completed trades" choices (owner 8 Nov: "5, 10, 25, 50"); null is no minimum. */
export const BAND_MIN_TRADES = [5, 10, 25, 50] as const;
export type MinTrades = (typeof BAND_MIN_TRADES)[number] | null;

/** How two bands of one currency can differ (owner Q20/F3, the list not settled: p11-60). */
export type BandDifference = 'range' | 'minTrades' | 'margin' | 'methods';
/**
 * The lead's default for "a second band must differ" (pending the owner, p11-60): any of a range
 * that does not overlap, another minimum of completed trades, another margin, another set of
 * payment types. A rule is a list of these; pass another to `checkBands` to change it.
 */
export const BAND_DIFFER_DEFAULT: readonly BandDifference[] = Object.freeze(['range', 'minTrades', 'margin', 'methods']);

/** A band as the vendor types it (whole units in fiat, atomic units in XMR, both ends included). */
export interface Band {
  min: string;
  max: string;
  marginBps: number;
  minTrades: MinTrades;
  /** The payment types this band is for (method ids); absent: every method of the offer in its currency. */
  methodIds?: readonly string[];
}

/** A band as covered (see the header), in the unit's minor units; `methodIds` null: every method. */
export interface Tier {
  min: string;
  max: string;
  marginBps: number;
  minTrades: MinTrades;
  methodIds: string[] | null;
}

export type BandsRefusal = 'bad-band' | 'no-bands' | 'too-many-bands' | 'xmr-one-band' | 'bands-same' | 'gap';

/** A fiat band edge: 1 to 12 whole units, no leading zero (12 digits + an exponent of at most 3 fit 15 digits of minor units). */
const WHOLE = /^[1-9]\d{0,11}$/;
/** An XMR band edge: atomic units, at most 20 digits (as the API's ATOMIC for offers). */
const ATOMIC = /^[1-9]\d{0,19}$/;
const METHOD_ID = /^.{1,64}$/su;

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function bandShape(b: unknown, unit: AmountUnit): b is Band {
  if (!isRecord(b)) return false;
  const keys = Object.keys(b);
  const want = ['min', 'max', 'marginBps', 'minTrades'];
  if (!want.every((k) => keys.includes(k)) || !keys.every((k) => want.includes(k) || k === 'methodIds')) return false;
  const edge = unit === 'xmr' ? ATOMIC : WHOLE;
  if (typeof b.min !== 'string' || !edge.test(b.min) || typeof b.max !== 'string' || !edge.test(b.max)) return false;
  if (BigInt(b.min) > BigInt(b.max)) return false;
  if (typeof b.marginBps !== 'number' || !Number.isSafeInteger(b.marginBps) || Math.abs(b.marginBps) > MAX_MARGIN_BPS) return false;
  if (b.minTrades !== null && !(BAND_MIN_TRADES as readonly unknown[]).includes(b.minTrades)) return false;
  if (b.methodIds !== undefined) {
    const ids = b.methodIds;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_METHODS || new Set(ids).size !== ids.length) return false;
    if (!ids.every((m) => typeof m === 'string' && METHOD_ID.test(m))) return false;
  }
  return true;
}

function overlap(a: Pick<Band, 'min' | 'max'>, b: Pick<Band, 'min' | 'max'>): boolean {
  return BigInt(a.min) <= BigInt(b.max) && BigInt(b.min) <= BigInt(a.max);
}

function sameMethods(a: Band, b: Band): boolean {
  if (a.methodIds === undefined || b.methodIds === undefined) return a.methodIds === b.methodIds;
  return a.methodIds.length === b.methodIds.length && a.methodIds.every((m) => b.methodIds!.includes(m));
}

/** Whether two bands of one currency differ by at least one of `rule`'s differences. */
export function bandsDiffer(a: Band, b: Band, rule: readonly BandDifference[] = BAND_DIFFER_DEFAULT): boolean {
  return (
    (rule.includes('range') && !overlap(a, b)) ||
    (rule.includes('minTrades') && a.minTrades !== b.minTrades) ||
    (rule.includes('margin') && a.marginBps !== b.marginBps) ||
    (rule.includes('methods') && !sameMethods(a, b))
  );
}

function byMin(a: Pick<Band, 'min'>, b: Pick<Band, 'min'>): number {
  const x = BigInt(a.min);
  const y = BigInt(b.min);
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * One currency's bands, or why not (see the header): 1 to MAX_BANDS well-formed bands in any order;
 * in XMR only one; every two differ by `rule`; in fiat no gap (each next band, sorted by its start,
 * starts at most one unit after the furthest end so far). Null when they are fine.
 */
export function checkBands(bands: unknown, unit: AmountUnit, rule: readonly BandDifference[] = BAND_DIFFER_DEFAULT): BandsRefusal | null {
  if (!Array.isArray(bands)) return 'bad-band';
  if (!bands.every((b) => bandShape(b, unit))) return 'bad-band';
  const list = bands as Band[];
  if (list.length === 0) return 'no-bands';
  if (list.length > MAX_BANDS) return 'too-many-bands';
  if (unit === 'xmr' && list.length > 1) return 'xmr-one-band';
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (!bandsDiffer(list[i]!, list[j]!, rule)) return 'bands-same';
  const sorted = [...list].sort(byMin);
  let reach = BigInt(sorted[0]!.max);
  for (const b of sorted.slice(1)) {
    if (BigInt(b.min) > reach + 1n) return 'gap';
    if (BigInt(b.max) > reach) reach = BigInt(b.max);
  }
  return null;
}

/**
 * Valid bands (`checkBands`) as the ranges they cover, sorted by start (a stable sort: the poster's
 * order on a tie), in minor units of a currency with `exponent` decimal places (fiat) or atomic units
 * (XMR, kept as typed). A fiat band whose next unit (max + 1) is inside another band covers up to one
 * minor unit below it; otherwise it ends at its own max.
 */
export function bandsToTiers(bands: readonly Band[], unit: AmountUnit, exponent: number): Tier[] {
  const sorted = [...bands].sort(byMin);
  const methods = (b: Band): string[] | null => (b.methodIds === undefined ? null : [...b.methodIds]);
  if (unit === 'xmr') return sorted.map((b) => ({ min: b.min, max: b.max, marginBps: b.marginBps, minTrades: b.minTrades, methodIds: methods(b) }));
  const u = 10n ** BigInt(exponent);
  return sorted.map((b) => {
    const next = BigInt(b.max) + 1n;
    const goesOn = sorted.some((c) => c !== b && BigInt(c.min) <= next && next <= BigInt(c.max));
    const max = goesOn ? next * u - 1n : BigInt(b.max) * u;
    return { min: (BigInt(b.min) * u).toString(), max: max.toString(), marginBps: b.marginBps, minTrades: b.minTrades, methodIds: methods(b) };
  });
}

/** A tier's covered range as an @x2f/trade OfferRange in `unit` (for `rangeAllows`, `tradeFiatLimits`). */
export function tierRange(unit: AmountUnit, t: Pick<Tier, 'min' | 'max'>): OfferRange {
  return { unit, min: BigInt(t.min), max: BigInt(t.max) };
}

/** The sizes of a take: its XMR amount and its fiat total (at the quoted rate). */
export interface TakeSizes {
  amountAtomic: bigint;
  fiatCents: bigint;
}

/** Whether the tier holds the take: by its fiat total in fiat, by its XMR amount in XMR (both ends included). */
export function tierHolds(unit: AmountUnit, t: Pick<Tier, 'min' | 'max'>, s: TakeSizes): boolean {
  const v = unit === 'xmr' ? s.amountAtomic : s.fiatCents;
  return BigInt(t.min) <= v && v <= BigInt(t.max);
}

function offersMethod(t: Pick<Tier, 'methodIds'>, methodId: string): boolean {
  return t.methodIds === null || t.methodIds.includes(methodId);
}

/** The best of `tiers` for the taker by margin (the rate follows it): a sell ad's lowest, a buy ad's highest; the first on a tie. */
function bestForTaker<T extends Pick<Tier, 'marginBps'>>(tiers: readonly T[], side: Side): T {
  let best = tiers[0]!;
  for (const t of tiers) if (side === 'buy' ? t.marginBps > best.marginBps : t.marginBps < best.marginBps) best = t;
  return best;
}

export type TierPick<T extends Tier = Tier> = { tier: T } | { refused: 'out-of-range' } | { refused: 'not-enough-trades'; minTrades: number };

/**
 * The band a take is priced from (see the header): of `tiers` (one currency's) holding the take and
 * offered with `methodId`, those whose rule a taker with `completed` trades meets, the best for the
 * taker. 'out-of-range' when no band holds it with this method; 'not-enough-trades' with the lowest
 * rule among them when the taker meets none.
 */
export function pickTier<T extends Tier>(tiers: readonly T[], unit: AmountUnit, s: TakeSizes, methodId: string, side: Side, completed: number): TierPick<T> {
  const holding = tiers.filter((t) => tierHolds(unit, t, s) && offersMethod(t, methodId));
  if (holding.length === 0) return { refused: 'out-of-range' };
  const open = holding.filter((t) => (t.minTrades ?? 0) <= completed);
  if (open.length === 0) return { refused: 'not-enough-trades', minTrades: Math.min(...holding.map((t) => t.minTrades ?? 0)) };
  return { tier: bestForTaker(open, side) };
}

/**
 * The band a card without an amount is priced from: of the bands offered with `methodId`, those a
 * viewer with `completed` trades qualifies for (or, when none, those with the lowest rule, so a card
 * still shows a rate), the best for the taker. `completed` null: every band (the poster's own view).
 * Null when no band is offered with the method.
 */
export function headlineTier<T extends Tier>(tiers: readonly T[], methodId: string, side: Side, completed: number | null): T | null {
  const offered = tiers.filter((t) => offersMethod(t, methodId));
  if (offered.length === 0) return null;
  if (completed === null) return bestForTaker(offered, side);
  const lowest = Math.min(...offered.map((t) => t.minTrades ?? 0));
  return bestForTaker(offered.filter((t) => (t.minTrades ?? 0) <= Math.max(completed, lowest)), side);
}

/**
 * One band's price with one method in `currency`: market + margin + adjustment, or null while that
 * currency has no market price (or `market` is another currency's). Throws RangeError when margin +
 * adjustment passes ±MAX_MARGIN_BPS.
 */
export function tierRate(currency: string, tier: Pick<Tier, 'marginBps'>, method: { adjustBps: number }, market: Price | null): Price | null {
  if (market === null || market.currency !== currency) return null;
  return rateFor(market, tier.marginBps + method.adjustBps);
}
