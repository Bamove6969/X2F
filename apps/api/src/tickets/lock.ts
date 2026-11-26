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
// - After the reply, every session of the account is revoked and its live streams end
//   (`endAllSessions`). For a team member's login, the member's sessions (rows of the team account
//   tagged with the member) are revoked and their streams ended too.
// - The account's open trades are paused (`pause`, by the system) and stay paused: the timer loop
//   pauses any it missed and never resumes a held trade (`timerEvents`' `locked`); no trader or
//   moderator event moves a held trade (`applyEvent`: 409 `trade-held`, for the other party too);
//   the moderation service sees it as paused (`/internal/v1/watch`), so it decides nothing (no
//   auto-refund, no fallback); dispute timers stop (disputes/timers.ts) and ruling work is refused
//   (disputes/rulings.ts). Chain events and the moderation service's reports are still recorded, so
//   coins that arrive are never lost track of.
// - Only staff end it (`unlockAccount`: perm `accounts.freeze`, a senior moderator or the owner,
//   with a security-key tap `unlock-account`).
//
// Never locked by the form: staff and owner accounts (anyone who learned a moderator's login name
// could otherwise lock the moderators out; staff have their own switch-off). Their report is kept
// with no account, so the answer never tells whose name it was.
import type pg from 'pg';
import type { Deps } from '../app.js';
import { endAllSessions } from '../auth/sessions.js';
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

export interface PlacedLock {
  accountId: string;
  kind: 'trader' | 'member';
  /** The member's team row, for a member's login (its sessions are the team account's). */
  memberId: string | null;
  /** False when the account was already locked: nothing new, the report still names it. */
  placed: boolean;
}

/**
 * In the report's transaction: locks the account `accountId` (a trader or a member login) if it is
 * not locked yet, and logs it (`account.locked`, ids only). Null for an account the form never locks.
 */
export async function placeLock(c: pg.PoolClient, accountId: string, ticketId: string, now: Date): Promise<PlacedLock | null> {
  const { rows } = await c.query<{ kind: string; disabled: boolean; member_id: string | null }>(
    `select a.kind, a.disabled_at is not null as disabled,
            (select tm.id from team_members tm where tm.member_account_id = a.id) as member_id
       from accounts a where a.id = $1 for no key update`,
    [accountId],
  );
  const a = rows[0];
  if (!a || !(LOCKABLE_KINDS as readonly string[]).includes(a.kind)) return null;
  const kind = a.kind as PlacedLock['kind'];
  const existing = await c.query('select 1 from account_locks where account_id = $1 and unlocked_at is null', [accountId]);
  if ((existing.rowCount ?? 0) > 0) return { accountId, kind, memberId: a.member_id, placed: false };
  await c.query('insert into account_locks (account_id, ticket_id, locked_at, set_disabled) values ($1, $2, $3, $4)', [accountId, ticketId, now, !a.disabled]);
  await c.query('update accounts set disabled_at = coalesce(disabled_at, $2) where id = $1', [accountId, now]);
  await appendLog(c, { at: now, actor: { kind: 'system' }, tradeCode: null, action: 'account.locked', detail: { accountId, ticketId } });
  return { accountId, kind, memberId: a.member_id, placed: true };
}

export interface AfterLockDeps {
  db: pg.Pool;
  clock: Deps['clock'];
  events: Pick<EventBus, 'closeAccount' | 'closeSession'>;
  publish?: TradePublisher;
  log?: (reason: string) => void;
}

/**
 * After the reply: revokes every session (and ends their streams), then pauses every open trade of
 * the account. Each pause is its own transaction; one that fails is left to the timer loop, which
 * pauses every held trade on its next pass, and the trade is held anyway (no trader event, paused to
 * the moderation service) from the lock's commit on.
 */
export async function afterLock(deps: AfterLockDeps, lock: PlacedLock): Promise<void> {
  await endAllSessions(deps, lock.accountId);
  if (lock.memberId !== null) {
    const r = await deps.db.query<{ id: string; account_id: string }>(
      'update sessions set revoked_at = $2 where member_id = $1 and revoked_at is null returning id, account_id',
      [lock.memberId, deps.clock()],
    );
    for (const s of r.rows) deps.events.closeSession(s.account_id, s.id);
  }
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
 * else set (a closure, a ban's switch-off) stays. Held trades resume on the timer loop's next pass.
 * Returns false when there was no active lock.
 */
export async function unlockAccount(c: pg.PoolClient, accountId: string, staffId: string, now: Date): Promise<boolean> {
  const lock = await activeLock(c, accountId);
  if (lock === null) return false;
  await c.query('update account_locks set unlocked_at = $2, unlocked_by = $3 where id = $1', [lock.id, now, staffId]);
  if (lock.setDisabled) await c.query('update accounts set disabled_at = null where id = $1 and disabled_at = $2', [accountId, lock.lockedAt]);
  return true;
}
