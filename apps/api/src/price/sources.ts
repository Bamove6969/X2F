import { CURRENCY_EXPONENTS, currencyExponent, decimalToMinor } from './currencies.js';
import type { PriceQuote, PriceSource } from './feed.js';

/**
 * The public XMR price sources, picked by name in `PRICE_SOURCES` (spec 11.6; approved by the lead
 * 2026-10-24): see ~/x2f-comms/briefs/p3-t3-price-sources.md for the evidence (each still
 * lists XMR, needs no key, answers plain JSON, and was fetched over Tor on 2026-10-24). Each
 * parser is self-contained: swapping a source is one entry here plus its fixture test.
 */
export const PRICE_SOURCE_NAMES = ['kraken', 'bitfinex', 'coingecko'] as const;
export type PriceSourceName = (typeof PRICE_SOURCE_NAMES)[number];

/** The default `PRICE_SOURCES`: all of them. */
export const DEFAULT_PRICE_SOURCES: readonly PriceSourceName[] = PRICE_SOURCE_NAMES;

/** A source answer bigger than this is refused (the real ones are under 2 KiB). */
const MAX_BODY_BYTES = 256 * 1024;

export type Fetch = typeof fetch;

/**
 * The one fetch seam for every price and exchange-rate source: GET `url` and parse JSON, 200
 * only, no redirects, no cookies, size capped. Throws on anything else. No proxy is wired here:
 * `f` is the global fetch in production (main.ts) and a stub in tests.
 */
export async function getJson(f: Fetch, url: string, signal: AbortSignal): Promise<unknown> {
  const res = await f(url, { method: 'GET', redirect: 'error', credentials: 'omit', headers: { accept: 'application/json' }, signal });
  if (res.status !== 200) {
    await res.body?.cancel().catch(() => undefined);
    throw new Error('price source: bad status');
  }
  return JSON.parse(await readCapped(res, MAX_BODY_BYTES)) as unknown;
}

/**
 * The body as UTF-8 text, refusing more than `max` bytes without buffering them: an announced
 * Content-Length over the cap is refused before reading, and the stream is cancelled as soon as
 * the bytes read pass the cap.
 */
export async function readCapped(res: Response, max: number): Promise<string> {
  const tooLarge = () => new Error('price source: body too large');
  const announced = Number(res.headers.get('content-length') ?? '');
  if (Number.isFinite(announced) && announced > max) {
    await res.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(all);
}

export const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** A JSON number as a plain decimal string ("582.46"); exponent forms ("1e-7") are rejected later. */
const numberText = (v: unknown): string | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? String(v) : null);

function toQuote(currency: string, decimal: string | null, at?: Date): PriceQuote | null {
  const exponent = currencyExponent(currency);
  if (exponent === null || decimal === null) return null;
  const cents = decimalToMinor(decimal, exponent);
  if (cents === null || cents <= 0n) return null;
  return at ? { currency, centsPerXmr: cents, at } : { currency, centsPerXmr: cents };
}

const byCurrency = (a: PriceQuote, b: PriceQuote) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0);

/** Kraken: XMR/USD and XMR/EUR order books; `c[0]` is the last trade price. */
const KRAKEN_PAIRS: Readonly<Record<string, string>> = { XXMRZUSD: 'USD', XXMRZEUR: 'EUR' };
function kraken(f: Fetch): PriceSource {
  const url = `https://api.kraken.com/0/public/Ticker?pair=${Object.keys(KRAKEN_PAIRS).join(',')}`;
  return {
    name: 'kraken',
    async fetchQuotes(signal) {
      const body = await getJson(f, url, signal);
      if (!isRecord(body) || !Array.isArray(body.error) || !isRecord(body.result)) throw new Error('kraken: shape');
      // Kraken lists errors as "E…" strings and warnings as "W…": any error, or anything else odd, refuses the answer.
      if (body.error.some((e) => typeof e !== 'string' || !e.startsWith('W'))) throw new Error('kraken: error');
      const out: PriceQuote[] = [];
      for (const [pair, currency] of Object.entries(KRAKEN_PAIRS)) {
        const t = body.result[pair];
        const last = isRecord(t) && Array.isArray(t.c) && typeof t.c[0] === 'string' ? t.c[0] : null;
        const q = toQuote(currency, last);
        if (q) out.push(q);
      }
      return out.sort(byCurrency);
    },
  };
}

/** Bitfinex: the tXMRUSD ticker row; index 7 is LAST_PRICE. */
function bitfinex(f: Fetch): PriceSource {
  const url = 'https://api-pub.bitfinex.com/v2/tickers?symbols=tXMRUSD';
  return {
    name: 'bitfinex',
    async fetchQuotes(signal) {
      const body = await getJson(f, url, signal);
      if (!Array.isArray(body)) throw new Error('bitfinex: shape');
      const row = body.find((r): r is unknown[] => Array.isArray(r) && r[0] === 'tXMRUSD');
      if (!row) throw new Error('bitfinex: no XMR/USD');
      const q = toQuote('USD', numberText(row[7]));
      return q ? [q] : [];
    },
  };
}

/** CoinGecko: one call for every supported currency, dated by CoinGecko's own `last_updated_at` (its answers are CDN-cached). */
function coingecko(f: Fetch): PriceSource {
  const currencies = Object.keys(CURRENCY_EXPONENTS);
  const url =
    'https://api.coingecko.com/api/v3/simple/price?ids=monero&include_last_updated_at=true&vs_currencies=' +
    currencies.map((c) => c.toLowerCase()).join(',');
  return {
    name: 'coingecko',
    async fetchQuotes(signal) {
      const body = await getJson(f, url, signal);
      const m = isRecord(body) ? body.monero : undefined;
      if (!isRecord(m)) throw new Error('coingecko: shape');
      const ts = m.last_updated_at;
      if (typeof ts !== 'number' || !Number.isSafeInteger(ts) || ts <= 0) throw new Error('coingecko: no time');
      const at = new Date(ts * 1000);
      const out: PriceQuote[] = [];
      for (const currency of currencies) {
        const q = toQuote(currency, numberText(m[currency.toLowerCase()]), at);
        if (q) out.push(q);
      }
      return out.sort(byCurrency);
    },
  };
}

const BUILDERS: Readonly<Record<PriceSourceName, (f: Fetch) => PriceSource>> = { kraken, bitfinex, coingecko };

/** The named sources, fetching with `f` (tests pass a stub; production the global fetch). */
export function priceSources(names: readonly PriceSourceName[], f: Fetch = fetch): PriceSource[] {
  return names.map((n) => BUILDERS[n](f));
}

/** `PRICE_SOURCES`: comma-separated names, each known and once; unset or empty means the defaults. */
export function parsePriceSources(raw: string | undefined): PriceSourceName[] {
  if (raw === undefined || raw.trim() === '') return [...DEFAULT_PRICE_SOURCES];
  const names = raw.split(',').map((s) => s.trim());
  const out: PriceSourceName[] = [];
  for (const n of names) {
    const known = PRICE_SOURCE_NAMES.find((k) => k === n);
    if (!known || out.includes(known)) {
      throw new Error(`config: PRICE_SOURCES is malformed (comma-separated, each once, from: ${PRICE_SOURCE_NAMES.join(', ')})`);
    }
    out.push(known);
  }
  return out;
}
