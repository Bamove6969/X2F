/**
 * The Terms step of the staff invite (Plan 4 Task 16; owner 9 Nov 2026, p11-14: "everyone who gets
 * a login signs", staff too). The same parts as the trader app's Terms screen (apps/web
 * screens/setup/Terms.tsx), never a copy of its text: the key points, the draft note and the full
 * text come from the trader app's termsText.ts through the kit, the version from
 * `GET /staff/v1/terms` (the staff origin's answer to the trader API's `GET /v1/terms`: the same
 * `X2F_TERMS_VERSION`), and the signature pad is the trader app's SignaturePad (design 9 Nov,
 * p11-15, canvas ea2a9ca8: drawn, or the typed name for anyone who can't draw).
 *
 * The scroll box must be read to its end before the tick box enables; Continue needs both the tick
 * and a signature. A server version this bundle does not carry is not accepted from here (the
 * trader's review M4): the stale notice asks for a reload. `onAccept` gets the version and the
 * signature; the invite page sends them with the names (`acceptedTerms`, `termsSignature`).
 * `changed` is set when the API refused those with `terms-not-accepted` (the Terms changed between
 * reading and accepting, the trader's review M3): the step is mounted again, empty, and says so.
 *
 * The trader's sentences are reused where they are the same; the step's own lines (the heading's
 * owner passes it, the intro, "Continue") are draft copy. COPY-UNSIGNED
 */
import type { TermsSignature } from '@x2f/auth-client';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { staffTerms } from '../api.js';
import { Button, KEY_POINTS, PRIVACY_HEADING, SignaturePad, TERMS, TermsParagraphs, TERMS_DRAFT_NOTE, TERMS_TEXT_VERSION } from './kit.js';
import './staff.css';

/** How close to the bottom (in CSS pixels) counts as the end, for rounding on zoomed screens (as the trader's). */
const END_SLACK = 4;

/** The step's button: the invite's own word for going on. COPY-UNSIGNED */
export const TERMS_CONTINUE = 'Continue';
/** Shown when the Terms changed between reading and accepting (the trader's sentence). */
export const TERMS_CHANGED = 'The Terms changed while you were reading. Read them to the end again, then accept.';

export function TermsStep({
  heading,
  changed = false,
  onAccept,
}: {
  heading: string;
  /** The API refused the last acceptance with `terms-not-accepted`: say so once the version is in. */
  changed?: boolean;
  onAccept: (version: string, signature: TermsSignature) => void;
}) {
  const id = useId();
  const [version, setVersion] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [read, setRead] = useState(false);
  const [ticked, setTicked] = useState(false);
  const [signature, setSignature] = useState<TermsSignature | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const t = await staffTerms();
      setVersion(t.version);
    } catch {
      setLoadFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const checkEnd = useCallback(() => {
    const el = box.current;
    if (el !== null && el.scrollTop + el.clientHeight >= el.scrollHeight - END_SLACK) setRead(true);
  }, []);

  // A box tall enough to show everything counts as read at once.
  useLayoutEffect(() => {
    checkEnd();
    window.addEventListener('resize', checkEnd);
    return () => window.removeEventListener('resize', checkEnd);
  }, [checkEnd]);

  // This page shows only the text it was built with: a server version it does not carry is not
  // accepted from here (the trader's review M4).
  const stale = version !== null && version !== TERMS_TEXT_VERSION;
  const ready = ticked && signature !== null && version !== null && !stale;

  /** Scrolls the box to the top (`null`) or to a section heading. */
  const show = (target: string | null) => {
    const el = box.current;
    if (el === null) return;
    const h = target === null ? null : el.querySelector<HTMLElement>(`[data-heading="${target}"]`);
    el.scrollTo({ top: h === null ? 0 : h.offsetTop - el.offsetTop });
    el.focus({ preventScroll: true });
  };

  const staleId = `${id}-stale`;
  const hintId = `${id}-hint`;
  const helpId = `${id}-help`;

  return (
    <section className="x2f-staff-step x2f-staff-terms" aria-labelledby={`${id}-h`} data-part="invite-terms">
      <h2 id={`${id}-h`} className="x2f-staff-step__title">
        {heading}
      </h2>
      <p className="x2f-staff-step__text">
        {/* After the trader's SetupTerms intro (design 9 Nov, p11-15); staff go on with Continue. COPY-UNSIGNED */}
        Staff sign the Terms too. Read them to the end. If you agree to X2F's rules and Terms, tick the box, sign your name and continue.
      </p>
      <ul className="x2f-terms__points" aria-label="Key points">
        {KEY_POINTS.map((k) => (
          <li key={k}>{k}</li>
        ))}
      </ul>
      <div className="x2f-terms" ref={box} onScroll={checkEnd} tabIndex={0} role="region" aria-label="Full Terms of Service" data-part="terms-text">
        <p className="x2f-terms__note">{TERMS_DRAFT_NOTE}</p>
        {TERMS.map((s) => (
          <section key={s.heading} className="x2f-terms__section">
            <h3 className="x2f-terms__heading" data-heading={s.heading}>
              {s.heading}
            </h3>
            <TermsParagraphs paragraphs={s.paragraphs} />
          </section>
        ))}
        <p className="x2f-terms__end">{version !== null ? `End of Terms. Version ${version}.` : 'End of Terms.'}</p>
      </div>
      {loadFailed ? (
        <p className="x2f-error" role="alert" data-part="terms-load-failed">
          Could not load the Terms version.{' '}
          <button type="button" className="x2f-start__textbutton" onClick={() => void load()}>
            Try again
          </button>
        </p>
      ) : null}
      {changed && version === TERMS_TEXT_VERSION ? (
        <p className="x2f-error" role="alert" data-part="terms-changed">
          {TERMS_CHANGED}
        </p>
      ) : null}
      {stale ? (
        <p className="x2f-error" role="alert" id={staleId} data-part="terms-stale">
          The Terms have been updated.{' '}
          <button type="button" className="x2f-start__textbutton" onClick={() => window.location.reload()}>
            Reload the page
          </button>{' '}
          to read the new version.
        </p>
      ) : null}
      {!read ? (
        <p className="x2f-note x2f-terms__hint" id={hintId} data-part="terms-hint">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M12 5v14M6 13l6 6 6-6" />
          </svg>
          Scroll to the end to continue
        </p>
      ) : null}
      <label className="x2f-check">
        <input
          type="checkbox"
          disabled={!read || stale}
          checked={ticked}
          onChange={(e) => setTicked(e.target.checked)}
          aria-describedby={[stale ? staleId : !read ? hintId : null, helpId].filter((x) => x !== null).join(' ')}
          data-part="terms-tick"
        />
        <span>
          I have read and agree to the{' '}
          <button type="button" className="x2f-start__textbutton" onClick={() => show(null)}>
            Terms of Service
          </button>{' '}
          and{' '}
          <button type="button" className="x2f-start__textbutton" onClick={() => show(PRIVACY_HEADING)}>
            Privacy Policy
          </button>
          .
        </span>
      </label>
      <p className="x2f-sign__help" id={helpId}>
        {/* The trader's help line; the button's name is this step's (Continue). COPY-UNSIGNED */}
        Then sign in the white box with your finger, a pen or the mouse. A scribble or an X is fine. {TERMS_CONTINUE} needs both the tick and your
        signature.
      </p>
      <SignaturePad onChange={setSignature} describedBy={helpId} />
      <Button
        variant="primary"
        disabled={!ready}
        onClick={() => {
          if (version !== null && signature !== null && !stale) onAccept(version, signature);
        }}
        data-part="terms-accept"
      >
        {TERMS_CONTINUE}
      </Button>
    </section>
  );
}
