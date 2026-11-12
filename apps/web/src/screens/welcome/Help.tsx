/**
 * `/help`: where the welcome screen's FAQ and Getting started links go until those pages are written
 * (owner, demo note #42 names the links; no FAQ or Getting started content exists yet). Getting
 * started offers the tour. COPY-UNSIGNED. DESIGNER-REVIEW: no board yet.
 */
import { Link } from 'react-router';
import { Button } from '../../ui/Button.js';
import { FIRST_TRADE_TOUR } from '../../tour/firstTradeTour.js';
import { useTour } from '../../tour/TourProvider.js';
import './welcome.css';

export const HELP_PATH = '/help';

export const HELP_COPY = {
  title: 'Help',
  faq: 'FAQ',
  faqBody: 'Answers to the questions traders ask most are being written. Until they are here, Support reaches the X2F team.',
  started: 'Getting started',
  startedBody: 'The tour walks you through a first trade, from finding an offer to releasing the Monero.',
  tour: 'Take the tour',
  support: 'Support',
} as const;

export function Help() {
  const tour = useTour();
  return (
    <main className="x2f-screen x2f-help" data-screen="help">
      <h1 className="x2f-screen__title">{HELP_COPY.title}</h1>
      <section id="faq" className="x2f-card x2f-help__section" aria-labelledby="help-faq">
        <h2 id="help-faq" className="x2f-section-title">
          {HELP_COPY.faq}
        </h2>
        <p>{HELP_COPY.faqBody}</p>
        <Link className="x2f-button x2f-button--secondary" to="/feedback">
          {HELP_COPY.support}
        </Link>
      </section>
      <section id="getting-started" className="x2f-card x2f-help__section" aria-labelledby="help-started">
        <h2 id="help-started" className="x2f-section-title">
          {HELP_COPY.started}
        </h2>
        <p>{HELP_COPY.startedBody}</p>
        <Button variant="primary" onClick={() => tour.start(FIRST_TRADE_TOUR)}>
          {HELP_COPY.tour}
        </Button>
      </section>
    </main>
  );
}
