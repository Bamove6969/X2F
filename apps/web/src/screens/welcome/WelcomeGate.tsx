/**
 * The first visit on a device goes to the welcome screen before /sell (owner, 12 Nov 2026, demo
 * note #47: "not the first screen I want them to land on"). Only /sell, the home every login and
 * setup returns to, is gated: a deep link (a trade, a wallet) is never interrupted. The query comes
 * along, so Skip lands on the same /sell (review 12 Nov, T3).
 *
 * Team members (lead, 12 Nov 2026) never see the welcome screen or the trader's first-trade tour:
 * on a member's first /sell on a device the member tour starts instead (tour/memberSteps.ts, from the
 * boxes the owner ticked), once, and Skip tour ends it as for any tour.
 */
import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { memberAbilities, memberOf } from '../../session/member.js';
import { useSession } from '../../session/useSession.js';
import { memberTour } from '../../tour/memberSteps.js';
import { useTour } from '../../tour/TourProvider.js';
import { WELCOME_PATH, markWelcomeSeen, welcomeSeen } from '../../tour/welcomeSeen.js';

export function WelcomeGate({ children }: { children: ReactNode }) {
  const { search } = useLocation();
  const session = useSession();
  const tour = useTour();
  const member = memberOf(session) !== null;
  const memberFirst = member && !welcomeSeen();
  useEffect(() => {
    if (!memberFirst) return;
    markWelcomeSeen();
    // No trade to open here: the member tour leaves its Trade room page out (memberTour).
    tour.start(memberTour(memberAbilities(session)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on the first visit
  }, [memberFirst]);
  if (!member && !welcomeSeen()) return <Navigate to={`${WELCOME_PATH}${search}`} replace />;
  return <>{children}</>;
}
