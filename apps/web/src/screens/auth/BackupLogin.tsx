/**
 * The backup way in (Task 30; design build gaps Job 1, board Login-Backup: "Your recovery code is
 * your only backup"): a printed recovery code with the login name. Nothing else is a backup, not an
 * authenticator (TOTP) code. Owner, 26 Nov 2026: a backup login is a full session that may change
 * every login method for an hour, with no hold. This screen says the code is burned and the hour
 * has started, then follows the usual Terms-then-`returnTo` path.
 */
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { AuthApiError } from '@x2f/auth-client';
import { returnToFrom } from '../../api/client.js';
import { Button } from '../../ui/Button.js';
import { Notice } from '../../ui/Notice.js';
import { BURNED_CODE_COPY as BURNED } from '../settings/recoveryCopy.js';
import { afterLogin, authApi, deviceLabel } from './authApi.js';
import { LOGIN_RETRY_LATER } from './loginRules.js';
import { refusalText } from './refusals.js';
import '../screens.css';

/** Owner, 26 Nov 2026: what a recovery-code login allows. COPY-UNSIGNED */
export const RECOVERY_WINDOW_NOTE =
  'For the next hour you can add or remove any login method without confirming it\'s you. Set up the ways you will log in from now on in Security settings.';

export function BackupLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = returnToFrom(location.search);
  const [loginName, setLoginName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set after a backup login: the screen says the code is burned, then goes on.
  const [inNow, setInNow] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await authApi.loginBackup({ loginName: loginName.trim(), kind: 'recovery-code', code: code.trim(), deviceLabel: deviceLabel() });
      setInNow(true);
    } catch (e) {
      // A wrong name or code reads the same; an outage or a rate limit is not a mismatch.
      setError(e instanceof AuthApiError && e.code === 'credentials-invalid' ? "That login name and backup code don't match." : refusalText(e, LOGIN_RETRY_LATER));
    } finally {
      setBusy(false);
    }
  };

  if (inNow) {
    return (
      <main className="x2f-screen" data-screen="backup-login">
        <h1 className="x2f-screen__title">You're in</h1>
        <p className="x2f-note" data-part="recovery-window-note">
          {RECOVERY_WINDOW_NOTE}
        </p>
        {/* Owner S-111 (p11-36): the code just used is burned. COPY-UNSIGNED (BURNED_CODE_COPY). */}
        <Notice tone="caution" title={BURNED.title} data-part="code-burned">
          {BURNED.body}
        </Notice>
        <Button variant="primary" onClick={() => void afterLogin((to) => navigate(to), returnTo)} data-part="recovery-continue">
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
