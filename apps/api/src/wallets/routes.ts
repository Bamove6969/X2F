import { addressEnd, addressHash, type ConfirmAction } from '@x2f/accounts';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type pg from 'pg';
import { addAlert } from '../alerts.js';
import { requireConfirm } from '../auth/confirm.js';
import { requireSession } from '../auth/sessions.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import type { RetentionJob } from '../retention.js';

/** The wallet apps a person can pick when adding a wallet (spec 6.4). */
export const WALLET_APPS = ['cake', 'edge', 'feather', 'monerujo', 'stack', 'monero-gui-cli', 'ledger-trezor', 'other'] as const;
export type WalletApp = (typeof WALLET_APPS)[number];

/** The opt-in wait before a newly added wallet can receive payouts, and before switching the wait off takes effect. */
export const PAYOUT_WAIT_MS = 24 * 3_600_000;
/** A removed wallet's address is kept this long (then nulled by `purgeRemovedWalletAddresses`). */
export const REMOVED_ADDRESS_RETENTION_MS = 90 * 24 * 3_600_000;
export const LABEL_MAX = 40;

/** A payout wallet as the API shows it: never a balance. */
export interface Wallet {
  id: string;
  app: WalletApp;
  label: string;
  address: string;
  addressEnd: string;
  usableFrom: Date;
  /** `usableFrom <= now`: false while the 24-hour wait runs. */
  usable: boolean;
}

/** The account columns that hold the 24-hour wait. */
export interface PayoutWaitRow {
  payout_wait: boolean;
  payout_wait_off_at: Date | null;
}

/** The wait applies while it is on and any scheduled switch-off has not yet arrived. */
export function payoutWaitActive(row: PayoutWaitRow, now: Date): boolean {
  return row.payout_wait && (row.payout_wait_off_at === null || now.getTime() < row.payout_wait_off_at.getTime());
}

/**
 * The wait as the person sees it: `enabled` while it applies, and `offAt` when a switch-off is
 * scheduled but not yet in effect. (For Task 11's `me.payoutWait`; same shape.)
 */
export function payoutWaitState(row: PayoutWaitRow, now: Date): { enabled: boolean; offAt: string | null } {
  const enabled = payoutWaitActive(row, now);
  return { enabled, offAt: enabled && row.payout_wait_off_at !== null ? row.payout_wait_off_at.toISOString() : null };
}

interface WalletRow {
  id: string;
  app: WalletApp;
  label: string;
  address: string;
  usable_from: Date;
}

function toWallet(r: WalletRow, now: Date): Wallet {
  return {
    id: r.id, app: r.app, label: r.label, address: r.address, addressEnd: addressEnd(r.address),
    usableFrom: r.usable_from, usable: r.usable_from.getTime() <= now.getTime(),
  };
}

const toJson = (w: Wallet) => ({ ...w, usableFrom: w.usableFrom.toISOString() });

const WALLET_COLUMNS = 'id, app, label, address, usable_from';

/** The account's open (not removed) wallets, oldest first. */
async function openWallets(db: Queryable, accountId: string, now: Date): Promise<Wallet[]> {
  const { rows } = await db.query<WalletRow>(
    `select ${WALLET_COLUMNS} from wallets where account_id = $1 and removed_at is null order by created_at, id`,
    [accountId],
  );
  return rows.map((r) => toWallet(r, now));
}

/** The wallets that may receive a payout now (open and past any wait). Plan 3 calls this when a buyer picks one. */
export async function usableWallets(db: Queryable, accountId: string, now: Date): Promise<Wallet[]> {
  const { rows } = await db.query<WalletRow>(
    `select ${WALLET_COLUMNS} from wallets
      where account_id = $1 and removed_at is null and usable_from <= $2
      order by created_at, id`,
    [accountId, now],
  );
  return rows.map((r) => toWallet(r, now));
}

/** Nulls the address of every wallet removed more than 90 days ago (P2-M4). */
export const purgeRemovedWalletAddresses: RetentionJob = {
  name: 'purgeRemovedWalletAddresses',
  async run(db: pg.Pool, now: Date): Promise<number> {
    const { rowCount } = await db.query(
      'update wallets set address = null where removed_at < $1 and address is not null',
      [new Date(now.getTime() - REMOVED_ADDRESS_RETENTION_MS)],
    );
    return rowCount ?? 0;
  },
};

/** What the add-wallet body was checked to be; the address hash is computed here, once (R17). */
interface WalletInput {
  app: WalletApp;
  label: string;
  /** Trimmed: exactly the address that is confirmed and stored. */
  address: string;
  action: Extract<ConfirmAction, { kind: 'add-wallet' }>;
}

const walletInputs = new WeakMap<FastifyRequest, WalletInput>();
const waitInputs = new WeakMap<FastifyRequest, { enabled: boolean }>();

function bodyOf(req: FastifyRequest): Record<string, unknown> {
  const body = req.body;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'bad-request');
  return body as Record<string, unknown>;
}

// C0 and C1 control characters (and DEL): never part of a label shown back in lists and alerts.
const CONTROL = /\p{Cc}/u;

/**
 * preHandler between `requireSession` and `requireConfirm` (R17): every check that can refuse the
 * request runs here, before a confirm token is looked at, so a refused request never uses one up.
 * `app` from the list, `label` 1-40 characters once trimmed, `address` trimmed and checked by the
 * validator (`invalid` or wrong network → 400 `address-invalid`, `integrated` → 400
 * `address-integrated`), and not already listed (409 `wallet-exists`; the unique index decides races).
 */
const checkWalletInput: preHandlerAsyncHookHandler = async function (req) {
  const deps = req.server.deps;
  const body = bodyOf(req);
  const { app, label, address } = body;
  if (typeof app !== 'string' || !(WALLET_APPS as readonly string[]).includes(app)) throw new ApiError(400, 'bad-request');
  if (typeof label !== 'string' || typeof address !== 'string') throw new ApiError(400, 'bad-request');
  const cleanLabel = label.trim();
  const labelLength = [...cleanLabel].length;
  if (labelLength < 1 || labelLength > LABEL_MAX || CONTROL.test(cleanLabel)) throw new ApiError(400, 'bad-request');
  const clean = address.trim();
  const verdict = await deps.addresses.check(clean);
  if (verdict === 'integrated') throw new ApiError(400, 'address-integrated');
  if (verdict !== 'ok') throw new ApiError(400, 'address-invalid');
  const listed = await deps.db.query(
    'select 1 from wallets where account_id = $1 and address = $2 and removed_at is null',
    [req.auth.accountId, clean],
  );
  if (listed.rows.length > 0) throw new ApiError(409, 'wallet-exists');
  walletInputs.set(req, {
    app: app as WalletApp,
    label: cleanLabel,
    address: clean,
    action: { kind: 'add-wallet', addressHash: await addressHash(clean), addressEnd: addressEnd(clean) },
  });
};

function walletInput(req: FastifyRequest): WalletInput {
  const input = walletInputs.get(req);
  if (!input) throw new Error('wallet input was not checked');
  return input;
}

/** The onboarding exemption covers the account's first wallet only (on top of the session's window). */
async function firstWalletOnly(req: FastifyRequest): Promise<boolean> {
  const { rows } = await req.server.deps.db.query<{ had_wallet: boolean }>('select had_wallet from accounts where id = $1', [
    req.auth.accountId,
  ]);
  return rows[0]?.had_wallet === false;
}

async function addHandler(req: FastifyRequest, reply: FastifyReply) {
  const deps = req.server.deps;
  const input = walletInput(req);
  // R17: store exactly the address whose action was confirmed (or exempted); the hash is not recomputed.
  const confirmed = req.confirmedAction;
  if (confirmed?.kind !== 'add-wallet' || confirmed.addressHash !== input.action.addressHash) {
    throw new Error('confirmed action does not match the wallet');
  }
  // `requireConfirm` let a request without a token through only under the first-wallet exemption.
  const exempted = bodyOf(req).confirmToken === undefined;
  const now = deps.clock();
  const client = await deps.db.connect();
  let wallet: Wallet;
  try {
    await client.query('begin');
    try {
      const { rows } = await client.query<PayoutWaitRow & { had_wallet: boolean }>(
        'select payout_wait, payout_wait_off_at, had_wallet from accounts where id = $1 for update',
        [req.auth.accountId],
      );
      const account = rows[0]!;
      // Two tokenless first wallets in parallel: the row lock lets the first through; the second
      // finds `had_wallet` set and needs a token like any later wallet.
      if (exempted && account.had_wallet) throw new ApiError(403, 'confirm-required', { action: 'add-wallet' });
      const waits = account.had_wallet && payoutWaitActive(account, now);
      const usableFrom = waits ? new Date(now.getTime() + PAYOUT_WAIT_MS) : now;
      let inserted: WalletRow;
      try {
        const res = await client.query<WalletRow>(
          `insert into wallets (account_id, app, label, address, created_at, usable_from)
           values ($1, $2, $3, $4, $5, $6) returning ${WALLET_COLUMNS}`,
          [req.auth.accountId, input.app, input.label, input.address, now, usableFrom],
        );
        inserted = res.rows[0]!;
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new ApiError(409, 'wallet-exists');
        throw e;
      }
      await client.query('update accounts set had_wallet = true where id = $1', [req.auth.accountId]);
      wallet = toWallet(inserted, now);
      await addAlert(
        client, req.auth.accountId, 'wallet-added',
        { app: wallet.app, label: wallet.label, addressEnd: wallet.addressEnd, usableFrom: usableFrom.toISOString() }, now,
      );
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
  } finally {
    client.release();
  }
  return reply.code(201).send(toJson(wallet));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Removal cannot redirect money, so it needs no confirm; it also cancels a wallet still waiting. */
async function removeHandler(req: FastifyRequest, reply: FastifyReply) {
  const deps = req.server.deps;
  const { id } = req.params as { id: string };
  if (!UUID.test(id)) throw new ApiError(404, 'not-found');
  const { rows } = await deps.db.query(
    'update wallets set removed_at = $3 where id = $1 and account_id = $2 and removed_at is null returning id',
    [id, req.auth.accountId, deps.clock()],
  );
  if (rows.length === 0) throw new ApiError(404, 'not-found');
  return reply.code(204).send();
}

const checkWaitInput: preHandlerAsyncHookHandler = async function (req) {
  const { enabled } = bodyOf(req);
  if (typeof enabled !== 'boolean') throw new ApiError(400, 'bad-request');
  waitInputs.set(req, { enabled });
};

const waitOffConfirm = requireConfirm({ kind: 'payout-wait-off' });

async function waitRow(db: Queryable, accountId: string, lock = false): Promise<PayoutWaitRow> {
  const { rows } = await db.query<PayoutWaitRow>(
    `select payout_wait, payout_wait_off_at from accounts where id = $1${lock ? ' for update' : ''}`,
    [accountId],
  );
  return rows[0]!;
}

/** Switching off changes something only while the wait applies and no switch-off is scheduled. */
const switchOffPending = (row: PayoutWaitRow, now: Date) => payoutWaitActive(row, now) && row.payout_wait_off_at === null;

/**
 * Turning the wait off needs a `payout-wait-off` token (no onboarding exemption), but only when it
 * would change something: asking while the wait is already off or already scheduled to end is a no-op.
 */
const confirmIfSwitchingOff: preHandlerAsyncHookHandler = async function (req, reply) {
  const { enabled } = waitInputs.get(req)!;
  if (enabled) return;
  const deps = req.server.deps;
  if (!switchOffPending(await waitRow(deps.db, req.auth.accountId), deps.clock())) return;
  await waitOffConfirm.call(req.server, req, reply);
};

async function waitHandler(req: FastifyRequest) {
  const deps = req.server.deps;
  const { enabled } = waitInputs.get(req)!;
  const now = deps.clock();
  const client = await deps.db.connect();
  try {
    await client.query('begin');
    try {
      const row = await waitRow(client, req.auth.accountId, true);
      let next: PayoutWaitRow = row;
      if (enabled) {
        // On at once; a scheduled switch-off is cancelled.
        next = { payout_wait: true, payout_wait_off_at: null };
        await client.query('update accounts set payout_wait = true, payout_wait_off_at = null where id = $1', [req.auth.accountId]);
      } else if (switchOffPending(row, now)) {
        // The state changed since the check (it was switched on in parallel): a token is still needed.
        if (req.confirmedAction?.kind !== 'payout-wait-off') throw new ApiError(403, 'confirm-required', { action: 'payout-wait-off' });
        const offAt = new Date(now.getTime() + PAYOUT_WAIT_MS);
        next = { payout_wait: true, payout_wait_off_at: offAt };
        await client.query('update accounts set payout_wait_off_at = $2 where id = $1', [req.auth.accountId, offAt]);
        await addAlert(client, req.auth.accountId, 'payout-wait-off-scheduled', { offAt: offAt.toISOString() }, now);
      }
      await client.query('commit');
      return payoutWaitState(next, now);
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
  } finally {
    client.release();
  }
}

/**
 * `GET /v1/wallets`, `POST /v1/wallets`, `DELETE /v1/wallets/:id` and
 * `PUT /v1/account/security/payout-wait`. Full trader sessions only (R3: staff and owner accounts
 * never hold payout wallets).
 */
export function walletRoutes(app: FastifyInstance): void {
  const session = requireSession({ kinds: ['trader'] });
  app.get('/v1/wallets', { preHandler: session }, async (req) => {
    const deps = req.server.deps;
    return (await openWallets(deps.db, req.auth.accountId, deps.clock())).map(toJson);
  });
  app.post(
    '/v1/wallets',
    {
      preHandler: [
        session,
        checkWalletInput,
        requireConfirm((req) => walletInput(req).action, { onboarding: firstWalletOnly }),
      ],
    },
    addHandler,
  );
  app.delete('/v1/wallets/:id', { preHandler: session }, removeHandler);
  app.put('/v1/account/security/payout-wait', { preHandler: [session, checkWaitInput, confirmIfSwitchingOff] }, waitHandler);
}
