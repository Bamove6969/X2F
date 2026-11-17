// Plan 4 Task 25 and Task 12's owed fees (J-06; owner D-006, D-008, D-009, D-062, D-063): the liens
// and owed fees of migration 400, kept in step with every change of a dispute (store.ts
// `withDispute` → disputes/lien.ts `applyLienRules`). Who owes what is @x2f/staff `lienSteps`
// (packages/staff/test/lien.test.ts); this file checks that it is stored, logged and enforced.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../../src/app.js';
import { hasActiveLien } from '../../src/disputes/lien.js';
import { applyDispute } from '@x2f/staff';
import { DISPUTE_DEFAULTS } from '../../src/disputes/settings.js';
import { startDispute, withDispute } from '../../src/disputes/store.js';
import { disputeTimerJob } from '../../src/disputes/timers.js';
import { revenueReport } from '../../src/staff/revenue.js';
import { appealDirect, publishRuling } from '../helpers/disputes.js';
import { insertOffer } from '../helpers/offers.js';
import { AMOUNT, driveTo, seedTrade } from '../helpers/trades.js';
import { tradeApp } from '../helpers/tradeApp.js';

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];

const START = new Date('2026-11-12T12:00:00Z');
const MIN = 60_000;
const H = 60 * MIN;
const at = (ms: number) => new Date(START.getTime() + ms);
/** The trade's 1% (escrowPlan of AMOUNT). */
const FEE = AMOUNT / 100n;

beforeAll(async () => {
  ({ app, deps, trader, setNow } = await tradeApp());
});
afterAll(async () => {
  await app.close();
});

const errorOf = (res: { json(): unknown }) => (res.json() as { error?: string }).error;

async function relogin(...who: { id: string; browser: { post(url: string, body: unknown): Promise<{ statusCode: number }> } }[]) {
  for (const w of who) expect((await w.browser.post('/t/login', { accountId: w.id })).statusCode).toBe(200);
}

/** A trade with a dispute opened at START: after a refund (the buyer disputes it) or on the escrow. */
async function disputed(o: { afterRefund: boolean; poster?: 'seller' | 'buyer' }) {
  setNow(START);
  const seller = await trader();
  const buyer = await trader();
  const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: o.poster ?? 'seller' });
  const t = await driveTo(deps, trade, 'paid');
  const client = await deps.db.connect();
  try {
    await client.query('begin');
    await startDispute(client, t, { openedBy: 'buyer', reason: 'paid', note: '', afterRefund: o.afterRefund, now: START, prices: null });
    await client.query('commit');
  } finally {
    client.release();
  }
  setNow(at(H));
  await relogin(seller, buyer);
  return { seller, buyer, code: t.code };
}

interface LienRow {
  debtor: string;
  creditor: string;
  amount_atomic: string;
  fee_atomic: string;
  round: number;
  cause: string;
  status: string;
  lifted: boolean;
}

async function liens(code: string): Promise<LienRow[]> {
  const { rows } = await deps.db.query<LienRow>(
    `select debtor_account_id::text as debtor, creditor_account_id::text as creditor, amount_atomic::text, fee_atomic::text, round, cause, status,
            lifted_at is not null as lifted
       from liens where from_code = $1 order by created_at, round`,
    [code],
  );
  return rows;
}

async function owed(code: string) {
  const { rows } = await deps.db.query<{ account: string; amount_atomic: string; collected_atomic: string }>(
    'select account_id::text as account, amount_atomic::text, collected_atomic::text from fees_owed where from_code = $1',
    [code],
  );
  return rows;
}

async function lienLog(code: string) {
  const { rows } = await deps.db.query<{ action: string; actor_kind: string; detail: string }>(
    `select action, actor_kind, detail from activity_log where trade_code = $1 and (action like 'lien.%' or action = 'fee.owed') order by id`,
    [code],
  );
  return rows.map((r) => ({ action: r.action, actor: r.actor_kind, detail: JSON.parse(r.detail) as Record<string, unknown> }));
}

const tick = () => disputeTimerJob().run(deps.db, deps.clock());

describe('a lost dispute that requires restitution: an immediate lien (D-008, D-009)', () => {
  it('seller-sends-xmr after a refund liens the seller at publish for the trade XMR; the buyer is owed it; logged by the system', async () => {
    const { seller, buyer, code } = await disputed({ afterRefund: true, poster: 'buyer' });
    await publishRuling(deps, code, { outcome: 'seller-sends-xmr' });
    expect(await liens(code)).toEqual([
      { debtor: seller.id, creditor: buyer.id, amount_atomic: AMOUNT.toString(), fee_atomic: '0', round: 1, cause: 'restitution', status: 'active', lifted: false },
    ]);
    expect(await hasActiveLien(deps.db, seller.id)).toBe(true);
    expect(await hasActiveLien(deps.db, buyer.id)).toBe(false);
    const log = await lienLog(code);
    expect(log).toEqual([{ action: 'lien.placed', actor: 'system', detail: { lienId: expect.any(String), accountId: seller.id, amountAtomic: AMOUNT.toString(), cause: 'restitution' } }]);
    // The fee waits for the outcome (g63): nothing is owed while the appeal window is open.
    expect(await owed(code)).toEqual([]);
  });

  it('D-063: on the seller\'s own ad the lien also carries the unpaid 1%', async () => {
    const { seller, code } = await disputed({ afterRefund: true, poster: 'seller' });
    await publishRuling(deps, code, { outcome: 'seller-sends-xmr' });
    expect(await liens(code)).toMatchObject([{ debtor: seller.id, amount_atomic: AMOUNT.toString(), fee_atomic: FEE.toString() }]);
    expect((await lienLog(code))[0]!.detail).toMatchObject({ amountAtomic: (AMOUNT + FEE).toString() });
  });

  it('a ruling the escrow pays in full places no lien, whoever wins', async () => {
    for (const outcome of ['release-to-buyer', 'refund-to-seller'] as const) {
      const { code } = await disputed({ afterRefund: false });
      await publishRuling(deps, code, { outcome });
      expect(await liens(code), outcome).toEqual([]);
    }
  });
});

describe('an appeal lifts the lien while it is pending, and its outcome decides (D-008)', () => {
  it("the seller's appeal through the route suspends it: they may trade again meanwhile", async () => {
    const { seller, code } = await disputed({ afterRefund: true, poster: 'buyer' });
    await publishRuling(deps, code, { outcome: 'seller-sends-xmr' });
    setNow(at(2 * H));
    await relogin(seller);
    const res = await seller.browser.post(`/v1/trades/${code}/appeal`, { why: 'I sent the XMR already, here is why.' });
    expect(res.statusCode, res.body).toBe(200);
    expect(await liens(code)).toMatchObject([{ status: 'suspended', lifted: false }]);
    expect(await hasActiveLien(deps.db, seller.id)).toBe(false);
    expect((await lienLog(code)).map((e) => e.action)).toEqual(['lien.placed', 'lien.suspended']);
  });

  it("the buyer's appeal (the person owed) leaves the lien in force", async () => {
    const { seller, code } = await disputed({ afterRefund: true, poster: 'buyer' });
    await publishRuling(deps, code, { outcome: 'seller-sends-xmr' });
    await appealDirect(deps, code, 'buyer');
    expect(await liens(code)).toMatchObject([{ status: 'active' }]);
    expect(await hasActiveLien(deps.db, seller.id)).toBe(true);
  });

  it('"Decision stands": active again, and the buyer poster now owes the 1% from future trades (g63 poster pays; owner question O3)', async () => {
    const { seller, buyer, code } = await disputed({ afterRefund: true, poster: 'buyer' });
    await publishRuling(deps, code, { outcome: 'seller-sends-xmr' });
    await appealDirect(deps, code, 'seller');
    await publishRuling(deps, code, { outcome: 'seller-sends-xmr' });
    expect(await liens(code)).toMatchObject([{ round: 1, status: 'active' }]);
    expect(await hasActiveLien(deps.db, seller.id)).toBe(true);
    expect(await owed(code)).toEqual([{ account: buyer.id, amount_atomic: FEE.toString(), collected_atomic: '0' }]);
    expect((await lienLog(code)).map((e) => e.action)).toEqual(['lien.placed', 'lien.suspended', 'lien.reactivated', 'fee.owed']);
  });

  it('"Decision overruled": the restitution lien is void, nothing owed', async () => {
    const { seller, code } = await disputed({ afterRefund: true, poster: 'buyer' });
    await publishRuling(deps, code, { outcome: 'seller-sends-xmr' });
    await appealDirect(deps, code, 'seller');
    await publishRuling(deps, code, { outcome: 'no-action' });
    expect(await liens(code)).toMatchObject([{ status: 'void', lifted: true }]);
    expect(await hasActiveLien(deps.db, seller.id)).toBe(false);
    expect(await owed(code)).toEqual([]);
  });

  it('no appeal by the end of the window: the lien stays; the fee becomes owed', async () => {
    const { buyer, code } = await disputed({ afterRefund: true, poster: 'buyer' });
    await publishRuling(deps, code, { outcome: 'seller-sends-xmr' });
    setNow(at(H + 48 * H));
    expect(await tick()).toBeGreaterThanOrEqual(1);
    expect(await liens(code)).toMatchObject([{ status: 'active' }]);
    expect(await owed(code)).toEqual([{ account: buyer.id, amount_atomic: FEE.toString(), collected_atomic: '0' }]);
    // A second pass changes nothing.
    await tick();
    expect(await owed(code)).toHaveLength(1);
    expect((await lienLog(code)).map((e) => e.action)).toEqual(['lien.placed', 'fee.owed']);
  });
});

describe('a won appeal liens whoever received the coins (D-006)', () => {
  it('released at round 1, refunded on appeal: the buyer is liened for the trade XMR, owed to the seller', async () => {
    const { seller, buyer, code } = await disputed({ afterRefund: false, poster: 'seller' });
    await publishRuling(deps, code, { outcome: 'release-to-buyer' });
    await appealDirect(deps, code, 'seller');
    await publishRuling(deps, code, { outcome: 'refund-to-seller' });
    expect(await liens(code)).toEqual([
      { debtor: buyer.id, creditor: seller.id, amount_atomic: AMOUNT.toString(), fee_atomic: '0', round: 2, cause: 'overturned', status: 'active', lifted: false },
    ]);
    expect(await owed(code)).toEqual([]);
  });

  it('refunded at round 1, released on appeal on a buyer\'s ad: the seller is liened; the buyer owes the 1% (D-063; g63 poster pays, owner question O3)', async () => {
    const { seller, buyer, code } = await disputed({ afterRefund: false, poster: 'buyer' });
    await publishRuling(deps, code, { outcome: 'refund-to-seller' });
    await appealDirect(deps, code, 'buyer');
    await publishRuling(deps, code, { outcome: 'release-to-buyer' });
    expect(await liens(code)).toMatchObject([{ debtor: seller.id, creditor: buyer.id, fee_atomic: '0', cause: 'overturned', status: 'active' }]);
    expect(await owed(code)).toEqual([{ account: buyer.id, amount_atomic: FEE.toString(), collected_atomic: '0' }]);
  });

  it('a decision that stands brings no lien', async () => {
    const { code } = await disputed({ afterRefund: false });
    await publishRuling(deps, code, { outcome: 'release-to-buyer' });
    await appealDirect(deps, code, 'seller');
    await publishRuling(deps, code, { outcome: 'release-to-buyer' });
    expect(await liens(code)).toEqual([]);
  });
});

/** The seller's payment proof accepted (`complied`), through withDispute as its route will (NEEDS_TASK_12_TX_PROOF). */
async function complied(code: string) {
  const S = { appealWindowH: DISPUTE_DEFAULTS.appealWindowH, firstResponseH: DISPUTE_DEFAULTS.firstResponseH };
  await withDispute(deps, { code }, async (d, _client, now) => applyDispute(d, { type: 'complied' }, { kind: 'system' }, now, S));
}

// Review B1 (lien recovery, 2026-11-16): a lien keeps the creditor's own address from the disputed
// trade, the one the moderation service signed there, so recoveries go to it and nowhere the API chooses.
describe('the creditor\'s address is bound at placement (review B1)', () => {
  it('seller-sends-xmr: the lien keeps the buyer\'s payout address from the disputed trade', async () => {
    const { code } = await disputed({ afterRefund: true, poster: 'buyer' });
    const payout = (await deps.db.query<{ a: string }>('select buyer_payout as a from trades where code = $1', [code])).rows[0]!.a;
    await publishRuling(deps, code, { outcome: 'seller-sends-xmr' });
    const { rows } = await deps.db.query('select creditor_address from liens where from_code = $1', [code]);
    expect(rows).toEqual([{ creditor_address: payout }]);
  });

  it('released at round 1, refunded on appeal: the buyer\'s lien pays the seller\'s refund address', async () => {
    const { buyer, code } = await disputed({ afterRefund: false });
    const refund = (await deps.db.query<{ a: string }>('select seller_refund as a from trades where code = $1', [code])).rows[0]!.a;
    await publishRuling(deps, code, { outcome: 'release-to-buyer' });
    await appealDirect(deps, code, 'seller');
    await publishRuling(deps, code, { outcome: 'refund-to-seller' });
    const { rows } = await deps.db.query('select debtor_account_id::text as d, creditor_address from liens where from_code = $1 and round = 2', [code]);
    expect(rows).toEqual([{ d: buyer.id, creditor_address: refund }]);
  });

  it('once set it never changes', async () => {
    const { code } = await disputed({ afterRefund: true, poster: 'buyer' });
    await publishRuling(deps, code, { outcome: 'seller-sends-xmr' });
    await expect(deps.db.query(`update liens set creditor_address = 'x' where from_code = $1`, [code])).rejects.toThrow(/never change/);
  });
});

// Review M2 (lien recovery): a lien the seller repays directly (complied) while a trade of theirs
// still carries a signed recovery for it would be paid twice; complied waits until that trade ends.
describe('complied while a recovery is in flight (review M2)', () => {
  it('is refused while the debtor\'s trade holds an open recovery for the lien; accepted once it ends', async () => {
    const { seller, code } = await disputed({ afterRefund: true, poster: 'buyer' });
    await publishRuling(deps, code, { outcome: 'seller-sends-xmr' });
    const lien = (await deps.db.query<{ id: string }>('select id::text from liens where from_code = $1', [code])).rows[0]!.id;
    const other = await trader();
    const { code: next } = await seedTrade(deps, { sellerId: other.id, buyerId: seller.id, poster: 'seller' });
    await deps.db.query(`insert into lien_recovery_holds (lien_id, trade_code, amount_atomic, address, created_at) values ($1, $2, 1000, 'creditor-address', now())`, [lien, next]);
    await expect(complied(code)).rejects.toMatchObject({ status: 409, code: 'lien-recovery-in-flight' });
    expect(await liens(code)).toMatchObject([{ status: 'active' }]);
    await deps.db.query(`update lien_recovery_holds set status = 'released', closed_at = now(), address = null where trade_code = $1`, [next]);
    await complied(code);
    expect(await liens(code)).toMatchObject([{ status: 'repaid' }]);
  });
});

describe('the seller pays the XMR (complied, through withDispute; review L6)', () => {
  it('a lien for the XMR alone is repaid and logged; the seller may trade again', async () => {
    const { seller, code } = await disputed({ afterRefund: true, poster: 'buyer' });
    await publishRuling(deps, code, { outcome: 'seller-sends-xmr' });
    await complied(code);
    expect(await liens(code)).toMatchObject([{ status: 'repaid', lifted: true }]);
    expect(await hasActiveLien(deps.db, seller.id)).toBe(false);
    expect((await lienLog(code)).map((e) => e.action)).toEqual(['lien.placed', 'lien.repaid']);
  });
});

describe('review L1: the seller paid, then the appeal overrules the order to pay', () => {
  for (const by of ['seller', 'buyer'] as const) {
    it(`appeal by the ${by}, overruled to no-action: the buyer is liened for the XMR received, owed to the seller`, async () => {
      const { seller, buyer, code } = await disputed({ afterRefund: true, poster: 'buyer' });
      await publishRuling(deps, code, { outcome: 'seller-sends-xmr' });
      await complied(code);
      await appealDirect(deps, code, by);
      // The repaid lien stays over: the appeal suspends nothing.
      expect(await liens(code)).toMatchObject([{ status: 'repaid' }]);
      await publishRuling(deps, code, { outcome: 'no-action' });
      expect(await liens(code)).toEqual([
        expect.objectContaining({ debtor: seller.id, round: 1, status: 'repaid' }),
        { debtor: buyer.id, creditor: seller.id, amount_atomic: AMOUNT.toString(), fee_atomic: '0', round: 2, cause: 'overturned', status: 'active', lifted: false },
      ]);
      expect(await hasActiveLien(deps.db, buyer.id)).toBe(true);
      expect(await owed(code)).toEqual([]);
      expect((await lienLog(code)).map((e) => e.action)).toEqual(['lien.placed', 'lien.repaid', 'lien.placed']);
    });
  }
});

describe("re-verify R1: on the seller's own ad the paid lien keeps the 1% and stays active", () => {
  for (const by of ['seller', 'buyer'] as const) {
    for (const final of ['no-action', 'seller-returns-fiat'] as const) {
      it(`appeal by the ${by}, overruled to ${final}: the round-1 lien is void and the buyer is liened for the XMR received`, async () => {
        const { seller, buyer, code } = await disputed({ afterRefund: true, poster: 'seller' });
        await publishRuling(deps, code, { outcome: 'seller-sends-xmr' });
        await complied(code);
        // The lien carries the seller's own 1% (D-063), so paying the buyer does not repay it.
        expect(await liens(code)).toMatchObject([{ fee_atomic: FEE.toString(), status: 'active' }]);
        await appealDirect(deps, code, by);
        expect(await liens(code)).toMatchObject([{ status: by === 'seller' ? 'suspended' : 'active' }]);
        await publishRuling(deps, code, { outcome: final });
        expect(await liens(code)).toEqual([
          expect.objectContaining({ debtor: seller.id, round: 1, status: 'void' }),
          { debtor: buyer.id, creditor: seller.id, amount_atomic: AMOUNT.toString(), fee_atomic: '0', round: 2, cause: 'overturned', status: 'active', lifted: false },
        ]);
        expect(await hasActiveLien(deps.db, buyer.id)).toBe(true);
        expect(await owed(code)).toEqual([]);
      });
    }
  }
});

describe("re-verify R2: liens switched off on a seller's ad, the seller's 1% is still recorded", () => {
  it('seller-sends-xmr while off: nothing at publish; one owed fee on the seller once the ruling is final', async () => {
    const { seller, code } = await disputed({ afterRefund: true, poster: 'seller' });
    await deps.db.query('update site_flags set liens_enabled = false');
    try {
      await publishRuling(deps, code, { outcome: 'seller-sends-xmr' });
      expect(await liens(code)).toEqual([]);
      // Never at publish: an appeal could still overrule it, and an owed fee cannot be undone.
      expect(await owed(code)).toEqual([]);
      setNow(at(H + 48 * H));
      expect(await tick()).toBeGreaterThanOrEqual(1);
      expect(await owed(code)).toEqual([{ account: seller.id, amount_atomic: FEE.toString(), collected_atomic: '0' }]);
      await tick();
      expect(await owed(code)).toHaveLength(1);
      expect((await lienLog(code)).map((e) => e.action)).toEqual(['fee.owed']);
    } finally {
      await deps.db.query('update site_flags set liens_enabled = true');
    }
  });
});

describe("re-verify N2: switched off between publish and finality on a seller's ad, the 1% is not owed twice", () => {
  it('placed while on with the 1%, final while off: no owed fee, and the lien still carries the 1%', async () => {
    const { seller, buyer, code } = await disputed({ afterRefund: true, poster: 'seller' });
    await publishRuling(deps, code, { outcome: 'seller-sends-xmr' });
    expect(await liens(code)).toEqual([
      { debtor: seller.id, creditor: buyer.id, amount_atomic: AMOUNT.toString(), fee_atomic: FEE.toString(), round: 1, cause: 'restitution', status: 'active', lifted: false },
    ]);
    await deps.db.query('update site_flags set liens_enabled = false');
    try {
      setNow(at(H + 48 * H));
      expect(await tick()).toBeGreaterThanOrEqual(1);
      // The stored lien already carries the seller's 1% (D-063): it is not also owed from future trades.
      expect(await owed(code)).toEqual([]);
      expect(await liens(code)).toEqual([
        { debtor: seller.id, creditor: buyer.id, amount_atomic: AMOUNT.toString(), fee_atomic: FEE.toString(), round: 1, cause: 'restitution', status: 'active', lifted: false },
      ]);
      expect((await lienLog(code)).map((e) => e.action)).toEqual(['lien.placed']);
    } finally {
      await deps.db.query('update site_flags set liens_enabled = true');
    }
  });
});

describe('review L2: liens stay dark until switched on (site_flags.liens_enabled)', () => {
  it('switched off: no lien is placed and none blocks trading, but the owed 1% is still recorded', async () => {
    const { seller, buyer, code } = await disputed({ afterRefund: true, poster: 'buyer' });
    // A lien from before the switch-off (placed while on) blocks nothing while off.
    const earlier = await disputed({ afterRefund: true, poster: 'buyer' });
    await publishRuling(deps, earlier.code, { outcome: 'seller-sends-xmr' });
    expect(await hasActiveLien(deps.db, earlier.seller.id)).toBe(true);
    await deps.db.query('update site_flags set liens_enabled = false');
    try {
      expect(await hasActiveLien(deps.db, earlier.seller.id)).toBe(false);
      await publishRuling(deps, code, { outcome: 'seller-sends-xmr' });
      expect(await liens(code)).toEqual([]);
      expect(await hasActiveLien(deps.db, seller.id)).toBe(false);
      setNow(at(H + 48 * H));
      await tick();
      expect(await owed(code)).toEqual([{ account: buyer.id, amount_atomic: FEE.toString(), collected_atomic: '0' }]);
    } finally {
      await deps.db.query('update site_flags set liens_enabled = true');
    }
    expect(await hasActiveLien(deps.db, earlier.seller.id)).toBe(true);
  });
});

describe('the records (migration 400)', () => {
  it('review L3: neither table can be truncated', async () => {
    // Since 560 the recovery tables reference liens: a plain truncate is refused by the foreign
    // keys (0A000), and a cascading one by the guards (42501).
    await expect(deps.db.query('truncate liens')).rejects.toMatchObject({ code: expect.stringMatching(/^(42501|0A000)$/) });
    await expect(deps.db.query('truncate liens cascade')).rejects.toMatchObject({ code: '42501' });
    for (const t of ['lien_recoveries', 'lien_recovery_holds', 'lien_rate_requests']) {
      await expect(deps.db.query(`truncate ${t}`), t).rejects.toMatchObject({ code: '42501' });
    }
    await expect(deps.db.query('truncate fees_owed')).rejects.toMatchObject({ code: '42501' });
  });

  it('review L4: a lien or an owed fee that is over never changes again, in any column', async () => {
    const { code } = await disputed({ afterRefund: true, poster: 'buyer' });
    await publishRuling(deps, code, { outcome: 'seller-sends-xmr' });
    await complied(code);
    for (const set of [`changed_at = changed_at + interval '1 s'`, `lifted_at = lifted_at + interval '1 s'`, `repayment_code = 'X'`]) {
      await expect(deps.db.query(`update liens set ${set} where from_code = $1`, [code]), set).rejects.toMatchObject({ code: '42501' });
    }
    const other = await disputed({ afterRefund: true, poster: 'buyer' });
    await publishRuling(deps, other.code, { outcome: 'seller-sends-xmr' });
    setNow(at(H + 48 * H));
    await tick();
    await deps.db.query('update fees_owed set collected_atomic = amount_atomic, settled_at = $2 where from_code = $1', [other.code, deps.clock()]);
    await expect(deps.db.query(`update fees_owed set settled_at = settled_at + interval '1 s' where from_code = $1`, [other.code])).rejects.toMatchObject({ code: '42501' });
  });

  it('a lien is an account record: it survives the trade being deleted (the 90-day purge)', async () => {
    const { seller, code } = await disputed({ afterRefund: true, poster: 'buyer' });
    await publishRuling(deps, code, { outcome: 'seller-sends-xmr' });
    setNow(at(H + 48 * H));
    await tick();
    // Nothing ties either record to the trade, so no purge can cascade to it.
    const fk = await deps.db.query(
      `select 1 from pg_constraint where contype = 'f' and conrelid in ('liens'::regclass, 'fees_owed'::regclass) and confrelid <> 'accounts'::regclass`,
    );
    expect(fk.rows).toEqual([]);
    // Plan 7's whole-trade purge is not on this tree: remove the trade directly (triggers and
    // foreign keys off for this transaction only, as revenue.test.ts does).
    const c = await deps.db.connect();
    try {
      await c.query('begin');
      await c.query("set local session_replication_role = 'replica'");
      for (const table of ['dispute_appeals', 'dispute_rulings', 'disputes', 'trade_events']) await c.query(`delete from ${table} where code = $1`, [code]);
      await c.query('delete from trades where code = $1', [code]);
      await c.query('commit');
    } finally {
      c.release();
    }
    expect(await liens(code)).toHaveLength(1);
    expect(await owed(code)).toHaveLength(1);
    expect(await hasActiveLien(deps.db, seller.id)).toBe(true);
  });

  it('a lien is never deleted, its amounts and parties never change, and one that is over stays over', async () => {
    const { code } = await disputed({ afterRefund: true, poster: 'buyer' });
    await publishRuling(deps, code, { outcome: 'seller-sends-xmr' });
    await expect(deps.db.query('delete from liens where from_code = $1', [code])).rejects.toMatchObject({ code: '42501' });
    await expect(deps.db.query('update liens set amount_atomic = 1 where from_code = $1', [code])).rejects.toMatchObject({ code: '42501' });
    await appealDirect(deps, code, 'seller');
    await publishRuling(deps, code, { outcome: 'no-action' });
    await expect(deps.db.query(`update liens set status = 'active', lifted_at = null where from_code = $1`, [code])).rejects.toMatchObject({ code: '42501' });
  });

  it('an owed fee only collects upwards and is never deleted', async () => {
    const { code } = await disputed({ afterRefund: true, poster: 'buyer' });
    await publishRuling(deps, code, { outcome: 'seller-sends-xmr' });
    setNow(at(H + 48 * H));
    await tick();
    await deps.db.query('update fees_owed set collected_atomic = 5 where from_code = $1', [code]);
    await expect(deps.db.query('update fees_owed set collected_atomic = 4 where from_code = $1', [code])).rejects.toMatchObject({ code: '42501' });
    await expect(deps.db.query('delete from fees_owed where from_code = $1', [code])).rejects.toMatchObject({ code: '42501' });
  });

  it("the owner's revenue report lists what is owed and not yet collected", async () => {
    const before = BigInt((await revenueReport(deps.db, { from: '2026-11-01', to: '2026-11-30', by: 'month' })).owedOutstandingAtomic);
    const { code } = await disputed({ afterRefund: true, poster: 'buyer' });
    await publishRuling(deps, code, { outcome: 'seller-sends-xmr' });
    setNow(at(H + 48 * H));
    await tick();
    const after = (await revenueReport(deps.db, { from: '2026-11-01', to: '2026-11-30', by: 'month' })).owedOutstandingAtomic;
    expect(BigInt(after) - before).toBe(FEE);
  });
});

describe('owner option b (16 Nov 2026): a lien no longer blocks trading', () => {
  it('the debtor may take an offer while the lien is active; the lien stays active', async () => {
    const { seller, code } = await disputed({ afterRefund: true, poster: 'buyer' });
    await publishRuling(deps, code, { outcome: 'seller-sends-xmr' });
    const poster = await trader();
    const offerId = await insertOffer(deps.db, { accountId: poster.id, side: 'buy', methodId: 'ZELLE', currency: 'USD', min: 1000, max: 100000, minTrades: null, at: deps.clock() });
    const body = { amountAtomic: '1000000000000', walletId: '00000000-0000-4000-8000-000000000000', centsPerXmr: '33000', fiatCents: '33000', methodId: 'ZELLE', currency: 'USD' };
    await relogin(seller);
    const take = await seller.browser.post(`/v1/offers/${offerId}/take`, body);
    expect(errorOf(take)).not.toBe('lien');
    expect(await hasActiveLien(deps.db, seller.id)).toBe(true);
  });
});
