import { MAX_WALLET_BATCH, WALLET_LABEL_MAX, addressEnd, addressEnds, addressHash, addressesHash, cleanWalletLabel, labelSpoofsAddress, type ConfirmAction } from '@x2f/accounts';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type pg from 'pg';
import { addAlert } from '../alerts.js';
import { STRONG_CONFIRM_METHODS, redeemConfirm, type ConfirmMethod } from '../auth/confirm.js';
import { requireSession } from '../auth/sessions.js';
import { gateChange, holdInTx, holdRefusal, settleOf, stagedReply, requireLiveSessionInTx, requireNotHeld, weakOf, weakRefusal, withTx } from '../auth/hold.js';
import { dailyCapInTx } from '../auth/throttle.js';
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
/**
 * Security review of wip/lead-note-226, Medium 3: renames an account may make in a UTC day (counted
 * when one changes a name; past it 429 `slow-down`), so a stolen session cannot churn names.
 */
export const WALLET_RENAMES_PER_DAY = 20;
export const walletRenameKey = (accountId: string) => `wallet-rename:${accountId}`;

/** A wallet name's longest (owner demo note #226: the one rule, `cleanWalletLabel` in @x2f/accounts). */
export const LABEL_MAX = WALLET_LABEL_MAX;

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
  /**
   * Owner demo note #6 (migration 620): for one trade only. Listed until a trade uses it, then
   * removed by `useUpOneTimeWallet` in that trade's transaction; false: saved for future trades.
   */
  oneTime: boolean;
  /**
   * Owner, 17 Nov 2026 (note #6 Q1): the default the trade screen picks first (`effectiveDefault`):
   * the saved wallet the person chose, else their only usable saved wallet, else none. Only a
   * preselection: the take still names a wallet.
   */
  isDefault: boolean;
  /**
   * Review of wip/third-trade-wallet 17 Nov (b), M1: the code of the trade, still in setup, that used
   * up this one-time wallet (it comes back if that trade ends in setup). Such a wallet is listed so its
   * owner can see and remove it, but it is not usable. Null for every open wallet.
   */
  inUseByTrade: string | null;
}

interface WalletRow {
  id: string;
  app: WalletApp;
  label: string;
  address: string;
  usable_from: Date;
  one_time: boolean;
  is_default: boolean;
}

function toWallet(r: WalletRow, now: Date): Wallet {
  return {
    id: r.id, app: r.app, label: r.label, address: r.address, addressEnd: addressEnd(r.address),
    usableFrom: r.usable_from, usable: r.usable_from.getTime() <= now.getTime(), oneTime: r.one_time, isDefault: false,
    inUseByTrade: null,
  };
}

const toJson = (w: Wallet) => ({ ...w, usableFrom: w.usableFrom.toISOString() });

const WALLET_COLUMNS = 'id, app, label, address, usable_from, one_time, is_default';

/**
 * Owner, 17 Nov 2026 (note #6 Q1): which of the account's open wallets is the default. "If they only
 * have one wallet saved then that's the default. If they have multiple they can choose to have one as
 * the default": the open wallet the person chose (`is_default`, never a one-time wallet), else the only
 * usable saved wallet, else none (several saved and none chosen, or the chosen one removed).
 */
export function effectiveDefault(rows: readonly WalletRow[], now: Date): string | null {
  // Review 17 Nov (b), B1: a chosen wallet counts only once it is usable (one chosen while it still
  // waited, before the route refused that, never outranks a usable one).
  const chosen = rows.find((r) => r.is_default && !r.one_time && r.usable_from.getTime() <= now.getTime());
  if (chosen) return chosen.id;
  const saved = rows.filter((r) => !r.one_time && r.usable_from.getTime() <= now.getTime());
  return saved.length === 1 ? saved[0]!.id : null;
}

/**
 * The account's open (not removed) wallets, oldest first, the default marked. Review 17 Nov (b), M1:
 * with them, each one-time wallet a trade still in `setup` used up, as in use by that trade (not
 * usable, never the default), so its owner sees it and can remove it before it can come back.
 */
async function openWallets(db: Queryable, accountId: string, now: Date): Promise<Wallet[]> {
  const { rows } = await db.query<WalletRow & { in_use_by: string | null }>(
    `select ${WALLET_COLUMNS.split(', ').map((c) => `w.${c}`).join(', ')},
            case when w.removed_at is not null then w.used_by_trade end as in_use_by
       from wallets w
      where w.account_id = $1
        and (w.removed_at is null
             or (w.used_by_trade is not null and exists (select 1 from trades t where t.code = w.used_by_trade and t.state = 'setup')))
      order by w.created_at, w.id`,
    [accountId],
  );
  const def = effectiveDefault(rows.filter((r) => r.in_use_by === null), now);
  return rows.map((r) =>
    r.in_use_by === null
      ? { ...toWallet(r, now), isDefault: r.id === def }
      : { ...toWallet(r, now), usable: false, inUseByTrade: r.in_use_by },
  );
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
export interface WalletItem {
  app: WalletApp;
  label: string;
  /** Trimmed: exactly the address that is confirmed and stored. */
  address: string;
  /**
   * Owner demo note #6: for one trade only (`Wallet.oneTime`). Absent in a change staged before
   * migration 620, which then applies as saved for future trades.
   */
  oneTime?: boolean;
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

/**
 * `app` from the list, `label` 1-40 characters once trimmed, `address` a string (checked later),
 * `oneTime` absent or a boolean (owner demo note #6; absent is saved for future trades).
 */
function checkItemShape(raw: unknown): WalletItem & { oneTime: boolean } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new ApiError(400, 'bad-request');
  const { app, label, address, oneTime } = raw as Record<string, unknown>;
  if (typeof app !== 'string' || !(WALLET_APPS as readonly string[]).includes(app)) throw new ApiError(400, 'bad-request');
  if (typeof label !== 'string' || typeof address !== 'string') throw new ApiError(400, 'bad-request');
  if (oneTime !== undefined && typeof oneTime !== 'boolean') throw new ApiError(400, 'bad-request');
  // Control and format characters (bidi overrides, zero-width) are refused: the label is shown back
  // in lists and alerts. The same rule as a rename (`cleanWalletLabel`, owner demo note #226).
  const cleanLabel = cleanWalletLabel(label);
  if (cleanLabel === null) throw new ApiError(400, 'bad-request');
  return { app: app as WalletApp, label: cleanLabel, address: address.trim(), oneTime: oneTime === true };
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
  let shapes: Array<WalletItem & { oneTime: boolean }>;
  if (batch) {
    const list = body.wallets;
    if (['app', 'label', 'address', 'oneTime'].some((k) => Object.hasOwn(body, k))) throw new ApiError(400, 'bad-request');
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
  // Verification review of wip/lead-note-226 (Medium): no name may spell (a look-alike of) the end of
  // any of the account's addresses: its wallets, removed ones included, and every one in this request.
  const known = [...(await accountAddresses(deps.db, req.auth.accountId)), ...addresses];
  if (shapes.some((s) => labelSpoofsAddress(s.label, known))) throw new ApiError(400, 'bad-request');
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

/** Every address the account has had as a wallet (open, removed, used up; purged ones are gone). */
async function accountAddresses(db: Queryable, accountId: string): Promise<string[]> {
  const { rows } = await db.query<{ address: string }>('select address from wallets where account_id = $1 and address is not null', [accountId]);
  return rows.map((r) => r.address);
}

function walletInput(req: FastifyRequest): WalletInput {
  const input = walletInputs.get(req);
  if (!input) throw new Error('wallet input was not checked');
  return input;
}

/** The account's creating session, until it ends its sign-up (owner 2026-11-26: no clock for the first wallet). */
const signupSession = (req: FastifyRequest): boolean => req.auth.onboardingUntil !== null;

/** The onboarding exemption covers the account's first wallets only (on top of the sign-up session). */
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
  // Owner, 2026-11-26 (demo note #161, "no matter what"): the first wallet skips the confirm for the
  // whole sign-up session, with no 30-minute clock. The sign-up session is the creating session
  // until it reaches Welcome (`onboarding/end` nulls `onboarding_until`); later wallets confirm.
  if (signupSession(req) && (await noWalletYet(req))) return;
  throw new ApiError(403, 'confirm-required', { action: walletInput(req).action.kind });
};

/** Wallets waiting out the account's 24-hour hold (Plan 2 Task 17 review round 2 N-I4), as checked. */
export type PendingWallet = WalletItem;

/**
 * Inserts checked wallets with one `usable_from` and their `wallet-added` alerts, and sets
 * `had_wallet` (inside the caller's transaction, account row locked). 409 `wallet-exists` when an
 * address is already open on the account.
 */
async function insertWallets(
  db: Queryable,
  accountId: string,
  items: readonly WalletItem[],
  usableFrom: Date,
  confirmedWith: ConfirmMethod | 'onboarding',
  now: Date,
): Promise<Wallet[]> {
  const wallets: Wallet[] = [];
  for (const item of items) {
    let inserted: WalletRow;
    try {
      const res = await db.query<WalletRow>(
        `insert into wallets (account_id, app, label, address, created_at, usable_from, one_time)
         values ($1, $2, $3, $4, $5, $6, $7) returning ${WALLET_COLUMNS}`,
        [accountId, item.app, item.label, item.address, now, usableFrom, item.oneTime === true],
      );
      inserted = res.rows[0]!;
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new ApiError(409, 'wallet-exists');
      throw e;
    }
    const wallet = toWallet(inserted, now);
    wallets.push(wallet);
    await addAlert(
      db, accountId, 'wallet-added',
      { app: wallet.app, label: wallet.label, addressEnd: wallet.addressEnd, usableFrom: usableFrom.toISOString(), confirmedWith },
      now,
    );
  }
  await db.query('update accounts set had_wallet = true where id = $1', [accountId]);
  return wallets;
}

/**
 * Wallets that waited out the account's hold, applied when it ends by time (review round 2 N-I4):
 * usable at once (they have waited their 24 hours: R42, once, not twice), whatever the confirm.
 * 409 `wallet-exists` drops the change when one of them was added meanwhile.
 */
export async function applyWallets(db: Queryable, accountId: string, items: readonly PendingWallet[], method: ConfirmMethod | null, now: Date): Promise<void> {
  await db.query('select 1 from accounts where id = $1 for update', [accountId]);
  await insertWallets(db, accountId, items, now, method ?? 'onboarding', now);
}

async function addHandler(req: FastifyRequest, reply: FastifyReply) {
  const deps = req.server.deps;
  const input = walletInput(req);
  const raw = bodyOf(req).confirmToken;
  // `walletConfirm` let a request without a token through only under the onboarding exemption.
  const exempted = raw === undefined;
  const now = deps.clock();
  const client = await deps.db.connect();
  let wallets: Wallet[] = [];
  let held: { changeId: string } | null = null;
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
      // Plan 2 Task 17 review round 2 N-I4 (lead decision 2026-10-30, the owner's 14:12 ruling over
      // the wallet rule of 10-24): a session whose login waits (a username and password; a PGP key login is strong since Q81) adds no wallet
      // at once, whatever it confirmed with: hold model v3, the add is staged like any security
      // change and applies 24 h after it is submitted (`gateChange`; 202 `staged`). The sign-up's
      // first 30 minutes are exempt there, and so is the first wallet of the sign-up session
      // (owner 2026-11-26, note #161).
      held = await gateChange(client, req, { kind: 'wallets', items: input.items, method }, { signup: exempted });
      if (held === null) {
        // Owner, 2026-10-23 and 2026-10-24: an account's first wallets (it has never had one) are
        // usable at once, whenever they are added and however they were confirmed. Later wallets
        // are usable at once when confirmed with PGP, a passkey or a security key from a strong
        // login (STRONG_CONFIRM_METHODS; a waiting login was held above), and wait 24 hours when
        // confirmed with a password. `method` is what the redeemed token recorded, never anything in
        // this request. A batch shares one clock: every wallet in it gets the same `usable_from`.
        const strong = method !== null && STRONG_CONFIRM_METHODS.includes(method);
        const waits = account.had_wallet && !strong;
        const usableFrom = waits ? new Date(now.getTime() + PAYOUT_WAIT_MS) : now;
        wallets = await insertWallets(client, req.auth.accountId, input.items, usableFrom, method ?? 'onboarding', now);
      }
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
  } finally {
    client.release();
  }
  if (held !== null) {
    return reply.code(202).send(stagedReply(held));
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
 * Owner demo note #6: a one-time wallet is used up by the trade that uses it. Called in the take's
 * (or the poster's wallet route's) transaction, after the trade's address is written and under the
 * account lock those routes hold, so a second trade can never pick it: it is marked removed and is
 * never listed or usable again. No in-app alert (the person chose this when adding it); the Jabber
 * change notice still goes out, from the `wallets` row trigger on `removed_at` (jabber/changePaths.ts),
 * and that is intended. A saved wallet is left as it is. The trade keeps its own copy of the address;
 * nothing here touches the trade.
 */
export async function useUpOneTimeWallet(db: Queryable, accountId: string, walletId: string, tradeCode: string, now: Date): Promise<void> {
  // `used_by_trade` (migration 640): the trade that used it, so that trade ending in setup gives it back.
  await db.query(
    'update wallets set removed_at = $3, used_by_trade = $4 where id = $1 and account_id = $2 and one_time and removed_at is null',
    [walletId, accountId, now, tradeCode],
  );
}

/**
 * Owner, 17 Nov 2026 (note #6 Q10: "they have the option of reusing the wallet over again, but by no
 * means do they have to"): the one-time wallets trade `tradeCode` used up are open again, still
 * one-time, with their address and wait as they were. Called by the trade store (trades/store.ts
 * `applyEvent`) in the transaction that closes a trade straight from `setup` with nothing funded, after
 * the trade row lock; it takes the lock of each account that has a wallet to give back (in id order),
 * so it serialises with any take, add or wallet route of that account. It never creates an address, never touches
 * `had_wallet` or any wait, and never restores a wallet whose removal applied meanwhile (that removal
 * cleared `used_by_trade`, `applyWalletRemoval`), nor one whose address is open again on the account
 * (re-added meanwhile) or was purged.
 */
export async function restoreOneTimeWallets(db: Queryable, tradeCode: string, accountIds: readonly string[], now: Date): Promise<number> {
  // Review 17 Nov (b), B2: `applyEvent` already locked both parties in id order right after the trade
  // row (before the cancel route's own account lock), so this lock is re-entrant there and cannot
  // close a cycle with a take; it stays for any other caller.
  const owners = await db.query<{ account_id: string }>(
    'select distinct account_id from wallets where used_by_trade = $1 and account_id = any($2)',
    [tradeCode, [...accountIds]],
  );
  if (owners.rows.length === 0) return 0;
  await db.query('select id from accounts where id = any($1) order by id for update', [owners.rows.map((r) => r.account_id)]);
  const { rows } = await db.query<{ account_id: string; app: WalletApp; label: string; address: string }>(
    `update wallets w set removed_at = null, used_by_trade = null
      where w.used_by_trade = $1 and w.account_id = any($2) and w.one_time and w.removed_at is not null and w.address is not null
        and not exists (select 1 from wallets o where o.account_id = w.account_id and o.address = w.address and o.removed_at is null)
      returning w.account_id, w.app, w.label, w.address`,
    [tradeCode, [...accountIds]],
  );
  // Review 17 Nov (b), M1: the return is told in the app too (the Jabber notice already goes out from
  // the wallets trigger), with display details only, never the whole address.
  for (const r of rows) {
    await addAlert(db, r.account_id, 'wallet-restored', { app: r.app, label: r.label, addressEnd: addressEnd(r.address) }, now);
  }
  return rows.length;
}

/**
 * The removal write (the route's, or a waiting one applied 24 h after a username-and-password
 * session submitted it): the wallet is marked removed (a wallet still waiting to be usable is
 * cancelled with it) and alert `wallet-removed` carries display details only: the app, the label
 * and the end of the address, never all of it (owner, 2026-10-23). 404 when the wallet is gone
 * already (a waiting removal is then dropped).
 */
export async function applyWalletRemoval(db: Queryable, accountId: string, walletId: string, now: Date): Promise<void> {
  // Owner note #6 Q10: a one-time wallet a trade is using (used up, `used_by_trade` set) is removed
  // for good: it will not come back if that trade ends in setup. The removal is done, with its alert.
  const used = await db.query<{ app: WalletApp; label: string; address: string }>(
    `update wallets set used_by_trade = null where id = $1 and account_id = $2 and used_by_trade is not null
     returning app, label, address`,
    [walletId, accountId],
  );
  if (used.rows[0]) {
    const u = used.rows[0];
    await addAlert(db, accountId, 'wallet-removed', { app: u.app, label: u.label, addressEnd: addressEnd(u.address) }, now);
    return;
  }
  const { rows } = await db.query<{ app: WalletApp; label: string; address: string }>(
    `update wallets set removed_at = $3 where id = $1 and account_id = $2 and removed_at is null
     returning app, label, address`,
    [walletId, accountId, now],
  );
  const removed = rows[0];
  if (!removed) throw new ApiError(404, 'not-found');
  await addAlert(db, accountId, 'wallet-removed', { app: removed.app, label: removed.label, addressEnd: addressEnd(removed.address) }, now);
}

/**
 * `DELETE /v1/wallets/:id`. Removal cannot redirect money, so it needs no confirm. Owner p5-7 (7
 * Nov 2026, replacing G5): from a session whose login waits (just a username and password) it is
 * staged like every other change (`gateChange`; 202 `staged`) and the wallet stays usable until
 * the change applies; otherwise it applies at once (`applyWalletRemoval`).
 */
async function removeHandler(req: FastifyRequest, reply: FastifyReply) {
  const deps = req.server.deps;
  const { id } = req.params as { id: string };
  if (!UUID.test(id)) throw new ApiError(404, 'not-found');
  const now = deps.clock();
  const held = await withTx(deps.db, async (client) => {
    // Review round 4: the removing session must still be live where it writes.
    await requireLiveSessionInTx(client, req.auth, now);
    // Review 17 Nov (b), M1: a one-time wallet a trade used up (`used_by_trade` set) can be removed
    // too, so it never comes back (`applyWalletRemoval` clears `used_by_trade`, with its alert).
    const { rows } = await client.query<{ label: string; address: string }>(
      'select label, address from wallets where id = $1 and account_id = $2 and (removed_at is null or (used_by_trade is not null and address is not null))',
      [id, req.auth.accountId],
    );
    const w = rows[0];
    if (!w) throw new ApiError(404, 'not-found');
    const g = await gateChange(client, req, { kind: 'remove-wallet', walletId: id, label: w.label, addressEnd: addressEnd(w.address) });
    if (g === null) await applyWalletRemoval(client, req.auth.accountId, id, now);
    return g;
  });
  if (held !== null) return reply.code(202).send(stagedReply(held));
  return reply.code(204).send();
}

/**
 * The default-wallet write, under the account lock: the wallet must still be the account's, open, saved
 * (409 `wallet-one-time`) and usable now (409 `wallet-not-ready`), else nothing changes (404
 * `not-found` for one gone; a waiting change is then dropped). Alert `wallet-default` with display
 * details only (app, label, end of the address), once per actual change: choosing the default again
 * writes nothing.
 */
export async function applyDefaultWallet(db: Queryable, accountId: string, walletId: string, now: Date): Promise<void> {
  await db.query('select 1 from accounts where id = $1 for update', [accountId]);
  const { rows } = await db.query<{ app: WalletApp; label: string; address: string; one_time: boolean; usable_from: Date }>(
    'select app, label, address, one_time, usable_from from wallets where id = $1 and account_id = $2 and removed_at is null',
    [walletId, accountId],
  );
  const w = rows[0];
  if (!w) throw new ApiError(404, 'not-found');
  if (w.one_time) throw new ApiError(409, 'wallet-one-time');
  if (w.usable_from.getTime() > now.getTime()) throw new ApiError(409, 'wallet-not-ready');
  await db.query('update wallets set is_default = false where account_id = $1 and is_default and id <> $2', [accountId, walletId]);
  const set = await db.query('update wallets set is_default = true where id = $1 and not is_default', [walletId]);
  if ((set.rowCount ?? 0) > 0) {
    await addAlert(db, accountId, 'wallet-default', { app: w.app, label: w.label, addressEnd: addressEnd(w.address) }, now);
  }
}

/**
 * `PUT /v1/wallets/:id/default` (owner, 17 Nov 2026, note #6 Q1): the account owner chooses which open
 * saved wallet the trade screen picks first. 404 `not-found` for a wallet that is not the account's or
 * not open (removed, used up by a trade, or a staged add, which has no wallet yet); 409 `wallet-one-time`
 * for a one-time wallet; 409 `wallet-not-ready` for a wallet still in its wait (review 17 Nov M1: a
 * stolen session must not silently pre-arm an address that has not yet passed the wait meant to let
 * the user notice it; the same `usable_from <= now` rule as the take's `pickWallet`).
 * Review of wip/third-trade-wallet 17 Nov (b), B1: the default steers which address a payout goes to
 * (the quote and the accepted sheet preselect it), so the session is re-checked live under the account
 * lock and a running recovery hold refuses it (403 `recovery-hold`). Owner Q12 (27 Nov 2026, "Apply at
 * once, alert"): never staged, from any login; it applies at once and writes alert `wallet-default`.
 * One default per account (the account lock, and migration 630's partial unique index).
 */
async function defaultHandler(req: FastifyRequest, reply: FastifyReply) {
  const deps = req.server.deps;
  const { id } = req.params as { id: string };
  if (!UUID.test(id)) throw new ApiError(404, 'not-found');
  const now = deps.clock();
  await withTx(deps.db, async (client) => {
    const session = await requireLiveSessionInTx(client, req.auth, now);
    if (session.kind === 'trader') {
      const running = await holdInTx(client, settleOf(req), req.auth.accountId, now);
      if (running !== null) throw holdRefusal(running.holdUntil);
    }
    const { rows } = await client.query<{ label: string; address: string; one_time: boolean; usable_from: Date }>(
      'select label, address, one_time, usable_from from wallets where id = $1 and account_id = $2 and removed_at is null',
      [id, req.auth.accountId],
    );
    const w = rows[0];
    if (!w) throw new ApiError(404, 'not-found');
    if (w.one_time) throw new ApiError(409, 'wallet-one-time');
    if (w.usable_from.getTime() > now.getTime()) throw new ApiError(409, 'wallet-not-ready');
    await applyDefaultWallet(client, req.auth.accountId, id, now);
  });
  return reply.code(204).send();
}

/**
 * `PUT /v1/wallets/:id/label` `{ label }` (owner demo note #226, 25 Nov 2026: "an option to ...
 * rename the wallet in settings later. Traders want to know where each wallet is going"). Renames
 * one of the account's open wallets: the label only, by the add's rule (`cleanWalletLabel`: trimmed,
 * 1-40 characters, no control or format characters; names need not be unique, as on the add) → 400
 * `bad-request` otherwise. 404 `not-found` for a wallet that is not the account's or not open
 * (removed, used up by a trade, or a staged add, which has no wallet yet). The address, the default,
 * `usable_from` and every other column stay as they are, so it redirects no money and starts or
 * skips no wait: like the default, it needs no confirm and is not staged; the hold still blocks it,
 * as every wallet write, and the session must still be live under the account lock. Security review
 * of wip/lead-note-226: the name follows the spoofing rule (`walletLabelProblem`: no separators,
 * status words, address-like runs or mixed scripts; Medium 1; verification review: nor a look-alike
 * of the end of any of the account's addresses, `labelSpoofsAddress`, read under the lock); a session whose changes must wait
 * (`weakOf`: a username-and-password login, a backup session) gets 403 `weak-session` (Medium 2: so a
 * weak foothold cannot rename any wallet, one still in its wait included); and at most
 * WALLET_RENAMES_PER_DAY renames a day, then 429 `slow-down` (Medium 3). A real change
 * records alert `wallet-renamed` (display details only: the app, both names and the address's last
 * 6); the Jabber change notice goes out from the `wallets` row trigger (`label` is a change column,
 * jabber/changePaths.ts). The same name again changes nothing and records nothing. 204.
 */
async function renameHandler(req: FastifyRequest, reply: FastifyReply) {
  const deps = req.server.deps;
  const { id } = req.params as { id: string };
  if (!UUID.test(id)) throw new ApiError(404, 'not-found');
  const body = bodyOf(req);
  if (Object.keys(body).some((k) => k !== 'label')) throw new ApiError(400, 'bad-request');
  const label = cleanWalletLabel(body.label);
  if (label === null) throw new ApiError(400, 'bad-request');
  const now = deps.clock();
  await withTx(deps.db, async (client) => {
    // Takes the account row lock and re-checks that the renaming session is still live.
    const live = await requireLiveSessionInTx(client, req.auth, now);
    if (weakOf(live, now)) throw weakRefusal();
    const { rows } = await client.query<{ app: WalletApp; label: string; address: string }>(
      'select app, label, address from wallets where id = $1 and account_id = $2 and removed_at is null',
      [id, req.auth.accountId],
    );
    const w = rows[0];
    if (!w) throw new ApiError(404, 'not-found');
    // Verification review (Medium): read under the account lock, so no add slips in between.
    if (labelSpoofsAddress(label, await accountAddresses(client, req.auth.accountId))) throw new ApiError(400, 'bad-request');
    if (w.label === label) return;
    await client.query('update wallets set label = $3 where id = $1 and account_id = $2 and removed_at is null', [id, req.auth.accountId, label]);
    // Counted only for a real change, after it: a refusal rolls the count back with the rename.
    await dailyCapInTx(client, walletRenameKey(req.auth.accountId), WALLET_RENAMES_PER_DAY, now);
    await addAlert(client, req.auth.accountId, 'wallet-renamed', { app: w.app, from: w.label, label, addressEnd: addressEnd(w.address) }, now);
  });
  return reply.code(204).send();
}

/**
 * `GET /v1/wallets`, `GET /v1/wallets/rule`, `POST /v1/wallets` (one wallet or a batch),
 * `PUT /v1/wallets/:id/default`, `PUT /v1/wallets/:id/label` and `DELETE /v1/wallets/:id`. (The opt-in `PUT /v1/account/security/payout-wait` was retired
 * 2026-10-23.) Full trader sessions only (R3: staff and owner accounts never hold payout wallets).
 */
export function walletRoutes(app: FastifyInstance): void {
  const session = requireSession({ kinds: ['trader'] });
  // Plan 2 Task 18 (lead default): a Trades member reads the account's list (to recognise the
  // trade's payout wallet); adding and removing wallets stay the account owner's (owner-only).
  // Review M7: a member gets each address's last 6 characters only (`addressEnd`), never `address`, the whole
  // address: their device never runs the escrow, so it never needs one.
  // Job 1c: the wallet list (names and address endings) is the See wallet names box.
  const pickWallet = requireSession({ kinds: ['trader'], member: 'wallets-see' });
  app.get('/v1/wallets/rule', { preHandler: session }, async (req) => walletRule(req.server.deps.db, req.auth.accountId));
  app.get('/v1/wallets', { preHandler: pickWallet }, async (req) => {
    const deps = req.server.deps;
    const list = await openWallets(deps.db, req.auth.accountId, deps.clock());
    if (req.auth.memberId !== null) {
      return list.map(({ address: _whole, ...w }) => ({ ...w, usableFrom: w.usableFrom.toISOString() }));
    }
    return list.map(toJson);
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
  app.put('/v1/wallets/:id/default', { preHandler: [session, requireNotHeld] }, defaultHandler);
  // Owner demo note #226: renaming a wallet, cosmetic (the label only).
  app.put('/v1/wallets/:id/label', { preHandler: [session, requireNotHeld] }, renameHandler);
}
