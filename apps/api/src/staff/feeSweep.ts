import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { addOwnerAlert } from '../alerts.js';
import { withTx } from '../auth/hold.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { appendLog } from '../log/append.js';
import { pushOwnerAlert } from '../push/ownerAlert.js';
import type { PushKind } from '../push/send.js';
import { requireStaff, type StaffContext } from './guard.js';
import { consumeKeyTap } from './keyTap.js';
import type { PayrollWallet } from './payrollWallet.js';

/**
 * Plan 4 Task 9 / B-006, reworked by the owner on 26 Nov 2026 ("anything that goes over a certain
 * amount gets sent to the first wallet as well and everything under stays in wallet 2 for paying
 * staff"): every completed trade pays half of its 1% to the hot payroll wallet (wallet 2,
 * `payrollWallet.ts`), which pays staff at clock-out (`payrollSend.ts`). When its balance reaches
 * the owner's cap (the threshold), the excess moves automatically to X2F's fee wallet (wallet 1,
 * watch-only here: its spend key stays offline), leaving the amount to keep (the float) for staff
 * pay, and the owner gets a notification. Settings in migration 431; they ship unset (sweep off).
 *
 * The maths (`planFeeSweep`): due when the spendable balance is at or above the cap; the amount
 * moved is the balance less the amount to keep, so the payroll wallet keeps exactly that (the
 * network fee comes off the moved amount). The cap must be above the amount to keep, so a due sweep
 * always moves something, and a payroll wallet hovering at its cap is not swept on every pass.
 *
 * The destination is the stored address (`fee_sweep_cold_address`, the name from 431), which must be
 * X2F's fee wallet (`X2F_FEE_WALLET`): the PUT refuses any other (400 `not-fee-wallet`) and the pass
 * re-checks it before sending (`not-fee-wallet`). Without a payroll wallet connected
 * (`X2F_PAYROLL_WALLET_RPC_URL` unset) nothing runs the pass and the view says `walletWired: false`.
 */

export interface FeeSweepConfig {
  /** At or above this spendable balance the sweep runs (atomic units); null = sweep off. */
  thresholdAtomic: bigint | null;
  /** What the hot wallet keeps: one day plus one night of staff pay (atomic units). */
  floatAtomic: bigint | null;
  /** Where the excess goes: X2F's fee wallet's standard address (only the address: its spend key stays offline). */
  coldAddress: string | null;
}

export type FeeSweepPlan =
  | { due: false; reason: 'off' | 'below-threshold' }
  | { due: true; balanceAtomic: bigint; amountAtomic: bigint; keepAtomic: bigint };

/** The sweep decision for a spendable (unlocked) balance. Pure; throws on a negative balance. */
export function planFeeSweep(cfg: FeeSweepConfig, unlockedAtomic: bigint): FeeSweepPlan {
  if (unlockedAtomic < 0n) throw new RangeError('balance must not be negative');
  if (cfg.thresholdAtomic === null || cfg.floatAtomic === null || cfg.coldAddress === null) return { due: false, reason: 'off' };
  if (cfg.thresholdAtomic <= cfg.floatAtomic) throw new RangeError('threshold must be above the float');
  if (unlockedAtomic < cfg.thresholdAtomic) return { due: false, reason: 'below-threshold' };
  return { due: true, balanceAtomic: unlockedAtomic, amountAtomic: unlockedAtomic - cfg.floatAtomic, keepAtomic: cfg.floatAtomic };
}

/** No payroll wallet is connected, so a due sweep moves nothing (it alerts the owner). */
export class FeeWalletNotWiredError extends Error {
  constructor() {
    super('the payroll wallet is not connected; nothing has moved');
    this.name = 'FeeWalletNotWiredError';
  }
}

/** Not the fee wallet: the stored destination is not `X2F_FEE_WALLET`, so nothing is sent. */
export class NotFeeWalletError extends Error {
  constructor() {
    super('the sweep destination is not X2F\'s fee wallet; nothing has moved');
    this.name = 'NotFeeWalletError';
  }
}

interface Row {
  fee_sweep_threshold_atomic: string | null;
  fee_sweep_float_atomic: string | null;
  fee_sweep_cold_address: string | null;
  fee_sweep_set_at: Date | null;
}

const SELECT = `select fee_sweep_threshold_atomic::text, fee_sweep_float_atomic::text, fee_sweep_cold_address, fee_sweep_set_at
                  from settings where id = 1`;

const big = (v: string | null): bigint | null => (v === null ? null : BigInt(v));
const cfgOf = (r: Row | undefined): FeeSweepConfig =>
  r ? { thresholdAtomic: big(r.fee_sweep_threshold_atomic), floatAtomic: big(r.fee_sweep_float_atomic), coldAddress: r.fee_sweep_cold_address } : { thresholdAtomic: null, floatAtomic: null, coldAddress: null };

/** The sweep settings; `forShare` locks the row for the caller's transaction (a concurrent save waits). */
export async function getFeeSweepConfig(q: Queryable, opts: { forShare?: boolean } = {}): Promise<FeeSweepConfig & { setAt: Date | null }> {
  const r = (await q.query<Row>(opts.forShare ? `${SELECT} for share` : SELECT)).rows[0];
  return { ...cfgOf(r), setAt: r?.fee_sweep_set_at ?? null };
}

// ---------------------------------------------------------------------------------------------
// The sweep pass

export interface FeeSweepDeps {
  db: pg.Pool;
  clock: () => Date;
  /** The payroll wallet (`payrollWallet.ts`): its spendable balance, and the send of a due sweep. */
  wallet: { unlockedAtomic(): Promise<bigint>; transfer?: PayrollWallet['transfer'] };
  /** `X2F_FEE_WALLET`: the only address a sweep may go to (null: none set, every sweep refused). */
  feeWallet: string | null;
  /** The send (tests only override it); the wallet's `transfer`, the network fee off the amount, by default. */
  send?: (a: { coldAddress: string; amountAtomic: bigint }) => Promise<{ txHash: string; feeAtomic?: bigint | null }>;
  /** The owner's phone push (`app.push`); in-app alerts are written either way. */
  push?: { send(accountId: string, kind: PushKind): Promise<boolean> };
}

export type FeeSweepResult =
  | { outcome: 'off' | 'below-threshold' | 'busy' | 'held-after-failure' | 'held-unfinished' }
  | { outcome: 'sent'; amountAtomic: bigint; keepAtomic: bigint; txHash: string }
  | { outcome: 'failed'; amountAtomic: bigint; keepAtomic: bigint; reason: FeeSweepFailReason };

/**
 * Why an attempt failed. `not-wired`: no payroll wallet send; `not-fee-wallet`: the stored address
 * is not X2F's fee wallet (`X2F_FEE_WALLET`, or none is set); `send-error`: the send threw or returned
 * no tx hash; `settings-changed`: the owner saved the sweep settings after the pass started (a new
 * address, the sweep off, or any other save: `fee_sweep_set_at` moved), so it did not send (review
 * F2, R2); `settings-unread`: the settings could not be read again before the send, so it did not
 * send. Only `send-error` follows a send call.
 */
export type FeeSweepFailReason = 'not-wired' | 'not-fee-wallet' | 'send-error' | 'settings-changed' | 'settings-unread';

const HEX64 = /^[0-9a-f]{64}$/;
const LOCK_KEY = 'x2f-fee-sweep';

/**
 * One sweep pass. Off or below the threshold: nothing. Due, in three steps so the send never runs
 * inside an open transaction:
 * 1. one transaction records the attempt as `pending` in `fee_sweeps` and alerts the owner
 *    (`fee-sweep-due`: the balance, the amount and what stays), then commits (and pushes);
 * 2. the send runs, with no transaction open;
 * 3. a second transaction settles the attempt (`sent` with its tx hash, or `failed`), logs it
 *    (`treasury.swept` or `treasury.sweep-failed`) and on a failure alerts the owner again
 *    (`fee-sweep-failed`).
 * Step 1 reads the settings `for share`, so a concurrent save waits for it; the lock ends with
 * step 1's commit, and the wallet's balance is read before the transaction so a hung wallet RPC
 * never holds it (review R3). Just before the send the settings are read again `for share` in a separate short
 * transaction: if the settings were saved since step 1 (`fee_sweep_set_at` moved, the sweep is off
 * or the address differs), nothing is sent and the attempt is settled `failed` (`settings-changed`,
 * review F2 and R2: a sweep sized from an old float would leave the hot wallet short). Nothing is
 * held across the send itself (review R1, accepted): a save that commits between that re-read's
 * commit and the wallet's broadcast is not seen, so the coins go to the address the pass re-read,
 * seconds earlier.
 * The phone pushes are best-effort: a push error is swallowed, so it never stops the pass or leaves
 * the attempt pending (review F3; the in-app alert is written either way).
 * If the process dies or step 3 fails after the send, the attempt stays `pending`: its result is
 * unknown, so no pass sends again (`held-unfinished`) until the owner saves the sweep settings
 * again, as after a failure (`held-after-failure`, no repeat alerts every pass). One pass at a time
 * on the site: a session advisory lock held across the three steps; if releasing it fails, the
 * connection is destroyed rather than returned to the pool still holding it (review F4).
 */
export async function runFeeSweep(d: FeeSweepDeps): Promise<FeeSweepResult> {
  const transfer = d.wallet.transfer?.bind(d.wallet);
  const send =
    d.send ??
    (async (a: { coldAddress: string; amountAtomic: bigint }) => {
      if (transfer === undefined) throw new FeeWalletNotWiredError();
      // The network fee comes off the moved amount: the payroll wallet keeps exactly the float.
      return transfer({ address: a.coldAddress, amountAtomic: a.amountAtomic, feeFromAmount: true });
    });
  const client = await d.db.connect();
  let locked = false;
  try {
    locked = (await client.query<{ ok: boolean }>('select pg_try_advisory_lock(hashtext($1)) as ok', [LOCK_KEY])).rows[0]?.ok === true;
    if (!locked) return { outcome: 'busy' };

    // Step 1: decide and record the attempt. The wallet is asked first, before the transaction: a
    // slow or hung wallet RPC must never hold the settings share lock, which would block every
    // owner settings save until it returned (review R3).
    const unlockedAtomic = await d.wallet.unlockedAtomic();
    const now = d.clock();
    await client.query('begin');
    let started: { id: string; coldAddress: string; setAt: Date | null; plan: Extract<FeeSweepPlan, { due: true }> };
    try {
      const cfg = await getFeeSweepConfig(client, { forShare: true });
      const plan = planFeeSweep(cfg, unlockedAtomic);
      if (!plan.due) {
        await client.query('rollback');
        return { outcome: plan.reason };
      }
      const last = (await client.query<{ outcome: string; at: Date }>('select outcome, at from fee_sweeps order by id desc limit 1')).rows[0];
      // OWNER QUESTION p11-77 (review F1): how a held (pending or failed) sweep resumes. As built, any
      // settings save after the attempt (a later `fee_sweep_set_at`) lifts the hold, even an
      // unrelated threshold change, and an identical re-save (no change, no tap) does not. Left as
      // built until the owner answers p11-77; do not change this rule without that answer.
      if (last && last.outcome !== 'sent' && (cfg.setAt === null || last.at.getTime() >= cfg.setAt.getTime())) {
        await client.query('rollback');
        return { outcome: last.outcome === 'pending' ? 'held-unfinished' : 'held-after-failure' };
      }
      const { rows } = await client.query<{ id: string }>(
        `insert into fee_sweeps (at, balance_atomic, amount_atomic, keep_atomic, outcome) values ($1, $2, $3, $4, 'pending') returning id::text`,
        [now, plan.balanceAtomic.toString(), plan.amountAtomic.toString(), plan.keepAtomic.toString()],
      );
      // COPY-UNSIGNED: the owner's alert texts (Claude Design words the StaffSettings "Fee wallet" section).
      await addOwnerAlert(client, 'fee-sweep-due', { ...amountsOf(plan), message: 'The payroll wallet reached your cap: moving the extra to the fee wallet' }, now);
      await client.query('commit');
      started = { id: rows[0]!.id, coldAddress: cfg.coldAddress!, setAt: cfg.setAt, plan };
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
    await bestEffortPush(d, 'fee-sweep-due');

    // Step 2: the settings again, `for share` in a separate short transaction, right before the send
    // (review F2); then the send, outside any transaction and under no lock (review R1: the window
    // between the re-read's commit and the broadcast is accepted).
    const { plan } = started;
    const failed = (reason: FeeSweepFailReason) => ({ outcome: 'failed' as const, amountAtomic: plan.amountAtomic, keepAtomic: plan.keepAtomic, reason });
    let result: Extract<FeeSweepResult, { outcome: 'sent' | 'failed' }>;
    let networkFeeAtomic: bigint | null = null;
    const recheck = await settingsStillAllow(client, started).then(
      (ok): FeeSweepFailReason | null => (ok ? null : 'settings-changed'),
      (): FeeSweepFailReason => 'settings-unread',
    );
    if (recheck !== null) {
      result = failed(recheck);
    } else if (d.feeWallet === null || started.coldAddress !== d.feeWallet) {
      // Owner 26 Nov: the excess only ever goes to X2F's fee wallet.
      result = failed('not-fee-wallet');
    } else {
      try {
        const sent = await send({ coldAddress: started.coldAddress, amountAtomic: plan.amountAtomic });
        if (typeof sent.txHash !== 'string' || !HEX64.test(sent.txHash)) throw new Error('send returned no tx hash');
        networkFeeAtomic = typeof sent.feeAtomic === 'bigint' && sent.feeAtomic >= 0n ? sent.feeAtomic : null;
        result = { outcome: 'sent', amountAtomic: plan.amountAtomic, keepAtomic: plan.keepAtomic, txHash: sent.txHash };
      } catch (e) {
        result = failed(e instanceof FeeWalletNotWiredError ? 'not-wired' : 'send-error');
      }
    }

    // Step 3: settle the attempt.
    const done = d.clock();
    const amountAtomic = plan.amountAtomic.toString();
    await withTx(d.db, async (c) => {
      const upd = await c.query(`update fee_sweeps set outcome = $2, tx_hash = $3, settled_at = $4, network_fee_atomic = $5 where id = $1 and outcome = 'pending'`, [
        started.id, result.outcome, result.outcome === 'sent' ? result.txHash : null, done, networkFeeAtomic?.toString() ?? null,
      ]);
      if (upd.rowCount !== 1) throw new Error('fee sweep attempt is no longer pending');
      if (result.outcome === 'failed') {
        await addOwnerAlert(c, 'fee-sweep-failed', { ...amountsOf(plan), reason: result.reason, message: 'Moving the payroll wallet\'s extra to the fee wallet did not go through: nothing moved' }, done);
      }
      // Last before the commit (the log lock is held only for the commit, as trades/store.ts).
      await appendLog(c, {
        at: done, actor: { kind: 'system' }, tradeCode: null,
        ...(result.outcome === 'sent'
          ? { action: 'treasury.swept' as const, detail: { amountAtomic, txHash: result.txHash } }
          : { action: 'treasury.sweep-failed' as const, detail: { amountAtomic, reason: result.reason } }),
      });
    });
    if (result.outcome === 'failed') await bestEffortPush(d, 'fee-sweep-failed');
    return result;
  } finally {
    let unlockError: Error | undefined;
    if (locked) {
      await client.query('select pg_advisory_unlock(hashtext($1))', [LOCK_KEY]).catch((e: unknown) => {
        unlockError = e instanceof Error ? e : new Error('advisory unlock failed');
      });
    }
    // A connection whose unlock failed may still hold the lock: destroy it (release with an error)
    // so every later pass is not `busy` until the pool happens to close it (review F4).
    client.release(unlockError);
  }
}

/**
 * Step 2's check (review F2, R2): reads the settings `for share` in a short transaction on the
 * pass's connection; true while the sweep is still on, the cold address is the one step 1 read and
 * the settings were not saved since (`fee_sweep_set_at` unchanged: every save moves it, so a new
 * float or threshold stops the send too, as the attempt was sized from the old ones).
 */
async function settingsStillAllow(client: pg.PoolClient, started: { coldAddress: string; setAt: Date | null }): Promise<boolean> {
  await client.query('begin');
  try {
    const now = await getFeeSweepConfig(client, { forShare: true });
    await client.query('commit');
    return now.thresholdAtomic !== null && now.coldAddress === started.coldAddress && (now.setAt?.getTime() ?? null) === (started.setAt?.getTime() ?? null);
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  }
}

/** The owner's phone push, best-effort (review F3): the in-app alert is already written. */
async function bestEffortPush(d: FeeSweepDeps, kind: 'fee-sweep-due' | 'fee-sweep-failed'): Promise<void> {
  if (!d.push) return;
  await pushOwnerAlert({ db: d.db, push: d.push }, kind).catch(() => undefined);
}

const amountsOf = (p: Extract<FeeSweepPlan, { due: true }>) => ({
  balanceAtomic: p.balanceAtomic.toString(), amountAtomic: p.amountAtomic.toString(), keepAtomic: p.keepAtomic.toString(),
});

// ---------------------------------------------------------------------------------------------
// The owner's settings: GET and PUT /staff/v1/fee-sweep

export interface FeeSweepView {
  thresholdAtomic: string | null;
  floatAtomic: string | null;
  coldAddress: string | null;
  /** True while a threshold is set. */
  on: boolean;
  /** False while no payroll wallet is connected: a due sweep alerts the owner and moves nothing. */
  walletWired: boolean;
  /** The latest attempt, or null (`pending`: sent or being sent, its result not yet recorded). */
  lastSweep: { at: string; amountAtomic: string; keepAtomic: string; outcome: 'pending' | 'sent' | 'failed'; txHash: string | null } | null;
}

async function viewOf(q: Queryable, walletWired: boolean): Promise<FeeSweepView> {
  const c = await getFeeSweepConfig(q);
  const last = (await q.query<{ at: Date; amount_atomic: string; keep_atomic: string; outcome: 'pending' | 'sent' | 'failed'; tx_hash: string | null }>(
    'select at, amount_atomic::text, keep_atomic::text, outcome, tx_hash from fee_sweeps order by id desc limit 1',
  )).rows[0];
  return {
    thresholdAtomic: c.thresholdAtomic?.toString() ?? null,
    floatAtomic: c.floatAtomic?.toString() ?? null,
    coldAddress: c.coldAddress,
    on: c.thresholdAtomic !== null,
    walletWired,
    lastSweep: last ? { at: last.at.toISOString(), amountAtomic: last.amount_atomic, keepAtomic: last.keep_atomic, outcome: last.outcome, txHash: last.tx_hash } : null,
  };
}

const ATOMIC = /^(0|[1-9][0-9]{0,29})$/;
const COLD_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{95}$/;
const badRequest = (field?: string): ApiError => new ApiError(400, 'bad-request', field ? { field } : undefined);

/**
 * The PUT body: all three values (each may be null) and the `tapId` of a `fee-sweep` tap bound to
 * exactly them. A threshold needs the float and the address, and must be above the float.
 */
export function parseFeeSweepChange(body: unknown): { next: FeeSweepConfig; tapId: string } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw badRequest();
  const r = body as Record<string, unknown>;
  const keys = Object.keys(r).sort();
  if (keys.join(',') !== 'coldAddress,floatAtomic,tapId,thresholdAtomic') throw badRequest();
  const amount = (k: string): bigint | null => {
    const v = r[k];
    if (v === null) return null;
    if (typeof v !== 'string' || !ATOMIC.test(v)) throw badRequest(k);
    return BigInt(v);
  };
  const thresholdAtomic = amount('thresholdAtomic');
  const floatAtomic = amount('floatAtomic');
  const coldAddress = r.coldAddress;
  if (coldAddress !== null && (typeof coldAddress !== 'string' || !COLD_ADDRESS.test(coldAddress))) throw badRequest('coldAddress');
  if (typeof r.tapId !== 'string') throw badRequest('tapId');
  if (thresholdAtomic !== null) {
    if (thresholdAtomic === 0n) throw badRequest('thresholdAtomic');
    if (floatAtomic === null) throw badRequest('floatAtomic');
    if (coldAddress === null) throw badRequest('coldAddress');
    if (thresholdAtomic <= floatAtomic) throw badRequest('thresholdAtomic');
  }
  return { next: { thresholdAtomic, floatAtomic, coldAddress: coldAddress as string | null }, tapId: r.tapId };
}

const str = (v: bigint | null): string | null => (v === null ? null : v.toString());

/**
 * Saves the sweep settings for the owner in `client`'s transaction: the tap (intent `fee-sweep`
 * with the new values) is consumed for any change; each changed field logs `settings.changed`
 * (the amounts from and to; the address by its field only, never its value). Nothing changed →
 * no tap needed, nothing logged.
 */
export async function changeFeeSweep(
  client: pg.PoolClient,
  actor: Pick<StaffContext, 'accountId' | 'role'>,
  input: { next: FeeSweepConfig; tapId: string; sessionId?: string },
  now: Date,
): Promise<void> {
  const cur = cfgOf((await client.query<Row>(`${SELECT} for update`)).rows[0]);
  const { next } = input;
  const fields = [
    ['feeSweepThresholdAtomic', str(cur.thresholdAtomic), str(next.thresholdAtomic)],
    ['feeSweepFloatAtomic', str(cur.floatAtomic), str(next.floatAtomic)],
    ['feeSweepColdAddress', cur.coldAddress, next.coldAddress],
  ] as const;
  const changed = fields.filter(([, a, b]) => a !== b);
  if (changed.length === 0) return;
  const intent = { kind: 'fee-sweep' as const, thresholdAtomic: str(next.thresholdAtomic), floatAtomic: str(next.floatAtomic), coldAddress: next.coldAddress };
  const tap = await consumeKeyTap(client, input.tapId, actor.accountId, intent, now, input.sessionId !== undefined ? { sessionId: input.sessionId } : {});
  await client.query(
    `update settings set fee_sweep_threshold_atomic = $1, fee_sweep_float_atomic = $2, fee_sweep_cold_address = $3,
            fee_sweep_tap_id = $4, fee_sweep_set_at = $5, updated_at = $5 where id = 1`,
    [intent.thresholdAtomic, intent.floatAtomic, intent.coldAddress, tap.id, now],
  );
  for (const [field, from, to] of changed) {
    const detail = field === 'feeSweepColdAddress' ? { field } : { field, from, to };
    await appendLog(client, { at: now, actor: { kind: 'staff', id: actor.accountId, role: actor.role }, tradeCode: null, action: 'settings.changed', detail });
  }
}

/**
 * `GET /staff/v1/fee-sweep` → `FeeSweepView`; `PUT /staff/v1/fee-sweep` `{ thresholdAtomic,
 * floatAtomic, coldAddress, tapId }` → the view after it (perm `settings.write`, the owner). A cold
 * address that is not a valid standard address on this network is 400 `address-invalid`; a missing
 * or wrong tap 403 `tap-invalid`.
 * NEEDS_DESIGN_FEE_WALLET: the StaffSettings "Fee wallet" section (B-006 is NOT DRAWN) is Claude
 * Design's to draw; apps/staff-web is not on this line yet.
 */
export function staffFeeSweepRoutes(app: FastifyInstance): void {
  const perm = 'settings.write' as const;
  const opts = { config: { perm }, preHandler: requireStaff(perm) };
  const wired = (req: { server: FastifyInstance }) => req.server.deps.payrollWallet !== undefined;
  app.get('/staff/v1/fee-sweep', opts, async (req) => viewOf(req.server.deps.db, wired(req)));
  app.put('/staff/v1/fee-sweep', opts, async (req) => {
    const input = parseFeeSweepChange(req.body);
    const { db, clock, addresses, config } = req.server.deps;
    if (input.next.coldAddress !== null && (await addresses.check(input.next.coldAddress)) !== 'ok') throw new ApiError(400, 'address-invalid');
    // Owner 26 Nov: the excess goes to X2F's fee wallet only.
    if (input.next.coldAddress !== null && input.next.coldAddress !== (config.feeWallet ?? null)) throw new ApiError(400, 'not-fee-wallet');
    await withTx(db, (c) => changeFeeSweep(c, req.staff, { ...input, sessionId: req.auth.sessionId }, clock()));
    return viewOf(db, wired(req));
  });
}
