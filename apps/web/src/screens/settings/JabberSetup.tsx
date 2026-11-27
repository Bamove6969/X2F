/**
 * Settings → Alerts → Secure Jabber alerts (owner rule p5-7), after Claude Design's JabberSetup
 * board: three steps, the address, the code from the test message, done (with a preview of the one
 * message X2F will ever send). Turn off is a danger tertiary, never a primary. The address is
 * shown masked only (the server never sends it back in full).
 */
import { ALERTS_PATH } from './settingsCopy.js';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { AuthApiError, type JabberStatus } from '@x2f/auth-client';
import { Button } from '../../ui/Button.js';
import { authApi } from '../auth/authApi.js';
import { refusalText } from '../auth/refusals.js';
import { JABBER_COPY as C } from './jabberCopy.js';
import '../screens.css';
import { RetryLine } from '../../ui/RetryButton.js';

type Step = 'address' | 'verify' | 'done';

/** The words for a refusal on this screen; the shared ones (hold, wait, weak session) from `refusalText`. */
export function jabberErrorText(e: unknown): string {
  if (e instanceof AuthApiError) {
    if (e.code === 'jabber-unavailable') return C.unavailable;
    if (e.code === 'jabber-address-invalid') return C.badAddress;
    if (e.code === 'code-invalid') return C.wrongCode;
    if (e.code === 'challenge-expired') return C.codeEnded;
    if (e.code === 'slow-down' && typeof e.retryAfterSeconds === 'number' && e.retryAfterSeconds <= 120) return C.waitSeconds(e.retryAfterSeconds);
  }
  return refusalText(e, C.failed);
}

export function JabberSetup() {
  const [status, setStatus] = useState<JabberStatus | null>(null);
  const [step, setStep] = useState<Step>('address');
  const [jid, setJid] = useState('');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void authApi.getJabber().then(
      (s) => {
        if (!live) return;
        setStatus(s);
        if (s.state === 'on' || s.state === 'paused') setStep('done');
      },
      (e: unknown) => {
        if (!live) return;
        setError(jabberErrorText(e));
        setLoadFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setLoadFailed(false);
    try {
      await fn();
    } catch (e) {
      setError(jabberErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const sendTest = (again: boolean) =>
    run(async () => {
      const r = await authApi.sendJabberTest({ address: jid });
      setPending(r.pendingAddress);
      setResent(again);
      setCode('');
      setStep('verify');
    });

  const turnOn = () =>
    run(async () => {
      setStatus(await authApi.verifyJabber({ code }));
      setStep('done');
    });

  const turnOff = () =>
    run(async () => {
      await authApi.turnOffJabber();
      setStatus((s) => (s ? { ...s, state: 'off', address: null, pendingAddress: null, lastSentAt: null } : s));
      setJid('');
      setStep('address');
    });

  const masked = status?.address ?? pending ?? '';
  const unavailable = status !== null && !status.available;

  return (
    <main className="x2f-screen" data-screen="jabber-setup" data-step={step}>
      <Link className="x2f-button x2f-button--quiet" to={ALERTS_PATH} aria-label={C.back}>
        ‹
      </Link>
      <p className="x2f-note">{C.kicker}</p>
      <h1 className="x2f-screen__title">{C.title}</h1>
      {step !== 'done' ? <p className="x2f-note">{C.lead}</p> : null}
      {error !== null ? (
        <p className="x2f-error" role="alert">
          {/* DESIGN: owner 17 Nov black+orange rule: a failed load's "Try again" is the orange retry (reloads the page). */}
          {loadFailed ? <RetryLine text={error} data-part="jabber-retry" /> : error}
        </p>
      ) : null}
      {unavailable ? <p className="x2f-note" data-part="jabber-unavailable">{C.unavailable}</p> : null}

      {step === 'address' && status?.state === 'broken' ? <p className="x2f-note" data-part="jabber-broken">{C.needsSetUpAgain}</p> : null}

      {step === 'address' ? (
        <section className="x2f-card x2f-field" data-part="jabber-address" aria-labelledby="js-addr-l">
          <label className="x2f-label" id="js-addr-l" htmlFor="js-jid">
            {C.yourAddress}
          </label>
          <input
            className="x2f-input" id="js-jid" type="text" autoComplete="off" autoCapitalize="off" spellCheck={false} inputMode="email"
            placeholder={C.placeholder} value={jid} onChange={(e) => setJid(e.target.value)}
          />
          <p className="x2f-note">{C.anyServer}</p>
          <p className="x2f-note">{C.addContact}</p>
          <Button variant="primary" disabled={busy || unavailable || jid.trim() === ''} onClick={() => void sendTest(false)} data-part="jabber-send-test">
            {C.sendTest}
          </Button>
        </section>
      ) : null}

      {step === 'verify' ? (
        <section className="x2f-card x2f-field" data-part="jabber-verify" aria-labelledby="js-code-l">
          <label className="x2f-label" id="js-code-l" htmlFor="js-code">
            {C.enterCode}
          </label>
          <input
            className="x2f-input" id="js-code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000"
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          />
          <p className="x2f-note">{C.sentTo(masked)}</p>
          <Button variant="secondary" disabled={busy} onClick={() => void sendTest(true)} data-part="jabber-resend">
            {resent ? C.sentAgain : C.resend}
          </Button>
          <Button variant="primary" disabled={busy || code.length !== 6} onClick={() => void turnOn()} data-part="jabber-turn-on">
            {C.turnOn}
          </Button>
        </section>
      ) : null}

      {step === 'done' ? (
        <>
          <section className="x2f-card" data-part="jabber-done" aria-labelledby="js-done-t">
            <h2 className="x2f-card__title" id="js-done-t">
              {C.doneTitle}
            </h2>
            <p className="x2f-note">{C.doneNote(masked)}</p>
          </section>
          <section className="x2f-card" data-part="jabber-preview" aria-labelledby="js-prev-t">
            <h2 className="x2f-card__title" id="js-prev-t">
              {C.previewTitle}
            </h2>
            <p className="x2f-note">
              <strong>{C.previewFrom}</strong>
            </p>
            <p data-part="jabber-preview-text">{C.previewText}</p>
          </section>
          <Link className="x2f-button x2f-button--primary" to={ALERTS_PATH} data-part="jabber-done-link">
            {C.done}
          </Link>
          <Button variant="danger-outline" disabled={busy} onClick={() => void turnOff()} data-part="jabber-turn-off">
            {C.turnOff}
          </Button>
        </>
      ) : null}
    </main>
  );
}
