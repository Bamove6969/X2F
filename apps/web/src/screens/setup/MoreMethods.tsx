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
import { StatusIcon } from '../../ui/icons.js';
import { ConfirmOpenProvider, isConfirmAbort, useConfirm, usePrimaryVariant } from '../auth/ConfirmSheet.js';
import { authApi } from '../auth/authApi.js';
import { keyErrorText } from '../auth/keyErrors.js';
import { HOLD_COPY } from '../settings/holdCopy.js';
import { Totp } from '../settings/Totp.js';
import { SetupFrame, SetupIntro, finishMethod, useSetup } from './kit.js';

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

/** The name the server gives a key left unnamed (api webauthn.ts cleanLabel), trimmed and at most 60 characters as it keeps it. */
const KEY_NAME_MAX = 60;
export function keyNameShown(name: string): string {
  const n = Array.from(name.trim()).slice(0, KEY_NAME_MAX).join('').trim();
  return n === '' ? 'Security key' : n;
}

/**
 * Owner 16 Nov 2026 (demo: the key was added, but the step went straight on, so he could not tell):
 * like his 13 Nov note for the authenticator app, the step turns green, shows a security key and the
 * name it was given, and he moves on himself with Continue.
 */
function KeyAdded({ name, onNext }: { name: string; onNext: () => void }) {
  return (
    <section className="x2f-start__keydone" data-tone="escrow" data-part="key-done" aria-labelledby="key-done-h">
      {/* DESIGN: needs drawing (a picture of a security key; the kit's security-key icon for now). */}
      <span data-part="key-picture">
        <StatusIcon name="security-key" tone="escrow" />
      </span>
      {/* DESIGN: wording. COPY-UNSIGNED */}
      <p className="x2f-start__status" data-tone="escrow" id="key-done-h" role="status">
        Security key added
      </p>
      <p className="x2f-start__keyname" data-part="key-name">
        {name}
      </p>
      <Button variant="primary" onClick={onNext} data-part="key-continue">
        Continue
      </Button>
    </section>
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
  /** The security key's name, typed before the tap (sent as its label). */
  const [name, setName] = useState('');
  /** The added key's name as shown; null until a key is added. */
  const [added, setAdded] = useState<string | null>(null);
  const words = KEY_WORDS[kind];

  const add = async () => {
    setBusy(true);
    setError(null);
    const label = kind === 'security-key' && name.trim() !== '' ? { label: name.trim() } : {};
    try {
      const staged = await withConfirm(
        { kind: 'add-method', method: kind },
        (t) => addWebAuthnKey(authApi, kind, { ...label, ...(t !== undefined ? { confirmToken: t } : {}) }),
        prove,
      );
      // A security key added now says so and waits for Continue (owner 16 Nov); a staged one says it is waiting.
      if (kind === 'security-key' && !(staged !== undefined && isStaged(staged))) setAdded(keyNameShown(name));
      else finish.done(staged);
    } catch (e) {
      // Why it failed, when the browser or the server says (owner demo 13 Nov).
      if (!isConfirmAbort(e)) setError(keyErrorText(e, kind));
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
          finish.held || added !== null ? null : (
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
        {kind === 'security-key' && added === null && !finish.held ? (
          // DESIGN: wording. COPY-UNSIGNED
          <label className="x2f-field x2f-label" htmlFor="key-name">
            Name this key (optional)
            <input className="x2f-input" id="key-name" maxLength={KEY_NAME_MAX} autoComplete="off" placeholder="Security key" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        ) : null}
        {added !== null ? <KeyAdded name={added} onNext={finish.next} /> : null}
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

  return (
    <ConfirmOpenProvider value={open}>
      <SetupFrame screen="setup-authenticator" step={3} footer={finish.held ? null : <Later onClick={finish.next} />}>
        {/* COPY-UNSIGNED */}
        <SetupIntro title="Add your authenticator app">
          Each time you log in with your password, you then type the 6-digit code your authenticator app shows.
        </SetupIntro>
        {finish.held ? <Held onNext={finish.next} /> : <Totp prove={prove} onDone={finish.done} onCancel={finish.next} />}
        {confirmUi}
      </SetupFrame>
    </ConfirmOpenProvider>
  );
}
