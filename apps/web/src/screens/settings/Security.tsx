/**
 * Settings → Security (Task 30, P3-C4). One screen that gathers: the login methods (list, add,
 * remove, with the last-method guard and TOTP / recovery codes), the new payout-wallet wait
 * explanation, the signed-in devices with remote log-out, the alerts list, and the inactivity
 * logout-timer dropdown. All confirm-it's-you prompts across the screen use one shared
 * `ConfirmSheet` (via `useConfirm`), so there is a single confirm UI (X-4).
 */
import { useState } from 'react';
import { useConfirm } from '../auth/ConfirmSheet.js';
import { Alerts } from './Alerts.js';
import { Devices } from './Devices.js';
import { Methods } from './Methods.js';
import { PayoutWait } from './PayoutWait.js';
import { DEFAULT_LOGOUT_TIMER, LOGOUT_TIMER_HOURS, isLogoutTimerHours, saveLogoutTimer, type LogoutTimerHours } from './logoutTimer.js';
import '../screens.css';

function LogoutTimer() {
  const [hours, setHours] = useState<LogoutTimerHours>(DEFAULT_LOGOUT_TIMER);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const change = (value: number) => {
    if (!isLogoutTimerHours(value)) return;
    setHours(value);
    setStatus('saving');
    saveLogoutTimer(value).then(
      () => setStatus('saved'),
      () => setStatus('error'),
    );
  };

  return (
    <section className="x2f-card" data-part="logout-timer" aria-labelledby="logout-timer-h">
      <h2 className="x2f-card__title" id="logout-timer-h">
        Stay logged in
      </h2>
      <p className="x2f-sheet__body">Log me out after this long with no activity.</p>
      <div className="x2f-field">
        <label className="x2f-label" htmlFor="logout-timer-select">
          Inactivity timeout
        </label>
        <select
          className="x2f-select"
          id="logout-timer-select"
          value={hours}
          onChange={(e) => change(Number(e.target.value))}
          data-part="logout-timer-select"
        >
          {LOGOUT_TIMER_HOURS.map((h) => (
            <option value={h} key={h}>
              {h} hours
            </option>
          ))}
        </select>
        {status === 'saved' ? (
          <p className="x2f-note" data-part="logout-timer-status">
            Saved.
          </p>
        ) : null}
        {status === 'error' ? (
          <p className="x2f-error" role="alert" data-part="logout-timer-status">
            Could not save that. Try again.
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function Security() {
  const { prove, confirmUi } = useConfirm();

  return (
    <main className="x2f-screen" data-screen="security">
      <h1 className="x2f-screen__title">Security</h1>
      <Methods prove={prove} />
      <PayoutWait />
      <Devices />
      <LogoutTimer />
      <Alerts />
      {confirmUi}
    </main>
  );
}
