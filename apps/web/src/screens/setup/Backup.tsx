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
 * settings. There is no "Skip for now" until then. After that, a security key or a second PGP key is an
 * optional extra backup, and "Skip for now" goes on to the wallet. A recovery code is the
 * emergency way in only (owner G32): a backup login opens a held recovery session (recovery.ts).
 *
 * An authenticator app is not offered here (design build gaps Job 1, board Login-Backup: an
 * authenticator code alone no longer opens a backup login). It stays in Settings as a login step
 * with a password. While the account's sign-up window is open the server needs no confirm-it's-you
 * for these; the confirm sheet is wired in anyway, so a person who comes back later is asked to
 * confirm rather than refused.
 *
 * The server keeps the code only as a keyed hash (recovery.ts); the check here sends nothing. A
 * reload loses the flow's memory, so the step then makes a new code, which replaces the earlier one
 * (the server cannot show a code again).
 */
import { useState } from 'react';
import { addWebAuthnKey, formatRecoveryInput, isStaged, normalizeRecoveryCode, withConfirm, type PgpChallenge } from '@x2f/auth-client';
import { Button } from '../../ui/Button.js';
import { ConfirmOpenProvider, isConfirmAbort, useConfirm, usePrimaryVariant } from '../auth/ConfirmSheet.js';
import { authApi } from '../auth/authApi.js';
import { keyErrorText } from '../auth/keyErrors.js';
import { refusalText } from '../auth/refusals.js';
import { HOLD_COPY, codeGroups } from '../settings/holdCopy.js';
import { SetupFrame, SetupIntro, radioProps, useSetup, type BackupChoice } from './kit.js';
import { errorCode, setupError } from './register.js';

type Prove = ReturnType<typeof useConfirm>['prove'];

/** The board's choices in its words, the recovery code first (the backup login); no authenticator app. */
export const BACKUPS: { id: BackupChoice; name: string; short: string; desc: string }[] = [
  // COPY-UNSIGNED (owner, 12 Nov 2026: one code, in the singular)
  { id: 'recovery-codes', name: 'Recovery code', short: 'recovery code', desc: 'One long code to write down. It works once and is then replaced.' },
  { id: 'security-key', name: 'Security key', short: 'security key', desc: 'A YubiKey or similar that you keep somewhere safe.' },
  { id: 'pgp', name: 'Second PGP key', short: 'second PGP key', desc: 'A spare PGP key stored separately from your main one.' },
];

/** The optional backups offered once the recovery codes are saved. */
const EXTRAS = BACKUPS.filter((b) => b.id !== 'recovery-codes');

export function Backup() {
  const { state, update, go } = useSetup();
  const { prove, confirmUi, open } = useConfirm();
  // A reload comes back here with the flow's memory gone, so a code is made and checked again
  // (the server keeps no "saved" flag; a new code replaces the old one).
  const [saved, setSaved] = useState(state.backup !== null);
  const [pick, setPick] = useState<BackupChoice>(EXTRAS[0]!.id);
  const [adding, setAdding] = useState<BackupChoice | null>(null);
  const choice = EXTRAS.find((b) => b.id === pick)!;

  const extra = (b: BackupChoice) => {
    update({ backup: b });
    go('wallet');
  };

  if (!saved) {
    return (
      <ConfirmOpenProvider value={open}>
        <SetupFrame screen="setup-backup" step={4} footer={null}>
          {/* COPY-UNSIGNED (singular: owner, 12 Nov 2026) */}
          <SetupIntro title="Save your recovery code">
            X2F has no email address or phone number for you, so if you lose your key or forget your password, a recovery code is your emergency
            way back in.
          </SetupIntro>
          <p className="x2f-start__panel">
            Your coins stay in your own wallet either way. Without a backup, you could lose this account and the reputation you've built on it.
          </p>
          <RecoveryCodeStep
            prove={prove}
            code={state.recoveryCode}
            onMade={(code) => update({ recoveryCode: code })}
            onDone={() => {
              update({ backup: 'recovery-codes' });
              setSaved(true);
            }}
          />
          {confirmUi}
        </SetupFrame>
      </ConfirmOpenProvider>
    );
  }

  return (
    <ConfirmOpenProvider value={open}>
      <SetupFrame
        screen="setup-backup"
        step={4}
        footer={
          <div className="x2f-start__buttons">
            {adding === null ? (
              <Button variant={open ? 'secondary' : 'primary'} onClick={() => setAdding(pick)} data-part="backup-add">
                Add {choice.short}
              </Button>
            ) : null}
            <Button variant="quiet" onClick={() => go('wallet')} data-part="backup-skip">
              Skip for now
            </Button>
          </div>
        }
      >
        {/* COPY-UNSIGNED */}
        <SetupIntro title="Add another backup (optional)">
          A security key or a second PGP key also gets you back in. You can add one later in Settings.
        </SetupIntro>
        {adding === null ? (
          <div className="x2f-start__options" role="radiogroup" aria-label="Backup method">
            {EXTRAS.map((b, i) => (
              <button
                key={b.id}
                type="button"
                {...radioProps(
                  EXTRAS.map((x) => x.id),
                  pick,
                  setPick,
                  i,
                )}
                className="x2f-start__option"
                data-backup={b.id}
              >
                <span className="x2f-start__option-text">
                  <span className="x2f-start__choice-name">{b.name}</span>
                  <span className="x2f-start__choice-desc">{b.desc}</span>
                </span>
                <span className="x2f-start__dot" aria-hidden="true" />
              </button>
            ))}
          </div>
        ) : (
          <section className="x2f-stack" aria-label={BACKUPS.find((b) => b.id === adding)!.name} data-part="backup-adding">
            {adding === 'security-key' ? <SecurityKeyBackup prove={prove} onDone={() => extra('security-key')} onCancel={() => setAdding(null)} /> : null}
            {adding === 'pgp' ? <SecondPgpKey prove={prove} onDone={() => extra('pgp')} onCancel={() => setAdding(null)} /> : null}
          </section>
        )}
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
        <Button variant={primary} disabled={busy} onClick={() => void make()} data-part="recovery-make">
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

function SecurityKeyBackup({ prove, onDone, onCancel }: { prove: Prove; onDone: () => void; onCancel: () => void }) {
  const primary = usePrimaryVariant();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await withConfirm(
        { kind: 'add-method', method: 'security-key' },
        (t) => addWebAuthnKey(authApi, 'security-key', t !== undefined ? { confirmToken: t } : {}),
        prove,
      );
      onDone();
    } catch (e) {
      if (!isConfirmAbort(e)) setError(keyErrorText(e, 'security-key'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="x2f-field" data-part="backup-security-key">
      <ErrorLine error={error} />
      <p className="x2f-start__help">Plug in or hold your security key near the phone, then tap it when asked.</p>
      <div className="x2f-row">
        <Button variant={primary} disabled={busy} onClick={() => void add()} data-part="backup-key-add">
          Add security key
        </Button>
        <Button variant="quiet" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function SecondPgpKey({ prove, onDone, onCancel }: { prove: Prove; onDone: () => void; onCancel: () => void }) {
  const primary = usePrimaryVariant();
  const [key, setKey] = useState('');
  const [challenge, setChallenge] = useState<PgpChallenge | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const publicKey = key.trim();
      setChallenge(
        await withConfirm(
          { kind: 'add-method', method: 'pgp' },
          (t) => authApi.addPgpKeyStart({ publicKey, ...(t !== undefined ? { confirmToken: t } : {}) }),
          prove,
        ),
      );
      setCode('');
    } catch (e) {
      // not-a-refusal: an input check on a pasted key
      if (!isConfirmAbort(e)) setError(setupError(e, 'X2F could not use that key. Check that you pasted the whole public key.').text);
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      await authApi.addPgpKeyFinish({ challengeId: challenge!.challengeId, code: code.trim() });
      onDone();
    } catch (e) {
      // Each refusal its own sentence (review I1): a key another account holds never passes, so a new
      // message would not help; an expired message does need one; a wrong code needs checking.
      const code = errorCode(e);
      if (code === 'key-in-use') setError('That key is already used by another X2F account. Use a different second key.');
      else if (code === 'challenge-expired') setError('That message has expired. Send a new message and try again.');
      else if (code === 'code-invalid') setError('That code did not work. Check it and try again, or send a new message.');
      else setError(setupError(e, 'X2F could not check that code just now. Try again.').text);
    } finally {
      setBusy(false);
    }
  };

  if (challenge === null) {
    return (
      <div className="x2f-field" data-part="backup-pgp">
        <ErrorLine error={error} />
        <label className="x2f-field x2f-label" htmlFor="backup-pub">
          Second public key
          <textarea
            className="x2f-input x2f-textarea"
            id="backup-pub"
            rows={6}
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </label>
        <div className="x2f-row">
          <Button variant={primary} disabled={busy || key.trim() === ''} onClick={() => void start()} data-part="backup-pgp-start">
            Send me a message
          </Button>
          <Button variant="quiet" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="x2f-field" data-part="backup-pgp">
      <ErrorLine error={error} />
      <p className="x2f-start__help">Decrypt this message with the second key, then paste the code from inside it.</p>
      <pre className="x2f-pre">{challenge.encryptedMessage}</pre>
      <label className="x2f-field x2f-label" htmlFor="backup-code">
        Code from the message
        <input className="x2f-input" id="backup-code" autoComplete="off" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} />
      </label>
      <div className="x2f-row">
        <Button variant={primary} disabled={busy || code.trim() === ''} onClick={() => void finish()} data-part="backup-pgp-finish">
          Verify
        </Button>
        <Button variant="quiet" disabled={busy} onClick={() => void start()}>
          Send a new message
        </Button>
      </div>
    </div>
  );
}
