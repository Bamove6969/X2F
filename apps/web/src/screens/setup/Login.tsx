/**
 * Setup step 2 (board SetupLogin; spec 6.2): how to log in, PGP first and picked by default. PGP
 * goes on to the key and code, a password to its own screen; a passkey or a security key is
 * registered right here with the browser's own prompt, then setup goes on to the backup.
 */
import { useState } from 'react';
import { refreshSession } from '../../session/useSession.js';
import { Button } from '../../ui/Button.js';
import { RegisterError, SetupFrame, SetupIntro, useSetup, type LoginMethod } from './kit.js';
import { errorCode, nameError, registerWebAuthn, termsChanged } from './register.js';

interface MethodDef {
  id: LoginMethod;
  name: string;
  cta: string;
  desc: string;
  rec?: boolean;
  later?: string;
}

/** The board's four methods, in its order and words. */
export const METHODS: MethodDef[] = [
  {
    id: 'pgp',
    name: 'PGP key',
    rec: true,
    cta: 'Continue with PGP key',
    desc: 'Log in with a PGP key instead of a password. X2F stores only your public key, so there is no password for anyone to steal from us.',
    later:
      'Each time you log in, X2F shows a message locked with your public key. Only your private key can unlock it, so you decrypt it in your PGP app and paste in the login code inside. Without your private key, nobody can get that code, and each one works only once.',
  },
  {
    id: 'passkey',
    name: 'Passkey',
    cta: 'Continue with passkey',
    desc: 'Log in with your face, fingerprint or phone PIN. Apple or Google keep it synced across your devices.',
  },
  {
    id: 'security-key',
    name: 'Security key',
    cta: 'Continue with security key',
    desc: 'Log in by tapping a YubiKey or similar key plugged into your phone or computer.',
  },
  {
    id: 'password',
    name: 'Password',
    cta: 'Continue with a password',
    desc: 'Set a password if you would rather. It needs at least 10 characters, with upper and lower case letters, a number and a symbol.',
  },
];

export function Login() {
  const { state, update, go, path } = useSetup();
  const [pick, setPick] = useState<LoginMethod>(state.method);
  const [explain, setExplain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; names: boolean } | null>(null);
  const current = METHODS.find((m) => m.id === pick)!;

  const next = async () => {
    update({ method: pick });
    if (pick === 'pgp') return go('pgp-key');
    if (pick === 'password') return go('password');
    setBusy(true);
    setError(null);
    try {
      await registerWebAuthn({ displayName: state.displayName, loginName: state.loginName }, pick, state.terms!);
      update({ registered: true });
      refreshSession();
      go('backup');
    } catch (e) {
      if (termsChanged(e)) {
        update({ terms: null });
        go('');
        return;
      }
      const names = nameError(e);
      if (names !== null) setError({ text: names, names: true });
      else if (errorCode(e) === null) setError({ text: 'That did not finish. Try again, or pick another way to log in.', names: false });
      else setError({ text: 'X2F could not set that up. Try again, or pick another way to log in.', names: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SetupFrame
      screen="setup-login"
      step={2}
      back={path('name')}
      footer={
        <Button variant="primary" disabled={busy} onClick={() => void next()} data-part="method-continue">
          {current.cta}
        </Button>
      }
    >
      <SetupIntro title="How do you want to log in?">Choose one for now. You can add others later in Settings.</SetupIntro>
      <div className="x2f-setup__choices" role="radiogroup" aria-label="Login method">
        {METHODS.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={pick === m.id}
            className="x2f-setup__choice"
            data-method={m.id}
            onClick={() => setPick(m.id)}
          >
            <span className="x2f-setup__choice-head">
              <span className="x2f-setup__choice-name">{m.name}</span>
              {m.rec ? <span className="x2f-setup__rec">Recommended</span> : null}
            </span>
            <span className="x2f-setup__choice-desc">{m.desc}</span>
            {pick === m.id && m.later !== undefined ? <span className="x2f-setup__choice-later">{m.later}</span> : null}
          </button>
        ))}
      </div>
      <RegisterError error={error} />
      <button type="button" className="x2f-setup__textbutton" aria-expanded={explain} onClick={() => setExplain((x) => !x)} data-part="pgp-explain">
        New to PGP?
      </button>
      {explain ? (
        <p className="x2f-setup__help" data-part="pgp-explainer">
          PGP is free software that locks and unlocks messages with a pair of keys: a public key you can share and a private key only you keep. You
          need a PGP app each time you log in, such as Kleopatra on Windows, GPG Suite on a Mac or OpenKeychain on Android. X2F never makes keys for
          you, so your private key never leaves your app.
        </p>
      ) : null}
    </SetupFrame>
  );
}
