import { useId, useState } from 'react';
import type { PgpChallenge } from '../api.js';
import { faultText, refusalOf, type StaffRefusal } from '../refusals.js';
import { Button, CantDoThat, Notice } from './kit.js';

/**
 * Proving a PGP key, for staff login, invite acceptance and owner setup (Plan 4 Task 16): paste the
 * public key, X2F sends a message encrypted to it, decrypt it in the PGP app and paste the code.
 * `start` and `finish` are the screen's own API calls; `onProved` runs after `finish` succeeds.
 * Built from the kit and screens.css fields; no board of its own (the trader app's
 * SetupPgpChallenge is the nearest). DESIGNER-REVIEW. Words: COPY-UNSIGNED
 */
export function PgpProof({
  start,
  finish,
  onProved,
  keyLabel = 'Your PGP public key',
  submitLabel = 'Check code',
  primary = false,
}: {
  start: (publicKey: string) => Promise<PgpChallenge>;
  finish: (challengeId: string, code: string) => Promise<void>;
  onProved: () => void;
  keyLabel?: string;
  submitLabel?: string;
  /** The code's button is the screen's one primary action (Login's PGP way). */
  primary?: boolean;
}) {
  const keyId = useId();
  const msgId = useId();
  const codeId = useId();
  const [key, setKey] = useState('');
  const [challenge, setChallenge] = useState<PgpChallenge | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ code: StaffRefusal; text: string } | null>(null);

  const fail = (e: unknown, fallback: string) => {
    const r = refusalOf(e);
    if (r !== null) setRefusal(r);
    else setFault(faultText(e, fallback));
  };

  const send = async () => {
    if (!key.includes('-----BEGIN PGP')) {
      setFault('Paste your whole public key, from -----BEGIN PGP PUBLIC KEY BLOCK----- to the end.');
      return;
    }
    setBusy(true);
    setFault(null);
    try {
      setChallenge(await start(key));
      setCode('');
    } catch (e) {
      fail(e, 'X2F could not read that key. Check that you pasted the public key, then try again.');
    } finally {
      setBusy(false);
    }
  };

  const check = async () => {
    if (challenge === null) return;
    if (code.trim() === '') {
      setFault('Paste the code from the decrypted message first.');
      return;
    }
    setBusy(true);
    setFault(null);
    try {
      await finish(challenge.challengeId, code.trim());
      onProved();
    } catch (e) {
      fail(e, 'That code did not work. It may have expired: send a new message and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="x2f-stack" data-part="pgp-proof">
      {challenge === null ? (
        <>
          <div className="x2f-field">
            <label className="x2f-label" htmlFor={keyId}>
              {keyLabel}
            </label>
            <textarea id={keyId} className="x2f-textarea" rows={6} spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} />
          </div>
          <Button variant="secondary" disabled={busy} onClick={() => void send()}>
            Send message
          </Button>
        </>
      ) : (
        <>
          <div className="x2f-field">
            <label className="x2f-label" htmlFor={msgId}>
              Decrypt this message in your PGP app
            </label>
            <textarea id={msgId} className="x2f-textarea" rows={6} readOnly spellCheck={false} value={challenge.encryptedMessage} />
          </div>
          <div className="x2f-field">
            <label className="x2f-label" htmlFor={codeId}>
              Code from the message
            </label>
            <input id={codeId} className="x2f-input" autoComplete="one-time-code" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <Button variant={primary ? 'primary' : 'secondary'} disabled={busy} onClick={() => void check()}>
            {submitLabel}
          </Button>
          <Button variant="quiet" disabled={busy} onClick={() => void send()}>
            Send a new message
          </Button>
        </>
      )}
      {fault !== null ? (
        <Notice tone="danger" data-part="pgp-fault">
          {fault}
        </Notice>
      ) : null}
      {refusal !== null ? <CantDoThat body={refusal.text} from={refusal.code} onClose={() => setRefusal(null)} /> : null}
    </div>
  );
}
