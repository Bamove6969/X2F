/**
 * Support tickets (Plan 4 Tasks 30-31; spec 6.6 "Helper": support tickets "in categories plus a
 * final 'Everything else'"). Shared so the API's checks and both apps' forms cannot drift apart.
 *
 * TICKET_CATEGORIES: lead default, the owner to confirm the list (Task 30); "everything-else" is
 * always last.
 */
export const TICKET_CATEGORIES = ['account', 'trades', 'offers', 'wallets', 'alerts', 'everything-else'] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const TICKET_STATUSES = ['open', 'answered', 'closed'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** One message's length, in characters (code points), after trimming. */
export const TICKET_BODY_MAX = 4000;
/**
 * New tickets per account per rolling 24 hours: the team-abilities table's "shared limit of 10 a
 * day" (owner Q69 on `support-open`), counted from the stored rows.
 */
export const TICKET_OPEN_DAILY = 10;
/** Tickets an account may have not closed at one time (lead default). */
export const TICKET_OPEN_AT_ONCE = 3;
/**
 * `TICKET_KEEP_DAYS` (Task 30: owner to decide; default 90): a ticket is deleted, with its
 * messages, this long after its last activity (`updated_at`: its last message or its close; a take
 * or a release does not count). A ticket that names
 * a trade goes sooner if the trade itself is purged first (the trade retention rules).
 */
export const TICKET_KEEP_DAYS = 90;
