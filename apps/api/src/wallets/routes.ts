import { addressEnd, addressHash, type ConfirmAction } from '@x2f/accounts';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type pg from 'pg';
import { addAlert } from '../alerts.js';
import { STRONG_CONFIRM_METHODS, redeemConfirm, type ConfirmMethod } from '../auth/confirm.js';
import { requireSession } from '../auth/sessions.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import type { RetentionJob } from '../retention.js';

/** The wallet apps a person can pick when adding a wallet (spec 6.4). */
export const WALLET_APPS = ['cake', 'edge', 'feather', 'monerujo', 'stack', 'monero-gui-cli', 'ledger-trezor', 'other'] as const;
export type WalletApp = (typeof WALLET_APPS)[number];

/** How long a wallet confirmed with a password (or password and TOTP) waits before it can receive payouts. */
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
  /** `usableFrom <= now`: false while the 24-hour wait of a password-confirmed wallet runs. */
  usable: boolean;
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

function bodyOf(req: FastifyRequest): Record<string, unknown> {
  const body = req.body;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'bad-request');
  return body as Record<string, unknown>;
}

// Control characters (C0, C1, DEL) and format characters (bidi overrides such as U+202E, zero-width
// characters): never part of a label shown back in lists and alerts.
const CONTROL = /[\p{Cc}\p{Cf}]/u;

/**
 * preHandler after `requireSession` (R17): every check that can refuse the request runs here,
 * before a confirm token is looked at, so a refused request never uses one up.
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

/**
 * preHandler after `checkWalletInput`: decides whether this add is the first-wallet exemption (no
 * token, the creating session's onboarding window, `had_wallet = false`) or needs a token; a
 * missing token outside the exemption → 403 `confirm-required`. A token is NOT used up here:
 * `addHandler` redeems it inside its transaction, so a lost race (409), a database error or a
 * failed alert rolls the redemption back with the wallet (M1).
 */
const walletConfirm: preHandlerAsyncHookHandler = async function (req) {
  if (req.auth.level === 'recovery') throw new ApiError(403, 'recovery-session');
  if (bodyOf(req).confirmToken !== undefined) return;
  const until = req.auth.onboardingUntil;
  const inWindow = until !== null && until.getTime() > req.server.deps.clock().getTime();
  if (inWindow && (await firstWalletOnly(req))) return;
  throw new ApiError(403, 'confirm-required', { action: 'add-wallet' });
};

async function addHandler(req: FastifyRequest, reply: FastifyReply) {
  const deps = req.server.deps;
  const input = walletInput(req);
  const raw = bodyOf(req).confirmToken;
  // `walletConfirm` let a request without a token through only under the first-wallet exemption.
  const exempted = raw === undefined;
  const now = deps.clock();
  const client = await deps.db.connect();
  let wallet: Wallet;
  try {
    await client.query('begin');
    try {
      const { rows } = await client.query<{ had_wallet: boolean }>(
        'select had_wallet from accounts where id = $1 for update',
        [req.auth.accountId],
      );
      const account = rows[0]!;
      // Two tokenless first wallets in parallel: the row lock lets the first through; the second
      // finds `had_wallet` set and needs a token like any later wallet.
      if (exempted && account.had_wallet) throw new ApiError(403, 'confirm-required', { action: 'add-wallet' });
      // R17: the token must be for exactly the checked, trimmed address (hash computed once, in
      // checkWalletInput). Redeemed in this transaction: a rollback below leaves it unused (M1).
      // A present but non-string token (number, null, object) is invalid, never "missing".
      let method: ConfirmMethod | null = null;
      if (!exempted) {
        method = await redeemConfirm({ db: client, clock: deps.clock }, req, input.action, typeof raw === 'string' ? raw : '');
      }
      req.confirmedAction = input.action;
      // Owner, 2026-10-23: the first wallet during onboarding and a wallet confirmed with PGP, a
      // passkey or a security key are usable at once; one confirmed with a password waits 24 hours.
      // `method` is what the redeemed token recorded, never anything in this request.
      const waits = method !== null && !STRONG_CONFIRM_METHODS.includes(method);
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
        {
          app: wallet.app, label: wallet.label, addressEnd: wallet.addressEnd, usableFrom: usableFrom.toISOString(),
          confirmedWith: method ?? 'onboarding',
        },
        now,
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

/**
 * Removal cannot redirect money, so it needs no confirm; it also cancels a wallet still waiting.
 * It always writes a `wallet-removed` alert (owner, 2026-10-23), in the same transaction, carrying
 * display details only: the app, the label and the end of the address, never all of it.
 */
async function removeHandler(req: FastifyRequest, reply: FastifyReply) {
  const deps = req.server.deps;
  const { id } = req.params as { id: string };
  if (!UUID.test(id)) throw new ApiError(404, 'not-found');
  const now = deps.clock();
  const client = await deps.db.connect();
  try {
    await client.query('begin');
    try {
      const { rows } = await client.query<{ app: WalletApp; label: string; address: string }>(
        `update wallets set removed_at = $3 where id = $1 and account_id = $2 and removed_at is null
         returning app, label, address`,
        [id, req.auth.accountId, now],
      );
      const removed = rows[0];
      if (!removed) throw new ApiError(404, 'not-found');
      await addAlert(
        client, req.auth.accountId, 'wallet-removed',
        { app: removed.app, label: removed.label, addressEnd: addressEnd(removed.address) }, now,
      );
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
  } finally {
    client.release();
  }
  return reply.code(204).send();
}

/**
 * `GET /v1/wallets`, `POST /v1/wallets` and `DELETE /v1/wallets/:id`. (The opt-in
 * `PUT /v1/account/security/payout-wait` was retired 2026-10-23.) Full trader sessions only (R3: staff and owner accounts
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
        walletConfirm,
      ],
    },
    addHandler,
  );
  app.delete('/v1/wallets/:id', { preHandler: session }, removeHandler);
}
