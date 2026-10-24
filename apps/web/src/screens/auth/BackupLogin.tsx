/**
 * The backup way in (Task 30): a printed recovery code or an authenticator (TOTP) code, with the
 * login name. A password is never a backup (spec §6.2). A TOTP backup opens a recovery session
 * that is held for a day before it can make changes (Plan 2); this screen just gets the person in
 * and then follows the usual Terms-then-`returnTo` path.
 */
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { AuthApiError } from '@x2f/auth-client';
import { returnToFrom } from '../../api/client.js';
import { Button } from '../../ui/Button.js';
import { afterLogin, authApi, deviceLabel } from './authApi.js';
import { LOGIN_RETRY_LATER } from './loginRules.js';
import '../screens.css';

type Kind = 'recovery-code' | 'totp';

export function BackupLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = returnToFrom(location.search);
  const [kind, setKind] = useState<Kind>('recovery-code');
  const [loginName, setLoginName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await authApi.loginBackup({ username: loginName.trim(), kind, code: code.trim(), deviceLabel: deviceLabel() });
      await afterLogin((to) => navigate(to), returnTo);
    } catch (e) {
      // A wrong name or code reads the same; an outage or a rate limit is not a mismatch.
      setError(e instanceof AuthApiError && e.code === 'credentials-invalid' ? 'That login name and backup code don’t match.' : LOGIN_RETRY_LATER);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="x2f-screen" data-screen="backup-login">
      <h1 className="x2f-screen__title">Use a backup</h1>
      {error !== null ? (
        <p className="x2f-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="x2f-segmented" role="group" aria-label="Backup type">
        <Button
          variant="secondary"
          className={kind === 'recovery-code' ? 'x2f-segmented__on' : ''}
          aria-pressed={kind === 'recovery-code'}
          onClick={() => setKind('recovery-code')}
          data-kind="recovery-code"
        >
          Recovery code
        </Button>
        <Button
          variant="secondary"
          className={kind === 'totp' ? 'x2f-segmented__on' : ''}
          aria-pressed={kind === 'totp'}
          onClick={() => setKind('totp')}
          data-kind="totp"
        >
          Authenticator code
        </Button>
      </div>

      <div className="x2f-field">
        <label className="x2f-label" htmlFor="backup-login-name">
          Your login name
        </label>
        <input
          className="x2f-input"
          id="backup-login-name"
          autoComplete="username"
          value={loginName}
          onChange={(e) => setLoginName(e.target.value)}
        />
      </div>
      <div className="x2f-field">
        <label className="x2f-label" htmlFor="backup-code">
          {kind === 'recovery-code' ? 'A recovery code' : 'Authenticator code'}
        </label>
        <input
          className="x2f-input"
          id="backup-code"
          inputMode={kind === 'totp' ? 'numeric' : 'text'}
          autoComplete={kind === 'totp' ? 'one-time-code' : 'off'}
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </div>
      <Button variant="primary" disabled={busy || loginName.trim() === '' || code.trim() === ''} onClick={() => void submit()} data-part="backup-login">
        Log in
      </Button>
    </main>
  );
}
