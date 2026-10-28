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
    // Fires when Task 22 lands (checked against origin/wip/lead-p3-task22 @9bb22b7 and its landing
    // branch -land @50ecd93: screens/trade/TradeRoom.tsx, screens.ts, seams.ts). Then:
    // (1) register `{ owner: 'Task 27', role: 'any', states: ['disputed'], screen: DisputeSlot }` on
    //     the reserved line in screens/trade/screens.ts. DisputeSlot takes TradeScreenProps, loads
    //     only GET …/dispute, names the counterparty with publicName(view.counterparty), the method
    //     with methodOf(view), and uses props.serverClock(); it never fetches the trade or starts
    //     the escrow (the room's one `escrow` handle is where a Plan 4 mod-built co-sign through
    //     rulingAllowsCosign must run). Keep /trade/:code/dispute for DisputeOpen and ?view=chat.
    // (2) re-read on the room's live source (seams.ts useTradeLive, one connection) instead of a
    //     second useLiveEvents connection in DisputeScreen.
    // (3) Tasks 23/24/25 place <DisputeEntry> in BuyerPay, SellerConfirm and the buyer's refunded view.
    expect(has('apps/web/src/screens/trade/TradeRoom.tsx') || has('apps/web/src/screens/TradeRoom.tsx'), 'Task 22 landed: register the disputed slot and place DisputeEntry').toBe(false);
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

  it('NEEDS_PLAN_4_TASK_23: dispute retention is Plan 4 Task 23\'s, waiting on the owner\'s Plan 7 Q1', () => {
    // Task 27 deletes no dispute record: 108/110 keep every dispute per (code, seq) with `closed_at`,
    // the foreign keys have no cascade (deleting a trade with a dispute is refused), and the ruling
    // footer says "kept with the trade" (COPY-UNSIGNED, pending Q1). When Task 23 adds its purge:
    // keep the bare record (who opened it, the ruling's outcome or loser, opened_at, closed_at) that
    // Task 4's stage and Plan 5's reputation need; run as x2f_purge; delete appeals and rulings
    // before their dispute; never clear trades.dispute_by (POST …/dispute refuses a second dispute
    // on it); and change the footer line in screens/dispute/rules.ts to the owner's keep time.
    const jobs = readFileSync(ROOT + 'apps/api/src/retentionJobs.ts', 'utf8');
    expect(has('apps/api/src/disputes/purge.ts') || /purgeClosedDisputes|DISPUTE_KEEP_DAYS/.test(jobs), 'Plan 4 Task 23 landed: check the bare record and the footer').toBe(false);
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
