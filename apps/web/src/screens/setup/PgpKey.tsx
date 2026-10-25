/**
 * Setup step 3, PGP (board SetupPgpKey; spec 6.2): paste the public key. The key is checked on the
 * device as it is pasted (type, expiry and fingerprint, with the same rules as the server), and
 * Continue asks X2F for the first login message (`POST /v1/register/pgp/start`). Nothing inside the
 * key besides its fingerprint is shown.
 */
import { useEffect, useState } from 'react';
import { inspectPublicKey } from '@x2f/auth-client';
import { ApiCallError } from '../../api/client.js';
import { Button } from '../../ui/Button.js';
import { Icon } from '../../ui/icons.js';
import { RegisterError, SetupFrame, SetupIntro, useSetup } from './kit.js';
import { nameError, registerPgpStart, termsChanged } from './register.js';

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
  return at === null ? 'Never' : at.toISOString().slice(0, 10);
}

export function PgpKey() {
  const { state, update, go, path } = useSetup();
  const [key, setKey] = useState(state.publicKey);
  const [check, setCheck] = useState<KeyInspection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; names: boolean } | null>(null);

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
      const names = nameError(e);
      if (names !== null) setError({ text: names, names: true });
      else if (e instanceof ApiCallError && e.detail !== undefined) setError({ text: e.detail, names: false });
      else setError({ text: 'X2F could not use that key just now. Try again.', names: false });
    } finally {
      setBusy(false);
    }
  };

  const ok = check !== null && check.ok;

  return (
    <SetupFrame
      screen="setup-pgp-key"
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
        <textarea
          className="x2f-input x2f-textarea"
          id="pub"
          rows={6}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
      </label>
      {check !== null && check.ok ? (
        <section className="x2f-setup__facts" aria-label="Key check" data-part="key-check">
          <span className="x2f-setup__status" data-tone="escrow">
            <Icon name="check" size={18} stroke={2} />
            Key accepted
          </span>
          <div className="x2f-setup__fact">
            <span className="x2f-setup__fact-name">Type</span>
            <span>{keyType(check)}</span>
          </div>
          <div className="x2f-setup__fact">
            <span className="x2f-setup__fact-name">Expires</span>
            <span>{expiry(check.expiresAt)}</span>
          </div>
          <div className="x2f-setup__fact x2f-setup__fact--wide">
            <span className="x2f-setup__fact-name">Fingerprint (your account ID)</span>
            <span className="x2f-setup__mono">{groupFingerprint(check.fingerprint)}</span>
          </div>
        </section>
      ) : null}
      {check !== null && !check.ok ? (
        <p className="x2f-error" role="alert" data-part="key-refused">
          {check.detail}
        </p>
      ) : null}
      <RegisterError error={error} />
      <p className="x2f-setup__help">
        We accept RSA keys of 4096 bits or more, Ed25519 and Ed448. If a key has expired or been revoked, we'll tell you.
      </p>
      <p className="x2f-setup__help">If your key contains an email address, X2F never shows or uses it. For full privacy, use a key without one.</p>
    </SetupFrame>
  );
}
