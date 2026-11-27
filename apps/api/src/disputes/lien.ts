import { graceUntilOf, lienCreditor, lienSteps, type Dispute, type LienCause, type LienRef, type LienSide, type LienStatus } from '@x2f/staff';
import type pg from 'pg';
import { addAlert } from '../alerts.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { appendLog } from '../log/append.js';
import { releaseStaleHolds } from './recovery.js';

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
 * (`complied`, from the seller's accepted proof: disputes/comply.ts). Owner rule 4 ("evidence
 * before enforcement", 16 Nov 2026): `complied` is a system event only, emitted only once the tx
 * proof is accepted (the money arrived), never on the seller's "sent" claim or on uploaded evidence
 * alone; recoveries likewise are recorded only on the settled payout.
 * NEEDS_FEE_OWED_COLLECTION: `fees_owed` rows are written; collecting them from the debtor's next
 * settled trades (Revision 2026-10-29c: `feeOwedAtomic` in the signed terms, checked by the gate and
 * every app) is not built.
 */

/**
 * SQL: whether liens are switched on (review L2, migration 400's `site_flags.liens_enabled`; no
 * site_flags row counts as off).
 */
export const LIENS_ON_SQL = `coalesce((select f.liens_enabled from site_flags f), false)`;

/**
 * SQL over lien alias `l`: whether the lien collects from the debtor's trades now (owner 26 Nov 2026,
 * "Grace: 7 days to pay the agreed way"): not paid off the platform, and either never given the
 * grace or switched to collecting (`collect_started_at`). A grace whose days passed does not collect
 * until the moderator's switch (@x2f/staff LIEN_LAPSE_STARTS_COLLECTING). The twin of @x2f/staff
 * `lienCollecting`; the one predicate the take's reserve reads (recovery.ts `pickRecovery`).
 */
export const LIEN_COLLECTING_SQL = (l: string) =>
  `(${l}.repaid_off_platform_at is null and (${l}.grace_until is null or ${l}.collect_started_at is not null))`;

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
        // Owner 26 Nov 2026 (grace): how the ruling that places the lien chose to have it paid.
        const plan = await rulingLienPlan(client, next);
        const graceUntil = plan.method === null ? null : graceUntilOf(now);
        const r = await client.query<{ id: string }>(
          `insert into liens (debtor_account_id, creditor_account_id, amount_atomic, fee_atomic, from_code, dispute_seq, round, cause,
             status, created_at, changed_at, ruled_by, grace_method, grace_until)
           values ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, $9, $10, $11, $12)
           on conflict (from_code, dispute_seq, round, debtor_account_id) do nothing returning id::text`,
          [debtor, accountOf(lienCreditor(s.debtor)), s.amountAtomic.toString(), s.feeAtomic.toString(), next.code, next.seq, s.round, s.cause, now,
            plan.ruledBy, plan.method, graceUntil],
        );
        if (r.rows[0]) {
          await appendLog(client, {
            at: now, actor: system, tradeCode: next.code, action: 'lien.placed',
            detail: { lienId: r.rows[0].id, accountId: debtor, amountAtomic: (s.amountAtomic + s.feeAtomic).toString(), cause: s.cause },
          });
          if (graceUntil !== null) {
            await appendLog(client, { at: now, actor: system, tradeCode: next.code, action: 'lien.grace-started', detail: { lienId: r.rows[0].id, graceUntil: graceUntil.toISOString() } });
          }
          // Owner addition 26 Nov 5:51 PM: "Start collecting now" at a share under 100%: the ruler's pending rate request.
          if (plan.rateBps !== null && plan.rateReason !== null && plan.ruledBy !== null) {
            await proposeLienRate(client, { lienId: r.rows[0].id, rateBps: plan.rateBps, reason: plan.rateReason, by: plan.ruledBy, now, logCode: next.code });
          }
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
        // Review M2: a lien repaid directly (complied) while a trade of the debtor's still carries a
        // signed recovery for it would be paid twice; the change waits until that trade ends.
        if (s.op === 'repaid') {
          // Re-review N3: a hold that stopped counting (its trade closed without a coin for the whole
          // moderation watch) is released first, so it never blocks complied for ever.
          for (const h of await releaseStaleHolds(client, now, s.id)) {
            await appendLog(client, { at: now, actor: system, tradeCode: h.tradeCode, action: 'lien.recovery-released', detail: { lienId: h.lienId, amountAtomic: h.amountAtomic } });
          }
          const open = await client.query(`select 1 from lien_recovery_holds where lien_id = $1 and status = 'open' limit 1`, [s.id]);
          if ((open.rowCount ?? 0) > 0) throw new ApiError(409, 'lien-recovery-in-flight');
        }
        if (s.op === 'void') {
          await applyLienVoid(client, s.id, now, next.code);
          break;
        }
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

/**
 * Owner 26 Nov 2026 (grace): the plan of the ruling whose publishing places a lien, from its draft
 * (`ruling_drafts.lien_grace_method`, sent with the proposal): the grace's "How they agreed to pay"
 * text, or null for "Start collecting now" (also when the ruling has no draft, as before the
 * decision). `ruledBy`: the ruling's proposer, told when the grace lapses.
 */
interface RulingLienPlan {
  method: string | null;
  rateBps: number | null;
  rateReason: string | null;
  ruledBy: string | null;
}

async function rulingLienPlan(client: pg.PoolClient, d: Dispute): Promise<RulingLienPlan> {
  const r = d.ruling;
  if (r === null) return { method: null, rateBps: null, rateReason: null, ruledBy: null };
  const row = (
    await client.query<{ method: string | null; rate: number | null; reason: string | null }>(
      'select lien_grace_method as method, lien_rate_bps as rate, lien_rate_reason as reason from ruling_drafts where ruling_id = $1 and code = $2 and seq = $3',
      [r.id, d.code, d.seq],
    )
  ).rows[0];
  const staff = (await client.query('select 1 from accounts where id = $1', [r.proposer])).rowCount === 1;
  return { method: row?.method ?? null, rateBps: row?.rate ?? null, rateReason: row?.reason ?? null, ruledBy: staff ? r.proposer : null };
}

/**
 * Owner addition 26 Nov 2026 5:51 PM: a moderator's "Start collecting now" share under 100% (with the
 * ruling, or with the switch from a grace) becomes the lien's pending rate request, as if proposed on
 * `POST /staff/v1/liens/:id/rate`: a senior moderator or the owner approves it there (no key tap
 * since the owner change of 5:53 PM); until then the lien's current rate applies. The seniors and
 * the owner who may decide it are alerted (`alertRateDeciders`). Skipped (false) when one is pending.
 */
export async function proposeLienRate(c: pg.PoolClient, a: { lienId: string; rateBps: number; reason: string; by: string; now: Date; logCode: string | null }): Promise<boolean> {
  const pending = await c.query(`select 1 from lien_rate_requests where lien_id = $1 and status = 'pending'`, [a.lienId]);
  if ((pending.rowCount ?? 0) > 0) return false;
  const r = await c.query<{ id: string }>(
    'insert into lien_rate_requests (lien_id, proposed_bps, reason, proposed_by, proposed_at) values ($1, $2, $3, $4, $5) returning id::text',
    [a.lienId, a.rateBps, a.reason, a.by, a.now],
  );
  await alertRateDeciders(c, { lienId: a.lienId, requestId: r.rows[0]!.id, proposer: a.by, now: a.now });
  await appendLog(c, { at: a.now, actor: { kind: 'system' }, tradeCode: a.logCode, action: 'lien.rate-proposed', detail: { lienId: a.lienId, requestId: r.rows[0]!.id, rateBps: a.rateBps } });
  return true;
}

/**
 * Who may decide a rate request proposed by `proposer` (@x2f/staff `canDecideRateRequest`): every
 * senior moderator and the owner, switched on, not removed, their account not disabled, never the
 * proposer. The owner account counts even without a staff row.
 */
export async function rateDeciders(q: Queryable, proposer: string): Promise<string[]> {
  const { rows } = await q.query<{ id: string }>(
    `select id from (
       select m.account_id::text as id from staff_members m join accounts a on a.id = m.account_id
        where m.role in ('senior', 'owner') and m.switched_off_at is null and m.removed_at is null and a.disabled_at is null
       union
       select id::text from accounts where kind = 'owner' and disabled_at is null
     ) d where id <> $1 order by id`,
    [proposer],
  );
  return rows.map((r) => r.id);
}

/**
 * Coordinator follow-up, 26 Nov 2026 (owner: seniors are "requested and needed to just go in and
 * approve"): a new rate request, from a ruling, a switch to collecting or `POST .../rate`, alerts
 * each senior and the owner who may decide it (`lien-rate-requested`, detail: trade, lienId,
 * requestId; the staff site links it to the case's lien panel). Inside the request's own
 * transaction, so once per request. The phone push follows after the commit
 * (lienGrace.ts `pushRateDeciders`, from the route and the dispute timers).
 */
export async function alertRateDeciders(c: Queryable, a: { lienId: string; requestId: string; proposer: string; now: Date }): Promise<void> {
  const l = (await c.query<{ from_code: string }>('select from_code from liens where id = $1', [a.lienId])).rows[0];
  if (l === undefined) return;
  for (const who of await rateDeciders(c, a.proposer)) {
    await addAlert(c, who, 'lien-rate-requested', { trade: l.from_code, lienId: a.lienId, requestId: a.requestId }, a.now);
  }
}

/**
 * Voids lien `id` (a round-2 overturn, from `lienSteps`) on `client` inside the dispute's
 * transaction, logged on `logCode` (the dispute's trade). Q6 (provisional owner answer, 17 Nov
 * 2026; docs/lien-recovery.md): the holds of the debtor's trades whose terms are not signed yet are
 * released, so those trades pay nothing; a trade already attested pays what its signed terms carry
 * (nothing can change them), and `settleRecovery` records that payment and flags it for staff
 * (`lien.recovered-after-end`; no automatic clawback). True when the lien changed.
 */
export async function applyLienVoid(client: pg.PoolClient, id: string, now: Date, logCode?: string): Promise<boolean> {
  const released = await client.query<{ trade_code: string; amount_atomic: string }>(
    `update lien_recovery_holds h set status = 'released', closed_at = $2, address = null, address_statement = null, address_sig = null
      where h.lien_id = $1 and h.status = 'open' and not exists (select 1 from trade_attestations a where a.code = h.trade_code)
      returning h.trade_code, h.amount_atomic::text`,
    [id, now],
  );
  const r = await client.query(
    `update liens set status = 'void', changed_at = $2, lifted_at = $2 where id = $1 and status in ('active', 'suspended') returning from_code`,
    [id, now],
  );
  const system = { kind: 'system' as const };
  for (const h of released.rows) {
    await appendLog(client, { at: now, actor: system, tradeCode: h.trade_code, action: 'lien.recovery-released', detail: { lienId: id, amountAtomic: h.amount_atomic } });
  }
  const changed = (r.rowCount ?? 0) === 1;
  if (changed) await appendLog(client, { at: now, actor: system, tradeCode: logCode ?? (r.rows[0] as { from_code: string }).from_code, action: 'lien.voided', detail: { lienId: id } });
  return changed;
}

/**
 * Owner 26 Nov 2026: the owner writes lien `id` off as uncollectible (tap `lien-uncollectible`,
 * consumed by the caller in this transaction). It ends like a void: the holds of the debtor's
 * trades whose terms are not signed yet are released, the lien is lifted (no more recovery, no more
 * blocking) and its trade gets its delete date back (@x2f/trade retention.ts: 90 days from now).
 * Any ban stays as it is. False when the lien is not active or suspended.
 */
export async function applyLienUncollectible(client: pg.PoolClient, id: string, by: string, tapId: string, now: Date): Promise<string | null> {
  const released = await client.query<{ trade_code: string; amount_atomic: string }>(
    `update lien_recovery_holds h set status = 'released', closed_at = $2, address = null, address_statement = null, address_sig = null
      where h.lien_id = $1 and h.status = 'open' and not exists (select 1 from trade_attestations a where a.code = h.trade_code)
      returning h.trade_code, h.amount_atomic::text`,
    [id, now],
  );
  const r = await client.query<{ from_code: string }>(
    `update liens set status = 'uncollectible', changed_at = $2, lifted_at = $2, written_off_by = $3, written_off_tap = $4
      where id = $1 and status in ('active', 'suspended') returning from_code`,
    [id, now, by, tapId],
  );
  const system = { kind: 'system' as const };
  for (const h of released.rows) {
    await appendLog(client, { at: now, actor: system, tradeCode: h.trade_code, action: 'lien.recovery-released', detail: { lienId: id, amountAtomic: h.amount_atomic } });
  }
  return r.rows[0]?.from_code ?? null;
}
