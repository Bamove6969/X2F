// TRIPWIRES for the parts of the dispute screens (Task 27) that other tasks build. Each fails once
// the real part lands on the main line: then wire it in where the comment says, check the shapes
// the dispute screens assume against it, and delete that tripwire. (NEEDS_TASK_20 is retired
// 2026-10-30: DisputeRoom shows Task 20's TradeChatPanel under the system cards.)
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const has = (p: string): boolean => existsSync(ROOT + p);

describe('Task 27 seams still stand in for parts other tasks build', () => {
  it('PLAN_4_MOD_COSIGN LANDED (Task 21 fix): the runtime co-signs a mod-built set only through cosignPolicy with the signed ruling statement', () => {
    // The regtest e2e (Plan 4 Task 21) found no ruling ever paid out: context() carried no `ruling`
    // and nothing called getRulingStatement. Now, while the trade is disputed, the runtime reads
    // GET /v1/trades/:code/ruling-statement, keeps it once it verifies for this trade, its own
    // derived escrow address and this side as the winner, and puts it in the PolicyContext with the
    // pinned modSigningPublic; the set comes from policy.ts rulingOutcomeFor (worked out on the
    // device, never the statement's own list), saved as the `ruling` intent before the hand-over.
    // Behaviour: test/attestation-flow.test.ts "Plan 4 rulings", test/policy.test.ts rulingOutcomeFor.
    // The signed statement is the gate in front of cosignPolicy (the worker never reads the API's
    // unsigned dispute view); it binds the ruling, round 1 and the winner.
    const runtime = readFileSync(ROOT + 'apps/web/src/escrow/runtime.ts', 'utf8');
    expect(runtime).toMatch(/deps\.api\.getRulingStatement\(/);
    expect(runtime).toMatch(/verifyRulingStatement\(/);
    expect(runtime).toMatch(/modSigningPublic: deps\.config\.modSigningPublic, statement:/);
    expect(runtime).toMatch(/rulingOutcomeFor\(ctx\)/);
    // Every hand-over still goes through settle(), the one place cosignPolicy runs.
    expect(runtime.match(/this\.party\.settle\(/g)?.length).toBe(1);
    expect(readFileSync(ROOT + 'apps/web/src/escrow/adapters.ts', 'utf8')).toMatch(/\/ruling-statement/);
    // Review m2 (22 Nov): the weaker gate over the unsigned dispute view is gone, so no caller can
    // wire it in place of the signed statement.
    const src = ['apps/web/src/screens/dispute/rules.ts', 'apps/web/src/escrow/runtime.ts', 'apps/web/src/escrow/policy.ts', 'apps/web/src/screens/dispute/DisputeSlot.tsx', 'apps/web/src/screens/dispute/DisputeRuling.tsx'];
    for (const f of src) expect(readFileSync(ROOT + f, 'utf8'), f).not.toMatch(/function rulingAllowsCosign/);
    expect(readFileSync(ROOT + 'apps/web/src/screens/dispute/rules.ts', 'utf8')).not.toMatch(/rulingAllowsCosign/);
  });

  it('PLAN_4_MOD_COSIGN LANDED (growth-binding review m4, decided): the release-binding flags never block a ruling co-sign', () => {
    // docs/security/growth-before-paid-2026-11-20.md. acceptedAmount() still returns null under
    // releaseRebindRefused and paidRefused for every release; a mod-built ruling set takes its amount
    // from rulingAmount() (the same rules without the two flags), and the seller's full reversal is
    // refund-shaped. Behaviour: attestation-flow.test.ts "TODO(m4) decided".
    const runtime = readFileSync(ROOT + 'apps/web/src/escrow/runtime.ts', 'utf8');
    expect(runtime, 'the TODO(m4) note is resolved').not.toMatch(/TODO\(m4\)/);
    expect(runtime).toMatch(/refundOnly \? \(r\.acceptedAtomic \?\? r\.sizeAtomic\) : ruling \? this\.rulingAmount\(v\) : this\.acceptedAmount\(v\)/);
    expect(runtime).toMatch(/this\.context\(sumOf\(o\.to\), refundShaped, o\.builder === 'mod'\)/);
  });

  it('NEEDS_PLAN_4_RULING_PAYOUT: the ruling page says where the XMR goes until the API reports the payout executed', () => {
    // C11 review I1. Spec / Plan 4 ("A1 dropped", Revision 2026-10-29c) and owner Q37 (6 Nov): the
    // coins move at the ruling. rulingAllowsCosign (screens/dispute/rules.ts) allows the co-sign from
    // the ruling on (Task 15), but nothing executes a ruling's payout yet, so DisputeRuling says
    // "Goes to …" and the appeal line does not say the XMR has moved. Plan 4's execution task adds an
    // executed flag on the dispute view. When the view reports the payout executed: show the board's
    // "Sent to …" once it is, and delete this check.
    const view = readFileSync(ROOT + 'apps/web/src/screens/dispute/api.ts', 'utf8');
    const routes = readFileSync(ROOT + 'apps/api/src/disputes/routes.ts', 'utf8');
    expect(/executed|payoutTx|paidOutAt/i.test(view + routes), 'the dispute view reports the payout executed: flip the ruling copy to "Sent to …"').toBe(false);
  });

  it('PLAN_4_TASK_23 LANDED: dispute records go with their trade, 90 days after the dispute closes (R36)', () => {
    // Plan 4 Task 23 / Plan 7 Task 2 (wip/lead-retention): a disputed trade is deleted whole 90 days
    // after its last dispute closes (owner p11-11; closed_at, not the dispute button), never while
    // a dispute or appeal is open. The dispute half lives in disputes/purge.ts (appeals, drafts and
    // rulings before the dispute rows) and the whole-trade job in retention/tradePurge.ts, as
    // x2f_purge. The trade's won/lost disputes and completed count move to the accounts' running
    // totals (account_traded_totals.purged_*) in the same transaction, so there is no per-dispute
    // bare record. trades.dispute_by is never cleared on a kept trade (the purge deletes the row or
    // leaves it alone). The ruling footer ("kept with the trade") stays true: the dispute records
    // live exactly as long as the trade does.
    const disputePurge = readFileSync(ROOT + 'apps/api/src/disputes/purge.ts', 'utf8');
    const tradePurge = readFileSync(ROOT + 'apps/api/src/retention/tradePurge.ts', 'utf8');
    const jobs = readFileSync(ROOT + 'apps/api/src/retentionJobs.ts', 'utf8');
    expect(disputePurge).toMatch(/DISPUTE_KEEP_DAYS/);
    expect(disputePurge.indexOf("'dispute_appeals'")).toBeGreaterThan(-1);
    expect(disputePurge.indexOf("'dispute_appeals'")).toBeLessThan(disputePurge.indexOf("'dispute_rulings'"));
    expect(disputePurge.indexOf("'dispute_rulings'")).toBeLessThan(disputePurge.indexOf("'disputes'"));
    expect(tradePurge).toMatch(/deleteDisputeRecords\(/);
    expect(tradePurge).toMatch(/set local role \$\{PURGE_ROLE\}/);
    expect(jobs).toMatch(/purgeTradesJob/);
    expect(readFileSync(ROOT + 'apps/web/src/screens/dispute/rules.ts', 'utf8')).toContain('This ruling and its evidence are kept with the trade.');
  });

  it('NEEDS_PLAN_5: evidence upload and the unblurred copy wait for the on-device proof pipeline', () => {
    // EvidenceUpload and tradeProofs in screens/dispute/seams.tsx are stand-ins (no file input at
    // all). Plan 5 Tasks 13-15 replace them (strip metadata, blur, check, seal). UnblurredRequest is
    // wired (Task 15: SendUnblurred, behind VITE_X2F_PROOF_UPLOAD).
    expect(has('apps/web/src/proof/pipeline.ts'), 'Plan 5 pipeline landed: replace the evidence seams').toBe(false);
  });

  it('NEEDS_REFUND_REASON: the refunded view infers the reason until trades record refund_reason', () => {
    // rules.ts refundReason reads `settling` and `dispute`, and calls any refund on a disputed trade
    // a dispute decision (wrong for a released trade's refunded late deposit, or a pre-signed refund
    // landing after a dispute opened). Plan 3 Revision 2026-10-29: each refund path records
    // `refund_reason` ('no-show' | 'buyer-cancel' | 'mutual-cancel' | 'ruling' | 'lapse') and
    // toTradeView returns it. When it does: switch refundReason to view.refundReason (TradeView in
    // api/trade.ts), one line per reason, and delete this check.
    const migrations = readdirSync(ROOT + 'apps/api/migrations').map((f) => readFileSync(ROOT + 'apps/api/migrations/' + f, 'utf8')).join('\n');
    const view = readFileSync(ROOT + 'apps/api/src/trades/view.ts', 'utf8');
    expect(/refund_reason/.test(migrations) || /refundReason/.test(view), 'refund_reason landed: switch rules.ts refundReason to view.refundReason').toBe(false);
  });
  it('NEEDS_TASK_12_FEES_OWED: the ruling page shows the owed-fee line only when the dispute view carries feeOwedAtomic', () => {
    // Revision 2026-10-29c "Fees on settled disputes": Task 12's publish writes fees_owed and the
    // trader view tells the debtor. Task 10's view has no such field yet, so DisputeRuling (via
    // parseDispute's optional feeOwedAtomic) shows nothing. When the API sends it: check the name and
    // shape (a digit string, only in the debtor's view) against api.ts parseDispute, check that the
    // collection the line promises ("deducted automatically from your future trades": feeOwedAtomic in
    // the next trades' signed terms) is built, or change the line, and delete this.
    const routes = readFileSync(ROOT + 'apps/api/src/disputes/routes.ts', 'utf8');
    expect(/feeOwed|fees_owed/.test(routes), 'the dispute view sends the owed fee: check parseDispute against it').toBe(false);
  });
});
