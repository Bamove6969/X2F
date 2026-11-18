# Review: wip/agy-stash-0 @ 33c29068 ("wip(handoff): stash-0 formatXmrExact for trade send amounts")

Reviewer: the lead's dedicated agy reviewer, 18 Nov 2026.
Base: 3c2964e9 (main as of 8 Nov 2026). That is 1778 commits behind main 8e7e63d5, and the branch holds this one commit on top of it.
Author: the commit carries the owner's identity (flem), not AGY. It was pushed at 10:45:53 -0800, in the same minute as agy's `wip(handoff)` commit on wip/agy-layout (aadc5c93, 10:46:22). It is agy's handoff of an old git stash, so it is reviewed as agy work.
Scope:
- `packages/trade/src/money.ts` and `packages/trade/src/index.ts`: a new `formatXmrExact`;
- `apps/web/src/screens/trade/TradeFund.tsx` and `FundFallback.tsx`: the escrow funding screen's "send exactly / send the rest" amounts;
- `apps/web/src/screens/quote/quoteModel.ts`, plus tests in `packages/trade/test/money.test.ts` and `apps/web/test/tradeFund.test.tsx`.

## Verdict: CHANGES NEEDED (drop the branch; do not land)

## Findings

### Blocking
- **B1. Out of agy's lane: money and escrow.** The commit changes the shared money package (`@x2f/trade` money.ts) and the amount a seller is told to send into escrow. agy's lane is UI, copy, docs, research and test code only. Any change to money or escrow blocks, whatever its quality.
- **B2. Superseded by main, and it conflicts with it.** Main already has this exact fix:
  - `formatXmrExact` in `@x2f/trade`;
  - `TradeFund.tsx:22,160` and `FundFallback.tsx:12,82` use it;
  - `quoteModel.ts:243` reads `export const xmrText = formatXmrExact`;
  - `SellerRefund.tsx` and `browse/bands.ts` use it too;
  - `e2e/fund.spec.ts:316` covers it ("review kit round 1, finding 1").

  `git merge-tree origin/main 33c29068` reports conflicts. The branch has nothing to add. Delete it after the handoff, or leave it unmerged. The lead decides.

### Info
- The code itself matches what main landed, and the new tests are sound. This is not a correctness complaint; the branch is simply old and outside the lane.
- No user-facing copy is added. No "half".

## Checks
Not run. A full `npm run check` on an 8 Nov base 1778 commits behind main would only measure the old base, and it cannot change the verdict (B1 and B2). If the lead wants it run anyway, say so and I will queue it.

Counts: 2 blocking, 0 minor, 2 info.
