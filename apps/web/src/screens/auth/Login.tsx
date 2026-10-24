/**
 * The login screen (Task 30, P3-C4). Four ways in: PGP (paste your key, decrypt the message, paste
 * the code — no login name, owner 2026-10-23), a passkey, a security key, or a login name and
 * password. A password login may ask for an authenticator code. "Use a backup" leads to the
 * recovery-code / TOTP screen. After a login the Terms screen comes first when they have changed
 * (R10), otherwise the page returns to wherever the session expired (`returnTo`).
 */
import { useCallback, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { AuthApiError, loginWithPasskey, loginWithSecurityKey, type LoginResult, type PgpChallenge } from '@x2f/auth-client';
import { returnToFrom } from '../../api/client.js';
import { Button } from '../../ui/Button.js';
import { afterLogin, authApi, deviceLabel, pgpLoginFinish, pgpLoginStart } from './authApi.js';
import '../screens.css';

/**
 * Where a visitor is sent after about ten password misses in a row (spec §6.3, owner 2026-10-23):
 * off the site entirely. A neutral destination, not an X2F page.
 */
export const AWAY_URL = 'https://duckduckgo.com/';
const MAX_MISSES = 10;

/** The same answer for any password-login mistake, so a guesser never learns which part was wrong. */
const GENERIC_LOGIN_ERROR = "That login name and password don't match";

type Method = 'choose' | 'pgp' | 'passkey' | 'security-key' | 'password';

export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = returnToFrom(location.search);
  const [method, setMethod] = useState<Method>('choose');

  const onLoggedIn = useCallback(() => void afterLogin((to) => navigate(to), returnTo), [navigate, returnTo]);

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

      {method === 'pgp' ? <PgpLogin onLoggedIn={onLoggedIn} /> : null}
      {method === 'passkey' ? <PasskeyLogin onLoggedIn={onLoggedIn} /> : null}
      {method === 'security-key' ? <SecurityKeyLogin onLoggedIn={onLoggedIn} /> : null}
      {method === 'password' ? <PasswordLogin onLoggedIn={onLoggedIn} /> : null}

      <p className="x2f-screen__foot">
        <Link className="x2f-link" to={`/login/backup?returnTo=${encodeURIComponent(returnTo)}`} data-part="use-backup">
          Use a backup
        </Link>
      </p>
    </main>
  );
}

function done(result: LoginResult, onLoggedIn: () => void, onSecondFactor: (pendingId: string) => void) {
  if (result.status === 'ok') onLoggedIn();
  else onSecondFactor(result.pendingId);
}

function PgpLogin({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [publicKey, setPublicKey] = useState('');
  const [challenge, setChallenge] = useState<PgpChallenge | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      setChallenge(await pgpLoginStart(publicKey.trim()));
    } catch {
      setError('Could not send a login message for that key. Check the key and try again.');
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      done(await pgpLoginFinish(challenge!.challengeId, code), onLoggedIn, () => setError('This account needs a second step.'));
    } catch {
      setError('That code did not work. It may have expired — send a new message.');
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

  return (
    <section className="x2f-stack" data-part="pgp">
      {error !== null ? (
        <p className="x2f-error" role="alert">
          {error}
        </p>
      ) : null}
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
        </div>
      )}
    </section>
  );
}

function PasskeyLogin({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      done(await loginWithPasskey(authApi, deviceLabel()), onLoggedIn, () => setError('This account needs a second step.'));
    } catch {
      setError('That passkey did not work. Try again, or use another way in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="x2f-stack" data-part="passkey">
      {error !== null ? (
        <p className="x2f-error" role="alert">
          {error}
        </p>
      ) : null}
      <p className="x2f-note">Your device or password manager picks the account.</p>
      <Button variant="primary" disabled={busy} onClick={() => void go()} data-part="passkey-login">
        Use a passkey
      </Button>
    </section>
  );
}

function SecurityKeyLogin({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [loginName, setLoginName] = useState('');
  const [pendingId, setPendingId] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await loginWithSecurityKey(authApi, loginName.trim(), deviceLabel(), undefined, pendingId !== undefined ? { pendingId } : {});
      done(result, onLoggedIn, (id) => setPendingId(id));
    } catch {
      setError('That security key did not work. Try again, or use another way in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="x2f-stack" data-part="security-key">
      {error !== null ? (
        <p className="x2f-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="x2f-field">
        <label className="x2f-label" htmlFor="sk-login-name">
          Your login name
        </label>
        <input
          className="x2f-input"
          id="sk-login-name"
          autoComplete="username"
          value={loginName}
          onChange={(e) => setLoginName(e.target.value)}
        />
      </div>
      <Button variant="primary" disabled={busy || loginName.trim() === ''} onClick={() => void go()} data-part="security-key-login">
        Use a security key
      </Button>
    </section>
  );
}

function PasswordLogin({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [loginName, setLoginName] = useState('');
  const [password, setPassword] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [totp, setTotp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Misses in a row: after about ten, the page leaves the site (spec §6.3).
  const [misses, setMisses] = useState(0);

  const miss = (message: string) => {
    const next = misses + 1;
    setMisses(next);
    if (next >= MAX_MISSES) {
      window.location.assign(AWAY_URL);
      return;
    }
    setError(message);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await authApi.loginPassword({ username: loginName.trim(), password, deviceLabel: deviceLabel() });
      if (result.status === 'ok') {
        onLoggedIn();
        return;
      }
      setPendingId(result.pendingId);
    } catch {
      // Any mistake — wrong login name or wrong password — gets the one generic answer.
      miss(GENERIC_LOGIN_ERROR);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      await authApi.loginSecondFactor({ pendingId: pendingId!, code: totp.trim() });
      onLoggedIn();
    } catch {
      setError('That authenticator code did not work.');
    } finally {
      setBusy(false);
    }
  };

  if (pendingId !== null) {
    return (
      <section className="x2f-stack" data-part="password-totp">
        {error !== null ? (
          <p className="x2f-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="x2f-field">
          <label className="x2f-label" htmlFor="login-totp">
            Authenticator code
          </label>
          <input
            className="x2f-input"
            id="login-totp"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={totp}
            onChange={(e) => setTotp(e.target.value)}
          />
        </div>
        <Button variant="primary" disabled={busy || totp.trim() === ''} onClick={() => void verify()} data-part="verify-totp">
          Verify
        </Button>
      </section>
    );
  }

  return (
    <section className="x2f-stack" data-part="password">
      {error !== null ? (
        <p className="x2f-error" role="alert" data-part="login-error">
          {error}
        </p>
      ) : null}
      <div className="x2f-field">
        <label className="x2f-label" htmlFor="login-name">
          Login name
        </label>
        <input
          className="x2f-input"
          id="login-name"
          autoComplete="username"
          value={loginName}
          onChange={(e) => setLoginName(e.target.value)}
        />
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
