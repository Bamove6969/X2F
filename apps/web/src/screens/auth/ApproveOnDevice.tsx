/**
 * The new device's side of new-device approval (Plan 2 Task 16): the login waits until a device
 * that is already logged in taps the same 2-digit number. It polls `POST /v1/login/approval/:id/poll`
 * every 2 seconds (only this browser, with its approval cookie, can); `ok` means the session has
 * started.
 *
 * Laid out to the LoginApprove board, side=new (C2-D1; docs/design-boards/LoginApprove.dc.html and
 * -Wide on wip/design-brief): a full screen with the back control and "Log in", the number in a
 * card, the countdown, "Where do I approve it?", the no-other-device card, and the actions in the
 * footer. All look comes from the UI kit (ui/FlowScreen, ui/Disclosure, ui.css). The board's
 * new-device side is marked Draft copy: its new sentences here are COPY-UNSIGNED. Not built (new
 * behaviour, see the C2-D1 report): the room note about the account's devices (review M5 keeps
 * the account's devices off this screen), and the passkey / security key / PGP way in without an
 * approval; the card keeps the existing link to the backup login.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { ApprovalPoll, ApprovalWait } from '@x2f/auth-client';
import { Button } from '../../ui/Button.js';
import { formatRemaining } from '../../ui/Countdown.js';
import { Disclosure } from '../../ui/Disclosure.js';
import { FlowScreen } from '../../ui/FlowScreen.js';
import { Icon, StatusIcon } from '../../ui/icons.js';
import { authApi } from './authApi.js';
import '../screens.css';

export const POLL_MS = 2000;

type Stage = 'waiting' | 'in' | 'blocked' | 'expired';

/** The board's countdown form: "04:59" (mm:ss, mono). */
export function mmss(ms: number): string {
  return formatRemaining(ms, 'clock').padStart(5, '0');
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
  // While waiting the back control cancels the wait, as Cancel does; after it, it starts again.
  const back = { label: 'Back to log in', onClick: stage === 'waiting' ? cancel : onRestart };

  if (stage === 'in') {
    return (
      <FlowScreen
        screen="login"
        title="Log in"
        back={back}
        footer={
          <Button variant="primary" onClick={onLoggedIn} data-part="approve-continue">
            Continue
          </Button>
        }
      >
        <section className="x2f-stack" data-part="approve-in" aria-labelledby="approve-in-h">
          <StatusIcon name="check-circle" tone="escrow" />
          <h2 className="x2f-h2" id="approve-in-h">
            You're in
          </h2>
          <p className="x2f-text">Your other device approved this login.</p>
          {loggedOut.length > 0 ? (
            <p className="x2f-muted" data-part="approve-logged-out">
              Logged out to make room: {loggedOut.join(', ')}.
            </p>
          ) : null}
        </section>
      </FlowScreen>
    );
  }

  if (stage === 'blocked' || stage === 'expired') {
    const blocked = stage === 'blocked';
    return (
      <FlowScreen
        screen="login"
        title="Log in"
        back={back}
        footer={
          <>
            <Button variant="primary" onClick={onRestart} data-part="approve-retry">
              Try again
            </Button>
            <Link className="x2f-button x2f-button--quiet" to={backup} data-part="approve-backup">
              Log in with a backup
            </Link>
          </>
        }
      >
        <section className="x2f-stack" data-part={`approve-${stage}`} aria-labelledby="approve-end-h">
          {blocked ? <StatusIcon name="shield-x" tone="danger" /> : null}
          <h2 className="x2f-h2" id="approve-end-h">
            {blocked ? 'This login was blocked' : 'This request has ended'}
          </h2>
          <p className="x2f-text">{blocked ? 'Your other device said no, or a different number was tapped.' : 'Nobody approved it in time.'}</p>
          {blocked ? (
            // COPY-UNSIGNED (LoginApprove board, side=new, Draft copy).
            <p className="x2f-text">This device can't log in until it's approved. Nobody else on your account is affected.</p>
          ) : null}
          <p className="x2f-muted">If it was you, try again. You'll get a new number.</p>
        </section>
      </FlowScreen>
    );
  }

  return (
    <FlowScreen
      screen="login"
      title="Log in"
      back={back}
      footer={
        <Button variant="secondary" onClick={cancel} data-part="approve-cancel">
          Cancel
        </Button>
      }
    >
      <h2 className="x2f-h2" data-part="approve-wait">
        Approve this login on a device you're already using
      </h2>
      <div className="x2f-number-card">
        <span className="x2f-kicker" id="approve-your-number">
          Your number
        </span>
        <span className="x2f-big-number" data-part="approve-number" aria-labelledby="approve-your-number">
          {wait.number}
        </span>
        <span className="x2f-muted">
          On your other device, tap {wait.number}, then Yes, let them in.
        </span>
      </div>
      <p className="x2f-icon-line" data-part="approve-countdown" data-mask="clock">
        <Icon name="clock" size={20} />
        <span>
          Waiting for approval. This ends in <span className="x2f-mono">{mmss(left)}</span>.
        </span>
      </p>
      <Disclosure summary="Where do I approve it?" part="approve-where">
        {(id) => (
          <ol id={id} data-part="approve-steps">
            <li>Open X2F on a phone or computer where you're already logged in.</li>
            <li>A login request pops up. Check it names this device.</li>
            <li>Tap {wait.number}, then Yes, let them in.</li>
          </ol>
        )}
      </Disclosure>
      <section className="x2f-panel" data-part="approve-no-device" aria-labelledby="approve-no-device-h">
        {/* COPY-UNSIGNED (LoginApprove board, side=new, Draft copy): the card's heading. */}
        <h3 className="x2f-h3" id="approve-no-device-h">
          No other device with you?
        </h3>
        <Link className="x2f-button x2f-button--secondary" to={backup} data-part="approve-backup">
          Log in with a backup instead.
        </Link>
      </section>
    </FlowScreen>
  );
}
