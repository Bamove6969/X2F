import { PartyError } from '@x2f/escrow';
import { channelFor } from '@x2f/trade';
import { afterEach, describe, expect, it } from 'vitest';
import { cosignPolicy } from '../src/escrow/policy.js';
import { ADDR, AMOUNT, CODE, ESCROW_ADDRESS, FEE_WALLET, Hub, Parties, confirmedFor, device, testIdentity, funded, makeApi, modKey, tradeView, until, type ApiState, type Device } from './escrow-helpers.js';

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
      await Promise.all([t.parties.ticks('seller'), t.parties.ticks('buyer')]);
      expect(t.parties.settles).toEqual([]);
      if ('amountAtomic' in lie) expect(t.seller.last()?.refusal).toBe('amount-out-of-range');
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

  describe('growth and starter caps: the API amount is accepted only between the take amount and the device-grown amount', () => {
    const grown = 1_300_000_000_000n;
    const fundsFor = (a: bigint) => a + a / 100n;
    async function grownTrade() {
      const t = await ready();
      // Grown while securing: no standing co-sign yet, so nothing settles before the view below.
      t.state.view = tradeView({ state: 'securing' });
      t.parties.funds = { balance: fundsFor(grown), unlocked: fundsFor(grown), incoming: [] };
      await until(async () => (await t.seller.store.load(CODE))?.sizeAtomic === grown && (await t.buyer.store.load(CODE))?.sizeAtomic === grown);
      return t;
    }
    const paidAt = '2026-10-23T12:30:00.000Z';

    it.each([
      ['the take amount (growth capped at the start)', AMOUNT],
      ['an amount in between (a starter cap)', 1_280_000_000_000n],
      ['the device-grown amount', grown],
    ])('%s: accepted, release pays the buyer that amount and the rest to the seller', async (_n, apiAmount) => {
      const t = await grownTrade();
      t.state.view = tradeView({ state: 'paid', paidAt, amountAtomic: apiAmount.toString() });
      await t.seller.runtime.act(CODE, { type: 'release' });
      await until(() => t.parties.settles.length === 2);
      const [s, b] = [t.parties.settles.find((x) => x.role === 'seller')!, t.parties.settles.find((x) => x.role === 'buyer')!];
      expect(b.o).toEqual(s.o);
      expect(s.o.to[0]).toEqual({ address: ADDR.buyer, amountAtomic: apiAmount });
      expect(s.o.to.reduce((x, p) => x + p.amountAtomic, 0n)).toBe(fundsFor(grown));
      expect(t.seller.last()?.refusal).toBeNull();
    });

    it.each([
      ['one atomic unit above the device-grown amount', grown + 1n],
      ['one atomic unit below the take amount', AMOUNT - 1n],
    ])('%s: refused visibly (status refusal), nothing settled', async (_n, apiAmount) => {
      const t = await grownTrade();
      t.state.view = tradeView({ state: 'paid', paidAt, amountAtomic: apiAmount.toString() });
      await expect(t.seller.runtime.act(CODE, { type: 'release' })).resolves.toBeUndefined();
      expect(await t.seller.status((x) => x.refusal === 'amount-out-of-range')).toMatchObject({ phase: 'ready', error: null });
      expect(await t.buyer.status((x) => x.refusal === 'amount-out-of-range')).toMatchObject({ error: null });
      await Promise.all([t.parties.ticks('seller'), t.parties.ticks('buyer')]);
      expect(t.parties.settles).toEqual([]);
      // Back in range: the refusal clears and the trade settles.
      t.state.view = tradeView({ state: 'paid', paidAt, amountAtomic: grown.toString() });
      expect(await t.seller.status((x) => x.refusal === null && x.phase === 'signing')).toBeTruthy();
      await until(() => t.parties.settles.length === 2);
    });
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

  it('a buyer who tapped propose-cancel and then paid co-signs the release once the seller releases', async () => {
    const t = await ready();
    t.parties.funds = funded();
    t.state.view = tradeView({ state: 'secured', cancelProposedBy: 'buyer' });
    await t.buyer.runtime.act(CODE, { type: 'propose-cancel-sign' });
    expect((await t.buyer.store.load(CODE))?.intent).toMatchObject({ kind: 'mutual-cancel', auto: false });
    // The buyer pays anyway (its proposal stands, Task 2), then the seller releases.
    t.state.view = tradeView({ state: 'paid', paidAt: '2026-10-23T12:30:00.000Z', cancelProposedBy: 'buyer' });
    await t.seller.runtime.act(CODE, { type: 'release' });
    t.state.view = tradeView({ state: 'settling', settling: 'release', paidAt: '2026-10-23T12:30:00.000Z', cancelProposedBy: 'buyer' });
    await until(() => t.parties.settles.some((s) => s.role === 'buyer' && s.o.builder === 'seller'));
    const release = t.parties.settles.filter((s) => s.role === 'buyer').at(-1)!;
    expect(release.o).toEqual(t.parties.settles.find((s) => s.role === 'seller')!.o);
    expect(release.o.to[0]).toEqual({ address: ADDR.buyer, amountAtomic: AMOUNT });
    expect((await t.buyer.store.load(CODE))?.intent).toMatchObject({ kind: 'release', auto: true });
  });

  it('a tapped mutual cancel stays while the proposal stands, and falls back once it is withdrawn', async () => {
    const t = await ready();
    t.parties.funds = funded();
    t.state.view = tradeView({ state: 'paid', paidAt: '2026-10-23T12:30:00.000Z', cancelProposedBy: 'seller' });
    await t.buyer.runtime.act(CODE, { type: 'propose-cancel-sign' });
    await until(() => t.parties.settles.some((s) => s.role === 'buyer' && s.o.cosigner === 'seller'));
    expect((await t.buyer.store.load(CODE))?.intent).toMatchObject({ kind: 'mutual-cancel', auto: false });
    // The proposal is gone (withdrawn): the standing release co-sign comes back.
    t.state.view = tradeView({ state: 'paid', paidAt: '2026-10-23T12:30:00.000Z', cancelProposedBy: null });
    await until(async () => (await t.buyer.store.load(CODE))?.intent?.kind === 'release');
    await until(() => t.parties.settles.at(-1)?.role === 'buyer' && t.parties.settles.at(-1)?.o.builder === 'seller');
  });

  it('a tap the trade view does not support is refused and changes nothing', async () => {
    const t = await ready();
    t.parties.funds = funded();
    t.state.view = tradeView({ state: 'paid', paidAt: '2026-10-23T12:30:00.000Z' });
    await until(async () => (await t.buyer.store.load(CODE))?.intent?.kind === 'release');
    // No cancel proposed and not settling a mutual cancel: the tap has nothing to sign.
    await expect(t.buyer.runtime.act(CODE, { type: 'propose-cancel-sign' })).rejects.toThrow();
    expect((await t.buyer.store.load(CODE))?.intent).toMatchObject({ kind: 'release', auto: true });
    // The seller's release tap outside secured/paid (here: refund_requested) is refused too.
    t.state.view = tradeView({ state: 'refund_requested' });
    await expect(t.seller.runtime.act(CODE, { type: 'release' })).rejects.toThrow();
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

describe('guards in front of settle', () => {
  async function ready(over: Partial<ApiState> = {}, sellerDeal: Partial<Parameters<typeof confirmedFor>[1]> = {}) {
    const t = await setup(over);
    const buyer = await t.mk('buyer');
    const seller = await t.mk('seller');
    await buyer.runtime.start(CODE);
    await seller.runtime.start(CODE, confirmedFor('seller', sellerDeal));
    return { ...t, buyer, seller };
  }

  it('the counterparty signed another deal: deal-mismatch on both sides, nothing settled', async () => {
    // The API tells the seller a different offer maximum, and the seller signs that.
    const t = await ready({ roleView: { seller: { maxFiatCents: '60000' } } }, { maxFiatCents: 60_000n });
    t.parties.funds = funded();
    t.state.view = tradeView({ state: 'paid', paidAt: '2026-10-23T12:30:00.000Z' });
    expect(await t.buyer.status((s) => s.phase === 'error')).toMatchObject({ error: 'deal-mismatch' });
    expect(await t.seller.status((s) => s.phase === 'error')).toMatchObject({ error: 'deal-mismatch' });
    expect((await t.buyer.store.load(CODE))?.theirDeal?.maxFiatCents).toBe(60_000n);
    await expect(t.seller.runtime.act(CODE, { type: 'release' })).rejects.toThrow();
    expect(t.parties.settles).toEqual([]);
  });

  async function settlingSeller() {
    const t = await ready();
    await until(async () => (await t.seller.store.load(CODE))?.theirDeal != null && (await t.buyer.store.load(CODE))?.theirDeal != null);
    t.parties.funds = funded();
    t.state.view = tradeView({ state: 'paid', paidAt: '2026-10-23T12:30:00.000Z' });
    await t.seller.runtime.act(CODE, { type: 'release' });
    await until(() => t.parties.settles.some((s) => s.role === 'seller'));
    await t.seller.runtime.stopAll();
    return t;
  }

  it('on resume, a stored outcome next to a changed counterparty deal is not settled', async () => {
    const t = await settlingSeller();
    const rec = (await t.seller.store.load(CODE))!;
    expect(rec.intent?.outcome).not.toBeNull();
    await t.seller.store.save({ ...rec, theirDeal: { ...rec.theirDeal!, maxFiatCents: 60_000n } });
    const sellers = () => t.parties.settles.filter((s) => s.role === 'seller').length;
    const count = sellers();
    const again = await t.mk('seller', { idb: t.seller.idb });
    await again.runtime.resumeAll();
    expect(await again.status((s) => s.phase === 'error')).toMatchObject({ error: 'deal-mismatch' });
    expect(sellers()).toBe(count);
  });

  it('on resume, a stored outcome is gated by cosignPolicy again: a tampered one is never settled', async () => {
    const t = await settlingSeller();
    const rec = (await t.seller.store.load(CODE))!;
    const o = rec.intent!.outcome!;
    const evil = { ...o, to: [{ address: '4AttackerAddress', amountAtomic: o.to[0]!.amountAtomic }, ...o.to.slice(1)] };
    await t.seller.store.save({ ...rec, intent: { ...rec.intent!, outcome: evil } });
    const count = t.parties.settles.length;
    const again = await t.mk('seller', { idb: t.seller.idb });
    await again.runtime.resumeAll();
    // The tick re-derives the true outcome and settles that; the stored one never reaches the party.
    await until(() => t.parties.settles.length > count);
    await t.parties.ticks('seller');
    expect(t.parties.settles.slice(count).every((s) => s.o.to.every((p) => p.address !== '4AttackerAddress'))).toBe(true);
    expect(t.parties.settles.slice(count).at(-1)!.o).toEqual({ kind: 'release', ...o });
  });

  it('no growth once this device knows of "I’ve paid", even while the API still says secured', async () => {
    const t = await ready();
    await until(async () => (await t.seller.store.load(CODE))?.theirDeal != null && (await t.buyer.store.load(CODE))?.theirDeal != null);
    t.state.view = tradeView({ state: 'secured' });
    t.parties.funds = funded();
    await t.buyer.runtime.act(CODE, { type: 'signal', signal: 'trade.paid' });
    await until(async () => (await t.seller.store.load(CODE))?.paidSeen === true);
    expect((await t.buyer.store.load(CODE))?.paidSeen).toBe(true);
    // Extra XMR that would grow the trade (within the offer maximum) arrives after the tap.
    const grown = 1_300_000_000_000n;
    const b = grown + grown / 100n;
    t.parties.funds = { balance: b, unlocked: b, incoming: [] };
    await Promise.all([t.parties.ticks('seller', 3), t.parties.ticks('buyer', 3)]);
    expect((await t.seller.store.load(CODE))?.sizeAtomic).toBe(AMOUNT);
    expect((await t.buyer.store.load(CODE))?.sizeAtomic).toBe(AMOUNT);
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
});

describe('after the trade closes: the escrow store is kept for 30 days or until this device saw its settle confirmed, whichever is later', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const empty = (confirmations = 12) => ({ balance: 0n, unlocked: 0n, incoming: [{ txHash: 'aa', amountAtomic: 1n, confirmations, unlocked: confirmations >= 10 }] });

  async function released(o: { settle?: boolean; settledElsewhereMs?: number } = {}) {
    let clock = Date.parse('2026-10-24T12:00:00.000Z');
    const t = await setup();
    const opts = { now: () => clock, ...(o.settledElsewhereMs !== undefined ? { settledElsewhereMs: o.settledElsewhereMs } : {}) };
    const seller = await t.mk('seller', opts);
    const buyer = await t.mk('buyer', opts);
    await seller.runtime.start(CODE);
    await buyer.runtime.start(CODE);
    await until(async () => (await seller.store.load(CODE))?.theirDeal != null && (await buyer.store.load(CODE))?.theirDeal != null);
    t.parties.funds = funded();
    t.state.view = tradeView({ state: 'paid', paidAt: '2026-10-23T12:30:00.000Z' });
    await seller.runtime.act(CODE, { type: 'release' });
    await until(() => t.parties.pending.some((p) => p.role === 'seller') && t.parties.pending.some((p) => p.role === 'buyer'));
    if (o.settle !== false) {
      for (const p of t.parties.pending.splice(0)) p.resolve(p.role === 'buyer' ? 'txhash' : null);
      await seller.status((s) => s.phase === 'done');
    }
    return { ...t, seller, buyer, advance: (ms: number) => (clock += ms) };
  }

  it('settled and confirmed: kept until 30 days after this device saw the trade closed, then both records go', async () => {
    const t = await released();
    t.state.view = tradeView({ state: 'released' });
    t.parties.funds = empty();
    await t.parties.ticks('seller', 3);
    expect(await t.seller.store.load(CODE)).not.toBeNull();
    t.advance(30 * DAY - 1);
    await t.parties.ticks('seller', 3);
    expect(await t.seller.store.load(CODE)).not.toBeNull();
    t.advance(1);
    await until(async () => (await t.seller.store.load(CODE)) === null);
    expect(await t.seller.store.password(CODE)).toBeNull();
    expect(t.seller.last()?.phase).toBe('done');
  });

  it('30 days passed but the settle tx is still in the pool: kept until it is in a block', async () => {
    const t = await released();
    t.state.view = tradeView({ state: 'released' });
    t.parties.funds = empty(0);
    await t.parties.ticks('seller');
    t.advance(31 * DAY);
    await t.parties.ticks('seller', 3);
    expect(await t.seller.store.load(CODE)).not.toBeNull();
    t.parties.funds = empty(1);
    await until(async () => (await t.seller.store.load(CODE)) === null);
  });

  it('the API says cancelled while the escrow still holds coins: never deleted, whatever the clock says', async () => {
    const t = await released({ settle: false });
    t.state.view = tradeView({ state: 'cancelled' });
    await t.parties.ticks('seller');
    t.advance(60 * DAY);
    await t.parties.ticks('seller', 3);
    expect(await t.seller.store.load(CODE)).not.toBeNull();
    expect(await t.seller.store.password(CODE)).not.toBeNull();
  });

  it('cancelled before any funding: nothing to settle, deleted only after 30 days', async () => {
    let clock = Date.parse('2026-10-24T12:00:00.000Z');
    const t = await setup();
    const seller = await t.mk('seller', { now: () => clock });
    const buyer = await t.mk('buyer');
    await seller.runtime.start(CODE);
    await buyer.runtime.start(CODE);
    await seller.status((s) => s.phase === 'ready');
    t.state.view = tradeView({ state: 'cancelled' });
    await t.parties.ticks('seller', 3);
    expect(await seller.store.load(CODE)).not.toBeNull();
    clock += 30 * DAY;
    await until(async () => (await seller.store.load(CODE)) === null);
  });

  it('closed and emptied while this device was still settling: settled elsewhere, escrow-failed, the store is kept', async () => {
    const t = await released({ settle: false, settledElsewhereMs: 60_000 });
    t.state.view = tradeView({ state: 'released' });
    await t.parties.ticks('seller');
    // Long after the close, the emptied escrow is seen while this device's own settle is still open.
    t.advance(31 * 24 * 60 * 60 * 1000);
    t.parties.funds = empty();
    await t.parties.ticks('seller', 3);
    expect(t.seller.last()?.phase).toBe('signing'); // not yet: the party may still catch up
    expect(await t.seller.store.load(CODE)).not.toBeNull(); // its own settle was never seen: kept
    t.advance(60_000);
    expect(await t.seller.status((s) => s.phase === 'error')).toMatchObject({ error: 'escrow-failed' });
    t.advance(60 * DAY);
    await t.parties.ticks('seller', 3);
    expect(await t.seller.store.load(CODE)).not.toBeNull();
  });

  it('the party reports settled-elsewhere: escrow-failed, never a quiet close', async () => {
    const t = await released({ settle: false });
    const p = t.parties.pending.find((x) => x.role === 'seller')!;
    p.reject(new PartyError('settled-elsewhere', 'another transaction emptied the escrow'));
    expect(await t.seller.status((s) => s.phase === 'error')).toMatchObject({ error: 'escrow-failed' });
    expect(await t.seller.store.load(CODE)).not.toBeNull();
  });

});
