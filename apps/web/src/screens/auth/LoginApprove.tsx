/**
 * The logged-in device's side of new-device approval (Plan 2 Task 16): "Someone is logging in on
 * <device>. Is this you?" with three numbers; the right one lets the new device in, a wrong one or
 * "No, block it" blocks it. At the device limit the approval asks which device to log out. Opened
 * by the live `login-approval` event (App.tsx) and on load for any approval still open (a push may
 * have brought the person here).
 *
 * Laid out to the LoginApprove board, side=existing (C2-D1; docs/design-boards/LoginApprove.dc.html
 * and -Wide on wip/design-brief): a sheet with no X close (Escape and the backdrop still close it),
 * a "New login" label over the h2 question, the facts as a <dl>, the numbers as radio tiles, the
 * outlined danger "No, block it", radio cards for the device to log out, and a state icon over the
 * result. At the device limit "Yes" goes straight to the chooser (the board has no refusal popup
 * there; the lead's earlier CantDoThat step is gone). Other refusals (the 24-hour hold) still go
 * through CantDoThat. All look comes from the UI kit. The screen shows only what the server sends:
 * a coarse device label, the choices and the times. X2F has no IP address or place to show.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { AuthApiError, type ApprovalView } from '@x2f/auth-client';
import { Button } from '../../ui/Button.js';
import { CantDoThat } from '../../ui/CantDoThat.js';
import { ChoiceGroup } from '../../ui/Choice.js';
import { CANT_DO_TITLE, TOO_MANY_DEVICES_CODE, type CantDoCode } from '../../ui/cantDoCodes.js';
import { StatusIcon } from '../../ui/icons.js';
import { lastActive, utcWhen } from '../../ui/lastActive.js';
import { Notice } from '../../ui/Notice.js';
import { Sheet } from '../../ui/Sheet.js';
import { forgetLocalSession } from '../../push/usePush.js';
import { refreshSession } from '../../session/useSession.js';
import { DEVICES_PATH } from '../settings/devicesCopy.js';
import { mmss } from './ApproveOnDevice.js';
import { authApi } from './authApi.js';
import { loginCantDo } from './refusals.js';
import '../screens.css';

type Session = NonNullable<AuthApiError['sessions']>[number];

type Stage =
  | { kind: 'ask' }
  | { kind: 'choose'; sessions: Session[]; max: number | null }
  | { kind: 'approved'; out: Session | null }
  | { kind: 'blocked'; wrong: boolean }
  | { kind: 'ended' };

export function LoginApprove({ approval, onDone }: { approval: ApprovalView; onDone: () => void }) {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>({ kind: 'ask' });
  const [pick, setPick] = useState<number | null>(null);
  const [out, setOut] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A rule refusing the answer (the 24-hour hold): CantDoThat (Plan 5 Task 21).
  const [cantDo, setCantDo] = useState<{ code: CantDoCode; text: string } | null>(null);
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

  const choose = useCallback(async (sessions: Session[]) => {
    setStage({ kind: 'choose', sessions, max: null });
    // The chooser's sentence names the limit; without it the sentence is left out.
    const max = await authApi.getDeviceSettings().then((s) => s.maxDevices, () => null);
    setStage((st) => (st.kind === 'choose' ? { ...st, max } : st));
  }, []);

  const decide = async (b: { choice: number; logOut?: string } | { block: true }) => {
    setBusy(true);
    setError(null);
    try {
      const { outcome } = await authApi.decideApproval(approval.id, b);
      if (outcome === 'approved') {
        const logOut = 'logOut' in b ? b.logOut : undefined;
        setStage({ kind: 'approved', out: stage.kind === 'choose' ? (stage.sessions.find((s) => s.id === logOut) ?? null) : null });
      } else setStage({ kind: 'blocked', wrong: !('block' in b) });
    } catch (e) {
      // At the device limit the chooser comes next (LoginApprove board: no refusal popup).
      if (e instanceof AuthApiError && e.code === TOO_MANY_DEVICES_CODE) void choose(e.sessions ?? []);
      else {
        const refused = loginCantDo(e, 'approve');
        if (refused !== null) setCantDo(refused);
        else if (e instanceof AuthApiError && e.code === 'approval-ended') setStage({ kind: 'ended' });
        else setError('Could not send your answer. Try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const label = approval.deviceLabel;
  const errorLine =
    error !== null ? (
      <p className="x2f-error" role="alert">
        {error}
      </p>
    ) : null;
  const blockButton = (
    <Button variant="danger-outline" disabled={busy} onClick={() => void decide({ block: true })} data-part="approve-block">
      No, block it
    </Button>
  );

  let title: string;
  let kicker: string | undefined;
  let lead: ReactNode;
  let body: ReactNode;
  if (stage.kind === 'approved') {
    // This device is logged out when One device at a time is on, or when it chose itself.
    const selfOut = approval.oneDevice || stage.out?.current === true;
    title = `${label} is logged in`;
    lead = <StatusIcon name="check-circle" tone="escrow" />;
    body = (
      <div className="x2f-stack" data-part="approve-done">
        {approval.oneDevice ? (
          <p className="x2f-body">This device is now logged out, because One device at a time is on.</p>
        ) : stage.out?.current === true ? (
          <p className="x2f-body">You chose this device, so it is now logged out.</p>
        ) : stage.out !== null ? (
          <p className="x2f-body">{stage.out.deviceLabel} has been logged out.</p>
        ) : null}
        {selfOut ? (
          <Button
            variant="primary"
            onClick={() => {
              onDone();
              // The server ended this device's session: forget it here before Log in (review N6).
              forgetLocalSession();
              refreshSession();
              void navigate('/login');
            }}
            data-part="approve-ok"
          >
            OK
          </Button>
        ) : (
          <>
            <p className="x2f-fine">
              You can see your devices and log any of them out in{' '}
              <Link className="x2f-link" to={DEVICES_PATH} onClick={onDone}>
                Devices
              </Link>
              .
            </p>
            <Button variant="primary" onClick={onDone} data-part="approve-ok">
              Done
            </Button>
          </>
        )}
      </div>
    );
  } else if (stage.kind === 'blocked') {
    title = stage.wrong ? 'Wrong number, so we blocked it' : 'Login blocked';
    lead = <StatusIcon name="shield-x" tone="danger" />;
    body = (
      <div className="x2f-stack" data-part="approve-blocked">
        <p className="x2f-body">
          {stage.wrong
            ? "The number you tapped didn't match the one on the new device, so that login was blocked to be safe. If it was you, start again on the new device. Nobody else is affected." // not-a-refusal: says what blocking did, the person chose it
            : `${label} was not let in. It can't log in, and nothing else changes: you and your team stay logged in.`}
        </p>
        <section className="x2f-panel" data-tone="caution" aria-labelledby="approve-change-h">
          <h3 className="x2f-h3" id="approve-change-h">
            Change your login method
          </h3>
          {/* not-a-refusal: advice after a block */}
          <p className="x2f-fine">If you didn't try to log in, someone else may have your login details. Change how you log in now so they can't try again.</p>
        </section>
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
    title = 'This request has ended';
    body = (
      <div className="x2f-stack" data-part="approve-ended">
        <p className="x2f-body">Nobody was let in.</p>
        <Button variant="primary" onClick={onDone} data-part="approve-ok">
          OK
        </Button>
      </div>
    );
  } else if (stage.kind === 'choose') {
    title = 'Choose a device to log out';
    kicker = `New login · ${label}`;
    body = (
      <div className="x2f-stack" data-part="approve-choose">
        <p className="x2f-body">
          {stage.max !== null ? `You can be logged in on ${stage.max} devices at once. ` : ''}To let {label} in, one of these has to be logged out.
        </p>
        <ChoiceGroup
          look="card"
          label="Device to log out"
          part="approve-out"
          value={out}
          onChange={setOut}
          options={stage.sessions.map((s) => ({
            value: s.id,
            label: s.deviceLabel,
            note: s.current ? 'This device · active now' : lastActive(s.lastSeenAt),
          }))}
        />
        {errorLine}
        <Button variant="primary" disabled={busy || out === null || pick === null} onClick={() => void decide({ choice: pick!, logOut: out! })} data-part="approve-out-yes">
          Log it out and let them in
        </Button>
        {blockButton}
      </div>
    );
  } else {
    title = `Someone is logging in on ${label}. Is this you?`;
    kicker = 'New login';
    body = (
      <div className="x2f-stack" data-part="approve-ask">
        <dl className="x2f-facts">
          <div>
            <dt>Device</dt>
            <dd data-strong="true">{label}</dd>
          </div>
          <div>
            <dt>Time</dt>
            <dd className="x2f-num" data-mask="clock">
              {utcWhen(approval.createdAt)}
            </dd>
          </div>
          <div>
            <dt>Where</dt>
            {/* not-a-refusal: explains why there is no place */}
            <dd>Not shown. X2F doesn't log IP addresses, so we can't show where.</dd>
          </div>
        </dl>
        <p className="x2f-h3" id="approve-numbers">
          If it's you, tap the number shown on the new device
        </p>
        <ChoiceGroup
          look="tile"
          labelledBy="approve-numbers"
          part="approve-choice"
          value={pick}
          onChange={setPick}
          options={approval.choices.map((n) => ({ value: n, label: String(n) }))}
        />
        {/* With One device at a time on there is no limit to reach: approving logs this device out. */}
        {approval.oneDevice ? (
          <Notice part="approve-one-device">One device at a time is on, so letting them in logs this device out.</Notice>
        ) : approval.atLimit ? (
          <Notice part="approve-at-limit">You're logged in on the most devices allowed. Next you'll choose one to log out.</Notice>
        ) : null}
        {errorLine}
        <Button variant="primary" disabled={busy || pick === null} onClick={() => void decide({ choice: pick! })} data-part="approve-yes">
          Yes, let them in
        </Button>
        {blockButton}
        <p className="x2f-fine" data-mask="clock" data-part="approve-countdown">
          If you do nothing, the request ends in{' '}
          <span className="x2f-num" data-ink="true">
            {mmss(left)}
          </span>{' '}
          and they stay out.
        </p>
      </div>
    );
  }

  return (
    <>
      <Sheet
        open={cantDo === null}
        title={title}
        kicker={kicker}
        lead={lead}
        closeButton={false}
        focusKey={stage.kind}
        wide="dialog"
        onClose={onDone}
      >
        {body}
      </Sheet>
      {cantDo !== null ? <CantDoThat title={CANT_DO_TITLE.approve} body={cantDo.text} from={cantDo.code} onClose={() => setCantDo(null)} /> : null}
    </>
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
