/**
 * The 24 h wait of a username + password session's changes (hold model v3, owner 1-2 Nov 2026; see
 * hold.ts for the whole model).
 *
 * - **Staging:** a change by a session whose login waits (`waits(strength)`: a username and password
 *   with nothing stronger; a PGP key login is strong, owner 6 Nov 2026 Q81) to its login methods, payout wallets, login name,
 *   security settings, recovery code or a team member's permissions, or its removal of a payout
 *   wallet or a team member (owner p5-7: removals included, nothing applies early), is not applied: `gateChange`
 *   (hold.ts) stores it here as a draft of that session (202 `{ status: 'staged', changeId }`). The
 *   session reviews its drafts (`GET /v1/account/hold`) and submits them together.
 * - **Submitting** (`POST /v1/account/hold/changes/submit { ids }`, exactly the drafts the session
 *   reviewed): the changes wait; every waiting change of the account now takes effect 24 h after
 *   this submission (one date for the banner). Nobody is logged out and trading goes on. The owner
 *   is told at once on every channel: alert `hold-changes-submitted` `{ count, changes,
 *   takesEffectAt }` (the list of changes) and a push to every device (Jabber later).
 * - **Cancelling:** any logged-in session of the account owner, a username-and-password one included
 *   (`DELETE /v1/account/hold/changes`, or one by id; alert `hold-changes-cancelled`).
 * - **Approving early** (owner G58, 7 Nov; replaces the earlier discard on a strong login): a
 *   session with a strong login sees the waiting changes in the before-and-after view with the
 *   countdown and may approve them now (`POST /v1/account/hold/changes/approve { ids }`), cancel them
 *   all, or untick single ones (g65). A recovery-code login keeps them (owner G32).
 * - **Applying:** at the date, every minute (`settleDueChanges`) or at the next read of the account's
 *   changes, each through the same write its route uses, in order, each on its own: one that can no
 *   longer apply is dropped and the rest stand (alert `hold-changes-applied` `{ applied, dropped }`).
 * - A draft dies with the session that staged it (migration 016's trigger); a submitted change does
 *   not (the owner said any session cancels them; nobody is logged out).
 * - Every read-modify-write here runs with the account locked (`lockAccount`), the same lock as the
 *   account hold's.
 */
import type { FastifyRequest } from 'fastify';
import { addAlert } from '../alerts.js';
import type { Config } from '../config.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import type { RetentionJob } from '../retention.js';
import { applyChange, concurrencyFailure, lockAccount, methodIds, withTx, HOLD_MS, type PendingChange, type SettleDeps } from './hold.js';
import { addressEnd } from '@x2f/accounts';

/** At most this many changes (drafts and waiting ones) per account, so a session cannot flood the list or the alerts. */
export const MAX_HOLD_CHANGES = 20;

/**
 * Staging, submitting and cancelling, together, per account and UTC day (lead hold v3 review,
 * minor: each writes an alert, and the alert list shows 50); past it 429 `slow-down`.
 */
export const HOLD_CHANGE_ACTIONS_PER_DAY = 100;
export const holdActionsKey = (accountId: string) => `hold-changes:${accountId}`;

/** What a change is, as the review list, the alerts and the banner name it: never a secret, an address or a key. */
export interface ChangeSummary {
  kind: PendingChange['kind'];
  /** A passkey or a security key (webauthn), the method removed (remove-method). */
  method?: string;
  /** Wallets: how many, and each address's last 6 characters (lead hold v3 review, minor). */
  wallets?: number;
  addressEnds?: string[];
  /** The one-device switch, the logout timer, a member's new roles. */
  on?: boolean;
  idleHours?: number;
  memberId?: string;
  roles?: string[];
  /** A wallet removed (owner p5-7): its label. */
  label?: string;
}

export function describeChange(c: PendingChange): ChangeSummary {
  switch (c.kind) {
    case 'webauthn':
      return { kind: c.kind, method: c.credential.kind };
    case 'remove-method':
      return { kind: c.kind, method: c.type };
    case 'wallets':
      return { kind: c.kind, wallets: c.items.length, addressEnds: c.items.map((w) => addressEnd(w.address)) };
    case 'one-device':
      return { kind: c.kind, on: c.on };
    case 'logout-timer':
      return { kind: c.kind, idleHours: c.idleHours };
    case 'team-roles':
      return { kind: c.kind, memberId: c.memberId, roles: [...c.roles] };
    case 'remove-wallet':
      return { kind: c.kind, label: c.label, addressEnds: [c.addressEnd] };
    case 'team-remove':
      return { kind: c.kind, memberId: c.memberId };
    default:
      return { kind: c.kind };
  }
}

/** Inside `gateChange`'s transaction (account locked, session live): stores the change as a draft of the session. Returns its id. */
export async function stageChange(db: Queryable, accountId: string, sessionId: string, change: PendingChange, now: Date): Promise<string> {
  const { rows: n } = await db.query<{ n: number }>('select count(*)::int as n from hold_changes where account_id = $1', [accountId]);
  if (n[0]!.n >= MAX_HOLD_CHANGES) throw new ApiError(409, 'too-many-changes', { max: MAX_HOLD_CHANGES });
  const { rows } = await db.query<{ id: string }>(
    'insert into hold_changes (account_id, session_id, change, created_at) values ($1, $2, $3, $4) returning id',
    [accountId, sessionId, JSON.stringify(change), now],
  );
  return rows[0]!.id;
}

interface ChangeRow {
  id: string;
  seq: string;
  session_id: string | null;
  change: PendingChange;
  created_at: Date;
  submitted_at: Date | null;
  due_at: Date | null;
  methods_before: string[] | null;
}

/**
 * Inside a transaction with the account locked: applies the account's waiting changes whose date
 * has come, in order, each on its own savepoint (one that fails is dropped; a deadlock or
 * serialization failure fails the whole transaction so the next run retries). Returns how many
 * were settled (applied or dropped).
 */
export async function settleChangesInTx(db: Queryable, s: SettleDeps, accountId: string, now: Date): Promise<number> {
  const { rows } = await db.query<ChangeRow>(
    'select * from hold_changes where account_id = $1 and due_at <= $2 order by seq',
    [accountId, now],
  );
  if (rows.length === 0) return 0;
  await db.query('delete from hold_changes where id = any($1::uuid[])', [rows.map((r) => r.id)]);
  const applied: string[] = [];
  const dropped: string[] = [];
  let endedOthers = false;
  let keep: string | null = null;
  for (const r of rows) {
    await db.query('savepoint hold_change');
    try {
      // A password change or a removal ends the other sessions; the session that staged it stays,
      // when it is still live (as the route would have kept it).
      keep = r.session_id;
      endedOthers = (await applyChange(db, s, accountId, r.change, keep, now)) || endedOthers;
      await db.query('release savepoint hold_change');
      applied.push(r.change.kind);
    } catch (e) {
      if (concurrencyFailure(e)) throw e;
      await db.query('rollback to savepoint hold_change');
      if (!(e instanceof ApiError)) s.log?.error({ err: e, change: r.change.kind }, 'waiting change failed; dropped');
      dropped.push(r.change.kind);
    }
  }
  await addAlert(db, accountId, 'hold-changes-applied', { applied, dropped }, now);
  if (endedOthers) s.events?.closeAccount(accountId, keep ?? undefined);
  return rows.length;
}

/** The waiting (submitted) changes' count and date, or null: the banner's data. */
export async function pendingSummary(db: Queryable, accountId: string): Promise<{ count: number; takesEffectAt: string } | null> {
  const { rows } = await db.query<{ n: number; due: Date | null }>(
    'select count(*)::int as n, max(due_at) as due from hold_changes where account_id = $1 and submitted_at is not null',
    [accountId],
  );
  const r = rows[0]!;
  return r.n === 0 || r.due === null ? null : { count: r.n, takesEffectAt: r.due.toISOString() };
}

/**
 * Inside a transaction with the account locked: submits exactly `ids`, which must all be drafts of
 * `sessionId` (else 409 `changes-changed`: the list the user reviewed is not the list there is).
 * Every waiting change of the account then takes effect 24 h from now. Alert
 * `hold-changes-submitted` `{ count, changes, takesEffectAt }` names what was submitted now.
 */
export async function submitChanges(db: Queryable, accountId: string, sessionId: string, ids: string[], now: Date): Promise<{ count: number; takesEffectAt: string }> {
  const { rows } = await db.query<ChangeRow>(
    `select * from hold_changes where account_id = $1 and session_id = $2 and submitted_at is null and id = any($3::uuid[])
      order by seq`,
    [accountId, sessionId, ids],
  );
  if (rows.length !== new Set(ids).size) throw new ApiError(409, 'changes-changed');
  const due = new Date(now.getTime() + HOLD_MS);
  const methods = await methodIds(db, accountId);
  await db.query('update hold_changes set submitted_at = $2, methods_before = $3, due_at = $4 where id = any($1::uuid[])', [ids, now, methods, due]);
  await db.query('update hold_changes set due_at = $2 where account_id = $1 and submitted_at is not null', [accountId, due]);
  const total = (await pendingSummary(db, accountId))!;
  await addAlert(db, accountId, 'hold-changes-submitted', { count: total.count, changes: rows.map((r) => describeChange(r.change)), takesEffectAt: total.takesEffectAt }, now);
  return total;
}

/**
 * Inside a transaction with the account locked: cancels the account's waiting changes (all, or the
 * one `id`) and the calling session's own drafts among them. Cancelling all takes every other
 * session's drafts too (lead hold v3 review, minor: a thief's drafts must not wait to be submitted
 * after the owner cancelled everything). One other session's draft by id is not this session's to
 * cancel (404, as an unknown id). Alert `hold-changes-cancelled` `{ count, changes }` when a waiting
 * change went. Returns how many went.
 */
export async function cancelChanges(
  db: Queryable,
  accountId: string,
  sessionId: string,
  id: string | null,
  now: Date,
  o: { member?: string } = {},
): Promise<number> {
  // Owner p4-8: a member with hold rights cancels waiting changes only, never the lead's drafts.
  const { rows } = await db.query<ChangeRow>(
    `delete from hold_changes
      where account_id = $1 and ($4::boolean is false or submitted_at is not null)
        and ($3::uuid is null or ((submitted_at is not null or session_id = $2) and id = $3))
      returning *`,
    [accountId, sessionId, id, o.member !== undefined],
  );
  const waiting = rows.filter((r) => r.submitted_at !== null).sort((a, b) => Number(a.seq) - Number(b.seq));
  if (waiting.length > 0) {
    await addAlert(db, accountId, 'hold-changes-cancelled', {
      count: waiting.length, changes: waiting.map((r) => describeChange(r.change)), ...(o.member !== undefined ? { member: o.member } : {}),
    }, now);
  }
  return rows.length;
}


/**
 * Owner G58 (7 Nov): inside a transaction with the account locked, a strong session approves
 * exactly `ids`, which must all be waiting (submitted) changes of the account (else 409
 * `changes-changed`): they are due now, and `settleChangesInTx` applies them in order. Returns how
 * many settled.
 */
export async function approveChanges(db: Queryable, s: SettleDeps, accountId: string, ids: string[], now: Date): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    'select id from hold_changes where account_id = $1 and submitted_at is not null and id = any($2::uuid[])',
    [accountId, ids],
  );
  if (rows.length !== new Set(ids).size) throw new ApiError(409, 'changes-changed');
  await db.query('update hold_changes set due_at = $2 where id = any($1::uuid[])', [ids, now]);
  return settleChangesInTx(db, s, accountId, now);
}

/** `GET /v1/account/hold`'s list: the waiting changes (any session's) and the calling session's drafts. */
export async function listChanges(db: Queryable, accountId: string, sessionId: string): Promise<{
  changes: { count: number; takesEffectAt: string | null; items: Array<ChangeSummary & { id: string; createdAt: string; submittedAt: string; by: string | null; mine: boolean }> };
  drafts: Array<ChangeSummary & { id: string; createdAt: string }>;
}> {
  const { rows } = await db.query<ChangeRow & { device_label: string | null }>(
    `select h.*, s.device_label from hold_changes h left join sessions s on s.id = h.session_id
      where h.account_id = $1 and (h.submitted_at is not null or h.session_id = $2)
      order by h.seq`,
    [accountId, sessionId],
  );
  const waiting = rows.filter((r) => r.submitted_at !== null);
  const due = waiting.reduce<Date | null>((m, r) => (m === null || r.due_at!.getTime() > m.getTime() ? r.due_at : m), null);
  return {
    changes: {
      count: waiting.length,
      takesEffectAt: due?.toISOString() ?? null,
      items: waiting.map((r) => ({
        id: r.id, ...describeChange(r.change), createdAt: r.created_at.toISOString(), submittedAt: r.submitted_at!.toISOString(),
        by: r.device_label, mine: r.session_id === sessionId,
      })),
    },
    drafts: rows.filter((r) => r.submitted_at === null).map((r) => ({ id: r.id, ...describeChange(r.change), createdAt: r.created_at.toISOString() })),
  };
}

/** Every minute (main.ts): applies the waiting changes whose date has come, each account in its own transaction. */
export function settleDueChanges(
  config: Config,
  events: SettleDeps['events'],
  log?: SettleDeps['log'],
  push?: { send(accountId: string, kind: 'alert'): Promise<unknown> },
): RetentionJob {
  return {
    name: 'settleDueChanges',
    async run(pool, now) {
      const { rows } = await pool.query<{ account_id: string }>('select distinct account_id from hold_changes where due_at <= $1', [now]);
      let n = 0;
      for (const r of rows) {
        const settled = await withTx(pool, async (db) => {
          await lockAccount(db, r.account_id);
          return settleChangesInTx(db, { config, events, log }, r.account_id, now);
        });
        n += settled;
        // The owner hears that the changes applied (alert hold-changes-applied; lead hold v3 review, minor).
        if (settled > 0 && push) void push.send(r.account_id, 'alert').catch(() => undefined);
      }
      return n;
    },
  };
}

/** True when changes by the calling session are staged instead of applied (the pop-up warns before the first one). */
export async function changesWait(req: FastifyRequest): Promise<boolean> {
  const { rows } = await req.server.deps.db.query<{ kind: string; level: string; strength: string | null; onboarding_until: Date | null; hold_until: Date | null }>(
    `select a.kind, s.level, s.strength, s.onboarding_until, s.hold_until from sessions s join accounts a on a.id = s.account_id where s.id = $1`,
    [req.auth.sessionId],
  );
  const r = rows[0];
  if (!r || r.kind !== 'trader') return false;
  const now = req.server.deps.clock();
  if (r.onboarding_until !== null && r.onboarding_until.getTime() > now.getTime()) return false;
  if (r.level === 'recovery' && r.hold_until !== null && r.hold_until.getTime() <= now.getTime()) return false;
  return r.strength !== 'strong';
}
