import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import {
  FX_DEFAULTS, FX_SOURCE_NAMES, RATE_SCALE, createFxRates, decimalToScaled, fxSources, parseFxSources, type FxSource,
} from '../src/price/fx.js';
import { VAPID_ENV } from './helpers/vapid.js';

const T0 = new Date('2026-10-24T06:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;

/** USD→X as a scaled rate: r('0.9') = 0.9 × RATE_SCALE. */
const r = (text: string): bigint => decimalToScaled(text)!;

function clockAt(start: Date): { clock: () => Date; set(d: Date): void; advance(ms: number): void } {
  let now = start;
  return { clock: () => now, set: (d) => void (now = d), advance: (ms) => void (now = new Date(now.getTime() + ms)) };
}

/** A source answering `rates()` (or throwing it when it is an Error). */
function stub(name: string, rates: () => Record<string, string> | Error): FxSource {
  return {
    name,
    async fetchRates() {
      const x = rates();
      if (x instanceof Error) throw x;
      return new Map(Object.entries(x).map(([c, v]) => [c, r(v)]));
    },
  };
}

/** A stubbed `fetch` that answers `body` for any URL starting with `prefix` and records the calls. */
function fakeFetch(answers: Record<string, unknown>, status = 200) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const f = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const hit = Object.keys(answers).find((p) => url.startsWith(p));
    if (!hit) return new Response('not found', { status: 404 });
    return new Response(typeof answers[hit] === 'string' ? (answers[hit] as string) : JSON.stringify(answers[hit]), { status });
  };
  return { fetch: f as typeof fetch, calls };
}

// Shapes as fetched on 2026-10-24 (see ~/x2f-comms/briefs/p3-t3-fx-sources.md), trimmed.
const COINBASE = {
  data: {
    currency: 'USD',
    rates: { '00': '109.738', AED: '3.67253', BTC: '0.0000126', EUR: '0.892572', JPY: '156.86597991', KWD: '0.310706', USD: '1.0', XYZ: '5' },
  },
};
const BITPAY = [
  { code: 'BTC', name: 'Bitcoin', rate: 1 },
  { code: 'BCH', name: 'Bitcoin Cash', rate: 291.29 },
  { code: 'USD', name: 'US Dollar', rate: 79334.29 },
  { code: 'EUR', name: 'Eurozone Euro', rate: 70905.73 },
  { code: 'JPY', name: 'Japanese Yen', rate: 12444770.76 },
  { code: 'VND', name: 'Vietnamese Dong', rate: 2050246668.16 },
];
const COINGECKO = {
  rates: {
    btc: { name: 'Bitcoin', unit: 'BTC', value: 1.0, type: 'crypto' },
    eth: { name: 'Ether', unit: 'ETH', value: 34.64, type: 'crypto' },
    usd: { name: 'US Dollar', unit: '$', value: 80033.813, type: 'fiat' },
    eur: { name: 'Euro', unit: '€', value: 71433.22, type: 'fiat' },
    kwd: { name: 'Kuwaiti Dinar', unit: 'KD', value: 24865.705, type: 'fiat' },
    xdr: { name: 'IMF Special Drawing Rights', unit: 'XDR', value: 58658.062, type: 'fiat' },
    xag: { name: 'Silver - Troy Ounce', unit: 'XAG', value: 1484.9, type: 'commodity' },
    // A non-fiat entry whose code is a supported currency is never used.
    gbp: { name: 'Not really', unit: 'G', value: 1, type: 'crypto' },
  },
};

const near = (got: bigint | undefined, want: number) => Math.abs(Number(got) / Number(RATE_SCALE) - want) / want;

describe('decimalToScaled', () => {
  it('scales plain and exponent decimals exactly by RATE_SCALE, half up', () => {
    expect(RATE_SCALE).toBe(10n ** 18n);
    expect(decimalToScaled('1')).toBe(RATE_SCALE);
    expect(decimalToScaled('0.892572')).toBe(892_572_000_000_000_000n);
    expect(decimalToScaled('156.86597991')).toBe(156_865_979_910_000_000_000n);
    expect(decimalToScaled('2050246668.16')).toBe(2_050_246_668_160_000_000_000_000_000n);
    expect(decimalToScaled('1e-7')).toBe(100_000_000_000n);
    expect(decimalToScaled('1.5e+21')).toBe(1_500_000_000_000_000_000_000n * RATE_SCALE);
    expect(decimalToScaled('0.0000000000000000005')).toBe(1n); // half up at the 18th place
    expect(decimalToScaled('0.0000000000000000004')).toBe(0n);
    for (const bad of ['', '-1', '1.', '.5', 'NaN', ' 5', '0x10', '1e', '1e999', '1'.repeat(41), 'Infinity']) {
      expect(decimalToScaled(bad), bad).toBeNull();
    }
  });
});

describe('FX sources', () => {
  const signal = new AbortController().signal;
  const one = (name: (typeof FX_SOURCE_NAMES)[number], f: typeof fetch) => fxSources([name], f)[0]!;

  it('lists the approved sources in trust order: Coinbase, BitPay, CoinGecko', () => {
    expect(FX_SOURCE_NAMES).toEqual(['coinbase', 'bitpay', 'coingecko']);
  });

  it('coinbase: USD-based rates, supported currencies only, USD itself left out', async () => {
    const { fetch, calls } = fakeFetch({ 'https://api.coinbase.com/v2/exchange-rates?currency=USD': COINBASE });
    const m = await one('coinbase', fetch).fetchRates(signal);
    expect([...m.keys()].sort()).toEqual(['AED', 'EUR', 'JPY', 'KWD']);
    expect(m.get('EUR')).toBe(892_572_000_000_000_000n);
    expect(m.get('JPY')).toBe(156_865_979_910_000_000_000n);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init?.signal).toBe(signal);
    expect(calls[0]!.init?.redirect).toBe('error');
  });

  it('coinbase: a base other than USD is refused', async () => {
    const { fetch } = fakeFetch({ 'https://api.coinbase.com/': { data: { currency: 'EUR', rates: COINBASE.data.rates } } });
    await expect(one('coinbase', fetch).fetchRates(signal)).rejects.toThrow();
  });

  it('bitpay: BTC-based, USD→X = rate[X] / rate[USD]', async () => {
    const { fetch, calls } = fakeFetch({ 'https://bitpay.com/api/rates': BITPAY });
    const m = await one('bitpay', fetch).fetchRates(signal);
    expect([...m.keys()].sort()).toEqual(['EUR', 'JPY', 'VND']);
    expect(near(m.get('EUR'), 70905.73 / 79334.29)).toBeLessThan(1e-12);
    expect(near(m.get('JPY'), 12444770.76 / 79334.29)).toBeLessThan(1e-12);
    expect(near(m.get('VND'), 2050246668.16 / 79334.29)).toBeLessThan(1e-12);
    expect(calls[0]!.url).toBe('https://bitpay.com/api/rates');
    // Exact on round numbers.
    const exact = fakeFetch({ 'https://bitpay.com/': [{ code: 'USD', rate: 50000 }, { code: 'EUR', rate: 45000 }] });
    expect((await one('bitpay', exact.fetch).fetchRates(signal)).get('EUR')).toBe(900_000_000_000_000_000n);
  });

  it('bitpay: no USD row means no rates', async () => {
    const { fetch } = fakeFetch({ 'https://bitpay.com/': BITPAY.filter((x) => x.code !== 'USD') });
    await expect(one('bitpay', fetch).fetchRates(signal)).rejects.toThrow();
  });

  it('coingecko: BTC-based, fiat entries only, same derivation', async () => {
    const { fetch, calls } = fakeFetch({ 'https://api.coingecko.com/api/v3/exchange_rates': COINGECKO });
    const m = await one('coingecko', fetch).fetchRates(signal);
    expect([...m.keys()].sort()).toEqual(['EUR', 'KWD']);
    expect(near(m.get('EUR'), 71433.22 / 80033.813)).toBeLessThan(1e-12);
    expect(near(m.get('KWD'), 24865.705 / 80033.813)).toBeLessThan(1e-12);
    expect(calls[0]!.url).toBe('https://api.coingecko.com/api/v3/exchange_rates');
  });

  it('the three agree within 0.2% on the same minute (evidence in the brief)', async () => {
    const cb = await one('coinbase', fakeFetch({ 'https://': COINBASE }).fetch).fetchRates(signal);
    const bp = await one('bitpay', fakeFetch({ 'https://': BITPAY }).fetch).fetchRates(signal);
    const cg = await one('coingecko', fakeFetch({ 'https://': COINGECKO }).fetch).fetchRates(signal);
    const eur = Number(cb.get('EUR')) / Number(RATE_SCALE);
    expect(near(bp.get('EUR'), eur)).toBeLessThan(0.002);
    expect(near(cg.get('EUR'), eur)).toBeLessThan(0.002);
  });

  it.each(FX_SOURCE_NAMES)('%s: a non-200 answer, non-JSON, a huge body or a wrong shape throws', async (name) => {
    for (const [body, status] of [
      [COINBASE, 503], ['<html>Just a moment...</html>', 200], ['x'.repeat(300_000), 200], [{ unexpected: true }, 200], [[1, 2, 3], 200], [null, 200],
    ] as const) {
      const { fetch } = fakeFetch({ 'https://': body }, status);
      await expect(one(name, fetch).fetchRates(signal), `${name} ${String(status)}`).rejects.toThrow();
    }
  });

  it('a rate outside the absolute bounds (USD→X above 10^9 or below 10^-4) is skipped', async () => {
    const cb = fakeFetch({
      'https://': { data: { currency: 'USD', rates: { CAD: '1'.repeat(38), EUR: '0.00001', JPY: '1000000000', VND: '1000000001', CHF: '0.0001' } } },
    });
    expect([...(await one('coinbase', cb.fetch).fetchRates(signal)).keys()]).toEqual(['CHF', 'JPY']);
    const bp = fakeFetch({ 'https://': [{ code: 'USD', rate: 1 }, { code: 'CAD', rate: 1e30 }, { code: 'EUR', rate: 0.9 }] });
    expect([...(await one('bitpay', bp.fetch).fetchRates(signal)).keys()]).toEqual(['EUR']);
    const cg = fakeFetch({ 'https://': { rates: { usd: { value: 1, type: 'fiat' }, cad: { value: 1e30, type: 'fiat' }, eur: { value: 0.9, type: 'fiat' } } } });
    expect([...(await one('coingecko', cg.fetch).fetchRates(signal)).keys()]).toEqual(['EUR']);
  });

  it('a zero, negative or non-numeric rate is skipped', async () => {
    const cb = fakeFetch({ 'https://': { data: { currency: 'USD', rates: { EUR: '0', GBP: '-1', JPY: 'abc', CHF: '0.8' } } } });
    expect([...(await one('coinbase', cb.fetch).fetchRates(signal)).keys()]).toEqual(['CHF']);
    const bp = fakeFetch({ 'https://': [{ code: 'USD', rate: 50000 }, { code: 'EUR', rate: 0 }, { code: 'GBP', rate: '1' }, { code: 'CHF', rate: 40000 }] });
    expect([...(await one('bitpay', bp.fetch).fetchRates(signal)).keys()]).toEqual(['CHF']);
  });

  it('parses FX_SOURCES: order is the trust order; unset means the approved order', () => {
    expect(parseFxSources(undefined)).toEqual(['coinbase', 'bitpay', 'coingecko']);
    expect(parseFxSources('')).toEqual(['coinbase', 'bitpay', 'coingecko']);
    expect(parseFxSources(' bitpay , coinbase ')).toEqual(['bitpay', 'coinbase']);
    expect(() => parseFxSources('coinbase,yahoo')).toThrow(/FX_SOURCES/);
    expect(() => parseFxSources('coinbase,coinbase')).toThrow(/FX_SOURCES/);
  });

  it('config reads FX_SOURCES', () => {
    const env = {
      X2F_ORIGINS: 'https://x2f.test', X2F_RP_ID: 'x2f.test', DATABASE_URL: 'postgres://u@h/x', X2F_LEAKED_LIST_PATH: '/x',
      X2F_SERVER_KEY: Buffer.alloc(32, 1).toString('base64'), X2F_MONERO_NETWORK: 'stagenet', X2F_TERMS_VERSION: 'v1',
      X2F_PGP_SIGNING_KEY_PATH: '/k', X2F_PGP_SIGNING_FINGERPRINT: 'a'.repeat(40),
      X2F_RECOVERY_CODE_KEYS: `1:${Buffer.alloc(32, 12).toString('base64')}`,
      X2F_TOTP_KEYS: `1:${Buffer.alloc(32, 13).toString('base64')}`, X2F_LOGIN_NAME_KEYS: `1:${Buffer.alloc(32, 14).toString('base64')}`, X2F_TICKET_KEYS: `1:${Buffer.alloc(32, 15).toString('base64')}`,
      ...VAPID_ENV,
    };
    expect(loadConfig(env).fxSources).toEqual(['coinbase', 'bitpay', 'coingecko']);
    expect(loadConfig({ ...env, FX_SOURCES: 'coingecko' }).fxSources).toEqual(['coingecko']);
    expect(() => loadConfig({ ...env, FX_SOURCES: 'nope' })).toThrow('FX_SOURCES');
  });
});

describe('createFxRates', () => {
  it('uses the defaults: poll every 5 min, stale after 1 h, sanity 10% within 1 h, 3 failures make a source down', () => {
    expect(FX_DEFAULTS).toMatchObject({
      pollMs: 5 * MIN, staleAfterMs: HOUR, sanityBps: 1_000, sanityWindowMs: HOUR, failLimit: 3,
    });
  });

  it('uses the highest-ranked source that has the currency, never an average', async () => {
    const c = clockAt(T0);
    const fx = createFxRates(
      [stub('a', () => ({ EUR: '0.90' })), stub('b', () => ({ EUR: '0.91', GBP: '0.75' })), stub('c', () => ({ EUR: '0.92', JPY: '150' }))],
      { clock: c.clock },
    );
    expect(fx.rate('EUR')).toBeNull(); // nothing polled yet
    await fx.poll();
    expect(fx.rate('EUR')).toEqual({ currency: 'EUR', rate: r('0.90'), source: 'a', at: T0 });
    expect(fx.rate('GBP')?.source).toBe('b');
    expect(fx.rate('JPY')?.source).toBe('c');
    expect(fx.rate('CHF')).toBeNull();
  });

  it('falls back in order: #1 down (3 failures in a row) → #2, #2 down too → #3; and back up when #1 recovers', async () => {
    const c = clockAt(T0);
    let up = { a: true, b: true };
    const fx = createFxRates(
      [stub('a', () => (up.a ? { EUR: '0.90' } : new Error('down'))), stub('b', () => (up.b ? { EUR: '0.91' } : new Error('down'))), stub('c', () => ({ EUR: '0.92' }))],
      { clock: c.clock },
    );
    await fx.poll();
    expect(fx.rate('EUR')?.source).toBe('a');
    up = { a: false, b: true };
    for (let i = 1; i <= 2; i++) {
      c.advance(5 * MIN);
      await fx.poll();
      expect(fx.rate('EUR')?.source, `failure ${i}: retried quietly, its fresh rate still used`).toBe('a');
    }
    c.advance(5 * MIN);
    await fx.poll();
    expect(fx.rate('EUR')).toEqual({ currency: 'EUR', rate: r('0.91'), source: 'b', at: c.clock() });
    up = { a: false, b: false };
    for (let i = 0; i < 3; i++) {
      c.advance(5 * MIN);
      await fx.poll();
    }
    expect(fx.rate('EUR')?.source).toBe('c');
    up = { a: true, b: false };
    c.advance(5 * MIN);
    await fx.poll();
    expect(fx.rate('EUR')?.source).toBe('a');
  });

  it('a source is stale when its last good fetch of that currency is 1 h old (fetch time), and the next is used', async () => {
    const c = clockAt(T0);
    let aHasEur = true;
    const fx = createFxRates(
      [stub('a', () => (aHasEur ? { EUR: '0.90', GBP: '0.75' } : { GBP: '0.75' })), stub('b', () => ({ EUR: '0.91' }))],
      { clock: c.clock, failLimit: 1_000 }, // only staleness moves it here
    );
    await fx.poll();
    aHasEur = false;
    c.set(new Date(T0.getTime() + HOUR));
    await fx.poll();
    expect(fx.rate('EUR')?.source, 'exactly 1 h old is still fresh').toBe('a');
    c.set(new Date(T0.getTime() + HOUR + 1));
    expect(fx.rate('EUR')).toEqual({ currency: 'EUR', rate: r('0.91'), source: 'b', at: new Date(T0.getTime() + HOUR) });
    expect(fx.rate('GBP')?.source).toBe('a');
  });

  it('a rate that has not moved all weekend stays fresh: staleness is by fetch time, never "unchanged"', async () => {
    const c = clockAt(new Date('2026-10-24T00:00:00Z')); // Saturday
    const fx = createFxRates([stub('a', () => ({ EUR: '0.892572' })), stub('b', () => ({ EUR: '0.8937' }))], { clock: c.clock });
    for (let t = 0; t <= 48 * HOUR; t += FX_DEFAULTS.pollMs) {
      c.set(new Date(Date.parse('2026-10-24T00:00:00Z') + t));
      await fx.poll();
      expect(fx.rate('EUR'), `at +${t / MIN} min`).toEqual({ currency: 'EUR', rate: r('0.892572'), source: 'a', at: c.clock() });
    }
  });

  it('when no source is fresh the currency has no rate; others are unaffected', async () => {
    const c = clockAt(T0);
    let ngn = true;
    const answer = () => (ngn ? { EUR: '0.90', NGN: '1332' } : { EUR: '0.90' });
    const fx = createFxRates([stub('a', answer), stub('b', answer), stub('c', answer)], { clock: c.clock });
    await fx.poll();
    expect(fx.rate('NGN')?.source).toBe('a');
    ngn = false;
    for (let i = 0; i < 3; i++) {
      c.advance(5 * MIN);
      await fx.poll();
    }
    expect(fx.rate('NGN')).toBeNull();
    expect(fx.rate('EUR')?.source).toBe('a');
    // Even with no failure limit, NGN goes once the last rate is 1 h old.
    const c2 = clockAt(T0);
    ngn = true;
    const fx2 = createFxRates([stub('a', answer)], { clock: c2.clock, failLimit: 1_000 });
    await fx2.poll();
    ngn = false;
    c2.advance(HOUR + 1);
    await fx2.poll();
    expect(fx2.rate('NGN')).toBeNull();
    expect(fx2.rate('EUR')).not.toBeNull();
  });

  describe('sanity guard', () => {
    it('with no last good value (boot), #1 is used only if another fresh source agrees: a bad first fetch is refused', async () => {
      const c = clockAt(T0);
      let a = '90'; // 100× the real EUR rate
      const fx = createFxRates([stub('a', () => ({ EUR: a })), stub('b', () => ({ EUR: '0.90' })), stub('c', () => ({ EUR: '0.901' }))], { clock: c.clock });
      await fx.poll();
      expect(fx.rate('EUR')).toEqual({ currency: 'EUR', rate: r('0.90'), source: 'b', at: T0 });
      expect(fx.health().rejected).toEqual([{ source: 'a', currency: 'EUR', at: T0 }]);
      // The correct value is accepted at the next poll, not refused for an hour.
      a = '0.899';
      c.advance(5 * MIN);
      await fx.poll();
      expect(fx.rate('EUR')?.source).toBe('a');
      expect(fx.health().rejected).toEqual([]);
    });

    it('a restart (fresh state) cross-checks again, and the trust order stays (no average)', async () => {
      const c = clockAt(T0);
      const fresh = () => createFxRates([stub('a', () => ({ EUR: '0.95' })), stub('b', () => ({ EUR: '0.90' }))], { clock: c.clock });
      const fx = fresh();
      await fx.poll();
      expect(fx.rate('EUR'), 'within 10% of b: #1 is used as is').toEqual({ currency: 'EUR', rate: r('0.95'), source: 'a', at: T0 });
      const bad = createFxRates([stub('a', () => ({ EUR: '9.5' })), stub('b', () => ({ EUR: '0.90' }))], { clock: c.clock });
      await bad.poll();
      expect(bad.rate('EUR'), 'a and b disagree: b agrees with no one either, so nothing is used').toBeNull();
      expect(bad.health().rejected.map((x) => x.source)).toEqual(['a', 'b']);
    });

    it('once the last in-use value is over 1 h old, the next fetch is cross-checked again', async () => {
      const c = clockAt(T0);
      let a: Record<string, string> | Error = { EUR: '0.90' };
      let b: Record<string, string> | Error = { EUR: '0.90' };
      const fx = createFxRates([stub('a', () => a), stub('b', () => b)], { clock: c.clock, staleAfterMs: 3 * HOUR, failLimit: 1_000 });
      await fx.poll();
      a = new Error('down');
      b = new Error('down');
      c.advance(HOUR + 1);
      await fx.poll();
      a = { EUR: '90' };
      b = { EUR: '0.91' };
      c.advance(1);
      await fx.poll();
      expect(fx.rate('EUR')).toBeNull();
      expect(fx.health().rejected.map((x) => x.source)).toEqual(['a', 'b']);
    });

    it('a currency only one source has is accepted unchecked', async () => {
      const c = clockAt(T0);
      const fx = createFxRates([stub('a', () => ({ EUR: '0.90', GBP: '0.75' })), stub('b', () => ({ EUR: '0.90' }))], { clock: c.clock });
      await fx.poll();
      expect(fx.rate('GBP')).toEqual({ currency: 'GBP', rate: r('0.75'), source: 'a', at: T0 });
    });

    it('cannot be walked: a rate more than 10% from ANY in-use value of the last hour is refused (9% steps)', async () => {
      const c = clockAt(T0);
      let a = 0.9;
      const fx = createFxRates([stub('a', () => ({ EUR: a.toFixed(6) })), stub('b', () => ({ EUR: '0.90' }))], { clock: c.clock });
      await fx.poll();
      const used: string[] = [];
      for (let i = 0; i < 12; i++) {
        a *= 1.09;
        c.advance(5 * MIN);
        await fx.poll();
        used.push(fx.rate('EUR')!.source);
      }
      expect(used[0], 'the first 9% step is fine').toBe('a');
      expect(used.slice(1), 'every later step is more than 10% from 0.90').toEqual(Array(11).fill('b'));
      expect(fx.health().rejected).toEqual([{ source: 'a', currency: 'EUR', at: c.clock() }]);
    });

    it('a move over 10% from the last good value within 1 h fails that source for that currency: fall back at once', async () => {
      const c = clockAt(T0);
      let a = '0.90';
      const fx = createFxRates([stub('a', () => ({ EUR: a, GBP: '0.75' })), stub('b', () => ({ EUR: '0.905' }))], { clock: c.clock });
      await fx.poll();
      a = '0.991'; // +10.1%
      c.advance(5 * MIN);
      await fx.poll();
      expect(fx.rate('EUR')).toEqual({ currency: 'EUR', rate: r('0.905'), source: 'b', at: c.clock() });
      expect(fx.rate('GBP')?.source, 'only that currency falls back').toBe('a');
      expect(fx.health().rejected).toEqual([{ source: 'a', currency: 'EUR', at: c.clock() }]);
      const a1 = fx.health().sources.find((s) => s.name === 'a')!;
      expect(a1.consecutiveFailures, 'the fetch itself was fine').toBe(0);
      // Back within range: accepted again.
      a = '0.95';
      c.advance(5 * MIN);
      await fx.poll();
      expect(fx.rate('EUR')?.source).toBe('a');
      expect(fx.health().rejected).toEqual([]);
    });

    it('exactly 10% is accepted; the setting changes the limit', async () => {
      const c = clockAt(T0);
      let a = '1.00';
      let bps = 1_000;
      const fx = createFxRates([stub('a', () => ({ EUR: a }))], {
        clock: c.clock, settings: () => ({ staleAfterMs: HOUR, sanityBps: bps }),
      });
      await fx.poll();
      a = '1.10';
      c.advance(5 * MIN);
      await fx.poll();
      expect(fx.rate('EUR')?.rate).toBe(r('1.10'));
      a = '1.155'; // +5% from 1.10
      bps = 400;
      c.advance(5 * MIN);
      await fx.poll();
      expect(fx.rate('EUR')).toBeNull();
      expect(fx.health().settings).toEqual({ staleAfterMs: HOUR, sanityBps: 400 });
    });

    it('compares against the last good value only while it is under 1 h old', async () => {
      const c = clockAt(T0);
      let a: Record<string, string> | Error = { EUR: '0.90' };
      const fx = createFxRates([stub('a', () => a)], { clock: c.clock, staleAfterMs: 3 * HOUR, failLimit: 1_000 });
      await fx.poll();
      a = new Error('down');
      c.advance(HOUR);
      await fx.poll();
      a = { EUR: '1.20' };
      c.advance(1);
      await fx.poll();
      expect(fx.rate('EUR')?.rate, 'the last good value is over 1 h old: nothing to compare with').toBe(r('1.20'));
    });

    it('a real jump on 2+ sources that agree with each other and with none of the last hour replaces the history at once', async () => {
      const c = clockAt(T0);
      let ngn = '1332';
      const answer = () => ({ EUR: '0.90', NGN: ngn });
      const fx = createFxRates([stub('a', answer), stub('b', answer), stub('c', answer)], { clock: c.clock });
      await fx.poll();
      ngn = '1600';
      c.advance(5 * MIN);
      await fx.poll();
      expect(fx.rate('NGN')).toEqual({ currency: 'NGN', rate: r('1600'), source: 'a', at: c.clock() });
      expect(fx.health().rejected).toEqual([]);
    });

    it('#2 and #3 jumping 20% together never refuse a steady #1: the trust order holds (re-review)', async () => {
      const c = clockAt(T0);
      let low = '1332';
      const fx = createFxRates([stub('a', () => ({ NGN: '1332' })), stub('b', () => ({ NGN: low })), stub('c', () => ({ NGN: low }))], { clock: c.clock });
      await fx.poll();
      low = '1598.4';
      c.advance(5 * MIN);
      await fx.poll();
      expect(fx.rate('NGN')).toEqual({ currency: 'NGN', rate: r('1332'), source: 'a', at: c.clock() });
      expect(fx.health().rejected.map((x) => x.source)).toEqual(['b', 'c']);
      c.advance(5 * MIN);
      await fx.poll();
      expect(fx.rate('NGN')?.source, 'the next poll too: the history is still #1').toBe('a');
    });

    it('a jump only #2 and #3 agree on is no real jump while #1 still holds a usable rate it did not fetch this poll', async () => {
      const c = clockAt(T0);
      let a: string | Error = '1332';
      let low = '1332';
      const fx = createFxRates([stub('a', () => (a instanceof Error ? a : { NGN: a })), stub('b', () => ({ NGN: low })), stub('c', () => ({ NGN: low }))], { clock: c.clock });
      await fx.poll();
      a = new Error('blip');
      low = '1598.4';
      c.advance(5 * MIN);
      await fx.poll();
      expect(fx.rate('NGN')?.source, 'one failure is retried quietly: #1 still serves').toBe('a');
      a = '1332';
      c.advance(5 * MIN);
      await fx.poll();
      expect(fx.rate('NGN')).toEqual({ currency: 'NGN', rate: r('1332'), source: 'a', at: c.clock() });
    });

    it('with #1 down, a jump #2 and #3 agree on is a real jump (#2 is the highest-ranked fresh source)', async () => {
      const c = clockAt(T0);
      let a: string | Error = '1332';
      let low = '1332';
      const fx = createFxRates([stub('a', () => (a instanceof Error ? a : { NGN: a })), stub('b', () => ({ NGN: low })), stub('c', () => ({ NGN: low }))], { clock: c.clock });
      await fx.poll();
      a = new Error('down');
      for (let i = 0; i < 3; i++) {
        c.advance(5 * MIN);
        await fx.poll();
      }
      expect(fx.rate('NGN')?.source).toBe('b');
      low = '1600';
      c.advance(5 * MIN);
      await fx.poll();
      expect(fx.rate('NGN')).toEqual({ currency: 'NGN', rate: r('1600'), source: 'b', at: c.clock() });
      expect(fx.health().rejected).toEqual([]);
    });

    it('#1 jumping first (refused alone), then #2 and #3 joining it: a real jump, #1 serves the new rate', async () => {
      const c = clockAt(T0);
      let a = '1332';
      let low = '1332';
      const fx = createFxRates([stub('a', () => ({ NGN: a })), stub('b', () => ({ NGN: low })), stub('c', () => ({ NGN: low }))], { clock: c.clock });
      await fx.poll();
      a = '1600';
      c.advance(5 * MIN);
      await fx.poll();
      expect(fx.rate('NGN')?.source).toBe('b');
      low = '1600';
      c.advance(5 * MIN);
      await fx.poll();
      expect(fx.rate('NGN')).toEqual({ currency: 'NGN', rate: r('1600'), source: 'a', at: c.clock() });
    });

    it('one source jumping alone is still refused against the history (no drop)', async () => {
      const c = clockAt(T0);
      let a = '1332';
      const fx = createFxRates([stub('a', () => ({ NGN: a })), stub('b', () => ({ NGN: '1332' })), stub('c', () => ({ NGN: '1333' }))], { clock: c.clock });
      await fx.poll();
      a = '1600';
      c.advance(5 * MIN);
      await fx.poll();
      expect(fx.rate('NGN')?.source).toBe('b');
      expect(fx.health().rejected.map((x) => x.source)).toEqual(['a']);
    });
  });

  describe('no history: the cross-check fails closed (review I-1)', () => {
    it('boot with #2 and #3 down and #1 wrong: nothing is served; #2 and #3 back correct: #2; #1 correct again: #1', async () => {
      const c = clockAt(T0);
      let a = '90'; // 100× the real EUR rate
      let up = false;
      const fx = createFxRates(
        [stub('a', () => ({ EUR: a })), stub('b', () => (up ? { EUR: '0.90' } : new Error('down'))), stub('c', () => (up ? { EUR: '0.901' } : new Error('down')))],
        { clock: c.clock },
      );
      await fx.poll();
      expect(fx.rate('EUR'), 'no peer could check it, and b and c may list EUR').toBeNull();
      expect(fx.health().rejected).toEqual([{ source: 'a', currency: 'EUR', at: T0 }]);
      for (let i = 0; i < 48; i++) {
        c.advance(5 * MIN);
        await fx.poll();
        expect(fx.rate('EUR'), `+${(i + 1) * 5} min`).toBeNull();
      }
      up = true;
      c.advance(5 * MIN);
      await fx.poll();
      expect(fx.rate('EUR')).toEqual({ currency: 'EUR', rate: r('0.90'), source: 'b', at: c.clock() });
      a = '0.899';
      c.advance(5 * MIN);
      await fx.poll();
      expect(fx.rate('EUR')?.source).toBe('a');
      expect(fx.health().rejected).toEqual([]);
    });

    it('only #2 back, disagreeing with #1: neither can be checked, so nothing is served', async () => {
      const c = clockAt(T0);
      let up = false;
      const fx = createFxRates(
        [stub('a', () => ({ EUR: '90' })), stub('b', () => (up ? { EUR: '0.90' } : new Error('down'))), stub('c', () => new Error('down'))],
        { clock: c.clock },
      );
      await fx.poll();
      up = true;
      c.advance(5 * MIN);
      await fx.poll();
      expect(fx.rate('EUR')).toBeNull();
    });

    it('a truly single-source currency (every other source answered without it) is accepted unchecked', async () => {
      const c = clockAt(T0);
      const fx = createFxRates([stub('a', () => ({ EUR: '0.90', VND: '25842' })), stub('b', () => ({ EUR: '0.90' })), stub('c', () => ({ EUR: '0.90' }))], { clock: c.clock });
      await fx.poll();
      expect(fx.rate('VND')).toEqual({ currency: 'VND', rate: r('25842'), source: 'a', at: T0 });
      // An earlier good fetch without it counts too, while that source is down now.
      let bUp = true;
      const fx2 = createFxRates([stub('a', () => ({ VND: '25842' })), stub('b', () => (bUp ? { EUR: '0.90' } : new Error('down')))], { clock: c.clock });
      bUp = true;
      await fx2.poll();
      expect(fx2.rate('VND')?.source).toBe('a');
      let aUp = true;
      const fx3 = createFxRates(
        [stub('b', () => (bUp ? { EUR: '0.90' } : new Error('down'))), stub('a', () => (aUp ? { VND: '25842' } : new Error('down')))],
        { clock: c.clock },
      );
      bUp = false;
      await fx3.poll();
      expect(fx3.rate('VND'), 'b has never answered: it might list VND').toBeNull();
      bUp = true;
      c.advance(5 * MIN);
      await fx3.poll();
      expect(fx3.rate('VND')?.source).toBe('a');
      // Both down for over an hour (the history ages out), then a back while b is still down.
      aUp = false;
      bUp = false;
      c.advance(HOUR + 1);
      await fx3.poll();
      aUp = true;
      c.advance(1);
      await fx3.poll();
      expect(fx3.rate('VND')?.source, "b's last good fetch did not list VND: still single-source").toBe('a');
    });

    it('a peer whose last good rate is over 1 h old is not used for the cross-check (m-1)', async () => {
      const c = clockAt(T0);
      let a: Record<string, string> | Error = { EUR: '0.90' };
      let b: Record<string, string> | Error = { EUR: '0.90' };
      const fx = createFxRates([stub('a', () => a), stub('b', () => b)], { clock: c.clock, failLimit: 1_000 });
      await fx.poll();
      expect(fx.rate('EUR')?.source).toBe('a');
      a = new Error('down');
      b = new Error('down');
      c.advance(HOUR + 1);
      await fx.poll();
      a = { EUR: '0.90' };
      c.advance(1);
      await fx.poll();
      expect(fx.rate('EUR'), "b's 0.90 is over 1 h old: no fresh peer, and b lists EUR").toBeNull();
    });
  });

  it('health: per source last good fetch, consecutive failures, stale and which currencies it serves', async () => {
    const c = clockAt(T0);
    let a: Record<string, string> | Error = { EUR: '0.90' };
    const fx = createFxRates([stub('a', () => a), stub('b', () => ({ EUR: '0.91', GBP: '0.75' }))], { clock: c.clock });
    expect(fx.polled()).toBe(false);
    await fx.poll();
    expect(fx.polled()).toBe(true);
    expect(fx.health().sources).toEqual([
      { name: 'a', rank: 1, lastGoodAt: T0, consecutiveFailures: 0, stale: false, usedFor: ['EUR'] },
      { name: 'b', rank: 2, lastGoodAt: T0, consecutiveFailures: 0, stale: false, usedFor: ['GBP'] },
    ]);
    a = new Error('down');
    for (let i = 0; i < 3; i++) {
      c.advance(5 * MIN);
      await fx.poll();
    }
    expect(fx.health().sources[0]).toEqual({ name: 'a', rank: 1, lastGoodAt: T0, consecutiveFailures: 3, stale: false, usedFor: [] });
    expect(fx.health().sources[1]!.usedFor).toEqual(['EUR', 'GBP']);
    c.set(new Date(T0.getTime() + HOUR + 1));
    expect(fx.health().sources[0]!.stale).toBe(true);
  });

  it('never throws past poll, gives a hanging source its timeout, and polls one at a time', async () => {
    vi.useFakeTimers({ now: T0 });
    try {
      let aborted = false;
      let calls = 0;
      const hang: FxSource = {
        name: 'hang',
        fetchRates: (signal) => {
          calls++;
          return new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              aborted = true;
              reject(signal.reason);
            });
          });
        },
      };
      const syncThrow: FxSource = {
        name: 'sync',
        fetchRates: () => {
          throw new Error('boom');
        },
      };
      const fx = createFxRates([hang, syncThrow, stub('b', () => ({ EUR: '0.9' }))], {});
      const done = fx.poll();
      expect(fx.poll()).toBe(done);
      await vi.advanceTimersByTimeAsync(FX_DEFAULTS.timeoutMs - 1);
      expect(aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(done).resolves.toBeUndefined();
      expect(aborted).toBe(true);
      expect(calls).toBe(1);
      expect(fx.rate('EUR'), 'b alone, and the others might list EUR: not checked, not used').toBeNull();
      expect(fx.health().sources.map((s) => s.consecutiveFailures)).toEqual([1, 1, 0]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a failing settings read keeps the last settings (defaults at first)', async () => {
    const c = clockAt(T0);
    let fail = false;
    const fx = createFxRates([stub('a', () => ({ EUR: '0.9' }))], {
      clock: c.clock,
      settings: async () => {
        if (fail) throw new Error('db down');
        return { staleAfterMs: 2 * HOUR, sanityBps: 500 };
      },
    });
    await fx.poll();
    expect(fx.health().settings).toEqual({ staleAfterMs: 2 * HOUR, sanityBps: 500 });
    fail = true;
    c.advance(5 * MIN);
    await fx.poll();
    expect(fx.health().settings).toEqual({ staleAfterMs: 2 * HOUR, sanityBps: 500 });
  });
});
