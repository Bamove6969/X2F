import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { withTx } from '../auth/hold.js';
import { COOKIE_ATTRS } from '../auth/device.js';
import { realmOf } from '../auth/sessions.js';
import { subkey, type Config } from '../config.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { appendLog } from '../log/append.js';
import type { MarketPrices } from '../price/market.js';
import { requireStaff, type StaffContext } from './guard.js';
import { consumeKeyTap } from './keyTap.js';

/**
 * Plan 4 Task 33 / J-12 (D-041..D-045): shifts, clock-out pay, payout addresses and the owner's pay
 * settings (migration 420). What a dispute earns, and the clawback, is `payAccrual.ts` (run by the
 * dispute store). The owner's rules, as the routes apply them:
 * - clock-in is the staff login (a shift per staff session, written by migration 420's triggers);
 * - only `POST /staff/v1/pay/clock-out` pays: it settles every unpaid item since the last paid
 *   clock-out (so a forgotten clock-out loses nothing), to an address the member pre-approved, and
 *   logs them out. Logging out, closing the app and an automatic logout pay nothing; an automatic
 *   logout is recorded on the shift as information only;
 * - the dispute pay is in US cents (the owner's numbers), converted to XMR at the clock-out's
 *   price; the large-trade shares and clawbacks are already in XMR. A net debt (clawbacks bigger
 *   than what was earned since) is not paid: it stays, carried to the next clock-out, and is shown
 *   to the owner as owed (clawback option A);
 * - the money itself does not move yet: the payout is recorded `waiting-send` until Plan 6 wires a
 *   payroll wallet (NEEDS_PLAN_6_PAYROLL_WALLET).
 */

export const XMR_ATOMIC = 1_000_000_000_000n;
/** Lead default: at most this many live payout addresses per staff member. */
export const MAX_PAYOUT_ADDRESSES = 5;

// ---------------------------------------------------------------------------------------------
// The payroll wallet tripwire

export const NEEDS_PLAN_6_PAYROLL_WALLET = 'NEEDS_PLAN_6_PAYROLL_WALLET';

export class PayrollWalletNotWiredError extends Error {
  readonly code = NEEDS_PLAN_6_PAYROLL_WALLET;
  constructor() {
    super(`${NEEDS_PLAN_6_PAYROLL_WALLET}: the payroll wallet's send is Plan 6's (key handling); nothing has moved`);
    this.name = 'PayrollWalletNotWiredError';
  }
}

/**
 * NEEDS_PLAN_6_PAYROLL_WALLET: the Monero send of one recorded payout (`staff_payouts`,
 * `waiting-send`) to its pre-approved address. Plan 4 Task 33 notes the fee wallet's spending key
 * stays offline (spec 6.6 Earnings), so the owner funds a payroll wallet whose key handling is the
 * lead's and Plan 6's. Until then this always throws and moves nothing. When it lands: send exactly
 * `amountAtomic` to the payout's stored address only, record the tx hash (`sent`) or `failed` in a
 * second transaction (the fee sweep's pending/settled pattern), and delete this tripwire with its
 * test (test/staff/pay.test.ts).
 *
 * Security review 12 Nov M2: before sending, the send must also re-check that the payout's address
 * is still the one its tap approved (`staff_payout_addresses.tap_id` -> `key_taps.intent`, whose
 * `address` must equal the stored address exactly) and that the address is still live
 * (`removed_at is null`); otherwise it marks the payout `failed` and sends nothing.
 */
export async function sendStaffPayout(_a: { address: string; amountAtomic: bigint }): Promise<{ txHash: string }> {
  throw new PayrollWalletNotWiredError();
}

// ---------------------------------------------------------------------------------------------
// The owner's pay settings

export interface PaySettings {
  /** US cents per completed dispute for a moderator; null = not set. */
  modDisputeUsdCents: number | null;
  /** US cents per completed dispute for a senior moderator; null = not set. */
  seniorDisputeUsdCents: number | null;
  /** A senior moderator's share of a large trade's X2F fee, basis points (1000 = 10%); null = not set. */
  seniorLargeTradeBp: number | null;
  /** A trade is large at or above this US dollar value (its value when the dispute opened); null = not set. */
  largeTradeThresholdUsd: number | null;
  /**
   * Owner 26 Nov 2026: a moderator's default share of X2F's fee on each trade whose dispute they
   * rule, basis points of the fee (10000 = 100% of the 1%); null = not set. With a share set, the
   * per-dispute cents above are the minimum a completed dispute pays.
   */
  modFeeBp: number | null;
  /** The same for a senior moderator. */
  seniorFeeBp: number | null;
  /** Owner 26 Nov 2026: US cents per completed dispute paid on top of the share, per role; null = none. */
  modFlatUsdCents: number | null;
  seniorFlatUsdCents: number | null;
}

const PAY_FIELDS = ['modDisputeUsdCents', 'seniorDisputeUsdCents', 'seniorLargeTradeBp', 'largeTradeThresholdUsd', 'modFeeBp', 'seniorFeeBp', 'modFlatUsdCents', 'seniorFlatUsdCents'] as const;
type PayField = (typeof PAY_FIELDS)[number];
const PAY_BOUNDS: Readonly<Record<PayField, readonly [number, number]>> = {
  modDisputeUsdCents: [0, 10_000_000],
  seniorDisputeUsdCents: [0, 10_000_000],
  seniorLargeTradeBp: [0, 10_000],
  largeTradeThresholdUsd: [1, 10_000_000],
  modFeeBp: [0, 10_000],
  seniorFeeBp: [0, 10_000],
  modFlatUsdCents: [0, 10_000_000],
  seniorFlatUsdCents: [0, 10_000_000],
};
/** The settings' log names (the column names, camel-cased). */
const PAY_LOG_FIELD: Readonly<Record<PayField, string>> = {
  modDisputeUsdCents: 'payModDisputeUsdCents',
  seniorDisputeUsdCents: 'paySeniorDisputeUsdCents',
  seniorLargeTradeBp: 'seniorLargeTradeBp',
  largeTradeThresholdUsd: 'largeTradeBonusThresholdUsd',
  modFeeBp: 'payModFeeBp',
  seniorFeeBp: 'paySeniorFeeBp',
  modFlatUsdCents: 'payModFlatUsdCents',
  seniorFlatUsdCents: 'paySeniorFlatUsdCents',
};

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
const PAY_SELECT = `select pay_mod_dispute_usd_cents::text, pay_senior_dispute_usd_cents::text, senior_large_trade_bp,
                           large_trade_bonus_threshold_usd, pay_mod_fee_bp, pay_senior_fee_bp,
                           pay_mod_flat_usd_cents::text, pay_senior_flat_usd_cents::text from settings where id = 1`;
const num = (v: string | number | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));
const paySettingsOf = (r: PayRow | undefined): PaySettings => ({
  modDisputeUsdCents: num(r?.pay_mod_dispute_usd_cents),
  seniorDisputeUsdCents: num(r?.pay_senior_dispute_usd_cents),
  seniorLargeTradeBp: num(r?.senior_large_trade_bp),
  largeTradeThresholdUsd: num(r?.large_trade_bonus_threshold_usd),
  modFeeBp: num(r?.pay_mod_fee_bp),
  seniorFeeBp: num(r?.pay_senior_fee_bp),
  modFlatUsdCents: num(r?.pay_mod_flat_usd_cents),
  seniorFlatUsdCents: num(r?.pay_senior_flat_usd_cents),
});

export async function getPaySettings(q: Queryable): Promise<PaySettings> {
  return paySettingsOf((await q.query<PayRow>(PAY_SELECT)).rows[0]);
}

const badRequest = (field?: string): ApiError => new ApiError(400, 'bad-request', field ? { field } : undefined);

/** The PUT body: all eight settings (each a whole number in bounds, or null) and the `tapId`. */
export function parsePaySettings(body: unknown): { next: PaySettings; tapId: string } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw badRequest();
  const r = body as Record<string, unknown>;
  if (Object.keys(r).sort().join(',') !== [...PAY_FIELDS, 'tapId'].sort().join(',')) throw badRequest();
  const next = {} as PaySettings;
  for (const f of PAY_FIELDS) {
    const v = r[f];
    if (v === null) {
      next[f] = null;
      continue;
    }
    const [lo, hi] = PAY_BOUNDS[f];
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < lo || v > hi) throw badRequest(f);
    next[f] = v;
  }
  if (typeof r.tapId !== 'string') throw badRequest('tapId');
  return { next, tapId: r.tapId };
}

/**
 * Saves the pay settings for the owner in `client`'s transaction: any change needs the tap (intent
 * `pay-settings` with the values after the change), and each changed field logs `settings.changed`.
 * Nothing changed: no tap needed, nothing logged. A new amount applies to disputes completed from
 * then on; items already earned keep theirs.
 */
export async function changePaySettings(
  client: pg.PoolClient,
  actor: Pick<StaffContext, 'accountId' | 'role'>,
  input: { next: PaySettings; tapId: string; sessionId?: string },
  now: Date,
): Promise<PaySettings> {
  const cur = paySettingsOf((await client.query<PayRow>(`${PAY_SELECT} for update`)).rows[0]);
  const changed = PAY_FIELDS.filter((f) => cur[f] !== input.next[f]);
  if (changed.length === 0) return cur;
  const tap = await consumeKeyTap(client, input.tapId, actor.accountId, { kind: 'pay-settings', ...input.next }, now, input.sessionId !== undefined ? { sessionId: input.sessionId } : {});
  const n = input.next;
  await client.query(
    `update settings set pay_mod_dispute_usd_cents = $1, pay_senior_dispute_usd_cents = $2, senior_large_trade_bp = $3,
            large_trade_bonus_threshold_usd = $4, pay_tap_id = $5, pay_set_at = $6, updated_at = $6,
            pay_mod_fee_bp = $7, pay_senior_fee_bp = $8, pay_mod_flat_usd_cents = $9, pay_senior_flat_usd_cents = $10 where id = 1`,
    [n.modDisputeUsdCents, n.seniorDisputeUsdCents, n.seniorLargeTradeBp, n.largeTradeThresholdUsd, tap.id, now, n.modFeeBp, n.seniorFeeBp, n.modFlatUsdCents, n.seniorFlatUsdCents],
  );
  for (const f of changed) {
    await appendLog(client, {
      at: now, actor: { kind: 'staff', id: actor.accountId, role: actor.role }, tradeCode: null, action: 'settings.changed',
      detail: { field: PAY_LOG_FIELD[f], from: cur[f], to: n[f] },
    });
  }
  return n;
}

// ---------------------------------------------------------------------------------------------
// One person's share of the fee (owner 26 Nov 2026)

/** The PUT body of `/staff/v1/pay/staff/:id`: `feeBp` (0-10000, or null for the role's default) and `tapId`. */
export function parseStaffPay(body: unknown): { feeBp: number | null; tapId: string } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw badRequest();
  const r = body as Record<string, unknown>;
  if (Object.keys(r).sort().join(',') !== 'feeBp,tapId') throw badRequest();
  const v = r.feeBp;
  if (v !== null && (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > 10_000)) throw badRequest('feeBp');
  if (typeof r.tapId !== 'string') throw badRequest('tapId');
  return { feeBp: v, tapId: r.tapId };
}

/**
 * Sets one moderator's or senior moderator's own share in `client`'s transaction, with a tap bound
 * to the person and the value (intent `staff-pay`), and logs `staff.pay-set` (from, to). The owner
 * and helpers earn no dispute pay, so their rows are refused (400, field `staffId`). The same value
 * again needs no tap and logs nothing. Applies to disputes completed from then on.
 */
export async function changeStaffPay(
  client: pg.PoolClient,
  actor: Pick<StaffContext, 'accountId' | 'role'>,
  input: { staffId: string; feeBp: number | null; tapId: string; sessionId?: string },
  now: Date,
): Promise<{ feeBp: number | null }> {
  const id = input.staffId.toLowerCase();
  const { rows } = await client.query<{ role: string; pay_fee_bp: number | null; removed: boolean }>(
    'select role, pay_fee_bp, removed_at is not null as removed from staff_members where account_id::text = $1 for update',
    [id],
  );
  const row = rows[0];
  if (row === undefined || row.removed) throw new ApiError(404, 'not-found');
  if (row.role !== 'mod' && row.role !== 'senior') throw badRequest('staffId');
  if (row.pay_fee_bp === input.feeBp) return { feeBp: row.pay_fee_bp };
  const tap = await consumeKeyTap(client, input.tapId, actor.accountId, { kind: 'staff-pay', accountId: id, feeBp: input.feeBp }, now, input.sessionId !== undefined ? { sessionId: input.sessionId } : {});
  await client.query('update staff_members set pay_fee_bp = $2, pay_tap_id = $3, pay_set_at = $4 where account_id::text = $1', [id, input.feeBp, tap.id, now]);
  await appendLog(client, {
    at: now, actor: { kind: 'staff', id: actor.accountId, role: actor.role }, tradeCode: null, action: 'staff.pay-set',
    detail: { staffId: id, from: row.pay_fee_bp, to: input.feeBp },
  });
  return { feeBp: input.feeBp };
}

// ---------------------------------------------------------------------------------------------
// The owner's audit of one person's work and hours (owner 26 Nov 2026)

/** The periods the audit offers, in days. */
export const AUDIT_DAYS: readonly number[] = [7, 30, 90, 365];

/**
 * One staff member's work and hours over the last `days`: their shifts with the minutes each lasted
 * (an open one counts to now; one whose session ran out ends then), every pay item they earned with
 * where it stands (unpaid, or paid and the payout's status), their payouts and the
 * totals. Staff names and trade codes only: no trader.
 */
export async function staffAudit(q: Queryable, staffId: string, days: number, now: Date) {
  const m = (await q.query<{ display_name: string; role: string; switched_off: boolean; pay_fee_bp: number | null }>(
    `select a.display_name, m.role, m.switched_off_at is not null as switched_off, m.pay_fee_bp
       from staff_members m join accounts a on a.id = m.account_id where m.account_id::text = $1`,
    [staffId],
  )).rows[0];
  if (m === undefined) throw new ApiError(404, 'not-found');
  const since = new Date(now.getTime() - days * 86_400_000);
  const shifts = (await q.query<{ clocked_in_at: Date; ended_at: Date | null; ended: string | null }>(
    `select sh.clocked_in_at,
            coalesce(sh.ended_at, case when s.expires_at <= $3 then s.expires_at end) as ended_at,
            coalesce(sh.ended, case when s.expires_at <= $3 then 'auto-logout' end) as ended
       from staff_shifts sh left join sessions s on s.id = sh.session_id
      where sh.staff_id::text = $1 and coalesce(sh.ended_at, $3) >= $2
      order by sh.clocked_in_at desc, sh.id limit 500`,
    [staffId, since, now],
  )).rows.map((r) => {
    const start = Math.max(r.clocked_in_at.getTime(), since.getTime());
    const end = (r.ended_at ?? now).getTime();
    return { clockedInAt: r.clocked_in_at.toISOString(), endedAt: r.ended_at?.toISOString() ?? null, ended: r.ended, minutes: Math.max(0, Math.floor((end - start) / 60_000)) };
  });
  const items = (await q.query<{ kind: string; trade_code: string | null; seq: number | null; round: number; usd_cents: string | null; atomic: string | null; earned_at: Date; payout_status: string | null; paid_at: Date | null }>(
    `select i.kind, i.trade_code, i.seq, i.round, i.usd_cents::text, i.atomic::text, i.earned_at,
            p.status as payout_status, p.at as paid_at
       from staff_pay_items i left join staff_payouts p on p.id = i.payout_id
      where i.staff_id::text = $1 and i.earned_at >= $2 order by i.earned_at desc, i.id limit 1000`,
    [staffId, since],
  )).rows;
  const payouts = (await q.query<{ at: Date; amount_atomic: string; status: string }>(
    'select at, amount_atomic::text, status from staff_payouts where staff_id::text = $1 and at >= $2 order by at desc, id limit 200',
    [staffId, since],
  )).rows;
  let usd = 0n;
  let atomic = 0n;
  let backUsd = 0n;
  let backAtomic = 0n;
  for (const i of items) {
    const u = i.usd_cents === null ? 0n : BigInt(i.usd_cents);
    const a = i.atomic === null ? 0n : BigInt(i.atomic);
    if (i.kind === 'clawback') {
      backUsd += u;
      backAtomic += a;
    } else {
      usd += u;
      atomic += a;
    }
  }
  return {
    staffId, displayName: m.display_name, role: m.role, switchedOff: m.switched_off, feeBp: m.pay_fee_bp, days,
    totals: {
      minutes: shifts.reduce((t, s) => t + s.minutes, 0),
      shifts: shifts.length,
      clockOuts: shifts.filter((s) => s.ended === 'clock-out').length,
      disputes: items.filter((i) => i.kind === 'dispute' && i.round === 1).length,
      appeals: items.filter((i) => i.kind === 'dispute' && i.round === 2).length,
      earnedUsdCents: usd.toString(), earnedAtomic: atomic.toString(),
      clawedBackUsdCents: backUsd.toString(), clawedBackAtomic: backAtomic.toString(),
    },
    shifts,
    items: items.map((i) => ({
      kind: i.kind, code: i.trade_code, seq: i.seq, round: i.round, usdCents: i.usd_cents, atomic: i.atomic, earnedAt: i.earned_at.toISOString(),
      status: i.payout_status !== null ? (i.payout_status === 'sent' ? 'paid' : i.payout_status) : 'unpaid',
      paidAt: i.paid_at?.toISOString() ?? null,
    })),
    payouts: payouts.map((p) => ({ at: p.at.toISOString(), amountAtomic: p.amount_atomic, status: p.status })),
  };
}

// ---------------------------------------------------------------------------------------------
// The pay ledger as one member sees it

interface ItemRow {
  id: string;
  kind: string;
  trade_code: string | null;
  seq: number | null;
  usd_cents: string | null;
  atomic: string | null;
  earned_at: Date;
}

/**
 * The member's unpaid items. `lock` takes them `for no key update` (security review S1): the
 * clock-out is already serialised by the `staff_members` row lock, and a stronger `for update` would
 * conflict with the `for key share` a clawback's `source_item` foreign key takes, deadlocking a
 * clock-out against an appeal's save that holds the activity log's lock.
 */
async function unpaidItems(q: Queryable, staffId: string, lock = false): Promise<ItemRow[]> {
  const { rows } = await q.query<ItemRow>(
    `select id::text, kind, trade_code, seq, usd_cents::text, atomic::text, earned_at
       from staff_pay_items where staff_id = $1 and payout_id is null order by earned_at, id${lock ? ' for no key update' : ''}`,
    [staffId],
  );
  return rows;
}

const sum = (rows: ItemRow[], k: 'usd_cents' | 'atomic'): bigint => rows.reduce((a, r) => a + (r[k] === null ? 0n : BigInt(r[k])), 0n);

/** What is due now: `pay` (a positive amount), `nothing-due`, `owed` (a net debt) or `no-price`. */
export type ClockOutDue = 'pay' | 'nothing-due' | 'owed' | 'no-price';

export interface ClockOutTotals {
  usdCents: bigint;
  atomic: bigint;
  usdCentsPerXmr: bigint | null;
  /** The net in atomic units at the price (negative when owed); null with no price for a dollar part. */
  amountAtomic: bigint | null;
  due: ClockOutDue;
}

/**
 * The net of `rows` at the USD price: dollar items converted at `usdCentsPerXmr` (rounded toward
 * zero), plus the XMR items. Pure.
 */
export function clockOutTotals(rows: ItemRow[], usdCentsPerXmr: bigint | null): ClockOutTotals {
  const usdCents = sum(rows, 'usd_cents');
  const atomic = sum(rows, 'atomic');
  if (usdCents !== 0n && usdCentsPerXmr === null) return { usdCents, atomic, usdCentsPerXmr, amountAtomic: null, due: 'no-price' };
  const amountAtomic = (usdCents === 0n ? 0n : (usdCents * XMR_ATOMIC) / usdCentsPerXmr!) + atomic;
  const due: ClockOutDue = amountAtomic > 0n ? 'pay' : amountAtomic === 0n ? 'nothing-due' : 'owed';
  return { usdCents, atomic, usdCentsPerXmr, amountAtomic, due };
}

function usdPrice(prices: MarketPrices): bigint | null {
  const q = prices.quote('USD');
  return q === null || q.usdCentsPerXmr <= 0n ? null : q.usdCentsPerXmr;
}

interface AddressRow {
  id: string;
  address: string;
  added_at: Date;
}
async function liveAddresses(q: Queryable, staffId: string): Promise<AddressRow[]> {
  const { rows } = await q.query<AddressRow>(
    'select id::text, address, added_at from staff_payout_addresses where staff_id = $1 and removed_at is null order by added_at, id',
    [staffId],
  );
  return rows;
}
const addressView = (a: AddressRow) => ({ id: a.id, address: a.address, addedAt: a.added_at.toISOString() });

const itemView = (r: ItemRow) => ({
  kind: r.kind, code: r.trade_code, seq: r.seq, usdCents: r.usd_cents, atomic: r.atomic, earnedAt: r.earned_at.toISOString(),
});

/** One member's pay page (`MyPay`): what is unpaid, recent payouts and shifts, and their addresses. */
async function myPayView(q: Queryable, staffId: string, now: Date) {
  const items = await unpaidItems(q, staffId);
  const payouts = await q.query<{ id: string; at: Date; amount_atomic: string; usd_cents: string; atomic: string; usd_cents_per_xmr: string | null; status: string; address_id: string }>(
    `select id::text, at, amount_atomic::text, usd_cents::text, atomic::text, usd_cents_per_xmr::text, status, address_id::text
       from staff_payouts where staff_id = $1 order by at desc, id limit 50`,
    [staffId],
  );
  // A shift whose session ran out but is not purged yet already reads as an automatic logout.
  const shifts = await q.query<{ clocked_in_at: Date; ended_at: Date | null; ended: string | null }>(
    `select sh.clocked_in_at,
            coalesce(sh.ended_at, case when s.expires_at <= $2 then s.expires_at end) as ended_at,
            coalesce(sh.ended, case when s.expires_at <= $2 then 'auto-logout' end) as ended
       from staff_shifts sh left join sessions s on s.id = sh.session_id
      where sh.staff_id = $1 order by sh.clocked_in_at desc, sh.ended_at desc nulls first, sh.id limit 50`,
    [staffId, now],
  );
  return {
    unpaid: { items: items.map(itemView), usdCents: sum(items, 'usd_cents').toString(), atomic: sum(items, 'atomic').toString() },
    payouts: payouts.rows.map((p) => ({
      id: p.id, at: p.at.toISOString(), amountAtomic: p.amount_atomic, usdCents: p.usd_cents, atomic: p.atomic,
      usdCentsPerXmr: p.usd_cents_per_xmr, status: p.status, addressId: p.address_id,
    })),
    shifts: shifts.rows.map((s) => ({ clockedInAt: s.clocked_in_at.toISOString(), endedAt: s.ended_at?.toISOString() ?? null, ended: s.ended })),
    addresses: (await liveAddresses(q, staffId)).map(addressView),
  };
}

const str = (v: bigint | null): string | null => (v === null ? null : v.toString());

// ---------------------------------------------------------------------------------------------
// The clock-out quote (security review S2, lead call): the POST pays exactly what the sheet showed

/** Lead default: a clock-out sheet's figures hold for 5 minutes. */
export const QUOTE_TTL_MS = 5 * 60_000;

interface QuoteBody {
  v: 1;
  staffId: string;
  sessionId: string;
  /** Review r2-m1: this sheet's nonce; only the session's newest one (`staff_shifts.latest_quote`) pays. */
  nonce: string;
  /** SHA-256 (hex) of the sorted ids of the unpaid items the sheet was made from. */
  items: string;
  /** The USD price used (US cents per XMR), or null when there was none. */
  price: string | null;
  expiresAt: string;
}

const itemsHash = (rows: ItemRow[]): string => createHash('sha256').update(rows.map((r) => r.id).sort().join(',')).digest('hex');
const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const quoteMac = (config: Config, body: string) => createHmac('sha256', subkey(config, 'pay-quote')).update(`pay-quote/${body}`).digest();

/** A signed quote: base64url(JSON) "." base64url(HMAC-SHA-256 under the server's `pay-quote` key). */
export function signQuote(config: Config, q: QuoteBody): string {
  const body = b64(JSON.stringify(q));
  return `${body}.${b64(quoteMac(config, body))}`;
}

/**
 * The quote's body when it is genuine and this member's for this session (else 400
 * `quote-invalid`), and not expired (409 `quote-expired`).
 */
export function openQuote(config: Config, quote: string, staffId: string, sessionId: string, now: Date): QuoteBody {
  const invalid = () => new ApiError(400, 'quote-invalid');
  const [body, mac, extra] = quote.split('.');
  if (body === undefined || mac === undefined || extra !== undefined) throw invalid();
  const want = quoteMac(config, body);
  const got = Buffer.from(mac, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) throw invalid();
  let q: QuoteBody;
  try {
    q = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as QuoteBody;
  } catch {
    throw invalid();
  }
  if (q.v !== 1 || typeof q.nonce !== 'string' || q.staffId !== staffId.toLowerCase() || q.sessionId !== sessionId.toLowerCase()) throw invalid();
  const ends = Date.parse(q.expiresAt);
  if (!Number.isFinite(ends)) throw invalid();
  if (now.getTime() >= ends) throw new ApiError(409, 'quote-expired');
  return q;
}

/** The clock-out sheet: the total, how it is made up, the addresses to choose from and its quote. */
async function clockOutPreview(q: Queryable, config: Config, staffId: string, sessionId: string, prices: MarketPrices, now: Date) {
  const items = await unpaidItems(q, staffId);
  const price = usdPrice(prices);
  const t = clockOutTotals(items, price);
  const expiresAt = new Date(now.getTime() + QUOTE_TTL_MS).toISOString();
  // Review r2-m1: this sheet replaces any earlier one of the session.
  const nonce = randomUUID();
  await q.query('update staff_shifts set latest_quote = $2 where session_id = $1 and staff_id = $3 and ended is null', [sessionId, nonce, staffId]);
  return {
    quote: signQuote(config, { v: 1, staffId: staffId.toLowerCase(), sessionId: sessionId.toLowerCase(), nonce, items: itemsHash(items), price: str(price), expiresAt }),
    expiresAt,
    due: t.due,
    disputes: items.filter((i) => i.kind === 'dispute').length,
    largeTrades: items.filter((i) => i.kind === 'large-trade').length,
    clawbacks: items.filter((i) => i.kind === 'clawback').length,
    usdCents: t.usdCents.toString(),
    atomic: t.atomic.toString(),
    usdCentsPerXmr: str(t.usdCentsPerXmr),
    amountAtomic: str(t.amountAtomic),
    addresses: (await liveAddresses(q, staffId)).map(addressView),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseClockOut(body: unknown): { quote: string; addressId: string | null } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw badRequest();
  const r = body as Record<string, unknown>;
  if (Object.keys(r).some((k) => k !== 'addressId' && k !== 'quote')) throw badRequest();
  if (typeof r.quote !== 'string' || r.quote.length === 0 || r.quote.length > 2048) throw badRequest('quote');
  if (r.addressId === undefined || r.addressId === null) return { quote: r.quote, addressId: null };
  if (typeof r.addressId !== 'string' || !UUID.test(r.addressId)) throw badRequest('addressId');
  return { quote: r.quote, addressId: r.addressId.toLowerCase() };
}

export interface ClockOutResult {
  due: ClockOutDue;
  payout: { id: string; amountAtomic: string; addressId: string; status: 'waiting-send' } | null;
}

/**
 * A correct clock-out in `client`'s transaction (D-041, D-045): locks the member's row and unpaid
 * items, checks they are exactly the ones the quote was made from (409 `quote-changed` otherwise:
 * the member sees the sheet again), works out the net at the quote's price, and when it is positive records one payout to the chosen
 * pre-approved address (400 `address-required` without one; 404 `address-unknown` for one that is
 * not theirs or was removed) and settles every unpaid item into it. Then the shift ends as
 * `clock-out` and the session is revoked. With nothing due, a debt or no price, nothing is paid and
 * the items wait for the next clock-out; the shift still ends.
 */
export async function clockOut(
  client: pg.PoolClient,
  staff: Pick<StaffContext, 'accountId' | 'role'>,
  sessionId: string,
  addressId: string | null,
  quote: Pick<QuoteBody, 'items' | 'price' | 'nonce'>,
  now: Date,
): Promise<ClockOutResult> {
  await client.query('select 1 from staff_members where account_id = $1 for update', [staff.accountId]);
  const items = await unpaidItems(client, staff.accountId, true);
  const shift = (await client.query<{ id: string; clocked_in_at: Date; latest_quote: string | null }>(
    "select id::text, clocked_in_at, latest_quote::text from staff_shifts where session_id = $1 and staff_id = $2 and ended is null for update",
    [sessionId, staff.accountId],
  )).rows[0];
  // Review r2-m1: only the session's newest sheet pays (an older one's price cannot be chosen).
  if (shift === undefined || shift.latest_quote !== quote.nonce) throw new ApiError(409, 'quote-changed');
  if (itemsHash(items) !== quote.items) throw new ApiError(409, 'quote-changed');
  const t = clockOutTotals(items, quote.price === null ? null : BigInt(quote.price));
  let payout: ClockOutResult['payout'] = null;
  if (t.due === 'pay') {
    if (addressId === null) throw new ApiError(400, 'address-required');
    const a = await client.query(
      'select 1 from staff_payout_addresses where id = $1 and staff_id = $2 and removed_at is null',
      [addressId, staff.accountId],
    );
    if ((a.rowCount ?? 0) === 0) throw new ApiError(404, 'address-unknown');
    const { rows } = await client.query<{ id: string }>(
      `insert into staff_payouts (staff_id, at, shift_id, address_id, usd_cents, usd_cents_per_xmr, atomic, amount_atomic)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id::text`,
      [staff.accountId, now, shift.id, addressId, t.usdCents.toString(), t.usdCents === 0n ? null : t.usdCentsPerXmr!.toString(),
        t.atomic.toString(), t.amountAtomic!.toString()],
    );
    const payoutId = rows[0]!.id;
    await client.query('update staff_pay_items set payout_id = $1 where id = any($2::uuid[])', [payoutId, items.map((i) => i.id)]);
    const detail: Record<string, string> = { staffId: staff.accountId.toLowerCase(), kind: 'clock-out', atomic: t.amountAtomic!.toString(), ref: payoutId };
    if (t.usdCents >= 0n) detail.usdCents = t.usdCents.toString();
    await appendLog(client, { at: now, actor: { kind: 'staff', id: staff.accountId, role: staff.role }, tradeCode: null, action: 'pay.paid', detail });
    payout = { id: payoutId, amountAtomic: t.amountAtomic!.toString(), addressId, status: 'waiting-send' };
  }
  // The shift ends as a correct clock-out (it exists: the quote check above found it).
  await client.query("update staff_shifts set ended = 'clock-out', ended_at = $2 where id = $1", [shift.id, now]);
  await appendLog(client, {
    at: now, actor: { kind: 'staff', id: staff.accountId, role: staff.role }, tradeCode: null, action: 'shift.clocked-out',
    detail: { shiftId: shift.id, minutes: Math.max(0, Math.floor((now.getTime() - shift.clocked_in_at.getTime()) / 60_000)) },
  });
  await client.query("update sessions set revoked_at = $2 where id = $1 and app = 'staff' and revoked_at is null", [sessionId, now]);
  return { due: t.due, payout };
}

// ---------------------------------------------------------------------------------------------
// Payout addresses

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{95}$/;

function parseAddressAdd(body: unknown): { address: string; tapId: string } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw badRequest();
  const r = body as Record<string, unknown>;
  if (Object.keys(r).sort().join(',') !== 'address,tapId') throw badRequest();
  if (typeof r.address !== 'string' || !ADDRESS.test(r.address)) throw badRequest('address');
  if (typeof r.tapId !== 'string') throw badRequest('tapId');
  return { address: r.address, tapId: r.tapId };
}

// ---------------------------------------------------------------------------------------------
// Routes

/**
 * The pay routes of the staff app:
 * - `GET /staff/v1/pay` (self): one's own pay page (unpaid items, payouts, shifts, addresses);
 * - `GET /staff/v1/pay/clock-out` (self): the clock-out sheet's figures;
 * - `POST /staff/v1/pay/clock-out` `{ addressId? }` (self): the correct clock-out (logs out);
 * - `POST /staff/v1/pay/addresses` `{ address, tapId }` (self, tap `payout-address` bound to the
 *   address): 400 `address-invalid` for an address that is not a standard address on this network,
 *   409 `address-exists`, 409 `too-many-addresses`; `DELETE /staff/v1/pay/addresses/:id` (self);
 * - `GET` and `PUT /staff/v1/pay/settings` (settings.write, the owner; tap `pay-settings`);
 * - `GET /staff/v1/pay/staff` (earnings.read, the owner): each member's unpaid net and whether they
 *   owe (the clawback debt kept when someone leaves).
 * NEEDS_DESIGN_CLOCK_OUT: the clock-out sheet, MyPay and PaySetup boards are not drawn (D-041 NOT
 * DRAWN); apps/staff-web has a plain first version only.
 */
export function staffPayRoutes(app: FastifyInstance): void {
  const self = { config: { perm: 'self' as const }, preHandler: requireStaff('self') };
  const owner = { config: { perm: 'settings.write' as const }, preHandler: requireStaff('settings.write') };
  const earnings = { config: { perm: 'earnings.read' as const }, preHandler: requireStaff('earnings.read') };

  app.get('/staff/v1/pay', self, async (req) => myPayView(req.server.deps.db, req.staff.accountId, req.server.deps.clock()));
  app.get('/staff/v1/pay/clock-out', self, async (req) => {
    const { db, config, prices, clock } = req.server.deps;
    return clockOutPreview(db, config, req.staff.accountId, req.auth.sessionId, prices, clock());
  });
  app.post('/staff/v1/pay/clock-out', self, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = parseClockOut(req.body);
    const { db, clock, config } = req.server.deps;
    const quote = openQuote(config, body.quote, req.staff.accountId, req.auth.sessionId, clock());
    const result = await withTx(db, (c) => clockOut(c, req.staff, req.auth.sessionId, body.addressId, quote, clock()));
    req.server.events.closeSession(req.staff.accountId, req.auth.sessionId);
    void reply.clearCookie(realmOf(req).cookie, COOKIE_ATTRS);
    return result;
  });

  app.post('/staff/v1/pay/addresses', self, async (req) => {
    const input = parseAddressAdd(req.body);
    const { db, clock, addresses } = req.server.deps;
    if ((await addresses.check(input.address)) !== 'ok') throw new ApiError(400, 'address-invalid');
    const now = clock();
    return withTx(db, async (c) => {
      await c.query('select 1 from staff_members where account_id = $1 for update', [req.staff.accountId]);
      const live = await liveAddresses(c, req.staff.accountId);
      // The tap first: nothing about the member's addresses is told to a request without it.
      const tap = await consumeKeyTap(c, input.tapId, req.staff.accountId, { kind: 'payout-address', address: input.address }, now, { sessionId: req.auth.sessionId });
      if (live.some((a) => a.address === input.address)) throw new ApiError(409, 'address-exists');
      if (live.length >= MAX_PAYOUT_ADDRESSES) throw new ApiError(409, 'too-many-addresses');
      const { rows } = await c.query<AddressRow>(
        'insert into staff_payout_addresses (staff_id, address, added_at, tap_id) values ($1, $2, $3, $4) returning id::text, address, added_at',
        [req.staff.accountId, input.address, now, tap.id],
      );
      const added = rows[0]!;
      await appendLog(c, { at: now, actor: { kind: 'staff', id: req.staff.accountId, role: req.staff.role }, tradeCode: null, action: 'pay.address-added', detail: { addressId: added.id } });
      return addressView(added);
    });
  });
  app.delete('/staff/v1/pay/addresses/:id', self, async (req) => {
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) throw new ApiError(404, 'address-unknown');
    const { db, clock } = req.server.deps;
    const now = clock();
    return withTx(db, async (c) => {
      // Security review S3: the same member lock as adding and clocking out, so a removal never
      // interleaves with a clock-out choosing that address.
      await c.query('select 1 from staff_members where account_id = $1 for update', [req.staff.accountId]);
      const r = await c.query(
        'update staff_payout_addresses set removed_at = $3 where id = $1 and staff_id = $2 and removed_at is null',
        [id.toLowerCase(), req.staff.accountId, now],
      );
      if ((r.rowCount ?? 0) === 0) throw new ApiError(404, 'address-unknown');
      await appendLog(c, { at: now, actor: { kind: 'staff', id: req.staff.accountId, role: req.staff.role }, tradeCode: null, action: 'pay.address-removed', detail: { addressId: id.toLowerCase() } });
      return { ok: true };
    });
  });

  app.get('/staff/v1/pay/settings', owner, async (req) => getPaySettings(req.server.deps.db));
  app.put('/staff/v1/pay/settings', owner, async (req) => {
    const input = parsePaySettings(req.body);
    const { db, clock } = req.server.deps;
    return withTx(db, (c) => changePaySettings(c, req.staff, { ...input, sessionId: req.auth.sessionId }, clock()));
  });
  // Owner 26 Nov 2026: one moderator's or senior moderator's own share of the fee (tap `staff-pay`).
  app.put('/staff/v1/pay/staff/:id', owner, async (req) => {
    const raw = (req.params as { id?: unknown }).id;
    if (typeof raw !== 'string' || !/^[0-9a-fA-F-]{36}$/.test(raw)) throw badRequest('id');
    const input = parseStaffPay(req.body);
    const { db, clock } = req.server.deps;
    return withTx(db, (c) => changeStaffPay(c, req.staff, { staffId: raw, ...input, sessionId: req.auth.sessionId }, clock()));
  });

  // Owner 26 Nov 2026: one staff member's work and hours, for the owner's audit.
  app.get('/staff/v1/pay/staff/:id/audit', earnings, async (req) => {
    const raw = (req.params as { id?: unknown }).id;
    if (typeof raw !== 'string' || !/^[0-9a-fA-F-]{36}$/.test(raw)) throw badRequest('id');
    const q = req.query as Record<string, unknown>;
    if (Object.keys(q).some((k) => k !== 'days')) throw badRequest();
    const days = q.days === undefined ? 30 : Number(q.days);
    if (!AUDIT_DAYS.includes(days)) throw badRequest('days');
    return staffAudit(req.server.deps.db, raw.toLowerCase(), days, req.server.deps.clock());
  });

  app.get('/staff/v1/pay/staff', earnings, async (req) => {
    const { rows } = await req.server.deps.db.query<{ staff_id: string; display_name: string; role: string; switched_off: boolean; usd_cents: string; atomic: string; pay_fee_bp: number | null }>(
      `select m.account_id::text as staff_id, a.display_name, m.role, m.switched_off_at is not null as switched_off, m.pay_fee_bp,
              coalesce(sum(i.usd_cents), 0)::text as usd_cents, coalesce(sum(i.atomic), 0)::text as atomic
         from staff_members m join accounts a on a.id = m.account_id
         left join staff_pay_items i on i.staff_id = m.account_id and i.payout_id is null
        where m.role <> 'owner'
        group by m.account_id, a.display_name, m.role, m.switched_off_at, m.pay_fee_bp
        order by a.display_name`,
    );
    const defaults = await getPaySettings(req.server.deps.db);
    const price = usdPrice(req.server.deps.prices);
    return {
      members: rows.map((r) => {
        const usd = BigInt(r.usd_cents);
        const atomic = BigInt(r.atomic);
        // Owed: the net is a debt. With no price, a dollar debt with no XMR to offset it still is.
        const net = price === null ? (usd < 0n && atomic <= 0n ? -1n : usd > 0n || atomic > 0n ? 1n : 0n) : (usd * XMR_ATOMIC) / price + atomic;
        return {
          staffId: r.staff_id, displayName: r.display_name, role: r.role, switchedOff: r.switched_off,
          unpaidUsdCents: r.usd_cents, unpaidAtomic: r.atomic, owed: net < 0n,
          // The person's own share of the fee (null = their role's), and the share that applies.
          feeBp: r.pay_fee_bp,
          effectiveFeeBp: r.pay_fee_bp ?? (r.role === 'senior' ? defaults.seniorFeeBp : r.role === 'mod' ? defaults.modFeeBp : null),
        };
      }),
    };
  });
}
