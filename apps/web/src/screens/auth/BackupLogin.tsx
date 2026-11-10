/**
 * The backup way in (Task 30; design build gaps Job 1, board Login-Backup: "Your recovery code is
 * your only backup"): a printed recovery code with the login name. Nothing else is a backup: not a
 * password (spec §6.2) and, since 8 Nov 2026, not an authenticator (TOTP) code, which stays a
 * normal login step after a password. A backup login opens a recovery session that is held for a
 * day before it can make changes (Plan 2): this screen says until when before it goes on. Then it
 * follows the usual Terms-then-`returnTo` path.
 */
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { AuthApiError } from '@x2f/auth-client';
import { returnToFrom } from '../../api/client.js';
import { Button } from '../../ui/Button.js';
import { afterLogin, authApi, deviceLabel } from './authApi.js';
import { LOGIN_RETRY_LATER } from './loginRules.js';
import { holdSentence, refusalText } from './refusals.js';
import '../screens.css';

export function BackupLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = returnToFrom(location.search);
  const [loginName, setLoginName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set after a backup login whose changes are held: the screen says until when, then goes on.
  const [heldUntil, setHeldUntil] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await authApi.loginBackup({ loginName: loginName.trim(), kind: 'recovery-code', code: code.trim(), deviceLabel: deviceLabel() });
      if (result.holdUntil !== null) setHeldUntil(result.holdUntil);
      else await afterLogin((to) => navigate(to), returnTo);
    } catch (e) {
      // A wrong name or code reads the same; an outage or a rate limit is not a mismatch.
      setError(e instanceof AuthApiError && e.code === 'credentials-invalid' ? "That login name and backup code don't match." : refusalText(e, LOGIN_RETRY_LATER));
    } finally {
      setBusy(false);
    }
  };

  if (heldUntil !== null) {
    return (
      <main className="x2f-screen" data-screen="backup-login">
        <h1 className="x2f-screen__title">You're in</h1>
        <p className="x2f-note" data-part="hold-note">
          {holdSentence(heldUntil)}
        </p>
        <Button variant="primary" onClick={() => void afterLogin((to) => navigate(to), returnTo)} data-part="hold-continue">
          Continue
        </Button>
      </main>
    );
  }

  return (
    <main className="x2f-screen" data-screen="backup-login">
      <h1 className="x2f-screen__title">Use a backup</h1>
      {error !== null ? (
        <p className="x2f-error" role="alert">
          {error}
        </p>
      ) : null}

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
          A recovery code
        </label>
        <input className="x2f-input" id="backup-code" inputMode="text" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />
      </div>
      <Button variant="primary" disabled={busy || loginName.trim() === '' || code.trim() === ''} onClick={() => void submit()} data-part="backup-login">
        Log in
      </Button>
    </main>
  );
}
