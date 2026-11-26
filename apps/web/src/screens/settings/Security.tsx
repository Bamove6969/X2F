/**
 * Settings → Security (Task 30, P3-C4), the first of the Settings tabs since owner demo note #101
 * (SettingsTabs.tsx; the alerts moved to the Alerts tab, the account links to Account, the tour to
 * Help). One screen that gathers: the login methods (list, add,
 * remove, with the last-method guard and TOTP / recovery codes), a link to Devices and sessions (its own screen since C2-D1; it holds the session length, which
 * replaced the inactivity logout timer, owner 2 Nov 2026) and the idle reminder. All confirm-it's-you prompts across the screen use one shared `ConfirmSheet` (via
 * `useConfirm`), so there is a single confirm UI (X-4).
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ConfirmOpenProvider, useConfirm } from '../auth/ConfirmSheet.js';
import { authApi } from '../auth/authApi.js';
import { formatDateTime } from '../../ui/dates.js';
import { IDLE_COPY, IDLE_REMINDER_PATH } from '../auth/sessionCopy.js';
import { Icon } from '../../ui/icons.js';
import { NewRecoveryCode } from './NewRecoveryCode.js';
import { DEVICES_PATH, DEVICES_TITLE } from './devicesCopy.js';
import { Methods } from './Methods.js';
import { TradeKeys } from './TradeKeys.js';
import { MovedSectionRedirect, SettingsPage, SettingsRow, useKnownMember } from './SettingsTabs.js';
import { SETTINGS_COPY } from './settingsCopy.js';
import { useSession } from '../../session/useSession.js';
import { SECOND_METHOD_MESSAGE, SECOND_METHOD_TITLE } from '../../ui/cantDoCodes.js';
import '../screens.css';
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
function HelpCard({ member = false }: { member?: boolean }) {
  const tour = useTour();
  const label = replayLabel(FIRST_TRADE_TOUR.id);
  return (
    <section className="x2f-card" data-part="help" aria-label={REPLAY_COPY.help}>
      <h2 className="x2f-section-title">{REPLAY_COPY.help}</h2>
      <ul className="x2f-list">
        {!member ? (
          <li className="x2f-list__row">
            <button type="button" className="x2f-row-link x2f-tour-replay" data-part="tour-replay" onClick={() => tour.start(FIRST_TRADE_TOUR, { resume: true })}>
              <span className="x2f-tour-replay__text">
                <span>{label}</span>
                <small>{REPLAY_COPY.sub}</small>
              </span>
              <Icon name="chevron-right" size={20} />
            </button>
          </li>
        ) : null}
        <li className="x2f-list__row">
          <Link className="x2f-button x2f-button--quiet" to={WELCOME_PATH} data-part="welcome-link">
            {WELCOME_LINK}
          </Link>
        </li>
      </ul>
    </section>
  );
}

/** COPY-UNSIGNED (owner, 26 Nov 2026): what a recovery-code login may do, and until when. */
export const recoveryWindowSentence = (until: string): string =>
  `You logged in with your recovery code. Until ${formatDateTime(new Date(until))} you can add or remove any login method without confirming it's you. Set up the ways you will log in from now on.`;

/**
 * Owner, 26 Nov 2026: a recovery-code login may change every login method without confirming for
 * an hour (`me().recoveryUntil`), so the screen says so up front.
 */
function RecoveryWindowBanner() {
  const [until, setUntil] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    authApi.me().then(
      (me) => {
        if (!live) return;
        const t = me.recoveryUntil ?? null;
        setUntil(t !== null && Date.parse(t) > Date.now() ? t : null);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  if (until === null) return null;
  return (
    <p className="x2f-note" role="status" data-part="recovery-window">
      {recoveryWindowSentence(until)}
    </p>
  );
}

/** Plan 2 Task 18, order #2 M3: Settings screen. Owner sees full security settings; team members see member settings. */
export function Security() {
  return <SecurityScreen />;
}

function SecurityScreen() {
  const { prove, confirmUi, open } = useConfirm();
  const { ready, member } = useKnownMember();
  const session = useSession();
  // Fewer than two kinds of login method, its sign-up over: this session may only add a way to log in.
  const setupOnly = session.status === 'signed-in' && (session.me as { setupOnly?: unknown }).setupOnly === true;

  return (
    <ConfirmOpenProvider value={open}>
      <MovedSectionRedirect />
      <SettingsPage tab="security" screen="security">
        {!ready ? null : (
          <>
            {setupOnly ? (
              <section className="x2f-card" role="status" data-part="setup-only" aria-labelledby="setup-only-h">
                <h2 className="x2f-card__title" id="setup-only-h">
                  {SECOND_METHOD_TITLE}
                </h2>
                <p className="x2f-note">{SECOND_METHOD_MESSAGE}</p>
              </section>
            ) : null}
            {!member ? (
              <>
                <RecoveryWindowBanner />
                {/* A new recovery code to write down (after a recovery-code login). */}
                <NewRecoveryCode />
                <Methods prove={prove} />
              </>
            ) : null}
            {/* Escrow-key sync (owner, 26 Nov 2026): the holder's backup, or an assigned member's own reader key. */}
            {!setupOnly ? <TradeKeys member={member} /> : null}
            {/* C2-D1: Devices is its own screen ("Devices and sessions" board); Security links to it, and to
                the idle reminder (owner Q75), both about how long a login lasts. A team member (order #2
                M3) gets the idle reminder only: Devices is the owner's. */}
            {/* A setup-only session (review M2) reaches neither screen. */}
            {!setupOnly ? (
            <section className="x2f-card" data-part={member ? 'sessions-card' : 'devices-link'} aria-labelledby="settings-sessions-h">
              <h2 className="x2f-card__title" id="settings-sessions-h">
                {SETTINGS_COPY.sessionsTitle}
              </h2>
              <ul className="x2f-list">
                {!member ? (
                  <SettingsRow to={DEVICES_PATH} part="devices-row">
                    {DEVICES_TITLE}
                  </SettingsRow>
                ) : null}
                <SettingsRow to={IDLE_REMINDER_PATH} part="idle-reminder-link">
                  {IDLE_COPY.link}
                </SettingsRow>
              </ul>
            </section>
            ) : null}
          </>
        )}
        {confirmUi}
      </SettingsPage>
    </ConfirmOpenProvider>
  );
}

/** Settings → Help: the guided tour and the way back to the welcome screen (moved off Security). */
export function HelpSettings() {
  // Order #2 m1: a team member gets the welcome link but not the owner's tour replay.
  const { ready, member } = useKnownMember();
  return (
    <SettingsPage tab="help" screen="settings-help">
      {ready ? <HelpCard member={member} /> : null}
    </SettingsPage>
  );
}
