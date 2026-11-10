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
 * - an offer, when it is posted or relisted (resumed): its whole range inside [min, max]. Pausing
 *   and removing are never banded (review F2, owner question p11-134, lead default: shutting off
 *   always works). An offer kept in fiat has no fixed size in XMR (it moves with the price), so a
 *   member with a band is refused on posting or resuming it (lead default, conservative; F3);
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

/**
 * OWNER QUESTION p11-136 (review F8 / Q4): does a member see their own band and hours? The lead's
 * recommendation is yes, so this is on: `GET /v1/account/me`'s `member.limits` carries them and the
 * web's Team screen shows a member "Your limits". Off: `/me` leaves `limits` out (the web then
 * shows nothing; a member learns a limit only from a refusal). Enforcement is the same either way.
 */
export const MEMBER_SEES_OWN_LIMITS: boolean = true;

/** A member's own limits as `/v1/account/me` carries them; undefined when MEMBER_SEES_OWN_LIMITS is off, or the row is gone or unreadable. */
export async function ownLimitsView(q: Queryable, memberId: string): Promise<MemberLimitsView | undefined> {
  if (!MEMBER_SEES_OWN_LIMITS) return undefined;
  const { rows } = await q.query<{ band_min_atomic: string | null; band_max_atomic: string | null; hours: unknown }>(
    'select band_min_atomic::text, band_max_atomic::text, hours from team_members where id = $1',
    [memberId],
  );
  const r = rows[0];
  // Every write is checked (`parseHours`); a stored value that is still not valid hours (enforced as
  // never inside) is not shown rather than shown wrong.
  const hours = r ? storedHours(r.hours) : null;
  if (!r || hours === null) return undefined;
  return { band: bandView(bandOf(r.band_min_atomic, r.band_max_atomic)), hours };
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

/**
 * Review F6, as staff (staff/login.ts caps the end a client sees at `windowEndsAt`): the end a
 * member's session reports, `end` or the end of their working window if that is sooner. The
 * stored end is not changed (the window is enforced on every request and by the sweep). `end`
 * unchanged for the account owner and for "any" hours.
 */
export async function endWithinHours(q: Queryable, memberId: string | null, now: Date, end: Date): Promise<Date> {
  if (memberId === null) return end;
  const { rows } = await q.query<{ hours: unknown }>('select hours from team_members where id = $1', [memberId]);
  const until = workingUntil(rows[0]?.hours, now);
  return until !== null && until.getTime() < end.getTime() ? until : end;
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
 * OWNER QUESTION p11-133 (review F1): the unit a band is counted in. The one switch point: every
 * band check values its trade or offer through `tradeSize` / `offerRange` below, which read this.
 * Built: 'xmr' (XMR atomic units, exact, no price feed; design TP4 A). The lead recommends the
 * trade's USD value at market, as the take values it; switching means a 'usd' unit here whose
 * `tradeSize` reads `trades.usd_cents` (set at take, never changes) and whose `offerRange` values
 * the offer's bands with `usdCentsOf` at the current quote (409 `price-unavailable` with none, as the
 * take), plus what follows the stored numbers' unit: the columns' names (migration 380), the
 * request/answer fields (`minAtomic`/`maxAtomic`), the confirm words (accounts confirmAction.ts
 * `bandWords`) and the web editor (teamCopy.ts `bandText`, Team.tsx's inputs).
 */
export const BAND_UNIT = 'xmr' as const;
export type BandUnit = typeof BAND_UNIT;

/** A trade's size in the band's unit; undefined when the trade is not found (left to the action's own 404). */
async function tradeSize(q: Queryable, tradeCode: string): Promise<bigint | undefined> {
  const { rows } = await q.query<{ amount_atomic: string }>('select amount_atomic::text from trades where code = $1', [tradeCode]);
  return rows[0] ? BigInt(rows[0].amount_atomic) : undefined;
}

/**
 * An offer's whole range in the band's unit: every band of every currency (flex offers, migration
 * 490). Null when it has no size in that unit: an offer kept in fiat moves with the price in XMR
 * (refused under a band: lead default, conservative; review F3, follows p11-133). Undefined when the
 * offer is not found.
 */
async function offerRange(q: Queryable, offerId: string): Promise<{ min: bigint; max: bigint } | null | undefined> {
  const { rows } = await q.query<{ amount_unit: string; min: string | null; max: string | null }>(
    `select o.amount_unit, min(t.min_amount)::text as min, max(t.max_amount)::text as max
       from offers o left join offer_tiers t on t.offer_id = o.id where o.id = $1 group by o.id`,
    [offerId],
  );
  const r = rows[0];
  if (!r) return undefined;
  if (r.amount_unit !== BAND_UNIT || r.min === null || r.max === null) return null;
  return { min: BigInt(r.min), max: BigInt(r.max) };
}

/** Whether the offer's whole range is inside `band` (true without a band, or for an offer not found). */
export async function offerInsideBand(q: Queryable, band: TradeBand | null, offerId: string): Promise<boolean> {
  if (band === null) return true;
  const r = await offerRange(q, offerId);
  if (r === undefined) return true;
  return r !== null && r.min >= band.minAtomic && r.max <= band.maxAtomic;
}

/** A member's band (null: none, or the account owner), read in the caller's transaction. */
export async function memberBand(q: Queryable, memberId: string | null): Promise<TradeBand | null> {
  if (memberId === null) return null;
  const { rows } = await q.query<{ band_min_atomic: string | null; band_max_atomic: string | null }>(
    'select band_min_atomic::text, band_max_atomic::text from team_members where id = $1',
    [memberId],
  );
  const r = rows[0];
  return r ? bandOf(r.band_min_atomic, r.band_max_atomic) : null;
}

/**
 * Inside the action's transaction: 403 `outside-trade-band` `{ minAtomic, maxAtomic }` unless the
 * trade (`tradeCode`) or the offer (`offerId`) falls inside `band`. Nothing without a band, or for
 * an action on neither. A trade or offer that is not found is left to the action (its own 404).
 * Callers pass `offerId` only for the actions that create or widen exposure (post, relist; review
 * F2, p11-134): pausing and removing always work.
 */
export async function assertInsideBand(q: Queryable, band: TradeBand | null, on: { tradeCode?: string | null; offerId?: string | null }): Promise<void> {
  if (band === null) return;
  if (on.tradeCode) {
    const a = await tradeSize(q, on.tradeCode);
    if (a !== undefined && (a < band.minAtomic || a > band.maxAtomic)) throw outside(band);
  }
  if (on.offerId && !(await offerInsideBand(q, band, on.offerId))) throw outside(band);
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
