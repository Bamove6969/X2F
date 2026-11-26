/**
 * Recovery code (Task 30, spec §6.2; singular per owner demo note #28, 12 Nov 2026): making a new
 * code needs confirm-it's-you, and the code is shown once and never again. Making a new code
 * replaces any old one.
 */
import { useState } from 'react';
import { withConfirm, type ConfirmAction } from '@x2f/auth-client';
import { Button } from '../../ui/Button.js';
import { isConfirmAbort, usePrimaryVariant } from '../auth/ConfirmSheet.js';
import { authApi } from '../auth/authApi.js';
import { refusalText } from '../auth/refusals.js';
import { StagedNote, reportChangesCap } from './HoldChanges.js';

export function RecoveryCodes({ prove, onDone }: { prove: (a: ConfirmAction) => Promise<string>; onDone: () => void }) {
  const primary = usePrimaryVariant();
  const [codes, setCodes] = useState<string[] | null>(null);
  // Hold model v3: a new code made from a username-and-password login is a draft; it works once submitted and applied.
  const [staged, setStaged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const make = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await withConfirm({ kind: 'new-recovery-codes' }, (t) => authApi.newRecoveryCodes(t !== undefined ? { confirmToken: t } : {}), prove);
      setCodes(result.codes);
      setStaged(result.status === 'staged');
    } catch (e) {
      // COPY-UNSIGNED (singular: owner demo note #28, 12 Nov 2026)
      if (!isConfirmAbort(e) && !reportChangesCap(e)) setError(refusalText(e, 'Could not make your recovery code. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  if (codes !== null) {
    return (
      <div className="x2f-field" data-part="recovery-codes">
        {/* COPY-UNSIGNED (singular: owner demo note #28, 12 Nov 2026) */}
        <p className="x2f-note">Save this now. It works once, and you will not see it again.</p>
        {staged ? <StagedNote /> : null}
        <ul className="x2f-codes" data-part="code-list">
          {codes.map((c) => (
            <li className="x2f-codes__item" key={c}>
              {c}
            </li>
          ))}
        </ul>
        {/* COPY-UNSIGNED (singular: owner demo note #28, 12 Nov 2026) */}
        <Button variant={primary} onClick={onDone} data-part="recovery-done">
          I have saved it
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
      {/* COPY-UNSIGNED (singular: owner demo note #28, 12 Nov 2026) */}
      <Button variant={primary} disabled={busy} onClick={() => void make()} data-part="recovery-make">
        Show my recovery code
      </Button>
    </div>
  );
}
