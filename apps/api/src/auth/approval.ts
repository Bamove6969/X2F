/**
 * New-device approval, number matching and the device limit (Plan 2 Task 16; owner + design,
 * 2026-10-29b). Traders only (lead default): staff and owner logins already need two factors.
 *
 * - **When a login waits.** A trader login whose credentials passed (PGP, passkey, security key, or
 *   or a recovery code's full session never: that is `recovery.ts`) starts no session when the account already has an
 *   open full session on another device and either this browser is not trusted for the account
 *   (`isTrusted`) or the account is at its device limit (`max_devices`, default 3; 1 with "One
 *   device at a time"). Instead it gets `{ status: 'approve-on-device', approvalId, number,
 *   expiresAt }` (nothing about the account's devices: review M5). A browser already holding a live full session of the account, or an
 *   account with no open full session, logs in as before (the no-device case is OPEN: Revision
 *   2026-10-29b; until decided it works as today).
 * - **Binding.** The approval is bound to the new browser twice: its device-cookie hash and a fresh
 *   32-byte approval cookie (`__Host-x2f_approval`, HttpOnly) whose SHA-256 is stored. The poll
 *   needs both; anything else is 404 `not-found`, the same as an unknown id.
 * - **Number matching.** `number` (10-99) and two other distinct numbers, shuffled, come from
 *   `crypto.randomInt` (through `approvalRandom`, the test seam). The new device shows `number`; the
 *   logged-in device is offered the three (`choices`), never told which is right. The right one
 *   approves; a wrong one blocks (a random tap has 1/3 odds and one try), as does "No, block it".
 * - **Expiry and limits.** An approval is open for `APPROVAL_TTL_MS` (5 minutes, the plan's lead
 *   default), and an approved one must start its session within another 5 minutes. A new approval from the same browser
 *   supersedes that browser's open one; at most `MAX_OPEN_APPROVALS` are open per account (the
 *   oldest expires); at most `APPROVALS_PER_HOUR` start per account per hour (then 429 `slow-down`).
 *   Every check-and-write is serialised per account by an advisory lock.
 * - **What the logged-in device learns.** The live event and the push carry no secret and no detail
 *   (`{ type: 'login-approval', id }`; the push is the fixed "Someone is logging in. Is this you?").
 *   The approval shows only a coarse device label ("Browser on Linux"; never digits, never the
 *   client's free text, never an IP address or a login name), the choices and the times.
 * - **Deciding** needs a full trader session of the same account on
 *   another browser. At the device limit an approval must name a session to log out (`logOut`),
 *   else 409 `too-many-devices` with the session list; with "One device at a time" on, every other
 *   session ends instead. The sessions end when the new device's session starts (the poll), so an
 *   approval the new device never collects logs nobody out.
 * - **Activity log** (the account's alerts): `login-approval` when one starts, `login-blocked` when
 *   blocked or a wrong number was tapped, `new-login` when the session starts (startSession), and
 *   `logged-out-by-new-device` listing what the new login ended.
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { Deps } from '../app.js';
import { addAlert } from '../alerts.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { COOKIE_ATTRS, deviceHash, ensureDeviceCookie, isTrusted } from './device.js';
import {
  lockAccount, requireLiveSessionInTx,
} from './liveSession.js';
import { assertNotDisabled, cleanLabel, openSession, presentedTokenHash, requireSession } from './sessions.js';

/** How long the new device waits for a decision, and how long an approved login may take to collect its session. */
export const APPROVAL_TTL_MS = 5 * 60_000;
/** Open approvals per account; a new one beyond this expires the oldest. */
export const MAX_OPEN_APPROVALS = 3;
/** Approvals one account may start per rolling hour (approval spam). */
export const APPROVALS_PER_HOUR = 10;
/** Full trader sessions an account may hold at once unless the owner's `max_devices` says otherwise. */
export const DEFAULT_MAX_DEVICES = 3;
export const APPROVAL_COOKIE = '__Host-x2f_approval';

/** The trader login methods that can wait for approval. */
export type ApprovalMethod = 'pgp' | 'passkey' | 'security-key';

export type ApprovalWait = { status: 'approve-on-device'; approvalId: string; number: number; expiresAt: string };

/** The test seam for the "no patterns" rule (spec 6.2): every number comes from `crypto.randomInt`. */
export const approvalRandom = { int: (min: number, max: number): number => randomInt(min, max) };

/** The right number (10-99) and the three choices: it plus two other distinct numbers, shuffled. */
export function drawNumbers(): { number: number; choices: number[] } {
  const number = approvalRandom.int(10, 100);
  const set = new Set([number]);
  while (set.size < 3) set.add(approvalRandom.int(10, 100));
  const choices = [...set];
  for (let i = choices.length - 1; i > 0; i--) {
    const j = approvalRandom.int(0, i + 1);
    [choices[i], choices[j]] = [choices[j]!, choices[i]!];
  }
  return { number, choices };
}

const BROWSERS: ReadonlyArray<[RegExp, string]> = [
  [/\btor\b/i, 'Tor Browser'],
  [/\bfirefox\b/i, 'Firefox'],
  [/\bedge\b/i, 'Edge'],
  [/\bbrave\b/i, 'Brave'],
  [/\bopera\b/i, 'Opera'],
  [/\bvivaldi\b/i, 'Vivaldi'],
  // "Chrome OS" names a system, not the browser.
  [/\bchrom(e|ium)\b(?!\s?os\b)/i, 'Chrome'],
  [/\bsafari\b/i, 'Safari'],
  [/\bx2f app\b/i, 'X2F app'],
];
const SYSTEMS: ReadonlyArray<[RegExp, string]> = [
  [/\bwindows\b/i, 'Windows'],
  [/\bmac ?os\b|\bmacintosh\b/i, 'macOS'],
  [/\bchrome ?os\b/i, 'ChromeOS'],
  [/\bandroid\b/i, 'Android'],
  [/\bios\b|\biphone\b|\bipad\b/i, 'iOS'],
  [/\blinux\b/i, 'Linux'],
];

/**
 * What the approving device is told about the new one: a browser and a system from fixed lists
 * ("Firefox on Linux", "Browser on Android"), or "A new device". The client chooses its label, so
 * nothing of its own text is shown: a label saying "tap 47" must not reach the approval screen.
 */
export function coarseDeviceLabel(label: string): string {
  const b = BROWSERS.find(([re]) => re.test(label))?.[1];
  const system = SYSTEMS.find(([re]) => re.test(label))?.[1];
  if (b !== undefined && system !== undefined) return `${b} on ${system}`;
  if (b !== undefined) return b;
  if (system !== undefined) return `Browser on ${system}`;
  return 'A new device';
}

/** The owner's `max_devices` setting (1-10); a missing or out-of-range row means `DEFAULT_MAX_DEVICES`. */
export async function maxDevices(db: Queryable): Promise<number> {
  const { rows } = await db.query<{ value: string }>("select value from owner_settings where key = 'max_devices'");
  const v = rows[0] === undefined ? NaN : Number(rows[0].value);
  return Number.isInteger(v) && v >= 1 && v <= 10 ? v : DEFAULT_MAX_DEVICES;
}

const sha256 = (s: string): Buffer => createHash('sha256').update(s).digest();
const lockApprovals = (db: Queryable, accountId: string) =>
  db.query("select pg_advisory_xact_lock(hashtextextended('x2f-approval/' || $1, 0))", [accountId]);

/** Open full sessions of the account plus approved logins not yet collected (they become sessions). */
async function devicesInUse(db: Queryable, accountId: string, now: Date, exceptTokenHash: Buffer | null): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `select (select count(*)::int from sessions
              where account_id = $1 and level = 'full' and revoked_at is null and expires_at > $2
                and token_hash is distinct from $3)
          + (select count(*)::int from login_approvals
              where account_id = $1 and outcome = 'approved' and used_at is null and expires_at > $2) as n`,
    [accountId, now, exceptTokenHash],
  );
  return rows[0]!.n;
}

/**
 * Inside a login's transaction: logs out the fewest sessions so that one more fits within `max`
 * (review round 2 N-C1). Approved logins not yet collected go first (they count as devices), then
 * full sessions, least recently seen first; this browser's own session is left to `openSession`. Alert
 * `logged-out-by-new-device` lists what ended. Returns the ended session ids.
 */
async function makeRoom(db: Queryable, accountId: string, now: Date, exceptTokenHash: Buffer | null, max: number): Promise<string[]> {
  if ((await devicesInUse(db, accountId, now, exceptTokenHash)) < max) return [];
  await db.query(
    `update login_approvals set outcome = 'expired' where account_id = $1 and outcome = 'approved' and used_at is null and expires_at > $2`,
    [accountId, now],
  );
  const excess = (await devicesInUse(db, accountId, now, exceptTokenHash)) - max + 1;
  if (excess <= 0) return [];
  const { rows } = await db.query<{ id: string; device_label: string }>(
    `update sessions set revoked_at = $2 where id in (
       select id from sessions
        where account_id = $1 and level = 'full' and revoked_at is null and expires_at > $2
          and token_hash is distinct from $3
        order by last_seen_at, id
        limit $4)
     returning id, device_label`,
    [accountId, now, exceptTokenHash, excess],
  );
  const labels = rows.map((r) => r.device_label);
  if (labels.length > 0) await addAlert(db, accountId, 'logged-out-by-new-device', { deviceLabels: labels, count: labels.length }, now);
  return rows.map((r) => r.id);
}

async function withTx<T>(deps: Pick<Deps, 'db'>, fn: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await deps.db.connect();
  try {
    await client.query('begin');
    try {
      const out = await fn(client);
      await client.query('commit');
      return out;
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
  } finally {
    client.release();
  }
}

/**
 * The end of every trader login whose credentials passed (`completeLogin`'s trader branch): either
 * a full session now (`{ status: 'ok' }`) or an approval to wait for (see the module comment).
 * Staff and owner accounts never get here. All in one transaction with the account locked. With
 * nothing logged in to approve it, a login goes in (every trader login is a passkey, security key
 * or PGP key now: owner, 26 Nov 2026).
 */
export async function traderLogin(
  deps: Deps,
  req: FastifyRequest,
  reply: FastifyReply,
  a: { accountId: string; method: ApprovalMethod; deviceLabel: string },
): Promise<{ status: 'ok' } | ApprovalWait> {
  ensureDeviceCookie(req, reply);
  const device = deviceHash(req)!;
  const now = deps.clock();
  // Matched on token_hash only, never prev_token_hash (S-m1): a login sent with the token before an extend, in its short window, is not "this browser's own session".
  const presented = presentedTokenHash(req);
  const secret = randomBytes(32).toString('base64url');

  // `refused`: the login is refused once the transaction's own work is committed.
  type Outcome = { kind: 'session'; after: () => void } | { kind: 'wait'; wait: ApprovalWait } | { kind: 'refused'; error: ApiError };
  const out = await withTx(deps, async (db): Promise<Outcome> => {
    await lockApprovals(db, a.accountId);
    await lockAccount(db, a.accountId);
    /** `max`: log sessions out until this one fits within it. */
    const session = async (max?: number): Promise<Outcome> => {
      const ended = max !== undefined ? await makeRoom(db, a.accountId, now, presented, max) : [];
      const s = await openSession(db, deps, req, reply, { accountId: a.accountId, level: 'full', deviceLabel: a.deviceLabel, method: a.method, firstSession: false });
      return {
        kind: 'session',
        after: () => {
          s.after();
          for (const id of ended) req.server.events.closeSession(a.accountId, id);
        },
      };
    };
    const acct = await db.query<{ kind: string; one_device: boolean }>('select kind, one_device from accounts where id = $1', [a.accountId]);
    const row = acct.rows[0];
    if (!row || row.kind !== 'trader') return session();
    // This browser already holds a live full session of the account: it is a logged-in device (a
    // team member's session is not: Task 18, it never approves the owner's logins, its own included).
    if (presented !== null) {
      const own = await db.query(
        `select 1 from sessions where account_id = $1 and token_hash = $2 and level = 'full' and revoked_at is null and expires_at > $3
            and member_id is null`,
        [a.accountId, presented, now],
      );
      if (own.rows.length > 0) return session();
    }
    const max = row.one_device ? 1 : await maxDevices(db);
    // Plan 2 Task 18: a team member's session is no logged-in device here: it never answers an
    // approval (the approval routes are the account owner's), so the owner's login never waits for
    // one. Member sessions still count toward the device limit (`devicesInUse`).
    const open = await db.query<{ n: number }>(
      `select count(*)::int as n
         from sessions where account_id = $1 and level = 'full' and revoked_at is null and expires_at > $2 and member_id is null`,
      [a.accountId, now],
    );
    // No logged-in device to approve it: the login goes in, the least recently seen sessions making
    // room at the device limit.
    if (open.rows[0]!.n === 0) return session(max);
    const inUse = await devicesInUse(db, a.accountId, now, presented);
    const trusted = await isTrusted(deps, a.accountId, device);
    if (trusted && inUse < max) return session();

    const hourAgo = new Date(now.getTime() - 3_600_000);
    const recent = await db.query<{ n: number; oldest: Date | null }>(
      'select count(*)::int as n, min(created_at) as oldest from login_approvals where account_id = $1 and created_at > $2',
      [a.accountId, hourAgo],
    );
    if (recent.rows[0]!.n >= APPROVALS_PER_HOUR) {
      const oldest = recent.rows[0]!.oldest ?? now;
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest.getTime() + 3_600_000 - now.getTime()) / 1000));
      return { kind: 'refused', error: new ApiError(429, 'slow-down', { retryAfterSeconds, reason: 'approvals' }) };
    }
    // This browser's earlier open approval is superseded (its approval cookie is replaced below).
    await db.query(
      `update login_approvals set outcome = 'expired', decided_at = $3
        where account_id = $1 and device_hash = $2 and outcome is null`,
      [a.accountId, device, now],
    );
    await db.query(
      `update login_approvals set outcome = 'expired', decided_at = $2
        where id in (select id from login_approvals where account_id = $1 and outcome is null and expires_at > $2
                      order by created_at desc, id desc offset $3)`,
      [a.accountId, now, MAX_OPEN_APPROVALS - 1],
    );
    const { number, choices } = drawNumbers();
    const deviceLabel = coarseDeviceLabel(a.deviceLabel);
    const expiresAt = new Date(now.getTime() + APPROVAL_TTL_MS);
    const ins = await db.query<{ id: string }>(
      `insert into login_approvals (account_id, device_hash, secret_hash, device_label, session_label, method, number, choices, created_at, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
      [a.accountId, device, sha256(secret), deviceLabel, cleanLabel(a.deviceLabel), a.method, number, choices, now, expiresAt],
    );
    const approvalId = ins.rows[0]!.id;
    await addAlert(db, a.accountId, 'login-approval', { approvalId, deviceLabel, method: a.method }, now);
    // Review M5: nothing about the account's devices goes to a device nobody has approved yet.
    return { kind: 'wait', wait: { status: 'approve-on-device', approvalId, number, expiresAt: expiresAt.toISOString() } };
  });

  if (out.kind === 'refused') throw out.error;
  if (out.kind === 'session') {
    out.after();
    return { status: 'ok' };
  }
  void reply.setCookie(APPROVAL_COOKIE, secret, { ...COOKIE_ATTRS, maxAge: Math.ceil((2 * APPROVAL_TTL_MS) / 1000) });
  // Hints only, after commit: the logged-in devices fetch the approval over their own session.
  req.server.events.publish(a.accountId, { type: 'login-approval', id: out.wait.approvalId });
  void req.server.push.send(a.accountId, 'login').catch(() => undefined);
  return out.wait;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET = /^[A-Za-z0-9_-]{43}$/;

function idParam(req: FastifyRequest): string {
  const id = (req.params as { id?: unknown }).id;
  if (typeof id !== 'string' || !UUID.test(id)) throw new ApiError(404, 'not-found');
  return id.toLowerCase();
}

interface ApprovalRow {
  id: string;
  account_id: string;
  device_hash: Buffer;
  secret_hash: Buffer;
  device_label: string;
  session_label: string;
  method: ApprovalMethod;
  number: number;
  choices: number[];
  created_at: Date;
  expires_at: Date;
  outcome: 'approved' | 'blocked' | 'expired' | null;
  ends: 'one-device' | 'session' | null;
  end_session: string | null;
  used_at: Date | null;
}

/**
 * The new device's own approval: this id, this browser's device cookie and its approval cookie,
 * else 404 `not-found` (an unknown id, another browser and a missing cookie all read the same).
 */
async function ownApproval(deps: Deps, req: FastifyRequest): Promise<ApprovalRow> {
  const id = idParam(req);
  const device = deviceHash(req);
  const raw = req.cookies?.[APPROVAL_COOKIE];
  if (device === null || typeof raw !== 'string' || !SECRET.test(raw)) throw new ApiError(404, 'not-found');
  const { rows } = await deps.db.query<ApprovalRow>('select * from login_approvals where id = $1 and device_hash = $2', [id, device]);
  const row = rows[0];
  if (!row || !timingSafeEqual(row.secret_hash, sha256(raw))) throw new ApiError(404, 'not-found');
  return row;
}

type PollResult = { status: 'waiting'; expiresAt: string } | { status: 'ok'; loggedOut: string[] } | { status: 'blocked' } | { status: 'expired' };

async function poll(req: FastifyRequest, reply: FastifyReply): Promise<PollResult> {
  const deps = req.server.deps;
  const row = await ownApproval(deps, req);
  const now = deps.clock();
  const clear = () => void reply.clearCookie(APPROVAL_COOKIE, COOKIE_ATTRS);
  if (row.outcome === null) {
    if (now.getTime() < row.expires_at.getTime()) return { status: 'waiting', expiresAt: row.expires_at.toISOString() };
    await deps.db.query(`update login_approvals set outcome = 'expired', decided_at = $2 where id = $1 and outcome is null`, [row.id, now]);
    clear();
    return { status: 'expired' };
  }
  if (row.outcome === 'blocked') {
    clear();
    return { status: 'blocked' };
  }
  if (row.outcome === 'expired') {
    clear();
    return { status: 'expired' };
  }
  // Approved: collected once, before its deadline, in one transaction with the session and the
  // logouts the approval asked for (review M7). Review round 3 R3-M1: under the same locks as a
  // login (so it runs wholly before or after a recovery-code login, which expires every approval).
  const done = await withTx(deps, async (db) => {
    await lockApprovals(db, row.account_id);
    await lockAccount(db, row.account_id);
    // Review round 4 R4-M2: an approval dies with the session that granted it (logged out, ended by
    // a method removal or a recovery-code login, or expired): `decided_by` must still be live.
    const claimed = await db.query<ApprovalRow>(
      `update login_approvals l set used_at = $2
        where l.id = $1 and l.outcome = 'approved' and l.used_at is null and l.expires_at > $2
          and exists (select 1 from sessions s where s.id = l.decided_by and s.revoked_at is null and s.expires_at > $2)
        returning l.*`,
      [row.id, now],
    );
    const won = claimed.rows[0];
    if (!won) return null;
    await assertNotDisabled(db, won.account_id);
    const s = await openSession(db, deps, req, reply, {
      accountId: won.account_id, level: 'full', deviceLabel: won.session_label, method: won.method, firstSession: false,
    });
    const ended = await endForNewDevice(db, now, won, s.sessionId);
    return { s, ended, accountId: won.account_id };
  });
  clear();
  if (done === null) return { status: 'expired' };
  done.s.after();
  for (const id of done.ended.ids) req.server.events.closeSession(done.accountId, id);
  return { status: 'ok', loggedOut: done.ended.labels };
}

/** Ends what the approval said (every other session, or the one chosen at the limit), in the caller's transaction; returns their ids and labels. */
async function endForNewDevice(db: Queryable, now: Date, a: ApprovalRow, sessionId: string): Promise<{ ids: string[]; labels: string[] }> {
  let ended: Array<{ id: string; device_label: string }> = [];
  if (a.ends === 'one-device') {
    ended = (await db.query<{ id: string; device_label: string }>(
      `update sessions set revoked_at = $3 where account_id = $1 and id <> $2 and revoked_at is null returning id, device_label`,
      [a.account_id, sessionId, now],
    )).rows;
  } else if (a.ends === 'session' && a.end_session !== null) {
    ended = (await db.query<{ id: string; device_label: string }>(
      `update sessions set revoked_at = $3 where id = $1 and account_id = $2 and revoked_at is null returning id, device_label`,
      [a.end_session, a.account_id, now],
    )).rows;
  }
  // Only live sessions are listed (an expired one ends as well, but was not "logged in").
  const labels = ended.map((r) => r.device_label);
  if (labels.length > 0) await addAlert(db, a.account_id, 'logged-out-by-new-device', { deviceLabels: labels, count: labels.length }, now);
  return { ids: ended.map((r) => r.id), labels };
}

/** `POST /v1/login/approval/:id/cancel`: the new device stops waiting (the request ends as expired). */
async function cancel(req: FastifyRequest, reply: FastifyReply) {
  const deps = req.server.deps;
  const row = await ownApproval(deps, req);
  await deps.db.query(`update login_approvals set outcome = 'expired', decided_at = $2 where id = $1 and outcome is null`, [row.id, deps.clock()]);
  void reply.clearCookie(APPROVAL_COOKIE, COOKIE_ATTRS);
  return { ok: true };
}

/** What a logged-in device is shown about an open approval. */
export interface ApprovalView {
  id: string;
  deviceLabel: string;
  choices: number[];
  createdAt: string;
  expiresAt: string;
  /** The account is at its device limit: approving needs `logOut` (unless "One device at a time" is on). */
  atLimit: boolean;
  oneDevice: boolean;
  /**
   * J-23 (design note docs/security/multi-device-2026-11-09.md section 3.1 rule 2): whether a
   * chat-key handover may be offered with this approval at all. Every login is a passkey, security
   * key or PGP key now (owner, 26 Nov 2026), so it always may. Nothing rides on it yet: the
   * handover gesture waits for owner p12-5.
   */
  keysOffered: boolean;
}

async function views(deps: Deps, req: FastifyRequest, id: string | null): Promise<ApprovalView[]> {
  const now = deps.clock();
  const { accountId } = req.auth;
  const device = deviceHash(req);
  const { rows } = await deps.db.query<ApprovalRow & { one_device: boolean }>(
    `select l.*, a.one_device from login_approvals l join accounts a on a.id = l.account_id
      where l.account_id = $1 and l.outcome is null and l.expires_at > $2 and ($3::uuid is null or l.id = $3)
        and ($4::bytea is null or l.device_hash <> $4)
      order by l.created_at desc, l.id`,
    [accountId, now, id, device],
  );
  if (rows.length === 0) return [];
  const max = rows[0]!.one_device ? 1 : await maxDevices(deps.db);
  const inUse = await devicesInUse(deps.db, accountId, now, null);
  return rows.map((r) => ({
    id: r.id,
    deviceLabel: r.device_label,
    choices: r.choices,
    createdAt: r.created_at.toISOString(),
    expiresAt: r.expires_at.toISOString(),
    atLimit: !r.one_device && inUse >= max,
    oneDevice: r.one_device,
    keysOffered: true,
  }));
}

function decisionBody(raw: unknown): { block: true } | { choice: number; logOut: string | null } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new ApiError(400, 'bad-request');
  const b = raw as Record<string, unknown>;
  const keys = Object.keys(b);
  if (b.block === true && keys.length === 1) return { block: true };
  const choice = b.choice;
  if (typeof choice !== 'number' || !Number.isInteger(choice) || keys.some((k) => k !== 'choice' && k !== 'logOut')) {
    throw new ApiError(400, 'bad-request');
  }
  const logOut = b.logOut;
  if (logOut !== undefined && (typeof logOut !== 'string' || !UUID.test(logOut))) throw new ApiError(400, 'bad-request');
  return { choice, logOut: typeof logOut === 'string' ? logOut.toLowerCase() : null };
}

/**
 * `POST /v1/account/approvals/:id { choice, logOut? } | { block: true }` → `{ outcome }` (throttled
 * per session, `APPROVAL_DECISION_BUCKET`; the caller must still be live under the locks). A decided
 * or expired approval → 409 `approval-ended`; at the device limit without a valid `logOut` → 409
 * `too-many-devices` `{ sessions }` and the approval stays open.
 */
async function decide(req: FastifyRequest) {
  const deps = req.server.deps;
  const id = idParam(req);
  const body = decisionBody(req.body);
  const { accountId, sessionId } = req.auth;
  const device = deviceHash(req);
  const now = deps.clock();
  return withTx(deps, async (db) => {
    await lockApprovals(db, accountId);
    // Review round 4 R4-I1: the deciding session must still be live, checked under the approval and
    // account locks a recovery-code login also holds (401 `not-authenticated`).
    await requireLiveSessionInTx(db, req.auth, now);
    const { rows } = await db.query<ApprovalRow & { one_device: boolean }>(
      `select l.*, a.one_device from login_approvals l join accounts a on a.id = l.account_id
        where l.id = $1 and l.account_id = $2 for update of l`,
      [id, accountId],
    );
    const row = rows[0];
    if (!row || (device !== null && row.device_hash.equals(device))) throw new ApiError(404, 'not-found');
    if (row.outcome !== null || now.getTime() >= row.expires_at.getTime()) {
      throw new ApiError(409, 'approval-ended', { outcome: row.outcome ?? 'expired' });
    }
    if ('block' in body || body.choice !== row.number) {
      await db.query(`update login_approvals set outcome = 'blocked', decided_at = $2, decided_by = $3 where id = $1`, [id, now, sessionId]);
      await addAlert(db, accountId, 'login-blocked', {
        approvalId: id, deviceLabel: row.device_label, method: row.method, reason: 'block' in body ? 'blocked' : 'wrong-number',
      }, now);
      return { outcome: 'blocked' as const };
    }
    let ends: 'one-device' | 'session' | null = null;
    let endId: string | null = null;
    if (row.one_device) {
      ends = 'one-device';
    } else if ((await devicesInUse(db, accountId, now, null)) >= (await maxDevices(db))) {
      const chosen = body.logOut === null ? [] : (await db.query(
        `select 1 from sessions where id = $1 and account_id = $2 and level = 'full' and revoked_at is null and expires_at > $3`,
        [body.logOut, accountId, now],
      )).rows;
      if (chosen.length === 0) {
        const list = await db.query<{ id: string; device_label: string; last_seen_at: Date }>(
          `select id, device_label, last_seen_at from sessions
            where account_id = $1 and level = 'full' and revoked_at is null and expires_at > $2
            order by last_seen_at desc, id`,
          [accountId, now],
        );
        throw new ApiError(409, 'too-many-devices', {
          sessions: list.rows.map((s) => ({ id: s.id, deviceLabel: s.device_label, lastSeenAt: s.last_seen_at.toISOString(), current: s.id === sessionId })),
        });
      }
      ends = 'session';
      endId = body.logOut;
    }
    await db.query(
      `update login_approvals set outcome = 'approved', decided_at = $2, decided_by = $3, expires_at = $4, ends = $5, end_session = $6, keys_offered = $7 where id = $1`,
      // J-23: the handover gate as it stood at the decision; nothing uses it yet (p12-5).
      [id, now, sessionId, new Date(now.getTime() + APPROVAL_TTL_MS), ends, endId, true],
    );
    return { outcome: 'approved' as const };
  });
}

/**
 * Task 16's routes. New device (no session): `POST /v1/login/approval/:id/poll` and `.../cancel`.
 * Logged-in device (full trader session): `GET /v1/account/approvals`,
 * `GET /v1/account/approvals/:id` and `POST /v1/account/approvals/:id`.
 */
export function approvalRoutes(app: FastifyInstance): void {
  const trader = requireSession({ kinds: ['trader'] });
  app.post('/v1/login/approval/:id/poll', poll);
  app.post('/v1/login/approval/:id/cancel', cancel);
  app.get('/v1/account/approvals', { preHandler: trader }, async (req) => views(req.server.deps, req, null));
  app.get('/v1/account/approvals/:id', { preHandler: trader }, async (req) => {
    const found = await views(req.server.deps, req, idParam(req));
    if (found.length === 0) throw new ApiError(404, 'not-found');
    return found[0];
  });
  // Review round 4 R4-I1: tries per session, refused ones included.
  const throttle = async (req: FastifyRequest) => req.server.budgets.approvalDecision.take(req.auth.sessionId);
  app.post('/v1/account/approvals/:id', { preHandler: [trader, throttle] }, decide);
}
