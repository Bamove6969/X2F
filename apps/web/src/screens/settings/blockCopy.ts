// Plan 3 Task 37: the block's words, following Claude Design's Block board
// (origin/wip/design-brief docs/design-boards/Block.dc.html). // COPY-UNSIGNED: the owner signs
// it off with the board. Softened where the build cannot promise more (review M7): a blocked
// person who logs out sees what any stranger sees, so the promises are "while they're signed in".
// Blocking is silent (the blocked person is never told) and open trades finish normally. The one
// refusal (a block the API refuses) is CantDoThat's, worded in ui/cantDoCodes.ts (CANNOT_BLOCK).

import { formatDateTime } from '../../ui/dates.js';

export const BLOCK_COPY = {
  action: (name: string) => `Block ${name}`,
  confirmTitle: (name: string) => `Block ${name}?`,
  // not-a-refusal: says what the block will stop the other trader doing, not a rule stopping this user
  confirmLead: (name: string) => `Once blocked, while they're signed in, ${name} can't:`,
  cant: ['see or take your offers', 'message you or nudge you', "see when you're online"] as const,
  silent: "They won't be told you blocked them.",
  openTrades: "Open trades with them aren't affected. They finish normally.",
  later: 'You can unblock them any time in Settings, Blocked traders.',
  cancel: 'Cancel',
  // not-a-refusal: confirms what the block now stops the other trader doing
  done: (name: string) => `You blocked ${name}. While signed in, they can't see or take your offers, message you, or see when you're online.`,
  manage: 'Blocked traders',
  failed: (name: string) => `Could not block ${name}. Try again.`,
  title: 'Blocked traders',
  whatTitle: 'What blocking does',
  // not-a-refusal: explains what a block stops the blocked trader doing
  what: ["They can't see or take your offers.", "They can't message you or nudge you.", "They can't see when you're online."] as const,
  whatNote: "This applies while they're signed in. To block someone, open one of their offers and tap Block.",
  count: (n: number) => (n === 1 ? '1 blocked trader' : `${n} blocked traders`),
  // S-093 (owner p7-6): the date and the time they were blocked.
  blockedOn: (iso: string) => `Blocked ${formatDateTime(iso)}`,
  // S-093: my private note on a blocked person (the owner's "optional notes"). COPY-UNSIGNED
  noteAdd: 'Add a note',
  noteEdit: 'Edit note',
  noteLabel: (name: string) => `Your note on ${name}`,
  notePrivate: 'Only you can see this note.',
  // Review Q1: unblocking deletes the row and its note (migration 362). COPY-UNSIGNED
  noteGoesOnUnblock: 'Unblocking deletes your note.',
  noteSave: 'Save note',
  noteCancel: 'Cancel',
  noteSaved: (name: string) => `Note saved for ${name}.`,
  noteRemoved: (name: string) => `Note removed for ${name}.`,
  noteFailed: (name: string) => `Could not save the note for ${name}. Try again.`,
  unblockedRow: 'Unblocked. They can see your offers again.',
  // The row button: the accessible name starts with the visible word, so a voice user saying
  // "click Undo" or "click Unblock" finds it (WCAG 2.5.3, review N2).
  unblockButton: 'Unblock',
  unblock: (name: string) => `Unblock ${name}`,
  undoButton: 'Undo',
  undo: (name: string) => `Undo: block ${name} again`,
  unblocked: (name: string) => `Unblocked ${name}.`,
  reblocked: (name: string) => `Blocked ${name} again.`,
  empty: "You haven't blocked anyone.",
  loadFailed: 'Could not load your blocked traders. Reload the page to try again.',
  unblockFailed: (name: string) => `Could not unblock ${name}. Try again.`,
  signedOut: 'Log in to see the traders you blocked.',
} as const;
