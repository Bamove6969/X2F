import { apply, MAX_CONFIRM_WINDOW_MIN, newTrade, TradeRuleError, type AttestedTerms, type By, type Trade, type TradeEvent } from '@x2f/trade';

/**
 * The moderation service's shadow Trade (Plan 3 Task 10): its own copy of the trade, built from the
 * deal it attested and fed ONLY by its own chain watcher (setup-done, chain, settled) and by
 * signals it opened itself (trade.paid, trade.extend, trade.refund-request, trade.cancel), through
 * the same pure `apply` the API uses, on this service's clock. The auto-refund guard reads payBy,
 * paidAt and finalAlertAt from here, never from the API: a lying API can delay a refund, never
 * cause one.
 *
 * Fields the attested deal does not carry are filled so they can never loosen a rule: the offer's
 * minimum (1 minor unit: only growth reads the limits, and it reads the maximum), the confirm window
 * (the longest the machine allows, MAX_CONFIRM_WINDOW_MIN; only disputes after paid read it), placeholder ids. The trade's code is the
 * real one.
 */
export function newShadow(code: string, terms: AttestedTerms, takenAt: Date): Trade {
  const d = terms.deal;
  return newTrade(
    {
      code,
      offerId: 'shadow',
      poster: d.poster,
      sellerId: 'seller',
      buyerId: 'buyer',
      methodId: 'shadow',
      amountAtomic: BigInt(d.takeAmountAtomic),
      lockedRate: { currency: d.currency, centsPerXmr: BigInt(d.centsPerXmr) },
      confirmWindowMin: MAX_CONFIRM_WINDOW_MIN,
      minFiatCents: 1n,
      maxFiatCents: BigInt(d.maxFiatCents),
    },
    takenAt,
  );
}

/** Applies one event; the rule code instead of the next trade when the machine refuses it. */
export function applyShadow(t: Trade, e: TradeEvent, by: By, now: Date): { trade: Trade; refused: null } | { trade: Trade; refused: string } {
  try {
    return { trade: apply(t, e, by, now), refused: null };
  } catch (err) {
    if (err instanceof TradeRuleError) return { trade: t, refused: err.code };
    if (err instanceof RangeError) return { trade: t, refused: 'bad-event' };
    throw err;
  }
}

/** JSON with bigints and Dates tagged (`{ $bigint }`, `{ $date }`), for the desk record. */
export function toJson(v: unknown): unknown {
  if (typeof v === 'bigint') return { $bigint: v.toString() };
  if (v instanceof Date) return { $date: v.toISOString() };
  if (Array.isArray(v)) return v.map(toJson);
  if (v !== null && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toJson(x)]));
  return v;
}

const BIGINT = /^-?(0|[1-9]\d{0,40})$/;

export function fromJson(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(fromJson);
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 1 && typeof o.$bigint === 'string') {
      if (!BIGINT.test(o.$bigint)) throw new RangeError('bad desk record');
      return BigInt(o.$bigint);
    }
    if (keys.length === 1 && typeof o.$date === 'string') {
      const d = new Date(o.$date);
      if (Number.isNaN(d.getTime())) throw new RangeError('bad desk record');
      return d;
    }
    return Object.fromEntries(keys.map((k) => [k, fromJson(o[k])]));
  }
  return v;
}
