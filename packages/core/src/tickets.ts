/**
 * Support tickets (Plan 4 Tasks 30-31; owner D-054, D-055, D-056, D-057, D-059). Shared so the API's
 * limits and the web's messages cannot drift apart.
 */

/**
 * Tickets an account opens per UTC day: owner Q67 (6 Nov 2026), "feedback and tickets at a maximum of
 * ten per day", to stop spam. Shared across a team (owner Q69: "keep tickets shared"): every member
 * and the account owner count against the team account's one number.
 */
export const TICKETS_DAILY = 10;

/**
 * The categories a trader picks from, "Everything else" last (owner D-054, 28 Oct Q9). OWNER TO
 * CONFIRM the list (plan Task 30): these are the lead's placeholder categories. `compromised` is not
 * here: it is its own form, open without a login (D-059).
 */
export const TICKET_CATEGORIES = ['login-security', 'trades', 'offers', 'wallets', 'everything-else'] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

/** Longest message in a ticket thread, in code points. */
export const TICKET_BODY_MAX = 4000;

/**
 * The ways to log in a "My account has been compromised" sender may tick as still theirs (D-059:
 * "whatever credentials they still have"). Only the kind is ever sent or kept, never a secret: the
 * form has no login, so it must never check, store or echo a password, a code or a key.
 */
export const COMPROMISED_METHODS = ['password', 'passkey', 'security-key', 'pgp', 'authenticator', 'recovery-code'] as const;
export type CompromisedMethod = (typeof COMPROMISED_METHODS)[number];
