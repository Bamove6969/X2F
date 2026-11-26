/**
 * The team log's routes (team audit v2, migration 855; owner 26 Nov 2026). See team/audit.ts.
 *
 * - `GET /v1/team/log?from&to&member&category&action&trade&before&limit` → `{ entries, next }`,
 *   newest first. `member`, `category` and `action` take a comma-separated list. `trade` is a
 *   trade code (matched by its kept commitment, so it still finds a deleted trade's rows if the
 *   reader has the code). `before` is the previous page's `next`. The account owner sees the
 *   whole log; a member holding the `team-see-log` box sees only the rows they acted in or are
 *   about, and `member` cannot widen that.
 * - `GET /v1/team/log/integrity?id&hash` (account owner) → the chain check: `{ ok, entries,
 *   brokenAt, head }`, and with a kept fingerprint (`id` and `hash`) whether it still matches.
 * - `GET /v1/team/log/summary?days` (account owner) → `{ since, members }`: per member, their work,
 *   logins, refused attempts and changes made to them in the last `days` (1..365, default 30).
 * - `GET /v1/team/log/export?format=json|csv&...filters` (account owner) → a download of every
 *   matching row, oldest first, each with the exact `line` its hash covers, and the chain check.
 *
 * Refused attempts: `installRefusalAudit` adds an onResponse hook that logs a member's request
 * refused for lack of a box, outside their hours or band (`REFUSAL_CODES`).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '../errors.js';
import { requireSession } from '../auth/sessions.js';
import {
  ACCESS_ACTIONS, ACTION_ABILITY, AUDIT_CATEGORIES, AUDIT_PAGE, auditRefusal, exportAudit, listAudit, REFUSAL_CODES, summariseAudit,
  TEAM_ACTIONS, verifyAudit, type AuditCategory, type AuditFilter, type ExportRow,
} from '../team/audit.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** A member session's team and member, set by `requireSession` as soon as the session is known (even when it then refuses). */
    memberAttempt: { accountId: string; memberId: string } | null;
    /** The `ApiError` code the request was answered with, if any (installErrorAnswers). */
    apiErrorCode: string | null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRADE_CODE = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/;
const ID = /^[1-9][0-9]{0,18}$/;
const HEX32 = /^[0-9a-f]{64}$/i;

/** Every action the log can hold. */
export const LOG_ACTIONS: ReadonlySet<string> = new Set([...Object.keys(ACTION_ABILITY), 'release-started', ...TEAM_ACTIONS, ...ACCESS_ACTIONS]);

function list(v: unknown): string[] {
  if (v === undefined) return [];
  const raw = Array.isArray(v) ? v : [v];
  if (!raw.every((x) => typeof x === 'string')) throw new ApiError(400, 'bad-request');
  const out = (raw as string[]).flatMap((x) => x.split(',')).map((x) => x.trim()).filter((x) => x !== '');
  if (out.length > 50) throw new ApiError(400, 'bad-request');
  return out;
}

function date(v: unknown): Date | undefined {
  if (v === undefined) return undefined;
  const d = typeof v === 'string' ? new Date(v) : new Date(Number.NaN);
  if (Number.isNaN(d.getTime())) throw new ApiError(400, 'bad-request');
  return d;
}

/** The filter a request asks for; 400 `bad-request` on anything malformed. */
export function filterOf(query: unknown): AuditFilter {
  const q = (query ?? {}) as Record<string, unknown>;
  const members = list(q.member);
  if (!members.every((m) => UUID.test(m))) throw new ApiError(400, 'bad-request');
  const categories = list(q.category);
  if (!categories.every((c) => (AUDIT_CATEGORIES as readonly string[]).includes(c))) throw new ApiError(400, 'bad-request');
  const actions = list(q.action);
  if (!actions.every((a) => LOG_ACTIONS.has(a))) throw new ApiError(400, 'bad-request');
  const trade = q.trade;
  if (trade !== undefined && (typeof trade !== 'string' || !TRADE_CODE.test(trade.toUpperCase()))) throw new ApiError(400, 'bad-request');
  const before = q.before;
  if (before !== undefined && (typeof before !== 'string' || !ID.test(before))) throw new ApiError(400, 'bad-request');
  const limit = q.limit === undefined ? undefined : Number(q.limit);
  if (limit !== undefined && !(Number.isInteger(limit) && limit >= 1 && limit <= AUDIT_PAGE)) throw new ApiError(400, 'bad-request');
  const from = date(q.from);
  const to = date(q.to);
  return {
    ...(from ? { from } : {}), ...(to ? { to } : {}),
    ...(members.length > 0 ? { members: members.map((m) => m.toLowerCase()) } : {}),
    ...(categories.length > 0 ? { categories: categories as AuditCategory[] } : {}),
    ...(actions.length > 0 ? { actions } : {}),
    ...(typeof trade === 'string' ? { tradeCode: trade.toUpperCase() } : {}),
    ...(typeof before === 'string' ? { before } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
}

const CSV_COLUMNS = ['id', 'at', 'category', 'action', 'actorKind', 'memberName', 'subjectName', 'tradeCode', 'detail', 'prevHash', 'hash', 'line'] as const;

/** One CSV field: quoted, quotes doubled, and a leading = + - @ tab or CR neutralised so a spreadsheet never runs it as a formula. */
export function csvField(v: unknown): string {
  let s = v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

function toCsv(rows: ExportRow[]): string {
  const head = CSV_COLUMNS.join(',');
  const body = rows.map((r) => CSV_COLUMNS.map((c) => csvField(r[c])).join(','));
  return [head, ...body].join('\r\n') + '\r\n';
}

export function teamAuditRoutes(app: FastifyInstance): void {
  const owner = requireSession({ kinds: ['trader'] });
  const ownerOrLogReader = requireSession({ kinds: ['trader'], member: 'team-see-log' });

  app.get('/v1/team/log', { preHandler: ownerOrLogReader }, async (req) => {
    const f = filterOf(req.query);
    const memberId = req.auth.memberId;
    return listAudit(req.server.deps.db, req.auth.accountId, memberId === null ? f : { ...f, onlyMember: memberId });
  });

  app.get('/v1/team/log/integrity', { preHandler: owner }, async (req) => {
    const q = (req.query ?? {}) as Record<string, unknown>;
    if ((q.id === undefined) !== (q.hash === undefined)) throw new ApiError(400, 'bad-request');
    if (q.id !== undefined && (typeof q.id !== 'string' || !ID.test(q.id) || typeof q.hash !== 'string' || !HEX32.test(q.hash))) {
      throw new ApiError(400, 'bad-request');
    }
    return verifyAudit(req.server.deps.db, req.auth.accountId, typeof q.id === 'string' ? { id: q.id, hash: String(q.hash) } : undefined);
  });

  app.get('/v1/team/log/summary', { preHandler: owner }, async (req) => {
    const q = (req.query ?? {}) as Record<string, unknown>;
    const days = q.days === undefined ? 30 : Number(q.days);
    if (!(Number.isInteger(days) && days >= 1 && days <= 365)) throw new ApiError(400, 'bad-request');
    const since = new Date(req.server.deps.clock().getTime() - days * 86_400_000);
    return { since: since.toISOString(), members: await summariseAudit(req.server.deps.db, req.auth.accountId, since) };
  });

  app.get('/v1/team/log/export', { preHandler: owner }, async (req: FastifyRequest, reply: FastifyReply) => {
    const q = (req.query ?? {}) as Record<string, unknown>;
    const format = q.format ?? 'json';
    if (format !== 'json' && format !== 'csv') throw new ApiError(400, 'bad-request');
    const { format: _f, ...rest } = q;
    const f = filterOf(rest);
    const db = req.server.deps.db;
    const now = req.server.deps.clock();
    const [{ rows, truncated }, integrity] = await Promise.all([exportAudit(db, req.auth.accountId, f), verifyAudit(db, req.auth.accountId)]);
    const stamp = now.toISOString().slice(0, 10);
    void reply.header('content-disposition', `attachment; filename="x2f-team-log-${stamp}.${format}"`);
    if (format === 'csv') {
      return reply.type('text/csv; charset=utf-8').send(toCsv(rows));
    }
    return reply.type('application/json; charset=utf-8').send({
      exportedAt: now.toISOString(),
      // How to re-check the chain without X2F: for each row in id order, hash = SHA-256(prevHash bytes || UTF-8 line).
      chain: 'sha256(prev_hash || utf8(line)); line = id|at|actorKind|memberId|subjectId|category|action|sha256hex(tradeCode)|detail',
      integrity,
      truncated,
      rows,
    });
  });
}

/**
 * Logs every member request refused for lack of a box, outside the member's hours or band
 * (`REFUSAL_CODES`): after the answer is sent, in its own statement, never failing the request.
 */
export function installRefusalAudit(app: FastifyInstance): void {
  app.decorateRequest('memberAttempt', null);
  app.decorateRequest('apiErrorCode', null);
  app.addHook('onResponse', async (req, reply) => {
    const who = req.memberAttempt;
    const code = req.apiErrorCode;
    if (who === null || code === null || (reply.statusCode !== 401 && reply.statusCode !== 403) || !REFUSAL_CODES.has(code)) return;
    try {
      await auditRefusal(req.server.deps.db, who, { method: req.method, route: req.routeOptions.url ?? '', code }, req.server.deps.clock());
    } catch (err) {
      req.log.error({ err }, 'team log: refused attempt not recorded');
    }
  });
}
