import type { Side } from '@x2f/trade';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireSession } from '../auth/sessions.js';
import { ApiError } from '../errors.js';
import { liveOfferStats } from '../offers/routes.js';
import { catalog, isAvailable, type CatalogMethod } from './profiles.js';

/** Which live offers to count: the ads' own side (what the poster does with XMR) and currency. */
export interface LiveOfferQuery {
  side: Side;
  currency: string;
}

/** Live offers for one method in the queried side and currency. */
export interface LiveOfferStat {
  methodId: string;
  offers: number;
  /** The best rate among them (highest for buy ads, lowest for sell ads), or null when none has a price now. */
  bestCentsPerXmr: bigint | null;
}

/** Counts live offers per method; by default Task 4's `liveOfferStats` over the `offers` table. */
export type LiveOfferStats = (q: LiveOfferQuery) => Promise<LiveOfferStat[]>;

export interface MethodRow {
  id: string;
  name: string;
  group: string;
  giftCard: boolean;
  offers: number;
  bestRate: string | null;
}

const SORTS = ['buyers', 'rate', 'az'] as const;
type Sort = (typeof SORTS)[number];

const SUGGEST_NAME_MAX = 60;
// Control (C0, C1, DEL) and format characters (bidi overrides, zero-width): never in a stored name.
const CONTROL = /[\p{Cc}\p{Cf}]/u;

/** A query value given exactly once as a string, else undefined (a repeated key arrives as an array). */
function single(q: unknown, key: string): string | undefined {
  const v = (q as Record<string, unknown> | null)?.[key];
  return typeof v === 'string' ? v : undefined;
}

function parseQuery(req: FastifyRequest): LiveOfferQuery & { sort: Sort } {
  const side = single(req.query, 'side');
  const currency = single(req.query, 'currency');
  const given = (req.query as Record<string, unknown> | null)?.sort !== undefined;
  const rawSort = single(req.query, 'sort');
  // A repeated `sort` arrives as an array: `given` but no single value, so refused.
  const sort = given ? SORTS.find((s) => s === rawSort) : 'buyers';
  if ((side !== 'sell' && side !== 'buy') || currency === undefined || !/^[A-Z]{3}$/.test(currency) || sort === undefined) {
    throw new ApiError(400, 'bad-request');
  }
  return { side, currency, sort };
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'en');

function compareRate(side: Side, a: bigint | null, b: bigint | null): number {
  if (a === b) return 0;
  if (a === null) return 1; // no price: last
  if (b === null) return -1;
  // Buy ads pay the seller: highest first. Sell ads charge the buyer: lowest first.
  const asc = a < b ? -1 : 1;
  return side === 'buy' ? -asc : asc;
}

export function methodListRoutes(app: FastifyInstance): void {
  // Browsing needs no session (P3-M9).
  app.get('/v1/methods', async (req) => {
    const q = parseQuery(req);
    const source = req.server.deps.liveOffers ?? liveOfferStats(req.server.deps);
    const stats = await source({ side: q.side, currency: q.currency });
    const byId = new Map<string, LiveOfferStat>();
    for (const s of stats) if (s.offers > 0 && isAvailable(s.methodId) && !byId.has(s.methodId)) byId.set(s.methodId, s);

    const row = (m: CatalogMethod): MethodRow => {
      const s = byId.get(m.id);
      return {
        id: m.id, name: m.name, group: m.group, giftCard: m.giftCard,
        offers: s?.offers ?? 0, bestRate: s?.bestCentsPerXmr === null || s === undefined ? null : s.bestCentsPerXmr.toString(),
      };
    };
    const available = catalog().filter((m) => isAvailable(m.id));
    const all = available.map(row).sort(byName);
    const live = available.filter((m) => byId.has(m.id)).sort(byName);
    if (q.sort === 'buyers') live.sort((a, b) => byId.get(b.id)!.offers - byId.get(a.id)!.offers || byName(a, b));
    if (q.sort === 'rate') {
      live.sort((a, b) => compareRate(q.side, byId.get(a.id)!.bestCentsPerXmr, byId.get(b.id)!.bestCentsPerXmr) || byName(a, b));
    }
    return { live: live.map(row), all };
  });

  // "Suggest a missing method" (P3-M3): stored with no account, session or exact time.
  app.post('/v1/method-suggestions', { preHandler: requireSession({ kinds: ['trader'] }) }, async (req, reply) => {
    const body = req.body;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'bad-request');
    const { name, country, ...rest } = body as Record<string, unknown>;
    if (Object.keys(rest).length > 0 || typeof name !== 'string') throw new ApiError(400, 'bad-request');
    const clean = name.trim();
    const length = [...clean].length;
    if (length < 1 || length > SUGGEST_NAME_MAX || CONTROL.test(clean)) throw new ApiError(400, 'bad-request');
    if (country !== undefined && (typeof country !== 'string' || !/^[A-Z]{2}$/.test(country))) throw new ApiError(400, 'bad-request');

    // Rows carry no account, so one budget covers every trader (503 `busy` when spent).
    req.server.budgets.suggest.take();

    const day = req.server.deps.clock().toISOString().slice(0, 10);
    await req.server.deps.db.query('insert into method_suggestions (name, country, created_on) values ($1, $2, $3)', [
      clean, country ?? null, day,
    ]);
    return reply.code(202).send({});
  });
}
