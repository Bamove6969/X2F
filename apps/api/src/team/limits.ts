/**
 * The limits a team lead puts on each member on top of the boxes (J-20; owner p7-4 / S-091, p7-11 /
 * S-096; Plan 2 Task 18, Plan 3 Task 42). Stored on `team_members` (migration 380).
 *
 * Trade-size band (p7-4): "this team member can deal with trades from this size to this size ...
 * that will have a lasting effect through all the other features you're giving them". A band is
 * the smallest and the largest trade in XMR atomic units (design TP4 option A: XMR "matches how the
 * trade itself is counted, so the limit doesn't move when the price moves"; the unit is a choice
 * listed for the owner). No band: no cap (TP4 A). With a band, every effectful member action on a
 * trade or an offer must fall inside it, checked in the action's own transaction (`assertLiveMember`
 * in team/audit.ts, the one gate every such action passes):
 * - a trade: its amount (`trades.amount_atomic`, after any growth) inside [min, max];
 * - an offer (post, relist, pause, remove): its whole range inside [min, max]. An offer kept in
 *   fiat has no fixed size in XMR (it moves with the price), so a member with a band is refused on
 *   it (lead default, conservative; listed for the owner);
 * - an action on neither (a note, the lead's waiting changes) is not touched by the band.
 * Reads (seeing trades and offers) are not limited by the band (lead default, listed).
 *
 * Working hours (p7-11): "any" (the default, design TP11 A) or the staff app's days-and-hours
 * window (@x2f/staff LoginHours: local wall-clock time in an IANA zone). Outside it a member cannot
 * log in (403 `outside-login-hours`), an open session ends on its next request (401
 * `outside-login-hours`) or at the next sweep (`endMemberSessionsOutsideHours`, every minute), every
 * effectful action is refused in its transaction, and (review S-m4, owner G9) a session cannot be
 * given an end past the window's end (403 `past-working-hours` `{ workingUntil }`). A stored value
 * that is not valid LoginHours fails closed: the member is outside their hours.
 */
import { validateHours, windowEndsAt, inWindow, type LoginHours } from '@x2f/staff';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import type { EventBus } from '../events/bus.js';
import type { RetentionJob } from '../retention.js';

export type { LoginHours } from '@x2f/staff';

/** A member's trade-size band, XMR atomic units, both ends included. */
export interface TradeBand {
  minAtomic: bigint;
  maxAtomic: bigint;
}

/** The band as JSON answers and staged changes carry it (decimal strings). */
export interface TradeBandView {
  minAtomic: string;
  maxAtomic: string;
}

export interface MemberLimits {
  band: TradeBand | null;
  hours: LoginHours;
}

export interface MemberLimitsView {
  band: TradeBandView | null;
  hours: LoginHours;
}

/** numeric(30, 0): at most 30 digits. */
const ATOMIC = /^(0|[1-9]\d{0,29})$/;

/** Parses a band from a request body: null (no band) or `{ minAtomic, maxAtomic }`, 0 <= min <= max, max > 0. 400 `bad-request` otherwise. */
export function parseBand(raw: unknown): TradeBand | null {
  if (raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new ApiError(400, 'bad-request');
  const o = raw as Record<string, unknown>;
  if (Object.keys(o).sort().join(',') !== 'maxAtomic,minAtomic') throw new ApiError(400, 'bad-request');
  const { minAtomic, maxAtomic } = o;
  if (typeof minAtomic !== 'string' || typeof maxAtomic !== 'string' || !ATOMIC.test(minAtomic) || !ATOMIC.test(maxAtomic)) throw new ApiError(400, 'bad-request');
  const min = BigInt(minAtomic);
  const max = BigInt(maxAtomic);
  if (max === 0n || max < min) throw new ApiError(400, 'bad-request');
  return { minAtomic: min, maxAtomic: max };
}

/** Parses working hours from a request body (`validateHours`); 400 `bad-request` otherwise. */
export function parseHours(raw: unknown): LoginHours {
  try {
    return validateHours(raw);
  } catch {
    throw new ApiError(400, 'bad-request');
  }
}

/** A stored hours value, or null when it is not valid LoginHours (every check then fails closed). */
export function storedHours(raw: unknown): LoginHours | null {
  try {
    return validateHours(raw);
  } catch {
    return null;
  }
}

/** Whether a member with stored hours `raw` may be logged in at `now` (invalid hours: never). */
export function insideHours(raw: unknown, now: Date): boolean {
  const h = storedHours(raw);
  return h !== null && inWindow(h, now);
}

/**
 * The latest end a member's session may be given at `now` (S-m4): the end of the window `now` is
 * in; null for "any". Outside the window it is `now` (nothing later is allowed).
 */
export function workingUntil(raw: unknown, now: Date): Date | null {
  const h = storedHours(raw);
  if (h === null) return now;
  return windowEndsAt(h, now);
}

/**
 * Review S-m4 (owner G9: members "won't be able to extend the session anyway"): inside the session
 * route's transaction, 403 `past-working-hours` `{ workingUntil }` when a member's session would be
 * given an end later than its current one and past the end of the member's working window. Nothing
 * for the account owner, for "any" hours, or for an end no later than the session already has.
 */
export async function assertSessionEndInHours(q: Queryable, memberId: string | null, now: Date, end: Date, currentEnd: Date): Promise<void> {
  if (memberId === null || end.getTime() <= currentEnd.getTime()) return;
  const { rows } = await q.query<{ hours: unknown }>('select hours from team_members where id = $1', [memberId]);
  const until = workingUntil(rows[0]?.hours, now);
  if (until !== null && end.getTime() > until.getTime()) throw new ApiError(403, 'past-working-hours', { workingUntil: until.toISOString() });
}

/** The band of a stored row, or null. */
export function bandOf(min: string | null, max: string | null): TradeBand | null {
  if (min === null || max === null) return null;
  return { minAtomic: BigInt(min), maxAtomic: BigInt(max) };
}

export function bandView(b: TradeBand | null): TradeBandView | null {
  return b === null ? null : { minAtomic: b.minAtomic.toString(), maxAtomic: b.maxAtomic.toString() };
}

/** The confirm action's `band` (bound by the token, `team-limits`): `none` or `<min>-<max>` in atomic units. */
export function bandKey(b: TradeBand | null): string {
  return b === null ? 'none' : `${b.minAtomic}-${b.maxAtomic}`;
}

/** The confirm action's `hours`: `any` or `<days comma-separated> <start>-<end> <tz>`, e.g. `Mon,Tue 08:00-18:00 UTC`. */
export function hoursKey(h: LoginHours): string {
  return h === 'any' ? 'any' : `${h.days.join(',')} ${h.start}-${h.end} ${h.tz}`;
}

/** The band a confirm action's `band` names, or undefined when it is not one `bandKey` makes. */
export function bandFromKey(key: string): TradeBand | null | undefined {
  if (key === 'none') return null;
  const m = /^(0|[1-9]\d{0,29})-([1-9]\d{0,29})$/.exec(key);
  if (!m) return undefined;
  try {
    const b = parseBand({ minAtomic: m[1], maxAtomic: m[2] });
    return b !== null && bandKey(b) === key ? b : undefined;
  } catch {
    return undefined;
  }
}

/** The hours a confirm action's `hours` names, or undefined when it is not one `hoursKey` makes. */
export function hoursFromKey(key: string): LoginHours | undefined {
  if (key === 'any') return 'any';
  const m = /^([A-Za-z,]{3,27}) (\d\d:\d\d)-(\d\d:\d\d) ([A-Za-z0-9_+\-/]{1,64})$/.exec(key);
  if (!m) return undefined;
  try {
    const h = validateHours({ days: m[1]!.split(','), start: m[2], end: m[3], tz: m[4] });
    return hoursKey(h) === key ? h : undefined;
  } catch {
    return undefined;
  }
}

function outside(b: TradeBand): ApiError {
  return new ApiError(403, 'outside-trade-band', { minAtomic: b.minAtomic.toString(), maxAtomic: b.maxAtomic.toString() });
}

/**
 * Inside the action's transaction: 403 `outside-trade-band` `{ minAtomic, maxAtomic }` unless the
 * trade (`tradeCode`) or the offer (`offerId`) falls inside `band`. Nothing without a band, or for
 * an action on neither. A trade or offer that is not found is left to the action (its own 404).
 */
export async function assertInsideBand(q: Queryable, band: TradeBand | null, on: { tradeCode?: string | null; offerId?: string | null }): Promise<void> {
  if (band === null) return;
  if (on.tradeCode) {
    const { rows } = await q.query<{ amount_atomic: string }>('select amount_atomic::text from trades where code = $1', [on.tradeCode]);
    const r = rows[0];
    if (r) {
      const a = BigInt(r.amount_atomic);
      if (a < band.minAtomic || a > band.maxAtomic) throw outside(band);
    }
  }
  if (on.offerId) {
    // Flex offers (migration 490): the range is every band of every currency, in the offer's unit.
    const { rows } = await q.query<{ amount_unit: string; min_atomic: string | null; max_atomic: string | null }>(
      `select o.amount_unit, min(t.min_amount)::text as min_atomic, max(t.max_amount)::text as max_atomic
         from offers o left join offer_tiers t on t.offer_id = o.id where o.id = $1 group by o.id`,
      [on.offerId],
    );
    const r = rows[0];
    if (r) {
      // A fiat range has no fixed XMR size (lead default, conservative): refused under a band.
      if (r.amount_unit !== 'xmr' || r.min_atomic === null || r.max_atomic === null) throw outside(band);
      if (BigInt(r.min_atomic) < band.minAtomic || BigInt(r.max_atomic) > band.maxAtomic) throw outside(band);
    }
  }
}

/**
 * Writes a member's limits (the route's, or a waiting one applied 24 h after a username-and-password
 * session submitted it): live members and open invites only (404 `not-found` otherwise). When the
 * new hours shut the member out now, their sessions end at once; returns those sessions (the caller
 * closes their streams after the commit).
 */
export async function applyLimits(q: Queryable, accountId: string, memberId: string, limits: MemberLimits, now: Date): Promise<string[]> {
  const { rows } = await q.query(
    `update team_members set band_min_atomic = $3, band_max_atomic = $4, hours = $5
      where id = $1 and account_id = $2 and removed_at is null and (joined_at is not null or invite_expires_at > $6) returning id`,
    [memberId, accountId, limits.band?.minAtomic.toString() ?? null, limits.band?.maxAtomic.toString() ?? null, JSON.stringify(limits.hours), now],
  );
  if (rows.length === 0) throw new ApiError(404, 'not-found');
  if (inWindow(limits.hours, now)) return [];
  const s = await q.query<{ id: string }>('update sessions set revoked_at = $2 where member_id = $1 and revoked_at is null returning id', [memberId, now]);
  return s.rows.map((r) => r.id);
}

/**
 * Every minute (with the hold jobs): ends each live member session whose member is outside their
 * working hours now, and closes its streams. Returns how many ended.
 */
export function endMemberSessionsOutsideHours(events: Pick<EventBus, 'closeSession'>): RetentionJob {
  return {
    name: 'endMemberSessionsOutsideHours',
    async run(db, now) {
      const { rows } = await db.query<{ id: string; account_id: string; hours: unknown }>(
        `select s.id, s.account_id, tm.hours from sessions s join team_members tm on tm.id = s.member_id
          where s.member_id is not null and s.revoked_at is null and s.expires_at > $1 and tm.hours <> '"any"'::jsonb`,
        [now],
      );
      let n = 0;
      for (const r of rows) {
        if (insideHours(r.hours, now)) continue;
        const ended = await db.query('update sessions set revoked_at = $2 where id = $1 and revoked_at is null', [r.id, now]);
        if ((ended.rowCount ?? 0) === 0) continue;
        events.closeSession(r.account_id, r.id);
        n++;
      }
      return n;
    },
  };
}
