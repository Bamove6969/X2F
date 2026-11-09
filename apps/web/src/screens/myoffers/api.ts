// My offers (Plan 3 Task 36): the API's two routes, parsed strictly so a renamed or missing field
// fails loudly. Shapes from apps/api/src/offers/routes.ts (`MyOffer`, `OfferSwitchResult`), built
// in the same task:
//   GET  /v1/account/offers → MyOffer[] (live and paused, newest first; `hidden` on a live offer
//        nobody can see now)
//   POST /v1/account/offers/status { ids: string[] | 'all', status: 'live' | 'paused' }
//        → { status, results: { id, status?, refused? }[] }, one result per offer named (or every
//        offer of mine for 'all'); a refused offer keeps its status and says why.
import { api } from '../../api/client.js';
import { HIDDEN_REASONS } from './model.js';

export type OfferState = 'live' | 'paused';

export interface MyOffer {
  id: string;
  side: 'sell' | 'buy';
  methodId: string;
  methodName: string;
  currency: string;
  rate: bigint | null;
  /** Always the market price moved by the margin (owner Q1, F1: there are no fixed-price offers). */
  pricing: { mode: 'market'; marginBps: number };
  /**
   * The unit the range was set in (owner, 8 Nov): that pair is exact; the API sends the other at the
   * offer's rate now, or null with no rate.
   */
  amountUnit: 'xmr' | 'fiat';
  minAtomic: bigint | null;
  maxAtomic: bigint | null;
  minFiatCents: bigint | null;
  maxFiatCents: bigint | null;
  minTrades: number;
  country?: string;
  status: OfferState;
  /** A live offer nobody can see right now, and why (review M4). */
  hidden?: (typeof HIDDEN_REASONS)[number];
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

const bigOrNull = (v: unknown): bigint | null => (v === null ? null : big(v));

/** The range: an answer without `amountUnit` is in fiat (before 8 Nov); the own pair is required, in order. */
function amounts(o: Record<string, unknown>): Pick<MyOffer, 'amountUnit' | 'minAtomic' | 'maxAtomic' | 'minFiatCents' | 'maxFiatCents'> {
  if (o.amountUnit === undefined) return { amountUnit: 'fiat', minAtomic: null, maxAtomic: null, minFiatCents: big(o.minFiatCents), maxFiatCents: big(o.maxFiatCents) };
  if (o.amountUnit !== 'xmr' && o.amountUnit !== 'fiat') throw shape();
  for (const k of ['minAtomic', 'maxAtomic', 'minFiatCents', 'maxFiatCents']) if (!(k in o)) throw shape();
  const out = { amountUnit: o.amountUnit as 'xmr' | 'fiat', minAtomic: bigOrNull(o.minAtomic), maxAtomic: bigOrNull(o.maxAtomic), minFiatCents: bigOrNull(o.minFiatCents), maxFiatCents: bigOrNull(o.maxFiatCents) };
  const [lo, hi] = out.amountUnit === 'xmr' ? [out.minAtomic, out.maxAtomic] : [out.minFiatCents, out.maxFiatCents];
  if (lo === null || hi === null || lo <= 0n || hi < lo) throw shape();
  return out;
}

function state(v: unknown): OfferState {
  if (v !== 'live' && v !== 'paused') throw shape();
  return v;
}

function str(v: unknown): string {
  if (typeof v !== 'string' || v.length === 0) throw shape();
  return v;
}

/** `{ mode: 'market', marginBps }`; any other mode (a fixed price, owner Q1) does not parse. */
function parsePricing(v: unknown): MyOffer['pricing'] {
  if (isRecord(v) && v.mode === 'market' && typeof v.marginBps === 'number' && Number.isInteger(v.marginBps)) return { mode: 'market', marginBps: v.marginBps };
  throw shape();
}

export function parseMyOffers(raw: unknown): MyOffer[] {
  if (!Array.isArray(raw)) throw shape();
  return raw.map((o: unknown) => {
    if (!isRecord(o)) throw shape();
    if (o.side !== 'sell' && o.side !== 'buy') throw shape();
    // Null is no minimum (owner, 8 Nov), read as 0 as before.
    if (o.minTrades !== null && typeof o.minTrades !== 'number') throw shape();
    const out: MyOffer = {
      id: str(o.id),
      side: o.side,
      methodId: str(o.methodId),
      methodName: str(o.methodName),
      currency: str(o.currency),
      rate: o.rate === null ? null : big(o.rate),
      pricing: parsePricing(o.pricing),
      ...amounts(o),
      minTrades: o.minTrades ?? 0,
      status: state(o.status),
    };
    if (o.country !== undefined) out.country = str(o.country);
    if (o.hidden !== undefined) {
      const hidden = HIDDEN_REASONS.find((h) => h === o.hidden);
      if (hidden === undefined) throw shape();
      out.hidden = hidden;
    }
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

/** One call: at most SWITCH_BATCH ids (model.ts batches). The UI never sends 'all' (review M1). */
export async function switchOffers(ids: string[], status: OfferState): Promise<SwitchResult[]> {
  return parseSwitch(await api('/v1/account/offers/status', { method: 'POST', body: { ids, status } }));
}
