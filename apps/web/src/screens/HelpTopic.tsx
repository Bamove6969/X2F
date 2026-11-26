import { Link, useParams } from 'react-router';
import { isInside } from '../session/frontDoor.js';
import { memberOf } from '../session/member.js';
import { useSession } from '../session/useSession.js';
import { HelpLibrary } from './help/HelpLibrary.js';
import { LIBRARY_TOPICS, type HelpTopicId } from './help/helpLibrary.js';

/*
 * The help placeholder pages (owner demo notes 12 Nov 2026 #42, lead 12 Nov): FAQ, Getting started,
 * Support and Settings, linked from /login, /session-length and the welcome screen. They are on the
 * front door, so they are read both by someone who is not logged in yet and by someone who is: each
 * topic has a line for each (review 12 Nov, L4), and only a signed-in reader gets links behind the
 * door. A team member gets member-level Settings (alarm settings and idle reminder), while owner-only settings remain gated.
 * The one help page (review L3: /help/:topic wins over a separate signed-in /help).
 * COPY-UNSIGNED and DESIGNER-REVIEW: every word here is a placeholder until the owner writes the pages.
 *
 * The help library (owner, 18 Nov 2026; screens/help/): /help and /help/faq list every question by
 * topic, with the search; /help/<topic> is one topic of the library (Getting started is one); Support
 * and Settings keep their lines and point to the library.
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
  /** A second way on (a quieter link), for the account owner only. */
  more?: { label: string; to: string };
  /** A team member's way on, where `link` is the account owner's. */
  memberLink?: { label: string; to: string };
}

/** COPY-UNSIGNED: each topic's title, its placeholder lines, and its link. */
export const HELP_TOPICS: Record<string, TopicCopy> = {
  faq: {
    title: 'FAQ',
    out: 'Answers to the questions traders ask most, by topic.',
    in: 'Answers to the questions traders ask most, by topic.',
  },
  'getting-started': {
    title: 'Getting started',
    out: 'Creating an account, logging in and your recovery code.',
    in: 'Logging in, your sessions and your recovery code.',
  },
  // Plan 4 Task 31: support tickets are the account owner's (a team member keeps Feedback).
  support: {
    title: 'Support',
    out: 'Once you are logged in, you can open a support ticket to ask X2F staff, or send Feedback about the app.',
    in: 'Open a ticket to ask X2F staff, and follow their answers in Your tickets. Feedback about the app goes in Feedback.',
    member: 'Feedback sends a message to X2F staff. Support tickets are opened by the account owner.',
    link: { label: 'Open a ticket', to: '/support/tickets/new', owner: true },
    more: { label: 'Your tickets', to: '/support/tickets' },
    memberLink: { label: 'Open Feedback', to: '/feedback' },
  },
  settings: {
    title: 'Settings',
    out: 'Your settings are in the app once you are logged in.',
    in: 'Your security, devices and team are in Settings.',
    // COPY-UNSIGNED (rail-members r3 review, M1): members have their own alarm and idle reminder in Settings.
    member: 'Your alarm and idle reminder are in Settings. The account owner looks after the rest.',
    link: { label: 'Open Settings', to: '/settings/security' },
  },
};

/** COPY-UNSIGNED: the way back, for each reader. */
export const HELP_BACK = { out: 'Back to log in', in: 'Back to trading' } as const;

/** COPY-UNSIGNED: /help's own title and line, and the way from Support, Settings or an unknown page to the library. */
export const HELP_HOME = { title: 'Help', body: 'Answers to the questions traders ask most, by topic.', browse: 'Browse all help', unknown: 'This help page does not exist.' } as const;

const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** Which questions a help page lists: every topic (null), one topic, or none. */
function libraryOf(topic: string): HelpTopicId | null | 'none' {
  if (topic === '' || topic === 'faq') return null;
  const lib = LIBRARY_TOPICS.find((t) => t.id === topic);
  return lib === undefined ? 'none' : lib.id;
}

export function HelpTopic() {
  const { topic = '' } = useParams();
  const session = useSession();
  const inside = isInside(session);
  const member = inside && memberOf(session) !== null;
  const lib = LIBRARY_TOPICS.find((x) => x.id === topic);
  const t: TopicCopy | null =
    topic === '' ? { title: HELP_HOME.title, out: HELP_HOME.body, in: HELP_HOME.body }
    : own(HELP_TOPICS, topic) ? HELP_TOPICS[topic]!
    : lib !== undefined ? { title: lib.title, out: lib.intro, in: lib.intro }
    : null;
  const body = t === null ? HELP_HOME.unknown : !inside ? t.out : member ? (t.member ?? t.in) : t.in;
  const link = !inside || t === null ? null : member && t.link?.owner === true ? (t.memberLink ?? null) : (t.link ?? null);
  const more = inside && !member && t?.more !== undefined ? t.more : null;
  const library = t === null ? 'none' : libraryOf(topic);
  return (
    <main className="x2f-screen x2f-screen--roomy" data-screen={t === null ? 'help-unknown' : topic === '' ? 'help' : `help-${topic}`}>
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
      {more === null ? null : (
        <p>
          <Link className="x2f-link" to={more.to} data-part="help-more">
            {more.label}
          </Link>
        </p>
      )}
      {library === 'none' ? (
        <p>
          {/* COPY-UNSIGNED */}
          <Link className="x2f-link" to="/help" data-part="help-browse">
            {HELP_HOME.browse}
          </Link>
        </p>
      ) : (
        <HelpLibrary key={topic} topic={library} />
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
