import { Link, useParams } from 'react-router';
import { isInside } from '../session/frontDoor.js';
import { memberOf } from '../session/member.js';
import { useSession } from '../session/useSession.js';

/*
 * The help placeholder pages (owner demo notes 12 Nov 2026 #42, lead 12 Nov): FAQ, Getting started,
 * Support and Settings, linked from /login, /session-length and the welcome screen. They are on the
 * front door, so they are read both by someone who is not logged in yet and by someone who is: each
 * topic has a line for each (review 12 Nov, L4), and only a signed-in reader gets links behind the
 * door. A team member gets member-level Settings (security alerts and idle reminder), while owner-only settings remain gated.
 * The one help page (review L3: /help/:topic wins over a separate signed-in /help).
 * COPY-UNSIGNED and DESIGNER-REVIEW: every word here is a placeholder until the owner writes the pages.
 */

interface TopicCopy {
  title: string;
  /** Not logged in (or not set up yet). */
  out: string;
  /** Logged in, the account owner. */
  in: string;
  /** Logged in, a team member, where it differs from `in`. */
  member?: string;
  /** A signed-in reader's way on from here, where there is one. */
  link?: { label: string; to: string; owner?: true };
}

/** COPY-UNSIGNED: each topic's title, its placeholder lines, and its link. */
export const HELP_TOPICS: Record<string, TopicCopy> = {
  faq: {
    title: 'FAQ',
    out: 'Answers to common questions are coming here soon.',
    in: 'Answers to common questions are coming here soon.',
  },
  'getting-started': {
    title: 'Getting started',
    out: 'A short guide to your first trade is coming here soon.',
    in: 'A short guide to your first trade is coming here soon.',
  },
  support: {
    title: 'Support',
    out: 'Once you are logged in, Feedback in the app sends a message to X2F staff.',
    in: 'Feedback sends a message to X2F staff.',
    link: { label: 'Open Feedback', to: '/feedback' },
  },
  settings: {
    title: 'Settings',
    out: 'Your settings are in the app once you are logged in.',
    in: 'Your security, devices and team are in Settings.',
    member: 'The account owner looks after the settings of the account you work for.',
    link: { label: 'Open Settings', to: '/settings/security', owner: true },
  },
};

/** COPY-UNSIGNED: the way back, for each reader. */
export const HELP_BACK = { out: 'Back to log in', in: 'Back to trading' } as const;

export function HelpTopic() {
  const { topic = '' } = useParams();
  const session = useSession();
  const inside = isInside(session);
  const member = inside && memberOf(session) !== null;
  const t = Object.prototype.hasOwnProperty.call(HELP_TOPICS, topic) ? HELP_TOPICS[topic]! : null;
  const body = t === null ? 'This help page does not exist.' : !inside ? t.out : member ? (t.member ?? t.in) : t.in;
  const link = inside && t?.link !== undefined && !(member && t.link.owner === true) ? t.link : null;
  return (
    <main className="x2f-screen x2f-screen--roomy" data-screen={t === null ? 'help-unknown' : `help-${topic}`}>
      {/* COPY-UNSIGNED: the title of an unknown topic. */}
      <h1 className="x2f-screen__title">{t === null ? 'Help' : t.title}</h1>
      {/* COPY-UNSIGNED */}
      <p data-part="help-body">{body}</p>
      {link === null ? null : (
        <p>
          <Link className="x2f-button x2f-button--secondary" to={link.to} data-part="help-action">
            {link.label}
          </Link>
        </p>
      )}
      <p className="x2f-screen__foot">
        {/* COPY-UNSIGNED */}
        <Link className="x2f-link" to={inside ? '/sell' : '/login'} data-part="help-back">
          {inside ? HELP_BACK.in : HELP_BACK.out}
        </Link>
      </p>
    </main>
  );
}
