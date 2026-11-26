/**
 * Setup step 3 for a method ticked after the first one (owner demo notes, 12 Nov 2026: after the
 * first chosen method is set up, the next chosen one follows): a security key or a passkey
 * (`/setup/security-key`, `/setup/passkey`), or the authenticator app (`/setup/authenticator`).
 * The account exists by now, so these use the account's own add-method calls. While the sign-up
 * window is open the server asks no confirm-it's-you for them; the confirm sheet is wired in anyway,
 * as on the backup step, so someone who comes back later is asked to confirm rather than refused.
 * "Set up later" goes on without it (Settings can add it), but only while the methods still ticked
 * make two kinds without it (owner, 26 Nov 2026: at least two).
 */
import { useEffect, useState } from 'react';
import { MIN_METHOD_KINDS, addWebAuthnKeyWithId, countedKinds, defaultKeyName, withConfirm } from '@x2f/auth-client';
import { Button } from '../../ui/Button.js';
import { ConfirmOpenProvider, isConfirmAbort, useConfirm, usePrimaryVariant } from '../auth/ConfirmSheet.js';
import { authApi } from '../auth/authApi.js';
import { keyErrorText } from '../auth/keyErrors.js';
import { KEY_SAVED_COPY, KeySaved } from '../auth/KeySaved.js';
import { Totp } from '../settings/Totp.js';
import { SetupFrame, SetupIntro, finishMethod, nextStep, useSetup } from './kit.js';
import { SecurityKeyArt } from './SecurityKeyArt.js';

/**
 * `done` once the method is set up; `skip` for "Set up later", which unticks it. `required` when
 * the other methods still ticked would make fewer than two kinds without this one, so it cannot be
 * left for later.
 */
function useFinish(m: 'security-key' | 'passkey' | 'totp') {
  const api = useSetup();
  const rest = api.state.methods.filter((x) => x !== m);
  return {
    required: countedKinds(rest).size < MIN_METHOD_KINDS,
    done: () => finishMethod(api, m),
    skip: () => finishMethod(api, m, { methods: rest }),
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
      const { credentialId } = await withConfirm(
        { kind: 'add-method', method: kind },
        (t) => addWebAuthnKeyWithId(authApi, kind, t !== undefined ? { confirmToken: t } : {}),
        prove,
      );
      // A key added says so and is named (owner 25 Nov).
      setAdded({ credentialId, defaultName: await suggestedKeyName(kind) });
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
          added !== null ? null : (
            <div className="x2f-start__buttons">
              <Button variant={primary} disabled={busy} onClick={() => void add()} data-part="key-add">
                {words.cta}
              </Button>
              {finish.required ? null : <Later onClick={finish.skip} />}
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
        {added !== null ? <KeySaved kind={kind} credentialId={added.credentialId} defaultName={added.defaultName} onContinue={finish.done} /> : null}
        {error !== null ? (
          <p className="x2f-error" role="alert" data-part="key-error">
            {error}
          </p>
        ) : null}
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

  return (
    <ConfirmOpenProvider value={open}>
      <SetupFrame screen="setup-authenticator" step={3} footer={finish.required ? null : <Later onClick={finish.skip} />}>
        {/* COPY-UNSIGNED (owner, 26 Nov 2026: no passwords; the app counts as one of the two) */}
        <SetupIntro title="Add your authenticator app">
          Your authenticator app shows a new 6-digit code every 30 seconds. It counts as one of your two ways in, but it never logs you in by itself.
        </SetupIntro>
        <Totp prove={prove} onDone={finish.done} onCancel={finish.required ? undefined : finish.skip} />
        {confirmUi}
      </SetupFrame>
    </ConfirmOpenProvider>
  );
}
