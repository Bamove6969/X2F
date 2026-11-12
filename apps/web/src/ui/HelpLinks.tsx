import { Link } from 'react-router';
import './ui.css';

/*
 * Owner demo notes 12 Nov 2026 #42 (fill the space "with links to faq, getting started, support,
 * settings"), lead 12 Nov. DESIGNER-REVIEW: placement and wording. Each is a placeholder page on the
 * front door (screens/HelpTopic.tsx): someone on /login is not inside yet, so nothing here leads
 * behind the door.
 */

/** COPY-UNSIGNED: the four link names. */
export const HELP_LINKS: readonly { label: string; to: string }[] = [
  { label: 'FAQ', to: '/help/faq' },
  { label: 'Getting started', to: '/help/getting-started' },
  { label: 'Support', to: '/help/support' },
  { label: 'Settings', to: '/help/settings' },
];

export function HelpLinks() {
  return (
    <nav aria-label="Help" className="x2f-help-links" data-part="help-links">
      {HELP_LINKS.map((l) => (
        <Link key={l.to} to={l.to} className="x2f-link x2f-help-links__link">
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
