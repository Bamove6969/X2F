/**
 * Setup step 4 (board SetupBackup; spec 6.1 step 4, 6.2 "Backup method").
 *
 * Owner 1 Nov 2026 (register S-017; lead job J-09): the recovery code is REQUIRED at sign-up.
 * Owner demo notes, 12 Nov 2026: ONE code, spoken of in the singular, about four times longer (64
 * symbols, `newRecoveryCode`), on two screens (`RecoveryCodeStep`). Screen A shows it with "I've
 * written it down" and Next; screen B asks for it typed in without seeing it (the dashes go in by
 * themselves, typed or pasted: `formatRecoveryInput`), red until it matches and green when it does,
 * and only then Next. Back on screen B returns to screen A with the same code: it is kept in the
 * flow's memory (`recoveryCode`) and changes only when it is used or a new one is made in Security
 * settings. There is no way past this step until then; then it goes straight on to the wallet.
 * Lead call (12 Nov 2026): the optional "Add another backup" view (a security key or a second PGP
 * key) is gone: the login step's checkboxes replace it, and Settings adds more later. A recovery
 * code is the emergency way in only (owner G32): a backup login opens a held recovery session
 * (recovery.ts). While the account's sign-up window is open the server needs no confirm-it's-you
 * for the code; the confirm sheet is wired in anyway, so a person who comes back later is asked to
 * confirm rather than refused.
 *
 * The server keeps the code only as a keyed hash (recovery.ts); the check here sends nothing. A
 * reload loses the flow's memory, so the step then makes a new code, which replaces the earlier one
 * (the server cannot show a code again).
 */
import { useEffect, useState } from 'react';
import { formatRecoveryInput, isStaged, normalizeRecoveryCode, withConfirm } from '@x2f/auth-client';
import { Button } from '../../ui/Button.js';
import { Icon } from '../../ui/icons.js';
import { ConfirmOpenProvider, isConfirmAbort, useConfirm, usePrimaryVariant } from '../auth/ConfirmSheet.js';
import { authApi } from '../auth/authApi.js';
import { keyErrorText } from '../auth/keyErrors.js';
import { refusalText } from '../auth/refusals.js';
import { HOLD_COPY, codeGroups } from '../settings/holdCopy.js';
import { SetupFrame, SetupIntro, useSetup } from './kit.js';

type Prove = ReturnType<typeof useConfirm>['prove'];

export function Backup() {
  const { state, update, go } = useSetup();
  const { prove, confirmUi, open } = useConfirm();
  // A reload comes back here with the flow's memory gone, so a code is made and checked again
  // (the server keeps no "saved" flag; a new code replaces the old one).
  const saved = state.backup !== null;

  // The code is saved in this flow already (Back from the wallet): on to the wallet again.
  useEffect(() => {
    if (saved) go('wallet', { replace: true });
  }, [saved, go]);

  if (saved) return null;
  return (
    <ConfirmOpenProvider value={open}>
      <SetupFrame screen="setup-backup" step={4} footer={null}>
        {/* Owner demo note #149 (23 Nov): "EXTREMELY IMPORTANT" in big words above the heading, to show how
            much this screen matters and to fill the empty space. A caution sign stands in for his optional "!",
            which copy-lint does not allow in copy. COPY-UNSIGNED */}
        <p className="x2f-start__shout" data-part="backup-important">
          <Icon name="alert" size={32} stroke={2.25} />
          EXTREMELY IMPORTANT
        </p>
        {/* COPY-UNSIGNED (singular: owner, 12 Nov 2026; signup round 3 wording, 13 Nov 2026) */}
        <SetupIntro title="Save your recovery code" />
        {/* Owner demo note #151 (23 Nov): this paragraph in the same box as the one below it, the heading stays outside. */}
        <p className="x2f-start__panel" data-part="backup-lead">
          X2F has no email address or phone number for you, so if you ever lose access to your login methods, your emergency recovery code is the
          only way back into your account to set up or update your current security methods.
        </p>
        <p className="x2f-start__panel">
          Your coins stay in your own wallet either way. Without a backup, you could lose this account and the reputation you've built on it.
        </p>
        <RecoveryCodeStep
          prove={prove}
          code={state.recoveryCode}
          onMade={(code) => update({ recoveryCode: code })}
          onDone={() => {
            update({ backup: 'recovery-codes' });
            go('wallet');
          }}
        />
        {confirmUi}
      </SetupFrame>
    </ConfirmOpenProvider>
  );
}

/**
 * S-017 and the owner's demo notes (12 Nov 2026): makes the recovery code (once per flow: `code`
 * is the one made earlier in this flow, if any), then screen A (the code, "I've written it down",
 * Next) and screen B (type it in unseen, compared in the normalized form the server uses: case
 * and dashes do not matter; red until it matches, green when it does; Back to screen A). Nothing
 * is sent for the check: it only proves the person wrote the code down.
 */
export function RecoveryCodeStep({
  prove,
  code: kept = null,
  onMade,
  onDone,
}: {
  prove: Prove;
  code?: string | null;
  onMade?: (code: string) => void;
  onDone: () => void;
}) {
  const primary = usePrimaryVariant();
  const [code, setCode] = useState<string | null>(kept);
  // Hold model v3: a code made by a weak login is a staged change (HOLD_COPY.staged) until the hold ends.
  const [held, setHeld] = useState<string | null>(null);
  const [written, setWritten] = useState(false);
  const [testing, setTesting] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const make = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await withConfirm({ kind: 'new-recovery-codes' }, (t) => authApi.newRecoveryCodes(t !== undefined ? { confirmToken: t } : {}), prove);
      const made = result.codes[0]!;
      setCode(made);
      onMade?.(made);
      // Hold model v3 (team-perms-port, batch 4): a weak login's code is a staged draft; the hold copy says so.
      setHeld(isStaged(result) ? HOLD_COPY.staged : null);
    } catch (e) {
      // COPY-UNSIGNED
      if (!isConfirmAbort(e)) setError(refusalText(e, 'Could not make your recovery code. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  if (code === null) {
    return (
      <div className="x2f-field" data-part="recovery-codes">
        <ErrorLine error={error} />
        {/* COPY-UNSIGNED */}
        <Button variant={primary} className="x2f-start__reveal" disabled={busy} onClick={() => void make()} data-part="recovery-make">
          Show my recovery code
        </Button>
      </div>
    );
  }

  if (!testing) {
    return (
      <div className="x2f-field" data-part="recovery-codes" data-screen-part="show">
        {/* COPY-UNSIGNED */}
        <p className="x2f-note">Write it down now and keep it somewhere safe. It works once, and the next screen asks you to type it in.</p>
        {held !== null ? (
          <p className="x2f-note" role="status" data-part="held-note">
            {held}
          </p>
        ) : null}
        <ol className="x2f-codes x2f-codes--long" data-part="recovery-code" aria-label={`Your recovery code: ${codeGroups(code).join(' ')}`}>
          {codeGroups(code).map((g, i) => (
            <li className="x2f-codes__item" key={i}>
              {g}
            </li>
          ))}
        </ol>
        <label className="x2f-check x2f-check--tap">
          <input type="checkbox" checked={written} onChange={(e) => setWritten(e.target.checked)} data-part="recovery-written" />
          {/* COPY-UNSIGNED (owner's words, S-017) */}
          <span>I've written it down</span>
        </label>
        <Button
          variant={primary}
          disabled={!written}
          onClick={() => {
            setTyped('');
            setTesting(true);
          }}
          data-part="recovery-next"
        >
          Next
        </Button>
      </div>
    );
  }

  const want = normalizeRecoveryCode(code);
  const got = normalizeRecoveryCode(typed);
  const matches = got !== null && got === want;
  const match = typed === '' ? 'empty' : matches ? 'yes' : 'no';

  return (
    <div className="x2f-field" data-part="recovery-codes" data-screen-part="test">
      <div className="x2f-field">
        {/* COPY-UNSIGNED */}
        <label className="x2f-label" htmlFor="recovery-typeback">
          Type your recovery code from what you wrote down
        </label>
        <input
          className="x2f-input x2f-start__typeback"
          id="recovery-typeback"
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          maxLength={160}
          value={typed}
          onChange={(e) => setTyped(formatRecoveryInput(e.target.value))}
          aria-invalid={match === 'no'}
          aria-describedby="recovery-typeback-state"
          data-part="recovery-typeback"
          data-match={match}
        />
        <span id="recovery-typeback-state" aria-live="polite">
          {match === 'no' ? (
            // COPY-UNSIGNED
            <span className="x2f-start__match" data-tone="no" data-part="recovery-mismatch">
              Not a match yet. Check what you wrote down.
            </span>
          ) : null}
          {match === 'yes' ? (
            // COPY-UNSIGNED
            <span className="x2f-start__match" data-tone="yes" data-part="recovery-match">
              That matches your recovery code.
            </span>
          ) : null}
        </span>
      </div>
      <div className="x2f-start__buttons">
        <Button variant={primary} disabled={!matches} onClick={onDone} data-part="recovery-continue">
          Next
        </Button>
        {/* COPY-UNSIGNED */}
        <Button variant="quiet" onClick={() => setTesting(false)} data-part="recovery-back">
          Back to my code
        </Button>
      </div>
    </div>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  return error === null ? null : (
    <p className="x2f-error" role="alert">
      {error}
    </p>
  );
}
