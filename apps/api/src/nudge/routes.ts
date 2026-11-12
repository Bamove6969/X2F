import { normalizeTradeCode } from '@x2f/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { requireSession } from '../auth/sessions.js';
import { ApiError } from '../errors.js';
import type { RetentionJob } from '../retention.js';
import { blockedEitherWaySql } from '../traders/blocks.js';
import { findByPublicName, PUBLIC_NAME } from './names.js';
import { canonicalTimeZone, formatClock, inQuietHours, parseClock } from './quiet.js';

/**
 * One nudge every 15 minutes per sender and recipient (owner, 7 Nov: "once every 15 minutes", as
 * many as needed; lead 7 Nov: per counterpart, so a vendor with several silent buyers can nudge
 * each of them): the sender's own limit, refused with `too-soon`. There is no cap on how many.
 */
export const NUDGE_GAP_MS = 15 * 60_000;
/**
 * At most 3 nudges received per hour from everyone combined: past it, nudges are dropped silently
 * (`recipient-busy`). Not for a nudge about a trade that is secured or paid:
 * there the owner's rule is one per 15 minutes with no cap on the number (7 Nov; lead default for
 * the states), so only the sender's gap limits them.
 */
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
 *   named by `context`, a chat or trade code. It answers `'open-trade'` when `context` is an open
 *   trade between them: a block does not stop those nudges (Task 37 review N1, lead decision (a):
 *   open trades with a blocked person finish normally, so a buyer who paid can still wake the
 *   seller to release). `true` is any other shared context (an offer chat), where a block either
 *   way drops the nudge.
 * - `publish` / `sendPush`: left out in production, so delivery is Task 19's own (`liveDelivery`);
 *   tests pass fakes. `sendPush` takes only the kind, so the payload can only be the generic
 *   "Someone nudged you on X2F": never a name, an amount or a trade detail.
 */
/** `false`: nothing shared (403). `'open-trade'`: an open trade, which a block does not stop. `true`: any other shared context. */
export type SharedContext = boolean | 'open-trade';

export interface NudgeWiring {
  hasSharedContext(fromId: string, toId: string, context: string): Promise<SharedContext>;
  publish?(accountId: string, ev: NudgeEvent): void | Promise<void>;
  sendPush?(accountId: string, kind: 'nudge'): Promise<boolean>;
}

/**
 * Task 19's real channels: the SSE bus delivers only to the recipient's own open streams; a
 * recipient with no stream open (a closed tab, plan Task 26) gets the generic Web Push, the same
 * rule as trade events (events/tradePublisher.ts), so an open tab does not also get an OS alert.
 */
export function liveDelivery(app: FastifyInstance): Required<Pick<NudgeWiring, 'publish' | 'sendPush'>> {
  return {
    publish: (accountId, ev) => void app.events.publish(accountId, ev),
    sendPush: async (accountId, kind) => (app.events.delivered(accountId) ? false : app.push.send(accountId, kind)),
  };
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
  const live = liveDelivery(app);
  const publish = app.deps.nudges.publish ?? live.publish;
  const sendPush = app.deps.nudges.sendPush ?? live.sendPush;
  setImmediate(() => {
    const tries = [Promise.resolve().then(() => publish(toId, ev)), Promise.resolve().then(() => sendPush(toId, 'nudge'))];
    void Promise.allSettled(tries).then((results) => {
      for (const r of results) if (r.status === 'rejected') app.log.warn({ err: r.reason }, 'nudge delivery failed');
    });
  });
}

/** Trade states in which the 3-per-hour recipient cap is lifted for a trade nudge (lead default, review finding 4). */
const UNCAPPED_STATES: readonly string[] = ['secured', 'paid'];

/**
 * The open trade a trade nudge is about (the trade, or the trade a chat is linked to), between
 * these two accounts either way round, LOCKED (`for no key update`). This runs first in the
 * nudge's transaction, before the accounts are locked, so the lock order is the trade events'
 * (trade row, then account; review finding 2) and the two cannot deadlock.
 *
 * Nudges are optional (owner 8 Nov, p6-1, reversing G2 / g66): the seller's cancel needs none. An
 * accepted nudge from the trade's seller to its buyer still records its first time in
 * `trades.seller_nudged_at` while the trade is `secured` (a record only: no trade rule reads it).
 * It is written in the same transaction, so a 429 or any later error rolls
 * it back. Set whether or not the nudge is delivered: the seller did nudge, and the answer is the
 * same 202 either way. A later nudge leaves it as is.
 */
async function lockTradeAndRecordNudge(
  client: pg.PoolClient,
  fromId: string,
  toId: string,
  context: string,
  now: Date,
): Promise<{ state: string } | null> {
  const code = normalizeTradeCode(context);
  if (code === null) return null;
  const { rows } = await client.query<{ code: string; state: string; seller: boolean; counts: boolean }>(
    `select t.code, t.state, t.seller_account_id = $1 as seller,
            (t.seller_nudged_at is null or t.seller_nudged_at < t.secured_at) as counts
       from trades t
      where t.code in ($3, (select c.trade_code from chats c where c.code = $3)) and t.closed_at is null
        and ((t.seller_account_id = $1 and t.buyer_account_id = $2) or (t.seller_account_id = $2 and t.buyer_account_id = $1))
      for no key update of t`,
    [fromId, toId, code],
  );
  const t = rows[0];
  if (!t) return null;
  if (t.seller && t.state === 'secured' && t.counts) {
    await client.query('update trades set seller_nudged_at = $2 where code = $1', [t.code, now]);
  }
  return { state: t.state };
}

/**
 * `POST /v1/nudges { to, context }`. The sender's own refusals are distinct: 403
 * `no-shared-context` (also for an unknown name or yourself) and 429 `too-soon`. Everything about
 * the recipient (a block either way outside an open trade (Task 37 review M6, N1), nudges off, quiet hours, 3 already this hour, disabled) is decided after
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
  const shared = recipient === null || recipient.id === fromId ? false : await deps.nudges.hasSharedContext(fromId, recipient.id, context);
  if (recipient === null || shared === false) throw new ApiError(403, 'no-shared-context');
  // Review N1: inside an open trade a block does not drop the nudge (the trade finishes normally).
  const blockApplies = shared !== 'open-trade';

  const now = deps.clock();
  let deliverIt = false;
  let fromName = '';
  const client = await deps.db.connect();
  try {
    await client.query('begin');
    try {
      // The trade row first (review finding 2: the trade events' order), then the accounts.
      const trade = shared === 'open-trade' ? await lockTradeAndRecordNudge(client, fromId, recipient.id, context, now) : null;
      // Owner 7 Nov: one per 15 minutes with no cap on the number, while the trade is in an active
      // pre-close state (lead default, review finding 4); disputed or lapsed keep the 3-per-hour cap.
      const capApplies = trade === null || !UNCAPPED_STATES.includes(trade.state);
      // Both accounts, in a fixed order: parallel nudges by one sender, or to one recipient, queue here.
      await client.query('select id from accounts where id = any($1::uuid[]) order by id for no key update', [[fromId, recipient.id]]);
      const last = await client.query<{ last: Date | null }>(
        'select max(sent_at) as last from nudges where from_id = $1 and to_id = $2 and sent_at > $3',
        [fromId, recipient.id, new Date(now.getTime() - NUDGE_GAP_MS)],
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
                ${blockedEitherWaySql('$1::uuid', '$2::uuid')} as blocked,
                (select count(*) from nudges n where n.to_id = $2 and n.delivered and n.sent_at > $3)::int as recent
           from (select 1) as one left join nudge_settings s on s.account_id = $2`,
        [fromId, recipient.id, new Date(now.getTime() - HOUR_MS)],
      );
      const f = rows[0]!;
      fromName = f.from_name;
      const quiet = inQuietHours({ quietFrom: f.quiet_from, quietTo: f.quiet_to, tz: f.tz }, now);
      deliverIt =
        !recipient.disabled && f.enabled && !quiet && !(blockApplies && f.blocked) && !(capApplies && f.recent >= RECIPIENT_LIMIT_PER_HOUR);
      // Recorded either way: a dropped nudge still starts the sender's 15 minutes.
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

/** `POST /v1/account/blocks { displayName }`: by public display name; blocking twice is a no-op. */
async function blockHandler(req: FastifyRequest, reply: FastifyReply) {
  const deps = req.server.deps;
  const { displayName } = bodyOf(req);
  if (typeof displayName !== 'string' || displayName.length > NAME_MAX) throw new ApiError(400, 'bad-request');
  const who = await findByPublicName(deps.db, displayName);
  if (who === null) throw new ApiError(404, 'not-found');
  if (who.id === req.auth.accountId) throw new ApiError(400, 'bad-request');
  await deps.db.query(
    'insert into account_blocks (account_id, blocked_id, created_at) values ($1, $2, $3) on conflict do nothing',
    [req.auth.accountId, who.id, deps.clock()],
  );
  return reply.code(204).send();
}

/**
 * `DELETE /v1/account/blocks/:displayName` (Task 37): unblocks by public display name; unblocking
 * someone not blocked is a no-op (204), an unknown name 404 as for blocking. Everything the block
 * stopped (offers, takes, chats, presence) comes back at once: nothing is stored but the row.
 */
async function unblockHandler(req: FastifyRequest, reply: FastifyReply) {
  const deps = req.server.deps;
  const { displayName } = req.params as { displayName: string };
  if (displayName.length > NAME_MAX) throw new ApiError(400, 'bad-request');
  // By the stored key (display_key = lower(display_name)), within my own blocks only, with no
  // name-shape or reserved-word check (review M1): a name that a later rule change would refuse
  // must still be unblockable. 404 only when no account has that name.
  const { rows } = await deps.db.query<{ found: boolean }>(
    `with who as (select id from accounts where display_key = lower($2)),
          gone as (delete from account_blocks b using who where b.account_id = $1 and b.blocked_id = who.id returning 1)
     select exists (select 1 from who) as found`,
    [req.auth.accountId, displayName],
  );
  if (rows[0]?.found !== true) throw new ApiError(404, 'not-found');
  return reply.code(204).send();
}

/** One entry of my Blocked list: the public display name only (never the login name). */
export interface BlockedEntry {
  displayName: string;
  /** When I blocked them (S-093: shown with its date and time). */
  blockedAt: string;
  /** S-093 (owner p7-6): my own private note on them, or null; nobody else ever reads it. */
  note: string | null;
}

/** S-093: a block note's most characters (migration 362). */
export const BLOCK_NOTE_MAX = 500;
/**
 * Control and format characters other than a new line, refused in a note: S-094's rule for trader
 * notes (team/notes.ts, `[\p{Cc}\p{Cf}]` but a new line), so C1 controls, bidi and zero-width
 * characters, the BOM, a tab and a carriage return are refused (review m1, lead's call); and the line
 * and paragraph separators U+2028/2029 too, which are not Cc or Cf.
 */
const NOTE_CONTROL = /[\p{Cc}\p{Cf}\u2028\u2029]/u;

/**
 * `PUT /v1/account/blocks/:displayName/note { note }` (S-093, owner p7-6): sets, changes or clears
 * (null, or blank text) my private note on someone I blocked → 200 `{ note }` as stored (trimmed).
 * By the stored name key, as unblock, and only on my own block: 404 `not-found` for an unknown name
 * and for someone I did not block (names are public, so the two need not differ). 400
 * `bad-request` for a missing or non-string note, over BLOCK_NOTE_MAX characters, or control or
 * format characters other than a new line. The note is stored as plain text (as S-094's trader
 * notes); the blocked person and staff never read it.
 */
async function blockNoteHandler(req: FastifyRequest) {
  const deps = req.server.deps;
  const { displayName } = req.params as { displayName: string };
  if (displayName.length > NAME_MAX) throw new ApiError(400, 'bad-request');
  const raw = bodyOf(req).note;
  if (raw !== null && typeof raw !== 'string') throw new ApiError(400, 'bad-request', { field: 'note' });
  const trimmed = raw === null ? '' : raw.trim();
  if ([...trimmed].length > BLOCK_NOTE_MAX || NOTE_CONTROL.test(trimmed.replace(/\n/g, ''))) throw new ApiError(400, 'bad-request', { field: 'note' });
  const note = trimmed === '' ? null : trimmed;
  const { rows } = await deps.db.query<{ note: string | null }>(
    `update account_blocks b set note = $3 from accounts a
      where a.display_key = lower($2) and b.account_id = $1 and b.blocked_id = a.id
      returning b.note`,
    [req.auth.accountId, displayName, note],
  );
  if (rows.length === 0) throw new ApiError(404, 'not-found');
  return { note: rows[0]!.note };
}

/**
 * `GET /v1/account/blocks` (Task 37) → `BlockedEntry[]`, newest first: only the people I blocked.
 * Who blocked me is never answered anywhere (blocks are private, spec 2.4).
 */
async function listBlocks(req: FastifyRequest): Promise<BlockedEntry[]> {
  const { rows } = await req.server.deps.db.query<{ name: string; created_at: Date; note: string | null }>(
    `select a.${PUBLIC_NAME} as name, b.created_at, b.note from account_blocks b join accounts a on a.id = b.blocked_id
      where b.account_id = $1 order by b.created_at desc, a.${PUBLIC_NAME}`,
    [req.auth.accountId],
  );
  return rows.map((r) => ({ displayName: r.name, blockedAt: r.created_at.toISOString(), note: r.note }));
}

/** Deletes nudge records older than an hour (registered in main.ts). */
export const purgeNudges: RetentionJob = {
  name: 'purgeNudges',
  async run(db: pg.Pool, now: Date): Promise<number> {
    const { rowCount } = await db.query('delete from nudges where sent_at < $1', [new Date(now.getTime() - NUDGE_RETENTION_MS)]);
    return rowCount ?? 0;
  },
};

/** Nudges, nudge settings and blocks (Tasks 26 and 37): full trader sessions only. */
export function nudgeRoutes(app: FastifyInstance): void {
  const trader = requireSession({ kinds: ['trader'] });
  app.post('/v1/nudges', { preHandler: trader }, nudgeHandler);
  app.get('/v1/account/nudges', { preHandler: trader }, getSettings);
  app.put('/v1/account/nudges', { preHandler: trader }, putSettings);
  app.get('/v1/account/blocks', { preHandler: trader }, listBlocks);
  app.post('/v1/account/blocks', { preHandler: trader }, blockHandler);
  app.delete('/v1/account/blocks/:displayName', { preHandler: trader }, unblockHandler);
  app.put('/v1/account/blocks/:displayName/note', { preHandler: trader }, blockNoteHandler);
}
