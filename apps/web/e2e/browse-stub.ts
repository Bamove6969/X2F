// The browse API stub the sell and buy browse specs share: `GET /v1/methods`, `/v1/offers`,
// `/v1/price`, `POST /v1/method-suggestions` and the session probe, in the Task 3/4 shapes that
// src/screens/browse/api.ts reads (see test/browse-tripwire.test.ts).
import { readFileSync } from 'node:fs';
import type { Page, Request } from '@playwright/test';
import { INSIDE } from './session.js';

export type Row = { id: string; name: string; group: string; giftCard: boolean; offers: number; bestRate: string | null };

/** Every method a person can pick (the catalog without the ones waiting for legal review). */
export const CATALOG = (
  JSON.parse(readFileSync(new URL('../../../data/payment-methods.json', import.meta.url), 'utf8')) as {
    methods: { id: string; name: string; group: string; giftCard?: boolean; legalReview?: string }[];
  }
).methods.filter((m) => !m.legalReview);

export interface BrowseStub {
  signedIn?: boolean;
  /** The live rows per currency, in the API's default "most offers" order. */
  live: Record<string, readonly Row[]>;
  /** The offers the API sends for a currency (any method). */
  offers: (currency: string) => unknown[];
  /** The market price per currency, minor units per XMR as a string. */
  market: Record<string, string>;
}

export interface Seen {
  requests: Request[];
  suggestions: unknown[];
}

/**
 * The method lists the API would send: `live` sorted for `sort` (Best rate is highest first for buy
 * ads, which pay the seller, and lowest first for sell ads, which charge the buyer), and `all` the
 * catalog A–Z with each live row in place.
 */
function methodLists(rows: readonly Row[], adSide: string, sort: string): { live: Row[]; all: Row[] } {
  const live = [...rows];
  const name = (a: Row, b: Row) => a.name.localeCompare(b.name, 'en');
  if (sort === 'rate') live.sort((a, b) => (adSide === 'buy' ? Number(b.bestRate) - Number(a.bestRate) : Number(a.bestRate) - Number(b.bestRate)) || name(a, b));
  if (sort === 'az') live.sort(name);
  const byId = new Map(live.map((r) => [r.id, r]));
  const all = CATALOG.map((m) => byId.get(m.id) ?? { id: m.id, name: m.name, group: m.group, giftCard: m.giftCard === true, offers: 0, bestRate: null }).sort(name);
  return { live, all };
}

export async function stubBrowseApi(page: Page, o: BrowseStub): Promise<Seen> {
  const seen: Seen = { requests: [], suggestions: [] };
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.startsWith('/v1/')) seen.requests.push(r);
  });
  await page.route('**/v1/account/me', (r) =>
    o.signedIn !== false ? r.fulfill({ json: { displayName: 'viewer_1', ...INSIDE } }) : r.fulfill({ status: 401, json: { error: 'unauthenticated' } }),
  );
  await page.route('**/v1/methods?*', (r) => {
    const q = new URL(r.request().url()).searchParams;
    return r.fulfill({ json: methodLists(o.live[q.get('currency') ?? ''] ?? [], q.get('side') ?? '', q.get('sort') ?? 'buyers') });
  });
  await page.route('**/v1/price?*', (r) => {
    const currency = new URL(r.request().url()).searchParams.get('currency') ?? '';
    const centsPerXmr = o.market[currency];
    return centsPerXmr === undefined
      ? r.fulfill({ status: 503, json: { error: 'price-unavailable' } })
      : r.fulfill({ json: { currency, centsPerXmr, exponent: 2, at: new Date().toISOString() } });
  });
  await page.route('**/v1/offers?*', (r) => r.fulfill({ json: o.offers(new URL(r.request().url()).searchParams.get('currency') ?? '') }));
  await page.route('**/v1/method-suggestions', async (r) => {
    seen.suggestions.push(r.request().postDataJSON());
    return r.fulfill({ status: 202, json: {} });
  });
  return seen;
}
