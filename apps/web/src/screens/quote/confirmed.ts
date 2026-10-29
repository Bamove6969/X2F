// The device's own record of what the person confirmed on the quote, handed to the trade room so
// the browser escrow (Task 12) starts from what was SEEN and TAPPED, never from the API's trade
// alone: the taker's role, the full address of the wallet they picked, and the deal (who posted,
// the XMR amount, the currency, the rate that locked and the offer's ceiling). The room gets it
// twice: as `{ state: { confirmed } }` on the navigation (Task 22's seam) and in this tab's storage
// under the trade code, written BEFORE navigating, because history state is gone when the trade is
// opened in a new tab or from a push notification (it does survive a reload). The room clears the
// stored copy once the escrow has stored the deal (forgetConfirmed).
//
// The types are Task 12's own (escrow/runtime.ts, escrow/policy.ts), imported, not copied.
import type { ConfirmedTrade } from '../../escrow/runtime.js';
import type { Deal } from '../../escrow/policy.js';

export type { ConfirmedTrade, Deal };

export const CONFIRMED_KEY_PREFIX = 'x2f.confirmed:';

export function confirmedKey(code: string): string {
  return `${CONFIRMED_KEY_PREFIX}${code}`;
}

function store(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Keeps the record for `code` in this tab; false when this tab cannot store it (the state still travels). */
export function storeConfirmed(code: string, c: ConfirmedTrade): boolean {
  const s = store();
  if (s === null) return false;
  try {
    s.setItem(confirmedKey(code), JSON.stringify(c, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)));
    return true;
  } catch {
    return false;
  }
}

/** Drops the record for `code` (the room calls it once the escrow has stored the deal). */
export function forgetConfirmed(code: string): void {
  try {
    store()?.removeItem(confirmedKey(code));
  } catch {
    // Storage blocked: nothing was stored either.
  }
}

const bigString = (v: unknown): bigint | null => (typeof v === 'string' && /^\d{1,30}$/.test(v) && v !== '0' ? BigInt(v) : null);

/** The record stored for `code`, or null when there is none or it is not a whole ConfirmedTrade. */
export function readConfirmed(code: string): ConfirmedTrade | null {
  const s = store();
  if (s === null) return null;
  let raw: string | null;
  try {
    raw = s.getItem(confirmedKey(code));
  } catch {
    return null;
  }
  if (raw === null) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (v === null || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const d = o.deal;
  if (d === null || typeof d !== 'object') return null;
  const deal = d as Record<string, unknown>;
  const [takeAmountAtomic, centsPerXmr, maxFiatCents] = [bigString(deal.takeAmountAtomic), bigString(deal.centsPerXmr), bigString(deal.maxFiatCents)];
  if (
    (o.role !== 'buyer' && o.role !== 'seller') ||
    typeof o.ownAddress !== 'string' ||
    o.ownAddress === '' ||
    o.ownAddress.length > 256 ||
    (deal.poster !== 'seller' && deal.poster !== 'buyer') ||
    typeof deal.currency !== 'string' ||
    !/^[A-Z]{3}$/.test(deal.currency) ||
    takeAmountAtomic === null ||
    centsPerXmr === null ||
    maxFiatCents === null
  ) {
    return null;
  }
  return { role: o.role, ownAddress: o.ownAddress, deal: { poster: deal.poster, takeAmountAtomic, currency: deal.currency, centsPerXmr, maxFiatCents } };
}
