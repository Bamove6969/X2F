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
  it('NEEDS_PLAN_4_MOD_COSIGN: moderator-built transactions go through rulingAllowsCosign and cosignPolicy', () => {
    // Task 12's runtime (escrow/runtime.ts) settles only the trader routes today: outcomeFor never
    // builds a mod-built set, so rulingAllowsCosign (screens/dispute/rules.ts) is not reachable yet.
    // When the runtime gains a path that settles a set whose builder is 'mod' (Plan 4), that path
    // must call rulingAllowsCosign with the real cosignPolicy closed over its PolicyContext
    // ((o) => cosignPolicy(ctx, o)), and the stand-in policy in test/dispute.test.tsx goes.
    // Haveno review 2026-11-12, finding 2 (lead call): that PolicyContext must carry `ruling`, the
    // moderation service's signed statement from GET /v1/trades/:code/ruling-statement
    // (adapters.ts httpEscrowApi.getRulingStatement) with this trade's code, the escrow address the
    // device's own party derived and the pinned modSigningPublic: without it cosignPolicy refuses
    // every mod-built set (policy.ts `ruled`).
    const runtime = readFileSync(ROOT + 'apps/web/src/escrow/runtime.ts', 'utf8');
    expect(/'mod'|rulingAllowsCosign/.test(runtime), 'the runtime settles mod-built sets: gate them with rulingAllowsCosign').toBe(false);
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

  it('NEEDS_PLAN_4_TASK_23: dispute retention is Plan 4 Task 23\'s / Plan 7 Task 2\'s (R36)', () => {
    // Task 27 deletes no dispute record: 108/110 keep every dispute per (code, seq) with `closed_at`,
    // the foreign keys have no cascade (deleting a trade with a dispute is refused), and the ruling
    // footer is the board's "kept with the trade" (COPY-UNSIGNED, pending Q1). When the purge lands
    // (R36: a disputed trade goes 90 days after the dispute button, opened_at): add the trade's
    // disputes to the accounts' running totals (lost disputes, Plan 5 Task 20) instead of a
    // per-dispute bare record; run as x2f_purge; delete appeals, then rulings, then disputes before
    // the trade; never clear trades.dispute_by on a kept trade (POST …/dispute refuses a second
    // dispute on it); and check the footer line in screens/dispute/rules.ts against the keep time.
    const jobs = readFileSync(ROOT + 'apps/api/src/retentionJobs.ts', 'utf8');
    expect(has('apps/api/src/disputes/purge.ts') || /purgeClosedDisputes|DISPUTE_KEEP_DAYS/.test(jobs), 'Plan 4 Task 23 landed: check the bare record and the footer').toBe(false);
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

  it('NEEDS_TASK_12_TX_PROOF: the seller-sends-xmr proof form is shown only with a handler', () => {
    // Plan 4 Task 15 (A6/A8): the seller sends the XMR and proves it (tx hash, tx key). No API route
    // takes the proof yet, and the view does not carry the buyer's address, so DisputeScreen passes no
    // onTxProof and the ruling shows the amount and the time only. When the route lands: pass
    // onTxProof from DisputeScreen and DisputeSlot, show the buyer's address, and delete this.
    const routes = readFileSync(ROOT + 'apps/api/src/disputes/routes.ts', 'utf8');
    expect(/tx-proof|txKey|tx_key/.test(routes), 'the tx-proof route landed: wire onTxProof and the buyer address').toBe(false);
  });
});
