/**
 * The staff app's guided tours, one per role (owner 12 Nov 2026), as design specified them:
 * docs/design-12nov/tour-stops.md §3 (wip/design-brief @b3b8315b). Data only: the tour engine
 * (wip/lead-landing-tour) runs the steps and owns the shell and the motion (tour-motion.md: the
 * scrim, ring, arrow and card; no 3D or isometric layer, which the owner rejected on 12 Nov).
 *
 * Titles and card texts are design's, word for word (COPY-UNSIGNED, as there), but for S5 and the
 * Clock out and Notifications stops (review 12 Nov, S1: lead drafts, COPY-UNSIGNED, for the owner).
 * The steps are the engine's own types (apps/web tour/engine.ts, through ui/kit.ts; review S2): design's
 * arrow side "left" (the staff web is wide-first: the card right of the element) is `auto`, which
 * puts the card beside the element on a wide screen; "top" (card below) is `below`; "bottom" (card
 * above) is `above`.
 *
 * A tour is the shell stops (S), then each page in the person's menu in menu order: the menu the
 * server sends, `GET /staff/v1/me`.`nav` (review S3), so the tour is the menu even when the server
 * narrows it (login hours, a revoked grant). Next / Next screen / Finish follow from the pages.
 *
 * Design's stops on pages or parts that are not built on main yet (ModQueue, ModCase, StaffList,
 * StaffPerformance, StaffLog, StaffSettings, the Overview controls, the past-reputation check, the
 * session countdown shown in tour mode) are PENDING_STAFF_STOPS: named by board, never in a tour
 * until their screen exists, when each gets its selector and moves into PAGE_STEPS. Every live
 * target renders on its route (test/tourSteps.test.tsx).
 */
import type { NavItem, StaffRole } from '@x2f/staff';
import type { TourDef, TourPage, TourStep } from '../ui/kit.js';
import { NAV_LABELS, NAV_PATHS } from '../ui/StaffShell.js';

/** Where a pending stop's card sits, in the engine's terms. */
type Placement = TourStep['placement'];

/** A design stop whose screen is not built yet: no selector until it is. */
export interface PendingStop {
  /** Design's id (tour-stops.md §3). */
  id: string;
  /** The board it is drawn on, and the element as design names it. */
  board: string;
  element: string;
  title: string;
  body: string;
  placement: Placement;
  /** Who sees it. */
  roles: readonly StaffRole[];
  /** What it waits for. */
  waitsFor: string;
}

/** What the shell knows of the person: their role and the server's menu (`GET /staff/v1/me`). */
export interface StaffMe {
  role: StaffRole;
  nav: readonly NavItem[];
}

// ---- Shell (S): the start of every staff tour ----

const S1: TourStep = {
  id: 'S1',
  target: '.x2f-staff__brand',
  title: 'Welcome to X2F Staff',
  body: 'This is where the X2F team works. Only staff can get in, and only during your login hours.',
  placement: 'auto',
};
const S2: TourStep = {
  id: 'S2',
  target: 'nav[aria-label="Staff"].x2f-staff__nav',
  title: 'Your pages',
  body: 'These are the pages your role uses. You only see what you need.',
  placement: 'auto',
};
const S3: TourStep = {
  id: 'S3',
  target: '[data-part="user-chip"]',
  title: "That's you",
  body: 'Your name and role. Your role decides which pages and actions you have.',
  placement: 'auto',
};
/**
 * O-040: the owner's Notifications link (main's shell; no board places it). Lead draft, COPY-UNSIGNED.
 */
export const SN: TourStep = {
  id: 'SN',
  target: '[data-part="notifications"]',
  title: 'Notifications',
  body: 'Anything waiting for you, such as a ruling to approve, shows up here. The number is how many are unread.',
  placement: 'auto',
};
/** D-045: the Clock out button (every role but the owner). Lead draft, COPY-UNSIGNED. */
export const SC: TourStep = {
  id: 'SC',
  target: '[data-part="clock-out-button"]',
  title: 'Clock out',
  body: 'Tap Clock out at the end of every shift. Your pay is worked out when you do.',
  placement: 'auto',
};
/**
 * S5, Log out. Design's "Log out when you step away" read as if logging out ended a shift, which
 * main's pay rule (D-045: only a clock-out pays) contradicts (review 12 Nov, S1). For staff who
 * clock out, the lead's draft (COPY-UNSIGNED); the owner does not clock out, so the owner keeps
 * design's first sentence. Design's "replay this tour from the link just below" is not built, so
 * it is left out.
 */
export const S5: TourStep = {
  id: 'S5',
  target: '[data-part="logout"]',
  title: 'Logging out',
  body: 'When your shift ends, tap Clock out. Only clocked-in time is paid.',
  placement: 'auto',
};
const S5_OWNER: TourStep = { ...S5, body: 'Log out when you step away.' };

/** H1: a helper's home (an empty menu). */
export const H1: TourStep = {
  id: 'H1',
  target: '[data-part="nothing-for-role"]',
  title: 'More on the way',
  body: "There's nothing here for helpers just yet. When the owner turns on support tickets for you, they'll appear in the menu.",
  placement: 'below',
};

// ---- Pages ----

const F: readonly TourStep[] = [
  {
    id: 'F1',
    target: '[data-part="mood-counts"]',
    title: "How's X2F doing?",
    body: 'How traders rated X2F over the last 30 days, at a glance.',
    placement: 'below',
  },
  {
    id: 'F2',
    target: 'table[aria-label="Messages"]',
    title: 'What traders said',
    body: 'Their own words. Read them, spot problems early, and flag anything urgent to the owner.',
    placement: 'below',
  },
];

const T1_READ: TourStep = {
  id: 'T1',
  target: '.x2f-staff-page__title',
  title: 'Training library',
  body: 'Guides for handling cases. Start here when a case is new to you.',
  placement: 'below',
};
/** The owner's T1 (`training.write`). */
const T1_WRITE: TourStep = { ...T1_READ, body: 'Write and update the guides your staff learn from.' };

/** Each menu page's live steps for each role (most pages read the same for every role that has them). */
function pageSteps(item: NavItem, role: StaffRole): readonly TourStep[] {
  switch (item) {
    case 'overview':
      return [{ id: 'O4', target: 'a.x2f-link[href="/overview/news"]', title: 'News', body: 'Write the posts traders see under Site news.', placement: 'auto' }];
    case 'staff':
      return [{ id: 'P3', target: '[data-member] .x2f-check', title: 'Extra access', body: 'Give one person extra access, like support tickets or feedback.', placement: 'auto' }];
    case 'prices':
      return [
        { id: 'X1', target: 'table[aria-label="XMR price sources"]', title: 'Price sources', body: 'Where the XMR price comes from. Several sources keep it honest.', placement: 'below' },
        {
          id: 'X2',
          target: '[data-part="paused"]',
          title: 'Paused currencies',
          // not-a-refusal: design's tour card, explaining a paused currency; it stops nobody.
          body: "A currency pauses when its rate can't be trusted. Traders see that it's paused.",
          placement: 'below',
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

/** The shell's stops for this role: Notifications for the owner, Clock out for everyone else. */
function shellSteps(role: StaffRole, emptyMenu: boolean): TourStep[] {
  const end = role === 'owner' ? [SN, S5_OWNER] : [SC, S5];
  // Design: an empty menu (a helper with nothing granted) leaves out S2 and shows H1.
  return emptyMenu ? [S1, S3, H1, ...end] : [S1, S2, S3, ...end];
}

/** COPY-UNSIGNED: the tour's name for screen readers, and its first page's. */
export const STAFF_TOUR_LABEL = 'Staff tour';
const SHELL_NAME = 'X2F Staff';

/**
 * The tour for one staff member, from the server's menu (`me.nav`, review S3): the shell, then each
 * page of that menu that has live stops, in menu order.
 */
export function staffTour(me: StaffMe): TourDef {
  const shell: TourPage = { id: 'shell', name: SHELL_NAME, path: '/', steps: shellSteps(me.role, me.nav.length === 0) };
  const pages: TourPage[] = me.nav
    .map((item): TourPage => ({ id: item, name: NAV_LABELS[item], path: NAV_PATHS[item], steps: pageSteps(item, me.role) }))
    .filter((p) => p.steps.length > 0);
  return { id: `staff-${me.role}`, flow: 'screens', label: STAFF_TOUR_LABEL, pages: [shell, ...pages] };
}

// ---- Design's stops that wait for their screens (tour-stops.md §3) ----

const MODS: readonly StaffRole[] = ['mod', 'senior', 'owner'];
const MOD_QUEUE = 'ModQueue (Disputes page, Plan 4 Task 17)';
const MOD_CASE = 'ModCase (the case page, Plan 4 Task 18)';

export const PENDING_STAFF_STOPS: readonly PendingStop[] = [
  { id: 'S4', board: 'StaffOverview rail foot', element: '[data-part="session-countdown"], shown in tour mode', title: 'Session time', body: 'When your session is close to ending, a countdown appears here. Wrap up before it hits zero.', placement: 'auto', roles: ['helper', 'mod', 'senior', 'owner'], waitsFor: 'the engine showing the countdown in tour mode (it renders only in the last 10 minutes)' },
  { id: 'D1', board: MOD_QUEUE, element: '"Take next case"', title: 'Take the next case', body: 'One tap gives you the oldest case nobody has yet.', placement: 'auto', roles: MODS, waitsFor: 'the Disputes page' },
  { id: 'D2', board: MOD_QUEUE, element: 'the queue table (Amount, Method, Opened by, Assigned to)', title: 'The queue', body: 'Every open dispute. Unassigned ones are waiting for someone like you.', placement: 'below', roles: MODS, waitsFor: 'the Disputes page' },
  { id: 'D3', board: MOD_QUEUE, element: '"Overdue" chip', title: 'Watch the clock', body: 'Overdue means a reply deadline has passed. Those come first.', placement: 'auto', roles: MODS, waitsFor: 'the Disputes page' },
  { id: 'D4', board: MOD_QUEUE, element: '"Need a second approval"', title: 'Second approvals', body: "Big rulings wait here for a senior's yes. Check them before your own cases.", placement: 'auto', roles: ['senior', 'owner'], waitsFor: 'the Disputes page' },
  { id: 'C1', board: MOD_CASE, element: '"First reply due in"', title: 'Your first reply', body: 'Say hello to both traders before this runs out.', placement: 'auto', roles: ['mod', 'senior'], waitsFor: 'the case page' },
  { id: 'C2', board: MOD_CASE, element: 'Traders / Trade / Escrow facts', title: 'The facts', body: "Who's involved, what was agreed, and where the XMR is.", placement: 'auto', roles: ['mod', 'senior'], waitsFor: 'the case page' },
  { id: 'C3', board: MOD_CASE, element: '"Payment proof", "Request the original proof"', title: 'Check the proof', body: 'Look at what each side sent. Ask for the original if a picture looks off.', placement: 'auto', roles: ['mod', 'senior'], waitsFor: 'the case page and the moderator proof view (NEEDS_P4_CHAT_MEMBERSHIP)' },
  { id: 'C4', board: MOD_CASE, element: '"Full chat", "Message both traders"', title: 'Talk it through', body: 'Read the whole chat and write to both traders at once.', placement: 'auto', roles: ['mod', 'senior'], waitsFor: 'the case page and chat membership (NEEDS_P4_CHAT_MEMBERSHIP)' },
  { id: 'C5', board: MOD_CASE, element: '"Your ruling", "Send ruling for approval"', title: 'Your ruling', body: 'Pick the outcome and explain it. Big trades need a second approval before they count.', placement: 'auto', roles: ['mod', 'senior'], waitsFor: 'the case page' },
  { id: 'C6', board: MOD_CASE, element: '"Account action", "Freeze trading"', title: 'Account action', body: "You can freeze a trader's trading, or ban them, when a case calls for it. Every action is logged.", placement: 'auto', roles: ['senior'], waitsFor: 'the case page' },
  { id: 'R1', board: 'StaffImportVerify (past reputation check)', element: 'the check page', title: 'Check past trades', body: 'Confirm the trading history a new trader brings from another site.', placement: 'below', roles: ['senior'], waitsFor: 'the past-reputation check page' },
  { id: 'L1', board: 'StaffLog (Activity log)', element: '"Show", "Trade code" filters', title: 'Find what happened', body: 'Search by trade code to see every step of a case.', placement: 'below', roles: ['mod', 'senior'], waitsFor: 'the Activity log page' },
  { id: 'L2', board: 'StaffLog (Activity log)', element: '"When / What happened" list', title: 'The record', body: 'Everything on your cases is logged, so you can always check back.', placement: 'below', roles: ['mod', 'senior'], waitsFor: 'the Activity log page' },
  { id: 'O1', board: 'StaffOverview', element: '"Emergency stop", "Pause all new trades"', title: 'Emergency stop', body: "Pauses every new trade at once. Use it only when something's really wrong.", placement: 'auto', roles: ['owner'], waitsFor: 'the Overview page (Plan 4 Task 17)' },
  { id: 'O2', board: 'StaffOverview', element: '"Maintenance mode"', title: 'Maintenance', body: 'Take the site down for planned work, with a message for traders.', placement: 'auto', roles: ['owner'], waitsFor: 'the Overview page' },
  { id: 'O3', board: 'StaffOverview', element: '"Announcement banner"', title: 'Announcements', body: "Put a short notice at the top of every trader's screen.", placement: 'auto', roles: ['owner'], waitsFor: 'the Overview page' },
  { id: 'O5', board: 'StaffOverview', element: '"Earnings" (This month, All time)', title: 'Earnings', body: 'What X2F has earned in fees, by month.', placement: 'auto', roles: ['owner'], waitsFor: 'the Overview page' },
  { id: 'O6', board: 'StaffOverview', element: '"Ruling waiting for you" (Notifications)', title: 'Needs you', body: 'Anything waiting for your approval shows up here first.', placement: 'auto', roles: ['owner'], waitsFor: 'the Overview page' },
  { id: 'P1', board: 'StaffList', element: '"Add staff member"', title: 'Add staff', body: 'Create an invite link for a new helper or moderator.', placement: 'auto', roles: ['owner'], waitsFor: 'the StaffList page (the Staff page shows grants only on main)' },
  { id: 'P2', board: 'StaffList', element: 'the table (Role, Login hours, Status)', title: 'Your team', body: "Everyone's role, login hours and status at a glance.", placement: 'below', roles: ['owner'], waitsFor: 'the StaffList page' },
  { id: 'M1', board: 'StaffPerformance', element: '"Moderators" table', title: 'How cases go', body: "Each moderator's cases, reply times and rulings overturned on appeal.", placement: 'below', roles: ['owner'], waitsFor: 'the Performance page' },
  { id: 'M2', board: 'StaffPerformance', element: '"Period"', title: 'Pick a period', body: 'Compare this week, last month or all time.', placement: 'auto', roles: ['owner'], waitsFor: 'the Performance page' },
  { id: 'L1-owner', board: 'StaffLog (Activity log)', element: '"Show everything" (log.read.all)', title: 'Everything, logged', body: 'Every event on the site, from every staff member.', placement: 'below', roles: ['owner'], waitsFor: 'the Activity log page' },
  { id: 'L2-owner', board: 'StaffLog (Activity log)', element: '"When / What happened"', title: 'The record', body: 'Filter by trade code or person to follow any thread.', placement: 'below', roles: ['owner'], waitsFor: 'the Activity log page' },
  { id: 'G1', board: 'StaffSettings', element: '"Staff pay"', title: 'Staff pay', body: 'Set what helpers and moderators earn.', placement: 'auto', roles: ['owner'], waitsFor: 'the Settings page (Plan 4 Task 20)' },
  { id: 'G2', board: 'StaffSettings', element: '"Rulings" (Appeal window, First response deadline)', title: 'Case rules', body: 'How long traders have to appeal, and how fast moderators must reply.', placement: 'auto', roles: ['owner'], waitsFor: 'the Settings page' },
  { id: 'G3', board: 'StaffSettings', element: '"Fee wallet", "Owner keys"', title: 'Money and keys', body: 'Where fees are swept and which keys can approve. Every change needs your key.', placement: 'auto', roles: ['owner'], waitsFor: 'the Settings page' },
];
