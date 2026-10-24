/**
 * TOTP (authenticator app) enrolment (Task 30, spec §6.2): start a secret, show it as a QR code
 * and as text to type in by hand, then confirm with a 6-digit code. Adding a method needs
 * confirm-it's-you, so the start goes through `withConfirm`. The secret and QR are shown once and
 * never kept.
 */
import { useState } from 'react';
import { withConfirm, type ConfirmAction } from '@x2f/auth-client';
import { Button } from '../../ui/Button.js';
import { authApi } from '../auth/authApi.js';
import { Qr } from './Qr.js';

export function Totp({ prove, onDone, onCancel }: { prove: (a: ConfirmAction) => Promise<string>; onDone: () => void; onCancel: () => void }) {
  const [enrol, setEnrol] = useState<{ challengeId: string; otpauthUri: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      setEnrol(await withConfirm({ kind: 'add-method', method: 'totp' }, (t) => authApi.addTotpStart(t !== undefined ? { confirmToken: t } : {}), prove));
    } catch (e) {
      if (!(e instanceof Error && e.message === 'confirm cancelled')) setError('Could not start enrolment. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      await authApi.addTotpFinish({ challengeId: enrol!.challengeId, code: code.trim() });
      onDone();
    } catch {
      setError('That code did not work. Check your authenticator app and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="x2f-field" data-part="totp">
      {error !== null ? (
        <p className="x2f-error" role="alert">
          {error}
        </p>
      ) : null}
      {enrol === null ? (
        <div className="x2f-row">
          <Button variant="primary" disabled={busy} onClick={() => void start()} data-part="totp-start">
            Start enrolment
          </Button>
          <Button variant="quiet" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      ) : (
        <>
          <p className="x2f-note">Scan this in your authenticator app, or type the secret in by hand.</p>
          <Qr value={enrol.otpauthUri} label="Authenticator setup QR code" />
          <p className="x2f-secret" data-part="totp-secret">
            {enrol.secret}
          </p>
          <label className="x2f-label" htmlFor="totp-code">
            6-digit code
          </label>
          <input className="x2f-input" id="totp-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
          <Button variant="primary" disabled={busy || code.trim() === ''} onClick={() => void finish()} data-part="totp-finish">
            Confirm
          </Button>
        </>
      )}
    </div>
  );
}
