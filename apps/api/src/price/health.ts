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
  currency?: string;
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

function failingAlert(c: Condition, sanityBps: number): PriceAlert {
  const who = label(c.source);
  let message: string;
  if (c.reason === 'rejected') message = `${who} ${c.currency!} rate off by more than ${sanityBps / 100}%, using backup`;
  else if (c.feed === 'xmr') message = `${who} price feed failing, using backup`;
  else message = `${who} exchange rates ${c.reason === 'stale' ? 'stale' : 'failing'}, using backup`;
  const detail: PriceAlertDetail = { feed: c.feed, source: c.source, ...(c.currency ? { currency: c.currency } : {}), reason: c.reason, message };
  return { kind: 'price-source-failing', detail };
}

function recoveredAlert(c: Condition): PriceAlert {
  const who = label(c.source);
  const message = c.currency
    ? `${who} ${c.currency} rate back in range`
    : `${who} ${c.feed === 'xmr' ? 'price feed' : 'exchange rates'} recovered`;
  return { kind: 'price-source-recovered', detail: { feed: c.feed, source: c.source, ...(c.currency ? { currency: c.currency } : {}), message } };
}

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
      const out: PriceAlert[] = [
        ...failing.map((c) => failingAlert(c, s.fx.settings.sanityBps)),
        ...recovered.map(recoveredAlert),
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
