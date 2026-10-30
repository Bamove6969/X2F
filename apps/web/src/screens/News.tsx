/**
 * News (Plan 4 Task 28; owner, 2026-10-29; spec 6.6): messages from X2F, newest at the top, each
 * with the date it was posted, so a reader can tell new from already seen. It opens after login
 * when something is new (authApi.afterLogin) and works logged out, because the emergency-stop
 * message sends everyone here ("Check the News section").
 *
 * No board yet: Claude Design owns the look (design brief 2026-10-29, item 13), so this screen uses
 * only existing UI-kit classes and components and adds no styling of its own
 * (test/news-tripwire.test.ts NEEDS_DESIGN_NEWS). All copy here is // COPY-UNSIGNED.
 *
 * New versus seen is kept on this device only (news-model.ts). Messages that were new when the
 * page opened keep their "New" mark for this visit; opening the page marks them seen for next time.
 * A "Don't show me this again" checkbox is NOT built: the owner has not decided
 * (NEWS_DISMISS_ENABLED stays false).
 */
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { returnToFrom } from '../api/client.js';
import { Button } from '../ui/Button.js';
import { fetchNews, markSeen, postedDate, readLastSeen, rememberNews, type NewsItem } from './news-model.js';
import './screens.css';

type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; items: NewsItem[]; seenBefore: number };

function Message({ item, isNew }: { item: NewsItem; isNew: boolean }) {
  const titleId = `news-${item.id}-title`;
  return (
    <article className="x2f-card" data-part="news-item" data-new={isNew ? '' : undefined} aria-labelledby={titleId}>
      <div className="x2f-row">
        <h2 className="x2f-card__title" id={titleId}>
          {item.title}
        </h2>
        {isNew ? (
          <span className="x2f-badge" data-tone="escrow" data-part="news-new">
            New
          </span>
        ) : null}
      </div>
      <p className="x2f-note" data-part="news-date">
        Posted <time dateTime={item.publishedAt}>{postedDate(item.publishedAt)}</time>
        {item.editedAt !== null ? (
          <>
            {' · Updated '}
            <time dateTime={item.editedAt}>{postedDate(item.editedAt)}</time>
          </>
        ) : null}
      </p>
      {item.body.split(/\n+/).map((para, i) => (
        <p className="x2f-sheet__body" key={i}>
          {para}
        </p>
      ))}
    </article>
  );
}

export function News() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const returnTo = returnToFrom(search);
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ctl = new AbortController();
    setState({ status: 'loading' });
    fetchNews(ctl.signal).then(
      ({ items }) => {
        if (ctl.signal.aborted) return;
        const seenBefore = readLastSeen();
        setState({ status: 'ready', items, seenBefore });
        rememberNews(items);
        const newest = items.reduce((m, i) => Math.max(m, i.id), 0);
        if (newest > 0) markSeen(newest);
      },
      () => {
        if (!ctl.signal.aborted) setState({ status: 'error' });
      },
    );
    return () => ctl.abort();
  }, [attempt]);

  const newCount = state.status === 'ready' ? state.items.filter((i) => i.id > state.seenBefore).length : 0;

  return (
    <main className="x2f-screen" data-screen="news" aria-busy={state.status === 'loading'}>
      <h1 className="x2f-screen__title">News</h1>
      <p className="x2f-sheet__body">Messages from X2F. The newest is at the top.</p>
      {state.status === 'loading' ? <p className="x2f-note">Loading…</p> : null}
      {state.status === 'error' ? (
        <div className="x2f-stack">
          <p className="x2f-error" role="alert">
            Could not load the news. Check your connection and try again.
          </p>
          <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)} data-part="news-retry">
            Try again
          </Button>
        </div>
      ) : null}
      {state.status === 'ready' ? (
        <>
          <p className="x2f-note" role="status" data-part="news-count">
            {state.items.length === 0 ? 'No news yet.' : newCount === 0 ? 'Nothing new since your last visit.' : newCount === 1 ? '1 new message.' : `${newCount} new messages.`}
          </p>
          {state.items.length > 0 ? (
            <section className="x2f-stack" aria-label="Messages" data-part="news-list">
              {state.items.map((i) => (
                <Message key={i.id} item={i} isNew={i.id > state.seenBefore} />
              ))}
            </section>
          ) : null}
        </>
      ) : null}
      <Button variant="primary" onClick={() => void navigate(returnTo)} data-part="news-continue">
        Continue
      </Button>
    </main>
  );
}
