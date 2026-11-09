/**
 * Setup step 3, password (board SetupPassword; spec 6.2 and "Decided 2026-10-23"): at least 10
 * characters with upper and lower case, a number and a symbol, typed twice. The leaked-password
 * list lives on X2F's own server, so that line is ticked off only by the server's answer to
 * `POST /v1/register/password` (with `acceptedTerms`). The password stays in this screen's memory.
 *
 * Owner 1 Nov 2026 (register S-014): a live strength meter in words (weak, then medium, then
 * strong), and only a strong password is accepted. Strong is exactly the server's rule
 * (`checkPassword` and not on the leaked list), so the meter never says Strong for a password the
 * server would refuse for its shape. The levels below Strong and their words are for design.
 */
import { useState } from 'react';
import { checkPassword } from '@x2f/auth-client';
import { refreshSession } from '../../session/useSession.js';
import { Button } from '../../ui/Button.js';
import { Icon } from '../../ui/icons.js';
import { RegisterError, SetupFrame, SetupIntro, useSetup } from './kit.js';
import { errorCode, registerPassword, setupError, termsChanged, type SetupError } from './register.js';

type Met = 'true' | 'false' | 'unknown';

export interface PasswordRules {
  length: boolean;
  cases: boolean;
  numberSymbol: boolean;
  match: boolean;
  ok: boolean;
}

/** The board's checklist for what has been typed so far (the leaked list is the server's). */
export function passwordRules(pw: string, again: string): PasswordRules {
  const r = checkPassword(pw);
  const missing = r.ok ? [] : r.missing;
  const length = pw !== '' && !missing.includes('length') && !missing.includes('too-long');
  const cases = pw !== '' && !missing.includes('upper') && !missing.includes('lower');
  const numberSymbol = pw !== '' && !missing.includes('number') && !missing.includes('symbol');
  const match = pw !== '' && pw === again;
  return { length, cases, numberSymbol, match, ok: r.ok && match };
}

function Rule({ id, met, children }: { id: string; met: Met; children: string }) {
  return (
    <li className="x2f-start__rule" data-rule={id} data-met={met}>
      <Icon name={met === 'false' ? 'close' : 'check'} size={18} stroke={2} />
      {children}
    </li>
  );
}

const yes = (b: boolean): Met => (b ? 'true' : 'false');

export type PasswordStrength = 'weak' | 'medium' | 'strong';

/**
 * The meter's level for what has been typed (null before anything is typed): `strong` only when
 * every rule is met and the server has not found it on the leaked list; `medium` with 3 or 4 of the
 * 5 rules (length, upper case, lower case, number, symbol); `weak` otherwise, and always when leaked.
 */
export function passwordStrength(pw: string, leaked: boolean): PasswordStrength | null {
  if (pw === '') return null;
  const r = checkPassword(pw);
  if (leaked) return 'weak';
  if (r.ok) return 'strong';
  const missing = new Set<string>(r.missing.map((m) => (m === 'too-long' ? 'length' : m)));
  const met = ['length', 'upper', 'lower', 'number', 'symbol'].filter((k) => !missing.has(k)).length;
  return met >= 3 ? 'medium' : 'weak';
}

/** The meter's words (COPY-UNSIGNED: the owner left the levels' wording to design, 1 Nov 2026). */
const STRENGTH_WORDS: Record<PasswordStrength, string> = { weak: 'Weak', medium: 'Medium', strong: 'Strong' };

/** The live meter: the level in words, and three bars for it. */
function StrengthMeter({ level }: { level: PasswordStrength | null }) {
  if (level === null) return null;
  const filled = level === 'strong' ? 3 : level === 'medium' ? 2 : 1;
  return (
    <div className="x2f-start__meter" role="status" aria-live="polite" data-part="password-meter" data-level={level}>
      <span className="x2f-start__meter-bars" aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <span key={i} className="x2f-start__meter-bar" data-on={i <= filled ? 'true' : 'false'} />
        ))}
      </span>
      {/* COPY-UNSIGNED */}
      <span className="x2f-start__meter-text">Strength: {STRENGTH_WORDS[level]}</span>
    </div>
  );
}

export function Password() {
  const { state, update, go, path } = useSetup();
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [leaked, setLeaked] = useState<Met>('unknown');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SetupError | null>(null);
  const rules = passwordRules(pw, again);
  const strength = passwordStrength(pw, leaked === 'false');
  // Only a strong password can be set (owner, S-014): the rules, both typed the same, not leaked.
  const canSet = rules.ok && strength === 'strong';

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await registerPassword({ displayName: state.displayName, loginName: state.loginName }, pw, state.terms!);
      setPw('');
      setAgain('');
      update({ registered: true, method: 'password' });
      refreshSession();
      go('backup', { replace: true });
    } catch (e) {
      const code = errorCode(e);
      if (termsChanged(e)) {
        update({ terms: null });
        go('');
        return;
      }
      if (code === 'password-leaked') {
        setLeaked('false');
        setError({ text: 'That password is on a list of leaked passwords. Pick another one.' });
      } else if (code === 'password-weak') setError(setupError(e, 'That password does not meet the rules above.'));
      else setError(setupError(e, 'X2F could not set that password just now. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SetupFrame
      screen="setup-password"
      step={3}
      back={path('login')}
      footer={
        <Button variant="primary" disabled={!canSet || busy} onClick={() => void submit()} data-part="password-set">
          Set password
        </Button>
      }
    >
      <SetupIntro title="Choose a password">At least 10 characters, with upper and lower case letters, a number and a symbol.</SetupIntro>
      <label className="x2f-field x2f-label" htmlFor="pw">
        Password
        <input
          className="x2f-input"
          id="pw"
          type="password"
          autoComplete="new-password"
          value={pw}
          onChange={(e) => {
            setPw(e.target.value);
            setLeaked('unknown');
          }}
        />
      </label>
      <StrengthMeter level={strength} />
      <label className="x2f-field x2f-label" htmlFor="pw2">
        Type it again
        <input className="x2f-input" id="pw2" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
      </label>
      <ul className="x2f-start__rules" aria-label="Password rules">
        <Rule id="length" met={yes(rules.length)}>
          10 characters or more
        </Rule>
        <Rule id="cases" met={yes(rules.cases)}>
          Upper and lower case letters
        </Rule>
        <Rule id="number-symbol" met={yes(rules.numberSymbol)}>
          A number and a symbol
        </Rule>
        <Rule id="leaked" met={leaked}>
          Not on the list of leaked passwords
        </Rule>
        <Rule id="match" met={yes(rules.match)}>
          Both match
        </Rule>
      </ul>
      <RegisterError error={error} />
      {/* not-a-refusal: explains password storage */}
      <p className="x2f-start__help">
        X2F stores a scrambled version that can't be turned back into your password. We have no email address to reset it with, so keep it in a
        password manager or somewhere else safe.
      </p>
    </SetupFrame>
  );
}
