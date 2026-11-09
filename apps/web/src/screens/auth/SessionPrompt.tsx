/**
 * "Stay logged in?" (owner, 2 Nov 2026; SessionExtend board on wip/design-brief). Mounted once by
 * the app shell; it watches the signed-in session (`useSessionWatch`). SESSION_PROMPT_MS before the
 * session's end (5 minutes, owner Q73, 6 Nov 2026) it asks the person to confirm it's them with one
 * of their own login methods (passkey, security key, PGP key, or the password with its
 * authenticator code when there is one; a team member's own methods, which `me` sends) and to pick
 * how long, from the same choices as at login (the session's own length picked). The proof is a
 * confirm token for `extend-session`, checked on the server, which then makes the picked time the
 * length, from now; with no answer by the end the person is logged out. A session the server says
 * cannot extend (`canExtend` false; none today) is logged out at its end with no prompt.
 *
 * Several tabs watch one session (review 2): an extend here is sent to the others
 * (`shareSessionInfo`), a later end from another tab closes this prompt, and at the end this tab
 * first re-reads `me` (a quiet read: a 401 does not leave the page) and, when the end has moved,
 * watches the new one instead of logging out.
 *
 * The prompt opens before the end, not at it, so the session never runs past its chosen length
 * without a login method. Times come from the server clock (`serverClock`), checked every second so
 * a sleeping tab catches up when it wakes.
 *
 * Built with the UI kit's Sheet and the confirm-it's-you method list (`ConfirmMethods`); the
 * board's v2 look comes later. Words: SESSION_COPY (COPY-UNSIGNED).
 */
import { useEffect, useMemo, useState } from 'react';
import { SESSION_PROMPT_MS, UNCHOSEN_SESSION_HOURS, createAuthApi } from '@x2f/auth-client';
import { goLogin, serverClock } from '../../api/client.js';
import { publishIdleReminder } from '../../session/idleReminderWatch.js';
import { listenAcrossTabs, publishSessionWatch, shareSessionInfo, useSessionWatch, type SessionWatch } from '../../session/sessionWatch.js';
import { Button } from '../../ui/Button.js';
import { Countdown } from '../../ui/Countdown.js';
import { Sheet } from '../../ui/Sheet.js';
import { browserPushEnv, logOut } from '../../push/usePush.js';
import { ConfirmMethods } from './ConfirmSheet.js';
import { SessionLengthField } from './SessionLength.js';
import { authApi } from './authApi.js';
import { SESSION_COPY as C } from './sessionCopy.js';

type Phase = 'wait' | 'ask' | 'extended' | 'out';

// COPY-UNSIGNED (SessionExtend board); kept beside its logOut(env) call (logout tripwire).
const LOG_OUT = 'Log out';

/**
 * Reads `me` without the app's 401 handling (`authApi` sends a gone session to /login): at the
 * session's end a 401 is the expected answer, and the prompt then shows "You're logged out".
 */
const quietApi = createAuthApi({ fetch: (input, init) => globalThis.fetch(input, init) });

/** The session's end as the server has it now (another tab may have extended it), or null. */
async function endOnServer(): Promise<SessionWatch | null> {
  try {
    const me = await quietApi.me();
    return me.session == null ? null : { info: me.session, methods: me.methods };
  } catch {
    return null;
  }
}

export function SessionPrompt() {
  const watch = useSessionWatch();
  const [phase, setPhase] = useState<Phase>('wait');
  const [error, setError] = useState<string | null>(null);
  const info = watch?.info ?? null;
  const clock = useMemo(() => (info === null ? null : serverClock(info.serverNow)), [info]);
  const end = info === null ? Number.NaN : Date.parse(info.expiresAt);
  const own = info === null ? UNCHOSEN_SESSION_HOURS : (info.lengthHours ?? UNCHOSEN_SESSION_HOURS);
  // How long to stay logged in: the session's own length until the person picks another choice.
  const [pick, setPick] = useState<number>(own);
  useEffect(() => setPick(own), [own]);
  // Review 2: the other tabs' extends and length changes.
  useEffect(() => listenAcrossTabs(), []);

  useEffect(() => {
    if (clock === null || !Number.isFinite(end) || info === null) return;
    // A session watched again after a logout is a new login: the old "You're logged out" goes.
    setPhase((p) => (p === 'out' ? 'wait' : p));
    let gone = false;
    const timeUp = async () => {
      if (gone) return;
      gone = true;
      // Review 2: another tab may have extended the session; then watch its new end instead.
      const fresh = await endOnServer();
      if (fresh !== null && Date.parse(fresh.info.expiresAt) > end) {
        setPhase('wait');
        publishSessionWatch(fresh);
        return;
      }
      setPhase('out');
      publishSessionWatch(null);
      publishIdleReminder(null);
      // Every UI log-out goes through logOut(env) (L2 tripwire): push off, local session forgotten.
      void logOut(browserPushEnv()).catch(() => undefined);
    };
    const tick = () => {
      const now = clock().getTime();
      if (now >= end) void timeUp();
      else if (info.canExtend && now >= end - SESSION_PROMPT_MS) setPhase((p) => (p === 'wait' || p === 'extended' ? 'ask' : p));
      // A later end (an extend in another tab) closes the question.
      else setPhase((p) => (p === 'ask' ? 'wait' : p));
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
      shareSessionInfo(await authApi.extendSession({ confirmToken, hours: pick }));
      setPhase('extended');
    } catch {
      setError(C.extendFailed);
    }
  };

  return (
    // Escape and the backdrop do not answer the question: only a login method or "Log out" does.
    <Sheet open title={C.extendTitle} closeButton={false} wide="dialog" onClose={() => undefined}>
      <div className="x2f-stack" data-part="session-extend">
        <p className="x2f-body">{C.extendBody}</p>
        <SessionLengthField choices={info.choices} value={pick} onChange={setPick} hints={false} />
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
            publishIdleReminder(null);
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
