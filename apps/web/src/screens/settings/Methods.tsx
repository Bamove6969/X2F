/**
 * Login methods (Task 30): the list, adding one, and removing one. Adding a method needs
 * confirm-it's-you outside the sign-up window, so every add goes through `withConfirm` and the
 * shared `ConfirmSheet` (passed in as `prove`). The server refuses removing the last way to log in
 * with `last-login-method`; the screen shows that plainly rather than letting someone lock
 * themselves out. TOTP enrolment and recovery codes are their own screens.
 *
 * Owner, 16 Nov 2026: the authenticator app goes only with a password (`@x2f/accounts`
 * METHOD_PARTNERS), so it is offered only on an account with a password, and the password is not
 * removed while it is on (the API refuses both: 409 `totp-needs-password`, `password-has-totp`).
 */
import { useCallback, useEffect, useState } from 'react';
import {
  AuthApiError,
  addWebAuthnKeyWithId,
  isStaged,
  partnerMissing,
  partnerNeededBy,
  passwordAlone,
  withConfirm,
  type ConfirmAction,
  type Staged,
  type MethodEntry,
  type MethodType,
  type WebAuthnKind,
} from '@x2f/auth-client';
import { Button } from '../../ui/Button.js';
import { KeyTest } from '../auth/KeyTest.js';
import { Notice } from '../../ui/Notice.js';
import { CantDoThat } from '../../ui/CantDoThat.js';
import {
  CANT_DO_TITLE, LAST_METHOD_CODE, LAST_METHOD_MESSAGE, PASSWORD_ALONE_CODE, PASSWORD_ALONE_MESSAGE, PASSWORD_HAS_TOTP_CODE, PASSWORD_HAS_TOTP_MESSAGE,
} from '../../ui/cantDoCodes.js';
import { isConfirmAbort, usePrimaryVariant } from '../auth/ConfirmSheet.js';
import { authApi } from '../auth/authApi.js';
import { keyErrorText } from '../auth/keyErrors.js';
import { refusalText } from '../auth/refusals.js';
import { StagedNote, reportChangesCap } from './HoldChanges.js';
import { BURNED_CODE_COPY as BURNED } from './holdCopy.js';
import { RecoveryCodes } from './RecoveryCodes.js';
import { Totp } from './Totp.js';
import { PasswordInput } from '../../ui/PasswordInput.js';
import { MessageBox } from '../../ui/MessageBox.js';
import { hasPasswordSpace, spaceProblem } from '../setup/names.js';

const LABELS: Record<MethodType, string> = {
  pgp: 'PGP key',
  passkey: 'Passkey',
  'security-key': 'Security key',
  password: 'Password',
  totp: 'Authenticator app',
  'recovery-codes': 'Recovery codes',
};


/** The methods that log in on their own; an authenticator app and recovery codes only back them up. */
const LOGIN_METHODS: readonly MethodType[] = ['pgp', 'passkey', 'security-key', 'password'];

/**
 * True when `m` is the account's only way to log in, so removing it is refused at once, before any
 * confirm round-trip. The server still decides every other case (staff minimums, for one).
 */
export function isOnlyLogin(m: MethodEntry, all: readonly MethodEntry[]): boolean {
  return LOGIN_METHODS.includes(m.type) && all.filter((x) => LOGIN_METHODS.includes(x.type)).length === 1;
}

/**
 * True when removing `m` would leave a password with neither the authenticator app nor a PGP key,
 * passkey or security key (owner, 16 Nov 2026). The server decides the rest.
 */
export function leavesPasswordAlone(m: MethodEntry, all: readonly MethodEntry[]): boolean {
  const i = all.indexOf(m);
  return passwordAlone(all.filter((_, j) => j !== i).map((x) => x.type));
}

type Adding = 'none' | 'password' | 'pgp' | 'totp' | 'recovery-codes';

export function Methods({ prove }: { prove: (action: ConfirmAction) => Promise<string> }) {
  const [methods, setMethods] = useState<MethodEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 409 `last-login-method` (or the same check here first): CantDoThat until closed (Plan 5 Task 21).
  const [lastMethod, setLastMethod] = useState(false);
  // 409 `password-has-totp` (or the same check here first): the password stays while TOTP is on.
  const [keepsPassword, setKeepsPassword] = useState(false);
  // 409 `password-alone` (or the same check here first): a password does not stand alone.
  const [leavesAlone, setLeavesAlone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<Adding>('none');
  // Hold model v3: a change made from a username-and-password login is staged as a draft (202).
  // The count makes each new draft announce itself again.
  const [staged, setStaged] = useState(0);
  const noteStaged = useCallback((h: Staged | undefined) => {
    if (h !== undefined) setStaged((n) => n + 1);
  }, []);
  const done = (h?: Staged) => {
    noteStaged(h);
    void refresh().finally(() => setAdding('none'));
  };

  const refresh = useCallback(async () => {
    setMethods(await authApi.listMethods());
  }, []);

  useEffect(() => {
    void refresh().catch(() => setError('Could not load your login methods.'));
  }, [refresh]);

  /** The security key just added here, offered for a test (owner demo note #94); null otherwise. */
  const [justAdded, setJustAdded] = useState<string | null>(null);

  const addWebAuthn = async (kind: WebAuthnKind) => {
    setBusy(true);
    setError(null);
    setJustAdded(null);
    try {
      const { staged: h, credentialId } = await withConfirm(
        { kind: 'add-method', method: kind },
        (t) => addWebAuthnKeyWithId(authApi, kind, t !== undefined ? { confirmToken: t } : {}),
        prove,
      );
      noteStaged(h);
      // A staged key (hold model v3) is not a login method yet, so only a key added now is tested.
      if (kind === 'security-key' && !(h !== undefined && isStaged(h))) setJustAdded(credentialId);
      await refresh();
    } catch (e) {
      if (!isConfirmAbort(e) && !reportChangesCap(e)) setError(keyErrorText(e, kind));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (m: MethodEntry) => {
    setJustAdded(null);
    if (methods !== null && isOnlyLogin(m, methods)) {
      setLastMethod(true);
      return;
    }
    if (methods !== null && partnerNeededBy(m.type, methods.map((x) => x.type)) !== null) {
      setKeepsPassword(true);
      return;
    }
    if (methods !== null && leavesPasswordAlone(m, methods)) {
      setLeavesAlone(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      noteStaged(await withConfirm(
        { kind: 'remove-method', method: m.type, id: m.id },
        (t) => authApi.removeMethod(m.type, m.id, t !== undefined ? { confirmToken: t } : {}),
        prove,
      ));
      await refresh();
    } catch (e) {
      if (e instanceof AuthApiError && e.code === LAST_METHOD_CODE) setLastMethod(true);
      else if (e instanceof AuthApiError && e.code === PASSWORD_HAS_TOTP_CODE) setKeepsPassword(true);
      else if (e instanceof AuthApiError && e.code === PASSWORD_ALONE_CODE) setLeavesAlone(true);
      else if (!isConfirmAbort(e) && !reportChangesCap(e)) setError(refusalText(e, 'Could not remove that method. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="x2f-card" data-part="methods" aria-labelledby="methods-h">
      <h2 className="x2f-card__title" id="methods-h">
        Login methods
      </h2>
      {error !== null ? (
        <p className="x2f-error" role="alert" data-part="methods-error">
          {error}
        </p>
      ) : null}
      {staged > 0 ? <StagedNote key={staged} /> : null}
      {justAdded !== null ? (
        <div data-part="key-just-added">
          {/* COPY-UNSIGNED */}
          <p className="x2f-note" role="status">
            Security key added.
          </p>
          <KeyTest key={justAdded} credentialId={justAdded} />
        </div>
      ) : null}
      {lastMethod ? <CantDoThat title={CANT_DO_TITLE.methods} body={LAST_METHOD_MESSAGE} from={LAST_METHOD_CODE} onClose={() => setLastMethod(false)} /> : null}
      {leavesAlone ? <CantDoThat title={CANT_DO_TITLE.methods} body={PASSWORD_ALONE_MESSAGE} from={PASSWORD_ALONE_CODE} onClose={() => setLeavesAlone(false)} /> : null}
      {keepsPassword ? (
        <CantDoThat title={CANT_DO_TITLE.methods} body={PASSWORD_HAS_TOTP_MESSAGE} from={PASSWORD_HAS_TOTP_CODE} onClose={() => setKeepsPassword(false)} />
      ) : null}

      <ul className="x2f-list" data-part="method-list">
        {(methods ?? []).map((m) => (
          <li className="x2f-list__row" key={`${m.type}:${m.id}`} data-method={m.type}>
            <span className="x2f-list__label">{m.label || LABELS[m.type]}</span>
            <Button variant="danger" disabled={busy} onClick={() => void remove(m)} data-part="remove">
              Remove
            </Button>
          </li>
        ))}
      </ul>

      <div className="x2f-stack" data-part="add-method">
        <Button variant="secondary" disabled={busy} onClick={() => void addWebAuthn('passkey')} data-add="passkey">
          Add a passkey
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => void addWebAuthn('security-key')} data-add="security-key">
          Add a security key
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => setAdding('pgp')} data-add="pgp">
          Add a PGP key
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => setAdding('password')} data-add="password">
          Set a password
        </Button>
        {methods !== null && partnerMissing('totp', methods.map((x) => x.type)) === null ? (
          <Button variant="secondary" disabled={busy} onClick={() => setAdding('totp')} data-add="totp">
            Add an authenticator app
          </Button>
        ) : null}
        <Button variant="secondary" disabled={busy} onClick={() => setAdding('recovery-codes')} data-add="recovery-codes">
          Create recovery codes
        </Button>
      </div>

      {adding === 'password' ? (
        <AddPassword prove={prove} onDone={done} onCancel={() => setAdding('none')} />
      ) : null}
      {adding === 'pgp' ? (
        <AddPgpKey prove={prove} onDone={done} onCancel={() => setAdding('none')} />
      ) : null}
      {adding === 'totp' ? <Totp prove={prove} onDone={done} onCancel={() => setAdding('none')} /> : null}
      {adding === 'recovery-codes' ? <RecoveryCodes prove={prove} onDone={() => setAdding('none')} /> : null}
    </section>
  );
}

export function AddPassword({ prove, onDone, onCancel }: { prove: (a: ConfirmAction) => Promise<string>; onDone: (staged?: Staged) => void; onCancel: () => void }) {
  const primary = usePrimaryVariant();
  const [password, setPassword] = useState('');
  // Owner S-110 (p11-35): the recovery code, optional, makes the change apply at once.
  const [recoveryCode, setRecoveryCode] = useState('');
  const [burned, setBurned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const spaced = hasPasswordSpace(password);

  const save = async () => {
    setBusy(true);
    setError(null);
    const code = recoveryCode.trim();
    try {
      const staged = await withConfirm(
        { kind: 'set-password' },
        (t) => authApi.setPassword({ password, ...(code !== '' ? { recoveryCode: code } : {}), ...(t !== undefined ? { confirmToken: t } : {}) }),
        prove,
      );
      // Owner S-111 (p11-36): a code that was used is burned; say so before closing the form.
      if (code !== '' && staged === undefined) setBurned(true);
      else onDone(staged);
    } catch (e) {
      if (e instanceof AuthApiError && e.code === 'password-weak') setError('That password is too weak: use at least 10 characters with upper and lower case, a number and a symbol, and no spaces.');
      else if (e instanceof AuthApiError && e.code === 'password-leaked') setError('That password has been seen in a breach. Pick another.');
      else if (code !== '' && e instanceof AuthApiError && e.code === 'credentials-invalid') setError(BURNED.passwordCodeWrong);
      else if (!isConfirmAbort(e) && !reportChangesCap(e)) setError(refusalText(e, 'Could not set a password. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  if (burned) {
    return (
      <div className="x2f-field" data-part="add-password">
        <Notice tone="caution" title={BURNED.title} data-part="code-burned">
          {BURNED.body}
        </Notice>
        <div className="x2f-row">
          <Button variant={primary} onClick={() => onDone()} data-part="code-burned-done">
            {BURNED.done}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="x2f-field" data-part="add-password">
      {error !== null ? (
        <p className="x2f-error" role="alert">
          {error}
        </p>
      ) : null}
      <label className="x2f-label" htmlFor="new-password">
        New password
      </label>
      <PasswordInput id="new-password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      {/* Owner demo note #108: a new password holds no spaces; said as soon as one is typed. */}
      {spaced ? (
        <p className="x2f-error" data-part="password-space">
          {spaceProblem('password')}
        </p>
      ) : null}
      <label className="x2f-label" htmlFor="password-recovery-code">
        {BURNED.passwordCodeLabel}
      </label>
      <input
        className="x2f-input"
        id="password-recovery-code"
        inputMode="text"
        autoComplete="off"
        value={recoveryCode}
        onChange={(e) => setRecoveryCode(e.target.value)}
        data-part="password-recovery-code"
      />
      <p className="x2f-note">{BURNED.passwordCodeHint}</p>
      <div className="x2f-row">
        <Button variant={primary} disabled={busy || password === '' || spaced} onClick={() => void save()}>
          Save
        </Button>
        <Button variant="quiet" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function AddPgpKey({ prove, onDone, onCancel }: { prove: (a: ConfirmAction) => Promise<string>; onDone: (staged?: Staged) => void; onCancel: () => void }) {
  const primary = usePrimaryVariant();
  const [publicKey, setPublicKey] = useState('');
  const [message, setMessage] = useState<{ challengeId: string; encryptedMessage: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const challenge = await withConfirm(
        { kind: 'add-method', method: 'pgp' },
        (t) => authApi.addPgpKeyStart({ publicKey: publicKey.trim(), ...(t !== undefined ? { confirmToken: t } : {}) }),
        prove,
      );
      setMessage({ challengeId: challenge.challengeId, encryptedMessage: challenge.encryptedMessage });
    } catch (e) {
      if (!isConfirmAbort(e)) setError(refusalText(e, 'Could not add that key. Check it and try again.'));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await authApi.addPgpKeyFinish({ challengeId: message!.challengeId, code: code.trim() });
      onDone(isStaged(r) ? r : undefined);
    } catch (e) {
      if (!reportChangesCap(e)) setError(refusalText(e, 'That code did not work. It may have expired.', { expired: 'That message has expired. Start again for a new one.' }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="x2f-field" data-part="add-pgp">
      {error !== null ? (
        <p className="x2f-error" role="alert">
          {error}
        </p>
      ) : null}
      {message === null ? (
        <>
          <label className="x2f-label" htmlFor="add-pgp-key">
            Your PGP public key
          </label>
          <textarea className="x2f-input x2f-textarea" id="add-pgp-key" rows={6} spellCheck={false} value={publicKey} onChange={(e) => setPublicKey(e.target.value)} />
          <div className="x2f-row">
            <Button variant={primary} disabled={busy || publicKey.trim() === ''} onClick={() => void start()}>
              Add key
            </Button>
            <Button variant="quiet" disabled={busy} onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <>
          <label className="x2f-label" htmlFor="add-pgp-message">
            Decrypt this message and paste the code
          </label>
          <MessageBox id="add-pgp-message">
            {message.encryptedMessage}
          </MessageBox>
          <input className="x2f-input" aria-label="Login code" value={code} onChange={(e) => setCode(e.target.value)} />
          <Button variant={primary} disabled={busy || code.trim() === ''} onClick={() => void finish()}>
            Confirm key
          </Button>
        </>
      )}
    </div>
  );
}
