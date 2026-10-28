// TRIPWIRES for Task 24's seams. Task 24 was built before Tasks 12, 19, 22 and 3 reached the main
// line; after the main-line merge (fix round 2026-10-28) the Task 12, 19 and 3 tripwires fired and
// were acted on: the interim route runs Task 12's useEscrow (NEEDS_TASK_12 retired), it keeps
// polling instead of opening a second /v1/events connection because Task 22's room fans out
// App.tsx's one connection (NEEDS_TASK_19 retired; goes with NEEDS_TASK_22), and Task 3's
// MethodProfile has the `landsIn`/`checkPrompt` profileCopy reads (NEEDS_TASK_3 re-aimed below).
// Task 22's landing (fix round 2, 2026-10-28) retired both NEEDS_TASK_22 tripwires: the slots are
// registered by screens/trade/releaseScreens.ts (release.test.tsx checks screenFor for each), the
// interim route is gone, and view.ts uses api/trade.ts's TradeView, publicName, methodOf and
// postTradeEvent. Each remaining test fails once the missing piece is on the line: then do what
// it says.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (p: string): string => readFileSync(ROOT + p, 'utf8');

describe('Task 24 seams still stand in for missing modules', () => {
  it('NEEDS_TASK_3_IN_VIEW: the trade view carries no method profile until tradeRoutes gets getProfile', () => {
    // Task 3's profiles are on the line and profileCopy reads their `landsIn`/`checkPrompt`, but
    // app.ts does not pass a profile lookup to tradeRoutes, so `view.profile` is null and
    // SellerConfirm uses the generic "your account" wording. When it is wired: check the e2e stubs
    // in e2e/release.spec.ts against the real profile, and do Minor 5 of the 2026-10-27 review
    // (first-person wording for PAY_BY_MAIL and CUSTOM, all 8 launch profiles tested).
    const call = read('apps/api/src/app.ts').match(/tradeRoutes\(app,[^;]*\);/)?.[0] ?? '';
    expect(call, 'tradeRoutes call not found in app.ts').not.toBe('');
    expect(call, 'tradeRoutes now gets a profile lookup: check profileCopy and do Minor 5').not.toMatch(/profile/i);
  });

  it('NEEDS_TASK_12_OWN_ADDRESS: the payout ending on Released is the API\'s stored buyer_payout', () => {
    // Minor 7 of the 2026-10-27 review: the release pays the address the buyer's device signed
    // (ConfirmedTrade.ownAddress). When UseEscrow exposes it (or its ending), show that on Released
    // and fall back to the API's `payoutEnd`.
    expect(read('apps/web/src/escrow/useEscrow.ts'), 'Task 12 exposes the own address: prefer it on Released').not.toMatch(/ownAddress|payoutEnd|addressEnd/);
  });
});
