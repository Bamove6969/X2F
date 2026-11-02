/**
 * Session length (owner, 2 Nov 2026; SessionLength board on wip/design-brief). After every login
 * the person picks how long this session lasts, from a drop-down with nothing pre-selected;
 * Continue waits for a choice. The choices come from the server (`me().session.choices`, by account
 * type: traders 2, 4, 6 or 12 hours, vendors later 2, 6, 12 or 24). `afterLogin` sends a session
 * with no length here with `returnTo`; a session with nothing to choose (staff, backup) or one that
 * has its length goes straight on. The same field is on Devices and sessions.
 *
 * Built with the UI kit's field, select and button styles; the board's v2 look comes later.
 * Words: SESSION_COPY (COPY-UNSIGNED).
 */
import { useEffect, useId, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { returnToFrom } from '../../api/client.js';
import { publishSessionInfo } from '../../session/sessionWatch.js';
import { Button } from '../../ui/Button.js';
import { DEVICES_PATH } from '../settings/devicesCopy.js';
import { authApi } from './authApi.js';
import { SESSION_COPY as C, SESSION_LENGTH_PATH } from './sessionCopy.js';
import '../screens.css';

export { SESSION_LENGTH_PATH };

/**
 * "Stay logged in for" and its drop-down. `value` null shows "Choose a time" selected (it cannot be
 * picked back); `choices` are hours, shortest first.
 */
export function SessionLengthField({
  choices,
  value,
  onChange,
  disabled = false,
}: {
  choices: readonly number[];
  value: number | null;
  onChange: (hours: number) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="x2f-field" data-part="session-length">
      <label className="x2f-label" htmlFor={id}>
        {C.label}
      </label>
      <select
        className="x2f-select"
        id={id}
        value={value === null ? '' : String(value)}
        disabled={disabled}
        onChange={(e) => {
          const h = Number(e.target.value);
          if (choices.includes(h)) onChange(h);
        }}
        data-part="session-length-select"
      >
        <option value="" disabled>
          {C.placeholder}
        </option>
        {choices.map((h) => (
          <option value={String(h)} key={h}>
            {C.option(h)}
          </option>
        ))}
      </select>
      <p className="x2f-fine">{C.sleepHint}</p>
      <p className="x2f-fine">{C.askHint}</p>
    </div>
  );
}

/** `/session-length?returnTo=…`: the question after every login. */
export function SessionLengthScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = returnToFrom(location.search);
  const [me, setMe] = useState<Awaited<ReturnType<typeof authApi.me>> | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    authApi.me().then(
      (m) => {
        if (!live) return;
        // Nothing to choose (staff, owner, backup sessions) or already chosen: go on.
        if (m.session == null || m.session.lengthHours !== null) {
          void navigate(returnTo, { replace: true });
          return;
        }
        setMe(m);
      },
      // The session has gone (401 goes to /login) or the server is away: go on; the server keeps
      // an unchosen session to the shortest time.
      () => {
        if (live) void navigate(returnTo, { replace: true });
      },
    );
    return () => {
      live = false;
    };
  }, [navigate, returnTo]);

  const go = async () => {
    if (pick === null || me === null) return;
    setBusy(true);
    setError(null);
    try {
      const info = await authApi.setSessionLength({ hours: pick });
      publishSessionInfo(info, me.methods);
      void navigate(returnTo, { replace: true });
    } catch {
      setError(C.saveFailed);
      setBusy(false);
    }
  };

  if (me === null || me.session == null) return <main className="x2f-screen" data-screen="session-length" aria-busy="true" />;
  return (
    <main className="x2f-screen" data-screen="session-length">
      <p className="x2f-sheet__body">{C.loggedInAs(me.displayName)}</p>
      <h1 className="x2f-screen__title">{C.question}</h1>
      <SessionLengthField choices={me.session.choices} value={pick} onChange={setPick} disabled={busy} />
      <p className="x2f-fine">
        {C.changeBefore}
        <Link to={DEVICES_PATH}>{C.changeLink}</Link>
        {C.changeAfter}
      </p>
      {error !== null ? (
        <p className="x2f-error" role="alert">
          {error}
        </p>
      ) : null}
      {pick === null ? (
        <p className="x2f-fine" id="session-length-why">
          {C.pickFirst}
        </p>
      ) : null}
      <Button
        variant="primary"
        disabled={pick === null || busy}
        aria-describedby={pick === null ? 'session-length-why' : undefined}
        onClick={() => void go()}
        data-part="session-length-continue"
      >
        {C.continue}
      </Button>
    </main>
  );
}
