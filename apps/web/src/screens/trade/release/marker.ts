import { TIMERS } from '@x2f/trade';

/**
 * "This device asked to release this trade" (round-2 review 2026-10-28, Important 1). The
 * seller's hold is the only consent for the one outcome that pays the buyer, and Task 12 gives the
 * seller no automatic release. So SellerConfirm signs a release WITHOUT a hold on this mount only
 * when this device itself asked for it (a lost `release-started` answer, a reload between the
 * POST and `release()`), never on the API's word that the trade is settling. The marker is written
 * just before the POST, in this device's storage (localStorage: it must survive a reload and a
 * closed tab), with the device's own time; it is ignored after RELEASE_ASKED_MAX_MS (the API's
 * settle window, after which an unsigned release falls back to `paid`), and cleared when the POST
 * is refused, when this device has signed, and when the trade has ended.
 *
 * Cross-task note (Task 12): an EscrowStatus flag "a release intent from this device is pending"
 * would let the screen drop this marker.
 */
export const RELEASE_ASKED_MAX_MS = TIMERS.settleMin * 60_000;

const key = (code: string): string => `x2f.release-asked:${code}`;

function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Records that this device asked to release `code`; false when the device cannot store it (the hold then stays the only way). */
export function markReleaseAsked(code: string): boolean {
  try {
    store()?.setItem(key(code), String(Date.now()));
    return store()?.getItem(key(code)) !== null;
  } catch {
    return false;
  }
}

/** Whether this device asked to release `code` within the settle window (an old marker is dropped). */
export function releaseAsked(code: string): boolean {
  try {
    const raw = store()?.getItem(key(code)) ?? null;
    if (raw === null) return false;
    const at = Number(raw);
    const age = Date.now() - at;
    if (!Number.isFinite(at) || age < 0 || age > RELEASE_ASKED_MAX_MS) {
      clearReleaseAsked(code);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function clearReleaseAsked(code: string): void {
  try {
    store()?.removeItem(key(code));
  } catch {
    // Storage blocked: nothing was stored.
  }
}
