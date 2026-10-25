// TRIPWIRES for the parts of the dispute screens (Task 27) that other tasks build. Each fails once
// the real part lands on the main line: then wire it in where the comment says, check the shapes
// the dispute screens assume against it, and delete that tripwire.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const has = (p: string): boolean => existsSync(ROOT + p);

describe('Task 27 seams still stand in for parts other tasks build', () => {
  it('NEEDS_TASK_22: the trade room links to the dispute screens', () => {
    // TradeRoom (Task 22) must (1) show <DisputeEntry> (screens/dispute/DisputeEntry.tsx) where the
    // boards have "Open dispute" (BuyerPay, SellerConfirm) and on a refunded trade for the buyer
    // (spec 2.3, 90 days), and (2) send a trade in state `disputed` to /trade/:code/dispute, which
    // App.tsx already routes to DisputeScreen. Then check the TradeView fields parseTrade reads.
    expect(has('apps/web/src/screens/trade/TradeRoom.tsx') || has('apps/web/src/screens/TradeRoom.tsx'), 'Task 22 landed: place DisputeEntry and the disputed redirect').toBe(false);
  });

  it('NEEDS_TASK_20: the dispute room uses FallbackChat until ChatPanel exists', () => {
    // Replace FallbackChat (screens/dispute/seams.tsx) with Task 20's ChatPanel, passing the system
    // cards from systemCardsFor; moderator messages render <ModeratorTag from="mod" …> (never
    // ModeratorBadge directly); drop DisputeRoom's own chat notice if ChatPanel shows it.
    expect(has('apps/web/src/chat/ChatPanel.tsx'), 'Task 20 ChatPanel landed: wire it into DisputeRoom').toBe(false);
  });

  it('NEEDS_TASK_12: moderator-built transactions go through rulingAllowsCosign and cosignPolicy', () => {
    // The escrow runtime must call rulingAllowsCosign (screens/dispute/rules.ts) with the real
    // cosignPolicy before settling any set whose builder is 'mod', and the stand-in policy in
    // test/dispute.test.tsx must be replaced by the real one.
    expect(has('apps/web/src/escrow/policy.ts'), 'Task 12 landed: gate mod-built sets with rulingAllowsCosign').toBe(false);
  });

  it('NEEDS_PLAN_5: evidence upload and the unblurred copy wait for the on-device proof pipeline', () => {
    // EvidenceUpload, UnblurredRequest and tradeProofs in screens/dispute/seams.tsx are stand-ins
    // (no file input at all). Plan 5 Tasks 13-15 replace them (strip metadata, blur, check, seal).
    expect(has('apps/web/src/proof/pipeline.ts'), 'Plan 5 pipeline landed: replace the evidence seams').toBe(false);
  });

  it('NEEDS_TASK_3: the method name comes from GET /v1/methods', () => {
    // fetchMethodName (screens/dispute/api.ts) reads { all: [{ id, name }] } from wip/second-p3-t3.
    expect(has('apps/api/src/methods/routes.ts'), 'Task 3 landed: check fetchMethodName against /v1/methods').toBe(false);
  });

  it('NEEDS_TASK_19: the dispute screens poll until live events exist', () => {
    // DisputeScreen re-reads the dispute every 30 s and on focus; Task 19's SSE (moderator-joined,
    // ruling) should trigger the re-read instead.
    expect(has('apps/web/src/live/useLive.ts') || has('apps/web/src/events/useTradeEvents.ts'), 'Task 19 landed: refresh on live events').toBe(false);
  });

  it('NEEDS_FU_A: the counterparty name is TradeView.counterparty.username (the public name today)', () => {
    const view = readFileSync(ROOT + 'apps/api/src/trades/view.ts', 'utf8');
    expect(view.includes('displayName'), 'FU-A renamed the field: update parseTrade').toBe(false);
  });
});
