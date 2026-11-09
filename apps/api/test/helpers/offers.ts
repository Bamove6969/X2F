import type pg from 'pg';
import { currencyExponent } from '../../src/price/currencies.js';

/**
 * J-16: the flexible-offer post body for an offer written in the old single-method terms (`{ side,
 * methodId, currency, pricing: { mode: 'market', marginBps }, amountUnit?, minFiatCents/maxFiatCents
 * or minAtomic/maxAtomic, minTrades, terms, country? }`), which `POST /v1/offers` no longer takes
 * (Task 34 review M1): one currency with one band and one method with no instructions and no
 * adjustment. A fiat band is in whole units (`min = minFiatCents / 10^exp`, `max = maxFiatCents /
 * 10^exp`, so the band covers the same totals); an XMR band keeps its atomic units. A test that
 * wants a malformed post keeps it malformed: a non-numeric amount, an odd `pricing`, a missing
 * method or any extra key goes through as given, so the API still answers 400. Fiat amounts that
 * are not whole units throw (the new shape cannot say them).
 */
export function flexBody(b: Record<string, unknown>): Record<string, unknown> {
  const { side, methodId, currency, pricing, amountUnit, minFiatCents, maxFiatCents, minAtomic, maxAtomic, minTrades, terms, ...rest } = b;
  const exp = typeof currency === 'string' ? (currencyExponent(currency) ?? 2) : 2;
  const unit = 10n ** BigInt(exp);
  const whole = (v: unknown): unknown => {
    if (typeof v !== 'string' || !/^\d+$/.test(v)) return v;
    const n = BigInt(v);
    if (n % unit !== 0n) throw new Error(`flexBody: ${v} is not a whole number of ${String(currency)} units`);
    return (n / unit).toString();
  };
  const p = pricing as Record<string, unknown> | undefined;
  const plain = p !== null && typeof p === 'object' && p.mode === 'market' && Object.keys(p).sort().join(',') === 'marginBps,mode';
  const xmr = amountUnit === 'xmr';
  const band: Record<string, unknown> = xmr
    ? { min: minAtomic, max: maxAtomic, marginBps: plain ? p.marginBps : 0, minTrades }
    : { min: whole(minFiatCents), max: whole(maxFiatCents), marginBps: plain ? p.marginBps : 0, minTrades };
  const out: Record<string, unknown> = {
    side,
    currencies: [{ currency, bands: [band] }],
    methods: methodId === undefined ? [] : [{ methodId, adjustBps: 0, instructions: '' }],
    ...rest,
  };
  if (amountUnit !== undefined) out.amountUnit = amountUnit;
  if (terms !== undefined) out.terms = terms;
  if (!plain && pricing !== undefined) out.pricing = pricing;
  // The other unit's keys stay wrong, so the API refuses them as before.
  if (xmr && (minFiatCents !== undefined || maxFiatCents !== undefined)) Object.assign(out, { minFiatCents, maxFiatCents });
  if (!xmr && (minAtomic !== undefined || maxAtomic !== undefined)) Object.assign(out, { minAtomic, maxAtomic });
  return out;
}

/** An offer's rows written straight to the database (migration 490's shape): one currency, one band, one method. */
export interface RawOffer {
  accountId: string;
  side: 'sell' | 'buy';
  methodId: string;
  currency: string;
  marginBps?: number;
  amountUnit?: 'fiat' | 'xmr';
  /** In the unit's minor units (fiat minor units or atomic). */
  min: bigint | string | number;
  max: bigint | string | number;
  minTrades?: number | null;
  terms?: string;
  country?: string | null;
  status?: 'live' | 'paused' | 'removed';
  instructions?: string;
  at?: Date;
}

/** Inserts `o` (offer, currency, band, method and pair) and returns its id. */
export async function insertOffer(db: Pick<pg.Pool, 'query'>, o: RawOffer): Promise<string> {
  const at = o.at ?? new Date();
  const { rows } = await db.query<{ id: string }>(
    `insert into offers (account_id, side, price_mode, amount_unit, terms, country, status, created_at, updated_at)
     values ($1, $2, 'market', $3, $4, $5, $6, $7, $7) returning id`,
    [o.accountId, o.side, o.amountUnit ?? 'fiat', o.terms ?? '', o.country ?? null, o.status ?? 'live', at],
  );
  const id = rows[0]!.id;
  await db.query(`insert into offer_currencies (offer_id, position, currency) values ($1, 0, $2)`, [id, o.currency]);
  await db.query(
    `insert into offer_tiers (offer_id, currency, position, min_amount, max_amount, margin_bps, min_trades) values ($1, $2, 0, $3, $4, $5, $6)`,
    [id, o.currency, String(o.min), String(o.max), o.marginBps ?? 0, o.minTrades ?? null],
  );
  await db.query(`insert into offer_methods (offer_id, position, method_id, instructions, adjust_bps) values ($1, 0, $2, $3, 0)`, [
    id, o.methodId, o.instructions ?? '',
  ]);
  await db.query(`insert into offer_method_currencies (offer_id, method_id, currency) values ($1, $2, $3)`, [id, o.methodId, o.currency]);
  return id;
}

/** Renames an offer's (only) method everywhere it is stored (the pair follows through `on update cascade`). */
export async function renameOfferMethod(db: Pick<pg.Pool, 'query'>, offerId: string, methodId: string): Promise<void> {
  // A test-only rewrite of a written-once row: both tables' own triggers off for the one statement
  // (the foreign keys still cascade the new id into offer_method_currencies).
  await db.query('alter table offer_methods disable trigger offer_methods_written_once');
  await db.query('alter table offer_method_currencies disable trigger offer_method_currencies_written_once');
  try {
    await db.query('update offer_methods set method_id = $2 where offer_id = $1', [offerId, methodId]);
  } finally {
    await db.query('alter table offer_methods enable trigger offer_methods_written_once');
    await db.query('alter table offer_method_currencies enable trigger offer_method_currencies_written_once');
  }
}
