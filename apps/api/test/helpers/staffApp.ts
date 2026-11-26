import { createHash, randomBytes } from 'node:crypto';
import { canonicalJson, stampIssuedAt, type KeyTapIntent, type LoginHours, type StaffRole } from '@x2f/staff';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { Deps } from '../../src/app.js';
import { SESSION_COOKIE, STAFF_SESSION_COOKIE } from '../../src/auth/sessions.js';
import { buildStaffApi, type ModerationClient } from '../../src/staff/app.js';
import type { PushTransport } from '../../src/push/send.js';
import { NO_MODERATION } from '../../src/disputes/moderationClient.js';
import type { TradePublisher } from '../../src/trades/store.js';
import { seedAccount } from './accounts.js';
import { testApp } from './app.js';
import { captureLogs } from './logs.js';

export const STAFF_ORIGIN = 'https://staff.x2f.test';
export const TRADER_ORIGIN = 'https://x2f.test';
/** No moderation process: every chat or proof call answers `moderation-unavailable`. */
export const MODERATION_STUB: ModerationClient = NO_MODERATION;

/** The trader API and the staff API on one database and one clock; `overrides` go to `testApp`. */
export async function staffApps(
  overrides: Partial<Deps> = {},
  staffOptions: { pushTransport?: PushTransport; webRoot?: string } = {},
  staffDeps: { tradePublish?: TradePublisher } = {},
): Promise<{
  app: FastifyInstance;
  trader: FastifyInstance;
  deps: Deps;
  setNow(d: Date): void;
  logs: string[];
  close(): Promise<void>;
}> {
  const t = await testApp(overrides);
  const { stream, logs } = captureLogs();
  const { webRoot, ...options } = staffOptions;
  const app = await buildStaffApi(
    // The trader app's bus, as main.ts passes it (a site ban ends the trader's streams, review S2).
    { ...t.deps, staffOrigin: STAFF_ORIGIN, moderation: MODERATION_STUB, traderEvents: t.app.events, ...(webRoot !== undefined ? { staffWebRoot: webRoot } : {}), ...staffDeps },
    { logStream: stream, ...options },
  );
  return {
    app, trader: t.app, deps: t.deps, setNow: t.setNow, logs,
    async close() {
      await app.close();
      await t.app.close();
    },
  };
}

let seq = 0;
export const uniqueName = (prefix: string): string => `${prefix}${++seq}${randomBytes(3).toString('hex')}`;

/** A staff (or owner) account with its `staff_members` row. */
export async function seedStaff(
  deps: Deps,
  o: { role: StaffRole; hours?: LoginHours; switchedOff?: boolean; loginName?: string; grants?: string[] },
): Promise<{ id: string; loginName: string }> {
  const loginName = o.loginName ?? uniqueName(o.role);
  const id = await seedAccount(deps, { loginName, kind: o.role === 'owner' ? 'owner' : 'staff' });
  await deps.db.query(
    `insert into staff_members (account_id, role, hours, grants, has_security_key, switched_off_at, joined_at)
     values ($1, $2, $3, $4, true, $5, $6)`,
    [id, o.role, JSON.stringify(o.role === 'owner' ? 'any' : (o.hours ?? 'any')), o.grants ?? [], o.switchedOff ? deps.clock() : null, deps.clock()],
  );
  return { id, loginName };
}

/** A live session row for the account in `app` ('staff' or 'trader'); returns its cookie token. */
export async function insertSession(deps: Deps, accountId: string, app: 'staff' | 'trader'): Promise<{ token: string; sessionId: string }> {
  const token = randomBytes(32).toString('base64url');
  const now = deps.clock();
  const { rows } = await deps.db.query<{ id: string }>(
    `insert into sessions (account_id, token_hash, level, device_label, created_at, last_seen_at, expires_at, app)
     values ($1, $2, 'full', 'Test', $3, $3, $4, $5) returning id`,
    [accountId, createHash('sha256').update(token).digest(), now, new Date(now.getTime() + 2 * 3600_000), app],
  );
  return { token, sessionId: rows[0]!.id };
}

/** One browser on the staff origin: keeps the cookies the staff API sets. */
export class StaffBrowser {
  cookies: Record<string, string> = {};
  constructor(
    private readonly app: FastifyInstance,
    private readonly origin = STAFF_ORIGIN,
  ) {}
  withSession(token: string): this {
    this.cookies[STAFF_SESSION_COOKIE] = token;
    return this;
  }
  async send(method: string, url: string, payload?: unknown): Promise<LightMyRequestResponse> {
    const res = await this.app.inject({
      method: method as 'GET', url, headers: { origin: this.origin }, cookies: this.cookies,
      ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
    });
    for (const c of res.cookies) this.cookies[c.name] = c.value;
    return res;
  }
  post(url: string, payload: unknown = {}): Promise<LightMyRequestResponse> {
    return this.send('POST', url, payload);
  }
  get(url: string): Promise<LightMyRequestResponse> {
    return this.send('GET', url);
  }
}

export { SESSION_COOKIE, STAFF_SESSION_COOKIE };

export const errorOf = (res: LightMyRequestResponse): string | undefined => (res.json() as { error?: string }).error;

/** The activity-log entries with this action, oldest first. */
export async function logEntries(deps: Deps, action: string): Promise<Array<{ actor_kind: string; detail: string }>> {
  const { rows } = await deps.db.query<{ actor_kind: string; detail: string }>(
    'select actor_kind, detail from activity_log where action = $1 order by id',
    [action],
  );
  return rows;
}

/**
 * Plan 4 Task 8: a finished (answered, unused) key tap for `intent`, inserted directly. The tapped
 * routes only `consumeKeyTap` it; Task 5's own tests cover starting and finishing a real one.
 */
export async function seedTap(deps: Deps, accountId: string, intent: KeyTapIntent, startedAt = deps.clock()): Promise<string> {
  // The answering key is registered to the account, as a real finish needs (consume re-checks it, RV5 m9).
  const credentialId = randomBytes(16);
  await deps.db.query(
    `insert into webauthn_credentials (account_id, credential_id, public_key, counter, kind, backed_up, device_type, attested, aaguid, label, created_at)
     values ($1, $2, $3, 0, 'security-key', false, 'singleDevice', true, null, 'tap', $4)`,
    [accountId, credentialId, randomBytes(77), startedAt],
  );
  const { rows } = await deps.db.query<{ id: string }>(
    `insert into key_taps (account_id, credential_id, intent, nonce, response, started_at, finished_at)
     values ($1, $2, $3, $4, $5, $6, $6) returning id`,
    // As `startKeyTap` stores it: an owner registry kind carries its start time (lead P4 call).
    [accountId, credentialId.toString('base64url'), canonicalJson(stampIssuedAt(intent, startedAt)), randomBytes(16), JSON.stringify({ id: 'test' }), startedAt],
  );
  return rows[0]!.id;
}
