// Plan 3 Task 37: the block's words. // COPY-UNSIGNED: no board yet (Claude Design brief item 14);
// the owner signs the copy off with the board. The refusals are shown inline until Plan 5 Task 21's
// shared CantDoThat popup is on the main line (tripwire in apps/web/test/block-tripwires.test.ts).

export const BLOCK_COPY = {
  action: (name: string) => `Block ${name}`,
  confirmTitle: (name: string) => `Block ${name}?`,
  confirmBody: "They won't see your offers or be able to take them, message you, or see when you're online. They won't be told. Trades already open with them continue to the end.",
  confirm: 'Block',
  cancel: 'Cancel',
  done: (name: string) => `You blocked ${name}. You won't see each other's offers.`,
  manage: 'Blocked traders',
  failed: (name: string) => `Could not block ${name}. Try again.`,
  // A name that is gone (the account was closed) or yourself: the API's 404 and 400.
  cannot: 'That trader cannot be blocked.',
  title: 'Blocked traders',
  intro: "People you block can't see your offers, take them, message you, or see when you're online. You won't see theirs either.",
  empty: "You haven't blocked anyone.",
  unblock: 'Unblock',
  loadFailed: 'Could not load your blocked traders. Reload the page to try again.',
  unblockFailed: (name: string) => `Could not unblock ${name}. Try again.`,
  signedOut: 'Log in to see the traders you blocked.',
} as const;
