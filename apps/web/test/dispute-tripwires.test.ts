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

  it('NEEDS_PLAN_4_MOD_COSIGN: moderator-built transactions go through rulingAllowsCosign and cosignPolicy', () => {
    // Task 12's runtime (escrow/runtime.ts) settles only the trader routes today: outcomeFor never
    // builds a mod-built set, so rulingAllowsCosign (screens/dispute/rules.ts) is not reachable yet.
    // When the runtime gains a path that settles a set whose builder is 'mod' (Plan 4), that path
    // must call rulingAllowsCosign with the real cosignPolicy closed over its PolicyContext
    // ((o) => cosignPolicy(ctx, o)), and the stand-in policy in test/dispute.test.tsx goes.
    const runtime = readFileSync(ROOT + 'apps/web/src/escrow/runtime.ts', 'utf8');
    expect(/'mod'|rulingAllowsCosign/.test(runtime), 'the runtime settles mod-built sets: gate them with rulingAllowsCosign').toBe(false);
  });

  it('NEEDS_PLAN_5: evidence upload and the unblurred copy wait for the on-device proof pipeline', () => {
    // EvidenceUpload, UnblurredRequest and tradeProofs in screens/dispute/seams.tsx are stand-ins
    // (no file input at all). Plan 5 Tasks 13-15 replace them (strip metadata, blur, check, seal).
    expect(has('apps/web/src/proof/pipeline.ts'), 'Plan 5 pipeline landed: replace the evidence seams').toBe(false);
  });

  it('NEEDS_FU_A: the counterparty name is TradeView.counterparty.username (the public name today)', () => {
    const view = readFileSync(ROOT + 'apps/api/src/trades/view.ts', 'utf8');
    expect(view.includes('displayName'), 'FU-A renamed the field: update parseTrade').toBe(false);
  });
});
