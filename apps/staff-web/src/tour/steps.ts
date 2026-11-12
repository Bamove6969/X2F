/**
 * The staff app's guided tours, one per role (owner 12 Nov 2026), as design specified them:
 * docs/design-12nov/tour-stops.md §3 (wip/design-brief @b3b8315b). Data only: the tour engine
 * (wip/lead-landing-tour) runs the steps and owns the shell and the motion (tour-motion.md: the
 * scrim, ring, arrow and card; no 3D or isometric layer, which the owner rejected on 12 Nov).
 *
 * Titles and card texts are design's, word for word (COPY-UNSIGNED, as there). `placement` is where
 * the card sits: design gives the arrow side, the card edge the arrow leaves from, so its "left"
 * (the staff web is wide-first: the card right of the element) is `right` here, "top" (card below)
 * is `bottom`, and "bottom" (card above) is `top`. The engine still applies design's side rule.
 *
 * A tour is the shell stops (S), then each page in the person's menu (`navFor(role, grants)`, the
 * list the API sends as `GET /staff/v1/me`.`nav`) in menu order. Next / Next screen / Finish follow from the route changing between steps.
 *
 * Design's stops on pages or parts that are not built on main yet (ModQueue, ModCase, StaffList,
 * StaffPerformance, StaffLog, StaffSettings, the Overview controls, the past-reputation check, the
 * session countdown shown in tour mode) are PENDING_STAFF_STOPS: named by board, never in a tour
 * until their screen exists, when each gets its selector and moves into PAGE_STEPS. Every live
 * target renders on its route (test/tourSteps.test.tsx).
 */
import { type GrantablePerm, type NavItem, type StaffRole, navFor } from '@x2f/staff';
import { NAV_PATHS } from '../ui/StaffShell.js';

/** One step, as the tour engine takes it (wip/lead-landing-tour). */
export interface TourStep {
  /** The path the step is shown on (the engine navigates there first). */
  route: string;
  /** A CSS selector for the element the step points at. */
  target: string;
  title: string;
  explanation: string;
  /** Where the card sits relative to the element ('center': no element, a centred card). */
  placement: 'top' | 'bottom' | 'left' | 'right' | 'center';
}

/** A design stop whose screen is not built yet: no selector until it is. */
export interface PendingStop {
  /** Design's id (tour-stops.md §3). */
  id: string;
  /** The board it is drawn on, and the element as design names it. */
  board: string;
  element: string;
  title: string;
  explanation: string;
  placement: TourStep['placement'];
  /** Who sees it. */
  roles: readonly StaffRole[];
  /** What it waits for. */
  waitsFor: string;
}

// ---- Shell (S): the start of every staff tour ----

const S1: TourStep = {
  route: '/',
  target: '.x2f-staff__brand',
  title: 'Welcome to X2F Staff',
  explanation: 'This is where the X2F team works. Only staff can get in, and only during your login hours.',
  placement: 'right',
};
const S2: TourStep = {
  route: '/',
  target: 'nav[aria-label="Staff"].x2f-staff__nav',
  title: 'Your pages',
  explanation: 'These are the pages your role uses. You only see what you need.',
  placement: 'right',
};
const S3: TourStep = {
  route: '/',
  target: '[data-part="user-chip"]',
  title: "That's you",
  explanation: 'Your name and role. Your role decides which pages and actions you have.',
  placement: 'right',
};
/** Design's S5 also points at the "Take the tour again" link under Log out, which the engine adds. */
const S5: TourStep = {
  route: '/',
  target: '[data-part="logout"]',
  title: 'Logging out',
  explanation: 'Log out when you step away. You can replay this tour from the link just below.',
  placement: 'right',
};

/** H1: a helper's home (NAV.helper is empty). */
export const H1: TourStep = {
  route: '/',
  target: '[data-part="nothing-for-role"]',
  title: 'More on the way',
  explanation: "There's nothing here for helpers just yet. When the owner turns on support tickets for you, they'll appear in the menu.",
  placement: 'bottom',
};

// ---- Pages ----

const F: readonly TourStep[] = [
  {
    route: NAV_PATHS.feedback,
    target: '[data-part="mood-counts"]',
    title: "How's X2F doing?",
    explanation: 'How traders rated X2F over the last 30 days, at a glance.',
    placement: 'bottom',
  },
  {
    route: NAV_PATHS.feedback,
    target: 'table[aria-label="Messages"]',
    title: 'What traders said',
    explanation: 'Their own words. Read them, spot problems early, and flag anything urgent to the owner.',
    placement: 'bottom',
  },
];

const T1_READ: TourStep = {
  route: NAV_PATHS.training,
  target: '.x2f-staff-page__title',
  title: 'Training library',
  explanation: 'Guides for handling cases. Start here when a case is new to you.',
  placement: 'bottom',
};
/** The owner's T1 (`training.write`). */
const T1_WRITE: TourStep = { ...T1_READ, explanation: 'Write and update the guides your staff learn from.' };

/** Each menu page's live steps for each role (most pages read the same for every role that has them). */
function pageSteps(item: NavItem, role: StaffRole): readonly TourStep[] {
  switch (item) {
    case 'overview':
      return [
        {
          route: NAV_PATHS.overview,
          target: 'a.x2f-link[href="/overview/news"]',
          title: 'News',
          explanation: 'Write the posts traders see under Site news.',
          placement: 'right',
        },
      ];
    case 'staff':
      return [
        {
          route: NAV_PATHS.staff,
          target: '[data-member] .x2f-check',
          title: 'Extra access',
          explanation: 'Give one person extra access, like support tickets or feedback.',
          placement: 'right',
        },
      ];
    case 'prices':
      return [
        {
          route: NAV_PATHS.prices,
          target: 'table[aria-label="XMR price sources"]',
          title: 'Price sources',
          explanation: 'Where the XMR price comes from. Several sources keep it honest.',
          placement: 'bottom',
        },
        {
          route: NAV_PATHS.prices,
          target: '[data-part="paused"]',
          title: 'Paused currencies',
          // not-a-refusal: design's tour card, explaining a paused currency; it stops nobody.
          explanation: "A currency pauses when its rate can't be trusted. Traders see that it's paused.",
          placement: 'bottom',
        },
      ];
    case 'training':
      return [role === 'owner' ? T1_WRITE : T1_READ];
    case 'feedback':
      return F;
    // Disputes, Performance, Activity log and Settings are title-only on main: their stops wait (PENDING_STAFF_STOPS).
    default:
      return [];
  }
}

/** The tour for one staff member: their role, plus the pages the owner granted them. */
export function staffTour(role: StaffRole, grants: readonly GrantablePerm[] = []): TourStep[] {
  const items = navFor(role, grants);
  if (items.length === 0) return [S1, S3, H1, S5];
  // Design: S1–S5, then the pages. An empty menu (a helper with nothing granted) leaves out S2 and
  // shows H1; a helper granted Feedback has a menu, so H1 (the empty-menu note) is not shown.
  return [S1, S2, S3, S5, ...items.flatMap((i) => pageSteps(i, role))];
}

/** Each role's tour with nothing extra granted. */
export const STAFF_TOURS: Readonly<Record<StaffRole, readonly TourStep[]>> = {
  owner: staffTour('owner'),
  senior: staffTour('senior'),
  mod: staffTour('mod'),
  helper: staffTour('helper'),
};

// ---- Design's stops that wait for their screens (tour-stops.md §3) ----

const MODS: readonly StaffRole[] = ['mod', 'senior', 'owner'];
const MOD_QUEUE = 'ModQueue (Disputes page, Plan 4 Task 17)';
const MOD_CASE = 'ModCase (the case page, Plan 4 Task 18)';

export const PENDING_STAFF_STOPS: readonly PendingStop[] = [
  { id: 'S4', board: 'StaffOverview rail foot', element: '[data-part="session-countdown"], shown in tour mode', title: 'Session time', explanation: 'When your session is close to ending, a countdown appears here. Wrap up before it hits zero.', placement: 'right', roles: ['helper', 'mod', 'senior', 'owner'], waitsFor: 'the engine showing the countdown in tour mode (it renders only in the last 10 minutes)' },
  { id: 'D1', board: MOD_QUEUE, element: '"Take next case"', title: 'Take the next case', explanation: 'One tap gives you the oldest case nobody has yet.', placement: 'right', roles: MODS, waitsFor: 'the Disputes page' },
  { id: 'D2', board: MOD_QUEUE, element: 'the queue table (Amount, Method, Opened by, Assigned to)', title: 'The queue', explanation: 'Every open dispute. Unassigned ones are waiting for someone like you.', placement: 'bottom', roles: MODS, waitsFor: 'the Disputes page' },
  { id: 'D3', board: MOD_QUEUE, element: '"Overdue" chip', title: 'Watch the clock', explanation: 'Overdue means a reply deadline has passed. Those come first.', placement: 'right', roles: MODS, waitsFor: 'the Disputes page' },
  { id: 'D4', board: MOD_QUEUE, element: '"Need a second approval"', title: 'Second approvals', explanation: "Big rulings wait here for a senior's yes. Check them before your own cases.", placement: 'right', roles: ['senior', 'owner'], waitsFor: 'the Disputes page' },
  { id: 'C1', board: MOD_CASE, element: '"First reply due in"', title: 'Your first reply', explanation: 'Say hello to both traders before this runs out.', placement: 'right', roles: ['mod', 'senior'], waitsFor: 'the case page' },
  { id: 'C2', board: MOD_CASE, element: 'Traders / Trade / Escrow facts', title: 'The facts', explanation: "Who's involved, what was agreed, and where the XMR is.", placement: 'right', roles: ['mod', 'senior'], waitsFor: 'the case page' },
  { id: 'C3', board: MOD_CASE, element: '"Payment proof", "Request the original proof"', title: 'Check the proof', explanation: 'Look at what each side sent. Ask for the original if a picture looks off.', placement: 'right', roles: ['mod', 'senior'], waitsFor: 'the case page and the moderator proof view (NEEDS_P4_CHAT_MEMBERSHIP)' },
  { id: 'C4', board: MOD_CASE, element: '"Full chat", "Message both traders"', title: 'Talk it through', explanation: 'Read the whole chat and write to both traders at once.', placement: 'right', roles: ['mod', 'senior'], waitsFor: 'the case page and chat membership (NEEDS_P4_CHAT_MEMBERSHIP)' },
  { id: 'C5', board: MOD_CASE, element: '"Your ruling", "Send ruling for approval"', title: 'Your ruling', explanation: 'Pick the outcome and explain it. Big trades need a second approval before they count.', placement: 'right', roles: ['mod', 'senior'], waitsFor: 'the case page' },
  { id: 'C6', board: MOD_CASE, element: '"Account action", "Freeze trading"', title: 'Account action', explanation: "You can freeze a trader's trading, or ban them, when a case calls for it. Every action is logged.", placement: 'right', roles: ['senior'], waitsFor: 'the case page' },
  { id: 'R1', board: 'StaffImportVerify (past reputation check)', element: 'the check page', title: 'Check past trades', explanation: 'Confirm the trading history a new trader brings from another site.', placement: 'bottom', roles: ['senior'], waitsFor: 'the past-reputation check page' },
  { id: 'L1', board: 'StaffLog (Activity log)', element: '"Show", "Trade code" filters', title: 'Find what happened', explanation: 'Search by trade code to see every step of a case.', placement: 'bottom', roles: ['mod', 'senior'], waitsFor: 'the Activity log page' },
  { id: 'L2', board: 'StaffLog (Activity log)', element: '"When / What happened" list', title: 'The record', explanation: 'Everything on your cases is logged, so you can always check back.', placement: 'bottom', roles: ['mod', 'senior'], waitsFor: 'the Activity log page' },
  { id: 'O1', board: 'StaffOverview', element: '"Emergency stop", "Pause all new trades"', title: 'Emergency stop', explanation: "Pauses every new trade at once. Use it only when something's really wrong.", placement: 'right', roles: ['owner'], waitsFor: 'the Overview page (Plan 4 Task 17)' },
  { id: 'O2', board: 'StaffOverview', element: '"Maintenance mode"', title: 'Maintenance', explanation: 'Take the site down for planned work, with a message for traders.', placement: 'right', roles: ['owner'], waitsFor: 'the Overview page' },
  { id: 'O3', board: 'StaffOverview', element: '"Announcement banner"', title: 'Announcements', explanation: "Put a short notice at the top of every trader's screen.", placement: 'right', roles: ['owner'], waitsFor: 'the Overview page' },
  { id: 'O5', board: 'StaffOverview', element: '"Earnings" (This month, All time)', title: 'Earnings', explanation: 'What X2F has earned in fees, by month.', placement: 'right', roles: ['owner'], waitsFor: 'the Overview page' },
  { id: 'O6', board: 'StaffOverview', element: '"Ruling waiting for you" (Notifications)', title: 'Needs you', explanation: 'Anything waiting for your approval shows up here first.', placement: 'right', roles: ['owner'], waitsFor: 'the Overview page' },
  { id: 'P1', board: 'StaffList', element: '"Add staff member"', title: 'Add staff', explanation: 'Create an invite link for a new helper or moderator.', placement: 'right', roles: ['owner'], waitsFor: 'the StaffList page (the Staff page shows grants only on main)' },
  { id: 'P2', board: 'StaffList', element: 'the table (Role, Login hours, Status)', title: 'Your team', explanation: "Everyone's role, login hours and status at a glance.", placement: 'bottom', roles: ['owner'], waitsFor: 'the StaffList page' },
  { id: 'M1', board: 'StaffPerformance', element: '"Moderators" table', title: 'How cases go', explanation: "Each moderator's cases, reply times and rulings overturned on appeal.", placement: 'bottom', roles: ['owner'], waitsFor: 'the Performance page' },
  { id: 'M2', board: 'StaffPerformance', element: '"Period"', title: 'Pick a period', explanation: 'Compare this week, last month or all time.', placement: 'right', roles: ['owner'], waitsFor: 'the Performance page' },
  { id: 'L1-owner', board: 'StaffLog (Activity log)', element: '"Show everything" (log.read.all)', title: 'Everything, logged', explanation: 'Every event on the site, from every staff member.', placement: 'bottom', roles: ['owner'], waitsFor: 'the Activity log page' },
  { id: 'L2-owner', board: 'StaffLog (Activity log)', element: '"When / What happened"', title: 'The record', explanation: 'Filter by trade code or person to follow any thread.', placement: 'bottom', roles: ['owner'], waitsFor: 'the Activity log page' },
  { id: 'G1', board: 'StaffSettings', element: '"Staff pay"', title: 'Staff pay', explanation: 'Set what helpers and moderators earn.', placement: 'right', roles: ['owner'], waitsFor: 'the Settings page (Plan 4 Task 20)' },
  { id: 'G2', board: 'StaffSettings', element: '"Rulings" (Appeal window, First response deadline)', title: 'Case rules', explanation: 'How long traders have to appeal, and how fast moderators must reply.', placement: 'right', roles: ['owner'], waitsFor: 'the Settings page' },
  { id: 'G3', board: 'StaffSettings', element: '"Fee wallet", "Owner keys"', title: 'Money and keys', explanation: 'Where fees are swept and which keys can approve. Every change needs your key.', placement: 'right', roles: ['owner'], waitsFor: 'the Settings page' },
];
