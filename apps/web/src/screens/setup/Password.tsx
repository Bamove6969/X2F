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
 * Only the server knows the leaked list, so a password that meets every rule reads "Checking…"
 * (signup-rules review S4), not Strong, until the server has answered: it can be set, and the
 * server's answer to "Set password" is the check (a leaked one drops to Weak).
 */
import { useState } from 'react';
import { checkPassword, isStaged, withConfirm } from '@x2f/auth-client';
import { ConfirmOpenProvider, isConfirmAbort, useConfirm } from '../auth/ConfirmSheet.js';
import { authApi } from '../auth/authApi.js';
import { HOLD_COPY } from '../settings/holdCopy.js';
import { refreshSession } from '../../session/useSession.js';
import { Button } from '../../ui/Button.js';
import { Icon } from '../../ui/icons.js';
import { RegisterError, SetupFrame, SetupIntro, finishMethod, useSetup } from './kit.js';
import { errorCode, registerPassword, setupError, termsChanged, type SetupError } from './register.js';
import { PasswordInput } from '../../ui/PasswordInput.js';
import { hasSpace, spaceProblem } from './names.js';

type Met = 'true' | 'false' | 'unknown';

export interface PasswordRules {
  length: boolean;
  cases: boolean;
  numberSymbol: boolean;
  /** Owner demo note #108: no spaces (false once one is typed). */
  noSpaces: boolean;
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
  const noSpaces = pw !== '' && !missing.includes('space');
  const match = pw !== '' && pw === again;
  return { length, cases, numberSymbol, noSpaces, match, ok: r.ok && match };
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

export type PasswordStrength = 'weak' | 'medium' | 'checking' | 'strong';

/** What the server has said about the leaked list for this password: nothing yet, on it, or not. */
export type LeakedCheck = 'unchecked' | 'leaked' | 'clear';

/**
 * The meter's level for what has been typed (null before anything is typed): `strong` only when
 * every rule is met and the server has said it is not on the leaked list; `checking` when every
 * rule is met and the server has not answered yet (review S4: Strong would promise "not leaked"
 * before anyone checked); `medium` with 3 or 4 of the 5 rules (length, upper case, lower case,
 * number, symbol); `weak` otherwise, and always when leaked.
 */
export function passwordStrength(pw: string, leaked: LeakedCheck): PasswordStrength | null {
  if (pw === '') return null;
  const r = checkPassword(pw);
  if (leaked === 'leaked') return 'weak';
  if (r.ok) return leaked === 'clear' ? 'strong' : 'checking';
  const missing = new Set<string>(r.missing.map((m) => (m === 'too-long' ? 'length' : m)));
  const met = ['length', 'upper', 'lower', 'number', 'symbol'].filter((k) => !missing.has(k)).length;
  return met >= 3 ? 'medium' : 'weak';
}

/** The meter's words (COPY-UNSIGNED: the owner left the levels' wording to design, 1 Nov 2026). */
// COPY-UNSIGNED: "Checking…" (review S4).
const STRENGTH_WORDS: Record<PasswordStrength, string> = { weak: 'Weak', medium: 'Medium', checking: 'Checking…', strong: 'Strong' };

/** The live meter: the level in words, and three bars for it. */
function StrengthMeter({ level }: { level: PasswordStrength | null }) {
  if (level === null) return null;
  const filled = level === 'strong' || level === 'checking' ? 3 : level === 'medium' ? 2 : 1;
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
  const api = useSetup();
  const { state, update, go, path } = api;
  // Owner demo notes (12 Nov 2026): a password ticked after a stronger method is added to the
  // account that method made (`PUT /v1/account/password`, no confirm in the sign-up window).
  const adding = state.registered;
  const [held, setHeld] = useState(false);
  // Review m-1: past the sign-up window (or when it no longer covers this), the server asks for
  // confirm-it's-you, as on the other method steps.
  const { prove, confirmUi, open } = useConfirm();
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [leaked, setLeaked] = useState<Met>('unknown');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SetupError | null>(null);
  const rules = passwordRules(pw, again);
  const strength = passwordStrength(pw, leaked === 'false' ? 'leaked' : leaked === 'true' ? 'clear' : 'unchecked');
  // Only a strong password can be set (owner, S-014): the rules, both typed the same, not leaked.
  // "Checking…" is a password that meets the rules and that the server checks on this tap.
  const canSet = rules.ok && (strength === 'strong' || strength === 'checking');

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (adding) {
        const staged = await withConfirm({ kind: 'set-password' }, (t) => authApi.setPassword({ password: pw, ...(t !== undefined ? { confirmToken: t } : {}) }), prove);
        setPw('');
        setAgain('');
        if (staged !== undefined && isStaged(staged)) setHeld(true);
        else finishMethod(api, 'password');
        return;
      }
      await registerPassword({ displayName: state.displayName, loginName: state.loginName }, pw, state.terms!);
      setPw('');
      setAgain('');
      refreshSession();
      finishMethod(api, 'password', { registered: true, method: 'password' });
    } catch (e) {
      if (isConfirmAbort(e)) return;
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
    <ConfirmOpenProvider value={open}>
      <SetupFrame
        screen="setup-password"
        step={3}
        {...(adding ? {} : { back: path('login') })}
        footer={
          held ? (
            <Button variant="primary" onClick={() => finishMethod(api, 'password')} data-part="method-next">
              Continue
            </Button>
          ) : (
            <Button variant={open ? 'secondary' : 'primary'} disabled={!canSet || busy} onClick={() => void submit()} data-part="password-set">
              Set password
            </Button>
          )
        }
      >
        {held ? (
          <p className="x2f-note" role="status" data-part="held-note">
            {HOLD_COPY.staged}
          </p>
        ) : null}
        <SetupIntro title="Choose a password">At least 10 characters, with upper and lower case letters, a number and a symbol, and no spaces.</SetupIntro>
        <label className="x2f-field x2f-label" htmlFor="pw">
          Password
          <PasswordInput id="pw"
            autoComplete="new-password"
            value={pw}
            onChange={(e) => {
              setPw(e.target.value);
              setLeaked('unknown');
            }}
          />
        </label>
        <StrengthMeter level={strength} />
        {hasSpace(pw) ? (
          <p className="x2f-error" data-part="password-space">
            {spaceProblem('password')}
          </p>
        ) : null}
        <label className="x2f-field x2f-label" htmlFor="pw2">
          Type it again
          <PasswordInput id="pw2" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
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
          {/* COPY-UNSIGNED (owner demo note #108) */}
          <Rule id="no-spaces" met={yes(rules.noSpaces)}>
            No spaces
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
        {confirmUi}
      </SetupFrame>
    </ConfirmOpenProvider>
  );
}
