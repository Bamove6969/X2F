import { DEFAULT_RECOVERY_RATE_BPS, lienRemaining, recoveryFor } from '@x2f/staff';
import type pg from 'pg';
import type { Queryable } from '../db/pool.js';
import type { LogAction } from '../log/actions.js';
import { LIENS_ON_SQL } from './lien.js';

/**
 * Lien recovery (owner rules 16 Nov 2026; docs/lien-recovery.md; arithmetic in @x2f/staff
 * lienRecovery.ts).
 *
 * - At take (`reserveRecovery`), when the buyer owes an active lien: the trade reserves
 *   `min(rate × buyer's proceeds, free remainder)` for the creditor (a `lien_recovery_holds` row).
 *   The moderation service signs it into the terms (internal/routes.ts `termsOf`), and every
 *   party's device builds the completed trade's payout set with it (@x2f/trade `payoutsFor`).
 * - Rule 4, evidence before enforcement: the ledger row (`lien_recoveries`) is written only when
 *   the trade reaches `released` through the chain-observed `settled` event (`settleRecovery`,
 *   trades/store.ts), never on a payment claim. A cancel or refund releases the hold.
 * - Rule 2: the SQL guard (migration 560) and `lienRemaining` both refuse more than the amount.
 * - A lien becomes `repaid` exactly when its remainder reaches 0 and it carries no X2F 1%
 *   (NEEDS_OWNER_LIEN_FEE_AFTER_COMPLY: one that does stays `active`, recovering nothing more).
 *
 * NEEDS_OWNER_SELLER_DEBTOR: a debtor who SELLS receives fiat off-platform; nothing is withheld
 * (docs/lien-recovery.md lists the options).
 */

/** What a trade reserved for a lien, as the signed terms carry it. */
export interface Reserved {
  lienId: string;
  amountAtomic: bigint;
  address: string;
}

/** A log entry for the caller to append last (append.ts: the log lock is taken just before the commit). */
export interface PendingLog {
  action: Extract<LogAction, `lien.${string}`>;
  detail: Record<string, string>;
}

interface OpenLien {
  id: string;
  creditor: string;
  amount_atomic: string;
  rate: number;
  recovered: string;
  held: string;
}

/**
 * Reserves this trade's recovery for the buyer's oldest active lien with something left to
 * reserve, on `c` inside the take's transaction (the lien row is locked `for update`, so two takes
 * by one debtor serialise). Nothing when liens are off, the buyer owes nothing, the creditor is the
 * trade's seller (their own address would be a party's: lead default), or the creditor has no
 * usable wallet (the remainder carries forward).
 */
export async function reserveRecovery(
  c: pg.PoolClient,
  a: { code: string; buyerId: string; sellerId: string; proceedsAtomic: bigint; now: Date },
): Promise<Reserved | null> {
  const on = (await c.query<{ on: boolean }>(`select ${LIENS_ON_SQL} as on`)).rows[0]?.on === true;
  if (!on || a.proceedsAtomic <= 1n) return null;
  const { rows } = await c.query<OpenLien>(
    `select l.id::text, l.creditor_account_id::text as creditor, l.amount_atomic::text, l.recovery_rate_bps as rate,
            (select coalesce(sum(r.amount_atomic), 0) from lien_recoveries r where r.lien_id = l.id)::text as recovered,
            (select coalesce(sum(h.amount_atomic), 0) from lien_recovery_holds h where h.lien_id = l.id and h.status = 'open')::text as held
       from liens l
      where l.debtor_account_id = $1 and l.status = 'active' and l.creditor_account_id <> $2
      order by l.created_at, l.id
      for update of l`,
    [a.buyerId, a.sellerId],
  );
  for (const l of rows) {
    const remaining = lienRemaining(BigInt(l.amount_atomic), BigInt(l.recovered) > 0n ? [BigInt(l.recovered)] : []);
    const free = remaining - BigInt(l.held);
    if (free <= 0n) continue;
    // The buyer always keeps something (payoutsFor: the recovery is below the proceeds).
    const cap = a.proceedsAtomic - 1n;
    const amount = recoveryFor({ proceedsAtomic: a.proceedsAtomic, rateBps: l.rate, freeAtomic: free < cap ? free : cap });
    if (amount <= 0n) continue;
    const w = await c.query<{ address: string }>(
      `select address from wallets
        where account_id = $1 and removed_at is null and address is not null and usable_from <= $2
        order by usable_from desc, created_at desc, id limit 1`,
      [l.creditor, a.now],
    );
    const address = w.rows[0]?.address;
    if (address === undefined) continue;
    await c.query(
      `insert into lien_recovery_holds (lien_id, trade_code, amount_atomic, address, created_at) values ($1, $2, $3, $4, $5)`,
      [l.id, a.code, amount.toString(), address, a.now],
    );
    return { lienId: l.id, amountAtomic: amount, address };
  }
  return null;
}

/** The trade's recovery as its signed terms carry it (an open hold), or null. */
export async function recoveryForTerms(q: Queryable, code: string): Promise<{ address: string; amountAtomic: string } | null> {
  const { rows } = await q.query<{ address: string; amount_atomic: string }>(
    `select address, amount_atomic::text from lien_recovery_holds where trade_code = $1 and status = 'open'`,
    [code],
  );
  const r = rows[0];
  return r === undefined ? null : { address: r.address, amountAtomic: r.amount_atomic };
}

/** The recovery a trade reserved (any status), for the buyer's own view. */
export async function reservedAtomic(q: Queryable, code: string): Promise<bigint | null> {
  const { rows } = await q.query<{ amount_atomic: string }>('select amount_atomic::text from lien_recovery_holds where trade_code = $1', [code]);
  return rows[0] === undefined ? null : BigInt(rows[0].amount_atomic);
}

/**
 * The trade ended. `completed`: it settled by a completed-trade payout (`release`,
 * `dispute-buyer`) seen on chain, so the hold becomes a ledger row (and the lien `repaid` when its
 * remainder reaches 0 and it carries no 1%). Otherwise (cancel, refund, full reversal) the hold is
 * released and nothing is recovered. Returns the log entries for the caller to append last.
 */
export async function settleRecovery(c: pg.PoolClient, code: string, completed: boolean, now: Date): Promise<PendingLog[]> {
  const hold = (
    await c.query<{ id: string; lien_id: string; amount_atomic: string }>(
      `select id::text, lien_id::text, amount_atomic::text from lien_recovery_holds where trade_code = $1 and status = 'open' for update`,
      [code],
    )
  ).rows[0];
  if (hold === undefined) return [];
  if (!completed) {
    await c.query(`update lien_recovery_holds set status = 'released', closed_at = $2, address = null where id = $1`, [hold.id, now]);
    return [{ action: 'lien.recovery-released', detail: { lienId: hold.lien_id, amountAtomic: hold.amount_atomic } }];
  }
  const lien = (
    await c.query<{ amount_atomic: string; fee_atomic: string; status: string }>(
      'select amount_atomic::text, fee_atomic::text, status from liens where id = $1 for update',
      [hold.lien_id],
    )
  ).rows[0]!;
  await c.query(`update lien_recovery_holds set status = 'recovered', closed_at = $2, address = null where id = $1`, [hold.id, now]);
  // The money moved (the signed terms paid it), so it is recorded whatever the lien's status now
  // (owner question 4 in docs/lien-recovery.md: a lien voided or suspended meanwhile).
  await c.query('insert into lien_recoveries (lien_id, trade_code, amount_atomic, at) values ($1, $2, $3, $4)', [hold.lien_id, code, hold.amount_atomic, now]);
  const got = (
    await c.query<{ amount_atomic: string }>('select amount_atomic::text from lien_recoveries where lien_id = $1', [hold.lien_id])
  ).rows.map((r) => BigInt(r.amount_atomic));
  const remaining = lienRemaining(BigInt(lien.amount_atomic), got);
  const logs: PendingLog[] = [
    { action: 'lien.recovered', detail: { lienId: hold.lien_id, amountAtomic: hold.amount_atomic, remainingAtomic: remaining.toString() } },
  ];
  if (remaining === 0n && BigInt(lien.fee_atomic) === 0n && lien.status === 'active') {
    const r = await c.query(
      `update liens set status = 'repaid', changed_at = $2, lifted_at = $2, repayment_code = $3 where id = $1 and status = 'active'`,
      [hold.lien_id, now, code],
    );
    if ((r.rowCount ?? 0) === 1) logs.push({ action: 'lien.repaid', detail: { lienId: hold.lien_id, repaymentCode: code } });
  }
  return logs;
}

/** A lien's figures for its debtor, its creditor and staff. */
export interface LienFigures {
  id: string;
  debtorId: string;
  creditorId: string;
  status: string;
  amountAtomic: string;
  feeAtomic: string;
  recoveredAtomic: string;
  remainingAtomic: string;
  rateBps: number;
  defaultRateBps: number;
  fromCode: string;
  createdAt: string;
}

export const LIEN_FIGURES_SQL = `select l.id::text, l.debtor_account_id::text as debtor, l.creditor_account_id::text as creditor, l.status,
         l.amount_atomic::text, l.fee_atomic::text, l.recovery_rate_bps as rate, l.from_code, l.created_at,
         (select coalesce(sum(r.amount_atomic), 0) from lien_recoveries r where r.lien_id = l.id)::text as recovered
    from liens l`;

export interface LienFiguresRow {
  id: string;
  debtor: string;
  creditor: string;
  status: string;
  amount_atomic: string;
  fee_atomic: string;
  rate: number;
  from_code: string;
  created_at: Date;
  recovered: string;
}

export function lienFigures(r: LienFiguresRow): LienFigures {
  const recovered = BigInt(r.recovered);
  return {
    id: r.id,
    debtorId: r.debtor,
    creditorId: r.creditor,
    status: r.status,
    amountAtomic: r.amount_atomic,
    feeAtomic: r.fee_atomic,
    recoveredAtomic: r.recovered,
    remainingAtomic: lienRemaining(BigInt(r.amount_atomic), recovered > 0n ? [recovered] : []).toString(),
    rateBps: r.rate,
    defaultRateBps: DEFAULT_RECOVERY_RATE_BPS,
    fromCode: r.from_code,
    createdAt: r.created_at.toISOString(),
  };
}
