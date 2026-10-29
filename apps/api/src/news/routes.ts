import type { FastifyInstance } from 'fastify';
import { listNews } from './store.js';

/**
 * Plan 4 Task 28: `GET /v1/news` (no session needed: the page works logged out, and the
 * emergency-stop message sends everyone here) → `{ items, serverNow }`, newest first, each with
 * `publishedAt`. No `POST /v1/news/seen`: new versus seen is kept on the reader's device
 * (lead, 2026-10-29), so a read leaves nothing on the server.
 *
 * Writing is the owner's (perm `site.control`, each change in the activity log). Plan 4's staff
 * API is not on the main line yet, so until it is the operator posts with
 * `npm run news -w @x2f/api` (tools/news.ts); `test/news-tripwire.test.ts` fires when the staff
 * pieces land.
 */
export function newsRoutes(app: FastifyInstance): void {
  app.get('/v1/news', async (req) => ({
    items: await listNews(req.server.deps.db),
    serverNow: req.server.deps.clock().toISOString(),
  }));
}
