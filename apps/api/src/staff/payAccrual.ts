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
 * - owner 26 Nov 2026, the share of the fee: the proposer also earns their share (basis points of
 *   the 1% fee, their own `staff_members.pay_fee_bp`, else their role's default) of the trade's X2F
 *   fee when the ruling makes the poster pay it, as a `fee-share` item in XMR. With a share set,
 *   the role's cents per dispute are a minimum: when the share (in dollars at the trade's value at
 *   dispute opening) is below it, or nothing (a full refund takes no fee), the `dispute` item pays
 *   the minimum and no share is set aside; otherwise the share alone pays and the `dispute` item
 *   carries no amount. With no share set, pay is the cents per dispute as before. Logged `pay.earned`;
 * - owner 26 Nov 2026: the appeal's own ruling (round 2) earns its decider their pay the same way
 *   (their share of the final fee, flat amount, minimum); it is never clawed back (owner question, not ruled);
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
  pay_mod_fee_bp: number | null;
  pay_senior_fee_bp: number | null;
  pay_mod_flat_usd_cents: string | null;
  pay_senior_flat_usd_cents: string | null;
}

/**
 * The dispute pay for one ruling (pure). The share of the fee (`feeBp`, basis points of the 1%) in
 * XMR, plus the flat amount in US cents; when the minimum is set and the share (in dollars at the
 * trade's value at opening) plus the flat amount is below it, the minimum alone pays instead. No fee
 * charged (a full refund) means no share. `usdCents` null = no dollar amount.
 */
export function disputePay(a: {
  feeBp: number | null; flatUsdCents: bigint | null; minUsdCents: bigint | null; feeAtomic: bigint; feeCharged: boolean; tradeUsdCents: bigint;
}): { shareAtomic: bigint; usdCents: bigint | null; minimum: boolean } {
  const bp = a.feeBp === null ? 0n : BigInt(a.feeBp);
  const shareAtomic = a.feeCharged ? (a.feeAtomic * bp) / 10_000n : 0n;
  // X2F's fee is 1% of the trade (X2F_FEE_BPS), so the share in cents is value * 1% * bp / 10000.
  const shareCents = shareAtomic > 0n ? (a.tradeUsdCents * bp) / 1_000_000n : 0n;
  const flat = a.flatUsdCents ?? 0n;
  if (a.minUsdCents !== null && shareCents + flat < a.minUsdCents) return { shareAtomic: 0n, usdCents: a.minUsdCents, minimum: true };
  return { shareAtomic, usdCents: a.flatUsdCents, minimum: false };
}

async function roleOf(client: pg.PoolClient, id: string | null): Promise<string | null> {
  if (id === null) return null;
  const { rows } = await client.query<{ role: string }>('select role from staff_members where account_id::text = $1', [id.toLowerCase()]);
  return rows[0]?.role ?? null;
}

/**
 * What `r`'s proposer earns for deciding round `round` of `d`. `feeCharged`: whether the ruling
 * makes the poster pay X2F's 1% (round 1: its own outcome; round 2: the final fee of the dispute).
 */
async function earn(client: pg.PoolClient, d: Dispute, r: RulingDraft, round: 1 | 2, feeCharged: boolean, now: Date): Promise<void> {
  // Already earned (the usual case on a later save): nothing to read or write.
  const done = await client.query("select 1 from staff_pay_items where kind = 'dispute' and trade_code = $1 and seq = $2 and round = $3", [d.code, d.seq, round]);
  if ((done.rowCount ?? 0) > 0) return;
  const proposerRole = await roleOf(client, r.proposer);
  if (proposerRole !== 'mod' && proposerRole !== 'senior') return;
  const s = (await client.query<PayRow>(
    `select pay_mod_dispute_usd_cents::text, pay_senior_dispute_usd_cents::text, senior_large_trade_bp, large_trade_bonus_threshold_usd,
            pay_mod_fee_bp, pay_senior_fee_bp, pay_mod_flat_usd_cents::text, pay_senior_flat_usd_cents::text
       from settings where id = 1`,
  )).rows[0];
  const rate = proposerRole === 'senior' ? s?.pay_senior_dispute_usd_cents : s?.pay_mod_dispute_usd_cents;
  const own = (await client.query<{ pay_fee_bp: number | null }>('select pay_fee_bp from staff_members where account_id::text = $1', [r.proposer.toLowerCase()])).rows[0];
  const feeBp = own?.pay_fee_bp ?? (proposerRole === 'senior' ? s?.pay_senior_fee_bp : s?.pay_mod_fee_bp) ?? null;
  const flat = proposerRole === 'senior' ? s?.pay_senior_flat_usd_cents : s?.pay_mod_flat_usd_cents;
  const tradeFee = (await client.query<{ fee_atomic: string }>('select fee_atomic::text from trades where code = $1', [d.code])).rows[0];
  const big = (v: string | null | undefined) => (v === null || v === undefined ? null : BigInt(v));
  const pay = disputePay({
    feeBp, flatUsdCents: big(flat), minUsdCents: big(rate),
    feeAtomic: tradeFee ? BigInt(tradeFee.fee_atomic) : 0n, feeCharged: feeCharged && tradeFee !== undefined, tradeUsdCents: d.usdCents,
  });
  await client.query(
    `insert into staff_pay_items (staff_id, kind, trade_code, seq, round, usd_cents, earned_at)
     values ($1, 'dispute', $2, $3, $4, $5, $6) on conflict do nothing`,
    [r.proposer, d.code, d.seq, round, pay.usdCents?.toString() ?? null, now],
  );
  if (pay.shareAtomic > 0n) {
    await client.query(
      `insert into staff_pay_items (staff_id, kind, trade_code, seq, round, atomic, earned_at)
       values ($1, 'fee-share', $2, $3, $4, $5, $6) on conflict do nothing`,
      [r.proposer, d.code, d.seq, round, pay.shareAtomic.toString(), now],
    );
  }
  if (feeBp !== null || flat !== null) {
    const detail: Record<string, string | number | boolean | null> = { staffId: r.proposer.toLowerCase(), feeBp, minimum: pay.minimum, round };
    if (pay.shareAtomic > 0n) detail.atomic = pay.shareAtomic.toString();
    if (pay.usdCents !== null) detail.usdCents = pay.usdCents.toString();
    await appendLog(client, { at: now, actor: { kind: 'system' }, tradeCode: null, action: 'pay.earned', detail });
  }

  // The senior moderators' large-trade share (D-043): round 1 only.
  if (round !== 1) return;
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
      where i.trade_code = $1 and i.seq = $2 and i.round = 1 and i.kind <> 'clawback'
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
  await earn(client, d, r1, 1, rulingFee({ status: 'published', round: 1, ruling: r1, round1: null }) === 'poster-pays', now);
  if (d.round === 2 && ROUND2_DONE.has(d.status) && d.ruling !== null) {
    // Owner 26 Nov 2026: whoever decides the appeal earns their pay for it too, on the dispute's final fee.
    await earn(client, d, d.ruling, 2, rulingFee(d) === 'poster-pays', now);
    if (d.overturned === true) await clawBack(client, d, d.ruling.id, now);
  }
}
