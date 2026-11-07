// Session length and "Stay logged in?" (owner, 2 Nov 2026): the words of the SessionLength,
// SessionExtend and Devices boards (docs/design-boards on wip/design-brief). The boards are marked
// Draft copy, so every sentence here is COPY-UNSIGNED until the owner signs them off.

export const SESSION_LENGTH_PATH = '/session-length';
/** The idle reminder setting (owner Q75): IdleReminderSettings.tsx. */
export const IDLE_REMINDER_PATH = '/settings/idle-reminder';

// COPY-UNSIGNED (all of SESSION_COPY).
export const SESSION_COPY = {
  // SessionLength board
  loggedInAs: (name: string) => `You're logged in as ${name}.`,
  question: 'How long should this session stay logged in?',
  label: 'Stay logged in for',
  placeholder: 'Choose a time',
  option: (h: number) => `${h} hours`,
  sleepHint: "Longer sessions so you don't miss a trade while you sleep. Turn on alert sounds so a new trade wakes you.",
  askHint: "When this time is up, we'll ask you to confirm it's you to stay logged in. If you don't, you're logged out.",
  changeBefore: 'You can change this any time in ',
  changeLink: 'Devices and sessions',
  changeAfter: '.',
  pickFirst: 'Pick a time to continue.',
  continue: 'Continue',
  // Not on the board (a fault): the choice did not save.
  saveFailed: 'Could not save that. Try again.',
  // SessionExtend board
  extendTitle: 'Stay logged in?',
  // DESIGN: wording (owner Q73, 6 Nov 2026: the warning comes 5 minutes before the end; the person
  // picks how long from the login choices). Replaces the board's "is up" sentence. Review M2: no
  // fixed minutes or stored length here; the countdown under it tells the time left.
  extendBody: "Your session is about to end. Confirm it's you to stay logged in.",
  loggingOutIn: 'Logging out in ',
  stayLoggedIn: 'Stay logged in',
  // The "Log out" words stay beside the logOut(env) call in SessionPrompt.tsx (test/logout-tripwire.test.ts).
  extended: (h: number) => `You're logged in for another ${h} h.`,
  // Not on the board (a fault): the extend call failed after the proof.
  extendFailed: 'Could not keep you logged in. Try again.',
  outTitle: "You're logged out",
  outBody: 'Your session time ran out. Log in again to keep trading.',
  logIn: 'Log in',
  // Devices board. A new time starts now (owner G24); one that ends later asks to confirm it's you.
  saved: 'Saved.',
} as const;

/** "1 hour", "2 hours", "15 minutes": an idle-reminder interval in words. */
const interval = (m: number): string => (m % 60 === 0 ? (m === 60 ? '1 hour' : `${m / 60} hours`) : `${m} minutes`);

// DESIGN: wording (all of IDLE_COPY; owner Q75, 6 Nov 2026: an idle reminder in the person's own
// settings, on or off, their own interval; a reminder, never a logout). No board yet.
export const IDLE_COPY = {
  title: 'Idle reminder',
  hint: "We'll remind you when you haven't used X2F for a while. It's only a reminder: you stay logged in.",
  label: 'Remind me after',
  off: 'Off',
  option: interval,
  saved: 'Saved.',
  // Not a board sentence (a fault): the choice did not save.
  saveFailed: 'Could not save that. Try again.',
  reminderTitle: 'Still there?',
  reminderBody: (m: number) => `You haven't used X2F for ${interval(m)}. You're still logged in.`,
  dismiss: "I'm here",
  link: 'Idle reminder',
} as const;
