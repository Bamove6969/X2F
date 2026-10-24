/**
 * Recovery codes (Task 30, spec §6.2): making a set needs confirm-it's-you, and the codes are
 * shown once and never again. Making a new set replaces any old one.
 */
import { useState } from 'react';
import { withConfirm, type ConfirmAction } from '@x2f/auth-client';
import { Button } from '../../ui/Button.js';
import { authApi } from '../auth/authApi.js';

export function RecoveryCodes({ prove, onDone }: { prove: (a: ConfirmAction) => Promise<string>; onDone: () => void }) {
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const make = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await withConfirm({ kind: 'new-recovery-codes' }, (t) => authApi.newRecoveryCodes(t !== undefined ? { confirmToken: t } : {}), prove);
      setCodes(result.codes);
    } catch (e) {
      if (!(e instanceof Error && e.message === 'confirm cancelled')) setError('Could not make recovery codes. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (codes !== null) {
    return (
      <div className="x2f-field" data-part="recovery-codes">
        <p className="x2f-note">Save these now. Each works once, and you will not see them again.</p>
        <ul className="x2f-codes" data-part="code-list">
          {codes.map((c) => (
            <li className="x2f-codes__item" key={c}>
              {c}
            </li>
          ))}
        </ul>
        <Button variant="primary" onClick={onDone} data-part="recovery-done">
          I have saved them
        </Button>
      </div>
    );
  }

  return (
    <div className="x2f-field" data-part="recovery-codes">
      {error !== null ? (
        <p className="x2f-error" role="alert">
          {error}
        </p>
      ) : null}
      <Button variant="primary" disabled={busy} onClick={() => void make()} data-part="recovery-make">
        Show my recovery codes
      </Button>
    </div>
  );
}
