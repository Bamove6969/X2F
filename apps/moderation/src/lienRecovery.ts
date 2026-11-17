import { normalizeTradeCode } from '@x2f/core';
import { lienCreditorsOf, type LienSide } from '@x2f/staff';
import { buyerProceeds, escrowPlan, lienRecoveryCap, type AttestedTerms } from '@x2f/trade';
import type pg from 'pg';
import { gateCheck, recordedTerms, type GateContext, type GateStore, type RecordedTerms } from './gate/index.js';
import type { RulingSource } from './execute.js';
import { fromJson } from './shadow.js';

/**
 * Lien recovery, review B1 (security, 2026-11-16; docs/lien-recovery.md). Under the threat model
 * of the reviews (the API and its database compromised; gate.bin, the MOD_* secrets and honest
 * staff keys not), the moderation service no longer signs whatever `lienRecovery` the API hands
 * it. It signs one only when its own records back it:
 *
 * 1. the work item names the recovery's source (`lienSource`: the disputed trade and the
 *    creditor's side in it), and that trade is one this service attested (`signed_terms`);
 * 2. the rulings of that trade's dispute, as this service's gate verifies them (staff key taps
 *    rooted in the owner's pinned keys, never the API's rows), make that side a lien's creditor
 *    (`lienCreditorsOf`);
 * 3. the recovery pays that side's own address from the source trade's signed terms, and none of
 *    this trade's own or the fee wallet;
 * 4. it is at most `lienRecoveryCap` of the buyer's proceeds (half, never leaving the buyer under
 *    the network fee: review B3); a rate above half needs a gate-verified rate change
 *    (NEEDS_GATE_LIEN_RATE);
 * 5. with every recovery it signed for the same source and has not seen end without paying, it is
 *    at most the source trade's XMR (`mod_lien_recoveries`, rule 2).
 *
 * What a compromised API can still do (owner question, docs/lien-recovery.md): attach a real lien
 * to a buyer who is not its debtor. The money then still goes only to the real creditor's own
 * address, within the lien's total; the buyer's device shows the deduction only once the lien
 * notice is designed (NEEDS_DESIGN_LIEN_NOTICE).
 *
 * A refusal is never final (the traders did nothing wrong): the work is logged
 * (`lien-refused-<reason>`) and skipped, like malformed terms.
 */
export type LienRefusal =
  | 'no-source'
  | 'bad-source'
  | 'no-authority'
  | 'source-unknown'
  | 'wrong-address'
  | 'not-creditor'
  | 'over-rate'
  | 'over-owed';

export class LienRefused extends Error {
  constructor(readonly reason: LienRefusal) {
    super(`lien-refused-${reason}`);
    this.name = 'LienRefused';
  }
}

/** The work item's claim of where its recovery comes from (apps/api internal/routes.ts). */
export interface LienSource {
  fromCode: string;
  creditor: LienSide;
}

/** The creditor sides of a trade's dispute rulings, each verified by the gate; null when none verifies (or there is no gate). */
export interface LienRulings {
  creditors(code: string, recorded: RecordedTerms): Promise<readonly LienSide[] | null>;
}

/** A recovery this service may sign, to be recorded with the attestation (`recordLienRecovery`). */
export interface CheckedRecovery {
  source: string;
  creditor: LienSide;
  amountAtomic: bigint;
  /** The source trade's XMR, as the gate verified the rulings against it: the lien's most. */
  owedAtomic: bigint;
}

export interface LienCheckDeps {
  db: Pick<pg.Pool, 'query'>;
  feeWallet: string;
  rulings: LienRulings | null;
}

/** The source trade's terms as this service signed and posted them, and its recorded terms (its own shadow trade when it has one). */
async function sourceFacts(db: Pick<pg.Pool, 'query'>, code: string, feeWallet: string): Promise<{ terms: AttestedTerms; recorded: RecordedTerms } | null> {
  const { rows } = await db.query<{ attestation: { terms?: AttestedTerms } }>('select attestation from signed_terms where trade = $1 and posted_at is not null', [code]);
  const terms = rows[0]?.attestation.terms;
  if (terms === undefined) return null;
  // The trade as this service's own desk saw it (it may have grown since take), else the attested deal.
  const desk = await db.query<{ record: unknown }>('select record from mod_trade_desk where trade = $1', [code]);
  type Shadow = { amountAtomic?: unknown; feeAtomic?: unknown; sellerFundsAtomic?: unknown; poster?: unknown };
  const shadowOf = (record: unknown): Shadow | null => {
    try {
      return (fromJson(record) as { shadow?: Shadow | null }).shadow ?? null;
    } catch {
      return null;
    }
  };
  const shadow = desk.rows[0] === undefined ? null : shadowOf(desk.rows[0].record);
  let trade: { amountAtomic: bigint; feeAtomic: bigint; sellerFundsAtomic: bigint; poster: 'buyer' | 'seller' };
  if (
    shadow !== null && typeof shadow.amountAtomic === 'bigint' && typeof shadow.feeAtomic === 'bigint' && typeof shadow.sellerFundsAtomic === 'bigint' &&
    (shadow.poster === 'buyer' || shadow.poster === 'seller')
  ) {
    trade = { amountAtomic: shadow.amountAtomic, feeAtomic: shadow.feeAtomic, sellerFundsAtomic: shadow.sellerFundsAtomic, poster: shadow.poster };
  } else {
    const take = BigInt(terms.deal.takeAmountAtomic);
    const plan = escrowPlan({ amountAtomic: take, poster: terms.deal.poster });
    trade = { amountAtomic: take, feeAtomic: plan.feeAtomic, sellerFundsAtomic: plan.sellerFundsAtomic, poster: terms.deal.poster };
  }
  try {
    return { terms, recorded: recordedTerms({ terms, trade, feeWallet }) };
  } catch {
    return null;
  }
}

/**
 * Checks the work item's recovery (rules 1 to 4 above) against this service's own records. Null
 * when the terms carry none (and the item names no source); throws LienRefused otherwise.
 */
export async function checkLienRecovery(w: { trade: string; terms: AttestedTerms; lienSource?: unknown }, d: LienCheckDeps): Promise<CheckedRecovery | null> {
  const rec = w.terms.lienRecovery;
  const src = w.lienSource;
  if (rec === undefined) {
    if (src !== undefined) throw new LienRefused('bad-source');
    return null;
  }
  if (src === undefined || src === null) throw new LienRefused('no-source');
  if (typeof src !== 'object' || Array.isArray(src)) throw new LienRefused('bad-source');
  const s = src as Record<string, unknown>;
  const keys = Object.keys(s).sort();
  const fromCode = typeof s.fromCode === 'string' ? normalizeTradeCode(s.fromCode) : null;
  const creditor = s.creditor;
  if (keys.join(',') !== 'creditor,fromCode' || fromCode === null || (creditor !== 'buyer' && creditor !== 'seller')) throw new LienRefused('bad-source');
  if (fromCode === normalizeTradeCode(w.trade)) throw new LienRefused('bad-source');
  const amount = BigInt(rec.amountAtomic);
  if (amount <= 0n || amount > lienRecoveryCap(buyerProceeds(w.terms.deal))) throw new LienRefused('over-rate');
  if (d.rulings === null) throw new LienRefused('no-authority');
  const facts = await sourceFacts(d.db, fromCode, d.feeWallet);
  if (facts === null) throw new LienRefused('source-unknown');
  const creditorAddress = creditor === 'buyer' ? facts.terms.buyerPayout : facts.terms.sellerRefund;
  if (rec.address !== creditorAddress || rec.address === w.terms.buyerPayout || rec.address === w.terms.sellerRefund || rec.address === d.feeWallet) {
    throw new LienRefused('wrong-address');
  }
  const sides = await d.rulings.creditors(fromCode, facts.recorded);
  if (sides === null) throw new LienRefused('no-authority');
  if (!sides.includes(creditor)) throw new LienRefused('not-creditor');
  return { source: fromCode, creditor, amountAtomic: amount, owedAtomic: facts.recorded.amountAtomic };
}

/**
 * Rule 5, inside the transaction that stores the attestation: with every recovery signed for the
 * same source and not freed, at most the source's XMR. Serialised per source (advisory lock).
 * Throws LienRefused('over-owed'), and the caller rolls back.
 */
export async function recordLienRecovery(c: pg.PoolClient, trade: string, r: CheckedRecovery): Promise<void> {
  await c.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`x2f-lien:${r.source}:${r.creditor}`]);
  const { rows } = await c.query<{ s: string }>(
    'select coalesce(sum(amount_atomic), 0)::text as s from mod_lien_recoveries where source_code = $1 and creditor = $2 and freed_at is null and trade <> $3',
    [r.source, r.creditor, trade],
  );
  if (BigInt(rows[0]!.s) + r.amountAtomic > r.owedAtomic) throw new LienRefused('over-owed');
  await c.query(
    'insert into mod_lien_recoveries (trade, source_code, creditor, amount_atomic) values ($1, $2, $3, $4) on conflict (trade) do nothing',
    [trade, r.source, r.creditor, r.amountAtomic.toString()],
  );
}

/** The watcher saw `trade` end without paying its recovery: it no longer counts against its lien. */
export async function freeLienRecoveries(db: Pick<pg.Pool, 'query'>, trade: string): Promise<void> {
  await db.query('update mod_lien_recoveries set freed_at = now() where trade = $1 and freed_at is null', [trade]);
}

/**
 * The gate-backed LienRulings: the source trade's round-1 ruling (and its appeal's, if published)
 * as the API stores them, each checked by the gate with its stored taps (`gateCheck` with
 * `verifyOnly`: nothing is settled or co-signed), then `lienCreditorsOf`. Any ruling that does not
 * verify: null.
 */
export function lienRulingVerifier(o: { store: GateStore; source: Pick<RulingSource, 'storedRulings' | 'rulingTaps' | 'ownerKeys' | 'usedTaps' | 'credential' | 'invite' | 'staff'>; ctx: GateContext }): LienRulings {
  return {
    async creditors(code, recorded) {
      const stored = await o.source.storedRulings(code);
      const r1 = stored.current?.round === 1 ? stored.current : stored.round1;
      if (r1 === null) return null;
      const a1 = await gateCheck(o.store, o.source, { ruling: r1, recorded, balanceAtomic: 0n, verifyOnly: true }, o.ctx);
      if (!a1.ok) return null;
      let r2 = null;
      if (stored.current !== null && stored.current.round === 2) {
        const a2 = await gateCheck(o.store, o.source, { ruling: stored.current, recorded, balanceAtomic: 0n, involved: stored.involved, verifyOnly: true }, o.ctx);
        if (!a2.ok) return null;
        r2 = stored.current.outcome;
      }
      return lienCreditorsOf(r1.outcome, r2);
    },
  };
}
