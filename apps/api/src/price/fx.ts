import { CURRENCY_EXPONENTS, currencyExponent } from './currencies.js';
import { withTimeout } from './feed.js';
import { getJson, isRecord, type Fetch } from './sources.js';

/**
 * Exchange rates USD→X for the market price of every currency (spec 11.6, owner 2026-10-24):
 * three public sources in a FIXED order of trust. Per currency X2F uses the highest-ranked source
 * that is fresh and has it; the next one only when it is down or stale. Never an average.
 * Approved by the lead 2026-10-24 (evidence: ~/x2f-comms/briefs/p3-t3-fx-sources.md).
 */

/** Rates are fixed-point bigints: USD→X × 10^18 (exact for every decimal the sources send). */
export const RATE_SCALE = 10n ** 18n;
const SCALE_DIGITS = 18;

/**
 * The approved sources, in trust order:
 * 1. Coinbase: USD-based, direct USD→X.
 * 2. BitPay: BTC-based, USD→X = rate[X] / rate[USD].
 * 3. CoinGecko: BTC-based, fiat entries only, the same derivation.
 * NOTE: #2 and #3 most likely share an upstream (their fiat rates match to 4–5 digits while
 * Coinbase's differ slightly). If that upstream freezes, both can look healthy while serving the
 * same frozen rates, so #3 adds little independence over #2. No third source with a different
 * upstream that works over Tor and covers more than ~20 fiats was found (2026-10-24).
 */
export const FX_SOURCE_NAMES = ['coinbase', 'bitpay', 'coingecko'] as const;
export type FxSourceName = (typeof FX_SOURCE_NAMES)[number];

/** The default `FX_SOURCES`: all three, in the approved trust order. */
export const DEFAULT_FX_SOURCES: readonly FxSourceName[] = FX_SOURCE_NAMES;

/** One exchange-rate source. `fetchRates` may throw; the rates object catches every failure. */
export interface FxSource {
  name: string;
  /** USD→X for each supported currency other than USD, as RATE_SCALE fixed point (> 0). */
  fetchRates(signal: AbortSignal): Promise<Map<string, bigint>>;
}

// A plain decimal, optionally with an exponent ("1.5e+21", "1e-7": what String(number) gives).
const DECIMAL = /^(\d{1,40})(?:\.(\d{1,40}))?(?:[eE]([+-]?\d{1,3}))?$/;

/** `text` × RATE_SCALE as a bigint, rounded half up; null when it is not a plain decimal. */
export function decimalToScaled(text: string): bigint | null {
  const m = DECIMAL.exec(text);
  if (!m) return null;
  const frac = m[2] ?? '';
  const exp = Number(m[3] ?? '0');
  if (Math.abs(exp) > 60) return null;
  const digits = BigInt(m[1]! + frac);
  const shift = SCALE_DIGITS + exp - frac.length;
  if (shift >= 0) return digits * 10n ** BigInt(shift);
  const den = 10n ** BigInt(-shift);
  return (digits * 2n + den) / (2n * den);
}

/** `x / usd` as RATE_SCALE fixed point, half up (both already scaled the same way). */
function ratio(x: bigint, usd: bigint): bigint {
  return (x * RATE_SCALE * 2n + usd) / (2n * usd);
}

const numberText = (v: unknown): string | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? String(v) : null);
const supported = (code: unknown): code is string => typeof code === 'string' && code !== 'USD' && currencyExponent(code) !== null;

/**
 * Absolute bounds on USD→X, whatever a source says: no real currency is worth more than 10^4 USD
 * or less than 10^-9 USD (KWD, the dearest, is about 0.31 per USD; VND about 26 000).
 */
const MIN_RATE = RATE_SCALE / 10_000n;
const MAX_RATE = RATE_SCALE * 1_000_000_000n;

/** Keeps the in-bounds rates of supported currencies (USD left out), in code order. */
function keep(entries: Iterable<[string, bigint | null]>): Map<string, bigint> {
  const out = new Map<string, bigint>();
  for (const [code, rate] of [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (rate !== null && rate >= MIN_RATE && rate <= MAX_RATE && !out.has(code)) out.set(code, rate);
  }
  return out;
}

/** BTC-based rates (X per BTC) to USD→X; throws when USD is missing. */
function fromBtcBased(perBtc: Map<string, bigint>, who: string): Map<string, bigint> {
  const usd = perBtc.get('USD');
  if (usd === undefined || usd <= 0n) throw new Error(`${who}: no USD rate`);
  const out: Array<[string, bigint | null]> = [];
  for (const [code, v] of perBtc) if (supported(code)) out.push([code, ratio(v, usd)]);
  return keep(out);
}

/** Coinbase: `{ data: { currency: 'USD', rates: { EUR: '0.8926', … } } }`, rates as decimal strings. */
function coinbase(f: Fetch): FxSource {
  const url = 'https://api.coinbase.com/v2/exchange-rates?currency=USD';
  return {
    name: 'coinbase',
    async fetchRates(signal) {
      const body = await getJson(f, url, signal);
      const data = isRecord(body) ? body.data : undefined;
      if (!isRecord(data) || data.currency !== 'USD' || !isRecord(data.rates)) throw new Error('coinbase: shape');
      const out: Array<[string, bigint | null]> = [];
      for (const [code, v] of Object.entries(data.rates)) {
        if (supported(code)) out.push([code, typeof v === 'string' ? decimalToScaled(v) : null]);
      }
      return keep(out);
    },
  };
}

/** BitPay: `[{ code: 'USD', name, rate: 79334.29 }, …]`, each rate in X per BTC. */
function bitpay(f: Fetch): FxSource {
  const url = 'https://bitpay.com/api/rates';
  return {
    name: 'bitpay',
    async fetchRates(signal) {
      const body = await getJson(f, url, signal);
      if (!Array.isArray(body)) throw new Error('bitpay: shape');
      const perBtc = new Map<string, bigint>();
      for (const row of body) {
        if (!isRecord(row) || typeof row.code !== 'string' || perBtc.has(row.code)) continue;
        const text = numberText(row.rate);
        const v = text === null ? null : decimalToScaled(text);
        if (v !== null && v > 0n) perBtc.set(row.code, v);
      }
      return fromBtcBased(perBtc, 'bitpay');
    },
  };
}

/** CoinGecko: `{ rates: { usd: { value: 80033.8, type: 'fiat' }, … } }`, X per BTC; fiat entries only. */
function coingeckoFx(f: Fetch): FxSource {
  const url = 'https://api.coingecko.com/api/v3/exchange_rates';
  return {
    name: 'coingecko',
    async fetchRates(signal) {
      const body = await getJson(f, url, signal);
      const rates = isRecord(body) ? body.rates : undefined;
      if (!isRecord(rates)) throw new Error('coingecko: shape');
      const perBtc = new Map<string, bigint>();
      for (const [key, e] of Object.entries(rates)) {
        if (!isRecord(e) || e.type !== 'fiat') continue;
        const text = numberText(e.value);
        const v = text === null ? null : decimalToScaled(text);
        if (v !== null && v > 0n) perBtc.set(key.toUpperCase(), v);
      }
      return fromBtcBased(perBtc, 'coingecko');
    },
  };
}

const BUILDERS: Readonly<Record<FxSourceName, (f: Fetch) => FxSource>> = { coinbase, bitpay, coingecko: coingeckoFx };

/** The named sources in the given (trust) order, fetching with `f` (tests pass a stub). */
export function fxSources(names: readonly FxSourceName[], f: Fetch = fetch): FxSource[] {
  return names.map((n) => BUILDERS[n](f));
}

/** `FX_SOURCES`: comma-separated names, each known and once; the order IS the trust order. Unset or empty: the approved order. */
export function parseFxSources(raw: string | undefined): FxSourceName[] {
  if (raw === undefined || raw.trim() === '') return [...DEFAULT_FX_SOURCES];
  const out: FxSourceName[] = [];
  for (const n of raw.split(',').map((s) => s.trim())) {
    const known = FX_SOURCE_NAMES.find((k) => k === n);
    if (!known || out.includes(known)) {
      throw new Error(`config: FX_SOURCES is malformed (comma-separated, each once, in trust order, from: ${FX_SOURCE_NAMES.join(', ')})`);
    }
    out.push(known);
  }
  return out;
}

/** The owner's settings for exchange rates (Settings; stored in `owner_settings`). */
export interface FxSettings {
  /** A source's rate for a currency is stale once its last good fetch is older than this (owner: 1 h). */
  staleAfterMs: number;
  /** A fetched rate further than this from the currency's last good value is refused (10% = 1000). */
  sanityBps: number;
}

export const FX_DEFAULTS = Object.freeze({
  pollMs: 5 * 60_000,
  timeoutMs: 10_000, // over Tor the sources answered in 1.6–3.5 s
  staleAfterMs: 60 * 60_000,
  sanityBps: 1_000,
  /** The sanity guard compares only with a last good value fetched within this window. */
  sanityWindowMs: 60 * 60_000,
  /** This many failed fetches in a row make a source "down" for a currency: the next one is used. */
  failLimit: 3,
});

export interface FxOptions {
  timeoutMs?: number;
  sanityWindowMs?: number;
  failLimit?: number;
  /** Defaults for the settings until (and whenever) `settings` cannot be read. */
  staleAfterMs?: number;
  sanityBps?: number;
  /** Read before each poll (the owner can change them); a failed read keeps the last ones. */
  settings?: () => FxSettings | Promise<FxSettings>;
  clock?: () => Date;
}

export interface FxRate {
  currency: string;
  /** USD→currency, RATE_SCALE fixed point. */
  rate: bigint;
  source: string;
  /** When that source's rate was fetched (sources carry no rate timestamps). */
  at: Date;
}

export interface FxSourceHealth {
  name: string;
  /** 1 is the most trusted. */
  rank: number;
  /** The last successful, well-formed fetch. */
  lastGoodAt: Date | null;
  /** Whole fetches failed in a row (network, status, shape, timeout). */
  consecutiveFailures: number;
  /** No good fetch within the staleness setting. */
  stale: boolean;
  /** The currencies this source's rate is in use for right now. */
  usedFor: string[];
}

export interface FxHealth {
  sources: FxSourceHealth[];
  /** Rates the sanity guard refused on their source's last fetch. */
  rejected: Array<{ source: string; currency: string; at: Date }>;
  settings: FxSettings;
}

export interface FxRates {
  /** The rate in use for `currency` (never USD), or null when no source has a fresh one. */
  rate(currency: string): FxRate | null;
  health(): FxHealth;
  /** Whether at least one poll has finished. */
  polled(): boolean;
  /** One poll of every source; never throws; a call while one is in flight joins it. */
  poll(): Promise<void>;
}

interface PerCurrency {
  good: { rate: bigint; at: Date } | null;
  /** Failed attempts in a row for this currency: a failed fetch, a fetch without it, or a sanity refusal. */
  failures: number;
  /** The last attempt was refused by the sanity guard: fall back at once. */
  rejectedAt: Date | null;
}

interface SourceState {
  source: FxSource;
  lastGoodAt: Date | null;
  failures: number;
  currencies: Map<string, PerCurrency>;
}

/**
 * The exchange rates. Staleness is measured by FETCH time, never by "the rate has not changed":
 * FX markets close at weekends and the rates freeze, which is fine. A source is used for a
 * currency while its last good rate is fresh, the guard did not refuse its latest one, and it has
 * failed fewer than `failLimit` times in a row (one failure is retried quietly).
 */
export function createFxRates(sources: readonly FxSource[], o: FxOptions = {}): FxRates {
  const clock = o.clock ?? (() => new Date());
  const timeoutMs = o.timeoutMs ?? FX_DEFAULTS.timeoutMs;
  const sanityWindowMs = o.sanityWindowMs ?? FX_DEFAULTS.sanityWindowMs;
  const failLimit = o.failLimit ?? FX_DEFAULTS.failLimit;
  let settings: FxSettings = {
    staleAfterMs: o.staleAfterMs ?? FX_DEFAULTS.staleAfterMs,
    sanityBps: o.sanityBps ?? FX_DEFAULTS.sanityBps,
  };
  const states: SourceState[] = sources.map((source) => ({ source, lastGoodAt: null, failures: 0, currencies: new Map() }));
  /**
   * Per currency, every rate in use within the sanity window, with its fetch time: what the guard
   * compares with. Comparing with all of them (not only the latest) stops a walk in sub-limit steps.
   */
  const inUse = new Map<string, Array<{ rate: bigint; at: Date }>>();
  let done = false;
  let inFlight: Promise<void> | null = null;

  function usable(c: PerCurrency | undefined, now: number): c is PerCurrency & { good: { rate: bigint; at: Date } } {
    return (
      c !== undefined && c.good !== null && c.rejectedAt === null && c.failures < failLimit &&
      now - c.good.at.getTime() <= settings.staleAfterMs
    );
  }

  function rate(currency: string): FxRate | null {
    const now = clock().getTime();
    for (const s of states) {
      const c = s.currencies.get(currency);
      if (usable(c, now)) return { currency, rate: c.good.rate, source: s.source.name, at: c.good.at };
    }
    return null;
  }

  const far = (value: bigint, ref: bigint) => (value > ref ? value - ref : ref - value) * 10_000n > ref * BigInt(settings.sanityBps);

  /** The in-use history of `currency` still inside the window (older entries dropped). */
  function recent(currency: string, now: Date): Array<{ rate: bigint; at: Date }> {
    const kept = (inUse.get(currency) ?? []).filter((h) => now.getTime() - h.at.getTime() <= sanityWindowMs);
    inUse.set(currency, kept);
    return kept;
  }

  /**
   * The sanity guard. With in-use values from the last hour: refused when more than sanityBps from
   * ANY of them. With none (boot, restart, an outage over an hour): accepted only when another
   * fresh source agrees within sanityBps, or when no other source has the currency at all. This
   * is a cross-check, not an average: the value used is still the highest-ranked accepted one.
   */
  function insane(currency: string, value: bigint, peers: bigint[], now: Date): boolean {
    const history = recent(currency, now);
    if (history.length > 0) return history.some((h) => far(value, h.rate));
    return peers.length > 0 && peers.every((p) => far(value, p));
  }

  async function pollOnce(): Promise<void> {
    if (o.settings) {
      try {
        settings = await o.settings();
      } catch {
        // Keep the last settings: a database hiccup must not change how prices behave.
      }
    }
    const answers = await Promise.all(
      states.map((s) =>
        withTimeout((signal) => s.source.fetchRates(signal), timeoutMs).then(
          (m) => (m instanceof Map && m.size > 0 ? m : null),
          () => null,
        ),
      ),
    );
    const now = clock();
    /** What every other source says about `code` now: this poll's answer, or else its last fresh good rate. */
    const peersOf = (i: number, code: string): bigint[] => {
      const out: bigint[] = [];
      states.forEach((t, j) => {
        if (j === i) return;
        const got = answers[j];
        if (got) {
          const v = got.get(code);
          if (typeof v === 'bigint' && v > 0n) out.push(v);
          return;
        }
        const c = t.currencies.get(code);
        if (c?.good && now.getTime() - c.good.at.getTime() <= settings.staleAfterMs) out.push(c.good.rate);
      });
      return out;
    };
    states.forEach((s, i) => {
      const got = answers[i]!;
      if (got === null) {
        s.failures++;
        for (const c of s.currencies.values()) c.failures++;
        return;
      }
      s.failures = 0;
      s.lastGoodAt = now;
      for (const [code, c] of s.currencies) if (!got.has(code)) c.failures++;
      for (const [code, value] of got) {
        if (!supported(code) || typeof value !== 'bigint' || value <= 0n) continue;
        const c = s.currencies.get(code) ?? { good: null, failures: 0, rejectedAt: null };
        s.currencies.set(code, c);
        if (insane(code, value, peersOf(i, code), now)) {
          // Counts as a failed fetch of this currency from this source: the next source is used.
          c.failures++;
          c.rejectedAt = now;
        } else {
          c.good = { rate: value, at: now };
          c.failures = 0;
          c.rejectedAt = null;
        }
      }
    });
    for (const code of Object.keys(CURRENCY_EXPONENTS)) {
      const r = rate(code);
      if (!r) continue;
      const history = recent(code, now);
      const last = history.at(-1);
      if (!last || last.rate !== r.rate || last.at.getTime() !== r.at.getTime()) history.push({ rate: r.rate, at: r.at });
    }
    done = true;
  }

  function health(): FxHealth {
    const now = clock().getTime();
    const usedBy = new Map<string, string[]>();
    for (const code of Object.keys(CURRENCY_EXPONENTS)) {
      const r = rate(code);
      if (r) usedBy.set(r.source, [...(usedBy.get(r.source) ?? []), code]);
    }
    const rejected: FxHealth['rejected'] = [];
    for (const s of states) {
      for (const [currency, c] of s.currencies) if (c.rejectedAt) rejected.push({ source: s.source.name, currency, at: c.rejectedAt });
    }
    return {
      sources: states.map((s, i) => ({
        name: s.source.name,
        rank: i + 1,
        lastGoodAt: s.lastGoodAt,
        consecutiveFailures: s.failures,
        stale: s.lastGoodAt !== null && now - s.lastGoodAt.getTime() > settings.staleAfterMs,
        usedFor: (usedBy.get(s.source.name) ?? []).sort(),
      })),
      rejected,
      settings: { ...settings },
    };
  }

  return {
    rate,
    health,
    polled: () => done,
    poll() {
      inFlight ??= pollOnce()
        .catch(() => undefined)
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    },
  };
}
