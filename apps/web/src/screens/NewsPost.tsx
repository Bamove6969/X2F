import { Icon } from '../ui/icons.js';
import { When } from '../ui/When.js';
import type { NewsItem } from './NewsMessage.js';
import '../ui/ui.css';

/**
 * One News post as the News page shows it (the News board; design session 2 Nov): a button opens and
 * closes it, a new one has the escrow edge and "New", a read one says "Read"; the posted (and
 * updated) moment in the one date format (ui/When). Its own module, with no API client and no router,
 * so the staff app's NewsEditor shows its preview with this very component through the kit ("As
 * traders will see it", design final call 10 Nov 2026; apps/staff-web/test/oneDoor.test.ts).
 */
export function NewsPost({ item, isNew, open, onToggle }: { item: NewsItem; isNew: boolean; open: boolean; onToggle: () => void }) {
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
