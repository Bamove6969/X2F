import type pg from 'pg';

/**
 * Plan 4 Task 28: the News inbox (owner, 2026-10-29; spec 6.6). Messages from X2F, newest first,
 * each with its posted date. Readers need no session; whether a message is new is kept on the
 * reader's device (the highest id it has shown), so nothing per reader is stored here.
 */

export const NEWS_TITLE_MAX = 120;
export const NEWS_BODY_MAX = 4000;
/** The most messages `GET /v1/news` returns; older ones drop off the bottom. */
export const NEWS_LIST_LIMIT = 50;

export interface NewsItem {
  id: number;
  title: string;
  body: string;
  publishedAt: string;
  editedAt: string | null;
}

export interface NewsDraft {
  title: string;
  body: string;
}

type Queryable = Pick<pg.Pool, 'query'>;

interface Row {
  id: string;
  title: string;
  body: string;
  published_at: Date;
  edited_at: Date | null;
}

const toItem = (r: Row): NewsItem => ({
  id: Number(r.id),
  title: r.title,
  body: r.body,
  publishedAt: r.published_at.toISOString(),
  editedAt: r.edited_at?.toISOString() ?? null,
});

// Control characters other than the newline (a title takes none at all).
const BODY_CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/;
const TITLE_CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

export class NewsInputError extends Error {
  constructor(readonly field: 'title' | 'body') {
    super(`news: bad ${field}`);
    this.name = 'NewsInputError';
  }
}

/**
 * A draft as stored: both fields trimmed, the body's line endings made `\n`. Throws NewsInputError
 * naming the field that is empty, too long or holds control characters.
 */
export function cleanDraft(input: { title: unknown; body: unknown }): NewsDraft {
  if (typeof input.title !== 'string') throw new NewsInputError('title');
  if (typeof input.body !== 'string') throw new NewsInputError('body');
  const title = input.title.trim();
  const body = input.body.replace(/\r\n?/g, '\n').trim();
  if (title.length === 0 || title.length > NEWS_TITLE_MAX || TITLE_CONTROL.test(title)) throw new NewsInputError('title');
  if (body.length === 0 || body.length > NEWS_BODY_MAX || BODY_CONTROL.test(body)) throw new NewsInputError('body');
  return { title, body };
}

/** The newest `limit` messages, newest first (ties by id, so the order never changes between reads). */
export async function listNews(db: Queryable, limit = NEWS_LIST_LIMIT): Promise<NewsItem[]> {
  const { rows } = await db.query<Row>(
    'select id, title, body, published_at, edited_at from news order by published_at desc, id desc limit $1',
    [limit],
  );
  return rows.map(toItem);
}

/** Posts a message dated now by the server clock. */
export async function addNews(db: Queryable, clock: () => Date, draft: NewsDraft): Promise<NewsItem> {
  const d = cleanDraft(draft);
  const { rows } = await db.query<Row>(
    'insert into news (title, body, published_at) values ($1, $2, $3) returning id, title, body, published_at, edited_at',
    [d.title, d.body, clock()],
  );
  return toItem(rows[0]!);
}

/** Changes a message's text; its posted date stays, so it keeps its place and is not new again. Null when there is no such message. */
export async function editNews(db: Queryable, clock: () => Date, id: number, draft: NewsDraft): Promise<NewsItem | null> {
  const d = cleanDraft(draft);
  const { rows } = await db.query<Row>(
    `update news set title = $2, body = $3, edited_at = greatest($4::timestamptz, published_at)
      where id = $1 returning id, title, body, published_at, edited_at`,
    [id, d.title, d.body, clock()],
  );
  return rows[0] ? toItem(rows[0]) : null;
}

/** Deletes a message; false when there was none. */
export async function deleteNews(db: Queryable, id: number): Promise<boolean> {
  const { rowCount } = await db.query('delete from news where id = $1', [id]);
  return (rowCount ?? 0) > 0;
}
