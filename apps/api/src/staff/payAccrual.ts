import { rulingFee, type Dispute, type RulingDraft } from '@x2f/staff';
import type pg from 'pg';
import { appendLog } from '../log/append.js';

/**
 * Plan 4 Task 33 / J-12 (D-041..D-044): what a staff member earns when a dispute completes, and the
 * clawback when that decision is overruled on appeal. Called by `saveDispute` (disputes/store.ts)
 * on every save, in the dispute's own transaction, so it runs whichever route moved the dispute
 * (Task 12's ruling routes are not built yet; their tests drive the machine directly). Idempotent:
 * every item is unique per dispute (migration 420), so a later save of the same dispute adds nothing.
 *
 * A leaf module (no staff route imports): disputes/store.ts imports it.
 *
 * The owner's rules and the lead's reading:
 * - a dispute is "completed" when round 1's ruling is published (it acts at once, A1 dropped); its
 *   proposer earns the per-dispute amount of their role at that moment (moderator or senior
 *   moderator; unset = an item with no amount). The owner earns nothing (lead default);
 * - a senior moderator also earns `senior_large_trade_bp` of the trade's X2F fee when the trade's
 *   value at dispute opening is at or above the threshold and the ruling makes the poster pay the
 *   fee (owner g63: a full reversal earns X2F nothing, so it has no share). The share goes to the
 *   proposer if senior, else to the senior who co-approved (lead reading of "decided or co-approved");
 * - the appeal's own ruling (round 2) earns nothing (owner question, not ruled);
 * - clawback option A: when round 2 is final and differs from round 1 ("Decision overruled"),
 *   every item round 1 earned is reversed by a negative item of the same amount, taken from future
 *   pay. "Decision stands" changes nothing.
 */

const ROUND1_DONE = new Set(['published', 'final', 'complying', 'closed']);
const ROUND2_DONE = new Set(['final', 'complying', 'closed']);

/** Round 1's published ruling, or null while round 1 is not published. */
function round1Ruling(d: Dispute): RulingDraft | null {
  if (d.round === 2) return d.round1;
  return ROUND1_DONE.has(d.status) ? d.ruling : null;
}

interface PayRow {
  pay_mod_dispute_usd_cents: string | null;
  pay_senior_dispute_usd_cents: string | null;
  senior_large_trade_bp: number | null;
  large_trade_bonus_threshold_usd: number | null;
}

async function roleOf(client: pg.PoolClient, id: string | null): Promise<string | null> {
  if (id === null) return null;
  const { rows } = await client.query<{ role: string }>('select role from staff_members where account_id::text = $1', [id.toLowerCase()]);
  return rows[0]?.role ?? null;
}

async function earn(client: pg.PoolClient, d: Dispute, r: RulingDraft, now: Date): Promise<void> {
  // Already earned (the usual case on a later save): nothing to read or write.
  const done = await client.query("select 1 from staff_pay_items where kind = 'dispute' and trade_code = $1 and seq = $2", [d.code, d.seq]);
  if ((done.rowCount ?? 0) > 0) return;
  const proposerRole = await roleOf(client, r.proposer);
  if (proposerRole !== 'mod' && proposerRole !== 'senior') return;
  const s = (await client.query<PayRow>(
    `select pay_mod_dispute_usd_cents::text, pay_senior_dispute_usd_cents::text, senior_large_trade_bp, large_trade_bonus_threshold_usd
       from settings where id = 1`,
  )).rows[0];
  const rate = proposerRole === 'senior' ? s?.pay_senior_dispute_usd_cents : s?.pay_mod_dispute_usd_cents;
  await client.query(
    `insert into staff_pay_items (staff_id, kind, trade_code, seq, usd_cents, earned_at)
     values ($1, 'dispute', $2, $3, $4, $5) on conflict do nothing`,
    [r.proposer, d.code, d.seq, rate ?? null, now],
  );

  // The senior moderators' large-trade share (D-043).
  const bp = s?.senior_large_trade_bp ?? null;
  const threshold = s?.large_trade_bonus_threshold_usd ?? null;
  if (bp === null || bp === 0 || threshold === null) return;
  if (d.usdCents < BigInt(threshold) * 100n) return;
  if (rulingFee({ status: 'published', round: 1, ruling: r, round1: null }) !== 'poster-pays') return;
  const senior = proposerRole === 'senior' ? r.proposer : (await roleOf(client, r.approver)) === 'senior' ? r.approver : null;
  if (senior === null) return;
  const fee = (await client.query<{ fee_atomic: string }>('select fee_atomic::text from trades where code = $1', [d.code])).rows[0];
  if (!fee) return;
  const share = (BigInt(fee.fee_atomic) * BigInt(bp)) / 10_000n;
  if (share <= 0n) return;
  await client.query(
    `insert into staff_pay_items (staff_id, kind, trade_code, seq, atomic, earned_at)
     values ($1, 'large-trade', $2, $3, $4, $5) on conflict do nothing`,
    [senior, d.code, d.seq, share.toString(), now],
  );
}

async function clawBack(client: pg.PoolClient, d: Dispute, rulingId: string, now: Date): Promise<void> {
  const { rows } = await client.query<{ id: string; staff_id: string; usd_cents: string | null; atomic: string | null }>(
    `insert into staff_pay_items (staff_id, kind, trade_code, seq, usd_cents, atomic, earned_at, source_item)
     select i.staff_id, 'clawback', i.trade_code, i.seq, -i.usd_cents, -i.atomic, $3, i.id
       from staff_pay_items i
      where i.trade_code = $1 and i.seq = $2 and i.kind <> 'clawback'
        and not exists (select 1 from staff_pay_items c where c.source_item = i.id)
     returning id, staff_id::text, usd_cents::text, atomic::text`,
    [d.code, d.seq, now],
  );
  for (const c of rows) {
    // The amounts as positive strings (the log takes non-negative amounts); never the trade.
    const detail: Record<string, string> = { staffId: c.staff_id, rulingId };
    if (c.usd_cents !== null) detail.usdCents = c.usd_cents.replace('-', '');
    await appendLog(client, { at: now, actor: { kind: 'system' }, tradeCode: null, action: 'pay.clawback', detail });
  }
}

/** The pay a dispute's save causes (see the module comment). Runs inside `saveDispute`'s transaction. */
export async function accrueDisputePay(client: pg.PoolClient, d: Dispute, now: Date): Promise<void> {
  const r1 = round1Ruling(d);
  if (r1 === null) return;
  await earn(client, d, r1, now);
  if (d.round === 2 && d.overturned === true && ROUND2_DONE.has(d.status) && d.ruling !== null) {
    await clawBack(client, d, d.ruling.id, now);
  }
}
