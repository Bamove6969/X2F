/**
 * Login methods (Task 30): the list, adding one, and removing one. Adding a method needs
 * confirm-it's-you outside the sign-up window, so every add goes through `withConfirm` and the
 * shared `ConfirmSheet` (passed in as `prove`). The server refuses removing the last way to log in
 * with `last-login-method`; the screen shows that plainly rather than letting someone lock
 * themselves out. TOTP enrolment and recovery codes are their own screens.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  AuthApiError,
  addWebAuthnKey,
  withConfirm,
  type ConfirmAction,
  type MethodEntry,
  type MethodType,
  type WebAuthnKind,
} from '@x2f/auth-client';
import { Button } from '../../ui/Button.js';
import { isConfirmAbort, usePrimaryVariant } from '../auth/ConfirmSheet.js';
import { authApi } from '../auth/authApi.js';
import { refusalText } from '../auth/refusals.js';
import { RecoveryCodes } from './RecoveryCodes.js';
import { Totp } from './Totp.js';

const LABELS: Record<MethodType, string> = {
  pgp: 'PGP key',
  passkey: 'Passkey',
  'security-key': 'Security key',
  password: 'Password',
  totp: 'Authenticator app',
  'recovery-codes': 'Recovery codes',
};

const LAST_METHOD_MESSAGE = 'That is your only way to log in. Add another login method before removing this one.';

/** The methods that log in on their own; an authenticator app and recovery codes only back them up. */
const LOGIN_METHODS: readonly MethodType[] = ['pgp', 'passkey', 'security-key', 'password'];

/**
 * True when `m` is the account's only way to log in, so removing it is refused at once, before any
 * confirm round-trip. The server still decides every other case (staff minimums, for one).
 */
export function isOnlyLogin(m: MethodEntry, all: readonly MethodEntry[]): boolean {
  return LOGIN_METHODS.includes(m.type) && all.filter((x) => LOGIN_METHODS.includes(x.type)).length === 1;
}

type Adding = 'none' | 'password' | 'pgp' | 'totp' | 'recovery-codes';

export function Methods({ prove }: { prove: (action: ConfirmAction) => Promise<string> }) {
  const [methods, setMethods] = useState<MethodEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<Adding>('none');

  const refresh = useCallback(async () => {
    setMethods(await authApi.listMethods());
  }, []);

  useEffect(() => {
    void refresh().catch(() => setError('Could not load your login methods.'));
  }, [refresh]);

  const addWebAuthn = async (kind: WebAuthnKind) => {
    setBusy(true);
    setError(null);
    try {
      await withConfirm({ kind: 'add-method', method: kind }, (t) => addWebAuthnKey(authApi, kind, t !== undefined ? { confirmToken: t } : {}), prove);
      await refresh();
    } catch (e) {
      if (!isConfirmAbort(e)) setError(refusalText(e, 'Could not add that method. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (m: MethodEntry) => {
    if (methods !== null && isOnlyLogin(m, methods)) {
      setError(LAST_METHOD_MESSAGE);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await withConfirm(
        { kind: 'remove-method', method: m.type, id: m.id },
        (t) => authApi.removeMethod(m.type, m.id, t !== undefined ? { confirmToken: t } : {}),
        prove,
      );
      await refresh();
    } catch (e) {
      if (e instanceof AuthApiError && e.code === 'last-login-method') setError(LAST_METHOD_MESSAGE);
      else if (!isConfirmAbort(e)) setError(refusalText(e, 'Could not remove that method. Try again.'));
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
        <Button variant="secondary" disabled={busy} onClick={() => setAdding('totp')} data-add="totp">
          Add an authenticator app
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => setAdding('recovery-codes')} data-add="recovery-codes">
          Create recovery codes
        </Button>
      </div>

      {adding === 'password' ? (
        <AddPassword prove={prove} onDone={() => void refresh().finally(() => setAdding('none'))} onCancel={() => setAdding('none')} />
      ) : null}
      {adding === 'pgp' ? (
        <AddPgpKey prove={prove} onDone={() => void refresh().finally(() => setAdding('none'))} onCancel={() => setAdding('none')} />
      ) : null}
      {adding === 'totp' ? <Totp prove={prove} onDone={() => void refresh().finally(() => setAdding('none'))} onCancel={() => setAdding('none')} /> : null}
      {adding === 'recovery-codes' ? <RecoveryCodes prove={prove} onDone={() => setAdding('none')} /> : null}
    </section>
  );
}

function AddPassword({ prove, onDone, onCancel }: { prove: (a: ConfirmAction) => Promise<string>; onDone: () => void; onCancel: () => void }) {
  const primary = usePrimaryVariant();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await withConfirm({ kind: 'set-password' }, (t) => authApi.setPassword({ password, ...(t !== undefined ? { confirmToken: t } : {}) }), prove);
      onDone();
    } catch (e) {
      if (e instanceof AuthApiError && e.code === 'password-weak') setError('That password is too weak: use at least 10 characters with upper and lower case, a number and a symbol.');
      else if (e instanceof AuthApiError && e.code === 'password-leaked') setError('That password has been seen in a breach. Pick another.');
      else if (!isConfirmAbort(e)) setError(refusalText(e, 'Could not set a password. Try again.'));
    } finally {
      setBusy(false);
    }
  };

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
      <input className="x2f-input" id="new-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <div className="x2f-row">
        <Button variant={primary} disabled={busy || password === ''} onClick={() => void save()}>
          Save
        </Button>
        <Button variant="quiet" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function AddPgpKey({ prove, onDone, onCancel }: { prove: (a: ConfirmAction) => Promise<string>; onDone: () => void; onCancel: () => void }) {
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
      await authApi.addPgpKeyFinish({ challengeId: message!.challengeId, code: code.trim() });
      onDone();
    } catch (e) {
      setError(refusalText(e, 'That code did not work. It may have expired.', { expired: 'That message has expired. Start again for a new one.' }));
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
          <pre className="x2f-pre" id="add-pgp-message">
            {message.encryptedMessage}
          </pre>
          <input className="x2f-input" aria-label="Login code" value={code} onChange={(e) => setCode(e.target.value)} />
          <Button variant={primary} disabled={busy || code.trim() === ''} onClick={() => void finish()}>
            Confirm key
          </Button>
        </>
      )}
    </div>
  );
}
