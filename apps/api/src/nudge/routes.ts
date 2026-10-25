import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { requireSession } from '../auth/sessions.js';
import { ApiError } from '../errors.js';
import type { RetentionJob } from '../retention.js';
import { findByPublicName, PUBLIC_NAME } from './names.js';
import { canonicalTimeZone, formatClock, inQuietHours, parseClock } from './quiet.js';

/** One nudge per sender every 10 minutes (spec 2.4): the sender's own limit, refused with `too-soon`. */
export const NUDGE_GAP_MS = 10 * 60_000;
/** At most 3 nudges received per hour from everyone combined: past it, nudges are dropped silently (`recipient-busy`). */
export const RECIPIENT_LIMIT_PER_HOUR = 3;
const HOUR_MS = 3_600_000;
/** Nudge records are kept only as long as the longest limit needs them. */
export const NUDGE_RETENTION_MS = HOUR_MS;

/** The live event for the recipient's own open tabs (Task 19's `{type:'nudge', from, context}`). `from` is the public name. */
export interface NudgeEvent {
  type: 'nudge';
  from: string;
  context: string;
}

/**
 * What nudges need from other tasks, injected through `Deps.nudges`:
 * - `hasSharedContext`: the two accounts share the open chat (Task 20) or active trade (Task 6)
 *   named by `context`, a chat or trade code.
 * - `publish`: Task 19's SSE bus, delivering only to that account's own streams.
 * - `sendPush`: Task 19's Web Push. It takes only the kind, so the payload can only be the generic
 *   "Someone nudged you on X2F": never a name, an amount or a trade detail.
 */
export interface NudgeWiring {
  hasSharedContext(fromId: string, toId: string, context: string): Promise<boolean>;
  publish(accountId: string, ev: NudgeEvent): void | Promise<void>;
  sendPush(accountId: string, kind: 'nudge'): Promise<boolean>;
}

const NAME_MAX = 64;
/** A chat or trade code as typed or shown (normalising it is `hasSharedContext`'s job). */
const CONTEXT = /^[A-Za-z0-9-]{1,64}$/;

/** The one body every accepted nudge gets, delivered or silently dropped (P3-M5). */
const ACCEPTED = { ok: true } as const;

function bodyOf(req: FastifyRequest): Record<string, unknown> {
  const body = req.body;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'bad-request');
  return body as Record<string, unknown>;
}

interface RecipientFacts {
  from_name: string;
  enabled: boolean;
  quiet_from: number | null;
  quiet_to: number | null;
  tz: string | null;
  blocked: boolean;
  recent: number;
}

/**
 * Delivery runs after the answer has gone, so how long SSE or a push service takes (or whether
 * they run at all) cannot be timed by the sender. Failures are logged with no name or context.
 */
function deliver(app: FastifyInstance, toId: string, ev: NudgeEvent): void {
  const wiring = app.deps.nudges;
  setImmediate(() => {
    const tries = [Promise.resolve().then(() => wiring.publish(toId, ev)), Promise.resolve().then(() => wiring.sendPush(toId, 'nudge'))];
    void Promise.allSettled(tries).then((results) => {
      for (const r of results) if (r.status === 'rejected') app.log.warn({ err: r.reason }, 'nudge delivery failed');
    });
  });
}

/**
 * `POST /v1/nudges { to, context }`. The sender's own refusals are distinct: 403
 * `no-shared-context` (also for an unknown name or yourself) and 429 `too-soon`. Everything about
 * the recipient (blocked, nudges off, quiet hours, 3 already this hour, disabled) is decided after
 * the same queries in the same order and answers the same 202 as a delivered nudge, so the
 * sender learns nothing about the recipient's settings or blocks.
 */
async function nudgeHandler(req: FastifyRequest, reply: FastifyReply) {
  const deps = req.server.deps;
  const { to, context } = bodyOf(req);
  if (typeof to !== 'string' || to.length < 1 || to.length > NAME_MAX) throw new ApiError(400, 'bad-request');
  if (typeof context !== 'string' || !CONTEXT.test(context)) throw new ApiError(400, 'bad-request');
  const fromId = req.auth.accountId;

  const recipient = await findByPublicName(deps.db, to);
  if (recipient === null || recipient.id === fromId || !(await deps.nudges.hasSharedContext(fromId, recipient.id, context))) {
    throw new ApiError(403, 'no-shared-context');
  }

  const now = deps.clock();
  let deliverIt = false;
  let fromName = '';
  const client = await deps.db.connect();
  try {
    await client.query('begin');
    try {
      // Both accounts, in a fixed order: parallel nudges by one sender, or to one recipient, queue here.
      await client.query('select id from accounts where id = any($1::uuid[]) order by id for no key update', [[fromId, recipient.id]]);
      const last = await client.query<{ last: Date | null }>(
        'select max(sent_at) as last from nudges where from_id = $1 and sent_at > $2',
        [fromId, new Date(now.getTime() - NUDGE_GAP_MS)],
      );
      const lastAt = last.rows[0]?.last ?? null;
      if (lastAt !== null) {
        const retryAfterSeconds = Math.max(1, Math.ceil((lastAt.getTime() + NUDGE_GAP_MS - now.getTime()) / 1000));
        throw new ApiError(429, 'too-soon', { retryAfterSeconds });
      }
      // Every fact about the recipient in one query, whatever the outcome.
      const { rows } = await client.query<RecipientFacts>(
        `select (select ${PUBLIC_NAME} from accounts where id = $1) as from_name,
                coalesce(s.enabled, true) as enabled, s.quiet_from, s.quiet_to, s.tz,
                exists (select 1 from account_blocks b where b.account_id = $2 and b.blocked_id = $1) as blocked,
                (select count(*) from nudges n where n.to_id = $2 and n.delivered and n.sent_at > $3)::int as recent
           from (select 1) as one left join nudge_settings s on s.account_id = $2`,
        [fromId, recipient.id, new Date(now.getTime() - HOUR_MS)],
      );
      const f = rows[0]!;
      fromName = f.from_name;
      const quiet = inQuietHours({ quietFrom: f.quiet_from, quietTo: f.quiet_to, tz: f.tz }, now);
      deliverIt = !recipient.disabled && f.enabled && !quiet && !f.blocked && f.recent < RECIPIENT_LIMIT_PER_HOUR;
      // Recorded either way: a dropped nudge still starts the sender's 10 minutes.
      await client.query('insert into nudges (from_id, to_id, sent_at, delivered) values ($1, $2, $3, $4)', [
        fromId, recipient.id, now, deliverIt,
      ]);
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
  } finally {
    client.release();
  }
  if (deliverIt) deliver(req.server, recipient.id, { type: 'nudge', from: fromName, context });
  return reply.code(202).send(ACCEPTED);
}

interface SettingsRow {
  enabled: boolean;
  quiet_from: number | null;
  quiet_to: number | null;
  tz: string | null;
}

const settingsJson = (r: SettingsRow | undefined) => ({
  enabled: r?.enabled ?? true,
  quietFrom: r?.quiet_from == null ? null : formatClock(r.quiet_from),
  quietTo: r?.quiet_to == null ? null : formatClock(r.quiet_to),
  tz: r?.tz ?? null,
});

async function getSettings(req: FastifyRequest) {
  const { rows } = await req.server.deps.db.query<SettingsRow>(
    'select enabled, quiet_from, quiet_to, tz from nudge_settings where account_id = $1',
    [req.auth.accountId],
  );
  return settingsJson(rows[0]);
}

/**
 * `PUT /v1/account/nudges { enabled, quietFrom, quietTo, tz }`: all four fields every time.
 * Quiet hours are "HH:MM" pairs (both or neither, not equal) and need a supported IANA time zone,
 * stored and returned by its canonical name; a start
 * later than the end crosses midnight.
 */
async function putSettings(req: FastifyRequest) {
  const { enabled, quietFrom, quietTo, tz: rawTz } = bodyOf(req);
  if (typeof enabled !== 'boolean') throw new ApiError(400, 'bad-request');
  // Only a supported zone, stored by its canonical name (case and alias variants collapse).
  const tz = rawTz === null ? null : canonicalTimeZone(rawTz);
  if (rawTz !== null && tz === null) throw new ApiError(400, 'bad-request');
  let from: number | null = null;
  let until: number | null = null;
  if (quietFrom !== null || quietTo !== null) {
    from = parseClock(quietFrom);
    until = parseClock(quietTo);
    if (from === null || until === null || from === until || tz === null) throw new ApiError(400, 'bad-request');
  }
  const { rows } = await req.server.deps.db.query<SettingsRow>(
    `insert into nudge_settings (account_id, enabled, quiet_from, quiet_to, tz) values ($1, $2, $3, $4, $5)
     on conflict (account_id) do update
       set enabled = excluded.enabled, quiet_from = excluded.quiet_from, quiet_to = excluded.quiet_to, tz = excluded.tz
     returning enabled, quiet_from, quiet_to, tz`,
    [req.auth.accountId, enabled, from, until, tz],
  );
  return settingsJson(rows[0]);
}

/** `POST /v1/account/blocks { username }`: by public name; blocking twice is a no-op. */
async function blockHandler(req: FastifyRequest, reply: FastifyReply) {
  const deps = req.server.deps;
  const { username } = bodyOf(req);
  if (typeof username !== 'string' || username.length > NAME_MAX) throw new ApiError(400, 'bad-request');
  const who = await findByPublicName(deps.db, username);
  if (who === null) throw new ApiError(404, 'not-found');
  if (who.id === req.auth.accountId) throw new ApiError(400, 'bad-request');
  await deps.db.query(
    'insert into account_blocks (account_id, blocked_id, created_at) values ($1, $2, $3) on conflict do nothing',
    [req.auth.accountId, who.id, deps.clock()],
  );
  return reply.code(204).send();
}

/** Deletes nudge records older than an hour (registered in main.ts). */
export const purgeNudges: RetentionJob = {
  name: 'purgeNudges',
  async run(db: pg.Pool, now: Date): Promise<number> {
    const { rowCount } = await db.query('delete from nudges where sent_at < $1', [new Date(now.getTime() - NUDGE_RETENTION_MS)]);
    return rowCount ?? 0;
  },
};

/** Nudges, nudge settings and blocks: full trader sessions only. */
export function nudgeRoutes(app: FastifyInstance): void {
  const trader = requireSession({ kinds: ['trader'] });
  app.post('/v1/nudges', { preHandler: trader }, nudgeHandler);
  app.get('/v1/account/nudges', { preHandler: trader }, getSettings);
  app.put('/v1/account/nudges', { preHandler: trader }, putSettings);
  app.post('/v1/account/blocks', { preHandler: trader }, blockHandler);
}
