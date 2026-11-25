/**
 * Setup step 3 for a method ticked after the first one (owner demo notes, 12 Nov 2026: after the
 * first chosen method is set up, the next chosen one follows): a security key or a passkey
 * (`/setup/security-key`, `/setup/passkey`), or the authenticator app (`/setup/authenticator`,
 * after the password it belongs to). The account exists by now, so these use the account's own
 * add-method calls. While the sign-up window is open the server asks no confirm-it's-you for them;
 * the confirm sheet is wired in anyway, as on the backup step, so someone who comes back later is
 * asked to confirm rather than refused. "Set up later" goes on without it (Settings can add it).
 */
import { useEffect, useState } from 'react';
import { STANDS_ALONE, addWebAuthnKeyWithId, defaultKeyName, isStaged, withConfirm, type Staged } from '@x2f/auth-client';
import { Button } from '../../ui/Button.js';
import { ConfirmOpenProvider, isConfirmAbort, useConfirm, usePrimaryVariant } from '../auth/ConfirmSheet.js';
import { authApi } from '../auth/authApi.js';
import { keyErrorText } from '../auth/keyErrors.js';
import { KEY_SAVED_COPY, KeySaved } from '../auth/KeySaved.js';
import { HOLD_COPY } from '../settings/holdCopy.js';
import { Totp } from '../settings/Totp.js';
import { SetupFrame, SetupIntro, finishMethod, nextStep, useSetup } from './kit.js';
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

// COPY-UNSIGNED: the headings and leads of these steps (the security key's lead: owner 25 Nov security-key report).
const KEY_WORDS = {
  'security-key': { title: 'Add your security key', lead: 'Plug in your security key or hold it near your phone, then enter its PIN and touch it when asked.', cta: 'Add security key' },
  passkey: { title: 'Add a passkey', lead: 'Your phone or computer asks for your face, fingerprint or PIN to make the passkey.', cta: 'Add passkey' },
} as const;

/**
 * The suggested name of a key just added: "Security key N" / "Passkey N", N the account's count of
 * that kind now (the new one included); 1 when the list cannot be read.
 */
export async function suggestedKeyName(kind: 'security-key' | 'passkey'): Promise<string> {
  try {
    const n = (await authApi.listMethods()).filter((m) => m.type === kind).length;
    return defaultKeyName(kind, n);
  } catch {
    return defaultKeyName(kind, 1);
  }
}

/**
 * Owner 16 Nov 2026 (demo: the key was added, but the step went straight on, so he could not
 * tell) and his 25 Nov security-key report ("some sort of acknowledgement of it saved, and I name
 * it"): while the browser's sheet is open the step says to enter the PIN and touch the key; once
 * saved it says so (KeySaved), asks for the key's name, offers the test (note #94) and moves on
 * only on Continue.
 */
export function KeyStep({ kind }: { kind: 'security-key' | 'passkey' }) {
  const { prove, confirmUi, open } = useConfirm();
  const finish = useFinish(kind);
  const primary = open ? 'secondary' : 'primary';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The added key's credential id and suggested name; null until a key is added. */
  const [added, setAdded] = useState<{ credentialId: string; defaultName: string } | null>(null);
  const words = KEY_WORDS[kind];

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const { staged, credentialId } = await withConfirm(
        { kind: 'add-method', method: kind },
        (t) => addWebAuthnKeyWithId(authApi, kind, t !== undefined ? { confirmToken: t } : {}),
        prove,
      );
      // A key added now says so and is named (owner 25 Nov); a staged one (no key row yet) says it is waiting.
      if (!(staged !== undefined && isStaged(staged))) setAdded({ credentialId, defaultName: await suggestedKeyName(kind) });
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
        {kind === 'security-key' && added === null ? <SecurityKeyArt /> : null}
        {busy ? (
          <p className="x2f-note" role="status" data-part="key-waiting">
            {KEY_SAVED_COPY.waiting(kind)}
          </p>
        ) : null}
        {added !== null ? <KeySaved kind={kind} credentialId={added.credentialId} defaultName={added.defaultName} onContinue={finish.next} /> : null}
        {error !== null ? (
          <p className="x2f-error" role="alert" data-part="key-error">
            {error}
          </p>
        ) : null}
        {finish.held ? <Held onNext={finish.next} /> : null}
        {confirmUi}
      </SetupFrame>
    </ConfirmOpenProvider>
  );
}

/**
 * Owner 25 Nov security-key report: the passkey or security key the account was just made with
 * (the login step's first method) is acknowledged and named here, in that step's place, before
 * the next ticked method. Its "Security key 1" / "Passkey 1" is the account's first.
 */
export function FirstKeySaved() {
  const api = useSetup();
  const saved = api.state.keySaved;
  if (saved === null) return null;
  return (
    <SetupFrame screen="setup-key-saved" step={3} footer={null}>
      <SetupIntro title={KEY_SAVED_COPY.title(saved.kind)} />
      <KeySaved
        kind={saved.kind}
        credentialId={saved.credentialId}
        defaultName={defaultKeyName(saved.kind, 1)}
        onContinue={() => {
          api.update({ keySaved: null });
          api.go(nextStep(api.state), { replace: true });
        }}
      />
    </SetupFrame>
  );
}

export function AuthenticatorStep() {
  const { prove, confirmUi, open } = useConfirm();
  const finish = useFinish('totp');
  const { state } = useSetup();
  // Owner decision, 16 Nov 2026: the authenticator app goes only with a password (the server refuses
  // it otherwise, 409 `totp-needs-password`). The sign-up screen never ticks it alone; a flow saved
  // before that (signup round 3) goes straight on, as "Set up later" would.
  const noPassword = !state.methods.includes('password');
  useEffect(() => {
    if (noPassword) finish.next();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, [noPassword]);
  if (noPassword) return null;
  // Owner decision, 16 Nov 2026: a password does not stand alone, so with no PGP key, security key
  // or passkey ticked the authenticator app is not left for later (sign-up cannot finish without it).
  const required = !state.methods.some((m) => STANDS_ALONE.has(m));

  return (
    <ConfirmOpenProvider value={open}>
      <SetupFrame screen="setup-authenticator" step={3} footer={finish.held || required ? null : <Later onClick={finish.next} />}>
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
