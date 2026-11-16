/**
 * Setup step 3 for a method ticked after the first one (owner demo notes, 12 Nov 2026: after the
 * first chosen method is set up, the next chosen one follows): a security key or a passkey
 * (`/setup/security-key`, `/setup/passkey`), or the authenticator app (`/setup/authenticator`,
 * after the password it belongs to). The account exists by now, so these use the account's own
 * add-method calls. While the sign-up window is open the server asks no confirm-it's-you for them;
 * the confirm sheet is wired in anyway, as on the backup step, so someone who comes back later is
 * asked to confirm rather than refused. "Set up later" goes on without it (Settings can add it).
 */
import { useState } from 'react';
import { addWebAuthnKey, isStaged, withConfirm, type Staged } from '@x2f/auth-client';
import { Button } from '../../ui/Button.js';
import { ConfirmOpenProvider, isConfirmAbort, useConfirm, usePrimaryVariant } from '../auth/ConfirmSheet.js';
import { authApi } from '../auth/authApi.js';
import { HOLD_COPY } from '../settings/holdCopy.js';
import { Totp } from '../settings/Totp.js';
import { SetupFrame, SetupIntro, finishMethod, useSetup } from './kit.js';
import { TOTP_NO_PASSWORD } from './Login.js';
import { SecurityKeyArt } from './SecurityKeyArt.js';

/** A staged addition (hold model v3) says so before going on; nothing staged goes straight on. */
function useFinish(m: 'security-key' | 'passkey' | 'totp') {
  const api = useSetup();
  const [held, setHeld] = useState(false);
  return {
    held,
    done: (staged?: Staged | undefined) => {
      if (staged !== undefined && isStaged(staged)) setHeld(true);
      else finishMethod(api, m);
    },
    next: () => finishMethod(api, m),
  };
}

function Later({ onClick }: { onClick: () => void }) {
  return (
    // COPY-UNSIGNED
    <Button variant="quiet" onClick={onClick} data-part="method-later">
      Set up later
    </Button>
  );
}

function Held({ onNext }: { onNext: () => void }) {
  return (
    <>
      <p className="x2f-note" role="status" data-part="held-note">
        {HOLD_COPY.staged}
      </p>
      <Button variant="primary" onClick={onNext} data-part="method-next">
        Continue
      </Button>
    </>
  );
}

// COPY-UNSIGNED: the headings and leads of these steps.
const KEY_WORDS = {
  'security-key': { title: 'Add your security key', lead: 'Plug in your security key or hold it near your phone, then tap it when asked.', cta: 'Add security key' },
  passkey: { title: 'Add a passkey', lead: 'Your phone or computer asks for your face, fingerprint or PIN to make the passkey.', cta: 'Add passkey' },
} as const;

export function KeyStep({ kind }: { kind: 'security-key' | 'passkey' }) {
  const { prove, confirmUi, open } = useConfirm();
  const finish = useFinish(kind);
  const primary = open ? 'secondary' : 'primary';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const words = KEY_WORDS[kind];

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      finish.done(await withConfirm({ kind: 'add-method', method: kind }, (t) => addWebAuthnKey(authApi, kind, t !== undefined ? { confirmToken: t } : {}), prove));
    } catch (e) {
      // COPY-UNSIGNED
      if (!isConfirmAbort(e)) setError(kind === 'passkey' ? 'That passkey was not added. Try again.' : 'That security key was not added. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmOpenProvider value={open}>
      <SetupFrame
        screen={`setup-${kind}`}
        step={3}
        footer={
          finish.held ? null : (
            <div className="x2f-start__buttons">
              <Button variant={primary} disabled={busy} onClick={() => void add()} data-part="key-add">
                {words.cta}
              </Button>
              <Later onClick={finish.next} />
            </div>
          )
        }
      >
        <SetupIntro title={words.title}>{words.lead}</SetupIntro>
        {kind === 'security-key' ? <SecurityKeyArt /> : null}
        {error !== null ? (
          <p className="x2f-error" role="alert">
            {error}
          </p>
        ) : null}
        {finish.held ? <Held onNext={finish.next} /> : null}
        {confirmUi}
      </SetupFrame>
    </ConfirmOpenProvider>
  );
}

export function AuthenticatorStep() {
  const { prove, confirmUi, open } = useConfirm();
  const finish = useFinish('totp');
  const { state } = useSetup();
  const noPassword = !state.methods.includes('password');

  return (
    <ConfirmOpenProvider value={open}>
      <SetupFrame screen="setup-authenticator" step={3} footer={finish.held ? null : <Later onClick={finish.next} />}>
        {/* COPY-UNSIGNED */}
        <SetupIntro title="Add your authenticator app">
          Each time you log in with your password, you then type the 6-digit code your authenticator app shows.
          {/* COPY-UNSIGNED (review of third-signup-r3, M3; owner question Q1) */}
          {noPassword ? <span data-part="totp-no-password"> {TOTP_NO_PASSWORD}</span> : null}
        </SetupIntro>
        {finish.held ? <Held onNext={finish.next} /> : <Totp prove={prove} onDone={finish.done} onCancel={finish.next} />}
        {confirmUi}
      </SetupFrame>
    </ConfirmOpenProvider>
  );
}
