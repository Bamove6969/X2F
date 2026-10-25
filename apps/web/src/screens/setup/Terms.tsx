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
 * There is no SetupTerms board in design/x2f-app/ yet (plan Task 28: a controller step mirrors it),
 * so this screen is built from the UI kit and the setup frame.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { returnToFrom } from '../../api/client.js';
import { refreshSession } from '../../session/useSession.js';
import { Button } from '../../ui/Button.js';
import { authApi } from '../auth/authApi.js';
import { SetupFrame, SetupIntro, useSetup } from './kit.js';
import { TERMS, TERMS_DRAFT_NOTE } from './termsText.js';

/** How close to the bottom (in CSS pixels) counts as the end, for rounding on zoomed screens. */
const END_SLACK = 4;

function TermsScreen({
  screen,
  title,
  intro,
  back,
  onAccept,
}: {
  screen: string;
  title: string;
  intro: string;
  back?: string;
  onAccept: (version: string) => Promise<void>;
}) {
  const [version, setVersion] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [read, setRead] = useState(false);
  const [ticked, setTicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    setLoadFailed(false);
    authApi.getTerms().then(
      (t) => setVersion(t.version),
      () => setLoadFailed(true),
    );
  }, []);
  useEffect(load, [load]);

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

  const accept = async () => {
    if (version === null) return;
    setBusy(true);
    setError(null);
    try {
      await onAccept(version);
    } catch {
      setError('Could not save that. Try again.');
      setBusy(false);
    }
  };

  return (
    <SetupFrame
      screen={screen}
      title={title}
      fit
      {...(back !== undefined ? { back } : {})}
      footer={
        <Button variant="primary" disabled={!ticked || version === null || busy} onClick={() => void accept()} data-part="terms-accept">
          I accept
        </Button>
      }
    >
      <SetupIntro title="Terms of Service">{intro}</SetupIntro>
      <div className="x2f-terms" ref={box} onScroll={checkEnd} tabIndex={0} role="region" aria-label="Terms of Service text" data-part="terms-text">
        <p className="x2f-terms__note">{TERMS_DRAFT_NOTE}</p>
        {TERMS.map((s) => (
          <section key={s.heading} className="x2f-terms__section">
            <h2 className="x2f-terms__heading">{s.heading}</h2>
            {s.paragraphs.map((p) => (
              <p key={p} className="x2f-terms__p">
                {p}
              </p>
            ))}
          </section>
        ))}
        <p className="x2f-terms__end">{version !== null ? `End of the Terms of Service, version ${version}.` : 'End of the Terms of Service.'}</p>
      </div>
      {loadFailed ? (
        <p className="x2f-error" role="alert">
          Could not load the Terms version.{' '}
          <button type="button" className="x2f-setup__textbutton" onClick={load}>
            Try again
          </button>
        </p>
      ) : null}
      {error !== null ? (
        <p className="x2f-error" role="alert">
          {error}
        </p>
      ) : null}
      <label className="x2f-check">
        <input type="checkbox" disabled={!read} checked={ticked} onChange={(e) => setTicked(e.target.checked)} data-part="terms-tick" />
        <span>I have read the Terms of Service and I accept them.</span>
      </label>
      {!read ? <p className="x2f-note">Scroll to the end of the Terms to tick the box.</p> : null}
    </SetupFrame>
  );
}

export function SetupTerms() {
  const { update, go, returnTo } = useSetup();
  return (
    <TermsScreen
      screen="setup-terms"
      title="Set up your account"
      intro="Read the Terms to the end, then tick the box to go on."
      back={returnTo}
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
      intro="The Terms of Service have changed. Read them to the end and accept them to keep trading."
      onAccept={async (version) => {
        await authApi.acceptTerms({ version });
        refreshSession();
        void navigate(returnTo, { replace: true });
      }}
    />
  );
}
