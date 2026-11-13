/**
 * The first visit on a device goes to the welcome screen before /sell (owner, 12 Nov 2026, demo
 * note #47: "not the first screen I want them to land on"). Only /sell, the home every login and
 * setup returns to, is gated: a deep link (a trade, a wallet) is never interrupted. The query comes
 * along, so Skip lands on the same /sell (review 12 Nov, T3).
 *
 * Team members (lead, 12 Nov 2026) never see the welcome screen or the trader's first-trade tour:
 * theirs is the member tour, and the welcome screen's Settings leads to an owner-only screen.
 */
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { memberOf } from '../../session/member.js';
import { useSession } from '../../session/useSession.js';
import { WELCOME_PATH, welcomeSeen } from '../../tour/welcomeSeen.js';

export function WelcomeGate({ children }: { children: ReactNode }) {
  const { search } = useLocation();
  const member = memberOf(useSession()) !== null;
  if (!member && !welcomeSeen()) return <Navigate to={`${WELCOME_PATH}${search}`} replace />;
  return <>{children}</>;
}
