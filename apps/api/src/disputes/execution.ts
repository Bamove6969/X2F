import { applyDispute, DisputeRuleError, ESCROW_OUTCOMES, type Dispute } from '@x2f/staff';
import type { RulingKind } from '@x2f/trade';
import type pg from 'pg';
import { appendLog } from '../log/append.js';
import { applyLienRules } from './lien.js';
import { disputeSettings } from './settings.js';
import { loadDisputeRecord, saveDispute } from './store.js';

/**
 * Plan 4 Task 14 (R-M2): records a round-1 ruling's payout, in the transaction that applies the
 * watcher's `settled` report to the disputed trade (`applyEvent`'s `within`, the trade row already
 * locked, so the order is trade then dispute, as `withDispute`'s callers keep it).
 *
 * The ruling that paid is round 1's, also once an appeal made round 2 current (Note 2026-10-30 M3:
 * round 1 executes once and round 2 never moves coins). It must be published, not after a refund,
 * an escrow outcome, and pay exactly the reported kind: `release-to-buyer` is `dispute-buyer` (the
 * buyer first, then the fee), `refund-to-seller` is `dispute-seller` (everything back to the seller).
 * Anything else: `settle-kind-unknown` (no escrow payout to record) or `settle-kind-changed` (the
 * report contradicts the ruling); the caller refuses the report and nothing is written.
 *
 * Then the dispute machine's `executed` (closed at once when the case is already final, else when
 * its appeal window ends, `resolveFinal`), its lien rules, and `ruling.executed {rulingId, txHash}`
 * appended last (appendLog's rule: only the trade's own entry and the commit follow it).
 */
export async function recordRulingExecution(
  client: pg.PoolClient,
  code: string,
  kind: RulingKind,
  txHash: string,
  now: Date,
): Promise<'ok' | 'settle-kind-unknown' | 'settle-kind-changed'> {
  const rec = await loadDisputeRecord(client, code, { lock: true });
  if (rec === null) return 'settle-kind-unknown';
  const d: Dispute = rec.dispute;
  const paid = d.round === 1 ? d.ruling : d.round1;
  if (paid === null || d.afterRefund || d.publishedAt === null || !(ESCROW_OUTCOMES as readonly string[]).includes(paid.outcome)) return 'settle-kind-unknown';
  const expected: RulingKind = paid.outcome === 'release-to-buyer' ? 'dispute-buyer' : 'dispute-seller';
  if (kind !== expected) return 'settle-kind-changed';
  // As withDispute (J-06 review L5): the parties' account rows, then this dispute's liens, before anything is logged.
  await client.query(
    `select 1 from accounts where id in (select seller_account_id from trades where code = $1 union select buyer_account_id from trades where code = $1)
      order by id for key share`,
    [code],
  );
  await client.query('select 1 from liens where from_code = $1 and dispute_seq = $2 order by id for update', [d.code, d.seq]);
  let next: Dispute;
  try {
    next = applyDispute(d, { type: 'executed' }, { kind: 'system' }, now, await disputeSettings(client));
  } catch (e) {
    // Executed already (another tx for the same escrow would be refused by the trade first), or closed.
    if (e instanceof DisputeRuleError) return 'settle-kind-unknown';
    throw e;
  }
  await applyLienRules(client, d, next, now);
  await saveDispute(client, next, now);
  await appendLog(client, { at: now, actor: { kind: 'system' }, tradeCode: code, action: 'ruling.executed', detail: { rulingId: paid.id, txHash } });
  return 'ok';
}
