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
  /** A quote further than this from the median does not count towards `minSources` (Review Focus 5). */
  maxSpreadBps?: number;
  clock?: () => Date;
}

export const PRICE_FEED_DEFAULTS = Object.freeze({
  minSources: 2, maxAgeMs: 300_000, pollMs: 60_000, timeoutMs: 5_000, maxSpreadBps: 500,
}) satisfies Required<Omit<PriceFeedOptions, 'clock'>>;

export interface FeedQuote {
  price: Price;
  /** The oldest quote behind the median. */
  at: Date;
  /** How many sources answered this currency in the last poll. */
  sources: number;
  /** ISO 4217 exponent of the currency (the minor unit of `centsPerXmr`). */
  exponent: 0 | 2 | 3;
}

export interface PriceFeed {
  /** The median price, or null when fewer than `minSources` agree or it is older than `maxAgeMs`. */
  current(currency: string): Price | null;
  quote(currency: string): FeedQuote | null;
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
 */
export function createPriceFeed(sources: readonly PriceSource[], o: PriceFeedOptions): PriceFeed {
  const clock = o.clock ?? (() => new Date());
  const timeoutMs = o.timeoutMs ?? PRICE_FEED_DEFAULTS.timeoutMs;
  const maxSpreadBps = BigInt(o.maxSpreadBps ?? PRICE_FEED_DEFAULTS.maxSpreadBps);
  let latest = new Map<string, FeedQuote>();
  let inFlight: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function pollOnce(): Promise<void> {
    const answers = await Promise.all(sources.map((s) => ask(s, timeoutMs)));
    const now = clock();
    const byCurrency = new Map<string, Sample[]>();
    for (const quotes of answers) {
      const seen = new Set<string>();
      for (const q of quotes) {
        if (q === null || typeof q !== 'object') continue;
        const { currency, centsPerXmr } = q;
        if (typeof currency !== 'string' || currencyExponent(currency) === null || seen.has(currency)) continue;
        seen.add(currency); // one quote per source and currency: the first
        if (typeof centsPerXmr !== 'bigint' || centsPerXmr <= 0n) continue;
        let at = q.at instanceof Date && !Number.isNaN(q.at.getTime()) ? q.at : now;
        if (at.getTime() > now.getTime()) at = now;
        if (now.getTime() - at.getTime() > o.maxAgeMs) continue;
        const list = byCurrency.get(currency) ?? [];
        list.push({ cents: centsPerXmr, at });
        byCurrency.set(currency, list);
      }
    }
    const next = new Map<string, FeedQuote>();
    for (const [currency, samples] of byCurrency) {
      if (samples.length < o.minSources) continue;
      const mid = median(samples.map((s) => s.cents));
      const near = samples.filter((s) => {
        const diff = s.cents > mid ? s.cents - mid : mid - s.cents;
        return diff * 10_000n <= mid * maxSpreadBps;
      });
      if (near.length < o.minSources) continue;
      const at = new Date(Math.min(...samples.map((s) => s.at.getTime())));
      next.set(currency, { price: { currency, centsPerXmr: mid }, at, sources: samples.length, exponent: currencyExponent(currency)! });
    }
    latest = next;
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
