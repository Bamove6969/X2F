/**
 * News (Plan 4 Task 28; owner, 2026-10-29; spec 6.6): messages from X2F, newest at the top, each
 * with the date it was posted, so a reader can tell new from already seen. It opens after login
 * when something is new (authApi.afterLogin) and works logged out, because the emergency-stop
 * message sends everyone here ("Check the News section").
 *
 * Laid out from the News board (origin/wip/design-brief docs/design-boards/News.dc.html; design
 * review 1 Nov shot 60) with UI-kit parts only, no stylesheet of its own (NEEDS_DESIGN_NEWS still
 * waits for the board in design/x2f-app): Close News, "3 new · 4 posts", Mark all as read,
 * "Newest first", collapsible posts (a new one on surface with the escrow edge and "New", a read
 * one outlined with "Read"), dates in the one format (ui/dates.ts). Board copy is used as drawn;
 * the rest is // COPY-UNSIGNED.
 *
 * New versus seen is kept on this device only (news-model.ts). Messages that were new when the
 * page opened keep their "New" mark for this visit; opening the page marks them seen for next time.
 * "Don't show me this again" (design session 2 Nov) shows on the News page that opened by itself
 * after a login (`?after=login`), and is kept on this device only (news-model.ts).
 */
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { returnToFrom } from '../api/client.js';
import { Button } from '../ui/Button.js';
import { CheckRow } from '../ui/CheckRow.js';
import { FlowScreen } from '../ui/FlowScreen.js';
import { Icon } from '../ui/icons.js';
import { When } from '../ui/When.js';
import { fetchNews, markSeen, readHideAfterLogin, readLastSeen, rememberNews, setHideAfterLogin, type NewsItem } from './news-model.js';
import './screens.css';

type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; items: NewsItem[]; seenBefore: number };

/** A post (News board): a button opens and closes it; new posts have the escrow edge and "New". */
function Post({ item, isNew, open, onToggle }: { item: NewsItem; isNew: boolean; open: boolean; onToggle: () => void }) {
  const titleId = `news-${item.id}-title`;
  const bodyId = `news-${item.id}-body`;
  return (
    <article className="x2f-post" data-part="news-item" data-new={isNew ? '' : undefined} aria-labelledby={titleId}>
      <h2 className="x2f-post__heading">
        {/* Named by the title alone (review N9); the New/Read mark and the date stay visible. */}
        <button type="button" className="x2f-post__toggle" aria-expanded={open} aria-controls={bodyId} aria-labelledby={titleId} onClick={onToggle}>
          <span className="x2f-post__text">
            <span className="x2f-post__meta" data-part="news-date">
              {isNew ? (
                <span className="x2f-post__new" data-part="news-new">
                  New
                </span>
              ) : (
                <span>Read</span>
              )}
              <When at={item.publishedAt} />
              {item.editedAt !== null ? (
                <span>
                  {/* COPY-UNSIGNED */}
                  Updated <When at={item.editedAt} />
                </span>
              ) : null}
            </span>
            <span className="x2f-post__title" id={titleId} data-part="news-title">
              {item.title}
            </span>
          </span>
          <span className="x2f-post__chevron">
            <Icon name="chevron-down" size={18} />
          </span>
        </button>
      </h2>
      <div className="x2f-post__body" id={bodyId} hidden={!open}>
        {item.body.split(/\n+/).map((para, i) => (
          <p key={i}>{para}</p>
        ))}
      </div>
    </article>
  );
}

export function News() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const returnTo = returnToFrom(search);
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  // Which posts are open: the newest unread one, or the newest when nothing is new (design session 2 Nov).
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  // Where the "1 of 3 new" stepper is among the new posts.
  const [step, setStep] = useState(0);
  const afterLogin = new URLSearchParams(search).get('after') === 'login';
  const [hide, setHide] = useState(() => readHideAfterLogin());

  useEffect(() => {
    const ctl = new AbortController();
    setState({ status: 'loading' });
    fetchNews(ctl.signal).then(
      ({ items }) => {
        if (ctl.signal.aborted) return;
        const seenBefore = readLastSeen();
        setState({ status: 'ready', items, seenBefore });
        setOpen(new Set(items.slice(0, 1).map((i) => i.id)));
        setStep(0);
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

  const fresh = state.status === 'ready' ? state.items.filter((i) => i.id > state.seenBefore) : [];
  const newCount = fresh.length;
  // Steps through the new posts, newest first, opening only that one.
  const goTo = (i: number) => {
    const target = fresh[i];
    if (target === undefined) return;
    setStep(i);
    setOpen(new Set([target.id]));
    requestAnimationFrame(() => document.getElementById(`news-${target.id}-title`)?.closest('article')?.scrollIntoView?.({ block: 'nearest' }));
  };
  const total = state.status === 'ready' ? state.items.length : 0;
  const leave = () => void navigate(returnTo);
  const toggle = (id: number) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // This device already counts every shown post as seen (markSeen on open); this clears the marks now.
  const list = useRef<HTMLElement>(null);
  const markAll = () => {
    if (state.status !== 'ready') return;
    setState({ ...state, seenBefore: state.items.reduce((m, i) => Math.max(m, i.id), state.seenBefore) });
    // Review N3: the button goes, so focus moves to the first post instead of being lost.
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>('[data-part="news-item"] button')?.focus());
  };

  const countText = total === 0 ? 'No news yet' : `${newCount > 0 ? `${newCount} new` : 'All read'} · ${total === 1 ? '1 post' : `${total} posts`}`;

  return (
    <FlowScreen
      screen="news"
      title="News"
      busy={state.status === 'loading'}
      back={{ label: 'Close News', icon: 'close', onClick: leave }}
      sub={
        state.status === 'ready' ? (
          <span role="status" data-part="news-count">
            {countText}
          </span>
        ) : undefined
      }
      action={
        newCount > 0 ? (
          <button type="button" className="x2f-header-action" onClick={markAll} data-part="news-mark-all">
            <Icon name="check-double" size={18} />
            Mark all as read
          </button>
        ) : undefined
      }
      footer={
        <>
          {afterLogin ? (
            <CheckRow
              part="news-hide"
              checked={hide}
              onChange={(on) => {
                setHide(on);
                setHideAfterLogin(on);
              }}
              title="Don't show me this again"
              hint="News won't open when you log in. You can still read it any time under Site news, the bell at the top of the screen."
            />
          ) : null}
          <Button variant="primary" onClick={leave} data-part="news-continue">
            Continue
          </Button>
        </>
      }
    >
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
      {state.status === 'ready' && state.items.length > 0 ? (
        <section className="x2f-stack" aria-label="Posts" data-part="news-list" ref={list}>
          <div className="x2f-news-pager-row">
            <span className="x2f-kicker">Newest first</span>
            {newCount > 1 ? (
              <span className="x2f-news-pager" data-part="news-stepper">
                <button type="button" className="x2f-icon-button" aria-label="Previous new post" disabled={step === 0} onClick={() => goTo(step - 1)}>
                  <Icon name="chevron-left" size={20} />
                </button>
                <span role="status" data-part="news-step">
                  <span className="x2f-when">{step + 1}</span> of <span className="x2f-when">{newCount}</span> new
                </span>
                <button type="button" className="x2f-icon-button" aria-label="Next new post" disabled={step >= newCount - 1} onClick={() => goTo(step + 1)}>
                  <Icon name="chevron-right" size={20} />
                </button>
              </span>
            ) : null}
          </div>
          {state.items.map((i) => (
            <Post key={i.id} item={i} isNew={i.id > state.seenBefore} open={open.has(i.id)} onToggle={() => toggle(i.id)} />
          ))}
        </section>
      ) : null}
    </FlowScreen>
  );
}
