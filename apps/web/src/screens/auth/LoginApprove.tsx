/**
 * The logged-in device's side of new-device approval (Plan 2 Task 16, LoginApprove board): "Someone
 * is logging in on <device>. Is this you?" with three numbers; the right one lets the new device in,
 * a wrong one or "No, block it" blocks it. At the device limit the approval first asks which device
 * to log out. Opened by the live `login-approval` event (App.tsx) and on load for any approval
 * still open (a push may have brought the person here).
 *
 * Built from existing UI-kit parts only (the board is still in progress:
 * test/devices-tripwire.test.ts NEEDS_DESIGN_DEVICES). The words are the board's. The screen shows
 * only what the server sends: a coarse device label, the choices and the times. X2F has no IP
 * address or place to show.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { AuthApiError, type ApprovalView } from '@x2f/auth-client';
import { Button } from '../../ui/Button.js';
import { formatRemaining } from '../../ui/Countdown.js';
import { Sheet } from '../../ui/Sheet.js';
import { authApi } from './authApi.js';
import '../screens.css';

type Session = NonNullable<AuthApiError['sessions']>[number];

type Stage =
  | { kind: 'ask' }
  | { kind: 'choose'; sessions: Session[] }
  | { kind: 'approved' }
  | { kind: 'blocked'; wrong: boolean }
  | { kind: 'ended' };

/** A clock time for the approval's "Time" row, e.g. "29 Oct 2026, 14:05". */
function when(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function LoginApprove({ approval, onDone }: { approval: ApprovalView; onDone: () => void }) {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>({ kind: 'ask' });
  const [pick, setPick] = useState<number | null>(null);
  const [out, setOut] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(() => new Date(approval.expiresAt).getTime() - Date.now());

  useEffect(() => {
    if (stage.kind !== 'ask' && stage.kind !== 'choose') return;
    const t = setInterval(() => {
      const ms = new Date(approval.expiresAt).getTime() - Date.now();
      setLeft(ms);
      if (ms <= 0) setStage({ kind: 'ended' });
    }, 1000);
    return () => clearInterval(t);
  }, [stage.kind, approval.expiresAt]);

  const decide = async (b: { choice: number; logOut?: string } | { block: true }) => {
    setBusy(true);
    setError(null);
    try {
      const { outcome } = await authApi.decideApproval(approval.id, b);
      setStage(outcome === 'approved' ? { kind: 'approved' } : { kind: 'blocked', wrong: !('block' in b) });
    } catch (e) {
      if (e instanceof AuthApiError && e.code === 'too-many-devices') setStage({ kind: 'choose', sessions: e.sessions ?? [] });
      else if (e instanceof AuthApiError && e.code === 'approval-ended') setStage({ kind: 'ended' });
      else setError('Could not send your answer. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const label = approval.deviceLabel;
  let body;
  if (stage.kind === 'approved') {
    body = (
      <div className="x2f-stack" data-part="approve-done">
        <p className="x2f-sheet__body">{label} is logged in.</p>
        {approval.oneDevice ? <p className="x2f-note">One device at a time is on, so this device is now logged out.</p> : null}
        <p className="x2f-note">You can see your devices and log any of them out in Settings, Security.</p>
        <Button variant="primary" onClick={onDone} data-part="approve-ok">
          OK
        </Button>
      </div>
    );
  } else if (stage.kind === 'blocked') {
    body = (
      <div className="x2f-stack" data-part="approve-blocked">
        <p className="x2f-sheet__body">{stage.wrong ? 'That number did not match, so the login was blocked.' : 'The login was blocked.'}</p>
        <p className="x2f-label">Change your login method</p>
        <p className="x2f-note">If you didn't try to log in, someone else may have your login details. Change how you log in now so they can't try again.</p>
        <Button
          variant="primary"
          onClick={() => {
            onDone();
            void navigate('/settings/security');
          }}
          data-part="approve-change-method"
        >
          Change login method
        </Button>
        <Button variant="quiet" onClick={onDone} data-part="approve-not-now">
          Not now
        </Button>
      </div>
    );
  } else if (stage.kind === 'ended') {
    body = (
      <div className="x2f-stack" data-part="approve-ended">
        <p className="x2f-sheet__body">This request has ended. Nobody was let in.</p>
        <Button variant="primary" onClick={onDone} data-part="approve-ok">
          OK
        </Button>
      </div>
    );
  } else if (stage.kind === 'choose') {
    body = (
      <div className="x2f-stack" data-part="approve-choose">
        <p className="x2f-label">Choose a device to log out</p>
        <p className="x2f-sheet__body">You can be logged in on only so many devices at once. To let {label} in, one of these has to be logged out.</p>
        <div className="x2f-stack" role="group" aria-label="Device to log out">
          {stage.sessions.map((s) => (
            <Button
              key={s.id}
              variant="secondary"
              className={out === s.id ? 'x2f-segmented__on' : ''}
              aria-pressed={out === s.id}
              onClick={() => setOut(s.id)}
              data-part="approve-out"
            >
              {s.deviceLabel}
              {s.current ? ' (this device)' : ''}
            </Button>
          ))}
        </div>
        <Button variant="primary" disabled={busy || out === null || pick === null} onClick={() => void decide({ choice: pick!, logOut: out! })} data-part="approve-out-yes">
          Log it out and let them in
        </Button>
        <Button variant="danger" disabled={busy} onClick={() => void decide({ block: true })} data-part="approve-block">
          No, block it
        </Button>
      </div>
    );
  } else {
    body = (
      <div className="x2f-stack" data-part="approve-ask">
        <p className="x2f-sheet__body">Someone is logging in on {label}. Is this you?</p>
        <ul className="x2f-list">
          <li className="x2f-list__row">
            <span className="x2f-list__label">Device</span> {label}
          </li>
          <li className="x2f-list__row">
            <span className="x2f-list__label">Time</span> <span data-mask="clock">{when(approval.createdAt)}</span>
          </li>
          <li className="x2f-list__row">
            <span className="x2f-list__label">Where</span> Not shown. X2F doesn't log IP addresses, so we can't show where.
          </li>
        </ul>
        <p className="x2f-label" id="approve-numbers">
          If it's you, tap the number shown on the new device
        </p>
        <div className="x2f-segmented" role="group" aria-labelledby="approve-numbers">
          {approval.choices.map((n) => (
            <Button
              key={n}
              variant="secondary"
              className={pick === n ? 'x2f-segmented__on' : ''}
              aria-pressed={pick === n}
              onClick={() => setPick(n)}
              data-part="approve-choice"
            >
              {String(n)}
            </Button>
          ))}
        </div>
        {approval.atLimit ? (
          <p className="x2f-note" data-part="approve-at-limit">
            You're logged in on the most devices allowed. Next you'll choose one to log out.
          </p>
        ) : null}
        {approval.oneDevice ? (
          <p className="x2f-note" data-part="approve-one-device">
            One device at a time is on, so letting them in logs this device out.
          </p>
        ) : null}
        {error !== null ? (
          <p className="x2f-error" role="alert">
            {error}
          </p>
        ) : null}
        <Button variant="primary" disabled={busy || pick === null} onClick={() => void decide({ choice: pick! })} data-part="approve-yes">
          Yes, let them in
        </Button>
        <Button variant="danger" disabled={busy} onClick={() => void decide({ block: true })} data-part="approve-block">
          No, block it
        </Button>
        <p className="x2f-note" data-mask="clock" data-part="approve-countdown">
          If you do nothing, the request ends in {formatRemaining(left, 'clock')} and they stay out.
        </p>
      </div>
    );
  }

  return (
    <Sheet open title="New login" onClose={onDone}>
      {body}
    </Sheet>
  );
}

/**
 * The open approvals for this trader session: loaded once, and again on each live `login-approval`
 * event (`refresh`). Shows the newest one; closing it without an answer leaves it to expire.
 */
export function useLoginApprovals(): { current: ApprovalView | null; refresh: () => void; dismiss: () => void } {
  const [list, setList] = useState<ApprovalView[]>([]);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const refresh = useCallback(() => {
    authApi.listApprovals().then(setList, () => undefined);
  }, []);
  useEffect(() => refresh(), [refresh]);
  const current = list.find((a) => !dismissed.has(a.id)) ?? null;
  const dismiss = useCallback(() => {
    if (current !== null) setDismissed((d) => new Set([...d, current.id]));
  }, [current]);
  return { current, refresh, dismiss };
}
