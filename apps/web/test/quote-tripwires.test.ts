// TRIPWIRES for what the quote (Task 18) assumes before the tasks it plugs into are on the line.
// Each one fails once the named module lands: then do what its message says (check the real shape
// against src/screens/quote/api.ts and the stubs in e2e/quote.spec.ts and test/quoteScreen.test.tsx,
// or wire the live call), and delete that tripwire.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const has = (p: string): boolean => existsSync(ROOT + p);

describe('Task 18 guesses still stand in for missing tasks', () => {
  it('NEEDS_TASK_4: the offer card the quote reads is guessed', () => {
    // Guessed (plan Task 4 + Revision 2026-10-24, as Task 16 reads it): GET /v1/offers?side&method&currency&sort
    // → [{ id; poster: { username (the public display name); stage: 'starter'|'building'|'graduated'; … };
    // pricing: { mode: 'market'; marginBps } | { mode: 'fixed'; centsPerXmr: string }; minFiatCents: string;
    // maxFiatCents: string; minTrades: number; opensAt?: 'building'|'graduated' }]. There is no single-offer
    // route, so the quote finds its offer in that list.
    expect(has('apps/api/src/offers/routes.ts'), 'Task 4 landed: check parseOffer (poster.username is the display name, stage, opensAt, bigint strings)').toBe(false);
  });

  it('NEEDS_TASK_5: the take route and its starter-limit refusal are guessed', () => {
    // Guessed: POST /v1/offers/:id/take { amountAtomic: string; walletId } → { code }; refusals 409 with
    // { error } as in plan Task 5, plus 409 { error: 'starter-limit', stage: 'starter'|'building',
    // capUsdCents?: string } naming only the caller's own stage (Revision 2026-10-24). Also check that
    // the trade's stored fiatCents is fiatCents(amountAtomic, lockedRate) (OD-5), which the quote shows.
    expect(has('apps/api/src/trades/take.ts'), "Task 5 landed: check takeOffer, takeRefusal's codes and the starter-limit fields").toBe(false);
  });

  it('NEEDS_TASK_3: GET /v1/price is taken from the unmerged Task 3 branch', () => {
    // From wip/second-p3-t3: { currency; centsPerXmr: string; exponent; at; usdCentsPerXmr: string } or
    // 503 price-unavailable; /v1/methods { live; all } rows with { id; name }.
    expect(has('apps/api/src/price/routes.ts'), 'Task 3 landed: check fetchMarket (usdCentsPerXmr) and fetchMethodName').toBe(false);
  });

  it("NEEDS_TASK_16: the sell browse Trade button does not open SellQuote yet, and parseOffer duplicates Task 16's", () => {
    expect(
      has('apps/web/src/screens/browse/OfferList.tsx'),
      "Task 16 landed: pass onTrade={(o) => navigate(quotePath('buy', methodId, o.id, currency))} on /sell/:methodId, and use browse/api.ts parseOffers in quote/api.ts",
    ).toBe(false);
  });

  it('NEEDS_TASK_17: the buy browse Trade button does not open BuyQuote yet', () => {
    expect(
      has('apps/web/src/screens/browse/BuyCopy.ts'),
      "Task 17 landed: pass onTrade={(o) => navigate(quotePath('sell', methodId, o.id, currency))} on /buy/:methodId",
    ).toBe(false);
  });

  it('NEEDS_TASK_28: setup does not yet come back to the quote with resume=1', () => {
    // useTake sends a logged-out Trade to /setup/terms?returnTo=<quote>&resume=1. Setup must end on
    // returnTo with a fresh session (useSession reads /v1/account/me once per page load today).
    expect(has('apps/web/src/screens/setup/SetupFlow.tsx'), 'Task 28 landed: check Start trading → returnTo resumes the take (e2e quote.spec.ts)').toBe(false);
  });

  it('NEEDS_TASK_29: the wallet names and the usable filter mirror the unmerged wallets model', () => {
    expect(
      has('apps/web/src/screens/wallets-model.ts'),
      'Task 29 landed: use APP_LABELS and takeableWallets in WalletPicker, and check /wallets?add=1&returnTo comes back here after confirm-it\'s-you',
    ).toBe(false);
  });

  it('NEEDS_TASK_20: the quote header Chat button is a placeholder', () => {
    expect(has('apps/web/src/chat/ChatPanel.tsx'), "Task 20 landed: wire the quote header's Chat to the poster's pre-trade chat").toBe(false);
  });
});
