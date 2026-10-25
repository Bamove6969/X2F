import { CURRENCY_EXPONENTS } from './currencies.js';
import type { PriceSourceHealth } from './feed.js';
import { FX_DEFAULTS, type FxHealth } from './fx.js';

/**
 * Price health alerts for the owner (spec 11.6, owner 2026-10-24). One failed fetch is retried
 * quietly; `failLimit` failures in a row, or a stale source, raise "<Source> … failing, using
 * backup"; every source for a currency down raises an urgent "<CCY> market prices paused"; each
 * recovery sends an all-clear. Alerts are grouped by outage: a condition alerts when it starts and
 * when it ends, never once per fetch.
 */

export type PriceAlertKind = 'price-source-failing' | 'price-source-recovered' | 'market-prices-paused' | 'market-prices-resumed';

export interface PriceAlertDetail {
  message: string;
  feed?: 'xmr' | 'fx';
  source?: string;
  reason?: 'failures' | 'stale' | 'rejected';
  currencies?: string[];
  urgent?: true;
}

export interface PriceAlert {
  kind: PriceAlertKind;
  detail: PriceAlertDetail;
}

export interface HealthSnapshot {
  /** When it was taken (the quiet period runs on this clock). */
  at: Date;
  xmr: PriceSourceHealth[];
  fx: FxHealth;
  /** Currencies with no market price right now. */
  paused: string[];
}

const LABELS: Readonly<Record<string, string>> = {
  kraken: 'Kraken', bitfinex: 'Bitfinex', coingecko: 'CoinGecko', coinbase: 'Coinbase', bitpay: 'BitPay',
};
const label = (name: string): string => LABELS[name] ?? name;

interface Condition {
  feed: 'xmr' | 'fx';
  source: string;
  currency?: string;
  reason: 'failures' | 'stale' | 'rejected';
}

function failingAlert(c: Condition): PriceAlert {
  const who = label(c.source);
  const message = c.feed === 'xmr' ? `${who} price feed failing, using backup` : `${who} exchange rates ${c.reason === 'stale' ? 'stale' : 'failing'}, using backup`;
  return { kind: 'price-source-failing', detail: { feed: c.feed, source: c.source, reason: c.reason, message } };
}

function recoveredAlert(c: Condition): PriceAlert {
  const who = label(c.source);
  return { kind: 'price-source-recovered', detail: { feed: c.feed, source: c.source, message: `${who} ${c.feed === 'xmr' ? 'price feed' : 'exchange rates'} recovered` } };
}

/** "EUR rate", "EUR, GBP rates", or "rates for 44 currencies" once the list gets long. */
function ratesOf(currencies: string[]): string {
  if (currencies.length === 1) return `${currencies[0]!} rate`;
  return currencies.length <= 5 ? `${currencies.join(', ')} rates` : `rates for ${currencies.length} currencies`;
}

/**
 * Sanity-guard refusals, grouped per source per snapshot (re-review): ONE alert listing every
 * currency of that source the snapshot newly refused, and ONE all-clear for those it clears.
 */
function groupRejected(cs: Condition[], make: (source: string, currencies: string[]) => PriceAlert): PriceAlert[] {
  const by = new Map<string, string[]>();
  for (const c of cs) by.set(c.source, [...(by.get(c.source) ?? []), c.currency!]);
  return [...by].map(([source, currencies]) => make(source, currencies.sort()));
}

const rejectedAlert = (sanityBps: number) => (source: string, currencies: string[]): PriceAlert => ({
  kind: 'price-source-failing',
  detail: { feed: 'fx', source, reason: 'rejected', currencies, message: `${label(source)} ${ratesOf(currencies)} off by more than ${sanityBps / 100}%, using backup` },
});

const inRangeAlert = (source: string, currencies: string[]): PriceAlert => ({
  kind: 'price-source-recovered',
  detail: { feed: 'fx', source, currencies, message: `${label(source)} ${ratesOf(currencies)} back in range` },
});

const EVERY = Object.keys(CURRENCY_EXPONENTS).length;

/**
 * The quiet period: a condition (a failing source, a refused rate, a paused currency) counts as
 * over only once it has stayed away for `quietPolls` snapshots in a row AND at least `quietMs`.
 * Until then a return is the same outage, so a flapping source alerts once, not once per flap.
 */
export const PRICE_HEALTH_DEFAULTS = Object.freeze({ quietPolls: 3, quietMs: 15 * 60_000 });

export interface AlertGrouperOptions {
  failLimit?: number;
  quietPolls?: number;
  quietMs?: number;
}

export interface AlertGrouper {
  /** The alerts this snapshot starts or ends, in order: sources first, then currencies. */
  update(s: HealthSnapshot): PriceAlert[];
}

interface Open<T> {
  value: T;
  /** When it was first seen absent in the current clean run, and how many snapshots that run has. */
  absentSince: number | null;
  absentPolls: number;
}

export function createAlertGrouper(o: AlertGrouperOptions = {}): AlertGrouper {
  const failLimit = o.failLimit ?? FX_DEFAULTS.failLimit;
  const quietPolls = o.quietPolls ?? PRICE_HEALTH_DEFAULTS.quietPolls;
  const quietMs = o.quietMs ?? PRICE_HEALTH_DEFAULTS.quietMs;
  const sources = new Map<string, Open<Condition>>();
  const paused = new Map<string, Open<string>>();

  /** Opens the new keys, keeps the returning ones, and closes those quiet long enough; returns [started, ended]. */
  function step<T>(open: Map<string, Open<T>>, present: Map<string, T>, at: number): [T[], T[]] {
    const started: T[] = [];
    const ended: T[] = [];
    for (const [key, value] of present) {
      const cur = open.get(key);
      if (cur) {
        cur.absentSince = null; // back during the quiet period: the same outage
        cur.absentPolls = 0;
      } else {
        open.set(key, { value, absentSince: null, absentPolls: 0 });
        started.push(value);
      }
    }
    for (const [key, cur] of open) {
      if (present.has(key)) continue;
      cur.absentSince ??= at;
      cur.absentPolls++;
      if (cur.absentPolls >= quietPolls && at - cur.absentSince >= quietMs) {
        open.delete(key);
        ended.push(cur.value);
      }
    }
    return [started, ended];
  }

  return {
    update(s) {
      const at = s.at.getTime();
      const now = new Map<string, Condition>();
      for (const x of s.xmr) {
        if (x.consecutiveFailures >= failLimit) now.set(`xmr:${x.name}`, { feed: 'xmr', source: x.name, reason: 'failures' });
      }
      for (const f of s.fx.sources) {
        if (f.consecutiveFailures >= failLimit || f.stale) {
          now.set(`fx:${f.name}`, { feed: 'fx', source: f.name, reason: f.stale ? 'stale' : 'failures' });
        }
      }
      for (const r of s.fx.rejected) {
        now.set(`fx:${r.source}:${r.currency}`, { feed: 'fx', source: r.source, currency: r.currency, reason: 'rejected' });
      }
      // A condition keeps the reason it started with: stale → failing is the same outage.
      const [failing, recovered] = step(sources, now, at);
      const isRejected = (c: Condition) => c.reason === 'rejected';
      const out: PriceAlert[] = [
        ...failing.filter((c) => !isRejected(c)).map(failingAlert),
        ...groupRejected(failing.filter(isRejected), rejectedAlert(s.fx.settings.sanityBps)),
        ...recovered.filter((c) => !isRejected(c)).map(recoveredAlert),
        ...groupRejected(recovered.filter(isRejected), inRangeAlert),
      ];

      const [started, ended] = step(paused, new Map(s.paused.map((c) => [c, c])), at);
      started.sort();
      ended.sort();
      if (started.length > 0) {
        const message = s.paused.length >= EVERY ? 'Market prices paused in every currency' : `${started.join(', ')} market prices paused`;
        out.push({ kind: 'market-prices-paused', detail: { urgent: true, currencies: started, message } });
      }
      if (ended.length > 0) {
        const message = paused.size === 0 && ended.length >= EVERY ? 'Market prices back in every currency' : `${ended.join(', ')} market prices back`;
        out.push({ kind: 'market-prices-resumed', detail: { currencies: ended, message } });
      }
      return out;
    },
  };
}
