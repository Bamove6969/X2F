import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { withTx } from '../auth/hold.js';
import { COOKIE_ATTRS } from '../auth/device.js';
import { realmOf } from '../auth/sessions.js';
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
}

const PAY_FIELDS = ['modDisputeUsdCents', 'seniorDisputeUsdCents', 'seniorLargeTradeBp', 'largeTradeThresholdUsd'] as const;
type PayField = (typeof PAY_FIELDS)[number];
const PAY_BOUNDS: Readonly<Record<PayField, readonly [number, number]>> = {
  modDisputeUsdCents: [0, 10_000_000],
  seniorDisputeUsdCents: [0, 10_000_000],
  seniorLargeTradeBp: [0, 10_000],
  largeTradeThresholdUsd: [1, 10_000_000],
};
/** The settings' log names (the column names, camel-cased). */
const PAY_LOG_FIELD: Readonly<Record<PayField, string>> = {
  modDisputeUsdCents: 'payModDisputeUsdCents',
  seniorDisputeUsdCents: 'paySeniorDisputeUsdCents',
  seniorLargeTradeBp: 'seniorLargeTradeBp',
  largeTradeThresholdUsd: 'largeTradeBonusThresholdUsd',
};

interface PayRow {
  pay_mod_dispute_usd_cents: string | null;
  pay_senior_dispute_usd_cents: string | null;
  senior_large_trade_bp: number | null;
  large_trade_bonus_threshold_usd: number | null;
}
const PAY_SELECT = `select pay_mod_dispute_usd_cents::text, pay_senior_dispute_usd_cents::text, senior_large_trade_bp,
                           large_trade_bonus_threshold_usd from settings where id = 1`;
const num = (v: string | number | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));
const paySettingsOf = (r: PayRow | undefined): PaySettings => ({
  modDisputeUsdCents: num(r?.pay_mod_dispute_usd_cents),
  seniorDisputeUsdCents: num(r?.pay_senior_dispute_usd_cents),
  seniorLargeTradeBp: num(r?.senior_large_trade_bp),
  largeTradeThresholdUsd: num(r?.large_trade_bonus_threshold_usd),
});

export async function getPaySettings(q: Queryable): Promise<PaySettings> {
  return paySettingsOf((await q.query<PayRow>(PAY_SELECT)).rows[0]);
}

const badRequest = (field?: string): ApiError => new ApiError(400, 'bad-request', field ? { field } : undefined);

/** The PUT body: all four settings (each a whole number in bounds, or null) and the `tapId`. */
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
            large_trade_bonus_threshold_usd = $4, pay_tap_id = $5, pay_set_at = $6, updated_at = $6 where id = 1`,
    [n.modDisputeUsdCents, n.seniorDisputeUsdCents, n.seniorLargeTradeBp, n.largeTradeThresholdUsd, tap.id, now],
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

async function unpaidItems(q: Queryable, staffId: string, lock = false): Promise<ItemRow[]> {
  const { rows } = await q.query<ItemRow>(
    `select id::text, kind, trade_code, seq, usd_cents::text, atomic::text, earned_at
       from staff_pay_items where staff_id = $1 and payout_id is null order by earned_at, id${lock ? ' for update' : ''}`,
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

/** The clock-out sheet: the total, how it is made up and the addresses to choose from. */
async function clockOutPreview(q: Queryable, staffId: string, prices: MarketPrices) {
  const items = await unpaidItems(q, staffId);
  const t = clockOutTotals(items, usdPrice(prices));
  return {
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

function parseClockOut(body: unknown): { addressId: string | null } {
  if (body === undefined || body === null) return { addressId: null };
  if (typeof body !== 'object' || Array.isArray(body)) throw badRequest();
  const r = body as Record<string, unknown>;
  const keys = Object.keys(r);
  if (keys.some((k) => k !== 'addressId')) throw badRequest();
  if (r.addressId === undefined || r.addressId === null) return { addressId: null };
  if (typeof r.addressId !== 'string' || !UUID.test(r.addressId)) throw badRequest('addressId');
  return { addressId: r.addressId.toLowerCase() };
}

export interface ClockOutResult {
  due: ClockOutDue;
  payout: { id: string; amountAtomic: string; addressId: string; status: 'waiting-send' } | null;
}

/**
 * A correct clock-out in `client`'s transaction (D-041, D-045): locks the member's row and unpaid
 * items, works out the net at the price, and when it is positive records one payout to the chosen
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
  usdCentsPerXmr: bigint | null,
  now: Date,
): Promise<ClockOutResult> {
  await client.query('select 1 from staff_members where account_id = $1 for update', [staff.accountId]);
  const items = await unpaidItems(client, staff.accountId, true);
  const t = clockOutTotals(items, usdCentsPerXmr);
  let payout: ClockOutResult['payout'] = null;
  const shift = (await client.query<{ id: string; clocked_in_at: Date }>(
    "select id::text, clocked_in_at from staff_shifts where session_id = $1 and staff_id = $2 and ended is null for update",
    [sessionId, staff.accountId],
  )).rows[0];
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
      [staff.accountId, now, shift?.id ?? null, addressId, t.usdCents.toString(), t.usdCents === 0n ? null : t.usdCentsPerXmr!.toString(),
        t.atomic.toString(), t.amountAtomic!.toString()],
    );
    const payoutId = rows[0]!.id;
    await client.query('update staff_pay_items set payout_id = $1 where id = any($2::uuid[])', [payoutId, items.map((i) => i.id)]);
    const detail: Record<string, string> = { staffId: staff.accountId.toLowerCase(), kind: 'clock-out', atomic: t.amountAtomic!.toString(), ref: payoutId };
    if (t.usdCents >= 0n) detail.usdCents = t.usdCents.toString();
    await appendLog(client, { at: now, actor: { kind: 'staff', id: staff.accountId, role: staff.role }, tradeCode: null, action: 'pay.paid', detail });
    payout = { id: payoutId, amountAtomic: t.amountAtomic!.toString(), addressId, status: 'waiting-send' };
  }
  if (shift) {
    await client.query("update staff_shifts set ended = 'clock-out', ended_at = $2 where id = $1", [shift.id, now]);
    await appendLog(client, {
      at: now, actor: { kind: 'staff', id: staff.accountId, role: staff.role }, tradeCode: null, action: 'shift.clocked-out',
      detail: { shiftId: shift.id, minutes: Math.max(0, Math.floor((now.getTime() - shift.clocked_in_at.getTime()) / 60_000)) },
    });
  }
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
  app.get('/staff/v1/pay/clock-out', self, async (req) => clockOutPreview(req.server.deps.db, req.staff.accountId, req.server.deps.prices));
  app.post('/staff/v1/pay/clock-out', self, async (req: FastifyRequest, reply: FastifyReply) => {
    const { addressId } = parseClockOut(req.body);
    const { db, clock, prices } = req.server.deps;
    const result = await withTx(db, (c) => clockOut(c, req.staff, req.auth.sessionId, addressId, usdPrice(prices), clock()));
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

  app.get('/staff/v1/pay/staff', earnings, async (req) => {
    const { rows } = await req.server.deps.db.query<{ staff_id: string; display_name: string; role: string; switched_off: boolean; usd_cents: string; atomic: string }>(
      `select m.account_id::text as staff_id, a.display_name, m.role, m.switched_off_at is not null as switched_off,
              coalesce(sum(i.usd_cents), 0)::text as usd_cents, coalesce(sum(i.atomic), 0)::text as atomic
         from staff_members m join accounts a on a.id = m.account_id
         left join staff_pay_items i on i.staff_id = m.account_id and i.payout_id is null
        where m.role <> 'owner'
        group by m.account_id, a.display_name, m.role, m.switched_off_at
        order by a.display_name`,
    );
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
        };
      }),
    };
  });
}
