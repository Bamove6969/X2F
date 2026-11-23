import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { withTx } from '../auth/hold.js';
import { ApiError } from '../errors.js';
import { appendLog } from '../log/append.js';
import type { Queryable } from '../db/pool.js';
import type { LogAction } from '../log/actions.js';
import { MAINTENANCE_KINDS, readSiteState, type SiteState } from '../site/routes.js';
import { requireStaff } from './guard.js';
import { consumeKeyTap } from './keyTap.js';
import { bannerPublishIntent, maintenanceOnIntent, maintenancePlannedIntent } from '@x2f/staff';

/** The banner's limit (Task 8; migration 206 checks the same, in characters). */
export const BANNER_MAX = 140;
/**
 * The maintenance message's limit, also a planned maintenance's (owner G19: "500 characters is more
 * than enough"; migrations 206 and 350 check the same).
 */
export const MAINTENANCE_MESSAGE_MAX = 500;

const badRequest = (field?: string): ApiError => new ApiError(400, 'bad-request', field ? { field } : undefined);

function bodyOf(req: FastifyRequest, keys: readonly string[]): Record<string, unknown> {
  const b = req.body;
  if (b === null || typeof b !== 'object' || Array.isArray(b)) throw badRequest();
  const r = b as Record<string, unknown>;
  if (!Object.keys(r).every((k) => keys.includes(k))) throw badRequest();
  return r;
}

/** Characters as Postgres's `char_length` counts them (code points, not UTF-16 units). */
const chars = (s: string): number => [...s].length;
/** Control characters (line breaks included): a banner is one line. */
const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]');
/** A message may have line breaks but no other control character. */
const CONTROL_BUT_NEWLINE = new RegExp('[\\u0000-\\u0009\\u000b-\\u001f\\u007f-\\u009f]');

/** A maintenance or plan message: absent, null or blank is none; at most 500 characters, line breaks allowed. */
function messageOf(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw badRequest('message');
  const m = v.trim();
  if (chars(m) > MAINTENANCE_MESSAGE_MAX || CONTROL_BUT_NEWLINE.test(m)) throw badRequest('message');
  return m === '' ? null : m;
}

/** An ISO time strictly after `after`, or 400 naming the field. */
function futureTime(v: unknown, after: Date, field: string): Date {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(v)) throw badRequest(field);
  const d = new Date(v);
  if (Number.isNaN(d.getTime()) || d.getTime() <= after.getTime()) throw badRequest(field);
  return d;
}

/**
 * The site state as the owner's staff pages see it: the trader-side state plus `logAlarm`, the time
 * the moderation process's daily activity-log check first failed (`site_flags.log_alarm`, Task 14),
 * or null. StaffOverview shows its card only when it is set (Task 17). Never on `GET /v1/site`.
 */
export interface StaffSiteState extends SiteState {
  logAlarm: string | null;
}

export async function readStaffSiteState(db: Queryable): Promise<StaffSiteState> {
  const state = await readSiteState(db);
  const { rows } = await db.query<{ log_alarm: Date | null }>('select log_alarm from site_flags');
  return { ...state, logAlarm: rows[0]?.log_alarm?.toISOString() ?? null };
}

/**
 * Plan 4 Task 8, the site controls (perm `site.control`, the owner), each change logged in its own
 * transaction (the log entry last):
 * - `GET /staff/v1/site` → the full state with `logAlarm` (`StaffSiteState`; builder addition). Every
 *   staff site answer below is that same state.
 * - `POST /staff/v1/site/stop { tapId }` (tap intent `emergency-stop`): `trading_paused` on and
 *   `stopped_at`. Plan 3 then refuses new offers and takes with `trading-paused`; existing trades go on.
 * - `POST /staff/v1/site/resume { tapId }` (tap intent `resume-trading`).
 * - `PUT /staff/v1/site/banner { text, kind: 'info' | 'warning', tapId }` (review p4t22 m2, lead
 *   default: tap intent `banner-publish`, bound to the kind and the text as sent): over 140
 *   characters → 400 `banner-too-long`; `DELETE /staff/v1/site/banner` → 204 (untapped).
 * - `PUT /staff/v1/site/maintenance { on, message?, kind?, backBy?, tapId }` (on: review p4t22 m2,
 *   lead default, tap intent `maintenance-on`, bound to the kind, the message and backBy as sent;
 *   off: no tap): on sets `maintenance_since`
 *   (kept if already on, so the timers shift by the whole maintenance), the message, the kind and
 *   when it should be back; off clears them all. The kind is `planned` or `unplanned` and required
 *   (owner G19: no default, "emergency" is known only internally and is no kind). `backBy` (an ISO
 *   time after now, or null) is unplanned's best guess (G19: "our best guess as to when we hope to
 *   have it back up"); switching `planned` on with an announced plan takes the plan's end (while
 *   still ahead) and its message when the body gives none, and retires the plan. The trader API
 *   answers 503 `maintenance` meanwhile (site/routes.ts), and the timer loops pause every trade and
 *   dispute (trades/timers.ts, disputes/timers.ts; owner G19, g62).
 * - `PUT /staff/v1/site/maintenance/planned { startsAt, endsAt, message?, tapId }` (review p4t22 N2,
 *   lead default: tap intent `maintenance-planned`, bound to the start, end and message as sent; a
 *   planned switch-on that inherits the plan's message binds that message) (owner G19: "we will
 *   plan it and try and give 24-hour notice"): announces a planned maintenance, shown to every
 *   visitor until its end (`GET /v1/site` `plannedMaintenance`); a new one replaces it. The start is
 *   after now and the end after the start; how much notice is the staff member's call (no minimum
 *   is enforced: OWNER-Q in J-04's report). Announcing does not start it. `DELETE` → 204.
 * - `POST /staff/v1/site/auto-close/resume {}` (security review 8 Nov M1): turns the 60-day close
 *   (accountInactivity.ts) back on after a pass that hit its cap switched it off (`auto_close_off_at`).
 * A request that changes nothing (stop while stopped, removing no banner, resuming a close that is
 * on) consumes its tap but writes no log entry.
 */
export function staffSiteRoutes(app: FastifyInstance): void {
  const perm = 'site.control' as const;
  const opts = { config: { perm }, preHandler: requireStaff(perm) };
  const log = (c: pg.PoolClient, req: FastifyRequest, action: LogAction, detail: object = {}) =>
    appendLog(c, { at: req.server.deps.clock(), actor: { kind: 'staff', id: req.staff.accountId, role: req.staff.role }, tradeCode: null, action, detail });
  const tx = <T>(req: FastifyRequest, fn: (c: pg.PoolClient) => Promise<T>) => withTx(req.server.deps.db, fn);

  app.get('/staff/v1/site', opts, async (req): Promise<StaffSiteState> => readStaffSiteState(req.server.deps.db));

  for (const which of ['stop', 'resume'] as const) {
    app.post(`/staff/v1/site/${which}`, opts, async (req) => {
      const b = bodyOf(req, ['tapId']);
      const now = req.server.deps.clock();
      return tx(req, async (c) => {
        await consumeKeyTap(c, typeof b.tapId === 'string' ? b.tapId : '', req.staff.accountId, { kind: which === 'stop' ? 'emergency-stop' : 'resume-trading' }, now, {
          sessionId: req.auth.sessionId, // RV5 m10 (lead re-review item 7)
        });
        const { rowCount } =
          which === 'stop'
            ? await c.query('update site_flags set trading_paused = true, stopped_at = $1 where not trading_paused', [now])
            : await c.query('update site_flags set trading_paused = false, stopped_at = null where trading_paused');
        if (rowCount) await log(c, req, which === 'stop' ? 'site.stopped' : 'site.resumed');
        return readStaffSiteState(c);
      });
    });
  }

  app.post('/staff/v1/site/auto-close/resume', opts, async (req) => {
    bodyOf(req, []);
    return tx(req, async (c) => {
      const { rowCount } = await c.query('update site_flags set auto_close_off_at = null where auto_close_off_at is not null');
      if (rowCount) await log(c, req, 'site.auto-close-resumed');
      return { autoClose: 'on' as const };
    });
  });

  app.put('/staff/v1/site/banner', opts, async (req) => {
    const b = bodyOf(req, ['text', 'kind', 'tapId']);
    if (b.kind !== 'info' && b.kind !== 'warning') throw badRequest('kind');
    if (typeof b.text !== 'string') throw badRequest('text');
    const raw = b.text;
    const bannerKind = b.kind;
    const text = b.text.trim();
    if (text === '' || CONTROL.test(text)) throw badRequest('text');
    if (chars(text) > BANNER_MAX) throw new ApiError(400, 'banner-too-long', { max: BANNER_MAX });
    return tx(req, async (c) => {
      // Review p4t22 m2 (lead default): text shown to every user is tapped, bound to the text as sent.
      await consumeKeyTap(c, typeof b.tapId === 'string' ? b.tapId : '', req.staff.accountId, bannerPublishIntent({ bannerKind, text: raw }), req.server.deps.clock(), {
        sessionId: req.auth.sessionId,
      });
      await c.query('update site_flags set banner_text = $1, banner_kind = $2', [text, b.kind]);
      await log(c, req, 'site.banner-set', { kind: b.kind });
      return readStaffSiteState(c);
    });
  });

  app.delete('/staff/v1/site/banner', opts, async (req, reply) => {
    await tx(req, async (c) => {
      const { rowCount } = await c.query('update site_flags set banner_text = null, banner_kind = null where banner_text is not null');
      if (rowCount) await log(c, req, 'site.banner-removed');
    });
    return reply.code(204).send();
  });

  app.put('/staff/v1/site/maintenance', opts, async (req) => {
    const b = bodyOf(req, ['on', 'message', 'kind', 'backBy', 'tapId']);
    if (typeof b.on !== 'boolean') throw badRequest('on');
    const now = req.server.deps.clock();
    if (!b.on) {
      if (b.message !== undefined || b.kind !== undefined || b.backBy !== undefined || b.tapId !== undefined) throw badRequest();
      return tx(req, async (c) => {
        const { rowCount } = await c.query(
          `update site_flags set maintenance_since = null, maintenance_message = null, maintenance_kind = null, maintenance_back_by = null
            where maintenance_since is not null`,
        );
        if (rowCount) await log(c, req, 'site.maintenance-off');
        return readStaffSiteState(c);
      });
    }
    // Owner G19 (7 Nov): no default kind; the staff member says which (an emergency is internal).
    const kind = b.kind;
    if (!(MAINTENANCE_KINDS as readonly unknown[]).includes(kind)) throw badRequest('kind');
    const message = messageOf(b.message);
    let backBy: Date | null = null;
    if (b.backBy !== undefined && b.backBy !== null) backBy = futureTime(b.backBy, now, 'backBy');
    const rawMessage = typeof b.message === 'string' ? b.message : null;
    const rawBackBy = typeof b.backBy === 'string' ? b.backBy : null;
    const maintenanceKind = kind as 'planned' | 'unplanned';
    return tx(req, async (c) => {
      const { rows } = await c.query<{ was: boolean; planned_end: Date | null; planned_message: string | null }>(
        'select maintenance_since is not null as was, planned_end, planned_message from site_flags for update',
      );
      const plan = rows[0];
      // A planned switch-on takes up the announced plan and retires it; unplanned leaves it for later.
      const fromPlan = kind === 'planned' && plan !== undefined && plan.planned_end !== null;
      // Review p4t22 m2 (lead default): switching maintenance on is tapped, bound to its kind, the
      // message and the back-by time as sent. Switching it off is not. Review p4t22 N2: a planned
      // switch-on with no message of its own shows the plan's, so its tap binds that one.
      const shown = message === null && fromPlan ? (plan?.planned_message ?? null) : rawMessage;
      await consumeKeyTap(c, typeof b.tapId === 'string' ? b.tapId : '', req.staff.accountId, maintenanceOnIntent({ maintenanceKind, message: shown, backBy: rawBackBy }), now, {
        sessionId: req.auth.sessionId,
      });
      const planEnd = fromPlan && plan.planned_end !== null && plan.planned_end.getTime() > now.getTime() ? plan.planned_end : null;
      await c.query(
        `update site_flags set maintenance_since = coalesce(maintenance_since, $1), maintenance_message = $2, maintenance_kind = $3,
                maintenance_back_by = $4,
                planned_start = case when $5 then null else planned_start end,
                planned_end = case when $5 then null else planned_end end,
                planned_message = case when $5 then null else planned_message end`,
        [now, message ?? (fromPlan ? (plan?.planned_message ?? null) : null), kind, backBy ?? planEnd, fromPlan],
      );
      if (rows[0]?.was !== true) await log(c, req, 'site.maintenance-on', { kind });
      return readStaffSiteState(c);
    });
  });

  app.put('/staff/v1/site/maintenance/planned', opts, async (req) => {
    const b = bodyOf(req, ['startsAt', 'endsAt', 'message', 'tapId']);
    const now = req.server.deps.clock();
    const startsAt = futureTime(b.startsAt, now, 'startsAt');
    const endsAt = futureTime(b.endsAt, startsAt, 'endsAt');
    const message = messageOf(b.message);
    return tx(req, async (c) => {
      // Review p4t22 N2 (lead default): the announcement every visitor sees is tapped, bound to its
      // start, its end and its message as sent, like switching maintenance on.
      await consumeKeyTap(
        c,
        typeof b.tapId === 'string' ? b.tapId : '',
        req.staff.accountId,
        maintenancePlannedIntent({ startsAt: b.startsAt as string, endsAt: b.endsAt as string, message: typeof b.message === 'string' ? b.message : null }),
        now,
        { sessionId: req.auth.sessionId },
      );
      await c.query('update site_flags set planned_start = $1, planned_end = $2, planned_message = $3', [startsAt, endsAt, message]);
      await log(c, req, 'site.maintenance-planned', { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() });
      return readStaffSiteState(c);
    });
  });

  app.delete('/staff/v1/site/maintenance/planned', opts, async (req, reply) => {
    await tx(req, async (c) => {
      const { rowCount } = await c.query(
        'update site_flags set planned_start = null, planned_end = null, planned_message = null where planned_start is not null',
      );
      if (rowCount) await log(c, req, 'site.maintenance-plan-removed');
    });
    return reply.code(204).send();
  });

}
