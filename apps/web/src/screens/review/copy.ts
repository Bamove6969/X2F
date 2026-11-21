// Plan 5 Task 6: the words of the rating and "How's X2F doing?" cards. Board Review.dc.html where
// the board still says what the app does; COPY-UNSIGNED where it does not.
//
// Two board lines are NOT used (lead question in the Task 6 report): the board was drawn for the
// blind reveal, which the owner dropped on 2026-11-02 (R-007: "a review shows once the trade is
// marked complete"; reviews.ts "No blind reveal"). Saying "Shown to them only after they rate you
// too" would promise a privacy the app no longer gives, so the card says what does happen.
//   board: "Shown to them only after they rate you too."
//   board: "Rating saved. <name> sees it once they've rated you too."

export const REVIEW_COPY = {
  // COPY-UNSIGNED (replaces the board's blind-reveal line; R-007)
  shown: 'Shown on their profile as soon as you submit it.',
  // COPY-UNSIGNED (the card's name for a screen reader; the board has none)
  rateLabel: (name: string) => `Rate ${name}`,
  starsLabel: 'Stars',
  star: (n: number) => `${n} ${n === 1 ? 'star' : 'stars'}`,
  // COPY-UNSIGNED (the chips' group name for a screen reader; the board has none)
  phrasesLabel: 'What stood out',
  note: 'One-line note (optional)',
  notePlaceholder: 'Smooth trade, would do again',
  submit: 'Submit rating',
  neutral: 'Neutral, skip details',
  // COPY-UNSIGNED (owner 2026-11-01, item 28: "Skip review"; not on the board)
  skip: 'Skip review',
  // COPY-UNSIGNED (replaces the board's blind-reveal line; R-007)
  saved: (name: string) => `Rating saved. ${name} can see it now.`,
  // COPY-UNSIGNED (review m2: a 409 review-exists or not-reviewable; nothing was saved by this tap)
  gone: 'There is nothing left to rate on this trade.',
  // P5-A6, COPY-UNSIGNED
  personalDetails: 'Remove personal details from the note.',
  failed: 'That did not work. Try again.',
  retry: 'Try again',
} as const;

export const FEEDBACK_COPY = {
  heading: "How's X2F doing?",
  sub: 'Optional. Your feedback helps shape this community.',
  moodsLabel: 'How was X2F this time',
  moods: [
    { id: 'great', label: 'Great' },
    { id: 'ok', label: 'OK' },
    { id: 'needs-work', label: 'Needs work' },
  ],
  note: 'Anything we could do better?',
  notePlaceholder: 'Ideas, bugs, payment methods you want…',
  privacy: 'Sent without your username or trade details.',
  send: 'Send feedback',
  later: 'Not now',
  // COPY-UNSIGNED
  sent: 'Thanks. Your feedback was sent.',
  // COPY-UNSIGNED (review m4: the send failed; the card stays so it can go again)
  failed: 'Your feedback could not be sent.',
  // COPY-UNSIGNED (review m4: a 400 for a hidden character in the note, the API's HIDDEN rule)
  hidden: 'The note has a hidden character. Remove it, then send again.',
  // COPY-UNSIGNED
  retry: 'Try again',
} as const;

// Plan 5 Task 19: disputing a review of me (no board). "Dispute" and "Under review" are the spec's
// words (5.1, Revision 2026-10-29b); every other line is COPY-UNSIGNED.
export const DISPUTE_COPY = {
  // Spec 5.1.
  dispute: 'Dispute',
  // COPY-UNSIGNED
  title: 'Dispute a review',
  // COPY-UNSIGNED
  intro: 'A moderator reads your reason and decides whether the review stands, loses some of its comments, or is removed. Until then it shows "Under review" and does not count in your stats.',
  // COPY-UNSIGNED
  reason: 'Why should this review be looked at?',
  // COPY-UNSIGNED
  reasonHint: 'For example: it is revenge for a dispute, it is from a competitor, or it shares personal details.',
  // COPY-UNSIGNED
  send: 'Send to a moderator',
  // COPY-UNSIGNED
  cancel: 'Back to my profile',
  // COPY-UNSIGNED
  sent: 'Sent. The review shows "Under review" until a moderator decides.',
  // COPY-UNSIGNED (a stale screen: the review was already disputed)
  already: 'This review has already been disputed.',
  // COPY-UNSIGNED (unknown id, someone else's review, or one that was removed or is on hold)
  missing: 'There is no review to dispute here.',
  // COPY-UNSIGNED
  failed: 'That did not work. Try again.',
  // COPY-UNSIGNED
  loading: 'Loading…',
} as const;
