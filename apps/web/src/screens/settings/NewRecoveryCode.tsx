/**
 * Hold model v3 (lead hold v3 review item 3; RecoveryCode board, reminder and show steps; owner
 * G32): after a recovery-code login the used code is replaced, and the new one is shown once to a
 * session allowed to read it (a strong full login, or the recovery session once its 24 hours are
 * over): `me().recoveryCodeToShow`. Show it (`POST /v1/account/recovery-code/reveal` → `{ code }`;
 * the server forgets it in the same step), have it written down, then Done.
 */
import { useEffect, useId, useState } from 'react';
import { AuthApiError } from '@x2f/auth-client';
import { refreshSession } from '../../session/useSession.js';
import { Button } from '../../ui/Button.js';
import { Checkbox } from '../../ui/Checkbox.js';
import { Notice } from '../../ui/Notice.js';
import { authApi } from '../auth/authApi.js';
import { NEW_CODE_COPY as C, codeGroups } from './recoveryCopy.js';

type Step = { kind: 'ask' } | { kind: 'shown'; code: string } | { kind: 'gone' };

export function NewRecoveryCode() {
  const [due, setDue] = useState(false);
  const [step, setStep] = useState<Step>({ kind: 'ask' });
  const [written, setWritten] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  useEffect(() => {
    let live = true;
    authApi.me().then(
      (me) => {
        if (live) setDue(me.recoveryCodeToShow === true);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);

  const reveal = async () => {
    setBusy(true);
    setError(null);
    try {
      const { code } = await authApi.revealRecoveryCode();
      setStep({ kind: 'shown', code });
    } catch (e) {
      if (e instanceof AuthApiError && e.status === 404) {
        setStep({ kind: 'gone' });
        refreshSession();
      } else setError(C.failed);
    } finally {
      setBusy(false);
    }
  };

  const done = () => {
    setDue(false);
    refreshSession();
  };

  if (!due) return null;
  return (
    <section className="x2f-card" data-part="new-recovery-code" aria-labelledby={`${id}-h`}>
      <h2 className="x2f-card__title" id={`${id}-h`}>
        {C.title}
      </h2>
      {step.kind === 'ask' ? (
        <>
          <p className="x2f-sheet__body">{C.why}</p>
          <Notice tone="info" data-part="new-code-emergency">
            <p>{C.emergency}</p>
          </Notice>
          <p className="x2f-note">{C.ready}</p>
          {error !== null ? (
            <p className="x2f-error" role="alert">
              {error}
            </p>
          ) : null}
          <Button variant="secondary" disabled={busy} onClick={() => void reveal()} data-part="new-code-show">
            {C.show}
          </Button>
        </>
      ) : null}
      {step.kind === 'gone' ? (
        <>
          <p className="x2f-note" role="status" data-part="new-code-gone">
            {C.gone}
          </p>
          <Button variant="secondary" onClick={done} data-part="new-code-done">
            {C.done}
          </Button>
        </>
      ) : null}
      {step.kind === 'shown' ? (
        <>
          <p className="x2f-label">{C.codeLabel}</p>
          <ol className="x2f-codes" data-part="new-code" aria-label={`${C.codeLabel} ${codeGroups(step.code).join(' ')}`}>
            {codeGroups(step.code).map((g, i) => (
              <li className="x2f-codes__item" key={i}>
                {g}
              </li>
            ))}
          </ol>
          <Notice tone="caution" live="status" data-part="new-code-save">
            <p>{C.save}</p>
          </Notice>
          <div className="x2f-row">
            <Checkbox checked={written} onChange={setWritten} aria-labelledby={`${id}-written`} data-part="new-code-written" />
            <span id={`${id}-written`}>{C.written}</span>
          </div>
          <Button variant="secondary" disabled={!written} onClick={done} data-part="new-code-done">
            {C.done}
          </Button>
        </>
      ) : null}
    </section>
  );
}
