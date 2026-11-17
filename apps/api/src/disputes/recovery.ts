import { DEFAULT_RECOVERY_RATE_BPS, MAX_RECOVERY_RATE_BPS, lienRemaining, recoveryFor } from '@x2f/staff';
import { WATCH_CLOSED_DAYS, lienRecoveryCap } from '@x2f/trade';
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
 * - Rule 2: the SQL guard (migration 650) and `lienRemaining` both refuse more than the amount.
 * - Review B1 (security, 2026-11-16): the API is not trusted with the money. The recovery is paid
 *   to the creditor's own address from the disputed trade (`liens.creditor_address`, bound at
 *   placement), at most `lienRecoveryCap` of the proceeds (half, never leaving the buyer under the
 *   network fee: review B3), and the moderation service signs it only when its own records back
 *   it (apps/moderation lienRecovery.ts): the source trade it attested, a creditor of that trade's
 *   gate-verified rulings, that creditor's signed address, and the lien's total. The work item
 *   hands it the source (internal/routes.ts `lienSource`).
 * - Review M2: a hold stays reserved while its trade could still pay it: a trade that closed with
 *   an escrow but no coin may yet be funded late, escalated and ruled for the buyer, whose payout
 *   pays the signed recovery. It is released at once only when the trade can never pay it (no
 *   escrow was ever set up, or a refund settled on chain), and stops counting once the trade has
 *   been closed without coins for the moderation watch (`WATCH_CLOSED_DAYS`), as the moderation
 *   service's own count does.
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
  creditor_address: string | null;
  amount_atomic: string;
  rate: number;
  recovered: string;
  held: string;
}

/**
 * SQL: whether hold `h` still counts against its lien (review M2): open, and its trade not closed
 * without a coin for longer than the moderation watch (`$closedBefore`, a timestamptz parameter).
 */
const HOLD_COUNTS_SQL = (h: string, closedBefore: string) =>
  `(${h}.status = 'open' and not exists (
     select 1 from trades t where t.code = ${h}.trade_code and t.closed_at is not null and t.closed_at < ${closedBefore} and t.received_atomic = 0))`;

const DAY_MS = 86_400_000;


/**
 * Reserves this trade's recovery for the buyer's oldest active lien with something left to
 * reserve, on `c` inside the take's transaction (the lien row is locked `for update`, and the take
 * already holds both accounts `for update`, so two takes by one debtor serialise and the second
 * sees the first's hold). Nothing when liens are off, the buyer owes nothing, the creditor is the
 * trade's seller (lead default), the lien has no creditor address, or that address is one of this
 * trade's own (`ownAddresses`, review B2: the release could never be built); the remainder carries
 * forward.
 */
export async function reserveRecovery(
  c: pg.PoolClient,
  a: { code: string; buyerId: string; sellerId: string; proceedsAtomic: bigint; ownAddresses: readonly (string | null)[]; now: Date },
): Promise<Reserved | null> {
  const on = (await c.query<{ on: boolean }>(`select ${LIENS_ON_SQL} as on`)).rows[0]?.on === true;
  // Review B1, B3: never more than half the proceeds, never leaving the buyer under the network fee.
  const cap = lienRecoveryCap(a.proceedsAtomic);
  if (!on || cap <= 0n) return null;
  const closedBefore = new Date(a.now.getTime() - WATCH_CLOSED_DAYS * DAY_MS);
  const { rows } = await c.query<OpenLien>(
    `select l.id::text, l.creditor_address, l.amount_atomic::text, l.recovery_rate_bps as rate,
            (select coalesce(sum(r.amount_atomic), 0) from lien_recoveries r where r.lien_id = l.id)::text as recovered,
            (select coalesce(sum(h.amount_atomic), 0) from lien_recovery_holds h where h.lien_id = l.id and ${HOLD_COUNTS_SQL('h', '$3')})::text as held
       from liens l
      where l.debtor_account_id = $1 and l.status = 'active' and l.creditor_account_id <> $2
      order by l.created_at, l.id
      for update of l`,
    [a.buyerId, a.sellerId, closedBefore],
  );
  const own = a.ownAddresses.filter((x): x is string => typeof x === 'string' && x !== '');
  for (const l of rows) {
    const address = l.creditor_address;
    if (address === null || own.includes(address)) continue;
    const remaining = lienRemaining(BigInt(l.amount_atomic), BigInt(l.recovered) > 0n ? [BigInt(l.recovered)] : []);
    const free = remaining - BigInt(l.held);
    if (free <= 0n) continue;
    // NEEDS_GATE_LIEN_RATE: a rate above the default is never applied (the signed terms cap it).
    const rate = l.rate < MAX_RECOVERY_RATE_BPS ? l.rate : MAX_RECOVERY_RATE_BPS;
    const amount = recoveryFor({ proceedsAtomic: a.proceedsAtomic, rateBps: rate, freeAtomic: free < cap ? free : cap });
    if (amount <= 0n) continue;
    await c.query(
      `insert into lien_recovery_holds (lien_id, trade_code, amount_atomic, address, created_at) values ($1, $2, $3, $4, $5)`,
      [l.id, a.code, amount.toString(), address, a.now],
    );
    return { lienId: l.id, amountAtomic: amount, address };
  }
  return null;
}

/**
 * Review B2: the poster's own address, chosen after the take (`POST /v1/trades/:code/wallet`), is
 * the trade's open hold's address: the hold is released before anything is signed (the trade is not
 * work until both addresses are set), so the release stays buildable. Returns the log entry, or null.
 */
export async function releaseHoldAt(c: pg.PoolClient, code: string, address: string, now: Date): Promise<PendingLog | null> {
  const hold = (
    await c.query<{ id: string; lien_id: string; amount_atomic: string }>(
      `select id::text, lien_id::text, amount_atomic::text from lien_recovery_holds where trade_code = $1 and status = 'open' and address = $2 for update`,
      [code, address],
    )
  ).rows[0];
  if (hold === undefined) return null;
  await c.query(`update lien_recovery_holds set status = 'released', closed_at = $2, address = null where id = $1`, [hold.id, now]);
  return { action: 'lien.recovery-released', detail: { lienId: hold.lien_id, amountAtomic: hold.amount_atomic } };
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

/** The recovery a trade reserved and may still pay or paid (review I2: not a released one), for the buyer's own view. */
export async function reservedAtomic(q: Queryable, code: string): Promise<bigint | null> {
  const { rows } = await q.query<{ amount_atomic: string }>(`select amount_atomic::text from lien_recovery_holds where trade_code = $1 and status <> 'released'`, [code]);
  return rows[0] === undefined ? null : BigInt(rows[0].amount_atomic);
}

/**
 * How a trade's end bears on its hold: `completed` (a completed-trade payout, `release` or
 * `dispute-buyer`, seen on chain: the signed recovery was paid), `refunded` (a refund seen on chain:
 * the escrow is empty and the recovery was never paid) or `closed` (any other end, such as a cancel).
 */
export type TradeEnd = 'completed' | 'refunded' | 'closed';

/**
 * The trade ended. `completed`: the hold becomes a ledger row (and the lien `repaid` when its
 * remainder reaches 0 and it carries no 1%). `refunded`, or `closed` with no escrow ever set up
 * (`escrowSetUp` false): the hold is released, nothing is recovered. `closed` with an escrow
 * (review M2): the hold stays open, since late coins can still be escalated and ruled for the
 * buyer, whose payout pays the signed recovery; it stops counting after the moderation watch
 * (`HOLD_COUNTS_SQL`). Returns the log entries for the caller to append last.
 */
export async function settleRecovery(c: pg.PoolClient, code: string, end: TradeEnd, escrowSetUp: boolean, now: Date): Promise<PendingLog[]> {
  const hold = (
    await c.query<{ id: string; lien_id: string; amount_atomic: string }>(
      `select id::text, lien_id::text, amount_atomic::text from lien_recovery_holds where trade_code = $1 and status = 'open' for update`,
      [code],
    )
  ).rows[0];
  if (hold === undefined) return [];
  if (end !== 'completed') {
    if (end === 'closed' && escrowSetUp) return [];
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
  const before = (
    await c.query<{ amount_atomic: string }>('select amount_atomic::text from lien_recoveries where lien_id = $1', [hold.lien_id])
  ).rows.map((r) => BigInt(r.amount_atomic));
  const left = lienRemaining(BigInt(lien.amount_atomic), before);
  const paid = BigInt(hold.amount_atomic);
  // Review M2: a hold that stopped counting (its trade closed without coins for the whole watch)
  // and was paid after all, by a late-funded trade ruled for the buyer, can take the creditor past
  // what is owed. The money moved; the ledger records what was owed of it (rule 2's guard), and
  // the excess is logged for staff (owner question: whether the creditor owes it back).
  const recorded = paid < left ? paid : left;
  const logs: PendingLog[] = [];
  if (recorded > 0n) {
    // The money moved (the signed terms paid it), so it is recorded whatever the lien's status now
    // (owner question 4 in docs/lien-recovery.md: a lien voided or suspended meanwhile).
    await c.query('insert into lien_recoveries (lien_id, trade_code, amount_atomic, at) values ($1, $2, $3, $4)', [hold.lien_id, code, recorded.toString(), now]);
  }
  const remaining = left - recorded;
  logs.push({ action: 'lien.recovered', detail: { lienId: hold.lien_id, amountAtomic: recorded.toString(), remainingAtomic: remaining.toString() } });
  if (paid > recorded) logs.push({ action: 'lien.over-recovered', detail: { lienId: hold.lien_id, amountAtomic: (paid - recorded).toString() } });
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
