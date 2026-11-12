import { Link, useParams } from 'react-router';

/*
 * The help placeholder pages (owner demo notes 12 Nov 2026 #42, lead 12 Nov): FAQ, Getting started,
 * Support and Settings, linked from /login and /session-length. COPY-UNSIGNED and DESIGNER-REVIEW:
 * every word here is a placeholder until the owner writes the pages.
 */

/** COPY-UNSIGNED: each topic's title and its one placeholder line. */
const TOPICS: Record<string, { title: string; body: string }> = {
  faq: { title: 'FAQ', body: 'Answers to common questions are coming here soon.' },
  'getting-started': { title: 'Getting started', body: 'A short guide to your first trade is coming here soon.' },
  support: { title: 'Support', body: 'Once you are logged in, Help in the app sends a message to X2F staff.' },
  settings: { title: 'Settings', body: 'Your settings are in the app once you are logged in.' },
};

export function HelpTopic() {
  const { topic = '' } = useParams();
  const t = Object.prototype.hasOwnProperty.call(TOPICS, topic) ? TOPICS[topic]! : null;
  return (
    <main className="x2f-screen x2f-screen--roomy" data-screen={t === null ? 'help-unknown' : `help-${topic}`}>
      {/* COPY-UNSIGNED: the title of an unknown topic. */}
      <h1 className="x2f-screen__title">{t === null ? 'Help' : t.title}</h1>
      {/* COPY-UNSIGNED */}
      <p>{t === null ? 'This help page does not exist.' : t.body}</p>
      <p className="x2f-screen__foot">
        {/* COPY-UNSIGNED */}
        <Link className="x2f-link" to="/login">
          Back to log in
        </Link>
      </p>
    </main>
  );
}
