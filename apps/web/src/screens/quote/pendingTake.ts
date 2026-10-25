// The single-use marker that lets a quote take an offer by itself after a trip away (setup, or Add
// a wallet). A link alone can never start a trade: `resume=<nonce>` in the URL only counts when
// this tab holds a marker the person created by tapping Trade (or Add a wallet) on this quote, for
// the same offer and the same amount they typed, with the same nonce, within PENDING_TAKE_MS. The
// marker is cleared when it is read, whether or not it matches, so it works at most once. Anything
// else shows the quote with the amount filled in and waits for a tap.
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
