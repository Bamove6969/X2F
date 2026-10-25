/**
 * Setup step 4 (board SetupBackup; spec 6.1 step 4, 6.2 "Backup method"): an optional, strongly
 * recommended backup way to log in: an authenticator app, a security key, a second PGP key or
 * printed recovery codes. "Skip for now" goes straight on to the wallet. While the account's
 * sign-up window is open the server needs no confirm-it's-you for these; the confirm sheet is wired
 * in anyway, so a person who comes back later is asked to confirm rather than refused.
 */
import { useState } from 'react';
import { addWebAuthnKey, withConfirm, type PgpChallenge } from '@x2f/auth-client';
import { Button } from '../../ui/Button.js';
import { ConfirmOpenProvider, isConfirmAbort, useConfirm, usePrimaryVariant } from '../auth/ConfirmSheet.js';
import { authApi } from '../auth/authApi.js';
import { RecoveryCodes } from '../settings/RecoveryCodes.js';
import { Totp } from '../settings/Totp.js';
import { SetupFrame, SetupIntro, useSetup, type BackupChoice } from './kit.js';

type Prove = ReturnType<typeof useConfirm>['prove'];

/** The board's four choices, in its order and words. */
export const BACKUPS: { id: BackupChoice; name: string; short: string; desc: string }[] = [
  { id: 'totp', name: 'Authenticator app', short: 'authenticator app', desc: 'Six-digit codes from any authenticator app.' },
  { id: 'security-key', name: 'Security key', short: 'security key', desc: 'A YubiKey or similar that you keep somewhere safe.' },
  { id: 'pgp', name: 'Second PGP key', short: 'second PGP key', desc: 'A spare PGP key stored separately from your main one.' },
  { id: 'recovery-codes', name: 'Printed recovery codes', short: 'recovery codes', desc: 'Ten one-time codes to print or write down.' },
];

export function Backup() {
  const { update, go } = useSetup();
  const { prove, confirmUi, open } = useConfirm();
  const [pick, setPick] = useState<BackupChoice>('totp');
  const [adding, setAdding] = useState<BackupChoice | null>(null);
  const choice = BACKUPS.find((b) => b.id === pick)!;

  const done = (b: BackupChoice) => {
    update({ backup: b });
    go('wallet');
  };

  return (
    <ConfirmOpenProvider value={open}>
      <SetupFrame
        screen="setup-backup"
        step={4}
        footer={
          <div className="x2f-setup__buttons">
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
        <SetupIntro title="Add a backup way to log in">
          We recommend it. X2F has no email address or phone number for you, so if you lose your key or forget your password, we have no way to let
          you back in.
        </SetupIntro>
        <p className="x2f-setup__panel">
          Your coins stay in your own wallet either way. Without a backup, you could lose this account and the reputation you've built on it.
        </p>
        {adding === null ? (
          <div className="x2f-setup__options" role="radiogroup" aria-label="Backup method">
            {BACKUPS.map((b) => (
              <button
                key={b.id}
                type="button"
                role="radio"
                aria-checked={pick === b.id}
                className="x2f-setup__option"
                data-backup={b.id}
                onClick={() => setPick(b.id)}
              >
                <span className="x2f-setup__option-text">
                  <span className="x2f-setup__choice-name">{b.name}</span>
                  <span className="x2f-setup__choice-desc">{b.desc}</span>
                </span>
                <span className="x2f-setup__dot" aria-hidden="true" />
              </button>
            ))}
          </div>
        ) : (
          <section className="x2f-stack" aria-label={BACKUPS.find((b) => b.id === adding)!.name} data-part="backup-adding">
            {adding === 'totp' ? <Totp prove={prove} onDone={() => done('totp')} onCancel={() => setAdding(null)} /> : null}
            {adding === 'recovery-codes' ? <RecoveryCodes prove={prove} onDone={() => done('recovery-codes')} /> : null}
            {adding === 'security-key' ? <SecurityKeyBackup prove={prove} onDone={() => done('security-key')} onCancel={() => setAdding(null)} /> : null}
            {adding === 'pgp' ? <SecondPgpKey prove={prove} onDone={() => done('pgp')} onCancel={() => setAdding(null)} /> : null}
          </section>
        )}
        {confirmUi}
      </SetupFrame>
    </ConfirmOpenProvider>
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
      if (!isConfirmAbort(e)) setError('That security key was not added. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="x2f-field" data-part="backup-security-key">
      <ErrorLine error={error} />
      <p className="x2f-setup__help">Plug in or hold your security key near the phone, then tap it when asked.</p>
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
      if (!isConfirmAbort(e)) setError('X2F could not use that key. Check that you pasted the whole public key.');
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
    } catch {
      setError('That code did not work. It may have expired: send a new message and try again.');
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
      <p className="x2f-setup__help">Decrypt this message with the second key, then paste the code from inside it.</p>
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
