/**
 * Setup step 2 (board SetupLogin; spec 6.2; owner demo notes, 12 Nov 2026): how to log in. Every
 * method is a checkbox, so several can be ticked (owner: "checking all the security options they
 * want to setup"); PGP is first and ticked by default. Continue sets up the first ticked one in
 * SIGNUP_ORDER, which makes the account; each step after that goes on to the next ticked one
 * (`finishMethod`), and the recovery code comes after all of them. PGP goes on to the key and
 * code, a password to its own screen; a passkey or a security key ticked first is registered right
 * here with the browser's own prompt, a later one on its own step (SetupKey.tsx).
 *
 * Owner's labels (12 Nov 2026): "Recommended" and, in green, "Strong" on PGP and the security key;
 * the authenticator app (OTP) with its explanation, "Medium" (the owner's "Medium" note sat on the
 * passkey's card, so the passkey reads Medium too); the password "Weak", with his sentence. An
 * authenticator code is a password's second step (TOTP alone never logs in, recovery.ts), so it
 * can be ticked only with Password.
 */
import { useId, useState } from 'react';
import { refreshSession } from '../../session/useSession.js';
import { Button } from '../../ui/Button.js';
import { keyErrorText } from '../auth/keyErrors.js';
import { RegisterError, SIGNUP_ORDER, SetupFrame, SetupIntro, nextStep, useSetup, type LoginMethod, type SignupMethod } from './kit.js';
import { errorCode, registerWebAuthn, setupError, termsChanged, type SetupError } from './register.js';

export type Strength = 'strong' | 'medium' | 'weak';

interface MethodDef {
  id: SignupMethod;
  name: string;
  cta: string;
  desc: string;
  strength: Strength;
  rec?: boolean;
  /** A sentence of warning under the description. */
  warn?: string;
  later?: string;
  /** A method that is a second step of another one. */
  needs?: LoginMethod;
  needsText?: string;
}

// COPY-UNSIGNED: the strength words are the owner's (12 Nov 2026), their colours are for design.
const STRENGTH_WORDS: Record<Strength, string> = { strong: 'Strong', medium: 'Medium', weak: 'Weak' };

/** The methods in the order shown (and set up, but for the authenticator app after the password). */
export const METHODS: MethodDef[] = [
  {
    id: 'pgp',
    name: 'PGP key',
    rec: true,
    strength: 'strong',
    cta: 'Continue with PGP key',
    desc: 'Log in with a PGP key instead of a password. X2F stores only your public key, so there is no password for anyone to steal from us.',
    later:
      'Each time you log in, X2F shows a message locked with your public key. Only your private key can unlock it, so you decrypt it in your PGP app and paste in the login code inside. Without your private key, nobody can get that code, and each one works only once.',
  },
  {
    id: 'security-key',
    name: 'Security key',
    // COPY-UNSIGNED: "Recommended" and "Strong" on the security key (owner, 12 Nov 2026).
    rec: true,
    strength: 'strong',
    cta: 'Continue with security key',
    desc: 'Log in by tapping a YubiKey or similar key plugged into your phone or computer.',
  },
  {
    id: 'passkey',
    name: 'Passkey',
    strength: 'medium',
    cta: 'Continue with passkey',
    desc: 'Log in with your face, fingerprint or phone PIN. Apple or Google keep it synced across your devices.',
  },
  {
    id: 'totp',
    // COPY-UNSIGNED (owner, 12 Nov 2026: "Where is OTP and it's explanation - medium").
    name: 'Authenticator app (OTP)',
    strength: 'medium',
    cta: 'Continue',
    desc: 'After your password, type the 6-digit code from an authenticator app on your phone, such as Aegis or Google Authenticator. The code changes every 30 seconds, so your password alone is not enough to get in.',
    needs: 'password',
    // COPY-UNSIGNED
    needsText: 'Goes with a password: tick Password to add it.',
  },
  {
    id: 'password',
    name: 'Password',
    strength: 'weak',
    cta: 'Continue with a password',
    // not-a-refusal: explains the password rules
    desc: 'Set a password if you would rather. It needs at least 10 characters, with upper and lower case letters, a number and a symbol.',
    // COPY-UNSIGNED (the owner's words, 12 Nov 2026)
    warn: 'It is strongly recommended you do not choose this as the only security method you use.',
  },
];

/** The ticked methods in SIGNUP_ORDER, without one whose partner is not ticked. */
function ordered(picks: ReadonlySet<SignupMethod>): SignupMethod[] {
  return SIGNUP_ORDER.filter((m) => {
    if (!picks.has(m)) return false;
    const needs = METHODS.find((d) => d.id === m)!.needs;
    return needs === undefined || picks.has(needs);
  });
}

export function Login() {
  const { state, update, go, path } = useSetup();
  const [picks, setPicks] = useState<ReadonlySet<SignupMethod>>(() => new Set(state.methods));
  const [explain, setExplain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SetupError | null>(null);
  const id = useId();
  const chosen = ordered(picks);
  const first = chosen[0] as LoginMethod | undefined;
  const current = first !== undefined ? METHODS.find((m) => m.id === first)! : null;

  const toggle = (m: MethodDef, on: boolean) => {
    setPicks((p) => {
      const n = new Set(p);
      if (on) n.add(m.id);
      else {
        n.delete(m.id);
        // A second step goes with the method it belongs to.
        for (const d of METHODS) if (d.needs === m.id) n.delete(d.id);
      }
      return n;
    });
  };

  const next = async () => {
    if (first === undefined) return;
    update({ methods: chosen, done: [], method: first });
    if (first === 'pgp') return go('pgp-key');
    if (first === 'password') return go('password');
    setBusy(true);
    setError(null);
    try {
      await registerWebAuthn({ displayName: state.displayName, loginName: state.loginName }, first, state.terms!);
      update({ registered: true, done: [first] });
      refreshSession();
      go(nextStep({ methods: chosen, done: [first] }), { replace: true });
    } catch (e) {
      if (termsChanged(e)) {
        update({ terms: null });
        go('');
        return;
      }
      // The browser's own refusal says why (owner demo 13 Nov); anything else keeps the general sentence.
      if (errorCode(e) === null) setError({ text: keyErrorText(e, first, 'That did not finish. Try again, or pick another way to log in.') });
      else setError(setupError(e, 'X2F could not set that up. Try again, or pick another way to log in.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SetupFrame
      screen="setup-login"
      step={2}
      // Review F8: the screen before this one is the display name.
      back={path('display-name')}
      footer={
        <Button variant="primary" disabled={busy || current === null} onClick={() => void next()} data-part="method-continue">
          {current?.cta ?? 'Continue'}
        </Button>
      }
    >
      {/* COPY-UNSIGNED (owner, 12 Nov 2026: tick every method wanted, set up one after another) */}
      <SetupIntro title="How do you want to log in?">
        Tick every way you want to use. We'll set them up one after another, then show you your recovery code. You can add others later in
        Settings.
      </SetupIntro>
      <div className="x2f-start__choices" role="group" aria-label="Login methods">
        {METHODS.map((m) => {
          const on = picks.has(m.id);
          const off = m.needs !== undefined && !picks.has(m.needs);
          return (
            <label key={m.id} className="x2f-start__choice x2f-start__choice--check" data-method={m.id} data-checked={on && !off ? 'true' : 'false'} data-disabled={off ? 'true' : 'false'}>
              <span className="x2f-start__choice-head">
                <input
                  type="checkbox"
                  className="x2f-start__tick"
                  checked={on && !off}
                  disabled={off}
                  onChange={(e) => toggle(m, e.target.checked)}
                  aria-describedby={`${id}-${m.id}`}
                  data-part="method-pick"
                />
                <span className="x2f-start__choice-name">{m.name}</span>
                {m.rec ? (
                  <span className="x2f-start__rec" data-part="recommended">
                    Recommended
                  </span>
                ) : null}
                <span className="x2f-start__strength" data-part="strength" data-strength={m.strength}>
                  {STRENGTH_WORDS[m.strength]}
                </span>
              </span>
              <span className="x2f-start__choice-desc" id={`${id}-${m.id}`}>
                {m.desc}
                {m.warn !== undefined ? <span className="x2f-start__choice-warn"> {m.warn}</span> : null}
                {off && m.needsText !== undefined ? <span className="x2f-start__choice-needs"> {m.needsText}</span> : null}
              </span>
              {on && m.later !== undefined ? <span className="x2f-start__choice-later">{m.later}</span> : null}
            </label>
          );
        })}
      </div>
      {current === null ? (
        // COPY-UNSIGNED
        <p className="x2f-start__help" role="status" data-part="method-none">
          Tick at least one way to log in.
        </p>
      ) : null}
      <RegisterError error={error} />
      <button type="button" className="x2f-start__textbutton" aria-expanded={explain} onClick={() => setExplain((x) => !x)} data-part="pgp-explain">
        New to PGP?
      </button>
      {explain ? (
        <p className="x2f-start__help" data-part="pgp-explainer">
          PGP is free software that locks and unlocks messages with a pair of keys: a public key you can share and a private key only you keep. You
          need a PGP app each time you log in, such as Kleopatra on Windows, GPG Suite on a Mac or OpenKeychain on Android. X2F never makes keys for
          you, so your private key never leaves your app.{' '}
          {/* COPY-UNSIGNED (owner, 12 Nov 2026: "Recommend PGP only as well for Android") */}
          On an Android phone we recommend PGP too: OpenKeychain is free.
        </p>
      ) : null}
    </SetupFrame>
  );
}
