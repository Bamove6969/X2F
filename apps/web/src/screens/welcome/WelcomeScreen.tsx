/**
 * The welcome screen (owner, 12 Nov 2026, demo note #47 on /sell: "The first screen is going to
 * welcome them to X2F, and they can select "tour" or "skip and get started." The logo will be large
 * and in the middle of the screen, and "Welcome to" will be displayed diagonally from the top left
 * moving down right diagonally to the big logo in the middle of the screen the buttons across the
 * bottom of screen will be there as though they have dove right in and same with links I discussed
 * in the previous screen"; the links of note #42: FAQ, getting started, support, settings).
 *
 * Built to design's FirstScreen layout with the letter intro (wip/design-brief b3b8315b,
 * tour-motion.md §2), which the lead ruled replaces the owner's diagonal "Welcome to" (12 Nov): the
 * hero with the logo's letters springing in, "Welcome to X2F" and one line, Take the tour and Skip
 * and get started, the four links (only on screens 760+ tall), and the tab bar with no tab current.
 *
 * `/welcome`, behind the front door. The first time a device opens `/sell` it comes here instead
 * (WelcomeGate); either choice marks it seen on this device (tour/welcomeSeen.ts). Settings keeps a
 * way back. DESIGNER-REVIEW: design to check against the FirstScreen board.
 */
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { memberOf } from '../../session/member.js';
import { useSession } from '../../session/useSession.js';
import { Button } from '../../ui/Button.js';
import { FIRST_TRADE_TOUR } from '../../tour/firstTradeTour.js';
import { useTour } from '../../tour/TourProvider.js';
import { markWelcomeSeen } from '../../tour/welcomeSeen.js';
import { X2FMark } from './X2FMark.js';
import './welcome.css';

/**
 * COPY-UNSIGNED: design's line from the old intro scene 1 and her "Welcome to X2F"; the owner's two
 * choices ("tour", "skip and get started"); the four link names (his, note #42).
 */
export const WELCOME_COPY = {
  heading: 'Welcome to X2F',
  line: 'Swap Monero for cash, bank transfers or gift cards, person to person.',
  tour: 'Take the tour',
  skip: 'Skip and get started',
  // The one help page, /help/:topic, as /login's help links (review 12 Nov, L3; the pages are on
  // wip/lead-owner-layout-1): each says the way on for someone signed in (Support to Feedback,
  // Settings to Security).
  links: [
    { label: 'FAQ', to: '/help/faq' },
    { label: 'Getting started', to: '/help/getting-started' },
    { label: 'Support', to: '/help/support' },
    { label: 'Settings', to: '/help/settings' },
  ],
  linksLabel: 'Help and settings',
} as const;

export function WelcomeScreen() {
  const navigate = useNavigate();
  const tour = useTour();
  const { search } = useLocation();
  const session = useSession();
  // Lead, 12 Nov 2026: a team member's way in is the member tour, never this screen (and nothing is
  // shown until the session says who this is).
  if (session.status === 'loading') return null;
  if (memberOf(session) !== null) return <Navigate to="/sell" replace />;
  return (
    <main className="x2f-hello" data-screen="welcome">
      <div className="x2f-hello__col">
        <figure className="x2f-hello__hero" data-part="welcome-hero">
          <X2FMark />
        </figure>
        <div className="x2f-hello__text">
          <h1 className="x2f-hello__h1">{WELCOME_COPY.heading}</h1>
          <p className="x2f-hello__line">{WELCOME_COPY.line}</p>
        </div>
        <div className="x2f-hello__choices">
          <Button
            variant="primary"
            className="x2f-hello__tour"
            onClick={() => {
              markWelcomeSeen();
              tour.start(FIRST_TRADE_TOUR);
            }}
          >
            {WELCOME_COPY.tour}
          </Button>
          <Button
            variant="secondary"
            className="x2f-hello__skip"
            onClick={() => {
              markWelcomeSeen();
              // The query /sell came with, through the gate (review 12 Nov, T3).
              void navigate(`/sell${search}`);
            }}
          >
            {WELCOME_COPY.skip}
          </Button>
        </div>
        <nav className="x2f-hello__links" aria-label={WELCOME_COPY.linksLabel}>
          {WELCOME_COPY.links.map((l) => (
            <Link key={l.label} className="x2f-hello__link" to={l.to}>
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </main>
  );
}
