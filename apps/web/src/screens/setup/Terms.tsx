/**
 * The Terms of Service screen (spec 6.1 step 0, Plan 2 R10). Owner demo note #190 (25 Nov 2026), his
 * layout: "Key Highlights (TL;DR)", then "Full Terms of Service (Version <v>)" flowing in the page
 * with no scroll box of its own (owner demo note #187: a box scrolling inside the scrolling page
 * trapped the thumb on phones), then the tick box, the button (disabled until ticked) and, on
 * SetupTerms, "Already have an account? Log in". The tick is the only condition the person meets:
 * there is no read-to-the-end gate (note #190 dropped it). The Terms are agreed
 * once, at account opening (owner, 8 Nov 2026), never per trade. A trader agrees with the tick
 * alone, a clickwrap (owner demo note #187, 25 Nov 2026: "Drop the signature canvas completely"):
 * the accept button (**I accept**; on SetupTerms **Start creating my account**, design 9 Nov
 * p11-15) needs the tick. With `sign` (a team member, owner 9 Nov 2026, p11-14: everyone who gets a
 * login signs; not changed by note #187) the signature pad shows under the tick and the button
 * needs a signature too, drawn or typed. The version comes from `GET /v1/terms`.
 *
 * - `SetupTerms` (`/setup`): the first setup screen. Accepting keeps the version for the register
 *   call (`acceptedTerms`, no signature) and goes on to the names.
 * - `Terms` (`/terms`): a signed-in trader (or team member, on their own login account) refused
 *   with `terms-required` (the Terms changed). Accepting posts `POST /v1/account/terms`
 *   `{ version }` for a trader, `{ version, signature }` for a team member (`me().member`), and
 *   returns to `returnTo`.
 * - `TermsScreen` in MemberInvite (`/team/join`, `sign`): a team member signs the Terms before
 *   joining (review 2026-11-08 F1); the version goes with `POST /v1/team/join/start`
 *   (`acceptedTerms`), the signature with `POST /v1/team/join/finish` (`termsSignature`; owner 9 Nov
 *   2026, p11-14).
 *
 * The pad and its help line (team members only) are not on the SetupTerms board; they sit under
 * the tick box, before the board's footer, and their wording is unsigned.
 *
 * Board: SetupTerms (design/x2f-app/, mirrored from the canvas 2026-10-26): "Before you start", the
 * key points, then the full text. "Terms of Service" and "Privacy Policy" in the tick line are
 * buttons, outside the box's label, that scroll this page to the full Terms and to the privacy
 * section (the privacy policy is that section until the lawyer's text) and focus it: they open in
 * place and never leave the page (owner demo note #189). The setup screen also
 * offers "Already have an account? Log in" (to `/login` with the same `returnTo`), so a returning
 * trader sent here by a take or a post (both send any signed-out person to setup) is not made to
 * sign up again (Task 21 review follow-up). No board shows that line.
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import type { TermsSignature } from '@x2f/auth-client';
import { Link, useLocation, useNavigate } from 'react-router';
import { returnToFrom } from '../../api/client.js';
import { refreshSession, useSession } from '../../session/useSession.js';
import { Button } from '../../ui/Button.js';
import { authApi } from '../auth/authApi.js';
import { SetupFrame, SetupIntro, useSetup } from './kit.js';
import { errorCode, termsChanged } from './register.js';
import { SignaturePad } from './SignaturePad.js';
import { KEY_POINTS, PRIVACY_HEADING, TERMS, TERMS_DRAFT_NOTE, TERMS_TEXT_VERSION } from './termsText.js';
import { TermsParagraphs } from './TermsParagraphs.js';

/** Owner demo note #190 (25 Nov): the summary card's heading, his words (note #186's replaced). COPY-UNSIGNED. */
export const GLANCE_HEADING = 'Key Highlights (TL;DR)';
/** Owner demo note #186 (25 Nov): the full Terms card's heading; note #190 adds the version once it has loaded. COPY-UNSIGNED. */
export const FULL_HEADING = 'Full Terms of Service';

/** Owner demo note #190 (25 Nov): "Full Terms of Service (Version 2026-11-25b)", or just the heading while the version loads. */
export function fullHeading(version: string | null): string {
  return version === null ? FULL_HEADING : `${FULL_HEADING} (Version ${version})`;
}

/** The Terms screen itself; also the first step of a team member's join (MemberInvite, review 2026-11-08 F1). */
export function TermsScreen({
  screen,
  title,
  intro,
  back,
  after,
  acceptLabel = 'I accept',
  sign = false,
  waiting = false,
  notice,
  onAccept,
}: {
  screen: string;
  title: string;
  intro: string;
  back?: string;
  /** The accept button's words: SetupTerms says "Start creating my account" (design 9 Nov, p11-15). */
  acceptLabel?: string;
  /** Shown under the button, in the bar at the bottom (owner demo note #190: the log-in line last). */
  after?: ReactNode;
  /**
   * A team member signs as well as ticking (owner 9 Nov 2026, p11-14): the pad shows and the
   * button needs a signature. A trader never does (owner demo note #187).
   */
  sign?: boolean;
  /** True while the screen does not know yet whether this person signs: the button waits. */
  waiting?: boolean;
  /** A notice of the caller's own over the button (the session could not be read, with its retry). */
  notice?: ReactNode;
  /** `signature` is null unless `sign`, and never null with it. */
  onAccept: (version: string, signature: TermsSignature | null) => Promise<void>;
}) {
  const [version, setVersion] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [ticked, setTicked] = useState(false);
  const [signature, setSignature] = useState<TermsSignature | null>(null);
  /** Bumped to give a fresh, empty pad (the Terms changed: a new version needs a new signature). */
  const [padKey, setPadKey] = useState(0);
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

  // This page shows only the text it was built with: a server version it does not carry is not
  // accepted from here (review M4).
  const stale = version !== null && version !== TERMS_TEXT_VERSION;

  const accept = async () => {
    if (version === null || stale || waiting || (sign && signature === null)) return;
    setBusy(true);
    setError(null);
    try {
      await onAccept(version, sign ? signature : null);
    } catch (e) {
      if (termsChanged(e)) {
        // The Terms changed between loading and accepting (review M3): read the new version first.
        setTicked(false);
        setSignature(null);
        setPadKey((k) => k + 1);
        box.current?.closest('.x2f-start__main')?.scrollTo({ top: 0 });
        const now = await load();
        // In real use the server moved to a version this page does not carry, so the stale notice
        // ("Reload the page") is the one thing to say; "read them again" only when the reloaded
        // version is this page's own text (review m2, Task 28 round 2).
        if (now === TERMS_TEXT_VERSION) setError('The Terms changed while you were reading. Read them again, then accept.');
      } else if (errorCode(e) === 'signature-required') {
        // The API says this login signs (a team member, owner 9 Nov 2026, p11-14) though the page
        // did not know it: the caller shows the pad (`sign`), and this says what to do next.
        // COPY-UNSIGNED: review of owner demo note #187.
        setError('Your login signs the Terms too. Sign in the white box, then accept.');
      } else setError('Could not save that. Try again.');
      setBusy(false);
    }
  };

  /**
   * A tap anywhere on the tick row ticks the box (review of note #187, M2), except on the two
   * buttons (they show their section) and on the box and its labels (the browser ticks those itself).
   */
  const tapRow = (e: MouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (stale || t.closest('button, input, label') !== null) return;
    setTicked((v) => !v);
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
    // Owner demo note #189 (25 Nov 2026): the section opens in place, never a new page, so the
    // sign-up keeps its progress; the focus goes to the heading shown, so a keyboard or screen
    // reader user lands on it and reads on from there.
    (target ?? el).focus({ preventScroll: true });
  };

  return (
    <SetupFrame
      screen={screen}
      title={title}
      fit
      {...(back !== undefined ? { back } : {})}
      footer={
        <>
          {/* Review of note #187 (M1): the notices sit in the bottom bar, over the button, so they are on
              screen whatever the scroll (the in-page Terms put them far below on a phone). */}
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
          {notice}
          {/* Owner demo note #190 (25 Nov 2026): disabled until ticked (and while the version loads, the page is stale or a call is busy). */}
          <Button
            variant="primary"
            disabled={!ticked || (sign && signature === null) || waiting || version === null || stale || busy}
            onClick={() => void accept()}
            data-part="terms-accept"
          >
            {acceptLabel}
          </Button>
          {after}
        </>
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
      <h2 className="x2f-terms__boxhead" id="terms-full-heading" tabIndex={-1} data-part="terms-full-heading">
        {fullHeading(version)}
      </h2>
      {/* Owner demo note #187: in the page, no scroll box. Still a focusable region, so a keyboard
          user can land on it and page through it (the frame's middle scrolls under the keys). */}
      <div className="x2f-terms" id="terms-text" ref={box} tabIndex={0} role="region" aria-labelledby="terms-full-heading" data-part="terms-text">
        {TERMS_DRAFT_NOTE !== '' ? <p className="x2f-terms__note">{TERMS_DRAFT_NOTE}</p> : null}
        {TERMS.map((s) => (
          <section key={s.heading} className="x2f-terms__section">
            <h3
              className="x2f-terms__heading"
              data-heading={s.heading}
              tabIndex={-1}
              {...(s.heading === PRIVACY_HEADING ? { id: 'terms-privacy' } : {})}
            >
              {s.heading}
            </h3>
            <TermsParagraphs paragraphs={s.paragraphs} />
          </section>
        ))}
        <p className="x2f-terms__end" data-part="terms-end">
          {version !== null ? `End of Terms. Version ${version}.` : 'End of Terms.'}
        </p>
      </div>
      {/* Owner demo note #189 (25 Nov 2026): the two links are buttons that show their section in this
          page, outside the checkbox's <label>, so tapping one never ticks the box. The box's name is
          still the whole line (aria-labelledby). */}
      {/* Review of note #187 (M2): the whole row (44 px tall) ticks the box, except the two buttons. */}
      <div className="x2f-check x2f-check--tap x2f-check--row" data-part="terms-agree" onClick={tapRow}>
        <input
          type="checkbox"
          id="terms-tick"
          aria-labelledby="terms-tick-line"
          disabled={stale}
          checked={ticked}
          onChange={(e) => setTicked(e.target.checked)}
          aria-describedby={[stale ? 'terms-stale' : null, sign ? 'terms-sign-help' : null].filter((x) => x !== null).join(' ') || undefined}
          data-part="terms-tick"
        />
        <span id="terms-tick-line">
          <label htmlFor="terms-tick">I have read and agree to the</label>{' '}
          <button type="button" className="x2f-start__textbutton" onClick={() => show(null)} aria-controls="terms-text" data-part="terms-show-tos">
            Terms of Service
          </button>{' '}
          <label htmlFor="terms-tick">and</label>{' '}
          <button type="button" className="x2f-start__textbutton" onClick={() => show(PRIVACY_HEADING)} aria-controls="terms-privacy" data-part="terms-show-privacy">
            Privacy Policy
          </button>
          {/* Owner demo note #187 (25 Nov 2026): the line is exactly his words, with no full stop. */}
        </span>
      </div>
      {/* Team members only (owner 9 Nov 2026, p11-14); a trader just ticks (owner demo note #187). */}
      {sign ? (
        <>
          <p className="x2f-sign__help" id="terms-sign-help">
            {/* COPY-UNSIGNED: the button's name follows the screen's own (SetupTerms: design 9 Nov, p11-15). */}
            Then sign in the white box with your finger, a pen or the mouse. A scribble or an X is fine. {acceptLabel} needs both the tick and
            your signature.
          </p>
          <SignaturePad key={padKey} onChange={setSignature} describedBy="terms-sign-help" />
        </>
      ) : null}
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
      // rules and terms of X2F and then please sign your name and hit begin account creation"; the
      // signing dropped by owner demo note #187, 25 Nov).
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
      // Owner demo note #187 (25 Nov 2026): a trader agrees with the tick alone, so no `sign`.
      onAccept={async (version) => {
        update({ terms: { version } });
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
  // A team member's session still signs (owner 9 Nov 2026, p11-14; the API requires it); a trader's
  // does not (owner demo note #187). `GET /v1/account/me` answers on old Terms too
  // (allowStaleTerms) and names a member session (`member`), so it tells the two apart here. Until
  // it answers, the button waits.
  const session = useSession();
  // Belt and braces: if the API refuses an unsigned accept with signature-required (a member the
  // page could not tell apart, e.g. an API whose `me` refuses old Terms), the pad shows from then on.
  const [mustSign, setMustSign] = useState(false);
  const member = mustSign || (session.status === 'signed-in' && session.me.member != null);
  // Review of note #187 (L4): a session that could not be read can't say whether this person signs,
  // so nobody posts until it is read again (a member must not post unsigned). One error is not a
  // dead end to retry: `terms-required` (an API whose `me` refuses old Terms; frontDoor.tsx sends it
  // here) says the person is signed in on old Terms, which is what this screen is for. Then the
  // tick goes alone, and the API still refuses a member's unsigned accept (signature-required).
  const failed = session.status === 'error' && session.code !== 'terms-required';
  const unknown = session.status === 'loading' || failed;
  return (
    <TermsScreen
      screen="terms"
      title="Updated Terms"
      // Owner demo note #190 (25 Nov 2026): no read-to-the-end gate, so the intro no longer asks for it. COPY-UNSIGNED.
      intro="The Terms of Service have changed. Read them and accept them to keep trading. The key points first:"
      sign={member}
      waiting={unknown}
      notice={
        failed ? (
          <p className="x2f-error" role="alert" data-part="terms-session-error">
            {/* COPY-UNSIGNED: review of owner demo note #187 (L4). */}
            Could not check your account.{' '}
            <button type="button" className="x2f-start__textbutton" onClick={() => refreshSession()}>
              Try again
            </button>
          </p>
        ) : null
      }
      onAccept={async (version, signature) => {
        try {
          await authApi.acceptTerms(signature !== null ? { version, signature } : { version });
        } catch (e) {
          if (errorCode(e) === 'signature-required') setMustSign(true);
          throw e;
        }
        refreshSession();
        void navigate(returnTo, { replace: true });
      }}
    />
  );
}
