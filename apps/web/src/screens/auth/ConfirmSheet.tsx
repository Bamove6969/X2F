/**
 * Confirm-it's-you (Plan 2 P2-C2 / X-4). `ConfirmSheet` is the only UI for an action-bound confirm:
 * it offers the account's own login methods and returns a single-use token bound to exactly the
 * `action`. `useConfirm` wires it to `withConfirm` from `@x2f/auth-client` — `prove` opens the
 * sheet and resolves once the person proves it's them.
 *
 * A wrong password or code stays in the sheet as an error (the person tries again or picks another
 * method); only closing the sheet rejects. One confirm is open at a time: a second `prove` while one
 * is open is refused with `confirm busy`, so the one on screen is never orphaned.
 *
 * For new payout wallets the sheet explains what will happen, from `GET /v1/wallets/rule` (owner,
 * 2026-10-23/24): the first wallet never waits; a strong method used now (PGP key, passkey,
 * security key) works at once; a password or authenticator code means the wait, shared by a batch.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { confirmWithWebAuthn, describeAction, needsStrongConfirm, type ConfirmAction, type MethodType, type PgpChallenge, type WalletRule } from '@x2f/auth-client';
import { Button, type ButtonVariant } from '../../ui/Button.js';
import { Sheet } from '../../ui/Sheet.js';
import { authApi } from './authApi.js';
import { refusalText } from './refusals.js';

type Resolver = { resolve: (token: string) => void; reject: (reason: unknown) => void };

/** Errors `prove` rejects with; callers treat both as "nothing to report". */
export const CONFIRM_CANCELLED = 'confirm cancelled';
export const CONFIRM_BUSY = 'confirm busy';

export function isConfirmAbort(e: unknown): boolean {
  return e instanceof Error && (e.message === CONFIRM_CANCELLED || e.message === CONFIRM_BUSY);
}

/** True while a confirm sheet is open, so a form behind it drops its primary (one primary per state). */
const ConfirmOpen = createContext(false);

/** Wrap a screen in this with `useConfirm().open`, so its forms can call `usePrimaryVariant`. */
export const ConfirmOpenProvider = ConfirmOpen.Provider;

/** The variant for a screen's main button: primary, unless a confirm sheet is open over it. */
export function usePrimaryVariant(): ButtonVariant {
  return useContext(ConfirmOpen) ? 'secondary' : 'primary';
}

const STRONG_WORDS: Record<WalletRule['strongMethods'][number], string> = {
  pgp: 'PGP key',
  passkey: 'passkey',
  'security-key': 'security key',
};

const orList = (xs: string[]): string => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`);

/** What adding wallet(s) will do for this account, in one or two sentences. */
export function walletWaitNote(rule: WalletRule, batch: boolean): string {
  const it = batch ? 'these wallets' : 'this wallet';
  if (rule.firstWallet) return 'This is your first payout wallet, so it works at once however you confirm.';
  const wait = `${rule.waitHours}-hour wait`;
  if (rule.strongMethods.length > 0) {
    const strong = `Confirm with your ${orList(rule.strongMethods.map((m) => STRONG_WORDS[m]))} and ${it} ${batch ? 'work' : 'works'} at once.`;
    return rule.password === 'waits' ? `${strong} Confirming with your password instead means a ${wait}${batch ? ', shared by all of them' : ''}.` : strong;
  }
  // DESIGN: wording (owner 6 Nov 2026, Q14: never "password only")
  return `You have no passkey, security key or PGP key yet, so ${it} will work ${rule.waitHours} hours after you add ${batch ? 'them, all on one shared wait' : 'it'}. Add one first to skip the wait.`;
}

function WalletWaitNote({ batch }: { batch: boolean }) {
  const [rule, setRule] = useState<WalletRule | null>(null);
  useEffect(() => {
    let live = true;
    authApi.getWalletRule().then(
      (r) => {
        if (live) setRule(r);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  if (rule === null) return null;
  return (
    <p className="x2f-note" data-part="wallet-wait">
      {walletWaitNote(rule, batch)}
    </p>
  );
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
  const walletAdd = action.kind === 'add-wallet' || action.kind === 'add-wallets';
  return (
    <Sheet open title="Confirm it's you" onClose={onCancel}>
      <p className="x2f-sheet__body" data-part="action">
        To {describeAction(action)}, confirm it's you.
      </p>
      {walletAdd ? <WalletWaitNote batch={action.kind === 'add-wallets'} /> : null}
      <ConfirmMethods action={action} methods={methods} onToken={onToken} />
    </Sheet>
  );
}

/**
 * The account's own login methods for one action-bound confirm, with their errors: the body of
 * `ConfirmSheet`, and of "Stay logged in?" (`SessionPrompt`, owner 2 Nov 2026), which names the
 * password's button `submitLabel`. `onToken` gets the single-use token.
 */
export function ConfirmMethods({
  action,
  methods,
  onToken,
  submitLabel = 'Confirm',
}: {
  action: ConfirmAction;
  methods: MethodType[];
  onToken: (token: string) => void | Promise<void>;
  submitLabel?: string;
}) {
  // Owner 2 Nov 2026: some actions (switching to vendor) only a passkey, security key or PGP key confirms.
  const hasPassword = methods.includes('password') && !needsStrongConfirm(action);
  // Owner G10 (7 Nov 2026): the password alone keeps you logged in, authenticator app or not.
  const hasTotp = methods.includes('totp') && action.kind !== 'extend-session';
  const [busy, setBusy] = useState<MethodType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  // PGP confirm is two steps: ask for a challenge, then take the decrypted code.
  const [pgp, setPgp] = useState<PgpChallenge | null>(null);
  const [pgpCode, setPgpCode] = useState('');

  const run = useCallback(
    async (method: MethodType, fn: () => Promise<string>, wrong: string) => {
      setBusy(method);
      setError(null);
      try {
        await onToken(await fn());
      } catch (e) {
        // A held backup session or too many tries says so; a plain miss reads `wrong`.
        setError(refusalText(e, wrong));
        setBusy(null);
      }
    },
    [onToken],
  );

  const webauthn = (kind: Extract<MethodType, 'passkey' | 'security-key'>) =>
    void run(kind, () => confirmWithWebAuthn(authApi, action), 'That did not work. Try again, or use another method.');

  const startPgp = async () => {
    setBusy('pgp');
    setError(null);
    try {
      setPgp(await authApi.confirmPgpStart({ action }));
      setPgpCode('');
    } catch (e) {
      setError(refusalText(e, 'Could not start the PGP check. Try again.'));
    } finally {
      setBusy(null);
    }
  };

  const finishPgp = () =>
    void run(
      'pgp',
      async () => (await authApi.confirmPgpFinish({ challengeId: pgp!.challengeId, code: pgpCode.trim() })).confirmToken,
      'That code did not work. It may have expired: get a new message and try again.',
    );

  // With an authenticator app the server needs its code with the password (the password without it is a
  // miss and counts as one), so Confirm waits for both and always sends the code.
  const passwordReady = password !== '' && (!hasTotp || totp.trim() !== '');

  const finishPassword = () =>
    void run(
      'password',
      async () => (await authApi.confirmPassword({ password, action, ...(hasTotp ? { totp: totp.trim() } : {}) })).confirmToken,
      hasTotp ? 'That password or authenticator code did not work. Try again.' : 'That password did not work. Try again.',
    );

  // Exactly one primary in the sheet: the PGP Confirm while a PGP challenge is up, else the password Confirm.
  const pgpPrimary = pgp !== null;

  return (
    <>
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
              <input className="x2f-input" inputMode="text" autoComplete="off" aria-label="Login code" value={pgpCode} onChange={(e) => setPgpCode(e.target.value)} />
              <Button variant="primary" disabled={busy !== null || pgpCode.trim() === ''} onClick={finishPgp}>
                Confirm
              </Button>
              <Button variant="quiet" disabled={busy !== null} onClick={() => void startPgp()}>
                Get a new message
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
            <Button
              variant={pgpPrimary ? 'secondary' : 'primary'}
              disabled={busy !== null || !passwordReady}
              onClick={finishPassword}
              data-part="confirm-password"
            >
              {submitLabel}
            </Button>
          </div>
        ) : null}
      </div>
    </>
  );
}

/**
 * A `prove` callback for `withConfirm`, the sheet to render, and `open` for `ConfirmOpenProvider`
 * (so the screen's own primary button steps down while the sheet is open). `prove` opens the sheet
 * once; a second call while it is open rejects with `confirm busy`.
 */
export function useConfirm(): { prove: (action: ConfirmAction) => Promise<string>; confirmUi: ReactNode; open: boolean } {
  const [state, setState] = useState<{ action: ConfirmAction; methods: MethodType[] } | null>(null);
  const pending = useRef<Resolver | null>(null);

  const settle = useCallback((token: string | null) => {
    const p = pending.current;
    pending.current = null;
    setState(null);
    if (p === null) return;
    if (token === null) p.reject(new Error(CONFIRM_CANCELLED));
    else p.resolve(token);
  }, []);

  const prove = useCallback(
    async (action: ConfirmAction): Promise<string> =>
      new Promise<string>((resolve, reject) => {
        if (pending.current !== null) {
          reject(new Error(CONFIRM_BUSY));
          return;
        }
        pending.current = { resolve, reject };
        authApi.me().then(
          (me) => setState({ action, methods: me.methods }),
          (e: unknown) => {
            pending.current = null;
            reject(e);
          },
        );
      }),
    [],
  );

  const confirmUi =
    state === null ? null : <ConfirmSheet action={state.action} methods={state.methods} onToken={(t) => settle(t)} onCancel={() => settle(null)} />;

  return { prove, confirmUi, open: state !== null };
}
