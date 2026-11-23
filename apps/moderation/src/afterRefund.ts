import { signAfterRefundStatement, type AfterRefundStatement } from '@x2f/trade';
import { gateCheck, type GateContext, type GateRefusal, type GateRuling, type GateSource, type GateStore, type RecordedTerms, type StoredRulings } from './gate/index.js';

/**
 * Review p4t22 M2 (security review of the dispute system, 23 Nov): the after-refund "seller sends
 * XMR" ruling, bound to the moderation key. After a refund the escrow is empty, so nothing is
 * co-signed: the seller moves the coins by hand, and before this the seller's app showed the pay
 * form on the API's word alone. Now, for each current after-refund dispute whose ruling in force
 * orders `seller-sends-xmr`, this pass asks the ruling gate (`gateCheck`: the same staff taps, the
 * same two-person rule, R37 for round 2 against round 1 as the gate itself authorised it), and only
 * then signs an `AfterRefundStatement` with the moderation key: the trade, the round, the ruling,
 * the XMR and the buyer's payout address, all from this process's own attested records. It is
 * announced to the API (`after-refund-statement`), which keeps it for the traders; the seller's
 * device shows the pay form only for one that verifies against the pinned key and its own amount
 * and address.
 *
 * The ruling in force: round 1's while an appeal is pending (the API gives round 2 only once it is
 * decided), else round 2's. A round 2 is checked after round 1 (authorised, whatever its outcome,
 * so the gate knows its signers). A refusal is reported for the staff case view (`ruling-refused`,
 * once per change); no recorded terms (`no-terms`) signs nothing. `issuedAt` is when the gate first
 * saw the ruling (sealed in its store), so the statement is the same after a restart.
 */
export type AfterRefundStepResult = 'none' | 'no-terms' | `refused-${string}` | 'announce-failed' | 'announced' | 'done';

export interface AfterRefundStepInput {
  code: string;
  stored: StoredRulings;
  /** This process's own recorded terms for the trade (`recordedTerms`), or null. */
  recorded: RecordedTerms | null;
  announce(r: { statement: AfterRefundStatement; sig: string }): Promise<boolean>;
  reportRefusal?(r: { rulingId: string; reason: GateRefusal | null }): Promise<boolean>;
}

export interface AfterRefundSigner {
  step(s: AfterRefundStepInput): Promise<AfterRefundStepResult>;
}

export function afterRefundSigner(o: { store: GateStore; source: GateSource; ctx: GateContext; log: (e: { reason: string }) => void; signingSecret: Uint8Array }): AfterRefundSigner {
  /** The ruling whose statement the API took in this process, per trade. */
  const announced = new Map<string, string>();
  /** The refusal the API took in this process, per trade (`rulingId:reason`). */
  const refused = new Map<string, string>();

  const report = async (s: AfterRefundStepInput, rulingId: string, reason: GateRefusal | null): Promise<void> => {
    if (!s.reportRefusal) return;
    const now = `${rulingId}:${reason ?? ''}`;
    if (refused.get(s.code) === now) return;
    const took = await s.reportRefusal({ rulingId, reason }).catch(() => false);
    if (took) refused.set(s.code, now);
  };

  const check = async (s: AfterRefundStepInput, r: GateRuling): Promise<GateRefusal | null> => {
    const r1 = s.stored.current?.round === 1 ? s.stored.current : s.stored.round1;
    const a = await gateCheck(o.store, o.source, { ruling: r, recorded: s.recorded!, balanceAtomic: 0n, ...(r.round === 2 ? { involved: s.stored.involved, ...(r1 ? { round1: r1 } : {}) } : {}) }, o.ctx);
    return a.ok ? null : a.reason;
  };

  const step = async (s: AfterRefundStepInput): Promise<AfterRefundStepResult> => {
    const r1 = s.stored.current?.round === 1 ? s.stored.current : s.stored.round1;
    const inForce = s.stored.current ?? r1;
    if (inForce === null || inForce.outcome !== 'seller-sends-xmr') return 'none';
    if (announced.get(s.code) === inForce.id) return 'done';
    if (s.recorded === null) return 'no-terms';
    if (inForce.round === 2 && r1 !== null && !Object.hasOwn(o.store.state.rulingsSeen, r1.id)) {
      const first = await check(s, r1);
      // Review p4t22 N1: a round 1 whose signer was since switched off or removed is read for its signers by round 2's check.
      if (first !== null && first !== 'revoked') {
        o.log({ reason: `after-refund-refused-${first}` });
        await report(s, r1.id, first);
        return `refused-${first}`;
      }
    }
    const why = await check(s, inForce);
    if (why !== null) {
      o.log({ reason: `after-refund-refused-${why}` });
      await report(s, inForce.id, why);
      return `refused-${why}`;
    }
    await report(s, inForce.id, null);
    const seen = o.store.state.rulingsSeen[inForce.id];
    const statement: AfterRefundStatement = {
      v: 1,
      kind: 'after-refund',
      trade: s.code,
      round: inForce.round,
      rulingId: inForce.id,
      outcome: 'seller-sends-xmr',
      amountAtomic: s.recorded.amountAtomic.toString(),
      buyerPayout: s.recorded.buyerPayout,
      issuedAt: seen?.publishedSeenAt ?? o.ctx.now().toISOString(),
    };
    const sig = await signAfterRefundStatement(statement, o.signingSecret);
    const took = await s.announce({ statement, sig }).catch(() => false);
    if (took !== true) {
      o.log({ reason: 'after-refund-statement-refused' });
      return 'announce-failed';
    }
    announced.set(s.code, inForce.id);
    o.log({ reason: 'after-refund-statement' });
    return 'announced';
  };

  return { step };
}
