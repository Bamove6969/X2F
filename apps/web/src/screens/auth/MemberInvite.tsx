/**
 * Joining a team (Plan 2 Task 18; spec 6.7): the page an invite link opens (`/team/join#<code>`).
 * The invite never names the team account (review 2026-11-08 F3): the vendor is named once the
 * member is inside. The code is read from the fragment (never sent in a URL to the server) and then dropped from the
 * address bar. The person first reads, accepts and signs the Terms (review 2026-11-08 F1: nobody gets
 * past the front door without signing the agreement, a team member included; owner 9 Nov 2026,
 * p11-14: the signature too, sent with the first factor's finish), then picks a private
 * login name and proves a PGP key, then adds a second factor: a security key, a passkey or a second PGP key (the staff rule, lead default). The second
 * step starts their first session, and the page goes to the app.
 *
 * No Claude Design board yet (NEEDS_DESIGN_TEAM in test/team-tripwires.test.ts): kit parts and
 * existing classes only.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { startRegistration } from '@simplewebauthn/browser';
import { AuthApiError, type PgpChallenge, type TeamInviteView, type TermsSignature } from '@x2f/auth-client';
import { Button } from '../../ui/Button.js';
import { JOIN_COPY as C } from '../settings/teamCopy.js';
import { TermsScreen } from '../setup/Terms.js';
import { refreshSession } from '../../session/useSession.js';
import { authApi, deviceLabel } from './authApi.js';
import { isExpired, refusalText } from './refusals.js';
import '../screens.css';
import { MessageBox } from '../../ui/MessageBox.js';
import { hasSpace, spaceProblem } from '../setup/names.js';

/** The invite code in a `#fragment`, or null. */
export function inviteFromHash(hash: string): string | null {
  const code = hash.startsWith('#') ? hash.slice(1) : hash;
  return /^[A-Za-z0-9_-]{43}$/.test(code) ? code : null;
}

function ErrorLine({ error }: { error: string | null }) {
  if (error === null) return null;
  return (
    <p className="x2f-error" role="alert">
      {error}
    </p>
  );
}

/** Paste a key, get a message, paste the code back. */
function PgpProof({
  keyLabel,
  start,
  finish,
  primaryLabel,
}: {
  keyLabel: string;
  start: (publicKey: string) => Promise<PgpChallenge>;
  finish: (challengeId: string, code: string) => Promise<void>;
  primaryLabel: string;
}) {
  const [publicKey, setPublicKey] = useState('');
  const [challenge, setChallenge] = useState<PgpChallenge | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      setChallenge(await start(publicKey.trim()));
      setCode('');
      setCopied(false);
    } catch (e) {
      if (e instanceof AuthApiError && e.code === 'login-name-invalid') setError(C.nameInvalid);
      else if (e instanceof AuthApiError && e.code === 'names-unavailable') setError(C.nameUnavailable);
      else setError(refusalText(e, C.keyFailed));
    } finally {
      setBusy(false);
    }
  };

  const prove = async () => {
    setBusy(true);
    setError(null);
    try {
      await finish(challenge!.challengeId, code.trim());
    } catch (e) {
      if (e instanceof AuthApiError && e.code === 'names-unavailable') setError(C.nameUnavailable);
      else setError(isExpired(e) ? C.codeFailed : refusalText(e, C.codeFailed));
    } finally {
      setBusy(false);
    }
  };

  const copy = () => {
    void navigator.clipboard?.writeText(challenge?.encryptedMessage ?? '').then(
      () => setCopied(true),
      () => undefined,
    );
  };

  return (
    <div className="x2f-stack" data-part="pgp-proof">
      <ErrorLine error={error} />
      {challenge === null ? (
        <div className="x2f-field">
          <label className="x2f-label" htmlFor="join-key">
            {keyLabel}
          </label>
          <textarea
            className="x2f-input x2f-textarea"
            id="join-key"
            rows={6}
            autoComplete="off"
            spellCheck={false}
            value={publicKey}
            onChange={(e) => setPublicKey(e.target.value)}
          />
          <Button variant="primary" disabled={busy || publicKey.trim() === ''} onClick={() => void send()} data-part="send-message">
            {C.sendMessage}
          </Button>
        </div>
      ) : (
        <div className="x2f-field">
          <label className="x2f-label" htmlFor="join-message">
            {C.decryptLabel}
          </label>
          <MessageBox id="join-message" data-part="pgp-message">
            {challenge.encryptedMessage}
          </MessageBox>
          <Button variant="secondary" onClick={copy}>
            {copied ? C.copied : C.copyMessage}
          </Button>
          <input className="x2f-input" autoComplete="off" aria-label={C.codeLabel} value={code} onChange={(e) => setCode(e.target.value)} />
          <Button variant="primary" disabled={busy || code.trim() === ''} onClick={() => void prove()} data-part="prove">
            {primaryLabel}
          </Button>
          <Button variant="quiet" disabled={busy} onClick={() => void send()}>
            {C.sendMessage}
          </Button>
        </div>
      )}
    </div>
  );
}

type Second = 'choose' | 'pgp';

export function MemberInvite() {
  const navigate = useNavigate();
  const [code] = useState(() => (typeof window === 'undefined' ? null : inviteFromHash(window.location.hash)));
  const [invite, setInvite] = useState<TeamInviteView | null | 'gone'>(null);
  const [loginName, setLoginName] = useState('');
  /** The Terms version the member accepted on this page; null until then. */
  /** The Terms accepted and signed on the first step (owner 9 Nov 2026, p11-14: everyone who gets a login signs). */
  const [terms, setTerms] = useState<{ version: string; signature: TermsSignature } | null>(null);
  const [setup, setSetup] = useState<{ setupId: string; setupUntil: string } | null>(null);
  const [second, setSecond] = useState<Second>('choose');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // The code leaves the address bar (and so the history) at once.
    if (typeof window !== 'undefined' && window.location.hash !== '') window.history.replaceState(null, '', window.location.pathname);
    if (code === null) {
      setInvite('gone');
      return;
    }
    let live = true;
    authApi.readInvite({ invite: code }).then(
      (v) => live && setInvite(v),
      () => live && setInvite('gone'),
    );
    return () => {
      live = false;
    };
  }, [code]);

  // Signed in as the member now: drop the signed-out session answer read while the invite was open,
  // or the screens behind the front door (session/frontDoor.tsx) would send them to the login.
  const done = () => {
    refreshSession();
    void navigate('/');
  };

  const webauthn = async (kind: 'security-key' | 'passkey') => {
    if (setup === null) return;
    setBusy(true);
    setError(null);
    try {
      const { challengeId, options } = await authApi.joinSecondWebAuthnStart({ setupId: setup.setupId, kind });
      const response = await startRegistration({ optionsJSON: options });
      await authApi.joinSecondWebAuthnFinish({ setupId: setup.setupId, challengeId, response, deviceLabel: deviceLabel() });
      done();
    } catch (e) {
      setError(refusalText(e, C.webauthnFailed));
    } finally {
      setBusy(false);
    }
  };

  // A live invite: the Terms come first, before any name or key.
  if (invite !== null && invite !== 'gone' && code !== null && terms === null) {
    return (
      <TermsScreen
        screen="team-join-terms"
        title={C.title}
        intro={C.termsIntro}
        // A team member still signs (owner 9 Nov 2026, p11-14; owner demo note #187 is the trader's sign-up only).
        sign
        onAccept={async (version, signature) => {
          if (signature !== null) setTerms({ version, signature });
        }}
      />
    );
  }

  return (
    <main className="x2f-screen" data-screen="team-join">
      <h1 className="x2f-screen__title">{C.title}</h1>
      {invite === null ? <p className="x2f-note">{C.loading}</p> : null}
      {invite === 'gone' ? (
        <p className="x2f-note" data-part="invite-gone">
          {C.gone}
        </p>
      ) : null}
      {invite !== null && invite !== 'gone' && code !== null ? (
        <>
          <section className="x2f-card" data-part="invite">
            <p className="x2f-sheet__body" data-part="invite-who">
              {C.invited(invite.tradeTag, invite.roles)}
            </p>
            <p className="x2f-note">{C.twoFactors}</p>
          </section>
          {setup === null ? (
            <section className="x2f-card" data-part="join-first">
              <div className="x2f-field">
                <label className="x2f-label" htmlFor="join-login">
                  {C.loginNameLabel}
                </label>
                <input
                  className="x2f-input"
                  id="join-login"
                  autoComplete="username"
                  maxLength={20}
                  value={loginName}
                  aria-describedby={hasSpace(loginName.trim()) ? 'join-login-space join-login-hint' : 'join-login-hint'}
                  aria-invalid={hasSpace(loginName.trim()) ? true : undefined}
                  onChange={(e) => setLoginName(e.target.value)}
                />
                {/* Owner demo note #108: a username holds no spaces (the API refuses one too). */}
                {hasSpace(loginName.trim()) ? (
                  <p className="x2f-error" id="join-login-space" data-part="join-login-space">
                    {spaceProblem('username')}
                  </p>
                ) : null}
                <p className="x2f-note" id="join-login-hint">
                  {C.loginNameHint}
                </p>
              </div>
              <PgpProof
                keyLabel={C.keyLabel}
                primaryLabel={C.confirmKey}
                start={(publicKey) => authApi.joinStart({ invite: code, loginName: loginName.trim(), publicKey, acceptedTerms: terms!.version })}
                finish={async (challengeId, c) => {
                  const r = await authApi.joinFinish({ challengeId, code: c, termsSignature: terms!.signature });
                  setSetup({ setupId: r.setupId, setupUntil: r.setupUntil });
                }}
              />
            </section>
          ) : (
            <section className="x2f-card" data-part="join-second" aria-labelledby="join-second-h">
              <h2 className="x2f-card__title" id="join-second-h">
                {C.secondTitle}
              </h2>
              <p className="x2f-note">{C.secondUntil(setup.setupUntil)}</p>
              <ErrorLine error={error} />
              {second === 'choose' ? (
                <div className="x2f-stack">
                  <Button variant="primary" disabled={busy} onClick={() => void webauthn('security-key')} data-part="second-security-key">
                    {C.useSecurityKey}
                  </Button>
                  <Button variant="secondary" disabled={busy} onClick={() => void webauthn('passkey')} data-part="second-passkey">
                    {C.usePasskey}
                  </Button>
                  <Button variant="secondary" disabled={busy} onClick={() => setSecond('pgp')} data-part="second-pgp">
                    {C.useSecondPgp}
                  </Button>
                </div>
              ) : (
                <PgpProof
                  keyLabel={C.secondKeyLabel}
                  primaryLabel={C.finish}
                  start={(publicKey) => authApi.joinSecondPgpStart({ setupId: setup.setupId, publicKey })}
                  finish={async (challengeId, c) => {
                    await authApi.joinSecondPgpFinish({ setupId: setup.setupId, challengeId, code: c, deviceLabel: deviceLabel() });
                    done();
                  }}
                />
              )}
            </section>
          )}
        </>
      ) : null}
    </main>
  );
}
