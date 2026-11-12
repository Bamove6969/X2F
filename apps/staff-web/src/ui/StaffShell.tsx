import type { NavItem } from '@x2f/staff';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { codeOf, logout, me as fetchMe, serverNow, setSessionEndListener, type Me } from '../api.js';
import { ClockOut } from './ClockOut.js';
import { Button, Countdown, EmptyState } from './kit.js';
import { RoleChip } from './RoleChip.js';
import './staff.css';

/** The nav labels of the boards (StaffOverview's rail): "Overview, Disputes, Staff, Performance, Training library, Activity log, Settings". */
export const NAV_LABELS: Readonly<Record<NavItem, string>> = {
  overview: 'Overview',
  disputes: 'Disputes',
  staff: 'Staff',
  performance: 'Performance',
  // Owner Q13 (J-21): the price-health page. DESIGN: not drawn (no board places it); COPY-UNSIGNED
  prices: 'Prices',
  training: 'Training library',
  log: 'Activity log',
  // Plan 5 Task 4: no board places it yet (NAV puts it before Settings). DESIGNER-REVIEW
  feedback: 'Feedback',
  settings: 'Settings',
};

export const NAV_PATHS: Readonly<Record<NavItem, string>> = {
  overview: '/overview',
  disputes: '/disputes',
  staff: '/staff',
  performance: '/performance',
  prices: '/prices',
  training: '/training',
  log: '/log',
  feedback: '/feedback',
  settings: '/settings',
};

/** The countdown shows when the session ends this soon (Plan 4 Task 16). */
export const COUNTDOWN_FROM_MS = 10 * 60_000;

/** What a staff member whose role has no pages sees (a helper until Task 30's tickets). COPY-UNSIGNED */
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
export function StaffShell({ pages }: { pages: Partial<Record<NavItem, ReactNode>> }) {
  const [who, setWho] = useState<Me | null>(null);
  const [clockingOut, setClockingOut] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();

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
          <span className="x2f-wordmark">X2F</span>
          <span className="x2f-staff__brand-tag">Staff</span>
        </p>
        <nav aria-label="Staff" className="x2f-staff__nav">
          {who.nav.map((item) => (
            <Link key={item} to={NAV_PATHS[item]} aria-current={pathname === NAV_PATHS[item] || pathname.startsWith(`${NAV_PATHS[item]}/`) ? 'page' : undefined}>
              {NAV_LABELS[item]}
            </Link>
          ))}
        </nav>
        <div className="x2f-staff__foot">
          <SessionCountdown endsAt={who.sessionEndsAt} />
          <RoleChip username={who.displayName} role={who.role} />
          {who.role !== 'owner' ? (
            <>
              {/* Task 33 (D-045): the reminder that only a clock-out pays. COPY-UNSIGNED DESIGNER-REVIEW */}
              <p className="x2f-staff__countdown" data-part="clock-out-reminder">
                Clock out at the end of your shift to be paid. Logging out or closing the app does not pay.
              </p>
              <Button variant="primary" onClick={() => setClockingOut(true)}>
                Clock out
              </Button>
            </>
          ) : null}
          <Button variant="quiet" onClick={() => void onLogout()}>
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
        <Routes>
          <Route index element={first ? <Navigate to={NAV_PATHS[first]} replace /> : <NothingForRole />} />
          {who.nav.map((item) => (
            <Route key={item} path={`${NAV_PATHS[item]}/*`} element={pages[item] ?? <PageTitle title={NAV_LABELS[item]} />} />
          ))}
          <Route path="*" element={<NothingForRole />} />
        </Routes>
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
