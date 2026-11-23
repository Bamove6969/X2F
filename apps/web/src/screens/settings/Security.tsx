/**
 * Settings → Security (Task 30, P3-C4), the first of the Settings tabs since owner demo note #101
 * (SettingsTabs.tsx; the alerts moved to the Alerts tab, the account links to Account, the tour to
 * Help). One screen that gathers: the login methods (list, add,
 * remove, with the last-method guard and TOTP / recovery codes), the payout-wallet wait
 * explanation, a link to Devices and sessions (its own screen since C2-D1; it holds the session length, which
 * replaced the inactivity logout timer, owner 2 Nov 2026) and the idle reminder. All confirm-it's-you prompts across the screen use one shared `ConfirmSheet` (via
 * `useConfirm`), so there is a single confirm UI (X-4).
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ConfirmOpenProvider, useConfirm } from '../auth/ConfirmSheet.js';
import { authApi } from '../auth/authApi.js';
import { holdSentence } from '../auth/refusals.js';
import { IDLE_COPY, IDLE_REMINDER_PATH } from '../auth/sessionCopy.js';
import { Icon } from '../../ui/icons.js';
import { AccountChanges } from './HoldChanges.js';
import { NewRecoveryCode } from './NewRecoveryCode.js';
import { DEVICES_PATH, DEVICES_TITLE } from './devicesCopy.js';
import { Methods } from './Methods.js';
import { PayoutWait } from './PayoutWait.js';
import { MovedSectionRedirect, SettingsPage, SettingsRow } from './SettingsTabs.js';
import { SETTINGS_COPY } from './settingsCopy.js';
import '../screens.css';
import { OwnerOnly } from './OwnerOnly.js';
import { WELCOME_PATH } from '../../tour/welcomeSeen.js';
import { FIRST_TRADE_TOUR } from '../../tour/firstTradeTour.js';
import { REPLAY_COPY, replayLabel } from '../../tour/progress.js';
import { useTour } from '../../tour/TourProvider.js';

/** COPY-UNSIGNED: the way back to the welcome screen (owner, 12 Nov 2026). */
export const WELCOME_LINK = 'Welcome screen';

/**
 * Settings, Help (design, tour-stops.md §1 "Entry and replay"): "Take the tour again", which reads
 * "Carry on the tour" while one is left half done on this device, and the way back to the welcome
 * screen. Since owner demo note #101 it is the Settings Help tab. DESIGNER-REVIEW: placement.
 */
function HelpCard() {
  const tour = useTour();
  const label = replayLabel(FIRST_TRADE_TOUR.id);
  return (
    <section className="x2f-card" data-part="help" aria-label={REPLAY_COPY.help}>
      <h2 className="x2f-section-title">{REPLAY_COPY.help}</h2>
      <ul className="x2f-list">
        <li className="x2f-list__row">
          <button type="button" className="x2f-row-link x2f-tour-replay" data-part="tour-replay" onClick={() => tour.start(FIRST_TRADE_TOUR, { resume: true })}>
            <span className="x2f-tour-replay__text">
              <span>{label}</span>
              <small>{REPLAY_COPY.sub}</small>
            </span>
            <Icon name="chevron-right" size={20} />
          </button>
        </li>
        <li className="x2f-list__row">
          <Link className="x2f-button x2f-button--quiet" to={WELCOME_PATH} data-part="welcome-link">
            {WELCOME_LINK}
          </Link>
        </li>
      </ul>
    </section>
  );
}

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
      <MovedSectionRedirect />
      <SettingsPage tab="security" screen="security">
        <HoldBanner />
        {/* Hold model v3 (lead review item 3): a new recovery code to write down, and the account's changes. */}
        <NewRecoveryCode />
        <AccountChanges />
        <Methods prove={prove} />
        <PayoutWait />
        {/* C2-D1: Devices is its own screen ("Devices and sessions" board); Security links to it, and to
            the idle reminder (owner Q75), both about how long a login lasts. */}
        <section className="x2f-card" data-part="devices-link" aria-labelledby="settings-sessions-h">
          <h2 className="x2f-card__title" id="settings-sessions-h">
            {SETTINGS_COPY.sessionsTitle}
          </h2>
          <ul className="x2f-list">
            <SettingsRow to={DEVICES_PATH} part="devices-row">
              {DEVICES_TITLE}
            </SettingsRow>
            <SettingsRow to={IDLE_REMINDER_PATH} part="idle-reminder-link">
              {IDLE_COPY.link}
            </SettingsRow>
          </ul>
        </section>
        {confirmUi}
      </SettingsPage>
    </ConfirmOpenProvider>
  );
}

/** Settings → Help: the guided tour and the way back to the welcome screen (moved off Security). */
export function HelpSettings() {
  return (
    <OwnerOnly screen="settings-help">
      <SettingsPage tab="help" screen="settings-help">
        <HelpCard />
      </SettingsPage>
    </OwnerOnly>
  );
}
