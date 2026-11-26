/**
 * Setup step 3 (owner demo note #199; was step 2 on board SetupLogin; spec 6.2; owner demo notes, 12 Nov 2026): how to log in. Every
 * method is a checkbox, so several can be ticked (owner: "checking all the security options they
 * want to setup"); PGP is first and ticked by default. Continue sets up the first ticked one in
 * SIGNUP_ORDER, which makes the account; each step after that goes on to the next ticked one
 * (`finishMethod`), and the recovery code comes after all of them. PGP goes on to the key and
 * code; a passkey or a security key ticked first is registered right here with the browser's own
 * prompt, a later one on its own step (SetupKey.tsx).
 *
 * Owner, 26 Nov 2026 (no passwords): at least two different kinds must be ticked
 * (`enoughMethods`, @x2f/accounts): any two of PGP key, security key, passkey and the
 * authenticator app. There is one authenticator app at most and it never logs in by itself, so
 * two kinds always include a key that does. The recovery code comes after and does not count.
 */
import { useId, useState } from 'react';
import { enoughMethods } from '@x2f/auth-client';
import { refreshSession } from '../../session/useSession.js';
import { Button } from '../../ui/Button.js';
import { keyErrorText } from '../auth/keyErrors.js';
import { KEY_SAVED_COPY } from '../auth/KeySaved.js';
import { RegisterError, SIGNUP_ORDER, SetupFrame, SetupIntro, useSetup, type LoginMethod, type SignupMethod } from './kit.js';
import { errorCode, registerWebAuthn, setupError, termsChanged, type SetupError } from './register.js';

export type Strength = 'strong' | 'medium' | 'weak';

interface MethodDef {
  id: SignupMethod;
  name: string;
  cta: string;
  desc: string;
  /** A second paragraph under the description (owner demo note #137). */
  more?: string;
  strength: Strength;
  rec?: boolean;
  /** A sentence of warning under the description. */
  warn?: string;
  later?: string;
}

// COPY-UNSIGNED: the strength words are the owner's (12 Nov 2026), their colours are for design.
// Owner demo note #129 (23 Nov): "I want it to say RATED-STRONG". COPY-UNSIGNED.
// Owner demo note #140 (23 Nov): Weak and Medium follow suit, on the right like RATED-STRONG.
const STRENGTH_WORDS: Record<Strength, string> = { strong: 'RATED-STRONG', medium: 'RATED-MEDIUM', weak: 'RATED-WEAK' };

/** The methods in the order shown (and set up). */
export const METHODS: MethodDef[] = [
  {
    id: 'pgp',
    name: 'PGP key',
    rec: true,
    strength: 'strong',
    cta: 'Continue with PGP key',
    desc: 'Log in with a PGP key. X2F stores only your public key, so there is nothing secret for anyone to steal from us.',
    // COPY-UNSIGNED: owner demo note #130 (23 Nov), his words, replacing the 13 Nov line.
    later:
      'Upon logging in, you will be provided with an encrypted message that only you can decrypt or unlock using your private PGP key that is stored in your PGP software. Upon decrypting the message, you will be presented with a unique one-time login code which proves you hold the matching key pair and will allow you to log into the site.',
  },
  {
    id: 'security-key',
    name: 'Security key',
    // COPY-UNSIGNED: "Recommended" and "Strong" on the security key (owner, 12 Nov 2026).
    rec: true,
    strength: 'strong',
    cta: 'Continue with security key',
    // COPY-UNSIGNED (signup round 3, from the owner's words, 13 Nov 2026; brands named in text only)
    // Owner demo note #131 (23 Nov), his words ("Yubikey" kept as the brand writes it: YubiKey).
    desc: 'Log in by NFC tapping or USB inserting your YubiKey, Google Titan, Nitrokey, Feitian, or any FIDO2-certified security key into your phone or computer. This is probably the most secure and the most recommended method of security that there is.',
  },
  {
    id: 'passkey',
    name: 'Passkey',
    // Owner demo note #134 (23 Nov): passkeys rated strong and recommended, like PGP and the security key.
    rec: true,
    strength: 'strong',
    cta: 'Continue with passkey',
    // Owner demo note #133 (23 Nov), his words; "Passkeys people are" made "People are" and "pin" made "PIN".
    desc: 'People are pretty familiar with passkeys by now. They allow you to log in with your face, fingerprint, or personal PIN. You can save them in your favorite password manager and also sync them across your devices.',
  },
  {
    id: 'totp',
    // COPY-UNSIGNED (owner, 12 Nov 2026: "Where is OTP and it's explanation - medium").
    name: 'Authenticator app (OTP)',
    strength: 'medium',
    cta: 'Continue',
    // Owner demo note #135 (23 Nov), his words; "below" made "on the next screen", since the code box is there.
    // not-a-refusal: explains how authenticator-app setup works
    desc: 'Scan the QR code using your preferred authenticator app to generate a 6-digit code that refreshes every 30 seconds. Enter the current code on the next screen to finish setup. If you cannot scan the QR code, you can enter the setup key manually.',
    // COPY-UNSIGNED (owner, 26 Nov 2026: no passwords; an authenticator app counts as one of the two).
    // not-a-refusal: explains what an authenticator app does on X2F
    more: 'Security Level: Medium. It counts as one of your two ways in, but it never logs you in by itself, so tick a PGP key, security key or passkey with it. You can add one authenticator app.',
  },
];

/** The ticked methods in SIGNUP_ORDER. */
function ordered(picks: ReadonlySet<SignupMethod>): SignupMethod[] {
  return SIGNUP_ORDER.filter((m) => picks.has(m));
}

type LearnKey = 'pgp' | 'security-key' | 'passkey' | 'otp';

/**
 * Owner demo note #221 (25 Nov): the "Learn About" list, in his order. PGP is his #141/#142
 * paragraph word for word; the other three are COPY-UNSIGNED drafts for his review, checked against
 * the code. The password entry went with passwords (owner, 26 Nov 2026).
 */
const LEARN: readonly { key: LearnKey; label: string; text: string }[] = [
  {
    key: 'pgp',
    label: 'PGP',
    text:
      'PGP uses free, open-source encryption to lock and unlock messages with a cryptographic key pair: a public key you share with X2F, and a private key that stays strictly on your device. You will need a PGP app each time you log in to decrypt a login challenge, such as Kleopatra (Windows/Linux), GPG Suite (macOS), or PGPony (com.pgpony.android on F-Droid, our top Android pick) and OpenKeychain on Android. Because X2F never generates keys on your behalf, your private key never leaves your control.',
  },
  {
    key: 'security-key',
    label: 'Security Key',
    text:
      'A security key is a small physical device, such as a YubiKey or a Nitrokey, that you plug into your computer or tap against your phone. When you log in, X2F asks the key to prove it is the one you registered, and you touch it and enter its PIN (or use its fingerprint) to confirm; X2F only accepts keys that check a PIN or fingerprint. The secret inside the key never leaves it, so nobody can copy it from a website or a leaked list. Keep a second key or another login method as a backup in case one is lost.',
  },
  {
    key: 'passkey',
    label: 'Passkey',
    text:
      'A passkey is a login stored on your phone or computer and unlocked with your fingerprint, face or device PIN. Like a security key, it proves who you are without ever sending a secret that could be stolen or guessed. Passkeys are quick and easy to use, but some devices copy them to your Apple, Google or Microsoft account to sync them between devices, so pick a security key or PGP if you would rather nothing about your X2F login touches those accounts.',
  },
  {
    key: 'otp',
    label: 'OTP',
    text:
      'OTP means one-time password. You add X2F to an authenticator app, such as Aegis or 2FAS, by scanning a code once. From then on the app shows a new six-digit code every 30 seconds, and you type the current one when you log in. The codes come from a secret shared only between the app and X2F, and each one works only briefly, so a code someone sees over your shoulder is soon useless. On X2F an authenticator app counts as one of your two ways in, but it never logs you in by itself: you also need a PGP key, security key or passkey.',
  },
];

export function Login() {
  const { state, update, go, path } = useSetup();
  const [picks, setPicks] = useState<ReadonlySet<SignupMethod>>(() => new Set(state.methods));
  const learnId = useId();
  // Owner demo note #221 (25 Nov): which "Learn About" write-up is open, one at a time.
  const [explain, setExplain] = useState<LearnKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SetupError | null>(null);
  const id = useId();
  const chosen = ordered(picks);
  // SIGNUP_ORDER puts the authenticator app last, so the first ticked one is a key whenever two kinds are ticked.
  const first = chosen[0] as LoginMethod | undefined;
  const enough = enoughMethods(chosen);
  const current = first !== undefined && enough ? METHODS.find((m) => m.id === first)! : null;

  const toggle = (m: MethodDef, on: boolean) => {
    setPicks((p) => {
      const n = new Set(p);
      if (on) n.add(m.id);
      else n.delete(m.id);
      return n;
    });
  };

  const next = async () => {
    if (first === undefined || !enough) return;
    update({ methods: chosen, done: [], method: first });
    if (first === 'pgp') return go('pgp-key');
    setBusy(true);
    setError(null);
    try {
      const { credentialId } = await registerWebAuthn({ displayName: state.displayName, loginName: state.loginName }, first, state.terms!);
      // Owner 25 Nov security-key report: the key is saved, so say so and ask for its name
      // (FirstKeySaved, shown in this step's place by SetupFlow) before going on.
      update({ registered: true, done: [first], keySaved: { kind: first, credentialId } });
      refreshSession();
    } catch (e) {
      if (termsChanged(e)) {
        update({ terms: null });
        go('');
        return;
      }
      // The browser's own refusal says why (owner demo 13 Nov), and so does a key that did not check
      // its PIN (owner 25 Nov security-key report); anything else keeps the general sentence.
      if (errorCode(e) === null || (e as { reason?: unknown }).reason === 'needs-pin') setError({ text: keyErrorText(e, first, 'That did not finish. Try again, or pick another way to log in.') });
      else setError(setupError(e, 'X2F could not set that up. Try again, or pick another way to log in.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SetupFrame
      screen="setup-login"
      // Owner demo note #199: the display name is step 2 now, so choosing and setting up the login
      // methods is step 3 together (the method screens were already 3), and "of 5" stays true.
      step={3}
      // Review F8: the screen before this one is the display name.
      back={path('display-name')}
      footer={
        <Button variant="primary" disabled={busy || current === null} onClick={() => void next()} data-part="method-continue">
          {current?.cta ?? 'Continue'}
        </Button>
      }
    >
      {/* COPY-UNSIGNED (signup round 3, the owner's words, 13 Nov 2026) */}
      <SetupIntro title="How do you want to log in?">
        {/* Owner, 26 Nov 2026 (no passwords): at least two. COPY-UNSIGNED. */}
        Pick at least two. Anything else can be added later. The more you set up, the more ways you have back into your account if you
        lose one.
      </SetupIntro>
      <div className="x2f-start__choices" role="group" aria-label="Login methods">
        {METHODS.map((m) => {
          const on = picks.has(m.id);
          return (
            <label key={m.id} className="x2f-start__choice x2f-start__choice--check" data-method={m.id} data-checked={on ? 'true' : 'false'}>
              <span className="x2f-start__choice-head">
                <input
                  type="checkbox"
                  className="x2f-start__tick"
                  checked={on}
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
                {m.more !== undefined ? (
                  <>
                    <br />
                    <br />
                    <span data-part="method-more">{m.more}</span>
                  </>
                ) : null}
                {m.warn !== undefined ? <span className="x2f-start__choice-warn"> {m.warn}</span> : null}
              </span>
              {on && m.later !== undefined ? <span className="x2f-start__choice-later">{m.later}</span> : null}
            </label>
          );
        })}
      </div>
      {current === null ? (
        // COPY-UNSIGNED (owner, 26 Nov 2026: at least two kinds)
        <p className="x2f-start__help" role="status" data-part="method-none">
          Tick at least two ways to log in.
        </p>
      ) : null}
      {busy && (first === 'security-key' || first === 'passkey') ? (
        <p className="x2f-note" role="status" data-part="key-waiting">
          {KEY_SAVED_COPY.waiting(first)}
        </p>
      ) : null}
      <RegisterError error={error} />
      {/* Owner demo note #221 (25 Nov): "Learn About", underlined, with the methods straight down the
          middle; each opens a write-up the way "New to PGP?" did. PGP keeps his #141/#142 paragraph. */}
      <section className="x2f-start__learn" aria-labelledby={`${learnId}-head`} data-part="learn-about">
        <h2 className="x2f-start__learn-head" id={`${learnId}-head`}>
          Learn About
        </h2>
        <ul className="x2f-start__learn-list">
          {LEARN.map((l) => (
            <li key={l.key}>
              <button
                type="button"
                className="x2f-start__textbutton x2f-start__textbutton--tap"
                aria-expanded={explain === l.key}
                aria-controls={explain === l.key ? `${learnId}-${l.key}` : undefined}
                onClick={() => setExplain((x) => (x === l.key ? null : l.key))}
                data-part={l.key === 'pgp' ? 'pgp-explain' : `learn-${l.key}`}
              >
                {l.label}
              </button>
              {explain === l.key ? (
                <p
                  className="x2f-start__help x2f-start__help--loud x2f-start__learn-text"
                  id={`${learnId}-${l.key}`}
                  data-part={l.key === 'pgp' ? 'pgp-explainer' : `learn-${l.key}-text`}
                >
                  {l.text}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </SetupFrame>
  );
}
