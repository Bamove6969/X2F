/**
 * Setup step 3, PGP (board SetupPgpChallenge; spec 6.2): decrypt the first login message in the
 * PGP app and paste the code. Verify finishes the sign-up (`POST /v1/register/pgp/finish` with
 * `acceptedTerms`), which opens the new account's session; then the board's "Key verified" state.
 */
import { useEffect, useMemo, useState } from 'react';
import { authApi } from '../auth/authApi.js';
import { groupFingerprint } from './PgpKey.js';
import { serverClock } from '../../api/client.js';
import { refreshSession } from '../../session/useSession.js';
import { Button } from '../../ui/Button.js';
import { Countdown } from '../../ui/Countdown.js';
import { Icon } from '../../ui/icons.js';
import { RegisterError, SetupFrame, SetupIntro, finishMethod, useSetup } from './kit.js';
import { errorCode, registerPgpFinish, registerPgpStart, setupError, termsChanged, type SetupError } from './register.js';
import { MessageBox } from '../../ui/MessageBox.js';

/** Where the API publishes X2F's signing key for import (apps/api/src/auth/pgp.ts SIGNING_KEY_WELL_KNOWN). */
export const SIGNING_KEY_PATH = '/.well-known/x2f-signing-key.asc';

/**
 * X2F's official signing key (R7), which signs every login message (owner demo note, 12 Nov 2026:
 * the decrypted message read "unknown signer"): a download to import once, and its fingerprint to
 * check. Nothing shows when the key cannot be fetched; the message still works.
 */
function SigningKey() {
  const [fp, setFp] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    authApi.getPgpSigningKey().then(
      (k) => live && setFp(k.fingerprint),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  if (fp === null) return null;
  return (
    // COPY-UNSIGNED
    <section className="x2f-start__signing" aria-label="X2F's signing key" data-part="signing-key">
      <p className="x2f-start__signing-title">X2F's signing key</p>
      <p className="x2f-start__help">
        Import it into your PGP app once. Your app then shows each login message as signed by X2F. Check that the fingerprint matches:
      </p>
      <span className="x2f-start__mono">{groupFingerprint(fp)}</span>
      <a className="x2f-start__signing-link" href={SIGNING_KEY_PATH} download="x2f-signing-key.asc">
        Download X2F's signing key
      </a>
    </section>
  );
}

/** Each login code expires 5 minutes after X2F sends it (spec 6.2). */
const CODE_LIFETIME_MS = 5 * 60_000;

export function PgpChallenge() {
  const api = useSetup();
  const { state, update, go, path } = api;
  const challenge = state.challenge!;
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SetupError | null>(null);
  const [copied, setCopied] = useState(false);
  const done = state.registered;
  // The server's clock at the moment the message arrived is its expiry less the code's lifetime, so
  // the countdown follows the server and never the device's own time of day.
  const clock = useMemo(() => serverClock(new Date(Date.parse(challenge.expiresAt) - CODE_LIFETIME_MS)), [challenge]);

  const verify = async () => {
    if (code.trim() === '') {
      setError({ text: 'Paste the code from the decrypted message first.' });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await registerPgpFinish(challenge.challengeId, code.trim(), state.terms!);
      update({ registered: true });
      refreshSession();
    } catch (e) {
      if (termsChanged(e)) {
        update({ terms: null, challenge: null });
        go('');
        return;
      }
      // key-in-use (review I1): the code was right but another account holds the key, so a new
      // message would only end the same way; RegisterError links to the key screen and to Log in.
      if (errorCode(e) === null) setError({ text: 'X2F could not check that code just now. Try again.' });
      else
        setError(
          setupError(e, 'That code did not work. It may have expired: send a new message and try again.', {
            expired: 'That code has expired. Send a new message and try again.',
          }),
        );
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setBusy(true);
    setError(null);
    try {
      update({ challenge: await registerPgpStart({ displayName: state.displayName, loginName: state.loginName }, state.publicKey) });
      setCode('');
      setCopied(false);
    } catch (e) {
      setError(setupError(e, 'Could not send a new message. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const copy = () => {
    void navigator.clipboard?.writeText(challenge.encryptedMessage).then(
      () => setCopied(true),
      () => undefined,
    );
  };

  return (
    <SetupFrame
      screen="setup-pgp-code"
      step={3}
      {...(done ? {} : { back: path('pgp-key') })}
      footer={
        done ? (
          <Button variant="primary" onClick={() => finishMethod(api, 'pgp')} data-part="pgp-continue">
            Continue
          </Button>
        ) : (
          <Button variant="primary" disabled={busy} onClick={() => void verify()} data-part="pgp-verify">
            Verify
          </Button>
        )
      }
    >
      <SetupIntro title="Decrypt your first login code">You'll do the same thing each time you log in.</SetupIntro>
      {done ? (
        <section className="x2f-start__verified" aria-label="Key verified">
          <p className="x2f-start__status" data-tone="escrow">
            <Icon name="check" size={20} stroke={2} />
            Key verified
          </p>
          <p className="x2f-start__help">
            Every login works this way from now on. X2F shows a message locked to your key, your PGP app unlocks it with your private key, and you
            paste in the code.
          </p>
          <p className="x2f-start__help">{/* not-a-refusal: explains the login code */}Each code works once and expires after 5 minutes, so a fake site can't reuse one.</p>
        </section>
      ) : (
        <>
          <ol className="x2f-start__steps">
            <li>Copy the encrypted message below.</li>
            <li>Open your PGP app (Kleopatra, GPG Suite, PGPony or OpenKeychain) and decrypt it.</li>
            <li>Paste the code from inside the message.</li>
          </ol>
          <section className="x2f-start__message" aria-label="Encrypted message">
            <div className="x2f-start__message-bar">
              <span className="x2f-start__expires">
                <Icon name="clock" size={16} />
                Expires in <Countdown deadline={challenge.expiresAt} serverClock={clock} />
              </span>
              <button type="button" className="x2f-start__pill" onClick={copy} data-part="copy">
                {copied ? 'Copied' : 'Copy message'}
              </button>
            </div>
            <MessageBox data-part="pgp-message">
              {challenge.encryptedMessage}
            </MessageBox>
          </section>
          <SigningKey />
          <label className="x2f-field x2f-label" htmlFor="phrase">
            Code from the message
            <input
              className="x2f-input"
              id="phrase"
              type="text"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Paste the code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          <RegisterError error={error} />
          {error !== null && !error.names && !error.keyInUse && !error.keyRefused ? (
            <button type="button" className="x2f-start__textbutton x2f-start__textbutton--tap" disabled={busy} onClick={() => void resend()} data-part="pgp-new-message">
              Send a new message
            </button>
          ) : null}
          <p className="x2f-start__warn">
            The decrypted message also names X2F and today's date and time. If it names a different site or an old time, stop and don't paste
            anything. Someone may be trying to phish you.
          </p>
        </>
      )}
    </SetupFrame>
  );
}
