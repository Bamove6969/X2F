/**
 * The front door itself, `/` (design review 2026-11-08 item 1; boards Landing and Landing-Wide on
 * the design branch, docs/design-boards/): logo D "nice and big", the owner's slogan word for word,
 * three promise rows, and the three ways in: Create account (setup, starting on the Terms), Log in,
 * and Lost access? (the backup login). Nothing behind the door, no rates, offers, names, counts or
 * news ("There are no free tours for outsiders", owner, 8 Nov 2026).
 *
 * Every screen behind the door sends a signed-out visitor here with `returnTo` (session/frontDoor.tsx);
 * Create account and Log in carry it on, always through safeReturnTo. A set-up trader who opens `/`
 * goes on to the app; a session still loading shows nothing (no flash of the board for members).
 */
import { Link, Navigate, useLocation } from 'react-router';
import { safeReturnTo } from '../../api/client.js';
import { isInside } from '../../session/frontDoor.js';
import { useSession } from '../../session/useSession.js';
import { useFoldLayout } from '../../ui/fold.js';
import { Logo } from '../../ui/Logo.js';
import './landing.css';

/** The board's copy. COPY-UNSIGNED except the slogan (the owner's) and his two button labels. */
export const LANDING_COPY = {
  sloganTop: 'You’ll need Fiat',
  sloganBottom: 'to believe it.',
  promises: [
    // not-a-refusal: a reassurance about escrow, not a rule the user ran into
    // COPY: owner's demo note #109 (23 Nov), his words; comma splice made two sentences.
    'Your coins are protected by a modern 2-of-3 escrow wallet where you and the person you trade with will agree to release and complete the trade. Even X2F cannot unilaterally move the coins. It is a mutually agreed upon decision.',
    // COPY: owner's demo note #110 (23 Nov), his words.
    'No IP addresses logged and all chats are end-to-end encrypted.',
    // COPY: owner's demo note #111 (23 Nov), his words; "creates take no more then" tidied to "creation takes no more than".
    'This site is for members only and nothing is for just public viewing. Account creation takes no more than 5 minutes.',
  ],
  create: 'Create account',
  login: 'Log in',
  recover: 'Lost access? Recover your account',
  footer: 'Members only · Monero for cash, 2-of-3 escrow',
} as const;

function Lock() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
      <path d="M12 14.5v2" />
    </svg>
  );
}
function EyeOff() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3l18 18" />
      <path d="M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 8.5 4.5 9.5 6a15 15 0 0 1-2.6 3.1M6.3 7.6A15 15 0 0 0 2.5 12c1 1.5 4.5 6 9.5 6 1.5 0 2.9-.4 4.1-1" />
      <path d="M9.9 10a3 3 0 0 0 4.1 4.2" />
    </svg>
  );
}
function Member() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="10" cy="8" r="3.5" />
      <path d="M3.5 19.5c.8-3.4 3.5-5 6.5-5 1.6 0 3.1.4 4.3 1.3" />
      <path d="M15 18l2 2 4-4" />
    </svg>
  );
}
const ICONS = [Lock, EyeOff, Member] as const;

export function Landing() {
  const session = useSession();
  const { search } = useLocation();
  const wide = useFoldLayout() === 'wide';
  const raw = new URLSearchParams(search).get('returnTo');
  // Only a same-origin path is ever carried on (safeReturnTo); none given, none added.
  const returnTo = raw === null ? null : safeReturnTo(raw);
  const carry = returnTo === null ? '' : `?returnTo=${encodeURIComponent(returnTo)}`;

  if (session.status === 'loading') return null;
  // Members go on in: the board is for outsiders.
  if (isInside(session)) return <Navigate to={returnTo ?? '/sell'} replace />;

  return (
    <div className="x2f-landing" data-screen="landing" data-wide={wide ? 'true' : 'false'}>
      <main className="x2f-landing__main">
        <h1 className="x2f-landing__logo">
          <Logo height={wide ? 180 : 120} />
        </h1>
        <p className="x2f-landing__slogan">
          <span>{LANDING_COPY.sloganTop}</span> <span>{LANDING_COPY.sloganBottom}</span>
        </p>
        <ul className="x2f-landing__promises" aria-label="What X2F promises">
          {LANDING_COPY.promises.map((p, i) => {
            const Icon = ICONS[i]!;
            return (
              <li key={p}>
                <Icon />
                <span>{p}</span>
              </li>
            );
          })}
        </ul>
        <nav className="x2f-landing__ways" aria-label="Get in">
          <div className="x2f-landing__pair">
            <Link className="x2f-button x2f-button--primary x2f-landing__way" to={`/setup${carry}`} data-primary="" data-part="landing-create">
              {LANDING_COPY.create}
            </Link>
            <Link className="x2f-button x2f-button--secondary x2f-landing__way" to={`/login${carry}`} data-part="landing-login">
              {LANDING_COPY.login}
            </Link>
          </div>
          <Link className="x2f-link x2f-landing__recover" to="/login/backup" data-part="landing-recover">
            {LANDING_COPY.recover}
          </Link>
        </nav>
      </main>
      <footer className="x2f-landing__foot">
        <p>{LANDING_COPY.footer}</p>
      </footer>
    </div>
  );
}
