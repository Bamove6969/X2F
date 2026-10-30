import { MAX_WALLET_BATCH, addressEnd, addressEnds, addressHash, addressesHash, type ConfirmAction } from '@x2f/accounts';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type pg from 'pg';
import { addAlert } from '../alerts.js';
import { STRONG_CONFIRM_METHODS, redeemConfirm, type ConfirmMethod } from '../auth/confirm.js';
import { requireSession } from '../auth/sessions.js';
import { requireNotHeld } from '../auth/hold.js';
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

/** One wallet of an add request, checked. */
interface WalletItem {
  app: WalletApp;
  label: string;
  /** Trimmed: exactly the address that is confirmed and stored. */
  address: string;
}

/**
 * What the add-wallet body was checked to be; the action is computed here, once (R17). `batch`
 * when the body sent a `wallets` list (owner, 2026-10-24: several at once under one confirm,
 * `add-wallets`); otherwise one wallet (`add-wallet`).
 */
interface WalletInput {
  items: WalletItem[];
  batch: boolean;
  action: Extract<ConfirmAction, { kind: 'add-wallet' | 'add-wallets' }>;
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

/** `app` from the list, `label` 1-40 characters once trimmed, `address` a string (checked later). */
function checkItemShape(raw: unknown): { app: WalletApp; label: string; address: string } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new ApiError(400, 'bad-request');
  const { app, label, address } = raw as Record<string, unknown>;
  if (typeof app !== 'string' || !(WALLET_APPS as readonly string[]).includes(app)) throw new ApiError(400, 'bad-request');
  if (typeof label !== 'string' || typeof address !== 'string') throw new ApiError(400, 'bad-request');
  const cleanLabel = label.trim();
  const labelLength = [...cleanLabel].length;
  if (labelLength < 1 || labelLength > LABEL_MAX || CONTROL.test(cleanLabel)) throw new ApiError(400, 'bad-request');
  return { app: app as WalletApp, label: cleanLabel, address: address.trim() };
}

/**
 * preHandler after `requireSession` (R17): every check that can refuse the request runs here,
 * before a confirm token is looked at, so a refused request never uses one up.
 * The body is either one wallet `{ app, label, address }` or a batch `{ wallets: [...] }` of 1 to
 * MAX_WALLET_BATCH (not both; an address twice in one batch → 400 `bad-request`). For each wallet:
 * `app` from the list, `label` 1-40 characters once trimmed, `address` trimmed and checked by the
 * validator (`invalid` or wrong network → 400 `address-invalid`, `integrated` → 400
 * `address-integrated`), and not already listed (409 `wallet-exists`; the unique index decides races).
 */
const checkWalletInput: preHandlerAsyncHookHandler = async function (req) {
  const deps = req.server.deps;
  const body = bodyOf(req);
  const batch = Object.hasOwn(body, 'wallets');
  let shapes: Array<{ app: WalletApp; label: string; address: string }>;
  if (batch) {
    const list = body.wallets;
    if (['app', 'label', 'address'].some((k) => Object.hasOwn(body, k))) throw new ApiError(400, 'bad-request');
    if (!Array.isArray(list) || list.length < 1 || list.length > MAX_WALLET_BATCH) throw new ApiError(400, 'bad-request');
    shapes = list.map(checkItemShape);
    if (new Set(shapes.map((s) => s.address)).size !== shapes.length) throw new ApiError(400, 'bad-request');
  } else {
    shapes = [checkItemShape(body)];
  }
  for (const s of shapes) {
    const verdict = await deps.addresses.check(s.address);
    if (verdict === 'integrated') throw new ApiError(400, 'address-integrated');
    if (verdict !== 'ok') throw new ApiError(400, 'address-invalid');
  }
  const addresses = shapes.map((s) => s.address);
  const listed = await deps.db.query(
    'select 1 from wallets where account_id = $1 and address = any($2::text[]) and removed_at is null',
    [req.auth.accountId, addresses],
  );
  if (listed.rows.length > 0) throw new ApiError(409, 'wallet-exists');
  const action: WalletInput['action'] = batch
    ? { kind: 'add-wallets', addressesHash: await addressesHash(addresses), addressEnds: addressEnds(addresses) }
    : { kind: 'add-wallet', addressHash: await addressHash(addresses[0]!), addressEnd: addressEnd(addresses[0]!) };
  walletInputs.set(req, { items: shapes, batch, action });
};

function walletInput(req: FastifyRequest): WalletInput {
  const input = walletInputs.get(req);
  if (!input) throw new Error('wallet input was not checked');
  return input;
}

/** The onboarding exemption covers the account's first wallets only (on top of the session's window). */
async function noWalletYet(req: FastifyRequest): Promise<boolean> {
  const { rows } = await req.server.deps.db.query<{ had_wallet: boolean }>('select had_wallet from accounts where id = $1', [
    req.auth.accountId,
  ]);
  return rows[0]?.had_wallet === false;
}

/**
 * preHandler after `checkWalletInput`: decides whether this add is the onboarding exemption (no
 * token, the creating session's onboarding window, `had_wallet = false`) or needs a token; a
 * missing token outside the exemption → 403 `confirm-required` naming the action (`add-wallet`,
 * or `add-wallets` for a batch). A token is NOT used up here: `addHandler` redeems it inside its
 * transaction, so a lost race (409), a database error or a failed alert rolls the redemption back
 * with the wallets (M1).
 */
const walletConfirm: preHandlerAsyncHookHandler = async function (req) {
  if (req.auth.level === 'recovery') throw new ApiError(403, 'recovery-session');
  if (bodyOf(req).confirmToken !== undefined) return;
  const until = req.auth.onboardingUntil;
  const inWindow = until !== null && until.getTime() > req.server.deps.clock().getTime();
  if (inWindow && (await noWalletYet(req))) return;
  throw new ApiError(403, 'confirm-required', { action: walletInput(req).action.kind });
};

async function addHandler(req: FastifyRequest, reply: FastifyReply) {
  const deps = req.server.deps;
  const input = walletInput(req);
  const raw = bodyOf(req).confirmToken;
  // `walletConfirm` let a request without a token through only under the onboarding exemption.
  const exempted = raw === undefined;
  const now = deps.clock();
  const client = await deps.db.connect();
  const wallets: Wallet[] = [];
  try {
    await client.query('begin');
    try {
      // The row lock orders every add of this account: `had_wallet` read here is the truth.
      const { rows } = await client.query<{ had_wallet: boolean }>(
        'select had_wallet from accounts where id = $1 for update',
        [req.auth.accountId],
      );
      const account = rows[0]!;
      // Two tokenless first adds in parallel: the row lock lets the first through; the second
      // finds `had_wallet` set and needs a token like any later add.
      if (exempted && account.had_wallet) throw new ApiError(403, 'confirm-required', { action: input.action.kind });
      // R17: the token must be for exactly the checked, trimmed address list (action computed
      // once, in checkWalletInput). Redeemed in this transaction: a rollback below leaves it
      // unused (M1). A present but non-string token (number, null, object) is invalid, never "missing".
      let method: ConfirmMethod | null = null;
      if (!exempted) {
        method = await redeemConfirm({ db: client, clock: deps.clock }, req, input.action, typeof raw === 'string' ? raw : '');
      }
      req.confirmedAction = input.action;
      // Owner, 2026-10-23 and 2026-10-24: an account's first wallets (it has never had one) are
      // usable at once, whenever they are added and however they were confirmed. Later wallets are
      // usable at once when confirmed with PGP, a passkey or a security key, and wait 24 hours when
      // confirmed with a password. `method` is what the redeemed token recorded, never anything in
      // this request. A batch shares one clock: every wallet in it gets the same `usable_from`.
      const strong = method !== null && STRONG_CONFIRM_METHODS.includes(method);
      const waits = account.had_wallet && !strong;
      const usableFrom = waits ? new Date(now.getTime() + PAYOUT_WAIT_MS) : now;
      for (const item of input.items) {
        let inserted: WalletRow;
        try {
          const res = await client.query<WalletRow>(
            `insert into wallets (account_id, app, label, address, created_at, usable_from)
             values ($1, $2, $3, $4, $5, $6) returning ${WALLET_COLUMNS}`,
            [req.auth.accountId, item.app, item.label, item.address, now, usableFrom],
          );
          inserted = res.rows[0]!;
        } catch (e) {
          if ((e as { code?: string }).code === '23505') throw new ApiError(409, 'wallet-exists');
          throw e;
        }
        const wallet = toWallet(inserted, now);
        wallets.push(wallet);
        await addAlert(
          client, req.auth.accountId, 'wallet-added',
          {
            app: wallet.app, label: wallet.label, addressEnd: wallet.addressEnd, usableFrom: usableFrom.toISOString(),
            confirmedWith: method ?? 'onboarding',
          },
          now,
        );
      }
      await client.query('update accounts set had_wallet = true where id = $1', [req.auth.accountId]);
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
  } finally {
    client.release();
  }
  return reply.code(201).send(input.batch ? wallets.map(toJson) : toJson(wallets[0]!));
}

/**
 * `GET /v1/wallets/rule`: what adding wallets will do for this account, so the Add a wallet screen
 * can explain it before anything is entered (owner, 2026-10-24). Read from the account's own
 * methods; it changes nothing.
 * - `firstWallet`: the account has never had a wallet, so the next add is usable at once whatever
 *   the method.
 * - `strongMethods`: the PGP, passkey and security-key methods it holds; confirming with one of
 *   them makes new wallets usable at once.
 * - `password`: `none` (no password to confirm with), `immediate` (a password confirm would not
 *   wait, because this is the first wallet) or `waits` (it would wait `waitHours`).
 */
export interface WalletRule {
  firstWallet: boolean;
  strongMethods: ConfirmMethod[];
  password: 'none' | 'immediate' | 'waits';
  waitHours: number;
}

export async function walletRule(db: Queryable, accountId: string): Promise<WalletRule> {
  const { rows } = await db.query<{ had_wallet: boolean; pgp: boolean; passkey: boolean; security_key: boolean; password: boolean }>(
    `select a.had_wallet,
            exists (select 1 from pgp_keys where account_id = a.id) as pgp,
            exists (select 1 from webauthn_credentials where account_id = a.id and kind = 'passkey') as passkey,
            exists (select 1 from webauthn_credentials where account_id = a.id and kind = 'security-key') as security_key,
            exists (select 1 from passwords where account_id = a.id) as password
       from accounts a where a.id = $1`,
    [accountId],
  );
  const r = rows[0]!;
  const strongMethods: ConfirmMethod[] = [];
  if (r.pgp) strongMethods.push('pgp');
  if (r.passkey) strongMethods.push('passkey');
  if (r.security_key) strongMethods.push('security-key');
  const firstWallet = !r.had_wallet;
  return {
    firstWallet,
    strongMethods,
    password: !r.password ? 'none' : firstWallet ? 'immediate' : 'waits',
    waitHours: PAYOUT_WAIT_MS / 3_600_000,
  };
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
 * `GET /v1/wallets`, `GET /v1/wallets/rule`, `POST /v1/wallets` (one wallet or a batch) and
 * `DELETE /v1/wallets/:id`. (The opt-in `PUT /v1/account/security/payout-wait` was retired
 * 2026-10-23.) Full trader sessions only (R3: staff and owner accounts never hold payout wallets).
 */
export function walletRoutes(app: FastifyInstance): void {
  const session = requireSession({ kinds: ['trader'] });
  app.get('/v1/wallets/rule', { preHandler: session }, async (req) => walletRule(req.server.deps.db, req.auth.accountId));
  app.get('/v1/wallets', { preHandler: session }, async (req) => {
    const deps = req.server.deps;
    return (await openWallets(deps.db, req.auth.accountId, deps.clock())).map(toJson);
  });
  app.post(
    '/v1/wallets',
    {
      preHandler: [
        session,
        requireNotHeld,
        checkWalletInput,
        walletConfirm,
      ],
    },
    addHandler,
  );
  app.delete('/v1/wallets/:id', { preHandler: [session, requireNotHeld] }, removeHandler);
}
