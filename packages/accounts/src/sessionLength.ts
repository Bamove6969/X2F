/**
 * Session length (owner, 2 Nov 2026; boards SessionLength, SessionExtend, Devices). After every
 * login the person picks how long this session lasts, from a drop-down with nothing pre-selected.
 * The chosen time is the session length: using the session never moves its end. Five minutes before
 * it is up the app asks "Stay logged in?" (owner, Q73, 6 Nov 2026); confirming with one of the
 * person's own login methods (a team member's too) extends it for any of the same choices, and with
 * no answer the person is logged out. There is no fixed maximum.
 *
 * Staff and owner sessions, and backup (recovery) sessions, keep their own fixed rules.
 */

/**
 * Which choices an account gets (owner G23, 7 Nov 2026): traders 2, 4, 8 or 12 hours, vendors 2, 6,
 * 12 or 24, from a drop-down with nothing pre-selected. The API reads the account's type
 * (`sessionAccountType`, apps/api routes/account.ts) and refuses any other number.
 */
export type SessionAccountType = 'trader' | 'vendor';

const CHOICES: Record<SessionAccountType, readonly number[]> = {
  trader: [2, 4, 8, 12],
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
 * The "Stay logged in?" warning: it opens this long before the session's end, so a session never runs
 * past its chosen length without a login method. 5 minutes (owner, Q73, 6 Nov 2026; it replaces the
 * 2 minutes of 2 Nov).
 */
export const SESSION_PROMPT_MS = 5 * 60_000;

/**
 * A chosen length starts when it is chosen (owner G24, 7 Nov 2026): the session then ends `now +
 * length`. The first choice (the question after the login) may move the end later with no proof only
 * this long after the login (lead decision 6 Nov 2026): later, a stolen cookie of an unchosen 2-hour
 * session could otherwise stretch it to 12 or 24 hours. After the window a choice that would end the
 * session later needs a login method ("Stay logged in", `extend-session`); a shorter one applies at once.
 */
export const SESSION_CHOICE_WINDOW_MS = 10 * 60_000;

/**
 * The idle reminder (owner, Q75, 6 Nov 2026): off by default; the person may turn it on in their
 * own settings with one of these intervals, in minutes. A reminder only: it never logs anyone out
 * and never moves the session's end. The interval list is a lead default (owner may change).
 */
export const IDLE_REMINDER_MINUTES: readonly number[] = [10, 15, 30, 60, 120];

/** True only for one of IDLE_REMINDER_MINUTES (a whole number, not a string). */
export function isIdleReminderMinutes(v: unknown): v is number {
  return typeof v === 'number' && IDLE_REMINDER_MINUTES.includes(v);
}
