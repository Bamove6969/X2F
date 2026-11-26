import { createHash } from 'node:crypto';
import {
  AFTER_REFUND_OUTCOMES,
  ESCROW_OUTCOMES,
  DisputeRuleError,
  applyDispute,
  evidenceSha256,
  type AccountAction,
  type Dispute,
  type GateValue,
  type KeyTapIntent,
  type RulingOutcome,
} from '@x2f/staff';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { ApiError } from '../errors.js';
import { PUBLIC_NAME_COLUMN } from '../events/publicName.js';
import type { EventBus } from '../events/bus.js';
import { appendLog } from '../log/append.js';
import { consumeKeyTap } from '../staff/keyTap.js';
import { requireStaff } from '../staff/guard.js';
import { disputeSettings } from './settings.js';
import { gateValueOf, withDispute, type DisputeRecord } from './store.js';
import { tradeHeldSql } from '../tickets/held.js';
import { rulingExtras } from './rulingDrafts.js';
import { actorOf, body as bodyOf, codeOf as caseCodeOf, ruleError } from './staffRoutes.js';

/**
 * Plan 4 Task 12: the staff ruling routes (J-06).
 *
 * - `POST /staff/v1/disputes/:code/rulings {rulingId, outcome, accountAction, reason, evidence,
 *   tapId}` (perm `disputes.handle`): the assignee proposes. The security-key tap must be the
 *   caller's own, made for exactly this ruling (`ruling` intent, step `propose`: the ruling id, the
 *   trade, the round, the outcome, the account action, the trade's XMR, the SHA-256 of the
 *   reason's UTF-8 bytes and, review mod-screens M1, `evidenceSha256` of the evidence lines as
 *   stored); anything else is 403 `tap-invalid` and nothing is written (the tap stays
 *   unused). Under the large-trade limit it is published at once (round 1: the 48-hour appeal window
 *   opens; round 2: it is final). At or above it, it waits for a second person.
 * - `POST …/rulings/:id/approve {tapId}` (perm `rulings.approve`, a senior moderator or the owner,
 *   never the proposer, never anyone involved in round 1 for an appeal): the same content tapped
 *   again with step `approve`; it publishes.
 * - `POST …/rulings/:id/send-back {note}` (perm `rulings.approve`): back to the proposer with a
 *   staff-only note. No tap: it publishes nothing and only takes a proposal away.
 *
 * Lead call Q3 (12 Nov): no reviewer list here. `GET …/appeal-reviewers` is wip/lead-appeals'
 * (owner-only, refused to anyone involved, never logged, R37); if rulings needs the list, call that
 * branch's `eligibleReviewers` helper.
 *
 * Lead call Q1 (12 Nov): propose, approve and send-back are refused while maintenance pauses the
 * dispute or the site's maintenance switch is on (409 `dispute-paused`: the freeze route's
 * `paused_since` gate, and `site_flags.maintenance_since`, so nothing gets through before the timer
 * marks the dispute paused) and during the emergency
 * stop (409 `trading-paused`, `site_flags.trading_paused` read `for share`, so a stop being set waits
 * for the ruling or is seen by it). Refused before the tap, so the tap stays unused.
 *
 * Every change goes through `withDispute` and the dispute machine, so the two-person rule, R37 and
 * the deadlines are the machine's, and the liens (Task 25), the reviews' erasure on an overturn and
 * anything else hooked there follow by themselves. The reason and evidence stay staff-only in
 * `ruling_drafts` (401) until published, then go to the trader-visible `dispute_rulings`.
 *
 * Account actions on the ruling card are refused (409 `account-action-unavailable`): a freeze is a
 * separate act, never on the ruling card (owner D-015), and so is a ban. Task 27's ban stages are on
 * this branch (`account_bans`, staff/bans.ts): a senior moderator or the owner bans a party with its
 * own tapped act, `POST /staff/v1/accounts/:id/bans` (the `ban-account` tap binds the account, the
 * ban, its kind, D-017's rule and its end; D-017's offence count and term rules are checked there).
 * Lead default, owner question (bans onto main, 21 Nov): the ruling card does not carry a ban.
 * `AccountAction`'s ban shape names neither the party to ban nor D-017's rule, and a ruling's taps
 * (re-verified by the moderation gate) would then also be a ban's; until the owner says a ruling
 * should ban, and whom, every ruling here carries `{kind: 'none'}`. If it should, `publishDecided`
 * calls staff/bans.ts's own insert in this transaction, never a copy of it.
 *
 * Plan 4 Task 13: the moderation process's ruling gate (`apps/moderation/src/gate`) re-verifies these
 * taps itself, against the owner's pinned keys, and computes the payouts from its own records; it
 * reads the ruling, its taps and the reason through `x2f_mod_reader` (migration 211). Plan 4 Task 14:
 * its executor pays a published round-1 escrow ruling, and the dispute records the execution when
 * the watcher reports the payout (disputes/execution.ts). The seller's payment proof for
 * `seller-sends-xmr` (A6) is disputes/comply.ts.
 */

/** Plan 4 Task 12: a ruling's reason is at least 40 characters (and at most 108's 4000). */
export const REASON_MIN = 40;
export const REASON_MAX = 4000;
/** Evidence lines the traders read (lead default): up to 10, each 1 to 200 characters. */
export const EVIDENCE_MAX = 10;
export const EVIDENCE_LINE_MAX = 200;
export const SEND_BACK_NOTE_MAX = 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;
/** A lone (unpaired) surrogate: in `u` mode a valid pair is one code point and never matches. */
const LONE_SURROGATE = /\p{Surrogate}/u;
const OUTCOMES: readonly string[] = [...ESCROW_OUTCOMES, ...AFTER_REFUND_OUTCOMES];
const NONE: AccountAction = { kind: 'none' };

/** The SHA-256 of a reason's UTF-8 bytes, lower-case hex: the `reasonSha256` its taps bind. */
export const reasonSha256 = (reason: string): string => createHash('sha256').update(reason, 'utf8').digest('hex');

// Re-verify E3: no lone surrogate in any text a ruling stores (reason, evidence, send-back note): the
// database would keep U+FFFD in its place, which is not the text a tap's hash was taken over.
const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max && !CONTROL.test(v) && !LONE_SURROGATE.test(v);

function parseEvidence(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > EVIDENCE_MAX) throw new ApiError(400, 'bad-request');
  // Re-verify E3: `isText` refuses a lone surrogate, which jsonb cannot store (a 500 after the tap check).
  for (const x of v) if (!isText(x, EVIDENCE_LINE_MAX) || x.trim() === '') throw new ApiError(400, 'bad-request');
  return [...(v as string[])];
}

/** The account action as sent: only its shape here; anything but `none` is refused after. */
function parseAction(v: unknown): AccountAction {
  if (v === null || typeof v !== 'object' || Array.isArray(v) || typeof (v as { kind?: unknown }).kind !== 'string') throw new ApiError(400, 'bad-request');
  const kind = (v as { kind: string }).kind;
  if (kind === 'none' && Object.keys(v).length === 1) return NONE;
  if (kind === 'none' || !['freeze', 'trade-ban', 'site-ban'].includes(kind)) throw new ApiError(400, 'bad-request');
  return v as AccountAction;
}

interface DraftRow {
  ruling_id: string;
  round: 1 | 2;
  reason: string;
  evidence: string[];
  proposer: string;
  proposed_at: Date;
  status: 'proposed' | 'published' | 'sent-back';
}

async function tradeAmount(client: pg.PoolClient, code: string): Promise<string> {
  const { rows } = await client.query<{ amount_atomic: string }>('select amount_atomic::text from trades where code = $1', [code]);
  if (!rows[0]) throw new ApiError(404, 'not-found');
  return rows[0].amount_atomic;
}

/**
 * Review p4t22 M1: the ruling gate's inputs for the trade (`gateValueOf`): its XMR and locked rate
 * from the trade row, and the large-trade limit in the settings now.
 */
async function gateValue(client: pg.PoolClient, code: string, largeTradeLimitUsd: number): Promise<GateValue> {
  const { rows } = await client.query<{ amount_atomic: string; currency: string; cents: string }>(
    'select amount_atomic::text, locked_currency as currency, locked_cents_per_xmr::text as cents from trades where code = $1',
    [code],
  );
  const r = rows[0];
  if (!r) throw new ApiError(404, 'not-found');
  return gateValueOf({ amountAtomic: BigInt(r.amount_atomic), lockedRate: { currency: r.currency, centsPerXmr: BigInt(r.cents) } }, largeTradeLimitUsd);
}

/** `round1Id`: round 2's taps name the round-1 ruling they review (mod-gate review B2); null in round 1. */
const rulingIntent = (step: 'propose' | 'approve', a: { rulingId: string; code: string; round: 1 | 2; round1Id: string | null; outcome: RulingOutcome; amountAtomic: string; reason: string; evidence: readonly string[] }): KeyTapIntent => ({
  kind: 'ruling',
  step,
  rulingId: a.rulingId,
  code: a.code,
  round: a.round,
  outcome: a.outcome,
  accountAction: NONE,
  amountAtomic: a.amountAtomic,
  reasonSha256: reasonSha256(a.reason),
  // Review mod-screens M1: rebuilt from the lines this ruling stores (propose: the body's, as stored;
  // approve: the draft's), so a tap made for other evidence is tap-invalid.
  evidenceSha256: evidenceSha256(a.evidence),
  round1Id: a.round === 2 ? a.round1Id : null,
});

const rulingDetail = (r: { id: string; outcome: RulingOutcome }, round: 1 | 2, amountAtomic: string) => ({
  rulingId: r.id, round, outcome: r.outcome, accountAction: 'none', amountAtomic,
});

/** Whether `prev` → `next` decided the round: round 1 published, or round 2 final. */
const decided = (prev: Dispute, next: Dispute) =>
  next.round === 1
    ? next.status === 'published' && prev.status !== 'published'
    : ['final', 'complying', 'closed'].includes(next.status) && !['final', 'complying', 'closed'].includes(prev.status);

/**
 * The decided round, in the change's own transaction: the trader-visible ruling (`dispute_rulings`)
 * with the proposer's public name, the draft marked published, `ruling.published` and, for round 2,
 * `ruling.final` ("Decision overruled" when it differs from round 1). The payout is the moderation
 * process's (Plan 4 Task 14), recorded on the watcher's report (disputes/execution.ts).
 */
async function publishDecided(client: pg.PoolClient, next: Dispute, draft: DraftRow, amountAtomic: string, now: Date, actor: ReturnType<typeof actorOf>): Promise<void> {
  const r = next.ruling!;
  const name = (await client.query<{ name: string }>(`select ${PUBLIC_NAME_COLUMN} as name from accounts where id = $1`, [r.proposer])).rows[0]?.name;
  if (name === undefined) throw new Error('rulings: the proposer has no account');
  await client.query(
    `insert into dispute_rulings (code, seq, round, outcome, reason, evidence, moderator_name, ruled_at, appeal_until)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [next.code, next.seq, next.round, r.outcome, draft.reason, JSON.stringify(draft.evidence), name, now, next.round === 1 ? next.appealEndsAt : null],
  );
  await client.query(`update ruling_drafts set status = 'published', decided_by = $2, decided_at = $3 where ruling_id = $1`, [r.id, actor.id, now]);
  await appendLog(client, { at: now, actor, tradeCode: next.code, action: 'ruling.published', detail: rulingDetail(r, next.round, amountAtomic) });
  if (next.round === 2) {
    await appendLog(client, { at: now, actor, tradeCode: next.code, action: 'ruling.final', detail: { rulingId: r.id, round: 2, overturned: next.overturned === true } });
  }
}

/**
 * Lead call Q1: no ruling work while maintenance pauses the dispute (the freeze route's gate) or the
 * site's maintenance switch is on, or during the emergency stop. A missing site_flags row counts as
 * both (as the offers' guard).
 */
async function assertNotPaused(client: pg.PoolClient, rec: DisputeRecord): Promise<void> {
  if (rec.pausedSince !== null) throw new ApiError(409, 'dispute-paused');
  // D-059 (J-14 re-verify M1, ported): a compromised-account lock on either party holds the trade
  // from the lock's commit on, before the dispute timers' next pass sets `paused_since`.
  const held = await client.query<{ held: boolean }>(`select ${tradeHeldSql('t')} as held from trades t where t.code = $1`, [rec.dispute.code]);
  if (held.rows[0]?.held === true) throw new ApiError(409, 'dispute-paused');
  // Lead follow-up: the site's maintenance switch too, so nothing gets through before the timer
  // has marked the dispute paused. Both flags `for share`: a switch being set waits for this or is seen.
  const { rows } = await client.query<{ paused: boolean; maintenance: boolean }>(
    'select trading_paused as paused, maintenance_since is not null as maintenance from site_flags for share',
  );
  const f = rows[0];
  if (f === undefined || f.maintenance) throw new ApiError(409, 'dispute-paused');
  if (f.paused !== false) throw new ApiError(409, 'trading-paused');
}

/** The moderation gate's latest report on this trade's rulings (`ruling.gate-refused`), or null. */
async function latestRefusal(client: pg.PoolClient, code: string): Promise<{ rulingId?: unknown; reason?: unknown } | null> {
  const last = await client.query<{ detail: string }>(
    "select detail from activity_log where trade_code = $1 and action = 'ruling.gate-refused' order by id desc limit 1",
    [code],
  );
  return last.rows[0] === undefined ? null : (JSON.parse(last.rows[0].detail) as { rulingId?: unknown; reason?: unknown });
}

function rulingError(err: unknown): never {
  if (err instanceof DisputeRuleError) {
    if (err.code === 'same-person') throw new ApiError(409, 'same-person');
    if (err.code === 'invalid-action') throw new ApiError(400, 'bad-request');
  }
  return ruleError(err);
}

export interface StaffRulingDeps {
  traderEvents?: Pick<EventBus, 'publish'>;
}

export function staffRulingRoutes(app: FastifyInstance, o: StaffRulingDeps = {}): void {
  const handle = { preHandler: requireStaff('disputes.handle'), config: { perm: 'disputes.handle' as const } };
  const approver = { preHandler: requireStaff('rulings.approve'), config: { perm: 'rulings.approve' as const } };
  const disputeDeps = (req: FastifyRequest) => ({
    db: req.server.deps.db,
    clock: req.server.deps.clock,
    ...(o.traderEvents ? { events: o.traderEvents } : {}),
    // Owner 26 Nov: both traders are alerted when a ruling is published (the push names no trade).
    push: req.server.push,
  });

  app.post('/staff/v1/disputes/:code/rulings', handle, async (req) => {
    const b = bodyOf(req, ['rulingId', 'outcome', 'accountAction', 'reason', 'evidence', 'tapId']);
    if (typeof b.rulingId !== 'string' || !UUID.test(b.rulingId)) throw new ApiError(400, 'bad-request');
    if (typeof b.outcome !== 'string' || !OUTCOMES.includes(b.outcome)) throw new ApiError(400, 'bad-request');
    if (!isText(b.reason, REASON_MAX)) throw new ApiError(400, 'bad-request');
    if (typeof b.tapId !== 'string') throw new ApiError(400, 'bad-request');
    const action = parseAction(b.accountAction);
    const evidence = parseEvidence(b.evidence);
    const reason = b.reason;
    if (reason.trim().length < REASON_MIN) throw new ApiError(400, 'reason-too-short');
    const rulingId = b.rulingId;
    const outcome = b.outcome as RulingOutcome;
    const tapId = b.tapId;
    const code = await caseCodeOf(req.server.deps.db, req);
    // D-015 and Task 27: no account action on the ruling card (see the top).
    if (action.kind !== 'none') throw new ApiError(409, 'account-action-unavailable');
    const me = actorOf(req);
    try {
      await withDispute(disputeDeps(req), { code }, async (d, client, now, rec) => {
        await assertNotPaused(client, rec);
        const amountAtomic = await tradeAmount(client, code);
        // The tap first: a tap that is not for exactly this ruling writes nothing.
        await consumeKeyTap(client, tapId, me.id, rulingIntent('propose', { rulingId, code, round: d.round, round1Id: d.round1?.id ?? null, outcome, amountAtomic, reason, evidence }), now, { sessionId: req.auth.sessionId });
        const s = await disputeSettings(client);
        // Review p4t22 M1: never publish on one tap a ruling the gate would refuse (`needs-second`).
        const gate = await gateValue(client, code, s.largeTradeLimitUsd);
        const next = applyDispute(d, { type: 'propose', gate, ruling: { id: rulingId, outcome, accountAction: NONE, proposer: me.id } }, me, now, s);
        const ins = await client.query(
          `insert into ruling_drafts (ruling_id, code, seq, round, reason, evidence, proposer, proposed_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict do nothing`,
          [rulingId, code, d.seq, d.round, reason, JSON.stringify(evidence), me.id, now],
        );
        if (ins.rowCount !== 1) throw new ApiError(409, 'wrong-state');
        await appendLog(client, { at: now, actor: me, tradeCode: code, action: 'ruling.proposed', detail: rulingDetail({ id: rulingId, outcome }, d.round, amountAtomic) });
        if (decided(d, next)) {
          await publishDecided(client, next, { ruling_id: rulingId, round: d.round, reason, evidence, proposer: me.id, proposed_at: now, status: 'proposed' }, amountAtomic, now, me);
        }
        return next;
      });
    } catch (err) {
      rulingError(err);
    }
    return rulingState(req, code);
  });

  /** The waiting proposal `:id` of the dispute's current round, locked; 409 `wrong-state` otherwise. */
  async function waiting(client: pg.PoolClient, d: Dispute, id: unknown): Promise<DraftRow> {
    if (typeof id !== 'string' || !UUID.test(id) || d.status !== 'awaiting-approval' || d.ruling?.id !== id) throw new ApiError(409, 'wrong-state');
    const { rows } = await client.query<DraftRow>(
      `select ruling_id::text, round, reason, evidence, proposer::text, proposed_at, status from ruling_drafts
        where ruling_id = $1 and code = $2 and seq = $3 and round = $4 and status = 'proposed' for update`,
      [id, d.code, d.seq, d.round],
    );
    if (!rows[0]) throw new ApiError(409, 'wrong-state');
    return rows[0];
  }

  app.post('/staff/v1/disputes/:code/rulings/:id/approve', approver, async (req) => {
    const b = bodyOf(req, ['tapId']);
    if (typeof b.tapId !== 'string') throw new ApiError(400, 'bad-request');
    const tapId = b.tapId;
    const code = await caseCodeOf(req.server.deps.db, req);
    const me = actorOf(req);
    try {
      await withDispute(disputeDeps(req), { code }, async (d, client, now, rec) => {
        await assertNotPaused(client, rec);
        const draft = await waiting(client, d, (req.params as { id?: unknown }).id);
        const amountAtomic = await tradeAmount(client, code);
        const r = d.ruling!;
        await consumeKeyTap(client, tapId, me.id, rulingIntent('approve', { rulingId: r.id, code, round: d.round, round1Id: d.round1?.id ?? null, outcome: r.outcome, amountAtomic, reason: draft.reason, evidence: draft.evidence }), now, { sessionId: req.auth.sessionId });
        const next = applyDispute(d, { type: 'approve' }, me, now, await disputeSettings(client));
        await appendLog(client, { at: now, actor: me, tradeCode: code, action: 'ruling.approved', detail: rulingDetail(r, d.round, amountAtomic) });
        if (decided(d, next)) await publishDecided(client, next, draft, amountAtomic, now, me);
        return next;
      });
    } catch (err) {
      rulingError(err);
    }
    return rulingState(req, code);
  });

  /**
   * Review p4t22 M1 (e), the rescue for a dispute already stuck: `POST …/rulings/:id/second-approval
   * {tapId}` (perm `rulings.approve`). A round-1 ruling published on one tap that the moderation gate
   * refuses for want of a second person (its latest report for this dispute is `needs-second` for
   * this very ruling: 409 `not-refused` otherwise) gets a senior moderator's or the owner's approval,
   * never the proposer's (409 `same-person`), before its payout ran. The tap is exactly an `approve`
   * tap of this ruling, over its published reason and evidence: the key signs nothing a normal
   * approval would not, and the gate re-verifies it like any other. The machine's `second-approve`
   * records the approver; during an appeal it joins round 1's signers (R37). Logged as
   * `ruling.second-approved`. Refused while paused or stopped, before the tap (lead call Q1).
   */
  app.post('/staff/v1/disputes/:code/rulings/:id/second-approval', approver, async (req) => {
    const b = bodyOf(req, ['tapId']);
    if (typeof b.tapId !== 'string') throw new ApiError(400, 'bad-request');
    const tapId = b.tapId;
    const id = (req.params as { id?: unknown }).id;
    const code = await caseCodeOf(req.server.deps.db, req);
    const me = actorOf(req);
    try {
      await withDispute(disputeDeps(req), { code }, async (d, client, now, rec) => {
        await assertNotPaused(client, rec);
        const r1 = d.round === 1 ? d.ruling : d.round1;
        if (typeof id !== 'string' || !UUID.test(id) || r1 === null || r1.id !== id) throw new ApiError(409, 'wrong-state');
        const refused = await latestRefusal(client, code);
        if (refused === null || refused.rulingId !== id || refused.reason !== 'needs-second') throw new ApiError(409, 'not-refused');
        const pub = await client.query<{ reason: string; evidence: string[] }>(
          'select reason, evidence from dispute_rulings where code = $1 and seq = $2 and round = 1',
          [code, d.seq],
        );
        const p = pub.rows[0];
        if (!p) throw new ApiError(409, 'wrong-state');
        const amountAtomic = await tradeAmount(client, code);
        // The machine first (who may, and whether it is still open), so a refused rescue leaves the tap unused.
        const next = applyDispute(d, { type: 'second-approve' }, me, now, await disputeSettings(client));
        await consumeKeyTap(client, tapId, me.id, rulingIntent('approve', { rulingId: r1.id, code, round: 1, round1Id: null, outcome: r1.outcome, amountAtomic, reason: p.reason, evidence: p.evidence }), now, { sessionId: req.auth.sessionId });
        await appendLog(client, { at: now, actor: me, tradeCode: code, action: 'ruling.second-approved', detail: rulingDetail(r1, 1, amountAtomic) });
        return next;
      });
    } catch (err) {
      rulingError(err);
    }
    return rulingState(req, code);
  });

  /**
   * Review p4t22 N1, the re-proposal: `POST …/rulings/:id/re-propose {rulingId, outcome,
   * accountAction, reason, evidence, tapId}` (perm `rulings.approve`, a senior moderator or the
   * owner). A published round-1 escrow ruling that the moderation gate refuses as `revoked` (its
   * latest report for this dispute is `revoked` for this very ruling: 409 `not-refused` otherwise;
   * its signer was switched off, removed, or (review p4t22 F1 twin: the gate reports a key it retired
   * at a security reset as `revoked` too) reset before the payout ran) is replaced by the caller's own
   * new round-1 ruling, before any appeal and before the payout ran (the machine's `re-propose`).
   * Exactly a normal proposal otherwise: a new ruling id, the caller's own `propose` tap for it
   * (rebuilt here as the proposal route does; anything else is 403 `tap-invalid`), the same
   * two-person rule (published at once with a fresh appeal window, or waiting for a normal
   * `…/approve`). The key signs nothing a proposal would not, and the gate verifies it like one: a
   * new round-1 ruling it never saw, never the withdrawn one. The withdrawn ruling's trader-visible
   * row goes; it is logged as `ruling.re-proposed` (the new id, and the one it `replaces`).
   * Refused while paused or stopped, before the tap (lead call Q1). Never on an after-refund
   * dispute (lead default, owner question).
   */
  app.post('/staff/v1/disputes/:code/rulings/:id/re-propose', approver, async (req) => {
    const b = bodyOf(req, ['rulingId', 'outcome', 'accountAction', 'reason', 'evidence', 'tapId']);
    if (typeof b.rulingId !== 'string' || !UUID.test(b.rulingId)) throw new ApiError(400, 'bad-request');
    if (typeof b.outcome !== 'string' || !OUTCOMES.includes(b.outcome)) throw new ApiError(400, 'bad-request');
    if (!isText(b.reason, REASON_MAX)) throw new ApiError(400, 'bad-request');
    if (typeof b.tapId !== 'string') throw new ApiError(400, 'bad-request');
    const action = parseAction(b.accountAction);
    const evidence = parseEvidence(b.evidence);
    const reason = b.reason;
    if (reason.trim().length < REASON_MIN) throw new ApiError(400, 'reason-too-short');
    if (action.kind !== 'none') throw new ApiError(409, 'account-action-unavailable');
    const rulingId = b.rulingId;
    const outcome = b.outcome as RulingOutcome;
    const tapId = b.tapId;
    const id = (req.params as { id?: unknown }).id;
    const code = await caseCodeOf(req.server.deps.db, req);
    const me = actorOf(req);
    try {
      await withDispute(disputeDeps(req), { code }, async (d, client, now, rec) => {
        await assertNotPaused(client, rec);
        if (typeof id !== 'string' || !UUID.test(id) || d.round !== 1 || d.ruling === null || d.ruling.id !== id) throw new ApiError(409, 'wrong-state');
        const refused = await latestRefusal(client, code);
        if (refused === null || refused.rulingId !== id || refused.reason !== 'revoked') throw new ApiError(409, 'not-refused');
        const s = await disputeSettings(client);
        const gate = await gateValue(client, code, s.largeTradeLimitUsd);
        // The machine first (who may, and whether it is still open), so a refused re-proposal leaves the tap unused.
        const next = applyDispute(d, { type: 're-propose', gate, ruling: { id: rulingId, outcome, accountAction: NONE, proposer: me.id } }, me, now, s);
        const amountAtomic = await tradeAmount(client, code);
        await consumeKeyTap(client, tapId, me.id, rulingIntent('propose', { rulingId, code, round: 1, round1Id: null, outcome, amountAtomic, reason, evidence }), now, { sessionId: req.auth.sessionId });
        const ins = await client.query(
          `insert into ruling_drafts (ruling_id, code, seq, round, reason, evidence, proposer, proposed_at)
           values ($1, $2, $3, 1, $4, $5, $6, $7) on conflict do nothing`,
          [rulingId, code, d.seq, reason, JSON.stringify(evidence), me.id, now],
        );
        if (ins.rowCount !== 1) throw new ApiError(409, 'wrong-state');
        // The withdrawn round 1 is no longer the traders' ruling; the new one is, once published.
        await client.query('delete from dispute_rulings where code = $1 and seq = $2 and round = 1', [code, d.seq]);
        await appendLog(client, { at: now, actor: me, tradeCode: code, action: 'ruling.re-proposed', detail: { ...rulingDetail({ id: rulingId, outcome }, 1, amountAtomic), replaces: id } });
        if (next.status === 'published') {
          await publishDecided(client, next, { ruling_id: rulingId, round: 1, reason, evidence, proposer: me.id, proposed_at: now, status: 'proposed' }, amountAtomic, now, me);
        }
        return next;
      });
    } catch (err) {
      rulingError(err);
    }
    return rulingState(req, code);
  });

  app.post('/staff/v1/disputes/:code/rulings/:id/send-back', approver, async (req) => {
    const b = bodyOf(req, ['note']);
    if (!isText(b.note, SEND_BACK_NOTE_MAX) || b.note.trim() === '') throw new ApiError(400, 'bad-request');
    const note = b.note;
    const code = await caseCodeOf(req.server.deps.db, req);
    const me = actorOf(req);
    try {
      await withDispute(disputeDeps(req), { code }, async (d, client, now, rec) => {
        await assertNotPaused(client, rec);
        const draft = await waiting(client, d, (req.params as { id?: unknown }).id);
        const next = applyDispute(d, { type: 'send-back' }, me, now, await disputeSettings(client));
        await client.query(
          `update ruling_drafts set status = 'sent-back', decided_by = $2, decided_at = $3, sent_back_note = $4 where ruling_id = $1`,
          [draft.ruling_id, me.id, now, note],
        );
        await appendLog(client, { at: now, actor: me, tradeCode: code, action: 'ruling.sent-back', detail: { rulingId: draft.ruling_id } });
        return next;
      });
    } catch (err) {
      rulingError(err);
    }
    return rulingState(req, code);
  });
}

/** The ruling part of the case after a change (the same as the case view's `ruling` extras). */
async function rulingState(req: FastifyRequest, code: string) {
  return { code, ruling: await rulingExtras(req.server.deps.db, code) };
}
