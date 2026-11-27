/**
 * The welcome screen (owner, 12 Nov 2026, demo note #47 on /sell: "The first screen is going to
 * welcome them to X2F, and they can select "tour" or "skip and get started." The logo will be large
 * and in the middle of the screen, and "Welcome to" will be displayed diagonally from the top left
 * moving down right diagonally to the big logo in the middle of the screen the buttons across the
 * bottom of screen will be there as though they have dove right in and same with links I discussed
 * in the previous screen"; the links of note #42: FAQ, getting started, support, settings).
 *
 * Built to design's FirstScreen layout with the letter intro (wip/design-brief b3b8315b,
 * tour-motion.md §2) and the owner's diagonal "Welcome to" lead-in (12 Nov note #47): the hero with
 * "Welcome to" stepping from the top-left down-right into the large centred logo's letters springing
 * in, "Welcome to X2F" and one line, Take the tour and Skip and get started, the four links (visible
 * across phone and shorter screens), and the tab bar with no tab current.
 *
 * The lead ruled (12 Nov) that the letter intro replaces the owner's diagonal "Welcome to", with the
 * four links only on screens 760+ tall (tour-motion.md §2). Owner note #47, confirmed 26 Nov: both
 * reversed to follow the note (docs/agy-owner-questions-landing.md, R1 and R3).
 *
 * `/welcome`, behind the front door. The first time a device opens `/sell` it comes here instead
 * (WelcomeGate); either choice marks it seen on this device (tour/welcomeSeen.ts). Settings keeps a
 * way back. DESIGNER-REVIEW: design to check against the FirstScreen board.
 */
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { memberOf } from '../../session/member.js';
import { useSession } from '../../session/useSession.js';
import { Button } from '../../ui/Button.js';
import { HELP_LINKS } from '../../ui/HelpLinks.js';
import { FIRST_TRADE_TOUR } from '../../tour/firstTradeTour.js';
import { useTour } from '../../tour/TourProvider.js';
import { markWelcomeSeen } from '../../tour/welcomeSeen.js';
import { X2FMark } from './X2FMark.js';
import './welcome.css';

/**
 * COPY-UNSIGNED: the owner's diagonal "Welcome to" lead-in (note #47), design's line from the old
 * intro scene 1 and her "Welcome to X2F"; the owner's two choices ("tour", "skip and get started");
 * the four link names (his, note #42).
 */
export const WELCOME_COPY = {
  leadWelcome: 'Welcome',
  leadTo: 'to',
  heading: 'Welcome to X2F',
  line: 'Swap Monero for cash, bank transfers or gift cards, person to person.',
  tour: 'Take the tour',
  skip: 'Skip and get started',
  // The one help page, /help/:topic, and the same links as /login's (review 12 Nov, L3): each page
  // says the way on for someone signed in (Support to Feedback, Settings to Security).
  links: HELP_LINKS,
  linksLabel: 'Help and settings',
} as const;

/** The heading's last word, the one shown; the words before it are the lead-in's. */
const BRAND = 'X2F';

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
          <span className="x2f-hello__lead" data-part="welcome-lead" aria-hidden="true">
            <span className="x2f-hello__lead-word" data-part="welcome-word-1">
              {WELCOME_COPY.leadWelcome}
            </span>{' '}
            <span className="x2f-hello__lead-word" data-part="welcome-word-2">
              {WELCOME_COPY.leadTo}
            </span>
          </span>
          <X2FMark />
        </figure>
        <div className="x2f-hello__text">
          {/* The lead-in above already shows "Welcome to" (owner note #47, confirmed 26 Nov): here it
              stays for screen readers only, so the heading still reads "Welcome to X2F". */}
          <h1 className="x2f-hello__h1">
            <span className="x2f-sr-only">{WELCOME_COPY.heading.slice(0, -BRAND.length)}</span>
            {BRAND}
          </h1>
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
