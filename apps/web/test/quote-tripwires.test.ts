// TRIPWIRES for what the quote (Task 18) assumes before the tasks it plugs into are on the line.
// (Task 3's /v1/price and /v1/methods are on the line since 2026-10-26 and were checked against
// api.ts on 2026-10-27: same fields, `exponent` always sent; Tasks 16 and 17's offer lists are on
// the line and App.tsx hands their Trade button to the quote, which reads offers through browse's
// parseOffers; those tripwires are retired. Task 4's GET /v1/offers landed 2026-10-28 and matches
// quoteOffer and parseOffers (poster.displayName is the public name, stage, opensAt, bigint strings); its
// tripwire is retired. Task 4 also serves GET /v1/offers/:id, which the quote may use instead of the list. Task 12 is on the line since 2026-10-27: quote/confirmed.ts imports
// ConfirmedTrade and Deal from escrow/ and its read-back refuses what Task 12's validConfirmed refuses
// (address over 256 characters included); the trade room (Task 22) passes location.state.confirmed,
// else readConfirmed(code), to Task 12's useEscrow (test/tradeRoomEscrow.test.tsx). Task 28's setup is on the
// line since 2026-10-29: a logged-out Trade goes to the Terms at /setup, and Welcome's Start
// trading navigates to returnTo in the same tab with the session refreshed, so the quote's marker
// re-shows it for a fresh tap; e2e quote.spec.ts walks that through the real Welcome. Task 5's take route
// landed 2026-10-28 and matches takeOffer's body (amountAtomic, walletId, centsPerXmr, fiatCents) → { code },
// price-changed and takeRefusal's codes; its starter-limit refusal carries { stage, capUsdCents } or
// { stage: 'starter', maxOpen } for the caller's own limit and nothing for the other side's (takeErrors.ts);
// that tripwire is retired. Task 29 is on the line since
// 2026-10-29: WalletPicker names and filters wallets through wallets-model.ts (APP_LABELS,
// takeableWallets), and e2e/quote.spec.ts drives the real /wallets?add=1&returnTo screen back here.) Each one below fails once the named module lands: then
// do what its message says (check the real shape against src/screens/quote/api.ts and the stubs in
// e2e/quote.spec.ts and test/quoteScreen.test.tsx, or wire the live call), and delete that tripwire.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const has = (p: string): boolean => existsSync(ROOT + p);

describe('Task 18 guesses still stand in for missing tasks', () => {
  it('NEEDS_TASK_20: the quote header Chat button is a placeholder', () => {
    expect(has('apps/web/src/chat/ChatPanel.tsx'), "Task 20 landed: wire the quote header's Chat to the poster's pre-trade chat").toBe(false);
  });
});
