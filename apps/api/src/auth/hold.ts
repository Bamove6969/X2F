/**
 * The 24-hour hold, model v3 (owner 1-2 Nov 2026; lead brief 2026-11-02; it replaces Task 17's
 * model of 2026-10-29c for everything but the recovery-code login). Two separate things:
 *
 * 1. **A username-and-password session's changes wait 24 h** (holdChanges.ts): a session whose
 *    login waits (`waits(strength)`: a username and password with nothing stronger; a PGP key login
 *    is strong, owner 6 Nov 2026 Q81, strength.ts) changing its login methods, payout wallets, login
 *    name, security settings, recovery code, a team member's permissions or removing a wallet or a
 *    team member (owner p5-7: removals included, so nothing applies early; `SECURITY_CHANGE_ROUTES`,
 *    `PATCH` and `DELETE /v1/team/members/:id`) gets each change staged (`gateChange`, 202 `{
 *    status: 'staged', changeId }`), reviews them and submits them; they apply 24 h after the latest
 *    submission. Nobody is logged out, trades and offers go on, no `account_holds` row. Any
 *    logged-in session of the account owner cancels them (all, or one at a time: g65); a strong
 *    login may approve them now (G58); a member the lead gave hold rights sees, cancels or approves
 *    them (p4-8, holdRoutes.ts); the owner is alerted (in-app and push; Jabber later) with the list.
 * 2. **A recovery-code login holds the account 24 h** (`account_holds`, reason `recovery-code`;
 *    recovery.ts `backupSession`, all in the login's transaction): every session of the account
 *    (the owner's and the team members') is logged out, waiting changes are kept (owner G32: they
 *    still wait their 24 h and any session of the owner, the recovery one included, cancels them), open trades
 *    are held (trades/held.ts: unfunded ones cancelled, funded ones paused, the
 *    partner told only that the other account has a temporary problem), the code used is replaced
 *    by a new one shown once at the next login. During it no login opens a session (traderLogin;
 *    members: sessions.ts `openSession`) except the owner's proof, and the recovery session itself
 *    is limited as before (`requireSession`'s `allowHeld`). It ends: by time (`holdInTx`,
 *    `settleDueHolds`); by a login with a passkey, security key or PGP key the account held when
 *    it started (`endHoldIfOwner`; a password with an authenticator code is not enough, owner 2
 *    Nov), which also ends the recovery and waiting sessions; or by a moderator
 *    (`endHoldByModerator`, `extendHoldByModerator`: internal hooks, the staff API comes later).
 *
 * Holds of the older reasons (`weak-change`, `weak-new-device`, `weak-backup-login`) are no longer
 * started; one running at deploy settles as before (its `pending_change` applies by time).
 * A new device with nothing logged in to approve it gets in only with a passkey, security key or
 * PGP key (traderLogin, 403 `approval-unavailable`); nothing is held.
 *
 * Unchanged from Tasks 16-17:
 * - **During an account hold** (`hold_until > now`): no new trades, offers or payout-wallet
 *   changes, no approving new logins, no change to how the account logs in (`requireNotHeld`,
 *   `HOLD_BLOCKED_ROUTES`; 403 `recovery-hold` `{ holdUntil }`).
 * - **Weak sessions** (`weakOf`: the login waits, its sign-up window is over) may log out no
 *   session but their own (review round 3 R3-M2, lead decision 2026-10-30) and a backup session
 *   younger than themselves (round 4 R4-M1, lead decision 2026-10-30), and may not answer a
 *   strong login's approval, drop another session's push subscriptions or mark the hold's own
 *   alerts seen (`WEAK_LIMITED_ROUTES`; 403 `weak-session`).
 * - Every read-modify-write of a hold or of the waiting changes locks the account row first
 *   (`lockAccount`); the approval paths (login, deciding, collecting an approved login) take the
 *   approval lock before it; a trade event takes its trade row lock before it.
 * - **The calling session is live where it writes** (review round 4, the class of R3-I1 and
 *   R4-I1): every route in `LIVE_SESSION_ROUTES` re-checks its session inside the transaction that
 *   writes, under the account lock (`requireLiveSessionInTx`), so a request in flight across the
 *   owner's proof acts for nobody (401 `not-authenticated`, nothing written).
 * - **Lock order note** (review round 3 R3-M5): `POST /v1/account/login-name` takes `NAMES_LOCK`
 *   (`loginNameTaken`) before the account lock (`gateChange`), while applying a waiting login name
 *   takes the account lock before `NAMES_LOCK` (`applyLoginName`). If both run at once Postgres
 *   reports a deadlock (40P01) and aborts one: harmless, as the route answers 409
 *   `names-unavailable` and the settle retries. Left as it is on purpose; new code should take the
 *   account lock last.
 */
import type { MethodType } from '@x2f/accounts';
import type { FastifyBaseLogger, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type pg from 'pg';
import type { Deps } from '../app.js';
import { addAlert } from '../alerts.js';
import type { Config } from '../config.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import type { EventBus } from '../events/bus.js';
import type { RetentionJob } from '../retention.js';
import { applyLoginName, applyOneDevice } from '../routes/account.js';
import { applyWalletRemoval, applyWallets, type PendingWallet } from '../wallets/routes.js';
import type { ConfirmMethod } from './confirm.js';
import { applyRemoval } from './methods.js';
import { applyPassword } from './password.js';
import { applyPgpKey } from './pgp.js';
import { applyRecoveryCodes } from './recovery.js';
import { waits, type LoginStrength } from './strength.js';
import { applyTotp } from './totp.js';
import { CHAT_KEY_WRITE_ROUTES } from './chatKeyRouteList.js';
import { JABBER_WRITE_ROUTES } from '../jabber/routeList.js';
import { applyCredential, type StoredCredential } from './webauthn.js';
import { applyAbilities, applyMemberRemoval } from '../team/members.js';
import { rolesToAbilities, type TeamRole } from '../team/abilities.js';
import { applyLimits, parseBand, parseHours, type LoginHours, type TradeBandView } from '../team/limits.js';
import { releaseHeldTrades, syncHeldTrades } from '../trades/held.js';
import type { TradePublisher } from '../trades/store.js';
import { HOLD_CHANGE_ACTIONS_PER_DAY, holdActionsKey, stageChange } from './holdChanges.js';
import { dailyCapInTx } from './throttle.js';

export const HOLD_MS = 24 * 3_600_000;

/** Only `recovery-code` is started now (model v3); the others may still be running from before. */
export type HoldReason = 'weak-change' | 'weak-new-device' | 'weak-backup-login' | 'recovery-code';

/**
 * A change waiting out the hold, in the form its table stores it (a password hash, a sealed key or
 * secret, code hashes): never a plain secret.
 */
export type PendingChange =
  | { kind: 'password'; hash: string; pepperId: number }
  | { kind: 'totp'; secretEnc: string; step: number }
  | { kind: 'pgp'; fingerprint: string; keyEnc: string; recipient?: string | null }
  | { kind: 'webauthn'; credential: StoredCredential; label: string | null }
  | { kind: 'recovery-codes'; keyId: number; hashes: string[] }
  | { kind: 'remove-method'; type: MethodType; id: string }
  /** FU-D: the name's keyed tag under `keyId`, never the name. */
  | { kind: 'login-name'; tag: string; keyId: number }
  | { kind: 'one-device'; on: boolean }
  /**
   * Retired with the logout timer (session length, owner 2 Nov 2026; migration 307): a change of
   * this kind stored before then is dropped when its hold settles. Nothing creates one now.
   */
  | { kind: 'logout-timer'; idleHours: number }
  /** Review round 2 N-I4 (lead decision 2026-10-30): payout wallets added by a session whose login waits; `method` is the confirm's. */
  | { kind: 'wallets'; items: PendingWallet[]; method: ConfirmMethod | null }
  /**
   * Model v3: a team member's permissions changed by a username-and-password session, as boxes
   * (Job 1c, J-10): `abilities` sorted in catalogue order, whichever body shape asked for it (the
   * old `{ roles }` is mapped by `rolesToAbilities`). Checked again against the catalogue when it applies.
   */
  | { kind: 'team-abilities'; memberId: string; abilities: string[] }
  /**
   * The roles form staged before the boxes (hold v3, before Job 1c). Nothing stages one now; one
   * still stored applies as its roles' boxes (`rolesToAbilities`), checked again like the above.
   */
  | { kind: 'team-roles'; memberId: string; roles: TeamRole[] }
  /**
   * Owner p5-7 (7 Nov 2026, replacing G5): a payout wallet removed by a username-and-password
   * session; it stays usable until the change applies. `label` and `addressEnd` (the last 6
   * characters, never the address) name it in the review list and the alerts.
   */
  | { kind: 'remove-wallet'; walletId: string; label: string; addressEnd: string }
  /** Owner p5-7: a team member removed by a username-and-password session; they keep their access until it applies. */
  | { kind: 'team-remove'; memberId: string }
  /**
   * J-20 (owner p7-4, p7-11): a member's trade-size band and working hours set by a
   * username-and-password session (S-106: the change waits, nothing else does). Checked again
   * when it applies (`parseBand`, `parseHours`).
   */
  | { kind: 'team-limits'; memberId: string; band: TradeBandView | null; hours: LoginHours };

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
  events?: Pick<EventBus, 'closeAccount' | 'closeSession'> | undefined;
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
  await releaseHeldTrades(db, accountId, now);
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
      endedOthers = await applyChange(db, s, accountId, change, row.started_by, now);
      await db.query('release savepoint pending_change');
      applied = true;
    } catch (e) {
      // A deadlock or serialization failure says nothing about the change: the whole transaction
      // fails, so the hold is still there for the next settle (recovery-rules review round 2 m1).
      if (concurrencyFailure(e)) throw e;
      await db.query('rollback to savepoint pending_change');
      if (!(e instanceof ApiError)) s.log?.error({ err: e, change: change.kind }, 'pending change failed; dropped');
    }
  }
  await addAlert(db, accountId, 'hold-ended', { reason: 'time', change: change?.kind ?? null, applied }, now);
  // Streams of sessions the change ended: closed now (a caller without the bus leaves them to their lifetime).
  if (endedOthers) s.events?.closeAccount(accountId, row.started_by ?? undefined);
  return null;
}

/** A deadlock (40P01) or serialization failure (40001): the transaction must fail and run again. */
export function concurrencyFailure(e: unknown): boolean {
  const code = typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined;
  return code === '40P01' || code === '40001';
}

/** Applies a pending or waiting change through the same write its route uses. True when it ended other sessions. */
export async function applyChange(db: Queryable, s: SettleDeps, accountId: string, c: PendingChange, keep: string | null, now: Date): Promise<boolean> {
  const config = s.config;
  switch (c.kind) {
    case 'password':
      return (await applyPassword(db, accountId, c, keep, now)) > 0;
    case 'totp':
      await applyTotp(db, accountId, Buffer.from(c.secretEnc, 'base64'), c.step, now);
      return false;
    case 'pgp':
      await applyPgpKey(db, config, accountId, c.fingerprint, Buffer.from(c.keyEnc, 'base64'), now, c.recipient);
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
      // Retired (migration 307): nothing to apply.
      return false;
    case 'wallets':
      await applyWallets(db, accountId, c.items, c.method, now);
      return false;
    case 'team-abilities':
    case 'team-roles': {
      const abilities = c.kind === 'team-abilities' ? c.abilities : rolesToAbilities(c.roles);
      const ended = await applyAbilities(db, accountId, c.memberId, abilities, now);
      for (const id of ended) s.events?.closeSession(accountId, id);
      return false;
    }
    case 'remove-wallet':
      await applyWalletRemoval(db, accountId, c.walletId, now);
      return false;
    case 'team-remove': {
      const ended = await applyMemberRemoval(db, accountId, c.memberId, now);
      for (const id of ended) s.events?.closeSession(accountId, id);
      return false;
    }
    case 'team-limits': {
      const ended = await applyLimits(db, accountId, c.memberId, { band: parseBand(c.band), hours: parseHours(c.hours) }, now);
      for (const id of ended) s.events?.closeSession(accountId, id);
      return false;
    }
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
 * Inside a login's transaction (account locked): when an account hold runs and the login proved a
 * passkey, security key or PGP key the account held when the hold started (`ownerProof`), the hold
 * ends now, its pending change (an older-model hold's) is discarded and alert `hold-ended` `{
 * reason: 'owner-login', cancelled }` names it, and the held trades are released (resumed after the
 * commit, `syncHeldTrades`). With it end (review round 2 N-C1, N-I1) every live session whose login
 * waits (`strength` not `strong`, or none recorded), every backup (recovery) session and the
 * session that started the hold: otherwise a backup session that waited out its own 24 hours, or a
 * weak session filling the device limit, would outlive the owner's answer. Alert `sessions-ended`
 * `{ count, reason: 'owner-login' }` when any did. Returns null when no hold ended, else the ids of
 * the sessions it ended (the caller closes their streams after commit).
 *
 * Hold v2 path: it drops the pending change on a strong login, whereas hold v3 (holdChanges.ts)
 * approves or cancels the waiting changes per owner G58. Still reachable: approval.ts calls it on
 * every login that proved a method (`a.proven`), so it ends a running hold of either model.
 */
export async function endHoldIfOwner(db: Queryable, s: SettleDeps, accountId: string, proven: ProvenMethod, now: Date): Promise<string[] | null> {
  const hold = await holdInTx(db, s, accountId, now);
  if (hold === null || !ownerProof(hold, proven)) return null;
  await db.query('delete from account_holds where account_id = $1', [accountId]);
  await releaseHeldTrades(db, accountId, now);
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

/**
 * True when the login proved a passkey, security key or PGP key and every one it names was held
 * when the hold started. A password with an authenticator code never is (owner 2 Nov 2026: an
 * authenticator is not enough to end a hold early).
 */
export function ownerProof(hold: Hold, proven: ProvenMethod | undefined): boolean {
  if (proven === undefined || proven.kind === 'password-totp') return false;
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
  await releaseHeldTrades(db, accountId, now);
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
 * Inside a security route's transaction, before its write (the routes in `SECURITY_CHANGE_ROUTES`,
 * and a team member's roles):
 * - the calling session revoked or expired by now (`requireLiveSessionInTx`, under the account
 *   lock): 401 `not-authenticated` (review rounds 3 and 4);
 * - staff and owner accounts: null (they always log in with two factors);
 * - a running account hold: 403 `recovery-hold` `{ holdUntil }`, for every session of the account;
 * - a session whose login waits (outside its sign-up's first 30 minutes, and other than a backup
 *   session that has already waited out its own 24 hours): the change is staged as a draft of the
 *   session (holdChanges.ts, `stageChange`; 409 `too-many-changes` past `MAX_HOLD_CHANGES`) and `{
 *   changeId }` is returned: the route writes nothing else and answers 202 `stagedReply`;
 * - else null: the route applies the change.
 */
export async function gateChange(
  db: Queryable,
  req: FastifyRequest,
  change: PendingChange,
  // Owner 2026-11-26 (note #161): the sign-up session's first wallet is never staged, past the 30 minutes too.
  opts: { signup?: boolean } = {},
): Promise<{ changeId: string } | null> {
  const deps = req.server.deps;
  const now = deps.clock();
  const { accountId, sessionId } = req.auth;
  // Review round 3 R3-I1, round 4: the session must still be live under the account lock.
  const row = await requireLiveSessionInTx(db, req.auth, now);
  if (row.kind !== 'trader') return null;
  const running = await holdInTx(db, settleOf(req), accountId, now);
  if (running !== null) throw holdRefusal(running.holdUntil);
  const onboarding = (opts.signup === true && row.onboarding_until !== null) || (row.onboarding_until !== null && row.onboarding_until.getTime() > now.getTime());
  // Task 9's backup session already waited its 24 hours before it could change anything (R42:
  // the change waits out the 24 hours once, not twice).
  const waited = row.level === 'recovery' && row.hold_until !== null && row.hold_until.getTime() <= now.getTime();
  if (!waits(row.strength) || onboarding || waited) return null;
  const changeId = await stageChange(db, accountId, sessionId, change, now);
  // Counted only once staged (lead review 8 Nov C1); a refusal here rolls the draft back.
  await dailyCapInTx(db, holdActionsKey(sessionId), HOLD_CHANGE_ACTIONS_PER_DAY, now);
  return { changeId };
}

/** The 202 answer of a change staged for review (it waits 24 h once submitted). */
export const stagedReply = (h: { changeId: string }) => ({ status: 'staged' as const, changeId: h.changeId });

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
  // Review round 2 N-I4 (lead decision 2026-10-30): a payout wallet added by a session whose login
  // waits (a username and password; a PGP key login is strong since Q81) is staged like the rest,
  // whatever the confirm method.
  'POST /v1/wallets',
  // Owner p5-7 (7 Nov 2026): removals wait too, so nothing applies early.
  'DELETE /v1/wallets/:id',
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
  // Owner 26 Nov 2026: the Away switch pauses and turns back on offers (offers/away.ts, through switchOfferStatus).
  'PUT /v1/account/away',
  'POST /v1/trades/:code/events',
];

export const LIVE_SESSION_ROUTES: readonly string[] = [
  ...SECURITY_CHANGE_ROUTES,
  ...LIVE_SESSION_TRADING_ROUTES,
  'POST /v1/account/approvals/:id',
  'DELETE /v1/account/sessions/:id',
  'DELETE /v1/account/recovery-sessions/:id',
  'POST /v1/account/push',
  'DELETE /v1/account/push',
  'POST /v1/account/alerts/:id/seen',
  'POST /v1/account/terms',
  // Session length (owner, 2 Nov 2026): the calling session's own length and "Stay logged in".
  'PUT /v1/account/session/length',
  'POST /v1/account/session/extend',
  // Owner demo note #226: renaming one of the account's wallets re-checks the session under the
  // account lock (wallets/routes.ts `renameHandler`).
  'PUT /v1/wallets/:id/label',
  // Plan 2 Task 18 (team members), classified at its landing next to Tasks 16-17: the account
  // owner's invites, role changes and removals (team/members.ts; the lock is the account's).
  'POST /v1/team/invites',
  'PATCH /v1/team/members/:id',
  'DELETE /v1/team/members/:id',
  // J-20: a member's trade-size band and working hours (team/limits.ts; the lock is the account's).
  'PUT /v1/team/members/:id/limits',
  // Ending a member's signed-in sessions from the Team screen (team/memberSessions.ts; the lock is
  // the account's, then the member's sessions, as a removal).
  'DELETE /v1/team/members/:id/sessions/:sessionId',
  'DELETE /v1/team/members/:id/sessions',
  // Owner 2 Nov 2026: switching to a vendor account (routes/accountType.ts; the lock is the account's).
  'PUT /v1/account/type',
  // Hold model v3: submitting and cancelling the changes waiting their 24 h (holdRoutes.ts), and
  // showing the recovery code that replaced a used one (recovery.ts).
  'POST /v1/account/hold/changes/submit',
  'POST /v1/account/hold/changes/approve',
  'DELETE /v1/account/hold/changes',
  'DELETE /v1/account/hold/changes/:id',
  'POST /v1/account/recovery-code/reveal',
  // Plan 5 Task 10 review round 1 M3: the claim insert re-checks the session and the hold under the
  // account lock (as Task 18's ownerWriteGate).
  'POST /v1/account/past-rep/finish',
  // Owner rule p5-7: the Jabber alert set-up (jabber/routes.ts `writeGate`).
  ...JABBER_WRITE_ROUTES,
  // J-23 groundwork: the chat-key courier re-checks the session (strong, strictly) and the hold
  // under the account lock (auth/chatKeys.ts `strongCallerInTx`).
  ...CHAT_KEY_WRITE_ROUTES,
  // Owner 25 Nov security-key report; security review of wip/lead-seckey-fix: naming a key re-checks
  // the session, the hold and a waiting login under the account lock (auth/webauthn.ts `setKeyLabel`).
  'PUT /v1/account/webauthn/label',
  // Lien recovery (review B1/Q2): the creditor's signed address its recoveries are paid to
  // (disputes/lienRoutes.ts; the lock is the account's).
  'POST /v1/account/liens/:id/recovery-address',
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
  'POST /v1/account/onboarding/end': "only clears this session's own sign-up window, which narrows what the session may do (review M1)",
  // S-085 (auth/deviceBound.ts): renewing this session's own bound cookie with its own browser key.
  'POST /v1/account/session/proof/challenge': "writes only a proof challenge bound to this session; changes no account, approval or security state",
  'POST /v1/account/session/proof': "renews this session's own bound cookie after a signature with the key the session was bound to at login; never extends the session, changes no account, approval or security state",
  'POST /v1/account/totp/start': 'writes only an enrolment challenge bound to this session; its finish is checked',
  'POST /v1/account/webauthn/start': 'writes only a registration challenge bound to this session; its finish is checked',
  'POST /v1/confirm/password': 'writes only a confirm token bound to this session; every route that spends one and writes is checked',
  'POST /v1/confirm/pgp/start': 'writes only a confirm challenge bound to this session',
  'POST /v1/confirm/pgp/finish': 'writes only a confirm token bound to this session; every route that spends one and writes is checked',
  'POST /v1/confirm/webauthn/start': 'writes only a confirm challenge bound to this session',
  'POST /v1/confirm/webauthn/finish': 'writes only a confirm token bound to this session; every route that spends one and writes is checked',
  'POST /v1/account/blocks': 'social: a block row only; no account, session, approval or security state, no obligation',
  'DELETE /v1/account/blocks/:displayName': 'social: removes a block row only; no account, session, approval or security state',
  'PUT /v1/account/blocks/:displayName/note': "social: the note on a block row of mine only (S-093); no account, session, approval or security state",
  'PUT /v1/account/nudges': "the caller's own nudge preferences; no session, approval or security state",
  'POST /v1/nudges': 'a nudge to a trade counterparty; no account, session, approval or security state',
  'POST /v1/method-suggestions': 'a method suggestion row only',
  // Plan 3 Task 20 (encrypted chat), classified at its landing next to Tasks 16-17.
  'POST /v1/chats': 'social: opens a pre-trade chat row on an offer; no account, session, approval or security state, no obligation',
  'POST /v1/chats/:chat/envelopes': 'an encrypted chat line in a chat the caller is in; no account, session, approval or security state',
  'POST /v1/chats/:chat/key': "the signed key record of a chat the caller is in (wraps only); no account, session, approval or security state",
  'POST /v1/chats/:chat/grant': "the caller's fallback grant of a disputed trade's chat key to the moderator (a wrap only); no account, session, approval or security state, no new obligation",
  'POST /v1/chats/:chat/identity': "the caller's chat identity key for one chat; no account, session, approval or security state",
  'POST /v1/trades/:code/chat': "a participant's chat for an open trade (R42: finishing open trades stays allowed); no new obligation",
  // Plan 5 Task 14.
  'PUT /v1/trades/:code/proofs/:id': "a participant's proof ciphertext for their own trade (R42: finishing open trades stays allowed); no account, session, approval or security state, no new obligation",
  'POST /v1/feedback/form': 'a feedback row only, open to held sessions on purpose (owner 2026-10-29)',
  // Plan 4 Task 30: support tickets (the account owner's own question to staff).
  'POST /v1/tickets': 'a support ticket row and its first message only; no account, session, approval or security state, no obligation',
  'POST /v1/tickets/:id/messages': "a message on the caller's own support ticket; no account, session, approval or security state, no obligation",
  'POST /v1/tickets/:id/close': "closes the caller's own support ticket; no account, session, approval or security state, no obligation",
  // Plan 5 Task 3 (reviews), classified at its merge with Tasks 16-17.
  'POST /v1/trades/:code/review': "a participant's one review of their own finished trade (a reviews row only); no account, session, approval or security state, no new obligation",
  'POST /v1/trades/:code/review/skip': "a participant's Skip review of their own finished trade (a review_skips row only); no account, session, approval or security state, no new obligation",
  // Plan 5 Task 19: a dispute of a review about the caller.
  'POST /v1/reviews/:id/dispute': "the subject's one dispute of a review about them (a review_disputes row only; the review shows Under review); no account, session, approval or security state, no obligation",
  // C12b (owner 2026-11-01/02): the opt-in "traded to date" profile line.
  'PUT /v1/account/profile/traded-total': "the caller's own profile display preference (one accounts column); no session, approval or security state, no obligation",
  // Plan 5 Tasks 5 and 12: badge visibility and showing the signed record (one badge_prefs row).
  'PUT /v1/account/badges': "the caller's own badge visibility (a badge_prefs row only; badges are earned, never set); no session, approval or security state, no obligation",
  'PUT /v1/account/record/public': "the caller's own record-on-profile preference (a badge_prefs column only); no session, approval or security state, no obligation",
  // Owner Q75 (6 Nov 2026): the idle reminder.
  'PUT /v1/account/idle-reminder': "the person's own reminder preference (one accounts column of their login); never ends or extends a session; no approval or security state, no obligation",
  // Plan 5 Task 4 (platform feedback), classified at its merge with Tasks 16-17.
  'POST /v1/feedback': 'a platform-feedback row only, holding nothing about the sender; no account, session, approval or security state, no obligation',
  'POST /v1/trades/:code/dispute': 'finishes an open trade (R42); creates no new obligation',
  'POST /v1/trades/:code/appeal': 'finishes an open trade (R42); creates no new obligation',
  'POST /v1/trades/:code/payment-proof': "the seller's proof of a payment a ruling ordered (Plan 4 Task 12); finishes an open dispute, creates no new obligation",
  'POST /v1/trades/:code/identity': "a participant's identity for an open trade; no new obligation",
  'POST /v1/trades/:code/wallet': "the poster's payout wallet for an open trade, from the account's own usable wallets",
  // Owner 17 Nov 2026 (note #6 Q1): the default payout wallet is only what the trade screen picks first.
  'PUT /v1/wallets/:id/default': "which of the account's own saved wallets the trade screen picks first; changes no address, wait or security state, and every take still names its wallet",
  // Plan 5 Task 10: past reputation. No login, session, approval, security or trading state: the
  // caller's own claim rows only (a moderator approves before anything shows).
  'POST /v1/account/past-rep/start': "writes only a past-rep challenge bound to the caller's account; its finish re-checks it",
  'DELETE /v1/account/past-rep/:id': "sets the caller's own past-rep claim to removed",
  // Job 1c (J-10, S-094): notes on traders. Social, as blocks: a note row only (the add also re-checks
  // the session under the account lock and a member's boxes live, in its transaction).
  'POST /v1/account/notes': 'social: a private note row on another trader only; no account, session, approval or security state, no obligation',
  'DELETE /v1/account/notes/:id': "social: removes one of the account's own note rows (the account owner only); no account, session or security state",
  // P-012/P-013 (proof-check, classified at the batch 9 merge): the blur check. Anonymous by design.
  'POST /v1/trades/:code/proofs/:proofId/blur-check': "counts a participant's proof for the blur-check sample (blur_check_proofs/asks rows only); no account, session, approval or security state, no obligation",
  'POST /v1/trades/:code/blur-checks/:proofId': "a participant's anonymous blur-check answer (an answers row naming no one); no account, session, approval or security state, no obligation",
};

/**
 * Routes a weak session (`weakOf`) may use only on itself (review round 2 N-I2, N-I3, N-M3;
 * round 3 R3-M2; 403 `weak-session`): ending any session but its own (a backup session included),
 * answering a strong login's approval, dropping push subscriptions (only its own go), and marking
 * the hold's and the login alerts seen.
 */
export const WEAK_LIMITED_ROUTES: readonly string[] = [
  'DELETE /v1/account/sessions/:id',
  // A member's sessions from the Team screen: a weak session may not end them at all, as it may not
  // through DELETE /v1/account/sessions/:id (team/memberSessions.ts).
  'DELETE /v1/team/members/:id/sessions/:sessionId',
  'DELETE /v1/team/members/:id/sessions',
  // Review round 3 R3-M2, round 4 R4-M1 (lead decision 2026-10-30): a weak full session cancels a
  // backup session only when the weak session is the older of the two.
  'DELETE /v1/account/recovery-sessions/:id',
  'POST /v1/account/approvals/:id',
  'DELETE /v1/account/push',
  'POST /v1/account/push',
  'POST /v1/account/alerts/:id/seen',
  // J-23 groundwork: a weak session may not use the chat-key courier at all (strictly 'strong',
  // auth/chatKeys.ts), on itself or anyone else.
  ...CHAT_KEY_WRITE_ROUTES,
  // Security review of wip/lead-seckey-fix: a waiting session may not rename keys (auth/webauthn.ts `setKeyLabel`).
  'PUT /v1/account/webauthn/label',
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
  // Owner 17 Nov 2026 (note #6 Q1): choosing the default payout wallet, a wallet write like the others.
  'PUT /v1/wallets/:id/default',
  // Owner demo note #226: renaming a wallet, a wallet write like the others.
  'PUT /v1/wallets/:id/label',
  'POST /v1/account/approvals/:id',
  // Plan 2 Task 18 (owner 2026-10-30): every team change waits out a hold; they also check it
  // under the account lock (team/members.ts `ownerWriteGate`).
  'POST /v1/team/invites',
  'PATCH /v1/team/members/:id',
  'PUT /v1/team/members/:id/limits',
  // Hold model v3: during a recovery-code hold every session of the account is logged out, so only
  // the held recovery session could ask; refused (see team/members.ts `ownerWriteGate`).
  'DELETE /v1/team/members/:id',
  // Owner 2 Nov 2026: switching to a vendor account waits out a hold (checked again under the lock).
  'PUT /v1/account/type',
  // Plan 5 Task 10 (owner 1 Nov: during a hold the account is offline to everyone). Listing and
  // removing one's own claims stay open.
  'POST /v1/account/past-rep/start',
  'POST /v1/account/past-rep/finish',
  // Owner rule p5-7 (lead default): the Jabber alert set-up waits out a hold like the other
  // security settings; each also checks it under the account lock (jabber/routes.ts `writeGate`).
  ...JABBER_WRITE_ROUTES,
  // J-23 groundwork (design note 2.4): nothing is handed over during a hold (auth/chatKeys.ts).
  ...CHAT_KEY_WRITE_ROUTES,
  // Lien recovery (review B1/Q2): where a creditor's recoveries are paid is not changed during a hold.
  'POST /v1/account/liens/:id/recovery-address',
];

/**
 * Moderator hook (route: staff/holds.ts). Inside a transaction with the account
 * locked: moves the account hold's end to `until` (never earlier than it was) and the recovery
 * sessions' own holds with it. Alert `hold-extended` `{ holdUntil }`. False when no hold runs.
 */
export async function extendHoldByModerator(db: Queryable, accountId: string, until: Date, now: Date, by: { staffId: string | null }): Promise<boolean> {
  const { rows } = await db.query<{ hold_until: Date }>(
    'update account_holds set hold_until = greatest(hold_until, $2) where account_id = $1 and hold_until > $3 returning hold_until',
    [accountId, until, now],
  );
  const end = rows[0]?.hold_until;
  if (end === undefined) return false;
  await db.query(
    "update sessions set hold_until = $2 where account_id = $1 and level = 'recovery' and revoked_at is null and hold_until is not null",
    [accountId, end],
  );
  await addAlert(db, accountId, 'hold-extended', { holdUntil: end.toISOString(), staff: by.staffId !== null }, now);
  return true;
}

/**
 * Moderator hook (route: staff/holds.ts): ends the account's hold now, in a transaction of its own with the
 * account locked: the pending change of an older-model hold is dropped, the held trades are
 * released and resumed after the commit (through `publish`, so the partners' live views hear it),
 * alert `hold-ended` `{ reason: 'moderator' }`, and `audit` (the staff route's activity-log entry)
 * in the same transaction (lead review 8 Nov minor 6: no unaudited end, owner G35). Sessions are
 * left as they are (the moderator vetted the person in). False when no hold ran.
 */
export async function endHoldByModerator(
  deps: Pick<Deps, 'db' | 'clock' | 'config'>,
  accountId: string,
  by: { staffId: string | null },
  events?: SettleDeps['events'],
  publish?: TradePublisher,
  audit?: (db: pg.PoolClient, now: Date) => Promise<unknown>,
  /** Runs first, under the account lock, with the running hold; a throw ends nothing (D-064's channel check). */
  precheck?: (db: pg.PoolClient, hold: Hold) => Promise<void>,
): Promise<boolean> {
  const now = deps.clock();
  const ended = await withTx(deps.db, async (db) => {
    await lockAccount(db, accountId);
    const hold = await holdInTx(db, { config: deps.config, events }, accountId, now);
    if (hold === null) return false;
    if (precheck) await precheck(db, hold);
    await db.query('delete from account_holds where account_id = $1', [accountId]);
    await releaseHeldTrades(db, accountId, now);
    await db.query(
      "update sessions set hold_until = $2 where account_id = $1 and level = 'recovery' and revoked_at is null and hold_until > $2",
      [accountId, now],
    );
    await addAlert(db, accountId, 'hold-ended', { reason: 'moderator', cancelled: hold.pendingChange?.kind ?? null, staff: by.staffId !== null }, now);
    if (audit) await audit(db, now);
    return true;
  });
  if (ended) await syncHeldTrades({ db: deps.db, clock: deps.clock, ...(publish ? { publish } : {}) }, accountId);
  return ended;
}

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
