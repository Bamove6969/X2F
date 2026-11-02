/**
 * The 24-hour hold by login strength (Plan 2 Task 17, Revision 2026-10-29c; owner 14:12; R42).
 *
 * - **Starting it** (`account_holds`, one row per account, `hold_until = now + 24 h`):
 *   1. a session whose login waits (`waits(strength)`: `weak-single` or `pgp-single`) changes the
 *      password or a security setting (`SECURITY_CHANGE_ROUTES`). The route calls `gateChange`
 *      inside its own transaction *before* its write: the hold starts there, the change is stored
 *      in `pending_change` instead of applied, and the route answers 202 `{ status: 'held',
 *      holdUntil }`. The change applies only when the hold ends by time (`settleHold`);
 *   2. a waiting login on a device not trusted for the account while nothing is logged in to
 *      approve it (`traderLogin`, in the session's own transaction);
 *   3. a backup login (Task 9's recovery session; lead default), in the session's transaction.
 *   Each start records `started_methods`: the login methods the account held at that moment.
 * - **During it** (`hold_until > now`) for every session of the account: no new trades, offers or
 *   payout-wallet changes, no approving new logins, no change to how the account logs in
 *   (`requireNotHeld`, `HOLD_BLOCKED_ROUTES`; 403 `recovery-hold` `{ holdUntil }`). Trades
 *   already open can still be finished.
 * - **Ending it:** by time (`settleHold`: the pending change applies, alert `hold-ended`); or a
 *   strong login whose methods are all in `started_methods` (`endHoldIfOwner`, inside the login's
 *   transaction): the pending change is discarded and alert `hold-ended` names it, and every
 *   session whose login waits, every backup session and the session that started the hold end with
 *   it (review round 2 N-C1, N-I1; alert `sessions-ended` `{ count, reason: 'owner-login' }`), and
 *   the account's trusted devices are forgotten (a copied device cookie trusts nothing afterwards).
 *   Nothing can be added during the hold (every change waits or is refused), so a thief's method
 *   never ends it. A waiting login opens no session during the hold (traderLogin: device trust is
 *   a copyable cookie and must not override the hold).
 * - **Weak sessions** (`weakOf`: the login waits, its sign-up window is over) may log out no
 *   session but their own (review round 3 R3-M2, lead decision 2026-10-30) and a backup session
 *   younger than themselves (round 4 R4-M1, lead decision 2026-10-30), and may not answer a
 *   strong login's approval, drop another session's push subscriptions or mark the hold's own
 *   alerts seen (`WEAK_LIMITED_ROUTES`; 403 `weak-session`).
 * - Every read-modify-write of a hold locks the account row first (`lockAccount`); the approval
 *   paths (login, deciding, collecting an approved login) take the approval lock before it.
 * - **The calling session is live where it writes** (review round 4, the class of R3-I1 and
 *   R4-I1): every route in `LIVE_SESSION_ROUTES` re-checks its session inside the transaction that
 *   writes, under the account lock (`requireLiveSessionInTx`), so a request in flight across the
 *   owner's proof acts for nobody (401 `not-authenticated`, nothing written).
 * - **Lock order note** (review round 3 R3-M5): `POST /v1/account/login-name` takes `NAMES_LOCK`
 *   (`loginNameTaken`) before the account lock (`gateChange`), while settling that account's held
 *   login name takes the account lock before `NAMES_LOCK` (`applyLoginName`). If both run at once
 *   Postgres reports a deadlock (40P01) and aborts one: harmless, as the route answers 409
 *   `names-unavailable` and the settle's savepoint drops the change. Left as it is on purpose; new
 *   code should take the account lock last.
 */
import type { IdleHours, MethodType } from '@x2f/accounts';
import type { FastifyBaseLogger, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type pg from 'pg';
import type { Deps } from '../app.js';
import { addAlert } from '../alerts.js';
import type { Config } from '../config.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import type { EventBus } from '../events/bus.js';
import type { RetentionJob } from '../retention.js';
import { applyLoginName, applyLogoutTimer, applyOneDevice } from '../routes/account.js';
import { applyWallets, type PendingWallet } from '../wallets/routes.js';
import type { ConfirmMethod } from './confirm.js';
import { applyRemoval } from './methods.js';
import { applyPassword } from './password.js';
import { applyPgpKey } from './pgp.js';
import { applyRecoveryCodes } from './recovery.js';
import { waits, type LoginStrength } from './strength.js';
import { applyTotp } from './totp.js';
import { applyCredential, type StoredCredential } from './webauthn.js';

export const HOLD_MS = 24 * 3_600_000;

export type HoldReason = 'weak-change' | 'weak-new-device' | 'weak-backup-login';

/**
 * A change waiting out the hold, in the form its table stores it (a password hash, a sealed key or
 * secret, code hashes): never a plain secret.
 */
export type PendingChange =
  | { kind: 'password'; hash: string; pepperId: number }
  | { kind: 'totp'; secretEnc: string; step: number }
  | { kind: 'pgp'; fingerprint: string; keyEnc: string }
  | { kind: 'webauthn'; credential: StoredCredential; label: string }
  | { kind: 'recovery-codes'; keyId: number; hashes: string[] }
  | { kind: 'remove-method'; type: MethodType; id: string }
  /** FU-D: the name's keyed tag under `keyId`, never the name. */
  | { kind: 'login-name'; tag: string; keyId: number }
  | { kind: 'one-device'; on: boolean }
  | { kind: 'logout-timer'; idleHours: IdleHours }
  /** Review round 2 N-I4 (lead decision 2026-10-30): payout wallets added by a session whose login waits; `method` is the confirm's. */
  | { kind: 'wallets'; items: PendingWallet[]; method: ConfirmMethod | null };

export interface Hold {
  startedAt: Date;
  holdUntil: Date;
  reason: HoldReason;
  pendingChange: PendingChange | null;
  startedMethods: string[];
  startedBy: string | null;
}

/** What a strong login proved, as `started_methods` ids. */
export type ProvenMethod =
  | { kind: 'pgp'; fingerprints: string[] }
  | { kind: 'webauthn'; credentialId: string }
  | { kind: 'password-totp' };

export function provenIds(p: ProvenMethod): string[] {
  if (p.kind === 'pgp') return p.fingerprints.map((f) => `pgp:${f}`);
  if (p.kind === 'webauthn') return [`webauthn:${p.credentialId}`];
  return ['password', 'totp'];
}

/** Locks the account row for the rest of the caller's transaction (no key update: sessions and alerts can still reference it). */
export async function lockAccount(db: Queryable, accountId: string): Promise<void> {
  await db.query('select 1 from accounts where id = $1 for no key update', [accountId]);
}

/** The login methods the account holds now, as `started_methods` ids. */
export async function methodIds(db: Queryable, accountId: string): Promise<string[]> {
  const { rows } = await db.query<{ kind: string; ref: string | null }>(
    `select 'password' as kind, null::text as ref from passwords where account_id = $1
     union all select 'totp', null::text from totp where account_id = $1
     union all select 'pgp', fingerprint from pgp_keys where account_id = $1
     union all select 'webauthn', encode(credential_id, 'hex') from webauthn_credentials where account_id = $1`,
    [accountId],
  );
  return rows.map((r) => {
    if (r.ref === null) return r.kind;
    // A credential id as the login proves it: base64url (the hex form only crosses the query).
    const ref = r.kind === 'webauthn' ? Buffer.from(r.ref, 'hex').toString('base64url') : r.ref;
    return `${r.kind}:${ref}`;
  });
}

interface HoldRow {
  started_at: Date;
  hold_until: Date;
  reason: HoldReason;
  pending_change: PendingChange | null;
  started_methods: string[];
  started_by: string | null;
}

const toHold = (r: HoldRow): Hold => ({
  startedAt: r.started_at, holdUntil: r.hold_until, reason: r.reason, pendingChange: r.pending_change,
  startedMethods: r.started_methods, startedBy: r.started_by,
});

/** Who settling a hold needs: the database (inside the caller's transaction), the config and, when there is one, the live-event bus. */
export interface SettleDeps {
  config: Config;
  events?: Pick<EventBus, 'closeAccount'> | undefined;
  /** Where a pending change that failed with a fault is reported (its error class and code only: buildApi's serializer). */
  log?: Pick<FastifyBaseLogger, 'error'> | undefined;
}

/** The settle deps of a request: the config, the live-event bus and the request's logger. */
export const settleOf = (req: FastifyRequest): SettleDeps => ({ config: req.server.deps.config, events: req.server.events, log: req.log });

/**
 * Inside a transaction with the account locked (`lockAccount`): the running hold, or null. A hold
 * whose time is up is ended here: its pending change applies (alert `hold-ended` `{ reason: 'time',
 * change, applied }`).
 */
export async function holdInTx(db: Queryable, s: SettleDeps, accountId: string, now: Date): Promise<Hold | null> {
  const { rows } = await db.query<HoldRow>('select * from account_holds where account_id = $1', [accountId]);
  const row = rows[0];
  if (!row) return null;
  if (row.hold_until.getTime() > now.getTime()) return toHold(row);
  await db.query('delete from account_holds where account_id = $1', [accountId]);
  const change = row.pending_change;
  let applied = false;
  let endedOthers = false;
  if (change !== null) {
    // A change that can no longer apply (the key went to another account, the last login method,
    // a login name taken meanwhile) is dropped and the alert says so; the rest of the work stands.
    // A fault inside it (review round 2 N-M2) fails closed the same way: the change is dropped
    // (nothing of it is written), the fault is logged (its class and code only) and the hold
    // ends, so one persistent fault cannot turn every later login of the account into a 500.
    await db.query('savepoint pending_change');
    try {
      endedOthers = await applyChange(db, s.config, accountId, change, row.started_by, now);
      await db.query('release savepoint pending_change');
      applied = true;
    } catch (e) {
      await db.query('rollback to savepoint pending_change');
      if (!(e instanceof ApiError)) s.log?.error({ err: e, change: change.kind }, 'pending change failed; dropped');
    }
  }
  await addAlert(db, accountId, 'hold-ended', { reason: 'time', change: change?.kind ?? null, applied }, now);
  // Streams of sessions the change ended: closed now (a caller without the bus leaves them to their lifetime).
  if (endedOthers) s.events?.closeAccount(accountId, row.started_by ?? undefined);
  return null;
}

/** Applies a pending change through the same write its route uses. True when it ended other sessions. */
async function applyChange(db: Queryable, config: Config, accountId: string, c: PendingChange, keep: string | null, now: Date): Promise<boolean> {
  switch (c.kind) {
    case 'password':
      return (await applyPassword(db, accountId, c, keep, now)) > 0;
    case 'totp':
      await applyTotp(db, accountId, Buffer.from(c.secretEnc, 'base64'), c.step, now);
      return false;
    case 'pgp':
      await applyPgpKey(db, accountId, c.fingerprint, Buffer.from(c.keyEnc, 'base64'), now);
      return false;
    case 'webauthn':
      await applyCredential(db, accountId, c.credential, c.label, now);
      return false;
    case 'recovery-codes':
      await applyRecoveryCodes(db, accountId, c.keyId, c.hashes.map((h) => Buffer.from(h, 'base64')), now);
      return false;
    case 'remove-method':
      return (await applyRemoval(db, config, accountId, c.type, c.id, keep, now)) > 0;
    case 'login-name':
      await applyLoginName(db, config, accountId, Buffer.from(c.tag, 'base64'), c.keyId, now);
      return false;
    case 'one-device':
      await applyOneDevice(db, accountId, c.on, now);
      return false;
    case 'logout-timer':
      await applyLogoutTimer(db, accountId, c.idleHours, now);
      return false;
    case 'wallets':
      await applyWallets(db, accountId, c.items, c.method, now);
      return false;
  }
}

/**
 * Starts the account's hold inside the caller's transaction (account locked), or extends a running
 * one to `now + 24 h` (its `started_methods`, `pending_change` and start stay). Alert `hold-started`
 * `{ holdUntil, reason, change }`. Returns the hold's end.
 */
export async function startHold(
  db: Queryable,
  accountId: string,
  now: Date,
  a: { reason: HoldReason; startedBy: string | null; pending?: PendingChange },
): Promise<Date> {
  const until = new Date(now.getTime() + HOLD_MS);
  const methods = await methodIds(db, accountId);
  const { rows } = await db.query<{ hold_until: Date }>(
    `insert into account_holds (account_id, started_at, hold_until, reason, pending_change, started_methods, started_by)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (account_id) do update set hold_until = greatest(account_holds.hold_until, excluded.hold_until)
     returning hold_until`,
    [accountId, now, until, a.reason, a.pending === undefined ? null : JSON.stringify(a.pending), methods, a.startedBy],
  );
  const end = rows[0]!.hold_until;
  await addAlert(db, accountId, 'hold-started', { holdUntil: end.toISOString(), reason: a.reason, change: a.pending?.kind ?? null }, now);
  return end;
}

/**
 * Inside a strong login's transaction (account locked): when a hold runs and every method this
 * login proved was held when it started, the hold ends now, its pending change is discarded and
 * alert `hold-ended` `{ reason: 'owner-login', cancelled }` names it. With it end (review round 2
 * N-C1, N-I1) every live session whose login waits (`strength` not `strong`, or none recorded),
 * every backup (recovery) session and the session that started the hold: otherwise a backup
 * session that waited out its own 24 hours, or a weak session filling the device limit, would
 * outlive the owner's answer. Alert `sessions-ended` `{ count, reason: 'owner-login' }` when any
 * did. Returns null when no hold ended, else the ids of the sessions it ended (the caller closes
 * their streams after commit).
 */
export async function endHoldIfOwner(db: Queryable, s: SettleDeps, accountId: string, proven: ProvenMethod, now: Date): Promise<string[] | null> {
  const hold = await holdInTx(db, s, accountId, now);
  if (hold === null || !ownerProof(hold, proven)) return null;
  await db.query('delete from account_holds where account_id = $1', [accountId]);
  await addAlert(db, accountId, 'hold-ended', { reason: 'owner-login', cancelled: hold.pendingChange?.kind ?? null }, now);
  const ended = await db.query<{ id: string }>(
    `update sessions set revoked_at = $2
      where account_id = $1 and revoked_at is null
        and (level = 'recovery' or strength is distinct from 'strong' or id = $3)
      returning id`,
    [accountId, now, hold.startedBy],
  );
  // Logins approved and not yet collected go with those sessions, and (review round 4 R4-I1) so do
  // logins still waiting for an answer: each was asked for before the owner's proof, possibly by
  // the thief, and the owner can simply log in again.
  await db.query(
    `update login_approvals set outcome = 'expired', decided_at = coalesce(decided_at, $2)
      where account_id = $1 and (outcome is null or (outcome = 'approved' and used_at is null))`,
    [accountId, now],
  );
  if (ended.rows.length > 0) await addAlert(db, accountId, 'sessions-ended', { count: ended.rows.length, reason: 'owner-login' }, now);
  // Device trust is a cookie a thief can copy: after the owner's proof every other browser needs an
  // approval again (the owner's own is trusted again by the login's `openSession`).
  await db.query('delete from trusted_devices where account_id = $1', [accountId]);
  return ended.rows.map((r) => r.id);
}

/** True when every method `proven` names was held when the hold started. */
export function ownerProof(hold: Hold, proven: ProvenMethod): boolean {
  const ids = provenIds(proven);
  return ids.length > 0 && ids.every((id) => hold.startedMethods.includes(id));
}

/**
 * Inside a full session's transaction: ends the hold a backup session started when a strong
 * session of the account cancels that backup session (review M1). True when it ended one.
 */
export async function endHoldOfSession(db: Queryable, s: SettleDeps, accountId: string, sessionId: string, now: Date): Promise<boolean> {
  const hold = await holdInTx(db, s, accountId, now);
  if (hold === null || hold.startedBy !== sessionId) return false;
  await db.query('delete from account_holds where account_id = $1', [accountId]);
  await addAlert(db, accountId, 'hold-ended', { reason: 'backup-cancelled', cancelled: hold.pendingChange?.kind ?? null }, now);
  return true;
}

export async function withTx<T>(pool: pg.Pool, fn: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    try {
      const out = await fn(client);
      await client.query('commit');
      return out;
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
  } finally {
    client.release();
  }
}

/** The end of the account's running hold, or null; a hold whose time is up is settled first. */
export async function holdUntil(
  deps: Pick<Deps, 'db' | 'clock' | 'config'>,
  accountId: string,
  events?: SettleDeps['events'],
  log?: SettleDeps['log'],
): Promise<Date | null> {
  const now = deps.clock();
  const { rows } = await deps.db.query<{ hold_until: Date }>('select hold_until from account_holds where account_id = $1', [accountId]);
  const row = rows[0];
  if (!row) return null;
  if (row.hold_until.getTime() > now.getTime()) return row.hold_until;
  return withTx(deps.db, async (db) => {
    await lockAccount(db, accountId);
    return (await holdInTx(db, { config: deps.config, events, log }, accountId, now))?.holdUntil ?? null;
  });
}

export const holdRefusal = (until: Date): ApiError => new ApiError(403, 'recovery-hold', { holdUntil: until.toISOString() });

/** The calling session as `requireLiveSessionInTx` read it under the account lock. */
export interface LiveSession {
  kind: string;
  level: string;
  strength: LoginStrength | null;
  onboarding_until: Date | null;
  hold_until: Date | null;
  created_at: Date;
}

/**
 * True when the session may not act against a stronger login (review round 2 N-I2, N-I3, N-M3): a
 * trader session whose login waits (`waits(strength)`) once its sign-up's first 30 minutes are
 * over, and every backup (recovery) session. Staff and owner sessions never are.
 */
export function weakOf(r: Pick<LiveSession, 'kind' | 'level' | 'strength' | 'onboarding_until'>, now: Date): boolean {
  if (r.kind !== 'trader') return false;
  if (r.level === 'recovery') return true;
  if (r.onboarding_until !== null && r.onboarding_until.getTime() > now.getTime()) return false;
  return waits(r.strength);
}

/**
 * The one check of the class of review rounds 3 and 4 (R3-I1, R4-I1: an action by a session the
 * owner's proof has just revoked). Inside the transaction that performs a route's write and before
 * it: takes the account lock (`lockAccount`; the owner's proof, `endHoldIfOwner`, revokes under the
 * same lock, so this check is exact against it) and answers 401 `not-authenticated` unless the
 * calling session is still live (not revoked, not expired) and of this account. `requireSession`
 * read the session before the transaction, so a request in flight across a revocation would
 * otherwise act for a dead session. Returns the session as read under the lock. Every route in
 * `LIVE_SESSION_ROUTES` calls it (the security changes through `gateChange`); a caller that needs
 * the approval lock takes it first (lock order: approvals, then account).
 */
export async function requireLiveSessionInTx(db: Queryable, auth: { accountId: string; sessionId: string }, now: Date): Promise<LiveSession> {
  await lockAccount(db, auth.accountId);
  const { rows } = await db.query<LiveSession>(
    `select a.kind, s.level, s.strength, s.onboarding_until, s.hold_until, s.created_at
       from sessions s join accounts a on a.id = s.account_id
      where s.id = $1 and a.id = $2 and s.revoked_at is null and s.expires_at > $3`,
    [auth.sessionId, auth.accountId, now],
  );
  const row = rows[0];
  if (!row) throw new ApiError(401, 'not-authenticated');
  return row;
}

/** 403 `weak-session`: the calling session's login waits, so it may not do this to a stronger login. */
export const weakRefusal = (): ApiError => new ApiError(403, 'weak-session');

/**
 * preHandler after `requireSession`: 403 `recovery-hold` `{ holdUntil }` while the account's hold runs.
 *
 * Review round 2 N-M4 (note only): this is an unlocked read, so a take, offer or wallet request
 * racing a hold that is just starting can still pass. Only the session that starts the hold gains
 * from that, and it could have acted a moment earlier anyway. The security changes themselves are
 * checked under the account lock (`gateChange`).
 */
export const requireNotHeld: preHandlerAsyncHookHandler = async function (req) {
  const until = await holdUntil(req.server.deps, req.auth.accountId, req.server.events, req.log);
  if (until !== null) throw holdRefusal(until);
};

/**
 * Inside a security route's transaction, before its write (the routes in `SECURITY_CHANGE_ROUTES`):
 * - the calling session revoked or expired by now (`requireLiveSessionInTx`, under the account
 *   lock): 401 `not-authenticated` (review rounds 3 and 4);
 * - staff and owner accounts: null (they always log in with two factors; no hold);
 * - a running hold: 403 `recovery-hold` `{ holdUntil }`, for every session of the account;
 * - a session whose login waits (outside its sign-up's first 30 minutes, and other than a backup
 *   session that has already waited out its own 24 hours): the hold starts with `change` pending
 *   and `{ holdUntil }` is returned: the route writes nothing and answers 202 `heldReply`;
 * - else null: the route applies the change.
 */
export async function gateChange(db: Queryable, req: FastifyRequest, change: PendingChange): Promise<{ holdUntil: Date } | null> {
  const deps = req.server.deps;
  const now = deps.clock();
  const { accountId, sessionId } = req.auth;
  // Review round 3 R3-I1, round 4: the session must still be live under the account lock.
  const row = await requireLiveSessionInTx(db, req.auth, now);
  if (row.kind !== 'trader') return null;
  const running = await holdInTx(db, settleOf(req), accountId, now);
  if (running !== null) throw holdRefusal(running.holdUntil);
  const onboarding = row.onboarding_until !== null && row.onboarding_until.getTime() > now.getTime();
  // Task 9's backup session already waited its 24 hours before it could change anything (R42:
  // the change waits out the 24 hours once, not twice).
  const waited = row.level === 'recovery' && row.hold_until !== null && row.hold_until.getTime() <= now.getTime();
  if (!waits(row.strength) || onboarding || waited) return null;
  const until = await startHold(db, accountId, now, { reason: 'weak-change', startedBy: sessionId, pending: change });
  return { holdUntil: until };
}

/** The 202 answer of a change that waits out the hold. */
export const heldReply = (h: { holdUntil: Date }) => ({ status: 'held' as const, holdUntil: h.holdUntil.toISOString() });

/** Pushes that a hold started, after commit (the push names nothing). */
export function pushHoldStarted(req: FastifyRequest, accountId: string): void {
  void req.server.push.send(accountId, 'alert').catch(() => undefined);
}

/**
 * Routes that change the password or a security setting: each calls `gateChange` in its
 * transaction before writing.
 */
export const SECURITY_CHANGE_ROUTES: readonly string[] = [
  'PUT /v1/account/password',
  'POST /v1/account/pgp/finish',
  'POST /v1/account/webauthn/finish',
  'POST /v1/account/totp/finish',
  'POST /v1/account/recovery-codes',
  'DELETE /v1/account/methods/:type/:id',
  'POST /v1/account/login-name',
  'PUT /v1/account/security/one-device',
  'PUT /v1/account/security/logout-timer',
  // Review round 2 N-I4 (lead decision 2026-10-30): a payout wallet added by a session whose login
  // waits (PGP alone included) waits out the hold like the rest, whatever the confirm method.
  'POST /v1/wallets',
];

/**
 * Routes that act with the calling session as their authority on the account's, a session's, an
 * approval's or the security settings' state (review round 4, the class of R3-I1 and R4-I1): each
 * checks, inside the transaction that writes and under the account lock, that the calling session
 * is still live (`requireLiveSessionInTx`; the security changes through `gateChange`). Listed in
 * docs/coordination.md with the routes left out and why.
 */
/**
 * Trading routes that create or change obligations (review round 5 M2): take, posting and switching
 * offers, and trade events. Each re-checks its session with `requireLiveSessionInTx` in the
 * transaction that writes (the offer and take writes after the account lock they already take; a
 * trade event after its trade row lock, the order of `/v1/trades/:code/wallet`). A live session
 * still finishes every open trade. Covered by apps/api/test/take.test.ts.
 */
export const LIVE_SESSION_TRADING_ROUTES: readonly string[] = [
  'POST /v1/offers/:id/take',
  'POST /v1/offers',
  'PATCH /v1/offers/:id',
  'POST /v1/account/offers/status',
  'POST /v1/trades/:code/events',
];

export const LIVE_SESSION_ROUTES: readonly string[] = [
  ...SECURITY_CHANGE_ROUTES,
  ...LIVE_SESSION_TRADING_ROUTES,
  'DELETE /v1/wallets/:id',
  'POST /v1/account/approvals/:id',
  'DELETE /v1/account/sessions/:id',
  'DELETE /v1/account/recovery-sessions/:id',
  'POST /v1/account/push',
  'DELETE /v1/account/push',
  'POST /v1/account/alerts/:id/seen',
  'POST /v1/account/terms',
  // Plan 2 Task 18 (team members), classified at its landing next to Tasks 16-17: the account
  // owner's invites, role changes and removals (team/members.ts; the lock is the account's).
  'POST /v1/team/invites',
  'PATCH /v1/team/members/:id',
  'DELETE /v1/team/members/:id',
];

/**
 * Every other route but GET that runs with a session, each with why it needs no live-session check
 * (review round 5 M1; it was the "left out" paragraph of docs/coordination.md). The tripwire in
 * apps/api/test/coolingOff.test.ts ("every route other than GET that runs with a session is
 * classified") lists the app's routes behind `requireSession`: a new one fails it until it is in
 * `LIVE_SESSION_ROUTES` (with a test row) or here with a reason. Routes with no `requireSession`
 * (`POST /v1/logout` revokes the cookie's own session; `POST /v1/login/approval/:id/poll` checks
 * its approval's granter instead, R4-M2) are not listed.
 */
export const LIVE_SESSION_EXEMPT: Readonly<Record<string, string>> = {
  'POST /v1/account/pgp/start': 'writes only an add-key challenge bound to this session; its finish is checked',
  'POST /v1/account/totp/start': 'writes only an enrolment challenge bound to this session; its finish is checked',
  'POST /v1/account/webauthn/start': 'writes only a registration challenge bound to this session; its finish is checked',
  'POST /v1/confirm/password': 'writes only a confirm token bound to this session; every route that spends one and writes is checked',
  'POST /v1/confirm/pgp/start': 'writes only a confirm challenge bound to this session',
  'POST /v1/confirm/pgp/finish': 'writes only a confirm token bound to this session; every route that spends one and writes is checked',
  'POST /v1/confirm/webauthn/start': 'writes only a confirm challenge bound to this session',
  'POST /v1/confirm/webauthn/finish': 'writes only a confirm token bound to this session; every route that spends one and writes is checked',
  'POST /v1/account/blocks': 'social: a block row only; no account, session, approval or security state, no obligation',
  'DELETE /v1/account/blocks/:displayName': 'social: removes a block row only; no account, session, approval or security state',
  'PUT /v1/account/nudges': "the caller's own nudge preferences; no session, approval or security state",
  'POST /v1/nudges': 'a nudge to a trade counterparty; no account, session, approval or security state',
  'POST /v1/method-suggestions': 'a method suggestion row only',
  // Plan 3 Task 20 (encrypted chat), classified at its landing next to Tasks 16-17.
  'POST /v1/chats': 'social: opens a pre-trade chat row on an offer; no account, session, approval or security state, no obligation',
  'POST /v1/chats/:chat/envelopes': 'an encrypted chat line in a chat the caller is in; no account, session, approval or security state',
  'POST /v1/chats/:chat/identity': "the caller's chat identity key for one chat; no account, session, approval or security state",
  'POST /v1/trades/:code/chat': "a participant's chat for an open trade (R42: finishing open trades stays allowed); no new obligation",
  'POST /v1/feedback/form': 'a feedback row only, open to held sessions on purpose (owner 2026-10-29)',
  // Plan 5 Task 3 (reviews), classified at its merge with Tasks 16-17.
  'POST /v1/trades/:code/review': "a participant's one review of their own finished trade (a reviews row only); no account, session, approval or security state, no new obligation",
  'POST /v1/trades/:code/review/skip': "a participant's Skip review of their own finished trade (a review_skips row only); no account, session, approval or security state, no new obligation",
  // C12b (owner 2026-11-01/02): the opt-in "traded to date" profile line.
  'PUT /v1/account/profile/traded-total': "the caller's own profile display preference (one accounts column); no session, approval or security state, no obligation",
  // Plan 5 Task 4 (platform feedback), classified at its merge with Tasks 16-17.
  'POST /v1/feedback': 'a platform-feedback row only, holding nothing about the sender; no account, session, approval or security state, no obligation',
  'POST /v1/trades/:code/dispute': 'finishes an open trade (R42); creates no new obligation',
  'POST /v1/trades/:code/appeal': 'finishes an open trade (R42); creates no new obligation',
  'POST /v1/trades/:code/identity': "a participant's identity for an open trade; no new obligation",
  'POST /v1/trades/:code/wallet': "the poster's payout wallet for an open trade, from the account's own usable wallets",
  'POST /v1/trades/:code/final-alert-seen': 'review round 5 X1, an owner question; unchanged here',
};

/**
 * Routes a weak session (`weakOf`) may use only on itself (review round 2 N-I2, N-I3, N-M3;
 * round 3 R3-M2; 403 `weak-session`): ending any session but its own (a backup session included),
 * answering a strong login's approval, dropping push subscriptions (only its own go), and marking
 * the hold's and the login alerts seen.
 */
export const WEAK_LIMITED_ROUTES: readonly string[] = [
  'DELETE /v1/account/sessions/:id',
  // Review round 3 R3-M2, round 4 R4-M1 (lead decision 2026-10-30): a weak full session cancels a
  // backup session only when the weak session is the older of the two.
  'DELETE /v1/account/recovery-sessions/:id',
  'POST /v1/account/approvals/:id',
  'DELETE /v1/account/push',
  'POST /v1/account/push',
  'POST /v1/account/alerts/:id/seen',
];

/**
 * Routes refused during the hold besides the security changes (each carries `requireNotHeld`; the
 * approval decision and turning an offer on check it in their own code).
 */
export const HOLD_BLOCKED_ROUTES: readonly string[] = [
  'POST /v1/offers',
  'PATCH /v1/offers/:id',
  'POST /v1/account/offers/status',
  'POST /v1/offers/:id/take',
  'POST /v1/wallets',
  'DELETE /v1/wallets/:id',
  'POST /v1/account/approvals/:id',
  // Plan 2 Task 18 (owner 2026-10-30): every team change waits out a hold; they also check it
  // under the account lock (team/members.ts `ownerWriteGate`).
  'POST /v1/team/invites',
  'PATCH /v1/team/members/:id',
  // TODO(owner 1 Nov: removal queues until hold end, wire to hold_changes when recovery rules land);
  // refused until then (see team/members.ts `ownerWriteGate`).
  'DELETE /v1/team/members/:id',
];

/**
 * Every minute (main.ts): ends the holds whose time is up, so a pending change (a new password, a
 * removed key) applies on time even when nobody asks about the account. Each hold settles in its
 * own transaction with the account locked.
 */
export function settleDueHolds(config: Config, events: SettleDeps['events'], log?: SettleDeps['log']): RetentionJob {
  return {
    name: 'settleDueHolds',
    async run(pool, now) {
      const { rows } = await pool.query<{ account_id: string }>('select account_id from account_holds where hold_until <= $1', [now]);
      for (const r of rows) {
        await withTx(pool, async (db) => {
          await lockAccount(db, r.account_id);
          await holdInTx(db, { config, events, log }, r.account_id, now);
        });
      }
      return rows.length;
    },
  };
}
