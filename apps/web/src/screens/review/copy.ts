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
} as const;
