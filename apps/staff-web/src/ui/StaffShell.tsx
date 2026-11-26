import type { NavItem } from '@x2f/staff';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { codeOf, logout, me as fetchMe, ownerAlerts, serverNow, setSessionEndListener, type Me } from '../api.js';
import { AlertsCountContext } from './alertsCount.js';
import { ClockOut } from './ClockOut.js';
import { Button, Countdown, EmptyState } from './kit.js';
import { RoleChip } from './RoleChip.js';
import './staff.css';

/** The nav labels of the boards (StaffOverview's rail): "Overview, Disputes, Staff, Performance, Training library, Activity log, Settings". */
export const NAV_LABELS: Readonly<Record<NavItem, string>> = {
  overview: 'Overview',
  disputes: 'Disputes',
  // Plan 5 Task 11: no board places it (DESIGN: not drawn). COPY-UNSIGNED DESIGNER-REVIEW
  'past-reputation': 'Past reputation',
  // Spec 6.6 "Account actions": no board places it (DESIGN: not drawn). COPY-UNSIGNED DESIGNER-REVIEW
  accounts: 'Accounts',
  staff: 'Staff',
  performance: 'Performance',
  // Owner Q13 (J-21): the price-health page. DESIGN: not drawn (no board places it); COPY-UNSIGNED
  prices: 'Prices',
  training: 'Training library',
  log: 'Activity log',
  // Plan 5 Task 4: no board places it yet (NAV puts it before Settings). DESIGNER-REVIEW
  feedback: 'Feedback',
  // Plan 4 Task 31: the support-ticket queue (no board places it: DESIGN not drawn). COPY-UNSIGNED DESIGNER-REVIEW
  tickets: 'Tickets',
  settings: 'Settings',
};

export const NAV_PATHS: Readonly<Record<NavItem, string>> = {
  overview: '/overview',
  disputes: '/disputes',
  'past-reputation': '/past-reputation',
  accounts: '/accounts',
  staff: '/staff',
  performance: '/performance',
  prices: '/prices',
  training: '/training',
  log: '/log',
  feedback: '/feedback',
  tickets: '/tickets',
  settings: '/settings',
};

/**
 * The signed-in staff member as the shell last read `GET /staff/v1/me`, for the pages inside it
 * (review mod-screens I3: a page reads the role here instead of asking the API again).
 */
const MeContext = createContext<Me | null>(null);
export const useMe = (): Me | null => useContext(MeContext);

/** The countdown shows when the session ends this soon (Plan 4 Task 16). */
export const COUNTDOWN_FROM_MS = 10 * 60_000;

/** What a staff member with no pages sees (a helper the owner has not granted tickets or feedback). COPY-UNSIGNED */
export const NOTHING_FOR_ROLE = 'Nothing to show for your role yet';

/** How the shell left: Login says "Your login hours have ended." for `hours`. */
export type LoginState = { ended?: 'hours' | 'expired' } | null;

/**
 * The staff app's frame (board StaffOverview): the X2F Staff wordmark, the left nav built from
 * `GET /staff/v1/me`.`nav` (the API decides what each role sees; the app only labels and orders
 * it), the user chip at the foot, and the page. `pages` holds each nav item's page; a path the
 * role does not have shows NOTHING_FOR_ROLE, never another role's page (the API refuses it too).
 *
 * The session: `me` is read again on every page change (each answer moves the idle limit), a
 * countdown shows when `sessionEndsAt` is within 10 minutes, and when the API ends the session
 * (401 `outside-login-hours` from any call, or 401 `not-authenticated`: the session ran out) the
 * shell returns to Login, which says "Your login hours have ended." for the first.
 */
/**
 * My security (lead re-review 6 Nov items 1 and 2): every role's own login methods, sessions and
 * alerts, at /security. Not a `nav` item: the API's `self` perm, which every staff role holds,
 * reads it, so the rail links it under the nav for everyone. No board places it. DESIGNER-REVIEW
 */
export const SECURITY_PATH = '/security';
/** COPY-UNSIGNED */
export const SECURITY_LABEL = 'My security';

export function StaffShell({ pages, notifications, security }: { pages: Partial<Record<NavItem, ReactNode>>; notifications?: ReactNode; security?: ReactNode }) {
  const [clockingOut, setClockingOut] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [who, setWho] = useState<Me | null>(null);
  // O-040: the owner's unread notifications, read again on every page change and after the page acts.
  const [unread, setUnread] = useState(0);
  const [alertsTick, setAlertsTick] = useState(0);
  const isOwner = who?.role === 'owner';
  useEffect(() => {
    if (!isOwner) return;
    let live = true;
    ownerAlerts().then(
      (r) => {
        if (live) setUnread(r.unread);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [isOwner, pathname, alertsTick]);

  useEffect(() => {
    setSessionEndListener((why) => {
      void navigate('/login', { replace: true, state: { ended: why } satisfies LoginState });
    });
    return () => setSessionEndListener(null);
  }, [navigate]);

  useEffect(() => {
    let live = true;
    fetchMe().then(
      (m) => {
        if (live) setWho(m);
      },
      (e: unknown) => {
        // 401s went to Login through the listener; anything else (a network fault) does too, as
        // the shell cannot show pages it cannot check.
        const c = codeOf(e);
        // not-a-refusal: a code comparison that picks the navigation, no text shown.
        if (live && c !== 'outside-login-hours' && c !== 'not-authenticated') void navigate('/login', { replace: true });
      },
    );
    return () => {
      live = false;
    };
  }, [pathname, navigate]);

  if (who === null) return <div className="x2f-staff-loading" aria-busy="true" />;

  const first = who.nav[0];
  const onLogout = async () => {
    setSessionEndListener(null);
    await logout().catch(() => undefined);
    void navigate('/login', { replace: true });
  };

  return (
    <div className="x2f-staff" data-shell="staff">
      <aside className="x2f-staff__rail">
        <p className="x2f-staff__brand">
          <span className="x2f-wordmark">X2F</span>{' '}
          <span className="x2f-staff__brand-tag">Staff</span>
        </p>
        <nav aria-label="Staff" className="x2f-staff__nav">
          {who.nav.map((item) => (
            <Link key={item} to={NAV_PATHS[item]} data-nav={item} aria-current={pathname === NAV_PATHS[item] || pathname.startsWith(`${NAV_PATHS[item]}/`) ? 'page' : undefined}>
              {NAV_LABELS[item]}
            </Link>
          ))}
        </nav>
        {security !== undefined ? (
          // COPY-UNSIGNED: the nav's name for the person's own pages.
          <nav aria-label="Your account" className="x2f-staff__nav x2f-staff__self">
            <Link to={SECURITY_PATH} data-part="my-security" aria-current={pathname === SECURITY_PATH ? 'page' : undefined}>
              {SECURITY_LABEL}
            </Link>
          </nav>
        ) : null}
        <div className="x2f-staff__foot">
          <SessionCountdown endsAt={who.sessionEndsAt} />
          {who.role === 'owner' ? (
            // O-040: no board places it (NOT DRAWN). DESIGNER-REVIEW COPY-UNSIGNED
            <Link to="/notifications" className="x2f-link" data-part="notifications" aria-current={pathname === '/notifications' ? 'page' : undefined}>
              Notifications
              {unread > 0 ? (
                <span className="x2f-staff__badge" data-part="alerts-badge" aria-label={`${unread} unread`}>
                  {unread}
                </span>
              ) : null}
            </Link>
          ) : null}
          <RoleChip username={who.displayName} role={who.role} />
          {who.role !== 'owner' ? (
            <>
              {/* Task 33 (D-045): the reminder that only a clock-out pays. COPY-UNSIGNED DESIGNER-REVIEW */}
              <p className="x2f-staff__countdown" data-part="clock-out-reminder">
                Clock out at the end of your shift to be paid. Logging out or closing the app does not pay.
              </p>
              {/* The rail is the shell's chrome, never a page's primary action (exactly one data-primary
                  per screen, the page's own; as apps/web's tab bar carries none). No board places
                  Clock out (NEEDS_DESIGN_CLOCK_OUT), so it is the outlined button. DESIGN: emphasis */}
              <Button variant="secondary" data-part="clock-out-button" onClick={() => setClockingOut(true)}>
                Clock out
              </Button>
            </>
          ) : null}
          <Button variant="quiet" data-part="logout" onClick={() => void onLogout()}>
            Log out
          </Button>
        </div>
      </aside>
      {clockingOut ? (
        <ClockOut
          onCancel={() => setClockingOut(false)}
          onDone={() => {
            // The clock-out ended the session on the server.
            setSessionEndListener(null);
            void navigate('/login', { replace: true });
          }}
        />
      ) : null}
      <main className="x2f-staff__main">
        <MeContext.Provider value={who}>
          <Routes>
            <Route index element={first ? <Navigate to={NAV_PATHS[first]} replace /> : <NothingForRole />} />
            {who.nav.map((item) => (
              <Route key={item} path={`${NAV_PATHS[item]}/*`} element={pages[item] ?? <PageTitle title={NAV_LABELS[item]} />} />
            ))}
            {security !== undefined ? <Route path={SECURITY_PATH} element={security} /> : null}
            <Route
              path="/notifications"
              element={
                who.role === 'owner' && notifications !== undefined ? (
                  <AlertsCountContext.Provider value={{ unread, refresh: () => setAlertsTick((n) => n + 1) }}>{notifications}</AlertsCountContext.Provider>
                ) : (
                  <NothingForRole />
                )
              }
            />
            <Route path="*" element={<NothingForRole />} />
          </Routes>
        </MeContext.Provider>
      </main>
    </div>
  );
}

/** A nav page whose screen a later task builds (Tasks 17-20): its title only. */
export function PageTitle({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="x2f-staff-page__head">
      <h1 className="x2f-staff-page__title">{title}</h1>
      {children}
    </header>
  );
}

function NothingForRole() {
  // No board (DESIGNER-REVIEW). COPY-UNSIGNED
  return (
    <EmptyState icon="shield" title={NOTHING_FOR_ROLE} data-part="nothing-for-role">
      The owner decides what each role can see.
    </EmptyState>
  );
}

/** "Your session ends in 8 min" once the end is 10 minutes away or less (by the server's clock). COPY-UNSIGNED */
function SessionCountdown({ endsAt }: { endsAt: string }) {
  const end = Date.parse(endsAt);
  const [near, setNear] = useState(() => end - serverNow().getTime() <= COUNTDOWN_FROM_MS);
  useEffect(() => {
    const check = () => setNear(end - serverNow().getTime() <= COUNTDOWN_FROM_MS);
    check();
    const id = setInterval(check, 15_000);
    // At the end, ask the API: it answers 401 and the shell goes to Login.
    const left = end - serverNow().getTime();
    const bye = Number.isFinite(left) ? setTimeout(() => void fetchMe().catch(() => undefined), Math.max(0, left) + 1000) : undefined;
    return () => {
      clearInterval(id);
      if (bye !== undefined) clearTimeout(bye);
    };
  }, [end]);
  if (!near || !Number.isFinite(end)) return null;
  return (
    <p className="x2f-staff__countdown" data-part="session-countdown" role="status">
      Your session ends in <Countdown deadline={endsAt} serverClock={serverNow} format="minutes" />
    </p>
  );
}
