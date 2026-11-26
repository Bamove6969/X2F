// Owner 26 Nov 2026: the owner's audit of trades not deleted yet by status, and writing a lien off
// as uncollectible (it ends the lien, leaves any ban, and gives the trade its delete date back).
import { randomUUID } from 'node:crypto';
import { DISPUTE_KEEP_DAYS } from '@x2f/trade';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../../src/app.js';
import { parseKeyTapIntent, tapPermOf } from '../../src/staff/keyTap.js';
import { tradeSelfDestruct } from '../../src/retention/tradePurge.js';
import { seedAccount } from '../helpers/accounts.js';
import { StaffBrowser, errorOf, insertSession, logEntries, seedStaff, seedTap, staffApps, uniqueName } from '../helpers/staffApp.js';
import { seedTrade } from '../helpers/trades.js';

let app: FastifyInstance;
let deps: Deps;
let close: () => Promise<void>;
let setNow: (d: Date) => void;
let ownerId: string;
let owner: StaffBrowser;
const T0 = new Date('2026-11-20T12:00:00.000Z');
const DAY = 86_400_000;

beforeAll(async () => {
  ({ app, deps, setNow, close } = await staffApps());
  setNow(T0);
  ownerId = (await seedStaff(deps, { role: 'owner' })).id;
  owner = new StaffBrowser(app).withSession((await insertSession(deps, ownerId, 'staff')).token);
});
afterAll(async () => close());

async function trade(state: string, closed: boolean) {
  const seller = await seedAccount(deps, { loginName: uniqueName('s') });
  const buyer = await seedAccount(deps, { loginName: uniqueName('b') });
  const { code } = await seedTrade(deps, { sellerId: seller, buyerId: buyer, poster: 'seller' });
  await deps.db.query('update trades set state = $2, closed_at = $3 where code = $1', [code, state, closed ? T0 : null]);
  return { code, seller, buyer };
}
async function lien(t: { code: string; seller: string; buyer: string }): Promise<string> {
  await deps.db.query(
    `insert into disputes (code, seq, opened_by, reason, opened_at, status, reply_due_at, ruling_due_at, usd_cents, limit_usd_cents, published_at, appeal_ends_at, closed_at)
     values ($1, 1, 'buyer', 'paid', $2, 'closed', $2, $2, 0, 100000, $2, $2, $2)`,
    [t.code, T0],
  );
  return (await deps.db.query<{ id: string }>(
    `insert into liens (debtor_account_id, creditor_account_id, amount_atomic, from_code, dispute_seq, round, cause, created_at, changed_at)
     values ($1, $2, 1000, $3, 1, 1, 'restitution', $4, $4) returning id::text`,
    [t.buyer, t.seller, t.code, T0],
  )).rows[0]!.id;
}

type Page = { counts: Record<string, number>; trades: Array<{ code: string; status: string; deleteAt: string | null; liens: Array<{ id: string; status: string }> }>; next: string | null };
const page = async (qs = ''): Promise<Page> => {
  const res = await owner.get(`/staff/v1/trades/status${qs}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Page;
};

describe('the trade status audit and uncollectible liens', () => {
  it('lists every trade not deleted by status; the owner writes a lien off with a tap; bans are left alone', async () => {
    const open = await trade('secured', false);
    const done = await trade('released', true);
    const cancelled = await trade('cancelled', true);
    const owing = await trade('released', true);
    const lienId = await lien(owing);
    const ban = await deps.db.query('select count(*)::int as n from account_bans where account_id = $1', [owing.buyer]).catch(() => null);

    const all = await page();
    const find = (code: string) => all.trades.find((t) => t.code === code);
    expect(find(open.code)?.status).toBe('open');
    expect(find(done.code)?.status).toBe('completed');
    expect(find(cancelled.code)?.status).toBe('closed');
    expect(find(owing.code)).toMatchObject({ status: 'lien', deleteAt: null, liens: [{ id: lienId, status: 'active' }] });
    expect(all.counts.lien).toBeGreaterThanOrEqual(1);
    expect((await page('?status=lien')).trades.map((t) => t.code)).toContain(owing.code);
    expect((await page('?status=lien')).trades.every((t) => t.status === 'lien')).toBe(true);
    expect(errorOf(await owner.get('/staff/v1/trades/status?status=nope'))).toBe('bad-request');

    // Only the owner, and only with a tap bound to this lien.
    const senior = await seedStaff(deps, { role: 'senior' });
    const sb = new StaffBrowser(app).withSession((await insertSession(deps, senior.id, 'staff')).token);
    expect((await sb.get('/staff/v1/trades/status')).statusCode).toBe(403);
    expect((await sb.post(`/staff/v1/liens/${lienId}/uncollectible`, { tapId: randomUUID() })).statusCode).toBe(403);
    expect(errorOf(await owner.post(`/staff/v1/liens/${lienId}/uncollectible`, { tapId: randomUUID() }))).toBe('tap-invalid');
    const other = await seedTap(deps, ownerId, { kind: 'lien-uncollectible', lienId: randomUUID() });
    expect(errorOf(await owner.post(`/staff/v1/liens/${lienId}/uncollectible`, { tapId: other }))).toBe('tap-invalid');

    const tapId = await seedTap(deps, ownerId, { kind: 'lien-uncollectible', lienId });
    const res = await owner.post(`/staff/v1/liens/${lienId}/uncollectible`, { tapId });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ status: 'uncollectible' });
    const row = (await deps.db.query('select status, lifted_at, written_off_by::text as by from liens where id = $1', [lienId])).rows[0];
    expect(row).toMatchObject({ status: 'uncollectible', by: ownerId });
    expect((await logEntries(deps, 'lien.uncollectible')).map((r) => JSON.parse(r.detail) as unknown)).toContainEqual({ lienId });
    expect((await page('?status=uncollectible')).trades.map((t) => t.code)).toContain(owing.code);
    expect((await tradeSelfDestruct(deps.db, owing.code)).deleteAt).toEqual(new Date(T0.getTime() + DISPUTE_KEEP_DAYS * DAY));
    // Once over, it stays over.
    const again = await seedTap(deps, ownerId, { kind: 'lien-uncollectible', lienId });
    expect([(await owner.post(`/staff/v1/liens/${lienId}/uncollectible`, { tapId: again })).statusCode]).toEqual([409]);
    // No ban was touched.
    if (ban !== null) expect((await deps.db.query('select count(*)::int as n from account_bans where account_id = $1', [owing.buyer])).rows[0]).toEqual(ban.rows[0]);
  });

  it('pages newest first with a cursor', async () => {
    const first = await page();
    if (first.next !== null) {
      const second = await page(`?before=${encodeURIComponent(first.next)}`);
      expect(second.trades.some((t) => first.trades.some((f) => f.code === t.code))).toBe(false);
    }
    expect(errorOf(await owner.get('/staff/v1/trades/status?before=bad'))).toBe('bad-request');
  });

  it('parses the lien-uncollectible intent strictly; only the owner may tap it', () => {
    const v = { kind: 'lien-uncollectible', lienId: randomUUID() } as const;
    expect(parseKeyTapIntent(v)).toEqual(v);
    expect(tapPermOf(v)).toBe('owner');
    for (const bad of [{ kind: 'lien-uncollectible' }, { ...v, lienId: 'x' }, { ...v, extra: 1 }]) expect(() => parseKeyTapIntent(bad)).toThrow();
  });
});
