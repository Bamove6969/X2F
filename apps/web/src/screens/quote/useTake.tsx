import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ApiCallError, safeReturnTo } from '../../api/client.js';
import { useSession } from '../../session/useSession.js';
import { takeOffer, type TakeRequest } from './api.js';
import { storeConfirmed, type ConfirmedTrade } from './confirmed.js';

// The Trade button's action (plan Task 18). Logged out, it goes to setup with `returnTo` = the
// quote with `resume=<nonce>` and a pending-take marker in this tab (pendingTake.ts). Setup (Task 28)
// starts on the Terms at `/setup` and its Start trading navigates to returnTo in the same tab, where
// the marker re-shows the quote at the price now for a fresh tap (it never takes by itself).
// Logged in, it calls take with the quoted rate and total. The server locks its own rate now, never
// the quoted one (lead decision 2026-10-29), and refuses 409 price-changed when that is more than
// 0.5% from the quote (a fixed price: any difference), so the quote re-fetches the price and asks
// for a fresh tap. The take answers with the rate that locked; the device checks it is within that
// 0.5% of what the person saw (a fixed price: equal, as the server checks), else it records nothing
// and says the trade could not start. Then it opens the trade room with the device's own record of
// what was confirmed (confirmed.ts), its deal at the rate that locked: stored in this tab first,
// then carried as `{ state: { confirmed } }`. 403 terms-required and 409 no-wallet are sent on by the API client
// (Task 13) with this page as `returnTo`.

/** Where a logged-out Trade goes first. */
export const SETUP_START = '/setup';

export function setupHref(returnTo: string): string {
  return `${SETUP_START}?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`;
}

export type TakeState = { busy: boolean; error: unknown };

/** The largest move between the quoted rate and the one that locked: 0.5% (5 per mille), as the server allows. */
const TOLERANCE_PER_MILLE = 5n;

/** True when the rate that locked is within 0.5% of the quoted one (the server's own bound). */
export function lockedWithinQuote(quoted: bigint, locked: bigint): boolean {
  const diff = quoted > locked ? quoted - locked : locked - quoted;
  return diff * 1000n <= locked * TOLERANCE_PER_MILLE;
}

/** The take locked a rate farther from the quote than the server allows: the device does not record it. */
export class LockedRateError extends Error {
  constructor() {
    super('the locked rate is not the quoted one');
    this.name = 'LockedRateError';
  }
}

export const isPriceChanged = (e: unknown): boolean => e instanceof ApiCallError && e.status === 409 && e.code === 'price-changed';

export interface TakeArgs {
  /** The quote as shown: amount, rate and total. */
  quote: Pick<TakeRequest, 'amountAtomic' | 'centsPerXmr' | 'fiatCents'>;
  walletId: string | null;
  confirmed: ConfirmedTrade | null;
  /**
   * `resumeHref` is called only when the person is sent away: it records the pending take and
   * returns this quote with the amount and `resume=<nonce>`.
   */
  resumeHref: () => string;
}

/** `onPriceChanged` runs on a 409 price-changed, before the refusal is shown: the quote re-fetches the price. */
export function useTake(
  offerId: string,
  onPriceChanged?: () => void,
): {
  signedIn: boolean | null;
  state: TakeState;
  take: (a: TakeArgs) => void;
} {
  const session = useSession();
  const navigate = useNavigate();
  const [state, setState] = useState<TakeState>({ busy: false, error: null });
  const inFlight = useRef(false);
  const signedIn = session.status === 'loading' ? null : session.status !== 'signed-out';

  const take = useCallback(
    (a: TakeArgs) => {
      if (inFlight.current) return;
      if (session.status === 'signed-out') {
        void navigate(setupHref(a.resumeHref()));
        return;
      }
      if (a.walletId === null || a.confirmed === null) return;
      const confirmed = a.confirmed;
      inFlight.current = true;
      setState({ busy: true, error: null });
      takeOffer(offerId, { ...a.quote, walletId: a.walletId }).then(
        (taken) => {
          inFlight.current = false;
          if (!lockedWithinQuote(a.quote.centsPerXmr, taken.centsPerXmr)) {
            setState({ busy: false, error: new LockedRateError() });
            return;
          }
          const locked: ConfirmedTrade = { ...confirmed, deal: { ...confirmed.deal, centsPerXmr: taken.centsPerXmr } };
          storeConfirmed(taken.code, locked);
          void navigate(`/trade/${encodeURIComponent(taken.code)}`, { state: { confirmed: locked } });
        },
        (error: unknown) => {
          inFlight.current = false;
          if (error instanceof ApiCallError && error.status === 401) {
            void navigate(setupHref(a.resumeHref()));
            return;
          }
          if (isPriceChanged(error)) onPriceChanged?.();
          setState({ busy: false, error });
        },
      );
    },
    [session.status, navigate, offerId, onPriceChanged],
  );

  return { signedIn, state, take };
}
