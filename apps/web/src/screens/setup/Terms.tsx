/**
 * The Terms of Service screen (spec 6.1 step 0, Plan 2 R10). The Terms text sits in a scroll box;
 * the tick box enables only once the box has been scrolled to its end, and **I accept** only once
 * it is ticked. The version comes from `GET /v1/terms`.
 *
 * - `SetupTerms` (`/setup`): the first setup screen. Accepting keeps the version for the register
 *   call (`acceptedTerms`) and goes on to the names.
 * - `Terms` (`/terms`): a signed-in trader refused with `terms-required` (the Terms changed).
 *   Accepting posts `POST /v1/account/terms` and returns to `returnTo`.
 *
 * Board: SetupTerms (design/x2f-app/, mirrored from the canvas 2026-10-26): "Before you start", the
 * key points, then the full text in the box. "Terms of Service" and "Privacy Policy" in the tick
 * line scroll the box to the top and to the privacy section (the privacy policy is that section until
 * the lawyer's text). The setup screen also
 * offers "Already have an account? Log in" (to `/login` with the same `returnTo`), so a returning
 * trader sent here by a take or a post (both send any signed-out person to setup) is not made to
 * sign up again (Task 21 review follow-up). No board shows that line.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { returnToFrom } from '../../api/client.js';
import { refreshSession } from '../../session/useSession.js';
import { Button } from '../../ui/Button.js';
import { authApi } from '../auth/authApi.js';
import { SetupFrame, SetupIntro, useSetup } from './kit.js';
import { termsChanged } from './register.js';
import { KEY_POINTS, PRIVACY_HEADING, TERMS, TERMS_DRAFT_NOTE, TERMS_TEXT_VERSION } from './termsText.js';

/** How close to the bottom (in CSS pixels) counts as the end, for rounding on zoomed screens. */
const END_SLACK = 4;

function TermsScreen({
  screen,
  title,
  intro,
  back,
  after,
  onAccept,
}: {
  screen: string;
  title: string;
  intro: string;
  back?: string;
  /** Shown under the tick box. */
  after?: ReactNode;
  onAccept: (version: string) => Promise<void>;
}) {
  const [version, setVersion] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [read, setRead] = useState(false);
  const [ticked, setTicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  /** Loads the server's version; resolves to it, or to null when the load failed. */
  const load = useCallback(async (): Promise<string | null> => {
    setLoadFailed(false);
    try {
      const t = await authApi.getTerms();
      setVersion(t.version);
      return t.version;
    } catch {
      setLoadFailed(true);
      return null;
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const checkEnd = useCallback(() => {
    const el = box.current;
    if (el !== null && el.scrollTop + el.clientHeight >= el.scrollHeight - END_SLACK) setRead(true);
  }, []);

  // A box tall enough to show everything (a big screen) counts as read at once.
  useLayoutEffect(() => {
    checkEnd();
    window.addEventListener('resize', checkEnd);
    return () => window.removeEventListener('resize', checkEnd);
  }, [checkEnd]);

  // This page shows only the text it was built with: a server version it does not carry is not
  // accepted from here (review M4).
  const stale = version !== null && version !== TERMS_TEXT_VERSION;

  const accept = async () => {
    if (version === null || stale) return;
    setBusy(true);
    setError(null);
    try {
      await onAccept(version);
    } catch (e) {
      if (termsChanged(e)) {
        // The Terms changed between loading and accepting (review M3): read the new version first.
        setTicked(false);
        setRead(false);
        if (box.current !== null) box.current.scrollTop = 0;
        // A box that shows everything has no scroll to wait for: it counts as read again at once.
        checkEnd();
        const now = await load();
        // In real use the server moved to a version this page does not carry, so the stale notice
        // ("Reload the page") is the one thing to say; "read them again" only when the reloaded
        // version is this page's own text (review m2, Task 28 round 2).
        if (now === TERMS_TEXT_VERSION) setError('The Terms changed while you were reading. Read them to the end again, then accept.');
      } else setError('Could not save that. Try again.');
      setBusy(false);
    }
  };

  /** Scrolls the box to the top (`null`) or to a section heading. */
  const show = (heading: string | null) => {
    const el = box.current;
    if (el === null) return;
    const target = heading === null ? null : el.querySelector<HTMLElement>(`[data-heading="${heading}"]`);
    el.scrollTo({ top: target === null ? 0 : target.offsetTop - el.offsetTop });
    el.focus({ preventScroll: true });
  };

  return (
    <SetupFrame
      screen={screen}
      title={title}
      fit
      {...(back !== undefined ? { back } : {})}
      footer={
        <Button variant="primary" disabled={!ticked || version === null || stale || busy} onClick={() => void accept()} data-part="terms-accept">
          I accept
        </Button>
      }
    >
      <SetupIntro title="Terms of Service">{intro}</SetupIntro>
      <ul className="x2f-terms__points" aria-label="Key points">
        {KEY_POINTS.map((k) => (
          <li key={k}>
            {/* The board sets the numbers in mono ("1%", "60"). */}
            {k.split(/(\b\d+%?)/).map((part, i) => (i % 2 === 1 ? <span key={i} className="x2f-terms__num">{part}</span> : part))}
          </li>
        ))}
      </ul>
      <div className="x2f-terms" ref={box} onScroll={checkEnd} tabIndex={0} role="region" aria-label="Full Terms of Service" data-part="terms-text">
        <p className="x2f-terms__note">{TERMS_DRAFT_NOTE}</p>
        {TERMS.map((s) => (
          <section key={s.heading} className="x2f-terms__section">
            <h2 className="x2f-terms__heading" data-heading={s.heading}>
              {s.heading}
            </h2>
            {s.paragraphs.map((p) => (
              <p key={p} className="x2f-terms__p">
                {p}
              </p>
            ))}
          </section>
        ))}
        <p className="x2f-terms__end">{version !== null ? `End of Terms. Version ${version}.` : 'End of Terms.'}</p>
      </div>
      {loadFailed ? (
        <p className="x2f-error" role="alert">
          Could not load the Terms version.{' '}
          <button type="button" className="x2f-start__textbutton" onClick={() => void load()}>
            Try again
          </button>
        </p>
      ) : null}
      {error !== null ? (
        <p className="x2f-error" role="alert">
          {error}
        </p>
      ) : null}
      {stale ? (
        <p className="x2f-error" role="alert" id="terms-stale" data-part="terms-stale">
          The Terms have been updated.{' '}
          <button type="button" className="x2f-start__textbutton" onClick={() => window.location.reload()}>
            Reload the page
          </button>{' '}
          to read the new version.
        </p>
      ) : null}
      {!read ? (
        <p className="x2f-note x2f-terms__hint" id="terms-hint">
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
          {...(stale ? { 'aria-describedby': 'terms-stale' } : !read ? { 'aria-describedby': 'terms-hint' } : {})}
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
      {after}
    </SetupFrame>
  );
}

export function SetupTerms() {
  const { update, go, returnTo } = useSetup();
  return (
    <TermsScreen
      screen="setup-terms"
      title="Before you start"
      intro="Please read to the end. The key points first:"
      back={returnTo}
      after={
        <p className="x2f-start__help">
          {/* not-a-refusal: a link to log in */}
          Already have an account?{' '}
          <Link className="x2f-link" to={`/login?returnTo=${encodeURIComponent(returnTo)}`} data-part="setup-login">
            Log in
          </Link>
        </p>
      }
      onAccept={async (version) => {
        update({ terms: version });
        go('name');
      }}
    />
  );
}

export function Terms() {
  const location = useLocation();
  const navigate = useNavigate();
  const returnTo = returnToFrom(location.search);
  return (
    <TermsScreen
      screen="terms"
      title="Updated Terms"
      intro="The Terms of Service have changed. Read them to the end and accept them to keep trading. The key points first:"
      onAccept={async (version) => {
        await authApi.acceptTerms({ version });
        refreshSession();
        void navigate(returnTo, { replace: true });
      }}
    />
  );
}
