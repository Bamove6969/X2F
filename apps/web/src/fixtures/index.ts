// Fixture mode: `VITE_FIXTURES=1` in a non-production build only (vite.config.ts drops it from
// production). The boards' example data is in boards.ts; each screen task answers its own API calls from it.
import { BOARD_TRADE } from './boards.js';
import { PENDING_ESCROW, setTradeEscrowHook, type TradeEscrow } from '../screens/trade/seams.js';

declare global {
  interface Window {
    /**
     * Fixture builds only: the escrow state the trade room shows in place of Task 12's runtime
     * (fixture builds have no relay, node or moderator). Playwright sets it with addInitScript; see e2e/fund.spec.ts.
     */
    __x2fFixtureEscrow?: Partial<Pick<TradeEscrow, 'phase' | 'error' | 'retryable' | 'refusal' | 'checkWords' | 'keepOpen' | 'escrowAddress'>> & {
      /** The device's deal, with the take amount as a decimal string (bigints don't cross addInitScript); currency, rate and maximum are the board trade's. */
      deal?: { poster: 'seller' | 'buyer'; takeAmountAtomic: string };
      /** What this device has seen arrive, as a decimal string; absent for no reading. */
      receivedAtomic?: string;
      /** The confirmed part of it, as a decimal string; absent for no reading. */
      confirmedAtomic?: string;
    };
  }
}

export function installFixtures(): void {
  document.documentElement.dataset.fixtureMode = 'on';
  const escrow = window.__x2fFixtureEscrow;
  if (!escrow) return;
  const { deal, receivedAtomic, confirmedAtomic, ...rest } = escrow;
  const state: TradeEscrow = {
    ...PENDING_ESCROW,
    ...rest,
    deal: deal
      ? { poster: deal.poster, takeAmountAtomic: BigInt(deal.takeAmountAtomic), currency: BOARD_TRADE.currency, centsPerXmr: BOARD_TRADE.rateCentsPerXmr, maxFiatCents: BOARD_TRADE.fiatCents }
      : null,
    receivedAtomic: receivedAtomic === undefined ? null : BigInt(receivedAtomic),
    confirmedAtomic: confirmedAtomic === undefined ? null : BigInt(confirmedAtomic),
  };
  setTradeEscrowHook(() => state);
}
