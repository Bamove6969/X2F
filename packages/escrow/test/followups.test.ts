import { ROLES } from '@x2f/core';
import { ReplayGuard, open, seal } from '@x2f/protocol';
import { fundedWallet, mine, newTestWallet, startRegtest, type Regtest } from '@x2f/regtest';
import { buildRelay, type Relay } from '@x2f/relay';
import type { MoneroWalletFull } from 'monero-ts';
import sodium from 'libsodium-wrappers';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DAEMON_TIMEOUT_MS, EscrowError, MoneroMultisigEngine, MoneroMultisigSession, type EscrowSession, type Outcome } from '../src/index.js';
import { blackHole, faultyEngine, holdableProxy, minedWhile, partyKit, spyEngine, type Trade } from './harness.js';

const engine = new MoneroMultisigEngine({ network: 'regtest' });
const XMR = 1_000_000_000_000n;
const randomHash = (): string => sodium.to_hex(sodium.randombytes_buf(32));

describe('Plan 1 follow-ups on regtest', () => {
  let node: Regtest;
  let relay: Relay;
  let relayUrl: string;
  let funder: MoneroWalletFull;
  let funderAddress: string;
  let daemonUri = '';
  const kit = partyKit({ relay: () => relay, relayUrl: () => relayUrl, daemonUri: () => daemonUri, engine });
  const sessions: EscrowSession[] = [];

  beforeAll(async () => {
    await sodium.ready;
    node = await startRegtest();
    daemonUri = node.rpcUri;
    funder = await fundedWallet(node.rpcUri);
    funderAddress = await funder.getPrimaryAddress();
    relay = await buildRelay();
    await relay.app.listen({ host: '127.0.0.1', port: 0 });
    const addr = relay.app.server.address();
    relayUrl = `ws://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  });

  afterEach(async () => {
    await kit.stopAll();
    daemonUri = node.rpcUri;
  });

  afterAll(async () => {
    for (const s of sessions) await s.close().catch(() => undefined);
    await funder?.close();
    await relay?.app.close();
    await node?.stop();
  });

  async function pay(address: string, amount: bigint): Promise<string> {
    await funder.setDaemonConnection({ uri: node.rpcUri });
    await funder.sync();
    return (await funder.createTx({ accountIndex: 0, address, amount, relay: true })).getHash();
  }

  /** Returns the funding tx's hash. */
  async function readyAndFund(t: Trade, amount = XMR): Promise<string> {
    const addresses = await Promise.all(ROLES.map((r) => t.parties[r].ready()));
    expect(new Set(addresses).size).toBe(1);
    const funding = await pay(addresses[0]!, amount);
    await mine(node.rpcUri, 12, funderAddress);
    return funding;
  }

  it('txSeen is false for a tx only in the pool and true once it is in a block', async () => {
    const s = await engine.create({ daemonUri: node.rpcUri, password: 'x' });
    sessions.push(s);
    const dest = await newTestWallet(node.rpcUri);
    try {
      const hash = await pay(await dest.getPrimaryAddress(), XMR);
      expect(await s.txStatus(hash)).toBe('pool');
      expect(await s.txSeen(hash)).toBe(false);
      await mine(node.rpcUri, 1, funderAddress);
      expect(await s.txStatus(hash)).toBe('block');
      expect(await s.txSeen(hash)).toBe(true);
      expect(await s.txSeen(randomHash())).toBe(false);
      expect(await s.txSeen('not a hash')).toBe(false);
    } finally {
      await dest.close();
    }
  });

  it('a co-signer reporting a made-up DONE hash, or a real tx that did not spend the escrow, leaves the builder waiting', async () => {
    const t = await kit.newTrade();
    const funding = await readyAndFund(t);
    const dest = await newTestWallet(node.rpcUri);
    try {
      const o: Outcome = { kind: 'release', to: [{ address: await dest.getPrimaryAddress(), amountAtomic: XMR }], builder: 'seller', cosigner: 'buyer' };
      // The buyer co-signs and broadcasts, but its real DONE never reaches the seller...
      t.stores.buyer.onSave = (x) => {
        if (x.release?.phase === 'done') t.taps.buyer.dropSend = () => true;
      };
      let sellerResult: unknown = 'pending';
      void t.parties.seller.settle(o).then((v) => (sellerResult = v), (e: unknown) => (sellerResult = e));
      const hash = await t.parties.buyer.settle(o);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      // ...a made-up one does.
      const tag = t.stores.seller.current()!.release!.outcome.slice(0, 16);
      t.taps.seller.inject(await seal({ trade: t.code, from: 'buyer', seq: 1_000_000, type: 'release.done', payload: { key: `release.done:${tag}.0`, txHash: randomHash() }, to: ['seller'], me: t.ids.buyer, participants: t.participants }));
      await mine(node.rpcUri, 12, funderAddress);
      await expect.poll(() => t.stores.seller.current()?.received[`release.done:${tag}.0`]?.buyer !== undefined, { timeout: 30_000 }).toBe(true);
      // The escrow is empty and the real tx is in a block, but the reported hash is not: keep waiting.
      const s = await engine.create({ daemonUri: node.rpcUri, password: 'x' });
      sessions.push(s);
      expect(await s.txSeen(hash!)).toBe(true);
      await new Promise((r) => setTimeout(r, 8000));
      expect(sellerResult).toBe('pending');
      expect(t.stores.seller.current()!.release!.phase).toBe('built');
      expect(t.stores.seller.current()!.release!.txHash).toBeUndefined();
      // A real tx in a block, while the escrow is empty, that is not the tx that spent it.
      expect(await s.txSeen(funding)).toBe(true);
      // A DONE is stored once per outcome and the made-up one holds its slot, so restart the
      // seller as if the DONE it had received named the funding tx instead.
      await t.parties.seller.stop();
      const seller2 = t.stores.seller.current()!;
      t.stores.seller.set({ ...seller2, received: { ...seller2.received, [`release.done:${tag}.0`]: { buyer: { payload: { txHash: funding }, digest: 'x' } } } });
      const restarted = kit.startParty(t, 'seller');
      let restartedResult: unknown = 'pending';
      void restarted.party.settle(o).then((v) => (restartedResult = v), (e: unknown) => (restartedResult = e));
      await new Promise((r) => setTimeout(r, 8000));
      expect(restartedResult).toBe('pending');
      expect(t.stores.seller.current()!.release!.phase).toBe('built');
      expect(t.stores.seller.current()!.release!.txHash).toBeUndefined();
      // The real hash, in the same slot, is accepted: the waiting above was the check, not a stall.
      await restarted.party.stop();
      const seller3 = t.stores.seller.current()!;
      t.stores.seller.set({ ...seller3, received: { ...seller3.received, [`release.done:${tag}.0`]: { buyer: { payload: { txHash: hash! }, digest: 'x' } } } });
      expect(await kit.startParty(t, 'seller').party.settle(o)).toBeNull();
      expect(t.stores.seller.current()!.release!).toMatchObject({ phase: 'done', txHash: hash });
    } finally {
      await dest.close();
    }
  });

  it('a submit refused because another tx emptied the escrow stops for good, without resending', async () => {
    const t = await kit.newTrade();
    await readyAndFund(t);
    const dest = await newTestWallet(node.rpcUri);
    try {
      const o: Outcome = { kind: 'release', to: [{ address: await dest.getPrimaryAddress(), amountAtomic: XMR }], builder: 'seller', cosigner: 'buyer' };
      // The buyer signs, then dies before broadcasting.
      t.stores.buyer.onSave = (x) => {
        if (x.release?.phase === 'signed') throw new Error('power cut');
      };
      const sellerDone = t.parties.seller.settle(o);
      sellerDone.catch(() => undefined);
      expect(String(await t.parties.buyer.settle(o).catch((e: unknown) => e))).toMatch(/power cut/);
      await t.parties.buyer.stop();
      t.stores.buyer.onSave = undefined;
      const saved = t.stores.buyer.current()!;
      // That set reaches the chain anyway (another approved set, from this party's view)...
      const other = await engine.resume(saved.session, { daemonUri: node.rpcUri, password: 'pw-buyer' });
      sessions.push(other);
      const otherHash = await other.submit(saved.release!.signedHex!);
      await mine(node.rpcUri, 1, funderAddress);
      // ...while the party holds a different signed tx, which the daemon now refuses for good.
      t.stores.buyer.set({ ...saved, release: { ...saved.release!, signedHex: '00', txHash: randomHash() } });
      const spy = spyEngine(engine);
      const restarted = kit.startParty(t, 'buyer', { engine: spy });
      await restarted.party.ready();
      await expect(restarted.party.settle(o)).rejects.toMatchObject({ code: 'settled-elsewhere' });
      expect(t.stores.buyer.current()!.release!.phase).toBe('superseded');
      expect(spy.calls.submit).toBe(1);
      // It may still answer setup resends, but never sends a release message again.
      const sentBefore = restarted.tap.out.length;
      await new Promise((r) => setTimeout(r, 5000));
      const later = restarted.tap.out.slice(sentBefore);
      const keys: string[] = [];
      for (const env of later) {
        const opened = await open(env, { me: t.ids.seller, myRole: 'seller', participants: t.participants, trade: t.code, guard: new ReplayGuard(t.code) }).catch(() => null);
        if (opened) keys.push(String((opened.payload as { key: string }).key));
      }
      expect(keys.filter((k) => !k.startsWith('msig.'))).toEqual([]);
      expect(spy.calls.submit).toBe(1); // never resubmitted
      expect(spy.calls.buildRelease ?? 0).toBe(0); // never rebuilt
      expect(spy.calls.signRelease ?? 0).toBe(0);
      expect(await restarted.party.settle(o).catch((e: unknown) => e)).toMatchObject({ code: 'settled-elsewhere' });
      expect(otherHash).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      await dest.close();
    }
  });

  it('a co-signer whose submit fails while the escrow is still full keeps its signed tx and resubmits until it lands', async () => {
    // The daemon refuses the first submit (e.g. momentarily busy). The tx was never broadcast, so
    // txStatus reports 'none', but the escrow still holds the full balance: the balance guard at
    // party.ts must NOT treat this as "settled elsewhere" and must keep the signed tx to resubmit.
    const faulty = faultyEngine(engine, { submit: (n) => n === 1 });
    const t = await kit.newTrade({ buyer: { engine: faulty } });
    await readyAndFund(t);
    const dest = await newTestWallet(node.rpcUri);
    try {
      const o: Outcome = { kind: 'release', to: [{ address: await dest.getPrimaryAddress(), amountAtomic: XMR }], builder: 'seller', cosigner: 'buyer' };
      const [b, s] = await minedWhile(node.rpcUri, funderAddress, Promise.all([t.parties.buyer.settle(o), t.parties.seller.settle(o)]));
      // The co-signer resubmitted and the release landed: it never dropped the valid signed tx.
      expect(b).toMatch(/^[0-9a-f]{64}$/);
      expect(s).toBeNull();
      expect(faulty.calls.submit).toBeGreaterThanOrEqual(2); // failed once, then resubmitted
      expect(t.stores.buyer.current()!.release!.phase).toBe('done');
    } finally {
      await dest.close();
    }
  });

  it("re-review n-f1: a builder whose set the co-signer refused drops that attempt's fee with its key when it follows to the next attempt, then settles", async () => {
    // The buyer's first check of the seller's set refuses it (a retryable payout-mismatch): the buyer
    // moves to attempt 2 and the seller, which built and stored attempt 1's key and fee, follows.
    const refusing = faultyEngine(engine, { checkRelease: (n) => n === 1 }, () => new EscrowError('payout-mismatch', 'injected refusal'));
    const t = await kit.newTrade({ buyer: { engine: refusing } });
    await readyAndFund(t);
    const dest = await newTestWallet(node.rpcUri);
    const saves: { attempt: number; phase: string; txKey?: string; txFee?: string }[] = [];
    t.stores.seller.onSave = (x) => {
      if (x.release) saves.push(structuredClone(x.release) as (typeof saves)[number]);
    };
    try {
      const o: Outcome = { kind: 'release', to: [{ address: await dest.getPrimaryAddress(), amountAtomic: XMR }], builder: 'seller', cosigner: 'buyer' };
      const [b, s] = await minedWhile(node.rpcUri, funderAddress, Promise.all([t.parties.buyer.settle(o), t.parties.seller.settle(o)]));
      expect(b).toMatch(/^[0-9a-f]{64}$/);
      expect(s).toBeNull();
      expect(refusing.calls.checkRelease).toBeGreaterThanOrEqual(2);
      // Attempt 1 was built with its key and fee stored ...
      const built1 = saves.find((r) => r.attempt === 1 && r.phase === 'built');
      expect(built1?.txKey).toMatch(/^[0-9a-f]{64}$/);
      expect(built1?.txFee).toMatch(/^[1-9][0-9]*$/);
      // ... and the first save of attempt 2 (nextAttempt's) holds neither.
      const next = saves.find((r) => r.attempt === 2);
      expect(next).toMatchObject({ phase: 'waiting-funds' });
      expect(next!.txKey).toBeUndefined();
      expect(next!.txFee).toBeUndefined();
      expect(t.stores.seller.current()!.release!.phase).toBe('done');
    } finally {
      t.stores.seller.onSave = undefined;
      await dest.close();
    }
  });

  it('a co-signer committed to a set signs it with the bound it checked, even once the node gives no fee estimate (review M3)', async () => {
    const t = await kit.newTrade();
    await readyAndFund(t);
    const dest = await newTestWallet(node.rpcUri);
    const realFetch = globalThis.fetch;
    try {
      const o: Outcome = { kind: 'release', to: [{ address: await dest.getPrimaryAddress(), amountAtomic: XMR }], builder: 'seller', cosigner: 'buyer' };
      // The buyer checks the seller's set, commits to it, then dies before signing.
      t.stores.buyer.onSave = (x) => {
        if (x.release?.phase === 'cosigning') throw new Error('power cut');
      };
      const sellerDone = t.parties.seller.settle(o);
      sellerDone.catch(() => undefined);
      expect(String(await t.parties.buyer.settle(o).catch((e: unknown) => e))).toMatch(/power cut/);
      await t.parties.buyer.stop();
      t.stores.buyer.onSave = undefined;
      const saved = t.stores.buyer.current()!;
      expect(saved.release).toMatchObject({ phase: 'cosigning', committed: true });
      // The bound of that check is kept with the committed set (a decimal string: the state is JSON).
      expect((saved.release as { feeCeiling?: unknown }).feeCeiling).toMatch(/^[1-9][0-9]*$/);
      // From now on the node answers everything but get_fee_estimate.
      let asked = 0;
      vi.stubGlobal('fetch', (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        if (typeof init?.body === 'string' && init.body.includes('get_fee_estimate')) {
          asked += 1;
          return Promise.reject(new TypeError('fee estimate withheld'));
        }
        return realFetch(input, init);
      });
      const restarted = kit.startParty(t, 'buyer');
      const stalled = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('still cosigning: the node withholds the fee estimate')), 120_000));
      stalled.catch(() => undefined);
      const [b, s] = await minedWhile(node.rpcUri, funderAddress, Promise.race([Promise.all([restarted.party.settle(o), sellerDone]), stalled]));
      expect(b).toMatch(/^[0-9a-f]{64}$/);
      expect(s).toBeNull();
      expect(asked).toBe(0);
    } finally {
      vi.unstubAllGlobals();
      await dest.close();
    }
  });

  it('a frame whose raw `from` differs from the signed one is attributed to the signed sender', async () => {
    const t = await kit.newTrade();
    await Promise.all(ROLES.map((r) => t.parties[r].ready()));
    const o: Outcome = { kind: 'release', to: [{ address: 'nowhere', amountAtomic: XMR }], builder: 'seller', cosigner: 'buyer' };
    void t.parties.buyer.settle(o).catch(() => undefined);
    await expect.poll(() => t.stores.buyer.current()?.release?.outcome).toBeTruthy();
    const tag = t.stores.buyer.current()!.release!.outcome.slice(0, 16);
    const key = `state.export:${tag}.1`;
    const e = await seal({ trade: t.code, from: 'seller', seq: 1_000_000, type: 'state.export', payload: { key, hex: 'x' }, to: ['buyer'], me: t.ids.seller, participants: t.participants });
    // The checks see the signed fields; a later read of `from` says 'mod'.
    t.taps.buyer.inject(new Proxy({ ...e }, { get: (target, k) => (k === 'from' ? 'mod' : Reflect.get(target, k)) }));
    await expect.poll(() => t.stores.buyer.current()?.received[key]?.seller !== undefined, { timeout: 30_000 }).toBe(true);
    expect(t.stores.buyer.current()!.received[key]!.mod).toBeUndefined();
  });

  it('a daemon that stops answering: the party sees a retryable timeout, keeps going and settles', async () => {
    const proxy = await holdableProxy(node.rpcUri);
    try {
      daemonUri = proxy.uri;
      const t = await kit.newTrade();
      await readyAndFund(t);
      const dest = await newTestWallet(node.rpcUri);
      try {
        const o: Outcome = { kind: 'release', to: [{ address: await dest.getPrimaryAddress(), amountAtomic: XMR }], builder: 'seller', cosigner: 'buyer' };
        proxy.hold();
        const settled = Promise.all(ROLES.map((r) => t.parties[r].settle(o)));
        settled.catch(() => undefined);
        await expect.poll(() => kit.ignoredBy.buyer.includes('daemon-unavailable'), { timeout: 3 * DAEMON_TIMEOUT_MS, interval: 500 }).toBe(true);
        proxy.release();
        const [b, s] = await minedWhile(node.rpcUri, funderAddress, settled);
        expect(b).toMatch(/^[0-9a-f]{64}$/);
        expect(s).toBeNull();
      } finally {
        await dest.close();
      }
    } finally {
      await proxy.close();
    }
  });

  it(`sync and txStatus give up after ${DAEMON_TIMEOUT_MS / 1000} s with a retryable error`, async () => {
    expect(DAEMON_TIMEOUT_MS).toBe(15_000);
    const hole = await blackHole();
    // A wallet created against the real node (creating one needs the daemon), then pointed at the hole.
    const real = await engine.create({ daemonUri: node.rpcUri, password: 'x' });
    sessions.push(real);
    const s = new MoneroMultisigSession(real.wallet, hole.uri, 'x');
    try {
      for (const call of [() => s.sync(), () => s.txStatus(randomHash())]) {
        const started = Date.now();
        const err = await call().then(() => null, (e: unknown) => e);
        const took = Date.now() - started;
        expect(err).toBeInstanceOf(EscrowError);
        expect((err as EscrowError).code).toBe('daemon-unavailable');
        expect(took).toBeGreaterThanOrEqual(DAEMON_TIMEOUT_MS - 100);
        expect(took).toBeLessThan(DAEMON_TIMEOUT_MS + 5000);
      }
    } finally {
      await hole.close(); // the dropped calls now fail fast, so the wallet can close
    }
  });

  it(`submit and build also give up after ${DAEMON_TIMEOUT_MS / 1000} s with a retryable error`, async () => {
    // The black-hole wallet above runs in a worker, so a daemon that never answers is cut off by
    // the timeout rather than freezing the event loop. `submit` and `createTxs` (inside
    // `buildRelease`) need a funded multisig wallet to reach the daemon at all, and a resumed
    // regtest wallet runs in-process (it would freeze, not time out), so instead a stub wallet whose
    // daemon-facing calls never resolve isolates the `timed` wrapper on each: `submit` gives up as a
    // retryable `daemon-unavailable`, and a build that cannot reach the daemon as `not-ready`.
    const never = <T>(): Promise<T> => new Promise<T>(() => undefined);
    const stub = {
      getBalance: async () => XMR,
      getUnlockedBalance: async () => XMR,
      submitMultisigTxHex: () => never<string[]>(),
      createTxs: () => never<unknown>(),
    } as unknown as MoneroWalletFull;
    const s = new MoneroMultisigSession(stub, 'http://127.0.0.1:1', 'pw');
    const payouts = [{ address: 'escrow-stub-address', amountAtomic: XMR }];
    const calls: [() => Promise<unknown>, 'daemon-unavailable' | 'not-ready'][] = [
      [() => s.submit('deadbeef'), 'daemon-unavailable'],
      [() => s.buildRelease(payouts), 'not-ready'],
    ];
    for (const [call, code] of calls) {
      const started = Date.now();
      const err = await call().then(() => null, (e: unknown) => e);
      const took = Date.now() - started;
      expect(err).toBeInstanceOf(EscrowError);
      expect((err as EscrowError).code).toBe(code);
      expect(took).toBeGreaterThanOrEqual(DAEMON_TIMEOUT_MS - 100);
      expect(took).toBeLessThan(DAEMON_TIMEOUT_MS + 5000);
    }
  });

  it('a set wallet2 refuses for good ("destination amount is zero") is a permanent build-failed, not a retryable not-ready (re-verify N2)', async () => {
    // Re-verify 17 Nov, N2: a 0.02 XMR trade with a 0.0017952 XMR payout fee (regtest's 2-output
    // fee). The X2F fee output is 0.0002 XMR, below its wallet2 share floor(F/2) = 0.0008976 XMR,
    // so wallet2 refuses the marked set with "destination amount is zero". No fresh attempt can
    // build it, so it must not be reported as the retryable not-ready. Any other build error stays
    // not-ready (e.g. multisig state not imported yet: a fresh export recovers).
    const amount = 20_000_000_000n; // 0.02 XMR
    const fee = 200_000_000n; // its 1%
    const payouts = [
      { address: 'buyer-stub-address', amountAtomic: amount - fee, bearsNetworkFee: true },
      { address: 'fee-stub-address', amountAtomic: fee, bearsNetworkFee: true },
    ];
    const session = (refusal: string): MoneroMultisigSession => new MoneroMultisigSession({
      getBalance: async () => amount,
      getUnlockedBalance: async () => amount,
      createTxs: async () => { throw new Error(refusal); },
    } as unknown as MoneroWalletFull, 'http://127.0.0.1:1', 'pw');
    const zero = await session('destination amount is zero').buildRelease(payouts).then(() => null, (e: unknown) => e);
    expect(zero).toBeInstanceOf(EscrowError);
    expect((zero as EscrowError).code).toBe('build-failed');
    expect((zero as EscrowError).message).toMatch(/destination amount is zero/);
    const other = await session('multisig wallet: outputs not yet imported').buildRelease(payouts).then(() => null, (e: unknown) => e);
    expect(other).toBeInstanceOf(EscrowError);
    expect((other as EscrowError).code).toBe('not-ready');
  });
});
