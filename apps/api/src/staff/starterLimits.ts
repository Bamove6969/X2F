import { STARTER_FIELDS, starterLimitsProblem, type KeyTapIntent, type StarterSettings } from '@x2f/staff';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { withTx } from '../auth/liveSession.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { appendLog } from '../log/append.js';
import { loadStarterSettings, STARTER_SETTING_KEYS } from '../traders/stage.js';
import { requireStaff, type StaffContext } from './guard.js';
import { consumeKeyTap } from './keyTap.js';

/**
 * Spec 6.6 "Settings" and 2.3 (owner 2026-10-24: "The owner can change every number in Settings;
 * changes are logged"): the starter limits on the staff API. They live where Plan 3 put them, as
 * rows of `owner_settings` (migration 109, one whole number per key; a missing row is the
 * default), so no migration is needed.
 *
 * As the pay settings: the PUT names every number (`@x2f/staff`'s STARTER_FIELDS) and a tap
 * `starter-limits` bound to exactly them, since they decide how big a trade a new account can be
 * part of (a stolen owner session without the key must not raise them). Each changed number appends
 * one `settings.changed` `{ field, from, to }`. Nothing changed: no tap is needed, nothing is logged.
 *
 * - `GET /staff/v1/starter-limits` → `{ ...StarterSettings, updatedAt }` (`updatedAt`: the latest
 *   saved row's time, null while every number is the default).
 * - `PUT /staff/v1/starter-limits { ...StarterSettings, tapId }` → the same view after it. 400
 *   `bad-request` (with `field`) for a number out of bounds or stages out of order
 *   (`starterLimitsProblem`), 403 `tap-invalid` without a valid tap.
 * Perm `settings.write` (the owner).
 */

export interface StarterLimitsView extends StarterSettings {
  updatedAt: string | null;
}

const KEYS = STARTER_FIELDS.map((f) => STARTER_SETTING_KEYS[f]);

async function viewOf(q: Queryable): Promise<StarterLimitsView> {
  const s = await loadStarterSettings(q);
  const { rows } = await q.query<{ at: Date | null }>('select max(updated_at) as at from owner_settings where key = any($1)', [KEYS]);
  return { ...s, updatedAt: rows[0]?.at?.toISOString() ?? null };
}

const badRequest = (field?: string): ApiError => new ApiError(400, 'bad-request', field ? { field } : undefined);

/** The PUT body: every starter-limit number (whole, in bounds, the stages in order) and the `tapId`. */
export function parseStarterLimits(body: unknown): { next: StarterSettings; tapId: string } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw badRequest();
  const r = body as Record<string, unknown>;
  const keys = Object.keys(r).sort();
  if (keys.join(',') !== [...STARTER_FIELDS, 'tapId'].sort().join(',')) throw badRequest();
  const next = {} as StarterSettings;
  for (const f of STARTER_FIELDS) {
    const v = r[f];
    if (typeof v !== 'number') throw badRequest(f);
    next[f] = v;
  }
  const problem = starterLimitsProblem(next);
  if (problem !== null) throw badRequest(problem.field);
  if (typeof r.tapId !== 'string') throw badRequest('tapId');
  return { next, tapId: r.tapId };
}

export function starterLimitsIntent(s: StarterSettings): KeyTapIntent {
  const out: Record<string, unknown> = { kind: 'starter-limits' };
  for (const f of STARTER_FIELDS) out[f] = s[f];
  return out as KeyTapIntent;
}

/**
 * Saves the starter limits for the owner in `client`'s transaction: the settings row is locked as
 * the owner's settings mutex (the `owner_settings` rows may not exist yet), the tap consumed for any
 * change, the changed rows upserted and each change logged.
 */
export async function changeStarterLimits(
  client: pg.PoolClient,
  actor: Pick<StaffContext, 'accountId' | 'role'>,
  input: { next: StarterSettings; tapId: string; sessionId?: string },
  now: Date,
): Promise<void> {
  await client.query('select 1 from settings where id = 1 for update');
  const cur = await loadStarterSettings(client);
  const changed = STARTER_FIELDS.filter((f) => cur[f] !== input.next[f]);
  if (changed.length === 0) return;
  await consumeKeyTap(client, input.tapId, actor.accountId, starterLimitsIntent(input.next), now, input.sessionId !== undefined ? { sessionId: input.sessionId } : {});
  for (const f of changed) {
    await client.query(
      `insert into owner_settings (key, value, updated_at) values ($1, $2, $3)
         on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at`,
      [STARTER_SETTING_KEYS[f], input.next[f], now],
    );
  }
  for (const f of changed) {
    await appendLog(client, { at: now, actor: { kind: 'staff', id: actor.accountId, role: actor.role }, tradeCode: null, action: 'settings.changed', detail: { field: f, from: cur[f], to: input.next[f] } });
  }
}

export function staffStarterLimitRoutes(app: FastifyInstance): void {
  const perm = 'settings.write' as const;
  const opts = { config: { perm }, preHandler: requireStaff(perm) };
  app.get('/staff/v1/starter-limits', opts, async (req) => viewOf(req.server.deps.db));
  app.put('/staff/v1/starter-limits', opts, async (req) => {
    const input = parseStarterLimits(req.body);
    const { db, clock } = req.server.deps;
    await withTx(db, (c) => changeStarterLimits(c, req.staff, { ...input, sessionId: req.auth.sessionId }, clock()));
    return viewOf(db);
  });
}
