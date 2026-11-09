import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { withTx } from '../auth/hold.js';
import { ApiError } from '../errors.js';
import { appendLog } from '../log/append.js';
import type { LogAction } from '../log/actions.js';
import { MAINTENANCE_KINDS, readSiteState, type SiteState } from '../site/routes.js';
import { requireStaff } from './guard.js';
import { consumeKeyTap } from './keyTap.js';

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
 * Plan 4 Task 8, the site controls (perm `site.control`, the owner), each change logged in its own
 * transaction (the log entry last):
 * - `GET /staff/v1/site` → the full state (the staff Settings page; builder addition).
 * - `POST /staff/v1/site/stop { tapId }` (tap intent `emergency-stop`): `trading_paused` on and
 *   `stopped_at`. Plan 3 then refuses new offers and takes with `trading-paused`; existing trades go on.
 * - `POST /staff/v1/site/resume { tapId }` (tap intent `resume-trading`).
 * - `PUT /staff/v1/site/banner { text, kind: 'info' | 'warning' }`: over 140 characters → 400
 *   `banner-too-long`; `DELETE /staff/v1/site/banner` → 204.
 * - `PUT /staff/v1/site/maintenance { on, message?, kind?, backBy? }`: on sets `maintenance_since`
 *   (kept if already on, so the timers shift by the whole maintenance), the message, the kind and
 *   when it should be back; off clears them all. The kind is `planned` or `unplanned` and required
 *   (owner G19: no default, "emergency" is known only internally and is no kind). `backBy` (an ISO
 *   time after now, or null) is unplanned's best guess (G19: "our best guess as to when we hope to
 *   have it back up"); switching `planned` on with an announced plan takes the plan's end (while
 *   still ahead) and its message when the body gives none, and retires the plan. The trader API
 *   answers 503 `maintenance` meanwhile (site/routes.ts), and the timer loops pause every trade and
 *   dispute (trades/timers.ts, disputes/timers.ts; owner G19, g62).
 * - `PUT /staff/v1/site/maintenance/planned { startsAt, endsAt, message? }` (owner G19: "we will
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

  app.get('/staff/v1/site', opts, async (req): Promise<SiteState> => readSiteState(req.server.deps.db));

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
        return readSiteState(c);
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
    const b = bodyOf(req, ['text', 'kind']);
    if (b.kind !== 'info' && b.kind !== 'warning') throw badRequest('kind');
    if (typeof b.text !== 'string') throw badRequest('text');
    const text = b.text.trim();
    if (text === '' || CONTROL.test(text)) throw badRequest('text');
    if (chars(text) > BANNER_MAX) throw new ApiError(400, 'banner-too-long', { max: BANNER_MAX });
    return tx(req, async (c) => {
      await c.query('update site_flags set banner_text = $1, banner_kind = $2', [text, b.kind]);
      await log(c, req, 'site.banner-set', { kind: b.kind });
      return readSiteState(c);
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
    const b = bodyOf(req, ['on', 'message', 'kind', 'backBy']);
    if (typeof b.on !== 'boolean') throw badRequest('on');
    const now = req.server.deps.clock();
    if (!b.on) {
      if (b.message !== undefined || b.kind !== undefined || b.backBy !== undefined) throw badRequest();
      return tx(req, async (c) => {
        const { rowCount } = await c.query(
          `update site_flags set maintenance_since = null, maintenance_message = null, maintenance_kind = null, maintenance_back_by = null
            where maintenance_since is not null`,
        );
        if (rowCount) await log(c, req, 'site.maintenance-off');
        return readSiteState(c);
      });
    }
    // Owner G19 (7 Nov): no default kind; the staff member says which (an emergency is internal).
    const kind = b.kind;
    if (!(MAINTENANCE_KINDS as readonly unknown[]).includes(kind)) throw badRequest('kind');
    const message = messageOf(b.message);
    let backBy: Date | null = null;
    if (b.backBy !== undefined && b.backBy !== null) backBy = futureTime(b.backBy, now, 'backBy');
    return tx(req, async (c) => {
      const { rows } = await c.query<{ was: boolean; planned_end: Date | null; planned_message: string | null }>(
        'select maintenance_since is not null as was, planned_end, planned_message from site_flags for update',
      );
      const plan = rows[0];
      // A planned switch-on takes up the announced plan and retires it; unplanned leaves it for later.
      const fromPlan = kind === 'planned' && plan !== undefined && plan.planned_end !== null;
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
      return readSiteState(c);
    });
  });

  app.put('/staff/v1/site/maintenance/planned', opts, async (req) => {
    const b = bodyOf(req, ['startsAt', 'endsAt', 'message']);
    const now = req.server.deps.clock();
    const startsAt = futureTime(b.startsAt, now, 'startsAt');
    const endsAt = futureTime(b.endsAt, startsAt, 'endsAt');
    const message = messageOf(b.message);
    return tx(req, async (c) => {
      await c.query('update site_flags set planned_start = $1, planned_end = $2, planned_message = $3', [startsAt, endsAt, message]);
      await log(c, req, 'site.maintenance-planned', { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() });
      return readSiteState(c);
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
