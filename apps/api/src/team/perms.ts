/**
 * What team members may do (Plan 2 Task 18, Job 1c J-10; spec 6.7, R44): the checks on top of
 * the abilities catalogue (team/abilities.ts, one granular box per ability, presets on top).
 *
 * - A route names the abilities that let a member through: `requireSession({ member })`
 *   (auth/sessions.ts) with `'any'`, one ability id, or a list (any one of them). A route that names
 *   none refuses members with 403 `owner-only`, so new routes are the owner's until someone decides
 *   otherwise. A member without the ability gets 403 `forbidden`.
 * - Where one route covers several boxes (a trade event, an offer's status), the handler checks
 *   the exact one (`assertMemberMay`, and `auditMember` again live in the action's transaction).
 * - The owner's hard rules (`HARD_OWNER_ONLY`) are never a box: the routes they cover name no member.
 * - No member may sign escrow (R44, spec 3.1): releasing, funding and registering a trade's
 *   signing identity need the trade's party key, which today lives only on the account owner's
 *   device. Until a per-member key scheme is designed (OPEN, Plan 3 Task 42) they get 403
 *   `member-cannot-sign` whatever the member's boxes. Releasing and funding are the exceptions since
 *   26 Nov 2026 (owner question trades-release; Jess 18:41 UTC for funding): a member the lead gave
 *   Release coins or Fund the escrow, with Hold trade keys, sends that step with the synced escrow
 *   keys after a key confirm (`MEMBER_CONFIRMED_EVENTS`). Taking, accepting and the trade identity
 *   stay the owner's device's (`ownerDeviceOnly`).
 */
import type { CLIENT_EVENTS, TradeEvent } from '@x2f/trade';
import type { FastifyRequest } from 'fastify';
import { ApiError } from '../errors.js';
import { hasAbility, type AbilityNeed } from './abilities.js';

export { legacyRoles, parseAbilities, parseRoles, rolesToAbilities, TEAM_ROLES, type TeamRole } from './abilities.js';

/** At most this many live members (open invites included) per account (owner, 2026-10-29c). */
export const MAX_TEAM_MEMBERS = 3;

/** What a route lets members do: `any` (a read every member may make), one ability, or any one of several. */
export type MemberAccess = AbilityNeed;

/**
 * The trade events that need the trade's party key and no box opens (see `MEMBER_SIGNING_EVENTS`
 * below). Empty since owner 26 Nov 2026: `release-started` left it with the owner question
 * trades-release, and `fund-started` with Jess's 18:41 UTC answer ("funding the escrow for sellers,
 * yes as power granted to them by team lead"). A member holding the event's box and Hold trade keys
 * may send either, with a confirm token for that trade from a passkey, security key or PGP key
 * (`MEMBER_CONFIRMED_EVENTS`, trades/routes.ts; contract in team/memberTrade.ts).
 * To back out: put the event back here.
 */
const MEMBER_SIGNING_EVENTS_LIST: readonly string[] = [];

/**
 * Trade events a member sends only with a confirm-it's-you token for this action and this trade
 * (`{ kind, tradeCode }`), earned with a passkey, security key or PGP key (trades/routes.ts).
 */
export const MEMBER_CONFIRMED_EVENTS: ReadonlyMap<string, 'release-trade' | 'fund-trade'> = new Map([
  ['release-started', 'release-trade'],
  ['fund-started', 'fund-trade'],
]);

/**
 * The boxes a live stream (`GET /v1/events`, the account's trade events) needs: either trades box
 * (review trades-list I1); the bus then carries a member only the events of the parts their boxes
 * allow (events/bus.ts `PublishOptions`).
 */
export const STREAM_ABILITY: readonly string[] = ['trades-see-active', 'trades-see-history'];

/** The client events the events route takes (`open-dispute` comes only through the dispute route). */
export type EventsRouteEvent = Exclude<(typeof CLIENT_EVENTS)[number], 'open-dispute'>;

/**
 * The box each trade event a member may send needs (the events route checks it, and
 * `auditMember` again in the event's transaction). `MEMBER_SIGNING_EVENTS` are refused before.
 * Typed over every client event (review 2026-11-09 m2), so a new one cannot compile without its box.
 */
export const EVENT_ABILITY: Readonly<Record<EventsRouteEvent, string>> = {
  'mark-paid': 'trades-mark-paid',
  extend: 'trades-extend',
  'request-refund': 'trades-cancel-no-show',
  'buyer-cancel': 'trades-cancel',
  'propose-cancel': 'trades-cancel',
  'accept-cancel': 'trades-cancel',
  'withdraw-cancel': 'trades-cancel',
  'walk-away': 'trades-cancel',
  'confirm-cancel': 'trades-confirm-cancel',
  // Owner question trades-release: Release coins (which needs Hold trade keys) and a key confirm.
  'release-started': 'trades-release',
  // Owner 26 Nov 2026 18:41 UTC: Fund the escrow (which needs Hold trade keys) and a key confirm.
  'fund-started': 'trades-fund',
};

/** The box `type` needs; 400 `event-not-allowed` for an event with none (never a 500 from an undefined box). */
export function eventAbility(type: string): string {
  const box = (EVENT_ABILITY as Readonly<Record<string, string | undefined>>)[type];
  if (box === undefined) throw new ApiError(400, 'event-not-allowed');
  return box;
}

/** The boxes that let a member read one of the account's trades (its room, attestation, confirmations). */
export const TRADE_READ: readonly string[] = ['trades-see-active', 'trades-see-history'];

/**
 * The box for each part of the account's trades (the boxes' own words, team/abilities.ts): an open
 * trade needs See active trades, a completed one (closed) See trade history. The trades list
 * (trades/list.ts) and the trade room (trades/routes.ts, review trades-list I1) both apply it.
 */
export const TRADE_PART_ABILITY = { open: 'trades-see-active', completed: 'trades-see-history' } as const;

/** The box a member needs to read this trade: by whether it has closed. */
export function tradePartAbility(closedAt: Date | null): string {
  return closedAt === null ? TRADE_PART_ABILITY.open : TRADE_PART_ABILITY.completed;
}

/** The boxes that let a member reach the trade events route at all (each event then needs its own). */
export const MEMBER_EVENT_ABILITIES: readonly string[] = [
  ...new Set(Object.entries(EVENT_ABILITY).filter(([e]) => !MEMBER_SIGNING_EVENTS_LIST.includes(e)).map(([, a]) => a)),
];

/** 403 `forbidden` unless the calling session is the account owner's or a member's holding `need`. */
export function assertMemberMay(auth: { memberId: string | null; memberAbilities: readonly string[] }, need: AbilityNeed): void {
  if (auth.memberId !== null && !hasAbility(auth.memberAbilities, need)) throw new ApiError(403, 'forbidden');
}

/**
 * Trade events a member may never send, whatever their boxes (403 `member-cannot-sign`): none
 * since 26 Nov 2026 (release and funding are boxes with a key confirm, `MEMBER_CONFIRMED_EVENTS`).
 * Kept as the place to put one back. The buyer's cancel, a refund request and the mutual cancel only
 * record a choice; the signing they lead to is done by the owner's device (Plan 3 Task 42).
 */
export const MEMBER_SIGNING_EVENTS: ReadonlySet<TradeEvent['type']> = new Set(MEMBER_SIGNING_EVENTS_LIST as readonly TradeEvent['type'][]);

/** 403 `member-cannot-sign` for a member session sending a signing event. */
export function assertMemberMaySend(memberId: string | null, event: TradeEvent['type']): void {
  if (memberId !== null && MEMBER_SIGNING_EVENTS.has(event)) throw new ApiError(403, 'member-cannot-sign');
}

/**
 * A preHandler after `requireSession({ member })` for the steps that need the account
 * owner's device (Plan 2 Task 18 review I2, lead decision 2026-10-30): taking an offer, setting a
 * trade's payout wallet (the poster's accept step) and registering a trade identity. Each one makes
 * the device that does it the trade's escrow party (its `ConfirmedTrade`, its own payout address,
 * its trade key), and only the owner's device can be that until Plan 3 Task 42's member keys. A
 * member gets 403 `member-cannot-sign` whatever their boxes; with the boxes they still mark paid, cancel and answer a dispute on
 * the trades the owner's device set up. Kept by the escrow-key sync (migration 864): an assigned member holds an encrypted copy of the keys and, with Release coins or Fund the escrow, sends only those steps; never these three (test/team.test.ts "Task 42 escrow-key sync").
 */
export async function ownerDeviceOnly(req: FastifyRequest): Promise<void> {
  if (req.auth.memberId !== null) throw new ApiError(403, 'member-cannot-sign');
}

/** The routes `ownerDeviceOnly` guards (the tripwire checks each still names it). */
export const OWNER_DEVICE_ROUTES = ['POST /v1/offers/:id/take', 'POST /v1/trades/:code/wallet', 'POST /v1/trades/:code/identity'] as const;
