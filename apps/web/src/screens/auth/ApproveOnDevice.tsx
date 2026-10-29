/**
 * The new device's side of new-device approval (Plan 2 Task 16, LoginApprove board, new-device
 * view): the login waits until a device that is already logged in taps the same 2-digit number.
 * It polls `POST /v1/login/approval/:id/poll` every 2 seconds (only this browser, with its approval
 * cookie, can); `ok` means the session has started.
 *
 * Built from existing UI-kit classes and components only, with no styling of its own: the
 * LoginApprove board is still in progress (test/devices-tripwire.test.ts NEEDS_DESIGN_DEVICES).
 * The words are the board's.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { ApprovalPoll, ApprovalWait } from '@x2f/auth-client';
import { Button } from '../../ui/Button.js';
import { formatRemaining } from '../../ui/Countdown.js';
import { authApi } from './authApi.js';
import '../screens.css';

export const POLL_MS = 2000;

type Stage = 'waiting' | 'in' | 'blocked' | 'expired';

/** The note under the number: room for this device, the limit, or "One device at a time". */
export function roomNote(d: ApprovalWait['devices']): string {
  if (d.oneDevice) return 'One device at a time is on. When you approve, your other device will be logged out.';
  if (d.loggedIn >= d.max) {
    return `You're already logged in on ${d.max} devices, the most allowed. To let this one in, one of them will need to be logged out. You'll choose which when you approve.`;
  }
  return `You can be logged in on up to ${d.max} devices at once. You're on ${d.loggedIn} now, so there's room for this one.`;
}

export function ApproveOnDevice({
  wait,
  returnTo,
  onLoggedIn,
  onRestart,
  pollMs = POLL_MS,
}: {
  wait: ApprovalWait;
  returnTo: string;
  onLoggedIn: () => void;
  onRestart: () => void;
  pollMs?: number;
}) {
  const [stage, setStage] = useState<Stage>('waiting');
  const [loggedOut, setLoggedOut] = useState<string[]>([]);
  const [left, setLeft] = useState(() => new Date(wait.expiresAt).getTime() - Date.now());
  const [steps, setSteps] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    if (stage !== 'waiting') return;
    let live = true;
    const tick = async () => {
      setLeft(new Date(wait.expiresAt).getTime() - Date.now());
      if (busy.current) return;
      busy.current = true;
      try {
        const r: ApprovalPoll = await authApi.pollLoginApproval(wait.approvalId);
        if (!live) return;
        if (r.status === 'ok') {
          setLoggedOut(r.loggedOut);
          setStage('in');
        } else if (r.status === 'blocked' || r.status === 'expired') {
          setStage(r.status);
        }
      } catch {
        // A network blip or a 404 (the cookie is gone): keep waiting until the deadline says otherwise.
        if (live && new Date(wait.expiresAt).getTime() <= Date.now()) setStage('expired');
      } finally {
        busy.current = false;
      }
    };
    void tick();
    const t = setInterval(() => void tick(), pollMs);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [stage, wait.approvalId, wait.expiresAt, pollMs]);

  const cancel = () => {
    void authApi.cancelLoginApproval(wait.approvalId).catch(() => undefined);
    onRestart();
  };

  const backup = `/login/backup?returnTo=${encodeURIComponent(returnTo)}`;

  if (stage === 'in') {
    return (
      <section className="x2f-card" data-part="approve-in" aria-labelledby="approve-in-h">
        <h2 className="x2f-card__title" id="approve-in-h">
          You're in
        </h2>
        <p className="x2f-sheet__body">Your other device approved this login.</p>
        {loggedOut.length > 0 ? (
          <p className="x2f-note" data-part="approve-logged-out">
            {wait.devices.oneDevice
              ? 'Your other device has been logged out, because One device at a time is on.'
              : `The device you chose has been logged out, so you're still on ${wait.devices.max} of ${wait.devices.max}.`}
          </p>
        ) : null}
        <Button variant="primary" onClick={onLoggedIn} data-part="approve-continue">
          Continue
        </Button>
      </section>
    );
  }

  if (stage === 'blocked' || stage === 'expired') {
    return (
      <section className="x2f-card" data-part={`approve-${stage}`} aria-labelledby="approve-end-h">
        <h2 className="x2f-card__title" id="approve-end-h">
          {stage === 'blocked' ? 'This login was blocked' : 'This request has ended'}
        </h2>
        <p className="x2f-sheet__body">
          {stage === 'blocked' ? 'Your other device said no, or a different number was tapped.' : 'Nobody approved it in time.'}
        </p>
        <p className="x2f-note">If it was you, try again. You'll get a new number.</p>
        <Button variant="primary" onClick={onRestart} data-part="approve-retry">
          Try again
        </Button>
        <Link className="x2f-link" to={backup} data-part="approve-backup">
          Log in with a backup
        </Link>
      </section>
    );
  }

  return (
    <section className="x2f-card" data-part="approve-wait" aria-labelledby="approve-wait-h">
      <h2 className="x2f-card__title" id="approve-wait-h">
        Approve this login on a device you're already using
      </h2>
      <p className="x2f-label">Your number</p>
      <p className="x2f-screen__title" data-part="approve-number" aria-live="polite">
        {wait.number}
      </p>
      <p className="x2f-sheet__body">
        On your other device, tap {wait.number}, then Yes, let them in.
      </p>
      <p className="x2f-note" data-part="approve-countdown" data-mask="clock">
        Waiting for approval. This ends in {formatRemaining(left, 'clock')}.
      </p>
      <Button variant="quiet" onClick={() => setSteps((s) => !s)} aria-expanded={steps} data-part="approve-where">
        Where do I approve it?
      </Button>
      {steps ? (
        <ol className="x2f-list" data-part="approve-steps">
          <li className="x2f-list__row">Open X2F on a phone or computer where you're already logged in.</li>
          <li className="x2f-list__row">A login request pops up. Check it names this device.</li>
          <li className="x2f-list__row">Tap {wait.number}, then Yes, let them in.</li>
        </ol>
      ) : null}
      <p className="x2f-note" data-part="approve-room">
        {roomNote(wait.devices)}
      </p>
      <p className="x2f-label">I don't have my other device</p>
      <p className="x2f-note">
        <Link className="x2f-link" to={backup} data-part="approve-backup">
          Log in with a backup instead.
        </Link>
      </p>
      <Button variant="secondary" onClick={cancel} data-part="approve-cancel">
        Cancel
      </Button>
    </section>
  );
}
