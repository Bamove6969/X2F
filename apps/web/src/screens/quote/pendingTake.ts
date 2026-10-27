// The single-use marker that tells a quote the person is back from a trip away (setup, or Add a
// wallet) after tapping Trade here. It never takes the offer by itself (lead 2026-10-27: the rate
// the person confirms must be the one they see, and they may be back up to 30 minutes later): a
// matching marker re-shows the quote at the price now, picks the one usable wallet when there is
// exactly one, and says to check the total and tap Trade. `resume=<nonce>` in the URL only counts
// when this tab holds a marker the person created on this quote, for the same offer and the same
// amount they typed, with the same nonce, within PENDING_TAKE_MS; it is cleared when it is read,
// whether or not it matches, so it counts at most once. Anything else is a plain quote with the
// amount filled in.
//
// The amount is matched as typed (text and unit), not as XMR: a fiat amount is re-quoted at the
// price of the moment, as on any quote.

export const PENDING_TAKE_KEY = 'x2f.pendingTake';
export const PENDING_TAKE_MS = 30 * 60_000;

export interface PendingTake {
  offerId: string;
  unit: 'fiat' | 'xmr';
  text: string;
}

interface Stored extends PendingTake {
  nonce: string;
  expiresAt: number;
}

function store(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function nonce(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Records a pending take and returns its nonce for `resume=`; null when this tab cannot store it. */
export function rememberTake(p: PendingTake, now: number = Date.now()): string | null {
  const s = store();
  if (s === null) return null;
  const n = nonce();
  const v: Stored = { offerId: p.offerId, unit: p.unit, text: p.text, nonce: n, expiresAt: now + PENDING_TAKE_MS };
  try {
    s.setItem(PENDING_TAKE_KEY, JSON.stringify(v));
    return n;
  } catch {
    return null;
  }
}

/** True only for a live marker matching `p` and `resumeNonce`. Always clears the marker first. */
export function claimTake(p: PendingTake, resumeNonce: string, now: number = Date.now()): boolean {
  const s = store();
  if (s === null) return false;
  let raw: string | null;
  try {
    raw = s.getItem(PENDING_TAKE_KEY);
    s.removeItem(PENDING_TAKE_KEY);
  } catch {
    return false;
  }
  if (raw === null) return false;
  let v: Partial<Stored>;
  try {
    v = JSON.parse(raw) as Partial<Stored>;
  } catch {
    return false;
  }
  return (
    typeof v.nonce === 'string' &&
    v.nonce.length === 32 &&
    v.nonce === resumeNonce &&
    v.offerId === p.offerId &&
    v.unit === p.unit &&
    v.text === p.text &&
    typeof v.expiresAt === 'number' &&
    now < v.expiresAt
  );
}
