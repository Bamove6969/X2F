import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ApiCallError, safeReturnTo } from '../../api/client.js';
import { useSession } from '../../session/useSession.js';
import { takeOffer } from './api.js';

// The Trade button's action (plan Task 18). Logged out, it goes to setup with `returnTo` = the
// quote with `resume=1`, so the quote takes the offer once the person is back (Task 28 builds setup).
// Logged in, it calls take and opens the trade room. 403 terms-required and 409 no-wallet are sent
// on by the API client (Task 13) with this page as `returnTo`.

/** Where a logged-out Trade goes first. */
export const SETUP_START = '/setup/terms';

export function setupHref(returnTo: string): string {
  return `${SETUP_START}?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`;
}

export type TakeState = { busy: boolean; error: unknown };

export function useTake(offerId: string): {
  signedIn: boolean | null;
  state: TakeState;
  /** `resumeHref`: this quote with the amount and `resume=1`, for the trip through setup. */
  take: (a: { amountAtomic: bigint; walletId: string | null; resumeHref: string }) => void;
} {
  const session = useSession();
  const navigate = useNavigate();
  const [state, setState] = useState<TakeState>({ busy: false, error: null });
  const inFlight = useRef(false);
  const signedIn = session.status === 'loading' ? null : session.status !== 'signed-out';

  const take = useCallback(
    (a: { amountAtomic: bigint; walletId: string | null; resumeHref: string }) => {
      if (inFlight.current) return;
      if (session.status === 'signed-out') {
        void navigate(setupHref(a.resumeHref));
        return;
      }
      if (a.walletId === null) return;
      inFlight.current = true;
      setState({ busy: true, error: null });
      takeOffer(offerId, a.amountAtomic, a.walletId).then(
        (code) => {
          inFlight.current = false;
          void navigate(`/trade/${encodeURIComponent(code)}`);
        },
        (error: unknown) => {
          inFlight.current = false;
          if (error instanceof ApiCallError && error.status === 401) {
            void navigate(setupHref(a.resumeHref));
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
