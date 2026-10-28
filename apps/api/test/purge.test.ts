import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { purgeExpired } from '../src/auth/challenges.js';
import { DISPUTE_RETENTION_MS, purgeDisputes } from '../src/disputes/purge.js';
import { purgeNudges } from '../src/nudge/routes.js';
import { RETENTION_JOBS } from '../src/retentionJobs.js';
import { applyEvent } from '../src/trades/store.js';
import { TRADE_ADDRESS_RETENTION_MS, purgeTradeAddresses, purgeTradeAddressesJob } from '../src/trades/purge.js';
import { purgeRemovedWalletAddresses } from '../src/wallets/routes.js';
import { seedAccount } from './helpers/accounts.js';
import { testConfig } from './helpers/app.js';
import { testDb } from './helpers/db.js';
import { driveTo, seedTrade } from './helpers/trades.js';

let deps: Pick<Deps, 'db' | 'clock' | 'config'>;
const now = new Date('2026-10-17T12:00:00Z');
let n = 0;

beforeAll(async () => {
  deps = { db: await testDb(), clock: () => now, config: testConfig() };
});
afterAll(async () => {
  await deps.db.end();
});

async function released() {
  const seller = await seedAccount(deps, { username: `seller${++n}x` });
  const buyer = await seedAccount(deps, { username: `buyer${n}x` });
  const { trade } = await seedTrade(deps, { sellerId: seller, buyerId: buyer, poster: 'seller' });
  return driveTo(deps, trade, 'released');
}

async function addresses(code: string) {
  const { rows } = await deps.db.query<{ buyer_payout: string | null; seller_refund: string | null }>(
    'select buyer_payout, seller_refund from trades where code = $1', [code],
  );
  return rows[0]!;
}

const at = (base: Date, ms: number) => new Date(base.getTime() + ms);

describe('purgeTradeAddresses (P3-I12)', () => {
  it('nulls both addresses once 90 days after close have passed, not at the 90-day instant itself', async () => {
    const t = await released();
    expect(t.closedAt).toEqual(now);
    await purgeTradeAddresses(deps.db, at(now, TRADE_ADDRESS_RETENTION_MS - 1));
    expect(await addresses(t.code)).toEqual({ buyer_payout: expect.any(String), seller_refund: expect.any(String) });
    await purgeTradeAddresses(deps.db, at(now, TRADE_ADDRESS_RETENTION_MS));
    expect(await addresses(t.code)).toEqual({ buyer_payout: expect.any(String), seller_refund: expect.any(String) });
    expect(await purgeTradeAddresses(deps.db, at(now, TRADE_ADDRESS_RETENTION_MS + 1))).toBeGreaterThanOrEqual(1);
    expect(await addresses(t.code)).toEqual({ buyer_payout: null, seller_refund: null });
    // Already purged: the next run touches it no more.
    expect(await purgeTradeAddresses(deps.db, at(now, TRADE_ADDRESS_RETENTION_MS + 1))).toBe(0);
  });

  it('keeps a refunded trade\'s addresses at the last instant the buyer may still dispute it', async () => {
    const seller = await seedAccount(deps, { username: `seller${++n}x` });
    const buyer = await seedAccount(deps, { username: `buyer${n}x` });
    const { trade } = await seedTrade(deps, { sellerId: seller, buyerId: buyer, poster: 'seller' });
    await driveTo(deps, trade, 'secured');
    const refunded = await applyEvent(deps, trade.code, { type: 'settled', kind: 'mutual-cancel', txHash: 'ab'.repeat(32) }, 'system');
    expect(refunded.state).toBe('refunded');
    const edge = at(refunded.closedAt!, TRADE_ADDRESS_RETENTION_MS);
    // The purge runs first at that exact millisecond, then the buyer's dispute arrives in it too.
    await purgeTradeAddresses(deps.db, edge);
    expect(await addresses(trade.code)).toEqual({ buyer_payout: expect.any(String), seller_refund: expect.any(String) });
    const disputed = await applyEvent({ ...deps, clock: () => edge }, trade.code, { type: 'open-dispute' }, 'buyer');
    expect(disputed.state).toBe('disputed');
    await purgeTradeAddresses(deps.db, at(edge, 1));
    expect(await addresses(trade.code)).toEqual({ buyer_payout: expect.any(String), seller_refund: expect.any(String) });
  });

  it('keeps the addresses of an open trade and of a trade whose dispute is open', async () => {
    const t = await released();
    // Late funds after the release: the trade is disputed again (closedAt cleared by the machine)...
    await applyEvent(deps, t.code, { type: 'escalate' }, 'system');
    const open = await (async () => {
      const seller = await seedAccount(deps, { username: `seller${++n}x` });
      const buyer = await seedAccount(deps, { username: `buyer${n}x` });
      return (await seedTrade(deps, { sellerId: seller, buyerId: buyer, poster: 'buyer' })).trade;
    })();
    // ...and even a disputed row that still carries an old closed_at is kept.
    await deps.db.query('update trades set closed_at = $2 where code = $1', [t.code, now]);
    await purgeTradeAddresses(deps.db, at(now, 10 * TRADE_ADDRESS_RETENTION_MS));
    for (const code of [t.code, open.code]) {
      expect(await addresses(code)).toEqual({ buyer_payout: expect.any(String), seller_refund: expect.any(String) });
    }
  });

  it('runs as x2f_purge, which may only null the two addresses', async () => {
    const t = await released();
    const client = await deps.db.connect();
    try {
      await client.query('begin');
      await client.query('set local role x2f_purge');
      expect((await client.query<{ u: string }>('select current_user as u')).rows[0]!.u).toBe('x2f_purge');
      await expect(client.query("update trades set buyer_payout = 'attacker' where code = $1", [t.code])).rejects.toMatchObject({ code: '42501' });
      await client.query('rollback');
      await client.query('begin');
      await client.query('set local role x2f_purge');
      await expect(client.query("update trades set state = 'released' where code = $1", [t.code])).rejects.toMatchObject({ code: '42501' });
      await client.query('rollback');
      await client.query('begin');
      await client.query('set local role x2f_purge');
      await expect(client.query('insert into trade_events (code, at, by, event) values ($1, now(), $2, $3)', [t.code, 'system', '{}'])).rejects.toMatchObject({ code: '42501' });
      await client.query('rollback');
    } finally {
      client.release();
    }
  });
});

describe('trade_events is append-only', () => {
  it('refuses UPDATE, DELETE and TRUNCATE by the app role', async () => {
    const t = await released();
    await expect(deps.db.query("update trade_events set by = 'buyer' where code = $1", [t.code])).rejects.toMatchObject({ code: '42501' });
    await expect(deps.db.query('delete from trade_events where code = $1', [t.code])).rejects.toMatchObject({ code: '42501' });
    await expect(deps.db.query('truncate trade_events cascade')).rejects.toMatchObject({ code: '42501' });
    const { rows } = await deps.db.query<{ n: string }>('select count(*) as n from trade_events where code = $1', [t.code]);
    expect(Number(rows[0]!.n)).toBe(6);
  });

  it('allows DELETE by x2f_purge but never UPDATE', async () => {
    const t = await released();
    const client = await deps.db.connect();
    try {
      await client.query('begin');
      await client.query('set local role x2f_purge');
      await expect(client.query("update trade_events set by = 'buyer' where code = $1", [t.code])).rejects.toMatchObject({ code: '42501' });
      await client.query('rollback');
      await client.query('begin');
      await client.query('set local role x2f_purge');
      const del = await client.query('delete from trade_events where code = $1', [t.code]);
      expect(del.rowCount).toBe(6);
      await client.query('commit');
    } finally {
      client.release();
    }
  });
});

describe('retention scheduler jobs (X-12)', () => {
  it('runs purgeExpired, purgeRemovedWalletAddresses, purgeTradeAddresses, purgeNudges and purgeDisputes', () => {
    expect(RETENTION_JOBS).toEqual([purgeExpired, purgeRemovedWalletAddresses, purgeTradeAddressesJob, purgeNudges, purgeDisputes]);
    expect(purgeDisputes.name).toBe('purgeDisputes');
    expect(purgeTradeAddressesJob.name).toBe('purgeTradeAddresses');
  });
});

describe('purgeDisputes (spec 4.1: dispute records live 30 days after the dispute closes)', () => {
  async function disputed(status: 'open' | 'ruled' | 'appealed' | 'final' | 'closed', closedAt: Date | null) {
    const t = await released();
    await deps.db.query(
      `insert into disputes (code, opened_by, reason, note, opened_at, status, closed_at) values ($1, 'buyer', 'paid', 'for the moderator', $2, $3, $4)`,
      [t.code, now, status, closedAt],
    );
    await deps.db.query(
      `insert into dispute_rulings (code, round, outcome, reason, moderator_name, ruled_at, appeal_until) values ($1, 1, 'release-to-buyer', 'Paid.', 'sarah.v', $2, $2)`,
      [t.code, now],
    );
    await deps.db.query(`insert into dispute_appeals (code, by, why, at) values ($1, 'seller', 'Please look again at this.', $2)`, [t.code, now]);
    return t.code;
  }
  const rows = async (code: string) => {
    const n = async (table: string) => Number((await deps.db.query<{ n: string }>(`select count(*) as n from ${table} where code = $1`, [code])).rows[0]!.n);
    return [await n('disputes'), await n('dispute_rulings'), await n('dispute_appeals')];
  };

  it('deletes a closed dispute, its rulings and its appeal once 30 days have passed, not at the instant itself', async () => {
    const code = await disputed('closed', now);
    expect(await purgeDisputes.run(deps.db, at(now, DISPUTE_RETENTION_MS - 1))).toBe(0);
    expect(await rows(code)).toEqual([1, 1, 1]);
    await purgeDisputes.run(deps.db, at(now, DISPUTE_RETENTION_MS));
    expect(await rows(code)).toEqual([1, 1, 1]);
    // The count is what the scheduler logs (the job name and a number, nothing from the rows).
    const n = await purgeDisputes.run(deps.db, at(now, DISPUTE_RETENTION_MS + 1));
    expect(n).toBeGreaterThanOrEqual(1);
    expect(await rows(code)).toEqual([0, 0, 0]);
    expect(await purgeDisputes.run(deps.db, at(now, DISPUTE_RETENTION_MS + 1))).toBe(0);
  });

  it('never touches a dispute that is not closed, however old', async () => {
    const codes = [];
    for (const s of ['open', 'ruled', 'appealed', 'final'] as const) codes.push(await disputed(s, null));
    await purgeDisputes.run(deps.db, at(now, 100 * DISPUTE_RETENTION_MS));
    for (const code of codes) expect(await rows(code)).toEqual([1, 1, 1]);
  });

  it('closed and closed_at go together, and deleting a trade takes its dispute records with it', async () => {
    const t = await released();
    await expect(deps.db.query(`insert into disputes (code, opened_by, reason, opened_at, status) values ($1, 'buyer', 'paid', $2, 'closed')`, [t.code, now]))
      .rejects.toMatchObject({ code: '23514' });
    await expect(deps.db.query(`insert into disputes (code, opened_by, reason, opened_at, status, closed_at) values ($1, 'buyer', 'paid', $2, 'open', $2)`, [t.code, now]))
      .rejects.toMatchObject({ code: '23514' });
    const code = await disputed('final', null);
    const client = await deps.db.connect();
    try {
      // The disputes rows never block a trade's deletion (trade_events is cleared first, as x2f_purge).
      await client.query('begin');
      await client.query('set local role x2f_purge');
      await client.query('delete from trade_events where code = $1', [code]);
      await client.query('reset role');
      await client.query('delete from trades where code = $1', [code]);
      expect(await (async () => {
        const n = async (table: string) => Number((await client.query<{ n: string }>(`select count(*) as n from ${table} where code = $1`, [code])).rows[0]!.n);
        return [await n('disputes'), await n('dispute_rulings'), await n('dispute_appeals')];
      })()).toEqual([0, 0, 0]);
      await client.query('rollback');
    } finally {
      client.release();
    }
  });
});
