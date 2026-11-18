import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { proofUploadOn } from '../../proof/flag.js';
import { Icon } from '../../ui/icons.js';
import { FAQ_ANCHOR_PREFIX, LIBRARY_TOPICS, QUESTIONS, libraryQuestions, type HelpQuestion, type HelpTopicId } from './helpLibrary.js';
import './help.css';

/*
 * The help library (owner, 18 Nov 2026): the questions in helpLibrary.ts, grouped by topic, each one
 * a disclosure (a real button with aria-expanded and aria-controls; the answer is a group labelled
 * by its question, not a region: up to every answer may be open, and that many landmarks would
 * swamp the page's landmark list, review m7), a search box that filters questions and answers, and
 * deep links: /help/<topic>#faq-<question-id> opens that question and moves the focus to it. The
 * first form of the link, #<question-id>, is rewritten to the new one (`OLD_ANCHOR_REDIRECTS`), so
 * published links keep working. /help shows every topic; /help/<topic> shows one. The answers
 * follow the proof-upload flag (helpLibrary.ts `libraryQuestions`, proof/flag.ts).
 * DESIGNER-REVIEW: the layout. COPY-UNSIGNED: every string here.
 */

/** COPY-UNSIGNED */
export const LIBRARY_COPY = {
  searchLabel: 'Search help',
  searchHint: 'Type a word or two, like escrow or fee.',
  topicsLabel: 'Help topics',
  allTopics: 'All topics',
  count: (n: number) => (n === 1 ? '1 question' : `${n} questions`),
  none: (query: string) => `No questions match "${query}". Try another word, or look through the topics.`,
  link: 'Link to this answer',
  /** The link's accessible name: the visible words first, then the question, so 89 links are told apart. */
  linkLabel: (question: string) => `Link to this answer: ${question}`,
} as const;

/** The anchor of a question on the page: its id, prefixed so it never collides with another id. */
export const questionAnchor = (id: string): string => `${FAQ_ANCHOR_PREFIX}${id}`;

/** The path of a question's own page, with its anchor. */
export const questionHref = (q: Pick<HelpQuestion, 'id' | 'topic'>): string => `/help/${q.topic}#${questionAnchor(q.id)}`;

/**
 * The first published anchors (#price, #bans, ...) and the anchor each now has (#faq-price, ...).
 * A link in the old form is rewritten in place, so it opens the same question.
 */
export const OLD_ANCHOR_REDIRECTS: ReadonlyMap<string, string> = new Map(QUESTIONS.map((q) => [q.id, questionAnchor(q.id)]));

/** Lower case, accents and curly quotes folded, so "I’ve" finds "I've" and "Mónero" finds "Monero". */
function fold(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase();
}

/** The words of a search, folded; empty when nothing is typed. */
export function searchWords(query: string): string[] {
  return fold(query).split(/\s+/).filter((w) => w !== '');
}

/** A question matches when every word of the search is in its question or its answer. */
export function matches(q: Pick<HelpQuestion, 'q' | 'a'>, words: readonly string[]): boolean {
  if (words.length === 0) return true;
  const text = fold(`${q.q} ${q.a}`);
  return words.every((w) => text.includes(w));
}

/** The hash without its `#`, decoded; '' when it does not decode. */
function hashName(hash: string): string {
  try {
    return decodeURIComponent(hash.replace(/^#/, ''));
  } catch {
    return '';
  }
}

/** The question an address's hash names (`#faq-<id>`), or null. */
function fromHash(questions: readonly HelpQuestion[], hash: string): HelpQuestion | null {
  const name = hashName(hash);
  if (!name.startsWith(FAQ_ANCHOR_PREFIX)) return null;
  const id = name.slice(FAQ_ANCHOR_PREFIX.length);
  return questions.find((q) => q.id === id) ?? null;
}

function Question({ q, level, open, onToggle }: { q: HelpQuestion; level: 2 | 3; open: boolean; onToggle: () => void }) {
  const base = useId();
  const buttonId = `${base}-q`;
  const panelId = `${base}-a`;
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <li className="x2f-help__item" id={questionAnchor(q.id)} data-question={q.id}>
      <Heading className="x2f-help__question">
        <button type="button" id={buttonId} className="x2f-help__toggle" aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
          <span>{q.q}</span>
          <span className="x2f-help__chevron" data-open={open ? 'true' : 'false'}>
            <Icon name="chevron-down" size={20} />
          </span>
        </button>
      </Heading>
      <div id={panelId} role="group" aria-labelledby={buttonId} className="x2f-help__answer" hidden={!open}>
        <p>{q.a}</p>
        <p className="x2f-help__permalink">
          <Link className="x2f-link" to={questionHref(q)} aria-label={LIBRARY_COPY.linkLabel(q.q)}>
            {LIBRARY_COPY.link}
          </Link>
        </p>
      </div>
    </li>
  );
}

/**
 * `topic`: one topic's questions (its page has the topic as its h1, so each question is an h2), or
 * null for every topic (each topic an h2, its questions h3).
 */
export function HelpLibrary({ topic }: { topic: HelpTopicId | null }) {
  const { hash, pathname, search } = useLocation();
  const navigate = useNavigate();
  // The answers this build gives (the proof-upload flag), read once per page.
  const questions = useMemo(() => libraryQuestions(proofUploadOn()), []);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<ReadonlySet<string>>(() => {
    const q = fromHash(questions, hash);
    return new Set(q !== null && (topic === null || q.topic === topic) ? [q.id] : []);
  });
  const searchId = useId();
  const hintId = useId();
  const words = useMemo(() => searchWords(query), [query]);
  const topics = useMemo(() => (topic === null ? LIBRARY_TOPICS : LIBRARY_TOPICS.filter((t) => t.id === topic)), [topic]);
  const shown = useMemo(() => questions.filter((q) => topics.some((t) => t.id === q.topic) && matches(q, words)), [questions, topics, words]);
  const focused = useRef<string | null>(null);

  // A link in the first form (#price) is rewritten to its anchor now (#faq-price), in place.
  // A Map, so a hash such as #constructor or #__proto__ finds nothing (re-review m3).
  const moved = OLD_ANCHOR_REDIRECTS.get(hashName(hash));
  useEffect(() => {
    if (moved !== undefined) void navigate({ pathname, search, hash: `#${moved}` }, { replace: true });
  }, [moved, navigate, pathname, search]);

  // A deep link (on arrival, or a hash change on this page) opens its question and brings it into view.
  useEffect(() => {
    const q = fromHash(questions, hash);
    if (q === null || (topic !== null && q.topic !== topic)) return;
    setOpen((s) => (s.has(q.id) ? s : new Set([...s, q.id])));
    if (focused.current === `${hash}`) return;
    focused.current = hash;
    const el = document.getElementById(questionAnchor(q.id));
    const button = el?.querySelector<HTMLButtonElement>('button');
    if (typeof el?.scrollIntoView === 'function') el.scrollIntoView({ block: 'start' });
    button?.focus({ preventScroll: true });
  }, [questions, hash, topic]);

  const toggle = (id: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="x2f-help" data-part="help-library">
      <nav aria-label={LIBRARY_COPY.topicsLabel} className="x2f-help__topics" data-part="help-topics">
        <ul>
          <li>
            <Link className="x2f-help__topic" to="/help" aria-current={topic === null ? 'page' : undefined}>
              {LIBRARY_COPY.allTopics}
            </Link>
          </li>
          {LIBRARY_TOPICS.map((t) => (
            <li key={t.id}>
              <Link className="x2f-help__topic" to={`/help/${t.id}`} aria-current={topic === t.id ? 'page' : undefined}>
                {t.title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="x2f-help__search" role="search">
        <label htmlFor={searchId} className="x2f-help__search-label">
          {LIBRARY_COPY.searchLabel}
        </label>
        <input
          id={searchId}
          type="search"
          className="x2f-help__search-input"
          aria-describedby={hintId}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          data-part="help-search"
        />
        <p id={hintId} className="x2f-help__hint">
          {LIBRARY_COPY.searchHint}
        </p>
      </div>
      <p className="x2f-help__count" role="status" aria-live="polite" data-part="help-count">
        {shown.length === 0 ? LIBRARY_COPY.none(query.trim()) : LIBRARY_COPY.count(shown.length)}
      </p>
      {topics.map((t) => {
        const list = shown.filter((q) => q.topic === t.id);
        if (list.length === 0) return null;
        const items = (
          <ul className="x2f-help__list">
            {list.map((q) => (
              <Question key={q.id} q={q} level={topic === null ? 3 : 2} open={open.has(q.id)} onToggle={() => toggle(q.id)} />
            ))}
          </ul>
        );
        if (topic !== null) return <div key={t.id} data-topic={t.id}>{items}</div>;
        const headingId = `help-topic-${t.id}`;
        return (
          <section key={t.id} aria-labelledby={headingId} className="x2f-help__group" data-topic={t.id}>
            <h2 id={headingId} className="x2f-help__group-title">
              <Link className="x2f-help__group-link" to={`/help/${t.id}`}>
                {t.title}
              </Link>
            </h2>
            <p className="x2f-help__intro">{t.intro}</p>
            {items}
          </section>
        );
      })}
    </div>
  );
}
