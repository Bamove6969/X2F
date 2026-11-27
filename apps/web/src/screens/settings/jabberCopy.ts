/**
 * Words for secure Jabber account-change alerts (owner rule p5-7), word for word from Claude
 * Design's JabberSetup and Alerts boards (wip/design-brief). COPY-UNSIGNED: design's draft, not
 * signed off by the owner. The error lines at the bottom are the builder's (no board shows them).
 */
export const JABBER_COPY = {
  // Alerts section.
  sectionTitle: 'Secure Jabber (XMPP)',
  // COPY-UNSIGNED (27 Nov 2026): was "Account change alerts"; trade milestones joined it.
  rowTitle: 'Account and trade alerts',
  // COPY-UNSIGNED: "required" replaces the board's "recommended" (owner ruling p11-31: OMEMO is mandatory).
  rowNote: 'Get one short message for every change to your account and for the trade events you pick, with no details in it. Needs a Jabber account; OMEMO encryption required.',
  addressLabel: 'Address',
  notSetUp: 'Not set up',
  lastMessage: 'Last message',
  rowLabel: (masked: string | null) => (masked ? `Jabber address ${masked}, change it` : 'Jabber address not set up, set it up'),

  // JabberSetup.
  kicker: 'Settings',
  title: 'Secure Jabber alerts',
  lead: 'One short message to your Jabber address every time your account changes.',
  back: 'Back to alerts',
  yourAddress: 'Your Jabber address',
  placeholder: 'name@xmpp.example.org',
  anyServer: 'Any XMPP server works. We never send details, only that a change happened.',
  /** GAP: X2F's own sending address is not set up yet; the board's is an example. */
  addContact: "Add X2F's alert address to your contacts so the message isn't filtered.",
  sendTest: 'Send a test message',
  enterCode: 'Enter the code from the test message',
  sentTo: (masked: string) => `Sent to ${masked}. It can take a minute to arrive.`,
  resend: 'Resend',
  sentAgain: 'Sent again',
  turnOn: 'Turn on',
  doneTitle: 'Jabber alerts are on',
  doneNote: (masked: string) => `Every account change now sends one short message to ${masked}.`,
  previewTitle: "What you'll receive",
  previewFrom: 'X2F alerts',
  previewText: 'An account change was made on your X2F account.',
  done: 'Done',
  turnOff: 'Turn off',

  // Builder's lines (COPY-UNSIGNED; no board).
  unavailable: 'Jabber alerts are coming to X2F soon.',
  badAddress: "That isn't a Jabber address. It looks like name@server.org.",
  wrongCode: "That code isn't right. Check the test message and try again.",
  codeEnded: 'That code has ended. Send a new test message.',
  waitSeconds: (s: number) => `You can send another test message in ${s} seconds.`,
  failed: "That didn't work. Try again.",
  /** Review M4: the address is sealed under a key the server no longer holds. */
  needsSetUpAgain: 'Needs setting up again',
  brokenRowLabel: 'Jabber address needs setting up again, set it up',

  // W-021 (owner p11-27): the Jabber notifications settings page. COPY-UNSIGNED: builder's words,
  // no board draws this page yet (design to draw it). One entry per notice kind the API lists.
  eventsRow: 'Choose which events send a message',
  /** Trade milestones card (owner 27 Nov 2026). COPY-UNSIGNED. */
  tradesRow: 'Your trades',
  eventsTitle: 'Jabber notifications',
  eventsLead: 'Pick which events send you a secure Jabber message. Every message is one short sentence with no details in it.',
  eventsNeedSetUp: 'Set up a Jabber address first.',
  eventsSetUpLink: 'Set up Jabber alerts',
  events: {
    'account-change': {
      label: 'Account changes',
      note: 'A change to your login methods, wallets, team, holds or settings. Message: "An account change was made on your X2F account."',
    },
    // J-20 (wip/second-team-limits): listed once the API has this kind.
    'team-member-first-login': {
      label: 'A team member logs in for the first time',
      note: 'Message: "A team member logged in to your X2F account for the first time."',
    },
    // Trade milestones (owner, 27 Nov 2026; API migration 920). COPY-UNSIGNED: builder's words.
    'trade-started': {
      label: 'Someone starts a new trade with you',
      note: 'Someone took one of your offers. Message: "Someone started a new trade with you on X2F."',
    },
    'trade-funded': {
      label: 'Coins are locked in escrow',
      note: 'When you buy: the seller\'s coins are locked and you can pay. Message: "The coins for one of your X2F trades are locked in escrow. You can pay now."',
    },
    'trade-paid': {
      label: 'Payment is marked sent',
      note: 'When you sell: the buyer says they paid. Message: "A buyer marked a payment as sent on one of your X2F trades."',
    },
    'trade-cancel-asked': {
      label: 'Your trade partner asks to cancel',
      note: 'Message: "Your trade partner asked to cancel one of your X2F trades."',
    },
    'trade-completed': {
      label: 'A trade is complete',
      note: 'The coins were released. Message: "One of your X2F trades is complete."',
    },
    'trade-cancelled': {
      label: 'A trade is cancelled or refunded',
      note: 'Message: "One of your X2F trades was cancelled or refunded."',
    },
    'trade-attention': {
      label: 'A dispute is opened',
      note: 'On any of your trades, by either side. Message: "A trade on your X2F account needs your attention."',
    },
    'trade-ruled': {
      label: 'A dispute ruling is published',
      note: 'Message: "A ruling was published on a dispute in one of your X2F trades."',
    },
  },
  /** Review F1: under a security notice's box, which is ticked and cannot be unticked. */
  // not-a-refusal: a standing note under a disabled box; nothing was tried and refused
  alwaysOnNote: "Security alerts can't be turned off.",
} as const;
