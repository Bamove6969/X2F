// TRIPWIRES for what the quote (Task 18) assumes before the tasks it plugs into are on the line.
// (Task 3's /v1/price and /v1/methods are on the line since 2026-10-26 and were checked against
// api.ts on 2026-10-27: same fields, `exponent` always sent; Tasks 16 and 17's offer lists are on
// the line and App.tsx hands their Trade button to the quote, which reads offers through browse's
// parseOffers; those tripwires are retired. Task 4's GET /v1/offers landed 2026-10-28 and matches
// quoteOffer and parseOffers (poster.username is the public name, stage, opensAt, bigint strings); its
// tripwire is retired. Task 4 also serves GET /v1/offers/:id, which the quote may use instead of the list. Task 12 is on the line since 2026-10-27: quote/confirmed.ts imports
// ConfirmedTrade and Deal from escrow/ and its read-back refuses what Task 12's validConfirmed refuses
// (address over 256 characters included); the trade room (Task 22) passes location.state.confirmed,
// else readConfirmed(code), to Task 12's useEscrow (test/tradeRoomEscrow.test.tsx).) Each one below fails once the named module lands: then
// do what its message says (check the real shape against src/screens/quote/api.ts and the stubs in
// e2e/quote.spec.ts and test/quoteScreen.test.tsx, or wire the live call), and delete that tripwire.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const has = (p: string): boolean => existsSync(ROOT + p);

describe('Task 18 guesses still stand in for missing tasks', () => {
  it('NEEDS_TASK_5: the take route and its starter-limit refusal are guessed', () => {
    // Guessed: POST /v1/offers/:id/take { amountAtomic: string; walletId; centsPerXmr: string; fiatCents:
    // string } → { code } (plan Task 5 with Revision 2026-10-27: the quoted rate and total travel with the
    // take; the server locks exactly them or refuses 409 { error: 'price-changed' } when the market moved
    // past the offer's tolerance, fixed-price offers comparing exactly); the other refusals 409 with { error }
    // as in plan Task 5, plus 409 { error: 'starter-limit', stage: 'starter'|'building', capUsdCents?: string }
    // naming only the caller's own stage (Revision 2026-10-24). Also check that the trade's stored fiatCents
    // is the quoted one (OD-5).
    expect(has('apps/api/src/trades/take.ts'), "Task 5 landed: check takeOffer's body (centsPerXmr, fiatCents), price-changed, takeRefusal's codes and the starter-limit fields").toBe(false);
  });

  it("NEEDS_TASK_28: setup does not yet come back to the quote with `resume=<nonce>` and this tab's pending-take marker", () => {
    // useTake sends a logged-out Trade to /setup/terms?returnTo=<quote with resume=<nonce>> after
    // writing the single-use pending-take marker to this tab's sessionStorage (pendingTake.ts). Setup
    // must end on returnTo IN THE SAME TAB (the marker is per tab; a new tab or window is a plain
    // quote) with a fresh session (useSession reads /v1/account/me once per page load today). Back on
    // the quote, a matching marker re-shows the quote at the price now and asks for a tap; it never takes.
    expect(
      has('apps/web/src/screens/setup/SetupFlow.tsx'),
      'Task 28 landed: check Start trading → returnTo in the same tab re-shows the quote with "You\'re back" (e2e quote.spec.ts)',
    ).toBe(false);
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
