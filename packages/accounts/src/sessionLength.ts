/**
 * Session length (owner, 2 Nov 2026; boards SessionLength, SessionExtend, Devices). After every
 * login the person picks how long this session lasts, from a drop-down with nothing pre-selected.
 * The chosen time is the session length: using the session never moves its end. When it is up the
 * app asks "Stay logged in?"; confirming with any login method the account has extends it by the
 * same time, and with no answer the person is logged out. There is no fixed maximum.
 *
 * Staff and owner sessions, and backup (recovery) sessions, keep their own fixed rules.
 */

/**
 * Which choices an account gets. Every account is a trader for now; vendor accounts (Settings >
 * Account type, owner 2 Nov) are not built yet and slot in here.
 */
export type SessionAccountType = 'trader' | 'vendor';

const CHOICES: Record<SessionAccountType, readonly number[]> = {
  trader: [2, 4, 6, 12],
  vendor: [2, 6, 12, 24],
};

/** The hours a session of this account type may last, shortest first. */
export function sessionHoursFor(type: SessionAccountType): readonly number[] {
  return CHOICES[type];
}

/** True only for one of the account type's choices (a whole number, not a string). */
export function isSessionHours(type: SessionAccountType, v: unknown): v is number {
  return typeof v === 'number' && CHOICES[type].includes(v);
}

/**
 * A session whose length was never chosen (the person closed the page at the question) lasts the
 * shortest choice of every account type, so it is never longer than any choice.
 */
export const UNCHOSEN_SESSION_HOURS = 2;

/**
 * How long "Stay logged in?" waits for an answer before the person is logged out. OPEN, an owner
 * question (board SessionExtend; draft 2 minutes). The prompt opens this long before the session's
 * end, so a session never runs past its chosen length without a login method.
 */
export const SESSION_PROMPT_MS = 2 * 60_000;
