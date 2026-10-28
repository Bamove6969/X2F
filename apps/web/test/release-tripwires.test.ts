// TRIPWIRES for Task 24's seams. Task 24 was built before Tasks 12, 19, 22 and 3 reached the main
// line; after the main-line merge (fix round 2026-10-28) the Task 12, 19 and 3 tripwires fired and
// were acted on: the interim route runs Task 12's useEscrow (NEEDS_TASK_12 retired), it keeps
// polling instead of opening a second /v1/events connection because Task 22's room fans out
// App.tsx's one connection (NEEDS_TASK_19 retired; goes with NEEDS_TASK_22), and Task 3's
// MethodProfile has the `landsIn`/`checkPrompt` profileCopy reads (NEEDS_TASK_3 re-aimed below).
// Each remaining test fails once the missing piece is on the line: then do what it says.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const has = (p: string): boolean => existsSync(ROOT + p);
const read = (p: string): string => readFileSync(ROOT + p, 'utf8');

describe('Task 24 seams still stand in for missing modules', () => {
  it('NEEDS_TASK_22: /trade/:code goes to InterimTradeRoute until TradeRoom exists', () => {
    // When TradeRoom.tsx lands (wip/lead-p3-task22; types used here from @9bb22b7 and -land @76aea46):
    //   - in SellerConfirm.tsx add at top level
    //       import { registerTradeScreen } from './TradeRoom.js';
    //       for (const s of RELEASE_SLOTS) registerTradeScreen(s);
    //   - put `import './SellerConfirm.js';` on screens.ts's Task 24 line;
    //   - keep App.tsx's TradeRoom route, delete release/InterimTradeRoute.tsx and its route;
    //   - ReleaseRoomProps.escrow is Pick<UseEscrow, ...>, which Task 22's TradeEscrow (= UseEscrow
    //     on -land) satisfies; replace the "registers for exactly the lead's slots" unit test with
    //     one that `screenFor` picks ReleaseRoomScreen for each RELEASE_SLOTS entry.
    expect(has('apps/web/src/screens/trade/TradeRoom.tsx'), 'Task 22 TradeRoom landed: register RELEASE_SLOTS in it').toBe(false);
    expect(read('apps/web/src/App.tsx')).toContain('<InterimTradeRoute />');
  });

  it('NEEDS_TASK_22: publicName and methodInfo copy the rules of api/trade.ts', () => {
    // When apps/web/src/api/trade.ts lands: import publicName and methodOf from it in
    // release/view.ts, type ReleaseTrade as Pick<TradeView, ...>, and post release-started with
    // its postTradeEvent instead of SellerConfirm's direct api() call.
    expect(has('apps/web/src/api/trade.ts'), 'Task 22 api/trade.ts landed: use its publicName, methodOf, postTradeEvent and TradeView').toBe(false);
  });

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
