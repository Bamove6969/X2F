// My offers (Plan 3 Task 36): the API's two routes, parsed strictly so a renamed or missing field
// fails loudly. Shapes from apps/api/src/offers/routes.ts (`MyOffer`, `OfferSwitchResult`), built
// in the same task:
//   GET  /v1/account/offers → MyOffer[] (live and paused, newest first)
//   POST /v1/account/offers/status { ids: string[] | 'all', status: 'live' | 'paused' }
//        → { status, results: { id, status?, refused? }[] }, one result per offer named (or every
//        offer of mine for 'all'); a refused offer keeps its status and says why.
import { api } from '../../api/client.js';

export type OfferState = 'live' | 'paused';

export interface MyOffer {
  id: string;
  side: 'sell' | 'buy';
  methodId: string;
  methodName: string;
  currency: string;
  rate: bigint | null;
  pricing: { mode: 'market'; marginBps: number } | { mode: 'fixed'; centsPerXmr: bigint };
  minFiatCents: bigint;
  maxFiatCents: bigint;
  minTrades: number;
  country?: string;
  status: OfferState;
}

export interface SwitchResult {
  id: string;
  status?: OfferState;
  refused?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

function shape(): Error {
  return new Error('unexpected my offers answer');
}

function big(v: unknown): bigint {
  if (typeof v !== 'string' || !/^\d{1,30}$/.test(v)) throw shape();
  return BigInt(v);
}

function state(v: unknown): OfferState {
  if (v !== 'live' && v !== 'paused') throw shape();
  return v;
}

function str(v: unknown): string {
  if (typeof v !== 'string' || v.length === 0) throw shape();
  return v;
}

function parsePricing(v: unknown): MyOffer['pricing'] {
  if (isRecord(v) && v.mode === 'market' && typeof v.marginBps === 'number' && Number.isInteger(v.marginBps)) return { mode: 'market', marginBps: v.marginBps };
  if (isRecord(v) && v.mode === 'fixed') return { mode: 'fixed', centsPerXmr: big(v.centsPerXmr) };
  throw shape();
}

export function parseMyOffers(raw: unknown): MyOffer[] {
  if (!Array.isArray(raw)) throw shape();
  return raw.map((o: unknown) => {
    if (!isRecord(o)) throw shape();
    if (o.side !== 'sell' && o.side !== 'buy') throw shape();
    if (typeof o.minTrades !== 'number') throw shape();
    const out: MyOffer = {
      id: str(o.id),
      side: o.side,
      methodId: str(o.methodId),
      methodName: str(o.methodName),
      currency: str(o.currency),
      rate: o.rate === null ? null : big(o.rate),
      pricing: parsePricing(o.pricing),
      minFiatCents: big(o.minFiatCents),
      maxFiatCents: big(o.maxFiatCents),
      minTrades: o.minTrades,
      status: state(o.status),
    };
    if (o.country !== undefined) out.country = str(o.country);
    return out;
  });
}

export function parseSwitch(raw: unknown): SwitchResult[] {
  if (!isRecord(raw) || !Array.isArray(raw.results)) throw shape();
  return raw.results.map((r: unknown) => {
    if (!isRecord(r)) throw shape();
    const out: SwitchResult = { id: str(r.id) };
    if (r.status !== undefined) out.status = state(r.status);
    if (r.refused !== undefined) out.refused = str(r.refused);
    if (out.status === undefined && out.refused === undefined) throw shape();
    return out;
  });
}

export async function fetchMyOffers(signal?: AbortSignal): Promise<MyOffer[]> {
  return parseMyOffers(await api('/v1/account/offers', signal ? { signal } : {}));
}

export async function switchOffers(ids: string[] | 'all', status: OfferState): Promise<SwitchResult[]> {
  return parseSwitch(await api('/v1/account/offers/status', { method: 'POST', body: { ids, status } }));
}
