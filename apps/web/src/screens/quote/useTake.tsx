import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ApiCallError, safeReturnTo } from '../../api/client.js';
import { useSession } from '../../session/useSession.js';
import { takeOffer } from './api.js';
import { storeConfirmed, type ConfirmedTrade } from './confirmed.js';

// The Trade button's action (plan Task 18). Logged out, it goes to setup with `returnTo` = the
// quote with `resume=<nonce>` and a pending-take marker in this tab (pendingTake.ts), so the quote
// takes the offer once the person is back (Task 28 builds setup).
// Logged in, it calls take and opens the trade room with the device's own record of what was
// confirmed (confirmed.ts): stored in this tab first, then carried as `{ state: { confirmed } }`.
// 403 terms-required and 409 no-wallet are sent on by the API client (Task 13) with this page as
// `returnTo`.

/** Where a logged-out Trade goes first. */
export const SETUP_START = '/setup/terms';

export function setupHref(returnTo: string): string {
  return `${SETUP_START}?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`;
}

export type TakeState = { busy: boolean; error: unknown };

export function useTake(offerId: string): {
  signedIn: boolean | null;
  state: TakeState;
  /**
   * `resumeHref` is called only when the person is sent away: it records the pending take and
   * returns this quote with the amount and `resume=<nonce>`.
   */
  take: (a: { amountAtomic: bigint; walletId: string | null; confirmed: ConfirmedTrade | null; resumeHref: () => string }) => void;
} {
  const session = useSession();
  const navigate = useNavigate();
  const [state, setState] = useState<TakeState>({ busy: false, error: null });
  const inFlight = useRef(false);
  const signedIn = session.status === 'loading' ? null : session.status !== 'signed-out';

  const take = useCallback(
    (a: { amountAtomic: bigint; walletId: string | null; confirmed: ConfirmedTrade | null; resumeHref: () => string }) => {
      if (inFlight.current) return;
      if (session.status === 'signed-out') {
        void navigate(setupHref(a.resumeHref()));
        return;
      }
      if (a.walletId === null || a.confirmed === null) return;
      const confirmed = a.confirmed;
      inFlight.current = true;
      setState({ busy: true, error: null });
      takeOffer(offerId, a.amountAtomic, a.walletId).then(
        (code) => {
          inFlight.current = false;
          storeConfirmed(code, confirmed);
          void navigate(`/trade/${encodeURIComponent(code)}`, { state: { confirmed } });
        },
        (error: unknown) => {
          inFlight.current = false;
          if (error instanceof ApiCallError && error.status === 401) {
            void navigate(setupHref(a.resumeHref()));
            return;
          }
          setState({ busy: false, error });
        },
      );
    },
    [session.status, navigate, offerId],
  );

  return { signedIn, state, take };
}
