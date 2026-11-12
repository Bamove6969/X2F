/**
 * The first visit on a device goes to the welcome screen before /sell (owner, 12 Nov 2026, demo
 * note #47: "not the first screen I want them to land on"). Only /sell, the home every login and
 * setup returns to, is gated: a deep link (a trade, a wallet) is never interrupted.
 */
import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { WELCOME_PATH, welcomeSeen } from '../../tour/welcomeSeen.js';

export function WelcomeGate({ children }: { children: ReactNode }) {
  if (!welcomeSeen()) return <Navigate to={WELCOME_PATH} replace />;
  return <>{children}</>;
}
