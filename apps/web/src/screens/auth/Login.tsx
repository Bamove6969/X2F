/**
 * The login screen (Task 30, P3-C4). Four ways in: PGP (paste your key, decrypt the message, paste
 * the code — no login name, owner 2026-10-23), a passkey, a security key, or a login name and
 * password. A password login may ask for an authenticator code. "Use a backup" leads to the
 * recovery-code / TOTP screen. A trader logging in on a new device while logged in elsewhere waits
 * for that device's approval (Plan 2 Task 16, `ApproveOnDevice`). After a login the Terms screen comes first when they have changed
 * (R10), otherwise the page returns to wherever the session expired (`returnTo`).
 */
import { useCallback, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { startAuthentication } from '@simplewebauthn/browser';
import { loginWithPasskey, loginWithSecurityKey, type ApprovalWait, type LoginResult, type MethodType, type PgpChallenge } from '@x2f/auth-client';
import { returnToFrom } from '../../api/client.js';
import { Button } from '../../ui/Button.js';
import { ApproveOnDevice } from './ApproveOnDevice.js';
import { afterLogin, authApi, deviceLabel, passwordLogin, pgpLoginFinish, pgpLoginStart } from './authApi.js';
import { loginFailure, shouldSendAway } from './loginRules.js';
import { isExpired, loginCantDo, refusalText } from './refusals.js';
import { CantDoThat } from '../../ui/CantDoThat.js';
import { CANT_DO_TITLE, type CantDoCode } from '../../ui/cantDoCodes.js';
import '../screens.css';

/**
 * Where a visitor is sent once the server says this browser has missed the password about ten
 * times in a row (spec §6.3, owner 2026-10-23): off the site entirely, to a neutral page.
 */
export const AWAY_URL = 'https://duckduckgo.com/';

type Method = 'choose' | 'pgp' | 'passkey' | 'security-key' | 'password';

export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = returnToFrom(location.search);
  const [method, setMethod] = useState<Method>('choose');
  const [waiting, setWaiting] = useState<ApprovalWait | null>(null);
  // Plan 2 Task 16 / Plan 5 Task 21: a login refused by a rule (the device limit, the hourly cap on approvals).
  const [cantDo, setCantDo] = useState<{ code: CantDoCode; text: string } | null>(null);

  const onLoggedIn = useCallback(() => void afterLogin((to) => navigate(to), returnTo), [navigate, returnTo]);
  const onCantDo = useCallback((e: unknown) => {
    const c = loginCantDo(e, 'login');
    if (c !== null) setCantDo(c);
    return c !== null;
  }, []);
  const go = { onLoggedIn, onWait: setWaiting, onCantDo };

  if (waiting !== null) {
    return (
      <main className="x2f-screen" data-screen="login">
        <h1 className="x2f-screen__title">Log in</h1>
        <ApproveOnDevice
          key={waiting.approvalId}
          wait={waiting}
          returnTo={returnTo}
          onLoggedIn={onLoggedIn}
          onRestart={() => {
            setWaiting(null);
            setMethod('choose');
          }}
        />
      </main>
    );
  }

  return (
    <main className="x2f-screen" data-screen="login">
      <h1 className="x2f-screen__title">Log in</h1>

      {method === 'choose' ? (
        <div className="x2f-stack">
          <Button variant="primary" onClick={() => setMethod('pgp')} data-method="pgp">
            Log in with PGP
          </Button>
          <Button variant="secondary" onClick={() => setMethod('passkey')} data-method="passkey">
            Log in with a passkey
          </Button>
          <Button variant="secondary" onClick={() => setMethod('security-key')} data-method="security-key">
            Log in with a security key
          </Button>
          <Button variant="secondary" onClick={() => setMethod('password')} data-method="password">
            Log in with a password
          </Button>
        </div>
      ) : (
        <Button variant="quiet" onClick={() => setMethod('choose')} data-part="back">
          Choose another way
        </Button>
      )}

      {method === 'pgp' ? <PgpLogin {...go} /> : null}
      {method === 'passkey' ? <PasskeyLogin {...go} /> : null}
      {method === 'security-key' ? <SecurityKeyLogin {...go} /> : null}
      {method === 'password' ? <PasswordLogin {...go} /> : null}

      {cantDo !== null ? <CantDoThat title={CANT_DO_TITLE.login} body={cantDo.text} from={cantDo.code} onClose={() => setCantDo(null)} /> : null}

      <p className="x2f-screen__foot">
        <Link className="x2f-link" to={`/login/backup?returnTo=${encodeURIComponent(returnTo)}`} data-part="use-backup">
          Use a backup
        </Link>
      </p>
    </main>
  );
}

function ErrorLine({ error, part }: { error: string | null; part?: string }) {
  if (error === null) return null;
  return (
    <p className="x2f-error" role="alert" {...(part !== undefined ? { 'data-part': part } : {})}>
      {error}
    </p>
  );
}

/** What a login step does next: open the app, or wait for a logged-in device's approval (Task 16). */
interface Go {
  onLoggedIn: () => void;
  onWait: (w: ApprovalWait) => void;
  /** Shows a rule's refusal in CantDoThat; false when `e` is not one (the step words it inline). */
  onCantDo: (e: unknown) => boolean;
}

/** A two-factor login waiting for its second step: the account's `pendingId` and what it `needs`. */
interface Pending {
  pendingId: string;
  needs: MethodType[];
}

const NEEDS_WORDS: Partial<Record<MethodType, string>> = { pgp: 'PGP key', 'security-key': 'security key', passkey: 'passkey' };

/**
 * The second step of a two-factor login (staff and the owner: PGP plus a security key, two PGP
 * keys, or PGP plus a passkey). It offers exactly what the server `needs`; the `pendingId` from the
 * first step names the account, so no login name is asked for.
 */
function SecondStep({ pending, onLoggedIn, onWait, onCantDo }: { pending: Pending } & Go) {
  const offered = pending.needs.filter((m): m is 'pgp' | 'security-key' | 'passkey' => m in NEEDS_WORDS);
  const words = offered.map((m) => NEEDS_WORDS[m]!).join(' or ');
  return (
    <div className="x2f-field" data-part="second-step">
      {offered.length === 0 ? (
        <p className="x2f-note">{/* not-a-refusal: an account state this screen cannot handle; staff support helps */}This account needs another step that this screen cannot do. Ask X2F staff support.</p>
      ) : (
        <p className="x2f-note">This account also needs its {words}.</p>
      )}
      {offered.includes('pgp') ? <PgpLogin onLoggedIn={onLoggedIn} onWait={onWait} onCantDo={onCantDo} pendingId={pending.pendingId} /> : null}
      {/* One orange action: PGP's when it is offered, else the first key's. */}
      {offered.includes('security-key') ? (
        <SecondStepKey kind="security-key" primary={!offered.includes('pgp')} pendingId={pending.pendingId} onLoggedIn={onLoggedIn} onWait={onWait} onCantDo={onCantDo} />
      ) : null}
      {offered.includes('passkey') ? (
        <SecondStepKey kind="passkey" primary={!offered.includes('pgp') && !offered.includes('security-key')} pendingId={pending.pendingId} onLoggedIn={onLoggedIn} onWait={onWait} onCantDo={onCantDo} />
      ) : null}
    </div>
  );
}

function SecondStepKey({ kind, primary, pendingId, onLoggedIn, onWait, onCantDo }: { kind: 'security-key' | 'passkey'; primary: boolean; pendingId: string } & Go) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = kind === 'passkey' ? 'passkey' : 'security key';

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const { challengeId, options } = await authApi.loginWebAuthnStart({ pendingId });
      const response = await startAuthentication({ optionsJSON: options });
      const result = await authApi.loginWebAuthnFinish({ challengeId, response, deviceLabel: deviceLabel(), pendingId });
      if (result.status === 'ok') onLoggedIn();
      else if (result.status === 'approve-on-device') onWait(result);
      // not-a-refusal: an account state this screen cannot handle; staff support helps
      else setError('This account needs another step that this screen cannot do. Ask X2F staff support.');
    } catch (e) {
      if (!onCantDo(e)) setError(refusalText(e, `That ${name} did not work. Try again.`, { expired: 'That login step has expired. Choose another way and start again.' }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="x2f-stack">
      <ErrorLine error={error} />
      <Button variant={primary ? 'primary' : 'secondary'} disabled={busy} onClick={() => void go()} data-part={kind === 'passkey' ? 'second-step-passkey' : 'second-step-key'}>
        Use your {name}
      </Button>
    </div>
  );
}

/** PGP login, or (with `pendingId`) the PGP second step of a two-factor login. */
function PgpLogin({ onLoggedIn, onWait, onCantDo, pendingId: first }: Go & { pendingId?: string }) {
  const [publicKey, setPublicKey] = useState('');
  const [challenge, setChallenge] = useState<PgpChallenge | null>(null);
  const [code, setCode] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      setChallenge(await pgpLoginStart(publicKey.trim(), first !== undefined ? { pendingId: first } : {}));
      setCode('');
      setCopied(false);
    } catch (e) {
      // An expired or revoked key is turned away with the reason (spec 6.2); a wait says how long.
      setError(refusalText(e, 'Could not send a login message for that key. Check the key and try again.'));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      const result: LoginResult = await pgpLoginFinish(challenge!.challengeId, code.trim());
      if (result.status === 'ok') onLoggedIn();
      else if (result.status === 'approve-on-device') onWait(result);
      else setPending({ pendingId: result.pendingId, needs: result.needs });
    } catch (e) {
      if (onCantDo(e)) return;
      setError(
        isExpired(e)
          ? 'That message has expired. Send a new message and try again.'
          : refusalText(e, 'That code did not work. It may have expired: send a new message and try again.'),
      );
    } finally {
      setBusy(false);
    }
  };

  const copy = () => {
    void navigator.clipboard?.writeText(challenge?.encryptedMessage ?? '').then(
      () => setCopied(true),
      () => undefined,
    );
  };

  if (pending !== null) return <SecondStep pending={pending} onLoggedIn={onLoggedIn} onWait={onWait} onCantDo={onCantDo} />;

  return (
    <section className="x2f-stack" data-part="pgp">
      <ErrorLine error={error} />
      {challenge === null ? (
        <div className="x2f-field">
          <label className="x2f-label" htmlFor="pgp-key">
            Your PGP public key
          </label>
          <textarea
            className="x2f-input x2f-textarea"
            id="pgp-key"
            rows={6}
            autoComplete="off"
            spellCheck={false}
            value={publicKey}
            onChange={(e) => setPublicKey(e.target.value)}
          />
          <p className="x2f-note">If your key contains an email address, X2F never shows or uses it.</p>
          <Button variant="primary" disabled={busy || publicKey.trim() === ''} onClick={() => void start()}>
            Send me a login message
          </Button>
        </div>
      ) : (
        <div className="x2f-field">
          <label className="x2f-label" htmlFor="pgp-message">
            Decrypt this message in your PGP app, then paste the code
          </label>
          <pre className="x2f-pre" id="pgp-message" data-part="pgp-message">
            {challenge.encryptedMessage}
          </pre>
          <Button variant="secondary" onClick={copy} data-part="copy">
            {copied ? 'Copied' : 'Copy message'}
          </Button>
          <input
            className="x2f-input"
            inputMode="text"
            autoComplete="off"
            aria-label="Login code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <Button variant="primary" disabled={busy || code.trim() === ''} onClick={() => void finish()} data-part="pgp-login">
            Log in
          </Button>
          <Button variant="quiet" disabled={busy} onClick={() => void start()} data-part="pgp-new-message">
            Send a new message
          </Button>
        </div>
      )}
    </section>
  );
}

function PasskeyLogin({ onLoggedIn, onWait, onCantDo }: Go) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await loginWithPasskey(authApi, deviceLabel());
      if (result.status === 'ok') onLoggedIn();
      else if (result.status === 'approve-on-device') onWait(result);
      // Unreachable today (Plan 2 Task 18 review M8): discoverable passkey login accepts trader
      // accounts only (the API's webauthn.ts), and a trader's passkey login is 'ok' or 'approve-on-device'. Should
      // the API ever answer a second step here, show it: the server still decides every pair.
      else setPending({ pendingId: result.pendingId, needs: result.needs });
    } catch (e) {
      if (!onCantDo(e)) setError(refusalText(e, 'That passkey did not work. Try again, or use another way in.'));
    } finally {
      setBusy(false);
    }
  };

  if (pending !== null) return <SecondStep pending={pending} onLoggedIn={onLoggedIn} onWait={onWait} onCantDo={onCantDo} />;

  return (
    <section className="x2f-stack" data-part="passkey">
      <ErrorLine error={error} />
      <p className="x2f-note">Your device or password manager picks the account.</p>
      <Button variant="primary" disabled={busy} onClick={() => void go()} data-part="passkey-login">
        Use a passkey
      </Button>
    </section>
  );
}

function SecurityKeyLogin({ onLoggedIn, onWait, onCantDo }: Go) {
  const [loginName, setLoginName] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await loginWithSecurityKey(authApi, loginName.trim(), deviceLabel());
      if (result.status === 'ok') onLoggedIn();
      else if (result.status === 'approve-on-device') onWait(result);
      // Staff and the owner: the second step is whatever the server needs (often PGP), never the same key again.
      else setPending({ pendingId: result.pendingId, needs: result.needs });
    } catch (e) {
      if (!onCantDo(e)) setError(refusalText(e, 'That security key did not work. Try again, or use another way in.'));
    } finally {
      setBusy(false);
    }
  };

  if (pending !== null) return <SecondStep pending={pending} onLoggedIn={onLoggedIn} onWait={onWait} onCantDo={onCantDo} />;

  return (
    <section className="x2f-stack" data-part="security-key">
      <ErrorLine error={error} />
      <div className="x2f-field">
        <label className="x2f-label" htmlFor="sk-login-name">
          Your login name
        </label>
        <input className="x2f-input" id="sk-login-name" autoComplete="username" value={loginName} onChange={(e) => setLoginName(e.target.value)} />
      </div>
      <Button variant="primary" disabled={busy || loginName.trim() === ''} onClick={() => void go()} data-part="security-key-login">
        Use a security key
      </Button>
    </section>
  );
}

function PasswordLogin({ onLoggedIn, onWait, onCantDo }: Go) {
  const [loginName, setLoginName] = useState('');
  const [password, setPassword] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [totp, setTotp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await passwordLogin(loginName.trim(), password);
      if (result.status === 'ok') {
        onLoggedIn();
        return;
      }
      if (result.status === 'approve-on-device') {
        onWait(result);
        return;
      }
      setPendingId(result.pendingId);
    } catch (e) {
      // The server counts misses per browser, so neither a reload nor a method switch resets it.
      if (shouldSendAway(e)) {
        window.location.assign(AWAY_URL);
        return;
      }
      // Any mismatch reads the same; an outage or a rate limit is not a miss.
      if (!onCantDo(e)) setError(loginFailure(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await authApi.loginSecondFactor({ pendingId: pendingId!, code: totp.trim() });
      if (result.status === 'approve-on-device') onWait(result);
      else onLoggedIn();
    } catch (e) {
      if (!onCantDo(e)) setError(refusalText(e, 'That authenticator code did not work.', { expired: 'That login step has expired. Log in with your password again.' }));
    } finally {
      setBusy(false);
    }
  };

  if (pendingId !== null) {
    return (
      <section className="x2f-stack" data-part="password-totp">
        <ErrorLine error={error} />
        <div className="x2f-field">
          <label className="x2f-label" htmlFor="login-totp">
            Authenticator code
          </label>
          <input className="x2f-input" id="login-totp" inputMode="numeric" autoComplete="one-time-code" value={totp} onChange={(e) => setTotp(e.target.value)} />
        </div>
        <Button variant="primary" disabled={busy || totp.trim() === ''} onClick={() => void verify()} data-part="verify-totp">
          Verify
        </Button>
      </section>
    );
  }

  return (
    <section className="x2f-stack" data-part="password">
      <ErrorLine error={error} part="login-error" />
      <div className="x2f-field">
        <label className="x2f-label" htmlFor="login-name">
          Login name
        </label>
        <input className="x2f-input" id="login-name" autoComplete="username" value={loginName} onChange={(e) => setLoginName(e.target.value)} />
      </div>
      <div className="x2f-field">
        <label className="x2f-label" htmlFor="login-password">
          Password
        </label>
        <input
          className="x2f-input"
          id="login-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <Button
        variant="primary"
        disabled={busy || loginName.trim() === '' || password === ''}
        onClick={() => void submit()}
        data-part="password-login"
      >
        Log in
      </Button>
    </section>
  );
}
