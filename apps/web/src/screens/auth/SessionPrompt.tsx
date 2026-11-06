/**
 * "Stay logged in?" (owner, 2 Nov 2026; SessionExtend board on wip/design-brief). Mounted once by
 * the app shell; it watches the signed-in session (`useSessionWatch`). SESSION_PROMPT_MS before the
 * session's end (2 minutes, owner-confirmed 2 Nov) it asks the person to confirm it's them
 * with any login method the account has (passkey, security key, PGP key, or the password with its
 * authenticator code when there is one). The proof is a confirm token for `extend-session`, checked
 * on the server, which then extends the session by its length; with no answer by the end the person
 * is logged out. A team member's session cannot extend (an open owner question): it is logged out
 * at its end with no prompt.
 *
 * The prompt opens before the end, not at it, so the session never runs past its chosen length
 * without a login method. Times come from the server clock (`serverClock`), checked every second so
 * a sleeping tab catches up when it wakes.
 *
 * Built with the UI kit's Sheet and the confirm-it's-you method list (`ConfirmMethods`); the
 * board's v2 look comes later. Words: SESSION_COPY (COPY-UNSIGNED).
 */
import { useEffect, useMemo, useState } from 'react';
import { SESSION_PROMPT_MS, UNCHOSEN_SESSION_HOURS } from '@x2f/auth-client';
import { goLogin, serverClock } from '../../api/client.js';
import { publishSessionInfo, publishSessionWatch, useSessionWatch } from '../../session/sessionWatch.js';
import { Button } from '../../ui/Button.js';
import { Countdown } from '../../ui/Countdown.js';
import { Sheet } from '../../ui/Sheet.js';
import { browserPushEnv, logOut } from '../../push/usePush.js';
import { ConfirmMethods } from './ConfirmSheet.js';
import { authApi } from './authApi.js';
import { SESSION_COPY as C } from './sessionCopy.js';

type Phase = 'wait' | 'ask' | 'extended' | 'out';

// COPY-UNSIGNED (SessionExtend board); kept beside its logOut(env) call (logout tripwire).
const LOG_OUT = 'Log out';

export function SessionPrompt() {
  const watch = useSessionWatch();
  const [phase, setPhase] = useState<Phase>('wait');
  const [error, setError] = useState<string | null>(null);
  const info = watch?.info ?? null;
  const clock = useMemo(() => (info === null ? null : serverClock(info.serverNow)), [info]);
  const end = info === null ? Number.NaN : Date.parse(info.expiresAt);

  useEffect(() => {
    if (clock === null || !Number.isFinite(end) || info === null) return;
    // A session watched again after a logout is a new login: the old "You're logged out" goes.
    setPhase((p) => (p === 'out' ? 'wait' : p));
    let gone = false;
    const timeUp = () => {
      if (gone) return;
      gone = true;
      setPhase('out');
      publishSessionWatch(null);
      // Every UI log-out goes through logOut(env) (L2 tripwire): push off, local session forgotten.
      void logOut(browserPushEnv()).catch(() => undefined);
    };
    const tick = () => {
      const now = clock().getTime();
      if (now >= end) timeUp();
      else if (info.canExtend && now >= end - SESSION_PROMPT_MS) setPhase((p) => (p === 'wait' || p === 'extended' ? 'ask' : p));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [clock, end, info]);

  if (phase === 'out') {
    return (
      <Sheet open title={C.outTitle} closeButton={false} wide="dialog" onClose={() => goLogin()}>
        <div className="x2f-stack" data-part="session-out">
          <p className="x2f-body">{C.outBody}</p>
          <Button variant="primary" onClick={() => goLogin()} data-part="session-log-in">
            {C.logIn}
          </Button>
        </div>
      </Sheet>
    );
  }
  if (watch === null || info === null || clock === null) return null;
  const hours = info.lengthHours ?? UNCHOSEN_SESSION_HOURS;

  if (phase === 'extended') {
    return (
      <Sheet open title={C.stayLoggedIn} wide="dialog" onClose={() => setPhase('wait')}>
        <p className="x2f-body" role="status" data-part="session-extended">
          {C.extended(hours)}
        </p>
      </Sheet>
    );
  }
  if (phase !== 'ask') return null;

  const onToken = async (confirmToken: string) => {
    setError(null);
    try {
      publishSessionInfo(await authApi.extendSession({ confirmToken }));
      setPhase('extended');
    } catch {
      setError(C.extendFailed);
    }
  };

  return (
    // Escape and the backdrop do not answer the question: only a login method or "Log out" does.
    <Sheet open title={C.extendTitle} closeButton={false} wide="dialog" onClose={() => undefined}>
      <div className="x2f-stack" data-part="session-extend">
        <p className="x2f-body">{C.extendBody(hours)}</p>
        <p className="x2f-fine" data-part="session-countdown">
          {C.loggingOutIn}
          <Countdown deadline={info.expiresAt} serverClock={clock} />
        </p>
        {error !== null ? (
          <p className="x2f-error" role="alert">
            {error}
          </p>
        ) : null}
        <ConfirmMethods action={{ kind: 'extend-session' }} methods={watch.methods} onToken={onToken} submitLabel={C.stayLoggedIn} />
        <Button
          variant="quiet"
          onClick={() => {
            setPhase('out');
            publishSessionWatch(null);
            void logOut(browserPushEnv()).catch(() => undefined);
          }}
          data-part="session-log-out"
        >
          {LOG_OUT}
        </Button>
      </div>
    </Sheet>
  );
}
