import type pg from 'pg';
import { addOwnerAlert } from '../alerts.js';
import { withTx } from '../auth/liveSession.js';
import { appendLog } from '../log/append.js';
import { pushOwnerAlert } from '../push/ownerAlert.js';
import type { PushKind } from '../push/send.js';
import { PayrollWalletRefused, type PayrollWallet } from './payrollWallet.js';

/**
 * Owner, 26 Nov 2026: the hot payroll wallet pays staff automatically at clock-out. The clock-out
 * (`pay.ts` `clockOut`) records the payout `waiting-send` in its own transaction; this pass sends
 * each one, oldest first, in three steps so the wallet is never asked inside an open transaction
 * (the fee sweep's pattern, migration 840):
 * 1. one transaction locks the payout, re-checks its address (security review 12 Nov M2: the
 *    address is still live and is exactly the one its `payout-address` tap approved, a tap by the
 *    payout's own member) and records the attempt `pending`; a payout whose address fails the check
 *    is settled `failed` (attempt `blocked`) and nothing is sent;
 * 2. the wallet sends exactly `amount_atomic` to that address, the network fee on top;
 * 3. a second transaction settles the attempt: `sent` (the payout too, with the tx hash; `pay.sent`
 *    logged), `refused` (the wallet answered an error, so nothing went out: the payout waits and a
 *    later pass tries again; the owner is told once per payout) or `unknown` (no answer: the payout
 *    is never sent again by itself; the owner checks the wallet).
 * The pass stops at the first refusal (a low balance refuses every later one too). One pass at a
 * time on the site (a session advisory lock); a `pending` attempt found when a pass starts was left
 * by a process that died mid-send, so it is settled `unknown` (the owner is told).
 */

export interface PayrollSendDeps {
  db: pg.Pool;
  clock: () => Date;
  wallet: PayrollWallet;
  /** The owner's phone push (`app.push`); the in-app alerts are written either way. */
  push?: { send(accountId: string, kind: PushKind): Promise<boolean> };
  /** At most this many payouts per pass (default 20). */
  limit?: number;
}

export type PayoutSendOutcome = 'sent' | 'refused' | 'unknown' | 'blocked';
export interface PayrollPassResult {
  outcome: 'busy' | 'done';
  sends: Array<{ payoutId: string; outcome: PayoutSendOutcome }>;
}

const LOCK_KEY = 'x2f-payroll-send';
const HEX64 = /^[0-9a-f]{64}$/;

interface Due {
  id: string;
  staff_id: string;
  amount_atomic: string;
  address: string;
  removed_at: Date | null;
  tap_account: string | null;
  tap_used: boolean;
  tap_intent: string | null;
}

/** Security review 12 Nov M2: the address is live, and its tap was the payout's own member's, used, for exactly it. */
export function addressStillApproved(d: Pick<Due, 'staff_id' | 'address' | 'removed_at' | 'tap_account' | 'tap_used' | 'tap_intent'>): boolean {
  if (d.removed_at !== null || d.tap_account === null || d.tap_account !== d.staff_id || !d.tap_used || d.tap_intent === null) return false;
  let intent: unknown;
  try {
    intent = JSON.parse(d.tap_intent);
  } catch {
    return false;
  }
  if (intent === null || typeof intent !== 'object' || Array.isArray(intent)) return false;
  const i = intent as Record<string, unknown>;
  return i.kind === 'payout-address' && i.address === d.address;
}

/** One pass over the payouts waiting to be sent. Never throws for a single payout's send. */
export async function runPayrollPayouts(d: PayrollSendDeps): Promise<PayrollPassResult> {
  const client = await d.db.connect();
  let locked = false;
  const sends: PayrollPassResult['sends'] = [];
  try {
    locked = (await client.query<{ ok: boolean }>('select pg_try_advisory_lock(hashtext($1)) as ok', [LOCK_KEY])).rows[0]?.ok === true;
    if (!locked) return { outcome: 'busy', sends };

    // Attempts left `pending` by a process that died mid-send: their result is unknown.
    const orphans = await withTx(d.db, async (c) => {
      const { rows } = await c.query<{ payout_id: string; amount_atomic: string }>(
        `update staff_payout_sends s set outcome = 'unknown', settled_at = $1
           from staff_payouts p where s.outcome = 'pending' and p.id = s.payout_id
         returning s.payout_id::text, p.amount_atomic::text`,
        [d.clock()],
      );
      for (const r of rows) {
        // COPY-UNSIGNED: the owner's alert texts.
        await addOwnerAlert(c, 'payroll-send-unknown', { payoutId: r.payout_id, amountAtomic: r.amount_atomic, message: 'A staff payout may or may not have been sent: check the payroll wallet' }, d.clock());
      }
      return rows.length;
    });
    if (orphans > 0) await bestEffortPush(d, 'payroll-send-unknown');

    const { rows: due } = await client.query<{ id: string }>(
      `select p.id::text from staff_payouts p
        where p.status = 'waiting-send'
          and not exists (select 1 from staff_payout_sends s where s.payout_id = p.id and s.outcome <> 'refused')
        order by p.at, p.id limit $1`,
      [d.limit ?? 20],
    );
    for (const { id } of due) {
      const outcome = await sendOne(d, id);
      if (outcome === null) continue;
      sends.push({ payoutId: id, outcome });
      if (outcome === 'refused' || outcome === 'unknown') break;
    }
    return { outcome: 'done', sends };
  } finally {
    let unlockError: Error | undefined;
    if (locked) {
      await client.query('select pg_advisory_unlock(hashtext($1))', [LOCK_KEY]).catch((e: unknown) => {
        unlockError = e instanceof Error ? e : new Error('advisory unlock failed');
      });
    }
    client.release(unlockError);
  }
}

async function sendOne(d: PayrollSendDeps, payoutId: string): Promise<PayoutSendOutcome | null> {
  // Step 1: lock, check, record the attempt.
  const started = await withTx(d.db, async (c) => {
    const row = (await c.query<Due>(
      `select p.id::text, p.staff_id::text, p.amount_atomic::text, a.address, a.removed_at,
              t.account_id::text as tap_account, t.used_at is not null as tap_used, t.intent as tap_intent
         from staff_payouts p
         join staff_payout_addresses a on a.id = p.address_id
         left join key_taps t on t.id = a.tap_id
        where p.id = $1 and p.status = 'waiting-send'
          and not exists (select 1 from staff_payout_sends s where s.payout_id = p.id and s.outcome <> 'refused')
        for update of p`,
      [payoutId],
    )).rows[0];
    if (row === undefined) return null; // settled or started meanwhile
    const now = d.clock();
    if (!addressStillApproved(row)) {
      await c.query(`insert into staff_payout_sends (payout_id, started_at, outcome, settled_at) values ($1, $2, 'blocked', $2)`, [payoutId, now]);
      await c.query(`update staff_payouts set status = 'failed', settled_at = $2 where id = $1`, [payoutId, now]);
      await addOwnerAlert(c, 'payroll-send-blocked', { payoutId, amountAtomic: row.amount_atomic, message: 'A staff payout was stopped: its address no longer matches the one its key tap approved' }, now);
      await appendLog(c, { at: now, actor: { kind: 'system' }, tradeCode: null, action: 'pay.send-failed', detail: { ref: payoutId, reason: 'address-not-approved' } });
      return 'blocked' as const;
    }
    const { rows } = await c.query<{ id: string }>(
      `insert into staff_payout_sends (payout_id, started_at, outcome) values ($1, $2, 'pending') returning id::text`,
      [payoutId, now],
    );
    return { attempt: rows[0]!.id, address: row.address, amountAtomic: BigInt(row.amount_atomic), staffId: row.staff_id };
  });
  if (started === null) return null;
  if (started === 'blocked') {
    await bestEffortPush(d, 'payroll-send-blocked');
    return 'blocked';
  }

  // Step 2: the send, outside any transaction.
  let result: { outcome: 'sent'; txHash: string; feeAtomic: bigint | null } | { outcome: 'refused' | 'unknown' };
  try {
    const r = await d.wallet.transfer({ address: started.address, amountAtomic: started.amountAtomic, feeFromAmount: false });
    result = typeof r.txHash === 'string' && HEX64.test(r.txHash) ? { outcome: 'sent', txHash: r.txHash, feeAtomic: r.feeAtomic } : { outcome: 'unknown' };
  } catch (e) {
    result = { outcome: e instanceof PayrollWalletRefused ? 'refused' : 'unknown' };
  }

  // Step 3: settle the attempt (and the payout when it went out).
  const done = d.clock();
  const amountAtomic = started.amountAtomic.toString();
  let alerted = false;
  await withTx(d.db, async (c) => {
    const upd = await c.query(
      `update staff_payout_sends set outcome = $2, tx_hash = $3, network_fee_atomic = $4, settled_at = $5 where id = $1 and outcome = 'pending'`,
      [started.attempt, result.outcome, result.outcome === 'sent' ? result.txHash : null, result.outcome === 'sent' && result.feeAtomic !== null ? result.feeAtomic.toString() : null, done],
    );
    if (upd.rowCount !== 1) throw new Error('payroll send attempt is no longer pending');
    if (result.outcome === 'sent') {
      await c.query(`update staff_payouts set status = 'sent', tx_hash = $2, settled_at = $3 where id = $1 and status = 'waiting-send'`, [payoutId, result.txHash, done]);
      await appendLog(c, { at: done, actor: { kind: 'system' }, tradeCode: null, action: 'pay.sent', detail: { ref: payoutId, atomic: amountAtomic, txHash: result.txHash } });
      return;
    }
    if (result.outcome === 'refused') {
      // Told once per payout: a later pass's refusal of the same payout says nothing new.
      const before = (await c.query<{ n: number }>(`select count(*)::int as n from staff_payout_sends where payout_id = $1 and outcome = 'refused'`, [payoutId])).rows[0]?.n ?? 0;
      if (before === 1) {
        await addOwnerAlert(c, 'payroll-send-refused', { payoutId, amountAtomic, message: 'The payroll wallet could not pay a staff payout yet (low balance or coins still locked): it will try again' }, done);
        alerted = true;
      }
      await appendLog(c, { at: done, actor: { kind: 'system' }, tradeCode: null, action: 'pay.send-failed', detail: { ref: payoutId, reason: 'wallet-refused' } });
      return;
    }
    await addOwnerAlert(c, 'payroll-send-unknown', { payoutId, amountAtomic, message: 'A staff payout may or may not have been sent: check the payroll wallet' }, done);
    await appendLog(c, { at: done, actor: { kind: 'system' }, tradeCode: null, action: 'pay.send-failed', detail: { ref: payoutId, reason: 'no-answer' } });
    alerted = true;
  });
  if (alerted) await bestEffortPush(d, result.outcome === 'refused' ? 'payroll-send-refused' : 'payroll-send-unknown');
  return result.outcome;
}

async function bestEffortPush(d: PayrollSendDeps, kind: 'payroll-send-refused' | 'payroll-send-unknown' | 'payroll-send-blocked'): Promise<void> {
  if (!d.push) return;
  await pushOwnerAlert({ db: d.db, push: d.push }, kind).catch(() => undefined);
}

/** How often the payroll wallet's pass runs (payouts waiting, then the sweep to the fee wallet). */
export const PAYROLL_PASS_MS = 60_000;
