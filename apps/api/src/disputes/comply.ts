import { isTxKey } from '@x2f/escrow';
import { applyDispute, DisputeRuleError, type Dispute } from '@x2f/staff';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { addOwnerAlert } from '../alerts.js';
import { pushOwnerAlert, type OwnerAlertDeps } from '../push/ownerAlert.js';
import { requireSession } from '../auth/sessions.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { appendLog } from '../log/append.js';
import { FINISH_OPEN_TRADES, tradeFor } from '../trades/routes.js';
import { rowToTrade } from '../trades/store.js';
import { roleOf } from '../trades/view.js';
import { disputeSettings } from './settings.js';
import { loadDisputeRecord, withDispute, type DisputeDeps } from './store.js';
import { noTxProofCheck, TX_HASH, TxProofUnavailable, type TxProofCheck, type TxProofResult } from './txProof.js';

/**
 * Plan 4 Task 12, after-refund compliance (A6; was NEEDS_TASK_12_TX_PROOF):
 *
 * - `POST /v1/trades/:code/payment-proof {txHash, txKey}`: the seller of a `seller-sends-xmr` ruling
 *   proves they sent the buyer the trade's XMR. The account owner's sessions only (a backup or held
 *   one too: it only finishes an open dispute). Accepted only while that ruling is in force, the
 *   seller's payment is still owed (`compliedAt` null) and strictly before `complyBy` (submitted at
 *   or after it: 409 `too-late`; the case has gone to a senior moderator, below).
 *   The proof is checked on X2F's own node (`TxProofCheck`, disputes/txProof.ts) against the
 *   trade's own record: the destination is the trade's buyer payout address and the amount the
 *   trade's XMR (`amount_atomic`, the amount the ruling's taps bind), never anything the seller
 *   sends. Refused 409 `proof-invalid` when the key does not fit the tx, the tx is unknown, or the
 *   address received less than the amount (a wrong address receives nothing).
 *   A replay is refused 409 `proof-replayed`: a tx already submitted for any dispute (accepted,
 *   waiting or refused), a tx X2F recorded as a trade's settlement, or a tx in a block older than
 *   this dispute's opening (it cannot be the payment the dispute is about: a past release to the
 *   same buyer address, whose key the seller may hold, for one). With 10 confirmations or more it
 *   is accepted at once: `complied` (by the system), logged `dispute.complied`, which also repays
 *   the restitution lien in the same transaction (lien.ts). With fewer it waits (202
 *   `pending-confirmations`) and the dispute timer checks it again (`runPendingProofs`). One live
 *   proof per dispute: another while one waits is 409 `proof-pending`.
 * - A6, the escalation (`runComplyLapses`, on the dispute timer): once `complyBy` passes with no proof
 *   accepted or waiting, the dispute is marked (`disputes.comply_lapsed_at`), logged
 *   `dispute.comply-lapsed` and the owner is alerted (`dispute-comply-lapsed`, in-app and pushed to
 *   the phone by the dispute timer); the restitution lien
 *   stays in force, and the case is listed in the staff queue for senior moderators and the owner,
 *   who decide the suspension (Task 27's ban stages: NEEDS_BANS_MERGE, not on this branch; a
 *   moderator's freeze for an ignored ruling is staffRoutes.ts `freezeAllowed`). The buyer can still
 *   appeal "They paid too little or nothing" within the window (Task 24).
 */

/** Plan 4 Task 12: a proof is accepted at this many confirmations. */
export const COMPLY_CONFIRMATIONS = 10;
/** A waiting proof is checked again at most this often. */
export const PROOF_RECHECK_MS = 2 * 60_000;
/**
 * A waiting tx the node no longer knows is refused only once it has been unknown this long without a
 * break, counted from the first check that missed it (`lost_since`; review m1), not from submission:
 * a node restart that loses a tx late must not refuse a payment that is mined later.
 */
export const PROOF_LOST_AFTER_MS = 24 * 3_600_000;

type Verdict = 'invalid' | 'replayed' | 'pending' | 'accepted';

/** What a check shows, against the trade's amount and the dispute's opening. */
export function judgeProof(r: TxProofResult | null, amountAtomic: bigint, openedAt: Date): Verdict {
  if (r === null || r.good !== true || r.receivedAtomic < amountAtomic) return 'invalid';
  if (r.blockTimestamp !== null && r.blockTimestamp.getTime() < openedAt.getTime()) return 'replayed';
  if (r.confirmations < COMPLY_CONFIRMATIONS || r.blockTimestamp === null) return 'pending';
  return 'accepted';
}

/**
 * Whether the dispute takes a proof submitted at `at`: a `seller-sends-xmr` ruling in force that the
 * seller has not met, and `at` strictly before `complyBy`. The machine's own `complied` rule decides
 * the state (it throws `wrong-state` otherwise); the deadline is this route's.
 */
function assertTakesProof(d: Dispute, at: Date): void {
  const S = { appealWindowH: 48, firstResponseH: 4 };
  // A dry run of the system's `complied` on the current state: refused here exactly when it would be.
  applyDispute(d, { type: 'complied' }, { kind: 'system' }, at, S);
  if (d.complyBy === null) throw new DisputeRuleError('wrong-state');
  if (at.getTime() >= d.complyBy.getTime()) throw new DisputeRuleError('too-late');
}

const toApi = (err: unknown): never => {
  if (err instanceof DisputeRuleError) throw new ApiError(409, err.code === 'too-late' ? 'too-late' : 'wrong-state');
  if (err instanceof TxProofUnavailable) throw new ApiError(503, 'node-unavailable');
  throw err;
};

/** A tx hash already used: submitted for any dispute, or a trade's settlement tx. */
async function txUsed(q: Queryable, txHash: string): Promise<boolean> {
  const { rows } = await q.query<{ used: boolean }>(
    `select exists (select 1 from ruling_payments where tx_hash = $1) or exists (select 1 from trades where tx_hash = $1) as used`,
    [txHash],
  );
  return rows[0]?.used === true;
}

function bodyOf(req: FastifyRequest): { txHash: string; txKey: string } {
  const b = req.body;
  if (b === null || typeof b !== 'object' || Array.isArray(b)) throw new ApiError(400, 'bad-request');
  const o = b as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length !== 2 || !keys.includes('txHash') || !keys.includes('txKey')) throw new ApiError(400, 'bad-request');
  const { txHash, txKey } = o;
  if (typeof txHash !== 'string' || !TX_HASH.test(txHash)) throw new ApiError(400, 'bad-request');
  if (typeof txKey !== 'string' || !isTxKey(txKey)) throw new ApiError(400, 'bad-request');
  return { txHash, txKey };
}

/** Applies `complied` and logs it, in the dispute's own transaction (lien.ts repays the lien after). */
async function comply(client: pg.PoolClient, d: Dispute, txHash: string, now: Date): Promise<Dispute> {
  const next = applyDispute(d, { type: 'complied' }, { kind: 'system' }, now, await disputeSettings(client));
  await appendLog(client, { at: now, actor: { kind: 'system' }, tradeCode: d.code, action: 'dispute.complied', detail: { txHash } });
  return next;
}

export interface PaymentProofAnswer {
  status: 'accepted' | 'pending-confirmations';
  confirmations: number;
}

export function complyRoutes(app: FastifyInstance): void {
  const owner = requireSession({ ...FINISH_OPEN_TRADES });
  // Review m4: a per-account budget (429 slow-down), after the session check and before the node is asked.
  const budget = async (req: FastifyRequest) => req.server.budgets.paymentProof.take(req.auth.accountId);

  app.post('/v1/trades/:code/payment-proof', { preHandler: [owner, budget] }, async (req, reply): Promise<PaymentProofAnswer> => {
    const { txHash, txKey } = bodyOf(req);
    const row = await tradeFor(req);
    const side = roleOf(rowToTrade(row), req.auth.accountId);
    if (side === null) throw new ApiError(404, 'not-found');
    if (side !== 'seller') throw new ApiError(403, 'wrong-party');
    const deps = req.server.deps;
    // The submission's time: the deadline is judged on it, before the node is asked.
    const submittedAt = deps.clock();
    const rec = await loadDisputeRecord(deps.db, row.code);
    if (rec === null) throw new ApiError(404, 'not-found');
    try {
      assertTakesProof(rec.dispute, submittedAt);
    } catch (err) {
      toApi(err);
    }
    if (await txUsed(deps.db, txHash)) throw new ApiError(409, 'proof-replayed');
    const address = row.buyer_payout;
    if (address === null) throw new ApiError(409, 'wrong-state');
    const amount = BigInt(row.amount_atomic);
    let result: TxProofResult | null = null;
    try {
      result = await (deps.txProof ?? noTxProofCheck)({ txHash, txKey, address });
    } catch (err) {
      // RC-4 (lead default): a proof sent in time that the checker could not take is recorded for the
      // senior's case view; complyBy does not move.
      const reason = err instanceof TxProofUnavailable ? 'node-unavailable' : err instanceof ApiError && err.status === 503 && err.code === 'busy' ? 'busy' : null;
      if (reason !== null) {
        await deps.db
          .query('insert into ruling_payment_attempts (code, seq, at, reason) values ($1, $2, $3, $4)', [row.code, rec.dispute.seq, submittedAt, reason])
          .catch(() => undefined);
      }
      toApi(err);
    }
    const verdict = judgeProof(result, amount, rec.dispute.openedAt);
    if (verdict === 'invalid') throw new ApiError(409, 'proof-invalid');
    if (verdict === 'replayed') throw new ApiError(409, 'proof-replayed');
    const confirmations = result!.confirmations;
    try {
      await withDispute({ db: deps.db, clock: deps.clock, events: req.server.events }, { code: row.code, seq: rec.dispute.seq }, async (d, client, now) => {
        assertTakesProof(d, submittedAt);
        const ins = await client.query(
          `insert into ruling_payments (tx_hash, code, seq, tx_key, status, submitted_at, checked_at, received_atomic, confirmations, decided_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) on conflict do nothing`,
          [txHash, d.code, d.seq, verdict === 'pending' ? txKey : null, verdict, submittedAt, now, result!.receivedAtomic.toString(), confirmations,
            verdict === 'accepted' ? now : null],
        );
        if (ins.rowCount !== 1) {
          throw new ApiError(409, (await txUsed(client, txHash)) ? 'proof-replayed' : 'proof-pending');
        }
        if (verdict === 'accepted') return comply(client, d, txHash, now);
        await appendLog(client, { at: now, actor: { kind: 'trader', side: 'seller' }, tradeCode: d.code, action: 'dispute.proof-pending', detail: { txHash } });
        return d;
      });
    } catch (err) {
      toApi(err);
    }
    if (verdict === 'pending') reply.code(202);
    return { status: verdict === 'accepted' ? 'accepted' : 'pending-confirmations', confirmations };
  });
}

interface PendingRow {
  tx_hash: string;
  code: string;
  seq: number;
  tx_key: string;
  submitted_at: Date;
}

/**
 * The dispute timer's re-check of waiting proofs, each checked at most every PROOF_RECHECK_MS: at
 * COMPLY_CONFIRMATIONS it is accepted (`complied`) though `complyBy` may have passed since (it was
 * submitted in time); a tx whose check now fails, or that the node has not known for
 * PROOF_LOST_AFTER_MS since a check first missed it, is refused (`dispute.proof-refused`) and the seller may submit another.
 * A node that cannot be asked leaves it waiting. Returns the number of disputes changed.
 */
export async function runPendingProofs(deps: DisputeDeps & { txProof?: TxProofCheck }, failures: unknown[]): Promise<number> {
  const check = deps.txProof;
  if (check === undefined) return 0;
  const now = deps.clock();
  const { rows } = await deps.db.query<PendingRow>(
    `select p.tx_hash, p.code, p.seq, p.tx_key, p.submitted_at from ruling_payments p
      where p.status = 'pending' and p.checked_at <= $1 order by p.checked_at limit 50`,
    [new Date(now.getTime() - PROOF_RECHECK_MS)],
  );
  let n = 0;
  for (const p of rows) {
    try {
      const t = (await deps.db.query<{ buyer_payout: string | null; amount_atomic: string }>(
        'select buyer_payout, amount_atomic::text from trades where code = $1',
        [p.code],
      )).rows[0];
      if (!t || t.buyer_payout === null) continue;
      let result: TxProofResult | null;
      try {
        result = await check({ txHash: p.tx_hash, txKey: p.tx_key, address: t.buyer_payout });
      } catch (err) {
        if (err instanceof TxProofUnavailable) continue;
        throw err;
      }
      let accepted = false;
      await withDispute(deps, { code: p.code, seq: p.seq }, async (d, client, at) => {
        const live = await client.query<{ lost_since: Date | null }>('select lost_since from ruling_payments where tx_hash = $1 and status = $2 for update', [p.tx_hash, 'pending']);
        if ((live.rowCount ?? 0) === 0) return d;
        let verdict = judgeProof(result, BigInt(t.amount_atomic), d.openedAt);
        // Unknown to the node now: refused only once it has been lost for PROOF_LOST_AFTER_MS without
        // a break, from the first check that missed it (review m1). Known again: the clock resets.
        const lostSince = result === null ? (live.rows[0]!.lost_since ?? at) : null;
        if (lostSince !== null && at.getTime() - lostSince.getTime() < PROOF_LOST_AFTER_MS) verdict = 'pending';
        if (verdict === 'accepted') {
          let next: Dispute;
          try {
            next = applyDispute(d, { type: 'complied' }, { kind: 'system' }, at, await disputeSettings(client));
          } catch (err) {
            if (!(err instanceof DisputeRuleError)) throw err;
            // The ruling that ordered the payment is no longer in force (overruled, or settled otherwise).
            verdict = 'invalid';
            next = d;
          }
          if (verdict === 'accepted') {
            await client.query(
              `update ruling_payments set status = 'accepted', tx_key = null, decided_at = $2, checked_at = $2, received_atomic = $3, confirmations = $4 where tx_hash = $1`,
              [p.tx_hash, at, result!.receivedAtomic.toString(), result!.confirmations],
            );
            await appendLog(client, { at, actor: { kind: 'system' }, tradeCode: d.code, action: 'dispute.complied', detail: { txHash: p.tx_hash } });
            accepted = true;
            return next;
          }
        }
        if (verdict === 'pending') {
          await client.query('update ruling_payments set checked_at = $2, confirmations = $3, lost_since = $4 where tx_hash = $1', [p.tx_hash, at, result?.confirmations ?? null, lostSince]);
          return d;
        }
        await client.query(`update ruling_payments set status = 'refused', tx_key = null, decided_at = $2, checked_at = $2 where tx_hash = $1`, [p.tx_hash, at]);
        await appendLog(client, { at, actor: { kind: 'system' }, tradeCode: d.code, action: 'dispute.proof-refused', detail: { txHash: p.tx_hash } });
        return d;
      });
      if (accepted) n++;
    } catch (err) {
      if (!(err instanceof DisputeRuleError)) failures.push(err);
    }
  }
  return n;
}

/**
 * A6, on the dispute timer: a `seller-sends-xmr` ruling whose `complyBy` has passed with no proof
 * accepted and none waiting (one submitted in time is still being confirmed) goes to a senior
 * moderator or the owner: marked once per `complyBy` (a round-2 "Decision stands" sets a new one),
 * logged `dispute.comply-lapsed`, the owner alerted. Not while maintenance pauses the dispute
 * (its deadlines move, A7) or an appeal is pending. Returns the number of disputes marked.
 */
export async function runComplyLapses(deps: DisputeDeps, failures: unknown[]): Promise<number> {
  const now = deps.clock();
  const { rows } = await deps.db.query<{ code: string; seq: number }>(
    `select d.code, d.seq from disputes d
      where d.after_refund and d.status in ('published', 'complying') and d.complied_at is null
        and d.comply_by is not null and d.comply_by <= $1 and d.paused_since is null
        and (d.comply_lapsed_at is null or d.comply_lapsed_at < d.comply_by)
        and not exists (select 1 from ruling_payments p where p.code = d.code and p.seq = d.seq and p.status = 'pending')`,
    [now],
  );
  let n = 0;
  for (const p of rows) {
    try {
      await withDispute(deps, p, async (d, client, at) => {
        if (d.complyBy === null || d.compliedAt !== null || at.getTime() < d.complyBy.getTime()) return d;
        if (d.status !== 'published' && d.status !== 'complying') return d;
        if (d.ruling?.outcome !== 'seller-sends-xmr') return d;
        const fresh = await client.query(
          `update disputes set comply_lapsed_at = $3 where code = $1 and seq = $2 and (comply_lapsed_at is null or comply_lapsed_at < comply_by)
             and not exists (select 1 from ruling_payments x where x.code = $1 and x.seq = $2 and x.status = 'pending')`,
          [d.code, d.seq, at],
        );
        if ((fresh.rowCount ?? 0) === 0) return d;
        await addOwnerAlert(client, 'dispute-comply-lapsed', { trade: d.code, seq: d.seq }, at);
        await appendLog(client, { at, actor: { kind: 'system' }, tradeCode: d.code, action: 'dispute.comply-lapsed', detail: { seq: d.seq } });
        n++;
        return d;
      });
    } catch (err) {
      if (!(err instanceof DisputeRuleError)) failures.push(err);
    }
  }
  return n;
}

/** SQL over `disputes d`: the seller let the ruling's comply time pass (A6), and still owes it. */
export const COMPLY_LAPSED_SQL = `(d.comply_lapsed_at is not null and d.comply_by is not null and d.comply_lapsed_at >= d.comply_by
  and d.complied_at is null and d.status in ('published', 'complying'))`;

/** What the staff case view shows of the seller's compliance (A6): the latest proof, and the lapse. */
export interface ComplianceView {
  /** Set once the comply time passed with no proof (for the current `complyBy`). */
  lapsedAt: string | null;
  proof: { txHash: string; status: 'pending' | 'accepted' | 'refused'; confirmations: number | null; submittedAt: string } | null;
  /** RC-4: proofs the checker could not take (503), newest first, at most FAILED_CHECKS_SHOWN. */
  failedChecks: Array<{ at: string; reason: 'node-unavailable' | 'busy' }>;
}

/** How many failed checks the case view lists. */
export const FAILED_CHECKS_SHOWN = 10;

export async function complianceOf(q: Queryable, d: Pick<Dispute, 'code' | 'seq' | 'complyBy'>): Promise<ComplianceView> {
  const lapsed = (await q.query<{ at: Date | null }>('select comply_lapsed_at as at from disputes where code = $1 and seq = $2', [d.code, d.seq])).rows[0]?.at ?? null;
  const { rows } = await q.query<{ tx_hash: string; status: 'pending' | 'accepted' | 'refused'; confirmations: number | null; submitted_at: Date }>(
    'select tx_hash, status, confirmations, submitted_at from ruling_payments where code = $1 and seq = $2 order by submitted_at desc, tx_hash limit 1',
    [d.code, d.seq],
  );
  const p = rows[0];
  const failed = await q.query<{ at: Date; reason: 'node-unavailable' | 'busy' }>(
    'select at, reason from ruling_payment_attempts where code = $1 and seq = $2 order by at desc limit $3',
    [d.code, d.seq, FAILED_CHECKS_SHOWN],
  );
  return {
    failedChecks: failed.rows.map((r) => ({ at: r.at.toISOString(), reason: r.reason })),
    lapsedAt: lapsed !== null && d.complyBy !== null && lapsed.getTime() >= d.complyBy.getTime() ? lapsed.toISOString() : null,
    proof: p ? { txHash: p.tx_hash, status: p.status, confirmations: p.confirmations, submittedAt: p.submitted_at.toISOString() } : null,
  };
}

/**
 * Re-review m3 follow-up: the `onStuck` sink main.ts hands the proof checker. The owner alert
 * `tx-proof-check-stuck` in-app, then the fixed phone push. Best effort: it never throws.
 */
export function txProofStuckAlert(deps: OwnerAlertDeps): () => Promise<void> {
  return async () => {
    try {
      await addOwnerAlert(deps.db, 'tx-proof-check-stuck', {}, deps.clock());
      await pushOwnerAlert(deps, 'tx-proof-check-stuck');
    } catch {
      // nothing more to do: the checker answers 503 meanwhile
    }
  };
}
