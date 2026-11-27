import { LIEN_LAPSE_ESCALATE_HOURS, LIEN_LAPSE_STARTS_COLLECTING, can, parseCollectRate } from '@x2f/staff';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { addAlert, addOwnerAlert } from '../alerts.js';
import { requireLiveSessionInTx, requireNotHeld, withTx } from '../auth/hold.js';
import { requireSession } from '../auth/sessions.js';
import { ApiError } from '../errors.js';
import { appendLog } from '../log/append.js';
import type { OwnerAlertDeps } from '../push/ownerAlert.js';
import { consumeKeyTap } from '../staff/keyTap.js';
import { requireStaff } from '../staff/guard.js';
import { ownerDeviceOnly } from '../team/perms.js';
import { proposeLienRate, rateDeciders } from './lien.js';
export { GRACE_WAITING_SQL, graceOf, remainingWith, type GraceView } from './lienCase.js';
import { releaseStaleHolds } from './recovery.js';
import { actorOf, body as bodyOf } from './staffRoutes.js';
import type { DisputeDeps } from './store.js';

/**
 * Owner decision, 26 Nov 2026 5:43 PM Pacific (docs/lien-recovery.md "Grace: 7 days to pay the
 * agreed way"; the rules in @x2f/staff lienGrace.ts):
 *
 * - The ruling that places a lien carries the moderator's plan (`lienPlan` on the propose route,
 *   kept on `ruling_drafts.lien_grace_method`); `applyLienRules` (lien.ts) copies a grace onto the
 *   lien it places: `grace_method`, `grace_until` = placed + 7 days, `ruled_by`.
 * - While in grace nothing is reserved from the debtor's trades (lien.ts `LIEN_COLLECTING_SQL`, the
 *   one predicate recovery.ts `pickRecovery` reads).
 * - `POST /v1/account/liens/:id/paid`: the person owed (the creditor's own session on the account
 *   owner's device, live, not during a hold) signs off "I've been paid": the lien is settled off the
 *   platform in full (`repaid_off_platform_at`; status `repaid`, or `active` recovering nothing more
 *   when it carries X2F's 1%, as `complied` does: NEEDS_OWNER_LIEN_FEE_AFTER_COMPLY). Logged
 *   `lien.repaid-off-platform`. Only while not collecting.
 * - `runLienGraceLapses` (dispute timer): the days passed without the sign-off: marked once
 *   (`grace_lapsed_at`), logged `lien.grace-lapsed`, the moderator who ruled is alerted (in-app and
 *   pushed) and the case is in their queue; the owner is alerted in-app. Recovery does not start
 *   (`LIEN_LAPSE_STARTS_COLLECTING`).
 * - `POST /staff/v1/liens/:id/collect { tapId, rateBps?, rateReason? }` (`disputes.handle`: the
 *   moderator who ruled, or a senior moderator / the owner): switches the lien to collecting, early
 *   or after the lapse, with a `lien-collect` key tap bound to the lien and the share entered (money
 *   starts to move). Owner addition 5:51 PM: a share under 100% (with its reason) becomes the lien's
 *   pending rate request (lien.ts `proposeLienRate`), for a senior to approve (no tap since 5:53 PM);
 *   100% applies until then. Logged `lien.collect-started`; the person owed is alerted (`lien-collecting`).
 * - `POST /staff/v1/liens/:id/escalate {}` (the same people, after the lapse): sends it to a senior
 *   moderator or the owner (their queue lists it, as a comply lapse; each is alerted and pushed).
 *   Logged `lien.grace-escalated`. Nobody acting for LIEN_LAPSE_ESCALATE_HOURS, or a moderator who
 *   left, escalates it by itself (`runLienGraceEscalations`).
 * - `POST /staff/v1/liens/:id/paid-off-platform { tapId }` (the same people, `lien-paid-off-platform`
 *   tap): ends any active lien as settled off the platform (review item 3).
 */

/**
 * The dispute timer's step: each active lien whose grace passed without the creditor's sign-off or a
 * switch is marked lapsed once, logged and the moderator who ruled told (in-app, and pushed when
 * `push` is given; the owner in-app). With `LIEN_LAPSE_STARTS_COLLECTING` the lapse also starts
 * collecting (the lead reading leaves it off). Each lien is its own transaction; a failure is kept
 * in `failures` and the rest still run. Returns how many lapsed.
 */
export async function runLienGraceLapses(deps: Pick<DisputeDeps, 'db' | 'clock'> & { push?: OwnerAlertDeps['push'] }, failures: unknown[]): Promise<number> {
  const now = deps.clock();
  const { rows } = await deps.db.query<{ id: string }>(
    `select id::text from liens
      where status = 'active' and grace_until is not null and grace_until <= $1
        and grace_lapsed_at is null and collect_started_at is null and repaid_off_platform_at is null
      order by grace_until, id limit 200`,
    [now],
  );
  let n = 0;
  const told: string[] = [];
  for (const { id } of rows) {
    try {
      const ruler = await withTx(deps.db, async (c) => {
        const r = await c.query<{ from_code: string; ruled_by: string | null; creditor: string }>(
          `update liens set grace_lapsed_at = $2${LIEN_LAPSE_STARTS_COLLECTING ? ', collect_started_at = $2' : ''}
            where id = $1 and status = 'active' and grace_until <= $2
              and grace_lapsed_at is null and collect_started_at is null and repaid_off_platform_at is null
            returning from_code, ruled_by::text, creditor_account_id::text as creditor`,
          [id, now],
        );
        const l = r.rows[0];
        if (l === undefined) return undefined;
        if (l.ruled_by !== null) await addAlert(c, l.ruled_by, 'lien-grace-lapsed', { trade: l.from_code, lienId: id }, now);
        await addOwnerAlert(c, 'lien-grace-lapsed', { trade: l.from_code, lienId: id }, now);
        await appendLog(c, { at: now, actor: { kind: 'system' }, tradeCode: l.from_code, action: 'lien.grace-lapsed', detail: { lienId: id } });
        if (LIEN_LAPSE_STARTS_COLLECTING) {
          await addAlert(c, l.creditor, 'lien-collecting', { lienId: id }, now);
          await appendLog(c, { at: now, actor: { kind: 'system' }, tradeCode: l.from_code, action: 'lien.collect-started', detail: { lienId: id, lapsed: true } });
        }
        return l.ruled_by;
      });
      if (ruler !== undefined) {
        n++;
        if (ruler !== null) told.push(ruler);
      }
    } catch (err) {
      failures.push(err);
    }
  }
  if (deps.push !== undefined) {
    for (const who of new Set(told)) await deps.push.send(who, 'alert').catch(() => false);
  }
  return n;
}

/**
 * Review of feat/lien-grace items 2 and 6: a lapsed lien sent to the senior moderators and the owner
 * (by its moderator, or by the timer) alerts each of them in-app (`lien-grace-escalated`, detail:
 * trade, lienId), never `except` (the one who sent it). Returns who, for the push after the commit.
 */
async function alertEscalation(c: pg.PoolClient, a: { lienId: string; trade: string; except: string | null; now: Date }): Promise<string[]> {
  const to = await rateDeciders(c, a.except ?? '00000000-0000-0000-0000-000000000000');
  for (const who of to) await addAlert(c, who, 'lien-grace-escalated', { trade: a.trade, lienId: a.lienId }, a.now);
  return to;
}

/** SQL over `liens l`: the moderator who ruled is not active staff now (unknown, switched off, removed, disabled). */
const RULER_GONE_SQL = `(l.ruled_by is null or not exists (select 1 from staff_members m join accounts a on a.id = m.account_id
   where m.account_id = l.ruled_by and m.switched_off_at is null and m.removed_at is null and a.disabled_at is null))`;

/**
 * Review of feat/lien-grace item 2 (dispute timer): a lapsed lien nobody acted on goes to the senior
 * moderators and the owner by itself, once: `LIEN_LAPSE_ESCALATE_HOURS` after the lapse, or at once
 * when the moderator who ruled is no longer active staff. Marked as an escalation by nobody
 * (`grace_escalated_by` null), logged `lien.grace-escalated { auto: true }`, so the seniors' queue
 * lists it; each senior and the owner is alerted in-app and pushed. Returns how many.
 */
export async function runLienGraceEscalations(deps: Pick<DisputeDeps, 'db' | 'clock'> & { push?: OwnerAlertDeps['push'] }, failures: unknown[]): Promise<number> {
  const now = deps.clock();
  const due = new Date(now.getTime() - LIEN_LAPSE_ESCALATE_HOURS * 3_600_000);
  const WAITING = (dueParam: string) => `l.status = 'active' and l.grace_lapsed_at is not null and l.grace_escalated_at is null
    and l.collect_started_at is null and l.repaid_off_platform_at is null and (l.grace_lapsed_at <= ${dueParam} or ${RULER_GONE_SQL})`;
  const { rows } = await deps.db.query<{ id: string }>(`select l.id::text from liens l where ${WAITING('$1')} order by l.grace_lapsed_at, l.id limit 200`, [due]);
  let n = 0;
  const told = new Set<string>();
  for (const { id } of rows) {
    try {
      const to = await withTx(deps.db, async (c) => {
        const r = await c.query<{ from_code: string }>(`update liens l set grace_escalated_at = $3 where l.id = $1 and ${WAITING('$2')} returning l.from_code`, [id, due, now]);
        const l = r.rows[0];
        if (l === undefined) return null;
        const who = await alertEscalation(c, { lienId: id, trade: l.from_code, except: null, now });
        await appendLog(c, { at: now, actor: { kind: 'system' }, tradeCode: l.from_code, action: 'lien.grace-escalated', detail: { lienId: id, auto: true } });
        return who;
      });
      if (to !== null) {
        n++;
        for (const who of to) told.add(who);
      }
    } catch (err) {
      failures.push(err);
    }
  }
  if (deps.push !== undefined) for (const who of told) await deps.push.send(who, 'alert').catch(() => false);
  return n;
}

/**
 * Coordinator follow-up 26 Nov 2026: the phone push for new rate requests, after the transaction
 * that created them (and alerted the deciders in-app, lien.ts `alertRateDeciders`). Each pending
 * request not pushed yet is claimed once (`deciders_pushed_at`), then each senior and the owner who
 * may decide it gets the fixed `alert` push. Called by the routes that create a request and by the
 * dispute timers (a request placed with a ruling). Returns how many requests were pushed.
 */
export async function pushRateDeciders(deps: Pick<DisputeDeps, 'db' | 'clock'> & { push: OwnerAlertDeps['push'] }): Promise<number> {
  const { rows } = await deps.db.query<{ proposed_by: string }>(
    `update lien_rate_requests set deciders_pushed_at = $1
      where id in (select id from lien_rate_requests where status = 'pending' and deciders_pushed_at is null order by proposed_at, id limit 200 for update skip locked)
      returning proposed_by::text`,
    [deps.clock()],
  );
  const to = new Set<string>();
  for (const r of rows) for (const who of await rateDeciders(deps.db, r.proposed_by)) to.add(who);
  for (const who of to) await deps.push.send(who, 'alert').catch(() => false);
  return rows.length;
}

interface LockedLien {
  status: string;
  creditor: string;
  from_code: string;
  fee_atomic: string;
  ruled_by: string | null;
  grace_until: Date | null;
  grace_lapsed_at: Date | null;
  grace_escalated_at: Date | null;
  collect_started_at: Date | null;
  repaid_off_platform_at: Date | null;
}

async function lockLien(c: pg.PoolClient, id: string): Promise<LockedLien | undefined> {
  return (
    await c.query<LockedLien>(
      `select status, creditor_account_id::text as creditor, from_code, fee_atomic::text, ruled_by::text, grace_until, grace_lapsed_at,
              grace_escalated_at, collect_started_at, repaid_off_platform_at
         from liens where id = $1 for update`,
      [id],
    )
  ).rows[0];
}

/** In grace or lapsed, never switched and never paid off the platform: the switch and the sign-off apply. */
const waitingGrace = (l: LockedLien) => l.grace_until !== null && l.collect_started_at === null && l.repaid_off_platform_at === null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function lienParam(req: FastifyRequest): string {
  const v = (req.params as Record<string, unknown>).id;
  if (typeof v !== 'string' || !UUID.test(v.toLowerCase())) throw new ApiError(404, 'not-found');
  return v.toLowerCase();
}

/** The moderator whose ruling placed the lien, or a senior moderator / the owner (`rulings.approve`). */
function mayDecide(req: FastifyRequest, l: LockedLien): boolean {
  return l.ruled_by === req.staff.accountId || can(req.staff.role, 'rulings.approve', req.staff.grants);
}

export function lienGraceRoutes(app: FastifyInstance, o: { push?: OwnerAlertDeps['push'] } = {}): void {
  const handle = { preHandler: requireStaff('disputes.handle'), config: { perm: 'disputes.handle' as const } };

  app.post('/staff/v1/liens/:id/collect', handle, async (req) => {
    const id = lienParam(req);
    const b = bodyOf(req, ['tapId', 'rateBps', 'rateReason'], ['tapId']);
    if (typeof b.tapId !== 'string') throw new ApiError(400, 'bad-request', { field: 'tapId' });
    const rate = parseCollectRate(b);
    if (rate === null) throw new ApiError(400, 'bad-request', { field: 'rateBps' });
    const me = actorOf(req);
    const { db, clock } = req.server.deps;
    const out = await withTx(db, async (c) => {
      const now = clock();
      const l = await lockLien(c, id);
      if (l === undefined) throw new ApiError(404, 'not-found');
      if (!mayDecide(req, l)) throw new ApiError(403, 'forbidden');
      if ((l.status !== 'active' && l.status !== 'suspended') || !waitingGrace(l)) throw new ApiError(409, 'wrong-state');
      // Money starts to move: a key tap bound to this lien (as `lien-rate` and `lien-uncollectible`).
      const tap = await consumeKeyTap(c, b.tapId as string, me.id, { kind: 'lien-collect', lienId: id, rateBps: rate.rateBps }, now, { sessionId: req.auth.sessionId });
      await c.query('update liens set collect_started_at = $2, collect_started_by = $3, collect_tap = $4 where id = $1', [id, now, me.id, tap.id]);
      const requested = rate.rateReason !== null && (await proposeLienRate(c, { lienId: id, rateBps: rate.rateBps, reason: rate.rateReason, by: me.id, now, logCode: l.from_code }));
      if (rate.rateReason !== null && !requested) throw new ApiError(409, 'request-pending');
      await appendLog(c, { at: now, actor: me, tradeCode: l.from_code, action: 'lien.collect-started', detail: { lienId: id, lapsed: l.grace_lapsed_at !== null } });
      // Review item 9: the person owed hears that collecting started (and to choose their wallet).
      await addAlert(c, l.creditor, 'lien-collecting', { lienId: id }, now);
      return { mode: 'collect' as const, collectStartedAt: now.toISOString(), rateRequest: requested ? ('pending' as const) : null, creditor: l.creditor };
    });
    if (o.push !== undefined) {
      await o.push.send(out.creditor, 'alert').catch(() => false);
      if (out.rateRequest !== null) await pushRateDeciders({ db, clock, push: o.push }).catch(() => 0);
    }
    return { mode: out.mode, collectStartedAt: out.collectStartedAt, rateRequest: out.rateRequest };
  });

  // Review of feat/lien-grace item 3: the traders settled it themselves; the moderator who ruled, or a
  // senior moderator / the owner, ends the lien as repaid off the platform, grace or collecting, with
  // a `lien-paid-off-platform` key tap bound to it (it ends what is owed).
  app.post('/staff/v1/liens/:id/paid-off-platform', handle, async (req) => {
    const id = lienParam(req);
    const b = bodyOf(req, ['tapId'], ['tapId']);
    if (typeof b.tapId !== 'string') throw new ApiError(400, 'bad-request', { field: 'tapId' });
    const me = actorOf(req);
    const { db, clock } = req.server.deps;
    return withTx(db, async (c) => {
      const now = clock();
      const l = await lockLien(c, id);
      if (l === undefined) throw new ApiError(404, 'not-found');
      if (!mayDecide(req, l)) throw new ApiError(403, 'forbidden');
      if (l.status !== 'active' || l.repaid_off_platform_at !== null) throw new ApiError(409, 'wrong-state');
      await consumeKeyTap(c, b.tapId as string, me.id, { kind: 'lien-paid-off-platform', lienId: id }, now, { sessionId: req.auth.sessionId });
      return endOffPlatform(c, id, l, now, me);
    });
  });

  app.post('/staff/v1/liens/:id/escalate', handle, async (req) => {
    const id = lienParam(req);
    bodyOf(req, []);
    const me = actorOf(req);
    const { db, clock } = req.server.deps;
    const out = await withTx(db, async (c) => {
      const now = clock();
      const l = await lockLien(c, id);
      if (l === undefined) throw new ApiError(404, 'not-found');
      if (!mayDecide(req, l)) throw new ApiError(403, 'forbidden');
      if (l.status !== 'active' || !waitingGrace(l) || l.grace_lapsed_at === null || l.grace_escalated_at !== null) throw new ApiError(409, 'wrong-state');
      await c.query('update liens set grace_escalated_at = $2, grace_escalated_by = $3 where id = $1', [id, now, me.id]);
      const told = await alertEscalation(c, { lienId: id, trade: l.from_code, except: me.id, now });
      await appendLog(c, { at: now, actor: me, tradeCode: l.from_code, action: 'lien.grace-escalated', detail: { lienId: id, auto: false } });
      return { out: { escalatedAt: now.toISOString() }, told };
    });
    if (o.push !== undefined) for (const who of out.told) await o.push.send(who, 'alert').catch(() => false);
    return out.out;
  });
}

export function accountLienGraceRoutes(app: FastifyInstance): void {
  app.post('/v1/account/liens/:id/paid', { preHandler: [requireSession({ kinds: ['trader'] }), ownerDeviceOnly, requireNotHeld] }, async (req) => {
    const id = lienParam(req);
    bodyOf(req, []);
    const me = req.auth.accountId;
    const { db, clock } = req.server.deps;
    return withTx(db, async (c) => {
      const now = clock();
      // It ends what the creditor is owed: the session must still be live, under the account lock.
      await requireLiveSessionInTx(c, req.auth, now);
      const l = await lockLien(c, id);
      // Only the person owed: anyone else (the debtor included) is told nothing about it.
      if (l === undefined || l.creditor !== me) throw new ApiError(404, 'not-found');
      // Review item 3 (lead default): never while an appeal holds the lien (`suspended`).
      if (l.status !== 'active' || !waitingGrace(l)) throw new ApiError(409, 'wrong-state');
      const side = (
        await c.query<{ side: 'buyer' | 'seller' }>(`select case when buyer_account_id = $2 then 'buyer' else 'seller' end as side from trades where code = $1`, [l.from_code, me])
      ).rows[0]?.side;
      return endOffPlatform(c, id, l, now, side === undefined ? { kind: 'system' } : { kind: 'trader', side });
    });
  });
}

/**
 * Ends lien `id` (locked as `l`) as settled in full off the platform: open holds that stopped
 * counting are released first and one that still counts refuses it (`lien-recovery-in-flight`, as
 * `complied`, review M2). A lien that also carries X2F's 1% stays active recovering nothing more
 * (NEEDS_OWNER_LIEN_FEE_AFTER_COMPLY); otherwise it is repaid. Logged `lien.repaid-off-platform`.
 */
async function endOffPlatform(c: pg.PoolClient, id: string, l: LockedLien, now: Date, actor: Parameters<typeof appendLog>[1]['actor']) {
  for (const h of await releaseStaleHolds(c, now, id)) {
    await appendLog(c, { at: now, actor: { kind: 'system' }, tradeCode: h.tradeCode, action: 'lien.recovery-released', detail: { lienId: h.lienId, amountAtomic: h.amountAtomic } });
  }
  const open = await c.query(`select 1 from lien_recovery_holds where lien_id = $1 and status = 'open' limit 1`, [id]);
  if ((open.rowCount ?? 0) > 0) throw new ApiError(409, 'lien-recovery-in-flight');
  const ends = BigInt(l.fee_atomic) === 0n;
  await c.query(
    `update liens set repaid_off_platform_at = $2${ends ? `, status = 'repaid', changed_at = $2, lifted_at = $2` : ''} where id = $1`,
    [id, now],
  );
  await appendLog(c, { at: now, actor, tradeCode: l.from_code, action: 'lien.repaid-off-platform', detail: { lienId: id } });
  return { status: ends ? 'repaid' : 'active', repaidOffPlatformAt: now.toISOString() };
}
