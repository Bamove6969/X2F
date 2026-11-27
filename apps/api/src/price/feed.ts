import type { Price } from '@x2f/trade';
import { currencyExponent } from './currencies.js';

/** One source's price for one currency, in that currency's minor units per XMR. */
export interface PriceQuote {
  currency: string;
  centsPerXmr: bigint;
  /** When the source says it priced this (e.g. CoinGecko's `last_updated_at`); else the fetch time is used. */
  at?: Date;
}

/** A public price source (spec 11.6). `fetchQuotes` may throw; the feed catches every failure. */
export interface PriceSource {
  name: string;
  fetchQuotes(signal: AbortSignal): Promise<PriceQuote[]>;
}

export interface PriceFeedOptions {
  /** A currency needs at least this many sources in the last poll, agreeing within `maxSpreadBps`. */
  minSources: number;
  /** The median is dated by its oldest quote and refused once older than this. */
  maxAgeMs: number;
  pollMs: number;
  /** Each source gets this long per poll; its `signal` aborts then. */
  timeoutMs?: number;
  /**
   * A quote further than this from the median does not count towards `minSources` (Review Focus 5;
   * owner 6 Nov 2026, Q7: 3%, past which the currency has no price).
   */
  maxSpreadBps?: number;
  /**
   * The spread used instead when only two sources quote a currency in a poll (re-review): with two,
   * the median is their mean, so one wrong source moves it by half the gap. 2% keeps that under 1%.
   */
  pairSpreadBps?: number;
  /**
   * A quote with no timestamp of its own (Kraken, Bitfinex) that has not changed for longer than
   * this, while another source's quote for that currency has moved since, is treated as stale: the
   * pair is frozen (a halted market, a delisting) even though each fetch looks fresh.
   */
  frozenAfterMs?: number;
  clock?: () => Date;
}

export const PRICE_FEED_DEFAULTS = Object.freeze({
  minSources: 2, maxAgeMs: 300_000, pollMs: 15_000, timeoutMs: 5_000, maxSpreadBps: 300, pairSpreadBps: 200, frozenAfterMs: 30 * 60_000,
}) satisfies Required<Omit<PriceFeedOptions, 'clock'>>;

export interface FeedQuote {
  price: Price;
  /** The oldest quote behind the median. */
  at: Date;
  /** How many sources agreed (within `maxSpreadBps` of the median) in the last poll. */
  sources: number;
  /** ISO 4217 exponent of the currency (the minor unit of `centsPerXmr`). */
  exponent: 0 | 2 | 3;
}

/** One source's health, for the owner's Price health panel (spec 11.6). */
export interface PriceSourceHealth {
  name: string;
  /**
   * The last poll in which it gave a valid, fresh USD quote. Health is judged on USD only
   * (re-review): every market price is the USD median × an exchange rate, so USD is what counts.
   */
  lastGoodAt: Date | null;
  /** Polls in a row with no valid, fresh USD quote (failed, timed out, malformed, stale or frozen). */
  consecutiveFailures: number;
  /** Its USD quote counted towards the published median in the last poll. */
  inUse: boolean;
}

export interface PriceFeed {
  /** The median price, or null when fewer than `minSources` agree or it is older than `maxAgeMs`. */
  current(currency: string): Price | null;
  quote(currency: string): FeedQuote | null;
  /** Per-source health, in source order. */
  sources(): PriceSourceHealth[];
  /** Whether at least one poll has finished. */
  polled(): boolean;
  /** One poll of every source; never throws. */
  poll(): Promise<void>;
  /** Polls now and then every `pollMs` (never two polls at once); the timer does not keep the process alive. */
  start(): void;
  /** Stops polling and waits for a poll in flight. */
  stop(): Promise<void>;
}

/** The middle value; for an even count the mean of the two middle ones, rounded half up. */
export function median(values: readonly bigint[]): bigint {
  if (values.length === 0) throw new RangeError('median of nothing');
  const s = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = s.length >> 1;
  if (s.length % 2 === 1) return s[mid]!;
  const sum = s[mid - 1]! + s[mid]!;
  return sum / 2n + (sum % 2n);
}

interface Sample {
  cents: bigint;
  at: Date;
  /** Index of the source that gave it. */
  from: number;
}

/**
 * Runs `call` with an abort signal that fires after `timeoutMs`; resolves to its answer, or rejects
 * on a throw, a rejection or the timeout (whichever comes first). Shared by the price and
 * exchange-rate feeds.
 */
export async function withTimeout<T>(call: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_r, reject) => {
    timer = setTimeout(() => {
      ctl.abort(new Error('timeout'));
      reject(new Error('timeout'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => call(ctl.signal)), expired]);
  } finally {
    clearTimeout(timer);
  }
}

/** Fetches `source` with a timeout; any failure (throw, reject, abort, bad data) is no answer. */
async function ask(source: PriceSource, timeoutMs: number): Promise<PriceQuote[]> {
  try {
    const answer = await withTimeout((signal) => source.fetchQuotes(signal), timeoutMs);
    return Array.isArray(answer) ? answer : [];
  } catch {
    return [];
  }
}

/**
 * The median price feed (spec 8, 11.6). Each poll asks every source at once; a currency's price is
 * the median of the sources that answered THAT poll, and only when at least `minSources` of them
 * lie within `maxSpreadBps` of it. A quote already older than `maxAgeMs` when fetched (a frozen
 * pair after a delisting) is dropped. The price is dated by its oldest quote, so it goes stale on
 * time even if polling stops.
 *
 * There is no 1 h jump guard here like the exchange rates' sanity guard: for XMR the cross-source
 * check IS the guard. A wrong quote is outvoted by the median and, being outside the spread, does
 * not count towards `minSources`; with only two sources in play the tighter `pairSpreadBps` applies.
 */
export function createPriceFeed(sources: readonly PriceSource[], o: PriceFeedOptions): PriceFeed {
  const clock = o.clock ?? (() => new Date());
  const timeoutMs = o.timeoutMs ?? PRICE_FEED_DEFAULTS.timeoutMs;
  const maxSpreadBps = BigInt(o.maxSpreadBps ?? PRICE_FEED_DEFAULTS.maxSpreadBps);
  const pairSpreadBps = BigInt(o.pairSpreadBps ?? PRICE_FEED_DEFAULTS.pairSpreadBps);
  const frozenAfterMs = o.frozenAfterMs ?? PRICE_FEED_DEFAULTS.frozenAfterMs;
  /**
   * Per source and currency: its last quoted value, since when it has quoted exactly that, and
   * whether that began with a change (not with the source's first quote).
   */
  const unchanged = sources.map(() => new Map<string, { cents: bigint; since: number; moved: boolean }>());
  let latest = new Map<string, FeedQuote>();
  let inFlight: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let done = false;
  const health: PriceSourceHealth[] = sources.map((s) => ({ name: s.name, lastGoodAt: null, consecutiveFailures: 0, inUse: false }));

  async function pollOnce(): Promise<void> {
    const answers = await Promise.all(sources.map((s) => ask(s, timeoutMs)));
    const now = clock();
    const byCurrency = new Map<string, Sample[]>();
    const good = new Set<number>();
    const used = new Set<number>();
    /** This poll's valid quotes, before the staleness checks, with whether the source dated them. */
    const valid: Array<{ from: number; currency: string; cents: bigint; at: Date | null }> = [];
    for (const [from, quotes] of answers.entries()) {
      const seen = new Set<string>();
      for (const q of quotes) {
        if (q === null || typeof q !== 'object') continue;
        const { currency, centsPerXmr } = q;
        if (typeof currency !== 'string' || currencyExponent(currency) === null || seen.has(currency)) continue;
        seen.add(currency); // one quote per source and currency: the first
        if (typeof centsPerXmr !== 'bigint' || centsPerXmr <= 0n) continue;
        valid.push({ from, currency, cents: centsPerXmr, at: q.at instanceof Date && !Number.isNaN(q.at.getTime()) ? q.at : null });
      }
    }
    const t = now.getTime();
    for (const v of valid) {
      const u = unchanged[v.from]!.get(v.currency);
      if (!u || u.cents !== v.cents) unchanged[v.from]!.set(v.currency, { cents: v.cents, since: t, moved: u !== undefined });
    }
    for (const v of valid) {
      let at = v.at ?? now;
      if (at.getTime() > t) at = now;
      if (t - at.getTime() > o.maxAgeMs) continue;
      if (v.at === null) {
        // Frozen: unchanged for over frozenAfterMs while another source's quote moved since.
        const since = unchanged[v.from]!.get(v.currency)!.since;
        const othersMoved = unchanged.some((m, j) => {
          const w = j === v.from ? undefined : m.get(v.currency);
          return w !== undefined && w.moved && w.since > since;
        });
        if (t - since > frozenAfterMs && othersMoved) continue;
      }
      const list = byCurrency.get(v.currency) ?? [];
      list.push({ cents: v.cents, at, from: v.from });
      byCurrency.set(v.currency, list);
      if (v.currency === 'USD') good.add(v.from);
    }
    const next = new Map<string, FeedQuote>();
    for (const [currency, samples] of byCurrency) {
      if (samples.length < o.minSources) continue;
      const mid = median(samples.map((s) => s.cents));
      const spread = samples.length === 2 ? pairSpreadBps : maxSpreadBps;
      const near = samples.filter((s) => {
        const diff = s.cents > mid ? s.cents - mid : mid - s.cents;
        return diff * 10_000n <= mid * spread;
      });
      if (near.length < o.minSources) continue;
      if (currency === 'USD') for (const s of near) used.add(s.from);
      const at = new Date(Math.min(...samples.map((s) => s.at.getTime())));
      next.set(currency, { price: { currency, centsPerXmr: mid }, at, sources: near.length, exponent: currencyExponent(currency)! });
    }
    latest = next;
    for (const [i, h] of health.entries()) {
      if (good.has(i)) {
        h.lastGoodAt = now;
        h.consecutiveFailures = 0;
      } else {
        h.consecutiveFailures++;
      }
      h.inUse = used.has(i);
    }
    done = true;
  }

  function poll(): Promise<void> {
    inFlight ??= pollOnce()
      .catch(() => undefined)
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  function quote(currency: string): FeedQuote | null {
    const q = latest.get(currency);
    if (!q) return null;
    if (clock().getTime() - q.at.getTime() > o.maxAgeMs) return null;
    return q;
  }

  return {
    quote,
    current: (currency) => quote(currency)?.price ?? null,
    sources: () => health.map((h) => ({ ...h })),
    polled: () => done,
    poll,
    start() {
      if (timer) return;
      void poll();
      timer = setInterval(() => {
        if (!inFlight) void poll();
      }, o.pollMs);
      timer.unref?.();
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      await inFlight;
    },
  };
}
