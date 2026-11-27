// D-059 (owner 30 Oct 11:00-11:50; J-14, ported onto main): the lock a "My account has been
// compromised" report puts on an account. FULL LOCKOUT, at once, server-side: "no logins at all,
// nobody sees the account's info; the thief must not keep access", and "open trades are PAUSED (all
// timers stop) until staff resolve the ticket".
//
// What the lock does, in one transaction with the report (`placeLock`), then at once after the reply
// (`afterLock`):
// - `accounts.disabled_at` is set (kept if already set). Every request of the account's sessions is
//   then refused (`requireSession`: 403 `account-disabled`), every login is refused after its
//   credential (`assertNotDisabled`), its offers leave every list, can't be taken, and its push
//   subscriptions are dropped (105_push trigger).
// - In the same transaction, every session of the account is revoked (review item 2), and their
//   live streams end right after the commit. For a team member's login, the member's sessions (rows
//   of the team account tagged with the member) are revoked and their streams ended too.
// - The account's open trades are paused (`pause`, by the system) and stay paused: the timer loop
//   pauses any it missed and never resumes a held trade (`timerEvents`' `locked`); no trader event
//   moves a held trade (`applyEvent`: 409 `wrong-state`, as on any paused trade, so the other party
//   cannot tell a lock from a pause; opening a dispute and appealing go through, review item 5);
//   the moderation service sees it as paused (`/internal/v1/watch`), so it decides nothing (no
//   auto-refund, no fallback); dispute timers stop (disputes/timers.ts) and ruling work is refused
//   (disputes/rulings.ts), except by staff with `rulings.approve`, and a freeze still goes in, each
//   logged `dispute.lock-override` (review item 1: no self-stall). Chain events and the moderation service's reports are still recorded, so
//   coins that arrive are never lost track of.
// - Only staff end it (`unlockAccount`: perm `accounts.freeze`, a senior moderator or the owner,
//   with a security-key tap `unlock-account`).
//
// Never locked by the form: staff and owner accounts (anyone who learned a moderator's login name
// could otherwise lock the moderators out; staff have their own switch-off). Their report is kept
// with no account, so the answer never tells whose name it was.
import type pg from 'pg';
import type { Deps } from '../app.js';
import type { Queryable } from '../db/pool.js';
import type { EventBus } from '../events/bus.js';
import { appendLog } from '../log/append.js';
import { applyEvent, type TradePublisher } from '../trades/store.js';

/**
 * The account kinds the compromised form locks: traders and team members' logins, never a staff
 * account or the owner (lead default, owner question pending: a staff account is reset by the owner
 * through the staff site, and a form that needs no login must not be able to lock out staff).
 */
export const LOCKABLE_KINDS = ['trader', 'member'] as const;

export { lockedSql, tradeHeldSql } from './held.js';

/**
 * Review of feat/lockout, item 1 (lead default, owner question pending): once staff unlock an
 * account, the form records reports on it but never locks it again for this long, so a party cannot
 * stall a trade's dispute for good by re-reporting their own account after each unlock.
 */
export const RELOCK_BAR_DAYS = 30;

/**
 * Review item 4 (lead default, owner question pending): at most this many new locks site wide in any
 * hour. Over it, a report is still recorded (real victims can still file) but locks nothing, and the
 * owner is alerted (`compromised-lock-cap`), so a list of login names cannot lock the site out.
 */
export const LOCK_CAP_PER_HOUR = 20;

/** Why a report that matched a lockable account did not lock it (`tickets.lock_skipped`). */
export type LockSkip = 'recent-unlock' | 'legacy-login-name' | 'lock-cap';

export interface PlacedLock {
  accountId: string;
  kind: 'trader' | 'member';
  /** The member's team row, for a member's login (its sessions are the team account's). */
  memberId: string | null;
  /** False when the account was already locked: nothing new, the report still names it. */
  placed: boolean;
  /** The sessions revoked in the lock's transaction, whose streams end after the commit (`closeLockStreams`). */
  revoked: Array<{ accountId: string; sessionId: string }>;
}

export type LockResult = { kind: 'locked'; lock: PlacedLock } | { kind: 'skipped'; reason: LockSkip } | { kind: 'not-lockable' };

/**
 * In `c`'s transaction: revokes every session of the account (and, for a team member's login, the
 * member's sessions, rows of the team account tagged with the member) created at or before `now`.
 * Returns them, for their streams to be ended after the commit.
 */
async function revokeSessions(c: Queryable, accountId: string, memberId: string | null, now: Date): Promise<PlacedLock['revoked']> {
  const r = await c.query<{ id: string; account_id: string }>(
    `update sessions set revoked_at = $3
      where (account_id = $1 or ($2::uuid is not null and member_id = $2::uuid)) and revoked_at is null and created_at <= $3
      returning id, account_id`,
    [accountId, memberId, now],
  );
  return r.rows.map((x) => ({ accountId: x.account_id, sessionId: x.id }));
}

/**
 * In the report's transaction: locks the account `accountId` (a trader or a member login) if it is
 * not locked yet, revokes every one of its sessions in the same transaction (review item 2: never
 * left to the after-reply work), and logs it (`account.locked`, ids only). It does not lock, and says
 * why, for an account staff unlocked in the last RELOCK_BAR_DAYS, a pre-009 account whose login name
 * is its public Trade Tag, or once LOCK_CAP_PER_HOUR new locks were placed in the last hour.
 */
export async function placeLock(c: pg.PoolClient, accountId: string, ticketId: string, now: Date): Promise<LockResult> {
  const { rows } = await c.query<{ kind: string; disabled: boolean; legacy: boolean; member_id: string | null }>(
    `select a.kind, a.disabled_at is not null as disabled, a.legacy_login_name as legacy,
            (select tm.id from team_members tm where tm.member_account_id = a.id) as member_id
       from accounts a where a.id = $1 for no key update`,
    [accountId],
  );
  const a = rows[0];
  if (!a || !(LOCKABLE_KINDS as readonly string[]).includes(a.kind)) return { kind: 'not-lockable' };
  const kind = a.kind as PlacedLock['kind'];
  const existing = await c.query('select 1 from account_locks where account_id = $1 and unlocked_at is null', [accountId]);
  if ((existing.rowCount ?? 0) > 0) return { kind: 'locked', lock: { accountId, kind, memberId: a.member_id, placed: false, revoked: [] } };
  // Review item 3: the login name of a pre-009 account is its public Trade Tag, so anyone could
  // type it; the report is kept for staff, flagged, and locks nothing.
  if (a.legacy) return { kind: 'skipped', reason: 'legacy-login-name' };
  const barred = await c.query('select 1 from account_locks where account_id = $1 and relock_after > $2 limit 1', [accountId, now]);
  if ((barred.rowCount ?? 0) > 0) return { kind: 'skipped', reason: 'recent-unlock' };
  // One count at a time site wide (the transaction's advisory lock), so a burst cannot pass the cap.
  await c.query("select pg_advisory_xact_lock(hashtext('x2f/compromised-lock-cap'))");
  const recent = await c.query<{ n: number }>('select count(*)::int as n from account_locks where locked_at > $1', [new Date(now.getTime() - 3_600_000)]);
  if (recent.rows[0]!.n >= LOCK_CAP_PER_HOUR) return { kind: 'skipped', reason: 'lock-cap' };
  await c.query('insert into account_locks (account_id, ticket_id, locked_at, set_disabled) values ($1, $2, $3, $4)', [accountId, ticketId, now, !a.disabled]);
  await c.query('update accounts set disabled_at = coalesce(disabled_at, $2) where id = $1', [accountId, now]);
  const revoked = await revokeSessions(c, accountId, a.member_id, now);
  await appendLog(c, { at: now, actor: { kind: 'system' }, tradeCode: null, action: 'account.locked', detail: { accountId, ticketId } });
  return { kind: 'locked', lock: { accountId, kind, memberId: a.member_id, placed: true, revoked } };
}

/** After the commit that revoked them: ends the live streams of the account and of each revoked session. */
export function closeLockStreams(events: Pick<EventBus, 'closeAccount' | 'closeSession'>, accountId: string, revoked: PlacedLock['revoked']): void {
  events.closeAccount(accountId);
  for (const s of revoked) events.closeSession(s.accountId, s.sessionId);
}

export interface AfterLockDeps {
  db: pg.Pool;
  clock: Deps['clock'];
  publish?: TradePublisher;
  log?: (reason: string) => void;
}

/**
 * After the reply: pauses every open trade of the account (the sessions were revoked in the lock's
 * transaction, review item 2). Each pause is its own transaction; one that fails is left to the timer
 * loop, which pauses every held trade on its next pass, and the trade is held anyway (no trader event,
 * paused to the moderation service) from the lock's commit on.
 */
export async function afterLock(deps: AfterLockDeps, lock: PlacedLock): Promise<void> {
  if (lock.kind !== 'trader') return;
  const { rows } = await deps.db.query<{ code: string }>(
    `select code from trades
      where (seller_account_id = $1 or buyer_account_id = $1) and paused_at is null
        and (closed_at is null or (state = 'refunded' and settling = 'buyer-cancel' and cancel_confirmed_at is null and dispute_by is null and paid_at is null))
      order by code`,
    [lock.accountId],
  );
  for (const { code } of rows) {
    try {
      await applyEvent({ db: deps.db, clock: deps.clock, ...(deps.publish ? { publish: deps.publish } : {}) }, code, { type: 'pause' }, 'system');
    } catch {
      deps.log?.('lock-pause-deferred');
    }
  }
}

/** The account's lock that has not been lifted, or null. */
export async function activeLock(q: Queryable, accountId: string): Promise<{ id: string; lockedAt: Date; setDisabled: boolean } | null> {
  const { rows } = await q.query<{ id: string; locked_at: Date; set_disabled: boolean }>(
    'select id, locked_at, set_disabled from account_locks where account_id = $1 and unlocked_at is null',
    [accountId],
  );
  const r = rows[0];
  return r ? { id: r.id, lockedAt: r.locked_at, setDisabled: r.set_disabled } : null;
}

/**
 * Lifts the account's lock (staff only; the route checks the perm and the tap). `disabled_at` is
 * cleared only when the lock set it AND it still holds the lock's own time: a disable that something
 * else set (a closure, a ban's switch-off) stays. Every session created before the unlock (so every
 * one from before the lock, whatever let it through) is revoked (review item 2): the owner logs in
 * afresh. The form cannot lock the account again for RELOCK_BAR_DAYS (`relock_after`, review item 1).
 * Held trades resume on the timer loop's next pass. Returns null when there was no active lock, else
 * the sessions revoked, whose streams end after the commit (`closeLockStreams`).
 */
export async function unlockAccount(c: pg.PoolClient, accountId: string, staffId: string, now: Date): Promise<PlacedLock['revoked'] | null> {
  const lock = await activeLock(c, accountId);
  if (lock === null) return null;
  await c.query('update account_locks set unlocked_at = $2, unlocked_by = $3, relock_after = $4 where id = $1', [
    lock.id, now, staffId, new Date(now.getTime() + RELOCK_BAR_DAYS * 86_400_000),
  ]);
  if (lock.setDisabled) await c.query('update accounts set disabled_at = null where id = $1 and disabled_at = $2', [accountId, lock.lockedAt]);
  const member = await c.query<{ id: string }>('select id from team_members where member_account_id = $1', [accountId]);
  return revokeSessions(c, accountId, member.rows[0]?.id ?? null, now);
}
