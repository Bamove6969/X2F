import type { FastifyInstance, FastifyRequest } from 'fastify';
import { withTx } from '../auth/hold.js';
import { ApiError } from '../errors.js';
import { appendLog } from '../log/append.js';
import type { LogAction } from '../log/actions.js';
import { NewsInputError, addNews, cleanDraft, deleteNews, editNews } from '../news/store.js';
import { requireStaff } from './guard.js';

const ID = /^[1-9]\d{0,15}$/;

function newsId(req: FastifyRequest): number {
  const raw = (req.params as { id?: unknown }).id;
  if (typeof raw !== 'string' || !ID.test(raw)) throw new ApiError(404, 'not-found');
  return Number(raw);
}

function draftOf(body: unknown): { title: string; body: string } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'bad-request');
  const { title, body: text, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length > 0) throw new ApiError(400, 'bad-request');
  try {
    return cleanDraft({ title, body: text });
  } catch (e) {
    if (e instanceof NewsInputError) throw new ApiError(400, 'bad-request', { field: e.field });
    throw e;
  }
}

/**
 * Plan 4 Task 28 on the staff API (perm `site.control`, so only the owner): `POST /staff/v1/news
 * { title, body }` → 201 the message; `PUT /staff/v1/news/:id` → the message (404 `not-found`);
 * `DELETE /staff/v1/news/:id` → 204 (404 `not-found`). Each change is appended to the activity log
 * in the same transaction with the message id only, never its text. Readers keep `GET /v1/news`.
 */
export function staffNewsRoutes(app: FastifyInstance): void {
  const perm = 'site.control' as const;
  const opts = { config: { perm }, preHandler: requireStaff(perm) };
  const log = async (c: Parameters<typeof appendLog>[0], req: FastifyRequest, action: LogAction, id: number) =>
    appendLog(c, {
      at: req.server.deps.clock(), actor: { kind: 'staff', id: req.staff.accountId, role: req.staff.role }, tradeCode: null, action, detail: { newsId: String(id) },
    });

  app.post('/staff/v1/news', opts, async (req, reply) => {
    const draft = draftOf(req.body);
    const { db, clock } = req.server.deps;
    const item = await withTx(db, async (c) => {
      const it = await addNews(c, clock, draft);
      await log(c, req, 'news.published', it.id);
      return it;
    });
    return reply.code(201).send(item);
  });

  app.put('/staff/v1/news/:id', opts, async (req) => {
    const id = newsId(req);
    const draft = draftOf(req.body);
    const { db, clock } = req.server.deps;
    return withTx(db, async (c) => {
      const it = await editNews(c, clock, id, draft);
      if (it === null) throw new ApiError(404, 'not-found');
      await log(c, req, 'news.edited', id);
      return it;
    });
  });

  app.delete('/staff/v1/news/:id', opts, async (req, reply) => {
    const id = newsId(req);
    await withTx(req.server.deps.db, async (c) => {
      if (!(await deleteNews(c, id))) throw new ApiError(404, 'not-found');
      await log(c, req, 'news.deleted', id);
    });
    return reply.code(204).send();
  });
}
