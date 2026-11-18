/**
 * The team member's guided tour (owner 12 Nov 2026), as design specified it:
 * docs/design-12nov/tour-stops.md §4 (wip/design-brief @b3b8315b). Data only: the tour engine
 * (wip/lead-landing-tour) runs the steps and owns the shell and the motion (tour-motion.md; no 3D
 * or isometric layer, which the owner rejected on 12 Nov).
 *
 * A stop shows only when the member's ticked boxes hold its ability ("Shows when"), read from
 * `GET /v1/account/me`.`member.abilities` (`memberTour(abilities)`); `always` stops show to every
 * member. Titles and card texts are design's, word for word (COPY-UNSIGNED, as there).
 * The steps are the engine's own types (engine.ts; review 12 Nov, S2), grouped into its pages:
 * design's arrow side "top" (card below) is `below`, "bottom" (card above) is `above`; on wide the
 * engine puts the card beside the element, as design's "/ left" says.
 *
 * A member gets this tour once per device, the first time they open /sell, instead of the welcome
 * screen and the trader's first-trade tour (lead, 12 Nov 2026; WelcomeGate.tsx).
 *
 * Design's stops whose screen does not work for a member on main are PENDING_MEMBER_STOPS, each
 * saying what it waits for, and are in no tour until it does: Wallets and Settings → Security are
 * owner-only screens for members (settings/OwnerOnly.tsx), there is no My trades page, the dispute
 * room needs the Example dispute design ruled for, the extend button and the replay row are not
 * built, and Post an offer's stops are "as V1", which the rebuilt brief no longer has.
 *
 * The Trade room page needs a trade the member can open: `memberTour` takes its code, and leaves the
 * page out without one. Every live target renders on its page as a member with that ability
 * (test/memberTourSteps.test.tsx).
 */

import type { TourDef, TourPage, TourStep } from './engine.js';

/** A live stop, the ability that shows it (`always`: every member), and its page. */
export interface MemberStop {
  shows: string;
  page: MemberPageId;
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

type MemberPageId = 'find' | 'offers' | 'trade' | 'changes' | 'feedback';

/** The pages, in design's order, with their screens; the Trade room's path takes the trade's code. COPY-UNSIGNED: the names. */
const PAGES: readonly { id: MemberPageId; name: string; path: (code: string | null) => string | null }[] = [
  { id: 'find', name: 'Find a trade', path: () => '/buy' },
  { id: 'offers', name: 'My offers', path: () => '/profile/offers' },
  { id: 'trade', name: 'Trade room', path: (code) => (code === null ? null : `/trade/${code}`) },
  { id: 'changes', name: 'Account changes', path: () => '/settings/changes' },
  { id: 'feedback', name: 'Feedback', path: () => '/feedback' },
];

const stop = (shows: string, page: MemberPageId, id: string, target: string, title: string, body: string, placement: TourStep['placement']): MemberStop => ({
  shows,
  page,
  step: { id, target, title, body, placement },
});

/** Design §4, in page order: Find a trade, My offers, Trade room, Account changes, Feedback. */
export const MEMBER_STOPS: readonly MemberStop[] = [
  stop('always', 'find', 'whose', '.x2f-browse__brand', 'Whose account this is', "You're working in this vendor's account under your own login. Everything you do goes in the team log.", 'below'),
  stop('always', 'find', 'browse', '.x2f-segment', 'Browse offers', 'See offers to buy or sell, just like any trader.', 'below'),
  stop('always', 'find', 'tabs', 'nav[aria-label="Main"]', 'Your tabs', 'You only see the tabs your access covers. Ask the account owner if you need more.', 'above'),

  stop('offers-see', 'offers', 'offers-see', '[data-part="offer"]', "The account's offers", 'Every offer on this account, and whether each is on or off.', 'below'),
  stop('offers-pause', 'offers', 'offers-pause', '[data-part="switch"]', 'On or off', 'Turn offers off and back on when the team needs to.', 'below'),
  stop('offers-delete', 'offers', 'offers-delete', '[data-part="select"]', 'Tidy up', 'Select an offer to remove it for good.', 'below'),
  stop('offers-post', 'offers', 'offers-post', '[data-part="post"]', 'Post an offer', 'Start a new offer for the account, within its 3 buy and 3 sell.', 'above'),

  stop('trades-see-active', 'trade', 'trades-see-active', '[data-part="member-waiting"]', 'Following a trade', "Watch each step here. Anything that moves the XMR is done on the owner's device.", 'below'),
  stop('disputes-answer', 'trade', 'disputes-answer', '[data-part="member-dispute"]', 'If it goes wrong', 'If a trade party opens a dispute, you can follow it and answer the moderator.', 'above'),

  // Design names `[data-part="account-changes"]`; while a hold is on, the list a member sees is `changes-waiting`.
  stop('hold-see', 'changes', 'hold-see', '[data-part="changes-waiting"]', 'Waiting changes', 'Changes to the account wait 24 hours before they apply, for safety.', 'below'),
  // Design: "Cancel a change"; the member's cancel is Cancel all changes (and unticking one).
  stop('hold-cancel', 'changes', 'hold-cancel', '[data-part="waiting-cancel-all"]', 'Stop a change', 'If a change looks wrong, cancel it before it applies.', 'above'),
  stop('hold-end', 'changes', 'hold-end', '[data-part="waiting-approve"]', 'Apply it now', "Skip the wait when you're sure the change is right.", 'above'),

  // Design: the message field and `feedback-sent-as`; the sent-as line shows only after sending.
  stop('feedback-send', 'feedback', 'feedback-send', 'textarea.x2f-input--message', "Tell us how it's going", "Send X2F your thoughts. It goes with your own name, not the account's.", 'below'),
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

/** COPY-UNSIGNED: the tour's name for screen readers, and the line after Skip. */
export const MEMBER_TOUR_LABEL = 'Team member tour';
export const MEMBER_TOUR_CLOSED = 'Tour closed.';

/**
 * The tour for one member's ticked boxes (`me.member.abilities`), as the engine runs it. `code` is a
 * trade the member can open, for the Trade room page; without one that page is left out.
 */
export function memberTour(abilities: readonly string[], code: string | null = null): TourDef {
  const has = effective(abilities);
  const shown = MEMBER_STOPS.filter((s) => s.shows === 'always' || has.has(s.shows));
  const pages: TourPage[] = [];
  for (const p of PAGES) {
    const path = p.path(code);
    const steps = shown.filter((s) => s.page === p.id).map((s) => s.step);
    if (path !== null && steps.length > 0) pages.push({ id: p.id, name: p.name, path, steps });
  }
  return { id: 'member', flow: 'screens', label: MEMBER_TOUR_LABEL, pages, closed: MEMBER_TOUR_CLOSED };
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
