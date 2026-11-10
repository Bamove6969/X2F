import './screens.css';
import '../ui/ui.css';
import { formatDateTime as utcDateTime } from '../ui/dates.js';

/**
 * One News message as the News page shows it (Plan 4 Task 28): title, a "New" mark, the posted
 * (and updated) date, and the body split into paragraphs. Its own module, with no API client, so
 * the staff app's NewsEditor shows its preview with this same card (Plan 4 Task 16).
 */
export interface NewsItem {
  id: number;
  title: string;
  body: string;
  publishedAt: string;
  editedAt: string | null;
}

/** "29 Oct 2026, 09:00 UTC", the same for every reader (design X5). */
export function postedDate(iso: string): string {
  return utcDateTime(new Date(iso));
}

export function NewsMessage({ item, isNew }: { item: NewsItem; isNew: boolean }) {
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
