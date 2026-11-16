import { lienCreditor, lienSteps, type Dispute, type LienCause, type LienRef, type LienSide, type LienStatus } from '@x2f/staff';
import type pg from 'pg';
import type { Queryable } from '../db/pool.js';
import { appendLog } from '../log/append.js';

/**
 * Plan 4 Task 25 and Task 12's owed fees (J-06; owner D-006, D-008, D-009, D-062, D-063): the
 * liens and owed fees of migration 400, kept in step with the dispute.
 *
 * `applyLienRules` runs inside `withDispute` (store.ts) for every change any path makes to a
 * dispute, after the change's own activity-log entry and before the dispute row is written, all on
 * the one client (appendLog's rule). So whatever publishes a ruling (Task 12's routes, the timers,
 * the appeal route) cannot skip it, and a change that throws writes no lien either. What changes
 * comes from @x2f/staff `lienSteps`; this file only stores it and logs each step.
 *
 * A lien's effect (owner 16 Nov 2026, option b; docs/lien-recovery.md): an active lien no longer
 * blocks trading. The debtor keeps trading and each trade in which they receive XMR pays part of
 * their proceeds to the creditor (disputes/recovery.ts) until the lien is repaid. A moderator's
 * freeze or ban (`trading_holds`, bans) is separate and unchanged. `LIEN_BLOCKS_SQL` and
 * `lienBlocksTrading` stay the one choke point the trading guards read (409 `lien`), now false, so
 * an owner answer to NEEDS_OWNER_SELLER_DEBTOR (e.g. block selling only) has one place to change.
 *
 * Task 25's repayment trade (NEEDS_REPAYMENT_TRADE) is replaced by recovery from the debtor's
 * trades. The seller's accepted tx proof of `seller-sends-xmr` repays a lien for the XMR alone
 * (`complied`; its route is NEEDS_TASK_12_TX_PROOF). Owner rule 4 ("evidence before
 * enforcement", 16 Nov 2026): `complied` is a system event only, and that route must emit it only
 * once the tx proof is checked on chain (the money arrived), never on the seller's "sent" claim or
 * on uploaded evidence alone; recoveries likewise are recorded only on the settled payout.
 * NEEDS_FEE_OWED_COLLECTION: `fees_owed` rows are written; collecting them from the debtor's next
 * settled trades (Revision 2026-10-29c: `feeOwedAtomic` in the signed terms, checked by the gate and
 * every app) is not built.
 */

/**
 * SQL: whether liens are switched on (review L2, migration 400's `site_flags.liens_enabled`; no
 * site_flags row counts as off).
 */
export const LIENS_ON_SQL = `coalesce((select f.liens_enabled from site_flags f), false)`;

/** SQL: whether account `p` (a parameter or column) has an active lien that binds (liens switched on). */
export const ACTIVE_LIEN_SQL = (p: string) =>
  `(${LIENS_ON_SQL} and exists (select 1 from liens l where l.debtor_account_id = ${p} and l.status = 'active'))`;

/**
 * SQL: whether account `p`'s liens block its trading (the guards' 409 `lien` and the LISTED
 * filters). Owner option b (16 Nov 2026): never. `p` is unused while that holds.
 */
export const LIEN_BLOCKS_SQL = (_p: string) => `false`;

/** Whether the account's liens block its trading (owner option b: never; see LIEN_BLOCKS_SQL). */
export async function lienBlocksTrading(_q: Queryable, _accountId: string): Promise<boolean> {
  return false;
}

/** Whether the account has an active lien that binds (liens switched on): recovery applies. */
export async function hasActiveLien(q: Queryable, accountId: string): Promise<boolean> {
  const { rows } = await q.query<{ x: boolean }>(`select ${ACTIVE_LIEN_SQL('$1::uuid')} as x`, [accountId]);
  return rows[0]?.x === true;
}

interface LienRow {
  id: string;
  round: 1 | 2;
  debtor: string;
  cause: LienCause;
  status: LienStatus;
  amount_atomic: string;
  fee_atomic: string;
}

interface TradeRow {
  seller: string;
  buyer: string;
  poster: LienSide;
  amount_atomic: string;
  fee_atomic: string;
}

/**
 * Brings the dispute's liens and owed fees in line with `prev` → `next` (one accepted change of the
 * same dispute), at `now`, on `client` inside the caller's transaction. Each step is logged
 * (`lien.placed`, `lien.suspended`, `lien.reactivated`, `lien.voided`, `lien.repaid`, `fee.owed`)
 * by the system: a lien follows from the ruling, nobody chooses it.
 */
export async function applyLienRules(client: pg.PoolClient, prev: Dispute, next: Dispute, now: Date): Promise<void> {
  const t = (
    await client.query<TradeRow>(
      `select seller_account_id::text as seller, buyer_account_id::text as buyer, poster, amount_atomic::text, fee_atomic::text
         from trades where code = $1`,
      [next.code],
    )
  ).rows[0];
  if (!t) throw new Error('lien rules: the disputed trade is missing');
  const accountOf = (s: LienSide) => (s === 'seller' ? t.seller : t.buyer);
  const sideOf = (accountId: string): LienSide => (accountId === t.seller ? 'seller' : 'buyer');
  const stored = (
    await client.query<LienRow>(
      `select id::text, round, debtor_account_id::text as debtor, cause, status, amount_atomic::text, fee_atomic::text
         from liens where from_code = $1 and dispute_seq = $2 order by created_at, id for update`,
      [next.code, next.seq],
    )
  ).rows;
  const refs: LienRef[] = stored.map((r) => ({
    id: r.id,
    round: r.round,
    debtor: sideOf(r.debtor),
    cause: r.cause,
    status: r.status,
    amountAtomic: BigInt(r.amount_atomic),
    feeAtomic: BigInt(r.fee_atomic),
  }));
  // Reviews L2 and R2: while liens are switched off nothing is placed, and a 1% a lien would have
  // carried is owed from future trades once the ruling is final (lienSteps decides both); the
  // changes to liens placed before a switch-off still follow the dispute.
  const on = (await client.query<{ on: boolean }>(`select ${LIENS_ON_SQL} as on`)).rows[0]?.on === true;
  const all = lienSteps(prev, next, { poster: t.poster, amountAtomic: BigInt(t.amount_atomic), feeAtomic: BigInt(t.fee_atomic), liensOn: on }, refs);
  // Belt and braces: never a place while off, even if the rules above change.
  const steps = on ? all : all.filter((s) => s.op !== 'place');
  const system = { kind: 'system' as const };
  for (const s of steps) {
    switch (s.op) {
      case 'place': {
        const debtor = accountOf(s.debtor);
        const r = await client.query<{ id: string }>(
          `insert into liens (debtor_account_id, creditor_account_id, amount_atomic, fee_atomic, from_code, dispute_seq, round, cause,
             status, created_at, changed_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, $9)
           on conflict (from_code, dispute_seq, round, debtor_account_id) do nothing returning id::text`,
          [debtor, accountOf(lienCreditor(s.debtor)), s.amountAtomic.toString(), s.feeAtomic.toString(), next.code, next.seq, s.round, s.cause, now],
        );
        if (r.rows[0]) {
          await appendLog(client, {
            at: now, actor: system, tradeCode: next.code, action: 'lien.placed',
            detail: { lienId: r.rows[0].id, accountId: debtor, amountAtomic: (s.amountAtomic + s.feeAtomic).toString(), cause: s.cause },
          });
        }
        break;
      }
      case 'fee-owed': {
        const account = accountOf(s.side);
        const r = await client.query<{ id: string }>(
          `insert into fees_owed (account_id, amount_atomic, from_code, dispute_seq, created_at) values ($1, $2, $3, $4, $5)
           on conflict (from_code, dispute_seq) do nothing returning id::text`,
          [account, s.amountAtomic.toString(), next.code, next.seq, now],
        );
        if (r.rows[0]) {
          await appendLog(client, { at: now, actor: system, tradeCode: next.code, action: 'fee.owed', detail: { accountId: account, amountAtomic: s.amountAtomic.toString() } });
        }
        break;
      }
      default: {
        const to: Record<typeof s.op, { status: LienStatus; from: LienStatus[]; action: 'lien.suspended' | 'lien.reactivated' | 'lien.voided' | 'lien.repaid' }> = {
          suspend: { status: 'suspended', from: ['active'], action: 'lien.suspended' },
          reactivate: { status: 'active', from: ['suspended'], action: 'lien.reactivated' },
          void: { status: 'void', from: ['active', 'suspended'], action: 'lien.voided' },
          repaid: { status: 'repaid', from: ['active', 'suspended'], action: 'lien.repaid' },
        };
        const c = to[s.op];
        const over = c.status === 'void' || c.status === 'repaid';
        const r = await client.query(
          `update liens set status = $2, changed_at = $3, lifted_at = case when $4 then $3::timestamptz end
            where id = $1 and status = any($5::text[])`,
          [s.id, c.status, now, over, c.from],
        );
        if ((r.rowCount ?? 0) === 1) await appendLog(client, { at: now, actor: system, tradeCode: next.code, action: c.action, detail: { lienId: s.id } });
      }
    }
  }
}
