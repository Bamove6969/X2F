/**
 * TOTP (authenticator app) enrolment (Task 30, spec §6.2): start a secret, show it as a QR code
 * and as text to type in by hand, then confirm with a 6-digit code. Adding a method needs
 * confirm-it's-you, so the start goes through `withConfirm`. The secret and QR are shown once and
 * never kept.
 *
 * Signup round 3 (owner's demo notes, 13 Nov 2026): an `otpauth://` link opens the authenticator
 * app or password manager on the same phone (one that cannot scan its own screen); the secret is
 * grouped in fours on screen (the text itself has no spaces) and has a copy button. The secret goes
 * only to the screen, the clipboard and that link: never into the URL, storage or a log. Once the
 * code verifies, a green success state stays until Continue (it no longer just disappears).
 */
import { useState } from 'react';
import { withConfirm, type ConfirmAction, type Staged } from '@x2f/auth-client';
import { Button } from '../../ui/Button.js';
import { isConfirmAbort, usePrimaryVariant } from '../auth/ConfirmSheet.js';
import { authApi } from '../auth/authApi.js';
import { refusalText } from '../auth/refusals.js';
import { reportChangesCap } from './HoldChanges.js';
import { Qr } from './Qr.js';

export type CopyWrite = (text: string) => Promise<void>;
const clipboardWrite: CopyWrite = (text) => navigator.clipboard.writeText(text);

/** The secret in groups of four, for reading and typing in by hand. */
export const secretGroups = (secret: string): string[] => secret.match(/.{1,4}/g) ?? [];

export function Totp({
  prove,
  onDone,
  onCancel,
  write = clipboardWrite,
}: {
  prove: (a: ConfirmAction) => Promise<string>;
  onDone: (staged?: Staged) => void;
  onCancel: () => void;
  write?: CopyWrite;
}) {
  const primary = usePrimaryVariant();
  const [verified, setVerified] = useState(false);
  const [copied, setCopied] = useState(false);
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
      if (!isConfirmAbort(e)) setError(refusalText(e, 'Could not start enrolment. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      const staged = await authApi.addTotpFinish({ challengeId: enrol!.challengeId, code: code.trim() });
      // A staged enrolment waits 24 hours: no success claim, the caller says what happens next.
      if (staged !== undefined) return onDone(staged);
      setEnrol(null);
      setVerified(true);
    } catch (e) {
      if (!reportChangesCap(e)) setError(refusalText(e, 'That code did not work. Check your authenticator app and try again.', { expired: 'That setup has expired. Start again.' }));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (secret: string) => {
    try {
      await write(secret);
      setCopied(true);
    } catch {
      // COPY-UNSIGNED
      setError('Could not copy. Select the code and copy it by hand.');
    }
  };

  if (verified) {
    return (
      <div className="x2f-field" data-part="totp">
        {/* COPY-UNSIGNED (the owner's words, 13 Nov 2026) */}
        <p className="x2f-success" role="status" data-part="totp-success">
          You have successfully set up your one-time password.
        </p>
        <Button variant={primary} onClick={() => onDone()} data-part="totp-continue">
          Continue
        </Button>
      </div>
    );
  }

  return (
    <div className="x2f-field" data-part="totp">
      {error !== null ? (
        <p className="x2f-error" role="alert">
          {error}
        </p>
      ) : null}
      {enrol === null ? (
        <div className="x2f-row">
          <Button variant={primary} disabled={busy} onClick={() => void start()} data-part="totp-start">
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
          {/* COPY-UNSIGNED: opens the authenticator app or password manager that handles otpauth links. */}
          <a className="x2f-button x2f-button--secondary x2f-totp-link" href={enrol.otpauthUri} data-part="totp-link">
            Add to your authenticator or password manager
          </a>
          <p className="x2f-secret" data-part="totp-secret">
            {secretGroups(enrol.secret).map((g, i) => (
              <span key={i} className="x2f-secret__group" data-part="secret-group">
                {g}
              </span>
            ))}
          </p>
          {/* COPY-UNSIGNED */}
          <Button variant="quiet" onClick={() => void copy(enrol.secret)} data-part="totp-copy">
            {copied ? 'Copied' : 'Copy code'}
          </Button>
          <label className="x2f-label" htmlFor="totp-code">
            6-digit code
          </label>
          <input className="x2f-input" id="totp-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
          <Button variant={primary} disabled={busy || code.trim() === ''} onClick={() => void finish()} data-part="totp-finish">
            Confirm
          </Button>
        </>
      )}
    </div>
  );
}
