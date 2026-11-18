// Plan 4 Task 12, after-refund compliance (A6; was NEEDS_TASK_12_TX_PROOF): the seller of a
// `seller-sends-xmr` ruling proves the payment with the tx hash and its key, checked on X2F's node
// against the trade's own buyer address and XMR (disputes/comply.ts); and a seller who lets
// COMPLY_H pass goes to a senior moderator or the owner. The node is a stand-in here (`txProof`):
// the production check (disputes/txProof.ts, monero-ts checkTxKey) needs regtest.
import { randomBytes } from 'node:crypto';
import { COMPLY_H } from '@x2f/staff';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deps } from '../../src/app.js';
import { COMPLY_CONFIRMATIONS, PROOF_RECHECK_MS } from '../../src/disputes/comply.js';
import { hasActiveLien } from '../../src/disputes/lien.js';
import { NO_MODERATION } from '../../src/disputes/moderationClient.js';
import { loadDispute, startDispute } from '../../src/disputes/store.js';
import { disputeTimerJob } from '../../src/disputes/timers.js';
import { TxProofUnavailable, type TxProofCheck, type TxProofResult } from '../../src/disputes/txProof.js';
import { buildStaffApi } from '../../src/staff/app.js';
import { appealDirect, publishRuling } from '../helpers/disputes.js';
import { STAFF_ORIGIN, StaffBrowser, insertSession, seedStaff } from '../helpers/staffApp.js';
import { tradeApp } from '../helpers/tradeApp.js';
import { AMOUNT, driveTo, seedTrade } from '../helpers/trades.js';

const START = new Date('2026-11-14T12:00:00Z');
const MIN = 60_000;
const H = 60 * MIN;
const at = (ms: number) => new Date(START.getTime() + ms);
/** The ruling is published one hour after the dispute opened, so the seller must pay by this. */
const PUBLISHED = at(H);
const COMPLY_BY = new Date(PUBLISHED.getTime() + COMPLY_H * H);

const hex = () => randomBytes(32).toString('hex');
/** A reduced scalar (the top byte is small), as a real tx key is. */
const txKey = () => randomBytes(31).toString('hex') + '05';

/** The stand-in node: what each tx (by hash) shows for the address it is asked about. */
const node = new Map<string, (address: string) => TxProofResult | null>();
const asked: Array<{ txHash: string; txKey: string; address: string }> = [];
let nodeDown = false;
const txProof: TxProofCheck = async (a) => {
  asked.push(a);
  if (nodeDown) throw new TxProofUnavailable();
  return node.get(a.txHash)?.(a.address) ?? null;
};

/** A tx paying `to` exactly `amount`, `confirmations` deep, mined at `minedAt` (null: in the pool). */
function pays(to: string, amount: bigint, o: { confirmations?: number; minedAt?: Date | null } = {}): string {
  const txHash = hex();
  const confirmations = o.confirmations ?? COMPLY_CONFIRMATIONS;
  const minedAt = o.minedAt === undefined ? at(2 * H) : o.minedAt;
  node.set(txHash, (address) => ({ good: true, receivedAtomic: address === to ? amount : 0n, confirmations, blockTimestamp: minedAt }));
  return txHash;
}

let app: FastifyInstance;
let staffApp: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];

beforeAll(async () => {
  ({ app, deps, trader, setNow } = await tradeApp({}, { txProof }));
  staffApp = await buildStaffApi({ ...deps, staffOrigin: STAFF_ORIGIN, moderation: NO_MODERATION });
});
afterAll(async () => {
  await staffApp.close();
  await app.close();
});
beforeEach(() => {
  asked.length = 0;
  nodeDown = false;
});

const errorOf = (res: { body: string }) => (res.body === '' ? undefined : (JSON.parse(res.body) as { error?: string }).error);
const tick = () => disputeTimerJob(undefined, undefined, txProof).run(deps.db, deps.clock());

async function relogin(...who: { id: string; browser: { post(url: string, body: unknown): Promise<{ statusCode: number }> } }[]) {
  for (const w of who) expect((await w.browser.post('/t/login', { accountId: w.id })).statusCode).toBe(200);
}

/** A refunded trade the buyer disputed at START, ruled `seller-sends-xmr` at PUBLISHED (by default). */
async function ruled(o: { outcome?: 'seller-sends-xmr' | 'no-action' | 'seller-returns-fiat'; afterRefund?: boolean; buyerPayout?: string } = {}) {
  setNow(START);
  const seller = await trader();
  const buyer = await trader();
  const { trade, sides } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'buyer', ...(o.buyerPayout ? { buyerPayout: o.buyerPayout } : {}) });
  const t = await driveTo(deps, trade, 'paid');
  const client = await deps.db.connect();
  try {
    await client.query('begin');
    await startDispute(client, t, { openedBy: 'buyer', reason: 'paid', note: '', afterRefund: o.afterRefund ?? true, now: START, prices: null });
    await client.query('commit');
  } finally {
    client.release();
  }
  setNow(PUBLISHED);
  if (o.outcome !== undefined || o.afterRefund !== false) {
    await publishRuling(deps, t.code, { outcome: o.outcome ?? 'seller-sends-xmr' });
  }
  setNow(at(2 * H));
  await relogin(seller, buyer);
  return { seller, buyer, code: t.code, buyerAddress: sides.buyerPayout! };
}

async function proofs(code: string) {
  const { rows } = await deps.db.query<{ tx_hash: string; status: string; has_key: boolean; confirmations: number | null }>(
    'select tx_hash, status, tx_key is not null as has_key, confirmations from ruling_payments where code = $1 order by submitted_at, tx_hash',
    [code],
  );
  return rows;
}

async function logOf(code: string) {
  const { rows } = await deps.db.query<{ action: string; actor_kind: string; detail: string }>(
    `select action, actor_kind, detail from activity_log where trade_code = $1 and action like 'dispute.%' and action <> 'dispute.opened' order by id`,
    [code],
  );
  return rows.map((r) => ({ action: r.action, actor: r.actor_kind, detail: JSON.parse(r.detail) as Record<string, unknown> }));
}

const lienStatus = async (code: string) =>
  (await deps.db.query<{ status: string }>('select status from liens where from_code = $1 order by created_at', [code])).rows.map((r) => r.status);

describe('POST /v1/trades/:code/payment-proof: an accepted proof', () => {
  it("the trade's XMR to the trade's buyer address, 10 deep: complied, the lien repaid, logged by the system, the key not kept", async () => {
    const { seller, code, buyerAddress } = await ruled();
    expect(await hasActiveLien(deps.db, seller.id)).toBe(true);
    const txHash = pays(buyerAddress, AMOUNT);
    const key = txKey();
    const res = await seller.browser.post(`/v1/trades/${code}/payment-proof`, { txHash, txKey: key });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ status: 'accepted', confirmations: COMPLY_CONFIRMATIONS });
    // The node was asked about the trade's own buyer address, with the seller's key.
    expect(asked).toEqual([{ txHash, txKey: key, address: buyerAddress }]);
    const d = (await loadDispute(deps.db, code))!;
    expect(d.compliedAt).toEqual(at(2 * H));
    expect(d.status).toBe('published');
    expect(await lienStatus(code)).toEqual(['repaid']);
    expect(await hasActiveLien(deps.db, seller.id)).toBe(false);
    expect(await proofs(code)).toEqual([{ tx_hash: txHash, status: 'accepted', has_key: false, confirmations: COMPLY_CONFIRMATIONS }]);
    expect(await logOf(code)).toEqual([{ action: 'dispute.complied', actor: 'system', detail: { txHash } }]);
  });

  it('more than the amount is accepted; complied during the appeal window, the case closes when it ends', async () => {
    const { seller, code, buyerAddress } = await ruled();
    const res = await seller.browser.post(`/v1/trades/${code}/payment-proof`, { txHash: pays(buyerAddress, AMOUNT + 1n), txKey: txKey() });
    expect(res.statusCode, res.body).toBe(200);
    setNow(new Date(PUBLISHED.getTime() + 48 * H));
    await tick();
    expect((await loadDispute(deps.db, code))!.status).toBe('closed');
  });
});

describe('refused proofs (red: amount, address, late, replay)', () => {
  it('an amount 1 atomic unit short is 409 proof-invalid; nothing is stored and the seller still owes it', async () => {
    const { seller, code, buyerAddress } = await ruled();
    const res = await seller.browser.post(`/v1/trades/${code}/payment-proof`, { txHash: pays(buyerAddress, AMOUNT - 1n), txKey: txKey() });
    expect(res.statusCode, res.body).toBe(409);
    expect(errorOf(res)).toBe('proof-invalid');
    expect((await loadDispute(deps.db, code))!.compliedAt).toBeNull();
    expect(await proofs(code)).toEqual([]);
    expect(await lienStatus(code)).toEqual(['active']);
    expect(await logOf(code)).toEqual([]);
  });

  it('a payment to another address is 409 proof-invalid: the node is only ever asked about the trade\'s buyer address', async () => {
    const { seller, code, buyerAddress } = await ruled();
    const elsewhere = '4' + 'A'.repeat(94);
    const res = await seller.browser.post(`/v1/trades/${code}/payment-proof`, { txHash: pays(elsewhere, AMOUNT), txKey: txKey() });
    expect(res.statusCode, res.body).toBe(409);
    expect(errorOf(res)).toBe('proof-invalid');
    expect(asked.map((a) => a.address)).toEqual([buyerAddress]);
    // The seller cannot name the address (or the amount): any other key is a 400.
    for (const extra of [{ address: elsewhere }, { amountAtomic: '1' }]) {
      const bad = await seller.browser.post(`/v1/trades/${code}/payment-proof`, { txHash: pays(elsewhere, AMOUNT), txKey: txKey(), ...extra });
      expect(bad.statusCode, JSON.stringify(extra)).toBe(400);
    }
    expect((await loadDispute(deps.db, code))!.compliedAt).toBeNull();
  });

  it('a key that does not fit the tx (the node answers nothing) is 409 proof-invalid', async () => {
    const { seller, code } = await ruled();
    const res = await seller.browser.post(`/v1/trades/${code}/payment-proof`, { txHash: hex(), txKey: txKey() });
    expect(res.statusCode, res.body).toBe(409);
    expect(errorOf(res)).toBe('proof-invalid');
  });

  it('a proof at or after complyBy is 409 too-late, before the node is asked; one a minute before is accepted', async () => {
    const late = await ruled();
    setNow(COMPLY_BY);
    await relogin(late.seller);
    const res = await late.seller.browser.post(`/v1/trades/${late.code}/payment-proof`, { txHash: pays(late.buyerAddress, AMOUNT), txKey: txKey() });
    expect(res.statusCode, res.body).toBe(409);
    expect(errorOf(res)).toBe('too-late');
    expect(asked).toEqual([]);
    expect(await proofs(late.code)).toEqual([]);

    const inTime = await ruled();
    setNow(new Date(COMPLY_BY.getTime() - MIN));
    await relogin(inTime.seller);
    const ok = await inTime.seller.browser.post(`/v1/trades/${inTime.code}/payment-proof`, { txHash: pays(inTime.buyerAddress, AMOUNT), txKey: txKey() });
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it('a replayed proof is 409 proof-replayed: the same tx for a second dispute, a trade settlement tx, a tx mined before the dispute opened', async () => {
    const a = await ruled();
    // The same buyer address on both trades (a saved wallet) makes the replay real.
    const b = await ruled({ buyerPayout: a.buyerAddress });
    const txHash = pays(a.buyerAddress, AMOUNT);
    expect((await a.seller.browser.post(`/v1/trades/${a.code}/payment-proof`, { txHash, txKey: txKey() })).statusCode).toBe(200);
    const again = await b.seller.browser.post(`/v1/trades/${b.code}/payment-proof`, { txHash, txKey: txKey() });
    expect(again.statusCode, again.body).toBe(409);
    expect(errorOf(again)).toBe('proof-replayed');
    // And on the same dispute (already met: wrong-state comes first, nothing changes).
    expect((await a.seller.browser.post(`/v1/trades/${a.code}/payment-proof`, { txHash, txKey: txKey() })).statusCode).toBe(409);

    // A tx X2F recorded as a trade's settlement (a past release to that address).
    const settled = pays(a.buyerAddress, AMOUNT);
    await deps.db.query('update trades set tx_hash = $2 where code = $1', [a.code, settled]);
    const s = await b.seller.browser.post(`/v1/trades/${b.code}/payment-proof`, { txHash: settled, txKey: txKey() });
    expect(errorOf(s)).toBe('proof-replayed');

    // A tx in a block older than the dispute (it cannot be the payment the dispute is about).
    const old = pays(a.buyerAddress, AMOUNT, { minedAt: new Date(START.getTime() - MIN) });
    const o = await b.seller.browser.post(`/v1/trades/${b.code}/payment-proof`, { txHash: old, txKey: txKey() });
    expect(o.statusCode, o.body).toBe(409);
    expect(errorOf(o)).toBe('proof-replayed');
    expect((await loadDispute(deps.db, b.code))!.compliedAt).toBeNull();
    expect(await proofs(b.code)).toEqual([]);
  });

  it('only the seller, only on a seller-sends-xmr ruling in force, a well-formed body; no node: 503 and nothing stored', async () => {
    const { seller, buyer, code, buyerAddress } = await ruled();
    const body = () => ({ txHash: pays(buyerAddress, AMOUNT), txKey: txKey() });
    expect(errorOf(await buyer.browser.post(`/v1/trades/${code}/payment-proof`, body()))).toBe('wrong-party');
    const stranger = await trader();
    expect((await stranger.browser.post(`/v1/trades/${code}/payment-proof`, body())).statusCode).toBe(404);
    // A key that is not a reduced scalar never reaches the node (it would abort monero-ts's WebAssembly).
    for (const bad of [{ txHash: 'ab', txKey: txKey() }, { txHash: hex(), txKey: 'f'.repeat(64) }, { txHash: hex().toUpperCase(), txKey: txKey() }, { txHash: hex() }]) {
      expect((await seller.browser.post(`/v1/trades/${code}/payment-proof`, bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
    expect(asked).toEqual([]);
    nodeDown = true;
    const down = await seller.browser.post(`/v1/trades/${code}/payment-proof`, body());
    expect(down.statusCode).toBe(503);
    expect(errorOf(down)).toBe('node-unavailable');
    expect(await proofs(code)).toEqual([]);

    for (const outcome of ['no-action', 'seller-returns-fiat'] as const) {
      const other = await ruled({ outcome });
      const r = await other.seller.browser.post(`/v1/trades/${other.code}/payment-proof`, { txHash: pays(other.buyerAddress, AMOUNT), txKey: txKey() });
      expect(errorOf(r), outcome).toBe('wrong-state');
    }
    // No ruling yet.
    const open = await ruled({ afterRefund: false });
    expect(errorOf(await open.seller.browser.post(`/v1/trades/${open.code}/payment-proof`, { txHash: pays(open.buyerAddress, AMOUNT), txKey: txKey() }))).toBe('wrong-state');
  });
});

describe('a proof waiting for its confirmations', () => {
  it('3 deep: 202 pending, a second proof is 409 proof-pending; the timer accepts it at 10 though complyBy has passed', async () => {
    const { seller, code, buyerAddress } = await ruled();
    const txHash = pays(buyerAddress, AMOUNT, { confirmations: 3 });
    const res = await seller.browser.post(`/v1/trades/${code}/payment-proof`, { txHash, txKey: txKey() });
    expect(res.statusCode, res.body).toBe(202);
    expect(res.json()).toEqual({ status: 'pending-confirmations', confirmations: 3 });
    expect(await proofs(code)).toEqual([{ tx_hash: txHash, status: 'pending', has_key: true, confirmations: 3 }]);
    expect((await loadDispute(deps.db, code))!.compliedAt).toBeNull();
    const second = await seller.browser.post(`/v1/trades/${code}/payment-proof`, { txHash: pays(buyerAddress, AMOUNT), txKey: txKey() });
    expect(errorOf(second)).toBe('proof-pending');

    // Checked again no more often than PROOF_RECHECK_MS.
    asked.length = 0;
    await tick();
    expect(asked).toEqual([]);
    setNow(new Date(COMPLY_BY.getTime() + H));
    node.set(txHash, (address) => ({ good: true, receivedAtomic: address === buyerAddress ? AMOUNT : 0n, confirmations: 12, blockTimestamp: at(3 * H) }));
    await tick();
    expect(asked.map((a) => a.txHash)).toEqual([txHash]);
    expect((await loadDispute(deps.db, code))!.compliedAt).toEqual(new Date(COMPLY_BY.getTime() + H));
    expect(await proofs(code)).toEqual([{ tx_hash: txHash, status: 'accepted', has_key: false, confirmations: 12 }]);
    expect(await lienStatus(code)).toEqual(['repaid']);
    // A proof waiting in time is not a lapse.
    expect((await logOf(code)).map((e) => e.action)).toEqual(['dispute.proof-pending', 'dispute.complied']);
  });

  it('a waiting tx whose check later fails is refused and logged; the seller may send another', async () => {
    const { seller, code, buyerAddress } = await ruled();
    const txHash = pays(buyerAddress, AMOUNT, { confirmations: 0, minedAt: null });
    expect((await seller.browser.post(`/v1/trades/${code}/payment-proof`, { txHash, txKey: txKey() })).statusCode).toBe(202);
    setNow(new Date(at(2 * H).getTime() + PROOF_RECHECK_MS));
    node.set(txHash, () => ({ good: true, receivedAtomic: 0n, confirmations: 10, blockTimestamp: at(2 * H) }));
    await tick();
    expect(await proofs(code)).toEqual([{ tx_hash: txHash, status: 'refused', has_key: false, confirmations: 0 }]);
    expect((await logOf(code)).map((e) => e.action)).toEqual(['dispute.proof-pending', 'dispute.proof-refused']);
    await relogin(seller);
    // The refused tx can never be submitted again; a new one is taken.
    expect(errorOf(await seller.browser.post(`/v1/trades/${code}/payment-proof`, { txHash, txKey: txKey() }))).toBe('proof-replayed');
    expect((await seller.browser.post(`/v1/trades/${code}/payment-proof`, { txHash: pays(buyerAddress, AMOUNT), txKey: txKey() })).statusCode).toBe(200);
  });
});

describe('A6: the comply time lapses with no proof: the case goes to a senior moderator or the owner', () => {
  it('marked once, logged by the system, the owner alerted; the lien stays; listed for seniors and the owner, not for a moderator', async () => {
    const owner = await seedStaff(deps, { role: 'owner' });
    const { seller, code } = await ruled();
    setNow(new Date(COMPLY_BY.getTime() - MIN));
    await tick();
    expect(await logOf(code)).toEqual([]);
    setNow(COMPLY_BY);
    await tick();
    expect(await logOf(code)).toEqual([{ action: 'dispute.comply-lapsed', actor: 'system', detail: { seq: 1 } }]);
    const alerts = await deps.db.query<{ detail: { trade: string } }>(
      `select detail from alerts where account_id = $1 and kind = 'dispute-comply-lapsed'`,
      [owner.id],
    );
    expect(alerts.rows.map((r) => r.detail)).toEqual([{ trade: code, seq: 1 }]);
    expect(await hasActiveLien(deps.db, seller.id)).toBe(true);
    // Once only.
    setNow(new Date(COMPLY_BY.getTime() + H));
    await tick();
    expect((await logOf(code)).map((e) => e.action)).toEqual(['dispute.comply-lapsed']);

    const queueOf = async (role: 'mod' | 'senior' | 'owner') => {
      const s = role === 'owner' ? owner : await seedStaff(deps, { role });
      const b = new StaffBrowser(staffApp).withSession((await insertSession(deps, s.id, 'staff')).token);
      const res = await b.get('/staff/v1/disputes?filter=all');
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { rows: Array<{ code: string; complyLapsed: boolean; status: string }> }).rows.filter((r) => r.code === code);
    };
    expect(await queueOf('mod')).toEqual([]);
    expect(await queueOf('senior')).toMatchObject([{ code, status: 'published', complyLapsed: true }]);
    expect(await queueOf('owner')).toMatchObject([{ code, complyLapsed: true }]);
  });

  it("the owner's phone gets the fixed alert push once per lapse (the owner-alert push path)", async () => {
    const owner = await seedStaff(deps, { role: 'owner' });
    const { code } = await ruled();
    const push = { send: vi.fn(async (_id: string, _kind: string) => true) };
    const run = () => disputeTimerJob(undefined, push, txProof).run(deps.db, deps.clock());
    setNow(new Date(COMPLY_BY.getTime() - MIN));
    await run();
    expect(push.send).not.toHaveBeenCalledWith(owner.id, 'alert');
    setNow(COMPLY_BY);
    await run();
    await run();
    expect((await logOf(code)).map((e) => e.action)).toEqual(['dispute.comply-lapsed']);
    expect(push.send.mock.calls.filter(([id]) => id === owner.id)).toEqual([[owner.id, 'alert']]);
  });

  it('a round-2 "Decision stands" gives a fresh comply time, and a second lapse is marked again', async () => {
    const { code } = await ruled();
    setNow(COMPLY_BY);
    await tick();
    expect((await logOf(code)).map((e) => e.action)).toEqual(['dispute.comply-lapsed']);
    setNow(new Date(COMPLY_BY.getTime() + H));
    await appealDirect(deps, code, 'seller');
    // While the appeal is pending nothing lapses.
    await tick();
    await publishRuling(deps, code, { outcome: 'seller-sends-xmr' });
    const d = (await loadDispute(deps.db, code))!;
    expect(d.status).toBe('complying');
    expect(d.complyBy).toEqual(new Date(COMPLY_BY.getTime() + H + COMPLY_H * H));
    await tick();
    expect((await logOf(code)).map((e) => e.action)).toEqual(['dispute.comply-lapsed']);
    setNow(d.complyBy!);
    await tick();
    expect((await logOf(code)).map((e) => e.action)).toEqual(['dispute.comply-lapsed', 'dispute.comply-lapsed']);
  });
});
