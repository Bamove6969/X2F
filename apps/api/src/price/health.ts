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
  if (c.reason === 'rejected') message = `${who} ${c.currency!} rate moved more than ${sanityBps / 100}%, using backup`;
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

export interface AlertGrouper {
  /** The alerts this snapshot starts or ends, in order: sources first, then currencies. */
  update(s: HealthSnapshot): PriceAlert[];
}

export function createAlertGrouper(o: { failLimit?: number } = {}): AlertGrouper {
  const failLimit = o.failLimit ?? FX_DEFAULTS.failLimit;
  const active = new Map<string, Condition>();
  let paused = new Set<string>();

  return {
    update(s) {
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
      const out: PriceAlert[] = [];
      for (const [key, c] of now) if (!active.has(key)) out.push(failingAlert(c, s.fx.settings.sanityBps));
      for (const [key, c] of active) if (!now.has(key)) out.push(recoveredAlert(c));
      // A condition keeps the reason it started with: stale → failing is the same outage.
      for (const key of [...active.keys()]) if (!now.has(key)) active.delete(key);
      for (const [key, c] of now) if (!active.has(key)) active.set(key, c);

      const next = new Set(s.paused);
      const started = [...next].filter((c) => !paused.has(c)).sort();
      const ended = [...paused].filter((c) => !next.has(c)).sort();
      if (started.length > 0) {
        const message = next.size >= EVERY ? 'Market prices paused in every currency' : `${started.join(', ')} market prices paused`;
        out.push({ kind: 'market-prices-paused', detail: { urgent: true, currencies: started, message } });
      }
      if (ended.length > 0) {
        const message = next.size === 0 && ended.length >= EVERY ? 'Market prices back in every currency' : `${ended.join(', ')} market prices back`;
        out.push({ kind: 'market-prices-resumed', detail: { currencies: ended, message } });
      }
      paused = next;
      return out;
    },
  };
}
