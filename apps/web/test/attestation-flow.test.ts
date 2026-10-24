import { channelFor } from '@x2f/trade';
import { afterEach, describe, expect, it } from 'vitest';
import { cosignPolicy } from '../src/escrow/policy.js';
import { ADDR, AMOUNT, CODE, ESCROW_ADDRESS, FEE_WALLET, Hub, Parties, device, testIdentity, funded, makeApi, modKey, tradeView, until, type ApiState, type Device } from './escrow-helpers.js';

const running: Device[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((d) => d.runtime.stopAll()));
});

async function setup(over: Partial<ApiState> = {}) {
  const mod = await modKey();
  const state: ApiState = { identities: {}, view: tradeView(), ...over };
  const api = await makeApi(mod, state);
  const hub = new Hub();
  const parties = new Parties();
  const mk = async (role: 'buyer' | 'seller', extra: Partial<Parameters<typeof device>[1]> = {}) => {
    const d = await device(role, { api: api.forRole(role), hub, parties, modPublic: mod.publicHex, ...extra });
    running.push(d);
    return d;
  };
  return { mod, state, api, hub, parties, mk };
}

describe('attestation check before any escrow work (P3-C1)', () => {
  it('an attestation without this device’s key: phase error, participants-mismatch, runParty never called', async () => {
    const intruder = await testIdentity();
    const t = await setup({
      tamper: (a) => ({ ...a, participants: { ...a.participants, buyer: { signPublic: intruder.signPublic, boxPublic: intruder.boxPublic } } }),
    });
    const buyer = await t.mk('buyer');
    const seller = await t.mk('seller');
    await buyer.runtime.start(CODE);
    await seller.runtime.start(CODE);
    await until(() => buyer.last()?.phase === 'error');
    expect(buyer.last()).toMatchObject({ phase: 'error', error: 'participants-mismatch', keepOpen: false, checkWords: null });
    expect(t.parties.calls.filter((c) => c.role === 'buyer')).toEqual([]);
    // Nothing was sent or even opened on the relay by the buyer: no terms, no escrow messages.
    expect(t.hub.opened.filter((o) => o.role === 'buyer')).toEqual([]);
    expect(buyer.statuses.map((s) => s.phase)).toEqual(['idle', 'registering', 'verifying', 'error']);
  });

  it('an attestation signed by another key, for another trade or with another channel: participants-mismatch', async () => {
    const other = await modKey();
    const cases: Partial<ApiState>[] = [
      { resign: other.secret },
      { tamper: (a) => ({ ...a, trade: 'AAAA-BBBB-CCCC-DDDD' }) },
      { tamper: (a) => ({ ...a, channels: { ...a.channels, escrow: CODE } }) },
      { tamper: (a) => ({ ...a, channels: { signals: a.channels.signals! } }) },
    ];
    for (const c of cases) {
      const t = await setup(c);
      const buyer = await t.mk('buyer');
      const seller = await t.mk('seller');
      await seller.runtime.start(CODE);
      await buyer.runtime.start(CODE);
      await until(() => buyer.last()?.phase === 'error' && seller.last()?.phase === 'error');
      expect(buyer.last()?.error).toBe('participants-mismatch');
      expect(t.parties.calls).toEqual([]);
    }
  });

  it('a tampered attestation stored earlier is checked again on resume', async () => {
    const t = await setup();
    const seller = await t.mk('seller');
    const buyer = await t.mk('buyer');
    await seller.runtime.start(CODE);
    await buyer.runtime.start(CODE);
    await buyer.status((s) => s.phase === 'ready');
    await buyer.runtime.stopAll();
    // The stored attestation is swapped for one listing someone else as buyer (its old signature no longer fits).
    const rec = (await buyer.store.load(CODE))!;
    const intruder = await testIdentity();
    const a = rec.attestation!.attestation as { participants: Record<string, unknown> };
    await buyer.store.save({ ...rec, attestation: { ...rec.attestation!, attestation: { ...a, participants: { ...a.participants, buyer: { signPublic: intruder.signPublic, boxPublic: intruder.boxPublic } } } } });
    const calls = t.parties.calls.length;
    const again = await t.mk('buyer', { idb: buyer.idb });
    await again.runtime.resumeAll();
    expect(await again.status((s) => s.phase === 'error')).toMatchObject({ error: 'participants-mismatch' });
    expect(t.parties.calls.length).toBe(calls);
  });

  it('a stopped run never writes its record again (stop resolves only once the run has ended)', async () => {
    const t = await setup();
    const seller = await t.mk('seller');
    const buyer = await t.mk('buyer');
    await seller.runtime.start(CODE);
    await buyer.runtime.start(CODE);
    await buyer.status((s) => s.phase === 'ready');
    // A save is in flight (slow storage) when the page stops the runtime.
    const save = buyer.store.save.bind(buyer.store);
    let entered!: () => void;
    const inSave = new Promise<void>((r) => (entered = r));
    let stopped = false;
    let late = 0;
    buyer.store.save = async (r) => {
      entered();
      await new Promise((x) => setTimeout(x, 30));
      await save(r);
      if (stopped) late++;
    };
    const acting = buyer.runtime.act(CODE, { type: 'signal', signal: 'trade.paid' }).catch(() => undefined);
    await inSave;
    await buyer.runtime.stopAll();
    stopped = true;
    await acting;
    // Anything the old run still had queued gets its chance to (wrongly) write now.
    await new Promise((r) => setTimeout(r, 60));
    expect(late).toBe(0);
  });
});

describe('what this device signs comes from what the user confirmed, never the API', () => {
  const lies: [string, Partial<ApiState>][] = [
    ['another own address', { roleView: { buyer: { ownAddress: '4AttackerAddress' } } }],
    ['another amount', { view: tradeView({ amountAtomic: (AMOUNT + 1n).toString() }) }],
    ['another poster', { view: tradeView({ poster: 'buyer' }) }],
    ['another rate', { view: tradeView({ lockedRate: { currency: 'USD', centsPerXmr: '33001' } }) }],
    ['another maximum', { view: tradeView({ maxFiatCents: '90000' }) }],
    ['another currency', { view: tradeView({ lockedRate: { currency: 'EUR', centsPerXmr: '33000' } }) }],
    ['another role', { roleView: { buyer: { role: 'seller' } } }],
  ];
  it.each(lies)('a TradeView with %s at start: deal-mismatch, no identity registered, nothing signed, runParty never called', async (_n, lie) => {
    const t = await setup(lie);
    const buyer = await t.mk('buyer');
    await buyer.runtime.start(CODE);
    await until(() => buyer.last()?.phase === 'error');
    expect(buyer.last()?.error).toBe('deal-mismatch');
    expect(t.state.identities.buyer).toBeUndefined();
    expect(t.parties.calls).toEqual([]);
    expect(t.hub.sent).toEqual([]);
    expect(await buyer.store.load(CODE)).toBeNull();
  });

  it('a first start without the user’s confirmation does nothing (not-confirmed)', async () => {
    const t = await setup();
    const buyer = await t.mk('buyer');
    await buyer.rawStart(CODE);
    await until(() => buyer.last()?.phase === 'error');
    expect(buyer.last()?.error).toBe('not-confirmed');
    expect(t.state.identities).toEqual({});
  });

  it('the terms this device signs carry the confirmed address and deal even when the view omits the address', async () => {
    const t = await setup({ roleView: { seller: { ownAddress: undefined } } });
    const buyer = await t.mk('buyer');
    const seller = await t.mk('seller');
    await buyer.runtime.start(CODE);
    await seller.runtime.start(CODE);
    await until(async () => (await buyer.store.load(CODE))?.theirAddress != null);
    expect((await buyer.store.load(CODE))?.theirAddress).toBe(ADDR.seller);
    expect((await buyer.store.load(CODE))?.theirDeal).toEqual((await seller.store.load(CODE))?.deal);
  });

  it('a view that turns into another poster mid-trade: deal-mismatch and nothing is settled', async () => {
    const t = await setup();
    const buyer = await t.mk('buyer');
    const seller = await t.mk('seller');
    await buyer.runtime.start(CODE);
    await seller.runtime.start(CODE);
    await until(async () => buyer.last()?.phase === 'ready' && (await buyer.store.load(CODE))?.theirDeal != null);
    t.parties.funds = funded();
    t.state.view = tradeView({ state: 'paid', poster: 'buyer' });
    await until(() => buyer.last()?.phase === 'error' && seller.last()?.phase === 'error');
    expect(buyer.last()?.error).toBe('deal-mismatch');
    await expect(seller.runtime.act(CODE, { type: 'release' })).rejects.toThrow();
    expect(t.parties.settles).toEqual([]);
  });
});

describe('a verified trade', () => {
  it('registers with a proof, runs the party with the attested participants, and both devices show the same check words', async () => {
    const t = await setup();
    const buyer = await t.mk('buyer');
    const seller = await t.mk('seller');
    await buyer.runtime.start(CODE);
    await seller.runtime.start(CODE);
    await until(() => buyer.last()?.phase === 'ready' && seller.last()?.phase === 'ready');
    const words = buyer.last()!.checkWords!;
    expect(words).toHaveLength(4);
    expect(seller.last()!.checkWords).toEqual(words);

    const escrow = await channelFor(CODE, 'escrow');
    expect(t.parties.calls.map((c) => c.role).sort()).toEqual(['buyer', 'seller']);
    for (const c of t.parties.calls) {
      expect(c.args.trade).toBe(escrow);
      expect(c.args.participants.buyer.signPublic).toBe(t.state.identities.buyer!.signPublic);
      expect(c.args.participants.seller.signPublic).toBe(t.state.identities.seller!.signPublic);
      expect(c.args.password).toMatch(/^[0-9a-f]{64}$/); // R27
    }
    expect(t.parties.calls[0]!.args.password).not.toBe(t.parties.calls[1]!.args.password);
    // The identity proof verifies, and only public keys reached the API.
    for (const body of Object.values(t.state.identities)) expect(Object.keys(body!).sort()).toEqual(['boxPublic', 'proof', 'signPublic']);
    // Both sides' signed terms arrived.
    await until(async () => (await buyer.store.load(CODE))?.theirAddress === ADDR.seller && (await seller.store.load(CODE))?.theirAddress === ADDR.buyer);
    void ESCROW_ADDRESS;
  });

  it('check words differ when one key differs', async () => {
    const { escrowCheckWords } = await import('../src/escrow/adapters.js');
    const [a, b, c] = await Promise.all([testIdentity(), testIdentity(), testIdentity()]);
    const p = { buyer: a, seller: b, mod: c };
    const w1 = await escrowCheckWords(p, ESCROW_ADDRESS);
    expect(await escrowCheckWords(p, ESCROW_ADDRESS)).toEqual(w1);
    expect(await escrowCheckWords({ ...p, mod: a }, ESCROW_ADDRESS)).not.toEqual(w1);
    expect(await escrowCheckWords(p, `${ESCROW_ADDRESS}x`)).not.toEqual(w1);
  });
});

describe('settling', () => {
  async function ready(over: Partial<ApiState> = {}) {
    const t = await setup(over);
    const buyer = await t.mk('buyer');
    const seller = await t.mk('seller');
    await buyer.runtime.start(CODE);
    await seller.runtime.start(CODE);
    await until(() => buyer.last()?.phase === 'ready' && seller.last()?.phase === 'ready');
    await until(async () => (await buyer.store.load(CODE))?.theirDeal != null && (await seller.store.load(CODE))?.theirDeal != null);
    return { ...t, buyer, seller };
  }

  it('release: the seller builds, the buyer co-signs, each through cosignPolicy', async () => {
    const t = await ready();
    t.parties.funds = funded();
    t.state.view = tradeView({ state: 'paid', paidAt: '2026-10-23T12:30:00.000Z' });
    await t.seller.runtime.act(CODE, { type: 'release' });
    await until(() => t.parties.settles.length === 2);
    const [s, b] = [t.parties.settles.find((x) => x.role === 'seller')!, t.parties.settles.find((x) => x.role === 'buyer')!];
    expect(s.o).toEqual(b.o);
    expect(s.o).toMatchObject({ builder: 'seller', cosigner: 'buyer' });
    expect(s.o.to).toEqual([
      { address: ADDR.buyer, amountAtomic: AMOUNT },
      { address: FEE_WALLET, amountAtomic: 12_500_000_000n },
    ]);
    expect(t.seller.last()?.phase).toBe('signing');
    expect(t.seller.last()?.keepOpen).toBe(true);
    for (const p of t.parties.pending) p.resolve(p.role === 'buyer' ? 'txhash' : null);
    await until(() => t.seller.last()?.phase === 'done' && t.buyer.last()?.phase === 'done');
    void cosignPolicy;
  });

  it('a TradeView whose amount is one atomic unit bigger, or whose poster is swapped, settles nothing', async () => {
    for (const lie of [{ amountAtomic: (AMOUNT + 1n).toString() }, { poster: 'buyer' }]) {
      const t = await ready();
      t.parties.funds = funded();
      t.state.view = tradeView({ state: 'paid', ...lie });
      await t.seller.runtime.act(CODE, { type: 'release' });
      await new Promise((r) => setTimeout(r, 100));
      expect(t.parties.settles).toEqual([]);
      await t.buyer.runtime.stopAll();
      await t.seller.runtime.stopAll();
    }
  });

  it('a late surplus before signing: both sides re-derive and settle again, the surplus to the seller', async () => {
    const t = await ready();
    t.parties.funds = funded();
    t.state.view = tradeView({ state: 'paid', paidAt: '2026-10-23T12:30:00.000Z' });
    await t.seller.runtime.act(CODE, { type: 'release' });
    await until(() => t.parties.settles.length === 2);
    t.parties.funds = funded('seller', 100_000_000n);
    await until(() => t.parties.settles.length === 4);
    for (const s of t.parties.settles.slice(2)) expect(s.o.to.at(-1)).toEqual({ address: ADDR.seller, amountAtomic: 100_000_000n });
  });

  it('extra XMR before "I’ve paid" grows the trade on the device; the grown release matches the grown TradeView only', async () => {
    const t = await ready();
    const grown = 1_300_000_000_000n;
    const fundsFor = (a: bigint) => a + a / 100n;
    t.state.view = tradeView({ state: 'secured' });
    t.parties.funds = { balance: fundsFor(grown), unlocked: fundsFor(grown), incoming: [] };
    await until(async () => (await t.seller.store.load(CODE))?.sizeAtomic === grown && (await t.buyer.store.load(CODE))?.sizeAtomic === grown);
    // The API still says the old size: nothing settles.
    t.state.view = tradeView({ state: 'paid', paidAt: '2026-10-23T12:30:00.000Z' });
    await t.seller.runtime.act(CODE, { type: 'release' });
    await new Promise((r) => setTimeout(r, 60));
    expect(t.parties.settles).toEqual([]);
    t.state.view = tradeView({ state: 'paid', paidAt: '2026-10-23T12:30:00.000Z', amountAtomic: grown.toString() });
    await until(() => t.parties.settles.length === 2);
    expect(t.parties.settles[0]!.o.to[0]).toEqual({ address: ADDR.buyer, amountAtomic: grown });
  });

  it('buyerCancel sends trade.cancel and settles payoutsFor(buyer-cancel) with builder buyer, cosigner mod', async () => {
    const t = await ready();
    t.parties.funds = funded();
    t.state.view = tradeView({ state: 'secured' });
    await until(() => t.parties.settles.some((s) => s.role === 'buyer')); // the standing release co-sign
    const before = t.hub.sent.length;
    await t.buyer.runtime.act(CODE, { type: 'buyer-cancel' });
    await until(() => t.parties.settles.some((s) => s.role === 'buyer' && s.o.cosigner === 'mod'));
    const signals = await channelFor(CODE, 'signals');
    expect(t.hub.sent.slice(before).some((x) => x.channel === signals && x.from === 'buyer')).toBe(true);
    const cancel = t.parties.settles.find((s) => s.o.cosigner === 'mod')!;
    expect(cancel.o).toEqual({ kind: 'release', to: [{ address: ADDR.seller, amountAtomic: funded().balance }], builder: 'buyer', cosigner: 'mod' });
    await expect(t.seller.runtime.act(CODE, { type: 'buyer-cancel' })).rejects.toThrow();
  });

  it('lapsed with funds: the seller builds the lapse refund automatically and the buyer co-signs it', async () => {
    const t = await ready();
    const part = 400_000_000_000n;
    t.parties.funds = { balance: part, unlocked: part, incoming: [] };
    t.state.view = tradeView({ state: 'lapsed' });
    await until(() => t.parties.settles.length === 2);
    for (const s of t.parties.settles) expect(s.o).toEqual({ kind: 'release', to: [{ address: ADDR.seller, amountAtomic: part }], builder: 'seller', cosigner: 'buyer' });
  });
});

describe('resume on load (Review Focus 1)', () => {
  it('a reload mid-signing hands the party the same outcome again, and nothing else', async () => {
    const t = await setup();
    const seller = await t.mk('seller');
    const buyer = await t.mk('buyer');
    await seller.runtime.start(CODE);
    await buyer.runtime.start(CODE);
    await until(async () => (await seller.store.load(CODE))?.theirDeal != null && (await buyer.store.load(CODE))?.theirDeal != null);
    t.parties.funds = funded();
    t.state.view = tradeView({ state: 'paid', paidAt: '2026-10-23T12:30:00.000Z' });
    await seller.runtime.act(CODE, { type: 'release' });
    await until(() => t.parties.settles.filter((s) => s.role === 'seller').length === 1);
    const first = t.parties.settles.find((s) => s.role === 'seller')!.o;

    // Reload: the page goes away mid-signing and comes back.
    await seller.runtime.stopAll();
    const again = await t.mk('seller', { idb: seller.idb });
    await again.runtime.resumeAll();
    await until(() => t.parties.settles.filter((s) => s.role === 'seller').length === 2);
    await new Promise((r) => setTimeout(r, 60));
    const sellerSettles = t.parties.settles.filter((s) => s.role === 'seller');
    expect(sellerSettles).toHaveLength(2);
    expect(sellerSettles[1]!.o).toEqual(first);
    // The resumed party got its saved state back, and the same wallet password.
    const calls = t.parties.calls.filter((c) => c.role === 'seller');
    expect(calls).toHaveLength(2);
    expect(await calls[1]!.args.store.load()).not.toBeNull();
    expect(calls[1]!.args.password).toBe(calls[0]!.args.password);
    expect(calls[1]!.args.me.signPublic).toBe(calls[0]!.args.me.signPublic);
  });

  it('once settle resolved, a reload never calls settle again', async () => {
    const t = await setup();
    const seller = await t.mk('seller');
    const buyer = await t.mk('buyer');
    await seller.runtime.start(CODE);
    await buyer.runtime.start(CODE);
    await until(async () => (await seller.store.load(CODE))?.theirDeal != null && (await buyer.store.load(CODE))?.theirDeal != null);
    t.parties.funds = funded();
    t.state.view = tradeView({ state: 'paid', paidAt: '2026-10-23T12:30:00.000Z' });
    await seller.runtime.act(CODE, { type: 'release' });
    await until(() => t.parties.pending.some((p) => p.role === 'seller'));
    t.parties.pending.find((p) => p.role === 'seller')!.resolve(null);
    await until(() => seller.last()?.phase === 'done');
    expect((await seller.store.load(CODE))?.intent?.done).toBe(true);
    await seller.runtime.stopAll();
    const count = t.parties.settles.length;
    const again = await t.mk('seller', { idb: seller.idb });
    await again.runtime.resumeAll();
    await until(() => again.last()?.phase === 'done');
    await new Promise((r) => setTimeout(r, 60));
    expect(t.parties.settles.length).toBe(count);
  });

  it('a second tab waits for the first one’s lock and runs nothing meanwhile', async () => {
    const t = await setup();
    const held = new Map<string, Promise<void>>();
    const lock = async (name: string, fn: () => Promise<void>) => {
      while (held.has(name)) await held.get(name);
      const p = fn().finally(() => held.delete(name));
      held.set(name, p);
      await p;
    };
    const tab1 = await t.mk('seller', { lock });
    const tab2 = await t.mk('seller', { idb: tab1.idb, lock });
    const buyer = await t.mk('buyer');
    await tab1.runtime.start(CODE);
    await buyer.runtime.start(CODE);
    await until(() => tab1.last()?.phase === 'ready');
    await tab2.runtime.start(CODE);
    await new Promise((r) => setTimeout(r, 60));
    expect(tab2.statuses.map((s) => s.phase)).toEqual(['idle']);
    expect(t.parties.calls.filter((c) => c.role === 'seller')).toHaveLength(1);
    await tab1.runtime.stopAll();
    await until(() => tab2.last()?.phase === 'ready');
  });

  it('a closed trade with an empty escrow deletes both records', async () => {
    const t = await setup();
    const seller = await t.mk('seller');
    const buyer = await t.mk('buyer');
    await seller.runtime.start(CODE);
    await buyer.runtime.start(CODE);
    await until(() => seller.last()?.phase === 'ready');
    expect(await seller.store.password(CODE)).not.toBeNull();
    // The API says released but the escrow still holds coins: keep everything.
    t.state.view = tradeView({ state: 'released' });
    t.parties.funds = funded();
    await new Promise((r) => setTimeout(r, 60));
    expect(await seller.store.load(CODE)).not.toBeNull();
    t.parties.funds = { balance: 0n, unlocked: 0n, incoming: [{ txHash: 'aa', amountAtomic: 1n, confirmations: 12, unlocked: true }] };
    await until(async () => (await seller.store.load(CODE)) === null);
    expect(await seller.store.password(CODE)).toBeNull();
    expect(seller.last()?.phase).toBe('done');
  });
});
