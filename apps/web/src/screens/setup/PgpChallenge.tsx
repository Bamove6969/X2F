/**
 * Setup step 3, PGP (board SetupPgpChallenge; spec 6.2): decrypt the first login message in the
 * PGP app and paste the code. Verify finishes the sign-up (`POST /v1/register/pgp/finish` with
 * `acceptedTerms`), which opens the new account's session; then the board's "Key verified" state.
 */
import { useMemo, useState } from 'react';
import { serverClock } from '../../api/client.js';
import { refreshSession } from '../../session/useSession.js';
import { Button } from '../../ui/Button.js';
import { Countdown } from '../../ui/Countdown.js';
import { Icon } from '../../ui/icons.js';
import { RegisterError, SetupFrame, SetupIntro, useSetup } from './kit.js';
import { errorCode, nameError, registerPgpFinish, registerPgpStart, termsChanged } from './register.js';

/** Each login code expires 5 minutes after X2F sends it (spec 6.2). */
const CODE_LIFETIME_MS = 5 * 60_000;

export function PgpChallenge() {
  const { state, update, go, path } = useSetup();
  const challenge = state.challenge!;
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; names: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const done = state.registered;
  // The server's clock at the moment the message arrived is its expiry less the code's lifetime, so
  // the countdown follows the server and never the device's own time of day.
  const clock = useMemo(() => serverClock(new Date(Date.parse(challenge.expiresAt) - CODE_LIFETIME_MS)), [challenge]);

  const verify = async () => {
    if (code.trim() === '') {
      setError({ text: 'Paste the code from the decrypted message first.', names: false });
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
      const names = nameError(e);
      if (names !== null) setError({ text: names, names: true });
      else if (errorCode(e) === null) setError({ text: 'X2F could not check that code just now. Try again.', names: false });
      else setError({ text: 'That code did not work. It may have expired: send a new message and try again.', names: false });
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
      const names = nameError(e);
      setError(names !== null ? { text: names, names: true } : { text: 'Could not send a new message. Try again.', names: false });
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
          <Button variant="primary" onClick={() => go('backup')} data-part="pgp-continue">
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
        <section className="x2f-setup__verified" aria-label="Key verified">
          <p className="x2f-setup__status" data-tone="escrow">
            <Icon name="check" size={20} stroke={2} />
            Key verified
          </p>
          <p className="x2f-setup__help">
            Every login works this way from now on. X2F shows a message locked to your key, your PGP app unlocks it with your private key, and you
            paste in the code.
          </p>
          <p className="x2f-setup__help">Each code works once and expires after 5 minutes, so a fake site can't reuse one.</p>
        </section>
      ) : (
        <>
          <ol className="x2f-setup__steps">
            <li>Copy the encrypted message below.</li>
            <li>Open your PGP app (Kleopatra, GPG Suite or OpenKeychain) and decrypt it.</li>
            <li>Paste the code from inside the message.</li>
          </ol>
          <section className="x2f-setup__message" aria-label="Encrypted message">
            <div className="x2f-setup__message-bar">
              <span className="x2f-setup__expires">
                <Icon name="clock" size={16} />
                Expires in <Countdown deadline={challenge.expiresAt} serverClock={clock} />
              </span>
              <button type="button" className="x2f-setup__pill" onClick={copy} data-part="copy">
                {copied ? 'Copied' : 'Copy message'}
              </button>
            </div>
            <pre className="x2f-pre" data-part="pgp-message">
              {challenge.encryptedMessage}
            </pre>
          </section>
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
          {error !== null && !error.names ? (
            <button type="button" className="x2f-setup__textbutton" disabled={busy} onClick={() => void resend()} data-part="pgp-new-message">
              Send a new message
            </button>
          ) : null}
          <p className="x2f-setup__warn">
            The decrypted message also names X2F and today's date and time. If it names a different site or an old time, stop and don't paste
            anything. Someone may be trying to phish you.
          </p>
        </>
      )}
    </SetupFrame>
  );
}
