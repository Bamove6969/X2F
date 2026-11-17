import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { tradeFiatLimits, type OfferRange } from '@x2f/trade';
import { ApiCallError, safeReturnTo } from '../../api/client.js';
import { useSession } from '../../session/useSession.js';
import { takeOffer, type TakeRequest } from './api.js';
import { storeConfirmed, type ConfirmedTrade } from './confirmed.js';
import { dropIfLeft, readQuote, updateQuote, useQuoteKept } from './quoteKept.js';

// The Trade button's action (plan Task 18). Logged out, it goes to setup with `returnTo` = the
// quote with `resume=<nonce>` and a pending-take marker in this tab (pendingTake.ts). Setup (Task 28)
// starts on the Terms at `/setup` and its Start trading navigates to returnTo in the same tab, where
// the marker re-shows the quote at the price now for a fresh tap (it never takes by itself).
// Logged in, it calls take with the quoted rate and total. The server locks its own rate now, never
// the quoted one (lead decision 2026-10-29), and refuses 409 price-changed when that is more than
// 0.5% from the quote, so the quote re-fetches the price and asks
// for a fresh tap. The take answers with the rate that locked; the device checks it is within that
// 0.5% of what the person saw (as the server checks), else it records nothing
// and says the trade could not start. Then it opens the trade room with the device's own record of
// what was confirmed (confirmed.ts), its deal at the rate that locked (the rate, and the fiat maximum
// worked out again at that rate, as the server records it): stored in this tab first,
// then carried as `{ state: { confirmed } }`. 403 terms-required and 409 no-wallet are sent on by the API client
// (Task 13) with this page as `returnTo`.
//
// The take's state (in flight, and the last error) is kept per offer above the component
// (quoteKept.ts, review 2026-11-01 M1): a fold or unfold mounts a new quote, which must show the
// take still in flight, never send a second one, and show the refusal when it answers.

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

/** Review B1: the take reserved another lien recovery than the one the buyer accepted on the quote. */
export const isLienRecoveryChanged = (e: unknown): boolean => e instanceof ApiCallError && e.status === 409 && e.code === 'lien-recovery-changed';

/**
 * Review B1 (lien recovery): the take answered with another recovery than the one the quote showed
 * and the buyer accepted. The API refuses that itself; the device records nothing either way.
 */
export class LienRecoveryMismatchError extends Error {
  constructor() {
    super('the reserved lien recovery is not the accepted one');
    this.name = 'LienRecoveryMismatchError';
  }
}

export interface TakeArgs {
  /** The quote as shown: amount, rate and total. */
  quote: Pick<TakeRequest, 'amountAtomic' | 'centsPerXmr' | 'fiatCents' | 'methodId' | 'currency' | 'giftCardTerms' | 'lienRecoveryAtomic'>;
  walletId: string | null;
  confirmed: ConfirmedTrade | null;
  /**
   * The range the quote priced (quoteModel `quote`'s `range`: J-16, the band's; else the offer's
   * own, `quoteRange`). The deal's `maxFiatCents` is worked out again
   * from it at the rate that locked (review 2, I1): for an XMR-set offer the server records
   * `tradeFiatLimits(range, locked rate)`, and the escrow runtime fails `deal-mismatch` unless the
   * device's figure equals it exactly.
   */
  range: OfferRange;
  /**
   * `resumeHref` is called only when the person is sent away: it records the pending take and
   * returns this quote with the amount and `resume=<nonce>`.
   */
  resumeHref: () => string;
}

/**
 * `onPriceChanged` runs on a 409 price-changed, before the refusal is shown: the quote re-fetches the price.
 * Once the take went through (and is recorded) the room opens at once; the courtesy sheet (T-039)
 * shows over the room (TradeRoom.tsx, design final call 10 Nov 2026).
 */
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
  const [kept] = useQuoteKept(offerId);
  const state: TakeState = { busy: kept.busy, error: kept.error };
  const signedIn = session.status === 'loading' ? null : session.status !== 'signed-out';

  const take = useCallback(
    (a: TakeArgs) => {
      if (readQuote(offerId).busy) return;
      if (session.status === 'signed-out') {
        void navigate(setupHref(a.resumeHref()));
        return;
      }
      if (a.walletId === null || a.confirmed === null) return;
      const confirmed = a.confirmed;
      updateQuote(offerId, { busy: true, error: null });
      takeOffer(offerId, { ...a.quote, walletId: a.walletId }).then(
        (taken) => {
          if (!lockedWithinQuote(a.quote.centsPerXmr, taken.centsPerXmr)) {
            updateQuote(offerId, { busy: false, error: new LockedRateError() });
            dropIfLeft(offerId);
            return;
          }
          // Review B1: a buyer keeps only the recovery it accepted on the quote (none: none).
          if (confirmed.role === 'buyer' && (taken.lienRecoveryAtomic ?? 0n) !== (confirmed.lienRecoveryAtomic ?? 0n)) {
            updateQuote(offerId, { busy: false, error: new LienRecoveryMismatchError() });
            dropIfLeft(offerId);
            return;
          }
          updateQuote(offerId, { busy: false });
          dropIfLeft(offerId);
          // The deal's fiat maximum: the band's limits at the rate that locked (J-16: an XMR band's
          // maximum moves with the rate; review 2, I1), clamped to the growth ceiling the take fixed
          // (the launch cap, launch-rules review F1). Never above what this person saw at that rate: a
          // higher one keeps the device's figure, and the attested deal then fails to match
          // (deal-mismatch) instead of letting the trade grow more.
          const at = { currency: confirmed.deal.currency, centsPerXmr: taken.centsPerXmr };
          const seenMax = tradeFiatLimits(a.range, at).maxFiatCents;
          const maxFiatCents = taken.maxFiatCents < seenMax ? taken.maxFiatCents : seenMax;
          const locked: ConfirmedTrade = {
            ...confirmed,
            deal: { ...confirmed.deal, centsPerXmr: taken.centsPerXmr, maxFiatCents },
            // Lien recovery (review B1): the figure the buyer accepted on the quote (equal to the take's,
            // checked above); the device accepts only signed terms that carry exactly it.
          };
          storeConfirmed(taken.code, locked);
          void navigate(`/trade/${encodeURIComponent(taken.code)}`, { state: { confirmed: locked } });
        },
        (error: unknown) => {
          if (error instanceof ApiCallError && error.status === 401) {
            updateQuote(offerId, { busy: false });
            dropIfLeft(offerId);
            void navigate(setupHref(a.resumeHref()));
            return;
          }
          if (isPriceChanged(error) || isLienRecoveryChanged(error)) onPriceChanged?.();
          updateQuote(offerId, { busy: false, error });
          dropIfLeft(offerId);
        },
      );
    },
    [session.status, navigate, offerId, onPriceChanged],
  );

  return { signedIn, state, take };
}
