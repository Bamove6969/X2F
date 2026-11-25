/**
 * The Terms of Service screen (spec 6.1 step 0, Plan 2 R10). The full Terms flow in the page, with
 * no scroll box of their own (owner demo note #187, 25 Nov 2026: a box scrolling inside the
 * scrolling page trapped the thumb on phones); the tick box enables only once the page has been
 * scrolled to the "End of Terms" line (or shows it already, on a tall screen). Under it, the signature pad
 * (owner, 8 Nov 2026: the Terms are agreed once, at account opening, with a tick and a signature,
 * never per trade): the accept button (**I accept**; on SetupTerms **Start creating my account**,
 * design 9 Nov p11-15) needs both the tick and a signature, drawn or typed. The version
 * comes from `GET /v1/terms`.
 *
 * - `SetupTerms` (`/setup`): the first setup screen. Accepting keeps the version and the signature
 *   for the register call (`acceptedTerms`, `termsSignature`) and goes on to the names.
 * - `Terms` (`/terms`): a signed-in trader (or team member, on their own login account) refused
 *   with `terms-required` (the Terms changed). Accepting posts `POST /v1/account/terms`
 *   `{ version, signature }` (a new version asks for a new signature too) and returns to `returnTo`.
 * - `TermsScreen` in MemberInvite (`/team/join`): a team member signs the Terms before joining
 *   (review 2026-11-08 F1); the version goes with `POST /v1/team/join/start` (`acceptedTerms`), the
 *   signature with `POST /v1/team/join/finish` (`termsSignature`; owner 9 Nov 2026, p11-14).
 *
 * The pad and its help line are not on the SetupTerms board; they sit under the tick box, before
 * the board's footer, and their wording is unsigned.
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
import type { TermsSignature } from '@x2f/auth-client';
import { Link, useLocation, useNavigate } from 'react-router';
import { returnToFrom } from '../../api/client.js';
import { refreshSession } from '../../session/useSession.js';
import { Button } from '../../ui/Button.js';
import { authApi } from '../auth/authApi.js';
import { SetupFrame, SetupIntro, useSetup } from './kit.js';
import { termsChanged } from './register.js';
import { SignaturePad } from './SignaturePad.js';
import { KEY_POINTS, PRIVACY_HEADING, TERMS, TERMS_DRAFT_NOTE, TERMS_TEXT_VERSION } from './termsText.js';
import { TermsParagraphs } from './TermsParagraphs.js';

/** Owner demo note #186 (25 Nov): the two boxes' headings (his suggested words). COPY-UNSIGNED. */
export const GLANCE_HEADING = 'The Short Version (Key Takeaways)';
export const FULL_HEADING = 'Full Terms of Service';

/** How close to the bottom (in CSS pixels) counts as the end, for rounding on zoomed screens. */
const END_SLACK = 4;

/**
 * Whether the "End of Terms" line has been reached: its bottom is inside what the screen shows, or
 * above it. What the screen shows is the viewport, cut to the setup frame's middle (the part that
 * scrolls; the button bar sits under it, outside it, so it never hides the line).
 */
export function endReached(end: HTMLElement): boolean {
  const scroller = end.closest('.x2f-start__main');
  const viewBottom = Math.min(window.innerHeight, scroller !== null ? scroller.getBoundingClientRect().bottom : Infinity);
  return end.getBoundingClientRect().bottom <= viewBottom + END_SLACK;
}

/** The Terms screen itself; also the first step of a team member's join (MemberInvite, review 2026-11-08 F1). */
export function TermsScreen({
  screen,
  title,
  intro,
  back,
  after,
  acceptLabel = 'I accept',
  onAccept,
}: {
  screen: string;
  title: string;
  intro: string;
  back?: string;
  /** The accept button's words: SetupTerms says "Start creating my account" (design 9 Nov, p11-15). */
  acceptLabel?: string;
  /** Shown under the tick box. */
  after?: ReactNode;
  onAccept: (version: string, signature: TermsSignature) => Promise<void>;
}) {
  const [version, setVersion] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [read, setRead] = useState(false);
  const [ticked, setTicked] = useState(false);
  const [signature, setSignature] = useState<TermsSignature | null>(null);
  /** Bumped to give a fresh, empty pad (the Terms changed: a new version needs a new signature). */
  const [padKey, setPadKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLParagraphElement>(null);

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
    const el = end.current;
    if (el !== null && endReached(el)) setRead(true);
  }, []);

  // Owner demo note #187: the gate follows the page's own scroll. A page short enough to show the
  // end at once (a big screen) counts as read at once. Scroll events are caught on the document in
  // the capture phase, so the frame's middle (which does the scrolling) and the window both count,
  // whatever moved them: a thumb, the wheel, the keys or a focus change. An IntersectionObserver on
  // the end line catches layout changes with no scroll (fonts loading, the version arriving).
  useLayoutEffect(() => {
    checkEnd();
    document.addEventListener('scroll', checkEnd, { capture: true, passive: true });
    window.addEventListener('resize', checkEnd);
    let seen: IntersectionObserver | null = null;
    if (typeof IntersectionObserver === 'function' && end.current !== null) {
      seen = new IntersectionObserver(() => checkEnd());
      seen.observe(end.current);
    }
    return () => {
      document.removeEventListener('scroll', checkEnd, { capture: true });
      window.removeEventListener('resize', checkEnd);
      seen?.disconnect();
    };
  }, [checkEnd]);

  // This page shows only the text it was built with: a server version it does not carry is not
  // accepted from here (review M4).
  const stale = version !== null && version !== TERMS_TEXT_VERSION;

  const accept = async () => {
    if (version === null || stale || signature === null) return;
    setBusy(true);
    setError(null);
    try {
      await onAccept(version, signature);
    } catch (e) {
      if (termsChanged(e)) {
        // The Terms changed between loading and accepting (review M3): read the new version first.
        setTicked(false);
        setRead(false);
        setSignature(null);
        setPadKey((k) => k + 1);
        box.current?.closest('.x2f-start__main')?.scrollTo({ top: 0 });
        // A page that shows everything has no scroll to wait for: it counts as read again at once.
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

  /**
   * Scrolls the page to the full Terms' heading (`null`) or to a section heading, and moves the
   * focus to the Terms region so the keys go on from there (owner demo note #187: no box of its own).
   */
  const show = (heading: string | null) => {
    const el = box.current;
    if (el === null) return;
    const target = heading === null ? document.getElementById('terms-full-heading') : el.querySelector<HTMLElement>(`[data-heading="${heading}"]`);
    target?.scrollIntoView?.({ block: 'start' });
    el.focus({ preventScroll: true });
  };

  return (
    <SetupFrame
      screen={screen}
      title={title}
      fit
      {...(back !== undefined ? { back } : {})}
      footer={
        <Button variant="primary" disabled={!ticked || signature === null || version === null || stale || busy} onClick={() => void accept()} data-part="terms-accept">
          {acceptLabel}
        </Button>
      }
    >
      <SetupIntro title="Terms of Service">{intro}</SetupIntro>
      {/* Owner demo note #186 (25 Nov): each box gets a heading so the summary reads as a summary, the
          same type in both (the board's mono numbers dropped), and an amber edge marks the summary. */}
      <section className="x2f-terms__glance" aria-labelledby="terms-glance-heading" data-part="terms-glance">
        <h2 className="x2f-terms__boxhead" id="terms-glance-heading">
          {GLANCE_HEADING}
        </h2>
        <ul className="x2f-terms__points" aria-label="Key points">
          {KEY_POINTS.map((k) => (
            <li key={k}>{k}</li>
          ))}
        </ul>
      </section>
      <h2 className="x2f-terms__boxhead" id="terms-full-heading">
        {FULL_HEADING}
      </h2>
      {/* Owner demo note #187: in the page, no scroll box. Still a focusable region, so a keyboard
          user can land on it and page through it (the frame's middle scrolls under the keys). */}
      <div className="x2f-terms" ref={box} tabIndex={0} role="region" aria-labelledby="terms-full-heading" data-part="terms-text">
        <p className="x2f-terms__note">{TERMS_DRAFT_NOTE}</p>
        {TERMS.map((s) => (
          <section key={s.heading} className="x2f-terms__section">
            <h2 className="x2f-terms__heading" data-heading={s.heading}>
              {s.heading}
            </h2>
            <TermsParagraphs paragraphs={s.paragraphs} />
          </section>
        ))}
        <p className="x2f-terms__end" ref={end} data-part="terms-end">
          {version !== null ? `End of Terms. Version ${version}.` : 'End of Terms.'}
        </p>
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
          aria-describedby={[stale ? 'terms-stale' : !read ? 'terms-hint' : null, 'terms-sign-help'].filter((x) => x !== null).join(' ')}
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
      <p className="x2f-sign__help" id="terms-sign-help">
        {/* COPY-UNSIGNED: the button's name follows the screen's own (SetupTerms: design 9 Nov, p11-15). */}
        Then sign in the white box with your finger, a pen or the mouse. A scribble or an X is fine. {acceptLabel} needs both the tick and
        your signature.
      </p>
      <SignaturePad key={padKey} onChange={setSignature} describedBy="terms-sign-help" />
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
      // Design 9 Nov (p11-15, canvas ea2a9ca8; owner p11-15 "please check the box if you agree to the
      // rules and terms of X2F and then please sign your name and hit begin account creation").
      // "Terms" capitalised as this document's name (owner demo notes 13 Nov, setup-terms). COPY-UNSIGNED.
      // Owner demo note #176 (25 Nov), his words, replacing the whole intro (notes #174/#175 superseded);
      // a full stop added at the end.
      intro="Please take a quick moment to review our Terms of Service before getting started. You only need to accept them once—if we ever update them down the road, we'll highlight what changed to make it easy to spot, and prompt you to review and agree before continuing."
      acceptLabel="Start creating my account"
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
      onAccept={async (version, signature) => {
        update({ terms: { version, signature } });
        // NEEDS_OWNER_SITE_RULES (owner p11-24, 9 Nov 2026): "maybe we'll have a terms of service
        // that comes up, you agree to it, then we're going to have site rules that we expect people
        // to abide by, and they are then going to click and acknowledge that." A separate site
        // rules page would go here, between the Terms and the names (a `rules` step in
        // SetupFlow.tsx, acknowledged before "continue creating your account"). Not built: no rules
        // text exists yet, and whether the rules get their own page or stay in these Terms ("X2F's
        // rules and terms", design p11-15) is the owner's call.
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
      onAccept={async (version, signature) => {
        await authApi.acceptTerms({ version, signature });
        refreshSession();
        void navigate(returnTo, { replace: true });
      }}
    />
  );
}
