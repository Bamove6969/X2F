import { TIMERS } from '@x2f/trade';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { purgeExpired } from '../src/auth/challenges.js';
import { purgeChatsJob } from '../src/chat/retention.js';
import { purgeFeedbackForm } from '../src/feedback/form.js';
import { purgeFeedback } from '../src/feedback/mood.js';
import { purgeNudges } from '../src/nudge/routes.js';
import { RETENTION_JOBS } from '../src/retentionJobs.js';
import { purgeJabberPending } from '../src/jabber/retention.js';
import { PREKEY_RECORD_RETENTION_MS, purgeJabberPreKeys } from '../src/jabber/prekeys.js';
import { applyEvent } from '../src/trades/store.js';
import { purgeTeamLeftovers } from '../src/team/members.js';
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
  const seller = await seedAccount(deps, { loginName: `seller${++n}x` });
  const buyer = await seedAccount(deps, { loginName: `buyer${n}x` });
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

  it('keeps a refunded trade\'s addresses through the buyer\'s dispute window and while disputed', async () => {
    const seller = await seedAccount(deps, { loginName: `seller${++n}x` });
    const buyer = await seedAccount(deps, { loginName: `buyer${n}x` });
    const { trade } = await seedTrade(deps, { sellerId: seller, buyerId: buyer, poster: 'seller' });
    await driveTo(deps, trade, 'secured');
    // A no-show refund (a cancel's refund can't be disputed, owner 2026-10-29).
    const refunded = await applyEvent(deps, trade.code, { type: 'settled', kind: 'auto-refund', txHash: 'ab'.repeat(32) }, 'system');
    expect(refunded.state).toBe('refunded');
    const edge = at(refunded.closedAt!, TRADE_ADDRESS_RETENTION_MS);
    // The dispute window (48 h, owner 2026-10-29) ends long before the address retention: the
    // purge at the window's last instant keeps them, and the dispute opened then keeps them after.
    const lastDispute = at(refunded.closedAt!, TIMERS.disputeAfterRefundHours * 3_600_000);
    await purgeTradeAddresses(deps.db, lastDispute);
    expect(await addresses(trade.code)).toEqual({ buyer_payout: expect.any(String), seller_refund: expect.any(String) });
    const disputed = await applyEvent({ ...deps, clock: () => lastDispute }, trade.code, { type: 'open-dispute' }, 'buyer');
    expect(disputed.state).toBe('disputed');
    await purgeTradeAddresses(deps.db, at(edge, 1));
    expect(await addresses(trade.code)).toEqual({ buyer_payout: expect.any(String), seller_refund: expect.any(String) });
  });

  it('keeps the addresses of an open trade and of a trade whose dispute is open', async () => {
    const t = await released();
    // Late funds after the release: the trade is disputed again (closedAt cleared by the machine)...
    await applyEvent(deps, t.code, { type: 'escalate' }, 'system');
    const open = await (async () => {
      const seller = await seedAccount(deps, { loginName: `seller${++n}x` });
      const buyer = await seedAccount(deps, { loginName: `buyer${n}x` });
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
  it('runs purgeExpired, purgeRemovedWalletAddresses, purgeTradeAddresses and purgeNudges', () => {
    expect(RETENTION_JOBS).toEqual([purgeExpired, purgeRemovedWalletAddresses, purgeTeamLeftovers, purgeTradeAddressesJob, purgeNudges, purgeChatsJob, purgeFeedbackForm, purgeFeedback, purgeJabberPending, purgeJabberPreKeys]);
    expect(purgeTradeAddressesJob.name).toBe('purgeTradeAddresses');
  });

  it('review R5: the OMEMO prekey record is kept 180 days after its last write (a device offline that long may still read)', () => {
    expect(PREKEY_RECORD_RETENTION_MS).toBe(180 * 86_400_000);
  });
});
