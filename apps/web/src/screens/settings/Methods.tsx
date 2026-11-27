/**
 * Login methods (Task 30): the list, adding one, and removing one. Adding a method needs
 * confirm-it's-you outside the sign-up window, so every add goes through `withConfirm` and the
 * shared `ConfirmSheet` (passed in as `prove`). The server refuses removing the last way to log in
 * with `last-login-method`; the screen shows that plainly rather than letting someone lock
 * themselves out. TOTP enrolment and recovery codes are their own screens.
 *
 * Owner, 26 Nov 2026: no passwords. An account keeps at least two kinds of login method, one of them
 * a key (`@x2f/accounts` enoughMethods); removing one that would break that is refused here first
 * and by the API (409 `two-methods-required`). One authenticator app at most.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  AuthApiError,
  addWebAuthnKeyWithId,
  defaultKeyName,
  enoughMethods,
  normalizeLoginCode,
  withConfirm,
  type ConfirmAction,
  type MethodEntry,
  type MethodType,
  type WebAuthnKind,
} from '@x2f/auth-client';
import { Button } from '../../ui/Button.js';
import { KeySaved } from '../auth/KeySaved.js';
import { CantDoThat } from '../../ui/CantDoThat.js';
import { CANT_DO_TITLE, LAST_METHOD_CODE, LAST_METHOD_MESSAGE, SECOND_METHOD_CODE, SECOND_METHOD_REMOVE } from '../../ui/cantDoCodes.js';
import { isConfirmAbort, usePrimaryVariant } from '../auth/ConfirmSheet.js';
import { authApi } from '../auth/authApi.js';
import { keyErrorText } from '../auth/keyErrors.js';
import { refusalText } from '../auth/refusals.js';
import { RecoveryCodes } from './RecoveryCodes.js';
import { Totp } from './Totp.js';
import { MessageBox } from '../../ui/MessageBox.js';
import { KeyEmailNote, useKeyCheck } from '../setup/PgpKey.js';

const LABELS: Record<MethodType, string> = {
  pgp: 'PGP key',
  passkey: 'Passkey',
  'security-key': 'Security key',
  totp: 'Authenticator app',
  // COPY-UNSIGNED (singular: owner demo note #28, 12 Nov 2026)
  'recovery-codes': 'Recovery code',
};


/** The methods that log in on their own; an authenticator app and recovery codes only back them up. */
const LOGIN_METHODS: readonly MethodType[] = ['pgp', 'passkey', 'security-key'];

/**
 * True when `m` is the account's only way to log in, so removing it is refused at once, before any
 * confirm round-trip. The server still decides every other case (staff minimums, for one).
 */
export function isOnlyLogin(m: MethodEntry, all: readonly MethodEntry[]): boolean {
  return LOGIN_METHODS.includes(m.type) && all.filter((x) => LOGIN_METHODS.includes(x.type)).length === 1;
}

/**
 * True when removing `m` would leave fewer than two kinds of login method, or none of them a key
 * (owner, 26 Nov 2026). The server decides the rest.
 */
export function leavesTooFew(m: MethodEntry, all: readonly MethodEntry[]): boolean {
  const i = all.indexOf(m);
  return !enoughMethods(all.filter((_, j) => j !== i).map((x) => x.type));
}

type Adding = 'none' | 'pgp' | 'totp' | 'recovery-codes';

export function Methods({ prove }: { prove: (action: ConfirmAction) => Promise<string> }) {
  const [methods, setMethods] = useState<MethodEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 409 `last-login-method` (or the same check here first): CantDoThat until closed (Plan 5 Task 21).
  const [lastMethod, setLastMethod] = useState(false);
  // 409 `two-methods-required` (or the same check here first): two kinds stay on the account.
  const [tooFew, setTooFew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<Adding>('none');
  const done = () => {
    void refresh().finally(() => setAdding('none'));
  };

  const refresh = useCallback(async () => {
    setMethods(await authApi.listMethods());
  }, []);

  useEffect(() => {
    void refresh().catch(() => setError('Could not load your login methods.'));
  }, [refresh]);

  /**
   * The passkey or security key just added here: acknowledged and named (owner 25 Nov
   * security-key report), a security key then offered for a test (owner demo note #94); null otherwise.
   */
  const [justAdded, setJustAdded] = useState<{ kind: WebAuthnKind; credentialId: string; defaultName: string } | null>(null);

  const addWebAuthn = async (kind: WebAuthnKind) => {
    setBusy(true);
    setError(null);
    setJustAdded(null);
    try {
      const { credentialId } = await withConfirm(
        { kind: 'add-method', method: kind },
        (t) => addWebAuthnKeyWithId(authApi, kind, t !== undefined ? { confirmToken: t } : {}),
        prove,
      );
      // Security review of wip/lead-seckey-fix: the key is saved even when the list cannot be read
      // now, so it is still acknowledged and named (never added twice); its number is then a guess.
      let count = 1;
      try {
        const list = await authApi.listMethods();
        setMethods(list);
        count = list.filter((m) => m.type === kind).length;
      } catch {
        // The list stays as it was; the name step still shows.
      }
      setJustAdded({ kind, credentialId, defaultName: defaultKeyName(kind, count) });
    } catch (e) {
      if (!isConfirmAbort(e)) setError(keyErrorText(e, kind));
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
    if (methods !== null && leavesTooFew(m, methods)) {
      setTooFew(true);
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
      if (e instanceof AuthApiError && e.code === LAST_METHOD_CODE) setLastMethod(true);
      else if (e instanceof AuthApiError && e.code === SECOND_METHOD_CODE) setTooFew(true);
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
      {justAdded !== null ? (
        <div data-part="key-just-added">
          <KeySaved
            key={justAdded.credentialId}
            kind={justAdded.kind}
            credentialId={justAdded.credentialId}
            defaultName={justAdded.defaultName}
            continueLabel="Done"
            onNamed={() => void refresh()}
            onContinue={() => setJustAdded(null)}
          />
        </div>
      ) : null}
      {lastMethod ? <CantDoThat title={CANT_DO_TITLE.methods} body={LAST_METHOD_MESSAGE} from={LAST_METHOD_CODE} onClose={() => setLastMethod(false)} /> : null}
      {tooFew ? <CantDoThat title={CANT_DO_TITLE.methods} body={SECOND_METHOD_REMOVE} from={SECOND_METHOD_CODE} onClose={() => setTooFew(false)} /> : null}

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
        {/* Owner, 26 Nov 2026: one authenticator app at most. */}
        {methods !== null && !methods.some((x) => x.type === 'totp') ? (
          <Button variant="secondary" disabled={busy} onClick={() => setAdding('totp')} data-add="totp">
            Add an authenticator app
          </Button>
        ) : null}
        {/* COPY-UNSIGNED (singular: owner demo note #28, 12 Nov 2026) */}
        <Button variant="secondary" disabled={busy} onClick={() => setAdding('recovery-codes')} data-add="recovery-codes">
          Create recovery code
        </Button>
      </div>

      {adding === 'pgp' ? (
        <AddPgpKey prove={prove} onDone={done} onCancel={() => setAdding('none')} />
      ) : null}
      {adding === 'totp' ? <Totp prove={prove} onDone={done} onCancel={() => setAdding('none')} /> : null}
      {adding === 'recovery-codes' ? <RecoveryCodes prove={prove} onDone={() => setAdding('none')} /> : null}
    </section>
  );
}

/** Exported for its tests (owner demo note #144). */
export function AddPgpKey({ prove, onDone, onCancel }: { prove: (a: ConfirmAction) => Promise<string>; onDone: () => void; onCancel: () => void }) {
  const primary = usePrimaryVariant();
  const [publicKey, setPublicKey] = useState('');
  const [message, setMessage] = useState<{ challengeId: string; encryptedMessage: string } | null>(null);
  // Owner demo note #225 (25 Nov): a Copy message button, as on the login screen.
  const [copied, setCopied] = useState(false);
  const copyMessage = () => {
    void navigator.clipboard?.writeText(message?.encryptedMessage ?? '').then(
      () => setCopied(true),
      () => undefined,
    );
  };
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Owner demo note #144: the same check as setup, on the device as the key is pasted (the server
  // checks again and is the one that decides). Add key waits for the result of the text shown.
  const { check, checking } = useKeyCheck(publicKey);

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
      setCopied(false);
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
          {check !== null && !check.ok ? (
            <p className="x2f-error" role="alert" data-part="key-refused">
              {check.detail}
            </p>
          ) : null}
          <KeyEmailNote check={check} />
          <div className="x2f-row">
            <Button variant={primary} disabled={busy || publicKey.trim() === '' || checking || (check !== null && !check.ok)} onClick={() => void start()}>
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
          {/* COPY-UNSIGNED (owner demo note #225): the same words as the login screen's button. */}
          <Button variant="secondary" onClick={copyMessage} data-part="copy">
            {copied ? 'Copied' : 'Copy message'}
          </Button>
          <input className="x2f-input" aria-label="Login code" value={code} onChange={(e) => setCode(e.target.value)} />
          {/* Owner demo note #219: Confirm key waits for a whole login code (the server's normalizeLoginCode). */}
          <Button variant={primary} disabled={busy || normalizeLoginCode(code) === null} onClick={() => void finish()}>
            Confirm key
          </Button>
        </>
      )}
    </div>
  );
}
