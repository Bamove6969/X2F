// Plan 5 Task 10 on the staff API (owner 2026-11-02, owner Q58 6 Nov): a senior moderator or the
// owner sets a past-reputation claim's verified dollar figure, at most $100,000, through
// setVerifiedPastRepUsd; the activity log records the claim and never the figure.
import { randomBytes } from 'node:crypto';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Deps } from '../../src/app.js';
import { seedAccount } from '../helpers/accounts.js';
import { StaffBrowser, insertSession, logEntries, seedStaff, staffApps } from '../helpers/staffApp.js';

let app: FastifyInstance;
let deps: Deps;
let close: () => Promise<void>;
let n = 0;

let setNow: (d: Date) => void;
beforeAll(async () => {
  ({ app, deps, setNow, close } = await staffApps());
  setNow(new Date('2026-11-02T12:00:00Z'));
});
afterAll(async () => close());

async function claim(status = 'approved'): Promise<string> {
  const owner = await seedAccount(deps, { loginName: `pr${++n}${randomBytes(3).toString('hex')}`, kind: 'trader' });
  const { rows } = await deps.db.query<{ id: string }>(
    `insert into past_reputation (account_id, site, evidence_url, claimed_trades, fingerprint, key_enc, challenge_text, signature_enc, status, created_at)
     values ($1, 'LocalMonero', 'https://web.archive.org/web/2023/x', 10, $2, $3, 'text', $3, $4, now()) returning id`,
    [owner, randomBytes(20).toString('hex'), randomBytes(40), status],
  );
  return rows[0]!.id;
}

const figure = async (id: string) =>
  (await deps.db.query<{ cents: string | null }>('select verified_usd_cents::text as cents from past_reputation where id = $1', [id])).rows[0]!.cents;

async function as(role: 'senior' | 'mod' | 'owner' | 'helper'): Promise<StaffBrowser> {
  const s = role === 'owner' ? await ownerAccount() : (await seedStaff(deps, { role })).id;
  const { token } = await insertSession(deps, s, 'staff');
  return new StaffBrowser(app).withSession(token);
}
let ownerId: string | undefined;
const ownerAccount = async () => (ownerId ??= (await seedStaff(deps, { role: 'owner' })).id);

const put = (b: StaffBrowser, id: string, body: unknown) => b.send('PUT', `/staff/v1/past-rep/${id}/verified-usd`, body);

describe('PUT /staff/v1/past-rep/:id/verified-usd', () => {
  it('a senior moderator and the owner set and clear the figure; the log has the claim, never the amount', async () => {
    const id = await claim();
    const res = await put(await as('senior'), id, { usdCents: 1_234_500 });
    expect([res.statusCode, res.json()]).toEqual([200, { ok: true }]);
    expect(await figure(id)).toBe('1234500');
    const cleared = await put(await as('owner'), id, { usdCents: null });
    expect(cleared.statusCode).toBe(200);
    expect(await figure(id)).toBeNull();
    const entries = await logEntries(deps, 'pastrep.verified-usd-set');
    expect(entries.map((e) => JSON.parse(e.detail))).toEqual([{ claimId: id, cleared: false }, { claimId: id, cleared: true }]);
    expect(entries.map((e) => e.detail).join('')).not.toContain('1234500');
  });

  it('a moderator or a helper is refused by the guard (403 forbidden)', async () => {
    const id = await claim();
    for (const role of ['mod', 'helper'] as const) {
      const res = await put(await as(role), id, { usdCents: 100 });
      expect([res.statusCode, res.json()]).toEqual([403, { error: 'forbidden' }]);
    }
    expect(await figure(id)).toBeNull();
  });

  it('owner Q58: at most $100,000; zero, fractions, strings and extra keys are 400', async () => {
    const id = await claim();
    const b = await as('senior');
    expect((await put(b, id, { usdCents: 10_000_000 })).statusCode).toBe(200);
    for (const body of [{ usdCents: 10_000_001 }, { usdCents: 0 }, { usdCents: 1.5 }, { usdCents: '100' }, { usdCents: 100, x: 1 }, [], null]) {
      const res = await put(b, id, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(await figure(id)).toBe('10000000');
  });

  it('an unknown claim is 404 and one no longer live is 409 not-live', async () => {
    const b = await as('senior');
    expect((await put(b, '00000000-0000-4000-8000-000000000000', { usdCents: 100 })).statusCode).toBe(404);
    expect((await put(b, 'nope', { usdCents: 100 })).statusCode).toBe(404);
    const revoked = await claim('revoked');
    const res = await put(b, revoked, { usdCents: 100 });
    expect([res.statusCode, res.json()]).toEqual([409, { error: 'not-live' }]);
  });
});

// Plan 5 Task 11: moderators review past-reputation claims (perm `reputation.review`: the owner,
// senior moderators and moderators; revoking `reputation.revoke`: senior moderators and the owner).
// Each decision writes exactly one log entry with the claim, the site and a count: never the
// evidence link or the fingerprint.
describe('Task 11: GET /staff/v1/past-rep and the decisions', () => {
  async function signedClaim(o: { site?: string; claimed?: number } = {}): Promise<{ id: string; account: string; url: string }> {
    const loginName = `pr${++n}${randomBytes(3).toString('hex')}`;
    const account = await seedAccount(deps, { loginName, kind: 'trader' });
    const url = `https://web.archive.org/web/2023/https://localmonero.co/ad/${randomBytes(4).toString('hex')}`;
    const fp = randomBytes(20).toString('hex');
    const { rows } = await deps.db.query<{ id: string }>(
      `insert into past_reputation (account_id, site, evidence_url, claimed_trades, fingerprint, key_enc, challenge_text, signature_enc, status, created_at)
       values ($1, $2, $3, $4, $5, $6, 'text', $6, 'signed', $7) returning id`,
      [account, o.site ?? 'LocalMonero', url, o.claimed ?? 1240, fp, randomBytes(40), new Date(Date.UTC(2026, 10, 1, 0, 0, n))],
    );
    return { id: rows[0]!.id, account, url };
  }
  const row = async (id: string) =>
    (await deps.db.query<{
      status: string; verified_trades: number | null; reviewer_id: string | null; decided_at: Date | null; reason: string | null; fingerprint: string;
      revoked_by: string | null; revoked_at: Date | null;
    }>(
      'select status, verified_trades, reviewer_id, decided_at, reason, fingerprint, revoked_by, revoked_at from past_reputation where id = $1', [id],
    )).rows[0]!;
  const approve = (b: StaffBrowser, id: string, body: unknown) => b.post(`/staff/v1/past-rep/${id}/approve`, body);
  const reject = (b: StaffBrowser, id: string, body: unknown) => b.post(`/staff/v1/past-rep/${id}/reject`, body);
  const revoke = (b: StaffBrowser, id: string, body: unknown) => b.post(`/staff/v1/past-rep/${id}/revoke`, body);
  // The decision entries about these claims (the log is append-only, so each test reads its own).
  const pastrepLog = async (...claims: string[]) =>
    (await deps.db.query<{ action: string; detail: string }>("select action, detail from activity_log where action like 'pastrep.%' and action <> 'pastrep.verified-usd-set' order by id")).rows
      .filter((e) => claims.includes((JSON.parse(e.detail) as { claimId?: string }).claimId ?? ''));

  it('lists signed claims oldest first: the grouped fingerprint, the key id, the trader\'s display name; no key text or user ID', async () => {
    const c = await signedClaim();
    const name = (await deps.db.query<{ d: string }>('select display_name as d from accounts where id = $1', [c.account])).rows[0]!.d;
    const res = await (await as('mod')).get('/staff/v1/past-rep?status=signed');
    expect(res.statusCode).toBe(200);
    const page = res.json() as { items: Array<Record<string, unknown>>; next: string | null };
    const list = page.items;
    const item = list.find((x) => x.id === c.id)!;
    const fp = (await row(c.id)).fingerprint;
    expect(item).toEqual({
      id: c.id, site: 'LocalMonero', url: c.url, claimedTrades: 1240, verifiedTrades: null, verifiedUsdCents: null, status: 'signed',
      fingerprint: (fp.toUpperCase().match(/.{4}/g) ?? []).join(' '), keyId: fp.slice(-16).toUpperCase(), signatureValid: true,
      displayName: name, createdAt: expect.any(String),
      // Review M2: the archived original's host, read from the link itself (no lookup).
      originalHost: 'localmonero.co',
    });
    const created = list.map((x) => Date.parse(x.createdAt as string));
    expect(created).toEqual([...created].sort((a, b) => a - b));
    expect(JSON.stringify(list)).not.toMatch(/key_enc|BEGIN PGP|challenge|signature_enc/);
    // Approved claims for the revoke list; anything else is a bad request.
    expect((await (await as('mod')).get('/staff/v1/past-rep?status=approved')).statusCode).toBe(200);
    expect((await (await as('mod')).get('/staff/v1/past-rep?status=removed')).statusCode).toBe(400);
    expect((await (await as('mod')).get('/staff/v1/past-rep')).json()).toEqual(page);
  });

  it('a helper is refused every review route (the matrix); a moderator may review', async () => {
    const c = await signedClaim();
    const helper = await as('helper');
    for (const res of [
      await helper.get('/staff/v1/past-rep'),
      await approve(helper, c.id, { fingerprintSeen: true, profileSeen: true, tradesSeen: 10 }),
      await reject(helper, c.id, { reason: 'The archive does not show this key.' }),
    ]) expect([res.statusCode, res.json()]).toEqual([403, { error: 'forbidden' }]);
    expect((await row(c.id)).status).toBe('signed');
  });

  it('P5-A23: approve without fingerprintSeen is 400 confirm-fingerprint and changes nothing', async () => {
    const c = await signedClaim();
    const b = await as('mod');
    for (const body of [{ tradesSeen: 1240 }, { fingerprintSeen: false, tradesSeen: 1240 }, { fingerprintSeen: 'yes', tradesSeen: 1240 }]) {
      const res = await approve(b, c.id, body);
      expect([res.statusCode, res.json()], JSON.stringify(body)).toEqual([400, { error: 'confirm-fingerprint' }]);
    }
    // Review M2 (lead call): the second tick, the archived page is the trader's profile on the site.
    for (const body of [{ fingerprintSeen: true, tradesSeen: 1240 }, { fingerprintSeen: true, profileSeen: false, tradesSeen: 1240 }, { fingerprintSeen: true, profileSeen: 1, tradesSeen: 1240 }]) {
      const res = await approve(b, c.id, body);
      expect([res.statusCode, res.json()], JSON.stringify(body)).toEqual([400, { error: 'confirm-profile' }]);
    }
    for (const body of [{ fingerprintSeen: true, profileSeen: true }, { fingerprintSeen: true, profileSeen: true, tradesSeen: 0 }, { fingerprintSeen: true, profileSeen: true, tradesSeen: 1.5 },
      { fingerprintSeen: true, profileSeen: true, tradesSeen: '10' }, { fingerprintSeen: true, profileSeen: true, tradesSeen: 1241 }, { fingerprintSeen: true, profileSeen: true, tradesSeen: 10, x: 1 }, [], null]) {
      expect((await approve(b, c.id, body)).statusCode, JSON.stringify(body)).toBe(400);
    }
    expect((await row(c.id)).status).toBe('signed');
    expect(await pastrepLog(c.id)).toEqual([]);
  });

  it('approve sets approved and verified_trades; the profile\'s own counts and milestones do not move; one log entry, no link or fingerprint', async () => {
    const { traderProfile } = await import('../../src/reputation/profile.js');
    const c = await signedClaim({ claimed: 1300 });
    const before = await traderProfile(deps.db, c.account, c.account, deps.clock());
    const mod = await seedStaff(deps, { role: 'mod' });
    const b = new StaffBrowser(app).withSession((await insertSession(deps, mod.id, 'staff')).token);
    const res = await approve(b, c.id, { fingerprintSeen: true, profileSeen: true, tradesSeen: 1240 });
    expect([res.statusCode, res.json()]).toEqual([200, { id: c.id, status: 'approved', verifiedTrades: 1240 }]);
    const r = await row(c.id);
    expect(r).toMatchObject({ status: 'approved', verified_trades: 1240, reviewer_id: mod.id, reason: null });
    expect(r.decided_at?.toISOString()).toBe('2026-11-02T12:00:00.000Z');
    // The trader's own list shows the verified count.
    const own = await deps.db.query('select verified_trades, status from past_reputation where account_id = $1', [c.account]);
    expect(own.rows).toEqual([{ verified_trades: 1240, status: 'approved' }]);
    // Past reputation never feeds X2F's own counts (spec 5.5, R-024).
    const after = await traderProfile(deps.db, c.account, c.account, deps.clock());
    expect(after.stats).toEqual(before.stats);
    expect(after.badges).toEqual(before.badges);
    const log = await pastrepLog(c.id);
    expect(log.map((e) => [e.action, JSON.parse(e.detail)])).toEqual([['pastrep.approved', { claimId: c.id, accountId: c.account, site: 'LocalMonero', trades: 1240 }]]);
    expect(log[0]!.detail).not.toContain('archive');
    expect(log[0]!.detail.toLowerCase()).not.toContain(r.fingerprint.slice(-16));
    // Decided once: a second approve, or a reject now, is 409 wrong-state and logs nothing.
    expect((await approve(b, c.id, { fingerprintSeen: true, profileSeen: true, tradesSeen: 1240 })).json()).toEqual({ error: 'wrong-state' });
    expect((await reject(b, c.id, { reason: 'Changed my mind about it.' })).statusCode).toBe(409);
    expect(await pastrepLog(c.id)).toHaveLength(1);
  });

  it('reject needs a reason of at least 10 characters; it sets rejected with the reason and logs no text', async () => {
    const c = await signedClaim({ site: 'Hodl Hodl' });
    const b = await as('senior');
    for (const body of [{}, { reason: 'too short' }, { reason: '         x         ' }, { reason: 'x'.repeat(501) }, { reason: 'A fine reason.', x: 1 }]) {
      expect((await reject(b, c.id, body)).statusCode, JSON.stringify(body)).toBe(400);
    }
    const res = await reject(b, c.id, { reason: '  The archive shows another key.  ' });
    expect([res.statusCode, res.json()]).toEqual([200, { id: c.id, status: 'rejected' }]);
    expect(await row(c.id)).toMatchObject({ status: 'rejected', reason: 'The archive shows another key.', verified_trades: null });
    const log = await pastrepLog(c.id);
    expect(log.map((e) => [e.action, JSON.parse(e.detail)])).toEqual([['pastrep.rejected', { claimId: c.id, accountId: c.account, site: 'Hodl-Hodl' }]]);
    expect(log[0]!.detail).not.toContain('archive');
  });

  it('revoke: a moderator is forbidden; a senior moderator revokes an approved claim, which then stops counting', async () => {
    const c = await signedClaim();
    const approver = (await seedStaff(deps, { role: 'mod' })).id;
    const approverB = new StaffBrowser(app).withSession((await insertSession(deps, approver, 'staff')).token);
    expect((await approve(approverB, c.id, { fingerprintSeen: true, profileSeen: true, tradesSeen: 1000 })).statusCode).toBe(200);
    await put(await as('senior'), c.id, { usdCents: 5_000_000 });
    setNow(new Date('2026-11-02T13:00:00Z'));
    const mod = await revoke(await as('mod'), c.id, { reason: 'The archive was edited later.' });
    expect([mod.statusCode, mod.json()]).toEqual([403, { error: 'forbidden' }]);
    expect((await row(c.id)).status).toBe('approved');
    const senior = await as('senior');
    expect((await revoke(senior, c.id, { reason: 'short' })).statusCode).toBe(400);
    const res = await revoke(senior, c.id, { reason: 'The archive was edited later.' });
    expect([res.statusCode, res.json()]).toEqual([200, { id: c.id, status: 'revoked' }]);
    // Review m3: the approver stays on the row; the revoke has its own columns (migration 751).
    const revoked = await row(c.id);
    expect(revoked).toMatchObject({ status: 'revoked', reason: 'The archive was edited later.', reviewer_id: approver, verified_trades: 1000 });
    expect(revoked.decided_at?.toISOString()).toBe('2026-11-02T12:00:00.000Z');
    expect(revoked.revoked_at?.toISOString()).toBe('2026-11-02T13:00:00.000Z');
    expect(revoked.revoked_by).not.toBeNull();
    expect(revoked.revoked_by).not.toBe(approver);
    const { verifiedPastRepUsdCents } = await import('../../src/pastrep/store.js');
    expect(await verifiedPastRepUsdCents(deps.db, c.account)).toBe(0);
    // Only an approved claim is revoked; a signed one is rejected instead.
    const s = await signedClaim();
    expect((await revoke(senior, s.id, { reason: 'The archive was edited later.' })).json()).toEqual({ error: 'wrong-state' });
    const log = await pastrepLog(c.id);
    expect(log.map((e) => e.action)).toEqual(['pastrep.approved', 'pastrep.revoked']);
    expect(JSON.parse(log[1]!.detail)).toEqual({ claimId: c.id, accountId: c.account, site: 'LocalMonero' });
    // The owner may revoke too.
    const c2 = await signedClaim({ site: 'Bisq' });
    await approve(senior, c2.id, { fingerprintSeen: true, profileSeen: true, tradesSeen: 5 });
    expect((await revoke(await as('owner'), c2.id, { reason: 'The archive was edited later.' })).statusCode).toBe(200);
    setNow(new Date('2026-11-02T12:00:00Z'));
  });

  it('J-21: after a revoke, another account can claim the same key once it proves it (the key is no longer live)', async () => {
    const c = await signedClaim();
    const fp = (await row(c.id)).fingerprint;
    await approve(await as('mod'), c.id, { fingerprintSeen: true, profileSeen: true, tradesSeen: 10 });
    await revoke(await as('senior'), c.id, { reason: 'Proven to belong to someone else.' });
    const other = await seedAccount(deps, { loginName: `pr${++n}${randomBytes(3).toString('hex')}`, kind: 'trader' });
    await expect(deps.db.query(
      `insert into past_reputation (account_id, site, evidence_url, claimed_trades, fingerprint, key_enc, challenge_text, signature_enc, status, created_at)
       values ($1, 'LocalMonero', 'https://web.archive.org/web/2024/x', 10, $2, $3, 'text', $3, 'signed', now())`,
      [other, fp, randomBytes(40)],
    )).resolves.toBeDefined();
  });

  it('P5-A20: listing, approving and revoking call no fetch, DNS lookup or http(s) request', async () => {
    const c = await signedClaim();
    const mod = await as('mod');
    const senior = await as('senior');
    const spies = [
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        throw new Error('fetch called');
      }),
      vi.spyOn(dns, 'lookup'), vi.spyOn(dns.promises, 'lookup'), vi.spyOn(dns, 'resolve'),
      vi.spyOn(http, 'request'), vi.spyOn(http, 'get'), vi.spyOn(https, 'request'), vi.spyOn(https, 'get'),
    ];
    try {
      expect((await mod.get('/staff/v1/past-rep')).statusCode).toBe(200);
      expect((await approve(mod, c.id, { fingerprintSeen: true, profileSeen: true, tradesSeen: 3 })).statusCode).toBe(200);
      expect((await revoke(senior, c.id, { reason: 'The archive was edited later.' })).statusCode).toBe(200);
      for (const s of spies) expect(s).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  // Review M1: approved claims only grow, so their list is newest first (by approval), paged with a
  // cursor, and filtered by the trader's display name; the newest approved claim is always reachable.
  it('M1: more than 100 approved claims page newest first with a cursor; a name filter narrows them; the newest can be revoked', async () => {
    const sites = ['LocalMonero', 'AgoraDesk', 'LocalBitcoins', 'Paxful', 'Hodl Hodl', 'Bisq', 'Other'];
    const tag = randomBytes(3).toString('hex');
    const reviewer = (await seedStaff(deps, { role: 'mod' })).id;
    const ids: string[] = [];
    for (let a = 0; a < 16; a++) {
      const account = await seedAccount(deps, { loginName: `bulk${tag}${a}x`, displayName: `Bulk${tag}${String(a).padStart(2, '0')}`, kind: 'trader' });
      for (const [i, site] of sites.entries()) {
        const k = a * sites.length + i;
        const { rows } = await deps.db.query<{ id: string }>(
          `insert into past_reputation (account_id, site, evidence_url, claimed_trades, fingerprint, key_enc, challenge_text, signature_enc, status,
             verified_trades, reviewer_id, decided_at, created_at)
           values ($1, $2, 'https://web.archive.org/web/2023/https://example.org/u', 10, $3, $4, 'text', $4, 'approved', 10, $5, $6, $7) returning id`,
          [account, site, randomBytes(20).toString('hex'), randomBytes(40), reviewer, new Date(Date.UTC(2026, 10, 3) + k * 60_000), new Date(Date.UTC(2026, 8, 1) - k * 60_000)],
        );
        ids.push(rows[0]!.id);
      }
    }
    expect(ids.length).toBe(112);
    const newest = ids[ids.length - 1]!;
    const mod = await as('mod');
    // The first page holds the newest approval first, whatever the created order.
    const first = (await mod.get('/staff/v1/past-rep?status=approved')).json() as { items: Array<{ id: string }>; next: string | null };
    expect(first.items).toHaveLength(100);
    expect(first.items[0]!.id).toBe(newest);
    expect(first.next).not.toBeNull();
    // Walking the cursor reaches every one of the 112, each once, in approval order (newest first).
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const url = `/staff/v1/past-rep?status=approved${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`;
      const page = (await mod.get(url)).json() as { items: Array<{ id: string }>; next: string | null };
      seen.push(...page.items.map((x) => x.id));
      cursor = page.next;
    } while (cursor !== null);
    const ours = seen.filter((x) => ids.includes(x));
    expect(ours).toEqual([...ids].reverse());
    expect(new Set(seen).size).toBe(seen.length);
    // The name filter: a display-name prefix, case-insensitive.
    const one = (await mod.get(`/staff/v1/past-rep?status=approved&name=bulk${tag}03`)).json() as { items: Array<{ id: string; displayName: string }>; next: string | null };
    expect(one.items.map((x) => x.id)).toEqual(ids.slice(21, 28).reverse());
    expect(one.next).toBeNull();
    const all = (await mod.get(`/staff/v1/past-rep?status=approved&name=BULK${tag}`)).json() as { items: unknown[]; next: string | null };
    expect(all.items).toHaveLength(100);
    // LIKE wildcards in the filter are plain text.
    expect(((await mod.get(`/staff/v1/past-rep?status=approved&name=${encodeURIComponent('%')}`)).json() as { items: unknown[] }).items).toEqual([]);
    for (const bad of ['cursor=nope', 'cursor=2026-10-01T00:00:00.000Z~x', `name=${'x'.repeat(65)}`]) {
      expect((await mod.get(`/staff/v1/past-rep?status=approved&${bad}`)).statusCode, bad).toBe(400);
    }
    // The newest approved claim, past the 100th by creation date, is revoked from the first page.
    const res = await revoke(await as('senior'), newest, { reason: 'The archive was edited later.' });
    expect([res.statusCode, res.json()]).toEqual([200, { id: newest, status: 'revoked' }]);
    const after = (await mod.get('/staff/v1/past-rep?status=approved')).json() as { items: Array<{ id: string }> };
    expect(after.items[0]!.id).toBe(ids[ids.length - 2]);
  });

  // Review M3 (lead call): a reviewer never approves a claim backed by one of their own login keys.
  it('M3: approving a claim whose key is one of the reviewer\'s own PGP login keys is 403 reviewer-own-key; nothing changes', async () => {
    const c = await signedClaim();
    const fp = (await row(c.id)).fingerprint;
    const mod = await seedStaff(deps, { role: 'mod' });
    await deps.db.query('insert into pgp_keys (account_id, fingerprint, armored_enc, created_at) values ($1, $2, $3, now())', [mod.id, fp, randomBytes(8)]);
    const b = new StaffBrowser(app).withSession((await insertSession(deps, mod.id, 'staff')).token);
    const res = await approve(b, c.id, { fingerprintSeen: true, profileSeen: true, tradesSeen: 10 });
    expect([res.statusCode, res.json()]).toEqual([403, { error: 'reviewer-own-key' }]);
    expect((await row(c.id)).status).toBe('signed');
    expect(await pastrepLog(c.id)).toEqual([]);
    // Another moderator may approve it.
    expect((await approve(await as('mod'), c.id, { fingerprintSeen: true, profileSeen: true, tradesSeen: 10 })).statusCode).toBe(200);
  });

  // Review m6: the plan's profile line waits for Task 12 (traders/summary.ts passes `pastRep: []`).
  it.todo('Task 12: after approval the profile shows "Verified: 1,240 trades on LocalMonero (PGP proof)" linking to the archive, and a revoke removes it');

  it('an unknown or malformed claim id is 404 for every decision', async () => {
    const b = await as('senior');
    for (const id of ['00000000-0000-4000-8000-000000000000', 'nope']) {
      expect((await approve(b, id, { fingerprintSeen: true, profileSeen: true, tradesSeen: 1 })).statusCode).toBe(404);
      expect((await reject(b, id, { reason: 'A long enough reason.' })).statusCode).toBe(404);
      expect((await revoke(b, id, { reason: 'A long enough reason.' })).statusCode).toBe(404);
    }
  });
});
