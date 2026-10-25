// Fixture mode: `VITE_FIXTURES=1` in a non-production build only (vite.config.ts drops it from
// production). The boards' example data is in boards.ts; each screen task answers its own API calls from it.
import { PENDING_ESCROW, setTradeEscrowHook, type TradeEscrow } from '../screens/trade/seams.js';

declare global {
  interface Window {
    /**
     * Fixture builds only: the escrow state the trade room shows (Task 12's runtime is not in
     * fixture mode). Playwright sets it with addInitScript; see e2e/fund.spec.ts.
     */
    __x2fFixtureEscrow?: Partial<Pick<TradeEscrow, 'phase' | 'error' | 'retryable' | 'refusal' | 'checkWords' | 'keepOpen' | 'escrowAddress'>> & {
      /** The device's deal, with the take amount as a decimal string (bigints don't cross addInitScript). */
      deal?: { poster: 'seller' | 'buyer'; takeAmountAtomic: string };
    };
  }
}

export function installFixtures(): void {
  document.documentElement.dataset.fixtureMode = 'on';
  const escrow = window.__x2fFixtureEscrow;
  if (!escrow) return;
  const { deal, ...rest } = escrow;
  const state: TradeEscrow = { ...PENDING_ESCROW, ...rest, deal: deal ? { poster: deal.poster, takeAmountAtomic: BigInt(deal.takeAmountAtomic) } : null };
  setTradeEscrowHook(() => state);
}
