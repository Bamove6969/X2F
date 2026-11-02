// Session length and "Stay logged in?" (owner, 2 Nov 2026): the words of the SessionLength,
// SessionExtend and Devices boards (docs/design-boards on wip/design-brief). The boards are marked
// Draft copy, so every sentence here is COPY-UNSIGNED until the owner signs them off.

export const SESSION_LENGTH_PATH = '/session-length';

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
  extendBody: (h: number) => `Your ${h}-hour session is up. Confirm it's you to stay logged in for another ${h} hours.`,
  loggingOutIn: 'Logging out in ',
  stayLoggedIn: 'Stay logged in',
  // The "Log out" words stay beside the logOut(env) call in SessionPrompt.tsx (test/logout-tripwire.test.ts).
  extended: (h: number) => `You're logged in for another ${h} h.`,
  // Not on the board (a fault): the extend call failed after the proof.
  extendFailed: 'Could not keep you logged in. Try again.',
  outTitle: "You're logged out",
  outBody: 'Your session time ran out. Log in again to keep trading.',
  logIn: 'Log in',
  // Devices board. Not on the board: when a longer time starts (the safe default, an owner question).
  longerLater: "A longer time starts the next time you confirm it's you.",
  saved: 'Saved.',
} as const;
