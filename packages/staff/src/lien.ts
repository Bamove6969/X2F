import type { Dispute } from './dispute.js';
import { ESCROW_OUTCOMES, type RulingOutcome } from './intent.js';

/**
 * Plan 4 Task 25 (J-06): the liens and owed fees a dispute's change brings. Pure: the API stores
 * what this returns in the transaction that stores the dispute (`apps/api/src/disputes/lien.ts`).
 *
 * The owner's rules (register rows D-006, D-008, D-009, D-062, D-063; owner g63 for the 1%):
 * - D-009: money moves at once after a ruling; a lien covers a reversal.
 * - D-008: losing a dispute that requires restitution puts an immediate lien on the loser; if they
 *   appeal, it is lifted while the appeal is pending and the outcome decides; an overturned ruling
 *   liens whoever got the coins.
 * - D-006: a won appeal fixes the record and liens the other account for the loss, the trade's XMR.
 * - D-063: the lien includes the unpaid 1% only if the debtor was the one who owed it (their ad);
 *   a party who was not the fee payer is never charged it.
 * - D-062 with g63: a party who owes the 1% with no money in the escrow to take it from owes it
 *   from future trades (a `fee-owed` step, Task 12's `fees_owed`). Written only once the ruling is
 *   final ("during an appeal, the fee waits on the outcome", g63).
 *
 * Restitution, as built (lead reading of the owner's word, Plan 4 Task 25): an after-refund ruling
 * that orders the seller to send the trade's XMR (`seller-sends-xmr`). NEEDS_OWNER_FIAT_LIEN:
 * `seller-returns-fiat` (pay the buyer back through the payment method) is also restitution, but no
 * owner rule says how a fiat debt is shown as paid, so this places no lien for it yet.
 *
 * Who appeals (lead reading of "if they appeal", owner 28 Oct 12:54): only the debtor's own appeal
 * suspends their lien. The person owed may appeal too (owner 13:48: "they paid too little or
 * nothing"), and that must never lift the lien.
 */

export type LienSide = 'buyer' | 'seller';
export type LienCause = 'restitution' | 'overturned';
export type LienStatus = 'active' | 'suspended' | 'repaid' | 'void';

/** What a lien's amounts come from: the trade as agreed at take. */
export interface LienFacts {
  poster: LienSide;
  /** The trade's XMR (the agreed amount; a grown trade's grown amount), atomic units. */
  amountAtomic: bigint;
  /** The trade's 1%, atomic units. */
  feeAtomic: bigint;
}

/** A lien already stored for this dispute (code and seq). */
export interface LienRef {
  id: string;
  round: 1 | 2;
  debtor: LienSide;
  cause: LienCause;
  status: LienStatus;
  /** Owed to the creditor (the other side). */
  amountAtomic: bigint;
  /** The unpaid 1% the debtor owed X2F (D-063); 0 when they did not. */
  feeAtomic: bigint;
}

export type LienStep =
  /** A new lien, `active` at once, on `debtor`; the creditor is the other side. */
  | { op: 'place'; round: 1 | 2; debtor: LienSide; cause: LienCause; amountAtomic: bigint; feeAtomic: bigint }
  | { op: 'suspend' | 'reactivate' | 'void' | 'repaid'; id: string }
  /** D-062: `side` owes the 1% from its future trades. */
  | { op: 'fee-owed'; side: LienSide; amountAtomic: bigint };

const other = (s: LienSide): LienSide => (s === 'buyer' ? 'seller' : 'buyer');
const isEscrow = (o: RulingOutcome) => (ESCROW_OUTCOMES as readonly string[]).includes(o);
const FINAL = ['final', 'complying', 'closed'];

/** The restitution an after-refund outcome orders, or null. NEEDS_OWNER_FIAT_LIEN: see the top. */
const restitutionDebtor = (o: RulingOutcome): LienSide | null => (o === 'seller-sends-xmr' ? 'seller' : null);

/**
 * The 1% an outcome leaves unpaid by the escrow when the trade completes (g63: a lien completes the
 * trade and the poster pays), split by D-063: in the lien when the debtor is the poster, else owed
 * by the poster from future trades. `paidByEscrow`: a round-1 escrow output already carried it.
 */
function feeSplit(debtor: LienSide, facts: LienFacts, paidByEscrow: boolean): { inLien: bigint; owed: LienStep[] } {
  if (paidByEscrow) return { inLien: 0n, owed: [] };
  if (facts.poster === debtor) return { inLien: facts.feeAtomic, owed: [] };
  return { inLien: 0n, owed: [{ op: 'fee-owed', side: facts.poster, amountAtomic: facts.feeAtomic }] };
}

function checkFacts(f: LienFacts): void {
  if (f.poster !== 'buyer' && f.poster !== 'seller') throw new RangeError('poster must be buyer or seller');
  if (typeof f.amountAtomic !== 'bigint' || f.amountAtomic <= 0n) throw new RangeError('amount must be positive');
  if (typeof f.feeAtomic !== 'bigint' || f.feeAtomic < 0n || f.feeAtomic >= f.amountAtomic) throw new RangeError('fee out of range');
}

/**
 * The steps that `prev` → `next` (one accepted `applyDispute` change of the same dispute) brings,
 * given the liens already stored for it. Pure; never changes its inputs.
 */
export function lienSteps(prev: Dispute, next: Dispute, facts: LienFacts, liens: readonly LienRef[]): LienStep[] {
  if (prev.code !== next.code || prev.seq !== next.seq) throw new RangeError('not the same dispute');
  checkFacts(facts);
  const mine = liens.filter((l) => l.status === 'active' || l.status === 'suspended');

  // Round 1 published (from open, or approved): it acts at once (D-009, D-008).
  if (next.round === 1 && next.status === 'published' && prev.status !== 'published') {
    const o = next.ruling?.outcome;
    const debtor = o === undefined || !next.afterRefund ? null : restitutionDebtor(o);
    if (debtor === null) return [];
    // The fee part waits for finality (g63), except the debtor's own fee, which the lien carries.
    const inLien = facts.poster === debtor ? facts.feeAtomic : 0n;
    return [{ op: 'place', round: 1, debtor, cause: 'restitution', amountAtomic: facts.amountAtomic, feeAtomic: inLien }];
  }

  // The appeal: the debtor's own appeal suspends their round-1 lien while it is pending.
  if (prev.round === 1 && next.round === 2 && next.status === 'appealed') {
    const by = next.appealBy;
    return mine.filter((l) => l.round === 1 && l.status === 'active' && l.debtor === by).map((l) => ({ op: 'suspend' as const, id: l.id }));
  }

  // Round 1 final with no appeal: what the poster owes from future trades (D-062).
  if (next.round === 1 && prev.status === 'published' && FINAL.includes(next.status)) {
    const o = next.ruling?.outcome;
    const debtor = o === undefined || !next.afterRefund ? null : restitutionDebtor(o);
    if (debtor === null) return [];
    return feeSplit(debtor, facts, false).owed;
  }

  // Round 2 decided ("Decision stands" or "Decision overruled").
  if (next.round === 2 && FINAL.includes(next.status) && !FINAL.includes(prev.status)) {
    const first = next.round1?.outcome;
    const final = next.ruling?.outcome;
    if (first === undefined || final === undefined) return [];
    const round1 = mine.filter((l) => l.round === 1);
    if (final === first) {
      // "Decision stands": a suspended lien binds again, and a 1% the escrow never carried is owed
      // now that the outcome is final (g63: an appeal upholding completion, the poster pays).
      const back: LienStep[] = round1.filter((l) => l.status === 'suspended').map((l) => ({ op: 'reactivate' as const, id: l.id }));
      const debtor = next.afterRefund ? restitutionDebtor(final) : null;
      return debtor === null ? back : [...back, ...feeSplit(debtor, facts, false).owed];
    }
    const steps: LienStep[] = round1.map((l) => ({ op: 'void' as const, id: l.id }));
    if (isEscrow(first)) {
      // The coins moved under round 1 and never move again: whoever received them owes the loss.
      const debtor: LienSide = first === 'release-to-buyer' ? 'buyer' : 'seller';
      // A release paid the 1% from the escrow; a refund paid none, and the appeal completes the trade.
      const fee = feeSplit(debtor, facts, first === 'release-to-buyer');
      steps.push({ op: 'place', round: 2, debtor, cause: 'overturned', amountAtomic: facts.amountAtomic, feeAtomic: fee.inLien }, ...fee.owed);
      return steps;
    }
    // Review L1: the seller already paid under round 1 (its restitution lien `repaid` by the accepted
    // proof), and the appeal overruled the order: the XMR moved like escrow coins, so whoever
    // received it (the creditor) owes it back. g63: an overruled order to pay is no completion, so
    // no 1% goes with it.
    for (const l of liens) {
      if (l.round === 1 && l.cause === 'restitution' && l.status === 'repaid') {
        steps.push({ op: 'place', round: 2, debtor: other(l.debtor), cause: 'overturned', amountAtomic: l.amountAtomic, feeAtomic: 0n });
      }
    }
    const debtor = restitutionDebtor(final);
    if (debtor !== null) {
      const fee = feeSplit(debtor, facts, false);
      steps.push({ op: 'place', round: 2, debtor, cause: 'restitution', amountAtomic: facts.amountAtomic, feeAtomic: fee.inLien }, ...fee.owed);
    }
    return steps;
  }

  // The seller's payment of `seller-sends-xmr` was accepted: a lien for the XMR alone is repaid.
  // One that also carries the unpaid 1% (D-063) stays: paying the buyer did not pay X2F
  // (NEEDS_OWNER_LIEN_FEE_AFTER_COMPLY, see the report).
  if (prev.compliedAt === null && next.compliedAt !== null) {
    return mine
      .filter((l) => l.cause === 'restitution' && l.debtor === 'seller' && l.feeAtomic === 0n)
      .map((l) => ({ op: 'repaid' as const, id: l.id }));
  }

  return [];
}

/** The side a lien is owed to. */
export const lienCreditor = (debtor: LienSide): LienSide => other(debtor);
