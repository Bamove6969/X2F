/**
 * A team member's signed-in sessions, for the account owner (routes/team.ts):
 * `GET /v1/team/members/:id/sessions`, `DELETE /v1/team/members/:id/sessions/:sessionId` and
 * `DELETE /v1/team/members/:id/sessions` (every one of that member's).
 *
 * The owner already sees and ends every session of the account, members' included, through
 * `GET` and `DELETE /v1/account/sessions` (routes/account.ts); these name one member, so the Team
 * screen can show each member's own sessions and end them without the account's whole list.
 *
 * Ending one only ever sets `revoked_at`: migration 855's trigger then writes the team log's
 * `session-ended` row (category `access`). The lock order is the member removal's and the limits'
 * (team/members.ts `applyMemberRemoval`, team/limits.ts `applyLimits`): the account (the calling
 * session's check, `requireLiveSessionInTx`), then the member's live sessions in id order, then the
 * writes whose trigger takes the team log's lock. A logout locks its session row and then waits on
 * that lock, so taking the rows first never deadlocks with it.
 *
 * As `DELETE /v1/account/sessions/:id` (WEAK_LIMITED_ROUTES): a session whose login waits (a
 * username and password only) may not end a member's session (403 `weak-session`); a member's
 * logins are always strong.
 */
import type { Deps } from '../app.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { requireLiveSessionInTx, weakOf, weakRefusal, withTx } from '../auth/hold.js';
import type { EventBus } from '../events/bus.js';

/** One of a member's live sessions, as the owner's Team screen shows it. */
export interface MemberSessionView {
  id: string;
  /** Chosen by the member's browser at login (never from request headers). */
  deviceLabel: string;
  /** When the member signed in. */
  createdAt: string;
  /** The session's last request. */
  lastSeenAt: string;
}

/** 404 `not-found` unless `memberId` is a member (or open invite) of the account that is not removed. */
async function assertOwnMember(q: Queryable, accountId: string, memberId: string): Promise<void> {
  const { rows } = await q.query('select 1 from team_members where id = $1 and account_id = $2 and removed_at is null', [memberId, accountId]);
  if (rows.length === 0) throw new ApiError(404, 'not-found');
}

/** The member's live sessions (not ended, not expired), most recently seen first. */
export async function listMemberSessions(db: Queryable, accountId: string, memberId: string, now: Date): Promise<MemberSessionView[]> {
  await assertOwnMember(db, accountId, memberId);
  const { rows } = await db.query<{ id: string; device_label: string; created_at: Date; last_seen_at: Date }>(
    `select id, device_label, created_at, last_seen_at from sessions
      where member_id = $1 and account_id = $2 and revoked_at is null and expires_at > $3
      order by last_seen_at desc, created_at desc, id`,
    [memberId, accountId, now],
  );
  return rows.map((s) => ({ id: s.id, deviceLabel: s.device_label, createdAt: s.created_at.toISOString(), lastSeenAt: s.last_seen_at.toISOString() }));
}

/**
 * Ends the member's live session `sessionId`, or with null every live session of theirs. 404
 * `not-found` for a member not of the caller's account (or removed), and for a session that is not
 * that member's; a session of theirs that already ended ends nothing. 401 when the calling session
 * was revoked meanwhile, 403 `weak-session` from a session whose login waits. Returns the sessions
 * ended; their live streams are closed after the commit.
 */
export async function endMemberSessions(
  deps: Pick<Deps, 'db' | 'clock'> & { events: Pick<EventBus, 'closeSession'> },
  caller: { accountId: string; sessionId: string },
  memberId: string,
  sessionId: string | null,
): Promise<string[]> {
  const { accountId } = caller;
  const now = deps.clock();
  const ended = await withTx(deps.db, async (c) => {
    const live = await requireLiveSessionInTx(c, caller, now);
    if (weakOf(live, now)) throw weakRefusal();
    await assertOwnMember(c, accountId, memberId);
    if (sessionId !== null) {
      const { rows } = await c.query('select 1 from sessions where id = $1 and member_id = $2 and account_id = $3', [sessionId, memberId, accountId]);
      if (rows.length === 0) throw new ApiError(404, 'not-found');
    }
    // The member removal's order: the member's live sessions, in id order, before any write.
    await c.query('select 1 from sessions where member_id = $1 and revoked_at is null order by id for update', [memberId]);
    const r = await c.query<{ id: string }>(
      `update sessions set revoked_at = $3
        where member_id = $1 and account_id = $2 and revoked_at is null and expires_at > $3 and ($4::uuid is null or id = $4)
        returning id`,
      [memberId, accountId, now, sessionId],
    );
    return r.rows.map((x) => x.id);
  });
  for (const id of ended) deps.events.closeSession(accountId, id);
  return ended;
}
