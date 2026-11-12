/**
 * The team member's guided tour (owner 12 Nov 2026), as design specified it:
 * docs/design-12nov/tour-stops.md §4 (wip/design-brief @b3b8315b). Data only: the tour engine
 * (wip/lead-landing-tour) runs the steps and owns the shell and the motion (tour-motion.md; no 3D
 * or isometric layer, which the owner rejected on 12 Nov).
 *
 * A stop shows only when the member's ticked boxes hold its ability ("Shows when"), read from
 * `GET /v1/account/me`.`member.abilities` (`memberTour(abilities)`); `always` stops show to every
 * member. Titles and card texts are design's, word for word (COPY-UNSIGNED, as there).
 * `placement` is where the card sits on the phone: design's arrow side "top" (card below) is
 * `bottom`, "bottom" (card above) is `top`; on wide the engine puts the card to the right, as
 * design's "/ left" says.
 *
 * Design's stops whose screen does not work for a member on main are PENDING_MEMBER_STOPS, each
 * saying what it waits for, and are in no tour until it does: Wallets and Settings → Security are
 * owner-only screens for members (settings/OwnerOnly.tsx), there is no My trades page, the dispute
 * room needs the Example dispute design ruled for, the extend button and the replay row are not
 * built, and Post an offer's stops are "as V1", which the rebuilt brief no longer has.
 *
 * Routes with `:code` need a trade the member can open: the engine fills it in or skips the step.
 * Every live target renders on its route as a member with that ability (test/memberTourSteps.test.tsx).
 */

/** One step, as the tour engine takes it (wip/lead-landing-tour). */
export interface TourStep {
  /** The path the step is shown on; `:code` is a trade code the engine fills in. */
  route: string;
  /** A CSS selector for the element the step points at. */
  target: string;
  title: string;
  explanation: string;
  /** Where the card sits relative to the element on the phone. */
  placement: 'top' | 'bottom' | 'left' | 'right' | 'center';
}

/** A live stop and the ability that shows it (`always`: every member). */
export interface MemberStop {
  shows: string;
  step: TourStep;
}

export interface PendingMemberStop {
  page: string;
  element: string;
  shows: string;
  title: string;
  explanation: string;
  waitsFor: string;
}

const stop = (shows: string, route: string, target: string, title: string, explanation: string, placement: TourStep['placement']): MemberStop => ({
  shows,
  step: { route, target, title, explanation, placement },
});

/** Design §4, in page order: Find a trade, My offers, Trade room, Account changes, Feedback. */
export const MEMBER_STOPS: readonly MemberStop[] = [
  stop('always', '/buy', '.x2f-browse__brand', 'Whose account this is', "You're working in this vendor's account under your own login. Everything you do goes in the team log.", 'bottom'),
  stop('always', '/buy', '.x2f-segment', 'Browse offers', 'See offers to buy or sell, just like any trader.', 'bottom'),
  stop('always', '/buy', 'nav[aria-label="Main"]', 'Your tabs', 'You only see the tabs your access covers. Ask the account owner if you need more.', 'top'),

  stop('offers-see', '/profile/offers', '[data-part="offer"]', "The account's offers", 'Every offer on this account, and whether each is on or off.', 'bottom'),
  stop('offers-pause', '/profile/offers', '[data-part="switch"]', 'On or off', 'Turn offers off and back on when the team needs to.', 'bottom'),
  stop('offers-delete', '/profile/offers', '[data-part="select"]', 'Tidy up', 'Select an offer to remove it for good.', 'bottom'),
  stop('offers-post', '/profile/offers', '[data-part="post"]', 'Post an offer', 'Start a new offer for the account, within its 3 buy and 3 sell.', 'top'),

  stop('trades-see-active', '/trade/:code', '[data-part="member-waiting"]', 'Following a trade', "Watch each step here. Anything that moves the XMR is done on the owner's device.", 'bottom'),
  stop('disputes-answer', '/trade/:code', '[data-part="member-dispute"]', 'If it goes wrong', 'If a trade party opens a dispute, you can follow it and answer the moderator.', 'top'),

  // Design names `[data-part="account-changes"]`; while a hold is on, the list a member sees is `changes-waiting`.
  stop('hold-see', '/settings/changes', '[data-part="changes-waiting"]', 'Waiting changes', 'Changes to the account wait 24 hours before they apply, for safety.', 'bottom'),
  // Design: "Cancel a change"; the member's cancel is Cancel all changes (and unticking one).
  stop('hold-cancel', '/settings/changes', '[data-part="waiting-cancel-all"]', 'Stop a change', 'If a change looks wrong, cancel it before it applies.', 'top'),
  stop('hold-end', '/settings/changes', '[data-part="waiting-approve"]', 'Apply it now', "Skip the wait when you're sure the change is right.", 'top'),

  // Design: the message field and `feedback-sent-as`; the sent-as line shows only after sending.
  stop('feedback-send', '/feedback', 'textarea.x2f-input--message', "Tell us how it's going", "Send X2F your thoughts. It goes with your own name, not the account's.", 'bottom'),
];

/**
 * The hold rights build on each other (the API's effectiveAbilities: end brings cancel and see,
 * cancel brings see), so the tour follows the rights the member really has.
 */
function effective(abilities: readonly string[]): Set<string> {
  const has = new Set(abilities);
  if (has.has('hold-end')) has.add('hold-cancel');
  if (has.has('hold-cancel')) has.add('hold-see');
  return has;
}

/** The tour for one member's ticked boxes (`me.member.abilities`). */
export function memberTour(abilities: readonly string[]): TourStep[] {
  const has = effective(abilities);
  return MEMBER_STOPS.filter((s) => s.shows === 'always' || has.has(s.shows)).map((s) => s.step);
}

export const PENDING_MEMBER_STOPS: readonly PendingMemberStop[] = [
  { page: 'Post an offer /post', element: 'stops 1–4, "as V1"', shows: 'offers-post', title: '', explanation: "Stop 4's last line: The account pays the fee once it's posted.", waitsFor: "design's V1 stops (the rebuilt brief, the first-trade tour, dropped them)" },
  { page: 'My trades', element: '"Active trades"', shows: 'trades-see-active', title: 'Open trades', explanation: "The account's trades that are in progress right now.", waitsFor: 'a My trades page (no route on main)' },
  { page: 'My trades', element: '"Recent"', shows: 'trades-see-history', title: 'Past trades', explanation: 'Finished trades: amounts, partners and dates.', waitsFor: 'a My trades page (no route on main)' },
  { page: 'Trade room /trade/:code', element: 'Give more time (SellerRefund extend)', shows: 'trades-extend', title: 'More time', explanation: 'Give the buyer 30 more minutes to pay when they ask.', waitsFor: "a member's extend button (the member room has none on main)" },
  { page: 'Dispute room /trade/:code/dispute', element: '[aria-label="Dispute status"], .dispute-deadline', shows: 'disputes-answer', title: 'The dispute', explanation: 'Where it stands and when the next reply is due.', waitsFor: "the Example dispute design ruled for (apps/web/src/fixtures has none yet)" },
  { page: 'Dispute room /trade/:code/dispute', element: '[aria-label="Evidence"].dispute-evidence-chips', shows: 'disputes-answer', title: 'Evidence', explanation: 'What each side has shown the moderator.', waitsFor: 'the Example dispute' },
  { page: 'Dispute room /trade/:code/dispute', element: '.dispute-see-ruling', shows: 'disputes-appeal', title: 'Rulings and appeals', explanation: 'Read the ruling. You have 48 hours to appeal if it looks wrong.', waitsFor: 'the Example dispute' },
  { page: 'Wallets /wallets', element: '[aria-label="Linked wallets"]', shows: 'wallets-see', title: 'Where payouts go', explanation: "The account's wallets, by name and the end of the address. Only the owner can change them.", waitsFor: 'a member view of Wallets (owner-only on main: settings/OwnerOnly.tsx)' },
  { page: 'Settings /settings/security', element: 'Login methods', shows: 'always', title: 'Your own login', explanation: 'You log in with your own methods. Make them strong: a security key or PGP is best.', waitsFor: 'a member view of Security (owner-only on main)' },
  { page: 'Settings /settings/security', element: 'Recovery code', shows: 'always', title: 'Your recovery code', explanation: 'Your own backup way in. Write it down and keep it safe.', waitsFor: 'a member view of Security (owner-only on main)' },
  { page: 'Settings /settings/security', element: '[data-part="tour-replay"]', shows: 'always', title: 'Help is here', explanation: 'FAQ, Support and this tour live here. Replay it whenever you like.', waitsFor: 'the replay row (the tour engine adds it)' },
];
