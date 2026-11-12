// Late-funds step 1 (docs/superpowers/specs/2026-11-12-escrow-later-release.md): a later release
// from an escrow that was already paid out. Coins that arrive after the release stay in the escrow
// until a moderator rules (owner, 30 Oct); paying that ruling is a second 2-of-3 release, allowed only
// after a recorded done release (Outcome.after names the tx that emptied the escrow), moderator-built,
// for the remaining balance only, with a fresh multisig export, at most MAX_LATER_RELEASES per escrow.
import { ROLES, feeFor, type Role } from '@x2f/core';
import { canonicalJson, open, ReplayGuard, seal, type Envelope } from '@x2f/protocol';
import { fundedWallet, mine, newTestWallet, startRegtest, type Regtest } from '@x2f/regtest';
import { buildRelay, type Relay } from '@x2f/relay';
import sodium from 'libsodium-wrappers';
import type { MoneroWalletFull } from 'monero-ts';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MAX_LATER_RELEASES, MoneroMultisigEngine, PartyError, releaseTag, type Outcome, type PartyState } from '../src/index.js';
import { minedWhile, partyKit, type Trade } from './harness.js';

const engine = new MoneroMultisigEngine({ network: 'regtest' });
const XMR = 1_000_000_000_000n;
const MAX_NET_FEE = XMR / 100n;

describe('the release tag (pure)', () => {
  it("a first release's tag is unchanged (states and peers on today's code agree); a later one's covers `after`", async () => {
    await sodium.ready;
    const to = [{ address: '4'.padEnd(95, 'A'), amountAtomic: 123n }];
    const first: Outcome = { kind: 'release', to, builder: 'seller', cosigner: 'buyer' };
    const pinned = sodium.to_hex(
      sodium.crypto_generichash(32, canonicalJson({ key: 'outcome', payload: { builder: 'seller', cosigner: 'buyer', to: [{ address: to[0]!.address, amount: '123' }] } }), null),
    ).slice(0, 16);
    expect(releaseTag(first)).toBe(pinned);
    const later: Outcome = { ...first, builder: 'mod', cosigner: 'seller', after: 'a'.repeat(64) };
    const again: Outcome = { ...later, after: 'b'.repeat(64) };
    const { after: _after, ...noAfter } = later;
    expect(releaseTag(later)).not.toBe(releaseTag(noAfter));
    expect(releaseTag(later)).not.toBe(releaseTag(again)); // identical payouts, another earlier release
    expect(MAX_LATER_RELEASES).toBe(10);
  });
});

describe('a later release from a paid-out escrow, on regtest', () => {
  let node: Regtest;
  let relay: Relay;
  let relayUrl: string;
  let funder: MoneroWalletFull;
  let funderAddress: string;
  const kit = partyKit({ relay: () => relay, relayUrl: () => relayUrl, daemonUri: () => node.rpcUri, engine });
  const wallets: MoneroWalletFull[] = [];

  beforeAll(async () => {
    await sodium.ready;
    node = await startRegtest();
    funder = await fundedWallet(node.rpcUri);
    funderAddress = await funder.getPrimaryAddress();
    relay = await buildRelay();
    await relay.app.listen({ host: '127.0.0.1', port: 0 });
    const addr = relay.app.server.address();
    relayUrl = `ws://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  });
  afterEach(async () => {
    await kit.stopAll();
  });
  afterAll(async () => {
    for (const w of wallets.splice(0)) await w.close();
    await funder?.close();
    await relay?.app.close();
    await node?.stop();
  });

  const mining = <T,>(p: Promise<T>): Promise<T> => minedWhile(node.rpcUri, funderAddress, p);
  async function wallet(): Promise<{ w: MoneroWalletFull; address: string }> {
    const w = await newTestWallet(node.rpcUri);
    wallets.push(w);
    return { w, address: await w.getPrimaryAddress() };
  }
  async function balanceOf(w: MoneroWalletFull): Promise<bigint> {
    await w.setDaemonConnection({ uri: node.rpcUri });
    await w.sync();
    return w.getBalance();
  }
  async function pay(address: string, amount: bigint): Promise<void> {
    await funder.setDaemonConnection({ uri: node.rpcUri });
    await funder.sync();
    await funder.createTx({ accountIndex: 0, address, amount, relay: true });
    await mine(node.rpcUri, 12, funderAddress);
  }
  async function funded(amount: bigint): Promise<{ t: Trade; escrow: string }> {
    const t = await kit.newTrade();
    const addresses = await Promise.all(ROLES.map((r) => t.parties[r].ready()));
    expect(new Set(addresses).size).toBe(1);
    await pay(addresses[0]!, amount);
    return { t, escrow: addresses[0]! };
  }
  /** The first release, by `builder` co-signed by `cosigner`, paying `to`; resolves with the tx hash. */
  async function firstRelease(t: Trade, o: Outcome): Promise<string> {
    const r = await mining(Promise.all([t.parties[o.builder].settle(o), t.parties[o.cosigner].settle(o)]));
    const tx = r[1]!;
    expect(tx).toMatch(/^[0-9a-f]{64}$/);
    return tx;
  }
  /** Late coins reach the escrow and unlock; resolves once `role`'s party reads them all (it imported what it needs). */
  async function late(t: Trade, escrow: string, amount: bigint, roles: readonly Role[]): Promise<void> {
    await pay(escrow, amount);
    for (const r of roles) {
      await expect.poll(async () => {
        const f = await t.parties[r].funds();
        return f.unlocked > 0n && f.balance === f.unlocked ? 'unlocked' : `${f.balance}/${f.unlocked}`;
      }, { timeout: 120_000, interval: 1000 }).toBe('unlocked');
    }
  }
  const laterRelease = (to: { address: string; amountAtomic: bigint }[], after: string, cosigner: Role = 'seller'): Outcome => ({ kind: 'release', to, builder: 'mod', cosigner, after });

  it('late refund: after a seller-built release, the moderator builds the remainder to the seller, the seller co-signs; the first payout is untouched', async () => {
    const amount = XMR;
    const { t, escrow } = await funded(amount);
    const buyer = await wallet();
    const seller = await wallet();
    const fee = feeFor(amount);
    const feeW = await wallet();
    const first = await firstRelease(t, { kind: 'release', to: [{ address: buyer.address, amountAtomic: amount - fee }, { address: feeW.address, amountAtomic: fee }], builder: 'seller', cosigner: 'buyer' });
    await mine(node.rpcUri, 12, funderAddress);
    const buyerGot = await balanceOf(buyer.w);
    const lateAmount = 300_000_000_000n;
    await late(t, escrow, lateAmount, ['mod', 'seller']);

    // The refusals first (nothing saved or sent): no `after`, an `after` that is not the seller's own
    // done release, a trader-built later release.
    const sentBefore = t.taps.seller.sent;
    const to = [{ address: seller.address, amountAtomic: lateAmount }];
    for (const bad of [
      { kind: 'release', to, builder: 'mod', cosigner: 'seller' } as Outcome,
      laterRelease(to, 'c'.repeat(64)),
      { ...laterRelease(to, first), builder: 'buyer' } as Outcome,
    ]) {
      await expect(t.parties.seller.settle(bad), JSON.stringify(bad.after ?? null)).rejects.toMatchObject({ code: 'bad-outcome' });
    }
    expect(t.taps.seller.sent).toBe(sentBefore);

    const o = laterRelease(to, first);
    const [m, s] = await mining(Promise.all([t.parties.mod.settle(o), t.parties.seller.settle(o)]));
    expect(m).toBeNull();
    expect(s).toMatch(/^[0-9a-f]{64}$/);
    expect(s).not.toBe(first);
    await mine(node.rpcUri, 12, funderAddress);
    const got = await balanceOf(seller.w);
    expect(got).toBeLessThan(lateAmount);
    expect(got).toBeGreaterThan(lateAmount - MAX_NET_FEE);
    expect(await balanceOf(buyer.w)).toBe(buyerGot);
    expect(await balanceOf(feeW.w)).toBe(fee);
    // The seller's history keeps its first release; the moderator lists the tx it signed.
    expect(t.stores.seller.current()!.releases?.map((r) => [r.phase, r.txHash])).toEqual([['done', first]]);
    expect((await t.parties.mod.funds()).ownTxs).toContain(s);

    // A third episode: more late coins, named by the second release; and the cap holds.
    const more = 200_000_000_000n;
    await late(t, escrow, more, ['mod', 'seller']);
    const o3 = laterRelease([{ address: seller.address, amountAtomic: more }], s!);
    const [, s3] = await mining(Promise.all([t.parties.mod.settle(o3), t.parties.seller.settle(o3)]));
    expect(s3).toMatch(/^[0-9a-f]{64}$/);
    await mine(node.rpcUri, 12, funderAddress);
    expect(await balanceOf(seller.w)).toBeGreaterThan(got + more - MAX_NET_FEE);
    expect(t.stores.seller.current()!.releases?.map((r) => r.txHash)).toEqual([first, s]);
  });

  it('a restart in the middle of a later release resumes it from the stores, reuses nothing of the earlier release, and settles once', async () => {
    const amount = XMR;
    const { t, escrow } = await funded(amount);
    const buyer = await wallet();
    const seller = await wallet();
    const first = await firstRelease(t, { kind: 'release', to: [{ address: buyer.address, amountAtomic: amount }], builder: 'seller', cosigner: 'buyer' });
    const lateAmount = 250_000_000_000n;
    await late(t, escrow, lateAmount, ['mod', 'seller']);
    const o = laterRelease([{ address: seller.address, amountAtomic: lateAmount }], first);
    const tag = releaseTag(o);
    const firstTag = t.stores.seller.current()!.release!.outcome.slice(0, 16);
    const modP = t.parties.mod.settle(o);
    const sellerP = t.parties.seller.settle(o);
    modP.catch(() => undefined);
    sellerP.catch(() => undefined);
    // Both exported for the later release; then both processes die.
    await expect.poll(() => t.stores.mod.current()?.sent[`state.export:${tag}.1`] !== undefined && t.stores.seller.current()?.sent[`state.export:${tag}.1`] !== undefined, { timeout: 120_000 }).toBe(true);
    await t.parties.mod.stop();
    await t.parties.seller.stop();
    const before = { mod: t.stores.mod.current()!.sent[`state.export:${tag}.1`], seller: t.stores.seller.current()!.sent[`state.export:${tag}.1`] };
    t.parties.mod = kit.startParty(t, 'mod').party;
    t.parties.seller = kit.startParty(t, 'seller').party;
    const [, s] = await mining(Promise.all([t.parties.mod.settle(o), t.parties.seller.settle(o)]));
    expect(s).toMatch(/^[0-9a-f]{64}$/);
    // The saved exports were resent, not replaced; no key of the first release was touched again.
    expect(t.stores.mod.current()!.sent[`state.export:${tag}.1`]).toEqual(before.mod);
    expect(t.stores.seller.current()!.sent[`state.export:${tag}.1`]).toEqual(before.seller);
    expect(Object.keys(t.stores.seller.current()!.sent).filter((k) => k.includes(firstTag) && k.includes(tag))).toEqual([]);
    await mine(node.rpcUri, 12, funderAddress);
    const got = await balanceOf(seller.w);
    expect(got).toBeGreaterThan(lateAmount - MAX_NET_FEE);
    expect(got).toBeLessThan(lateAmount);
  });

  it('a wrong amount never builds; and a builder\'s set for other payouts is refused at the co-signer\'s check, with nothing signed', async () => {
    const amount = XMR;
    const { t, escrow } = await funded(amount);
    const buyer = await wallet();
    const seller = await wallet();
    const other = await wallet();
    const first = await firstRelease(t, { kind: 'release', to: [{ address: buyer.address, amountAtomic: amount }], builder: 'seller', cosigner: 'buyer' });
    const lateAmount = 400_000_000_000n;
    await late(t, escrow, lateAmount, ['mod', 'seller']);

    // (a) The payouts do not sum to the remaining balance: the moderator never exports or builds.
    const short = laterRelease([{ address: seller.address, amountAtomic: lateAmount - 1n }], first);
    t.parties.mod.settle(short).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 8000));
    expect(t.stores.mod.current()!.release).toMatchObject({ phase: 'waiting-funds' });
    expect(t.stores.mod.current()!.sent[`state.export:${releaseTag(short)}.1`]).toBeUndefined();

    // (b) A malicious builder: the seller expects the whole remainder (S). The moderator is made to
    // build a real set for other payouts (W: half to another wallet), and its export and set are
    // re-sealed under S's tag and handed to the seller. The seller imports, checks, refuses, signs nothing.
    const S = laterRelease([{ address: seller.address, amountAtomic: lateAmount }], first);
    const W = laterRelease([{ address: seller.address, amountAtomic: lateAmount / 2n }, { address: other.address, amountAtomic: lateAmount / 2n }], first);
    const tagS = releaseTag(S);
    const tagW = releaseTag(W);
    t.parties.seller.settle(S).catch(() => undefined);
    await expect.poll(() => t.stores.seller.current()?.sent[`state.export:${tagS}.1`] !== undefined, { timeout: 120_000 }).toBe(true);
    const openFor = async (e: Envelope, me: Role) => open(e, { me: t.ids[me], myRole: me, participants: t.participants, trade: t.code, guard: new ReplayGuard(t.code) });
    // The seller's export for S, re-sealed as the seller's export for W, hands the moderator what it needs to build W.
    const sellerExport = await (async () => {
      for (const e of t.taps.seller.out) {
        const x = await openFor(e, 'mod').catch(() => null);
        if (x && (x.payload as { key?: string }).key === `state.export:${tagS}.1`) return x.payload as { hex: string };
      }
      throw new Error('no seller export');
    })();
    let sellerSeq = t.stores.seller.current()!.seq + 1000;
    t.taps.mod.inject(await seal({ trade: t.code, from: 'seller', seq: ++sellerSeq, type: 'state.export', payload: { key: `state.export:${tagW}.1`, hex: sellerExport.hex }, to: ['mod'], me: t.ids.seller, participants: t.participants }));
    t.parties.mod.settle(W).catch(() => undefined);
    await expect.poll(() => t.stores.mod.current()?.sent[`release.txset:${tagW}.1`] !== undefined, { timeout: 120_000 }).toBe(true);
    const modState = t.stores.mod.current()!;
    let modSeq = modState.seq + 1000;
    const relabel = async (key: string, payload: Record<string, string>) =>
      seal({ trade: t.code, from: 'mod', seq: ++modSeq, type: key.split(':')[0]!, payload: { key, ...payload }, to: ['seller'], me: t.ids.mod, participants: t.participants });
    t.taps.seller.inject(await relabel(`state.export:${tagS}.1`, { hex: String(modState.sent[`state.export:${tagW}.1`]!.hex) }));
    t.taps.seller.inject(await relabel(`release.txset:${tagS}.1`, { txSet: String(modState.sent[`release.txset:${tagW}.1`]!.txSet) }));
    await expect.poll(() => kit.ignoredBy.seller.includes('cosign-payout-mismatch'), { timeout: 120_000 }).toBe(true);
    const rel = t.stores.seller.current()!.release!;
    expect(rel.attempt).toBe(2); // refused once: the next attempt starts afresh
    expect(rel.signedHex).toBeUndefined();
    expect(['waiting-funds', 'export']).toContain(rel.phase); // never 'cosigning' or 'signed'
    expect((await t.parties.seller.funds()).balance).toBe(lateAmount); // nothing left the escrow
    expect(await balanceOf(other.w)).toBe(0n);
  });

  it('a co-signer who took no part in the earlier release: after a buyer cancel the moderator co-signed, the remainder goes to the seller', async () => {
    const amount = XMR;
    const { t, escrow } = await funded(amount);
    const refund = await wallet();
    const seller = await wallet();
    const first = await firstRelease(t, { kind: 'release', to: [{ address: refund.address, amountAtomic: amount }], builder: 'buyer', cosigner: 'mod' });
    const lateAmount = 350_000_000_000n;
    // The seller never saw the first spend; the moderator signed it and reads the late coins exactly.
    await late(t, escrow, lateAmount, ['mod']);
    expect(t.stores.seller.current()!.release).toBeNull();
    const o = laterRelease([{ address: seller.address, amountAtomic: lateAmount }], first);
    const [, s] = await mining(Promise.all([t.parties.mod.settle(o), t.parties.seller.settle(o)]));
    expect(s).toMatch(/^[0-9a-f]{64}$/);
    await mine(node.rpcUri, 12, funderAddress);
    expect(await balanceOf(seller.w)).toBeGreaterThan(lateAmount - MAX_NET_FEE);
    const own = (await t.parties.mod.funds()).ownTxs;
    expect(own).toContain(first);
    expect(own).toContain(s);
  });

  it(`the safety cap: after ${MAX_LATER_RELEASES} later releases an escrow refuses another`, async () => {
    const amount = XMR;
    const { t } = await funded(amount);
    const buyer = await wallet();
    const first = await firstRelease(t, { kind: 'release', to: [{ address: buyer.address, amountAtomic: amount }], builder: 'seller', cosigner: 'buyer' });
    // The seller's saved history as if ten later releases had been done after the first.
    await t.parties.seller.stop();
    const s = t.stores.seller.current()!;
    const done = s.release!;
    const history: NonNullable<PartyState['releases']> = [{ ...done }];
    for (let i = 1; i < MAX_LATER_RELEASES; i++) history.push({ ...done, outcome: String(i).repeat(64).slice(0, 64), txHash: String(i % 10).repeat(64) });
    const last = 'e'.repeat(64);
    t.stores.seller.set({ ...s, releases: history, release: { ...done, outcome: 'f'.repeat(64), txHash: last } });
    t.parties.seller = kit.startParty(t, 'seller').party;
    await t.parties.seller.ready();
    await expect(t.parties.seller.settle(laterRelease([{ address: buyer.address, amountAtomic: 1n }], last))).rejects.toBeInstanceOf(PartyError);
    await expect(t.parties.seller.settle(laterRelease([{ address: buyer.address, amountAtomic: 1n }], last))).rejects.toMatchObject({ code: 'bad-outcome' });
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });
});
