/**
 * Confirm-it's-you (Plan 2 P2-C2 / X-4). `ConfirmSheet` is the only UI for an action-bound confirm:
 * it offers the account's own login methods and returns a single-use token bound to exactly the
 * `action`. `useConfirm` wires it to `withConfirm` from `@x2f/auth-client` — `prove` opens the
 * sheet and resolves once the person proves it's them.
 *
 * Strong methods (PGP key, passkey, security key) confirm at once; a password or an authenticator
 * code is accepted too, but for a new payout wallet that means the 24-hour wait (owner, 2026-10-23,
 * spec §6.3), so the sheet says so.
 */
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { confirmWithWebAuthn, describeAction, type ConfirmAction, type MethodType, type PgpChallenge } from '@x2f/auth-client';
import { Button } from '../../ui/Button.js';
import { Sheet } from '../../ui/Sheet.js';
import { authApi } from './authApi.js';

const STRONG: ReadonlySet<MethodType> = new Set<MethodType>(['pgp', 'passkey', 'security-key']);

type Resolver = { resolve: (token: string) => void; reject: (reason: unknown) => void };

/** The methods a confirm can use (PGP, passkey, security key, or password + any authenticator code). */
async function accountMethods(): Promise<MethodType[]> {
  const me = await authApi.me();
  return me.methods;
}

export function ConfirmSheet({
  action,
  methods,
  onToken,
  onCancel,
}: {
  action: ConfirmAction;
  methods: MethodType[];
  onToken: (token: string) => void;
  onCancel: () => void;
}) {
  const hasPassword = methods.includes('password');
  const hasTotp = methods.includes('totp');
  const [busy, setBusy] = useState<MethodType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  // PGP confirm is two steps: ask for a challenge, then take the decrypted code.
  const [pgp, setPgp] = useState<PgpChallenge | null>(null);
  const [pgpCode, setPgpCode] = useState('');

  const run = useCallback(
    async (method: MethodType, fn: () => Promise<string>) => {
      setBusy(method);
      setError(null);
      try {
        onToken(await fn());
      } catch {
        setError('That did not work. Try again, or use another method.');
        setBusy(null);
      }
    },
    [onToken],
  );

  const webauthn = (kind: Extract<MethodType, 'passkey' | 'security-key'>) =>
    void run(kind, () => confirmWithWebAuthn(authApi, action));

  const startPgp = async () => {
    setBusy('pgp');
    setError(null);
    try {
      setPgp(await authApi.confirmPgpStart({ action }));
    } catch {
      setError('Could not start the PGP check. Try again.');
    } finally {
      setBusy(null);
    }
  };

  const finishPgp = () =>
    void run('pgp', async () => (await authApi.confirmPgpFinish({ challengeId: pgp!.challengeId, code: pgpCode })).confirmToken);

  const finishPassword = () =>
    void run('password', async () =>
      (await authApi.confirmPassword({ password, action, ...(hasTotp && totp !== '' ? { totp } : {}) })).confirmToken,
    );

  const strongAvailable = methods.some((m) => STRONG.has(m));

  return (
    <Sheet open title="Confirm it's you" onClose={onCancel}>
      <p className="x2f-sheet__body" data-part="action">
        To {describeAction(action)}, confirm it's you.
      </p>
      {action.kind === 'add-wallet' ? (
        <p className="x2f-note" data-part="wallet-wait">
          {strongAvailable
            ? hasPassword || hasTotp
              ? 'Confirm with your PGP key, passkey or security key and this wallet works at once. Confirming with your password instead means a 24-hour wait.'
              : 'Confirm with your PGP key, passkey or security key and this wallet works at once.'
            : 'With a password or an authenticator code, a new payout wallet waits 24 hours. Add a passkey, security key or PGP key to skip the wait.'}
        </p>
      ) : null}

      {error !== null ? (
        <p className="x2f-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="x2f-stack">
        {methods.includes('passkey') ? (
          <Button variant="secondary" disabled={busy !== null} onClick={() => webauthn('passkey')} data-method="passkey">
            Use your passkey
          </Button>
        ) : null}
        {methods.includes('security-key') ? (
          <Button variant="secondary" disabled={busy !== null} onClick={() => webauthn('security-key')} data-method="security-key">
            Use your security key
          </Button>
        ) : null}

        {methods.includes('pgp') ? (
          pgp === null ? (
            <Button variant="secondary" disabled={busy !== null} onClick={() => void startPgp()} data-method="pgp">
              Use your PGP key
            </Button>
          ) : (
            <div className="x2f-field" data-method="pgp-code">
              <label className="x2f-label" htmlFor="confirm-pgp-message">
                Decrypt this message and paste the code
              </label>
              <pre className="x2f-pre" id="confirm-pgp-message" data-part="pgp-message">
                {pgp.encryptedMessage}
              </pre>
              <input
                className="x2f-input"
                inputMode="text"
                autoComplete="off"
                aria-label="Login code"
                value={pgpCode}
                onChange={(e) => setPgpCode(e.target.value)}
              />
              <Button variant="primary" disabled={busy !== null || pgpCode.trim() === ''} onClick={finishPgp}>
                Confirm
              </Button>
            </div>
          )
        ) : null}

        {hasPassword ? (
          <div className="x2f-field" data-method="password">
            <label className="x2f-label" htmlFor="confirm-password">
              Your password
            </label>
            <input
              className="x2f-input"
              id="confirm-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {hasTotp ? (
              <>
                <label className="x2f-label" htmlFor="confirm-totp">
                  Authenticator code
                </label>
                <input
                  className="x2f-input"
                  id="confirm-totp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={totp}
                  onChange={(e) => setTotp(e.target.value)}
                />
              </>
            ) : null}
            <Button variant="primary" disabled={busy !== null || password === ''} onClick={finishPassword}>
              Confirm
            </Button>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

/** A `ReactNode` to render and a `prove` callback for `withConfirm`; `prove` opens the sheet once. */
export function useConfirm(): { prove: (action: ConfirmAction) => Promise<string>; confirmUi: ReactNode } {
  const [state, setState] = useState<{ action: ConfirmAction; methods: MethodType[] } | null>(null);
  const pending = useRef<Resolver | null>(null);

  const settle = useCallback((token: string | null) => {
    const p = pending.current;
    pending.current = null;
    setState(null);
    if (p === null) return;
    if (token === null) p.reject(new Error('confirm cancelled'));
    else p.resolve(token);
  }, []);

  const prove = useCallback(
    async (action: ConfirmAction): Promise<string> =>
      new Promise<string>((resolve, reject) => {
        pending.current = { resolve, reject };
        accountMethods().then(
          (methods) => setState({ action, methods }),
          (e: unknown) => {
            pending.current = null;
            reject(e);
          },
        );
      }),
    [settle],
  );

  const confirmUi =
    state === null ? null : (
      <ConfirmSheet action={state.action} methods={state.methods} onToken={(t) => settle(t)} onCancel={() => settle(null)} />
    );

  return { prove, confirmUi };
}
