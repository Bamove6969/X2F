import type { FastifyInstance } from 'fastify';
import { requireInside } from '../auth/frontDoor.js';
import { listNews } from './store.js';

/**
 * Plan 4 Task 28: `GET /v1/news` → `{ items, serverNow }`. Behind the front door (`requireInside`,
 * owner 8 Nov 2026; it was open to logged-out visitors before), newest
 * first, each with `publishedAt`. No `POST /v1/news/seen`: new versus seen is kept on the reader's device
 * (lead, 2026-10-29), so a read leaves nothing on the server.
 *
 * Writing is the owner's, on the staff API (`staff/news.ts`: perm `site.control`, each change in the
 * activity log). The operator's offline CLI, `npm run news -w @x2f/api` (tools/news.ts), stays
 * until the lead decides it is not needed; `test/news-tripwire.test.ts` fires when the staff web
 * app (NewsEditor) lands.
 */
export function newsRoutes(app: FastifyInstance): void {
  app.get('/v1/news', { preHandler: requireInside }, async (req) => ({
    items: await listNews(req.server.deps.db),
    serverNow: req.server.deps.clock().toISOString(),
  }));
}
