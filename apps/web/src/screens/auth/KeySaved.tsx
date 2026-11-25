/**
 * Owner 25 Nov security-key report ("then some sort of acknowledgement of it saved, and I name it,
 * because it should let me name it as well"): once a security key or passkey is saved, this says
 * so, then asks for its name (default "Security key 1", 1 to 32 characters, checked here and by
 * the API with `checkKeyName`), stores it (`PUT /v1/account/webauthn/label`) and shows it. A
 * security key then offers its test (owner demo note #94). Continue (or Done) moves on; it is
 * offered once the name is saved, or when saving it failed, so a fault never strands the person.
 *
 * Used by sign-up (the first method, and each one after it) and by Settings → Login methods.
 * DESIGN: wording and look (the kit's security-key icon stands in for a drawing).
 */
import { useId, useState } from 'react';
import { AuthApiError, KEY_NAME_MAX, KEY_NAME_PUNCTUATION, checkKeyName, type KeyNameProblem } from '@x2f/auth-client';
import { Button } from '../../ui/Button.js';
import { StatusIcon } from '../../ui/icons.js';
import { authApi } from './authApi.js';
import { KeyTest } from './KeyTest.js';

export type SavedKind = 'security-key' | 'passkey';

// COPY-UNSIGNED (owner 25 Nov security-key report): every sentence below.
export const KEY_SAVED_COPY = {
  /** While the browser's own sheet is open (PIN, then touch). */
  waiting: (k: SavedKind) =>
    k === 'passkey'
      ? "Follow your device's prompt: your face, fingerprint or PIN makes the passkey."
      : "Enter your key's PIN, then touch your key. Over NFC, hold the key to the back of your phone again when asked.",
  /** The heading of sign-up's screen for the first key. */
  title: (k: SavedKind) => (k === 'passkey' ? 'Name your passkey' : 'Name your security key'),
  saved: (k: SavedKind) => (k === 'passkey' ? 'Passkey saved' : 'Security key saved'),
  nameLabel: (k: SavedKind) => (k === 'passkey' ? 'Name this passkey' : 'Name this key'),
  nameHint: `1 to ${KEY_NAME_MAX} characters: letters, numbers, spaces and ${KEY_NAME_PUNCTUATION.split('').join(' ')}`,
  save: 'Save name',
  saving: 'Saving the name…',
  savedAs: 'Saved as',
  problem: {
    empty: 'Give it a name.',
    'too-long': `Use ${KEY_NAME_MAX} characters or fewer.`,
    characters: `Use letters, numbers, spaces and ${KEY_NAME_PUNCTUATION.split('').join(' ')} in the name, in one alphabet.`,
    /** Security review of wip/lead-seckey-fix: another of the account's keys has this name. */
    taken: 'Another of your keys has that name. Pick a different one.',
  } satisfies Record<KeyNameProblem, string>,
  saveFailed: 'The name was not saved. Try again, or continue and rename it later.',
} as const;

export function keyNameProblemText(problem: KeyNameProblem): string {
  return KEY_SAVED_COPY.problem[problem];
}

type Phase = { kind: 'naming' } | { kind: 'saving' } | { kind: 'named'; name: string } | { kind: 'failed'; text: string };

export function KeySaved({
  kind,
  credentialId,
  defaultName,
  onContinue,
  continueLabel = 'Continue',
  onNamed,
}: {
  kind: SavedKind;
  /** The new credential's id (the registration response's `id`). */
  credentialId: string;
  /** "Security key 1", "Passkey 2" (`defaultKeyName`). */
  defaultName: string;
  onContinue: () => void;
  continueLabel?: string;
  /** Told the name as stored (Settings refreshes its list). */
  onNamed?: (name: string) => void;
}) {
  const id = useId();
  const [name, setName] = useState(defaultName);
  const [phase, setPhase] = useState<Phase>({ kind: 'naming' });
  const [problem, setProblem] = useState<KeyNameProblem | null>(null);

  const save = async () => {
    const checked = checkKeyName(name);
    if (!checked.ok) {
      setProblem(checked.problem);
      return;
    }
    setProblem(null);
    setPhase({ kind: 'saving' });
    try {
      const { label } = await authApi.renameWebAuthnKey({ credentialId, label: checked.name });
      setPhase({ kind: 'named', name: label });
      onNamed?.(label);
    } catch (e) {
      const reason = e instanceof AuthApiError && e.code === 'key-name-invalid' ? e.reason : undefined;
      if (reason === 'empty' || reason === 'too-long' || reason === 'characters' || reason === 'taken') {
        setProblem(reason);
        setPhase({ kind: 'naming' });
      } else setPhase({ kind: 'failed', text: KEY_SAVED_COPY.saveFailed });
    }
  };

  const editing = phase.kind !== 'named';
  return (
    <section className="x2f-start__keydone" data-tone="escrow" data-part="key-done" data-kind={kind} aria-labelledby={`${id}-h`}>
      <span data-part="key-picture">
        <StatusIcon name="security-key" tone="escrow" />
      </span>
      <p className="x2f-start__status" data-tone="escrow" id={`${id}-h`} role="status" data-part="key-saved">
        {KEY_SAVED_COPY.saved(kind)}
      </p>
      {editing ? (
        <form
          className="x2f-stack"
          data-part="key-name-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="x2f-field x2f-label" htmlFor={`${id}-name`}>
            {KEY_SAVED_COPY.nameLabel(kind)}
            <input
              className="x2f-input"
              id={`${id}-name`}
              data-part="key-name-input"
              maxLength={KEY_NAME_MAX * 2}
              autoComplete="off"
              value={name}
              aria-describedby={`${id}-hint`}
              aria-invalid={problem !== null}
              onChange={(e) => {
                setName(e.target.value);
                setProblem(null);
              }}
            />
          </label>
          <p className="x2f-start__help" id={`${id}-hint`}>
            {KEY_SAVED_COPY.nameHint}
          </p>
          {problem !== null ? (
            <p className="x2f-error" role="alert" data-part="key-name-problem">
              {keyNameProblemText(problem)}
            </p>
          ) : null}
          {phase.kind === 'saving' ? (
            <p className="x2f-note" role="status">
              {KEY_SAVED_COPY.saving}
            </p>
          ) : null}
          {phase.kind === 'failed' ? (
            <p className="x2f-error" role="alert" data-part="key-name-failed">
              {phase.text}
            </p>
          ) : null}
          <Button type="submit" variant="primary" disabled={phase.kind === 'saving'} data-part="key-name-save">
            {KEY_SAVED_COPY.save}
          </Button>
        </form>
      ) : (
        <p className="x2f-start__keyname" data-part="key-name">
          <span className="x2f-sr-only">{KEY_SAVED_COPY.savedAs} </span>
          {phase.name}
        </p>
      )}
      {phase.kind === 'named' && kind === 'security-key' ? <KeyTest credentialId={credentialId} /> : null}
      {phase.kind === 'named' || phase.kind === 'failed' ? (
        <Button variant={phase.kind === 'named' ? 'primary' : 'secondary'} onClick={onContinue} data-part="key-continue">
          {continueLabel}
        </Button>
      ) : null}
    </section>
  );
}
