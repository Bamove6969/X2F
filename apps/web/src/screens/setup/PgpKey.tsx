/**
 * Setup step 3, PGP (board SetupPgpKey; spec 6.2): paste the public key. The key is checked on the
 * device as it is pasted (type, expiry and fingerprint, with the same rules as the server), and
 * Continue asks X2F for the first login message (`POST /v1/register/pgp/start`). Signup round 3
 * (owner's demo notes, 13 Nov 2026): the facts also show the user ID's name, if the key has one
 * (never its email address), and the creation date, to the person only; nothing new is stored.
 * Dates are UTC.
 */
import { formatDate } from '../../ui/dates.js';
import { useEffect, useState } from 'react';
import { inspectPublicKey } from '@x2f/auth-client';
import { Button } from '../../ui/Button.js';
import { Icon } from '../../ui/icons.js';
import { RegisterError, SetupFrame, SetupIntro, useSetup } from './kit.js';
import { registerPgpStart, setupError, termsChanged, type SetupError } from './register.js';

type KeyInspection = Awaited<ReturnType<typeof inspectPublicKey>>;

const ALGORITHM: Record<'rsa' | 'ed25519' | 'ed448', string> = { rsa: 'RSA', ed25519: 'Ed25519', ed448: 'Ed448' };

/** "3F2A 9C41 … 0D15": groups of four, with a wider gap half way, as PGP apps show it. */
export function groupFingerprint(fp: string): string {
  const groups = fp.toUpperCase().match(/.{1,4}/g) ?? [];
  const half = Math.ceil(groups.length / 2);
  return `${groups.slice(0, half).join(' ')}  ${groups.slice(half).join(' ')}`.trim();
}

function keyType(k: Extract<KeyInspection, { ok: true }>): string {
  return k.algorithm === 'rsa' && k.bits !== null ? `RSA ${k.bits}` : ALGORITHM[k.algorithm];
}

function expiry(at: Date | null): string {
  return at === null ? 'Never' : formatDate(at);
}

/** The key's facts once it passes the check (board SetupPgpKey, plus signup round 3's name and dates). */
export function KeyFacts({ check }: { check: Extract<KeyInspection, { ok: true }> }) {
  return (
    <section className="x2f-start__facts" aria-label="Key check" data-part="key-check">
      <span className="x2f-start__status" data-tone="escrow">
        <Icon name="check" size={18} stroke={2} />
        Key accepted
      </span>
      {check.name !== null ? (
        <div className="x2f-start__fact x2f-start__fact--wide" data-part="key-name">
          {/* COPY-UNSIGNED */}
          <span className="x2f-start__fact-name">Name on the key</span>
          <span>{check.name}</span>
        </div>
      ) : null}
      <div className="x2f-start__fact">
        <span className="x2f-start__fact-name">Type</span>
        <span>{keyType(check)}</span>
      </div>
      <div className="x2f-start__fact" data-part="key-created">
        {/* COPY-UNSIGNED */}
        <span className="x2f-start__fact-name">Created</span>
        <span>{formatDate(check.createdAt)}</span>
      </div>
      <div className="x2f-start__fact">
        <span className="x2f-start__fact-name">Expires</span>
        <span>{expiry(check.expiresAt)}</span>
      </div>
      <div className="x2f-start__fact x2f-start__fact--wide">
        <span className="x2f-start__fact-name">Fingerprint (your account ID)</span>
        <span className="x2f-start__mono">{groupFingerprint(check.fingerprint)}</span>
      </div>
    </section>
  );
}

export function PgpKey() {
  const { state, update, go, path } = useSetup();
  const [key, setKey] = useState(state.publicKey);
  const [check, setCheck] = useState<KeyInspection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SetupError | null>(null);

  useEffect(() => {
    const armored = key.trim();
    if (armored === '') {
      setCheck(null);
      return;
    }
    let live = true;
    void inspectPublicKey(armored, new Date()).then((r) => {
      if (live) setCheck(r);
    });
    return () => {
      live = false;
    };
  }, [key]);

  const next = async () => {
    setBusy(true);
    setError(null);
    try {
      const challenge = await registerPgpStart({ displayName: state.displayName, loginName: state.loginName }, key.trim());
      update({ publicKey: key.trim(), challenge });
      go('pgp-code');
    } catch (e) {
      if (termsChanged(e)) {
        update({ terms: null });
        go('');
        return;
      }
      // The server's own sentence about a refused key (AuthApiError detail) is shown as it wrote it.
      setError(setupError(e, 'X2F could not use that key just now. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const ok = check !== null && check.ok;

  return (
    <SetupFrame
      screen="setup-pgp-key"
      // COPY-UNSIGNED (owner's demo notes, 13 Nov 2026)
      title="Adding your public PGP key"
      step={3}
      back={path('login')}
      footer={
        <Button variant="primary" disabled={!ok || busy} onClick={() => void next()} data-part="key-continue">
          Continue
        </Button>
      }
    >
      <SetupIntro title="Add your PGP public key">
        Paste the public key from your PGP app. X2F never asks for your private key, so don't paste it here.
      </SetupIntro>
      <label className="x2f-field x2f-label" htmlFor="pub">
        Public key
        {/* Owner demo note (12 Nov 2026): a much bigger box, so the whole key shows. */}
        <textarea
          className="x2f-input x2f-textarea x2f-textarea--key"
          id="pub"
          rows={18}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
      </label>
      {check !== null && check.ok ? <KeyFacts check={check} /> : null}
      {check !== null && !check.ok ? (
        <p className="x2f-error" role="alert" data-part="key-refused">
          {check.detail}
        </p>
      ) : null}
      <RegisterError error={error} />
      <p className="x2f-start__help">
        We accept RSA keys of 4096 bits or more, Ed25519 and Ed448. If a key has expired or been revoked, we'll tell you.
      </p>
      <p className="x2f-start__help">If your key contains an email address, X2F never shows or uses it. For full privacy, use a key without one.</p>
    </SetupFrame>
  );
}
