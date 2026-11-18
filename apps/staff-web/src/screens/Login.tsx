import { startAuthentication } from '@simplewebauthn/browser';
import { useId, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { loginOptions } from '../challenges.js';
import { codeOf, keyLoginFinish, keyLoginStart, pgpLoginFinish, pgpLoginStart, type LoginResult, type StaffMethod } from '../api.js';
import { faultText, refusalOf, type StaffRefusal } from '../refusals.js';
import { Button, CantDoThat, ChoiceGroup, Icon, Notice } from '../ui/kit.js';
import { PgpProof } from '../ui/PgpProof.js';
import type { LoginState } from '../ui/StaffShell.js';
import '../ui/staff.css';

/** Login's words when the shell ended the session at the end of the login window. */
export const HOURS_ENDED = 'Your login hours have ended.';

type Way = 'security-key' | 'pgp';

/**
 * Staff login (Plan 4 Task 16; the API is Task 4's). Staff and the owner always log in with two
 * factors (R1): a security key (by login name) or a PGP key first, then what the API's `needs`
 * names, bound to its `pendingId`. Staff accounts log in only here, on the staff site (owner Q19);
 * a new device is approved as on the trader site (Plan 2), not here.
 *
 * Refusals (switched off, outside login hours, a key the staff site does not take) are the kit's
 * CantDoThat; faults a danger Notice. No board (DESIGNER-REVIEW); every sentence COPY-UNSIGNED.
 */
export function Login() {
  const navigate = useNavigate();
  const state = (useLocation().state ?? null) as LoginState;
  const nameId = useId();
  const [ended, setEnded] = useState(state?.ended === 'hours');
  const [way, setWay] = useState<Way>('security-key');
  const [loginName, setLoginName] = useState('');
  const [second, setSecond] = useState<{ pendingId: string; needs: StaffMethod[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ code: StaffRefusal; text: string } | null>(null);

  const after = (r: LoginResult) => {
    if (r.status === 'ok') {
      void navigate('/', { replace: true });
      return;
    }
    setSecond({ pendingId: r.pendingId, needs: r.needs });
    // After a PGP key the usual second is a key; after a key it can only be PGP.
    setWay(r.needs.some((n) => n !== 'pgp') ? 'security-key' : 'pgp');
  };

  const fail = (e: unknown) => {
    const r = refusalOf(e);
    if (r !== null) {
      setRefusal(r);
      return;
    }
    if (codeOf(e) === null && e instanceof Error && e.name !== 'TypeError') {
      setFault('The key tap did not finish. Try again.');
      return;
    }
    setFault(faultText(e, 'That did not work. Check your login name and key, then try again.'));
  };

  const tapKey = async () => {
    if (second === null && loginName.trim() === '') {
      setFault('Type your login name first.');
      return;
    }
    setBusy(true);
    setFault(null);
    setEnded(false);
    try {
      const start = await keyLoginStart(second === null ? { loginName: loginName.trim() } : { pendingId: second.pendingId });
      // Re-verify X2: the key signs staffLoginChallenge(loginNonce), never the server's challenge.
      const response = await startAuthentication({ optionsJSON: loginOptions(start.options, start.loginNonce) });
      after(await keyLoginFinish({ challengeId: start.challengeId, response, ...(second !== null ? { pendingId: second.pendingId } : {}) }));
    } catch (e) {
      // A pending login that expired (5 minutes) starts again from the first key.
      if (codeOf(e) === 'challenge-expired') setSecond(null);
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const ways: Way[] = second === null ? ['security-key', 'pgp'] : (['security-key', 'pgp'] as const).filter((w) => (w === 'pgp' ? second.needs.includes('pgp') : second.needs.some((n) => n !== 'pgp')));
  const keyWord = second !== null && second.needs.includes('passkey') ? 'Security key or passkey' : 'Security key';

  return (
    <main className="x2f-staff-solo" data-screen="login">
      <p className="x2f-staff-eyebrow">
        <Icon name="shield" size={16} />
        X2F Staff
      </p>
      <h1 className="x2f-staff-solo__title">{second === null ? 'Log in' : 'Now your second key'}</h1>
      {ended ? (
        <Notice tone="caution" data-part="hours-ended">
          {HOURS_ENDED}
        </Notice>
      ) : null}
      <p className="x2f-staff-step__text">
        {second === null
          ? 'Staff log in with two keys: a security key or your PGP key first, then the other.'
          : 'That key is checked. Use your other key to finish logging in.'}
      </p>
      {ways.length > 1 ? (
        <ChoiceGroup
          look="card"
          label="How do you want to log in?"
          options={ways.map((w) => ({ value: w, label: w === 'pgp' ? 'PGP key' : keyWord }))}
          value={way}
          onChange={(w) => {
            setWay(w);
            setFault(null);
          }}
        />
      ) : null}
      {way === 'security-key' ? (
        <div className="x2f-stack">
          {second === null ? (
            <div className="x2f-field">
              <label className="x2f-label" htmlFor={nameId}>
                Login name
              </label>
              <input id={nameId} className="x2f-input" autoComplete="username" spellCheck={false} value={loginName} onChange={(e) => setLoginName(e.target.value)} />
            </div>
          ) : null}
          <Button variant="primary" disabled={busy} onClick={() => void tapKey()}>
            Tap security key
          </Button>
        </div>
      ) : (
        <PgpProof
          key={second?.pendingId ?? 'first'}
          primary
          submitLabel="Log in"
          start={(key) => pgpLoginStart(second === null ? { key } : { key, pendingId: second.pendingId })}
          finish={async (challengeId, code) => {
            try {
              after(await pgpLoginFinish({ challengeId, code }));
            } catch (e) {
              if (refusalOf(e) !== null) {
                fail(e);
                return;
              }
              throw e;
            }
          }}
          onProved={() => undefined}
        />
      )}
      {fault !== null ? (
        <Notice tone="danger" data-part="login-fault">
          {fault}
        </Notice>
      ) : null}
      {second !== null ? (
        <Button
          variant="quiet"
          onClick={() => {
            setSecond(null);
            setFault(null);
          }}
        >
          Start again
        </Button>
      ) : null}
      {refusal !== null ? <CantDoThat title="You can't log in here yet" body={refusal.text} from={refusal.code} onClose={() => setRefusal(null)} /> : null}
    </main>
  );
}
