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
  /**
   * Review L2/R2: whether liens are switched on (`site_flags.liens_enabled`). While off nothing is
   * placed, and a 1% a lien would have carried (the debtor posted) is owed from future trades
   * instead, once the ruling is final.
   */
  liensOn: boolean;
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
 * trade and the poster pays), split by D-063: in the lien when the debtor is the poster and a lien
 * carries it (`inLienOk`), else owed by the poster from future trades. `paidByEscrow`: a round-1
 * escrow output already carried it. Call it only once the ruling is final (g63), except for the
 * debtor's own fee at a round-1 publish, which the lien carries.
 */
function feeSplit(debtor: LienSide, facts: LienFacts, paidByEscrow: boolean, inLienOk: boolean): { inLien: bigint; owed: LienStep[] } {
  if (paidByEscrow) return { inLien: 0n, owed: [] };
  if (facts.poster === debtor && inLienOk) return { inLien: facts.feeAtomic, owed: [] };
  return { inLien: 0n, owed: [{ op: 'fee-owed', side: facts.poster, amountAtomic: facts.feeAtomic }] };
}

/**
 * Review R2: at round-1 finality (no appeal, or "Decision stands"), whether a stored round-1 lien
 * already carries the debtor-poster's 1%. Read from the stored liens rather than the flag now, so a
 * switch between publish and finality neither loses the fee nor records it twice.
 */
const round1Carries = (liens: readonly LienRef[], debtor: LienSide): boolean =>
  liens.some((l) => l.round === 1 && l.cause === 'restitution' && l.debtor === debtor && l.feeAtomic > 0n && l.status !== 'void');

function checkFacts(f: LienFacts): void {
  if (f.poster !== 'buyer' && f.poster !== 'seller') throw new RangeError('poster must be buyer or seller');
  if (typeof f.amountAtomic !== 'bigint' || f.amountAtomic <= 0n) throw new RangeError('amount must be positive');
  if (typeof f.feeAtomic !== 'bigint' || f.feeAtomic < 0n || f.feeAtomic >= f.amountAtomic) throw new RangeError('fee out of range');
  if (typeof f.liensOn !== 'boolean') throw new RangeError('liensOn must be a boolean');
}

/**
 * Review B1 (lien recovery, 2026-11-16): the sides a trade's dispute rulings can make a lien's
 * creditor, from the outcomes alone, so the moderation service can check a recovery against the
 * rulings its gate verified (staff key taps) without the API's lien rows. `round2`: the appeal's
 * decision, or null. It covers every lien `lienSteps` places (tested against it), and may name a
 * side whose lien a state the gate cannot see (the switch, the seller's compliance) left unplaced:
 * the recovery then still only ever pays that side's own address from the trade.
 */
export function lienCreditorsOf(round1: RulingOutcome, round2: RulingOutcome | null): LienSide[] {
  const out = new Set<LienSide>();
  const restitution = (o: RulingOutcome) => {
    const d = restitutionDebtor(o);
    if (d !== null) out.add(other(d));
  };
  if (round2 === null || round2 === round1) {
    restitution(round1);
  } else if (isEscrow(round1)) {
    // Overturned: whoever received the coins under round 1 owes them back.
    out.add(round1 === 'release-to-buyer' ? 'seller' : 'buyer');
  } else {
    // An overruled order to pay that was paid: the receiver (the creditor of round 1) owes it back.
    const paid = restitutionDebtor(round1);
    if (paid !== null) out.add(paid);
    restitution(round2);
  }
  return [...out].sort();
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
    // Review R2: while off nothing is placed, and the fee waits for finality like any other.
    if (debtor === null || !facts.liensOn) return [];
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
    return feeSplit(debtor, facts, false, round1Carries(liens, debtor)).owed;
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
      return debtor === null ? back : [...back, ...feeSplit(debtor, facts, false, round1Carries(liens, debtor)).owed];
    }
    const steps: LienStep[] = round1.map((l) => ({ op: 'void' as const, id: l.id }));
    if (isEscrow(first)) {
      // The coins moved under round 1 and never move again: whoever received them owes the loss.
      const debtor: LienSide = first === 'release-to-buyer' ? 'buyer' : 'seller';
      // A release paid the 1% from the escrow; a refund paid none, and the appeal completes the trade.
      const fee = feeSplit(debtor, facts, first === 'release-to-buyer', facts.liensOn);
      if (facts.liensOn) steps.push({ op: 'place', round: 2, debtor, cause: 'overturned', amountAtomic: facts.amountAtomic, feeAtomic: fee.inLien });
      steps.push(...fee.owed);
      return steps;
    }
    // Reviews L1 and R1: the seller already paid under round 1 (the dispute's own `compliedAt`, kept
    // through the appeal; never the lien's status, as a lien carrying the seller's own 1% stays
    // active after payment), and the appeal overruled the order: the XMR moved like escrow coins, so
    // whoever received it (the creditor) owes it back. g63: an overruled order to pay is no
    // completion, so no 1% goes with it.
    const paidDebtor = next.afterRefund ? restitutionDebtor(first) : null;
    if (paidDebtor !== null && next.compliedAt !== null && facts.liensOn) {
      steps.push({ op: 'place', round: 2, debtor: other(paidDebtor), cause: 'overturned', amountAtomic: facts.amountAtomic, feeAtomic: 0n });
    }
    const debtor = restitutionDebtor(final);
    if (debtor !== null) {
      const fee = feeSplit(debtor, facts, false, facts.liensOn);
      if (facts.liensOn) steps.push({ op: 'place', round: 2, debtor, cause: 'restitution', amountAtomic: facts.amountAtomic, feeAtomic: fee.inLien });
      steps.push(...fee.owed);
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
