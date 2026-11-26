/**
 * Settings → Security, "Trade key backup" and "Restore on this device" (escrow-key sync, Plan 3
 * Task 42; the steps are tradeKeys.ts, the crypto escrow/keySync.ts). Owner, 26 Nov 2026: each
 * trade's escrow keys are kept on X2F end to end encrypted, readable only by the account holder and
 * the members they assign; unlocked with a passkey or security key (WebAuthn PRF) or a PGP key,
 * never the authenticator app. X2F never sees the reader secret: it is wrapped and unwrapped here.
 *
 * A member holding "Hold trade keys" sets up their own reader key here too (without one, the
 * holder's device has nothing to seal to them); a member without it gets a 403 and sees nothing.
 * Restore is the holder's only: a member's device never imports a trade into an escrow store.
 * No confirm-it's-you step: the API asks none for the reader key (it opens nothing by itself).
 */
import { useCallback, useEffect, useState } from 'react';
import type { BoxKeyPair } from '@x2f/protocol';
import { Button } from '../../ui/Button.js';
import { MessageBox } from '../../ui/MessageBox.js';
import { pgpEnvelopeText, type UnlockEnvelope } from '../../escrow/keySync.js';
import { escrowClient } from '../../escrow/useEscrow.js';
import {
  addUnlock,
  choiceLabel,
  defaultTradeKeysDeps,
  keyChoices,
  keyErrorWords,
  newChoices,
  removeUnlock,
  setUpReader,
  unlockLabel,
  unlockWithPgp,
  unlockWithPrf,
  type KeyChoice,
  type StoredReader,
  type TradeKeysDeps,
  type UnlockOptions,
} from './tradeKeys.js';
import { TRADE_KEYS_COPY as K } from './tradeKeysCopy.js';

export type TradeKeysProps = {
  member: boolean;
  deps?: TradeKeysDeps & { readerState: () => Promise<StoredReader | 'none' | 'hidden'> };
  restore?: (reader: BoxKeyPair) => Promise<string[] | null>;
};

type Loaded = { reader: StoredReader | null; options: UnlockOptions };
type Mode = 'idle' | 'setup' | 'add-unlock' | 'add-pick' | 'restore';

const defaultRestore = async (reader: BoxKeyPair): Promise<string[] | null> => {
  const c = escrowClient();
  return c.restoreTrades ? c.restoreTrades(reader) : null;
};

export function TradeKeys({ member, deps: given, restore = defaultRestore }: TradeKeysProps) {
  const [deps] = useState(() => given ?? defaultTradeKeysDeps());
  const [state, setState] = useState<'loading' | 'failed' | 'hidden' | Loaded>('loading');
  const [mode, setMode] = useState<Mode>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // The reader secret, unlocked to add another way in; dropped as soon as that is done or cancelled.
  const [unlocked, setUnlocked] = useState<BoxKeyPair | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await deps.readerState();
      if (r === 'hidden') return setState('hidden');
      setState({ reader: r === 'none' ? null : r, options: await deps.unlockMethods() });
    } catch {
      setState('failed');
    }
  }, [deps]);

  useEffect(() => {
    void load();
  }, [load]);

  const reset = () => {
    unlocked?.boxSecret.fill(0);
    setUnlocked(null);
    setMode('idle');
  };

  const step = async (f: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await f();
    } catch (e) {
      setError(keyErrorWords(e, fallback));
    } finally {
      setBusy(false);
    }
  };

  if (state === 'hidden') return null;

  const body = () => {
    if (state === 'loading') return <p className="x2f-note">{K.loading}</p>;
    if (state === 'failed') return <p className="x2f-error" role="alert" data-part="trade-keys-failed">{K.loadFailed}</p>;
    const { reader, options } = state;
    const choices = keyChoices(options);

    if (reader === null) {
      return (
        <>
          <p className="x2f-note" data-part="trade-keys-none">
            {member ? K.noneMember : K.none}
          </p>
          {mode === 'setup' ? (
            <ChoiceList
              choices={choices}
              lead={K.pickMethod}
              busy={busy}
              onPick={(c) => void step(async () => {
                await setUpReader(c, deps);
                setMode('idle');
                await load();
              }, K.saveFailed)}
              onCancel={reset}
            />
          ) : (
            <Button variant="secondary" disabled={busy} onClick={() => setMode('setup')} data-part="trade-keys-setup">
              {K.setUp}
            </Button>
          )}
        </>
      );
    }

    const only = reader.unlocks.length <= 1;
    return (
      <>
        <p className="x2f-note" data-part="trade-keys-on">
          {K.on}
        </p>
        <h3 className="x2f-section-title">{K.unlocksTitle}</h3>
        <ul className="x2f-list" data-part="trade-keys-unlocks">
          {reader.unlocks.map((u) => {
            const name = unlockLabel(u, options);
            return (
              <li className="x2f-list__row" key={`${u.method}:${u.ref}`} data-unlock={u.method}>
                <span className="x2f-list__label">{name}</span>
                <Button
                  variant="danger"
                  disabled={busy || only}
                  aria-label={K.removeLabel(name)}
                  onClick={() =>
                    void step(async () => {
                      if (await removeUnlock(reader, u, deps)) await load();
                      else setNote(K.lastUnlock);
                    }, K.saveFailed)
                  }
                  data-part="trade-keys-remove"
                >
                  {K.remove}
                </Button>
              </li>
            );
          })}
        </ul>
        {only ? <p className="x2f-note" data-part="trade-keys-last">{K.lastUnlock}</p> : null}

        {mode === 'add-unlock' ? (
          <Unlocker
            lead={K.addFirst}
            reader={reader}
            options={options}
            busy={busy}
            deps={deps}
            step={step}
            onUnlocked={(pair) => {
              setUnlocked(pair);
              setMode('add-pick');
            }}
            onCancel={reset}
          />
        ) : null}
        {mode === 'add-pick' && unlocked !== null ? (
          <ChoiceList
            choices={newChoices(options, reader.unlocks)}
            lead={K.addPick}
            busy={busy}
            onPick={(c) => void step(async () => {
              await addUnlock(reader, unlocked, c, deps);
              reset();
              await load();
            }, K.saveFailed)}
            onCancel={reset}
          />
        ) : null}
        {mode === 'idle' && newChoices(options, reader.unlocks).length > 0 ? (
          <Button variant="secondary" disabled={busy} onClick={() => setMode('add-unlock')} data-part="trade-keys-add">
            {K.addUnlock}
          </Button>
        ) : null}

        {!member ? (
          <div className="x2f-stack" data-part="trade-keys-restore">
            <h3 className="x2f-section-title">{K.restoreTitle}</h3>
            <p className="x2f-note">{K.restoreAbout}</p>
            {mode === 'restore' ? (
              <Unlocker
                lead={null}
                reader={reader}
                options={options}
                busy={busy}
                deps={deps}
                step={step}
                onUnlocked={async (pair) => {
                  setNote(K.restoring);
                  let codes: string[] | null = null;
                  try {
                    codes = await restore(pair);
                  } catch {
                    codes = null;
                  } finally {
                    pair.boxSecret.fill(0);
                  }
                  setMode('idle');
                  if (codes === null) {
                    setNote(null);
                    setError(K.restoreFailed);
                  } else setNote(K.restored(codes.length));
                }}
                onCancel={reset}
              />
            ) : mode === 'idle' ? (
              <Button variant="secondary" disabled={busy} onClick={() => setMode('restore')} data-part="trade-keys-restore-start">
                {K.restore}
              </Button>
            ) : null}
          </div>
        ) : null}
      </>
    );
  };

  return (
    <section className="x2f-card" data-part="trade-keys" aria-labelledby="trade-keys-h">
      <h2 className="x2f-card__title" id="trade-keys-h">
        {K.title}
      </h2>
      <p className="x2f-note">{K.about}</p>
      {error !== null ? (
        <p className="x2f-error" role="alert" data-part="trade-keys-error">
          {error}
        </p>
      ) : null}
      {note !== null ? (
        <p className="x2f-note" role="status" data-part="trade-keys-note">
          {note}
        </p>
      ) : null}
      {body()}
    </section>
  );
}

/** The keys to pick from, with why the authenticator app is not among them. */
function ChoiceList({ choices, lead, busy, onPick, onCancel }: { choices: KeyChoice[]; lead: string; busy: boolean; onPick: (c: KeyChoice) => void; onCancel: () => void }) {
  return (
    <div className="x2f-stack" data-part="trade-keys-choices">
      <p className="x2f-note">{lead}</p>
      {choices.length === 0 ? <p className="x2f-note" data-part="trade-keys-no-keys">{K.noKeys}</p> : null}
      {choices.map((c) => (
        <Button key={`${c.method}:${c.ref}`} variant="secondary" disabled={busy} onClick={() => onPick(c)} data-choice={c.method}>
          {choiceLabel(c)}
        </Button>
      ))}
      {choices.some((c) => c.method === 'prf') ? <p className="x2f-note">{K.prfNote}</p> : null}
      <p className="x2f-note" data-part="trade-keys-no-totp">
        {K.noTotp}
      </p>
      {busy ? <p className="x2f-note">{K.working}</p> : null}
      <Button variant="quiet" disabled={busy} onClick={onCancel} data-part="trade-keys-cancel">
        {K.cancel}
      </Button>
    </div>
  );
}

/**
 * Unlocks the reader secret with one of the ways the backup has: a passkey or security key (asked
 * for its PRF output), or a PGP key (the person decrypts the message in their own tool and pastes
 * the text back; keySync.ts finds the 64 hex in it).
 */
function Unlocker({
  lead,
  reader,
  options,
  busy,
  deps,
  step,
  onUnlocked,
  onCancel,
}: {
  lead: string | null;
  reader: StoredReader;
  options: UnlockOptions;
  busy: boolean;
  deps: TradeKeysDeps;
  step: (f: () => Promise<void>, fallback: string) => Promise<void>;
  onUnlocked: (pair: BoxKeyPair) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [pgp, setPgp] = useState<UnlockEnvelope | null>(null);
  const [pasted, setPasted] = useState('');
  const [copied, setCopied] = useState(false);
  const message = pgp === null ? '' : pgpEnvelopeText(pgp);

  if (pgp !== null) {
    return (
      <div className="x2f-field" data-part="trade-keys-pgp">
        <label className="x2f-label" htmlFor="trade-keys-pgp-message">
          {K.pgpDecrypt}
        </label>
        <MessageBox id="trade-keys-pgp-message">{message}</MessageBox>
        <Button
          variant="secondary"
          onClick={() => void navigator.clipboard?.writeText(message).then(() => setCopied(true), () => undefined)}
          data-part="trade-keys-copy"
        >
          {copied ? K.pgpCopied : K.pgpCopy}
        </Button>
        <label className="x2f-label" htmlFor="trade-keys-pgp-paste">
          {K.pgpPaste}
        </label>
        <textarea className="x2f-input x2f-textarea" id="trade-keys-pgp-paste" rows={3} spellCheck={false} value={pasted} onChange={(e) => setPasted(e.target.value)} />
        <div className="x2f-row">
          <Button
            variant="secondary"
            disabled={busy || pasted.trim() === ''}
            onClick={() => void step(async () => onUnlocked(await unlockWithPgp(reader, pasted)), K.badUnlock)}
            data-part="trade-keys-pgp-unlock"
          >
            {K.pgpUnlock}
          </Button>
          <Button variant="quiet" disabled={busy} onClick={onCancel}>
            {K.cancel}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="x2f-stack" data-part="trade-keys-unlocker">
      {lead !== null ? <p className="x2f-note">{lead}</p> : null}
      {reader.unlocks.map((u) => (
        <Button
          key={`${u.method}:${u.ref}`}
          variant="secondary"
          disabled={busy}
          onClick={() => (u.method === 'pgp' ? setPgp(u) : void step(async () => onUnlocked(await unlockWithPrf(reader, u, deps)), K.badUnlock))}
          data-unlock-with={u.method}
        >
          {unlockLabel(u, options)}
        </Button>
      ))}
      {busy ? <p className="x2f-note">{K.working}</p> : null}
      <Button variant="quiet" disabled={busy} onClick={onCancel} data-part="trade-keys-cancel">
        {K.cancel}
      </Button>
    </div>
  );
}
