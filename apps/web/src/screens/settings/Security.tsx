/**
 * Settings → Security (Task 30, P3-C4). One screen that gathers: the login methods (list, add,
 * remove, with the last-method guard and TOTP / recovery codes), the payout-wallet wait
 * explanation, the signed-in devices with remote log-out, the inactivity logout timer, and the
 * alerts list. All confirm-it's-you prompts across the screen use one shared `ConfirmSheet` (via
 * `useConfirm`), so there is a single confirm UI (X-4).
 */
import { useEffect, useState } from 'react';
import { IDLE_HOURS, type IdleHours, type LogoutTimer as Timer } from '@x2f/auth-client';
import { ConfirmOpenProvider, useConfirm } from '../auth/ConfirmSheet.js';
import { authApi } from '../auth/authApi.js';
import { holdSentence } from '../auth/refusals.js';
import { Alerts } from './Alerts.js';
import { Devices } from './Devices.js';
import { Methods } from './Methods.js';
import { PayoutWait } from './PayoutWait.js';
import '../screens.css';

const isIdleHours = (n: number): n is IdleHours => (IDLE_HOURS as readonly number[]).includes(n);

/**
 * The inactivity logout timer (owner, 2026-10-23): traders pick 2–12 hours (default 12); staff and
 * the owner are fixed at 2 hours (`adjustable: false`) and see the value without a choice. The
 * saved value is loaded first, so the screen never claims a value it has not read.
 */
function LogoutTimer() {
  const [timer, setTimer] = useState<Timer | null>(null);
  const [status, setStatus] = useState<'loading' | 'idle' | 'saving' | 'saved' | 'error' | 'load-error'>('loading');

  useEffect(() => {
    let live = true;
    authApi.getLogoutTimer().then(
      (t) => {
        if (!live) return;
        setTimer(t);
        setStatus('idle');
      },
      () => {
        if (live) setStatus('load-error');
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const change = (value: number) => {
    if (!isIdleHours(value) || timer === null) return;
    const before = timer;
    setTimer({ ...timer, idleHours: value });
    setStatus('saving');
    authApi.setLogoutTimer({ idleHours: value }).then(
      (t) => {
        setTimer(t);
        setStatus('saved');
      },
      () => {
        setTimer(before);
        setStatus('error');
      },
    );
  };

  return (
    <section className="x2f-card" data-part="logout-timer" aria-labelledby="logout-timer-h">
      <h2 className="x2f-card__title" id="logout-timer-h">
        Stay logged in
      </h2>
      <p className="x2f-sheet__body">Log me out after this long with no activity.</p>
      {status === 'loading' ? <p className="x2f-note">Loading…</p> : null}
      {status === 'load-error' ? (
        <p className="x2f-error" role="alert">
          Could not load this setting. Reload the page to try again.
        </p>
      ) : null}
      {timer !== null && !timer.adjustable ? (
        <p className="x2f-sheet__body" data-part="logout-timer-fixed">
          {timer.idleHours} hours. Staff accounts are fixed at this.
        </p>
      ) : null}
      {timer !== null && timer.adjustable ? (
        <div className="x2f-field">
          <label className="x2f-label" htmlFor="logout-timer-select">
            Inactivity timeout
          </label>
          <select
            className="x2f-select"
            id="logout-timer-select"
            value={timer.idleHours}
            disabled={status === 'saving'}
            onChange={(e) => change(Number(e.target.value))}
            data-part="logout-timer-select"
          >
            {IDLE_HOURS.map((h) => (
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
      ) : null}
    </section>
  );
}

/**
 * A backup login's recovery session is held (Plan 2: a TOTP backup waits a day): every change on
 * this screen is refused until then, so the screen says so up front, from `me()`.
 */
function HoldBanner() {
  const [held, setHeld] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    authApi.me().then(
      (me) => {
        if (live) setHeld(me.level === 'recovery' && me.holdUntil !== null && Date.parse(me.holdUntil) > Date.now() ? me.holdUntil : null);
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

export function Security() {
  const { prove, confirmUi, open } = useConfirm();

  return (
    <ConfirmOpenProvider value={open}>
      <main className="x2f-screen" data-screen="security">
        <h1 className="x2f-screen__title">Security</h1>
        <HoldBanner />
        <Methods prove={prove} />
        <PayoutWait />
        <Devices prove={prove} />
        <LogoutTimer />
        <Alerts />
        {confirmUi}
      </main>
    </ConfirmOpenProvider>
  );
}
