/**
 * Settings → Security (Task 30, P3-C4). One screen that gathers: the login methods (list, add,
 * remove, with the last-method guard and TOTP / recovery codes), the payout-wallet wait
 * explanation, a link to Devices and sessions (its own screen since C2-D1; it holds the session length, which
 * replaced the inactivity logout timer, owner 2 Nov 2026), and the alerts list. All confirm-it's-you prompts across the screen use one shared `ConfirmSheet` (via
 * `useConfirm`), so there is a single confirm UI (X-4).
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ConfirmOpenProvider, useConfirm } from '../auth/ConfirmSheet.js';
import { authApi } from '../auth/authApi.js';
import { heldNote, holdSentence } from '../auth/refusals.js';
import { Icon } from '../../ui/icons.js';
import { Alerts } from './Alerts.js';
import { BLOCKED_PATH } from './BlockAction.js';
import { BLOCK_COPY } from './blockCopy.js';
import { DEVICES_PATH, DEVICES_TITLE } from './devicesCopy.js';
import { Methods } from './Methods.js';
import { PayoutWait } from './PayoutWait.js';
import { TEAM_COPY, TEAM_PATH } from './teamCopy.js';
import '../screens.css';
import { OwnerOnly } from './OwnerOnly.js';

/** The latest of these hold end times (the first on a tie), or null for none. */
export function latestHoldEnd(ends: readonly string[]): string | null {
  return ends.reduce<string | null>((a, b) => (a !== null && Date.parse(a) >= Date.parse(b) ? a : b), null);
}

/**
 * A backup login's recovery session is held, or the account is on its 24-hour hold (Plan 2 Tasks 9
 * and 17): changes on this screen are refused until then, so the screen says so up front, from `me()`.
 */
function HoldBanner() {
  const [held, setHeld] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    authApi.me().then(
      (me) => {
        if (!live) return;
        // A held backup session (Task 9), or the account's 24-hour hold (Task 17): the later end.
        const ends = [me.level === 'recovery' ? me.holdUntil : null, me.accountHoldUntil ?? null].filter(
          (t): t is string => typeof t === 'string' && Date.parse(t) > Date.now(),
        );
        setHeld(latestHoldEnd(ends));
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  if (typeof held !== 'string') return null;
  return (
    <p className="x2f-note" role="status" data-part="hold-banner">
      {holdSentence(held)}
    </p>
  );
}

/** Plan 2 Task 18: the account owner's screen; a team member gets the owner-only refusal. */
export function Security() {
  return (
    <OwnerOnly screen="security">
      <SecurityScreen />
    </OwnerOnly>
  );
}

function SecurityScreen() {
  const { prove, confirmUi, open } = useConfirm();

  return (
    <ConfirmOpenProvider value={open}>
      <main className="x2f-screen" data-screen="security">
        <h1 className="x2f-screen__title">Security</h1>
        <HoldBanner />
        <Methods prove={prove} />
        <PayoutWait />
        {/* C2-D1: Devices is its own screen ("Devices and sessions" board); Security links to it. */}
        <section className="x2f-card" data-part="devices-link" aria-label={DEVICES_TITLE}>
          <Link className="x2f-row-link" to={DEVICES_PATH}>
            <span>{DEVICES_TITLE}</span>
            <Icon name="chevron-right" size={20} />
          </Link>
        </section>
        <Alerts />
        {/* Task 37 review M3: the way to the Blocked list until Plan 5's Profile tab (Block board's Settings, Blocked traders). */}
        <section className="x2f-card" data-part="blocked-link" aria-label={BLOCK_COPY.title}>
          <ul className="x2f-list">
            <li className="x2f-list__row">
              <Link className="x2f-button x2f-button--quiet" to={BLOCKED_PATH}>
                {BLOCK_COPY.title}
              </Link>
            </li>
            {/* Plan 2 Task 18: the way to the Team screen until a board places it (NEEDS_DESIGN_TEAM). */}
            <li className="x2f-list__row">
              <Link className="x2f-button x2f-button--quiet" to={TEAM_PATH} data-part="team-link">
                {TEAM_COPY.title}
              </Link>
            </li>
          </ul>
        </section>
        {confirmUi}
      </main>
    </ConfirmOpenProvider>
  );
}
