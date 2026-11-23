// Review p4t22 M1 (d) and (e): the moderation ruling gate's refusal of a ruling reaches the staff
// case view (internal `ruling-refused`, the `ruling-wait` pattern), and a ruling already published
// on one tap that the gate refuses `needs-second` can get a second person's tap (the rescue). The
// tap is exactly an `approve` tap of that ruling: nothing a normal approval would not sign.
import { createHash, randomUUID } from 'node:crypto';
import { evidenceSha256, type KeyTapIntent, type RulingOutcome } from '@x2f/staff';
import { INTERNAL_AT_HEADER, INTERNAL_SIG_HEADER, internalSignedBytes, type Trade } from '@x2f/trade';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import sodium from 'libsodium-wrappers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../../src/app.js';
import { NO_MODERATION } from '../../src/disputes/moderationClient.js';
import { loadDispute } from '../../src/disputes/store.js';
import { buildInternalListener } from '../../src/internal/routes.js';
import { buildStaffApi } from '../../src/staff/app.js';
import { seedAccount } from '../helpers/accounts.js';
import { testApp } from '../helpers/app.js';
import { appealDirect, publishRuling } from '../helpers/disputes.js';
import { STAFF_ORIGIN, StaffBrowser, insertSession, seedStaff, seedTap } from '../helpers/staffApp.js';
import { driveTo, fakeAddress, seedTrade } from '../helpers/trades.js';

let app: FastifyInstance;
let staffApp: FastifyInstance;
let deps: Deps;
let internal: FastifyInstance;
let modSecret: Uint8Array;
let reqSeq = 0;
let n = 0;
const NOW = new Date('2026-11-23T12:00:00Z');
const ESCROW = fakeAddress();

const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex');
async function signed(path: string, body: unknown): Promise<LightMyRequestResponse> {
  const payload = JSON.stringify(body);
  const at = NOW.getTime() + ++reqSeq;
  const sig = sodium.crypto_sign_detached(internalSignedBytes({ method: 'POST', path, at, bodyHash: sha256Hex(payload) }), modSecret);
  return internal.inject({
    method: 'POST',
    url: path,
    headers: { [INTERNAL_AT_HEADER]: String(at), [INTERNAL_SIG_HEADER]: sodium.to_base64(sig, sodium.base64_variants.ORIGINAL), 'content-type': 'application/json' },
    payload,
  });
}
const report = (body: unknown) => signed('/internal/v1/reports', body);

beforeAll(async () => {
  await sodium.ready;
  ({ app, deps } = await testApp());
  staffApp = await buildStaffApi({ ...deps, staffOrigin: STAFF_ORIGIN, moderation: NO_MODERATION });
  const kp = sodium.crypto_sign_keypair();
  modSecret = kp.privateKey;
  internal = await buildInternalListener({ db: deps.db, modSigningPublic: sodium.to_hex(kp.publicKey), now: () => NOW.getTime(), clock: () => NOW, publish: () => {} });
});
afterAll(async () => {
  await internal.close();
  await staffApp.close();
  await app.close();
});

async function trade(): Promise<Trade> {
  const sellerId = await seedAccount(deps, { loginName: `gr${String(++n).padStart(4, '0')}s` });
  const buyerId = await seedAccount(deps, { loginName: `gr${String(n).padStart(4, '0')}b` });
  const { trade: t } = await seedTrade(deps, { sellerId, buyerId, poster: 'seller' });
  await deps.db.query(`insert into trade_attestations (code, attestation, sig, created_at) values ($1, '{}'::jsonb, 'x', now())`, [t.code]);
  return t;
}

/** A disputed trade whose round-1 ruling was published on one moderator's tap. */
async function ruled(outcome: RulingOutcome = 'release-to-buyer', staffId?: string) {
  const t = await trade();
  await driveTo(deps, t, 'settling', ESCROW);
  expect((await report({ kind: 'spend-unshown', trade: t.code })).statusCode).toBe(201);
  const d = await publishRuling(deps, t.code, { outcome, ...(staffId === undefined ? {} : { staffId }) });
  return { t, rulingId: d.ruling!.id, proposer: d.ruling!.proposer };
}

/** The one owner account (`one_owner`), seeded once. */
let ownerStaff: { id: string } | null = null;
async function staff(role: 'mod' | 'senior' | 'owner') {
  const s = role === 'owner' ? (ownerStaff ??= await seedStaff(deps, { role })) : await seedStaff(deps, { role });
  return { id: s.id, b: new StaffBrowser(staffApp).withSession((await insertSession(deps, s.id, 'staff')).token) };
}

type Refusal = { rulingId: string; reason: string; since: string; secondApproval: { rulingId: string; outcome: string; reason: string; evidence: string[] } | null; rePropose: { rulingId: string } | null } | null;
const caseView = async (code: string): Promise<Refusal> => {
  const s = await staff('senior');
  const res = await s.b.get(`/staff/v1/disputes/${code}`);
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { ruling: { gateRefusal: Refusal } }).ruling.gateRefusal;
};

const refusals = async (code: string) =>
  (await deps.db.query<{ detail: string; actor_kind: string }>(`select detail, actor_kind from activity_log where trade_code = $1 and action = 'ruling.gate-refused' order by id`, [code])).rows.map((r) => ({
    actor: r.actor_kind,
    ...(JSON.parse(r.detail) as object),
  }));

/** The approve tap of the published round-1 ruling, over its published reason and evidence. */
async function approveTap(who: { id: string }, code: string, rulingId: string, o: { outcome?: RulingOutcome; reason?: string } = {}): Promise<string> {
  const { rows } = await deps.db.query<{ reason: string; evidence: string[]; outcome: RulingOutcome }>('select reason, evidence, outcome from dispute_rulings where code = $1 and round = 1', [code]);
  const p = rows[0]!;
  const t = await deps.db.query<{ amount: string }>('select amount_atomic::text as amount from trades where code = $1', [code]);
  const intent: KeyTapIntent = {
    kind: 'ruling', step: 'approve', rulingId, code, round: 1, outcome: o.outcome ?? p.outcome, accountAction: { kind: 'none' },
    amountAtomic: t.rows[0]!.amount, reasonSha256: sha256Hex(o.reason ?? p.reason), evidenceSha256: evidenceSha256(p.evidence), round1Id: null,
  };
  return seedTap(deps, who.id, intent);
}
const used = async (tapId: string) => (await deps.db.query<{ used: boolean }>('select used_at is not null as used from key_taps where id = $1', [tapId])).rows[0]?.used;
const rescue = (who: { b: StaffBrowser }, code: string, rulingId: string, tapId: string) =>
  who.b.post(`/staff/v1/disputes/${code}/rulings/${rulingId}/second-approval`, { tapId });

describe('ruling-refused: the gate says why it will not act on a ruling', () => {
  it('each change is logged once by the system and shown on the case view; a repeat changes nothing; null clears it', async () => {
    const { t, rulingId } = await ruled();
    expect(await caseView(t.code)).toBeNull();
    expect((await report({ kind: 'ruling-refused', trade: t.code, rulingId, reason: null })).statusCode).toBe(201);
    expect(await refusals(t.code)).toEqual([]);
    const r = await report({ kind: 'ruling-refused', trade: t.code, rulingId, reason: 'needs-second' });
    expect([r.statusCode, r.json()]).toEqual([201, { ok: true }]);
    expect((await report({ kind: 'ruling-refused', trade: t.code, rulingId, reason: 'needs-second' })).statusCode).toBe(201);
    expect(await refusals(t.code)).toEqual([{ actor: 'system', rulingId, reason: 'needs-second' }]);
    const view = await caseView(t.code);
    expect(view).toMatchObject({ rulingId, reason: 'needs-second', since: NOW.toISOString() });
    expect(view?.secondApproval).toMatchObject({ rulingId, outcome: 'release-to-buyer', reason: "The payment is in the seller's activity.", evidence: ['The trade chat'] });
    expect((await report({ kind: 'ruling-refused', trade: t.code, rulingId, reason: 'stopped' })).statusCode).toBe(201);
    expect(await caseView(t.code)).toMatchObject({ reason: 'stopped', secondApproval: null });
    expect((await report({ kind: 'ruling-refused', trade: t.code, rulingId, reason: null })).statusCode).toBe(201);
    expect(await caseView(t.code)).toBeNull();
    expect((await refusals(t.code)).map((x) => (x as unknown as { reason: string }).reason)).toEqual(['needs-second', 'stopped', 'none']);
  });

  it('refuses a bad body, an unknown reason, an unknown trade and a ruling that is not the dispute\'s', async () => {
    const { t, rulingId } = await ruled();
    expect((await report({ kind: 'ruling-refused', trade: t.code, rulingId, reason: 'whatever' })).statusCode).toBe(400);
    expect((await report({ kind: 'ruling-refused', trade: t.code, rulingId, reason: 'needs-second', extra: 1 })).statusCode).toBe(400);
    expect((await report({ kind: 'ruling-refused', trade: t.code, rulingId: 'nope', reason: 'needs-second' })).statusCode).toBe(400);
    const other = await report({ kind: 'ruling-refused', trade: t.code, rulingId: randomUUID(), reason: 'needs-second' });
    expect([other.statusCode, (other.json() as { error: string }).error]).toEqual([409, 'stale-ruling']);
    const none = await trade();
    expect((await report({ kind: 'ruling-refused', trade: none.code, rulingId, reason: 'needs-second' })).statusCode).toBe(409);
    expect(await refusals(t.code)).toEqual([]);
  });
});

describe('the rescue: a second approval for a ruling the gate refuses needs-second', () => {
  it('a senior taps the approval of exactly that ruling; it is recorded and logged; the gate can then pay', async () => {
    const { t, rulingId } = await ruled();
    expect((await report({ kind: 'ruling-refused', trade: t.code, rulingId, reason: 'needs-second' })).statusCode).toBe(201);
    const senior = await staff('senior');
    const tapId = await approveTap(senior, t.code, rulingId);
    const res = await rescue(senior, t.code, rulingId, tapId);
    expect(res.statusCode, res.body).toBe(200);
    expect(await used(tapId)).toBe(true);
    const d = (await loadDispute(deps.db, t.code))!;
    expect(d.ruling).toMatchObject({ id: rulingId, approver: senior.id, needsSecond: true });
    expect(d.status).toBe('published');
    const { rows } = await deps.db.query<{ action: string; actor_id: string }>("select action, actor_id::text from activity_log where trade_code = $1 and action = 'ruling.second-approved'", [t.code]);
    expect(rows).toEqual([{ action: 'ruling.second-approved', actor_id: senior.id }]);
    // Once added, no second rescue: the ruling has its approver.
    const again = await rescue(await staff('owner'), t.code, rulingId, await approveTap(senior, t.code, rulingId));
    expect(again.statusCode).toBe(409);
  });

  it('refused without a needs-second report for this ruling; the tap stays unused', async () => {
    const { t, rulingId } = await ruled();
    const senior = await staff('senior');
    const tapId = await approveTap(senior, t.code, rulingId);
    const res = await rescue(senior, t.code, rulingId, tapId);
    expect([res.statusCode, (res.json() as { error: string }).error]).toEqual([409, 'not-refused']);
    expect((await report({ kind: 'ruling-refused', trade: t.code, rulingId, reason: 'stopped' })).statusCode).toBe(201);
    const res2 = await rescue(senior, t.code, rulingId, tapId);
    expect([res2.statusCode, (res2.json() as { error: string }).error]).toEqual([409, 'not-refused']);
    expect(await used(tapId)).toBe(false);
  });

  it('a tap made for anything else (another outcome or reason) is tap-invalid; a moderator cannot; the proposer cannot', async () => {
    const { t, rulingId, proposer } = await ruled();
    expect((await report({ kind: 'ruling-refused', trade: t.code, rulingId, reason: 'needs-second' })).statusCode).toBe(201);
    const senior = await staff('senior');
    const wrong = await approveTap(senior, t.code, rulingId, { outcome: 'refund-to-seller' });
    expect((await rescue(senior, t.code, rulingId, wrong)).statusCode).toBe(403);
    const wrongReason = await approveTap(senior, t.code, rulingId, { reason: 'Something else entirely, at least forty characters long.' });
    expect((await rescue(senior, t.code, rulingId, wrongReason)).statusCode).toBe(403);
    expect(await used(wrong)).toBe(false);
    const mod = await staff('mod');
    expect((await rescue(mod, t.code, rulingId, await approveTap(mod, t.code, rulingId))).statusCode).toBe(403);
    expect((await loadDispute(deps.db, t.code))!.ruling?.approver).toBeNull();
    void proposer;
  });

  it('the proposer is never their own second person', async () => {
    const senior = await staff('senior');
    const { t, rulingId } = await ruled('release-to-buyer', senior.id);
    expect((await report({ kind: 'ruling-refused', trade: t.code, rulingId, reason: 'needs-second' })).statusCode).toBe(201);
    const tapId = await approveTap(senior, t.code, rulingId);
    const r = await rescue(senior, t.code, rulingId, tapId);
    expect([r.statusCode, (r.json() as { error: string }).error]).toEqual([409, 'same-person']);
    expect(await used(tapId)).toBe(false);
    expect((await loadDispute(deps.db, t.code))!.ruling?.approver).toBeNull();
  });

  it('during an appeal: the approver joins round 1\'s signers (R37)', async () => {
    const { t, rulingId } = await ruled();
    await appealDirect(deps, t.code, 'seller');
    expect((await report({ kind: 'ruling-refused', trade: t.code, rulingId, reason: 'needs-second' })).statusCode).toBe(201);
    const senior = await staff('senior');
    const res = await rescue(senior, t.code, rulingId, await approveTap(senior, t.code, rulingId));
    expect(res.statusCode, res.body).toBe(200);
    const d = (await loadDispute(deps.db, t.code))!;
    expect(d.round1).toMatchObject({ id: rulingId, approver: senior.id });
    expect(d.round1?.involved).toContain(senior.id);
  });
});

describe('review p4t22 N1: a senior re-proposes a round 1 the gate refuses as revoked', () => {
  const REASON2 = 'The moderator who ruled was removed; on the evidence the buyer did not pay in time.';
  /** A `propose` tap of a new round-1 ruling, as the normal proposal route rebuilds it. */
  async function proposeTap(who: { id: string }, code: string, rulingId: string, o: { outcome?: RulingOutcome; reason?: string; evidence?: string[] } = {}): Promise<string> {
    const t = await deps.db.query<{ amount: string }>('select amount_atomic::text as amount from trades where code = $1', [code]);
    const intent: KeyTapIntent = {
      kind: 'ruling', step: 'propose', rulingId, code, round: 1, outcome: o.outcome ?? 'refund-to-seller', accountAction: { kind: 'none' },
      amountAtomic: t.rows[0]!.amount, reasonSha256: sha256Hex(o.reason ?? REASON2), evidenceSha256: evidenceSha256(o.evidence ?? ['The trade chat', 'The bank statement']), round1Id: null,
    };
    return seedTap(deps, who.id, intent);
  }
  const rePropose = (who: { b: StaffBrowser }, code: string, oldId: string, body: { rulingId: string; tapId: string; outcome?: RulingOutcome; reason?: string; evidence?: string[] }) =>
    who.b.post(`/staff/v1/disputes/${code}/rulings/${oldId}/re-propose`, {
      rulingId: body.rulingId, outcome: body.outcome ?? 'refund-to-seller', accountAction: { kind: 'none' }, reason: body.reason ?? REASON2, evidence: body.evidence ?? ['The trade chat', 'The bank statement'], tapId: body.tapId,
    });
  const published = async (code: string) =>
    (await deps.db.query<{ outcome: string; reason: string; moderator_name: string; appeal_until: Date }>('select outcome, reason, moderator_name, appeal_until from dispute_rulings where code = $1 and round = 1', [code])).rows;

  it('with the gate refusing the published round 1 as revoked, a senior proposes a new one with their own tap: published as round 1', async () => {
    const { t, rulingId } = await ruled();
    expect((await report({ kind: 'ruling-refused', trade: t.code, rulingId, reason: 'revoked' })).statusCode).toBe(201);
    expect(await caseView(t.code)).toMatchObject({ rulingId, reason: 'revoked', secondApproval: null, rePropose: { rulingId } });
    const senior = await staff('senior');
    const newId = randomUUID();
    const tapId = await proposeTap(senior, t.code, newId);
    const res = await rePropose(senior, t.code, rulingId, { rulingId: newId, tapId });
    expect(res.statusCode, res.body).toBe(200);
    expect(await used(tapId)).toBe(true);
    const d = (await loadDispute(deps.db, t.code))!;
    expect(d).toMatchObject({ round: 1, status: 'published', assignee: senior.id });
    expect(d.ruling).toMatchObject({ id: newId, outcome: 'refund-to-seller', proposer: senior.id, approver: null });
    const rows = await published(t.code);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: 'refund-to-seller', reason: REASON2 });
    expect(rows[0]!.appeal_until.toISOString()).toBe(d.appealEndsAt!.toISOString());
    const { rows: log } = await deps.db.query<{ action: string; detail: string }>("select action, detail from activity_log where trade_code = $1 and action in ('ruling.re-proposed', 'ruling.published') order by id", [t.code]);
    expect(log.map((l) => [l.action, (JSON.parse(l.detail) as { rulingId: string }).rulingId])).toEqual([['ruling.re-proposed', newId], ['ruling.published', newId]]);
    expect(JSON.parse(log[0]!.detail)).toMatchObject({ replaces: rulingId });
    // The refusal named the withdrawn ruling: nothing left to show.
    expect(await caseView(t.code)).toBeNull();
  });

  it('refused without a revoked report for this very ruling; the tap stays unused', async () => {
    const { t, rulingId } = await ruled();
    const senior = await staff('senior');
    const newId = randomUUID();
    const tapId = await proposeTap(senior, t.code, newId);
    const none = await rePropose(senior, t.code, rulingId, { rulingId: newId, tapId });
    expect([none.statusCode, (none.json() as { error: string }).error]).toEqual([409, 'not-refused']);
    expect((await report({ kind: 'ruling-refused', trade: t.code, rulingId, reason: 'needs-second' })).statusCode).toBe(201);
    const other = await rePropose(senior, t.code, rulingId, { rulingId: newId, tapId });
    expect([other.statusCode, (other.json() as { error: string }).error]).toEqual([409, 'not-refused']);
    expect(await used(tapId)).toBe(false);
    expect((await loadDispute(deps.db, t.code))!.ruling?.id).toBe(rulingId);
  });

  it('a moderator cannot; a tap for anything else is tap-invalid; nothing changes', async () => {
    const { t, rulingId } = await ruled();
    expect((await report({ kind: 'ruling-refused', trade: t.code, rulingId, reason: 'revoked' })).statusCode).toBe(201);
    const mod = await staff('mod');
    const id1 = randomUUID();
    expect((await rePropose(mod, t.code, rulingId, { rulingId: id1, tapId: await proposeTap(mod, t.code, id1) })).statusCode).toBe(403);
    const senior = await staff('senior');
    const id2 = randomUUID();
    const wrongOutcome = await proposeTap(senior, t.code, id2, { outcome: 'release-to-buyer' });
    expect((await rePropose(senior, t.code, rulingId, { rulingId: id2, tapId: wrongOutcome })).statusCode).toBe(403);
    const otherId = await proposeTap(senior, t.code, randomUUID());
    expect((await rePropose(senior, t.code, rulingId, { rulingId: id2, tapId: otherId })).statusCode).toBe(403);
    const someoneElse = await staff('senior');
    const theirs = await proposeTap(someoneElse, t.code, id2);
    expect((await rePropose(senior, t.code, rulingId, { rulingId: id2, tapId: theirs })).statusCode).toBe(403);
    expect(await used(wrongOutcome)).toBe(false);
    expect((await loadDispute(deps.db, t.code))!.ruling?.id).toBe(rulingId);
    expect(await published(t.code)).toHaveLength(1);
  });

  it('when the gate needs two people, it waits for the normal approval, and the withdrawn ruling is no longer shown', async () => {
    const { t, rulingId } = await ruled();
    expect((await report({ kind: 'ruling-refused', trade: t.code, rulingId, reason: 'revoked' })).statusCode).toBe(201);
    const senior = await staff('senior');
    const newId = randomUUID();
    const tapId = await proposeTap(senior, t.code, newId);
    // A limit lowered under the trade's value since round 1 was published: two people now.
    await deps.db.query('update settings set large_trade_limit_usd = 1');
    let res: LightMyRequestResponse;
    try {
      res = await rePropose(senior, t.code, rulingId, { rulingId: newId, tapId });
    } finally {
      await deps.db.query('update settings set large_trade_limit_usd = 1000');
    }
    expect(res.statusCode, res.body).toBe(200);
    expect((await loadDispute(deps.db, t.code))!.status).toBe('awaiting-approval');
    expect(await published(t.code)).toEqual([]);
    const owner = await staff('owner');
    const t2 = await deps.db.query<{ amount: string }>('select amount_atomic::text as amount from trades where code = $1', [t.code]);
    const approve: KeyTapIntent = {
      kind: 'ruling', step: 'approve', rulingId: newId, code: t.code, round: 1, outcome: 'refund-to-seller', accountAction: { kind: 'none' },
      amountAtomic: t2.rows[0]!.amount, reasonSha256: sha256Hex(REASON2), evidenceSha256: evidenceSha256(['The trade chat', 'The bank statement']), round1Id: null,
    };
    const ok = await owner.b.post(`/staff/v1/disputes/${t.code}/rulings/${newId}/approve`, { tapId: await seedTap(deps, owner.id, approve) });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await loadDispute(deps.db, t.code))!).toMatchObject({ status: 'published', ruling: { id: newId, approver: owner.id } });
    expect(await published(t.code)).toHaveLength(1);
  });

  it('not once an appeal is open (the appeal decides; the gate reads round 1 for its signers there)', async () => {
    const { t, rulingId } = await ruled();
    await appealDirect(deps, t.code, 'seller');
    expect((await report({ kind: 'ruling-refused', trade: t.code, rulingId, reason: 'revoked' })).statusCode).toBe(201);
    expect(await caseView(t.code)).toMatchObject({ reason: 'revoked', rePropose: null });
    const senior = await staff('senior');
    const newId = randomUUID();
    const tapId = await proposeTap(senior, t.code, newId);
    const r = await rePropose(senior, t.code, rulingId, { rulingId: newId, tapId });
    expect(r.statusCode).toBe(409);
    expect(await used(tapId)).toBe(false);
  });
});
