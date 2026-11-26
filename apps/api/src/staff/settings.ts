import { communityLink, moderatorContactLink, type KeyTapIntent } from '@x2f/staff';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { withTx } from '../auth/liveSession.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { appendLog } from '../log/append.js';
import { requireStaff, type StaffContext } from './guard.js';
import { consumeKeyTap } from './keyTap.js';
import { SETTINGS_DEFAULTS, type Settings } from './settingsDefaults.js';

/**
 * Plan 4 Task 8: the owner's settings (migration 206, table `settings`, one row). The large-trade
 * limit and the appeal window bind the moderation gate, so changing either needs a security-key
 * tap (intent `settings`); the first-reply time and the links do not. The plan's pay columns are
 * replaced by Task 33 (Revision 2026-10-29c) and are not here. The `Settings` shape and
 * `SETTINGS_DEFAULTS` live in `settingsDefaults.ts` (a leaf module, so `disputes/settings.ts` reads
 * them without this module's imports) and are re-exported here for the callers that had them.
 */
export { SETTINGS_DEFAULTS, type Settings };

type NumberField = 'largeTradeLimitUsd' | 'firstResponseH' | 'appealWindowH';
type LinkField = 'moderatorContactUrl' | 'communityMatrixUrl' | 'communityTelegramUrl';
type Field = NumberField | LinkField;

/** Whole-number bounds (Task 8), the same as migration 206's checks and `@x2f/staff`'s `checkHours`. */
const BOUNDS: Readonly<Record<NumberField, readonly [number, number]>> = {
  largeTradeLimitUsd: [1, 1_000_000],
  firstResponseH: [1, 72],
  appealWindowH: [12, 168],
};
const NUMBER_FIELDS = Object.keys(BOUNDS) as NumberField[];
const LINK_FIELDS: readonly LinkField[] = ['moderatorContactUrl', 'communityMatrixUrl', 'communityTelegramUrl'];
/** The fields whose change needs a tap: they bind the moderation gate. */
const TAPPED: readonly Field[] = ['largeTradeLimitUsd', 'appealWindowH'];

const COLUMN: Readonly<Record<Field, string>> = {
  largeTradeLimitUsd: 'large_trade_limit_usd',
  firstResponseH: 'first_response_h',
  appealWindowH: 'appeal_window_h',
  moderatorContactUrl: 'moderator_contact_url',
  communityMatrixUrl: 'community_matrix_url',
  communityTelegramUrl: 'community_telegram_url',
};

/**
 * D-067: the moderator contact link is a matrix.to or t.me link; the community links any https
 * link of at most 198 characters with no spaces (migration 206's check). Both checks are
 * `@x2f/staff`'s (ownerSettings.ts), so the owner's Settings page reads a link the same way;
 * `moderatorContactLink` answers the normalised link, which is what is stored (review F2).
 */
export { moderatorContactLink };

interface Row {
  large_trade_limit_usd: number;
  first_response_h: number;
  appeal_window_h: number;
  moderator_contact_url: string | null;
  community_matrix_url: string | null;
  community_telegram_url: string | null;
}

const SELECT = `select large_trade_limit_usd, first_response_h, appeal_window_h, moderator_contact_url,
                       community_matrix_url, community_telegram_url from settings where id = 1`;

function settingsOf(r: Row | undefined): Settings {
  if (!r) return { ...SETTINGS_DEFAULTS };
  return {
    largeTradeLimitUsd: r.large_trade_limit_usd,
    firstResponseH: r.first_response_h,
    appealWindowH: r.appeal_window_h,
    moderatorContactUrl: r.moderator_contact_url,
    communityMatrixUrl: r.community_matrix_url,
    communityTelegramUrl: r.community_telegram_url,
  };
}

/** The current settings (the defaults if the row is somehow missing). Used by the dispute routes (Task 10). */
export async function getSettings(db: Queryable): Promise<Settings> {
  const { rows } = await db.query<Row>(SELECT);
  return settingsOf(rows[0]);
}

const badRequest = (field?: string): ApiError => new ApiError(400, 'bad-request', field ? { field } : undefined);

/** The `PUT /staff/v1/settings` body: some of the fields (at least one) and an optional `tapId`. */
export function parseSettingsChange(body: unknown): { change: Partial<Settings>; tapId: unknown } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw badRequest();
  const { tapId, ...rest } = body as Record<string, unknown>;
  const change: Partial<Settings> = {};
  for (const [k, v] of Object.entries(rest)) {
    if ((NUMBER_FIELDS as string[]).includes(k)) {
      const [lo, hi] = BOUNDS[k as NumberField];
      if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) throw badRequest(k);
      change[k as NumberField] = v;
    } else if ((LINK_FIELDS as string[]).includes(k)) {
      if (v === null) {
        change[k as LinkField] = null;
        continue;
      }
      const link = typeof v === 'string' ? (k === 'moderatorContactUrl' ? moderatorContactLink(v) : communityLink(v)) : null;
      if (link === null) throw badRequest(k);
      change[k as LinkField] = link;
    } else {
      throw badRequest();
    }
  }
  if (Object.keys(change).length === 0) throw badRequest();
  if (tapId !== undefined && typeof tapId !== 'string') throw badRequest('tapId');
  return { change, tapId };
}

/** The tap intent for settings: the three gate-bound numbers as they will be after the change. */
export function settingsIntent(s: Pick<Settings, NumberField>): KeyTapIntent {
  return { kind: 'settings', largeTradeLimitUsd: s.largeTradeLimitUsd, firstResponseH: s.firstResponseH, appealWindowH: s.appealWindowH };
}

/**
 * Applies a settings change in `client`'s transaction for the staff member `actor`: locks the row,
 * compares field by field, consumes the tap when the limit or the appeal window changes (403
 * `tap-invalid` without a valid one), writes the row and appends one `settings.changed` per changed
 * field (`{ field, from, to }`; a link's values are not logged, only its field). Nothing changed →
 * no tap is needed and nothing is logged.
 */
export async function changeSettings(
  client: pg.PoolClient,
  actor: Pick<StaffContext, 'accountId' | 'role'>,
  input: { change: Partial<Settings>; tapId: unknown; sessionId?: string },
  now: Date,
): Promise<Settings> {
  const { rows } = await client.query<Row>(`${SELECT} for update`);
  if (!rows[0]) throw new Error('settings: the row of migration 206 is missing');
  const cur = settingsOf(rows[0]);
  const next: Settings = { ...cur, ...input.change };
  const changed = (Object.keys(input.change) as Field[]).filter((f) => next[f] !== cur[f]);
  if (changed.length === 0) return cur;

  let tapId: string | null = null;
  if (changed.some((f) => TAPPED.includes(f))) {
    // RV5 m10 (lead re-review item 7): the tap is used only from the session that started it.
    const tap = await consumeKeyTap(client, typeof input.tapId === 'string' ? input.tapId : '', actor.accountId, settingsIntent(next), now, input.sessionId !== undefined ? { sessionId: input.sessionId } : {});
    tapId = tap.id;
  }
  const sets = changed.map((f, i) => `${COLUMN[f]} = $${i + 1}`);
  const params: unknown[] = changed.map((f) => next[f]);
  params.push(now);
  sets.push(`updated_at = $${params.length}`);
  if (tapId !== null) {
    params.push(tapId);
    sets.push(`limits_tap_id = $${params.length}`);
  }
  await client.query(`update settings set ${sets.join(', ')} where id = 1`, params);
  for (const f of changed) {
    const detail = (LINK_FIELDS as readonly string[]).includes(f) ? { field: f } : { field: f, from: cur[f], to: next[f] };
    await appendLog(client, { at: now, actor: { kind: 'staff', id: actor.accountId, role: actor.role }, tradeCode: null, action: 'settings.changed', detail });
  }
  return next;
}

/**
 * `GET /staff/v1/settings` and `PUT /staff/v1/settings` (perm `settings.write`, the owner). The PUT
 * takes any of `largeTradeLimitUsd` (1–1,000,000), `firstResponseH` (1–72), `appealWindowH`
 * (12–168), `moderatorContactUrl`, `communityMatrixUrl`, `communityTelegramUrl` (https or null),
 * and `tapId` (required when the limit or the appeal window changes) → the settings after it.
 */
export function staffSettingsRoutes(app: FastifyInstance): void {
  const perm = 'settings.write' as const;
  const opts = { config: { perm }, preHandler: requireStaff(perm) };
  app.get('/staff/v1/settings', opts, async (req) => getSettings(req.server.deps.db));
  app.put('/staff/v1/settings', opts, async (req) => {
    const input = parseSettingsChange(req.body);
    const { db, clock } = req.server.deps;
    return withTx(db, (c) => changeSettings(c, req.staff, { ...input, sessionId: req.auth.sessionId }, clock()));
  });
}
