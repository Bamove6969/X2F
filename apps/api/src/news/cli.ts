import type pg from 'pg';
import { NewsInputError, addNews, deleteNews, editNews, listNews } from './store.js';

/**
 * The operator's way to post News until Plan 4's staff screen (NewsEditor, perm `site.control`)
 * is on the main line. Run on the server, with only DATABASE_URL:
 *
 *   npm run news -w @x2f/api -- list
 *   npm run news -w @x2f/api -- add --title "Planned upgrade" --body-file ./msg.txt
 *   npm run news -w @x2f/api -- edit 3 --title "..." --body "..."
 *   npm run news -w @x2f/api -- delete 3
 *
 * Prints one JSON line. It writes no activity-log entry, because that log (Plan 4 Task 3) does not
 * exist yet; the staff route that replaces this logs every change.
 */
export const NEWS_USAGE =
  'usage: news list | news add --title T (--body B | --body-file F) | news edit ID --title T (--body B | --body-file F) | news delete ID';

export interface NewsCliDeps {
  db: Pick<pg.Pool, 'query'>;
  clock: () => Date;
  readFile: (path: string) => Promise<string>;
}

export interface NewsCliResult {
  code: 0 | 1;
  out: string;
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function idOf(raw: string | undefined): number | null {
  return raw !== undefined && /^[1-9][0-9]{0,15}$/.test(raw) ? Number(raw) : null;
}

const fail = (error: string, extra: Record<string, unknown> = {}): NewsCliResult => ({ code: 1, out: JSON.stringify({ error, ...extra }) });

async function draftOf(args: string[], deps: NewsCliDeps): Promise<{ title: string; body: string } | null> {
  const title = flag(args, '--title');
  const file = flag(args, '--body-file');
  const body = file !== undefined ? await deps.readFile(file) : flag(args, '--body');
  return title === undefined || body === undefined ? null : { title, body };
}

export async function runNewsCommand(argv: string[], deps: NewsCliDeps): Promise<NewsCliResult> {
  const [cmd, ...rest] = argv;
  try {
    switch (cmd) {
      case 'list':
        return { code: 0, out: JSON.stringify({ items: await listNews(deps.db) }) };
      case 'add': {
        const draft = await draftOf(rest, deps);
        if (!draft) return fail('usage', { usage: NEWS_USAGE });
        return { code: 0, out: JSON.stringify({ added: await addNews(deps.db, deps.clock, draft) }) };
      }
      case 'edit': {
        const id = idOf(rest[0]);
        const draft = await draftOf(rest.slice(1), deps);
        if (id === null || !draft) return fail('usage', { usage: NEWS_USAGE });
        const item = await editNews(deps.db, deps.clock, id, draft);
        return item ? { code: 0, out: JSON.stringify({ edited: item }) } : fail('not-found');
      }
      case 'delete': {
        const id = idOf(rest[0]);
        if (id === null) return fail('usage', { usage: NEWS_USAGE });
        return (await deleteNews(deps.db, id)) ? { code: 0, out: JSON.stringify({ deleted: id }) } : fail('not-found');
      }
      default:
        return fail('usage', { usage: NEWS_USAGE });
    }
  } catch (e) {
    if (e instanceof NewsInputError) return fail('bad-input', { field: e.field });
    throw e;
  }
}
