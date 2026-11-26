/**
 * Plan 4 Task 27 (Revision 2026-10-29, 2026-10-29b), with D-017's rule list (owner Q15) and D-020's
 * notice (owner G39). Migration 780 (`account_bans`); the trader-side checks are banState.ts.
 *
 * Staff side (perm `accounts.ban`: senior moderators and the owner; a moderator cannot ban):
 * - `GET /staff/v1/accounts/:id/bans` → `{ priorOffences, bans }`: every ban of the account, newest
 *   first, the staff note included.
 * - `POST /staff/v1/accounts/:id/bans { banId, kind, ruleId, until, note?, tapId }` → 201 the ban.
 *   `kind` 'trade' | 'site'; `ruleId` one of BAN_RULES; `until` an exact ISO instant after now, or
 *   null for a lifetime ban; `note` staff-only (≤ 500 characters, never logged, never shown to the
 *   trader). D-017 (`checkBanTerm`, every earlier ban of the account an offence): lifetime only for
 *   a rule that allows it before the third offence (409 `lifetime-not-allowed`), and always from the
 *   third (409 `lifetime-required`). A second standing ban of the same kind: 409 `already-banned`.
 *   The tap `ban-account` binds the account, the ban id, the kind, the rule and the end, and is used
 *   only after every check passed. A lifetime site ban also puts the account's identifiers on the
 *   ban list (`recordBan`, lead reading: a timed ban must not stop the person's own names and keys
 *   coming back). Logged `account.trade-banned` / `account.site-banned`.
 * - `POST /staff/v1/accounts/:id/bans/:banId/lift { tapId }` → 200: tap `lift-ban`; 409
 *   `wrong-state` unless the ban still stands. Logged `account.ban-lifted` with the ban id. Lifting a
 *   lifetime site ban deletes the ban-list rows recorded as the account's or its members' own
 *   (review MF2, lead call; `identifiersRemoved` in the log).
 * Only a trader account is banned (a team's members are banned with it: their sessions are the
 * team account's); anything else is 404.
 *
 * Trader side: `GET /v1/account/ban` → `{ bans, unfinished, contacts }`: the bans in force (kind, the general
 * reason code, `until` or null, `permanent`), under a site ban the unfinished trades
 * (`{ code, dispute }`, newest first; review S1) and the moderator contact links from Settings
 * (`moderator_contact_url`, `community_matrix_url`, `community_telegram_url`; null when unset).
 * Never the rule or the note.
 *
 * `settleEndedBans` (every minute, main.ts): writes `ended_at` on the timed bans whose end has
 * passed and logs `account.reinstated` once each (the plan's "a log entry on the first request
 * after it", moved to the job so a request never writes the log).
 */
import { BAN_RULES, banRule, checkBanTerm, type BanReasonCode } from '@x2f/staff';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { Deps } from '../app.js';
import { lockAccount, withTx } from '../auth/liveSession.js';
import { requireSession } from '../auth/sessions.js';
import { activeBans, unfinishedTrades } from '../banState.js';
import { recordBan } from '../bans.js';
import type { Queryable } from '../db/pool.js';
import type { EventBus } from '../events/bus.js';
import { ApiError } from '../errors.js';
import { appendLog } from '../log/append.js';
import type { RetentionJob } from '../retention.js';
import { requireStaff } from './guard.js';
import { consumeKeyTap } from './keyTap.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const BAN_NOTE_MAX = 500;

interface BanRow {
  id: string;
  kind: 'trade' | 'site';
  rule_id: string;
  reason_code: BanReasonCode;
  until: Date | null;
  note: string | null;
  created_at: Date;
  ended_at: Date | null;
  lifted_at: Date | null;
}

const COLUMNS = 'id, kind, rule_id, reason_code, until, note, created_at, ended_at, lifted_at';

function staffView(r: BanRow, now: Date) {
  return {
    id: r.id,
    kind: r.kind,
    ruleId: r.rule_id,
    reasonCode: r.reason_code,
    until: r.until?.toISOString() ?? null,
    permanent: r.until === null,
    note: r.note,
    createdAt: r.created_at.toISOString(),
    endedAt: r.ended_at?.toISOString() ?? null,
    liftedAt: r.lifted_at?.toISOString() ?? null,
    active: r.ended_at === null && r.lifted_at === null && (r.until === null || r.until.getTime() > now.getTime()),
  };
}

function uuidParam(req: FastifyRequest, key: 'id' | 'banId'): string {
  const v = (req.params as Record<string, unknown>)[key];
  if (typeof v !== 'string' || !UUID.test(v)) throw new ApiError(404, 'not-found');
  return v.toLowerCase();
}

function bodyOf(req: FastifyRequest, keys: readonly string[], required: readonly string[]): Record<string, unknown> {
  const b = req.body ?? {};
  if (b === null || typeof b !== 'object' || Array.isArray(b)) throw new ApiError(400, 'bad-request');
  const r = b as Record<string, unknown>;
  if (Object.keys(r).some((k) => !keys.includes(k)) || required.some((k) => !Object.hasOwn(r, k))) throw new ApiError(400, 'bad-request');
  return r;
}

const actor = (req: FastifyRequest) => ({ kind: 'staff' as const, id: req.staff.accountId, role: req.staff.role });

/** 404 unless a trader account; locks it. */
async function lockTrader(c: Queryable, accountId: string): Promise<void> {
  const { rows } = await c.query<{ kind: string }>('select kind from accounts where id = $1', [accountId]);
  if (rows[0]?.kind !== 'trader') throw new ApiError(404, 'not-found');
  await lockAccount(c, accountId);
}

export interface StaffBanOptions {
  /** The trader API's bus (main.ts): a site ban ends the account's open event streams (review S2). */
  traderEvents?: Pick<EventBus, 'closeAccount'>;
}

export function staffBanRoutes(app: FastifyInstance, o: StaffBanOptions = {}): void {
  const perm = 'accounts.ban' as const;
  const opts = { config: { perm }, preHandler: requireStaff(perm) };

  app.get('/staff/v1/accounts/:id/bans', opts, async (req) => {
    const accountId = uuidParam(req, 'id');
    const { db, clock } = req.server.deps;
    const { rows: kind } = await db.query<{ kind: string }>('select kind from accounts where id = $1', [accountId]);
    if (kind[0]?.kind !== 'trader') throw new ApiError(404, 'not-found');
    const { rows } = await db.query<BanRow>(`select ${COLUMNS} from account_bans where account_id = $1 order by created_at desc, id`, [accountId]);
    return { priorOffences: rows.length, bans: rows.map((r) => staffView(r, clock())), rules: BAN_RULES };
  });

  app.post('/staff/v1/accounts/:id/bans', opts, async (req, reply) => {
    const accountId = uuidParam(req, 'id');
    const b = bodyOf(req, ['banId', 'kind', 'ruleId', 'until', 'note', 'tapId'], ['banId', 'kind', 'ruleId', 'until', 'tapId']);
    const banId = typeof b.banId === 'string' && UUID.test(b.banId) ? b.banId.toLowerCase() : null;
    const kind = b.kind === 'trade' || b.kind === 'site' ? b.kind : null;
    const ruleId = typeof b.ruleId === 'string' ? b.ruleId : '';
    const rule = banRule(ruleId);
    const until = b.until === null ? null : typeof b.until === 'string' ? b.until : undefined;
    const note = b.note === undefined || b.note === null ? null : typeof b.note === 'string' && b.note.length <= BAN_NOTE_MAX ? b.note : undefined;
    const tapId = typeof b.tapId === 'string' ? b.tapId : '';
    const deps = req.server.deps;
    const now = deps.clock();
    if (banId === null || kind === null || rule === null || until === undefined || note === undefined) throw new ApiError(400, 'bad-request');
    // The end's shape first (D-017's own check repeats it with the offence count).
    if (until !== null) {
      const shape = checkBanTerm({ ruleId, priorOffences: 0, until }, now);
      if (!shape.ok && shape.error === 'bad-until') throw new ApiError(400, 'bad-request', { field: 'until' });
    }
    const view = await withTx(deps.db, async (c) => {
      await lockTrader(c, accountId);
      const standing = await c.query(
        'select 1 from account_bans where account_id = $1 and kind = $2 and ended_at is null and lifted_at is null and (until is null or until > $3)',
        [accountId, kind, now],
      );
      if (standing.rows.length > 0) throw new ApiError(409, 'already-banned');
      // A standing ban past its end that the job has not settled yet makes room now, logged as the
      // job would (review S5: one account.reinstated per ended ban).
      const ended = await c.query<{ kind: string }>(
        'update account_bans set ended_at = until where account_id = $1 and kind = $2 and ended_at is null and lifted_at is null and until <= $3 returning kind',
        [accountId, kind, now],
      );
      for (const r of ended.rows) {
        await appendLog(c, { at: now, actor: { kind: 'system' }, tradeCode: null, action: 'account.reinstated', detail: { accountId, kind: r.kind } });
      }
      const { rows: prior } = await c.query<{ n: number }>('select count(*)::int as n from account_bans where account_id = $1', [accountId]);
      const term = checkBanTerm({ ruleId, priorOffences: prior[0]!.n, until }, now);
      if (!term.ok) {
        if (term.error === 'lifetime-required' || term.error === 'lifetime-not-allowed') throw new ApiError(409, term.error);
        throw new ApiError(400, 'bad-request');
      }
      const tap = await consumeKeyTap(c, tapId, req.staff.accountId, { kind: 'ban-account', accountId, banId, banKind: kind, ruleId, until }, now, { sessionId: req.auth.sessionId });
      const ins = await c.query<BanRow>(
        `insert into account_bans (id, account_id, kind, rule_id, reason_code, until, note, placed_by, tap_id, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) on conflict do nothing returning ${COLUMNS}`,
        [banId, accountId, kind, ruleId, rule.reasonCode, until, note, req.staff.accountId, tap.id, now],
      );
      if (ins.rows.length === 0) throw new ApiError(400, 'bad-request'); // the ban id is taken
      if (kind === 'site' && until === null) {
        await recordBan({ db: c as unknown as Deps['db'], config: deps.config, clock: deps.clock }, accountId);
      }
      await appendLog(c, {
        at: now, actor: actor(req), tradeCode: null,
        action: kind === 'trade' ? 'account.trade-banned' : 'account.site-banned',
        detail: { accountId, banId, ruleId, reasonCode: rule.reasonCode, ...(until !== null ? { until } : {}), permanent: until === null },
      });
      return staffView(ins.rows[0]!, now);
    });
    // Review S2: an event stream opened before the ban would run on for up to its lifetime; a site
    // ban ends them after the commit (a reconnect then meets the gate), as endAllSessions does.
    if (kind === 'site') o.traderEvents?.closeAccount(accountId);
    return reply.code(201).send(view);
  });

  app.post('/staff/v1/accounts/:id/bans/:banId/lift', opts, async (req) => {
    const accountId = uuidParam(req, 'id');
    const banId = uuidParam(req, 'banId');
    const b = bodyOf(req, ['tapId'], ['tapId']);
    const tapId = typeof b.tapId === 'string' ? b.tapId : '';
    const deps = req.server.deps;
    const now = deps.clock();
    return withTx(deps.db, async (c) => {
      await lockTrader(c, accountId);
      const { rows } = await c.query<BanRow>(
        `select ${COLUMNS} from account_bans where id = $1 and account_id = $2 for update`,
        [banId, accountId],
      );
      const ban = rows[0];
      if (!ban) throw new ApiError(404, 'not-found');
      if (!staffView(ban, now).active) throw new ApiError(409, 'wrong-state');
      await consumeKeyTap(c, tapId, req.staff.accountId, { kind: 'lift-ban', accountId, banId }, now, { sessionId: req.auth.sessionId });
      const up = await c.query<BanRow>(
        `update account_bans set lifted_at = $2, lifted_by = $3 where id = $1 returning ${COLUMNS}`,
        [banId, now, req.staff.accountId],
      );
      // Review MF2 (lead call): lifting a lifetime site ban undoes what it put on the ban list: every
      // row recorded as the account's or one of its members' login accounts' own (`recordBan`).
      let identifiersRemoved: number | null = null;
      if (ban.kind === 'site' && ban.until === null) {
        const del = await c.query(
          `delete from banned_identifiers
            where account_id = $1
               or account_id in (select m.member_account_id from team_members m where m.account_id = $1 and m.member_account_id is not null)`,
          [accountId],
        );
        identifiersRemoved = del.rowCount ?? 0;
      }
      await appendLog(c, {
        at: now, actor: actor(req), tradeCode: null, action: 'account.ban-lifted',
        detail: { accountId, banId, kind: ban.kind, ...(identifiersRemoved !== null ? { identifiersRemoved } : {}) },
      });
      return staffView(up.rows[0]!, now);
    });
  });
}

/** The trader's own ban notice (D-020, owner G39): what is in force and how to reach a moderator. */
export function traderBanRoutes(app: FastifyInstance): void {
  const pre = requireSession({ kinds: ['trader'], allowStaleTerms: true, member: 'any' });
  app.get('/v1/account/ban', { preHandler: pre }, async (req) => {
    const { db, clock } = req.server.deps;
    const bans = await activeBans(db, req.auth.accountId, clock());
    // Review S1: a site-banned person's unfinished trades, for the notice's links (empty otherwise).
    const unfinished = bans.some((x) => x.kind === 'site') ? await unfinishedTrades(db, req.auth.accountId) : [];
    const { rows } = await db.query<{ moderator_contact_url: string | null; community_matrix_url: string | null; community_telegram_url: string | null }>(
      'select moderator_contact_url, community_matrix_url, community_telegram_url from settings where id = 1',
    );
    const s = rows[0];
    return {
      bans: bans.map((x) => ({ kind: x.kind, reasonCode: x.reasonCode, until: x.until?.toISOString() ?? null, permanent: x.until === null })),
      unfinished,
      contacts: {
        moderatorUrl: s?.moderator_contact_url ?? null,
        matrixUrl: s?.community_matrix_url ?? null,
        telegramUrl: s?.community_telegram_url ?? null,
      },
    };
  });
}

/** Every minute: timed bans whose end has passed get `ended_at` and one `account.reinstated` entry each. */
export const settleEndedBans: RetentionJob = {
  name: 'settleEndedBans',
  async run(pool: pg.Pool, now: Date): Promise<number> {
    return withTx(pool, async (c) => {
      const { rows } = await c.query<{ account_id: string; kind: string }>(
        `update account_bans set ended_at = until
          where ended_at is null and lifted_at is null and until is not null and until <= $1
          returning account_id, kind`,
        [now],
      );
      for (const r of rows) {
        await appendLog(c, { at: now, actor: { kind: 'system' }, tradeCode: null, action: 'account.reinstated', detail: { accountId: r.account_id, kind: r.kind } });
      }
      return rows.length;
    });
  },
};
