import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { withTx } from '../auth/hold.js';
import { ApiError } from '../errors.js';
import { appendLog } from '../log/append.js';
import type { LogAction } from '../log/actions.js';
import { readSiteState, type SiteState } from '../site/routes.js';
import { requireStaff } from './guard.js';
import { consumeKeyTap } from './keyTap.js';

/** The banner's limit (Task 8; migration 206 checks the same, in characters). */
export const BANNER_MAX = 140;
/** The maintenance message's limit (a builder bound; migration 206 checks the same). */
export const MAINTENANCE_MESSAGE_MAX = 500;
export const MAINTENANCE_KINDS = ['planned', 'emergency'] as const;
export type MaintenanceKind = (typeof MAINTENANCE_KINDS)[number];

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

/**
 * Plan 4 Task 8, the site controls (perm `site.control`, the owner), each change logged in its own
 * transaction (the log entry last):
 * - `GET /staff/v1/site` → the full state (the staff Settings page; builder addition).
 * - `POST /staff/v1/site/stop { tapId }` (tap intent `emergency-stop`): `trading_paused` on and
 *   `stopped_at`. Plan 3 then refuses new offers and takes with `trading-paused`; existing trades go on.
 * - `POST /staff/v1/site/resume { tapId }` (tap intent `resume-trading`).
 * - `PUT /staff/v1/site/banner { text, kind: 'info' | 'warning' }`: over 140 characters → 400
 *   `banner-too-long`; `DELETE /staff/v1/site/banner` → 204.
 * - `PUT /staff/v1/site/maintenance { on, message?, kind? }`: on sets `maintenance_since` (kept if
 *   already on, so the timers shift by the whole maintenance), the message and the kind
 *   (`planned` | `emergency`, required: owner G19, no default); off clears all three. The trader API answers 503
 *   `maintenance` meanwhile (site/routes.ts). Nothing pauses the trade timers yet (lead review 7 Nov:
 *   `timerEvents` has no caller; the loop is on held work): the owner decides on the timer loop.
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
    const b = bodyOf(req, ['on', 'message', 'kind']);
    if (typeof b.on !== 'boolean') throw badRequest('on');
    const now = req.server.deps.clock();
    if (!b.on) {
      if (b.message !== undefined || b.kind !== undefined) throw badRequest();
      return tx(req, async (c) => {
        const { rowCount } = await c.query(
          'update site_flags set maintenance_since = null, maintenance_message = null, maintenance_kind = null where maintenance_since is not null',
        );
        if (rowCount) await log(c, req, 'site.maintenance-off');
        return readSiteState(c);
      });
    }
    // Owner G19 (7 Nov): no default kind; the staff member says which (an emergency is internal).
    const kind = b.kind;
    if (!(MAINTENANCE_KINDS as readonly unknown[]).includes(kind)) throw badRequest('kind');
    let message: string | null = null;
    if (b.message !== undefined && b.message !== null) {
      if (typeof b.message !== 'string') throw badRequest('message');
      const m = b.message.trim();
      if (chars(m) > MAINTENANCE_MESSAGE_MAX || CONTROL_BUT_NEWLINE.test(m)) throw badRequest('message');
      message = m === '' ? null : m;
    }
    return tx(req, async (c) => {
      const { rows } = await c.query<{ was: boolean }>('select maintenance_since is not null as was from site_flags for update');
      await c.query(
        'update site_flags set maintenance_since = coalesce(maintenance_since, $1), maintenance_message = $2, maintenance_kind = $3',
        [now, message, kind],
      );
      if (rows[0]?.was !== true) await log(c, req, 'site.maintenance-on', { kind });
      return readSiteState(c);
    });
  });
}
